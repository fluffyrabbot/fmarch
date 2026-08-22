//! The serialized pack model: declarative tables over the IR (doc 09).
//!
//! Maps use `BTreeMap` so iteration order is deterministic and never leaks
//! hash-map order into event ordering.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::events::VoteStatus;
use crate::ir::{InvestigateMode, IrAbility, Modifier};

pub type RoleKey = String;
pub type AlignmentKey = String;
pub type Tag = String;

pub const SUPPORTED_PACK_VERSION: u32 = 1;
pub const MIN_SUPPORTED_IR_VERSION: u16 = 1;
pub const SUPPORTED_IR_VERSION: u16 = 68;
pub const DEFAULT_SHIPPED_PACK: &str = "default_open";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pack {
    pub name: String,
    pub version: u32,
    pub ir_version: u16,
    /// Generated item actions keyed by the grant id that unlocks them. A slot
    /// may submit one of these templates only while carrying an unspent
    /// `GrantKind::Item` with the same id.
    #[serde(default)]
    pub item_actions: BTreeMap<Tag, ActionTemplate>,
    pub roles: BTreeMap<RoleKey, Role>,
    pub precedence: Vec<PrecedenceRule>,
    pub visibility: BTreeMap<IrAbility, VisibilityRule>,
    #[serde(default)]
    pub visibility_families: Vec<VisibilityFamily>,
    #[serde(default)]
    pub win_families: Vec<WinFamily>,
    pub redirects: RedirectPolicy,
    #[serde(default)]
    pub triggers: Vec<TriggerRule>,
    pub vote: VotePolicy,
    pub phases: PhasePolicy,
    #[serde(default)]
    pub investigation_overrides: Option<BTreeMap<Tag, ResultOverride>>,
    /// Pack-owned labels for base investigation results. This keeps culture
    /// wording such as Chinese good/evil out of resolver code.
    #[serde(default)]
    pub investigation_results: InvestigationResultPolicy,
    /// Optional effect metadata keyed by effect tag. This is the pack-owned
    /// lifecycle/visibility table for Mark/Clear effects; actions may still
    /// override duration during migration.
    #[serde(default)]
    pub effects: BTreeMap<Tag, EffectPolicy>,
    /// Optional source-death reveal policies keyed by persistent effect tag.
    /// This covers Oracle-style marks: if the slot that placed the effect dies,
    /// the marked target's declared fact is publicly revealed.
    #[serde(default)]
    pub effect_source_death_reveals: Vec<EffectSourceDeathRevealPolicy>,
    /// Optional Mafia Universe-style ITA policy. Present only for packs that
    /// expose `ItaShot` day actions.
    #[serde(default)]
    pub ita: ItaPolicy,
    /// Optional culture policy for public day notes that do not change game
    /// state: prior-night death announcements and last words after day deaths.
    #[serde(default)]
    pub day_notes: DayNotePolicy,
    /// Optional Chinese-structured White Wolf carry policy. This is modeled as
    /// durable event-folded engine state, then consumed by a later wolf kill.
    #[serde(default)]
    pub wolf_carry: WolfCarryPolicy,
    /// Optional Chinese-structured Wolf Beauty policy. Charm is a persistent
    /// owner-target mark; day death of the owner drags the current marked target.
    #[serde(default)]
    pub wolf_beauty: WolfBeautyPolicy,
    /// Optional Chinese-structured Guard/Witch timing policy. This keeps
    /// culture-specific poison blocking and same-target double-save behavior
    /// declarative instead of encoding it in generic Protect/Kill precedence.
    #[serde(default)]
    pub guard_policy: GuardPolicy,
    /// Optional faction action coordination. This lets a pack declare that
    /// multiple same-faction submissions are votes for one shared action rather
    /// than independent action executions.
    #[serde(default)]
    pub faction_actions: FactionActionPolicy,
    /// Required night-resolution contract. `Generic` selects the common IR
    /// semantics; `Explicit` additionally requires a linter-backed conflict
    /// catalog naming every participating action and cause.
    pub night_resolution: NightResolutionPolicy,
    /// Optional death-cause policy for Hunter-style chosen retaliation. This is
    /// culture-specific: some packs let a chosen Hunter shot fire on any death,
    /// while Chinese structured Werewolf suppresses it for poison deaths.
    #[serde(default)]
    pub death_retaliation: DeathRetaliationPolicy,
    /// Optional death reveal policy. The default is ordinary full flip; packs
    /// may conceal flips by kill cause (Janitor) or by target effect/role tag
    /// (Flipless), or reveal alignment only.
    #[serde(default)]
    pub death_reveal: DeathRevealPolicy,
    /// Optional Chinese-structured Idiot policy. A configured role survives the
    /// first lynch, receives a persistent vote-loss effect, and later lynches
    /// land normally once that effect is present.
    #[serde(default)]
    pub idiot_policy: IdiotPolicy,
    /// Optional Saulus policy. Eligible roles survive their first lynch by
    /// flipping to a configured alignment instead of dying.
    #[serde(default)]
    pub saulus_policy: SaulusPolicy,
    /// Optional backup inheritance policy. Passive backups use an effect prefix
    /// such as `backup:`; targeted backups are ordinary Mark actions whose
    /// effect is promoted into a durable source-target designation.
    #[serde(default)]
    pub backup_policy: BackupPolicy,
    /// Optional conversion timing policy. Packs with Convert actions must name
    /// how same-resolution deaths interact with conversion instead of relying
    /// on resolver-local timing branches.
    #[serde(default)]
    pub conversion_policy: ConversionPolicy,
    /// Optional target-lynch independent win policies. Targeting is a durable
    /// owner-target Mark; if the marked target is lynched, the owner wins.
    #[serde(default)]
    pub target_lynch_win_policies: Vec<TargetLynchWinPolicy>,
    /// Optional self-lynch independent win policies. If an eligible role is
    /// lynched, that role's alignment wins before ordinary faction checks.
    #[serde(default)]
    pub self_lynch_win_policies: Vec<SelfLynchWinPolicy>,
    /// Optional Beloved Princess-style public host prompt when a configured role
    /// dies to a configured cause such as a lynch.
    #[serde(default)]
    pub beloved_princess_policy: BelovedPrincessPolicy,
    /// Optional host prompts produced directly from official day-vote outcomes,
    /// such as no-majority/revote decisions.
    #[serde(default)]
    pub day_vote_prompt_policies: Vec<DayVotePromptPolicy>,
    /// Optional host/admin prompt resolution effects. Prompt producers declare
    /// durable prompts; this table declares which host decision shape resolves
    /// each prompt kind/reason pair and what event-side consequence it has.
    #[serde(default)]
    pub host_prompt_resolution_effects: Vec<HostPromptResolutionEffectPolicy>,
    /// Optional Cupid/lovers policy. Source catalogs may model lovers as helper
    /// metadata rather than draftable roles; this table keeps that culture
    /// behavior in pack data while links remain folded through `PlayersLinked`.
    #[serde(default)]
    pub lover_policy: LoverPolicy,
    /// Optional setup-time private channel metadata. This is intentionally pack
    /// data, not resolver state: the platform declares channels when the game
    /// starts, while the engine only needs to know the role/effect contract.
    #[serde(default)]
    pub private_channels: PrivateChannelPolicy,
    /// Optional Treestump policy. Eligible roles that die remain dead for
    /// voting/action purposes, but receive a durable status tag that lets the
    /// platform keep main-thread posting open for that slot.
    #[serde(default)]
    pub treestump_policy: TreestumpPolicy,
    /// Win conditions evaluated on the post-resolution state. Optional so older
    /// packs (and goldens) without a `win` table still deserialize; an absent
    /// table means no win is ever declared by the engine.
    #[serde(default)]
    pub win: WinPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub description: String,
    #[serde(default)]
    pub alignment: Option<AlignmentKey>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub modifiers: Vec<RoleModifier>,
    #[serde(default)]
    pub actions: Vec<ActionTemplate>,
    #[serde(default)]
    pub effects: Vec<Tag>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum RoleModifier {
    Lost,
    Recluse,
}

impl Role {
    pub fn has_modifier(&self, modifier: RoleModifier) -> bool {
        self.modifiers.contains(&modifier)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Window {
    Day,
    Night,
    Twilight,
    Instant,
    Any,
}

impl Window {
    pub fn required_phase_kind(self) -> Option<PhaseKind> {
        match self {
            Window::Day => Some(PhaseKind::Day),
            Window::Night => Some(PhaseKind::Night),
            Window::Twilight => Some(PhaseKind::Twilight),
            Window::Instant => None,
            Window::Any => None,
        }
    }

    pub fn matches_phase_kind(self, phase_kind: PhaseKind) -> bool {
        self.required_phase_kind()
            .is_none_or(|required| required == phase_kind)
    }

    pub fn is_night_resolution_window(self) -> bool {
        matches!(self, Window::Night | Window::Any)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetSpec {
    None,
    One,
    Many,
    Group,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetState {
    Any,
    Alive,
    Dead,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetRoleFilter {
    PowerRole,
    Vanilla,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RedirectKind {
    /// Two-target Bus Driver swap: each target is redirected to the other.
    Swap,
    /// Ordered multi-target rotation: each submitted target is redirected to the
    /// next submitted target, and the final target wraps to the first.
    Rotate,
    /// Lightning Rod pull: all current target-reading actions are redirected to
    /// the submitted target, or to the actor when the action has no target.
    Pull,
    /// Two-target redirector: actions aimed at the first target are redirected
    /// to the second target.
    Retarget,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectDuration {
    /// Effect is emitted as `EffectsMarked` and folded into future state.
    #[default]
    Persistent,
    /// Effect exists only inside the current resolution.
    Resolution,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectVisibility {
    #[default]
    Hidden,
    Public,
    Actor,
    Target,
    ActorAndTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EffectPolicy {
    #[serde(default = "default_effect_duration")]
    pub duration: EffectDuration,
    #[serde(default)]
    pub visibility: EffectVisibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EffectSourceDeathRevealPolicy {
    pub id: String,
    pub effect: Tag,
    pub reveal: EffectSourceDeathRevealKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum EffectSourceDeathRevealKind {
    Alignment,
    Role,
}

fn default_effect_duration() -> EffectDuration {
    EffectDuration::Persistent
}

/// Pack IR grant kind. Serializes as PascalCase for packs/events; also accepts
/// snake_case aliases so platform/wire payloads (`extra_action`, `item`,
/// `vote_weight`) deserialize without a second enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(rename_all = "snake_case"))]
pub enum GrantKind {
    ExtraAction,
    Item,
    VoteWeight,
}

impl<'de> Deserialize<'de> for GrantKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match value.as_str() {
            "ExtraAction" | "extra_action" => Ok(Self::ExtraAction),
            "Item" | "item" => Ok(Self::Item),
            "VoteWeight" | "vote_weight" => Ok(Self::VoteWeight),
            _ => Err(serde::de::Error::unknown_variant(
                &value,
                &[
                    "ExtraAction",
                    "Item",
                    "VoteWeight",
                    "extra_action",
                    "item",
                    "vote_weight",
                ],
            )),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GrantSpec {
    /// Stable pack-local id for the granted capability or item.
    pub grant_id: Tag,
    pub kind: GrantKind,
    #[serde(default = "default_grant_uses")]
    pub uses: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote_weight: Option<f64>,
    #[serde(default = "default_grant_visibility")]
    pub visibility: EffectVisibility,
}

fn default_grant_uses() -> u16 {
    1
}

fn default_grant_visibility() -> EffectVisibility {
    EffectVisibility::Target
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BadgeOperation {
    Elect,
    Pass,
    Destroy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BadgeSpec {
    pub badge_id: Tag,
    pub operation: BadgeOperation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote_weight: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuelSpec {
    pub hostile_alignments: Vec<AlignmentKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignmentFailbackSpec {
    pub hostile_alignments: Vec<AlignmentKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfDestructSpec {
    #[serde(default = "default_self_destruct_cause")]
    pub cause: String,
    #[serde(default = "default_self_destruct_true")]
    pub kill_target: bool,
    #[serde(default = "default_self_destruct_true")]
    pub sacrifice_actor: bool,
    #[serde(default = "default_self_destruct_true")]
    pub unstoppable: bool,
}

fn default_self_destruct_cause() -> String {
    "self_destruct".to_string()
}

fn default_self_destruct_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolfCarryPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_wolf_carry_token")]
    pub token_id: Tag,
    #[serde(default = "default_wolf_carry_cause")]
    pub cause: String,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default)]
    pub wolf_kill_roles: Vec<RoleKey>,
}

impl Default for WolfCarryPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            token_id: default_wolf_carry_token(),
            cause: default_wolf_carry_cause(),
            eligible_roles: Vec::new(),
            wolf_kill_roles: Vec::new(),
        }
    }
}

fn default_wolf_carry_token() -> String {
    "white_wolf_carry_token".to_string()
}

fn default_wolf_carry_cause() -> String {
    "wolf_carry".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WolfBeautyPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_wolf_beauty_mark_effect")]
    pub mark_effect: Tag,
    #[serde(default = "default_wolf_beauty_drag_cause")]
    pub drag_cause: String,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default = "default_wolf_beauty_death_causes")]
    pub death_causes: Vec<String>,
}

impl Default for WolfBeautyPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            mark_effect: default_wolf_beauty_mark_effect(),
            drag_cause: default_wolf_beauty_drag_cause(),
            eligible_roles: Vec::new(),
            death_causes: default_wolf_beauty_death_causes(),
        }
    }
}

fn default_wolf_beauty_mark_effect() -> String {
    "wolf_beauty_mark".to_string()
}

fn default_wolf_beauty_drag_cause() -> String {
    "trigger:wolf_beauty_drag".to_string()
}

fn default_wolf_beauty_death_causes() -> Vec<String> {
    vec![
        "lynch".to_string(),
        "poison".to_string(),
        "witch_poison".to_string(),
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GuardWitchSameTargetPolicy {
    NoDeath,
    KillTarget,
}

fn default_guard_witch_same_target_policy() -> GuardWitchSameTargetPolicy {
    GuardWitchSameTargetPolicy::NoDeath
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub guard_action_ids: Vec<String>,
    #[serde(default)]
    pub witch_heal_action_ids: Vec<String>,
    #[serde(default)]
    pub guard_blockable_causes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard_self_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guard_night_one_allowed: Option<bool>,
    #[serde(default = "default_guard_witch_same_target_policy")]
    pub same_target_witch: GuardWitchSameTargetPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub same_target_witch_kill_cause: Option<String>,
}

impl Default for GuardPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            guard_action_ids: Vec::new(),
            witch_heal_action_ids: Vec::new(),
            guard_blockable_causes: Vec::new(),
            guard_self_allowed: None,
            guard_night_one_allowed: None,
            same_target_witch: default_guard_witch_same_target_policy(),
            same_target_witch_kill_cause: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactionActionPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub actions: Vec<FactionActionSpec>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactionActionSpec {
    pub action_id: String,
    pub alignment: AlignmentKey,
    #[serde(default = "default_faction_max_resolved_submissions")]
    pub max_resolved_submissions: u16,
    #[serde(default)]
    pub target_tie: FactionVoteTieBreaker,
}

fn default_faction_max_resolved_submissions() -> u16 {
    1
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum FactionVoteTieBreaker {
    #[default]
    BlockAll,
    EarliestSubmitted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NightResolutionPolicy {
    pub mode: NightResolutionMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kill_stacking: Option<KillStackingPolicy>,
    #[serde(default)]
    pub conflict_families: Vec<NightResolutionConflictFamily>,
    #[serde(default)]
    pub block_action_ids: Vec<String>,
    #[serde(default)]
    pub protect_action_ids: Vec<String>,
    #[serde(default)]
    pub kill_action_ids: Vec<String>,
    #[serde(default)]
    pub team_kill_action_ids: Vec<String>,
    #[serde(default)]
    pub bodyguard_action_ids: Vec<String>,
    #[serde(default)]
    pub martyr_action_ids: Vec<String>,
    #[serde(default)]
    pub cpr_action_ids: Vec<String>,
    #[serde(default)]
    pub jailkeep_action_ids: Vec<String>,
    #[serde(default)]
    pub strongman_action_ids: Vec<String>,
    #[serde(default)]
    pub strongman_bypasses_protect: bool,
    #[serde(default)]
    pub kill_cause_ids: Vec<String>,
    #[serde(default)]
    pub target_state_save_tags: Vec<String>,
    #[serde(default)]
    pub target_state_gate_tags: Vec<String>,
    #[serde(default)]
    pub empower_effects: Vec<Tag>,
    #[serde(default)]
    pub intercept_cause_policy: BTreeMap<String, String>,
    #[serde(default)]
    pub guard_retaliation_cause_policy: BTreeMap<String, String>,
    #[serde(default)]
    pub cpr_harm_cause_policy: BTreeMap<String, String>,
    #[serde(default)]
    pub guard_dependency_cause_policy: BTreeMap<String, String>,
    #[serde(default)]
    pub hide_dependency_cause_policy: BTreeMap<String, String>,
    #[serde(default)]
    pub chosen_retaliation_cause_policy: BTreeMap<String, GeneratedKillCausePolicy>,
    #[serde(default)]
    pub generated_kill_cause_policy: BTreeMap<String, GeneratedKillCausePolicy>,
    #[serde(default)]
    pub trigger_fixpoint_policy: BTreeMap<String, TriggerFixpointPolicy>,
    #[serde(default)]
    pub protection_cause_policy: BTreeMap<String, ProtectionCausePolicy>,
    #[serde(default)]
    pub target_state_save_policy: BTreeMap<String, TargetStateSavePolicy>,
    #[serde(default)]
    pub target_state_gate_policy: BTreeMap<String, TargetStateGatePolicy>,
    #[serde(default)]
    pub suppression_policy: BTreeMap<String, SuppressionPolicy>,
    #[serde(default)]
    pub action_chance: BTreeMap<String, ActionChancePolicy>,
}

impl Default for NightResolutionPolicy {
    fn default() -> Self {
        Self {
            mode: NightResolutionMode::Generic,
            kill_stacking: None,
            conflict_families: Vec::new(),
            block_action_ids: Vec::new(),
            protect_action_ids: Vec::new(),
            kill_action_ids: Vec::new(),
            team_kill_action_ids: Vec::new(),
            bodyguard_action_ids: Vec::new(),
            martyr_action_ids: Vec::new(),
            cpr_action_ids: Vec::new(),
            jailkeep_action_ids: Vec::new(),
            strongman_action_ids: Vec::new(),
            strongman_bypasses_protect: false,
            kill_cause_ids: Vec::new(),
            target_state_save_tags: Vec::new(),
            target_state_gate_tags: Vec::new(),
            empower_effects: Vec::new(),
            intercept_cause_policy: BTreeMap::new(),
            guard_retaliation_cause_policy: BTreeMap::new(),
            cpr_harm_cause_policy: BTreeMap::new(),
            guard_dependency_cause_policy: BTreeMap::new(),
            hide_dependency_cause_policy: BTreeMap::new(),
            chosen_retaliation_cause_policy: BTreeMap::new(),
            generated_kill_cause_policy: BTreeMap::new(),
            trigger_fixpoint_policy: BTreeMap::new(),
            protection_cause_policy: BTreeMap::new(),
            target_state_save_policy: BTreeMap::new(),
            target_state_gate_policy: BTreeMap::new(),
            suppression_policy: BTreeMap::new(),
            action_chance: BTreeMap::new(),
        }
    }
}

impl NightResolutionPolicy {
    pub fn is_explicit(&self) -> bool {
        self.mode == NightResolutionMode::Explicit
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NightResolutionMode {
    Generic,
    Explicit,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum NightResolutionConflictFamily {
    BlockSuppressesActions,
    ProtectBlocksKills,
    StrongmanBypassesProtect,
    KillStacking,
    InterceptProtection,
    GuardRetaliation,
    CprProtection,
    GuardDependency,
    HideDependency,
    ChosenRetaliation,
    GeneratedKillReentry,
    TargetStateSave,
    TargetStateGate,
    ActionChance,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionChancePolicy {
    pub chance: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtectionCausePolicy {
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default)]
    pub bypasses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedKillCausePolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<TriggerOn>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<ActorRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<TargetRef>,
    #[serde(default)]
    pub strongman_bypasses_protect: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerFixpointPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on: Option<TriggerOn>,
    #[serde(default)]
    pub produced_kill_reenters: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loop_cap: Option<TriggerLoopCapPolicy>,
    #[serde(default)]
    pub trace: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TriggerLoopCapPolicy {
    RedirectLoopCap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetStateSavePolicy {
    #[serde(default)]
    pub blocks: Vec<String>,
    #[serde(default)]
    pub bypasses: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetStateGatePolicy {
    #[serde(default)]
    pub blocks: Vec<IrAbility>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SuppressionPolicy {
    #[serde(default)]
    pub scope: Option<SuppressionScope>,
    #[serde(default)]
    pub suppresses: Vec<String>,
    #[serde(default)]
    pub bypasses: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SuppressionScope {
    FirstMatchingAction,
    AllMatchingActions,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KillStackingPolicy {
    AggregateAttackers,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DeathRevealMode {
    #[default]
    Full,
    AlignmentOnly,
    Concealed,
}

pub fn default_death_reveal_mode() -> DeathRevealMode {
    DeathRevealMode::Full
}

pub fn is_default_death_reveal_mode(mode: &DeathRevealMode) -> bool {
    *mode == DeathRevealMode::Full
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeathRevealPolicy {
    #[serde(default)]
    pub default: DeathRevealMode,
    #[serde(default)]
    pub by_cause: BTreeMap<String, DeathRevealMode>,
    #[serde(default)]
    pub by_effect: BTreeMap<Tag, DeathRevealMode>,
}

impl Default for DeathRevealPolicy {
    fn default() -> Self {
        Self {
            default: DeathRevealMode::Full,
            by_cause: BTreeMap::new(),
            by_effect: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeathRetaliationPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timing: Option<DeathRetaliationTiming>,
    #[serde(default)]
    pub allowed_death_causes: Vec<String>,
    #[serde(default)]
    pub suppressed_death_causes: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DeathRetaliationTiming {
    ImmediateBeforePhaseAnnouncement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdiotPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default = "default_idiot_vote_loss_effect")]
    pub vote_loss_effect: Tag,
    #[serde(default = "default_idiot_survival_reason")]
    pub survival_reason: String,
}

impl Default for IdiotPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            eligible_roles: Vec::new(),
            vote_loss_effect: default_idiot_vote_loss_effect(),
            survival_reason: default_idiot_survival_reason(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaulusPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default = "default_saulus_target_alignment")]
    pub target_alignment: AlignmentKey,
    #[serde(default = "default_saulus_survival_reason")]
    pub survival_reason: String,
}

impl Default for SaulusPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            eligible_roles: Vec::new(),
            target_alignment: default_saulus_target_alignment(),
            survival_reason: default_saulus_survival_reason(),
        }
    }
}

fn default_saulus_target_alignment() -> String {
    "town".to_string()
}

fn default_saulus_survival_reason() -> String {
    "saulus_conversion".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_backup_passive_effect_prefix")]
    pub passive_effect_prefix: Tag,
    #[serde(default = "default_backup_targeted_effect")]
    pub targeted_effect: Tag,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub priority: Option<BackupPriorityPolicy>,
}

impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            passive_effect_prefix: default_backup_passive_effect_prefix(),
            targeted_effect: default_backup_targeted_effect(),
            priority: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackupPriorityPolicy {
    TargetedThenPassive,
    PassiveThenTargeted,
}

fn default_backup_passive_effect_prefix() -> String {
    "backup:".to_string()
}

fn default_backup_targeted_effect() -> String {
    "backup_target".to_string()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PrivateChannelPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub groups: Vec<PrivateChannelGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateChannelGroup {
    pub id: String,
    pub kind: PrivateChannelKind,
    #[serde(default)]
    pub roles: Vec<RoleKey>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub excluded_roles: Vec<RoleKey>,
    #[serde(default)]
    pub member_alignments: Vec<AlignmentKey>,
    #[serde(default)]
    pub enabled_by_roles: Vec<RoleKey>,
    #[serde(default)]
    pub active_while_source_alive: bool,
    pub reveals_alignment: PrivateChannelAlignmentReveal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreestumpPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_treestump_status_tag")]
    pub status_tag: Tag,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
}

impl Default for TreestumpPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            status_tag: default_treestump_status_tag(),
            eligible_roles: Vec::new(),
        }
    }
}

fn default_treestump_status_tag() -> String {
    "treestump".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrivateChannelKind {
    Mason,
    Neighbor,
    FactionDayChat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrivateChannelAlignmentReveal {
    None,
    Town,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TargetLynchWinPolicy {
    pub id: String,
    pub target_effect: Tag,
    pub eligible_roles: Vec<RoleKey>,
    pub winner: AlignmentKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelfLynchWinPolicy {
    pub id: String,
    pub eligible_roles: Vec<RoleKey>,
    pub winner: AlignmentKey,
    #[serde(default)]
    pub source_event: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BelovedPrincessPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default)]
    pub all_death_causes: bool,
    #[serde(default = "default_beloved_princess_prompt_kind")]
    pub prompt_kind: String,
    #[serde(default = "default_beloved_princess_prompt_reason")]
    pub prompt_reason: String,
    #[serde(default = "default_beloved_princess_death_causes")]
    pub death_causes: Vec<String>,
}

impl Default for BelovedPrincessPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            eligible_roles: Vec::new(),
            all_death_causes: false,
            prompt_kind: default_beloved_princess_prompt_kind(),
            prompt_reason: default_beloved_princess_prompt_reason(),
            death_causes: default_beloved_princess_death_causes(),
        }
    }
}

fn default_beloved_princess_prompt_kind() -> String {
    "skip_next_day".to_string()
}

fn default_beloved_princess_prompt_reason() -> String {
    "beloved_princess_died".to_string()
}

fn default_beloved_princess_death_causes() -> Vec<String> {
    vec!["lynch".to_string()]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayVotePromptPolicy {
    pub id: String,
    #[serde(default)]
    pub statuses: Vec<VoteStatus>,
    pub prompt_kind: String,
    pub prompt_reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HostPromptResolutionEffectPolicy {
    pub id: String,
    pub prompt_kind: String,
    pub prompt_reason: String,
    pub decision: HostPromptDecisionKind,
    pub effect: HostPromptResolutionEffect,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostPromptDecisionKind {
    SelectSlot,
    SelectPolicy,
    Acknowledge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostPromptResolutionEffect {
    PkKill,
    AdvanceRevote,
    AdvanceNight,
    SkipNextDay,
    AcknowledgeOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoverPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_lover_link_effect")]
    pub link_effect: Tag,
    #[serde(default = "default_lover_suicide_cause")]
    pub suicide_cause: String,
    #[serde(default = "default_lover_true")]
    pub suicide_on_lover_death: bool,
    #[serde(default = "default_lover_true")]
    pub lovers_known_to_each_other: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_helper_role: Option<RoleKey>,
}

impl Default for LoverPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            link_effect: default_lover_link_effect(),
            suicide_cause: default_lover_suicide_cause(),
            suicide_on_lover_death: default_lover_true(),
            lovers_known_to_each_other: default_lover_true(),
            source_helper_role: None,
        }
    }
}

fn default_lover_link_effect() -> String {
    "lovers_link".to_string()
}

fn default_lover_suicide_cause() -> String {
    "lover_suicide".to_string()
}

fn default_lover_true() -> bool {
    true
}

fn default_idiot_vote_loss_effect() -> String {
    "idiot_vote_loss".to_string()
}

fn default_idiot_survival_reason() -> String {
    "idiot_survival".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItaPolicy {
    #[serde(default)]
    pub sessions: Vec<ItaSessionSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote_conflict: Option<ItaVoteConflictPolicy>,
    #[serde(default = "default_ita_hit_chance")]
    pub default_hit_chance: f64,
    #[serde(default)]
    pub modifier_components: BTreeMap<String, ItaRoleOverride>,
    #[serde(default)]
    pub role_modifier_refs: BTreeMap<RoleKey, Vec<String>>,
    #[serde(default)]
    pub role_overrides: BTreeMap<RoleKey, ItaRoleOverride>,
    #[serde(default = "default_ita_auto_close")]
    pub auto_close: bool,
    #[serde(default, skip_serializing_if = "ItaLifecyclePolicy::is_empty")]
    pub lifecycle: ItaLifecyclePolicy,
    #[serde(default, skip_serializing_if = "is_default_ita_resolution_policy")]
    pub resolution_policy: ItaResolutionPolicy,
}

impl Default for ItaPolicy {
    fn default() -> Self {
        Self {
            sessions: Vec::new(),
            vote_conflict: None,
            default_hit_chance: default_ita_hit_chance(),
            modifier_components: BTreeMap::new(),
            role_modifier_refs: BTreeMap::new(),
            role_overrides: BTreeMap::new(),
            auto_close: default_ita_auto_close(),
            lifecycle: ItaLifecyclePolicy::default(),
            resolution_policy: ItaResolutionPolicy::default(),
        }
    }
}

impl ItaPolicy {
    pub fn effective_role_override(&self, role_key: &RoleKey) -> ItaRoleOverride {
        let mut policy = self
            .role_overrides
            .get(role_key)
            .copied()
            .unwrap_or_default();
        if let Some(component_refs) = self.role_modifier_refs.get(role_key) {
            for component_ref in component_refs {
                if let Some(component) = self.modifier_components.get(component_ref) {
                    policy.add_component(component);
                }
            }
        }
        policy
    }
}

fn default_ita_hit_chance() -> f64 {
    0.35
}

fn default_ita_auto_close() -> bool {
    true
}

fn is_zero_f64(value: &f64) -> bool {
    value.abs() <= f64::EPSILON
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItaVoteConflictPolicy {
    ResolveShotsBeforeVote,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItaTargetAlreadyDeadPolicy {
    #[default]
    ConsumeShot,
    RefundShot,
    SkipWithWarning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ItaResolutionPolicy {
    #[serde(default)]
    pub on_target_already_dead: ItaTargetAlreadyDeadPolicy,
}

fn is_default_ita_resolution_policy(policy: &ItaResolutionPolicy) -> bool {
    *policy == ItaResolutionPolicy::default()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ItaLifecyclePolicy {
    #[serde(default, skip_serializing_if = "is_false")]
    pub manual_open: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub pause: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub cancel: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub update: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub manual_close: bool,
}

impl ItaLifecyclePolicy {
    pub fn is_empty(&self) -> bool {
        !self.manual_open && !self.pause && !self.cancel && !self.update && !self.manual_close
    }

    pub fn allows(&self, control: ItaSessionControlKind) -> bool {
        match control {
            ItaSessionControlKind::Open => self.manual_open,
            ItaSessionControlKind::Pause => self.pause,
            ItaSessionControlKind::Cancel => self.cancel,
            ItaSessionControlKind::Update => self.update,
            ItaSessionControlKind::Close => self.manual_close,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItaSessionControlKind {
    Open,
    Pause,
    Cancel,
    Update,
    Close,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItaSessionSpec {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub day: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shot_limit: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hit_chance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub buffer_delay_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct ItaRoleOverride {
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    pub hit_bonus: f64,
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    pub hit_penalty: f64,
    #[serde(default, skip_serializing_if = "is_zero_f64")]
    pub target_evade: f64,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub shields: u16,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub hit_points: u16,
}

impl ItaRoleOverride {
    pub fn is_empty(&self) -> bool {
        is_zero_f64(&self.hit_bonus)
            && is_zero_f64(&self.hit_penalty)
            && is_zero_f64(&self.target_evade)
            && self.shields == 0
            && self.hit_points == 0
    }

    pub fn add_component(&mut self, component: &ItaRoleOverride) {
        self.hit_bonus += component.hit_bonus;
        self.hit_penalty += component.hit_penalty;
        self.target_evade += component.target_evade;
        self.shields = self.shields.saturating_add(component.shields);
        self.hit_points = self.hit_points.saturating_add(component.hit_points);
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DayNotePolicy {
    #[serde(default)]
    pub announcements: DayAnnouncementPolicy,
    #[serde(default)]
    pub last_words: LastWordsPolicy,
    #[serde(default)]
    pub day_deaths: DayDeathAnnouncementPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayAnnouncementPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "is_default_day_note_role_payload")]
    pub role_payload: DayNoteRolePayload,
    #[serde(default = "default_day_note_n1_announcements")]
    pub night_deaths_n1: bool,
    #[serde(default)]
    pub night_deaths_after_n1: bool,
    #[serde(default)]
    pub multiple_night_deaths_n2plus: bool,
}

impl Default for DayAnnouncementPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            template_id: None,
            audience: None,
            role_payload: DayNoteRolePayload::default(),
            night_deaths_n1: default_day_note_n1_announcements(),
            night_deaths_after_n1: false,
            multiple_night_deaths_n2plus: false,
        }
    }
}

fn default_day_note_n1_announcements() -> bool {
    true
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum DayNoteRolePayload {
    Hidden,
    #[default]
    RoleKey,
}

fn is_default_day_note_role_payload(value: &DayNoteRolePayload) -> bool {
    *value == DayNoteRolePayload::default()
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DayDeathAnnouncementPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub cause_templates: BTreeMap<String, DayDeathCauseTemplate>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DayDeathCauseTemplate {
    pub template_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LastWordsPolicy {
    #[serde(default)]
    pub day_deaths: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audience: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConversionMode {
    AssignRole,
    RestoreOriginal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConversionDeadTargetPolicy {
    Block,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConversionPendingDeathPolicy {
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ConversionPolicy {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_dead_target: Option<ConversionDeadTargetPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_pending_death: Option<ConversionPendingDeathPolicy>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversionSpec {
    pub mode: ConversionMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<RoleKey>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseParity {
    Odd,
    Even,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfoSpec {
    pub kind: String,
    #[serde(default)]
    pub audience: InfoAudience,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub payload: BTreeMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum InfoAudience {
    #[default]
    Actor,
    Target,
    ActorAndTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionTemplate {
    pub id: String,
    /// Source-catalog action ids that this fmarch template intentionally covers.
    /// These are descriptive parity aliases only; command submissions still use
    /// the canonical `id` above.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_ids: Vec<String>,
    pub ability: IrAbility,
    #[serde(default)]
    pub additional_abilities: Vec<IrAbility>,
    pub window: Window,
    pub targets: TargetSpec,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
    pub constraints: Constraints,
    /// REQUIRED iff `ability == Investigate`; absent/null otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<InvestigateMode>,
    /// Optional prior-result memory policy for Investigate actions. This is a
    /// state-bearing engine surface, not a player-facing result formatting flag.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_memory: Option<ResultMemorySpec>,
    /// REQUIRED iff `ability == Info`; describes a private, non-investigative
    /// result/notification emitted to the configured audience.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info: Option<InfoSpec>,
    /// The persistent effect tag a `Mark`/`Clear` action attaches/removes, or
    /// the cross-slot link type a `Link` action creates (REQUIRED for
    /// `Mark`/`Clear`; the Arsonist's `douse` Marks `"doused"`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect: Option<Tag>,
    /// When set on a `Kill`, the action ignores its submitted targets and instead
    /// kills every slot currently carrying this persistent effect tag (the
    /// Arsonist's `ignite` reads `"doused"`). This is the cross-phase
    /// effect-read that proves persistent state end to end. Additive/optional so
    /// every existing pack and golden still deserializes unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reads_effect: Option<Tag>,
    /// REQUIRED iff this action has `Redirect` ability. Specifies how the
    /// submitted targets become rewrite rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub redirect: Option<RedirectKind>,
    /// Mark duration. Defaults to persistent; `Resolution` is used for
    /// same-night-only target-state gates such as commute.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effect_duration: Option<EffectDuration>,
    /// REQUIRED iff this action has `Grant` ability. Describes the generated
    /// capability/item carried forward by `ActionGranted`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant: Option<GrantSpec>,
    /// Optional selectable Grant payloads keyed by submitted `grant_id`.
    /// v42 lets one canonical Grant action expose a pack-owned choice among
    /// generated capabilities/items without splitting the source action id.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub grant_options: Vec<GrantSpec>,
    /// REQUIRED iff this action has `Badge` ability. Describes a persistent
    /// badge lifecycle operation such as sheriff election/pass/destroy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub badge: Option<BadgeSpec>,
    /// REQUIRED iff this action has `Duel` ability. The pack owns which
    /// alignments are hostile for this culture's public day duel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duel: Option<DuelSpec>,
    /// Optional Desperado-style kill policy: the action kills its submitted
    /// target only when that target has a pack-hostile alignment, otherwise the
    /// actor dies. v41 supports this for one-target Day and Night Kill actions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment_failback: Option<AlignmentFailbackSpec>,
    /// REQUIRED iff this action has `SelfDestruct` ability. Describes a public
    /// day trade such as White Wolf King sacrificing self to kill one target.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub self_destruct: Option<SelfDestructSpec>,
    /// Convert policy. `AssignRole` is the canonical v2 shape for direct
    /// conversion; `RestoreOriginal` powers deprogramming from folded
    /// conversion-origin memory. `effect` is still accepted as the v1 direct
    /// conversion role during migration.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversion: Option<ConversionSpec>,
}

impl ActionTemplate {
    pub fn has_modifier(&self, m: Modifier) -> bool {
        self.modifiers.contains(&m)
    }

    pub fn has_ability(&self, ability: IrAbility) -> bool {
        self.ability == ability || self.additional_abilities.contains(&ability)
    }

    pub fn abilities(&self) -> impl Iterator<Item = IrAbility> + '_ {
        std::iter::once(self.ability).chain(self.additional_abilities.iter().copied())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraints {
    pub max_targets: u16,
    pub self_allowed: bool,
    #[serde(default)]
    pub personal_only: bool,
    pub unique_targets: bool,
    #[serde(default)]
    pub lazy_requires_multiple_non_town: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled_at_or_below_alive: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uncooperative_result: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_state: Option<TargetState>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_role_filter: Option<TargetRoleFilter>,
    pub roleblockable: bool,
    pub priority: i32,
    #[serde(default)]
    pub x_shots: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cooldown_cycles: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_from: Option<ActivationGate>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_parity: Option<PhaseParity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cycle_parity: Option<PhaseParity>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivationGate {
    pub phase_kind: PhaseKind,
    pub phase_number: u32,
    pub reason: ActivationGateReason,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActivationGateReason {
    Novice,
    Activated,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrecedenceRule {
    pub id: String,
    pub when: PrecedenceWhen,
    #[serde(default)]
    pub beats: Vec<IrAbility>,
    #[serde(default)]
    pub blocked_by: Vec<IrAbility>,
    #[serde(default)]
    pub unless_modifiers: Vec<Modifier>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrecedenceWhen {
    pub effect: IrAbility,
    #[serde(default)]
    pub target_state: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum VisField {
    ActorId,
    TargetId,
    ActionType,
    Result,
    VisTag,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VisibilityRule {
    #[serde(default)]
    pub sees: Vec<VisField>,
    #[serde(default)]
    pub unless_modifiers: Vec<Modifier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum VisibilityFamily {
    PrivateInvestigationResults,
    GraphVisitResults,
    StealthNinjaVisits,
    ResultTampering,
    DeathRevealVariants,
    EffectAudiences,
    GrantAudiences,
    PrivateChannels,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TieBreaker {
    Stable,
    Random,
    First,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedirectPolicy {
    #[serde(default)]
    pub order: Vec<IrAbility>,
    pub loop_cap: u16,
    pub tie_breaker: TieBreaker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerRule {
    pub id: String,
    pub on: TriggerOn,
    #[serde(default)]
    pub if_target_has: Vec<Tag>,
    #[serde(default)]
    pub if_actor_has: Vec<Tag>,
    pub produces: TriggerProduction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TriggerOn {
    Ability(IrAbility),
    Event(TriggerEvent),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TriggerEvent {
    Visit,
    Lynch,
    Death,
    EffectMarked,
    PhaseEnd,
    Win,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TriggerProduction {
    pub ability: IrAbility,
    pub actor: ActorRef,
    pub target: TargetRef,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ActorRef {
    Actor,
    Target,
    TargetGuard,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetRef {
    Actor,
    Target,
    Killer,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VotePolicy {
    pub method: VoteMethod,
    pub no_lynch_allowed: bool,
    pub self_vote_allowed: bool,
    pub hammer: bool,
    pub weights: WeightPolicy,
    #[serde(default)]
    pub threshold_adjustments: BTreeMap<RoleKey, f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tiebreaker_roles: Vec<RoleKey>,
    pub tie_breaker: VoteTieBreaker,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vote_duel_tie_breaker: Option<VoteDuelTieBreaker>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VoteMethod {
    Plurality,
    Majority,
    Supermajority { num: u32, den: u32 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum WeightPolicy {
    Equal,
    PerRole(BTreeMap<RoleKey, f64>),
    Dynamic(DynamicVoteWeightPolicy),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DynamicVoteWeightPolicy {
    pub base: f64,
    #[serde(default)]
    pub effect_rules: Vec<DynamicVoteWeightRule>,
    #[serde(default)]
    pub grant_rules: Vec<DynamicVoteWeightGrantRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DynamicVoteWeightRule {
    pub effect: Tag,
    pub weight: f64,
    pub priority: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DynamicVoteWeightGrantRule {
    pub grant_id: Tag,
    pub priority: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteTieBreaker {
    NoElimination,
    Random,
    HostDecides,
    EarliestReached,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteDuelTieBreaker {
    Random,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhasePolicy {
    #[serde(default)]
    pub cadence: Vec<PhaseKind>,
    #[serde(default)]
    pub subsegments: BTreeMap<PhaseKind, Vec<String>>,
    #[serde(default)]
    pub twilight: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum PhaseKind {
    Day,
    Night,
    Twilight,
}

impl PhaseKind {
    /// The single-character phase-identifier code (`D`, `N`, `T`).
    pub const fn code(self) -> &'static str {
        match self {
            PhaseKind::Day => "D",
            PhaseKind::Night => "N",
            PhaseKind::Twilight => "T",
        }
    }

    /// The serialized kind name used across packs, events, and wire payloads.
    pub const fn name(self) -> &'static str {
        match self {
            PhaseKind::Day => "Day",
            PhaseKind::Night => "Night",
            PhaseKind::Twilight => "Twilight",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultOverride {
    #[serde(flatten)]
    pub by_mode: BTreeMap<InvestigateMode, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResultMemorySpec {
    #[serde(default)]
    pub record: bool,
    #[serde(default)]
    pub compare_previous: bool,
    #[serde(default)]
    pub scope: ResultMemoryScope,
    #[serde(default)]
    pub output: ResultMemoryOutput,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResultMemoryScope {
    #[default]
    Target,
    Investigator,
}

impl ResultMemoryScope {
    pub fn is_default(&self) -> bool {
        *self == Self::Target
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResultMemoryOutput {
    #[default]
    PreviousCurrentChanged,
    SameDifferent,
}

impl ResultMemoryOutput {
    pub fn is_default(&self) -> bool {
        *self == Self::PreviousCurrentChanged
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InvestigationResultPolicy {
    #[serde(default)]
    pub parity: ParityResultPolicy,
    #[serde(default)]
    pub role_sets: RoleSetInvestigationPolicy,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoleSetInvestigationPolicy {
    #[serde(default)]
    pub vanilla_roles: Vec<RoleKey>,
    #[serde(default)]
    pub gun_bearing_roles: Vec<RoleKey>,
    #[serde(default)]
    pub killer_roles: Vec<RoleKey>,
    #[serde(default)]
    pub specialist_roles: Vec<RoleKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParityResultPolicy {
    #[serde(default = "default_parity_town_result")]
    pub town: String,
    #[serde(default = "default_parity_non_town_result")]
    pub non_town: String,
    #[serde(default)]
    pub alignment_results: BTreeMap<AlignmentKey, String>,
}

impl Default for ParityResultPolicy {
    fn default() -> Self {
        Self {
            town: default_parity_town_result(),
            non_town: default_parity_non_town_result(),
            alignment_results: BTreeMap::new(),
        }
    }
}

fn default_parity_town_result() -> String {
    "town".to_string()
}

fn default_parity_non_town_result() -> String {
    "scum".to_string()
}

/// Win conditions, evaluated in order on the post-resolution state; the FIRST
/// matching rule wins (doc 09). An empty `rules` list means the engine never
/// declares a win (e.g. a host-adjudicated game).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct WinPolicy {
    #[serde(default)]
    pub rules: Vec<WinRule>,
    /// Optional alive-at-end co-winners. Matching alive slots are neutral for
    /// primary faction end-state checks and are recorded in WinReached metadata.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub survival_awards: Vec<SurvivalWinAward>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WinRule {
    /// The alignment that wins when `when` holds.
    pub winner: AlignmentKey,
    pub when: WinCondition,
    /// Alignments that must have zero living slots before this rule can fire.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by_alive: Vec<AlignmentKey>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SurvivalWinAward {
    pub id: String,
    pub winner: String,
    #[serde(default)]
    pub eligible_roles: Vec<RoleKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_event: Option<String>,
}

/// A win condition over alive-counts on the post-resolution state.
///
/// - `FactionEliminated(f)`        → faction `f` has **0** alive slots.
/// - `FactionReachesParity(f)`     → faction `f`'s alive count is **>=** the alive
///   count of all *other* factions combined (slots with no alignment count as
///   "other"). With exactly two factions this is the usual mafia-parity check.
/// - `AllOtherFactionsEliminated(f)` → **every** faction other than `f` (every
///   distinct alignment, plus alignment-less slots) has **0** alive slots, and
///   `f` itself has `>= 1` alive. This is the minimal 3+-faction extension (R5):
///   in a town/mafia/cult game, *town* wins only when BOTH mafia AND cult are
///   wiped — a conjunction the two-faction conditions above cannot express.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WinCondition {
    FactionEliminated(AlignmentKey),
    FactionReachesParity(AlignmentKey),
    AllOtherFactionsEliminated(AlignmentKey),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum WinFamily {
    FactionElimination,
    FactionParity,
    AllOtherFactionsEliminated,
    CultParity,
    TargetLynchIndependent,
    SelfLynchIndependent,
    SurvivalIndependent,
    WinTriggeredActions,
}
