//! Pack-owned role presentation and the public role reference (RFC 0009).
//!
//! A pack's rules stay in `pack.json` and its content address; the words a
//! player reads live in a sibling `presentation.json`. This module validates
//! that sidecar against its pack in both directions and joins the two into a
//! [`RoleReference`]: the one place a role's display name, ability labels,
//! traits, channels and win copy are derived. The projection reads pack rules
//! only, so it can never express which slot holds a role.

use std::collections::{BTreeMap, BTreeSet};

use domain::pack::{
    ActionTemplate, DeathRevealMode, PrivateChannelAlignmentReveal, PrivateChannelGroup,
    PrivateChannelKind, Role, RoleModifier, TargetSpec,
};
use domain::Pack;
use game_platform::role_reference::{
    AlignmentFamily, AlignmentReference, PackRoleReference, PackSummary, RoleActionReference,
    RoleActionTargets, RoleChannel, RoleReference, RoleTrait,
};
use serde::{Deserialize, Serialize};

pub const PRESENTATION_SCHEMA_VERSION: u16 = 1;

const NAME_MAX: usize = 40;
const LABEL_MAX: usize = 32;
const SHORT_MAX: usize = 24;
const TEXT_MAX: usize = 80;
const SUMMARY_MAX: usize = 180;
const WIN_MAX: usize = 140;

