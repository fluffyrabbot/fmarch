//! `projections` — synchronous, rebuildable read models over the event log
//! (doc 02 / doc 10).
//!
//! Projections here:
//! - `votecount`      — the RUNNING tally. Phase-3 ruling: UNWEIGHTED, keyed by
//!   each actor-slot's CURRENT ballot. A `VoteSubmitted` OVERWRITES that actor's
//!   ballot; `VoteWithdrawn { actor, phase_id }` removes it; the tally is the
//!   COUNT of targets. Backed by the `vote_ballot` table (one row per actor per
//!   phase) so overwrite/withdraw are pure local upsert/delete. Weights remain an
//!   engine/official-`DayVoteOutcome` concern, NOT the running tally.
//! - `slot_state`     — per-slot lifecycle + role/alignment reveal, folded
//!   from `RoleAssigned`, death flips, and end-game reveal events.
//! - `slot_effect`    — role-level and persistent engine effect tags folded
//!   from `RoleAssigned` plus `EffectsMarked`/`EffectsCleared`, so cross-phase
//!   facts are rebuildable.
//! - `action_history` — engine action-use facts folded from `ActionRecorded`,
//!   so cadence constraints and audits are rebuildable without reinterpreting
//!   raw submissions.
//! - `action_grant`   — generated capability/item inventory folded from
//!   `ActionGranted` and decremented by `ActionGrantConsumed`, so
//!   motivator/inventor grants are rebuildable facts.
//! - `investigation_memory` — prior investigation baselines folded from
//!   `InvestigationMemoryRecorded`, so comparison-style roles are replayable.
//! - `delayed_death_queue` — active future death queues folded from
//!   `DelayedDeathQueued` and consumed by `DelayedDeathResolved`.
//! - `visit_history` — source-aware prior visit facts folded from
//!   `VisitRecorded`.
//! - `sheriff_badge`  — folded badge ownership/weight state from
//!   `BadgeChanged`, so sheriff vote weight is rebuildable and inspectable.
//! - `player_notification` — explicit-audience player-facing notices folded
//!   from `PlayerKilled` and `EffectNotification`, one row per recipient slot.
//! - `player_info_result` — private non-investigative info results folded from
//!   `InfoResult`, one row per recipient slot.
//! - `host_prompt` — host/admin intervention prompts folded from
//!   `HostPromptIssued` / `HostPromptResolved`, such as Beloved Princess
//!   phase-skip decisions and host-decided PK ties.
//! - `host_phase_control` — host/admin prompt decisions that move phase state,
//!   folded from provenance-bearing `PhaseAdvanced` events.
//! - `day_vote_outcome` — official engine/pack-policy day vote results folded
//!   from `DayVoteOutcome`, separate from the running ballot tally.
//! - `game_authority` — host + cohosts per game (`GameCreated`, `CohostAdded`).
//!   Backs `caps` HostOf / CohostOf resolution.
//! - `spectator_membership` — explicit read-only game grants
//!   (`SpectatorGranted` / `SpectatorRevoked`). Backs `caps` SpectatorOf.
//! - `slot_occupancy` — the LIVE slot→user mapping (`SlotAssigned`,
//!   `ReplacementCompleted`). The slot id is STABLE across replacement; only the
//!   occupant moves. Backs `caps` SlotOccupant resolution.
//! - `phase_state`    — current phase, lock, deadline (`GameStarted`/
//!   `PhaseAdvanced`, `DeadlineSet`/`DeadlineExtended`, `ThreadLocked`/
//!   `ThreadUnlocked`). Backs command validation (phase open/unlocked).
//! - `post_policy`    — host-toggleable channel posting affordances, currently
//!   whether media-only posts are accepted.
//! - `thread_view`    — stable, paginated channel-thread posts folded from
//!   `PostSubmitted` plus public engine announcements in `ResolutionApplied`.
//!
//! The centerpiece is [`append_and_project`]: it appends events AND folds them
//! into the projection tables **in one transaction** (doc 02 synchronous
//! projections → strong read-your-writes). [`rebuild`] truncates a game's
//! projections and re-folds the log; same log ⇒ same projection (determinism).
//!
//! Runtime sqlx queries only (no `query!` macro) so `cargo build` needs no DB.

use eventstore::{append_in_tx, EventInput, StoreError, StoredEvent};
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

/// A row of the `votecount` running tally: the COUNT of current ballots cast at
/// `candidate_slot` in `phase_id` (unweighted; Phase-3 ruling).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VoteCountRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub candidate_slot: String,
    /// Number of slots whose CURRENT ballot targets `candidate_slot`.
    pub count: i64,
}

/// A single actor slot's CURRENT ballot in one phase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CurrentBallotRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub actor_slot: String,
    pub target: String,
}

/// The official engine/pack-policy day vote result for one phase.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DayVoteOutcomeRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub source_seq: i64,
    pub event_index: i32,
    pub status: String,
    pub winner_slot: Option<String>,
    pub contenders: serde_json::Value,
    pub tallies: serde_json::Value,
    pub votes: serde_json::Value,
    pub weights: serde_json::Value,
    pub majority: Option<f64>,
    pub thresholds: serde_json::Value,
    pub total_weight: f64,
    pub tiebreak: Option<String>,
    pub reason: Option<String>,
}

/// A row of the `slot_state` projection.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotStateRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub alive: bool,
    pub status: String,
    #[serde(default)]
    pub status_tags: Vec<String>,
    pub role_key: Option<String>,
    pub alignment: Option<String>,
    pub role_revealed: bool,
    pub alignment_revealed: bool,
}

/// A persistent engine effect tag carried by a slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotEffectRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub effect: String,
    pub source_slot: String,
    pub source_action: Option<String>,
    pub phase_id: Option<String>,
    pub phase_kind: Option<String>,
    pub phase_number: Option<i32>,
    pub duration: String,
    pub visibility: String,
}

/// A folded engine action-use history record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionHistoryRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub template_id: String,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
    pub targets: Vec<String>,
    pub status: String,
}

/// A folded typed limited-use/counter record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActionCounterRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub counter_id: String,
    pub template_id: String,
    pub consumed_action: String,
    pub cadence_policy: String,
    pub phase_scope: String,
    pub limit: i32,
    pub used: i32,
    pub remaining: i32,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
}

/// A folded prior investigation baseline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct InvestigationMemoryRow {
    pub game_id: Uuid,
    pub investigator_slot: String,
    pub target_slot: String,
    pub mode: String,
    pub memory_scope: String,
    pub result: serde_json::Value,
    pub source_action: String,
    pub template_id: String,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
}

/// A folded active delayed-death queue row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelayedDeathQueueRow {
    pub game_id: Uuid,
    pub queue_id: String,
    pub target_slot: String,
    pub cause: String,
    pub effect: String,
    pub source_slot: String,
    pub source_action: String,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
}

/// A folded source-aware visit fact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VisitHistoryRow {
    pub game_id: Uuid,
    pub actor_slot: String,
    pub target_slot: String,
    pub template_id: String,
    pub source_action: String,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
    pub visible: bool,
}

/// A folded generated capability/item grant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionGrantRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub grant_id: String,
    pub grant_option: Option<String>,
    pub kind: String,
    pub source_slot: String,
    pub source_action: String,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
    pub uses: i32,
    pub vote_weight: Option<f64>,
}

/// A folded sheriff badge ownership row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheriffBadgeRow {
    pub game_id: Uuid,
    pub badge_id: String,
    pub owner_slot: Option<String>,
    pub vote_weight: Option<f64>,
    pub source_slot: String,
    pub source_action: String,
    pub reason: String,
    pub destroyed: bool,
    pub phase_id: String,
    pub phase_kind: String,
    pub phase_number: i32,
}

/// A folded player-facing notification addressed to one slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlayerNotificationRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub effect: String,
    pub status: String,
}

/// A folded private investigation result addressed to the investigator slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerInvestigationResultRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub mode: String,
    pub target_slot: String,
    pub result: serde_json::Value,
}

/// A folded private non-investigative info result addressed to one audience slot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerInfoResultRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub audience_slot: String,
    pub kind: String,
    pub actor_slot: String,
    pub target_slot: String,
    pub source_action: String,
    pub template_id: String,
    pub result: serde_json::Value,
}

/// A folded host/admin prompt emitted by the engine.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPromptRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub event_index: i32,
    pub prompt_id: String,
    pub kind: String,
    pub subject_slot: Option<String>,
    pub reason: String,
    pub phase_kind: String,
    pub phase_number: i32,
    pub metadata: serde_json::Value,
    pub status: String,
    pub decision: Option<serde_json::Value>,
    pub public_resolution: Option<serde_json::Value>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
}

/// A folded host/admin prompt decision that moved phase state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HostPhaseControlRow {
    pub game_id: Uuid,
    pub source_seq: i64,
    pub stream_seq: i64,
    pub prompt_id: String,
    pub prompt_kind: Option<String>,
    pub prompt_reason: Option<String>,
    pub source_phase_id: String,
    pub target_phase_id: String,
    pub reason: String,
    pub skipped_phase_id: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<i64>,
    pub occurred_at: i64,
}

/// A row of the `game_authority` projection (host/cohost per game).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GameAuthorityRow {
    pub game_id: Uuid,
    pub user_id: String,
    /// `"host"` | `"cohost"`.
    pub role: String,
}

/// A durable game-scoped spectator grant, independent of any player slot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SpectatorMembershipRow {
    pub game_id: Uuid,
    pub user_id: String,
}

/// A row of the `slot_occupancy` projection: the slot's CURRENT occupant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlotOccupancyRow {
    pub game_id: Uuid,
    pub slot_id: String,
    pub occupant_user_id: String,
}

/// The `phase_state` projection row: the game's current phase window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PhaseStateRow {
    pub game_id: Uuid,
    pub phase_id: String,
    pub locked: bool,
    pub deadline: Option<i64>,
}

/// Private channel membership derived from setup metadata.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivateChannelMemberRow {
    pub game_id: Uuid,
    pub channel_id: String,
    pub kind: String,
    pub slot_id: String,
    pub role_key: String,
    pub reveals_alignment: String,
    pub source: String,
}

/// Channel-level post policy derived from host/admin events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PostPolicyRow {
    pub game_id: Uuid,
    pub channel_id: String,
    pub allow_media_only: bool,
}

/// A projected post in the game thread.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadPostRow {
    pub game_id: Uuid,
    /// `events.seq`, used as the stable pagination cursor.
    pub source_seq: i64,
    /// `events.stream_seq`, useful for game-local ordering/debuggability.
    pub stream_seq: i64,
    pub channel_id: String,
    pub author_slot: Option<String>,
    pub author_user: Option<String>,
    pub phase_id: String,
    pub body: String,
    pub media: serde_json::Value,
    pub occurred_at: i64,
}

/// A cold-load page of channel-thread posts, returned oldest-to-newest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadViewPage {
    pub posts: Vec<ThreadPostRow>,
    /// Pass this as `before_seq` to fetch the next older page.
    pub next_before_seq: Option<i64>,
}

/// A capability-safe public game discovery row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameIndexRow {
    pub game_id: Uuid,
    pub pack: String,
    pub status: String,
    pub phase_id: Option<String>,
    /// `events.seq` for the lifecycle event that last changed this public row.
    pub updated_seq: i64,
    pub completed_seq: Option<i64>,
}

/// Stable keyset cursor for the public game index.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameIndexCursor {
    pub updated_seq: i64,
    pub game_id: Uuid,
}

/// A newest-first public game discovery page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GameIndexPage {
    pub games: Vec<GameIndexRow>,
    pub next_cursor: Option<GameIndexCursor>,
}

#[derive(Debug, thiserror::Error)]
pub enum ProjectionError {
    #[error(transparent)]
    Store(#[from] StoreError),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    #[error("malformed event payload for kind {kind}: {source}")]
    Payload {
        kind: String,
        #[source]
        source: serde_json::Error,
    },
}

/// Non-destructive replay audit for one projection table.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionAuditTable {
    pub table: String,
    pub matches: bool,
    pub before_rows: usize,
    pub rebuilt_rows: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rebuilt: Option<serde_json::Value>,
}

/// Non-destructive replay audit report for one game stream.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectionAuditReport {
    pub game_id: Uuid,
    pub ok: bool,
    pub tables: Vec<ProjectionAuditTable>,
}

