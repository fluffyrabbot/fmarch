//! The pack: declarative tables over the IR (doc 09).
//!
//! Maps use `BTreeMap` so iteration order is deterministic and never leaks
//! hash-map order into event ordering.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::events::VoteStatus;
use crate::ir::{InvestigateMode, IrAbility, Modifier};

pub type RoleKey = String;
pub type AlignmentKey = String;
pub type Tag = String;

pub const SUPPORTED_PACK_VERSION: u32 = 1;
pub const MIN_SUPPORTED_IR_VERSION: u16 = 1;
pub const SUPPORTED_IR_VERSION: u16 = 65;

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
    /// Optional standard Natural Action Resolution conflict catalog. This names
    /// the pack actions that participate in the ordinary block/protect/kill
    /// contract so validators can prove the generic resolver tables are backed
    /// by concrete pack data.
    #[serde(default)]
    pub standard_nar: StandardNarPolicy,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectDuration {
    /// Effect is emitted as `EffectsMarked` and folded into future state.
    Persistent,
    /// Effect exists only inside the current resolution.
    Resolution,
}

impl Default for EffectDuration {
    fn default() -> Self {
        Self::Persistent
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EffectVisibility {
    Hidden,
    Public,
    Actor,
    Target,
    ActorAndTarget,
}

impl Default for EffectVisibility {
    fn default() -> Self {
        Self::Hidden
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GrantKind {
    ExtraAction,
    Item,
    VoteWeight,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FactionActionPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub actions: Vec<FactionActionSpec>,
}

impl Default for FactionActionPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            actions: Vec::new(),
        }
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FactionVoteTieBreaker {
    BlockAll,
    EarliestSubmitted,
}

impl Default for FactionVoteTieBreaker {
    fn default() -> Self {
        Self::BlockAll
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StandardNarPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kill_stacking: Option<KillStackingPolicy>,
    #[serde(default)]
    pub conflict_families: Vec<StandardNarConflictFamily>,
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

impl Default for StandardNarPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum StandardNarConflictFamily {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum DeathRevealMode {
    Full,
    AlignmentOnly,
    Concealed,
}

impl Default for DeathRevealMode {
    fn default() -> Self {
        Self::Full
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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

impl Default for DeathRetaliationPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            eligible_roles: Vec::new(),
            timing: None,
            allowed_death_causes: Vec::new(),
            suppressed_death_causes: Vec::new(),
        }
    }
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
}

impl Default for BackupPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            passive_effect_prefix: default_backup_passive_effect_prefix(),
            targeted_effect: default_backup_targeted_effect(),
        }
    }
}

fn default_backup_passive_effect_prefix() -> String {
    "backup:".to_string()
}

fn default_backup_targeted_effect() -> String {
    "backup_target".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrivateChannelPolicy {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub groups: Vec<PrivateChannelGroup>,
}

impl Default for PrivateChannelPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            groups: Vec::new(),
        }
    }
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
    Acknowledge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HostPromptResolutionEffect {
    PkKill,
    AdvanceRevote,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ItaVoteConflictPolicy {
    ResolveShotsBeforeVote,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ItaTargetAlreadyDeadPolicy {
    ConsumeShot,
    RefundShot,
    SkipWithWarning,
}

impl Default for ItaTargetAlreadyDeadPolicy {
    fn default() -> Self {
        Self::ConsumeShot
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct ItaResolutionPolicy {
    #[serde(default)]
    pub on_target_already_dead: ItaTargetAlreadyDeadPolicy,
}

fn is_default_ita_resolution_policy(policy: &ItaResolutionPolicy) -> bool {
    *policy == ItaResolutionPolicy::default()
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DayAnnouncementPolicy {
    #[serde(default)]
    pub enabled: bool,
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
            night_deaths_n1: default_day_note_n1_announcements(),
            night_deaths_after_n1: false,
            multiple_night_deaths_n2plus: false,
        }
    }
}

fn default_day_note_n1_announcements() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LastWordsPolicy {
    #[serde(default)]
    pub day_deaths: bool,
}

impl Default for LastWordsPolicy {
    fn default() -> Self {
        Self { day_deaths: false }
    }
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResultMemoryScope {
    Target,
    Investigator,
}

impl Default for ResultMemoryScope {
    fn default() -> Self {
        Self::Target
    }
}

impl ResultMemoryScope {
    pub fn is_default(&self) -> bool {
        *self == Self::Target
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ResultMemoryOutput {
    PreviousCurrentChanged,
    SameDifferent,
}

impl Default for ResultMemoryOutput {
    fn default() -> Self {
        Self::PreviousCurrentChanged
    }
}

impl ResultMemoryOutput {
    pub fn is_default(&self) -> bool {
        *self == Self::PreviousCurrentChanged
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvestigationResultPolicy {
    #[serde(default)]
    pub parity: ParityResultPolicy,
    #[serde(default)]
    pub role_sets: RoleSetInvestigationPolicy,
}

impl Default for InvestigationResultPolicy {
    fn default() -> Self {
        Self {
            parity: ParityResultPolicy::default(),
            role_sets: RoleSetInvestigationPolicy::default(),
        }
    }
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackValidationError {
    pub issues: Vec<PackValidationIssue>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackValidationIssue {
    pub path: String,
    pub message: String,
}

impl std::fmt::Display for PackValidationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        for (idx, issue) in self.issues.iter().enumerate() {
            if idx > 0 {
                write!(f, "; ")?;
            }
            write!(f, "{}: {}", issue.path, issue.message)?;
        }
        Ok(())
    }
}

impl std::error::Error for PackValidationError {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackLoadError {
    Json(String),
    Migration(PackMigrationError),
    Decode(String),
    Validation(PackValidationError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PackMigrationError {
    NotObject,
    MissingField { path: String },
    InvalidField { path: String, message: String },
    UnsupportedVersion { version: u32, supported: u32 },
}

impl std::fmt::Display for PackLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackLoadError::Json(message) => write!(f, "pack JSON parse error: {message}"),
            PackLoadError::Migration(err) => write!(f, "pack migration: {err}"),
            PackLoadError::Decode(message) => write!(f, "pack decode error: {message}"),
            PackLoadError::Validation(err) => write!(f, "pack validation: {err}"),
        }
    }
}

impl std::fmt::Display for PackMigrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PackMigrationError::NotObject => write!(f, "pack root must be a JSON object"),
            PackMigrationError::MissingField { path } => {
                write!(f, "{path}: missing required field")
            }
            PackMigrationError::InvalidField { path, message } => {
                write!(f, "{path}: {message}")
            }
            PackMigrationError::UnsupportedVersion { version, supported } => write!(
                f,
                "unsupported pack version {version}; supported version is {supported}; no migration path is registered"
            ),
        }
    }
}

impl std::error::Error for PackLoadError {}
impl std::error::Error for PackMigrationError {}

pub fn load_pack_from_json(raw: &str) -> Result<Pack, PackLoadError> {
    let value = serde_json::from_str(raw).map_err(|err| PackLoadError::Json(err.to_string()))?;
    let value = upcast_pack_json(value).map_err(PackLoadError::Migration)?;
    let pack: Pack =
        serde_json::from_value(value).map_err(|err| PackLoadError::Decode(err.to_string()))?;
    validate_pack(&pack).map_err(PackLoadError::Validation)?;
    Ok(pack)
}

pub fn upcast_pack_json(value: serde_json::Value) -> Result<serde_json::Value, PackMigrationError> {
    let version = pack_json_version(&value)?;
    if version == SUPPORTED_PACK_VERSION {
        return Ok(value);
    }
    if version == 0 {
        return upcast_pack_v0_to_v1(value);
    }
    Err(PackMigrationError::UnsupportedVersion {
        version,
        supported: SUPPORTED_PACK_VERSION,
    })
}

fn upcast_pack_v0_to_v1(
    mut value: serde_json::Value,
) -> Result<serde_json::Value, PackMigrationError> {
    let object = value.as_object_mut().ok_or(PackMigrationError::NotObject)?;
    object.insert(
        "version".to_string(),
        serde_json::json!(SUPPORTED_PACK_VERSION),
    );
    object
        .entry("ir_version".to_string())
        .or_insert_with(|| serde_json::json!(MIN_SUPPORTED_IR_VERSION));
    rename_object_field(object, "vote_policy", "vote");
    rename_object_field(object, "phase_policy", "phases");
    rename_object_field(object, "action_order", "precedence");

    let roles = object
        .get_mut("roles")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or_else(|| PackMigrationError::MissingField {
            path: "roles".to_string(),
        })?;
    for (role_key, role) in roles {
        let role = role
            .as_object_mut()
            .ok_or_else(|| PackMigrationError::InvalidField {
                path: format!("roles.{role_key}"),
                message: "expected object".to_string(),
            })?;
        rename_object_field(role, "action_templates", "actions");
    }

    Ok(value)
}

fn rename_object_field(
    object: &mut serde_json::Map<String, serde_json::Value>,
    from: &str,
    to: &str,
) {
    if object.contains_key(to) {
        return;
    }
    if let Some(value) = object.remove(from) {
        object.insert(to.to_string(), value);
    }
}

fn pack_json_version(value: &serde_json::Value) -> Result<u32, PackMigrationError> {
    let object = value.as_object().ok_or(PackMigrationError::NotObject)?;
    let raw_version = object
        .get("version")
        .ok_or_else(|| PackMigrationError::MissingField {
            path: "version".to_string(),
        })?;
    let version = raw_version
        .as_u64()
        .ok_or_else(|| PackMigrationError::InvalidField {
            path: "version".to_string(),
            message: "expected non-negative integer".to_string(),
        })?;
    u32::try_from(version).map_err(|_| PackMigrationError::InvalidField {
        path: "version".to_string(),
        message: "expected u32-compatible integer".to_string(),
    })
}

pub fn validate_pack(pack: &Pack) -> Result<(), PackValidationError> {
    let mut issues = Vec::new();

    if pack.version != SUPPORTED_PACK_VERSION {
        issue(
            &mut issues,
            "version",
            format!(
                "unsupported pack version {}; supported version is {}",
                pack.version, SUPPORTED_PACK_VERSION
            ),
        );
    }
    if pack.ir_version < MIN_SUPPORTED_IR_VERSION || pack.ir_version > SUPPORTED_IR_VERSION {
        issue(
            &mut issues,
            "ir_version",
            format!(
                "unsupported IR version {}; supported range is {}..={}",
                pack.ir_version, MIN_SUPPORTED_IR_VERSION, SUPPORTED_IR_VERSION
            ),
        );
    }
    validate_pack_required_ir_version(&mut issues, pack);
    if pack.name.trim().is_empty() {
        issue(&mut issues, "name", "pack name must not be empty");
    }
    if pack.roles.is_empty() {
        issue(&mut issues, "roles", "pack must define at least one role");
    }
    validate_phase_policy(&mut issues, "phases", &pack.phases);

    let role_keys: BTreeSet<&str> = pack.roles.keys().map(String::as_str).collect();
    validate_ita_policy(&mut issues, "ita", &pack.ita, &role_keys);
    let alignments: BTreeSet<&str> = pack
        .roles
        .values()
        .filter_map(|role| role.alignment.as_deref())
        .collect();
    let effect_tags = declared_effect_tags(pack);
    let team_kill_action_ids: BTreeSet<&str> = pack
        .standard_nar
        .team_kill_action_ids
        .iter()
        .map(String::as_str)
        .collect();
    let cadence: BTreeSet<PhaseKind> = pack.phases.cadence.iter().copied().collect();
    validate_investigation_result_policy(
        &mut issues,
        "investigation_results",
        &pack.investigation_results,
        &role_keys,
        &alignments,
    );
    validate_day_note_policy(&mut issues, "day_notes", &pack.day_notes, &cadence);
    validate_wolf_carry_policy(
        &mut issues,
        "wolf_carry",
        &pack.wolf_carry,
        pack.ir_version,
        &role_keys,
        &cadence,
    );
    validate_wolf_beauty_policy(
        &mut issues,
        "wolf_beauty",
        &pack.wolf_beauty,
        pack.ir_version,
        &role_keys,
        &effect_tags,
        &cadence,
    );
    validate_guard_policy(
        &mut issues,
        "guard_policy",
        &pack.guard_policy,
        pack.ir_version,
        pack,
        &cadence,
    );
    validate_faction_action_policy(
        &mut issues,
        "faction_actions",
        &pack.faction_actions,
        pack.ir_version,
        pack,
        &alignments,
        &cadence,
    );
    validate_standard_nar_policy(
        &mut issues,
        "standard_nar",
        &pack.standard_nar,
        pack,
        &cadence,
    );
    validate_death_retaliation_policy(
        &mut issues,
        "death_retaliation",
        &pack.death_retaliation,
        pack.ir_version,
        &role_keys,
        &cadence,
    );
    validate_death_reveal_policy(
        &mut issues,
        "death_reveal",
        &pack.death_reveal,
        pack.ir_version,
        pack,
        &effect_tags,
    );
    validate_effect_source_death_reveals(
        &mut issues,
        "effect_source_death_reveals",
        &pack.effect_source_death_reveals,
        pack.ir_version,
        pack,
        &effect_tags,
    );
    validate_idiot_policy(
        &mut issues,
        "idiot_policy",
        &pack.idiot_policy,
        pack.ir_version,
        &role_keys,
        &effect_tags,
        &cadence,
    );
    validate_saulus_policy(
        &mut issues,
        "saulus_policy",
        &pack.saulus_policy,
        pack.ir_version,
        &role_keys,
        &alignments,
        &cadence,
    );
    validate_backup_policy(
        &mut issues,
        "backup_policy",
        &pack.backup_policy,
        pack.ir_version,
        &role_keys,
        &effect_tags,
    );
    validate_private_channel_policy(
        &mut issues,
        "private_channels",
        &pack.private_channels,
        pack.ir_version,
        &role_keys,
    );
    validate_treestump_policy(
        &mut issues,
        "treestump_policy",
        &pack.treestump_policy,
        pack.ir_version,
        &role_keys,
    );
    validate_conversion_policy(
        &mut issues,
        "conversion_policy",
        &pack.conversion_policy,
        pack,
    );
    validate_target_lynch_win_policies(
        &mut issues,
        "target_lynch_win_policies",
        &pack.target_lynch_win_policies,
        pack.ir_version,
        &role_keys,
        &alignments,
        &effect_tags,
        &cadence,
    );
    validate_self_lynch_win_policies(
        &mut issues,
        "self_lynch_win_policies",
        &pack.self_lynch_win_policies,
        pack.ir_version,
        &role_keys,
        &alignments,
        &cadence,
    );
    validate_beloved_princess_policy(
        &mut issues,
        "beloved_princess_policy",
        &pack.beloved_princess_policy,
        pack.ir_version,
        &role_keys,
        &cadence,
    );
    validate_day_vote_prompt_policies(
        &mut issues,
        "day_vote_prompt_policies",
        &pack.day_vote_prompt_policies,
        pack.ir_version,
        &cadence,
    );
    validate_host_prompt_resolution_effects(
        &mut issues,
        "host_prompt_resolution_effects",
        &pack.host_prompt_resolution_effects,
        pack.ir_version,
        pack,
    );
    validate_lover_policy(
        &mut issues,
        "lover_policy",
        &pack.lover_policy,
        pack.ir_version,
        &effect_tags,
        &cadence,
    );

    for tag in pack.effects.keys() {
        if tag.trim().is_empty() {
            issue(
                &mut issues,
                "effects",
                "effect policy tags must not be empty",
            );
        }
    }

    let mut has_ita_shot = false;
    for (role_key, role) in &pack.roles {
        validate_role(
            &mut issues,
            &format!("roles.{role_key}"),
            role,
            &pack.standard_nar,
        );
        let mut role_action_ids = BTreeSet::new();
        if role.description.trim().is_empty() {
            issue(
                &mut issues,
                format!("roles.{role_key}.description"),
                "role description must not be empty",
            );
        }
        for (idx, action) in role.actions.iter().enumerate() {
            let path = format!("roles.{role_key}.actions[{idx}]");
            validate_action(
                &mut issues,
                &path,
                action,
                pack.ir_version,
                &role_keys,
                &alignments,
                &effect_tags,
                &pack.effects,
                &team_kill_action_ids,
                &pack.investigation_results.role_sets.vanilla_roles,
                &cadence,
            );
            if action
                .abilities()
                .any(|ability| ability == IrAbility::ItaShot)
            {
                has_ita_shot = true;
            }
            if let Some(grant) = &action.grant {
                validate_grant_spec(&mut issues, format!("{path}.grant"), grant, pack);
            }
            for (idx, grant) in action.grant_options.iter().enumerate() {
                validate_grant_spec(
                    &mut issues,
                    format!("{path}.grant_options[{idx}]"),
                    grant,
                    pack,
                );
            }
            if !role_action_ids.insert(action.id.as_str()) {
                issue(
                    &mut issues,
                    format!("{path}.id"),
                    format!(
                        "duplicate action id `{}` within role `{role_key}`",
                        action.id
                    ),
                );
            }
        }
    }
    for (grant_id, action) in &pack.item_actions {
        let path = format!("item_actions.{grant_id}");
        if grant_id.trim().is_empty() {
            issue(
                &mut issues,
                "item_actions",
                "item action grant ids must not be empty",
            );
        }
        if action.id != *grant_id {
            issue(
                &mut issues,
                format!("{path}.id"),
                "item action id must match its item_actions key",
            );
        }
        validate_action(
            &mut issues,
            &path,
            action,
            pack.ir_version,
            &role_keys,
            &alignments,
            &effect_tags,
            &pack.effects,
            &team_kill_action_ids,
            &pack.investigation_results.role_sets.vanilla_roles,
            &cadence,
        );
        if action
            .abilities()
            .any(|ability| ability == IrAbility::ItaShot)
        {
            has_ita_shot = true;
        }
    }
    if has_ita_shot && pack.ita.sessions.is_empty() {
        issue(
            &mut issues,
            "ita.sessions",
            "packs with ItaShot actions must declare at least one ITA session",
        );
    }
    if has_ita_shot
        && !matches!(
            pack.ita.vote_conflict,
            Some(ItaVoteConflictPolicy::ResolveShotsBeforeVote)
        )
    {
        issue(
            &mut issues,
            "ita.vote_conflict",
            "packs with ItaShot actions must declare vote_conflict ResolveShotsBeforeVote",
        );
    }

    validate_precedence_rules(&mut issues, pack);
    validate_visibility_rules(&mut issues, pack);
    validate_visibility_families(&mut issues, pack);

    validate_trigger_identity_and_filters(&mut issues, pack, &effect_tags);
    validate_trigger_production_shapes(&mut issues, pack);
    validate_visit_trigger_contracts(&mut issues, pack);
    validate_kill_trigger_contracts(&mut issues, pack);
    validate_lynch_trigger_contracts(&mut issues, pack);

    for (tag, overrides) in &pack.investigation_overrides.clone().unwrap_or_default() {
        if !effect_tags.contains(tag.as_str()) {
            issue(
                &mut issues,
                format!("investigation_overrides.{tag}"),
                format!("unknown effect tag `{tag}`"),
            );
        }
        if overrides.by_mode.is_empty() {
            issue(
                &mut issues,
                format!("investigation_overrides.{tag}"),
                "override must define at least one investigate mode",
            );
        }
    }

    let vote_weight_grant_ids: BTreeSet<String> = pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .filter_map(|action| action.grant.as_ref())
        .filter(|grant| grant.kind == GrantKind::VoteWeight)
        .map(|grant| grant.grant_id.clone())
        .collect();

    validate_vote_policy(
        &mut issues,
        &pack.vote,
        &role_keys,
        &effect_tags,
        &vote_weight_grant_ids,
        &cadence,
        &pack.day_vote_prompt_policies,
        &pack.host_prompt_resolution_effects,
        pack_uses_ability(pack, IrAbility::VoteDuel),
    );

    validate_win_policy(
        &mut issues,
        &pack.win,
        pack.ir_version,
        &alignments,
        &role_keys,
    );
    validate_win_families(&mut issues, pack);

    if issues.is_empty() {
        Ok(())
    } else {
        Err(PackValidationError { issues })
    }
}

/// Derive the current night ability stage order from pack action priorities and
/// precedence edges. Only declared night/any-window abilities participate; day
/// handling has its own vote pipeline.
pub fn night_ability_order(pack: &Pack) -> Result<Vec<IrAbility>, PackValidationError> {
    let priorities = night_ability_priorities(pack);
    let abilities: BTreeSet<IrAbility> = priorities.keys().copied().collect();
    let edges = precedence_edges(pack, &abilities);
    topological_ability_order(&priorities, &edges)
}

fn validate_precedence_rules(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let mut ids = BTreeSet::new();
    let mut keys = BTreeSet::new();

    for (idx, rule) in pack.precedence.iter().enumerate() {
        let path = format!("precedence[{idx}]");
        if rule.id.trim().is_empty() {
            issue(
                issues,
                format!("{path}.id"),
                "precedence rule id must not be empty",
            );
        } else if !ids.insert(rule.id.as_str()) {
            issue(
                issues,
                format!("{path}.id"),
                format!("duplicate precedence rule id `{}`", rule.id),
            );
        }

        let key = (rule.when.effect, rule.when.target_state.as_deref());
        if !keys.insert(key) {
            issue(
                issues,
                format!("{path}.when"),
                "duplicate precedence rule for ability/target_state",
            );
        }

        if rule.when.target_state.is_some() {
            issue(
                issues,
                format!("{path}.when.target_state"),
                "target_state precedence is not supported by the v1 resolver",
            );
        }
        if rule.beats.is_empty() && rule.blocked_by.is_empty() {
            issue(
                issues,
                path.clone(),
                "precedence rule must declare beats or blocked_by",
            );
        }
        validate_unique_abilities(issues, format!("{path}.beats"), &rule.beats);
        validate_unique_abilities(issues, format!("{path}.blocked_by"), &rule.blocked_by);
        if rule.beats.contains(&rule.when.effect) || rule.blocked_by.contains(&rule.when.effect) {
            issue(
                issues,
                path.clone(),
                "precedence rule cannot relate an ability to itself",
            );
        }
        if !rule.unless_modifiers.is_empty()
            && !(rule.when.effect == IrAbility::Protect && rule.beats.contains(&IrAbility::Kill))
        {
            issue(
                issues,
                format!("{path}.unless_modifiers"),
                "unless_modifiers are currently supported only for Protect beating Kill",
            );
        }
    }

    validate_priority_ties(issues, pack);
    if let Err(err) = night_ability_order(pack) {
        issues.extend(err.issues);
    }
}

fn validate_unique_abilities(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    abilities: &[IrAbility],
) {
    let path = path.into();
    let mut seen = BTreeSet::new();
    for ability in abilities {
        if !seen.insert(*ability) {
            issue(
                issues,
                path.clone(),
                format!("duplicate ability `{ability:?}`"),
            );
        }
    }
}

fn validate_priority_ties(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let priorities = night_ability_priorities(pack);
    let abilities: Vec<IrAbility> = priorities.keys().copied().collect();
    let ability_set: BTreeSet<IrAbility> = abilities.iter().copied().collect();
    let edges = precedence_edges(pack, &ability_set);

    for (idx, left) in abilities.iter().enumerate() {
        for right in abilities.iter().skip(idx + 1) {
            if priorities.get(left) != priorities.get(right) {
                continue;
            }
            if has_path(*left, *right, &edges) || has_path(*right, *left, &edges) {
                continue;
            }
            issue(
                issues,
                "precedence",
                format!(
                    "abilities `{left:?}` and `{right:?}` share priority {} without precedence",
                    priorities[left]
                ),
            );
        }
    }
}

fn validate_unique_strings(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    values: &[String],
) {
    let path = path.into();
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(value.as_str()) {
            issue(issues, path.clone(), format!("duplicate value `{value}`"));
        }
    }
}

fn validate_visibility_rules(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    for (ability, rule) in &pack.visibility {
        let path = format!("visibility.{ability:?}");
        if rule.sees.is_empty() {
            issue(
                issues,
                format!("{path}.sees"),
                "visibility rule must expose at least one field",
            );
        }
        validate_unique_vis_fields(issues, format!("{path}.sees"), &rule.sees);
        validate_unique_modifiers(
            issues,
            format!("{path}.unless_modifiers"),
            &rule.unless_modifiers,
        );
        if *ability != IrAbility::Investigate && rule.sees.contains(&VisField::Result) {
            issue(
                issues,
                format!("{path}.sees"),
                "Result visibility is currently supported only for Investigate",
            );
        }
    }

    if pack
        .investigation_overrides
        .as_ref()
        .is_some_and(|overrides| !overrides.is_empty())
    {
        let Some(rule) = pack.visibility.get(&IrAbility::Investigate) else {
            issue(
                issues,
                "visibility.Investigate",
                "investigation_overrides require Investigate visibility policy",
            );
            return;
        };
        if !rule.sees.contains(&VisField::Result) {
            issue(
                issues,
                "visibility.Investigate.sees",
                "investigation_overrides require Investigate visibility to expose Result",
            );
        }
    }

    if !pack_has_ninja_action(pack) {
        return;
    }

    let Some(rule) = pack.visibility.get(&IrAbility::Investigate) else {
        issue(
            issues,
            "visibility.Investigate",
            "Ninja actions require Investigate visibility policy",
        );
        return;
    };
    if !rule.unless_modifiers.contains(&Modifier::Ninja) {
        issue(
            issues,
            "visibility.Investigate.unless_modifiers",
            "Ninja actions require Investigate visibility unless_modifiers Ninja",
        );
    }
    if !rule.sees.contains(&VisField::TargetId) {
        issue(
            issues,
            "visibility.Investigate.sees",
            "Ninja visit hiding requires Investigate visibility to expose TargetId",
        );
    }
}

fn validate_visibility_families(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    if pack.visibility_families.is_empty() {
        if pack.ir_version >= 45 && !visibility_required_families(pack).is_empty() {
            issue(
                issues,
                "visibility_families",
                "packs with visibility policy surfaces must declare visibility_families",
            );
        }
        return;
    }
    if pack.ir_version < 45 {
        issue(
            issues,
            "visibility_families",
            "visibility_families requires ir_version >= 45",
        );
    }

    let mut declared = BTreeSet::new();
    for family in &pack.visibility_families {
        if !declared.insert(*family) {
            issue(
                issues,
                "visibility_families",
                format!("duplicate visibility family `{family:?}`"),
            );
        }
    }

    let required = visibility_required_families(pack);
    for family in &required {
        if !declared.contains(family) {
            issue(
                issues,
                "visibility_families",
                format!("visibility_families must include `{family:?}`"),
            );
        }
    }
    for family in &declared {
        if !required.contains(family) {
            issue(
                issues,
                "visibility_families",
                format!("declared visibility family `{family:?}` has no matching policy surface"),
            );
        }
    }
}

pub(crate) fn visibility_required_families(pack: &Pack) -> BTreeSet<VisibilityFamily> {
    let mut required = BTreeSet::new();
    if pack
        .visibility
        .get(&IrAbility::Investigate)
        .is_some_and(|rule| rule.sees.contains(&VisField::Result))
    {
        required.insert(VisibilityFamily::PrivateInvestigationResults);
    }
    if pack_uses_graph_visit_results(pack) {
        required.insert(VisibilityFamily::GraphVisitResults);
    }
    if pack_has_ninja_action(pack) {
        required.insert(VisibilityFamily::StealthNinjaVisits);
    }
    if pack
        .investigation_overrides
        .as_ref()
        .is_some_and(|overrides| !overrides.is_empty())
    {
        required.insert(VisibilityFamily::ResultTampering);
    }
    if pack.death_reveal != DeathRevealPolicy::default() {
        required.insert(VisibilityFamily::DeathRevealVariants);
    }
    if !pack.effects.is_empty() {
        required.insert(VisibilityFamily::EffectAudiences);
    }
    if pack_uses_grant_audience(pack) {
        required.insert(VisibilityFamily::GrantAudiences);
    }
    if pack.private_channels.enabled {
        required.insert(VisibilityFamily::PrivateChannels);
    }
    required
}

fn pack_uses_graph_visit_results(pack: &Pack) -> bool {
    standard_nar_pack_actions(pack).iter().any(|(_, action)| {
        matches!(
            action.mode,
            Some(InvestigateMode::Track)
                | Some(InvestigateMode::Watch)
                | Some(InvestigateMode::Motion)
                | Some(InvestigateMode::PriorMotion)
        )
    })
}

fn pack_uses_grant_audience(pack: &Pack) -> bool {
    standard_nar_pack_actions(pack).iter().any(|(_, action)| {
        action.has_ability(IrAbility::Grant)
            || action.grant.is_some()
            || !action.grant_options.is_empty()
    })
}

fn validate_win_policy(
    issues: &mut Vec<PackValidationIssue>,
    win: &WinPolicy,
    ir_version: u16,
    alignments: &BTreeSet<&str>,
    role_keys: &BTreeSet<&str>,
) {
    let mut conditions = BTreeSet::new();
    for (idx, rule) in win.rules.iter().enumerate() {
        let winner_path = format!("win.rules[{idx}].winner");
        let when_path = format!("win.rules[{idx}].when");
        let blockers_path = format!("win.rules[{idx}].blocked_by_alive");
        let condition_label = win_condition_label(&rule.when);
        if !conditions.insert(condition_label.clone()) {
            issue(
                issues,
                when_path.clone(),
                format!("duplicate win condition `{condition_label}`"),
            );
        }
        validate_alignment_ref(issues, winner_path.clone(), &rule.winner, alignments);
        match &rule.when {
            WinCondition::FactionEliminated(alignment) => {
                validate_alignment_ref(issues, when_path.clone(), alignment, alignments);
                if rule.winner == *alignment {
                    issue(
                        issues,
                        winner_path,
                        "FactionEliminated rules must not award the eliminated faction",
                    );
                }
            }
            WinCondition::FactionReachesParity(alignment) => {
                validate_alignment_ref(issues, when_path.clone(), alignment, alignments);
                if rule.winner != *alignment {
                    issue(
                        issues,
                        winner_path,
                        "FactionReachesParity rules must award the parity faction",
                    );
                }
            }
            WinCondition::AllOtherFactionsEliminated(alignment) => {
                validate_alignment_ref(issues, when_path, alignment, alignments);
                if rule.winner != *alignment {
                    issue(
                        issues,
                        winner_path,
                        "AllOtherFactionsEliminated rules must award the surviving faction",
                    );
                }
            }
        }
        let mut blockers = BTreeSet::new();
        for blocker in &rule.blocked_by_alive {
            validate_alignment_ref(issues, blockers_path.clone(), blocker, alignments);
            if blocker == &rule.winner {
                issue(
                    issues,
                    blockers_path.clone(),
                    "win rule blockers must not include the winning alignment",
                );
            }
            if !blockers.insert(blocker.as_str()) {
                issue(
                    issues,
                    blockers_path.clone(),
                    format!("duplicate win rule blocker `{blocker}`"),
                );
            }
        }
    }

    let mut award_ids = BTreeSet::new();
    for (idx, award) in win.survival_awards.iter().enumerate() {
        let award_path = format!("win.survival_awards[{idx}]");
        if ir_version < 63 {
            issue(
                issues,
                award_path.clone(),
                "survival awards require ir_version >= 63",
            );
        }
        if award.id.trim().is_empty() {
            issue(issues, format!("{award_path}.id"), "id must not be empty");
        } else if !award_ids.insert(award.id.as_str()) {
            issue(
                issues,
                format!("{award_path}.id"),
                format!("duplicate survival award id `{}`", award.id),
            );
        }
        if award.winner.trim().is_empty() {
            issue(
                issues,
                format!("{award_path}.winner"),
                "winner must not be empty",
            );
        }
        if award.eligible_roles.is_empty() {
            issue(
                issues,
                format!("{award_path}.eligible_roles"),
                "survival award must declare eligible_roles",
            );
        }
        validate_unique_strings(
            issues,
            format!("{award_path}.eligible_roles"),
            &award.eligible_roles,
        );
        for role_key in &award.eligible_roles {
            if !role_keys.contains(role_key.as_str()) {
                issue(
                    issues,
                    format!("{award_path}.eligible_roles"),
                    format!("unknown eligible role `{role_key}`"),
                );
            }
        }
        if let Some(source_event) = &award.source_event {
            if source_event.trim().is_empty() {
                issue(
                    issues,
                    format!("{award_path}.source_event"),
                    "source_event must not be empty",
                );
            } else if !source_event.starts_with("win.") {
                issue(
                    issues,
                    format!("{award_path}.source_event"),
                    "source_event must be a win.* result event string",
                );
            }
        }
    }
}

fn validate_win_families(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    if pack.win_families.is_empty() {
        if pack.ir_version >= 46 && !win_required_families(pack).is_empty() {
            issue(
                issues,
                "win_families",
                "packs with win policy surfaces must declare win_families",
            );
        }
        return;
    }
    if pack.ir_version < 46 {
        issue(
            issues,
            "win_families",
            "win_families requires ir_version >= 46",
        );
    }

    let mut declared = BTreeSet::new();
    for family in &pack.win_families {
        if !declared.insert(*family) {
            issue(
                issues,
                "win_families",
                format!("duplicate win family `{family:?}`"),
            );
        }
    }

    let required = win_required_families(pack);
    for family in &required {
        if !declared.contains(family) {
            issue(
                issues,
                "win_families",
                format!("win_families must include `{family:?}`"),
            );
        }
    }
    for family in &declared {
        if !required.contains(family) {
            issue(
                issues,
                "win_families",
                format!("declared win family `{family:?}` has no matching policy surface"),
            );
        }
    }
}

pub(crate) fn win_required_families(pack: &Pack) -> BTreeSet<WinFamily> {
    let mut required = BTreeSet::new();
    for rule in &pack.win.rules {
        match &rule.when {
            WinCondition::FactionEliminated(_) => {
                required.insert(WinFamily::FactionElimination);
            }
            WinCondition::FactionReachesParity(alignment) => {
                required.insert(WinFamily::FactionParity);
                if alignment == "cult" || rule.winner == "cult" {
                    required.insert(WinFamily::CultParity);
                }
            }
            WinCondition::AllOtherFactionsEliminated(_) => {
                required.insert(WinFamily::AllOtherFactionsEliminated);
            }
        }
    }
    if !pack.target_lynch_win_policies.is_empty() {
        required.insert(WinFamily::TargetLynchIndependent);
    }
    if !pack.self_lynch_win_policies.is_empty() {
        required.insert(WinFamily::SelfLynchIndependent);
    }
    if pack
        .triggers
        .iter()
        .any(|trigger| trigger.on == TriggerOn::Event(TriggerEvent::Win))
    {
        required.insert(WinFamily::WinTriggeredActions);
    }
    if !pack.win.survival_awards.is_empty() {
        required.insert(WinFamily::SurvivalIndependent);
    }
    required
}

fn win_condition_label(condition: &WinCondition) -> String {
    match condition {
        WinCondition::FactionEliminated(alignment) => {
            format!("FactionEliminated({alignment})")
        }
        WinCondition::FactionReachesParity(alignment) => {
            format!("FactionReachesParity({alignment})")
        }
        WinCondition::AllOtherFactionsEliminated(alignment) => {
            format!("AllOtherFactionsEliminated({alignment})")
        }
    }
}

fn validate_unique_vis_fields(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    values: &[VisField],
) {
    let path = path.into();
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(*value) {
            issue(issues, path.clone(), format!("duplicate field `{value:?}`"));
        }
    }
}

fn validate_unique_modifiers(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    values: &[Modifier],
) {
    let path = path.into();
    let mut seen = BTreeSet::new();
    for value in values {
        if !seen.insert(*value) {
            issue(
                issues,
                path.clone(),
                format!("duplicate modifier `{value:?}`"),
            );
        }
    }
}

fn pack_has_ninja_action(pack: &Pack) -> bool {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .any(|action| action.has_modifier(Modifier::Ninja))
}

fn validate_conversion_spec(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    conversion: &ConversionSpec,
    role_keys: &BTreeSet<&str>,
) {
    match conversion.mode {
        ConversionMode::AssignRole => match &conversion.role {
            Some(role_key) if role_keys.contains(role_key.as_str()) => {}
            Some(role_key) => issue(
                issues,
                format!("{path}.role"),
                format!("AssignRole conversion references unknown role `{role_key}`"),
            ),
            None => issue(
                issues,
                format!("{path}.role"),
                "AssignRole conversion must declare role",
            ),
        },
        ConversionMode::RestoreOriginal => {
            if conversion.role.is_some() {
                issue(
                    issues,
                    format!("{path}.role"),
                    "RestoreOriginal conversion must not declare role",
                );
            }
        }
    }
}

fn validate_conversion_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &ConversionPolicy,
    pack: &Pack,
) {
    if !pack_has_convert_action(pack) {
        return;
    }
    match policy.on_dead_target {
        Some(ConversionDeadTargetPolicy::Block) => {}
        None => issue(
            issues,
            format!("{path}.on_dead_target"),
            "packs with Convert actions must declare on_dead_target Block",
        ),
    }
    match policy.on_pending_death {
        Some(ConversionPendingDeathPolicy::Block) => {}
        None => issue(
            issues,
            format!("{path}.on_pending_death"),
            "packs with Convert actions must declare on_pending_death Block",
        ),
    }
}

fn pack_has_convert_action(pack: &Pack) -> bool {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
        .any(|action| action.has_ability(IrAbility::Convert))
}

fn validate_ita_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    ita: &ItaPolicy,
    role_keys: &BTreeSet<&str>,
) {
    if !ita.default_hit_chance.is_finite()
        || ita.default_hit_chance < 0.0
        || ita.default_hit_chance > 1.0
    {
        issue(
            issues,
            format!("{path}.default_hit_chance"),
            "ITA default_hit_chance must be finite and between 0.0 and 1.0",
        );
    }

    if (!ita.role_overrides.is_empty()
        || !ita.modifier_components.is_empty()
        || !ita.role_modifier_refs.is_empty())
        && ita.sessions.is_empty()
    {
        issue(
            issues,
            path,
            "ITA modifiers require at least one ITA session",
        );
    }

    for (component_id, component) in &ita.modifier_components {
        let component_path = format!("{path}.modifier_components.{component_id}");
        if component_id.trim().is_empty() {
            issue(
                issues,
                format!("{path}.modifier_components"),
                "ITA modifier component id must not be empty",
            );
        }
        validate_ita_role_override(issues, &component_path, component, "component");
    }

    for (role_key, component_refs) in &ita.role_modifier_refs {
        let refs_path = format!("{path}.role_modifier_refs.{role_key}");
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_modifier_refs"),
                format!("unknown ITA role modifier ref `{role_key}`"),
            );
        }
        if component_refs.is_empty() {
            issue(
                issues,
                refs_path.clone(),
                "ITA role modifier refs must not be empty",
            );
        }
        let mut seen_refs = BTreeSet::new();
        for component_ref in component_refs {
            if !seen_refs.insert(component_ref) {
                issue(
                    issues,
                    refs_path.clone(),
                    format!("duplicate ITA modifier component ref `{component_ref}`"),
                );
            }
            if !ita.modifier_components.contains_key(component_ref) {
                issue(
                    issues,
                    refs_path.clone(),
                    format!("unknown ITA modifier component `{component_ref}`"),
                );
            }
        }
        let effective = ita.effective_role_override(role_key);
        validate_ita_role_override(
            issues,
            &format!("{refs_path}.effective"),
            &effective,
            "effective role modifier",
        );
    }

