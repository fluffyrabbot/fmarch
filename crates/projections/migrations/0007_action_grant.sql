-- 0007_action_grant.sql -- generated action/item grants.
--
-- Rebuildable capability inventory folded from `ActionGranted` inner events and
-- decremented by `ActionGrantConsumed` inner events.
-- This is intentionally separate from `action_history` (attempt audit) and
-- `slot_effect` (target-state tags).

CREATE TABLE IF NOT EXISTS action_grant (
    game_id      UUID NOT NULL,
    slot_id      TEXT NOT NULL,
    grant_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,
    source_slot  TEXT NOT NULL,
    source_action TEXT NOT NULL,
    phase_id     TEXT NOT NULL,
    phase_kind   TEXT NOT NULL,
    phase_number INTEGER NOT NULL,
    uses         INTEGER NOT NULL,
    vote_weight  DOUBLE PRECISION,
    PRIMARY KEY (game_id, slot_id, grant_id, source_slot, source_action, phase_id)
);

CREATE INDEX IF NOT EXISTS action_grant_slot_idx
    ON action_grant (game_id, slot_id, grant_id, phase_number);
