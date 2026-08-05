//! Residual pipeline integration tests (non day-event family).
//!
//! Body remains in `tests/pipeline.rs` and is included here so the first split
//! can land without rewriting ~75k lines of residual cases. That file is not an
//! autotest target (see `crates/commands/Cargo.toml`).
//!
//! The DayEvent family lives in `day_events`; shared helpers live in `common`.

use crate::common::*;

include!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/pipeline.rs"));
