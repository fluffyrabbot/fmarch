//! Pure DayProgram compilation and pack-compatibility inspection.
//!
//! This module is shared by the authoritative command path and read-side
//! catalog presentation. A setup option is attachable exactly when the same
//! compiler used by `AttachDayProgram` accepts it.

use std::collections::BTreeMap;

use domain::{pack::WeightPolicy, EffectDuration, Pack};
use game_platform::{
    CompiledNarrativeTemplate, DayEvent, DayEventState, DayProgram, EffectOperationTemplate,
    GrantKind, GrantSpec, NarrativeTemplate, ParticipantFilter, ParticipationMode,
    ProgramContentHash,
};

pub const HOST_NOTICE_CHANNEL_ALLOWLIST: &[&str] = &["main"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatibilityIssueCode {
    InvalidDocument,
    InvalidInitialState,
    UnsupportedParticipationMode,
    UnsupportedParticipantFilter,
    UndeclaredPersistentEffect,
    ResolutionScopedEffect,
    UndeclaredItemGrant,
    UndeclaredVoteWeightGrant,
    UnsupportedRewardAdapter,
    UnresolvedNarrativeTemplate,
    NarrativeChannelNotAllowed,
    UnsupportedNarrativeChannel,
}

impl CompatibilityIssueCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidDocument => "invalid_document",
            Self::InvalidInitialState => "invalid_initial_state",
            Self::UnsupportedParticipationMode => "unsupported_participation_mode",
            Self::UnsupportedParticipantFilter => "unsupported_participant_filter",
            Self::UndeclaredPersistentEffect => "undeclared_persistent_effect",
            Self::ResolutionScopedEffect => "resolution_scoped_effect",
            Self::UndeclaredItemGrant => "undeclared_item_grant",
            Self::UndeclaredVoteWeightGrant => "undeclared_vote_weight_grant",
            Self::UnsupportedRewardAdapter => "unsupported_reward_adapter",
            Self::UnresolvedNarrativeTemplate => "unresolved_narrative_template",
            Self::NarrativeChannelNotAllowed => "narrative_channel_not_allowed",
            Self::UnsupportedNarrativeChannel => "unsupported_narrative_channel",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityIssue {
    pub code: CompatibilityIssueCode,
    pub event_id: Option<String>,
    pub message: String,
}

impl CompatibilityIssue {
    fn event(code: CompatibilityIssueCode, event: &DayEvent, message: impl Into<String>) -> Self {
        Self {
            code,
            event_id: Some(event.id.as_str().to_string()),
            message: message.into(),
        }
    }

    fn document(message: impl Into<String>) -> Self {
        Self {
            code: CompatibilityIssueCode::InvalidDocument,
            event_id: None,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompiledDayProgram {
    pub content_hash: ProgramContentHash,
    pub events: Vec<DayEvent>,
    pub narratives: BTreeMap<String, Vec<CompiledNarrativeTemplate>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompatibilityReport {
    pub compilation: Option<CompiledDayProgram>,
    pub issues: Vec<CompatibilityIssue>,
}

impl CompatibilityReport {
    pub fn attachable(&self) -> bool {
        self.compilation.is_some() && self.issues.is_empty()
    }

    pub fn summary(&self) -> String {
        summarize_issues(&self.issues)
    }

    pub fn into_compilation(self) -> Result<CompiledDayProgram, Self> {
        if self.attachable() {
            Ok(self
                .compilation
                .expect("attachable compatibility report has compilation"))
        } else {
            Err(self)
        }
    }
}

pub fn summarize_issues(issues: &[CompatibilityIssue]) -> String {
    issues
        .iter()
        .map(|issue| match &issue.event_id {
            Some(event_id) => format!("{event_id}: {}", issue.message),
            None => issue.message.clone(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

/// Compile a program and inspect every materialized event against one pack.
///
/// Document validation failures necessarily stop compilation. Once the typed
/// document is valid, compatibility issues are accumulated across all events
/// so setup can explain the complete incompatibility instead of surfacing one
/// command rejection at a time.
pub fn inspect(pack: &Pack, program: &DayProgram) -> CompatibilityReport {
    let content_hash = match program.content_hash() {
        Ok(content_hash) => content_hash,
        Err(error) => {
            return CompatibilityReport {
                compilation: None,
                issues: vec![CompatibilityIssue::document(error.to_string())],
            };
        }
    };
    let events = match program.compile() {
        Ok(events) => events,
        Err(error) => {
            return CompatibilityReport {
                compilation: None,
                issues: vec![CompatibilityIssue::document(error.to_string())],
            };
        }
    };
    let catalog = program
        .narrative_templates
        .iter()
        .map(|template| (&template.key, template))
        .collect::<BTreeMap<_, _>>();
    let mut narratives = BTreeMap::new();
    let mut issues = Vec::new();
    for event in &events {
        issues.extend(inspect_event_adapters(pack, event));
        let mut compiled = Vec::new();
        for (lifecycle, template_key) in event.narrative.iter() {
            let template = catalog
                .get(template_key)
                .expect("validated DayProgram resolves every narrative template");
            if !event
                .channel_policy
                .allowed_channels
                .contains(&template.channel_id)
            {
                issues.push(CompatibilityIssue::event(
                    CompatibilityIssueCode::NarrativeChannelNotAllowed,
                    event,
                    format!(
                        "narrative template `{}` targets channel `{}` outside the event allow-list",
                        template.key, template.channel_id
                    ),
                ));
            }
            if !host_notice_channel_supported(template) {
                issues.push(CompatibilityIssue::event(
                    CompatibilityIssueCode::UnsupportedNarrativeChannel,
                    event,
                    format!(
                        "narrative template `{}` targets unsupported host-notice channel `{}`",
                        template.key, template.channel_id
                    ),
                ));
            }
            compiled.push(CompiledNarrativeTemplate {
                lifecycle,
                template_key: template.key.clone(),
                template_hash: template
                    .content_hash()
                    .expect("validated narrative template has a stable hash"),
                channel_id: template.channel_id.clone(),
                body: template.body.clone(),
            });
        }
        narratives.insert(event.id.as_str().to_string(), compiled);
    }
    CompatibilityReport {
        compilation: Some(CompiledDayProgram {
            content_hash,
            events,
            narratives,
        }),
        issues,
    }
}

/// Inspect an already-compiled inline DayEvent through the same adapter rules.
pub fn inspect_event(pack: &Pack, event: &DayEvent) -> Vec<CompatibilityIssue> {
    let mut issues = inspect_event_adapters(pack, event);
    for (_, template_key) in event.narrative.iter() {
        issues.push(CompatibilityIssue::event(
            CompatibilityIssueCode::UnresolvedNarrativeTemplate,
            event,
            format!("inline DayEvent narrative `{template_key}` has no immutable program template"),
        ));
    }
    issues
}

fn inspect_event_adapters(pack: &Pack, event: &DayEvent) -> Vec<CompatibilityIssue> {
    let mut issues = Vec::new();
    if event.state != DayEventState::Scheduled {
        issues.push(CompatibilityIssue::event(
            CompatibilityIssueCode::InvalidInitialState,
            event,
            "materialized definitions must begin in scheduled state",
        ));
    }
    if event.participation.mode != ParticipationMode::OptIn {
        issues.push(CompatibilityIssue::event(
            CompatibilityIssueCode::UnsupportedParticipationMode,
            event,
            "only opt-in participation is currently executable",
        ));
    }
    if matches!(
        event.participation.who,
        ParticipantFilter::HostInvited | ParticipantFilter::ChannelMembers
    ) {
        issues.push(CompatibilityIssue::event(
            CompatibilityIssueCode::UnsupportedParticipantFilter,
            event,
            "only alive-slots or all-occupied participant filters are currently executable",
        ));
    }
    for reward in &event.rewards {
        for effect in &reward.effects {
            if let Err(adapter_issue) = inspect_reward_operation(pack, &effect.operation) {
                issues.push(CompatibilityIssue::event(
                    adapter_issue.code,
                    event,
                    adapter_issue.message,
                ));
            }
        }
    }
    issues
}

pub fn host_notice_channel_supported(template: &NarrativeTemplate) -> bool {
    HOST_NOTICE_CHANNEL_ALLOWLIST.contains(&template.channel_id.as_str())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackAdapterIssue {
    pub code: CompatibilityIssueCode,
    pub message: String,
}

pub fn persistent_effect_policy<'a>(
    pack: &'a Pack,
    effect: &str,
) -> Result<&'a domain::pack::EffectPolicy, PackAdapterIssue> {
    let policy = pack.effects.get(effect).ok_or_else(|| PackAdapterIssue {
        code: CompatibilityIssueCode::UndeclaredPersistentEffect,
        message: format!("effect `{effect}` is not declared by pack `{}`", pack.name),
    })?;
    if policy.duration != EffectDuration::Persistent {
        return Err(PackAdapterIssue {
            code: CompatibilityIssueCode::ResolutionScopedEffect,
            message: format!(
                "effect `{effect}` is resolution-scoped and cannot be injected persistently"
            ),
        });
    }
    Ok(policy)
}

pub fn validate_platform_grant(pack: &Pack, grant: &GrantSpec) -> Result<(), PackAdapterIssue> {
    match grant.kind {
        GrantKind::ExtraAction => Ok(()),
        GrantKind::Item if pack.item_actions.contains_key(grant.grant_id.as_str()) => Ok(()),
        GrantKind::Item => Err(PackAdapterIssue {
            code: CompatibilityIssueCode::UndeclaredItemGrant,
            message: format!(
                "item grant `{}` is not declared by pack `{}`",
                grant.grant_id.as_str(),
                pack.name
            ),
        }),
        GrantKind::VoteWeight => {
            let supported = match &pack.vote.weights {
                WeightPolicy::Dynamic(policy) => policy
                    .grant_rules
                    .iter()
                    .any(|rule| rule.grant_id == grant.grant_id.as_str()),
                _ => false,
            };
            if supported {
                Ok(())
            } else {
                Err(PackAdapterIssue {
                    code: CompatibilityIssueCode::UndeclaredVoteWeightGrant,
                    message: format!(
                        "vote-weight grant `{}` is not declared by pack `{}` dynamic vote policy",
                        grant.grant_id.as_str(),
                        pack.name
                    ),
                })
            }
        }
    }
}

fn inspect_reward_operation(
    pack: &Pack,
    operation: &EffectOperationTemplate,
) -> Result<(), PackAdapterIssue> {
    match operation {
        EffectOperationTemplate::Mark { effect } | EffectOperationTemplate::Clear { effect } => {
            persistent_effect_policy(pack, effect.as_str()).map(|_| ())
        }
        EffectOperationTemplate::Grant { grant } => validate_platform_grant(pack, grant),
        EffectOperationTemplate::SetSlotLifecycle { .. } => Ok(()),
        EffectOperationTemplate::RevealAlignment | EffectOperationTemplate::RevealRole => {
            Err(PackAdapterIssue {
                code: CompatibilityIssueCode::UnsupportedRewardAdapter,
                message: "reveal adapters are not part of the persistent effect catalog"
                    .to_string(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRODUCT_PACKS: [(&str, &str, bool); 5] = [
        (
            "chinese_structured",
            include_str!("../../../packs/chinese_structured/pack.json"),
            false,
        ),
        (
            "default_open",
            include_str!("../../../packs/default_open/pack.json"),
            false,
        ),
        (
            "epicmafia",
            include_str!("../../../packs/epicmafia/pack.json"),
            false,
        ),
        (
            "mafia_universe",
            include_str!("../../../packs/mafia_universe/pack.json"),
            true,
        ),
        (
            "mafiascum",
            include_str!("../../../packs/mafiascum/pack.json"),
            true,
        ),
    ];

    #[test]
    fn catalog_program_compatibility_is_derived_for_every_product_pack() {
        let program: DayProgram =
            serde_json::from_str(include_str!("../../../programs/bakery.json")).unwrap();

        for (pack_key, raw_pack, expected_attachable) in PRODUCT_PACKS {
            let pack = domain::load_pack_from_json(raw_pack)
                .unwrap_or_else(|error| panic!("load {pack_key}: {error}"));
            let report = inspect(&pack, &program);
            assert_eq!(
                report.attachable(),
                expected_attachable,
                "unexpected bakery compatibility for {pack_key}: {}",
                report.summary()
            );
            if expected_attachable {
                assert!(report.issues.is_empty());
            } else {
                assert!(report.issues.iter().any(|issue| {
                    issue.code == CompatibilityIssueCode::UndeclaredPersistentEffect
                        && issue.event_id.as_deref() == Some("bakery-cookie-d1")
                }));
            }
        }
    }

    #[test]
    fn compatibility_report_accumulates_event_and_pack_adapter_issues() {
        let pack = domain::load_pack_from_json(PRODUCT_PACKS[1].1).unwrap();
        let mut program: DayProgram =
            serde_json::from_str(include_str!("../../../programs/bakery.json")).unwrap();
        program.events[0].participation.who = ParticipantFilter::HostInvited;

        let report = inspect(&pack, &program);
        assert!(!report.attachable());
        assert_eq!(report.issues.len(), 2);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == CompatibilityIssueCode::UnsupportedParticipantFilter));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.code == CompatibilityIssueCode::UndeclaredPersistentEffect));
    }
}
