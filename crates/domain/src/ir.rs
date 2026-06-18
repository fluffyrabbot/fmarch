//! IR: the closed, versioned vocabulary of primitive abilities (doc 09).

use serde::{Deserialize, Serialize};

/// IR ability vocabulary. Closed set, versioned by `ir_version`.
/// v1 shipped the first 8 abilities. `IrAbility` is a **flat tag**: the Investigate mode rides
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
    Grant,
    Link,
    Retaliate,
    Badge,
    Duel,
    ItaShot,
    SelfDestruct,
    Visit,
    RevealTown,
    VoteDuel,
    Veto,
    Info,
}

/// Investigate is parameterized by mode rather than split into many primitives.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum InvestigateMode {
    Parity,
    Vanilla,
    Neapolitan,
    Gunsmith,
    Killer,
    Specialist,
    PtAccess,
    Role,
    FullRole,
    Track,
    Watch,
    RoleWatcher,
    RoleGuard,
    SecurityGuard,
    Voyeur,
    ActionType,
    Motion,
    PriorMotion,
}

/// Capability flags adjusting how an ability interacts with the
/// precedence/visibility tables.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Modifier {
    Strongman,
    Ninja,
    Loyal,
    Disloyal,
    Bodyguard,
    Martyr,
    Cpr,
    Weak,
    Lazy,
    Loud,
    Announcing,
    XShot,
    OddNight,
    EvenNight,
    NonConsecutive,
    Indecisive,
    Uncooperative,
    Roaming,
    DisabledEndgame,
    Compulsive,
    Simultaneous,
    Roleblockable,
    Reflexive,
    Personal,
    StrongWilled,
    Babysitter,
    Hider,
}