    for (role_key, override_policy) in &ita.role_overrides {
        let override_path = format!("{path}.role_overrides.{role_key}");
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_overrides"),
                format!("unknown ITA role override `{role_key}`"),
            );
        }
        validate_ita_role_override(issues, &override_path, override_policy, "role override");
    }

    let mut seen = BTreeSet::new();
    for (idx, session) in ita.sessions.iter().enumerate() {
        let session_path = format!("{path}.sessions[{idx}]");
        if session.session_id.trim().is_empty() {
            issue(
                issues,
                format!("{session_path}.session_id"),
                "ITA session_id must not be empty",
            );
        } else if !seen.insert(session.session_id.as_str()) {
            issue(
                issues,
                format!("{session_path}.session_id"),
                format!("duplicate ITA session `{}`", session.session_id),
            );
        }
        if matches!(session.day, Some(0)) {
            issue(
                issues,
                format!("{session_path}.day"),
                "ITA session day must be greater than zero",
            );
        }
        if let Some(hit_chance) = session.hit_chance {
            if !hit_chance.is_finite() || !(0.0..=1.0).contains(&hit_chance) {
                issue(
                    issues,
                    format!("{session_path}.hit_chance"),
                    "ITA session hit_chance must be finite and between 0.0 and 1.0",
                );
            }
        }
        if matches!(session.shot_limit, Some(0)) {
            issue(
                issues,
                format!("{session_path}.shot_limit"),
                "ITA session shot_limit must be greater than zero",
            );
        }
        if matches!(session.buffer_delay_ms, Some(0)) {
            issue(
                issues,
                format!("{session_path}.buffer_delay_ms"),
                "ITA session buffer_delay_ms must be greater than zero",
            );
        }
    }
}

fn validate_probability_delta(issues: &mut Vec<PackValidationIssue>, path: &str, value: f64) {
    if !value.is_finite() || !(0.0..=1.0).contains(&value) {
        issue(
            issues,
            path,
            "ITA probability modifiers must be finite and between 0.0 and 1.0",
        );
    }
}

fn validate_ita_role_override(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &ItaRoleOverride,
    label: &str,
) {
    validate_probability_delta(issues, &format!("{path}.hit_bonus"), policy.hit_bonus);
    validate_probability_delta(issues, &format!("{path}.hit_penalty"), policy.hit_penalty);
    validate_probability_delta(issues, &format!("{path}.target_evade"), policy.target_evade);
    if policy.is_empty() {
        issue(
            issues,
            path,
            format!("ITA {label} must declare at least one nonzero modifier"),
        );
    }
}

fn validate_day_note_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &DayNotePolicy,
    cadence: &BTreeSet<PhaseKind>,
) {
    let needs_day = policy.announcements.enabled || policy.last_words.day_deaths;
    if needs_day && !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "day-note policy requires Day in phases.cadence",
        );
    }
    if policy.announcements.multiple_night_deaths_n2plus
        && !policy.announcements.night_deaths_after_n1
    {
        issue(
            issues,
            format!("{path}.announcements.multiple_night_deaths_n2plus"),
            "multiple_night_deaths_n2plus requires night_deaths_after_n1",
        );
    }
}

fn validate_wolf_carry_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &WolfCarryPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 11 {
        issue(
            issues,
            path,
            "enabled wolf carry policy requires ir_version >= 11",
        );
    }
    if policy.token_id.trim().is_empty() {
        issue(
            issues,
            format!("{path}.token_id"),
            "wolf carry token_id must not be empty",
        );
    }
    if policy.cause.trim().is_empty() {
        issue(
            issues,
            format!("{path}.cause"),
            "wolf carry cause must not be empty",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled wolf carry policy must declare eligible_roles",
        );
    }
    if policy.wolf_kill_roles.is_empty() {
        issue(
            issues,
            format!("{path}.wolf_kill_roles"),
            "enabled wolf carry policy must declare wolf_kill_roles",
        );
    }
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    for role_key in &policy.wolf_kill_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.wolf_kill_roles"),
                format!("unknown wolf kill role `{role_key}`"),
            );
        }
    }
    if !cadence.contains(&PhaseKind::Day) || !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled wolf carry policy requires Day and Night in phases.cadence",
        );
    }
}

fn validate_wolf_beauty_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &WolfBeautyPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 12 {
        issue(
            issues,
            path,
            "enabled wolf beauty policy requires ir_version >= 12",
        );
    }
    if policy.mark_effect.trim().is_empty() {
        issue(
            issues,
            format!("{path}.mark_effect"),
            "wolf beauty mark_effect must not be empty",
        );
    } else if !effect_tags.contains(policy.mark_effect.as_str()) {
        issue(
            issues,
            format!("{path}.mark_effect"),
            format!("unknown mark effect `{}`", policy.mark_effect),
        );
    }
    if policy.drag_cause.trim().is_empty() {
        issue(
            issues,
            format!("{path}.drag_cause"),
            "wolf beauty drag_cause must not be empty",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled wolf beauty policy must declare eligible_roles",
        );
    }
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    if policy.death_causes.is_empty() {
        issue(
            issues,
            format!("{path}.death_causes"),
            "enabled wolf beauty policy must declare death_causes",
        );
    }
    for cause in &policy.death_causes {
        if cause.trim().is_empty() {
            issue(
                issues,
                format!("{path}.death_causes"),
                "wolf beauty day death causes must not be empty",
            );
        }
    }
    if !cadence.contains(&PhaseKind::Day) || !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled wolf beauty policy requires Day and Night in phases.cadence",
        );
    }
}

fn validate_guard_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &GuardPolicy,
    ir_version: u16,
    pack: &Pack,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 13 {
        issue(
            issues,
            path,
            "enabled guard policy requires ir_version >= 13",
        );
    }
    if policy.guard_action_ids.is_empty() {
        issue(
            issues,
            format!("{path}.guard_action_ids"),
            "enabled guard policy must declare guard_action_ids",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.guard_action_ids"),
        &policy.guard_action_ids,
    );
    for action_id in &policy.guard_action_ids {
        validate_policy_action_ref(
            issues,
            format!("{path}.guard_action_ids"),
            pack,
            action_id,
            IrAbility::Protect,
            "guard action",
        );
    }
    match policy.guard_self_allowed {
        Some(self_allowed) => {
            for action_id in &policy.guard_action_ids {
                for action in policy_action_templates(pack, action_id, IrAbility::Protect) {
                    if action.constraints.self_allowed != self_allowed {
                        issue(
                            issues,
                            format!("{path}.guard_self_allowed"),
                            format!(
                                "guard action `{}` constraints.self_allowed must be {}",
                                action.id, self_allowed
                            ),
                        );
                    }
                }
            }
        }
        None => issue(
            issues,
            format!("{path}.guard_self_allowed"),
            "enabled guard policy must declare guard_self_allowed",
        ),
    }
    match policy.guard_night_one_allowed {
        Some(night_one_allowed) => {
            for action_id in &policy.guard_action_ids {
                for action in policy_action_templates(pack, action_id, IrAbility::Protect) {
                    let valid = if night_one_allowed {
                        match action.constraints.active_from.as_ref() {
                            None => true,
                            Some(gate) => {
                                gate.phase_kind == PhaseKind::Night && gate.phase_number <= 1
                            }
                        }
                    } else {
                        action.constraints.active_from.as_ref().is_some_and(|gate| {
                            gate.phase_kind == PhaseKind::Night && gate.phase_number == 2
                        })
                    };
                    if !valid {
                        issue(
                            issues,
                            format!("{path}.guard_night_one_allowed"),
                            format!(
                                "guard action `{}` active_from must match guard_night_one_allowed={}",
                                action.id, night_one_allowed
                            ),
                        );
                    }
                }
            }
        }
        None => issue(
            issues,
            format!("{path}.guard_night_one_allowed"),
            "enabled guard policy must declare guard_night_one_allowed",
        ),
    }
    validate_unique_strings(
        issues,
        format!("{path}.witch_heal_action_ids"),
        &policy.witch_heal_action_ids,
    );
    for action_id in &policy.witch_heal_action_ids {
        validate_policy_action_ref(
            issues,
            format!("{path}.witch_heal_action_ids"),
            pack,
            action_id,
            IrAbility::Protect,
            "witch heal action",
        );
    }
    if policy.guard_blockable_causes.is_empty() {
        issue(
            issues,
            format!("{path}.guard_blockable_causes"),
            "enabled guard policy must declare guard_blockable_causes",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.guard_blockable_causes"),
        &policy.guard_blockable_causes,
    );
    for cause in &policy.guard_blockable_causes {
        if cause.trim().is_empty() {
            issue(
                issues,
                format!("{path}.guard_blockable_causes"),
                "guard-blockable kill causes must not be empty",
            );
        }
    }
    if matches!(
        policy.same_target_witch,
        GuardWitchSameTargetPolicy::KillTarget
    ) {
        match policy.same_target_witch_kill_cause.as_deref() {
            Some(cause) if !cause.trim().is_empty() => {}
            _ => issue(
                issues,
                format!("{path}.same_target_witch_kill_cause"),
                "KillTarget guard/witch same-target policy requires same_target_witch_kill_cause",
            ),
        }
    } else if policy.same_target_witch_kill_cause.is_some() {
        issue(
            issues,
            format!("{path}.same_target_witch_kill_cause"),
            "same_target_witch_kill_cause is only valid with KillTarget policy",
        );
    }
    if !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled guard policy requires Night in phases.cadence",
        );
    }
    if !pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Protect
            && rule.when.target_state.is_none()
            && rule.beats.contains(&IrAbility::Kill)
    }) {
        issue(
            issues,
            format!("{path}.precedence"),
            "enabled guard policy requires a Protect precedence rule that beats Kill",
        );
    }
}

fn validate_faction_action_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &FactionActionPolicy,
    ir_version: u16,
    pack: &Pack,
    alignments: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        if !policy.actions.is_empty() {
            issue(
                issues,
                format!("{path}.actions"),
                "disabled faction action policy must not declare actions",
            );
        }
        return;
    }
    if ir_version < 35 {
        issue(
            issues,
            path,
            "enabled faction action policy requires ir_version >= 35",
        );
    }
    if !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled faction action policy requires Night in phases.cadence",
        );
    }
    if policy.actions.is_empty() {
        issue(
            issues,
            format!("{path}.actions"),
            "enabled faction action policy must declare actions",
        );
    }

    let mut seen_actions = BTreeSet::new();
    for (idx, spec) in policy.actions.iter().enumerate() {
        let spec_path = format!("{path}.actions[{idx}]");
        if spec.action_id.trim().is_empty() {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                "faction action id must not be empty",
            );
            continue;
        }
        if !seen_actions.insert(spec.action_id.as_str()) {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                format!("duplicate faction action `{}`", spec.action_id),
            );
        }
        if spec.alignment.trim().is_empty() {
            issue(
                issues,
                format!("{spec_path}.alignment"),
                "faction action alignment must not be empty",
            );
        } else if !alignments.contains(spec.alignment.as_str()) {
            issue(
                issues,
                format!("{spec_path}.alignment"),
                format!("unknown faction action alignment `{}`", spec.alignment),
            );
        }
        if spec.max_resolved_submissions != 1 {
            issue(
                issues,
                format!("{spec_path}.max_resolved_submissions"),
                "faction action max_resolved_submissions must be 1",
            );
        }

        let matches: Vec<&ActionTemplate> = pack
            .roles
            .values()
            .flat_map(|role| role.actions.iter())
            .filter(|action| action.id == spec.action_id)
            .collect();
        if matches.is_empty() {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                format!("unknown faction action `{}`", spec.action_id),
            );
            continue;
        }
        if !matches.iter().any(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Kill)
        }) {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                format!(
                    "faction action `{}` must be a night/any Kill action",
                    spec.action_id
                ),
            );
        }
        if matches
            .iter()
            .any(|action| action.has_modifier(Modifier::Simultaneous))
        {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                format!(
                    "faction action `{}` must not use Simultaneous",
                    spec.action_id
                ),
            );
        }
        if !matches
            .iter()
            .all(|action| action.targets != TargetSpec::None && action.constraints.max_targets >= 1)
        {
            issue(
                issues,
                format!("{spec_path}.action_id"),
                format!(
                    "faction action `{}` must accept at least one target",
                    spec.action_id
                ),
            );
        }
    }
}

fn validate_standard_nar_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled standard_nar policy requires Night in phases.cadence",
        );
    }
    if !matches!(
        policy.kill_stacking,
        Some(KillStackingPolicy::AggregateAttackers)
    ) {
        issue(
            issues,
            format!("{path}.kill_stacking"),
            "enabled standard_nar policy requires kill_stacking AggregateAttackers",
        );
    }
    if !policy.strongman_bypasses_protect {
        issue(
            issues,
            format!("{path}.strongman_bypasses_protect"),
            "enabled standard_nar policy requires strongman_bypasses_protect true",
        );
    }

    validate_standard_nar_bucket(
        issues,
        path,
        "block_action_ids",
        &policy.block_action_ids,
        pack,
        |action| action.has_ability(IrAbility::Block),
        "Block",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "protect_action_ids",
        &policy.protect_action_ids,
        pack,
        |action| {
            action.has_ability(IrAbility::Protect)
                && !action.has_modifier(Modifier::Bodyguard)
                && !action.has_modifier(Modifier::Martyr)
                && !action.has_modifier(Modifier::Cpr)
        },
        "Protect without Bodyguard/Martyr/Cpr",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "kill_action_ids",
        &policy.kill_action_ids,
        pack,
        |action| {
            action.has_ability(IrAbility::Kill)
                && !action.has_modifier(Modifier::Strongman)
                && !action.has_modifier(Modifier::Cpr)
        },
        "Kill without Strongman/Cpr",
    );
    validate_standard_nar_team_kill_actions(issues, path, policy, pack);
    validate_standard_nar_bucket(
        issues,
        path,
        "bodyguard_action_ids",
        &policy.bodyguard_action_ids,
        pack,
        |action| action.has_ability(IrAbility::Protect) && action.has_modifier(Modifier::Bodyguard),
        "Protect with Bodyguard",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "martyr_action_ids",
        &policy.martyr_action_ids,
        pack,
        |action| action.has_ability(IrAbility::Protect) && action.has_modifier(Modifier::Martyr),
        "Protect with Martyr",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "cpr_action_ids",
        &policy.cpr_action_ids,
        pack,
        |action| {
            action.has_ability(IrAbility::Protect)
                && action.has_ability(IrAbility::Kill)
                && action.has_modifier(Modifier::Cpr)
        },
        "Protect plus Kill with Cpr",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "jailkeep_action_ids",
        &policy.jailkeep_action_ids,
        pack,
        |action| action.has_ability(IrAbility::Block) && action.has_ability(IrAbility::Protect),
        "Block plus Protect",
    );
    validate_standard_nar_bucket(
        issues,
        path,
        "strongman_action_ids",
        &policy.strongman_action_ids,
        pack,
        |action| action.has_ability(IrAbility::Kill) && action.has_modifier(Modifier::Strongman),
        "Kill with Strongman",
    );
    validate_standard_nar_declares_block_protect_actions(issues, path, policy, pack);
    validate_standard_nar_declares_kill_actions(issues, path, policy, pack);
    validate_standard_nar_declares_strongman_actions(issues, path, policy, pack);
    validate_standard_nar_jailkeep_is_explicit_block_and_protect(issues, path, policy);
    validate_standard_nar_kill_cause_catalog(issues, path, policy, pack);
    validate_standard_nar_intercept_cause_policy(issues, path, policy, pack);
    validate_standard_nar_guard_retaliation_cause_policy(issues, path, policy, pack);
    validate_standard_nar_cpr_harm_cause_policy(issues, path, policy, pack);
    validate_standard_nar_guard_dependency_cause_policy(issues, path, policy, pack);
    validate_standard_nar_hide_dependency_cause_policy(issues, path, policy, pack);
    validate_standard_nar_chosen_retaliation_cause_policy(issues, path, policy, pack);
    validate_standard_nar_target_state_save_catalog(issues, path, policy, pack);
    validate_standard_nar_target_state_gate_catalog(issues, path, policy, pack);
    validate_standard_nar_generated_kill_ownership(issues, path, policy, pack);
    validate_standard_nar_target_state_gate_policy(issues, path, policy, pack);
    validate_standard_nar_suppression_precedence(issues, path, policy, pack);
    validate_standard_nar_action_chance_policy(issues, path, policy, pack);
    validate_standard_nar_conflict_families(issues, path, policy, pack);

    if !pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Block
            && rule.when.target_state.is_none()
            && rule.beats.contains(&IrAbility::Protect)
            && rule.beats.contains(&IrAbility::Kill)
    }) {
        issue(
            issues,
            format!("{path}.precedence"),
            "enabled standard_nar policy requires Block precedence over Protect and Kill",
        );
    }
    if !pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Protect
            && rule.when.target_state.is_none()
            && rule.beats.contains(&IrAbility::Kill)
            && rule.blocked_by.contains(&IrAbility::Block)
    }) {
        issue(
            issues,
            format!("{path}.precedence"),
            "enabled standard_nar policy requires Protect beats Kill and is blocked_by Block",
        );
    }
    if !pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Kill
            && rule.when.target_state.is_none()
            && rule.blocked_by.contains(&IrAbility::Block)
            && rule.blocked_by.contains(&IrAbility::Protect)
    }) {
        issue(
            issues,
            format!("{path}.precedence"),
            "enabled standard_nar policy requires Kill blocked_by Block and Protect",
        );
    }
}

