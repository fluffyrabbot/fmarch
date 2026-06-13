-- 0003_phase3.sql — Phase 3 projections: capability resolution + command validation.
--
-- These read models back the capability resolver (caps crate) and the command
-- pipeline (commands crate). All are DERIVED and rebuildable from the log.

-- ── RULING: running votecount is BALLOT-keyed, not weight-accumulated ──────────
-- The Phase-2 `votecount` table accumulated a DOUBLE weight per candidate. The
-- Phase-3 standing ruling makes the running tally UNWEIGHTED and keyed by each
-- actor-slot's CURRENT ballot: a `VoteSubmitted` OVERWRITES that actor's ballot,
-- `VoteWithdrawn { actor, phase_id }` removes it, and the tally is the COUNT of
-- targets. Weights remain an engine/official-DayVoteOutcome concern, never the
-- running tally. We replace the old table with a ballot table so "overwrite" and
-- "withdraw" are pure local upserts/deletes (one row per actor per phase).
DROP TABLE IF EXISTS votecount;

CREATE TABLE IF NOT EXISTS vote_ballot (
    game_id    UUID NOT NULL,
    phase_id   TEXT NOT NULL,
    actor_slot TEXT NOT NULL,        -- the voting slot (current ballot owner)
    target     TEXT NOT NULL,        -- target slot id, or "no_lynch"
    PRIMARY KEY (game_id, phase_id, actor_slot)
);

CREATE INDEX IF NOT EXISTS vote_ballot_target_idx
    ON vote_ballot (game_id, phase_id, target);

-- ── game_authority: host + cohosts per game (caps: HostOf / CohostOf) ──────────
-- Folded from GameCreated (host) and CohostAdded (cohost). One row per
-- (game, user, role) so a user can appear once as host and/or cohost.
CREATE TABLE IF NOT EXISTS game_authority (
    game_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    role    TEXT NOT NULL,           -- "host" | "cohost"
    PRIMARY KEY (game_id, user_id, role)
);

-- ── slot_occupancy: the LIVE slot→user mapping (caps: SlotOccupant) ────────────
-- The slot id is STABLE across replacement; only the occupant user moves.
-- Folded from SlotAssigned (occupancy begins) and ReplacementCompleted
-- (occupant swaps; slot id unchanged). One row per slot = its CURRENT occupant.
-- The slot's HISTORY (votes/posts attributed to the slot) lives in other
-- projections keyed by slot_id and is therefore untouched by a replacement.
CREATE TABLE IF NOT EXISTS slot_occupancy (
    game_id          UUID NOT NULL,
    slot_id          TEXT NOT NULL,
    occupant_user_id TEXT NOT NULL,
    PRIMARY KEY (game_id, slot_id)
);

CREATE INDEX IF NOT EXISTS slot_occupancy_user_idx
    ON slot_occupancy (game_id, occupant_user_id);

-- ── phase_state: current phase, lock, deadline (validation: phase open/locked) ─
-- Folded from GameStarted / PhaseAdvanced (current phase), DeadlineSet /
-- DeadlineExtended (deadline), ThreadLocked / ThreadUnlocked (locked flag).
-- One row per game (the CURRENT phase window).
CREATE TABLE IF NOT EXISTS phase_state (
    game_id    UUID NOT NULL,
    phase_id   TEXT NOT NULL,
    locked     BOOLEAN NOT NULL DEFAULT FALSE,
    deadline   BIGINT NULL,          -- LogicalTime (u64) deadline, captured as data
    PRIMARY KEY (game_id)
);
