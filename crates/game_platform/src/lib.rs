//! Pure platform-domain vocabulary for running a game.
//!
//! This crate deliberately has no database, async runtime, command, projection,
//! or resolver dependencies. It owns the values shared by those layers without
//! becoming a second rules engine.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

use serde::{de::Error as _, Deserialize, Deserializer, Serialize};
use thiserror::Error;

pub mod day_auto_resolution;
pub mod day_narrative;
pub mod day_schedule;
pub mod embed;
pub mod persona;

pub use persona::{
    GamePersonaId, GamePersonaName, GamePersonaPresentation, OccupancyEndReason, OccupancyId,
    OccupancyStartReason, OccupancyTransitionId,
};

#[derive(Debug, Clone, PartialEq, Error)]
pub enum ModelError {
    #[error("{kind} must not be blank")]
    BlankIdentifier { kind: &'static str },
    #[error("duration must be non-negative, got {0}")]
    NegativeDuration(i64),
    #[error("{kind} window must end after it begins")]
    InvalidWindow { kind: &'static str },
    #[error("participation maximum must be at least its minimum")]
    InvalidParticipationLimits,
    #[error("participation payload does not match mode {mode}")]
    ParticipationPayloadMismatch { mode: &'static str },
    #[error("DayEvent must define at least one reward")]
    MissingRewards,
    #[error("automatic DayEvent winner count must be positive")]
    ZeroAutoWinnerCount,
    #[error(
        "automatic DayEvent resolution requires at least {required} participants, got {actual}"
    )]
    InsufficientAutoParticipants { required: u32, actual: usize },
    #[error("automatic DayEvent resolution requires a recorded seed")]
    MissingAutoSeed,
    #[error("automatic DayEvent resolution received duplicate participant `{0}`")]
    DuplicateAutoParticipant(SlotId),
    #[error("reward {0} must define at least one effect")]
    EmptyReward(RewardKey),
    #[error("duplicate reward key {0}")]
    DuplicateReward(RewardKey),
    #[error("recipient selector {selector} resolved to no slots")]
    MissingRecipients { selector: &'static str },
    #[error("grant uses must be greater than zero")]
    ZeroGrantUses,
    #[error("vote-weight grants require a finite positive vote_weight")]
    InvalidVoteWeight,
    #[error("vote_weight is only valid for vote-weight grants")]
    UnexpectedVoteWeight,
    #[error("effect plans must contain at least one concrete effect")]
    EmptyEffectPlan,
    #[error("effect plan reason must not be blank")]
    BlankEffectPlanReason,
    #[error("day program version must be greater than zero")]
    ZeroProgramVersion,
    #[error("day program display name must not be blank")]
    BlankProgramDisplayName,
    #[error("day program must define at least one event")]
    EmptyDayProgram,
    #[error("duplicate day program event id {0}")]
    DuplicateProgramEvent(DayEventId),
    #[error("day program narrative templates require a theme reference")]
    MissingNarrativeThemeRef,
    #[error("narrative template {0} must not have a blank body")]
    BlankNarrativeTemplateBody(TemplateKey),
    #[error("narrative template {template} exceeds the {maximum} byte limit")]
    NarrativeTemplateTooLarge {
        template: TemplateKey,
        maximum: usize,
    },
    #[error("duplicate narrative template key {0}")]
    DuplicateNarrativeTemplate(TemplateKey),
    #[error("DayEvent references unknown narrative template {0}")]
    UnknownNarrativeTemplate(TemplateKey),
    #[error("narrative template {template} contains unsupported binding `{binding}`")]
    UnknownNarrativeBinding {
        template: TemplateKey,
        binding: String,
    },
    #[error("program content hash must be 64 lowercase hexadecimal characters")]
    InvalidProgramContentHash,
    #[error("game post embed is invalid")]
    InvalidEmbed,
    #[error("day program could not be serialized canonically")]
    CanonicalProgramSerialization,
}

macro_rules! identifier {
    ($name:ident, $kind:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
        #[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
        #[cfg_attr(feature = "typescript", ts(type = "string"))]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, ModelError> {
                let value = value.into();
                if value.trim().is_empty() {
                    return Err(ModelError::BlankIdentifier { kind: $kind });
                }
                Ok(Self(value))
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(formatter)
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
            where
                D: Deserializer<'de>,
            {
                let value = String::deserialize(deserializer)?;
                Self::new(value).map_err(D::Error::custom)
            }
        }
    };
}

identifier!(DayEventId, "day event id");
identifier!(ProgramId, "program id");
identifier!(TemplateKey, "template key");
identifier!(RewardKey, "reward key");
identifier!(SlotId, "slot id");
identifier!(PhaseId, "phase id");
identifier!(OptionId, "option id");
identifier!(Tag, "tag");
identifier!(ContentRef, "content reference");
identifier!(ChannelId, "channel id");
pub use principal::PrincipalId;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "string"))]
pub struct ProgramContentHash(String);