#[derive(Debug, Deserialize)]
struct PhaseAdvancedPayload {
    phase_id: String,
    #[serde(default)]
    source_prompt_id: Option<String>,
    #[serde(default)]
    source_phase_id: Option<String>,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    skipped_phase_id: Option<String>,
}

// ───────────────────────── fold: one event → projection deltas ─────────────────────────

/// Fold a single stored event into the projection tables, inside `tx`.
///
/// Dispatch is on the event `kind`. Engine inner events (`PlayerKilled`,
/// `PlayerSaved`, ...) are not top-level kinds — they ride inside a
/// `ResolutionApplied` envelope, so that kind unwraps and folds each inner event.
///
/// Determinism: this is a pure function of the event data plus current table
/// state. No wall-clock, no RNG, no external calls (doc 02 rebuild rule).
async fn fold_event(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    ev: &StoredEvent,
) -> Result<(), ProjectionError> {
    match ev.kind.as_str() {
        // ── votecount (running, ballot-keyed) ──
        "VoteSubmitted" => {
            // OVERWRITE this actor's current ballot for the phase.
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let actor = str_field(p, "actor", &ev.kind)?;
            let target = vote_target(p, &ev.kind)?;
            upsert_ballot(tx, game_id, &phase_id, &actor, &target).await?;
        }
        "VoteWithdrawn" => {
            // REMOVE this actor's ballot for the phase (no target needed).
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let actor = str_field(p, "actor", &ev.kind)?;
            delete_ballot(tx, game_id, &phase_id, &actor).await?;
        }

        // ── slot_state ──
        "RoleAssigned" => {
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let role_key = str_field(p, "role_key", &ev.kind)?;
            let alignment = optional_string_field(p, "alignment", &ev.kind)?;
            let role_effects = optional_string_array_field(p, "role_effects", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            sqlx::query(
                "UPDATE slot_state SET role_key = $3, alignment = $4 \
                 WHERE game_id = $1 AND slot_id = $2",
            )
            .bind(game_id)
            .bind(&slot_id)
            .bind(&role_key)
            .bind(alignment.as_deref())
            .execute(&mut **tx)
            .await?;
            let role_source_action = format!("role:{role_key}");
            for effect in role_effects {
                upsert_effect(
                    tx,
                    game_id,
                    &slot_id,
                    &effect,
                    &slot_id,
                    Some(role_source_action.as_str()),
                    None,
                    None,
                    None,
                    "Persistent",
                    "Hidden",
                )
                .await?;
            }
        }
        "EffectsMarked" | "EffectsCleared" => {
            let inner: domain::InnerEvent = serde_json::from_value(serde_json::json!({
                "kind": ev.kind.clone(),
                "payload": ev.payload.clone(),
            }))
            .map_err(|source| ProjectionError::Payload {
                kind: ev.kind.clone(),
                source,
            })?;
            let phase_id = ev.payload["phase_id"].as_str().unwrap_or("");
            fold_inner(tx, game_id, phase_id, ev.seq, ev.stream_seq as i32, &inner).await?;
        }

        // ── game_authority (caps: HostOf / CohostOf) ──
        "GameCreated" => {
            let host = str_field(&ev.payload, "host", &ev.kind)?;
            upsert_authority(tx, game_id, &host, "host").await?;
            let pack = str_field(&ev.payload, "pack", &ev.kind)?;
            insert_game_index_setup(tx, game_id, &pack, ev.seq).await?;
        }
        "CohostAdded" => {
            let cohost = str_field(&ev.payload, "user_id", &ev.kind)?;
            upsert_authority(tx, game_id, &cohost, "cohost").await?;
        }
        "SpectatorGranted" => {
            let user = str_field(&ev.payload, "user_id", &ev.kind)?;
            insert_spectator_membership(tx, game_id, &user).await?;
        }
        "SpectatorRevoked" => {
            let user = str_field(&ev.payload, "user_id", &ev.kind)?;
            delete_spectator_membership(tx, game_id, &user).await?;
        }

        // ── slot lifecycle / occupancy ──
        "SlotAdded" => {
            let slot_id = str_field(&ev.payload, "slot_id", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
        }
        "SlotAssigned" => {
            // Occupancy begins: slot → user (the LIVE mapping).
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let user_id = str_field(p, "user_id", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            upsert_occupancy(tx, game_id, &slot_id, &user_id).await?;
        }
        "ReplacementCompleted" => {
            // The slot id is UNCHANGED; only the occupant mapping moves. The
            // slot's history (votes/posts) is keyed by slot_id elsewhere and is
            // therefore preserved — THIS is the User≠Slot payoff.
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let incoming = str_field(p, "incoming_user", &ev.kind)?;
            upsert_occupancy(tx, game_id, &slot_id, &incoming).await?;
        }
        "SlotStatusChanged" => {
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let status = str_field(p, "status", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            set_slot_status(tx, game_id, &slot_id, &status).await?;
        }
        "SlotStatusTagged" => {
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let tag = str_field(p, "tag", &ev.kind)?;
            ensure_slot(tx, game_id, &slot_id).await?;
            upsert_status_tag(tx, game_id, &slot_id, &tag).await?;
        }
        "SlotStatusUntagged" => {
            let p = &ev.payload;
            let slot_id = str_field(p, "slot_id", &ev.kind)?;
            let tag = str_field(p, "tag", &ev.kind)?;
            delete_status_tag(tx, game_id, &slot_id, &tag).await?;
        }

        // ── phase_state (validation: phase open / locked / deadline) ──
        "GameStarted" => {
            // Set the current phase; a new phase starts unlocked with no deadline.
            let phase_id = str_field(&ev.payload, "phase_id", &ev.kind)?;
            set_phase(tx, game_id, &phase_id).await?;
            activate_game_index(tx, game_id, &phase_id, ev.seq).await?;
        }
        "PhaseAdvanced" => {
            // Set the current phase; a new phase starts unlocked with no deadline.
            // Host-prompt phase-control payloads carry typed provenance and are
            // validated here before the projection moves.
            let phase_control = phase_advanced_payload(&ev.payload, &ev.kind)?;
            if phase_control.source_prompt_id.is_some() {
                insert_host_phase_control(tx, game_id, ev, &phase_control).await?;
            }
            set_phase(tx, game_id, &phase_control.phase_id).await?;
            update_game_index_phase(tx, game_id, &phase_control.phase_id, ev.seq).await?;
        }
        "DeadlineSet" | "DeadlineExtended" => {
            let p = &ev.payload;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let at =
                p.get("at")
                    .and_then(|v| v.as_i64())
                    .ok_or_else(|| ProjectionError::Payload {
                        kind: ev.kind.clone(),
                        source: serde::de::Error::custom("missing integer field `at`"),
                    })?;
            ensure_phase(tx, game_id, &phase_id).await?;
            sqlx::query(
                "UPDATE phase_state SET deadline = $2 WHERE game_id = $1 AND phase_id = $3",
            )
            .bind(game_id)
            .bind(at)
            .bind(phase_id)
            .execute(&mut **tx)
            .await?;
        }
        "ThreadLocked" => set_locked(tx, game_id, true).await?,
        "ThreadUnlocked" => set_locked(tx, game_id, false).await?,
        "PostPolicyChanged" => {
            let p = &ev.payload;
            let channel_id = str_field(p, "channel_id", &ev.kind)?;
            let allow_media_only = p
                .get("allow_media_only")
                .and_then(|v| v.as_bool())
                .ok_or_else(|| ProjectionError::Payload {
                    kind: ev.kind.clone(),
                    source: serde::de::Error::custom("missing boolean field `allow_media_only`"),
                })?;
            upsert_post_policy(tx, game_id, &channel_id, allow_media_only).await?;
        }

        // ── thread_view (channel-scoped cold-load pagination) ──
        "PostSubmitted" => {
            let p = &ev.payload;
            let channel_id = str_field(p, "channel_id", &ev.kind)?;
            let (author_slot, author_user) = author_from_payload(p, &ev.kind)?;
            let phase_id = str_field(p, "phase_id", &ev.kind)?;
            let body = str_field(p, "body", &ev.kind)?;
            let media = thread_media_payload(p);
            insert_thread_post(
                tx,
                ThreadPostInsert {
                    game_id,
                    source_seq: ev.seq,
                    stream_seq: ev.stream_seq,
                    channel_id,
                    author_slot,
                    author_user,
                    phase_id,
                    body,
                    media,
                    occurred_at: ev.occurred_at,
                },
            )
            .await?;
        }
        "PrivateChannelDeclared" => {
            let p = &ev.payload;
            let channel_id = str_field(p, "channel_id", &ev.kind)?;
            let kind = str_field(p, "kind", &ev.kind)?;
            let reveals_alignment = str_field(p, "reveals_alignment", &ev.kind)?;
            let source = str_field(p, "source", &ev.kind)?;
            let members = private_channel_members_field(p, &ev.kind)?;
            for member in members {
                ensure_slot(tx, game_id, &member.slot_id).await?;
                insert_private_channel_member(
                    tx,
                    game_id,
                    &channel_id,
                    &kind,
                    &member.slot_id,
                    &member.role_key,
                    &reveals_alignment,
                    &source,
                )
                .await?;
            }
        }
        "PrivateChannelRevoked" => {
            let p = &ev.payload;
            let channel_id = str_field(p, "channel_id", &ev.kind)?;
            delete_private_channel_members(tx, game_id, &channel_id).await?;
        }

        // ── engine resolution envelope: unwrap and fold inner events ──
        "ResolutionApplied" => {
            let applied = domain::validate_resolution_json(&ev.payload, domain::RESULT_VERSION)
                .map_err(|e| ProjectionError::Payload {
                    kind: ev.kind.clone(),
                    source: serde::de::Error::custom(e.to_string()),
                })?;
            for indexed in &applied.events {
                fold_inner(
                    tx,
                    game_id,
                    &applied.phase_id,
                    ev.seq,
                    indexed.index as i32,
                    &indexed.event,
                )
                .await?;
            }
            if let Some(body) = resolution_thread_announcement_body(&applied) {
                insert_thread_post(
                    tx,
                    ThreadPostInsert {
                        game_id,
                        source_seq: ev.seq,
                        stream_seq: ev.stream_seq,
                        channel_id: "main".to_string(),
                        author_slot: None,
                        author_user: Some("system".to_string()),
                        phase_id: applied.phase_id.clone(),
                        body,
                        media: serde_json::json!([]),
                        occurred_at: ev.occurred_at,
                    },
                )
                .await?;
            }
        }
        "ResolutionTrace" => {
            domain::validate_trace_json(&ev.payload, domain::TRACE_VERSION).map_err(|e| {
                ProjectionError::Payload {
                    kind: ev.kind.clone(),
                    source: serde::de::Error::custom(e.to_string()),
                }
            })?;
        }
        "HostPromptResolved" => {
            let p = &ev.payload;
            let prompt_id = str_field(p, "prompt_id", &ev.kind)?;
            let resolved_by = str_field(p, "resolved_by", &ev.kind)?;
            let public_resolution: domain::HostPromptPublicResolution =
                serde_json::from_value(p["public_resolution"].clone()).map_err(|source| {
                    ProjectionError::Payload {
                        kind: ev.kind.clone(),
                        source,
                    }
                })?;
            sqlx::query(
                "UPDATE host_prompt SET \
                 status = 'resolved', decision = $3, public_resolution = $4, \
                 resolved_by = $5, resolved_at = $6 \
                 WHERE game_id = $1 AND prompt_id = $2",
            )
            .bind(game_id)
            .bind(&prompt_id)
            .bind(&p["decision"])
            .bind(&p["public_resolution"])
            .bind(&resolved_by)
            .bind(ev.occurred_at)
            .execute(&mut **tx)
            .await?;

            if let domain::HostPromptPublicResolution::DayVoteElimination {
                phase_id,
                selected_slot,
                reason,
            } = public_resolution
            {
                sqlx::query(
                    "UPDATE day_vote_outcome SET \
                     status = 'Lynch', winner_slot = $3, reason = $4 \
                     WHERE game_id = $1 AND phase_id = $2 \
                       AND status = 'Tie' AND tiebreak = 'HostDecides'",
                )
                .bind(game_id)
                .bind(&phase_id)
                .bind(&selected_slot)
                .bind(&reason)
                .execute(&mut **tx)
                .await?;
            }
        }

        // ── reveal flip (doc 10): end-of-game flips role visibility ──
        "GameCompleted" => {
            sqlx::query(
                "UPDATE slot_state SET role_revealed = TRUE, alignment_revealed = TRUE \
                 WHERE game_id = $1",
            )
            .bind(game_id)
            .execute(&mut **tx)
            .await?;
            complete_game_index(tx, game_id, ev.seq).await?;
        }

        // Everything else (posts, channels) is not folded by THESE projections.
        // Ignored here, not rejected — other projections own it.
        _ => {}
    }
    Ok(())
}

/// Fold a single engine inner event (already unwrapped from `ResolutionApplied`).
async fn fold_inner(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    source_seq: i64,
    event_index: i32,
    ev: &domain::InnerEvent,
) -> Result<(), ProjectionError> {
    use domain::InnerEvent::*;
    match ev {
        PlayerKilled {
            slot_id,
            cause,
            death_reveal,
            ..
        } => {
            ensure_slot(tx, game_id, slot_id).await?;
            set_slot_status(tx, game_id, slot_id, "dead").await?;
            reveal_slot_death(tx, game_id, slot_id, *death_reveal).await?;
            upsert_player_notification(
                tx,
                game_id,
                phase_id,
                event_index,
                slot_id,
                "player_killed",
                cause,
            )
            .await?;
        }
        SlotStatusTagged { slot_id, tag, .. } => {
            ensure_slot(tx, game_id, slot_id).await?;
            upsert_status_tag(tx, game_id, slot_id, tag).await?;
        }
        PlayerSaved { slot_id, .. } => {
            // A save cancels a would-be kill at resolution time; the slot was
            // never marked dead, so this just guarantees the row exists alive.
            ensure_slot(tx, game_id, slot_id).await?;
        }
        PlayerConverted {
            target,
            new_role,
            new_alignment,
            ..
        } => {
            ensure_slot(tx, game_id, target).await?;
            sqlx::query(
                "UPDATE slot_state SET role_key = $3, alignment = $4 \
                 WHERE game_id = $1 AND slot_id = $2",
            )
            .bind(game_id)
            .bind(target)
            .bind(new_role)
            .bind(new_alignment)
            .execute(&mut **tx)
            .await?;
        }
        AlignmentRevealed {
            slot_id, alignment, ..
        } => {
            ensure_slot(tx, game_id, slot_id).await?;
            sqlx::query(
                "UPDATE slot_state SET alignment = $3, alignment_revealed = TRUE \
                 WHERE game_id = $1 AND slot_id = $2",
            )
            .bind(game_id)
            .bind(slot_id)
            .bind(alignment)
            .execute(&mut **tx)
            .await?;
        }
        RoleRevealed {
            slot_id, role_key, ..
        } => {
            ensure_slot(tx, game_id, slot_id).await?;
            sqlx::query(
                "UPDATE slot_state SET role_key = $3, role_revealed = TRUE \
                 WHERE game_id = $1 AND slot_id = $2",
            )
            .bind(game_id)
            .bind(slot_id)
            .bind(role_key)
            .execute(&mut **tx)
            .await?;
        }
        EffectsMarked {
            effect,
            target,
            actor,
            source_action,
            phase_id,
            phase_kind,
            phase_number,
            duration,
            visibility,
        } => {
            if *duration == domain::EffectDuration::Persistent {
                ensure_slot(tx, game_id, target).await?;
                let phase_kind = phase_kind.map(|kind| format!("{kind:?}"));
                upsert_effect(
                    tx,
                    game_id,
                    target,
                    effect,
                    actor,
                    source_action.as_deref(),
                    phase_id.as_deref(),
                    phase_kind.as_deref(),
                    phase_number.map(|number| number as i32),
                    &format!("{duration:?}"),
                    &format!("{visibility:?}"),
                )
                .await?;
            }
        }
        EffectsCleared {
            effect, targets, ..
        } => {
            for target in targets {
                delete_effect(tx, game_id, target, effect).await?;
            }
        }
        ActionRecorded {
            actor,
            template_id,
            targets,
            phase_id,
            phase_kind,
            phase_number,
            status,
        } => {
            ensure_slot(tx, game_id, actor).await?;
            sqlx::query(
                "INSERT INTO action_history \
                 (game_id, slot_id, template_id, phase_id, phase_kind, phase_number, targets, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
                 ON CONFLICT (game_id, slot_id, template_id, phase_id) DO UPDATE SET \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number, \
                 targets = EXCLUDED.targets, \
                 status = EXCLUDED.status",
            )
            .bind(game_id)
            .bind(actor)
            .bind(template_id)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .bind(serde_json::to_value(targets).map_err(|e| ProjectionError::Payload {
                kind: "ActionRecorded".to_string(),
                source: e,
            })?)
            .bind(status)
            .execute(&mut **tx)
            .await?;
        }
        ActionUseCounted {
            counter_id,
            actor,
            template_id,
            consumed_action,
            cadence_policy,
            phase_scope,
            limit,
            used,
            remaining,
            phase_id,
            phase_kind,
            phase_number,
        } => {
            ensure_slot(tx, game_id, actor).await?;
            sqlx::query(
                "INSERT INTO action_counter \
                 (game_id, slot_id, counter_id, template_id, consumed_action, cadence_policy, \
                  phase_scope, limit_count, used_count, remaining_count, phase_id, phase_kind, phase_number) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) \
                 ON CONFLICT (game_id, slot_id, counter_id) DO UPDATE SET \
                 template_id = EXCLUDED.template_id, \
                 consumed_action = EXCLUDED.consumed_action, \
                 cadence_policy = EXCLUDED.cadence_policy, \
                 phase_scope = EXCLUDED.phase_scope, \
                 limit_count = EXCLUDED.limit_count, \
                 used_count = EXCLUDED.used_count, \
                 remaining_count = EXCLUDED.remaining_count, \
                 phase_id = EXCLUDED.phase_id, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number",
            )
            .bind(game_id)
            .bind(actor)
            .bind(counter_id)
            .bind(template_id)
            .bind(consumed_action)
            .bind(cadence_policy)
            .bind(phase_scope)
            .bind(*limit as i32)
            .bind(*used as i32)
            .bind(*remaining as i32)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .execute(&mut **tx)
            .await?;
        }
        InvestigationResult {
            mode,
            investigator,
            target,
            result,
        } => {
            ensure_slot(tx, game_id, investigator).await?;
            ensure_slot(tx, game_id, target).await?;
            let audience_slot = match mode {
                domain::InvestigateMode::RoleGuard | domain::InvestigateMode::SecurityGuard => {
                    target
                }
                _ => investigator,
            };
            sqlx::query(
                "INSERT INTO player_investigation_result \
                 (game_id, phase_id, event_index, audience_slot, mode, target_slot, result) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (game_id, phase_id, event_index, audience_slot) DO UPDATE SET \
                 mode = EXCLUDED.mode, \
                 target_slot = EXCLUDED.target_slot, \
                 result = EXCLUDED.result",
            )
            .bind(game_id)
            .bind(phase_id)
            .bind(event_index)
            .bind(audience_slot)
            .bind(format!("{mode:?}"))
            .bind(target)
            .bind(result)
            .execute(&mut **tx)
            .await?;
        }
        InfoResult {
            actor,
            target,
            kind,
            audience,
            result,
            source_action,
            template_id,
            ..
        } => {
            ensure_slot(tx, game_id, actor).await?;
            ensure_slot(tx, game_id, target).await?;
            for audience_slot in audience {
                ensure_slot(tx, game_id, audience_slot).await?;
                sqlx::query(
                    "INSERT INTO player_info_result \
                     (game_id, phase_id, event_index, audience_slot, kind, actor_slot, \
                      target_slot, source_action, template_id, result) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                     ON CONFLICT (game_id, phase_id, event_index, audience_slot) DO UPDATE SET \
                     kind = EXCLUDED.kind, \
                     actor_slot = EXCLUDED.actor_slot, \
                     target_slot = EXCLUDED.target_slot, \
                     source_action = EXCLUDED.source_action, \
                     template_id = EXCLUDED.template_id, \
                     result = EXCLUDED.result",
                )
                .bind(game_id)
                .bind(phase_id)
                .bind(event_index)
                .bind(audience_slot)
                .bind(kind)
                .bind(actor)
                .bind(target)
                .bind(source_action)
                .bind(template_id)
                .bind(result)
                .execute(&mut **tx)
                .await?;
            }
        }
        InvestigationMemoryRecorded {
            investigator,
            target,
            mode,
            scope,
            result,
            source_action,
            template_id,
            phase_id,
            phase_kind,
            phase_number,
        } => {
            ensure_slot(tx, game_id, investigator).await?;
            ensure_slot(tx, game_id, target).await?;
            if *scope == domain::pack::ResultMemoryScope::Investigator {
                sqlx::query(
                    "DELETE FROM investigation_memory \
                     WHERE game_id = $1 AND investigator_slot = $2 AND mode = $3",
                )
                .bind(game_id)
                .bind(investigator)
                .bind(format!("{mode:?}"))
                .execute(&mut **tx)
                .await?;
            }
            sqlx::query(
                "INSERT INTO investigation_memory \
                 (game_id, investigator_slot, target_slot, mode, memory_scope, result, source_action, template_id, phase_id, phase_kind, phase_number) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (game_id, investigator_slot, target_slot, mode) DO UPDATE SET \
                 memory_scope = EXCLUDED.memory_scope, \
                 result = EXCLUDED.result, \
                 source_action = EXCLUDED.source_action, \
                 template_id = EXCLUDED.template_id, \
                 phase_id = EXCLUDED.phase_id, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number",
            )
            .bind(game_id)
            .bind(investigator)
            .bind(target)
            .bind(format!("{mode:?}"))
            .bind(format!("{scope:?}"))
            .bind(result)
            .bind(source_action)
            .bind(template_id)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .execute(&mut **tx)
            .await?;
        }
        DelayedDeathQueued {
            queue_id,
            target,
            cause,
            effect,
            source,
            source_action,
            phase_id,
            phase_kind,
            phase_number,
        } => {
            ensure_slot(tx, game_id, target).await?;
            ensure_slot(tx, game_id, source).await?;
            sqlx::query(
                "INSERT INTO delayed_death_queue \
                 (game_id, queue_id, target_slot, cause, effect, source_slot, source_action, phase_id, phase_kind, phase_number) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
                 ON CONFLICT (game_id, queue_id) DO UPDATE SET \
                 target_slot = EXCLUDED.target_slot, \
                 cause = EXCLUDED.cause, \
                 effect = EXCLUDED.effect, \
                 source_slot = EXCLUDED.source_slot, \
                 source_action = EXCLUDED.source_action, \
                 phase_id = EXCLUDED.phase_id, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number",
            )
            .bind(game_id)
            .bind(queue_id)
            .bind(target)
            .bind(cause)
            .bind(effect)
            .bind(source)
            .bind(source_action)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .execute(&mut **tx)
            .await?;
        }
        DelayedDeathResolved { queue_id, .. } => {
            sqlx::query("DELETE FROM delayed_death_queue WHERE game_id = $1 AND queue_id = $2")
                .bind(game_id)
                .bind(queue_id)
                .execute(&mut **tx)
                .await?;
        }
        VisitRecorded {
            actor,
            target,
            template_id,
            source_action,
            phase_id,
            phase_kind,
            phase_number,
            visible,
        } => {
            ensure_slot(tx, game_id, actor).await?;
            ensure_slot(tx, game_id, target).await?;
            sqlx::query(
                "INSERT INTO visit_history \
                 (game_id, actor_slot, target_slot, template_id, source_action, phase_id, phase_kind, phase_number, visible) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
                 ON CONFLICT (game_id, source_action, actor_slot, target_slot) DO UPDATE SET \
                 template_id = EXCLUDED.template_id, \
                 phase_id = EXCLUDED.phase_id, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number, \
                 visible = EXCLUDED.visible",
            )
            .bind(game_id)
            .bind(actor)
            .bind(target)
            .bind(template_id)
            .bind(source_action)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .bind(visible)
            .execute(&mut **tx)
            .await?;
        }
        ActionGranted {
            grant_id,
            grant_option,
            kind,
            actor,
            target,
            source_action,
            uses,
            vote_weight,
            phase_id,
            phase_kind,
            phase_number,
        } => {
            ensure_slot(tx, game_id, target).await?;
            sqlx::query(
                "INSERT INTO action_grant \
                 (game_id, slot_id, grant_id, grant_option, kind, source_slot, source_action, phase_id, phase_kind, phase_number, uses, vote_weight) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
                 ON CONFLICT (game_id, slot_id, grant_id, source_slot, source_action, phase_id) DO UPDATE SET \
                 grant_option = EXCLUDED.grant_option, \
                 kind = EXCLUDED.kind, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number, \
                 uses = EXCLUDED.uses, \
                 vote_weight = EXCLUDED.vote_weight",
            )
            .bind(game_id)
            .bind(target)
            .bind(grant_id)
            .bind(grant_option)
            .bind(format!("{kind:?}"))
            .bind(actor)
            .bind(source_action)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .bind(*uses as i32)
            .bind(*vote_weight)
            .execute(&mut **tx)
            .await?;
        }
        ActionGrantConsumed {
            grant_id,
            actor,
            source_action,
            ..
        } => {
            ensure_slot(tx, game_id, actor).await?;
            sqlx::query(
                "UPDATE action_grant \
                 SET uses = GREATEST(uses - 1, 0) \
                 WHERE game_id = $1 AND slot_id = $2 AND grant_id = $3 AND source_action = $4 \
                 AND uses > 0",
            )
            .bind(game_id)
            .bind(actor)
            .bind(grant_id)
            .bind(source_action)
            .execute(&mut **tx)
            .await?;
        }
        BadgeChanged {
            badge_id,
            owner,
            vote_weight,
            actor,
            source_action,
            reason,
            destroyed,
            phase_id,
            phase_kind,
            phase_number,
            ..
        } => {
            sqlx::query(
                "INSERT INTO sheriff_badge \
                 (game_id, badge_id, owner_slot, vote_weight, source_slot, source_action, reason, destroyed, phase_id, phase_kind, phase_number) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) \
                 ON CONFLICT (game_id, badge_id) DO UPDATE SET \
                 owner_slot = EXCLUDED.owner_slot, \
                 vote_weight = EXCLUDED.vote_weight, \
                 source_slot = EXCLUDED.source_slot, \
                 source_action = EXCLUDED.source_action, \
                 reason = EXCLUDED.reason, \
                 destroyed = EXCLUDED.destroyed, \
                 phase_id = EXCLUDED.phase_id, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number",
            )
            .bind(game_id)
            .bind(badge_id)
            .bind(owner)
            .bind(vote_weight)
            .bind(actor)
            .bind(source_action)
            .bind(reason)
            .bind(*destroyed)
            .bind(phase_id)
            .bind(format!("{phase_kind:?}"))
            .bind(*phase_number as i32)
            .execute(&mut **tx)
            .await?;
        }
        WinReached {
            winner,
            reason,
            metadata,
        } => {
            // Win reached → reveal roles (the reveal flag, doc 10).
            sqlx::query(
                "UPDATE slot_state SET role_revealed = TRUE, alignment_revealed = TRUE \
                 WHERE game_id = $1",
            )
            .bind(game_id)
            .execute(&mut **tx)
            .await?;
            // Terminal winner fact → game_result (one row per game; rebuild
            // converges on the same trailing WinReached).
            sqlx::query(
                "INSERT INTO game_result \
                     (game_id, winner, reason, metadata, phase_id, source_seq, event_index) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (game_id) DO UPDATE SET \
                     winner = EXCLUDED.winner, \
                     reason = EXCLUDED.reason, \
                     metadata = EXCLUDED.metadata, \
                     phase_id = EXCLUDED.phase_id, \
                     source_seq = EXCLUDED.source_seq, \
                     event_index = EXCLUDED.event_index",
            )
            .bind(game_id)
            .bind(winner)
            .bind(reason)
            .bind(metadata)
            .bind(phase_id)
            .bind(source_seq)
            .bind(event_index)
            .execute(&mut **tx)
            .await?;
        }
        EffectNotification {
            effect,
            status,
            audience,
        } => {
            for audience_slot in audience {
                upsert_player_notification(
                    tx,
                    game_id,
                    phase_id,
                    event_index,
                    audience_slot,
                    effect,
                    status,
                )
                .await?;
            }
        }
        HostPromptIssued(note) => {
            if let Some(subject) = &note.subject {
                ensure_slot(tx, game_id, subject).await?;
            }
            sqlx::query(
                "INSERT INTO host_prompt \
                 (game_id, phase_id, event_index, prompt_id, kind, subject_slot, reason, phase_kind, phase_number, metadata, status) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') \
                 ON CONFLICT (game_id, prompt_id) DO UPDATE SET \
                 phase_id = EXCLUDED.phase_id, \
                 event_index = EXCLUDED.event_index, \
                 kind = EXCLUDED.kind, \
                 subject_slot = EXCLUDED.subject_slot, \
                 reason = EXCLUDED.reason, \
                 phase_kind = EXCLUDED.phase_kind, \
                 phase_number = EXCLUDED.phase_number, \
                 metadata = EXCLUDED.metadata, \
                 status = CASE \
                     WHEN host_prompt.status = 'resolved' THEN host_prompt.status \
                     ELSE EXCLUDED.status \
                 END",
            )
            .bind(game_id)
            .bind(&note.phase_id)
            .bind(event_index)
            .bind(&note.prompt_id)
            .bind(&note.kind)
            .bind(&note.subject)
            .bind(&note.reason)
            .bind(format!("{:?}", note.phase_kind))
            .bind(note.phase_number as i32)
            .bind(&note.metadata)
            .execute(&mut **tx)
            .await?;
        }
        DayVoteOutcome(outcome) => {
            upsert_day_vote_outcome(tx, game_id, phase_id, source_seq, event_index, outcome)
                .await?;
        }
        // Other inner events (investigations, effects, ...) are not folded by
        // slot_state/votecount here.
        _ => {}
    }
    Ok(())
}

// ───────────────────────── public API ─────────────────────────

/// Append `events` to `stream_id` AND fold them into the projections, **in one
/// DB transaction** (doc 02 synchronous projections). The append's optimistic
/// concurrency still applies: a conflicting concurrent append returns
/// [`StoreError::Conflict`] (via [`ProjectionError::Store`]) and the whole tx —
/// projection updates included — rolls back.
///
/// `game_id` keys the projections; it equals `stream_id` for game streams.
pub async fn append_and_project(
    pool: &PgPool,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let mut tx = pool.begin().await?;
    let stored = append_and_project_in_tx(&mut tx, stream_id, events).await?;
    tx.commit().await?;
    Ok(stored)
}

/// Append `events` and fold synchronous projections inside an existing
/// transaction. This is the atomic seam used by network command receipts: the
/// receipt row, event append, and hot projections all commit or roll back
/// together.
pub async fn append_and_project_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    stream_id: Uuid,
    events: &[EventInput],
) -> Result<Vec<StoredEvent>, ProjectionError> {
    let stored = append_in_tx(tx, stream_id, events).await?;
    for ev in &stored {
        fold_event(tx, stream_id, ev).await?;
    }
    Ok(stored)
}

/// Rebuild a game's projections from the log: truncate this game's projection
/// rows, then re-fold every event in `stream_seq` order. Deterministic — same
/// log ⇒ same projection (doc 02).
pub async fn rebuild(pool: &PgPool, game_id: Uuid) -> Result<(), ProjectionError> {
    let mut tx = pool.begin().await?;
    rebuild_in_tx(&mut tx, game_id).await?;
    tx.commit().await?;
    Ok(())
}

async fn rebuild_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
) -> Result<(), ProjectionError> {
    for table in [
        "vote_ballot",
        "day_vote_outcome",
        "game_result",
        "host_phase_control",
        "host_prompt",
        "player_info_result",
        "player_investigation_result",
        "player_notification",
        "sheriff_badge",
        "action_counter",
        "investigation_memory",
        "delayed_death_queue",
        "visit_history",
        "action_grant",
        "action_history",
        "slot_effect",
        "slot_state",
        "game_authority",
        "spectator_membership",
        "slot_occupancy",
        "phase_state",
        "private_channel_member",
        "post_policy",
        "thread_view",
        "game_index",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE game_id = $1"))
            .bind(game_id)
            .execute(&mut **tx)
            .await?;
    }

    // Load the stream in order (within this tx) and re-fold. We read inside the
    // tx so the rebuild is a consistent snapshot.
    let rows = sqlx::query(
        r#"
        SELECT seq, stream_id, stream_seq, kind, version, payload, actor, occurred_at, causation_id, meta
        FROM events
        WHERE stream_id = $1
        ORDER BY stream_seq ASC
        "#,
    )
    .bind(game_id)
    .fetch_all(&mut **tx)
    .await?;

    for row in rows {
        let stored = StoredEvent {
            seq: row.try_get("seq")?,
            stream_id: row.try_get("stream_id")?,
            stream_seq: row.try_get("stream_seq")?,
            kind: row.try_get("kind")?,
            version: row.try_get("version")?,
            payload: row.try_get("payload")?,
            actor: serde_json::from_value(row.try_get::<serde_json::Value, _>("actor")?)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?,
            occurred_at: row.try_get("occurred_at")?,
            causation_id: row.try_get("causation_id")?,
            meta: row.try_get("meta")?,
        };
        let stored = eventstore::upcast(eventstore::decode_stored_payload(stored)?);
        fold_event(tx, game_id, &stored).await?;
    }

    Ok(())
}

struct AuditProjection {
    table: &'static str,
    order_by: &'static str,
}

const AUDIT_PROJECTIONS: &[AuditProjection] = &[
    AuditProjection {
        table: "vote_ballot",
        order_by: "phase_id, actor_slot",
    },
    AuditProjection {
        table: "day_vote_outcome",
        order_by: "phase_id",
    },
    AuditProjection {
        table: "game_result",
        order_by: "game_id",
    },
    AuditProjection {
        table: "host_phase_control",
        order_by: "stream_seq, prompt_id",
    },
    AuditProjection {
        table: "host_prompt",
        order_by: "phase_id, event_index, prompt_id",
    },
    AuditProjection {
        table: "player_notification",
        order_by: "phase_id, event_index, audience_slot",
    },
    AuditProjection {
        table: "player_info_result",
        order_by: "phase_id, event_index, audience_slot",
    },
    AuditProjection {
        table: "player_investigation_result",
        order_by: "phase_id, event_index, audience_slot",
    },
    AuditProjection {
        table: "sheriff_badge",
        order_by: "badge_id",
    },
    AuditProjection {
        table: "action_counter",
        order_by: "phase_number, phase_id, slot_id, counter_id",
    },
    AuditProjection {
        table: "investigation_memory",
        order_by: "phase_number, phase_id, investigator_slot, target_slot, mode",
    },
    AuditProjection {
        table: "delayed_death_queue",
        order_by: "phase_number, phase_id, target_slot, effect, queue_id",
    },
    AuditProjection {
        table: "visit_history",
        order_by: "phase_number, phase_id, actor_slot, target_slot, source_action",
    },
    AuditProjection {
        table: "action_grant",
        order_by: "phase_number, phase_id, slot_id, grant_id, source_slot",
    },
    AuditProjection {
        table: "action_history",
        order_by: "phase_number, phase_id, slot_id, template_id",
    },
    AuditProjection {
        table: "slot_effect",
        order_by: "slot_id, effect",
    },
    AuditProjection {
        table: "slot_state",
        order_by: "slot_id",
    },
    AuditProjection {
        table: "game_authority",
        order_by: "role, user_id",
    },
    AuditProjection {
        table: "spectator_membership",
        order_by: "user_id",
    },
    AuditProjection {
        table: "slot_occupancy",
        order_by: "slot_id",
    },
    AuditProjection {
        table: "phase_state",
        order_by: "game_id",
    },
    AuditProjection {
        table: "private_channel_member",
        order_by: "channel_id, slot_id",
    },
    AuditProjection {
        table: "post_policy",
        order_by: "channel_id",
    },
    AuditProjection {
        table: "thread_view",
        order_by: "source_seq",
    },
    AuditProjection {
        table: "game_index",
        order_by: "game_id",
    },
];

/// Replay one game's event stream inside a rollback-only transaction and compare
/// every rebuildable projection table before/after. Live projection rows are left
/// unchanged even when the audit finds a mismatch.
pub async fn audit_rebuild(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<ProjectionAuditReport, ProjectionError> {
    let mut tx = pool.begin().await?;

    let mut before = Vec::with_capacity(AUDIT_PROJECTIONS.len());
    for projection in AUDIT_PROJECTIONS {
        before.push(projection_snapshot(&mut tx, projection, game_id).await?);
    }

    rebuild_in_tx(&mut tx, game_id).await?;

    let mut tables = Vec::with_capacity(AUDIT_PROJECTIONS.len());
    for (projection, before) in AUDIT_PROJECTIONS.iter().zip(before) {
        let rebuilt = projection_snapshot(&mut tx, projection, game_id).await?;
        tables.push(audit_table(projection.table, before, rebuilt));
    }

    tx.rollback().await?;

    Ok(ProjectionAuditReport {
        game_id,
        ok: tables.iter().all(|table| table.matches),
        tables,
    })
}

async fn projection_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    projection: &AuditProjection,
    game_id: Uuid,
) -> Result<serde_json::Value, ProjectionError> {
    let sql = format!(
        "SELECT COALESCE(jsonb_agg(to_jsonb(snapshot_rows) ORDER BY {order_by}), '[]'::jsonb) AS rows \
         FROM (SELECT * FROM {table} WHERE game_id = $1) snapshot_rows",
        table = projection.table,
        order_by = projection.order_by,
    );
    let row = sqlx::query(&sql).bind(game_id).fetch_one(&mut **tx).await?;
    Ok(row.get("rows"))
}

fn audit_table(
    table: &str,
    before: serde_json::Value,
    rebuilt: serde_json::Value,
) -> ProjectionAuditTable {
    let matches = before == rebuilt;
    ProjectionAuditTable {
        table: table.to_string(),
        matches,
        before_rows: json_array_len(&before),
        rebuilt_rows: json_array_len(&rebuilt),
        before: (!matches).then_some(before),
        rebuilt: (!matches).then_some(rebuilt),
    }
}

fn json_array_len(value: &serde_json::Value) -> usize {
    value.as_array().map_or(0, Vec::len)
}

// ───────────────────────── read helpers (for tests / queries / caps) ─────────────────────────

/// Read a game's running votecount: COUNT of current ballots per candidate,
/// ordered deterministically. Candidates with zero ballots are absent.
pub async fn votecount(pool: &PgPool, game_id: Uuid) -> Result<Vec<VoteCountRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT phase_id, target AS candidate_slot, COUNT(*) AS n \
         FROM vote_ballot WHERE game_id = $1 \
         GROUP BY phase_id, target ORDER BY phase_id, target",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| VoteCountRow {
            game_id,
            phase_id: r.get("phase_id"),
            candidate_slot: r.get("candidate_slot"),
            count: r.get("n"),
        })
        .collect())
}

