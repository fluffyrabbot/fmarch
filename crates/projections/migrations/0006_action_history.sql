-- 0006_action_history.sql -- engine action-use history.
--
-- Rebuildable history facts folded from `ActionRecorded` inner events. This is
-- intentionally separate from `slot_effect`: action cadence is temporal history,
-- not a persistent slot tag.

CREATE TABLE IF NOT EXISTS action_history (
    game_id      UUID NOT NULL,
    slot_id      TEXT NOT NULL,
    template_id  TEXT NOT NULL,
    phase_id     TEXT NOT NULL,
    phase_kind   TEXT NOT NULL,
    phase_number INTEGER NOT NULL,
    targets      JSONB NOT NULL DEFAULT '[]',
    status       TEXT NOT NULL,
    PRIMARY KEY (game_id, slot_id, template_id, phase_id)
);

CREATE INDEX IF NOT EXISTS action_history_slot_template_idx
    ON action_history (game_id, slot_id, template_id, phase_number);