fn validate_standard_nar_conflict_families(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.conflict_families");
    if policy.conflict_families.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must declare conflict_families",
        );
        return;
    }
    if pack.ir_version < 44 {
        issue(
            issues,
            path.clone(),
            "standard_nar conflict_families requires ir_version >= 44",
        );
    }

    let mut declared = BTreeSet::new();
    for family in &policy.conflict_families {
        if !declared.insert(*family) {
            issue(
                issues,
                path.clone(),
                format!("duplicate conflict family `{family:?}`"),
            );
        }
    }

    let required = standard_nar_required_conflict_families(policy, pack);
    for family in &required {
        if !declared.contains(family) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar conflict_families must include `{family:?}`"),
            );
        }
    }
    for family in &declared {
        if !required.contains(family) {
            issue(
                issues,
                path.clone(),
                format!("declared conflict family `{family:?}` has no matching policy surface"),
            );
        }
    }
}

fn standard_nar_required_conflict_families(
    policy: &StandardNarPolicy,
    pack: &Pack,
) -> BTreeSet<StandardNarConflictFamily> {
    let mut required = BTreeSet::from([
        StandardNarConflictFamily::BlockSuppressesActions,
        StandardNarConflictFamily::ProtectBlocksKills,
        StandardNarConflictFamily::StrongmanBypassesProtect,
        StandardNarConflictFamily::KillStacking,
    ]);

    if !policy.intercept_cause_policy.is_empty()
        || !policy.bodyguard_action_ids.is_empty()
        || !policy.martyr_action_ids.is_empty()
    {
        required.insert(StandardNarConflictFamily::InterceptProtection);
    }
    if !policy.guard_retaliation_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::GuardRetaliation);
    }
    if !policy.cpr_action_ids.is_empty() || !policy.cpr_harm_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::CprProtection);
    }
    if !policy.guard_dependency_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::GuardDependency);
    }
    if !policy.hide_dependency_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::HideDependency);
    }
    if !policy.chosen_retaliation_cause_policy.is_empty() {
        required.insert(StandardNarConflictFamily::ChosenRetaliation);
    }
    if !policy.generated_kill_cause_policy.is_empty() || !policy.trigger_fixpoint_policy.is_empty()
    {
        required.insert(StandardNarConflictFamily::GeneratedKillReentry);
    }
    if !standard_nar_target_state_save_tags(pack).is_empty() {
        required.insert(StandardNarConflictFamily::TargetStateSave);
    }
    if !standard_nar_target_state_gate_tags(pack).is_empty() {
        required.insert(StandardNarConflictFamily::TargetStateGate);
    }
    if !policy.action_chance.is_empty() {
        required.insert(StandardNarConflictFamily::ActionChance);
    }

    required
}

fn validate_standard_nar_action_chance_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.action_chance");
    if policy.action_chance.is_empty() {
        return;
    }
    if pack.ir_version < 43 {
        issue(
            issues,
            path.clone(),
            "standard_nar action_chance requires ir_version >= 43",
        );
    }

    for (action_id, chance_policy) in &policy.action_chance {
        let action_path = format!("{path}.{action_id}");
        if action_id.trim().is_empty() {
            issue(issues, path.clone(), "action_chance id must not be empty");
            continue;
        }
        let matches = standard_nar_pack_actions(pack)
            .into_iter()
            .map(|(_, action)| action)
            .filter(|action| action.id == action_id.as_str())
            .collect::<Vec<_>>();
        if matches.is_empty() {
            issue(
                issues,
                action_path.clone(),
                format!("unknown standard_nar action `{action_id}`"),
            );
        } else if !matches
            .iter()
            .any(|action| action.window.is_night_resolution_window())
        {
            issue(
                issues,
                action_path.clone(),
                format!("standard_nar action `{action_id}` must be a night/any action"),
            );
        }
        if !chance_policy.chance.is_finite() || !(0.0..=1.0).contains(&chance_policy.chance) {
            issue(
                issues,
                format!("{action_path}.chance"),
                "action chance must be finite and between 0.0 and 1.0",
            );
        }
    }
}

fn validate_role(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    role: &Role,
    standard_nar: &StandardNarPolicy,
) {
    validate_unique_role_modifiers(issues, format!("{path}.modifiers"), &role.modifiers);

    let team_kill_restricted =
        role.has_modifier(RoleModifier::Lost) || role.has_modifier(RoleModifier::Recluse);
    if team_kill_restricted {
        if role.alignment.as_deref() != Some("mafia") {
            issue(
                issues,
                format!("{path}.alignment"),
                "team-kill restricted role modifiers require mafia alignment",
            );
        }
        if standard_nar.team_kill_action_ids.is_empty() {
            issue(
                issues,
                "standard_nar.team_kill_action_ids",
                "team-kill restricted role modifiers require standard_nar.team_kill_action_ids",
            );
        } else if !role.actions.iter().any(|action| {
            standard_nar
                .team_kill_action_ids
                .iter()
                .any(|team_kill| team_kill == &action.id)
        }) {
            issue(
                issues,
                path,
                "team-kill restricted role modifiers must expose a standard_nar team kill action",
            );
        }
    }
}

fn validate_unique_role_modifiers(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    modifiers: &[RoleModifier],
) {
    let path = path.into();
    let mut seen = BTreeSet::new();
    for modifier in modifiers {
        if !seen.insert(*modifier) {
            issue(
                issues,
                path.clone(),
                format!("duplicate role modifier `{modifier:?}`"),
            );
        }
    }
}

fn validate_standard_nar_team_kill_actions(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.team_kill_action_ids");
    validate_unique_strings(issues, path.clone(), &policy.team_kill_action_ids);
    for action_id in &policy.team_kill_action_ids {
        if action_id.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                "team_kill_action_ids id must not be empty",
            );
            continue;
        }
        if !policy
            .kill_action_ids
            .iter()
            .any(|kill_id| kill_id == action_id)
        {
            issue(
                issues,
                path.clone(),
                format!("team kill action `{action_id}` must also be declared in kill_action_ids"),
            );
        }
        let matches: Vec<&ActionTemplate> = standard_nar_pack_actions(pack)
            .into_iter()
            .map(|(_, action)| action)
            .filter(|action| action.id == action_id.as_str())
            .collect();
        if matches.is_empty() {
            issue(
                issues,
                path.clone(),
                format!("unknown standard_nar team kill action `{action_id}`"),
            );
            continue;
        }
        if !matches.iter().any(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Kill)
        }) {
            issue(
                issues,
                path.clone(),
                format!(
                    "standard_nar team kill action `{action_id}` must be a night/any Kill action"
                ),
            );
        }
    }
}

fn validate_standard_nar_suppression_precedence(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let priorities = night_ability_priorities(pack);
    if !priorities.contains_key(&IrAbility::Block) {
        return;
    }
    let abilities: BTreeSet<IrAbility> = priorities.keys().copied().collect();
    let edges = precedence_edges(pack, &abilities);
    let action_abilities = standard_nar_night_action_abilities(pack);
    let mut required = BTreeSet::new();

    for source_id in standard_nar_block_source_ids(policy) {
        let Some(suppression) = policy.suppression_policy.get(&source_id) else {
            continue;
        };
        for action_id in &suppression.suppresses {
            let Some(suppressed_abilities) = action_abilities.get(action_id) else {
                continue;
            };
            for ability in suppressed_abilities {
                if *ability != IrAbility::Block {
                    required.insert(*ability);
                }
            }
        }
    }

    for ability in required {
        if priorities.contains_key(&ability) && !has_path(IrAbility::Block, ability, &edges) {
            issue(
                issues,
                format!("{policy_path}.precedence"),
                format!(
                    "standard_nar suppression policy requires Block precedence before suppressed ability `{ability:?}`"
                ),
            );
        }
    }
}

fn validate_standard_nar_suppression_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.suppression_policy");
    let block_sources = standard_nar_block_source_ids(policy);
    let action_roleblockability = standard_nar_night_action_roleblockability(issues, pack);
    let generated_trigger_feeds = standard_nar_generated_trigger_feed_actions(pack);

    if policy.suppression_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify roleblock suppression",
        );
    }

    for source_id in &block_sources {
        if !policy.suppression_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar Block action `{source_id}` must classify every night action"),
            );
        }
    }

    for (source_id, suppression) in &policy.suppression_policy {
        let source_path = format!("{path}.{source_id}");
        if source_id.trim().is_empty() {
            issue(issues, path.clone(), "block source id must not be empty");
            continue;
        }
        if !block_sources.contains(source_id) {
            issue(
                issues,
                source_path.clone(),
                format!("unknown standard_nar block source `{source_id}`"),
            );
        }
        if suppression.scope.is_none() {
            issue(
                issues,
                format!("{source_path}.scope"),
                "standard_nar suppression policy must declare scope",
            );
        }

        validate_unique_strings(
            issues,
            format!("{source_path}.suppresses"),
            &suppression.suppresses,
        );
        validate_unique_strings(
            issues,
            format!("{source_path}.bypasses"),
            &suppression.bypasses,
        );

        let mut classified = BTreeSet::new();
        for action_id in &suppression.suppresses {
            validate_standard_nar_suppression_action(
                issues,
                format!("{source_path}.suppresses"),
                action_id,
                &action_roleblockability,
            );
            if suppression.scope == Some(SuppressionScope::FirstMatchingAction)
                && action_roleblockability
                    .get(action_id)
                    .is_some_and(|action| !action.roleblockable || action.strong_willed)
            {
                issue(
                    issues,
                    format!("{source_path}.suppresses"),
                    format!(
                        "suppression-immune action `{action_id}` must be classified in bypasses"
                    ),
                );
            }
            classified.insert(action_id.as_str());
        }
        for action_id in &suppression.bypasses {
            validate_standard_nar_suppression_action(
                issues,
                format!("{source_path}.bypasses"),
                action_id,
                &action_roleblockability,
            );
            if suppression.scope == Some(SuppressionScope::FirstMatchingAction)
                && action_roleblockability
                    .get(action_id)
                    .is_some_and(|action| action.roleblockable && !action.strong_willed)
            {
                issue(
                    issues,
                    format!("{source_path}.bypasses"),
                    format!("roleblockable action `{action_id}` must be classified in suppresses"),
                );
            }
            if classified.contains(action_id.as_str()) {
                issue(
                    issues,
                    source_path.clone(),
                    format!("night action `{action_id}` cannot be both suppressed and bypassed"),
                );
            }
            classified.insert(action_id.as_str());
        }
        for action_id in action_roleblockability.keys() {
            if !classified.contains(action_id.as_str()) {
                issue(
                    issues,
                    source_path.clone(),
                    format!(
                        "block source `{source_id}` does not classify night action `{action_id}`"
                    ),
                );
                if let Some(trigger_ids) = generated_trigger_feeds.get(action_id) {
                    for trigger_id in trigger_ids {
                        issue(
                            issues,
                            source_path.clone(),
                            format!(
                                "block source `{source_id}` does not classify night action `{action_id}` that can feed generated kill trigger `{trigger_id}`"
                            ),
                        );
                    }
                }
            }
        }
    }
}

fn standard_nar_generated_trigger_feed_actions(pack: &Pack) -> BTreeMap<String, BTreeSet<String>> {
    let generated_triggers = standard_nar_generated_kill_source_ids(pack);
    let mut feeds: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for (_, action) in standard_nar_pack_actions(pack) {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        for (trigger_id, trigger) in &generated_triggers {
            if action_can_feed_trigger(action, trigger.on) {
                feeds
                    .entry(action.id.clone())
                    .or_default()
                    .insert(trigger_id.clone());
            }
        }
    }
    feeds
}

fn action_can_feed_trigger(action: &ActionTemplate, on: TriggerOn) -> bool {
    match on {
        TriggerOn::Ability(IrAbility::Visit) => action.targets != TargetSpec::None,
        TriggerOn::Ability(ability) => action
            .abilities()
            .any(|action_ability| action_ability == ability),
        TriggerOn::Event(TriggerEvent::Death) => {
            action.has_ability(IrAbility::Kill) || action.has_ability(IrAbility::Retaliate)
        }
        TriggerOn::Event(TriggerEvent::EffectMarked) => action.has_ability(IrAbility::Mark),
        TriggerOn::Event(TriggerEvent::Lynch | TriggerEvent::PhaseEnd | TriggerEvent::Win) => false,
        TriggerOn::Event(TriggerEvent::Visit) => action.targets != TargetSpec::None,
    }
}

fn standard_nar_night_action_abilities(pack: &Pack) -> BTreeMap<String, BTreeSet<IrAbility>> {
    let mut actions = BTreeMap::new();
    for (_, action) in standard_nar_pack_actions(pack) {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        let entry = actions
            .entry(action.id.clone())
            .or_insert_with(BTreeSet::new);
        entry.extend(night_order_abilities(action));
    }
    actions
}

fn standard_nar_block_source_ids(policy: &StandardNarPolicy) -> BTreeSet<String> {
    policy
        .block_action_ids
        .iter()
        .chain(policy.jailkeep_action_ids.iter())
        .cloned()
        .collect()
}

#[derive(Debug, Clone, Copy)]
struct StandardNarNightAction {
    roleblockable: bool,
    strong_willed: bool,
}

fn standard_nar_night_action_roleblockability(
    issues: &mut Vec<PackValidationIssue>,
    pack: &Pack,
) -> BTreeMap<String, StandardNarNightAction> {
    let mut actions = BTreeMap::new();
    for (role_key, role) in &pack.roles {
        for action in &role.actions {
            if !action.window.is_night_resolution_window() {
                continue;
            }
            record_standard_nar_action_roleblockability(
                issues,
                &mut actions,
                &action.id,
                action.constraints.roleblockable,
                action.has_modifier(Modifier::StrongWilled),
                format!("roles.{role_key}.actions.{}", action.id),
            );
        }
    }
    for (grant_id, action) in &pack.item_actions {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        record_standard_nar_action_roleblockability(
            issues,
            &mut actions,
            &action.id,
            action.constraints.roleblockable,
            action.has_modifier(Modifier::StrongWilled),
            format!("item_actions.{grant_id}"),
        );
    }
    actions
}

fn record_standard_nar_action_roleblockability(
    issues: &mut Vec<PackValidationIssue>,
    actions: &mut BTreeMap<String, StandardNarNightAction>,
    action_id: &str,
    roleblockable: bool,
    strong_willed: bool,
    path: String,
) {
    let record = StandardNarNightAction {
        roleblockable,
        strong_willed,
    };
    if let Some(existing) = actions.insert(action_id.to_string(), record) {
        if existing.roleblockable != roleblockable || existing.strong_willed != strong_willed {
            issue(
                issues,
                path,
                format!(
                    "night action `{action_id}` has inconsistent standard_nar suppression traits"
                ),
            );
        }
    }
}

fn validate_standard_nar_suppression_action(
    issues: &mut Vec<PackValidationIssue>,
    path: String,
    action_id: &str,
    action_roleblockability: &BTreeMap<String, StandardNarNightAction>,
) {
    if action_id.trim().is_empty() {
        issue(issues, path, "night action id must not be empty");
        return;
    }
    if !action_roleblockability.contains_key(action_id) {
        issue(
            issues,
            path,
            format!("unknown standard_nar night action `{action_id}`"),
        );
    }
}

fn validate_standard_nar_kill_cause_catalog(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.kill_cause_ids");
    let expected = standard_nar_derived_kill_cause_ids(pack);

    if policy.kill_cause_ids.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must declare kill_cause_ids",
        );
    }
    validate_unique_strings(issues, path.clone(), &policy.kill_cause_ids);

    let declared = policy
        .kill_cause_ids
        .iter()
        .filter_map(|cause| {
            if cause.trim().is_empty() {
                issue(
                    issues,
                    path.clone(),
                    "standard_nar kill cause id must not be empty",
                );
                None
            } else {
                Some(cause.as_str())
            }
        })
        .collect::<BTreeSet<_>>();

    for cause in &declared {
        if !expected.contains(*cause) {
            issue(
                issues,
                path.clone(),
                format!("unknown standard_nar kill cause `{cause}`"),
            );
        }
    }
    for cause in expected {
        if !declared.contains(cause.as_str()) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar kill_cause_ids must include `{cause}`"),
            );
        }
    }
}

fn validate_standard_nar_protection_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.protection_cause_policy");
    let protect_sources = standard_nar_protect_source_ids(policy);
    let kill_causes = standard_nar_kill_cause_ids(pack);
    let unstoppable_causes = standard_nar_unstoppable_cause_ids(policy, pack);
    let generated_kill_causes = standard_nar_generated_kill_cause_ids(pack);

    if policy.protection_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify protection causes",
        );
    }

    for source_id in &protect_sources {
        if !policy.protection_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar Protect action `{source_id}` must classify every kill cause"),
            );
        }
    }

    for (source_id, cause_policy) in &policy.protection_cause_policy {
        let source_path = format!("{path}.{source_id}");
        if source_id.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                "protection source id must not be empty",
            );
            continue;
        }
        if !protect_sources.contains(source_id) {
            issue(
                issues,
                source_path.clone(),
                format!("unknown standard_nar protection source `{source_id}`"),
            );
        }

        validate_unique_strings(
            issues,
            format!("{source_path}.blocks"),
            &cause_policy.blocks,
        );
        validate_unique_strings(
            issues,
            format!("{source_path}.bypasses"),
            &cause_policy.bypasses,
        );

        let mut classified = BTreeSet::new();
        for cause in &cause_policy.blocks {
            validate_standard_nar_protection_cause(
                issues,
                format!("{source_path}.blocks"),
                cause,
                &kill_causes,
            );
            if unstoppable_causes.contains(cause) {
                issue(
                    issues,
                    format!("{source_path}.blocks"),
                    format!("strongman bypass cause `{cause}` must be classified in bypasses"),
                );
            }
            classified.insert(cause.as_str());
        }
        for cause in &cause_policy.bypasses {
            validate_standard_nar_protection_cause(
                issues,
                format!("{source_path}.bypasses"),
                cause,
                &kill_causes,
            );
            if !unstoppable_causes.contains(cause) {
                issue(
                    issues,
                    format!("{source_path}.bypasses"),
                    format!("bypassed kill cause `{cause}` must be a Strongman bypass cause"),
                );
            }
            if classified.contains(cause.as_str()) {
                issue(
                    issues,
                    source_path.clone(),
                    format!("kill cause `{cause}` cannot be both blocked and bypassed"),
                );
            }
            classified.insert(cause.as_str());
        }
        for cause in &kill_causes {
            if !classified.contains(cause.as_str()) {
                issue(
                    issues,
                    source_path.clone(),
                    format!(
                        "protection source `{source_id}` does not classify kill cause `{cause}`"
                    ),
                );
                issue_generated_kill_classifier_gap(
                    issues,
                    source_path.clone(),
                    &generated_kill_causes,
                    cause,
                    format!(
                        "protection source `{source_id}` must classify generated kill trigger `{cause}`"
                    ),
                );
            }
        }
    }
}

fn validate_standard_nar_target_state_save_catalog(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.target_state_save_tags");
    validate_standard_nar_target_state_catalog(
        issues,
        path,
        &policy.target_state_save_tags,
        standard_nar_derived_target_state_save_tags(pack),
        "save",
    );
}

fn validate_standard_nar_target_state_gate_catalog(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.target_state_gate_tags");
    validate_standard_nar_target_state_catalog(
        issues,
        path,
        &policy.target_state_gate_tags,
        standard_nar_derived_target_state_gate_tags(pack),
        "gate",
    );
}

fn validate_standard_nar_target_state_catalog(
    issues: &mut Vec<PackValidationIssue>,
    path: String,
    declared_tags: &[String],
    expected_tags: BTreeSet<String>,
    label: &str,
) {
    if !expected_tags.is_empty() && declared_tags.is_empty() {
        issue(
            issues,
            path.clone(),
            format!("enabled standard_nar policy must declare target-state {label} tags"),
        );
    }
    validate_unique_strings(issues, path.clone(), declared_tags);

    let declared = declared_tags
        .iter()
        .filter_map(|tag| {
            if tag.trim().is_empty() {
                issue(
                    issues,
                    path.clone(),
                    format!("standard_nar target-state {label} tag must not be empty"),
                );
                None
            } else {
                Some(tag.as_str())
            }
        })
        .collect::<BTreeSet<_>>();

    for tag in &declared {
        if !expected_tags.contains(*tag) {
            issue(
                issues,
                path.clone(),
                format!("unknown standard_nar target-state {label} tag `{tag}`"),
            );
        }
    }
    for tag in expected_tags {
        if !declared.contains(tag.as_str()) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar target_state_{label}_tags must include `{tag}`"),
            );
        }
    }
}

fn validate_standard_nar_target_state_save_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.target_state_save_policy");
    let save_tags = standard_nar_target_state_save_tags(pack);
    let kill_causes = standard_nar_kill_cause_ids(pack);
    let unstoppable_causes = standard_nar_unstoppable_cause_ids(policy, pack);
    let generated_kill_causes = standard_nar_generated_kill_cause_ids(pack);

    if !save_tags.is_empty() && policy.target_state_save_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify target-state saves",
        );
    }

    for tag in &save_tags {
        if !policy.target_state_save_policy.contains_key(tag) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar target-state save `{tag}` must classify every kill cause"),
            );
        }
    }

    for (tag, save_policy) in &policy.target_state_save_policy {
        let tag_path = format!("{path}.{tag}");
        if tag.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                "target-state save tag must not be empty",
            );
            continue;
        }
        if !save_tags.contains(tag) {
            issue(
                issues,
                tag_path.clone(),
                format!("unknown standard_nar target-state save `{tag}`"),
            );
        }

        validate_unique_strings(issues, format!("{tag_path}.blocks"), &save_policy.blocks);
        validate_unique_strings(
            issues,
            format!("{tag_path}.bypasses"),
            &save_policy.bypasses,
        );

        let mut classified = BTreeSet::new();
        for cause in &save_policy.blocks {
            validate_standard_nar_protection_cause(
                issues,
                format!("{tag_path}.blocks"),
                cause,
                &kill_causes,
            );
            if unstoppable_causes.contains(cause) {
                issue(
                    issues,
                    format!("{tag_path}.blocks"),
                    format!("strongman bypass cause `{cause}` must be classified in bypasses"),
                );
            }
            classified.insert(cause.as_str());
        }
        for cause in &save_policy.bypasses {
            validate_standard_nar_protection_cause(
                issues,
                format!("{tag_path}.bypasses"),
                cause,
                &kill_causes,
            );
            if !unstoppable_causes.contains(cause) {
                issue(
                    issues,
                    format!("{tag_path}.bypasses"),
                    format!("bypassed kill cause `{cause}` must be a Strongman bypass cause"),
                );
            }
            if classified.contains(cause.as_str()) {
                issue(
                    issues,
                    tag_path.clone(),
                    format!("kill cause `{cause}` cannot be both blocked and bypassed"),
                );
            }
            classified.insert(cause.as_str());
        }
        for cause in &kill_causes {
            if !classified.contains(cause.as_str()) {
                issue(
                    issues,
                    tag_path.clone(),
                    format!("target-state save `{tag}` does not classify kill cause `{cause}`"),
                );
                issue_generated_kill_classifier_gap(
                    issues,
                    tag_path.clone(),
                    &generated_kill_causes,
                    cause,
                    format!(
                        "target-state save `{tag}` must classify generated kill trigger `{cause}`"
                    ),
                );
            }
        }
    }
}

fn issue_generated_kill_classifier_gap(
    issues: &mut Vec<PackValidationIssue>,
    path: String,
    generated_kill_causes: &BTreeSet<String>,
    cause: &str,
    message: String,
) {
    if generated_kill_causes.contains(cause) {
        issue(issues, path, message);
    }
}

fn validate_standard_nar_target_state_gate_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.target_state_gate_policy");
    let gate_tags = standard_nar_target_state_gate_tags(pack);

    if !gate_tags.is_empty() && policy.target_state_gate_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify target-state gates",
        );
    }

    for tag in &gate_tags {
        if !policy.target_state_gate_policy.contains_key(tag) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar target-state gate `{tag}` must classify blocked abilities"),
            );
        }
    }

    for (tag, gate_policy) in &policy.target_state_gate_policy {
        let tag_path = format!("{path}.{tag}");
        if tag.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                "target-state gate tag must not be empty",
            );
            continue;
        }
        if !gate_tags.contains(tag) {
            issue(
                issues,
                tag_path.clone(),
                format!("unknown standard_nar target-state gate `{tag}`"),
            );
        }
        if gate_policy.blocks.is_empty() {
            issue(
                issues,
                format!("{tag_path}.blocks"),
                "target-state gate policy must declare blocked abilities",
            );
        }
        let mut seen = BTreeSet::new();
        for ability in &gate_policy.blocks {
            if !seen.insert(*ability) {
                issue(
                    issues,
                    format!("{tag_path}.blocks"),
                    format!("duplicate blocked ability `{ability:?}`"),
                );
            }
            if !matches!(
                ability,
                IrAbility::Kill
                    | IrAbility::Protect
                    | IrAbility::Investigate
                    | IrAbility::Convert
                    | IrAbility::Mark
            ) {
                issue(
                    issues,
                    format!("{tag_path}.blocks"),
                    format!(
                        "target-state gates only support Kill, Protect, Investigate, Convert, or Mark, got `{ability:?}`"
                    ),
                );
            }
        }
    }
}

fn validate_lynch_trigger_contracts(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let mut has_super_saint_effect = false;

    for role in pack.roles.values() {
        for effect in &role.effects {
            if effect == "super_saint" {
                has_super_saint_effect = true;
            }
        }
    }

    if pack.effects.contains_key("super_saint") {
        has_super_saint_effect = true;
    }

    if has_super_saint_effect
        && !has_lynch_retaliation_trigger(pack, "super_saint", TargetRef::Actor)
    {
        issue(
            issues,
            "triggers",
            "super_saint effects require a Lynch trigger that produces Kill from Target to Actor",
        );
    }
}

fn validate_trigger_identity_and_filters(
    issues: &mut Vec<PackValidationIssue>,
    pack: &Pack,
    effect_tags: &BTreeSet<&str>,
) {
    let mut trigger_ids = BTreeSet::new();
    for (idx, trigger) in pack.triggers.iter().enumerate() {
        let path = format!("triggers[{idx}]");
        if trigger.id.trim().is_empty() {
            issue(issues, format!("{path}.id"), "trigger id must not be empty");
        } else if !trigger_ids.insert(trigger.id.as_str()) {
            issue(
                issues,
                format!("{path}.id"),
                format!("duplicate trigger id `{}`", trigger.id),
            );
        }

        validate_trigger_filter_tags(
            issues,
            &path,
            "if_target_has",
            &trigger.if_target_has,
            effect_tags,
        );
        validate_trigger_filter_tags(
            issues,
            &path,
            "if_actor_has",
            &trigger.if_actor_has,
            effect_tags,
        );
    }
}

fn validate_trigger_filter_tags(
    issues: &mut Vec<PackValidationIssue>,
    trigger_path: &str,
    field: &str,
    tags: &[String],
    effect_tags: &BTreeSet<&str>,
) {
    let path = format!("{trigger_path}.{field}");
    validate_unique_strings(issues, path.clone(), tags);
    for tag in tags {
        if tag.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                "trigger filter tags must not be empty",
            );
            continue;
        }
        if !effect_tags.contains(tag.as_str()) {
            issue(issues, path.clone(), format!("unknown effect tag `{tag}`"));
        }
    }
}

fn validate_trigger_production_shapes(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    for (idx, trigger) in pack.triggers.iter().enumerate() {
        let path = format!("triggers[{idx}].produces");
        if matches!(
            trigger.produces.actor,
            ActorRef::TargetGuard | ActorRef::Other
        ) {
            issue(
                issues,
                format!("{path}.actor"),
                "trigger productions only support Actor or Target actor refs",
            );
        }
        if matches!(trigger.produces.target, TargetRef::Other) {
            issue(
                issues,
                format!("{path}.target"),
                "trigger productions only support Actor, Target, or Killer target refs",
            );
        }
        match trigger.produces.ability {
            IrAbility::Kill => {
                let mut seen_modifiers = BTreeSet::new();
                for modifier in &trigger.produces.modifiers {
                    if !seen_modifiers.insert(*modifier) {
                        issue(
                            issues,
                            format!("{path}.modifiers"),
                            format!("duplicate generated Kill modifier `{modifier:?}`"),
                        );
                    }
                    if *modifier != Modifier::Strongman {
                        issue(
                            issues,
                            format!("{path}.modifiers"),
                            format!(
                                "generated Kill triggers only support Strongman modifier, got `{modifier:?}`"
                            ),
                        );
                    }
                }
            }
            IrAbility::Visit => {
                if trigger.produces.actor != ActorRef::Target {
                    issue(
                        issues,
                        format!("{path}.actor"),
                        "generated Visit triggers must use actor Target",
                    );
                }
                if trigger.produces.target != TargetRef::Target {
                    issue(
                        issues,
                        format!("{path}.target"),
                        "generated Visit triggers must use target Target",
                    );
                }
                if !trigger.produces.modifiers.is_empty() {
                    issue(
                        issues,
                        format!("{path}.modifiers"),
                        "generated Visit triggers must not declare modifiers",
                    );
                }
            }
            _ => {
                issue(
                    issues,
                    format!("{path}.ability"),
                    "trigger productions currently support generated Kill or self-targeted Visit",
                );
            }
        }
    }
}