/// Read one actor slot's current ballot for a specific phase, if present.
pub async fn current_ballot(
    pool: &PgPool,
    game_id: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<Option<CurrentBallotRow>, ProjectionError> {
    let row = sqlx::query(
        "SELECT game_id, phase_id, actor_slot, target \
         FROM vote_ballot \
         WHERE game_id = $1 AND phase_id = $2 AND actor_slot = $3",
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(actor_slot)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| CurrentBallotRow {
        game_id: r.get("game_id"),
        phase_id: r.get("phase_id"),
        actor_slot: r.get("actor_slot"),
        target: r.get("target"),
    }))
}

/// Read official engine day vote outcomes, ordered by source resolution.
pub async fn day_vote_outcomes(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<DayVoteOutcomeRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, source_seq, event_index, status, winner_slot, contenders, \
         tallies, votes, weights, majority, thresholds, total_weight, tiebreak, reason \
         FROM day_vote_outcome WHERE game_id = $1 \
         ORDER BY source_seq, event_index, phase_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| DayVoteOutcomeRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            source_seq: r.get("source_seq"),
            event_index: r.get("event_index"),
            status: r.get("status"),
            winner_slot: r.get("winner_slot"),
            contenders: r.get("contenders"),
            tallies: r.get("tallies"),
            votes: r.get("votes"),
            weights: r.get("weights"),
            majority: r.get("majority"),
            thresholds: r.get("thresholds"),
            total_weight: r.get("total_weight"),
            tiebreak: r.get("tiebreak"),
            reason: r.get("reason"),
        })
        .collect())
}

