-- 0041_discussion.sql -- public non-game discussion read models.
--
-- Areas and topics are append-only event streams. These tables are synchronous,
-- rebuildable projections; public readers never receive account identifiers.

CREATE TABLE discussion_area (
    area_id     UUID PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    created_seq BIGINT NOT NULL
);

CREATE TABLE discussion_topic (
    topic_id       UUID PRIMARY KEY,
    area_id        UUID NOT NULL REFERENCES discussion_area (area_id),
    title          TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('open', 'locked', 'hidden')),
    author_user_id TEXT NOT NULL,
    post_count     BIGINT NOT NULL DEFAULT 0,
    created_seq    BIGINT NOT NULL,
    updated_seq    BIGINT NOT NULL,
    moderated_seq  BIGINT NULL
);

CREATE INDEX discussion_topic_area_page_idx
    ON discussion_topic (area_id, updated_seq DESC, topic_id DESC)
    WHERE status <> 'hidden';

CREATE TABLE discussion_post (
    source_seq     BIGINT PRIMARY KEY,
    topic_id       UUID NOT NULL REFERENCES discussion_topic (topic_id) ON DELETE CASCADE,
    author_user_id TEXT NOT NULL,
    body           TEXT NOT NULL,
    created_seq    BIGINT NOT NULL
);

CREATE INDEX discussion_post_topic_order_idx
    ON discussion_post (topic_id, source_seq DESC);
