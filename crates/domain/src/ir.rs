//! IR: the closed, versioned vocabulary of primitive abilities (doc 09).

use serde::{Deserialize, Serialize};

/// IR ability vocabulary. Closed set, versioned by `ir_version`.
/// v1 ships these 8. `IrAbility` is a **flat tag**: the Investigate mode rides
/// alongside on the `ActionTemplate` (`mode`), it is not folded into the enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum IrAbility {
    Kill,
    Protect,
    Block,
    Redirect,
    Investigate,
    Convert,
    Mark,
    Clear,
}

/// Investigate is parameterized by mode rather than split into many primitives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum InvestigateMode {
    Parity,
    Track,
    Watch,
    Motion,
}

/// Capability flags adjusting how an ability interacts with the
/// precedence/visibility tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Modifier {
    Strongman,
    Ninja,
    Loyal,
    Roleblockable,
    Reflexive,
}
