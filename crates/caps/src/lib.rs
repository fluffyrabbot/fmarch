//! `caps` — capabilities and their resolution at the trust boundary (doc 06).
//!
//! Authority in this domain is **per-game scoped**: a host of one game has zero
//! authority in another. Global roles cannot express that, so we model authority
//! as **capabilities** — unforgeable, scoped grants resolved from the principal
//! against committed game state.
//!
//! Two layers, kept apart on purpose (doc 06 / hard constraint):
//!
//! - The capability **types** ([`Capability`], [`Principal`], [`CapabilitySet`])
//!   are PURE and exhaustively testable. No IO. The least-authority predicates
//!   (`grants`) live here.
//! - [`resolve`] is the IO half: given a [`Principal`] + game context it reads
//!   the `game_authority` and `slot_occupancy` projections to DERIVE the set of
//!   capabilities the principal holds — never from ambient globals. Capability is
//!   resolved ONCE at the boundary; inner code receives a [`CapabilitySet`] and
//!   asks it `grants(required)`. It does not re-derive authority.
//!
//! This is the confused-deputy defense: a component can only exercise authority
//! it was handed.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use uuid::Uuid;

// Re-export the id aliases so callers speak one vocabulary.
pub type UserId = String;
pub type GameId = Uuid;
pub type SlotId = String;
pub type ChannelId = String;

/// A principal is *who is acting*. For now only platform users exist; auth
/// (sessions, tokens) is a later phase, so a [`Principal`] is taken as given at
/// the boundary rather than authenticated here.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Principal {
    User(UserId),
}

impl Principal {
    pub fn user(id: impl Into<UserId>) -> Self {
        Principal::User(id.into())
    }

    /// The underlying user id (the only principal kind today).
    pub fn user_id(&self) -> &str {
        match self {
            Principal::User(u) => u,
        }
    }
}

/// An unforgeable, scoped grant of authority (doc 06 vocabulary). `Ord` so a
/// [`CapabilitySet`] can be a `BTreeSet` (deterministic iteration).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Capability {
    /// Platform operations.
    GlobalAdmin,
    /// Cross-game moderation / escalation.
    GlobalMod,
    /// Run this game (deadlines, phases, reveals, replacements).
    HostOf(GameId),
    /// Delegated host authority for this game.
    CohostOf(GameId),
    /// Act as this slot: post, vote — bound to the slot's CURRENT occupant.
    SlotOccupant(SlotId),
    /// Read/post in this channel.
    ChannelMember(ChannelId),
    /// See dead-visible content.
    DeadViewer(GameId),
}

/// The set of capabilities a principal holds in a resolved context. Resolved
/// once at the boundary and passed inward; inner code asks [`Self::grants`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CapabilitySet {
    held: BTreeSet<Capability>,
}

impl CapabilitySet {
    pub fn new() -> Self {
        CapabilitySet {
            held: BTreeSet::new(),
        }
    }

    pub fn insert(&mut self, cap: Capability) {
        self.held.insert(cap);
    }

    pub fn iter(&self) -> impl Iterator<Item = &Capability> {
        self.held.iter()
    }

    pub fn is_empty(&self) -> bool {
        self.held.is_empty()
    }

    /// Does this set grant `required`? **Least authority**: the predicate is
    /// narrow — the exact capability must be present, with one deliberate
    /// monotonic widening: a global operator (`GlobalAdmin`/`GlobalMod`) and a
    /// `HostOf(g)` subsume `CohostOf(g)` (a host can do anything a cohost can).
    ///
    /// PURE: a total function of the set and the request. The boundary computes
    /// the required capability for a command and calls this once.
    pub fn grants(&self, required: &Capability) -> bool {
        if self.held.contains(required) {
            return true;
        }
        match required {
            // Cohost authority is also satisfied by the game's host or a global
            // operator. Host authority is NOT satisfied by a cohost (a cohost is
            // strictly narrower) — this asymmetry is the least-authority spine.
            Capability::CohostOf(g) => {
                self.held.contains(&Capability::HostOf(*g)) || self.has_global()
            }
            // Host / DeadViewer / etc. may be escalated by a global operator, but
            // never by a same-game lesser capability.
            Capability::HostOf(_)
            | Capability::DeadViewer(_)
            | Capability::SlotOccupant(_)
            | Capability::ChannelMember(_) => self.has_global(),
            Capability::GlobalAdmin | Capability::GlobalMod => false,
        }
    }

    fn has_global(&self) -> bool {
        self.held.contains(&Capability::GlobalAdmin) || self.held.contains(&Capability::GlobalMod)
    }
}

