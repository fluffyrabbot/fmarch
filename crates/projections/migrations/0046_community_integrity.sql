-- 0046_community_integrity.sql -- public authorship and orthogonal topic state.
--
-- `status` previously complected whether a topic was readable with whether it
-- accepted replies. Public community writes now resolve to stable profile ids,
-- and `version` is the topic stream sequence used for optimistic commands.

ALTER TABLE discussion_topic
    ADD COLUMN author_profile_id UUID NULL
        REFERENCES profile_public (profile_id) DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN posting_state TEXT NOT NULL DEFAULT 'open'
        CHECK (posting_state IN ('open', 'locked')),
    ADD COLUMN visibility TEXT NOT NULL DEFAULT 'visible'
        CHECK (visibility IN ('visible', 'hidden')),
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_post_seq BIGINT NULL,
    ADD COLUMN last_post_at BIGINT NULL;

UPDATE discussion_topic AS topic
SET author_profile_id = editor.profile_id
FROM profile_editor AS editor
WHERE editor.principal_user_id = topic.author_user_id;

UPDATE discussion_topic
SET posting_state = CASE WHEN status = 'locked' THEN 'locked' ELSE 'open' END,
    visibility = CASE WHEN status = 'hidden' THEN 'hidden' ELSE 'visible' END;

UPDATE discussion_topic AS topic
SET version = source.version,
    created_at = source.created_at,
    updated_at = source.updated_at
FROM (
    SELECT stream_id,
           MAX(stream_seq) AS version,
           MIN(occurred_at) AS created_at,
           MAX(occurred_at) AS updated_at
    FROM events
    GROUP BY stream_id
) AS source
WHERE source.stream_id = topic.topic_id;

ALTER TABLE discussion_topic
    DROP COLUMN status,
    DROP COLUMN author_user_id;

DROP INDEX IF EXISTS discussion_topic_area_page_idx;
CREATE INDEX discussion_topic_area_page_idx
    ON discussion_topic (area_id, updated_seq DESC, topic_id DESC)
    WHERE visibility = 'visible';

ALTER TABLE discussion_post
    ADD COLUMN author_profile_id UUID NULL
        REFERENCES profile_public (profile_id) DEFERRABLE INITIALLY DEFERRED,
    ADD COLUMN created_at BIGINT NOT NULL DEFAULT 0;

UPDATE discussion_post AS post
SET author_profile_id = editor.profile_id
FROM profile_editor AS editor
WHERE editor.principal_user_id = post.author_user_id;

UPDATE discussion_post AS post
SET created_at = event.occurred_at
FROM events AS event
WHERE event.seq = post.source_seq;

UPDATE discussion_topic AS topic
SET last_post_seq = latest.source_seq,
    last_post_at = latest.created_at
FROM (
    SELECT DISTINCT ON (topic_id) topic_id, source_seq, created_at
    FROM discussion_post
    ORDER BY topic_id, source_seq DESC
) AS latest
WHERE latest.topic_id = topic.topic_id;

ALTER TABLE discussion_post
    DROP COLUMN author_user_id;