fn has_lynch_retaliation_trigger(pack: &Pack, effect: &str, target: TargetRef) -> bool {
    pack.triggers.iter().any(|trigger| {
        trigger_on_is_lynch(trigger.on)
            && trigger.if_target_has.iter().any(|tag| tag == effect)
            && trigger.produces.ability == IrAbility::Kill
            && trigger.produces.actor == ActorRef::Target
            && trigger.produces.target == target
    })
}

fn trigger_on_is_lynch(on: TriggerOn) -> bool {
    matches!(on, TriggerOn::Event(TriggerEvent::Lynch))
}

fn validate_kill_trigger_contracts(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let mut has_bomb_effect = false;
    let mut has_hero_effect = false;
    let mut has_vengeful_effect = false;
    let mut has_unstoppable_vengeful_effect = false;

    for role in pack.roles.values() {
        for effect in &role.effects {
            match effect.as_str() {
                "bomb" => has_bomb_effect = true,
                "hero" => has_hero_effect = true,
                "vengeful" => has_vengeful_effect = true,
                "unstoppable_vengeful" => has_unstoppable_vengeful_effect = true,
                _ => {}
            }
        }
    }

    if pack.effects.contains_key("bomb") {
        has_bomb_effect = true;
    }
    if pack.effects.contains_key("hero") {
        has_hero_effect = true;
    }
    if pack.effects.contains_key("vengeful") {
        has_vengeful_effect = true;
    }
    if pack.effects.contains_key("unstoppable_vengeful") {
        has_unstoppable_vengeful_effect = true;
    }

    if has_bomb_effect && !has_kill_retaliation_trigger(pack, "bomb", TargetRef::Killer, false) {
        issue(
            issues,
            "triggers",
            "bomb effects require a Kill trigger that produces Kill from Target to Killer",
        );
    }

    if has_vengeful_effect
        && !has_kill_retaliation_trigger(pack, "vengeful", TargetRef::Actor, false)
    {
        issue(
            issues,
            "triggers",
            "vengeful effects require a Kill trigger that produces Kill from Target to Actor",
        );
    }

    if has_unstoppable_vengeful_effect
        && !has_kill_retaliation_trigger(pack, "unstoppable_vengeful", TargetRef::Actor, true)
    {
        issue(
            issues,
            "triggers",
            "unstoppable_vengeful effects require a Kill trigger that produces Strongman Kill from Target to Actor",
        );
    }

    if has_hero_effect
        && !has_ability_retaliation_trigger(
            pack,
            "hero",
            IrAbility::VoteDuel,
            TargetRef::Actor,
            true,
        )
    {
        issue(
            issues,
            "triggers",
            "hero effects require a VoteDuel trigger that produces Strongman Kill from Target to Actor",
        );
    }
}

fn has_kill_retaliation_trigger(
    pack: &Pack,
    effect: &str,
    target: TargetRef,
    requires_strongman: bool,
) -> bool {
    pack.triggers.iter().any(|trigger| {
        trigger_on_is_kill(trigger.on)
            && trigger.if_target_has.iter().any(|tag| tag == effect)
            && trigger.produces.ability == IrAbility::Kill
            && trigger.produces.actor == ActorRef::Target
            && trigger.produces.target == target
            && (!requires_strongman || trigger.produces.modifiers.contains(&Modifier::Strongman))
    })
}

fn has_ability_retaliation_trigger(
    pack: &Pack,
    effect: &str,
    on_ability: IrAbility,
    target: TargetRef,
    requires_strongman: bool,
) -> bool {
    pack.triggers.iter().any(|trigger| {
        trigger.on == TriggerOn::Ability(on_ability)
            && trigger.if_target_has.iter().any(|tag| tag == effect)
            && trigger.produces.ability == IrAbility::Kill
            && trigger.produces.actor == ActorRef::Target
            && trigger.produces.target == target
            && (!requires_strongman || trigger.produces.modifiers.contains(&Modifier::Strongman))
    })
}

fn trigger_on_is_kill(on: TriggerOn) -> bool {
    matches!(on, TriggerOn::Ability(IrAbility::Kill))
}

fn validate_visit_trigger_contracts(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let mut has_pgo_effect = false;
    let mut has_visitor_kill_effect = false;

    for role in pack.roles.values() {
        for effect in &role.effects {
            match effect.as_str() {
                "pgo" => has_pgo_effect = true,
                "visitor_kill" => has_visitor_kill_effect = true,
                _ => {}
            }
        }
    }

    if pack.effects.contains_key("pgo") {
        has_pgo_effect = true;
    }
    if pack.effects.contains_key("visitor_kill") {
        has_visitor_kill_effect = true;
    }

    if has_pgo_effect && pack.ir_version < 24 {
        issue(
            issues,
            "triggers",
            "pgo visit-trigger effects require ir_version >= 24",
        );
    }

    if has_pgo_effect && !has_pgo_visit_kill_trigger(pack) {
        issue(
            issues,
            "triggers",
            "pgo effects require a Visit trigger that produces Kill from Target to Actor",
        );
    }

    if has_visitor_kill_effect && pack.ir_version < 24 {
        issue(
            issues,
            "triggers",
            "visitor_kill visit-trigger effects require ir_version >= 24",
        );
    }

    if has_visitor_kill_effect && !has_visitor_kill_trigger(pack) {
        issue(
            issues,
            "triggers",
            "visitor_kill effects require a target-filtered Visit trigger with if_target_has visitor_kill, non-empty if_actor_has, and Kill from Target to Actor",
        );
    }
}

fn has_pgo_visit_kill_trigger(pack: &Pack) -> bool {
    pack.triggers.iter().any(|trigger| {
        trigger_on_is_visit(trigger.on)
            && trigger.if_target_has.iter().any(|tag| tag == "pgo")
            && trigger.produces.ability == IrAbility::Kill
            && trigger.produces.actor == ActorRef::Target
            && trigger.produces.target == TargetRef::Actor
    })
}

fn has_visitor_kill_trigger(pack: &Pack) -> bool {
    pack.triggers.iter().any(|trigger| {
        trigger_on_is_visit(trigger.on)
            && trigger
                .if_target_has
                .iter()
                .any(|tag| tag == "visitor_kill")
            && !trigger.if_actor_has.is_empty()
            && trigger.produces.ability == IrAbility::Kill
            && trigger.produces.actor == ActorRef::Target
            && trigger.produces.target == TargetRef::Actor
    })
}

fn trigger_on_is_visit(on: TriggerOn) -> bool {
    matches!(
        on,
        TriggerOn::Ability(IrAbility::Visit) | TriggerOn::Event(TriggerEvent::Visit)
    )
}

fn standard_nar_protect_source_ids(policy: &StandardNarPolicy) -> BTreeSet<String> {
    policy
        .protect_action_ids
        .iter()
        .chain(policy.bodyguard_action_ids.iter())
        .chain(policy.martyr_action_ids.iter())
        .chain(policy.cpr_action_ids.iter())
        .chain(policy.jailkeep_action_ids.iter())
        .cloned()
        .collect()
}

fn standard_nar_intercept_source_ids(policy: &StandardNarPolicy) -> BTreeSet<String> {
    policy
        .bodyguard_action_ids
        .iter()
        .chain(policy.martyr_action_ids.iter())
        .cloned()
        .collect()
}

fn standard_nar_guard_retaliation_source_ids(policy: &StandardNarPolicy) -> BTreeSet<String> {
    policy
        .guard_retaliation_cause_policy
        .keys()
        .cloned()
        .collect()
}

fn standard_nar_guard_dependency_source_ids(pack: &Pack) -> BTreeSet<String> {
    standard_nar_pack_actions(pack)
        .into_iter()
        .map(|(_, action)| action)
        .filter(|action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Protect)
                && action.has_modifier(Modifier::Babysitter)
        })
        .map(|action| action.id.clone())
        .collect()
}

fn standard_nar_hide_dependency_source_ids(pack: &Pack) -> BTreeSet<String> {
    standard_nar_pack_actions(pack)
        .into_iter()
        .map(|(_, action)| action)
        .filter(|action| {
            action.window.is_night_resolution_window()
                && action.has_ability(IrAbility::Mark)
                && action.has_modifier(Modifier::Hider)
        })
        .map(|action| action.id.clone())
        .collect()
}

fn standard_nar_chosen_retaliation_source_ids(pack: &Pack) -> BTreeMap<String, &ActionTemplate> {
    standard_nar_pack_actions(pack)
        .into_iter()
        .map(|(_, action)| action)
        .filter(|action| {
            action.window.is_night_resolution_window() && action.has_ability(IrAbility::Retaliate)
        })
        .map(|action| (action.id.clone(), action))
        .collect()
}

fn standard_nar_generated_kill_source_ids(pack: &Pack) -> BTreeMap<String, &TriggerRule> {
    pack.triggers
        .iter()
        .filter(|trigger| trigger.produces.ability == IrAbility::Kill)
        .map(|trigger| (trigger.id.clone(), trigger))
        .collect()
}

fn standard_nar_generated_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
    standard_nar_generated_kill_source_ids(pack)
        .into_keys()
        .collect()
}

fn standard_nar_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
    if pack.standard_nar.enabled {
        return pack.standard_nar.kill_cause_ids.iter().cloned().collect();
    }
    standard_nar_derived_kill_cause_ids(pack)
}

fn standard_nar_derived_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
    let mut causes = BTreeSet::new();
    for (_, action) in standard_nar_pack_actions(pack) {
        if action.window.is_night_resolution_window()
            && (action.has_ability(IrAbility::Kill) || action.has_ability(IrAbility::Retaliate))
            && !pack
                .standard_nar
                .cpr_action_ids
                .iter()
                .any(|action_id| action_id == &action.id)
        {
            causes.insert(action.id.clone());
        }
    }
    for trigger in &pack.triggers {
        if trigger.produces.ability == IrAbility::Kill {
            causes.insert(trigger.id.clone());
        }
    }
    causes.extend(
        pack.standard_nar
            .guard_retaliation_cause_policy
            .values()
            .cloned(),
    );
    causes
}

fn standard_nar_unstoppable_cause_ids(
    policy: &StandardNarPolicy,
    _pack: &Pack,
) -> BTreeSet<String> {
    let mut causes = policy
        .strongman_action_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    causes.extend(
        policy
            .chosen_retaliation_cause_policy
            .iter()
            .filter(|(_, generated)| generated.strongman_bypasses_protect)
            .map(|(cause, _)| cause.clone()),
    );
    causes.extend(
        policy
            .generated_kill_cause_policy
            .iter()
            .filter(|(_, generated)| generated.strongman_bypasses_protect)
            .map(|(cause, _)| cause.clone()),
    );
    causes
}

fn standard_nar_target_state_save_tags(pack: &Pack) -> BTreeSet<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .target_state_save_tags
            .iter()
            .cloned()
            .collect();
    }
    standard_nar_derived_target_state_save_tags(pack)
}

fn standard_nar_derived_target_state_save_tags(pack: &Pack) -> BTreeSet<String> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            if effect == "bulletproof" || effect == "bulletproof_vest" {
                tags.insert(effect.clone());
            }
        }
    }
    for effect in pack.effects.keys() {
        if effect == "bulletproof" || effect == "bulletproof_vest" {
            tags.insert(effect.clone());
        }
    }
    tags
}

fn standard_nar_target_state_gate_tags(pack: &Pack) -> BTreeSet<String> {
    if pack.standard_nar.enabled {
        return pack
            .standard_nar
            .target_state_gate_tags
            .iter()
            .cloned()
            .collect();
    }
    standard_nar_derived_target_state_gate_tags(pack)
}

fn standard_nar_derived_target_state_gate_tags(pack: &Pack) -> BTreeSet<String> {
    let mut tags = BTreeSet::new();
    for role in pack.roles.values() {
        for effect in &role.effects {
            record_standard_nar_target_state_gate_tag(&mut tags, effect);
        }
        for action in &role.actions {
            if let Some(effect) = &action.effect {
                record_standard_nar_target_state_gate_tag(&mut tags, effect);
            }
        }
    }
    for effect in pack.effects.keys() {
        record_standard_nar_target_state_gate_tag(&mut tags, effect);
    }
    tags
}

fn record_standard_nar_target_state_gate_tag(tags: &mut BTreeSet<String>, effect: &str) {
    if effect == "ascetic" || effect == "commuted" || effect == "untargetable" {
        tags.insert(effect.to_string());
    }
}

fn validate_standard_nar_protection_cause(
    issues: &mut Vec<PackValidationIssue>,
    path: String,
    cause: &str,
    kill_causes: &BTreeSet<String>,
) {
    if cause.trim().is_empty() {
        issue(issues, path, "kill cause must not be empty");
        return;
    }
    if !kill_causes.contains(cause) {
        issue(
            issues,
            path,
            format!("unknown standard_nar kill cause `{cause}`"),
        );
    }
}

fn validate_standard_nar_declares_block_protect_actions(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let declared_blocks = policy
        .block_action_ids
        .iter()
        .chain(policy.jailkeep_action_ids.iter())
        .collect::<BTreeSet<_>>();
    let declared_protects = policy
        .protect_action_ids
        .iter()
        .chain(policy.bodyguard_action_ids.iter())
        .chain(policy.martyr_action_ids.iter())
        .chain(policy.cpr_action_ids.iter())
        .chain(policy.jailkeep_action_ids.iter())
        .collect::<BTreeSet<_>>();

    for (source, action) in standard_nar_pack_actions(pack) {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        if action.has_ability(IrAbility::Block) && !declared_blocks.contains(&action.id) {
            issue(
                issues,
                format!("{policy_path}.block_action_ids"),
                format!(
                    "standard_nar Block action `{}` on {source} must be declared in block_action_ids or jailkeep_action_ids",
                    action.id
                ),
            );
        }
        if action.has_ability(IrAbility::Protect) && !declared_protects.contains(&action.id) {
            issue(
                issues,
                format!("{policy_path}.protect_action_ids"),
                format!(
                    "standard_nar Protect action `{}` on {source} must be declared in protect_action_ids, bodyguard_action_ids, martyr_action_ids, cpr_action_ids, or jailkeep_action_ids",
                    action.id
                ),
            );
        }
    }
}

fn validate_standard_nar_declares_kill_actions(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let kill_sources = policy
        .kill_action_ids
        .iter()
        .chain(policy.strongman_action_ids.iter())
        .cloned()
        .collect::<BTreeSet<_>>();
    for (source, action) in standard_nar_pack_actions(pack) {
        if !action.window.is_night_resolution_window() || !action.has_ability(IrAbility::Kill) {
            continue;
        }
        if policy
            .cpr_action_ids
            .iter()
            .any(|action_id| action_id == &action.id)
        {
            continue;
        }
        if !kill_sources.contains(&action.id) {
            issue(
                issues,
                format!("{policy_path}.kill_action_ids"),
                format!(
                    "standard_nar Kill action `{}` on {source} must be declared in kill_action_ids or strongman_action_ids",
                    action.id
                ),
            );
        }
    }
}

fn validate_standard_nar_declares_strongman_actions(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let declared_strongman_kills = policy.strongman_action_ids.iter().collect::<BTreeSet<_>>();
    for (source, action) in standard_nar_pack_actions(pack) {
        if action.window.is_night_resolution_window()
            && action.has_ability(IrAbility::Kill)
            && action.has_modifier(Modifier::Strongman)
            && !declared_strongman_kills.contains(&action.id)
        {
            issue(
                issues,
                format!("{policy_path}.strongman_action_ids"),
                format!(
                    "standard_nar Strongman Kill action `{}` on {source} must be declared in strongman_action_ids",
                    action.id
                ),
            );
        }
    }
}

fn validate_standard_nar_jailkeep_is_explicit_block_and_protect(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
) {
    let block_ids = policy.block_action_ids.iter().collect::<BTreeSet<_>>();
    let protect_ids = policy.protect_action_ids.iter().collect::<BTreeSet<_>>();
    for action_id in &policy.jailkeep_action_ids {
        if !block_ids.contains(action_id) {
            issue(
                issues,
                format!("{policy_path}.jailkeep_action_ids"),
                format!(
                    "standard_nar Jailkeeper action `{action_id}` must also be declared in block_action_ids"
                ),
            );
        }
        if !protect_ids.contains(action_id) {
            issue(
                issues,
                format!("{policy_path}.jailkeep_action_ids"),
                format!(
                    "standard_nar Jailkeeper action `{action_id}` must also be declared in protect_action_ids"
                ),
            );
        }
    }
}

fn validate_standard_nar_intercept_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.intercept_cause_policy");
    let intercept_sources = standard_nar_intercept_source_ids(policy);
    if intercept_sources.is_empty() {
        return;
    }
    if policy.intercept_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify intercept causes",
        );
    }

    let direct_kill_causes = standard_nar_kill_cause_ids(pack);
    for source_id in &intercept_sources {
        if !policy.intercept_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar intercept action `{source_id}` must declare intercept cause"),
            );
        }
    }

    for (source_id, cause) in &policy.intercept_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        if !intercept_sources.contains(source_id) {
            issue(
                issues,
                entry_path.clone(),
                format!("unknown standard_nar intercept source `{source_id}`"),
            );
        }
        if cause.trim().is_empty() {
            issue(
                issues,
                entry_path.clone(),
                "standard_nar intercept cause must not be empty",
            );
        } else if direct_kill_causes.contains(cause) {
            issue(
                issues,
                entry_path,
                format!(
                    "standard_nar intercept cause `{cause}` must not reuse a direct kill cause"
                ),
            );
        }
    }
}

fn validate_standard_nar_guard_retaliation_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.guard_retaliation_cause_policy");
    let retaliation_sources = standard_nar_guard_retaliation_source_ids(policy);
    if retaliation_sources.is_empty() {
        return;
    }

    let intercept_sources = standard_nar_intercept_source_ids(policy);
    let declared_kill_causes = standard_nar_kill_cause_ids(pack);
    for source_id in &retaliation_sources {
        if !intercept_sources.contains(source_id) {
            issue(
                issues,
                format!("{path}.{source_id}"),
                format!(
                    "standard_nar guard retaliation source `{source_id}` must also be an intercept source"
                ),
            );
        }
    }

    for (source_id, cause) in &policy.guard_retaliation_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        if cause.trim().is_empty() {
            issue(
                issues,
                entry_path.clone(),
                "standard_nar guard retaliation cause must not be empty",
            );
        } else if !declared_kill_causes.contains(cause) {
            issue(
                issues,
                entry_path,
                format!(
                    "standard_nar guard retaliation cause `{cause}` must be declared in kill_cause_ids"
                ),
            );
        }
    }
}

fn validate_standard_nar_cpr_harm_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.cpr_harm_cause_policy");
    let cpr_sources = policy
        .cpr_action_ids
        .iter()
        .cloned()
        .collect::<BTreeSet<_>>();
    if cpr_sources.is_empty() {
        return;
    }
    if policy.cpr_harm_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify CPR harm causes",
        );
    }

    let direct_kill_causes = standard_nar_kill_cause_ids(pack);
    for source_id in &cpr_sources {
        if !policy.cpr_harm_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar CPR action `{source_id}` must declare harm cause"),
            );
        }
    }

    for (source_id, cause) in &policy.cpr_harm_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        if !cpr_sources.contains(source_id) {
            issue(
                issues,
                entry_path.clone(),
                format!("unknown standard_nar CPR source `{source_id}`"),
            );
        }
        if cause.trim().is_empty() {
            issue(
                issues,
                entry_path.clone(),
                "standard_nar CPR harm cause must not be empty",
            );
        } else if direct_kill_causes.contains(cause) {
            issue(
                issues,
                entry_path,
                format!("standard_nar CPR harm cause `{cause}` must not reuse a direct kill cause"),
            );
        }
    }
}

fn validate_standard_nar_guard_dependency_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.guard_dependency_cause_policy");
    let guard_sources = standard_nar_guard_dependency_source_ids(pack);
    if guard_sources.is_empty() {
        return;
    }
    if policy.guard_dependency_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify guard dependency causes",
        );
    }

    let direct_kill_causes = standard_nar_kill_cause_ids(pack);
    for source_id in &guard_sources {
        if !policy.guard_dependency_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar guard dependency action `{source_id}` must declare dependency cause"),
            );
        }
    }

    for (source_id, cause) in &policy.guard_dependency_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        if !guard_sources.contains(source_id) {
            issue(
                issues,
                entry_path.clone(),
                format!("unknown standard_nar guard dependency source `{source_id}`"),
            );
        }
        if cause.trim().is_empty() {
            issue(
                issues,
                entry_path.clone(),
                "standard_nar guard dependency cause must not be empty",
            );
        } else if direct_kill_causes.contains(cause) {
            issue(
                issues,
                entry_path,
                format!(
                    "standard_nar guard dependency cause `{cause}` must not reuse a direct kill cause"
                ),
            );
        }
    }
}

fn validate_standard_nar_hide_dependency_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.hide_dependency_cause_policy");
    let hide_sources = standard_nar_hide_dependency_source_ids(pack);
    if hide_sources.is_empty() {
        return;
    }
    if policy.hide_dependency_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify hide dependency causes",
        );
    }

    let direct_kill_causes = standard_nar_kill_cause_ids(pack);
    for source_id in &hide_sources {
        if !policy.hide_dependency_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar hide dependency action `{source_id}` must declare dependency cause"),
            );
        }
    }

    for (source_id, cause) in &policy.hide_dependency_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        if !hide_sources.contains(source_id) {
            issue(
                issues,
                entry_path.clone(),
                format!("unknown standard_nar hide dependency source `{source_id}`"),
            );
        }
        if cause.trim().is_empty() {
            issue(
                issues,
                entry_path.clone(),
                "standard_nar hide dependency cause must not be empty",
            );
        } else if direct_kill_causes.contains(cause) {
            issue(
                issues,
                entry_path,
                format!(
                    "standard_nar hide dependency cause `{cause}` must not reuse a direct kill cause"
                ),
            );
        }
    }
}

fn validate_standard_nar_chosen_retaliation_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.chosen_retaliation_cause_policy");
    let retaliation_sources = standard_nar_chosen_retaliation_source_ids(pack);
    if retaliation_sources.is_empty() {
        return;
    }

    if policy.chosen_retaliation_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify chosen retaliation causes",
        );
    }

    for source_id in retaliation_sources.keys() {
        if !policy
            .chosen_retaliation_cause_policy
            .contains_key(source_id)
        {
            issue(
                issues,
                path.clone(),
                format!("standard_nar Retaliate action `{source_id}` must declare chosen retaliation cause policy"),
            );
        }
    }

    for (source_id, cause_policy) in &policy.chosen_retaliation_cause_policy {
        let source_path = format!("{path}.{source_id}");
        let Some(action) = retaliation_sources.get(source_id) else {
            issue(
                issues,
                source_path.clone(),
                format!("unknown standard_nar Retaliate action `{source_id}`"),
            );
            continue;
        };
        let action_is_strongman = action.has_modifier(Modifier::Strongman);
        if cause_policy.strongman_bypasses_protect != action_is_strongman {
            issue(
                issues,
                format!("{source_path}.strongman_bypasses_protect"),
                format!(
                    "standard_nar Retaliate action `{source_id}` strongman_bypasses_protect must match Strongman modifier"
                ),
            );
        }
    }
}

fn validate_standard_nar_generated_kill_ownership(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    validate_standard_nar_generated_kill_ownership_matrix(issues, policy_path, policy, pack);
    validate_standard_nar_generated_kill_cause_policy(issues, policy_path, policy, pack);
    validate_standard_nar_trigger_fixpoint_policy(issues, policy_path, policy, pack);
    validate_standard_nar_generated_kill_policy_alignment(issues, policy_path, policy, pack);
    validate_standard_nar_protection_cause_policy(issues, policy_path, policy, pack);
    validate_standard_nar_target_state_save_policy(issues, policy_path, policy, pack);
    validate_standard_nar_empower_effects(issues, policy_path, policy, pack);
    validate_standard_nar_suppression_policy(issues, policy_path, policy, pack);
}

fn validate_standard_nar_empower_effects(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.empower_effects");
    if policy.empower_effects.is_empty() {
        return;
    }

    validate_unique_strings(issues, path.clone(), &policy.empower_effects);
    for effect in &policy.empower_effects {
        if effect.trim().is_empty() {
            issue(issues, path.clone(), "empower effect tag must not be empty");
            continue;
        }
        let Some(effect_policy) = pack.effects.get(effect) else {
            issue(
                issues,
                path.clone(),
                format!("unknown standard_nar empower effect `{effect}`"),
            );
            continue;
        };
        if effect_policy.duration != EffectDuration::Resolution {
            issue(
                issues,
                path.clone(),
                format!("standard_nar empower effect `{effect}` must be resolution-scoped"),
            );
        }

        let mut produced_by_mark = false;
        for (owner, action) in standard_nar_pack_actions(pack) {
            if !action.window.is_night_resolution_window()
                || !action.has_ability(IrAbility::Mark)
                || action.effect.as_deref() != Some(effect.as_str())
            {
                continue;
            }
            produced_by_mark = true;
            let duration = action
                .effect_duration
                .or_else(|| pack.effects.get(effect).map(|policy| policy.duration))
                .unwrap_or(EffectDuration::Persistent);
            if duration != EffectDuration::Resolution {
                issue(
                    issues,
                    path.clone(),
                    format!(
                        "standard_nar empower effect `{effect}` producer {owner} action `{}` must be resolution-scoped",
                        action.id
                    ),
                );
            }
        }
        if !produced_by_mark {
            issue(
                issues,
                path.clone(),
                format!(
                    "standard_nar empower effect `{effect}` must be produced by a night Mark action"
                ),
            );
        }
    }
}

fn validate_effect_source_death_reveals(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policies: &[EffectSourceDeathRevealPolicy],
    ir_version: u16,
    pack: &Pack,
    effect_tags: &BTreeSet<&str>,
) {
    if policies.is_empty() {
        return;
    }
    if ir_version < 57 {
        issue(
            issues,
            path,
            "effect source-death reveal policies require ir_version >= 57",
        );
    }

    let mut ids = BTreeSet::new();
    let mut effects = BTreeSet::new();
    for (idx, policy) in policies.iter().enumerate() {
        let policy_path = format!("{path}[{idx}]");
        if policy.reveal == EffectSourceDeathRevealKind::Role && ir_version < 58 {
            issue(
                issues,
                format!("{policy_path}.reveal"),
                "effect source-death role reveal policies require ir_version >= 58",
            );
        }
        if policy.id.trim().is_empty() {
            issue(
                issues,
                format!("{policy_path}.id"),
                "effect source-death reveal policy id must not be empty",
            );
        } else if !ids.insert(policy.id.as_str()) {
            issue(
                issues,
                format!("{policy_path}.id"),
                format!(
                    "duplicate effect source-death reveal policy `{}`",
                    policy.id
                ),
            );
        }

        if policy.effect.trim().is_empty() {
            issue(
                issues,
                format!("{policy_path}.effect"),
                "effect source-death reveal effect must not be empty",
            );
            continue;
        }
        if !effects.insert(policy.effect.as_str()) {
            issue(
                issues,
                format!("{policy_path}.effect"),
                format!(
                    "duplicate effect source-death reveal effect `{}`",
                    policy.effect
                ),
            );
        }
        if !effect_tags.contains(policy.effect.as_str()) {
            issue(
                issues,
                format!("{policy_path}.effect"),
                format!(
                    "unknown effect source-death reveal effect `{}`",
                    policy.effect
                ),
            );
            continue;
        }

        let Some(effect_policy) = pack.effects.get(&policy.effect) else {
            issue(
                issues,
                format!("{policy_path}.effect"),
                format!(
                    "effect source-death reveal effect `{}` must declare effect metadata",
                    policy.effect
                ),
            );
            continue;
        };
        if effect_policy.duration != EffectDuration::Persistent {
            issue(
                issues,
                format!("{policy_path}.effect"),
                format!(
                    "effect source-death reveal effect `{}` must be persistent",
                    policy.effect
                ),
            );
        }

        let produced_by_persistent_mark =
            standard_nar_pack_actions(pack)
                .into_iter()
                .any(|(_, action)| {
                    action.has_ability(IrAbility::Mark)
                        && action.effect.as_deref() == Some(policy.effect.as_str())
                        && action
                            .effect_duration
                            .or_else(|| {
                                pack.effects
                                    .get(&policy.effect)
                                    .map(|policy| policy.duration)
                            })
                            .unwrap_or(EffectDuration::Persistent)
                            == EffectDuration::Persistent
                });
        if !produced_by_persistent_mark {
            issue(
                issues,
                format!("{policy_path}.effect"),
                format!(
                    "effect source-death reveal effect `{}` must be produced by a persistent Mark action",
                    policy.effect
                ),
            );
        }
    }
}

