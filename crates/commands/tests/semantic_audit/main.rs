//! Full semantic and generated command audit against real Postgres.
//!
//! This target is physically separate from the ordinary command pipeline so
//! path selection and Cargo compilation can preserve audit fidelity without
//! charging every command-test edit for the heavyweight corpus.

#[path = "../pipeline/common.rs"]
#[allow(dead_code)]
mod common;

// Support is source-shared with the ordinary target, so target-local liveness
// is intentionally weaker than whole-corpus liveness.
#[allow(dead_code, unused_imports)]
mod residual {
    use crate::common::*;

    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/pipeline/residual_support.rs"
    ));
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/semantic_audit/cases.rs"
    ));
}
