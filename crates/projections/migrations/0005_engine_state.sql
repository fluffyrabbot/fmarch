-- 0005_engine_state.sql -- engine-carried cross-phase state.
--
-- These tables/columns are derived from engine result events and are rebuildable
-- from the event log. They carry facts that can affect later resolutions:
-- converted alignment/role and source-aware persistent effect state.

ALTER TABLE slot_state
    ADD COLUMN IF NOT EXISTS alignment TEXT NULL;

CREATE TABLE IF NOT EXISTS slot_effect (
    game_id UUID NOT NULL,
    slot_id TEXT NOT NULL,
    effect TEXT NOT NULL,
    source_slot TEXT NOT NULL,
    source_action TEXT NULL,
    phase_id TEXT NULL,
    phase_kind TEXT NULL,
    phase_number INTEGER NULL,
    duration TEXT NOT NULL DEFAULT 'Persistent',
    visibility TEXT NOT NULL DEFAULT 'Hidden',
    PRIMARY KEY (game_id, slot_id, effect)
);

CREATE INDEX IF NOT EXISTS slot_effect_by_effect_idx
    ON slot_effect (game_id, effect, slot_id);
