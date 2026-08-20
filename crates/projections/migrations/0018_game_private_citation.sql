-- 0018_game_private_citation.sql — quotations and private-game reverse index.

ALTER TABLE public.discussion_post
    ADD COLUMN quotations jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.thread_view
    ADD COLUMN quotations jsonb DEFAULT '[]'::jsonb NOT NULL;

-- Private game-channel citations are game-local. Public citation reads use the
-- source-agnostic `public_citation` bridge introduced by Community Platform v2.
CREATE TABLE public.game_private_citation (
    game_id uuid NOT NULL,
    quoted_source_seq bigint NOT NULL,
    quoting_source_seq bigint NOT NULL,
    occurred_at bigint NOT NULL
);

ALTER TABLE ONLY public.game_private_citation
    ADD CONSTRAINT game_private_citation_pkey PRIMARY KEY (
        game_id,
        quoting_source_seq,
        quoted_source_seq
    );

CREATE INDEX game_private_citation_quoted_idx
    ON public.game_private_citation (
        game_id,
        quoted_source_seq,
        quoting_source_seq
    );
