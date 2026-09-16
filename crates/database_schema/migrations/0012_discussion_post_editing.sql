-- Forum post editing and author retraction (completion registry:
-- product.community.forum-editing-curation, slice 1).
--
-- Editability is a policy owned by each thread source. Community forum posts
-- are editable by their author inside a bounded window and retractable by
-- their author at any time; game channel posts are slot-authored evidence and
-- have no counterpart here or anywhere else. The post row keeps its current
-- content plus three overlay columns, and the superseded content of every
-- edit is appended to discussion_post_revision so history is never rewritten.
--
-- Retraction is a read-time overlay: retracted_at is set, the row survives,
-- and cited excerpt snapshots on other posts keep what was quoted (RFC 0002).

ALTER TABLE public.discussion_post
    ADD COLUMN revision bigint DEFAULT 0 NOT NULL,
    ADD COLUMN edited_at bigint,
    ADD COLUMN retracted_at bigint;

ALTER TABLE public.discussion_post
    ADD CONSTRAINT discussion_post_revision_check CHECK ((revision >= 0)),
    ADD CONSTRAINT discussion_post_edited_check
        CHECK (((revision = 0) = (edited_at IS NULL)));

-- One row per superseded revision. Revision N of a post is the content that
-- was current until the edit recorded at superseded_seq replaced it; the
-- live row always carries the highest revision. Unedited posts have no rows.
CREATE TABLE public.discussion_post_revision (
    source_seq bigint NOT NULL,
    revision bigint NOT NULL,
    body text NOT NULL,
    mentions jsonb DEFAULT '[]'::jsonb NOT NULL,
    superseded_seq bigint NOT NULL,
    superseded_at bigint NOT NULL,
    CONSTRAINT discussion_post_revision_revision_check CHECK ((revision >= 0))
);

ALTER TABLE ONLY public.discussion_post_revision
    ADD CONSTRAINT discussion_post_revision_pkey PRIMARY KEY (source_seq, revision);

ALTER TABLE ONLY public.discussion_post_revision
    ADD CONSTRAINT discussion_post_revision_source_seq_fkey
        FOREIGN KEY (source_seq) REFERENCES public.discussion_post(source_seq) ON DELETE CASCADE;
