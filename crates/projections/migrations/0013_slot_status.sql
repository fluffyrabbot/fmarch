-- 0013_slot_status.sql -- resolver-facing lifecycle and pack-visible status tags.

ALTER TABLE slot_state
    ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'alive';

UPDATE slot_state
   SET status = CASE WHEN alive THEN 'alive' ELSE 'dead' END
 WHERE status = 'alive'
   AND alive = FALSE;

CREATE TABLE IF NOT EXISTS slot_status_tag (
    game_id UUID NOT NULL,
    slot_id TEXT NOT NULL,
    tag     TEXT NOT NULL,
    PRIMARY KEY (game_id, slot_id, tag)
);

CREATE INDEX IF NOT EXISTS slot_status_tag_by_tag_idx
    ON slot_status_tag (game_id, tag, slot_id);
