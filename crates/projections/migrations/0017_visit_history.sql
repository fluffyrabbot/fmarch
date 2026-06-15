-- 0017_visit_history.sql -- source-aware prior visits.
--
-- Rebuildable ledger facts folded from `VisitRecorded`. Current tracker/watcher
-- and ordinary motion still read the in-resolution action graph; this table is
-- the resolver-facing cross-phase visit history for later policies.

CREATE TABLE IF NOT EXISTS visit_history (
    game_id       UUID NOT NULL,
    actor_slot    TEXT NOT NULL,
    target_slot   TEXT NOT NULL,
    template_id   TEXT NOT NULL,
    source_action TEXT NOT NULL,
    phase_id      TEXT NOT NULL,
    phase_kind    TEXT NOT NULL,
    phase_number  INTEGER NOT NULL,
    visible       BOOLEAN NOT NULL,
    PRIMARY KEY (game_id, source_action, actor_slot, target_slot)
);

CREATE INDEX IF NOT EXISTS visit_history_actor_idx
    ON visit_history (game_id, actor_slot, phase_number, phase_id);

CREATE INDEX IF NOT EXISTS visit_history_target_idx
    ON visit_history (game_id, target_slot, phase_number, phase_id);
