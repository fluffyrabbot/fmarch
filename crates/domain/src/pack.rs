//! Declarative pack model and validation boundary (doc 09).
//!
//! `model` owns serialized pack data and defaults. `validation` owns loading,
//! derived cross-reference indexes, diagnostics, and execution ordering checks.

mod model;
mod validation;

pub use model::*;
pub use validation::{
    load_pack_from_json, night_ability_order, validate_pack, validate_pack_validated,
    PackLoadError, PackValidationError, PackValidationIssue, ValidatedPack,
};
pub(crate) use validation::{visibility_required_families, win_required_families};

#[cfg(test)]
mod validation_tests;
