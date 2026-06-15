-- 0002_projections.sql — read-model projection tables (doc 02 / doc 10).
--
-- Projections are DERIVED, rebuildable from the event log at any time. Unlike
-- `events`, these tables ARE mutated (upsert/truncate): that is the whole point
-- of a read model. A `rebuild(game_id)` truncates these rows for a game and
-- re-folds the log; same log => same projection (determinism, doc 02).

-- ── votecount: the RUNNING tally (doc 10 folds from VoteSubmitted/VoteWithdrawn).
-- The OFFICIAL outcome is the engine's DayVoteOutcome and is NOT this table.
-- One row per (game_id, phase_id, candidate_slot) with a weighted count.
--
-- RULING (doc under-specifies weight source for the running tally): the running
-- count is folded from raw submissions, before any resolution has run, so there
-- is no DayVoteOutcome to read weights from. We therefore use a per-event weight
-- carried on the VoteSubmitted payload (`weight`, default 1.0). This keeps the
-- running tally a pure fold of submissions; the authoritative weighted outcome
-- still comes from the engine later.
CREATE TABLE IF NOT EXISTS votecount (
    game_id        UUID   NOT NULL,
    phase_id       TEXT   NOT NULL,
    candidate_slot TEXT   NOT NULL,   -- target slot id, or "no_lynch"
    weight         DOUBLE PRECISION NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, phase_id, candidate_slot)
);

-- ── slot_state: per-slot lifecycle + role/alignment reveal (doc 10 folds from RoleAssigned,
-- PlayerKilled, PlayerSaved, ...).
--
-- RULING (doc under-specifies role-reveal timing): `role_key` is populated on
-- RoleAssigned, PlayerKilled flips the killed slot's `role_revealed` and/or
-- `alignment_revealed` according to pack-owned death reveal policy, and
-- end-of-game reveal (WinReached / GameCompleted) flips every slot. The data
-- is present from assignment; visibility is a separate flag a rebuild proves
-- was always correct. PlayerSaved is folded as an
-- explicit no-op that keeps the slot alive (it cancels a would-be kill at
-- resolution time; by the time a save is recorded the slot was never marked
-- dead).
CREATE TABLE IF NOT EXISTS slot_state (
    game_id       UUID NOT NULL,
    slot_id       TEXT NOT NULL,
    alive         BOOLEAN NOT NULL DEFAULT TRUE,
    role_key      TEXT NULL,
    role_revealed BOOLEAN NOT NULL DEFAULT FALSE,
    alignment_revealed BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (game_id, slot_id)
);
