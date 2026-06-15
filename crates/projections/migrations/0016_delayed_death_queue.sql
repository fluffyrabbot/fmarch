-- 0016_delayed_death_queue.sql -- active source-aware delayed deaths.
--
-- Rebuildable queue facts folded from `DelayedDeathQueued` and consumed by
-- `DelayedDeathResolved`. The event log preserves applied/preempted history;
-- this table is the active resolver-facing queue for future phases.

CREATE TABLE IF NOT EXISTS delayed_death_queue (
    game_id       UUID NOT NULL,
    queue_id      TEXT NOT NULL,
    target_slot   TEXT NOT NULL,
    cause         TEXT NOT NULL,
    effect        TEXT NOT NULL,
    source_slot   TEXT NOT NULL,
    source_action TEXT NOT NULL,
    phase_id      TEXT NOT NULL,
    phase_kind    TEXT NOT NULL,
    phase_number  INTEGER NOT NULL,
    PRIMARY KEY (game_id, queue_id)
);

CREATE INDEX IF NOT EXISTS delayed_death_queue_target_idx
    ON delayed_death_queue (game_id, target_slot, effect);