#[derive(Debug, Clone, PartialEq)]
pub struct GameResultRow {
    pub game_id: Uuid,
    pub winner: String,
    pub reason: String,
    pub metadata: serde_json::Value,
    pub phase_id: String,
    pub source_seq: i64,
    pub event_index: i32,
}

/// Read a game's terminal engine win result, if one has been folded.
pub async fn game_result(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Option<GameResultRow>, ProjectionError> {
    let row = sqlx::query(
        "SELECT game_id, winner, reason, metadata, phase_id, source_seq, event_index \
         FROM game_result WHERE game_id = $1",
    )
    .bind(game_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| GameResultRow {
        game_id: r.get("game_id"),
        winner: r.get("winner"),
        reason: r.get("reason"),
        metadata: r.get("metadata"),
        phase_id: r.get("phase_id"),
        source_seq: r.get("source_seq"),
        event_index: r.get("event_index"),
    }))
}

/// Read a game's slot_state rows, ordered deterministically.
pub async fn slot_state(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotStateRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, alive, status, role_key, alignment, role_revealed, \
         alignment_revealed FROM slot_state \
         WHERE game_id = $1 ORDER BY slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    let mut out = Vec::new();
    for r in rows {
        let slot_id: String = r.get("slot_id");
        out.push(SlotStateRow {
            game_id: r.get("game_id"),
            status_tags: slot_status_tags(pool, game_id, &slot_id).await?,
            slot_id,
            alive: r.get("alive"),
            status: r.get("status"),
            role_key: r.get("role_key"),
            alignment: r.get("alignment"),
            role_revealed: r.get("role_revealed"),
            alignment_revealed: r.get("alignment_revealed"),
        });
    }
    Ok(out)
}