/// The sidecar document, `packs/<key>/presentation.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackPresentation {
    pub schema_version: u16,
    pub pack: String,
    pub name: String,
    pub alignments: BTreeMap<String, AlignmentPresentation>,
    pub effects: BTreeMap<String, TraitPresentation>,
    /// Ability labels keyed by action template id. Ids repeat across roles
    /// (every Framer frames), so labels are pack-level.
    pub actions: BTreeMap<String, String>,
    pub roles: BTreeMap<String, RolePresentation>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AlignmentPresentation {
    pub label: String,
    pub family: AlignmentFamily,
    pub win: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TraitPresentation {
    pub text: String,
    pub short: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RolePresentation {
    pub name: String,
    pub summary: String,
    /// Required when the role's win is not its alignment's: unaligned roles
    /// and survival-award roles. Rejected elsewhere so copy cannot drift from
    /// the pack's win table.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub win: Option<String>,
}

/// Validate a sidecar against its pack. Coverage is closed both ways: every
/// role, role-borne effect tag, role action id and alignment in play has copy,
/// and every copy key names something in the pack.
pub fn validate_presentation(pack: &Pack, presentation: &PackPresentation) -> Result<(), String> {
    if presentation.schema_version != PRESENTATION_SCHEMA_VERSION {
        return Err(format!(
            "unsupported presentation schema {}",
            presentation.schema_version
        ));
    }
    if presentation.pack != pack.name {
        return Err(format!(
            "presentation identity drift: pack={}, presentation={}",
            pack.name, presentation.pack
        ));
    }
    text("name", &presentation.name, NAME_MAX)?;

    closed(
        "roles",
        pack.roles.keys().cloned().collect(),
        presentation.roles.keys().cloned().collect(),
    )?;
    closed(
        "effects",
        pack.roles
            .values()
            .flat_map(|role| role.effects.iter().cloned())
            .collect(),
        presentation.effects.keys().cloned().collect(),
    )?;
    closed(
        "actions",
        pack.roles
            .values()
            .flat_map(|role| role.actions.iter().map(|action| action.id.clone()))
            .collect(),
        presentation.actions.keys().cloned().collect(),
    )?;
    closed(
        "alignments",
        pack.roles
            .values()
            .filter_map(|role| role.alignment.clone())
            .chain(pack.win.rules.iter().map(|rule| rule.winner.clone()))
            .collect(),
        presentation.alignments.keys().cloned().collect(),
    )?;

    for (key, alignment) in &presentation.alignments {
        text(
            &format!("alignments.{key}.label"),
            &alignment.label,
            NAME_MAX,
        )?;
        text(&format!("alignments.{key}.win"), &alignment.win, WIN_MAX)?;
    }
    for (key, effect) in &presentation.effects {
        text(&format!("effects.{key}.text"), &effect.text, TEXT_MAX)?;
        text(&format!("effects.{key}.short"), &effect.short, SHORT_MAX)?;
    }
    for (key, label) in &presentation.actions {
        text(&format!("actions.{key}"), label, LABEL_MAX)?;
    }
    let survival_roles = survival_award_roles(pack);
    for (key, copy) in &presentation.roles {
        text(&format!("roles.{key}.name"), &copy.name, NAME_MAX)?;
        text(&format!("roles.{key}.summary"), &copy.summary, SUMMARY_MAX)?;
        let role = &pack.roles[key];
        let needs_win = role.alignment.is_none() || survival_roles.contains(key.as_str());
        match (&copy.win, needs_win) {
            (Some(win), true) => text(&format!("roles.{key}.win"), win, WIN_MAX)?,
            (None, true) => {
                return Err(format!(
                    "roles.{key}.win is required: the role's win is not its alignment's"
                ))
            }
            (Some(_), false) => {
                return Err(format!(
                    "roles.{key}.win must be absent: the role wins with its alignment"
                ))
            }
            (None, false) => {}
        }
    }
    Ok(())
}

/// Join one pack and its presentation into the public role reference.
pub fn pack_role_reference(pack: &Pack, presentation: &PackPresentation) -> PackRoleReference {
    PackRoleReference {
        pack: PackSummary {
            key: pack.name.clone(),
            name: presentation.name.clone(),
            role_count: u32::try_from(pack.roles.len()).unwrap_or(u32::MAX),
        },
        alignments: presentation
            .alignments
            .iter()
            .map(|(key, copy)| alignment_reference(key, copy))
            .collect(),
        win_families: pack
            .win_families
            .iter()
            .map(|family| format!("{family:?}"))
            .collect(),
        roles: pack
            .roles
            .keys()
            .filter_map(|key| role_reference(pack, presentation, key))
            .collect(),
    }
}

/// Project one role. `pack` may be a game-owned snapshot older than the
/// presentation; mechanics always come from `pack`, and copy that the
/// presentation no longer carries degrades to the key rather than failing.
pub fn role_reference(
    pack: &Pack,
    presentation: &PackPresentation,
    role_key: &str,
) -> Option<RoleReference> {
    let role = pack.roles.get(role_key)?;
    let copy = presentation.roles.get(role_key)?;
    let alignment = role.alignment.as_ref().map(|key| {
        presentation
            .alignments
            .get(key)
            .map(|copy| alignment_reference(key, copy))
            .unwrap_or_else(|| AlignmentReference {
                key: key.clone(),
                label: humanize_key(key),
                family: AlignmentFamily::Independent,
                win: String::new(),
            })
    });
    let win = copy
        .win
        .clone()
        .or_else(|| alignment.as_ref().map(|alignment| alignment.win.clone()))
        .unwrap_or_default();
    Some(RoleReference {
        key: role_key.to_string(),
        pack_key: pack.name.clone(),
        pack_name: presentation.name.clone(),
        name: copy.name.clone(),
        summary: copy.summary.clone(),
        alignment,
        win,
        actions: role
            .actions
            .iter()
            .map(|action| action_reference(presentation, action))
            .collect(),
        traits: role_traits(pack, presentation, role),
        channels: role_channels(pack, presentation, role_key, role),
    })
}

fn alignment_reference(key: &str, copy: &AlignmentPresentation) -> AlignmentReference {
    AlignmentReference {
        key: key.to_string(),
        label: copy.label.clone(),
        family: copy.family,
        win: copy.win.clone(),
    }
}

fn action_reference(
    presentation: &PackPresentation,
    action: &ActionTemplate,
) -> RoleActionReference {
    let constraints = &action.constraints;
    let self_only = constraints.personal_only
        || (action.targets == TargetSpec::None && constraints.self_allowed);
    let targets_label = match action.targets {
        _ if self_only => "Yourself".to_string(),
        TargetSpec::None => "No one directly".to_string(),
        TargetSpec::One if constraints.self_allowed => "One player, possibly yourself".to_string(),
        TargetSpec::One => "One other player".to_string(),
        TargetSpec::Many | TargetSpec::Group => match constraints.max_targets {
            0 | 1 => "Several players".to_string(),
            max => format!("Up to {max} players"),
        },
    };
    RoleActionReference {
        id: action.id.clone(),
        label: presentation
            .actions
            .get(&action.id)
            .cloned()
            .unwrap_or_else(|| humanize_key(&action.id)),
        abilities: action
            .abilities()
            .map(|ability| format!("{ability:?}"))
            .collect(),
        window: format!("{:?}", action.window),
        targets: RoleActionTargets {
            kind: format!("{:?}", action.targets),
            max: constraints.max_targets,
            self_allowed: constraints.self_allowed,
            self_only,
            label: targets_label,
        },
        roleblockable: constraints.roleblockable,
        priority: constraints.priority,
        uses: constraints.x_shots,
        notes: action_notes(action),
    }
}

fn action_notes(action: &ActionTemplate) -> Vec<String> {
    use domain::ir::Modifier;
    use domain::pack::{PhaseParity, TargetRoleFilter, TargetState};

    let constraints = &action.constraints;
    let mut notes = Vec::new();
    if let Some(gate) = &constraints.active_from {
        notes.push(format!("From {:?} {}", gate.phase_kind, gate.phase_number));
    }
    match constraints.phase_parity {
        Some(PhaseParity::Odd) => notes.push("Odd-numbered nights only".to_string()),
        Some(PhaseParity::Even) => notes.push("Even-numbered nights only".to_string()),
        None => {}
    }
    match constraints.cycle_parity {
        Some(PhaseParity::Odd) => notes.push("Odd-numbered cycles only".to_string()),
        Some(PhaseParity::Even) => notes.push("Even-numbered cycles only".to_string()),
        None => {}
    }
    match constraints.cooldown_cycles {
        Some(1) => notes.push("Rests a night after each use".to_string()),
        Some(cycles) => notes.push(format!("Rests {cycles} nights after each use")),
        None => {}
    }
    if let Some(alive) = constraints.disabled_at_or_below_alive {
        notes.push(format!("Stops working at {alive} or fewer alive"));
    }
    match constraints.target_state {
        Some(TargetState::Dead) => notes.push("Dead players only".to_string()),
        Some(TargetState::Alive) | Some(TargetState::Any) | None => {}
    }
    match constraints.target_role_filter {
        Some(TargetRoleFilter::PowerRole) => notes.push("Power roles only".to_string()),
        Some(TargetRoleFilter::Vanilla) => notes.push("Vanilla roles only".to_string()),
        None => {}
    }
    for modifier in &action.modifiers {
        let note = match modifier {
            Modifier::Strongman => "Goes through protection",
            Modifier::Ninja => "Hidden from trackers and watchers",
            Modifier::Weak => "Dies on finding Scum",
            Modifier::Lazy => "Idle when only one non-Town player is alive",
            Modifier::Loud | Modifier::Announcing => "Announced publicly",
            Modifier::NonConsecutive | Modifier::Indecisive => {
                "Not the same player on back-to-back nights"
            }
            Modifier::Roaming => "Never the same player twice",
            Modifier::Compulsive => "Must be used every night",
            Modifier::Simultaneous => "Several at once",
            Modifier::Uncooperative => "Vague results",
            Modifier::Disloyal => "Only works on other factions",
            _ => continue,
        };
        notes.push(note.to_string());
    }
    notes.dedup();
    notes
}

fn role_traits(pack: &Pack, presentation: &PackPresentation, role: &Role) -> Vec<RoleTrait> {
    let mut traits: Vec<RoleTrait> = role
        .effects
        .iter()
        .filter_map(|tag| presentation.effects.get(tag))
        .map(|copy| RoleTrait {
            text: copy.text.clone(),
            short: copy.short.clone(),
        })
        .collect();
    for modifier in &role.modifiers {
        traits.push(match modifier {
            RoleModifier::Lost => RoleTrait {
                text: "Joins the factional kill only once no teammate is alive".to_string(),
                short: "Lost".to_string(),
            },
            RoleModifier::Recluse => RoleTrait {
                text: "Joins the factional kill only if every living teammate is a Recluse"
                    .to_string(),
                short: "Recluse".to_string(),
            },
        });
    }
    for action in &role.actions {
        match pack.death_reveal.by_cause.get(&action.id) {
            Some(DeathRevealMode::Concealed) => traits.push(RoleTrait {
                text: "Their victims flip with role hidden".to_string(),
                short: "Hides flips".to_string(),
            }),
            Some(DeathRevealMode::AlignmentOnly) => traits.push(RoleTrait {
                text: "Their victims flip alignment only".to_string(),
                short: "Partial flips".to_string(),
            }),
            Some(DeathRevealMode::Full) | None => {}
        }
    }
    traits.dedup();
    traits
}

fn role_channels(
    pack: &Pack,
    presentation: &PackPresentation,
    role_key: &str,
    role: &Role,
) -> Vec<RoleChannel> {
    if !pack.private_channels.enabled {
        return Vec::new();
    }
    pack.private_channels
        .groups
        .iter()
        .filter(|group| channel_includes(group, role_key, role))
        .map(|group| RoleChannel {
            id: group.id.clone(),
            label: match group.kind {
                PrivateChannelKind::Mason => "Mason chat".to_string(),
                PrivateChannelKind::Neighbor => "Neighbor chat".to_string(),
                PrivateChannelKind::FactionDayChat => {
                    let faction = group
                        .member_alignments
                        .first()
                        .and_then(|key| presentation.alignments.get(key))
                        .map(|copy| copy.label.as_str())
                        .unwrap_or("Faction");
                    format!("{faction} day chat")
                }
            },
            confirms_town: group.reveals_alignment == PrivateChannelAlignmentReveal::Town,
        })
        .collect()
}

fn channel_includes(group: &PrivateChannelGroup, role_key: &str, role: &Role) -> bool {
    if group.excluded_roles.iter().any(|key| key == role_key) {
        return false;
    }
    group.roles.iter().any(|key| key == role_key)
        || role
            .alignment
            .as_ref()
            .is_some_and(|alignment| group.member_alignments.contains(alignment))
}

fn survival_award_roles(pack: &Pack) -> BTreeSet<&str> {
    pack.win
        .survival_awards
        .iter()
        .flat_map(|award| award.eligible_roles.iter().map(String::as_str))
        .collect()
}

fn closed(
    kind: &str,
    pack: BTreeSet<String>,
    presentation: BTreeSet<String>,
) -> Result<(), String> {
    let missing: Vec<_> = pack.difference(&presentation).collect();
    let unknown: Vec<_> = presentation.difference(&pack).collect();
    if missing.is_empty() && unknown.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "presentation {kind} drift: missing={missing:?}, unknown={unknown:?}"
        ))
    }
}

fn text(field: &str, value: &str, max: usize) -> Result<(), String> {
    let length = value.chars().count();
    if value.trim() != value || length == 0 || length > max {
        Err(format!(
            "presentation {field} must be 1..={max} trimmed characters, got {length}"
        ))
    } else {
        Ok(())
    }
}

/// Fallback for copy skew only: a game-owned snapshot may carry an action or
/// alignment the current presentation no longer names.
fn humanize_key(value: &str) -> String {
    let spaced = value.replace(['_', '-', ':'], " ");
    let mut characters = spaced.trim().chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => String::new(),
    }
}
