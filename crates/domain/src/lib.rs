//! fmarch `domain` crate — the PURE, deterministic resolution engine (doc 09/10).
//!
//! No tokio, no sqlx, no networking, no wall-clock, no system RNG. Only `serde`
//! (+ `serde_json`) for the contract types. Any randomness is a seeded, inline
//! deterministic PRNG (see `resolver::DetRng`).

pub mod events;
pub mod golden;
pub mod ir;
pub mod pack;
pub mod resolver;
pub mod state;

pub use events::{
    validate_resolution_applied, validate_resolution_json, validate_resolution_trace,
    validate_trace_json, DayAnnouncement, DayVoteOutcome, Death, DecisionTrace, DuelResult,
    EffectDeltaTrace, GeneratedActionTrace, HostPromptIssued, InnerEvent, ItaCounters,
    ItaShotOutcome, LastWordsRecorded, LastWordsVoteSummary, PhaseAnnouncement, ResolutionApplied,
    ResolutionTrace, ResultValidationError, TraceEdge, VisibilityTrace, VoteStatus, TRACE_VERSION,
};
pub use golden::{
    golden_events_from_input_value, golden_pack_json_with_overrides, normalize_golden_event,
    normalize_golden_events, GoldenFixtureError,
};
pub use ir::{InvestigateMode, IrAbility, Modifier};
pub use pack::{
    load_pack_from_json, night_ability_order, upcast_pack_json, validate_pack, BackupPolicy,
    BelovedPrincessPolicy, DayAnnouncementPolicy, DayNotePolicy, DayVotePromptPolicy,
    DeathRetaliationPolicy, DeathRevealMode, DeathRevealPolicy, EffectDuration, EffectVisibility,
    GrantKind, GrantSpec, HostPromptDecisionKind, HostPromptResolutionEffect,
    HostPromptResolutionEffectPolicy, IdiotPolicy, InvestigationResultPolicy, LastWordsPolicy,
    Pack, PackLoadError, PackMigrationError, PackValidationError, PackValidationIssue,
    ParityResultPolicy, RoleModifier, SelfDestructSpec, WinCondition, WinPolicy, WinRule,
    WolfBeautyPolicy, WolfCarryPolicy, MIN_SUPPORTED_IR_VERSION, SUPPORTED_IR_VERSION,
    SUPPORTED_PACK_VERSION,
};
pub use resolver::{
    check_win, resolve, resolve_events, resolve_instant, DayAnnouncementInput, DayPhaseInputs,
    ResolutionInput, ResolutionOutput, RESULT_VERSION,
};
pub use state::{
    apply_events, ActionCounterRecord, ActionGrantRecord, BackupTargetRecord,
    ConversionOriginRecord, DelayedDeathRecord, EffectRecord, InvestigationMemoryRecord,
    LinkRecord, PrivateChannelRecord, RetaliationRecord, RevealState, SlotLifecycle, SlotState,
    StateSnapshot, Submission, VisitRecord, WolfBeautyMarkRecord, WolfCarryTokenRecord,
};
