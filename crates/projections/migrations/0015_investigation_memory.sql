-- 0015_investigation_memory.sql -- prior investigation baselines.
--
-- Rebuildable state facts folded from `InvestigationMemoryRecorded`. These are
-- resolver-facing baselines; player/admin-facing `InvestigationResult` remains
-- a per-resolution output fact.

CREATE TABLE IF NOT EXISTS investigation_memory (
    game_id           UUID NOT NULL,
    investigator_slot TEXT NOT NULL,
    target_slot       TEXT NOT NULL,
    mode              TEXT NOT NULL,
    memory_scope      TEXT NOT NULL DEFAULT 'Target',
    result            JSONB NOT NULL,
    source_action     TEXT NOT NULL,
    template_id       TEXT NOT NULL,
    phase_id          TEXT NOT NULL,
    phase_kind        TEXT NOT NULL,
    phase_number      INTEGER NOT NULL,
    PRIMARY KEY (game_id, investigator_slot, target_slot, mode)
);

CREATE INDEX IF NOT EXISTS investigation_memory_investigator_idx
    ON investigation_memory (game_id, investigator_slot, mode);
