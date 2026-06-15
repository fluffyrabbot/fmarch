-- 0014_action_counter.sql -- typed limited-use/counter state.
--
-- Rebuildable counter facts folded from `ActionUseCounted` inner events.
-- This replaces ad hoc `used:<template_id>` slot effects for x-shot style
-- capability limits while preserving source action, cadence policy, phase
-- scope, and remaining-use metadata.

CREATE TABLE IF NOT EXISTS action_counter (
    game_id         UUID NOT NULL,
    slot_id         TEXT NOT NULL,
    counter_id      TEXT NOT NULL,
    template_id     TEXT NOT NULL,
    consumed_action TEXT NOT NULL,
    cadence_policy  TEXT NOT NULL,
    phase_scope     TEXT NOT NULL,
    limit_count     INTEGER NOT NULL,
    used_count      INTEGER NOT NULL,
    remaining_count INTEGER NOT NULL,
    phase_id        TEXT NOT NULL,
    phase_kind      TEXT NOT NULL,
    phase_number    INTEGER NOT NULL,
    PRIMARY KEY (game_id, slot_id, counter_id)
);

CREATE INDEX IF NOT EXISTS action_counter_slot_template_idx
    ON action_counter (game_id, slot_id, template_id);