/// Read persistent engine effects, ordered deterministically.
pub async fn slot_effects(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotEffectRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, effect, source_slot, source_action, phase_id, phase_kind, \
         phase_number, duration, visibility FROM slot_effect \
         WHERE game_id = $1 ORDER BY slot_id, effect",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SlotEffectRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            effect: r.get("effect"),
            source_slot: r.get("source_slot"),
            source_action: r.get("source_action"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
            duration: r.get("duration"),
            visibility: r.get("visibility"),
        })
        .collect())
}

pub async fn slot_status_tags(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Vec<String>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT tag FROM slot_status_tag \
         WHERE game_id = $1 AND slot_id = $2 ORDER BY tag",
    )
    .bind(game_id)
    .bind(slot_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| r.get("tag")).collect())
}

/// Read folded action history, ordered deterministically.
pub async fn action_history(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<ActionHistoryRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, template_id, phase_id, phase_kind, phase_number, targets, status \
         FROM action_history WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, slot_id, template_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let targets: serde_json::Value = r.get("targets");
            ActionHistoryRow {
                game_id: r.get("game_id"),
                slot_id: r.get("slot_id"),
                template_id: r.get("template_id"),
                phase_id: r.get("phase_id"),
                phase_kind: r.get("phase_kind"),
                phase_number: r.get("phase_number"),
                targets: serde_json::from_value(targets).unwrap_or_default(),
                status: r.get("status"),
            }
        })
        .collect())
}

/// Read folded action counters, ordered deterministically.
pub async fn action_counters(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<ActionCounterRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, counter_id, template_id, consumed_action, cadence_policy, \
         phase_scope, limit_count, used_count, remaining_count, phase_id, phase_kind, phase_number \
         FROM action_counter WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, slot_id, counter_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ActionCounterRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            counter_id: r.get("counter_id"),
            template_id: r.get("template_id"),
            consumed_action: r.get("consumed_action"),
            cadence_policy: r.get("cadence_policy"),
            phase_scope: r.get("phase_scope"),
            limit: r.get("limit_count"),
            used: r.get("used_count"),
            remaining: r.get("remaining_count"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
        })
        .collect())
}

/// Read folded investigation baselines, ordered deterministically.
pub async fn investigation_memory(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<InvestigationMemoryRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, investigator_slot, target_slot, mode, memory_scope, result, source_action, template_id, phase_id, phase_kind, phase_number \
         FROM investigation_memory WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, investigator_slot, target_slot, mode",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| InvestigationMemoryRow {
            game_id: r.get("game_id"),
            investigator_slot: r.get("investigator_slot"),
            target_slot: r.get("target_slot"),
            mode: r.get("mode"),
            memory_scope: r.get("memory_scope"),
            result: r.get("result"),
            source_action: r.get("source_action"),
            template_id: r.get("template_id"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
        })
        .collect())
}

/// Read active delayed-death queue rows, ordered deterministically.
pub async fn delayed_death_queues(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<DelayedDeathQueueRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, queue_id, target_slot, cause, effect, source_slot, source_action, phase_id, phase_kind, phase_number \
         FROM delayed_death_queue WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, target_slot, effect, queue_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| DelayedDeathQueueRow {
            game_id: r.get("game_id"),
            queue_id: r.get("queue_id"),
            target_slot: r.get("target_slot"),
            cause: r.get("cause"),
            effect: r.get("effect"),
            source_slot: r.get("source_slot"),
            source_action: r.get("source_action"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
        })
        .collect())
}

/// Read folded visit history rows, ordered deterministically.
pub async fn visit_history(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<VisitHistoryRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, actor_slot, target_slot, template_id, source_action, phase_id, phase_kind, phase_number, visible \
         FROM visit_history WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, actor_slot, target_slot, source_action",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| VisitHistoryRow {
            game_id: r.get("game_id"),
            actor_slot: r.get("actor_slot"),
            target_slot: r.get("target_slot"),
            template_id: r.get("template_id"),
            source_action: r.get("source_action"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
            visible: r.get("visible"),
        })
        .collect())
}

/// Read folded action grants, ordered deterministically.
pub async fn action_grants(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<ActionGrantRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, grant_id, grant_option, kind, source_slot, source_action, phase_id, phase_kind, phase_number, uses, vote_weight \
         FROM action_grant WHERE game_id = $1 \
         ORDER BY phase_number, phase_id, slot_id, grant_id, source_action, source_slot",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| ActionGrantRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            grant_id: r.get("grant_id"),
            grant_option: r.get("grant_option"),
            kind: r.get("kind"),
            source_slot: r.get("source_slot"),
            source_action: r.get("source_action"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
            uses: r.get("uses"),
            vote_weight: r.get("vote_weight"),
        })
        .collect())
}

/// Read folded sheriff badge ownership, ordered deterministically.
pub async fn sheriff_badges(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SheriffBadgeRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, badge_id, owner_slot, vote_weight, source_slot, source_action, reason, destroyed, phase_id, phase_kind, phase_number \
         FROM sheriff_badge WHERE game_id = $1 \
         ORDER BY badge_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SheriffBadgeRow {
            game_id: r.get("game_id"),
            badge_id: r.get("badge_id"),
            owner_slot: r.get("owner_slot"),
            vote_weight: r.get("vote_weight"),
            source_slot: r.get("source_slot"),
            source_action: r.get("source_action"),
            reason: r.get("reason"),
            destroyed: r.get("destroyed"),
            phase_id: r.get("phase_id"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
        })
        .collect())
}

/// Read folded player notifications, ordered deterministically.
pub async fn player_notifications(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<PlayerNotificationRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, effect, status \
         FROM player_notification WHERE game_id = $1 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerNotificationRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            effect: r.get("effect"),
            status: r.get("status"),
        })
        .collect())
}

/// Read folded player notifications for one audience slot.
pub async fn player_notifications_for_slot(
    pool: &PgPool,
    game_id: Uuid,
    audience_slot: &str,
) -> Result<Vec<PlayerNotificationRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, effect, status \
         FROM player_notification WHERE game_id = $1 AND audience_slot = $2 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .bind(audience_slot)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerNotificationRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            effect: r.get("effect"),
            status: r.get("status"),
        })
        .collect())
}