impl FromIterator<Capability> for CapabilitySet {
    fn from_iter<I: IntoIterator<Item = Capability>>(it: I) -> Self {
        CapabilitySet {
            held: it.into_iter().collect(),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CapError {
    #[error(transparent)]
    Projection(#[from] projections::ProjectionError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Resolve the capabilities a `principal` holds in `game` (the IO half).
///
/// Reads ONLY committed projections (`game_authority`, `slot_occupancy`, and
/// `slot_state`) so the result reflects real game state, never a stale client
/// claim or an ambient global. After a replacement the outgoing user's
/// slot-derived capabilities are gone and the incoming user's are granted —
/// because occupancy is the live mapping and the slot id is stable (doc 06 /
/// doc 01). A current occupant receives [`Capability::DeadViewer`] whenever at
/// least one of their occupied slots is dead; restoring that slot alive revokes
/// the capability on the next boundary resolution.
///
/// Global capabilities (`GlobalAdmin`/`GlobalMod`) are intentionally NOT derived
/// here: there is no auth/role store yet (a later phase). They can be injected by
/// the caller into the returned set if a future global-role projection exists.
pub async fn resolve(
    pool: &PgPool,
    principal: &Principal,
    game: GameId,
) -> Result<CapabilitySet, CapError> {
    let user = principal.user_id();
    let mut set = CapabilitySet::new();

    // Host / cohost from game_authority.
    for row in projections::game_authority(pool, game).await? {
        if row.user_id == user {
            match row.role.as_str() {
                "host" => set.insert(Capability::HostOf(game)),
                "cohost" => set.insert(Capability::CohostOf(game)),
                _ => {}
            }
        }
    }

    let occupied_slots: BTreeSet<_> = projections::slot_occupancy(pool, game)
        .await?
        .into_iter()
        .filter_map(|occ| {
            if occ.occupant_user_id == user {
                Some(occ.slot_id)
            } else {
                None
            }
        })
        .collect();

    // SlotOccupant for every slot this user CURRENTLY occupies (live mapping).
    for slot_id in &occupied_slots {
        set.insert(Capability::SlotOccupant(slot_id.clone()));
    }

    // DeadViewer follows the CURRENT occupant of any dead slot. It is derived
    // from the same stable-slot/current-occupancy join as SlotOccupant, so a
    // replacement transfers dead-chat authority and an alive restoration
    // revokes it without a separate mutable grant.
    if projections::slot_state(pool, game)
        .await?
        .into_iter()
        .any(|slot| !slot.alive && occupied_slots.contains(&slot.slot_id))
    {
        set.insert(Capability::DeadViewer(game));
    }

    // ChannelMember from private channel membership projections for the
    // principal's current slot(s). This keeps private channel authority derived
    // from committed game state, not client-selected channel ids.
    for member in projections::private_channel_members(pool, game).await? {
        if occupied_slots.contains(&member.slot_id) {
            set.insert(Capability::ChannelMember(member.channel_id));
        }
    }

    Ok(set)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> GameId {
        Uuid::nil()
    }

    #[test]
    fn exact_capability_grants_itself() {
        let set = CapabilitySet::from_iter([Capability::SlotOccupant("slot_7".into())]);
        assert!(set.grants(&Capability::SlotOccupant("slot_7".into())));
        assert!(!set.grants(&Capability::SlotOccupant("slot_8".into())));
    }

    #[test]
    fn host_subsumes_cohost_but_not_vice_versa() {
        let host = CapabilitySet::from_iter([Capability::HostOf(game())]);
        assert!(host.grants(&Capability::CohostOf(game())));
        assert!(host.grants(&Capability::HostOf(game())));

        let cohost = CapabilitySet::from_iter([Capability::CohostOf(game())]);
        assert!(cohost.grants(&Capability::CohostOf(game())));
        assert!(
            !cohost.grants(&Capability::HostOf(game())),
            "cohost is strictly narrower than host (least authority)"
        );
    }

    #[test]
    fn slot_occupant_does_not_imply_host() {
        let set = CapabilitySet::from_iter([Capability::SlotOccupant("slot_1".into())]);
        assert!(!set.grants(&Capability::HostOf(game())));
        assert!(!set.grants(&Capability::CohostOf(game())));
    }

    #[test]
    fn global_admin_escalates() {
        let set = CapabilitySet::from_iter([Capability::GlobalAdmin]);
        assert!(set.grants(&Capability::HostOf(game())));
        assert!(set.grants(&Capability::CohostOf(game())));
        assert!(set.grants(&Capability::SlotOccupant("slot_1".into())));
    }

    #[test]
    fn empty_set_grants_nothing() {
        let set = CapabilitySet::new();
        assert!(!set.grants(&Capability::HostOf(game())));
        assert!(!set.grants(&Capability::SlotOccupant("slot_1".into())));
    }
}
