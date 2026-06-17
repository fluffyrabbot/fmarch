-- 0021_player_info_result.sql -- private non-investigative info result projection.
--
-- Rebuildable player-visible info results folded from `InfoResult` inner
-- events. One row is written per audience slot so private result views can be
-- queried by recipient without reinterpreting resolution envelopes.

CREATE TABLE IF NOT EXISTS player_info_result (
    game_id       UUID    NOT NULL,
    phase_id      TEXT    NOT NULL,
    event_index   INTEGER NOT NULL,
    audience_slot TEXT    NOT NULL,
    kind          TEXT    NOT NULL,
    actor_slot    TEXT    NOT NULL,
    target_slot   TEXT    NOT NULL,
    source_action TEXT    NOT NULL,
    template_id   TEXT    NOT NULL,
    result        JSONB   NOT NULL,
    PRIMARY KEY (game_id, phase_id, event_index, audience_slot)
);

CREATE INDEX IF NOT EXISTS player_info_result_audience_idx
    ON player_info_result (game_id, audience_slot, phase_id, event_index);
