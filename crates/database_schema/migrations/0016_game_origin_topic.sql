-- A signup topic is an ordinary forum topic named by a game's creation event.
-- No FK to the forum projection: replaying the forum must not delete game facts.
ALTER TABLE public.game_index ADD COLUMN origin_topic_id uuid;
CREATE TABLE public.discussion_topic_spawned_game (
    game_id uuid NOT NULL PRIMARY KEY REFERENCES public.game_index(game_id) ON DELETE CASCADE,
    topic_id uuid NOT NULL,
    created_seq bigint NOT NULL,
    host_principal_id uuid NOT NULL,
    started_seq bigint,
    started_at bigint,
    CONSTRAINT discussion_topic_spawned_game_start_shape CHECK ((started_seq IS NULL) = (started_at IS NULL))
);
CREATE INDEX discussion_topic_spawned_game_topic_idx
    ON public.discussion_topic_spawned_game (topic_id, started_seq, game_id);

ALTER TABLE public.member_inbox_item DROP CONSTRAINT member_inbox_item_reason_check;
ALTER TABLE public.member_inbox_item ADD CONSTRAINT member_inbox_item_reason_check
    CHECK (reason IN ('watch', 'mention', 'game_spawned_from_watched_topic'));

-- Attention destinations are read adapters, not synthetic posts. Announcements
-- retain the origin topic as subscription scope and the creation event as stable
-- identity; the start event orders delivery. Setup remains private.
CREATE VIEW public.attention_destination AS
SELECT surface_id, source_seq, href, author_profile_id, visible
FROM public.public_publication
UNION ALL
SELECT origin.topic_id, origin.created_seq, '/games/' || origin.game_id::text,
       topic.author_profile_id,
       (origin.started_seq IS NOT NULL AND game.status IN ('active', 'completed')
        AND topic.visibility = 'visible' AND game_surface.visible) AS visible
FROM public.discussion_topic_spawned_game AS origin
JOIN public.game_index AS game ON game.game_id = origin.game_id
JOIN public.discussion_topic AS topic ON topic.topic_id = origin.topic_id
JOIN public.publication_surface AS game_surface ON game_surface.surface_id = game.game_id;
