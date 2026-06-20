-- 0004_thread_view.sql -- channel-thread read model.
--
-- `thread_view` is derived from PostSubmitted events. Rows are keyed by the
-- source event order, making the projection rebuildable and giving cold-load
-- pagination a stable cursor.

CREATE TABLE IF NOT EXISTS thread_view (
    game_id     UUID   NOT NULL,
    source_seq  BIGINT NOT NULL, -- events.seq: stable global event cursor
    stream_seq  BIGINT NOT NULL, -- events.stream_seq: game-local ordering
    channel_id  TEXT   NOT NULL,
    author_slot TEXT   NULL,
    author_user TEXT   NULL,
    phase_id    TEXT   NOT NULL,
    body        TEXT   NOT NULL,
    occurred_at BIGINT NOT NULL,
    PRIMARY KEY (game_id, source_seq),
    CONSTRAINT thread_view_author_present CHECK (
        author_slot IS NOT NULL OR author_user IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS thread_view_page_idx
    ON thread_view (game_id, channel_id, source_seq DESC);
