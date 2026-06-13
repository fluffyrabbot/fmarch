//! fmarch `domain` crate — the PURE, deterministic resolution engine (doc 09/10).
//!
//! No tokio, no sqlx, no networking, no wall-clock, no system RNG. Only `serde`
//! (+ `serde_json`) for the contract types. Any randomness is a seeded, inline
//! deterministic PRNG (see `resolver::DetRng`).

pub mod events;
pub mod ir;
pub mod pack;
pub mod resolver;
pub mod state;

pub use events::{
    DayVoteOutcome, Death, InnerEvent, PhaseAnnouncement, ResolutionApplied, VoteStatus,
};
pub use ir::{InvestigateMode, IrAbility, Modifier};
pub use pack::Pack;
pub use resolver::{resolve, ResolutionInput, RESULT_VERSION};
pub use state::{SlotState, StateSnapshot, Submission};