/// Read folded private investigation results, ordered deterministically.
pub async fn player_investigation_results(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<PlayerInvestigationResultRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, mode, target_slot, result \
         FROM player_investigation_result WHERE game_id = $1 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerInvestigationResultRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            mode: r.get("mode"),
            target_slot: r.get("target_slot"),
            result: r.get("result"),
        })
        .collect())
}

/// Read folded private investigation results for one audience slot.
pub async fn player_investigation_results_for_slot(
    pool: &PgPool,
    game_id: Uuid,
    audience_slot: &str,
) -> Result<Vec<PlayerInvestigationResultRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, mode, target_slot, result \
         FROM player_investigation_result WHERE game_id = $1 AND audience_slot = $2 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .bind(audience_slot)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerInvestigationResultRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            mode: r.get("mode"),
            target_slot: r.get("target_slot"),
            result: r.get("result"),
        })
        .collect())
}

/// Read folded private info results, ordered deterministically.
pub async fn player_info_results(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<PlayerInfoResultRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, kind, actor_slot, \
         target_slot, source_action, template_id, result \
         FROM player_info_result WHERE game_id = $1 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerInfoResultRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            kind: r.get("kind"),
            actor_slot: r.get("actor_slot"),
            target_slot: r.get("target_slot"),
            source_action: r.get("source_action"),
            template_id: r.get("template_id"),
            result: r.get("result"),
        })
        .collect())
}

/// Read folded private info results for one audience slot.
pub async fn player_info_results_for_slot(
    pool: &PgPool,
    game_id: Uuid,
    audience_slot: &str,
) -> Result<Vec<PlayerInfoResultRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, audience_slot, kind, actor_slot, \
         target_slot, source_action, template_id, result \
         FROM player_info_result WHERE game_id = $1 AND audience_slot = $2 \
         ORDER BY phase_id, event_index, audience_slot",
    )
    .bind(game_id)
    .bind(audience_slot)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PlayerInfoResultRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            audience_slot: r.get("audience_slot"),
            kind: r.get("kind"),
            actor_slot: r.get("actor_slot"),
            target_slot: r.get("target_slot"),
            source_action: r.get("source_action"),
            template_id: r.get("template_id"),
            result: r.get("result"),
        })
        .collect())
}

/// Read folded host/admin prompts, ordered deterministically.
pub async fn host_prompts(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<HostPromptRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, phase_id, event_index, prompt_id, kind, subject_slot, reason, phase_kind, phase_number, metadata, status, decision, public_resolution, resolved_by, resolved_at \
         FROM host_prompt WHERE game_id = $1 \
         ORDER BY phase_id, event_index, prompt_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| HostPromptRow {
            game_id: r.get("game_id"),
            phase_id: r.get("phase_id"),
            event_index: r.get("event_index"),
            prompt_id: r.get("prompt_id"),
            kind: r.get("kind"),
            subject_slot: r.get("subject_slot"),
            reason: r.get("reason"),
            phase_kind: r.get("phase_kind"),
            phase_number: r.get("phase_number"),
            metadata: r.get("metadata"),
            status: r.get("status"),
            decision: r.get("decision"),
            public_resolution: r.get("public_resolution"),
            resolved_by: r.get("resolved_by"),
            resolved_at: r.get("resolved_at"),
        })
        .collect())
}

/// Read folded host/admin prompt phase-control decisions, ordered by event log position.
pub async fn host_phase_controls(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<HostPhaseControlRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT c.game_id, c.source_seq, c.stream_seq, c.prompt_id, \
                p.kind AS prompt_kind, p.reason AS prompt_reason, \
                c.source_phase_id, c.target_phase_id, c.reason, c.skipped_phase_id, \
                p.resolved_by, p.resolved_at, c.occurred_at \
         FROM host_phase_control c \
         LEFT JOIN host_prompt p ON p.game_id = c.game_id AND p.prompt_id = c.prompt_id \
         WHERE c.game_id = $1 \
         ORDER BY c.stream_seq, c.prompt_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| HostPhaseControlRow {
            game_id: r.get("game_id"),
            source_seq: r.get("source_seq"),
            stream_seq: r.get("stream_seq"),
            prompt_id: r.get("prompt_id"),
            prompt_kind: r.get("prompt_kind"),
            prompt_reason: r.get("prompt_reason"),
            source_phase_id: r.get("source_phase_id"),
            target_phase_id: r.get("target_phase_id"),
            reason: r.get("reason"),
            skipped_phase_id: r.get("skipped_phase_id"),
            resolved_by: r.get("resolved_by"),
            resolved_at: r.get("resolved_at"),
            occurred_at: r.get("occurred_at"),
        })
        .collect())
}

/// Read a game's host/cohost authority rows (for `caps` resolution).
pub async fn game_authority(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<GameAuthorityRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, user_id, role FROM game_authority \
         WHERE game_id = $1 ORDER BY role, user_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| GameAuthorityRow {
            game_id: r.get("game_id"),
            user_id: r.get("user_id"),
            role: r.get("role"),
        })
        .collect())
}

/// Whether a user currently holds the explicit spectator grant for this game.
pub async fn spectator_membership(
    pool: &PgPool,
    game_id: Uuid,
    user_id: &str,
) -> Result<bool, ProjectionError> {
    let row =
        sqlx::query("SELECT 1 AS x FROM spectator_membership WHERE game_id = $1 AND user_id = $2")
            .bind(game_id)
            .bind(user_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.is_some())
}

/// Read a game's spectator grants in deterministic order for audit and tests.
pub async fn spectator_memberships(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SpectatorMembershipRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, user_id FROM spectator_membership WHERE game_id = $1 ORDER BY user_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SpectatorMembershipRow {
            game_id: r.get("game_id"),
            user_id: r.get("user_id"),
        })
        .collect())
}

/// The CURRENT occupant of a slot, if any (the live mapping for `caps`).
pub async fn slot_occupant(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Option<String>, ProjectionError> {
    let row = sqlx::query(
        "SELECT occupant_user_id FROM slot_occupancy WHERE game_id = $1 AND slot_id = $2",
    )
    .bind(game_id)
    .bind(slot_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.get("occupant_user_id")))
}

/// Read a game's slot_occupancy rows, ordered deterministically.
pub async fn slot_occupancy(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<SlotOccupancyRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, slot_id, occupant_user_id FROM slot_occupancy \
         WHERE game_id = $1 ORDER BY slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| SlotOccupancyRow {
            game_id: r.get("game_id"),
            slot_id: r.get("slot_id"),
            occupant_user_id: r.get("occupant_user_id"),
        })
        .collect())
}

/// The game's current phase window, if a phase has started.
pub async fn phase_state(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Option<PhaseStateRow>, ProjectionError> {
    let row = sqlx::query(
        "SELECT game_id, phase_id, locked, deadline FROM phase_state WHERE game_id = $1",
    )
    .bind(game_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| PhaseStateRow {
        game_id: r.get("game_id"),
        phase_id: r.get("phase_id"),
        locked: r.get("locked"),
        deadline: r.get("deadline"),
    }))
}

pub async fn private_channel_members(
    pool: &PgPool,
    game_id: Uuid,
) -> Result<Vec<PrivateChannelMemberRow>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source \
         FROM private_channel_member WHERE game_id = $1 ORDER BY channel_id, slot_id",
    )
    .bind(game_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| PrivateChannelMemberRow {
            game_id: r.get("game_id"),
            channel_id: r.get("channel_id"),
            kind: r.get("kind"),
            slot_id: r.get("slot_id"),
            role_key: r.get("role_key"),
            reveals_alignment: r.get("reveals_alignment"),
            source: r.get("source"),
        })
        .collect())
}

pub async fn post_policy(
    pool: &PgPool,
    game_id: Uuid,
    channel_id: &str,
) -> Result<PostPolicyRow, ProjectionError> {
    let row = sqlx::query(
        "SELECT game_id, channel_id, allow_media_only \
         FROM post_policy WHERE game_id = $1 AND channel_id = $2",
    )
    .bind(game_id)
    .bind(channel_id)
    .fetch_optional(pool)
    .await?;
    Ok(row
        .map(|r| PostPolicyRow {
            game_id: r.get("game_id"),
            channel_id: r.get("channel_id"),
            allow_media_only: r.get("allow_media_only"),
        })
        .unwrap_or_else(|| PostPolicyRow {
            game_id,
            channel_id: channel_id.to_string(),
            allow_media_only: false,
        }))
}

