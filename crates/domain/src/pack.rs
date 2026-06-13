//! The pack: declarative tables over the IR (doc 09).
//!
//! Maps use `BTreeMap` so iteration order is deterministic and never leaks
//! hash-map order into event ordering.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::ir::{InvestigateMode, IrAbility, Modifier};

pub type RoleKey = String;
pub type AlignmentKey = String;
pub type Tag = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pack {
    pub name: String,
    pub version: u32,
    pub ir_version: u16,
    pub roles: BTreeMap<RoleKey, Role>,
    pub precedence: Vec<PrecedenceRule>,
    pub visibility: BTreeMap<IrAbility, VisibilityRule>,
    pub redirects: RedirectPolicy,
    #[serde(default)]
    pub triggers: Vec<TriggerRule>,
    pub vote: VotePolicy,
    pub phases: PhasePolicy,
    #[serde(default)]
    pub investigation_overrides: Option<BTreeMap<Tag, ResultOverride>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Role {
    pub description: String,
    #[serde(default)]
    pub alignment: Option<AlignmentKey>,
    #[serde(default)]
    pub actions: Vec<ActionTemplate>,
    #[serde(default)]
    pub effects: Vec<Tag>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Window {
    Day,
    Night,
    Any,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetSpec {
    None,
    One,
    Many,
    Group,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionTemplate {
    pub id: String,
    pub ability: IrAbility,
    pub window: Window,
    pub targets: TargetSpec,
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
    pub constraints: Constraints,
    /// REQUIRED iff `ability == Investigate`; absent/null otherwise.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<InvestigateMode>,
}

impl ActionTemplate {
    pub fn has_modifier(&self, m: Modifier) -> bool {
        self.modifiers.contains(&m)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraints {
    pub max_targets: u16,
    pub self_allowed: bool,
    pub unique_targets: bool,
    pub roleblockable: bool,
    pub priority: i32,
    #[serde(default)]
    pub x_shots: Option<u16>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
    pub on: IrAbility,
    #[serde(default)]
    pub if_target_has: Vec<Tag>,
    pub produces: TriggerProduction,
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
    pub tie_breaker: VoteTieBreaker,
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
    Dynamic,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum VoteTieBreaker {
    NoElimination,
    Random,
    HostDecides,
    EarliestReached,
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