fn validate_standard_nar_generated_kill_ownership_matrix(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let generated_sources = standard_nar_generated_kill_source_ids(pack);
    if generated_sources.is_empty() {
        return;
    }

    let path = format!("{policy_path}.generated_kill_ownership");
    let kill_causes = policy.kill_cause_ids.iter().collect::<BTreeSet<_>>();
    let protect_sources = standard_nar_protect_source_ids(policy);
    let save_tags = standard_nar_target_state_save_tags(pack);
    let block_sources = standard_nar_block_source_ids(policy);
    let generated_trigger_feeds = standard_nar_generated_trigger_feed_actions(pack);

    for source_id in generated_sources.keys() {
        let source_path = format!("{path}.{source_id}");
        if !kill_causes.contains(source_id) {
            issue(
                issues,
                source_path.clone(),
                format!("generated kill trigger `{source_id}` is missing from kill_cause_ids"),
            );
        }
        if !policy.generated_kill_cause_policy.contains_key(source_id) {
            issue(
                issues,
                source_path.clone(),
                format!(
                    "generated kill trigger `{source_id}` is missing generated_kill_cause_policy"
                ),
            );
        }
        if !policy.trigger_fixpoint_policy.contains_key(source_id) {
            issue(
                issues,
                source_path.clone(),
                format!("generated kill trigger `{source_id}` is missing trigger_fixpoint_policy"),
            );
        }

        for protect_source in &protect_sources {
            let Some(cause_policy) = policy.protection_cause_policy.get(protect_source) else {
                continue;
            };
            if !standard_nar_blocks_bypasses_contains(
                &cause_policy.blocks,
                &cause_policy.bypasses,
                source_id,
            ) {
                issue(
                    issues,
                    source_path.clone(),
                    format!(
                        "generated kill trigger `{source_id}` is not owned by protection source `{protect_source}`"
                    ),
                );
            }
        }

        for save_tag in &save_tags {
            let Some(save_policy) = policy.target_state_save_policy.get(save_tag) else {
                continue;
            };
            if !standard_nar_blocks_bypasses_contains(
                &save_policy.blocks,
                &save_policy.bypasses,
                source_id,
            ) {
                issue(
                    issues,
                    source_path.clone(),
                    format!(
                        "generated kill trigger `{source_id}` is not owned by target-state save `{save_tag}`"
                    ),
                );
            }
        }

        for block_source in &block_sources {
            let Some(suppression) = policy.suppression_policy.get(block_source) else {
                continue;
            };
            for (action_id, trigger_ids) in &generated_trigger_feeds {
                if !trigger_ids.contains(source_id) {
                    continue;
                }
                if !standard_nar_suppression_contains(suppression, action_id) {
                    issue(
                        issues,
                        source_path.clone(),
                        format!(
                            "generated kill trigger `{source_id}` feeder action `{action_id}` is not owned by block source `{block_source}`"
                        ),
                    );
                }
            }
        }
    }
}

fn standard_nar_blocks_bypasses_contains(
    blocks: &[String],
    bypasses: &[String],
    cause: &str,
) -> bool {
    blocks.iter().any(|item| item == cause) || bypasses.iter().any(|item| item == cause)
}

fn standard_nar_suppression_contains(policy: &SuppressionPolicy, action_id: &str) -> bool {
    policy.suppresses.iter().any(|item| item == action_id)
        || policy.bypasses.iter().any(|item| item == action_id)
}

fn validate_standard_nar_generated_kill_cause_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.generated_kill_cause_policy");
    let generated_sources = standard_nar_generated_kill_source_ids(pack);
    if generated_sources.is_empty() {
        return;
    }
    if policy.generated_kill_cause_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify generated kill causes",
        );
    }

    for source_id in generated_sources.keys() {
        if !policy.generated_kill_cause_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!("standard_nar generated kill trigger `{source_id}` must declare generated kill cause policy"),
            );
        }
    }

    for (source_id, cause_policy) in &policy.generated_kill_cause_policy {
        let entry_path = format!("{path}.{source_id}");
        let Some(trigger) = generated_sources.get(source_id) else {
            issue(
                issues,
                entry_path,
                format!("unknown standard_nar generated kill trigger `{source_id}`"),
            );
            continue;
        };
        if cause_policy.on.is_none() {
            issue(
                issues,
                format!("{entry_path}.on"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must declare trigger on"
                ),
            );
        } else if cause_policy.on != Some(trigger.on) {
            issue(
                issues,
                format!("{entry_path}.on"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` on must match trigger rule"
                ),
            );
        }
        if cause_policy.actor.is_none() {
            issue(
                issues,
                format!("{entry_path}.actor"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must declare produced actor"
                ),
            );
        } else if cause_policy.actor != Some(trigger.produces.actor) {
            issue(
                issues,
                format!("{entry_path}.actor"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` actor must match trigger production"
                ),
            );
        }
        if cause_policy.target.is_none() {
            issue(
                issues,
                format!("{entry_path}.target"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must declare produced target"
                ),
            );
        } else if cause_policy.target != Some(trigger.produces.target) {
            issue(
                issues,
                format!("{entry_path}.target"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` target must match trigger production"
                ),
            );
        }
        let trigger_is_strongman = trigger.produces.modifiers.contains(&Modifier::Strongman);
        if cause_policy.strongman_bypasses_protect != trigger_is_strongman {
            issue(
                issues,
                format!("{entry_path}.strongman_bypasses_protect"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` strongman_bypasses_protect must match produced Strongman modifier"
                ),
            );
        }
    }
}

fn validate_standard_nar_trigger_fixpoint_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let path = format!("{policy_path}.trigger_fixpoint_policy");
    let generated_sources = standard_nar_generated_kill_source_ids(pack);
    if generated_sources.is_empty() {
        return;
    }
    if policy.trigger_fixpoint_policy.is_empty() {
        issue(
            issues,
            path.clone(),
            "enabled standard_nar policy must classify trigger fixpoint participation",
        );
    }

    for source_id in generated_sources.keys() {
        if !policy.trigger_fixpoint_policy.contains_key(source_id) {
            issue(
                issues,
                path.clone(),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must declare trigger fixpoint policy"
                ),
            );
        }
    }

    for (source_id, fixpoint_policy) in &policy.trigger_fixpoint_policy {
        let entry_path = format!("{path}.{source_id}");
        let Some(trigger) = generated_sources.get(source_id) else {
            issue(
                issues,
                entry_path,
                format!("unknown standard_nar trigger fixpoint source `{source_id}`"),
            );
            continue;
        };
        if fixpoint_policy.on.is_none() {
            issue(
                issues,
                format!("{entry_path}.on"),
                format!("standard_nar trigger `{source_id}` must declare observed trigger on"),
            );
        } else if fixpoint_policy.on != Some(trigger.on) {
            issue(
                issues,
                format!("{entry_path}.on"),
                format!("standard_nar trigger `{source_id}` on must match trigger rule"),
            );
        }
        if !fixpoint_policy.produced_kill_reenters {
            issue(
                issues,
                format!("{entry_path}.produced_kill_reenters"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must declare produced_kill_reenters true"
                ),
            );
        }
        if fixpoint_policy.loop_cap.is_none() {
            issue(
                issues,
                format!("{entry_path}.loop_cap"),
                format!("standard_nar trigger `{source_id}` must declare loop_cap policy"),
            );
        } else if fixpoint_policy.loop_cap != Some(TriggerLoopCapPolicy::RedirectLoopCap) {
            issue(
                issues,
                format!("{entry_path}.loop_cap"),
                format!("standard_nar trigger `{source_id}` loop_cap must use RedirectLoopCap"),
            );
        }
        if !fixpoint_policy.trace {
            issue(
                issues,
                format!("{entry_path}.trace"),
                format!("standard_nar trigger `{source_id}` must declare trace true"),
            );
        }
    }
}

fn validate_standard_nar_generated_kill_policy_alignment(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    policy: &StandardNarPolicy,
    pack: &Pack,
) {
    let generated_sources = standard_nar_generated_kill_source_ids(pack);
    for source_id in generated_sources.keys() {
        let has_cause_policy = policy.generated_kill_cause_policy.contains_key(source_id);
        let has_fixpoint_policy = policy.trigger_fixpoint_policy.contains_key(source_id);
        if has_cause_policy && !has_fixpoint_policy {
            issue(
                issues,
                format!("{policy_path}.generated_kill_cause_policy.{source_id}"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must also declare trigger fixpoint policy"
                ),
            );
        }
        if has_fixpoint_policy && !has_cause_policy {
            issue(
                issues,
                format!("{policy_path}.trigger_fixpoint_policy.{source_id}"),
                format!(
                    "standard_nar generated kill trigger `{source_id}` must also declare generated kill cause policy"
                ),
            );
        }
    }
}

fn validate_standard_nar_bucket(
    issues: &mut Vec<PackValidationIssue>,
    policy_path: &str,
    field: &str,
    action_ids: &[String],
    pack: &Pack,
    predicate: impl Fn(&ActionTemplate) -> bool,
    expected: &str,
) {
    let path = format!("{policy_path}.{field}");
    if action_ids.is_empty() {
        issue(
            issues,
            path.clone(),
            format!("enabled standard_nar policy must declare {field}"),
        );
    }
    validate_unique_strings(issues, path.clone(), action_ids);
    for action_id in action_ids {
        if action_id.trim().is_empty() {
            issue(
                issues,
                path.clone(),
                format!("{field} id must not be empty"),
            );
            continue;
        }
        let matches: Vec<&ActionTemplate> = standard_nar_pack_actions(pack)
            .into_iter()
            .map(|(_, action)| action)
            .filter(|action| action.id == action_id.as_str())
            .collect();
        if matches.is_empty() {
            issue(
                issues,
                path.clone(),
                format!("unknown standard_nar action `{action_id}`"),
            );
            continue;
        }
        if !matches
            .iter()
            .any(|action| action.window.is_night_resolution_window() && predicate(action))
        {
            issue(
                issues,
                path.clone(),
                format!("standard_nar action `{action_id}` must be a night/any {expected} action"),
            );
        }
    }
}

fn standard_nar_pack_actions(pack: &Pack) -> Vec<(String, &ActionTemplate)> {
    let mut actions = Vec::new();
    for (role_key, role) in &pack.roles {
        for action in &role.actions {
            actions.push((format!("role `{role_key}`"), action));
        }
    }
    for (grant_id, action) in &pack.item_actions {
        actions.push((format!("item_actions `{grant_id}`"), action));
    }
    actions
}

fn pack_uses_ability(pack: &Pack, ability: IrAbility) -> bool {
    standard_nar_pack_actions(pack)
        .iter()
        .any(|(_, action)| action.has_ability(ability))
}

fn pack_kill_cause_ids(pack: &Pack) -> BTreeSet<String> {
    let mut causes = BTreeSet::new();
    for (_, action) in standard_nar_pack_actions(pack) {
        if action.has_ability(IrAbility::Kill) {
            causes.insert(action.id.clone());
            causes.extend(action.source_ids.iter().cloned());
        }
    }
    for trigger in &pack.triggers {
        if trigger.produces.ability == IrAbility::Kill {
            causes.insert(trigger.id.clone());
        }
    }
    if pack.wolf_carry.enabled {
        causes.insert(pack.wolf_carry.cause.clone());
    }
    if pack.wolf_beauty.enabled {
        causes.insert(pack.wolf_beauty.drag_cause.clone());
    }
    if pack.lover_policy.enabled {
        causes.insert(pack.lover_policy.suicide_cause.clone());
    }
    causes.extend(pack.standard_nar.intercept_cause_policy.values().cloned());
    causes.extend(
        pack.standard_nar
            .guard_retaliation_cause_policy
            .values()
            .cloned(),
    );
    causes.extend(pack.standard_nar.cpr_harm_cause_policy.values().cloned());
    causes.extend(
        pack.standard_nar
            .guard_dependency_cause_policy
            .values()
            .cloned(),
    );
    causes.extend(
        pack.standard_nar
            .hide_dependency_cause_policy
            .values()
            .cloned(),
    );
    causes.insert("day_vote".to_string());
    causes.insert("lynch".to_string());
    causes.insert("weak".to_string());
    causes
}

fn validate_policy_action_ref(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    pack: &Pack,
    action_id: &str,
    required_ability: IrAbility,
    label: &str,
) {
    let path = path.into();
    if action_id.trim().is_empty() {
        issue(issues, path, format!("{label} id must not be empty"));
        return;
    }
    let matches: Vec<&ActionTemplate> = pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .filter(|action| action.id == action_id)
        .collect();
    if matches.is_empty() {
        issue(issues, path, format!("unknown {label} `{action_id}`"));
        return;
    }
    if !matches.iter().any(|action| {
        action.has_ability(required_ability) && action.window.is_night_resolution_window()
    }) {
        issue(
            issues,
            path,
            format!("{label} `{action_id}` must be a night/any {required_ability:?} action"),
        );
    }
}

fn policy_action_templates<'a>(
    pack: &'a Pack,
    action_id: &str,
    required_ability: IrAbility,
) -> Vec<&'a ActionTemplate> {
    pack.roles
        .values()
        .flat_map(|role| role.actions.iter())
        .filter(|action| {
            action.id == action_id
                && action.has_ability(required_ability)
                && action.window.is_night_resolution_window()
        })
        .collect()
}

fn validate_death_retaliation_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &DeathRetaliationPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 14 {
        issue(
            issues,
            path,
            "enabled death retaliation policy requires ir_version >= 14",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled death retaliation policy must declare eligible_roles",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.eligible_roles"),
        &policy.eligible_roles,
    );
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    if policy.timing.is_none() {
        issue(
            issues,
            format!("{path}.timing"),
            "enabled death retaliation policy must declare timing",
        );
    }
    if policy.allowed_death_causes.is_empty() {
        issue(
            issues,
            format!("{path}.allowed_death_causes"),
            "enabled death retaliation policy must declare allowed_death_causes",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.allowed_death_causes"),
        &policy.allowed_death_causes,
    );
    validate_unique_strings(
        issues,
        format!("{path}.suppressed_death_causes"),
        &policy.suppressed_death_causes,
    );
    for cause in policy
        .allowed_death_causes
        .iter()
        .chain(policy.suppressed_death_causes.iter())
    {
        if cause.trim().is_empty() {
            issue(issues, path, "death retaliation causes must not be empty");
        }
    }
    for cause in &policy.allowed_death_causes {
        if policy.suppressed_death_causes.contains(cause) {
            issue(
                issues,
                path,
                format!("death cause `{cause}` cannot be both allowed and suppressed"),
            );
        }
    }
    if !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled death retaliation policy requires Night in phases.cadence",
        );
    }
}

fn validate_death_reveal_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &DeathRevealPolicy,
    ir_version: u16,
    pack: &Pack,
    effect_tags: &BTreeSet<&str>,
) {
    if *policy != DeathRevealPolicy::default() && ir_version < 26 {
        issue(
            issues,
            path,
            "death_reveal policy requires ir_version >= 26",
        );
    }

    let kill_causes = pack_kill_cause_ids(pack);
    for cause in policy.by_cause.keys() {
        if cause.trim().is_empty() {
            issue(
                issues,
                format!("{path}.by_cause"),
                "death reveal cause must not be empty",
            );
        } else if !kill_causes.contains(cause) {
            issue(
                issues,
                format!("{path}.by_cause.{cause}"),
                format!("unknown kill cause `{cause}`"),
            );
        }
    }

    for effect in policy.by_effect.keys() {
        if effect.trim().is_empty() {
            issue(
                issues,
                format!("{path}.by_effect"),
                "death reveal effect must not be empty",
            );
        } else if !effect_tags.contains(effect.as_str()) {
            issue(
                issues,
                format!("{path}.by_effect.{effect}"),
                format!("unknown effect tag `{effect}`"),
            );
        }
    }
}

fn validate_idiot_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &IdiotPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 15 {
        issue(
            issues,
            path,
            "enabled idiot policy requires ir_version >= 15",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled idiot policy must declare eligible_roles",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.eligible_roles"),
        &policy.eligible_roles,
    );
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    if policy.vote_loss_effect.trim().is_empty() {
        issue(
            issues,
            format!("{path}.vote_loss_effect"),
            "idiot vote_loss_effect must not be empty",
        );
    } else if !effect_tags.contains(policy.vote_loss_effect.as_str()) {
        issue(
            issues,
            format!("{path}.vote_loss_effect"),
            format!("unknown vote loss effect `{}`", policy.vote_loss_effect),
        );
    }
    if policy.survival_reason.trim().is_empty() {
        issue(
            issues,
            format!("{path}.survival_reason"),
            "idiot survival_reason must not be empty",
        );
    }
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "enabled idiot policy requires Day in phases.cadence",
        );
    }
}

fn validate_saulus_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &SaulusPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    alignments: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 62 {
        issue(
            issues,
            path,
            "enabled saulus policy requires ir_version >= 62",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled saulus policy must declare eligible_roles",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.eligible_roles"),
        &policy.eligible_roles,
    );
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    validate_alignment_ref(
        issues,
        format!("{path}.target_alignment"),
        &policy.target_alignment,
        alignments,
    );
    if policy.survival_reason.trim().is_empty() {
        issue(
            issues,
            format!("{path}.survival_reason"),
            "saulus survival_reason must not be empty",
        );
    }
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "enabled saulus policy requires Day in phases.cadence",
        );
    }
}

fn validate_backup_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &BackupPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 17 {
        issue(
            issues,
            path,
            "enabled backup policy requires ir_version >= 17",
        );
    }
    if policy.passive_effect_prefix.trim().is_empty() {
        issue(
            issues,
            format!("{path}.passive_effect_prefix"),
            "backup passive_effect_prefix must not be empty",
        );
    }
    if policy.targeted_effect.trim().is_empty() {
        issue(
            issues,
            format!("{path}.targeted_effect"),
            "backup targeted_effect must not be empty",
        );
    } else if !effect_tags.contains(policy.targeted_effect.as_str()) {
        issue(
            issues,
            format!("{path}.targeted_effect"),
            format!(
                "unknown targeted backup effect `{}`",
                policy.targeted_effect
            ),
        );
    }

    for role in role_keys {
        let passive_effect = format!("{}{}", policy.passive_effect_prefix, role);
        if !effect_tags.contains(passive_effect.as_str()) {
            continue;
        }
        if !role_keys.contains(role) {
            issue(
                issues,
                format!("{path}.passive_effect_prefix"),
                format!("backup effect `{passive_effect}` references unknown role `{role}`"),
            );
        }
    }
    for effect in effect_tags {
        let Some(role) = effect.strip_prefix(&policy.passive_effect_prefix) else {
            continue;
        };
        if !role.is_empty() && !role_keys.contains(role) {
            issue(
                issues,
                format!("{path}.passive_effect_prefix"),
                format!("backup effect `{effect}` references unknown role `{role}`"),
            );
        }
    }
}

fn validate_private_channel_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &PrivateChannelPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
) {
    if !policy.enabled {
        if !policy.groups.is_empty() {
            issue(
                issues,
                path,
                "private channel groups require private_channels.enabled",
            );
        }
        return;
    }
    if ir_version < 29 {
        issue(
            issues,
            path,
            "enabled private channel policy requires ir_version >= 29",
        );
    }
    if policy.groups.is_empty() {
        issue(issues, path, "private channel groups must not be empty");
    }

    let mut ids = BTreeSet::new();
    for group in &policy.groups {
        let group_path = format!("{path}.{}", group.id);
        if group.id.trim().is_empty() {
            issue(issues, path, "private channel group id must not be empty");
        } else if !ids.insert(group.id.as_str()) {
            issue(
                issues,
                format!("{path}.{}", group.id),
                format!("duplicate private channel group id `{}`", group.id),
            );
        }
        let is_faction_day_chat = group.kind == PrivateChannelKind::FactionDayChat;
        if group.roles.is_empty() && !is_faction_day_chat {
            issue(
                issues,
                group_path.clone(),
                "private channel group roles must not be empty",
            );
        }
        let mut roles = BTreeSet::new();
        for role in &group.roles {
            if role.trim().is_empty() {
                issue(
                    issues,
                    format!("{group_path}.roles"),
                    "private channel role must not be empty",
                );
            } else if !role_keys.contains(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.roles"),
                    format!("unknown private channel role `{role}`"),
                );
            } else if !roles.insert(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.roles"),
                    format!("duplicate private channel role `{role}`"),
                );
            }
        }
        if !group.excluded_roles.is_empty() && ir_version < 64 {
            issue(
                issues,
                format!("{group_path}.excluded_roles"),
                "private channel role exclusions require ir_version >= 64",
            );
        }
        let mut excluded_roles = BTreeSet::new();
        for role in &group.excluded_roles {
            if role.trim().is_empty() {
                issue(
                    issues,
                    format!("{group_path}.excluded_roles"),
                    "private channel excluded role must not be empty",
                );
            } else if !role_keys.contains(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.excluded_roles"),
                    format!("unknown private channel excluded role `{role}`"),
                );
            } else if !excluded_roles.insert(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.excluded_roles"),
                    format!("duplicate private channel excluded role `{role}`"),
                );
            }
        }
        let mut enabled_by_roles = BTreeSet::new();
        for role in &group.enabled_by_roles {
            if role.trim().is_empty() {
                issue(
                    issues,
                    format!("{group_path}.enabled_by_roles"),
                    "private channel enabling role must not be empty",
                );
            } else if !role_keys.contains(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.enabled_by_roles"),
                    format!("unknown private channel enabling role `{role}`"),
                );
            } else if !enabled_by_roles.insert(role.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.enabled_by_roles"),
                    format!("duplicate private channel enabling role `{role}`"),
                );
            }
        }
        let mut member_alignments = BTreeSet::new();
        for alignment in &group.member_alignments {
            if alignment.trim().is_empty() {
                issue(
                    issues,
                    format!("{group_path}.member_alignments"),
                    "private channel member alignment must not be empty",
                );
            } else if !member_alignments.insert(alignment.as_str()) {
                issue(
                    issues,
                    format!("{group_path}.member_alignments"),
                    format!("duplicate private channel member alignment `{alignment}`"),
                );
            }
        }
        match (group.kind, group.reveals_alignment) {
            (PrivateChannelKind::Mason, PrivateChannelAlignmentReveal::Town)
            | (PrivateChannelKind::Neighbor, PrivateChannelAlignmentReveal::None)
            | (PrivateChannelKind::FactionDayChat, PrivateChannelAlignmentReveal::None) => {}
            (PrivateChannelKind::Mason, _) => issue(
                issues,
                format!("{group_path}.reveals_alignment"),
                "mason private channels must reveal Town alignment",
            ),
            (PrivateChannelKind::Neighbor, _) => issue(
                issues,
                format!("{group_path}.reveals_alignment"),
                "neighbor private channels must not reveal alignment",
            ),
            (PrivateChannelKind::FactionDayChat, _) => issue(
                issues,
                format!("{group_path}.reveals_alignment"),
                "faction day-chat private channels must not reveal alignment",
            ),
        }
        match group.kind {
            PrivateChannelKind::Mason | PrivateChannelKind::Neighbor => {
                if !group.member_alignments.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.member_alignments"),
                        "role-based private channels must not declare member_alignments",
                    );
                }
                if !group.enabled_by_roles.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.enabled_by_roles"),
                        "role-based private channels must not declare enabled_by_roles",
                    );
                }
                if group.active_while_source_alive {
                    issue(
                        issues,
                        format!("{group_path}.active_while_source_alive"),
                        "role-based private channels must not be source-alive gated",
                    );
                }
                if !group.excluded_roles.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.excluded_roles"),
                        "role-based private channels must not declare excluded_roles",
                    );
                }
            }
            PrivateChannelKind::FactionDayChat => {
                if !group.roles.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.roles"),
                        "faction day-chat private channels use member_alignments, not roles",
                    );
                }
                if group.member_alignments.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.member_alignments"),
                        "faction day-chat private channels must declare member_alignments",
                    );
                }
                if group.enabled_by_roles.is_empty() {
                    issue(
                        issues,
                        format!("{group_path}.enabled_by_roles"),
                        "faction day-chat private channels must declare enabled_by_roles",
                    );
                }
                if !group.active_while_source_alive {
                    issue(
                        issues,
                        format!("{group_path}.active_while_source_alive"),
                        "faction day-chat private channels must be source-alive gated",
                    );
                }
            }
        }
    }
}

fn validate_treestump_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &TreestumpPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
) {
    if !policy.enabled {
        if !policy.eligible_roles.is_empty() {
            issue(
                issues,
                path,
                "treestump eligible roles require treestump_policy.enabled",
            );
        }
        return;
    }
    if ir_version < 30 {
        issue(
            issues,
            path,
            "enabled treestump policy requires ir_version >= 30",
        );
    }
    if policy.status_tag.trim().is_empty() {
        issue(
            issues,
            format!("{path}.status_tag"),
            "status tag must not be empty",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(issues, path, "eligible roles must not be empty");
    }

    let mut roles = BTreeSet::new();
    for role in &policy.eligible_roles {
        if role.trim().is_empty() {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                "eligible role must not be empty",
            );
        } else if !role_keys.contains(role.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown treestump role `{role}`"),
            );
        } else if !roles.insert(role.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("duplicate treestump role `{role}`"),
            );
        }
    }
}

fn validate_target_lynch_win_policies(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policies: &[TargetLynchWinPolicy],
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    alignments: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if policies.is_empty() {
        return;
    }
    if ir_version < 19 {
        issue(
            issues,
            path,
            "target lynch win policies require ir_version >= 19",
        );
    }
    let mut ids = Vec::new();
    let mut source_keys = BTreeSet::new();
    for (idx, policy) in policies.iter().enumerate() {
        let item_path = format!("{path}[{idx}]");
        ids.push(policy.id.clone());
        if policy.id.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.id"),
                "target lynch win policy id must not be empty",
            );
        }
        if policy.target_effect.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.target_effect"),
                "target lynch win target_effect must not be empty",
            );
        } else if !effect_tags.contains(policy.target_effect.as_str()) {
            issue(
                issues,
                format!("{item_path}.target_effect"),
                format!("unknown target effect `{}`", policy.target_effect),
            );
        }
        if policy.eligible_roles.is_empty() {
            issue(
                issues,
                format!("{item_path}.eligible_roles"),
                "target lynch win policy must declare eligible_roles",
            );
        }
        validate_unique_strings(
            issues,
            format!("{item_path}.eligible_roles"),
            &policy.eligible_roles,
        );
        for role_key in &policy.eligible_roles {
            if !role_keys.contains(role_key.as_str()) {
                issue(
                    issues,
                    format!("{item_path}.eligible_roles"),
                    format!("unknown eligible role `{role_key}`"),
                );
            }
            let semantic_key = (role_key.clone(), policy.target_effect.clone());
            if !role_key.trim().is_empty()
                && !policy.target_effect.trim().is_empty()
                && !source_keys.insert(semantic_key)
            {
                issue(
                    issues,
                    format!("{item_path}.eligible_roles"),
                    format!(
                        "duplicate target lynch win source `{}` for eligible role `{role_key}`",
                        policy.target_effect
                    ),
                );
            }
        }
        validate_alignment_ref(
            issues,
            format!("{item_path}.winner"),
            &policy.winner,
            alignments,
        );
    }
    validate_unique_strings(issues, format!("{path}.id"), &ids);
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "target lynch win policies require Day in phases.cadence",
        );
    }
}