/// Whether a slot exists in the game (has a `slot_state` row).
pub async fn slot_exists(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<bool, ProjectionError> {
    let row = sqlx::query("SELECT 1 AS x FROM slot_state WHERE game_id = $1 AND slot_id = $2")
        .bind(game_id)
        .bind(slot_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Whether a slot is alive (`true`), dead (`false`), or absent (`None`).
pub async fn slot_alive(
    pool: &PgPool,
    game_id: Uuid,
    slot_id: &str,
) -> Result<Option<bool>, ProjectionError> {
    let row = sqlx::query("SELECT alive FROM slot_state WHERE game_id = $1 AND slot_id = $2")
        .bind(game_id)
        .bind(slot_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|r| r.get("alive")))
}

/// Whether a game exists (has a `game_authority` host row).
pub async fn game_exists(pool: &PgPool, game_id: Uuid) -> Result<bool, ProjectionError> {
    let row = sqlx::query("SELECT 1 AS x FROM game_authority WHERE game_id = $1 LIMIT 1")
        .bind(game_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.is_some())
}

/// Read the main thread as a stable cold-load page. Results are returned
/// oldest-to-newest for direct rendering. To page older, pass the previous
/// response's `next_before_seq` as `before_seq`.
pub async fn thread_view(
    pool: &PgPool,
    game_id: Uuid,
    before_seq: Option<i64>,
    limit: i64,
) -> Result<ThreadViewPage, ProjectionError> {
    thread_view_for_channel(pool, game_id, "main", before_seq, limit).await
}

/// Read public active and completed games newest-first. Setup rows are kept for
/// rebuildability but never leave this public discovery boundary.
pub async fn game_index(
    pool: &PgPool,
    cursor: Option<GameIndexCursor>,
    limit: i64,
) -> Result<GameIndexPage, ProjectionError> {
    let limit = limit.clamp(1, 100);
    let fetch_limit = limit + 1;
    let rows = match cursor {
        Some(cursor) => {
            sqlx::query(
                r#"
                SELECT game_id, pack, status, phase_id, updated_seq, completed_seq
                FROM game_index
                WHERE status IN ('active', 'completed')
                  AND (updated_seq < $1 OR (updated_seq = $1 AND game_id < $2))
                ORDER BY updated_seq DESC, game_id DESC
                LIMIT $3
                "#,
            )
            .bind(cursor.updated_seq)
            .bind(cursor.game_id)
            .bind(fetch_limit)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query(
                r#"
                SELECT game_id, pack, status, phase_id, updated_seq, completed_seq
                FROM game_index
                WHERE status IN ('active', 'completed')
                ORDER BY updated_seq DESC, game_id DESC
                LIMIT $1
                "#,
            )
            .bind(fetch_limit)
            .fetch_all(pool)
            .await?
        }
    };
    let has_more = rows.len() as i64 > limit;
    let games: Vec<_> = rows
        .into_iter()
        .take(limit as usize)
        .map(|row| GameIndexRow {
            game_id: row.get("game_id"),
            pack: row.get("pack"),
            status: row.get("status"),
            phase_id: row.get("phase_id"),
            updated_seq: row.get("updated_seq"),
            completed_seq: row.get("completed_seq"),
        })
        .collect();
    let next_cursor = has_more.then(|| {
        let last = games.last().expect("full page has a final game");
        GameIndexCursor {
            updated_seq: last.updated_seq,
            game_id: last.game_id,
        }
    });
    Ok(GameIndexPage { games, next_cursor })
}

/// Read one channel's thread as a stable cold-load page. Results are returned
/// oldest-to-newest for direct rendering. To page older, pass the previous
/// response's `next_before_seq` as `before_seq`.
pub async fn thread_view_for_channel(
    pool: &PgPool,
    game_id: Uuid,
    channel_id: &str,
    before_seq: Option<i64>,
    limit: i64,
) -> Result<ThreadViewPage, ProjectionError> {
    let limit = limit.clamp(1, 100);
    let fetch_limit = limit + 1;
    let rows = sqlx::query(
        r#"
        SELECT game_id, source_seq, stream_seq, channel_id, author_slot,
               author_user, phase_id, body, media, occurred_at
        FROM thread_view
        WHERE game_id = $1
          AND channel_id = $2
          AND ($3::BIGINT IS NULL OR source_seq < $3)
        ORDER BY source_seq DESC
        LIMIT $4
        "#,
    )
    .bind(game_id)
    .bind(channel_id)
    .bind(before_seq)
    .bind(fetch_limit)
    .fetch_all(pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    let mut posts: Vec<_> = rows
        .into_iter()
        .take(limit as usize)
        .map(|r| ThreadPostRow {
            game_id: r.get("game_id"),
            source_seq: r.get("source_seq"),
            stream_seq: r.get("stream_seq"),
            channel_id: r.get("channel_id"),
            author_slot: r.get("author_slot"),
            author_user: r.get("author_user"),
            phase_id: r.get("phase_id"),
            body: r.get("body"),
            media: r.get("media"),
            occurred_at: r.get("occurred_at"),
        })
        .collect();
    posts.reverse();
    let next_before_seq = if has_more {
        posts.first().map(|post| post.source_seq)
    } else {
        None
    };

    Ok(ThreadViewPage {
        posts,
        next_before_seq,
    })
}

// ───────────────────────── low-level upserts ─────────────────────────

async fn upsert_ballot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    actor_slot: &str,
    target: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO vote_ballot (game_id, phase_id, actor_slot, target)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (game_id, phase_id, actor_slot)
        DO UPDATE SET target = EXCLUDED.target
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(actor_slot)
    .bind(target)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_ballot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    actor_slot: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM vote_ballot WHERE game_id = $1 AND phase_id = $2 AND actor_slot = $3")
        .bind(game_id)
        .bind(phase_id)
        .bind(actor_slot)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

fn day_vote_json<T: Serialize>(value: &T) -> Result<serde_json::Value, ProjectionError> {
    serde_json::to_value(value).map_err(|e| ProjectionError::Payload {
        kind: "DayVoteOutcome".to_string(),
        source: serde::de::Error::custom(e.to_string()),
    })
}

async fn upsert_day_vote_outcome(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    source_seq: i64,
    event_index: i32,
    outcome: &domain::DayVoteOutcome,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO day_vote_outcome
            (game_id, phase_id, source_seq, event_index, status, winner_slot, contenders,
             tallies, votes, weights, majority, thresholds, total_weight, tiebreak, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (game_id, phase_id) DO UPDATE SET
            source_seq = EXCLUDED.source_seq,
            event_index = EXCLUDED.event_index,
            status = EXCLUDED.status,
            winner_slot = EXCLUDED.winner_slot,
            contenders = EXCLUDED.contenders,
            tallies = EXCLUDED.tallies,
            votes = EXCLUDED.votes,
            weights = EXCLUDED.weights,
            majority = EXCLUDED.majority,
            thresholds = EXCLUDED.thresholds,
            total_weight = EXCLUDED.total_weight,
            tiebreak = EXCLUDED.tiebreak,
            reason = EXCLUDED.reason
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(source_seq)
    .bind(event_index)
    .bind(format!("{:?}", outcome.status))
    .bind(&outcome.winner)
    .bind(day_vote_json(&outcome.contenders)?)
    .bind(day_vote_json(&outcome.tallies)?)
    .bind(day_vote_json(&outcome.votes)?)
    .bind(day_vote_json(&outcome.weights)?)
    .bind(outcome.majority)
    .bind(day_vote_json(&outcome.thresholds)?)
    .bind(outcome.total_weight)
    .bind(&outcome.tiebreak)
    .bind(&outcome.reason)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn ensure_slot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO slot_state (game_id, slot_id, alive, role_key, role_revealed, alignment_revealed)
        VALUES ($1, $2, TRUE, NULL, FALSE, FALSE)
        ON CONFLICT (game_id, slot_id) DO NOTHING
        "#,
    )
    .bind(game_id)
    .bind(slot_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_authority(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    user_id: &str,
    role: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO game_authority (game_id, user_id, role) VALUES ($1, $2, $3) \
         ON CONFLICT (game_id, user_id, role) DO NOTHING",
    )
    .bind(game_id)
    .bind(user_id)
    .bind(role)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_spectator_membership(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    user_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO spectator_membership (game_id, user_id) VALUES ($1, $2) \
         ON CONFLICT (game_id, user_id) DO NOTHING",
    )
    .bind(game_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_spectator_membership(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    user_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM spectator_membership WHERE game_id = $1 AND user_id = $2")
        .bind(game_id)
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_occupancy(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    user_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO slot_occupancy (game_id, slot_id, occupant_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (game_id, slot_id)
        DO UPDATE SET occupant_user_id = EXCLUDED.occupant_user_id
        "#,
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_effect(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    effect: &str,
    source_slot: &str,
    source_action: Option<&str>,
    phase_id: Option<&str>,
    phase_kind: Option<&str>,
    phase_number: Option<i32>,
    duration: &str,
    visibility: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO slot_effect \
         (game_id, slot_id, effect, source_slot, source_action, phase_id, phase_kind, \
          phase_number, duration, visibility) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         ON CONFLICT (game_id, slot_id, effect) DO UPDATE SET \
         source_slot = EXCLUDED.source_slot, \
         source_action = EXCLUDED.source_action, \
         phase_id = EXCLUDED.phase_id, \
         phase_kind = EXCLUDED.phase_kind, \
         phase_number = EXCLUDED.phase_number, \
         duration = EXCLUDED.duration, \
         visibility = EXCLUDED.visibility",
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(effect)
    .bind(source_slot)
    .bind(source_action)
    .bind(phase_id)
    .bind(phase_kind)
    .bind(phase_number)
    .bind(duration)
    .bind(visibility)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn set_slot_status(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    status: &str,
) -> Result<(), ProjectionError> {
    let alive = match status {
        "alive" => true,
        "dead" | "modkilled" => false,
        other => {
            return Err(ProjectionError::Payload {
                kind: "SlotStatusChanged".to_string(),
                source: serde::de::Error::custom(format!("unknown slot lifecycle `{other}`")),
            })
        }
    };
    sqlx::query(
        "UPDATE slot_state SET alive = $3, status = $4 WHERE game_id = $1 AND slot_id = $2",
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(alive)
    .bind(status)
    .execute(&mut **tx)
    .await?;
    if !alive {
        clear_ballots_for_dead_slot(tx, game_id, slot_id).await?;
    }
    Ok(())
}

async fn clear_ballots_for_dead_slot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM vote_ballot WHERE game_id = $1 AND (actor_slot = $2 OR target = $2)")
        .bind(game_id)
        .bind(slot_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_player_notification(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    event_index: i32,
    audience_slot: &str,
    effect: &str,
    status: &str,
) -> Result<(), ProjectionError> {
    ensure_slot(tx, game_id, audience_slot).await?;
    sqlx::query(
        "INSERT INTO player_notification \
         (game_id, phase_id, event_index, audience_slot, effect, status) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (game_id, phase_id, event_index, audience_slot) DO UPDATE SET \
         effect = EXCLUDED.effect, \
         status = EXCLUDED.status",
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(event_index)
    .bind(audience_slot)
    .bind(effect)
    .bind(status)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn reveal_slot_death(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    death_reveal: domain::DeathRevealMode,
) -> Result<(), ProjectionError> {
    let (role_revealed, alignment_revealed) = match death_reveal {
        domain::DeathRevealMode::Full => (true, true),
        domain::DeathRevealMode::AlignmentOnly => (false, true),
        domain::DeathRevealMode::Concealed => (false, false),
    };
    sqlx::query(
        "UPDATE slot_state SET role_revealed = $3, alignment_revealed = $4 \
         WHERE game_id = $1 AND slot_id = $2",
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(role_revealed)
    .bind(alignment_revealed)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_status_tag(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    tag: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO slot_status_tag (game_id, slot_id, tag) VALUES ($1, $2, $3) \
         ON CONFLICT (game_id, slot_id, tag) DO NOTHING",
    )
    .bind(game_id)
    .bind(slot_id)
    .bind(tag)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_status_tag(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    tag: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM slot_status_tag WHERE game_id = $1 AND slot_id = $2 AND tag = $3")
        .bind(game_id)
        .bind(slot_id)
        .bind(tag)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn delete_effect(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    slot_id: &str,
    effect: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM slot_effect WHERE game_id = $1 AND slot_id = $2 AND effect = $3")
        .bind(game_id)
        .bind(slot_id)
        .bind(effect)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn insert_host_phase_control(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    ev: &StoredEvent,
    payload: &PhaseAdvancedPayload,
) -> Result<(), ProjectionError> {
    let prompt_id =
        payload
            .source_prompt_id
            .as_deref()
            .ok_or_else(|| ProjectionError::Payload {
                kind: ev.kind.clone(),
                source: serde::de::Error::custom("missing string field `source_prompt_id`"),
            })?;
    let source_phase_id =
        payload
            .source_phase_id
            .as_deref()
            .ok_or_else(|| ProjectionError::Payload {
                kind: ev.kind.clone(),
                source: serde::de::Error::custom("missing string field `source_phase_id`"),
            })?;
    let reason = payload
        .reason
        .as_deref()
        .ok_or_else(|| ProjectionError::Payload {
            kind: ev.kind.clone(),
            source: serde::de::Error::custom("missing string field `reason`"),
        })?;

    sqlx::query(
        "INSERT INTO host_phase_control \
         (game_id, source_seq, stream_seq, prompt_id, source_phase_id, target_phase_id, reason, skipped_phase_id, occurred_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
         ON CONFLICT (game_id, prompt_id, stream_seq) DO NOTHING",
    )
    .bind(game_id)
    .bind(ev.seq)
    .bind(ev.stream_seq)
    .bind(prompt_id)
    .bind(source_phase_id)
    .bind(&payload.phase_id)
    .bind(reason)
    .bind(&payload.skipped_phase_id)
    .bind(ev.occurred_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Set the current phase: a new phase starts unlocked with no deadline.
async fn set_phase(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO phase_state (game_id, phase_id, locked, deadline)
        VALUES ($1, $2, FALSE, NULL)
        ON CONFLICT (game_id)
        DO UPDATE SET phase_id = EXCLUDED.phase_id, locked = FALSE, deadline = NULL
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_game_index_setup(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    pack: &str,
    event_seq: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO game_index (game_id, pack, status, phase_id, created_seq, started_seq, completed_seq, updated_seq)
        VALUES ($1, $2, 'setup', NULL, $3, NULL, NULL, $3)
        ON CONFLICT (game_id) DO NOTHING
        "#,
    )
    .bind(game_id)
    .bind(pack)
    .bind(event_seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn activate_game_index(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    event_seq: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "UPDATE game_index SET status = 'active', phase_id = $2, started_seq = COALESCE(started_seq, $3), updated_seq = $3 WHERE game_id = $1",
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(event_seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn update_game_index_phase(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
    event_seq: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "UPDATE game_index SET phase_id = $2, updated_seq = $3 WHERE game_id = $1 AND status = 'active'",
    )
    .bind(game_id)
    .bind(phase_id)
    .bind(event_seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn complete_game_index(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    event_seq: i64,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "UPDATE game_index SET status = 'completed', completed_seq = $2, updated_seq = $2 WHERE game_id = $1",
    )
    .bind(game_id)
    .bind(event_seq)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Ensure a phase_state row exists for the game (without clobbering an existing
/// phase). Used by deadline events that may arrive for the current phase.
async fn ensure_phase(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    phase_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO phase_state (game_id, phase_id, locked, deadline)
        VALUES ($1, $2, FALSE, NULL)
        ON CONFLICT (game_id) DO NOTHING
        "#,
    )
    .bind(game_id)
    .bind(phase_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn set_locked(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    locked: bool,
) -> Result<(), ProjectionError> {
    sqlx::query("UPDATE phase_state SET locked = $2 WHERE game_id = $1")
        .bind(game_id)
        .bind(locked)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

struct ThreadPostInsert {
    game_id: Uuid,
    source_seq: i64,
    stream_seq: i64,
    channel_id: String,
    author_slot: Option<String>,
    author_user: Option<String>,
    phase_id: String,
    body: String,
    media: serde_json::Value,
    occurred_at: i64,
}

async fn insert_thread_post(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    post: ThreadPostInsert,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO thread_view (
            game_id, source_seq, stream_seq, channel_id, author_slot,
            author_user, phase_id, body, media, occurred_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (game_id, source_seq) DO NOTHING
        "#,
    )
    .bind(post.game_id)
    .bind(post.source_seq)
    .bind(post.stream_seq)
    .bind(&post.channel_id)
    .bind(&post.author_slot)
    .bind(&post.author_user)
    .bind(&post.phase_id)
    .bind(&post.body)
    .bind(&post.media)
    .bind(post.occurred_at)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn thread_media_payload(payload: &serde_json::Value) -> serde_json::Value {
    for key in ["media", "attachments", "images"] {
        if let Some(value) = payload.get(key) {
            return value.clone();
        }
    }
    serde_json::json!([])
}

async fn insert_private_channel_member(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    channel_id: &str,
    kind: &str,
    slot_id: &str,
    role_key: &str,
    reveals_alignment: &str,
    source: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO private_channel_member (
            game_id, channel_id, kind, slot_id, role_key, reveals_alignment, source
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (game_id, channel_id, slot_id)
        DO UPDATE SET
            kind = EXCLUDED.kind,
            role_key = EXCLUDED.role_key,
            reveals_alignment = EXCLUDED.reveals_alignment,
            source = EXCLUDED.source
        "#,
    )
    .bind(game_id)
    .bind(channel_id)
    .bind(kind)
    .bind(slot_id)
    .bind(role_key)
    .bind(reveals_alignment)
    .bind(source)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn delete_private_channel_members(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    channel_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("DELETE FROM private_channel_member WHERE game_id = $1 AND channel_id = $2")
        .bind(game_id)
        .bind(channel_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn upsert_post_policy(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    game_id: Uuid,
    channel_id: &str,
    allow_media_only: bool,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO post_policy (game_id, channel_id, allow_media_only)
        VALUES ($1, $2, $3)
        ON CONFLICT (game_id, channel_id)
        DO UPDATE SET allow_media_only = EXCLUDED.allow_media_only
        "#,
    )
    .bind(game_id)
    .bind(channel_id)
    .bind(allow_media_only)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn resolution_thread_announcement_body(applied: &domain::ResolutionApplied) -> Option<String> {
    let mut lines = Vec::new();
    for indexed in &applied.events {
        match &indexed.event {
            domain::InnerEvent::DayAnnouncement(note) => {
                let attackers = if note.attackers.is_empty() {
                    "unknown attackers".to_string()
                } else {
                    format!("attackers: {}", note.attackers.join(", "))
                };
                let role = note
                    .role_key
                    .as_deref()
                    .map(|role| format!("; role: {role}"))
                    .unwrap_or_default();
                let template = note
                    .template_id
                    .as_deref()
                    .map(|template| format!("; template: {template}"))
                    .unwrap_or_default();
                let audience = note
                    .audience
                    .as_deref()
                    .map(|audience| format!("; audience: {audience}"))
                    .unwrap_or_default();
                lines.push(format!(
                    "Day {} announcement: {} died during night {} (cause: {}; {attackers}{role}{template}{audience}).",
                    note.day, note.player_id, note.night, note.cause
                ));
            }
            domain::InnerEvent::LastWordsRecorded(note) => {
                let vote = note
                    .vote
                    .winner
                    .as_deref()
                    .map(|winner| format!(" winner: {winner};"))
                    .unwrap_or_default();
                let template = note
                    .template_id
                    .as_deref()
                    .map(|template| format!(" template: {template};"))
                    .unwrap_or_default();
                let audience = note
                    .audience
                    .as_deref()
                    .map(|audience| format!(" audience: {audience};"))
                    .unwrap_or_default();
                let window = note
                    .window
                    .as_deref()
                    .map(|window| format!(" window: {window};"))
                    .unwrap_or_default();
                lines.push(format!(
                    "Last words: {} may speak after {} in {}.{vote}{template}{audience}{window}",
                    note.player_id, note.reason, note.phase_id
                ));
            }
            domain::InnerEvent::AlignmentRevealed {
                slot_id,
                alignment,
                source_action,
                phase_id,
                ..
            } => {
                lines.push(format!(
                    "Public reveal: {slot_id} revealed alignment {alignment} in {phase_id} ({source_action})."
                ));
            }
            domain::InnerEvent::RoleRevealed {
                slot_id,
                role_key,
                source_action,
                phase_id,
                ..
            } => {
                lines.push(format!(
                    "Public reveal: {slot_id} revealed role {role_key} in {phase_id} ({source_action})."
                ));
            }
            domain::InnerEvent::VoteDuelDeclared {
                challenger,
                target,
                source_action,
                phase_id,
                ..
            } => {
                lines.push(format!(
                    "Vote duel: {challenger} challenged {target} in {phase_id} ({source_action})."
                ));
            }
            domain::InnerEvent::VoteVetoed {
                governor,
                target,
                source_action,
                phase_id,
                ..
            } => {
                lines.push(format!(
                    "Vote veto: {governor} vetoed the elimination of {target} in {phase_id} ({source_action})."
                ));
            }
            domain::InnerEvent::PhaseAnnouncement(announcement) => {
                let template = announcement
                    .template_id
                    .as_deref()
                    .map(|template| format!("; template: {template}"))
                    .unwrap_or_default();
                let audience = announcement
                    .audience
                    .as_deref()
                    .map(|audience| format!("; audience: {audience}"))
                    .unwrap_or_default();
                if announcement.deaths.is_empty() {
                    lines.push(format!(
                        "Phase {} announcement: no deaths{}{}.",
                        announcement.phase_id, template, audience
                    ));
                } else {
                    let deaths = announcement
                        .deaths
                        .iter()
                        .map(|death| {
                            let death_template = death
                                .template_id
                                .as_deref()
                                .map(|template| format!("; template: {template}"))
                                .unwrap_or_default();
                            let death_audience = death
                                .audience
                                .as_deref()
                                .map(|audience| format!("; audience: {audience}"))
                                .unwrap_or_default();
                            format!(
                                "{} ({}{}{})",
                                death.slot_id, death.cause, death_template, death_audience
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    lines.push(format!(
                        "Phase {} announcement: {deaths}{template}{audience}.",
                        announcement.phase_id
                    ));
                }
            }
            _ => {}
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

// ───────────────────────── payload accessors ─────────────────────────

struct PrivateChannelMemberPayload {
    slot_id: String,
    role_key: String,
}

fn str_field(p: &serde_json::Value, key: &str, kind: &str) -> Result<String, ProjectionError> {
    p.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom(format!("missing string field `{key}`")),
        })
}

fn private_channel_members_field(
    p: &serde_json::Value,
    kind: &str,
) -> Result<Vec<PrivateChannelMemberPayload>, ProjectionError> {
    let members = p
        .get("members")
        .and_then(|value| value.as_array())
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom("missing array field `members`"),
        })?;
    if members.is_empty() {
        return Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom("field `members` must not be empty"),
        });
    }
    members
        .iter()
        .map(|member| {
            let slot_id = str_field(member, "slot_id", kind)?;
            let role_key = str_field(member, "role_key", kind)?;
            Ok(PrivateChannelMemberPayload { slot_id, role_key })
        })
        .collect()
}

fn optional_string_field(
    p: &serde_json::Value,
    key: &str,
    kind: &str,
) -> Result<Option<String>, ProjectionError> {
    match p.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom(format!("field `{key}` must be a string")),
        }),
    }
}

fn optional_string_array_field(
    p: &serde_json::Value,
    key: &str,
    kind: &str,
) -> Result<Vec<String>, ProjectionError> {
    match p.get(key) {
        None | Some(serde_json::Value::Null) => Ok(Vec::new()),
        Some(serde_json::Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_string)
                    .ok_or_else(|| ProjectionError::Payload {
                        kind: kind.to_string(),
                        source: serde::de::Error::custom(format!(
                            "field `{key}` must contain only strings"
                        )),
                    })
            })
            .collect(),
        Some(_) => Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom(format!("field `{key}` must be an array")),
        }),
    }
}

fn phase_advanced_payload(
    p: &serde_json::Value,
    kind: &str,
) -> Result<PhaseAdvancedPayload, ProjectionError> {
    let payload: PhaseAdvancedPayload =
        serde_json::from_value(p.clone()).map_err(|source| ProjectionError::Payload {
            kind: kind.to_string(),
            source,
        })?;
    if payload.phase_id.trim().is_empty() {
        return payload_error(kind, "phase_id must not be empty");
    }

    let has_phase_control = payload.source_prompt_id.is_some()
        || payload.source_phase_id.is_some()
        || payload.reason.is_some()
        || payload.skipped_phase_id.is_some();
    if !has_phase_control {
        return Ok(payload);
    }

    require_nonempty_optional(kind, "source_phase_id", payload.source_phase_id.as_deref())?;
    let reason = require_nonempty_optional(kind, "reason", payload.reason.as_deref())?;
    match reason {
        "revote" | "no_majority_no_lynch" => {
            require_nonempty_optional(
                kind,
                "source_prompt_id",
                payload.source_prompt_id.as_deref(),
            )?;
            if payload.skipped_phase_id.is_some() {
                return payload_error(
                    kind,
                    "prompt phase control must not declare skipped_phase_id",
                );
            }
        }
        "skip_next_day" => {
            require_nonempty_optional(
                kind,
                "source_prompt_id",
                payload.source_prompt_id.as_deref(),
            )?;
            require_nonempty_optional(
                kind,
                "skipped_phase_id",
                payload.skipped_phase_id.as_deref(),
            )?;
        }
        "resolved_phase" => {
            if payload.source_prompt_id.is_some() {
                return payload_error(
                    kind,
                    "resolved_phase control must not declare source_prompt_id",
                );
            }
            if payload.skipped_phase_id.is_some() {
                return payload_error(
                    kind,
                    "resolved_phase control must not declare skipped_phase_id",
                );
            }
        }
        "deadline_elapsed" => {
            if payload.source_prompt_id.is_some() {
                return payload_error(
                    kind,
                    "deadline_elapsed control must not declare source_prompt_id",
                );
            }
            if payload.skipped_phase_id.is_some() {
                return payload_error(
                    kind,
                    "deadline_elapsed control must not declare skipped_phase_id",
                );
            }
        }
        _ => {
            return payload_error(
                kind,
                "phase-control reason must be `revote`, `no_majority_no_lynch`, `skip_next_day`, `resolved_phase`, or `deadline_elapsed`",
            );
        }
    }

    Ok(payload)
}

fn require_nonempty_optional<'a>(
    kind: &str,
    field: &str,
    value: Option<&'a str>,
) -> Result<&'a str, ProjectionError> {
    match value {
        Some(value) if !value.trim().is_empty() => Ok(value),
        _ => payload_error(kind, format!("{field} must not be empty")),
    }
}

fn payload_error<T>(kind: &str, message: impl Into<String>) -> Result<T, ProjectionError> {
    Err(ProjectionError::Payload {
        kind: kind.to_string(),
        source: serde::de::Error::custom(message.into()),
    })
}

/// Vote target: a slot id, or the sentinel "no_lynch". Accepts `{ "target": "slot_x" }`
/// or `{ "target": "no_lynch" }` / `{ "target": { "no_lynch": true } }`.
fn vote_target(p: &serde_json::Value, kind: &str) -> Result<String, ProjectionError> {
    match p.get("target") {
        Some(serde_json::Value::String(s)) => Ok(s.clone()),
        Some(serde_json::Value::Object(_)) => Ok("no_lynch".to_string()),
        _ => Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom("missing `target` (slot id or no_lynch)"),
        }),
    }
}

fn author_from_payload(
    p: &serde_json::Value,
    kind: &str,
) -> Result<(Option<String>, Option<String>), ProjectionError> {
    let author = p
        .get("slot_or_user")
        .and_then(|v| v.as_object())
        .ok_or_else(|| ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom("missing object field `slot_or_user`"),
        })?;

    match (
        author.get("slot").and_then(|v| v.as_str()),
        author.get("user").and_then(|v| v.as_str()),
    ) {
        (Some(slot), None) => Ok((Some(slot.to_string()), None)),
        (None, Some(user)) => Ok((None, Some(user.to_string()))),
        _ => Err(ProjectionError::Payload {
            kind: kind.to_string(),
            source: serde::de::Error::custom(
                "expected exactly one of `slot_or_user.slot` or `slot_or_user.user`",
            ),
        }),
    }
}
