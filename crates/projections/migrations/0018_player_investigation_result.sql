-- 0018_player_investigation_result.sql -- private investigation result projection.
--
-- Rebuildable player-visible investigation results folded from
-- `InvestigationResult` inner events. One row is written per investigator slot
-- so private result views can be queried by recipient without reinterpreting
-- resolution envelopes.

CREATE TABLE IF NOT EXISTS player_investigation_result (
    game_id       UUID    NOT NULL,
    phase_id      TEXT    NOT NULL,
    event_index   INTEGER NOT NULL,
    audience_slot TEXT    NOT NULL,
    mode          TEXT    NOT NULL,
    target_slot   TEXT    NOT NULL,
    result        JSONB   NOT NULL,
    PRIMARY KEY (game_id, phase_id, event_index, audience_slot)
);

CREATE INDEX IF NOT EXISTS player_investigation_result_audience_idx
    ON player_investigation_result (game_id, audience_slot, phase_id, event_index);