fn validate_self_lynch_win_policies(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policies: &[SelfLynchWinPolicy],
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    alignments: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if policies.is_empty() {
        return;
    }
    if ir_version < 25 {
        issue(
            issues,
            path,
            "self lynch win policies require ir_version >= 25",
        );
    }
    let mut ids = Vec::new();
    let mut source_keys = BTreeSet::new();
    for (idx, policy) in policies.iter().enumerate() {
        let item_path = format!("{path}[{idx}]");
        ids.push(policy.id.clone());
        if policy.id.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.id"),
                "self lynch win policy id must not be empty",
            );
        }
        if policy.eligible_roles.is_empty() {
            issue(
                issues,
                format!("{item_path}.eligible_roles"),
                "self lynch win policy must declare eligible_roles",
            );
        }
        validate_unique_strings(
            issues,
            format!("{item_path}.eligible_roles"),
            &policy.eligible_roles,
        );
        for role_key in &policy.eligible_roles {
            if !role_keys.contains(role_key.as_str()) {
                issue(
                    issues,
                    format!("{item_path}.eligible_roles"),
                    format!("unknown eligible role `{role_key}`"),
                );
            }
        }
        validate_alignment_ref(
            issues,
            format!("{item_path}.winner"),
            &policy.winner,
            alignments,
        );
        let source_event = policy
            .source_event
            .as_deref()
            .map(str::to_string)
            .unwrap_or_else(|| format!("win.{}", policy.id));
        for role_key in &policy.eligible_roles {
            if role_key.trim().is_empty() {
                continue;
            }
            let semantic_key = (role_key.clone(), source_event.clone());
            if !source_keys.insert(semantic_key) {
                issue(
                    issues,
                    format!("{item_path}.eligible_roles"),
                    format!(
                        "duplicate self lynch win source `{source_event}` for eligible role `{role_key}`"
                    ),
                );
            }
        }
        if let Some(source_event) = &policy.source_event {
            if !source_event.starts_with("win.") {
                issue(
                    issues,
                    format!("{item_path}.source_event"),
                    "self lynch win source_event must start with `win.`",
                );
            }
        }
    }
    validate_unique_strings(issues, format!("{path}.id"), &ids);
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "self lynch win policies require Day in phases.cadence",
        );
    }
}

fn validate_beloved_princess_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &BelovedPrincessPolicy,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 20 {
        issue(
            issues,
            path,
            "enabled beloved princess policy requires ir_version >= 20",
        );
    }
    if policy.all_death_causes && ir_version < 65 {
        issue(
            issues,
            format!("{path}.all_death_causes"),
            "beloved princess all-death trigger matching requires ir_version >= 65",
        );
    }
    if policy.eligible_roles.is_empty() {
        issue(
            issues,
            format!("{path}.eligible_roles"),
            "enabled beloved princess policy must declare eligible_roles",
        );
    }
    validate_unique_strings(
        issues,
        format!("{path}.eligible_roles"),
        &policy.eligible_roles,
    );
    for role_key in &policy.eligible_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.eligible_roles"),
                format!("unknown eligible role `{role_key}`"),
            );
        }
    }
    if policy.prompt_kind.trim().is_empty() {
        issue(
            issues,
            format!("{path}.prompt_kind"),
            "beloved princess prompt_kind must not be empty",
        );
    }
    if policy.prompt_reason.trim().is_empty() {
        issue(
            issues,
            format!("{path}.prompt_reason"),
            "beloved princess prompt_reason must not be empty",
        );
    }
    if !policy.all_death_causes && policy.death_causes.is_empty() {
        issue(
            issues,
            format!("{path}.death_causes"),
            "enabled beloved princess policy must declare death_causes",
        );
    }
    validate_unique_strings(issues, format!("{path}.death_causes"), &policy.death_causes);
    for cause in &policy.death_causes {
        if cause.trim().is_empty() {
            issue(
                issues,
                format!("{path}.death_causes"),
                "beloved princess death causes must not be empty",
            );
        }
    }
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "enabled beloved princess policy requires Day in phases.cadence",
        );
    }
}

fn validate_day_vote_prompt_policies(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policies: &[DayVotePromptPolicy],
    ir_version: u16,
    cadence: &BTreeSet<PhaseKind>,
) {
    if policies.is_empty() {
        return;
    }
    if ir_version < 21 {
        issue(
            issues,
            path,
            "day vote prompt policies require ir_version >= 21",
        );
    }
    let mut ids = Vec::new();
    for (idx, policy) in policies.iter().enumerate() {
        let item_path = format!("{path}[{idx}]");
        ids.push(policy.id.clone());
        if policy.id.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.id"),
                "day vote prompt policy id must not be empty",
            );
        }
        if policy.statuses.is_empty() {
            issue(
                issues,
                format!("{item_path}.statuses"),
                "day vote prompt policy must declare statuses",
            );
        }
        let status_names: Vec<String> = policy
            .statuses
            .iter()
            .map(|status| format!("{status:?}"))
            .collect();
        validate_unique_strings(issues, format!("{item_path}.statuses"), &status_names);
        if policy.prompt_kind.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.prompt_kind"),
                "day vote prompt_kind must not be empty",
            );
        }
        if policy.prompt_reason.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.prompt_reason"),
                "day vote prompt_reason must not be empty",
            );
        }
    }
    validate_unique_strings(issues, format!("{path}.id"), &ids);
    if !cadence.contains(&PhaseKind::Day) {
        issue(
            issues,
            path,
            "day vote prompt policies require Day in phases.cadence",
        );
    }
}

fn validate_host_prompt_resolution_effects(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policies: &[HostPromptResolutionEffectPolicy],
    ir_version: u16,
    pack: &Pack,
) {
    let mut prompt_pairs = Vec::new();
    if pack.beloved_princess_policy.enabled
        && !pack.beloved_princess_policy.prompt_kind.trim().is_empty()
        && !pack.beloved_princess_policy.prompt_reason.trim().is_empty()
    {
        prompt_pairs.push((
            pack.beloved_princess_policy.prompt_kind.as_str(),
            pack.beloved_princess_policy.prompt_reason.as_str(),
            "beloved_princess_policy",
        ));
    }
    for policy in &pack.day_vote_prompt_policies {
        if !policy.prompt_kind.trim().is_empty() && !policy.prompt_reason.trim().is_empty() {
            prompt_pairs.push((
                policy.prompt_kind.as_str(),
                policy.prompt_reason.as_str(),
                "day_vote_prompt_policies",
            ));
        }
    }

    if policies.is_empty() {
        if !prompt_pairs.is_empty() && ir_version >= 22 {
            issue(
                issues,
                path,
                "missing resolution effect for declared host prompt producer",
            );
        }
        return;
    }
    if ir_version < 22 {
        issue(
            issues,
            path,
            "host prompt resolution effects require ir_version >= 22",
        );
    }

    let mut ids = Vec::new();
    let mut pairs = Vec::new();
    for (idx, policy) in policies.iter().enumerate() {
        let item_path = format!("{path}[{idx}]");
        ids.push(policy.id.clone());
        if policy.id.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.id"),
                "host prompt resolution effect id must not be empty",
            );
        }
        if policy.prompt_kind.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.prompt_kind"),
                "host prompt resolution effect prompt_kind must not be empty",
            );
        }
        if policy.prompt_reason.trim().is_empty() {
            issue(
                issues,
                format!("{item_path}.prompt_reason"),
                "host prompt resolution effect prompt_reason must not be empty",
            );
        }
        pairs.push(format!("{}:{}", policy.prompt_kind, policy.prompt_reason));
        match (policy.decision, policy.effect) {
            (HostPromptDecisionKind::SelectSlot, HostPromptResolutionEffect::PkKill)
            | (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AdvanceRevote)
            | (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::SkipNextDay)
            | (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::AcknowledgeOnly) => {
            }
            (HostPromptDecisionKind::SelectSlot, _) => issue(
                issues,
                format!("{item_path}.decision"),
                "SelectSlot decisions are only valid for PkKill prompt effects",
            ),
            (HostPromptDecisionKind::Acknowledge, HostPromptResolutionEffect::PkKill) => issue(
                issues,
                format!("{item_path}.decision"),
                "PkKill prompt effects require SelectSlot decisions",
            ),
        }
    }
    validate_unique_strings(issues, format!("{path}.id"), &ids);
    validate_unique_strings(issues, format!("{path}.prompt"), &pairs);

    for (kind, reason, producer_path) in prompt_pairs {
        if !policies
            .iter()
            .any(|policy| policy.prompt_kind == kind && policy.prompt_reason == reason)
        {
            issue(
                issues,
                path,
                format!(
                    "missing resolution effect for prompt {kind}:{reason} declared by {producer_path}",
                ),
            );
        }
    }
}

fn validate_lover_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &LoverPolicy,
    ir_version: u16,
    effect_tags: &BTreeSet<&str>,
    cadence: &BTreeSet<PhaseKind>,
) {
    if !policy.enabled {
        return;
    }
    if ir_version < 16 {
        issue(
            issues,
            path,
            "enabled lover policy requires ir_version >= 16",
        );
    }
    if policy.link_effect.trim().is_empty() {
        issue(
            issues,
            format!("{path}.link_effect"),
            "lover link_effect must not be empty",
        );
    } else if !effect_tags.contains(policy.link_effect.as_str()) {
        issue(
            issues,
            format!("{path}.link_effect"),
            format!("unknown lover link effect `{}`", policy.link_effect),
        );
    }
    if policy.suicide_cause.trim().is_empty() {
        issue(
            issues,
            format!("{path}.suicide_cause"),
            "lover suicide_cause must not be empty",
        );
    }
    if let Some(source_helper_role) = &policy.source_helper_role {
        if source_helper_role.trim().is_empty() {
            issue(
                issues,
                format!("{path}.source_helper_role"),
                "lover source_helper_role must not be empty",
            );
        }
    }
    if !cadence.contains(&PhaseKind::Night) {
        issue(
            issues,
            path,
            "enabled lover policy requires Night in phases.cadence",
        );
    }
}

fn validate_investigation_result_policy(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    policy: &InvestigationResultPolicy,
    role_keys: &BTreeSet<&str>,
    alignments: &BTreeSet<&str>,
) {
    if policy.parity.town.trim().is_empty() {
        issue(
            issues,
            format!("{path}.parity.town"),
            "Parity town result label must not be empty",
        );
    }
    if policy.parity.non_town.trim().is_empty() {
        issue(
            issues,
            format!("{path}.parity.non_town"),
            "Parity non_town result label must not be empty",
        );
    }
    for (alignment, label) in &policy.parity.alignment_results {
        validate_alignment_ref(
            issues,
            format!("{path}.parity.alignment_results.{alignment}"),
            alignment,
            alignments,
        );
        if label.trim().is_empty() {
            issue(
                issues,
                format!("{path}.parity.alignment_results.{alignment}"),
                "alignment result label must not be empty",
            );
        }
    }
    validate_unique_strings(
        issues,
        format!("{path}.role_sets.vanilla_roles"),
        &policy.role_sets.vanilla_roles,
    );
    validate_unique_strings(
        issues,
        format!("{path}.role_sets.gun_bearing_roles"),
        &policy.role_sets.gun_bearing_roles,
    );
    validate_unique_strings(
        issues,
        format!("{path}.role_sets.killer_roles"),
        &policy.role_sets.killer_roles,
    );
    validate_unique_strings(
        issues,
        format!("{path}.role_sets.specialist_roles"),
        &policy.role_sets.specialist_roles,
    );
    for role_key in &policy.role_sets.vanilla_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_sets.vanilla_roles"),
                format!("unknown vanilla role `{role_key}`"),
            );
        }
    }
    for role_key in &policy.role_sets.gun_bearing_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_sets.gun_bearing_roles"),
                format!("unknown gun-bearing role `{role_key}`"),
            );
        }
    }
    for role_key in &policy.role_sets.killer_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_sets.killer_roles"),
                format!("unknown killer role `{role_key}`"),
            );
        }
    }
    for role_key in &policy.role_sets.specialist_roles {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                format!("{path}.role_sets.specialist_roles"),
                format!("unknown specialist role `{role_key}`"),
            );
        }
    }
}

fn validate_action(
    issues: &mut Vec<PackValidationIssue>,
    path: &str,
    action: &ActionTemplate,
    ir_version: u16,
    role_keys: &BTreeSet<&str>,
    alignments: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
    effect_policies: &BTreeMap<Tag, EffectPolicy>,
    team_kill_action_ids: &BTreeSet<&str>,
    vanilla_roles: &[RoleKey],
    cadence: &BTreeSet<PhaseKind>,
) {
    if action.id.trim().is_empty() {
        issue(issues, format!("{path}.id"), "action id must not be empty");
    }
    validate_source_ids(issues, path, action);
    validate_unique_abilities(
        issues,
        format!("{path}.additional_abilities"),
        &action.additional_abilities,
    );
    if action.additional_abilities.contains(&action.ability) {
        issue(
            issues,
            format!("{path}.additional_abilities"),
            "additional_abilities cannot repeat the primary ability",
        );
    }
    let abilities: BTreeSet<IrAbility> = action.abilities().collect();
    if ir_version < 2 && abilities.contains(&IrAbility::Grant) {
        issue(
            issues,
            format!("{path}.ability"),
            "Grant requires ir_version >= 2",
        );
    }
    if ir_version < 3 && abilities.contains(&IrAbility::Link) {
        issue(
            issues,
            format!("{path}.ability"),
            "Link requires ir_version >= 3",
        );
    }
    if ir_version < 4 && abilities.contains(&IrAbility::Retaliate) {
        issue(
            issues,
            format!("{path}.ability"),
            "Retaliate requires ir_version >= 4",
        );
    }
    if ir_version < 5 && action.modifiers.contains(&Modifier::Babysitter) {
        issue(
            issues,
            format!("{path}.modifiers"),
            "Babysitter requires ir_version >= 5",
        );
    }
    if ir_version < 6 && action.modifiers.contains(&Modifier::Hider) {
        issue(
            issues,
            format!("{path}.modifiers"),
            "Hider requires ir_version >= 6",
        );
    }
    if ir_version < 57 && action.modifiers.contains(&Modifier::Disloyal) {
        issue(
            issues,
            format!("{path}.modifiers"),
            "Disloyal requires ir_version >= 57",
        );
    }
    if ir_version < 7 && abilities.contains(&IrAbility::Badge) {
        issue(
            issues,
            format!("{path}.ability"),
            "Badge requires ir_version >= 7",
        );
    }
    if ir_version < 8 && abilities.contains(&IrAbility::Duel) {
        issue(
            issues,
            format!("{path}.ability"),
            "Duel requires ir_version >= 8",
        );
    }
    if ir_version < 9 && abilities.contains(&IrAbility::ItaShot) {
        issue(
            issues,
            format!("{path}.ability"),
            "ItaShot requires ir_version >= 9",
        );
    }
    if ir_version < 10 && abilities.contains(&IrAbility::SelfDestruct) {
        issue(
            issues,
            format!("{path}.ability"),
            "SelfDestruct requires ir_version >= 10",
        );
    }
    if ir_version < 24 && abilities.contains(&IrAbility::Visit) {
        issue(
            issues,
            format!("{path}.ability"),
            "Visit requires ir_version >= 24",
        );
    }
    if ir_version < 33 && abilities.contains(&IrAbility::RevealTown) {
        issue(
            issues,
            format!("{path}.ability"),
            "RevealTown requires ir_version >= 33",
        );
    }
    if ir_version < 34 && abilities.contains(&IrAbility::VoteDuel) {
        issue(
            issues,
            format!("{path}.ability"),
            "VoteDuel requires ir_version >= 34",
        );
    }
    if ir_version < 47 && abilities.contains(&IrAbility::Veto) {
        issue(
            issues,
            format!("{path}.ability"),
            "Veto requires ir_version >= 47",
        );
    }
    if action.modifiers.contains(&Modifier::Babysitter) && !abilities.contains(&IrAbility::Protect)
    {
        issue(
            issues,
            format!("{path}.modifiers"),
            "Babysitter modifier is only legal on Protect actions",
        );
    }
    if action.modifiers.contains(&Modifier::Hider) {
        if !abilities.contains(&IrAbility::Mark) {
            issue(
                issues,
                format!("{path}.modifiers"),
                "Hider modifier is only legal on Mark actions",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "Hider actions must target exactly one host slot",
            );
        }
        match &action.effect {
            Some(effect) => {
                let duration = action
                    .effect_duration
                    .or_else(|| effect_policies.get(effect).map(|policy| policy.duration))
                    .unwrap_or(EffectDuration::Persistent);
                if duration != EffectDuration::Resolution {
                    issue(
                        issues,
                        format!("{path}.effect_duration"),
                        "Hider link effects must be resolution-scoped",
                    );
                }
            }
            None => issue(
                issues,
                format!("{path}.effect"),
                "Hider actions must declare a link effect",
            ),
        }
    }
    if abilities.contains(&IrAbility::Investigate) {
        if action.mode.is_none() {
            issue(
                issues,
                format!("{path}.mode"),
                "Investigate actions must declare mode",
            );
        }
        if ir_version < 24 && matches!(action.mode, Some(InvestigateMode::PriorMotion)) {
            issue(
                issues,
                format!("{path}.mode"),
                "PriorMotion requires ir_version >= 24",
            );
        }
        if ir_version < 36
            && matches!(
                action.mode,
                Some(
                    InvestigateMode::Vanilla
                        | InvestigateMode::Neapolitan
                        | InvestigateMode::Gunsmith
                )
            )
        {
            issue(
                issues,
                format!("{path}.mode"),
                "role-set investigation modes require ir_version >= 36",
            );
        }
        if ir_version < 50 && matches!(action.mode, Some(InvestigateMode::Killer)) {
            issue(
                issues,
                format!("{path}.mode"),
                "killer role-set investigation mode requires ir_version >= 50",
            );
        }
        if ir_version < 51 && matches!(action.mode, Some(InvestigateMode::Specialist)) {
            issue(
                issues,
                format!("{path}.mode"),
                "specialist role-set investigation mode requires ir_version >= 51",
            );
        }
        if ir_version < 52 && matches!(action.mode, Some(InvestigateMode::PtAccess)) {
            issue(
                issues,
                format!("{path}.mode"),
                "PT access investigation mode requires ir_version >= 52",
            );
        }
        if ir_version < 37 && matches!(action.mode, Some(InvestigateMode::Role)) {
            issue(
                issues,
                format!("{path}.mode"),
                "role disclosure investigation modes require ir_version >= 37",
            );
        }
        if ir_version < 38 && matches!(action.mode, Some(InvestigateMode::FullRole)) {
            issue(
                issues,
                format!("{path}.mode"),
                "full role disclosure investigation modes require ir_version >= 38",
            );
        }
        if ir_version < 55
            && matches!(
                action.mode,
                Some(
                    InvestigateMode::RoleWatcher
                        | InvestigateMode::RoleGuard
                        | InvestigateMode::SecurityGuard
                )
            )
        {
            issue(
                issues,
                format!("{path}.mode"),
                "visitor role/identity investigation modes require ir_version >= 55",
            );
        }
        if ir_version < 56 && matches!(action.mode, Some(InvestigateMode::Voyeur)) {
            issue(
                issues,
                format!("{path}.mode"),
                "voyeur action investigation mode requires ir_version >= 56",
            );
        }
        if ir_version < 61 && matches!(action.mode, Some(InvestigateMode::ActionType)) {
            issue(
                issues,
                format!("{path}.mode"),
                "action-type follow investigation mode requires ir_version >= 61",
            );
        }
    } else if action.mode.is_some() {
        issue(
            issues,
            format!("{path}.mode"),
            "mode is only legal on Investigate actions",
        );
    }
    if abilities.contains(&IrAbility::Info) {
        if ir_version < 54 {
            issue(
                issues,
                format!("{path}.ability"),
                "Info requires ir_version >= 54",
            );
        }
        let Some(info) = &action.info else {
            issue(
                issues,
                format!("{path}.info"),
                "Info actions must declare info",
            );
            return;
        };
        if info.kind.trim().is_empty() {
            issue(
                issues,
                format!("{path}.info.kind"),
                "info kind must not be empty",
            );
        }
        if matches!(
            info.audience,
            InfoAudience::Target | InfoAudience::ActorAndTarget
        ) && (action.targets == TargetSpec::None || action.constraints.max_targets == 0)
        {
            issue(
                issues,
                format!("{path}.info.audience"),
                "target-audience Info actions require targets",
            );
        }
    } else if action.info.is_some() {
        issue(
            issues,
            format!("{path}.info"),
            "info is only legal on Info actions",
        );
    }
    if let Some(memory) = &action.result_memory {
        if ir_version < 23 {
            issue(
                issues,
                format!("{path}.result_memory"),
                "result_memory requires ir_version >= 23",
            );
        }
        if !abilities.contains(&IrAbility::Investigate) {
            issue(
                issues,
                format!("{path}.result_memory"),
                "result_memory is only legal on Investigate actions",
            );
        }
        if !memory.record && !memory.compare_previous {
            issue(
                issues,
                format!("{path}.result_memory"),
                "result_memory must enable record or compare_previous",
            );
        }
        if ir_version < 39
            && (memory.scope != ResultMemoryScope::Target
                || memory.output != ResultMemoryOutput::PreviousCurrentChanged)
        {
            issue(
                issues,
                format!("{path}.result_memory"),
                "investigator-scoped or same/different result memory requires ir_version >= 39",
            );
        }
    }
    if action.constraints.target_role_filter.is_some() {
        if ir_version < 40 {
            issue(
                issues,
                format!("{path}.constraints.target_role_filter"),
                "target_role_filter requires ir_version >= 40",
            );
        }
        if action.targets == TargetSpec::None || action.constraints.max_targets == 0 {
            issue(
                issues,
                format!("{path}.constraints.target_role_filter"),
                "target_role_filter requires a targetful action",
            );
        }
        if action.constraints.personal_only {
            issue(
                issues,
                format!("{path}.constraints.target_role_filter"),
                "target_role_filter is not legal on personal-only actions",
            );
        }
        if vanilla_roles.is_empty() {
            issue(
                issues,
                format!("{path}.constraints.target_role_filter"),
                "target_role_filter requires investigation_results.role_sets.vanilla_roles",
            );
        }
    }

    let effect_abilities = abilities.contains(&IrAbility::Mark)
        || abilities.contains(&IrAbility::Clear)
        || abilities.contains(&IrAbility::Convert)
        || abilities.contains(&IrAbility::Link);
    if abilities.contains(&IrAbility::Mark) || abilities.contains(&IrAbility::Clear) {
        if action.effect.is_none() {
            issue(
                issues,
                format!("{path}.effect"),
                "Mark/Clear actions must declare effect",
            );
        }
    }
    if (abilities.contains(&IrAbility::Mark)
        || abilities.contains(&IrAbility::Clear)
        || abilities.contains(&IrAbility::Link))
        && action
            .effect
            .as_ref()
            .is_some_and(|effect| !effect_policies.contains_key(effect))
    {
        issue(
            issues,
            format!("{path}.effect"),
            "Mark/Clear/Link action effects must declare effects metadata",
        );
    }
    if abilities.contains(&IrAbility::Convert) {
        if action.effect.is_some() && action.conversion.is_some() {
            issue(
                issues,
                format!("{path}.conversion"),
                "Convert actions must not declare both effect and conversion",
            );
        }
        match (&action.effect, &action.conversion) {
            (Some(role_key), None) if !role_keys.contains(role_key.as_str()) => issue(
                issues,
                format!("{path}.effect"),
                format!("Convert effect must reference a role; unknown role `{role_key}`"),
            ),
            (Some(_), None) => {}
            (None, Some(conversion)) => validate_conversion_spec(
                issues,
                &format!("{path}.conversion"),
                conversion,
                role_keys,
            ),
            (None, None) => issue(
                issues,
                format!("{path}.conversion"),
                "Convert actions must declare effect or conversion",
            ),
            (Some(_), Some(conversion)) => validate_conversion_spec(
                issues,
                &format!("{path}.conversion"),
                conversion,
                role_keys,
            ),
        }
    } else if action.effect.is_some() && !effect_abilities {
        issue(
            issues,
            format!("{path}.effect"),
            "effect is only legal on Mark, Clear, Convert, and Link actions",
        );
    }
    if action.conversion.is_some() && !abilities.contains(&IrAbility::Convert) {
        issue(
            issues,
            format!("{path}.conversion"),
            "conversion is only legal on Convert actions",
        );
    }
    if action.effect_duration.is_some() && !abilities.contains(&IrAbility::Mark) {
        issue(
            issues,
            format!("{path}.effect_duration"),
            "effect_duration is only legal on Mark actions",
        );
    }
    if action.effect.as_deref() == Some("untargetable") {
        if !abilities.contains(&IrAbility::Mark) {
            issue(
                issues,
                format!("{path}.effect"),
                "untargetable target-state actions must use Mark ability",
            );
        }
        let duration = action
            .effect_duration
            .or_else(|| {
                action
                    .effect
                    .as_ref()
                    .and_then(|effect| effect_policies.get(effect).map(|policy| policy.duration))
            })
            .unwrap_or(EffectDuration::Persistent);
        if duration != EffectDuration::Resolution {
            issue(
                issues,
                format!("{path}.effect_duration"),
                "untargetable target-state actions must be resolution-scoped",
            );
        }
        if action.targets == TargetSpec::None || action.constraints.max_targets == 0 {
            issue(
                issues,
                format!("{path}.targets"),
                "untargetable target-state actions must target at least one slot",
            );
        }
    }
    if action.effect.as_deref() == Some("poisoned") && abilities.contains(&IrAbility::Mark) {
        let duration = action
            .effect_duration
            .or_else(|| {
                action
                    .effect
                    .as_ref()
                    .and_then(|effect| effect_policies.get(effect).map(|policy| policy.duration))
            })
            .unwrap_or(EffectDuration::Persistent);
        if duration != EffectDuration::Persistent {
            issue(
                issues,
                format!("{path}.effect_duration"),
                "poisoned delayed-death marks must be persistent",
            );
        }
    }
    if abilities.contains(&IrAbility::Grant) {
        if action.grant.is_none() && action.grant_options.is_empty() {
            issue(
                issues,
                format!("{path}.grant"),
                "Grant actions must declare grant or grant_options",
            );
        }
        if action.grant.is_some() && !action.grant_options.is_empty() {
            issue(
                issues,
                format!("{path}.grant_options"),
                "Grant actions must declare either grant or grant_options, not both",
            );
        }
        if let Some(grant) = &action.grant {
            validate_grant_payload(issues, format!("{path}.grant"), grant);
        }
        let mut seen_grants = BTreeSet::new();
        for (idx, grant) in action.grant_options.iter().enumerate() {
            let option_path = format!("{path}.grant_options[{idx}]");
            validate_grant_payload(issues, option_path.clone(), grant);
            if !seen_grants.insert(grant.grant_id.as_str()) {
                issue(
                    issues,
                    format!("{option_path}.grant_id"),
                    format!("duplicate grant option `{}`", grant.grant_id),
                );
            }
        }
    } else if action.grant.is_some() || !action.grant_options.is_empty() {
        issue(
            issues,
            if action.grant.is_some() {
                format!("{path}.grant")
            } else {
                format!("{path}.grant_options")
            },
            "grant is only legal on Grant actions",
        );
    }
    if abilities.contains(&IrAbility::Badge) {
        match &action.badge {
            Some(badge) => {
                if badge.badge_id.trim().is_empty() {
                    issue(
                        issues,
                        format!("{path}.badge.badge_id"),
                        "badge_id must not be empty",
                    );
                }
                if let Some(vote_weight) = badge.vote_weight {
                    if !vote_weight.is_finite() || vote_weight <= 0.0 {
                        issue(
                            issues,
                            format!("{path}.badge.vote_weight"),
                            "badge vote_weight must be finite and greater than zero",
                        );
                    }
                }
                match badge.operation {
                    BadgeOperation::Elect | BadgeOperation::Pass => {
                        if action.targets != TargetSpec::One || action.constraints.max_targets != 1
                        {
                            issue(
                                issues,
                                format!("{path}.targets"),
                                "Badge Elect/Pass actions must target exactly one slot",
                            );
                        }
                    }
                    BadgeOperation::Destroy => {
                        if action.targets != TargetSpec::None || action.constraints.max_targets != 0
                        {
                            issue(
                                issues,
                                format!("{path}.targets"),
                                "Badge Destroy actions must not target slots",
                            );
                        }
                    }
                }
            }
            None => issue(
                issues,
                format!("{path}.badge"),
                "Badge actions must declare badge",
            ),
        }
    } else if action.badge.is_some() {
        issue(
            issues,
            format!("{path}.badge"),
            "badge is only legal on Badge actions",
        );
    }
    if abilities.contains(&IrAbility::Duel) {
        match &action.duel {
            Some(duel) => {
                if duel.hostile_alignments.is_empty() {
                    issue(
                        issues,
                        format!("{path}.duel.hostile_alignments"),
                        "Duel actions must declare at least one hostile alignment",
                    );
                }
                let mut seen = BTreeSet::new();
                for alignment in &duel.hostile_alignments {
                    if alignment.trim().is_empty() {
                        issue(
                            issues,
                            format!("{path}.duel.hostile_alignments"),
                            "Duel hostile alignments must not be empty",
                        );
                    } else if !alignments.contains(alignment.as_str()) {
                        issue(
                            issues,
                            format!("{path}.duel.hostile_alignments"),
                            format!("unknown hostile alignment `{alignment}`"),
                        );
                    } else if !seen.insert(alignment.as_str()) {
                        issue(
                            issues,
                            format!("{path}.duel.hostile_alignments"),
                            format!("duplicate hostile alignment `{alignment}`"),
                        );
                    }
                }
                if action.window != Window::Day {
                    issue(
                        issues,
                        format!("{path}.window"),
                        "Duel actions must use the Day window",
                    );
                }
                if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
                    issue(
                        issues,
                        format!("{path}.targets"),
                        "Duel actions must target exactly one slot",
                    );
                }
            }
            None => issue(
                issues,
                format!("{path}.duel"),
                "Duel actions must declare duel",
            ),
        }
    } else if action.duel.is_some() {
        issue(
            issues,
            format!("{path}.duel"),
            "duel is only legal on Duel actions",
        );
    }
    if let Some(failback) = &action.alignment_failback {
        if ir_version < 41 {
            issue(
                issues,
                format!("{path}.alignment_failback"),
                "alignment_failback requires ir_version >= 41",
            );
        }
        if !abilities.contains(&IrAbility::Kill) {
            issue(
                issues,
                format!("{path}.alignment_failback"),
                "alignment_failback is only legal on Kill actions",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "alignment_failback actions must target exactly one slot",
            );
        }
        if failback.hostile_alignments.is_empty() {
            issue(
                issues,
                format!("{path}.alignment_failback.hostile_alignments"),
                "alignment_failback must declare at least one hostile alignment",
            );
        }
        let mut seen = BTreeSet::new();
        for alignment in &failback.hostile_alignments {
            if alignment.trim().is_empty() {
                issue(
                    issues,
                    format!("{path}.alignment_failback.hostile_alignments"),
                    "alignment_failback hostile alignment must not be empty",
                );
            } else if !alignments.contains(alignment.as_str()) {
                issue(
                    issues,
                    format!("{path}.alignment_failback.hostile_alignments"),
                    format!("unknown hostile alignment `{alignment}`"),
                );
            } else if !seen.insert(alignment.as_str()) {
                issue(
                    issues,
                    format!("{path}.alignment_failback.hostile_alignments"),
                    format!("duplicate hostile alignment `{alignment}`"),
                );
            }
        }
    }
    if abilities.contains(&IrAbility::VoteDuel) {
        if action.window != Window::Day {
            issue(
                issues,
                format!("{path}.window"),
                "VoteDuel actions must use the Day window",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "VoteDuel actions must target exactly one slot",
            );
        }
        if action.duel.is_some() {
            issue(
                issues,
                format!("{path}.duel"),
                "VoteDuel actions must not declare lethal duel config",
            );
        }
    }
    if abilities.contains(&IrAbility::Veto) {
        if action.window != Window::Day {
            issue(
                issues,
                format!("{path}.window"),
                "Veto actions must use the Day window",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "Veto actions must target exactly one slot",
            );
        }
    }
    if abilities.contains(&IrAbility::ItaShot) {
        if action.window != Window::Day {
            issue(
                issues,
                format!("{path}.window"),
                "ItaShot actions must use the Day window",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "ItaShot actions must target exactly one slot",
            );
        }
    }
    if abilities.contains(&IrAbility::SelfDestruct) {
        match &action.self_destruct {
            Some(spec) => {
                if spec.cause.trim().is_empty() {
                    issue(
                        issues,
                        format!("{path}.self_destruct.cause"),
                        "SelfDestruct cause must not be empty",
                    );
                }
                if !spec.kill_target && !spec.sacrifice_actor {
                    issue(
                        issues,
                        format!("{path}.self_destruct"),
                        "SelfDestruct must kill the target or sacrifice the actor",
                    );
                }
            }
            None => issue(
                issues,
                format!("{path}.self_destruct"),
                "SelfDestruct actions must declare self_destruct",
            ),
        }
        if !matches!(
            action.window,
            Window::Day | Window::Twilight | Window::Instant
        ) {
            issue(
                issues,
                format!("{path}.window"),
                "SelfDestruct actions must use the Day, Twilight, or Instant window",
            );
        }
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "SelfDestruct actions must target exactly one slot",
            );
        }
    } else if action.self_destruct.is_some() {
        issue(
            issues,
            format!("{path}.self_destruct"),
            "self_destruct is only legal on SelfDestruct actions",
        );
    }
    if abilities.contains(&IrAbility::Link) {
        if action.targets != TargetSpec::Many || action.constraints.max_targets < 2 {
            issue(
                issues,
                format!("{path}.targets"),
                "Link actions must target at least two unique slots",
            );
        }
    }
    if abilities.contains(&IrAbility::Retaliate) {
        if action.targets != TargetSpec::One || action.constraints.max_targets != 1 {
            issue(
                issues,
                format!("{path}.targets"),
                "Retaliate actions must target exactly one slot",
            );
        }
    }

    if let Some(tag) = &action.reads_effect {
        if !abilities.contains(&IrAbility::Kill) {
            issue(
                issues,
                format!("{path}.reads_effect"),
                "reads_effect is only legal on Kill actions",
            );
        }
        if !effect_tags.contains(tag.as_str()) {
            issue(
                issues,
                format!("{path}.reads_effect"),
                format!("unknown effect tag `{tag}`"),
            );
        }
    }

    if abilities.contains(&IrAbility::Redirect) {
        if action.redirect.is_none() {
            issue(
                issues,
                format!("{path}.redirect"),
                "Redirect actions must declare redirect kind",
            );
        }
    } else if action.redirect.is_some() {
        issue(
            issues,
            format!("{path}.redirect"),
            "redirect is only legal on Redirect actions",
        );
    }

    if matches!(action.ability, IrAbility::Clear | IrAbility::Link) {
        if let Some(tag) = &action.effect {
            if !effect_tags.contains(tag.as_str()) {
                issue(
                    issues,
                    format!("{path}.effect"),
                    format!("unknown effect tag `{tag}`"),
                );
            }
        }
    }

    match action.targets {
        TargetSpec::None if action.constraints.max_targets != 0 => issue(
            issues,
            format!("{path}.constraints.max_targets"),
            "TargetSpec::None requires max_targets = 0",
        ),
        TargetSpec::One if action.constraints.max_targets != 1 => issue(
            issues,
            format!("{path}.constraints.max_targets"),
            "TargetSpec::One requires max_targets = 1",
        ),
        TargetSpec::Many | TargetSpec::Group if action.constraints.max_targets == 0 => issue(
            issues,
            format!("{path}.constraints.max_targets"),
            "multi-target actions require max_targets > 0",
        ),
        _ => {}
    }
    if action.targets == TargetSpec::None
        && !matches!(
            action.constraints.target_state,
            None | Some(TargetState::Any)
        )
    {
        issue(
            issues,
            format!("{path}.constraints.target_state"),
            "TargetSpec::None requires target_state = Any",
        );
    }
    if action.targets == TargetSpec::None && action.constraints.target_role_filter.is_some() {
        issue(
            issues,
            format!("{path}.constraints.target_role_filter"),
            "TargetSpec::None cannot declare target_role_filter",
        );
    }
    if action.has_modifier(Modifier::Reflexive) && !action.constraints.self_allowed {
        issue(
            issues,
            format!("{path}.constraints.self_allowed"),
            "Reflexive actions must allow self-targeting",
        );
    }
    if action.targets != TargetSpec::None
        && action.constraints.self_allowed
        && !action.has_modifier(Modifier::Reflexive)
    {
        issue(
            issues,
            format!("{path}.modifiers"),
            "self_allowed actions must declare Reflexive",
        );
    }
    if action.has_modifier(Modifier::Personal) && !action.constraints.personal_only {
        issue(
            issues,
            format!("{path}.constraints.personal_only"),
            "Personal actions must declare personal_only",
        );
    }
    if action.constraints.personal_only && !action.has_modifier(Modifier::Personal) {
        issue(
            issues,
            format!("{path}.modifiers"),
            "personal_only actions must declare Personal",
        );
    }
    if action.constraints.personal_only && !action.constraints.self_allowed {
        issue(
            issues,
            format!("{path}.constraints.self_allowed"),
            "personal_only actions must allow self-targeting",
        );
    }
    if action.constraints.personal_only
        && (action.targets != TargetSpec::One || action.constraints.max_targets != 1)
    {
        issue(
            issues,
            format!("{path}.targets"),
            "personal_only actions must target exactly one self slot",
        );
    }
    if action.has_modifier(Modifier::Lazy) && !action.constraints.lazy_requires_multiple_non_town {
        issue(
            issues,
            format!("{path}.constraints.lazy_requires_multiple_non_town"),
            "Lazy actions must declare lazy_requires_multiple_non_town",
        );
    }
    if action.constraints.lazy_requires_multiple_non_town && !action.has_modifier(Modifier::Lazy) {
        issue(
            issues,
            format!("{path}.modifiers"),
            "lazy_requires_multiple_non_town actions must declare Lazy",
        );
    }
    if action.has_modifier(Modifier::DisabledEndgame)
        && action.constraints.disabled_at_or_below_alive.is_none()
    {
        issue(
            issues,
            format!("{path}.constraints.disabled_at_or_below_alive"),
            "DisabledEndgame actions must declare disabled_at_or_below_alive",
        );
    }
    if let Some(threshold) = action.constraints.disabled_at_or_below_alive {
        if !action.has_modifier(Modifier::DisabledEndgame) {
            issue(
                issues,
                format!("{path}.modifiers"),
                "disabled_at_or_below_alive actions must declare DisabledEndgame",
            );
        }
        if threshold == 0 {
            issue(
                issues,
                format!("{path}.constraints.disabled_at_or_below_alive"),
                "disabled_at_or_below_alive must be greater than zero",
            );
        }
    }
    if action.has_modifier(Modifier::Uncooperative)
        && action.constraints.uncooperative_result.is_none()
    {
        issue(
            issues,
            format!("{path}.constraints.uncooperative_result"),
            "Uncooperative actions must declare uncooperative_result",
        );
    }
    if let Some(result) = &action.constraints.uncooperative_result {
        if !action.has_modifier(Modifier::Uncooperative) {
            issue(
                issues,
                format!("{path}.modifiers"),
                "uncooperative_result actions must declare Uncooperative",
            );
        }
        if action.ability != IrAbility::Investigate {
            issue(
                issues,
                format!("{path}.constraints.uncooperative_result"),
                "uncooperative_result is only legal on Investigate actions",
            );
        }
        if result.trim().is_empty() {
            issue(
                issues,
                format!("{path}.constraints.uncooperative_result"),
                "uncooperative_result must not be empty",
            );
        }
    }
    if action.has_modifier(Modifier::Simultaneous)
        && team_kill_action_ids.contains(action.id.as_str())
    {
        issue(
            issues,
            format!("{path}.modifiers"),
            "Simultaneous actions must not be standard_nar team kills",
        );
    }
    if action.has_modifier(Modifier::Disloyal) && action.targets == TargetSpec::None {
        issue(
            issues,
            format!("{path}.targets"),
            "Disloyal actions must target at least one slot",
        );
    }

    match action.redirect {
        Some(RedirectKind::Swap | RedirectKind::Retarget)
            if action.constraints.max_targets != 2 =>
        {
            issue(
                issues,
                format!("{path}.constraints.max_targets"),
                "Swap/Retarget redirects require max_targets = 2",
            );
        }
        Some(RedirectKind::Rotate) if ir_version < 25 => {
            issue(
                issues,
                format!("{path}.redirect"),
                "Rotate redirects require ir_version >= 25",
            );
        }
        Some(RedirectKind::Rotate)
            if action.targets != TargetSpec::Many || action.constraints.max_targets < 3 =>
        {
            issue(
                issues,
                format!("{path}.constraints.max_targets"),
                "Rotate redirects require Many targets with max_targets >= 3",
            );
        }
        Some(RedirectKind::Pull) if action.constraints.max_targets > 1 => {
            issue(
                issues,
                format!("{path}.constraints.max_targets"),
                "Pull redirects require max_targets <= 1",
            );
        }
        _ => {}
    }

    if let Some(shots) = action.constraints.x_shots {
        if shots == 0 {
            issue(
                issues,
                format!("{path}.constraints.x_shots"),
                "x_shots must be greater than zero when present",
            );
        }
    }

    if action.constraints.cooldown_cycles == Some(0) {
        issue(
            issues,
            format!("{path}.constraints.cooldown_cycles"),
            "cooldown_cycles must be greater than zero when present",
        );
    }

    if action.constraints.phase_parity.is_some() && action.constraints.cycle_parity.is_some() {
        issue(
            issues,
            format!("{path}.constraints.cycle_parity"),
            "cycle_parity must not be combined with phase_parity",
        );
    }

    if let Some(active_from) = &action.constraints.active_from {
        if active_from.phase_number == 0 {
            issue(
                issues,
                format!("{path}.constraints.active_from.phase_number"),
                "active_from.phase_number must be greater than zero",
            );
        }
        let window_matches = action.window.matches_phase_kind(active_from.phase_kind);
        if !window_matches {
            issue(
                issues,
                format!("{path}.constraints.active_from.phase_kind"),
                "active_from.phase_kind must match the action window",
            );
        }
    }

    if cadence.is_empty() {
        issue(
            issues,
            "phases.cadence",
            "phase cadence must declare at least one phase kind",
        );
    } else if let Some(required) = action.window.required_phase_kind() {
        if !cadence.contains(&required) {
            issue(
                issues,
                format!("{path}.window"),
                format!(
                    "action window {:?} is absent from phases.cadence",
                    action.window
                ),
            );
        }
    }
}