impl ProgramContentHash {
    pub fn new(value: impl Into<String>) -> Result<Self, ModelError> {
        let value = value.into();
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(ModelError::InvalidProgramContentHash);
        }
        Ok(Self(value))
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for ProgramContentHash {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl<'de> Deserialize<'de> for ProgramContentHash {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(String::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

/// Immutable address of one versioned DayProgram artifact.
///
/// The identity and version keep the reference discoverable for humans while
/// the content hash makes resolution fail closed if the checked-in document
/// drifts.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DayProgramRef {
    pub id: ProgramId,
    pub version: u32,
    pub content_hash: ProgramContentHash,
}

/// Captured platform wall-clock time. This is never engine logical time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "number"))]
pub struct UnixSeconds(i64);

impl UnixSeconds {
    pub const fn new(value: i64) -> Self {
        Self(value)
    }

    pub const fn get(self) -> i64 {
        self.0
    }
}

/// Non-negative elapsed wall-clock duration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
#[cfg_attr(feature = "typescript", ts(type = "number"))]
pub struct DurationSeconds(i64);

impl DurationSeconds {
    pub fn new(value: i64) -> Result<Self, ModelError> {
        if value < 0 {
            return Err(ModelError::NegativeDuration(value));
        }
        Ok(Self(value))
    }

    pub const fn get(self) -> i64 {
        self.0
    }
}

impl<'de> Deserialize<'de> for DurationSeconds {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        Self::new(i64::deserialize(deserializer)?).map_err(D::Error::custom)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum PhaseScope {
    DuringDay {
        number: u32,
    },
    AnyRunning,
    ExplicitWindow {
        opens_at: UnixSeconds,
        closes_at: UnixSeconds,
    },
}

impl PhaseScope {
    fn validate(&self) -> Result<(), ModelError> {
        if let Self::ExplicitWindow {
            opens_at,
            closes_at,
        } = self
        {
            if closes_at <= opens_at {
                return Err(ModelError::InvalidWindow {
                    kind: "explicit phase scope",
                });
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ProgramTrigger {
    PhaseOpened { phase_id: PhaseId },
    PhaseLocked { phase_id: PhaseId },
    PhaseResolved { phase_id: PhaseId },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventSchedule {
    Absolute {
        open_at: UnixSeconds,
        lock_at: Option<UnixSeconds>,
    },
    RelativeToPhase {
        phase_id: PhaseId,
        open_offset: DurationSeconds,
        lock_offset: Option<DurationSeconds>,
    },
    HostOpened,
    OnTrigger {
        trigger: ProgramTrigger,
    },
}

impl DayEventSchedule {
    pub fn validate(&self) -> Result<(), ModelError> {
        match self {
            Self::Absolute {
                open_at,
                lock_at: Some(lock_at),
            } if lock_at <= open_at => Err(ModelError::InvalidWindow {
                kind: "absolute schedule",
            }),
            Self::RelativeToPhase {
                open_offset,
                lock_offset: Some(lock_offset),
                ..
            } if lock_offset <= open_offset => Err(ModelError::InvalidWindow {
                kind: "relative schedule",
            }),
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventState {
    Scheduled,
    Open,
    Locked,
    Resolved,
    Cancelled,
}

impl DayEventState {
    pub const fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Scheduled, Self::Open | Self::Cancelled)
                | (Self::Open, Self::Locked | Self::Cancelled)
                | (Self::Locked, Self::Resolved | Self::Cancelled)
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventResolutionMode {
    HostDecision,
    Auto { policy: AutoResolvePolicy },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum AutoResolvePolicy {
    FirstN { winners: u32 },
    SeededRandom { winners: u32 },
}

impl AutoResolvePolicy {
    pub const fn winner_count(self) -> u32 {
        match self {
            Self::FirstN { winners } | Self::SeededRandom { winners } => winners,
        }
    }

    pub const fn requires_seed(self) -> bool {
        matches!(self, Self::SeededRandom { .. })
    }

    pub fn validate(self) -> Result<(), ModelError> {
        if self.winner_count() == 0 {
            Err(ModelError::ZeroAutoWinnerCount)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ParticipantFilter {
    AliveSlots,
    AllOccupied,
    HostInvited,
    ChannelMembers,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ParticipationMode {
    OptIn,
    SubmitChoice,
    SubmitFreeformRef,
    VoteAmongOptions,
}

impl ParticipationMode {
    const fn name(self) -> &'static str {
        match self {
            Self::OptIn => "opt_in",
            Self::SubmitChoice => "submit_choice",
            Self::SubmitFreeformRef => "submit_freeform_ref",
            Self::VoteAmongOptions => "vote_among_options",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ParticipationLimits {
    pub minimum: u32,
    pub maximum: Option<u32>,
}

impl ParticipationLimits {
    pub fn validate(self) -> Result<(), ModelError> {
        if self.maximum.is_some_and(|maximum| maximum < self.minimum) {
            return Err(ModelError::InvalidParticipationLimits);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct ParticipationSpec {
    pub who: ParticipantFilter,
    pub mode: ParticipationMode,
    pub limits: ParticipationLimits,
}

impl ParticipationSpec {
    pub fn validate(&self) -> Result<(), ModelError> {
        self.limits.validate()
    }

    pub fn validate_payload(&self, payload: &ParticipationPayload) -> Result<(), ModelError> {
        let matches = matches!(
            (self.mode, payload),
            (ParticipationMode::OptIn, ParticipationPayload::OptIn)
                | (
                    ParticipationMode::SubmitChoice,
                    ParticipationPayload::Choice { .. }
                )
                | (
                    ParticipationMode::SubmitFreeformRef,
                    ParticipationPayload::FreeformRef { .. }
                )
                | (
                    ParticipationMode::VoteAmongOptions,
                    ParticipationPayload::Ballot { .. }
                )
        );
        if matches {
            Ok(())
        } else {
            Err(ModelError::ParticipationPayloadMismatch {
                mode: self.mode.name(),
            })
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ParticipationPayload {
    OptIn,
    Choice { option_id: OptionId },
    FreeformRef { body_ref: ContentRef },
    Ballot { option_id: OptionId },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct NarrativeTemplates {
    pub opened: Option<TemplateKey>,
    pub locked: Option<TemplateKey>,
    pub resolved: Option<TemplateKey>,
    pub cancelled: Option<TemplateKey>,
}

impl NarrativeTemplates {
    pub fn iter(&self) -> impl Iterator<Item = (NarrativeLifecycle, &TemplateKey)> {
        [
            (NarrativeLifecycle::Opened, self.opened.as_ref()),
            (NarrativeLifecycle::Locked, self.locked.as_ref()),
            (NarrativeLifecycle::Resolved, self.resolved.as_ref()),
            (NarrativeLifecycle::Cancelled, self.cancelled.as_ref()),
        ]
        .into_iter()
        .filter_map(|(lifecycle, template)| template.map(|template| (lifecycle, template)))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum NarrativeLifecycle {
    Opened,
    Locked,
    Resolved,
    Cancelled,
}

impl NarrativeLifecycle {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Opened => "opened",
            Self::Locked => "locked",
            Self::Resolved => "resolved",
            Self::Cancelled => "cancelled",
        }
    }
}

pub const MAX_NARRATIVE_TEMPLATE_BODY_BYTES: usize = 8 * 1024;
pub const MAX_RENDERED_NARRATIVE_BYTES: usize = 50 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct NarrativeTemplate {
    pub key: TemplateKey,
    pub body: String,
}

impl NarrativeTemplate {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.body.trim().is_empty() {
            return Err(ModelError::BlankNarrativeTemplateBody(self.key.clone()));
        }
        if self.body.len() > MAX_NARRATIVE_TEMPLATE_BODY_BYTES {
            return Err(ModelError::NarrativeTemplateTooLarge {
                template: self.key.clone(),
                maximum: MAX_NARRATIVE_TEMPLATE_BODY_BYTES,
            });
        }
        day_narrative::validate_bindings(self)
    }

    pub fn content_hash(&self) -> Result<ProgramContentHash, ModelError> {
        self.validate()?;
        let canonical =
            serde_json::to_vec(self).map_err(|_| ModelError::CanonicalProgramSerialization)?;
        ProgramContentHash::new(blake3::hash(&canonical).to_hex().to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct CompiledNarrativeTemplate {
    pub lifecycle: NarrativeLifecycle,
    pub template_key: TemplateKey,
    pub template_hash: ProgramContentHash,
    pub channel_id: ChannelId,
    pub body: String,
}

pub const EVENT_PRIVATE_CHANNEL_PREFIX: &str = "private:event:";

/// The event owns its publication scope. Program authors never provide a raw
/// channel id: public events use `main`, while private events derive a stable
/// slot-scoped channel from the immutable DayEvent id.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "visibility", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum EventChannelPolicy {
    PublicMain,
    Private { membership: EventChannelMembership },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum EventChannelMembership {
    /// Capture every slot eligible under the participation filter when the
    /// event opens. Later valid participants are also admitted, so a slot that
    /// becomes eligible after opening cannot participate without channel access.
    EligibleSlots,
    /// Membership follows current participation: submit grants and withdraw
    /// revokes. Locked/resolved events retain their final member set for
    /// read-only history.
    Participants,
}

impl EventChannelPolicy {
    pub fn channel_id(self, event_id: &DayEventId) -> ChannelId {
        match self {
            Self::PublicMain => ChannelId::new("main"),
            Self::Private { .. } => {
                ChannelId::new(format!("{EVENT_PRIVATE_CHANNEL_PREFIX}{event_id}"))
            }
        }
        .expect("validated DayEvent ids always derive non-blank channels")
    }

    pub const fn is_private(self) -> bool {
        matches!(self, Self::Private { .. })
    }

    pub const fn membership(self) -> Option<EventChannelMembership> {
        match self {
            Self::PublicMain => None,
            Self::Private { membership } => Some(membership),
        }
    }
}

pub fn event_id_from_private_channel(channel_id: &str) -> Option<&str> {
    channel_id
        .strip_prefix(EVENT_PRIVATE_CHANNEL_PREFIX)
        .filter(|event_id| !event_id.trim().is_empty())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum RecipientSelector {
    Winner,
    Participant,
    HostChosen,
    ExplicitSlot { slot: SlotId },
}

impl RecipientSelector {
    const fn name(&self) -> &'static str {
        match self {
            Self::Winner => "winner",
            Self::Participant => "participant",
            Self::HostChosen => "host_chosen",
            Self::ExplicitSlot { .. } => "explicit_slot",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum SlotLifecycleEffect {
    Alive,
    Dead,
    Modkilled,
}

/// Platform grants share domain pack IR `GrantKind` (single source of truth).
pub use domain::GrantKind;

#[derive(Serialize, Deserialize)]
#[serde(remote = "GrantKind", rename_all = "snake_case")]
enum PlatformGrantKindSerde {
    ExtraAction,
    Item,
    VoteWeight,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum EffectVisibility {
    Hidden,
    Public,
    Actor,
    Target,
    ActorAndTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct GrantSpec {
    pub grant_id: Tag,
    #[serde(with = "PlatformGrantKindSerde")]
    #[cfg_attr(feature = "typescript", ts(as = "GrantKind"))]
    pub kind: GrantKind,
    pub uses: u16,
    pub vote_weight: Option<f64>,
    pub visibility: EffectVisibility,
}

impl GrantSpec {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.uses == 0 {
            return Err(ModelError::ZeroGrantUses);
        }
        match (self.kind, self.vote_weight) {
            (GrantKind::VoteWeight, Some(weight)) if weight.is_finite() && weight > 0.0 => Ok(()),
            (GrantKind::VoteWeight, _) => Err(ModelError::InvalidVoteWeight),
            (_, Some(_)) => Err(ModelError::UnexpectedVoteWeight),
            (_, None) => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum EffectOperationTemplate {
    SetSlotLifecycle { status: SlotLifecycleEffect },
    Mark { effect: Tag },
    Clear { effect: Tag },
    Grant { grant: GrantSpec },
    RevealAlignment,
    RevealRole,
}

impl EffectOperationTemplate {
    fn validate(&self) -> Result<(), ModelError> {
        match self {
            Self::Grant { grant } => grant.validate(),
            _ => Ok(()),
        }
    }

    fn bind(&self, target: SlotId) -> ConcreteEffect {
        match self {
            Self::SetSlotLifecycle { status } => ConcreteEffect::SetSlotLifecycle {
                target,
                status: *status,
            },
            Self::Mark { effect } => ConcreteEffect::Mark {
                target,
                effect: effect.clone(),
            },
            Self::Clear { effect } => ConcreteEffect::Clear {
                target,
                effect: effect.clone(),
            },
            Self::Grant { grant } => ConcreteEffect::Grant {
                target,
                grant: grant.clone(),
            },
            Self::RevealAlignment => ConcreteEffect::RevealAlignment { target },
            Self::RevealRole => ConcreteEffect::RevealRole { target },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RewardEffectTemplate {
    pub recipient: RecipientSelector,
    pub operation: EffectOperationTemplate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RewardBinding {
    pub reward_key: RewardKey,
    pub display_name_theme_key: TemplateKey,
    pub effects: Vec<RewardEffectTemplate>,
}

impl RewardBinding {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.effects.is_empty() {
            return Err(ModelError::EmptyReward(self.reward_key.clone()));
        }
        for effect in &self.effects {
            effect.operation.validate()?;
        }
        Ok(())
    }

    /// Resolve every recipient selector into concrete slot-targeted effects.
    pub fn bind(&self, recipients: &RecipientBindings) -> Result<Vec<ConcreteEffect>, ModelError> {
        self.validate()?;
        let mut concrete = Vec::new();
        for effect in &self.effects {
            let targets = recipients.resolve(&effect.recipient)?;
            concrete.extend(
                targets
                    .into_iter()
                    .map(|target| effect.operation.bind(target)),
            );
        }
        Ok(concrete)
    }

    pub fn compile_plan(
        &self,
        event_id: DayEventId,
        recipients: &RecipientBindings,
        reason: impl Into<String>,
    ) -> Result<EffectPlan, ModelError> {
        EffectPlan::try_new(
            EffectOrigin::DayEventReward {
                event_id,
                reward_key: self.reward_key.clone(),
            },
            self.bind(recipients)?,
            reason,
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RecipientBindings {
    pub winners: Vec<SlotId>,
    pub participants: Vec<SlotId>,
    pub host_chosen: Vec<SlotId>,
}

impl RecipientBindings {
    fn resolve(&self, selector: &RecipientSelector) -> Result<Vec<SlotId>, ModelError> {
        let selected = match selector {
            RecipientSelector::Winner => &self.winners,
            RecipientSelector::Participant => &self.participants,
            RecipientSelector::HostChosen => &self.host_chosen,
            RecipientSelector::ExplicitSlot { slot } => return Ok(vec![slot.clone()]),
        };
        let unique: Vec<_> = selected
            .iter()
            .cloned()
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        if unique.is_empty() {
            Err(ModelError::MissingRecipients {
                selector: selector.name(),
            })
        } else {
            Ok(unique)
        }
    }
}

/// Fully targeted platform operation. No recipient selectors survive this boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum ConcreteEffect {
    SetSlotLifecycle {
        target: SlotId,
        status: SlotLifecycleEffect,
    },
    Mark {
        target: SlotId,
        effect: Tag,
    },
    Clear {
        target: SlotId,
        effect: Tag,
    },
    Grant {
        target: SlotId,
        grant: GrantSpec,
    },
    RevealAlignment {
        target: SlotId,
    },
    RevealRole {
        target: SlotId,
    },
}

impl ConcreteEffect {
    pub fn validate(&self) -> Result<(), ModelError> {
        match self {
            Self::Grant { grant, .. } => grant.validate(),
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum EffectOrigin {
    HostFiat {
        principal_id: PrincipalId,
    },
    DayEventReward {
        event_id: DayEventId,
        reward_key: RewardKey,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct EffectPlan {
    pub origin: EffectOrigin,
    pub effects: Vec<ConcreteEffect>,
    pub reason: String,
}

impl EffectPlan {
    pub fn try_new(
        origin: EffectOrigin,
        effects: Vec<ConcreteEffect>,
        reason: impl Into<String>,
    ) -> Result<Self, ModelError> {
        if effects.is_empty() {
            return Err(ModelError::EmptyEffectPlan);
        }
        let reason = reason.into();
        if reason.trim().is_empty() {
            return Err(ModelError::BlankEffectPlanReason);
        }
        for effect in &effects {
            effect.validate()?;
        }
        Ok(Self {
            origin,
            effects,
            reason,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DayEvent {
    pub id: DayEventId,
    pub program_id: ProgramId,
    pub template_key: TemplateKey,
    pub phase_scope: PhaseScope,
    pub schedule: DayEventSchedule,
    pub participation: ParticipationSpec,
    pub state: DayEventState,
    pub resolution: DayEventResolutionMode,
    pub rewards: Vec<RewardBinding>,
    pub narrative: NarrativeTemplates,
    pub channel_policy: EventChannelPolicy,
}

impl DayEvent {
    pub fn validate(&self) -> Result<(), ModelError> {
        self.phase_scope.validate()?;
        self.schedule.validate()?;
        self.participation.validate()?;
        if let DayEventResolutionMode::Auto { policy } = self.resolution {
            policy.validate()?;
            if self.participation.limits.minimum < policy.winner_count() {
                return Err(ModelError::InsufficientAutoParticipants {
                    required: policy.winner_count(),
                    actual: self.participation.limits.minimum as usize,
                });
            }
        }
        if self.rewards.is_empty() {
            return Err(ModelError::MissingRewards);
        }
        let mut reward_keys = BTreeSet::new();
        for reward in &self.rewards {
            if !reward_keys.insert(&reward.reward_key) {
                return Err(ModelError::DuplicateReward(reward.reward_key.clone()));
            }
            reward.validate()?;
        }
        Ok(())
    }
}

/// Program-owned event input. Identity and state are compiled at attachment so
/// authors cannot mismatch an event's program or materialize it mid-lifecycle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DayEventTemplate {
    pub id: DayEventId,
    pub template_key: TemplateKey,
    pub phase_scope: PhaseScope,
    pub schedule: DayEventSchedule,
    pub participation: ParticipationSpec,
    pub resolution: DayEventResolutionMode,
    pub rewards: Vec<RewardBinding>,
    pub narrative: NarrativeTemplates,
    pub channel_policy: EventChannelPolicy,
}

impl DayEventTemplate {
    pub fn compile(&self, program_id: ProgramId) -> Result<DayEvent, ModelError> {
        let event = DayEvent {
            id: self.id.clone(),
            program_id,
            template_key: self.template_key.clone(),
            phase_scope: self.phase_scope.clone(),
            schedule: self.schedule.clone(),
            participation: self.participation.clone(),
            state: DayEventState::Scheduled,
            resolution: self.resolution,
            rewards: self.rewards.clone(),
            narrative: self.narrative.clone(),
            channel_policy: self.channel_policy,
        };
        event.validate()?;
        Ok(event)
    }
}

/// Small inline day-program document. Attachment stores this canonical value
/// and its content hash, then materializes immutable DayEvent definitions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct DayProgram {
    pub id: ProgramId,
    pub version: u32,
    pub display_name: String,
    pub theme_ref: Option<ContentRef>,
    #[serde(default)]
    pub narrative_templates: Vec<NarrativeTemplate>,
    pub events: Vec<DayEventTemplate>,
}

impl DayProgram {
    pub fn validate(&self) -> Result<(), ModelError> {
        if self.version == 0 {
            return Err(ModelError::ZeroProgramVersion);
        }
        if self.display_name.trim().is_empty() {
            return Err(ModelError::BlankProgramDisplayName);
        }
        if self.events.is_empty() {
            return Err(ModelError::EmptyDayProgram);
        }
        if !self.narrative_templates.is_empty() && self.theme_ref.is_none() {
            return Err(ModelError::MissingNarrativeThemeRef);
        }
        let mut narrative_templates = BTreeMap::new();
        for template in &self.narrative_templates {
            template.validate()?;
            if narrative_templates
                .insert(&template.key, template)
                .is_some()
            {
                return Err(ModelError::DuplicateNarrativeTemplate(template.key.clone()));
            }
        }
        let mut event_ids = BTreeSet::new();
        for event in &self.events {
            if !event_ids.insert(&event.id) {
                return Err(ModelError::DuplicateProgramEvent(event.id.clone()));
            }
            for (_, template_key) in event.narrative.iter() {
                if !narrative_templates.contains_key(template_key) {
                    return Err(ModelError::UnknownNarrativeTemplate(template_key.clone()));
                }
            }
            event.compile(self.id.clone())?;
        }
        Ok(())
    }

    pub fn compile(&self) -> Result<Vec<DayEvent>, ModelError> {
        self.validate()?;
        self.events
            .iter()
            .map(|event| event.compile(self.id.clone()))
            .collect()
    }

    pub fn content_hash(&self) -> Result<ProgramContentHash, ModelError> {
        self.validate()?;
        let canonical =
            serde_json::to_vec(self).map_err(|_| ModelError::CanonicalProgramSerialization)?;
        ProgramContentHash::new(blake3::hash(&canonical).to_hex().to_string())
    }

    pub fn artifact_ref(&self) -> Result<DayProgramRef, ModelError> {
        Ok(DayProgramRef {
            id: self.id.clone(),
            version: self.version,
            content_hash: self.content_hash()?,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub struct RewardAssignment {
    pub slot: SlotId,
    pub reward_key: RewardKey,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventDecision {
    SelectWinners { slots: Vec<SlotId> },
    SelectMapping { assignments: Vec<RewardAssignment> },
    CancelInstead { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventResolutionEvidence {
    HostDecision {
        participant_slots: Vec<SlotId>,
    },
    Auto {
        policy: AutoResolvePolicy,
        seed: Option<u64>,
        participant_slots: Vec<SlotId>,
    },
}

/// Typed event payloads for stream facts. Adapters own envelopes and persistence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[cfg_attr(feature = "typescript", derive(ts_rs::TS))]
pub enum DayEventEvent {
    Scheduled {
        event: DayEvent,
    },
    Opened {
        event_id: DayEventId,
        phase_id: PhaseId,
        opened_at: UnixSeconds,
    },
    Locked {
        event_id: DayEventId,
        locked_at: UnixSeconds,
    },
    Cancelled {
        event_id: DayEventId,
        reason: String,
    },
    OpenDue {
        event_id: DayEventId,
        due_at: UnixSeconds,
        observed_at: UnixSeconds,
        source: String,
    },
    LockDue {
        event_id: DayEventId,
        due_at: UnixSeconds,
        observed_at: UnixSeconds,
        source: String,
    },
    ParticipationSubmitted {
        event_id: DayEventId,
        actor_slot: SlotId,
        payload: ParticipationPayload,
        phase_id: PhaseId,
    },
    ParticipationWithdrawn {
        event_id: DayEventId,
        actor_slot: SlotId,
    },
    Resolved {
        event_id: DayEventId,
        decision: DayEventDecision,
        winner_slots: Vec<SlotId>,
        reward_keys_applied: Vec<RewardKey>,
        evidence: DayEventResolutionEvidence,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn id<T>(value: &str) -> T
    where
        T: TryFrom<String, Error = ModelError>,
    {
        T::try_from(value.to_owned()).unwrap()
    }

    fn principal(value: u128) -> PrincipalId {
        PrincipalId::from_uuid(Uuid::from_u128(value))
    }

    macro_rules! impl_try_from_string {
        ($($type:ty),+ $(,)?) => {
            $(
                impl TryFrom<String> for $type {
                    type Error = ModelError;

                    fn try_from(value: String) -> Result<Self, Self::Error> {
                        Self::new(value)
                    }
                }
            )+
        };
    }

    impl_try_from_string!(
        DayEventId,
        ProgramId,
        TemplateKey,
        RewardKey,
        SlotId,
        PhaseId,
        OptionId,
        Tag,
        ContentRef,
        ChannelId,
    );

    fn reward() -> RewardBinding {
        RewardBinding {
            reward_key: id("cookie"),
            display_name_theme_key: id("theme.cookie"),
            effects: vec![
                RewardEffectTemplate {
                    recipient: RecipientSelector::Winner,
                    operation: EffectOperationTemplate::Mark {
                        effect: id("cookie_owner"),
                    },
                },
                RewardEffectTemplate {
                    recipient: RecipientSelector::ExplicitSlot {
                        slot: id("slot-host-choice"),
                    },
                    operation: EffectOperationTemplate::RevealRole,
                },
            ],
        }
    }

    fn program() -> DayProgram {
        DayProgram {
            id: id("program-bakery"),
            version: 1,
            display_name: "Bakery mash".to_string(),
            theme_ref: Some(id("theme.bakery")),
            narrative_templates: Vec::new(),
            events: vec![DayEventTemplate {
                id: id("event-cookie"),
                template_key: id("theme.raffle"),
                phase_scope: PhaseScope::DuringDay { number: 1 },
                schedule: DayEventSchedule::HostOpened,
                participation: ParticipationSpec {
                    who: ParticipantFilter::AliveSlots,
                    mode: ParticipationMode::OptIn,
                    limits: ParticipationLimits {
                        minimum: 1,
                        maximum: None,
                    },
                },
                resolution: DayEventResolutionMode::HostDecision,
                rewards: vec![reward()],
                narrative: NarrativeTemplates {
                    opened: None,
                    locked: None,
                    resolved: None,
                    cancelled: None,
                },
                channel_policy: EventChannelPolicy::PublicMain,
            }],
        }
    }

    #[test]
    fn reward_templates_compile_to_fully_bound_effects() {
        let plan = reward()
            .compile_plan(
                id("event-1"),
                &RecipientBindings {
                    winners: vec![id("slot-2"), id("slot-2")],
                    participants: vec![],
                    host_chosen: vec![],
                },
                "raffle reward",
            )
            .unwrap();

        assert_eq!(plan.effects.len(), 2);
        assert!(matches!(
            &plan.effects[0],
            ConcreteEffect::Mark { target, effect }
                if target.as_str() == "slot-2" && effect.as_str() == "cookie_owner"
        ));
        assert!(matches!(
            &plan.effects[1],
            ConcreteEffect::RevealRole { target } if target.as_str() == "slot-host-choice"
        ));
    }

    #[test]
    fn unresolved_recipient_cannot_cross_compiler_boundary() {
        let error = reward()
            .bind(&RecipientBindings {
                winners: vec![],
                participants: vec![],
                host_chosen: vec![],
            })
            .unwrap_err();

        assert_eq!(error, ModelError::MissingRecipients { selector: "winner" });
    }

    #[test]
    fn fiat_plans_validate_the_same_concrete_catalog() {
        let error = EffectPlan::try_new(
            EffectOrigin::HostFiat {
                principal_id: principal(1),
            },
            vec![ConcreteEffect::Grant {
                target: id("slot-2"),
                grant: GrantSpec {
                    grant_id: id("double-vote"),
                    kind: GrantKind::VoteWeight,
                    uses: 1,
                    vote_weight: None,
                    visibility: EffectVisibility::Target,
                },
            }],
            "manual reward",
        )
        .unwrap_err();

        assert_eq!(error, ModelError::InvalidVoteWeight);
    }

    #[test]
    fn invalid_schedules_and_payloads_are_rejected() {
        let schedule = DayEventSchedule::Absolute {
            open_at: UnixSeconds::new(20),
            lock_at: Some(UnixSeconds::new(20)),
        };
        assert_eq!(
            schedule.validate(),
            Err(ModelError::InvalidWindow {
                kind: "absolute schedule"
            })
        );

        let participation = ParticipationSpec {
            who: ParticipantFilter::AliveSlots,
            mode: ParticipationMode::OptIn,
            limits: ParticipationLimits {
                minimum: 0,
                maximum: None,
            },
        };
        assert!(matches!(
            participation.validate_payload(&ParticipationPayload::Choice {
                option_id: id("red")
            }),
            Err(ModelError::ParticipationPayloadMismatch { .. })
        ));
    }

    #[test]
    fn terminal_day_event_states_have_no_outbound_transition() {
        for state in [DayEventState::Resolved, DayEventState::Cancelled] {
            for next in [
                DayEventState::Scheduled,
                DayEventState::Open,
                DayEventState::Locked,
                DayEventState::Resolved,
                DayEventState::Cancelled,
            ] {
                assert!(!state.can_transition_to(next));
            }
        }
    }

    #[test]
    fn validated_identifiers_reject_blank_deserialization() {
        let error = serde_json::from_str::<SlotId>("\"  \"").unwrap_err();
        assert!(error.to_string().contains("slot id must not be blank"));
    }

    #[test]
    fn day_program_compiles_identity_and_scheduled_state() {
        let compiled = program().compile().unwrap();
        assert_eq!(compiled.len(), 1);
        assert_eq!(compiled[0].program_id.as_str(), "program-bakery");
        assert_eq!(compiled[0].state, DayEventState::Scheduled);
        assert_eq!(program().content_hash().unwrap().as_str().len(), 64);
        assert_eq!(program().content_hash(), program().content_hash());
    }

    #[test]
    fn day_program_rejects_duplicate_event_identity() {
        let mut invalid = program();
        invalid.events.push(invalid.events[0].clone());
        assert_eq!(
            invalid.validate(),
            Err(ModelError::DuplicateProgramEvent(id("event-cookie")))
        );
    }

    #[test]
    fn grant_kind_uses_snake_case_at_the_platform_boundary() {
        for (kind, name) in [
            (GrantKind::ExtraAction, "extra_action"),
            (GrantKind::Item, "item"),
            (GrantKind::VoteWeight, "vote_weight"),
        ] {
            let grant = GrantSpec {
                grant_id: id("grant"),
                kind,
                uses: 1,
                vote_weight: (kind == GrantKind::VoteWeight).then_some(2.0),
                visibility: EffectVisibility::Target,
            };
            let encoded = serde_json::to_value(&grant).unwrap();
            assert_eq!(encoded["kind"], name);
            assert_eq!(serde_json::from_value::<GrantSpec>(encoded).unwrap(), grant);
        }
    }
}
