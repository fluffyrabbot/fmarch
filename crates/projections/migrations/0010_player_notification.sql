-- 0010_player_notification.sql -- explicit-audience engine notifications.
--
-- Rebuildable player-visible notices folded from `EffectNotification` inner
-- events. One row is written per audience slot so private result views can be
-- queried by recipient without reinterpreting the resolution envelope.

CREATE TABLE IF NOT EXISTS player_notification (
    game_id       UUID    NOT NULL,
    phase_id      TEXT    NOT NULL,
    event_index   INTEGER NOT NULL,
    audience_slot TEXT    NOT NULL,
    effect        TEXT    NOT NULL,
    status        TEXT    NOT NULL,
    PRIMARY KEY (game_id, phase_id, event_index, audience_slot)
);

CREATE INDEX IF NOT EXISTS player_notification_audience_idx
    ON player_notification (game_id, audience_slot, phase_id, event_index);