fn validate_pack_required_ir_version(issues: &mut Vec<PackValidationIssue>, pack: &Pack) {
    let (required, reasons) = pack_required_ir_version(pack);
    if pack.ir_version < required {
        issue(
            issues,
            "ir_version",
            format!(
                "pack declares features requiring ir_version >= {required}: {}",
                reasons.into_iter().collect::<Vec<_>>().join(", ")
            ),
        );
    }
}

fn pack_required_ir_version(pack: &Pack) -> (u16, BTreeSet<&'static str>) {
    let mut required = MIN_SUPPORTED_IR_VERSION;
    let mut reasons = BTreeSet::new();

    for (_, action) in standard_nar_pack_actions(pack) {
        record_action_required_ir_version(action, &mut required, &mut reasons);
    }
    if pack.roles.values().any(|role| !role.modifiers.is_empty()) {
        require_ir(&mut required, &mut reasons, 27, "role_modifiers");
    }

    if pack.wolf_carry.enabled {
        require_ir(&mut required, &mut reasons, 11, "wolf_carry");
    }
    if !pack.ita.role_overrides.is_empty() {
        require_ir(&mut required, &mut reasons, 31, "ita.role_overrides");
    }
    if !pack.ita.modifier_components.is_empty() || !pack.ita.role_modifier_refs.is_empty() {
        require_ir(&mut required, &mut reasons, 32, "ita.modifier_components");
    }
    if pack
        .ita
        .modifier_components
        .values()
        .any(|component| component.hit_points > 0)
        || pack
            .ita
            .role_overrides
            .values()
            .any(|override_policy| override_policy.hit_points > 0)
    {
        require_ir(&mut required, &mut reasons, 61, "ita.hit_points");
    }
    if pack.ita.resolution_policy != ItaResolutionPolicy::default() {
        require_ir(&mut required, &mut reasons, 60, "ita.resolution_policy");
    }
    if pack
        .ita
        .sessions
        .iter()
        .any(|session| session.buffer_delay_ms.is_some())
    {
        require_ir(
            &mut required,
            &mut reasons,
            59,
            "ita.session.buffer_delay_ms",
        );
    }
    if pack.wolf_beauty.enabled {
        require_ir(&mut required, &mut reasons, 12, "wolf_beauty");
    }
    if pack.guard_policy.enabled {
        require_ir(&mut required, &mut reasons, 13, "guard_policy");
    }
    if pack.faction_actions.enabled {
        require_ir(&mut required, &mut reasons, 35, "faction_actions");
    }
    if pack.death_retaliation.enabled {
        require_ir(&mut required, &mut reasons, 14, "death_retaliation");
    }
    if pack.idiot_policy.enabled {
        require_ir(&mut required, &mut reasons, 15, "idiot_policy");
    }
    if pack.saulus_policy.enabled {
        require_ir(&mut required, &mut reasons, 62, "saulus_policy");
    }
    if pack.lover_policy.enabled {
        require_ir(&mut required, &mut reasons, 16, "lover_policy");
    }
    if pack.backup_policy.enabled {
        require_ir(&mut required, &mut reasons, 17, "backup_policy");
    }
    if pack.private_channels.enabled {
        require_ir(&mut required, &mut reasons, 29, "private_channels");
    }
    if pack
        .private_channels
        .groups
        .iter()
        .any(|group| !group.excluded_roles.is_empty())
    {
        require_ir(
            &mut required,
            &mut reasons,
            64,
            "private_channels.excluded_roles",
        );
    }
    if pack.treestump_policy.enabled {
        require_ir(&mut required, &mut reasons, 30, "treestump_policy");
    }
    if !pack.target_lynch_win_policies.is_empty() {
        require_ir(&mut required, &mut reasons, 19, "target_lynch_win_policies");
    }
    if !pack.win.survival_awards.is_empty() {
        require_ir(&mut required, &mut reasons, 63, "win.survival_awards");
    }
    if pack.beloved_princess_policy.enabled {
        require_ir(&mut required, &mut reasons, 20, "beloved_princess_policy");
    }
    if pack.beloved_princess_policy.all_death_causes {
        require_ir(
            &mut required,
            &mut reasons,
            65,
            "beloved_princess_policy.all_death_causes",
        );
    }
    if !pack.day_vote_prompt_policies.is_empty() {
        require_ir(&mut required, &mut reasons, 21, "day_vote_prompt_policies");
    }
    if !pack.vote.tiebreaker_roles.is_empty() {
        require_ir(&mut required, &mut reasons, 58, "vote.tiebreaker_roles");
    }
    if !pack.host_prompt_resolution_effects.is_empty() {
        require_ir(
            &mut required,
            &mut reasons,
            22,
            "host_prompt_resolution_effects",
        );
    }
    if !pack.self_lynch_win_policies.is_empty() {
        require_ir(&mut required, &mut reasons, 25, "self_lynch_win_policies");
    }
    if pack.death_reveal != DeathRevealPolicy::default() {
        require_ir(&mut required, &mut reasons, 26, "death_reveal");
    }
    if !pack.effect_source_death_reveals.is_empty() {
        require_ir(
            &mut required,
            &mut reasons,
            57,
            "effect_source_death_reveals",
        );
        if pack
            .effect_source_death_reveals
            .iter()
            .any(|policy| policy.reveal == EffectSourceDeathRevealKind::Role)
        {
            require_ir(
                &mut required,
                &mut reasons,
                58,
                "effect_source_death_reveals.Role",
            );
        }
    }
    if !pack.standard_nar.conflict_families.is_empty() {
        require_ir(
            &mut required,
            &mut reasons,
            44,
            "standard_nar.conflict_families",
        );
    }
    if !pack.visibility_families.is_empty() {
        require_ir(&mut required, &mut reasons, 45, "visibility_families");
    }
    if !pack.win_families.is_empty() {
        require_ir(&mut required, &mut reasons, 46, "win_families");
    }
    if pack
        .win
        .rules
        .iter()
        .any(|rule| !rule.blocked_by_alive.is_empty())
    {
        require_ir(&mut required, &mut reasons, 53, "win_rule_blockers");
    }
    if !pack.standard_nar.action_chance.is_empty() {
        require_ir(
            &mut required,
            &mut reasons,
            43,
            "standard_nar.action_chance",
        );
    }

    (required, reasons)
}

fn record_action_required_ir_version(
    action: &ActionTemplate,
    required: &mut u16,
    reasons: &mut BTreeSet<&'static str>,
) {
    if action.window == Window::Twilight {
        require_ir(required, reasons, 48, "Twilight action window");
    }
    if action.window == Window::Instant {
        require_ir(required, reasons, 49, "Instant action window");
    }

    for ability in action.abilities() {
        match ability {
            IrAbility::Grant => require_ir(required, reasons, 2, "Grant"),
            IrAbility::Link => require_ir(required, reasons, 3, "Link"),
            IrAbility::Retaliate => require_ir(required, reasons, 4, "Retaliate"),
            IrAbility::Badge => require_ir(required, reasons, 7, "Badge"),
            IrAbility::Duel => require_ir(required, reasons, 8, "Duel"),
            IrAbility::ItaShot => require_ir(required, reasons, 9, "ItaShot"),
            IrAbility::SelfDestruct => require_ir(required, reasons, 10, "SelfDestruct"),
            IrAbility::Visit => require_ir(required, reasons, 24, "Visit"),
            IrAbility::RevealTown => require_ir(required, reasons, 33, "RevealTown"),
            IrAbility::VoteDuel => require_ir(required, reasons, 34, "VoteDuel"),
            IrAbility::Veto => require_ir(required, reasons, 47, "Veto"),
            IrAbility::Info => require_ir(required, reasons, 54, "Info"),
            IrAbility::Kill
            | IrAbility::Protect
            | IrAbility::Block
            | IrAbility::Redirect
            | IrAbility::Investigate
            | IrAbility::Convert
            | IrAbility::Mark
            | IrAbility::Clear => {}
        }
    }

    if action.modifiers.contains(&Modifier::Babysitter) {
        require_ir(required, reasons, 5, "Babysitter");
    }
    if action.modifiers.contains(&Modifier::Hider) {
        require_ir(required, reasons, 6, "Hider");
    }
    if action.modifiers.contains(&Modifier::Disloyal) {
        require_ir(required, reasons, 57, "Disloyal");
    }
    if action.modifiers.contains(&Modifier::Simultaneous) {
        require_ir(required, reasons, 28, "Simultaneous");
    }
    if action.result_memory.is_some() {
        require_ir(required, reasons, 23, "result_memory");
    }
    if action.result_memory.as_ref().is_some_and(|memory| {
        memory.scope != ResultMemoryScope::Target
            || memory.output != ResultMemoryOutput::PreviousCurrentChanged
    }) {
        require_ir(
            required,
            reasons,
            39,
            "investigator-scoped or same/different result memory",
        );
    }
    if matches!(action.mode, Some(InvestigateMode::PriorMotion)) {
        require_ir(required, reasons, 24, "PriorMotion");
    }
    if matches!(
        action.mode,
        Some(InvestigateMode::Vanilla | InvestigateMode::Neapolitan | InvestigateMode::Gunsmith)
    ) {
        require_ir(required, reasons, 36, "role-set investigation modes");
    }
    if matches!(action.mode, Some(InvestigateMode::Killer)) {
        require_ir(required, reasons, 50, "killer role-set investigation mode");
    }
    if matches!(action.mode, Some(InvestigateMode::Specialist)) {
        require_ir(
            required,
            reasons,
            51,
            "specialist role-set investigation mode",
        );
    }
    if matches!(action.mode, Some(InvestigateMode::PtAccess)) {
        require_ir(required, reasons, 52, "PT access investigation mode");
    }
    if matches!(action.mode, Some(InvestigateMode::Role)) {
        require_ir(required, reasons, 37, "role disclosure investigation modes");
    }
    if matches!(action.mode, Some(InvestigateMode::FullRole)) {
        require_ir(
            required,
            reasons,
            38,
            "full role disclosure investigation modes",
        );
    }
    if matches!(
        action.mode,
        Some(
            InvestigateMode::RoleWatcher
                | InvestigateMode::RoleGuard
                | InvestigateMode::SecurityGuard
        )
    ) {
        require_ir(
            required,
            reasons,
            55,
            "visitor role/identity investigation modes",
        );
    }
    if matches!(action.mode, Some(InvestigateMode::Voyeur)) {
        require_ir(required, reasons, 56, "voyeur action investigation mode");
    }
    if matches!(action.mode, Some(InvestigateMode::ActionType)) {
        require_ir(
            required,
            reasons,
            61,
            "action-type follow investigation mode",
        );
    }
    if matches!(action.redirect, Some(RedirectKind::Rotate)) {
        require_ir(required, reasons, 25, "Rotate");
    }
    if action.constraints.target_role_filter.is_some() {
        require_ir(required, reasons, 40, "target_role_filter");
    }
    if action.alignment_failback.is_some() {
        require_ir(required, reasons, 41, "alignment_failback");
    }
    if !action.grant_options.is_empty() {
        require_ir(required, reasons, 42, "grant_options");
    }
}

fn validate_grant_spec(
    issues: &mut Vec<PackValidationIssue>,
    path: String,
    grant: &GrantSpec,
    pack: &Pack,
) {
    match grant.kind {
        GrantKind::ExtraAction => {
            if grant.vote_weight.is_some() {
                issue(
                    issues,
                    format!("{path}.vote_weight"),
                    "ExtraAction grants must not declare vote_weight",
                );
            }
        }
        GrantKind::Item => {
            if !pack.item_actions.contains_key(&grant.grant_id) {
                issue(
                    issues,
                    format!("{path}.grant_id"),
                    format!(
                        "Item grant `{}` must reference an item_actions entry",
                        grant.grant_id
                    ),
                );
            }
            if grant.vote_weight.is_some() {
                issue(
                    issues,
                    format!("{path}.vote_weight"),
                    "Item grants must not declare vote_weight",
                );
            }
        }
        GrantKind::VoteWeight => match grant.vote_weight {
            Some(weight) if weight.is_finite() && weight >= 0.0 => {}
            Some(weight) => issue(
                issues,
                format!("{path}.vote_weight"),
                format!(
                    "VoteWeight grant `{}` has invalid vote_weight {}; expected finite weight >= 0",
                    grant.grant_id, weight
                ),
            ),
            None => issue(
                issues,
                format!("{path}.vote_weight"),
                format!(
                    "VoteWeight grant `{}` must declare vote_weight",
                    grant.grant_id
                ),
            ),
        },
    }
}

fn validate_grant_payload(issues: &mut Vec<PackValidationIssue>, path: String, grant: &GrantSpec) {
    if grant.grant_id.trim().is_empty() {
        issue(
            issues,
            format!("{path}.grant_id"),
            "grant_id must not be empty",
        );
    }
    if grant.uses == 0 {
        issue(
            issues,
            format!("{path}.uses"),
            "grant uses must be greater than zero",
        );
    }
}

