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
//!   the `game_authority` and open occupancy-epoch projections to DERIVE the set of
//!   capabilities the principal holds — never from ambient globals. Capability is
//!   resolved ONCE at the boundary; inner code receives a [`CapabilitySet`] and
//!   asks it `grants(required)`. It does not re-derive authority.
//! - [`resolve_live_delivery_in_tx`] is the delivery-fence variant. It resolves
//!   the same authority while taking shared row locks on every existing row
//!   whose mutation could revoke a returned capability. The caller keeps that
//!   transaction open through the protected delivery, then commits or rolls it
//!   back to release the fence.
//!
//! This is the confused-deputy defense: a component can only exercise authority
//! it was handed.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use sqlx::{postgres::PgPool, PgConnection, Postgres, Row, Transaction};
use uuid::Uuid;

pub use principal::PrincipalId;

// Re-export the id aliases so callers speak one vocabulary.
pub type GameId = Uuid;
pub type SlotId = String;
pub type ChannelId = String;

/// An authenticated authority admitted to capability resolution.
///
/// This boundary wrapper deliberately carries only the canonical platform
/// [`PrincipalId`]. Provider subjects and account names never enter capability
/// resolution as identities.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Principal(PrincipalId);

impl Principal {
    pub const fn authenticated(id: PrincipalId) -> Self {
        Self(id)
    }

