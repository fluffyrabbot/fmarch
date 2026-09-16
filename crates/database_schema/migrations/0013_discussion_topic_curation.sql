-- Forum topic curation (completion registry:
-- product.community.forum-editing-curation, slice 2).
--
-- GlobalMod rename, move, and pin are topic-level facts folded from the
-- topic stream. Rename and move land on the existing title and area_id
-- columns; pin is the one new fact. Pinned topics sort ahead of the
-- (updated_seq, topic_id) keyset on an area's first page, so the column
-- carries no ordering sequence of its own.

ALTER TABLE public.discussion_topic
    ADD COLUMN pinned boolean DEFAULT false NOT NULL;

CREATE INDEX discussion_topic_area_pinned_idx
    ON public.discussion_topic USING btree (area_id, updated_seq DESC, topic_id DESC)
    WHERE pinned;