fn require_ir(
    required: &mut u16,
    reasons: &mut BTreeSet<&'static str>,
    version: u16,
    reason: &'static str,
) {
    *required = (*required).max(version);
    reasons.insert(reason);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn test_pack_value() -> Value {
        json!({
            "name": "version-map-test",
            "version": SUPPORTED_PACK_VERSION,
            "ir_version": SUPPORTED_IR_VERSION,
            "roles": {
                "townie": {
                    "description": "Town.",
                    "alignment": "town",
                    "actions": []
                }
            },
            "precedence": [],
            "visibility": {},
            "redirects": {
                "order": [],
                "loop_cap": 8,
                "tie_breaker": "Stable"
            },
            "triggers": [],
            "vote": {
                "method": "Plurality",
                "no_lynch_allowed": true,
                "self_vote_allowed": false,
                "hammer": false,
                "weights": "Equal",
                "threshold_adjustments": {},
                "tie_breaker": "NoElimination"
            },
            "phases": {
                "cadence": ["Day", "Night"],
                "subsegments": {},
                "twilight": false
            },
            "win": {
                "rules": []
            }
        })
    }

    fn test_pack_from_value(value: Value) -> Pack {
        serde_json::from_value(value).unwrap()
    }

    fn pack_required_from_value(value: Value) -> (u16, BTreeSet<&'static str>) {
        pack_required_ir_version(&test_pack_from_value(value))
    }

    fn test_action(ability: &str) -> Value {
        json!({
            "id": "versioned_action",
            "ability": ability,
            "window": "Night",
            "targets": "One",
            "modifiers": [],
            "constraints": {
                "max_targets": 1,
                "self_allowed": false,
                "unique_targets": true,
                "roleblockable": true,
                "priority": 10
            }
        })
    }

    fn pack_required_for_action(action: Value) -> (u16, BTreeSet<&'static str>) {
        let mut value = test_pack_value();
        value["roles"]["townie"]["actions"] = json!([action]);
        pack_required_from_value(value)
    }

    fn assert_versioned_action(action: Value, expected_version: u16, reason: &'static str) {
        let (required, reasons) = pack_required_for_action(action);
        assert_eq!(
            required, expected_version,
            "expected {reason} to require ir_version >= {expected_version}; got {required} from {reasons:?}"
        );
        assert!(
            reasons.contains(reason),
            "expected {reason} in required feature reasons {reasons:?}"
        );
    }

    fn assert_versioned_pack_feature(value: Value, expected_version: u16, reason: &'static str) {
        let (required, reasons) = pack_required_from_value(value);
        assert_eq!(
            required, expected_version,
            "expected {reason} to require ir_version >= {expected_version}; got {required} from {reasons:?}"
        );
        assert!(
            reasons.contains(reason),
            "expected {reason} in required feature reasons {reasons:?}"
        );
    }

    #[test]
    fn pack_required_ir_version_covers_versioned_action_features() {
        for (ability, expected_version, reason) in [
            ("Grant", 2, "Grant"),
            ("Link", 3, "Link"),
            ("Retaliate", 4, "Retaliate"),
            ("Badge", 7, "Badge"),
            ("Duel", 8, "Duel"),
            ("ItaShot", 9, "ItaShot"),
            ("SelfDestruct", 10, "SelfDestruct"),
            ("Visit", 24, "Visit"),
            ("RevealTown", 33, "RevealTown"),
            ("VoteDuel", 34, "VoteDuel"),
            ("Veto", 47, "Veto"),
            ("Info", 54, "Info"),
        ] {
            let mut action = test_action(ability);
            if ability == "Info" {
                action["info"] = json!({ "kind": "test_info" });
            }
            assert_versioned_action(action, expected_version, reason);
        }

        let mut twilight_action = test_action("SelfDestruct");
        twilight_action["window"] = json!("Twilight");
        twilight_action["self_destruct"] = json!({
            "cause": "twilight_self_destruct",
            "kill_target": true,
            "sacrifice_actor": true,
            "unstoppable": true
        });
        assert_versioned_action(twilight_action, 48, "Twilight action window");

        let mut instant_action = test_action("SelfDestruct");
        instant_action["window"] = json!("Instant");
        instant_action["self_destruct"] = json!({
            "cause": "instant_self_destruct",
            "kill_target": true,
            "sacrifice_actor": true,
            "unstoppable": true
        });
        assert_versioned_action(instant_action, 49, "Instant action window");

        let mut babysitter = test_action("Protect");
        babysitter["modifiers"] = json!(["Babysitter"]);
        assert_versioned_action(babysitter, 5, "Babysitter");

        let mut hider = test_action("Mark");
        hider["modifiers"] = json!(["Hider"]);
        hider["effect"] = json!("hide_link");
        assert_versioned_action(hider, 6, "Hider");

        let mut disloyal = test_action("Convert");
        disloyal["modifiers"] = json!(["Disloyal"]);
        disloyal["conversion"] = json!({
            "mode": "AssignRole",
            "role": "cultist"
        });
        assert_versioned_action(disloyal, 57, "Disloyal");

        let mut result_memory = test_action("Investigate");
        result_memory["result_memory"] = json!({ "record": true });
        assert_versioned_action(result_memory, 23, "result_memory");

        let mut investigator_scoped_memory = test_action("Investigate");
        investigator_scoped_memory["result_memory"] = json!({
            "record": true,
            "compare_previous": true,
            "scope": "Investigator",
            "output": "SameDifferent"
        });
        assert_versioned_action(
            investigator_scoped_memory,
            39,
            "investigator-scoped or same/different result memory",
        );

        let mut prior_motion = test_action("Investigate");
        prior_motion["mode"] = json!("PriorMotion");
        assert_versioned_action(prior_motion, 24, "PriorMotion");

        let mut role_set_mode = test_action("Investigate");
        role_set_mode["mode"] = json!("Vanilla");
        assert_versioned_action(role_set_mode, 36, "role-set investigation modes");

        let mut killer_mode = test_action("Investigate");
        killer_mode["mode"] = json!("Killer");
        assert_versioned_action(killer_mode, 50, "killer role-set investigation mode");

        let mut specialist_mode = test_action("Investigate");
        specialist_mode["mode"] = json!("Specialist");
        assert_versioned_action(
            specialist_mode,
            51,
            "specialist role-set investigation mode",
        );

        let mut pt_access_mode = test_action("Investigate");
        pt_access_mode["mode"] = json!("PtAccess");
        assert_versioned_action(pt_access_mode, 52, "PT access investigation mode");

        let mut role_disclosure_mode = test_action("Investigate");
        role_disclosure_mode["mode"] = json!("Role");
        assert_versioned_action(
            role_disclosure_mode,
            37,
            "role disclosure investigation modes",
        );

        let mut full_role_disclosure_mode = test_action("Investigate");
        full_role_disclosure_mode["mode"] = json!("FullRole");
        assert_versioned_action(
            full_role_disclosure_mode,
            38,
            "full role disclosure investigation modes",
        );

        for mode in ["RoleWatcher", "RoleGuard", "SecurityGuard"] {
            let mut visitor_identity_mode = test_action("Investigate");
            visitor_identity_mode["mode"] = json!(mode);
            assert_versioned_action(
                visitor_identity_mode,
                55,
                "visitor role/identity investigation modes",
            );
        }

        let mut voyeur_mode = test_action("Investigate");
        voyeur_mode["mode"] = json!("Voyeur");
        assert_versioned_action(voyeur_mode, 56, "voyeur action investigation mode");

        let mut action_type_mode = test_action("Investigate");
        action_type_mode["mode"] = json!("ActionType");
        assert_versioned_action(
            action_type_mode,
            61,
            "action-type follow investigation mode",
        );

        let mut rotate = test_action("Redirect");
        rotate["targets"] = json!("Many");
        rotate["constraints"]["max_targets"] = json!(3);
        rotate["redirect"] = json!("Rotate");
        assert_versioned_action(rotate, 25, "Rotate");

        let mut target_role_filter = test_action("Kill");
        target_role_filter["constraints"]["target_role_filter"] = json!("PowerRole");
        assert_versioned_action(target_role_filter, 40, "target_role_filter");

        let mut alignment_failback = test_action("Kill");
        alignment_failback["window"] = json!("Day");
        alignment_failback["alignment_failback"] = json!({ "hostile_alignments": ["mafia"] });
        assert_versioned_action(alignment_failback, 41, "alignment_failback");

        let mut grant_options = test_action("Grant");
        grant_options["grant_options"] = json!([{
            "grant_id": "extra_action",
            "kind": "ExtraAction",
            "uses": 1,
            "visibility": "Target"
        }]);
        assert_versioned_action(grant_options, 42, "grant_options");
    }

    #[test]
    fn pack_required_ir_version_covers_versioned_policy_features() {
        let mut value = test_pack_value();
        value["wolf_carry"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 11, "wolf_carry");

        let mut value = test_pack_value();
        value["wolf_beauty"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 12, "wolf_beauty");

        let mut value = test_pack_value();
        value["guard_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 13, "guard_policy");

        let mut value = test_pack_value();
        value["death_retaliation"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 14, "death_retaliation");

        let mut value = test_pack_value();
        value["idiot_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 15, "idiot_policy");

        let mut value = test_pack_value();
        value["saulus_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 62, "saulus_policy");

        let mut value = test_pack_value();
        value["lover_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 16, "lover_policy");

        let mut value = test_pack_value();
        value["backup_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 17, "backup_policy");

        let mut value = test_pack_value();
        value["private_channels"] = json!({
            "enabled": true,
            "groups": [{
                "id": "mason",
                "kind": "Mason",
                "roles": ["townie"],
                "reveals_alignment": "Town"
            }]
        });
        assert_versioned_pack_feature(value, 29, "private_channels");

        let mut value = test_pack_value();
        value["roles"]["traitor"] = json!({
            "description": "Traitor.",
            "alignment": "mafia",
            "actions": []
        });
        value["private_channels"] = json!({
            "enabled": true,
            "groups": [{
                "id": "mafia_day_chat",
                "kind": "FactionDayChat",
                "member_alignments": ["mafia"],
                "enabled_by_roles": ["townie"],
                "excluded_roles": ["traitor"],
                "active_while_source_alive": true,
                "reveals_alignment": "None"
            }]
        });
        assert_versioned_pack_feature(value, 64, "private_channels.excluded_roles");

        let mut value = test_pack_value();
        value["ita"] = json!({
            "modifier_components": {
                "better": { "hit_bonus": 0.25 }
            },
            "role_modifier_refs": {
                "townie": ["better"]
            }
        });
        assert_versioned_pack_feature(value, 32, "ita.modifier_components");

        let mut value = test_pack_value();
        value["target_lynch_win_policies"] = json!([{
            "id": "executioner",
            "target_effect": "executioner_target",
            "eligible_roles": ["townie"],
            "winner": "town"
        }]);
        assert_versioned_pack_feature(value, 19, "target_lynch_win_policies");

        let mut value = test_pack_value();
        value["beloved_princess_policy"] = json!({ "enabled": true });
        assert_versioned_pack_feature(value, 20, "beloved_princess_policy");

        let mut value = test_pack_value();
        value["beloved_princess_policy"] = json!({
            "enabled": true,
            "eligible_roles": ["townie"],
            "all_death_causes": true,
            "prompt_kind": "skip_next_day",
            "prompt_reason": "beloved_princess_death",
            "death_causes": []
        });
        assert_versioned_pack_feature(value, 65, "beloved_princess_policy.all_death_causes");

        let mut value = test_pack_value();
        value["day_vote_prompt_policies"] = json!([{
            "id": "no_majority",
            "statuses": ["NoMajority"],
            "prompt_kind": "revote",
            "prompt_reason": "no_majority"
        }]);
        assert_versioned_pack_feature(value, 21, "day_vote_prompt_policies");

        let mut value = test_pack_value();
        value["host_prompt_resolution_effects"] = json!([{
            "id": "no_majority_revote",
            "prompt_kind": "revote",
            "prompt_reason": "no_majority",
            "decision": "Acknowledge",
            "effect": "AdvanceRevote"
        }]);
        assert_versioned_pack_feature(value, 22, "host_prompt_resolution_effects");

        let mut value = test_pack_value();
        value["self_lynch_win_policies"] = json!([{
            "id": "jester",
            "eligible_roles": ["townie"],
            "winner": "town"
        }]);
        assert_versioned_pack_feature(value, 25, "self_lynch_win_policies");

        let mut value = test_pack_value();
        value["death_reveal"] = json!({
            "default": "AlignmentOnly",
            "by_cause": {},
            "by_effect": {}
        });
        assert_versioned_pack_feature(value, 26, "death_reveal");

        let mut value = test_pack_value();
        value["standard_nar"] = json!({
            "conflict_families": ["BlockSuppressesActions"]
        });
        assert_versioned_pack_feature(value, 44, "standard_nar.conflict_families");

        let mut value = test_pack_value();
        value["visibility_families"] = json!(["PrivateInvestigationResults"]);
        assert_versioned_pack_feature(value, 45, "visibility_families");

        let mut value = test_pack_value();
        value["win_families"] = json!(["FactionParity"]);
        assert_versioned_pack_feature(value, 46, "win_families");

        let mut value = test_pack_value();
        value["win"]["survival_awards"] = json!([{
            "id": "survivor",
            "winner": "survivor",
            "eligible_roles": ["townie"],
            "source_event": "win.survivor"
        }]);
        assert_versioned_pack_feature(value, 63, "win.survival_awards");

        let mut value = test_pack_value();
        value["standard_nar"] = json!({
            "action_chance": {
                "faith_healer_protect": { "chance": 0.5 }
            }
        });
        assert_versioned_pack_feature(value, 43, "standard_nar.action_chance");
    }
}

fn validate_phase_policy(issues: &mut Vec<PackValidationIssue>, path: &str, policy: &PhasePolicy) {
    let mut cadence = BTreeSet::new();
    if policy.cadence.is_empty() {
        issue(
            issues,
            format!("{path}.cadence"),
            "phase cadence must declare at least one phase kind",
        );
    }
    for kind in &policy.cadence {
        if !cadence.insert(*kind) {
            issue(
                issues,
                format!("{path}.cadence"),
                format!("duplicate phase kind `{kind:?}`"),
            );
        }
    }

    if policy.twilight && !cadence.contains(&PhaseKind::Twilight) {
        issue(
            issues,
            format!("{path}.twilight"),
            "twilight requires Twilight in phases.cadence",
        );
    }
    if !policy.twilight && cadence.contains(&PhaseKind::Twilight) {
        issue(
            issues,
            format!("{path}.cadence"),
            "Twilight cadence requires phases.twilight = true",
        );
    }

    for (kind, subsegments) in &policy.subsegments {
        let subsegment_path = format!("{path}.subsegments.{kind:?}");
        if !cadence.contains(kind) {
            issue(
                issues,
                &subsegment_path,
                format!("subsegments declared for absent phase kind `{kind:?}`"),
            );
        }
        if subsegments.is_empty() {
            issue(
                issues,
                &subsegment_path,
                "subsegments must declare at least one step when the phase key is present",
            );
        }

        let mut seen = BTreeSet::new();
        for (idx, segment) in subsegments.iter().enumerate() {
            let item_path = format!("{subsegment_path}[{idx}]");
            if segment.trim().is_empty() {
                issue(issues, &item_path, "subsegment names must not be empty");
            } else if !segment
                .chars()
                .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_')
            {
                issue(
                    issues,
                    &item_path,
                    "subsegment names must be lowercase snake_case ASCII",
                );
            }
            if !seen.insert(segment.as_str()) {
                issue(
                    issues,
                    &item_path,
                    format!("duplicate subsegment `{segment}` for `{kind:?}`"),
                );
            }
        }
    }
}

fn validate_source_ids(issues: &mut Vec<PackValidationIssue>, path: &str, action: &ActionTemplate) {
    let mut seen = BTreeSet::new();
    for source_id in &action.source_ids {
        if source_id.trim().is_empty() {
            issue(
                issues,
                format!("{path}.source_ids"),
                "source action ids must not be empty",
            );
        } else if source_id == &action.id {
            issue(
                issues,
                format!("{path}.source_ids"),
                format!("source action id `{source_id}` duplicates canonical id"),
            );
        } else if !seen.insert(source_id.as_str()) {
            issue(
                issues,
                format!("{path}.source_ids"),
                format!("duplicate source action id `{source_id}`"),
            );
        }
    }
}

fn validate_vote_policy(
    issues: &mut Vec<PackValidationIssue>,
    policy: &VotePolicy,
    role_keys: &BTreeSet<&str>,
    effect_tags: &BTreeSet<&str>,
    vote_weight_grant_ids: &BTreeSet<String>,
    cadence: &BTreeSet<PhaseKind>,
    prompt_policies: &[DayVotePromptPolicy],
    prompt_effects: &[HostPromptResolutionEffectPolicy],
    uses_vote_duel: bool,
) {
    if !cadence.contains(&PhaseKind::Day) {
        issue(issues, "vote", "vote policy requires Day in phases.cadence");
    }

    validate_vote_method(issues, &policy.method);
    if matches!(policy.method, VoteMethod::Plurality) {
        if policy.hammer {
            issue(
                issues,
                "vote.hammer",
                "hammer requires Majority or Supermajority vote method",
            );
        }
        if !policy.threshold_adjustments.is_empty() {
            issue(
                issues,
                "vote.threshold_adjustments",
                "threshold adjustments require Majority or Supermajority vote method",
            );
        }
    }

    match &policy.weights {
        WeightPolicy::Equal => {}
        WeightPolicy::PerRole(weights) => {
            if weights.is_empty() {
                issue(
                    issues,
                    "vote.weights",
                    "PerRole vote weights must declare at least one role override",
                );
            }
            for (role_key, weight) in weights {
                if !role_keys.contains(role_key.as_str()) {
                    issue(issues, "vote.weights", format!("unknown role `{role_key}`"));
                }
                if !weight.is_finite() || *weight < 0.0 {
                    issue(
                        issues,
                        "vote.weights",
                        format!("role `{role_key}` has invalid vote weight {weight}; expected finite weight >= 0"),
                    );
                }
            }
        }
        WeightPolicy::Dynamic(dynamic) => {
            if !dynamic.base.is_finite() || dynamic.base < 0.0 {
                issue(
                    issues,
                    "vote.weights.Dynamic.base",
                    "dynamic vote base weight must be finite and >= 0",
                );
            }
            if dynamic.effect_rules.is_empty() && dynamic.grant_rules.is_empty() {
                issue(
                    issues,
                    "vote.weights.Dynamic",
                    "dynamic vote weights must declare at least one effect or grant rule",
                );
            }
            let mut seen_effects = BTreeSet::new();
            let mut seen_priorities = BTreeSet::new();
            for (idx, rule) in dynamic.effect_rules.iter().enumerate() {
                let path = format!("vote.weights.Dynamic.effect_rules[{idx}]");
                if rule.effect.trim().is_empty() {
                    issue(issues, format!("{path}.effect"), "effect must not be empty");
                } else if !effect_tags.contains(rule.effect.as_str()) {
                    issue(
                        issues,
                        format!("{path}.effect"),
                        format!("unknown effect `{}`", rule.effect),
                    );
                }
                if !seen_effects.insert(rule.effect.as_str()) {
                    issue(
                        issues,
                        format!("{path}.effect"),
                        format!("duplicate dynamic vote effect `{}`", rule.effect),
                    );
                }
                if !rule.weight.is_finite() || rule.weight < 0.0 {
                    issue(
                        issues,
                        format!("{path}.weight"),
                        format!(
                            "dynamic vote effect `{}` has invalid weight {}; expected finite weight >= 0",
                            rule.effect, rule.weight
                        ),
                    );
                }
                if !seen_priorities.insert(rule.priority) {
                    issue(
                        issues,
                        format!("{path}.priority"),
                        format!("duplicate dynamic vote priority {}", rule.priority),
                    );
                }
            }
            let mut seen_grants = BTreeSet::new();
            for (idx, rule) in dynamic.grant_rules.iter().enumerate() {
                let path = format!("vote.weights.Dynamic.grant_rules[{idx}]");
                if rule.grant_id.trim().is_empty() {
                    issue(
                        issues,
                        format!("{path}.grant_id"),
                        "grant_id must not be empty",
                    );
                } else if !vote_weight_grant_ids.contains(&rule.grant_id) {
                    issue(
                        issues,
                        format!("{path}.grant_id"),
                        format!(
                            "unknown VoteWeight grant `{}`; dynamic grant rules must reference a Grant action with kind VoteWeight",
                            rule.grant_id
                        ),
                    );
                }
                if !seen_grants.insert(rule.grant_id.as_str()) {
                    issue(
                        issues,
                        format!("{path}.grant_id"),
                        format!("duplicate dynamic vote grant `{}`", rule.grant_id),
                    );
                }
                if !seen_priorities.insert(rule.priority) {
                    issue(
                        issues,
                        format!("{path}.priority"),
                        format!("duplicate dynamic vote priority {}", rule.priority),
                    );
                }
            }
        }
    }

    for (role_key, adjustment) in &policy.threshold_adjustments {
        if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                "vote.threshold_adjustments",
                format!("unknown role `{role_key}`"),
            );
        }
        if !adjustment.is_finite() {
            issue(
                issues,
                "vote.threshold_adjustments",
                format!(
                    "role `{role_key}` has invalid vote threshold adjustment {adjustment}; expected finite value"
                ),
            );
        }
    }

    let mut seen_tiebreaker_roles = BTreeSet::new();
    for role_key in &policy.tiebreaker_roles {
        if role_key.trim().is_empty() {
            issue(
                issues,
                "vote.tiebreaker_roles",
                "tiebreaker role must not be empty",
            );
        } else if !role_keys.contains(role_key.as_str()) {
            issue(
                issues,
                "vote.tiebreaker_roles",
                format!("unknown role `{role_key}`"),
            );
        } else if !seen_tiebreaker_roles.insert(role_key.as_str()) {
            issue(
                issues,
                "vote.tiebreaker_roles",
                format!("duplicate tiebreaker role `{role_key}`"),
            );
        }
    }

    match policy.tie_breaker {
        VoteTieBreaker::NoElimination | VoteTieBreaker::Random => {}
        VoteTieBreaker::EarliestReached => issue(
            issues,
            "vote.tie_breaker",
            "EarliestReached vote tie breaker is not implemented by the resolver yet",
        ),
        VoteTieBreaker::HostDecides => {
            validate_host_decided_vote_tie(issues, prompt_policies, prompt_effects)
        }
    }

    match (uses_vote_duel, policy.vote_duel_tie_breaker) {
        (true, None) => issue(
            issues,
            "vote.vote_duel_tie_breaker",
            "VoteDuel actions require an explicit vote_duel_tie_breaker",
        ),
        (false, Some(_)) => issue(
            issues,
            "vote.vote_duel_tie_breaker",
            "vote_duel_tie_breaker requires a VoteDuel action",
        ),
        _ => {}
    }
}

fn validate_vote_method(issues: &mut Vec<PackValidationIssue>, method: &VoteMethod) {
    if let VoteMethod::Supermajority { num, den } = method {
        if *den == 0 || *num == 0 || num > den {
            issue(
                issues,
                "vote.method",
                "supermajority must satisfy 0 < num <= den",
            );
        } else if (*num as u64) * 2 <= *den as u64 {
            issue(
                issues,
                "vote.method",
                "supermajority must be greater than one-half; use Majority for simple majority",
            );
        }
    }
}

fn validate_host_decided_vote_tie(
    issues: &mut Vec<PackValidationIssue>,
    prompt_policies: &[DayVotePromptPolicy],
    prompt_effects: &[HostPromptResolutionEffectPolicy],
) {
    let tie_prompt_pairs: BTreeSet<(&str, &str)> = prompt_policies
        .iter()
        .filter(|policy| policy.statuses.contains(&VoteStatus::Tie))
        .map(|policy| (policy.prompt_kind.as_str(), policy.prompt_reason.as_str()))
        .collect();
    if tie_prompt_pairs.is_empty() {
        issue(
            issues,
            "vote.tie_breaker",
            "HostDecides vote tie breaker requires a Tie day_vote_prompt_policy",
        );
        return;
    }

    let has_select_slot_effect = prompt_effects.iter().any(|effect| {
        tie_prompt_pairs.contains(&(effect.prompt_kind.as_str(), effect.prompt_reason.as_str()))
            && effect.decision == HostPromptDecisionKind::SelectSlot
            && effect.effect == HostPromptResolutionEffect::PkKill
    });
    if !has_select_slot_effect {
        issue(
            issues,
            "vote.tie_breaker",
            "HostDecides vote tie breaker requires a SelectSlot/PkKill host_prompt_resolution_effect for a Tie prompt",
        );
    }
}

fn validate_alignment_ref(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    alignment: &str,
    alignments: &BTreeSet<&str>,
) {
    if !alignments.contains(alignment) {
        issue(issues, path, format!("unknown alignment `{alignment}`"));
    }
}

fn declared_effect_tags(pack: &Pack) -> BTreeSet<&str> {
    let mut tags = BTreeSet::new();
    tags.extend(pack.effects.keys().map(String::as_str));
    for role in pack.roles.values() {
        tags.extend(role.effects.iter().map(String::as_str));
        for action in &role.actions {
            if matches!(action.ability, IrAbility::Mark) {
                if let Some(effect) = &action.effect {
                    tags.insert(effect.as_str());
                }
            }
        }
    }
    for action in pack.item_actions.values() {
        if matches!(action.ability, IrAbility::Mark) {
            if let Some(effect) = &action.effect {
                tags.insert(effect.as_str());
            }
        }
    }
    tags
}

fn night_ability_priorities(pack: &Pack) -> BTreeMap<IrAbility, i32> {
    let mut priorities = BTreeMap::new();
    for action in pack
        .roles
        .values()
        .flat_map(|role| role.actions.iter())
        .chain(pack.item_actions.values())
    {
        if !action.window.is_night_resolution_window() {
            continue;
        }
        for ability in night_order_abilities(action) {
            priorities
                .entry(ability)
                .and_modify(|priority: &mut i32| {
                    *priority = (*priority).max(action.constraints.priority);
                })
                .or_insert(action.constraints.priority);
        }
    }
    priorities
}

fn night_order_abilities(action: &ActionTemplate) -> Vec<IrAbility> {
    action
        .abilities()
        .into_iter()
        .filter(|ability| !(action.has_modifier(Modifier::Cpr) && *ability == IrAbility::Kill))
        .collect()
}

fn precedence_edges(pack: &Pack, abilities: &BTreeSet<IrAbility>) -> Vec<(IrAbility, IrAbility)> {
    let mut edges = BTreeSet::new();
    for rule in &pack.precedence {
        for beaten in &rule.beats {
            if abilities.contains(&rule.when.effect) && abilities.contains(beaten) {
                edges.insert((rule.when.effect, *beaten));
            }
        }
        for blocker in &rule.blocked_by {
            if abilities.contains(blocker) && abilities.contains(&rule.when.effect) {
                edges.insert((*blocker, rule.when.effect));
            }
        }
    }
    edges.into_iter().collect()
}

fn topological_ability_order(
    priorities: &BTreeMap<IrAbility, i32>,
    edges: &[(IrAbility, IrAbility)],
) -> Result<Vec<IrAbility>, PackValidationError> {
    let mut incoming: BTreeMap<IrAbility, usize> =
        priorities.keys().map(|ability| (*ability, 0)).collect();
    let mut outgoing: BTreeMap<IrAbility, Vec<IrAbility>> = priorities
        .keys()
        .map(|ability| (*ability, Vec::new()))
        .collect();

    for (from, to) in edges {
        if from == to {
            return Err(pack_order_error(
                "precedence",
                "precedence cycle includes self-edge",
            ));
        }
        if !priorities.contains_key(from) || !priorities.contains_key(to) {
            continue;
        }
        outgoing.entry(*from).or_default().push(*to);
        *incoming.entry(*to).or_default() += 1;
    }

    let mut ready: Vec<IrAbility> = incoming
        .iter()
        .filter_map(|(ability, count)| (*count == 0).then_some(*ability))
        .collect();
    sort_ready(&mut ready, priorities);

    let mut order = Vec::new();
    while let Some(ability) = ready.first().copied() {
        ready.remove(0);
        order.push(ability);
        for next in outgoing.get(&ability).cloned().unwrap_or_default() {
            let count = incoming.get_mut(&next).expect("known ability");
            *count -= 1;
            if *count == 0 {
                ready.push(next);
                sort_ready(&mut ready, priorities);
            }
        }
    }

    if order.len() != priorities.len() {
        return Err(pack_order_error(
            "precedence",
            "precedence cycle prevents deriving night ability order",
        ));
    }

    Ok(order)
}

fn sort_ready(ready: &mut [IrAbility], priorities: &BTreeMap<IrAbility, i32>) {
    ready.sort_by(|left, right| {
        priorities[right]
            .cmp(&priorities[left])
            .then_with(|| left.cmp(right))
    });
}

fn has_path(from: IrAbility, to: IrAbility, edges: &[(IrAbility, IrAbility)]) -> bool {
    let mut stack = vec![from];
    let mut seen = BTreeSet::new();
    while let Some(current) = stack.pop() {
        if current == to {
            return true;
        }
        if !seen.insert(current) {
            continue;
        }
        for (_, next) in edges.iter().filter(|(edge_from, _)| *edge_from == current) {
            stack.push(*next);
        }
    }
    false
}

fn pack_order_error(path: impl Into<String>, message: impl Into<String>) -> PackValidationError {
    PackValidationError {
        issues: vec![PackValidationIssue {
            path: path.into(),
            message: message.into(),
        }],
    }
}

fn issue(
    issues: &mut Vec<PackValidationIssue>,
    path: impl Into<String>,
    message: impl Into<String>,
) {
    issues.push(PackValidationIssue {
        path: path.into(),
        message: message.into(),
    });
}