    /// The UUID-backed authority whose capabilities are being resolved.
    pub const fn id(self) -> PrincipalId {
        self.0
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
    /// Read the game-scoped spectator room without occupying a player slot.
    SpectatorOf(GameId),
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
            | Capability::SpectatorOf(_)
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
/// Reads ONLY committed projections (`game_authority`, `spectator_membership`,
/// open occupancy epochs and `slot_state`) so the result reflects real game state, never a stale client
/// claim or an ambient global. After a replacement the outgoing user's
/// slot-derived capabilities are gone and the incoming user's are granted —
/// because occupancy is the live mapping and the slot id is stable (doc 06 /
/// doc 01). A current occupant receives [`Capability::DeadViewer`] whenever at
/// least one of their occupied slots is dead; restoring that slot alive revokes
/// the capability on the next boundary resolution.
///
/// Global capabilities (`GlobalAdmin`/`GlobalMod`) are intentionally not derived
/// here. The identity boundary reads their single durable source on
/// `platform_principal`; callers may combine that freshly validated authority
/// with this game-scoped result without making the game resolver an auth store.
pub async fn resolve(
    pool: &PgPool,
    principal: &Principal,
    game: GameId,
) -> Result<CapabilitySet, CapError> {
    let mut conn = pool.acquire().await?;
    resolve_with(&mut conn, principal, game).await
}

/// Resolve capabilities from the caller's command transaction. This keeps the
/// authority snapshot in the same atomic unit as validation, append, projection
/// folding, and receipt commit.
pub async fn resolve_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: GameId,
) -> Result<CapabilitySet, CapError> {
    resolve_with(tx, principal, game).await
}

const LIVE_DELIVERY_GAME_AUTHORITY_SQL: &str = "SELECT role FROM game_authority \
     WHERE game_id = $1 AND principal_id = $2 \
     ORDER BY role FOR SHARE";
const LIVE_DELIVERY_SPECTATOR_SQL: &str = "SELECT principal_id FROM spectator_membership \
     WHERE game_id = $1 AND principal_id = $2 \
     ORDER BY principal_id FOR SHARE";
const LIVE_DELIVERY_SUBJECT_SQL: &str = "SELECT subject_id FROM privacy_subject \
     WHERE principal_id = $1 \
     ORDER BY subject_id";
const LIVE_DELIVERY_BINDING_SQL: &str = "SELECT persona_id FROM game_persona_subject_binding \
     WHERE game_id = $1 AND subject_id = ANY($2::uuid[]) AND lifecycle = 'active' \
     ORDER BY persona_id FOR SHARE";
const LIVE_DELIVERY_OCCUPANCY_SQL: &str = "SELECT occupancy_id, slot_id FROM slot_occupancy_epoch \
     WHERE game_id = $1 AND persona_id = ANY($2::uuid[]) AND ended_seq IS NULL \
     ORDER BY slot_id, occupancy_id FOR SHARE";
const LIVE_DELIVERY_SLOT_STATE_SQL: &str = "SELECT slot_id, alive FROM slot_state \
     WHERE game_id = $1 AND slot_id = ANY($2::text[]) \
     ORDER BY slot_id FOR SHARE";
const LIVE_DELIVERY_CHANNEL_SQL: &str = "SELECT channel_id, slot_id FROM private_channel_member \
     WHERE game_id = $1 AND slot_id = ANY($2::text[]) \
     ORDER BY channel_id, slot_id FOR SHARE";

/// Resolve current game capabilities and fence every existing row whose
/// mutation can revoke one of the returned grants.
///
/// The lock order is deliberately fixed across relation types and total within
/// each query:
///
/// 1. `game_authority` by role;
/// 2. `spectator_membership` by principal;
/// 3. read the `privacy_subject` identifier while the caller's exact-session
///    fence transitively prevents owner lifecycle completion;
/// 4. active `game_persona_subject_binding` by persona;
/// 5. open `slot_occupancy_epoch` by slot and occupancy id;
/// 6. `slot_state` by slot;
/// 7. `private_channel_member` by channel and slot.
///
/// These are separate statements rather than a joined `SELECT DISTINCT ...
/// FOR SHARE`: PostgreSQL cannot apply a locking clause to a `DISTINCT` result,
/// and explicit statements make both the locked relation and acquisition order
/// reviewable. The subject lookup deliberately does not take a row lock after
/// the session: every owner lifecycle mutation follows owner -> session order,
/// and the caller's exact-session lock already prevents it from completing.
/// Locking the owner after the session would invert that order. Inserts can only
/// add authority and need not be fenced. Updates or deletes of rows supporting
/// a returned game capability conflict with `FOR SHARE` and wait until the
/// caller commits or rolls back `tx` after delivery.
pub async fn resolve_live_delivery_in_tx(
    tx: &mut Transaction<'_, Postgres>,
    principal: &Principal,
    game: GameId,
) -> Result<CapabilitySet, CapError> {
    let principal_id = principal.id().as_uuid();
    let mut set = CapabilitySet::new();

    let authority = sqlx::query(LIVE_DELIVERY_GAME_AUTHORITY_SQL)
        .bind(game)
        .bind(principal_id)
        .fetch_all(&mut **tx)
        .await?;
    for row in authority {
        match row.get::<String, _>("role").as_str() {
            "host" => set.insert(Capability::HostOf(game)),
            "cohost" => set.insert(Capability::CohostOf(game)),
            _ => {}
        }
    }

    let spectator = sqlx::query_scalar::<_, Uuid>(LIVE_DELIVERY_SPECTATOR_SQL)
        .bind(game)
        .bind(principal_id)
        .fetch_optional(&mut **tx)
        .await?;
    if spectator.is_some() {
        set.insert(Capability::SpectatorOf(game));
    }

    let subject_ids = sqlx::query_scalar::<_, Uuid>(LIVE_DELIVERY_SUBJECT_SQL)
        .bind(principal_id)
        .fetch_all(&mut **tx)
        .await?;
    let persona_ids = sqlx::query_scalar::<_, Uuid>(LIVE_DELIVERY_BINDING_SQL)
        .bind(game)
        .bind(&subject_ids)
        .fetch_all(&mut **tx)
        .await?;
    let occupancy = sqlx::query_as::<_, (Uuid, String)>(LIVE_DELIVERY_OCCUPANCY_SQL)
        .bind(game)
        .bind(&persona_ids)
        .fetch_all(&mut **tx)
        .await?;
    let occupied_slots = occupancy
        .into_iter()
        .map(|(_, slot_id)| slot_id)
        .collect::<BTreeSet<_>>();
    for slot_id in &occupied_slots {
        set.insert(Capability::SlotOccupant(slot_id.clone()));
    }
    let occupied_slots = occupied_slots.into_iter().collect::<Vec<_>>();

    let slot_states = sqlx::query_as::<_, (String, bool)>(LIVE_DELIVERY_SLOT_STATE_SQL)
        .bind(game)
        .bind(&occupied_slots)
        .fetch_all(&mut **tx)
        .await?;
    if slot_states.iter().any(|(_, alive)| !alive) {
        set.insert(Capability::DeadViewer(game));
    }

    let channels = sqlx::query_as::<_, (String, String)>(LIVE_DELIVERY_CHANNEL_SQL)
        .bind(game)
        .bind(&occupied_slots)
        .fetch_all(&mut **tx)
        .await?;
    for (channel_id, _) in channels {
        set.insert(Capability::ChannelMember(channel_id));
    }

    Ok(set)
}

async fn resolve_with(
    conn: &mut PgConnection,
    principal: &Principal,
    game: GameId,
) -> Result<CapabilitySet, CapError> {
    let principal_id = principal.id().as_uuid();
    let mut set = CapabilitySet::new();

    let authority = sqlx::query(
        "SELECT role FROM game_authority WHERE game_id = $1 AND principal_id = $2 ORDER BY role",
    )
    .bind(game)
    .bind(principal_id)
    .fetch_all(&mut *conn)
    .await?;
    for row in authority {
        match row.get::<String, _>("role").as_str() {
            "host" => set.insert(Capability::HostOf(game)),
            "cohost" => set.insert(Capability::CohostOf(game)),
            _ => {}
        }
    }

    let spectator: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM spectator_membership WHERE game_id = $1 AND principal_id = $2)",
    )
    .bind(game)
    .bind(principal_id)
    .fetch_one(&mut *conn)
    .await?;
    if spectator {
        set.insert(Capability::SpectatorOf(game));
    }

    let occupied_slots: BTreeSet<String> = sqlx::query(
        "SELECT o.slot_id FROM slot_occupancy_epoch o \
         JOIN game_persona_subject_binding binding ON binding.game_id = o.game_id AND binding.persona_id = o.persona_id AND binding.lifecycle = 'active' \
         JOIN privacy_subject subject ON subject.subject_id = binding.subject_id \
         WHERE o.game_id = $1 AND subject.principal_id = $2 AND o.ended_seq IS NULL ORDER BY o.slot_id",
    )
    .bind(game)
    .bind(principal_id)
    .fetch_all(&mut *conn)
    .await?
    .into_iter()
    .map(|row| row.get("slot_id"))
    .collect();
    for slot_id in &occupied_slots {
        set.insert(Capability::SlotOccupant(slot_id.clone()));
    }

    let dead_occupant: bool = sqlx::query_scalar(
        "SELECT EXISTS(\
            SELECT 1 FROM slot_occupancy_epoch o \
            JOIN game_persona_subject_binding binding ON binding.game_id = o.game_id AND binding.persona_id = o.persona_id AND binding.lifecycle = 'active' \
            JOIN privacy_subject subject ON subject.subject_id = binding.subject_id \
            JOIN slot_state s ON s.game_id = o.game_id AND s.slot_id = o.slot_id \
            WHERE o.game_id = $1 AND subject.principal_id = $2 AND o.ended_seq IS NULL AND NOT s.alive\
         )",
    )
    .bind(game)
    .bind(principal_id)
    .fetch_one(&mut *conn)
    .await?;
    if dead_occupant {
        set.insert(Capability::DeadViewer(game));
    }

    let channels = sqlx::query(
        "SELECT DISTINCT m.channel_id FROM private_channel_member m \
         JOIN slot_occupancy_epoch o ON o.game_id = m.game_id AND o.slot_id = m.slot_id AND o.ended_seq IS NULL \
         JOIN game_persona_subject_binding binding ON binding.game_id = o.game_id AND binding.persona_id = o.persona_id AND binding.lifecycle = 'active' \
         JOIN privacy_subject subject ON subject.subject_id = binding.subject_id \
         WHERE m.game_id = $1 AND subject.principal_id = $2 ORDER BY m.channel_id",
    )
    .bind(game)
    .bind(principal_id)
    .fetch_all(&mut *conn)
    .await?;
    for row in channels {
        set.insert(Capability::ChannelMember(row.get("channel_id")));
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

    #[test]
    fn live_delivery_lock_contract_is_total_ordered_and_distinct_free() {
        let queries = [
            (
                "game_authority",
                LIVE_DELIVERY_GAME_AUTHORITY_SQL,
                "ORDER BY role FOR SHARE",
            ),
            (
                "spectator_membership",
                LIVE_DELIVERY_SPECTATOR_SQL,
                "ORDER BY principal_id FOR SHARE",
            ),
            (
                "game_persona_subject_binding",
                LIVE_DELIVERY_BINDING_SQL,
                "ORDER BY persona_id FOR SHARE",
            ),
            (
                "slot_occupancy_epoch",
                LIVE_DELIVERY_OCCUPANCY_SQL,
                "ORDER BY slot_id, occupancy_id FOR SHARE",
            ),
            (
                "slot_state",
                LIVE_DELIVERY_SLOT_STATE_SQL,
                "ORDER BY slot_id FOR SHARE",
            ),
            (
                "private_channel_member",
                LIVE_DELIVERY_CHANNEL_SQL,
                "ORDER BY channel_id, slot_id FOR SHARE",
            ),
        ];

        assert_eq!(
            queries.map(|(relation, _, _)| relation),
            [
                "game_authority",
                "spectator_membership",
                "game_persona_subject_binding",
                "slot_occupancy_epoch",
                "slot_state",
                "private_channel_member",
            ]
        );
        for (relation, query, ordered_lock_clause) in queries {
            assert!(
                query.contains(relation),
                "lock query must name {relation}: {query}"
            );
            assert!(
                query.contains(ordered_lock_clause),
                "{relation} rows must be totally ordered before locking: {query}"
            );
            assert_eq!(
                query.matches("FOR SHARE").count(),
                1,
                "{relation} must be locked exactly once"
            );
            assert!(
                !query.contains("DISTINCT"),
                "PostgreSQL rejects DISTINCT results with FOR SHARE: {query}"
            );
        }
        assert!(LIVE_DELIVERY_SUBJECT_SQL.contains("ORDER BY subject_id"));
        assert!(!LIVE_DELIVERY_SUBJECT_SQL.contains("FOR SHARE"));
    }
}
