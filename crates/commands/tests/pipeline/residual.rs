//! Ordinary residual pipeline integration tests (non-DayEvent family).
//!
//! Heavy semantic and generated audits have their own `semantic_audit` target.
//! Test support is source-shared so the two targets cannot drift by copying
//! harness behavior.

use crate::common::*;

include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/pipeline/residual_support.rs"
));
include!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/tests/pipeline/residual_cases.rs"
));
