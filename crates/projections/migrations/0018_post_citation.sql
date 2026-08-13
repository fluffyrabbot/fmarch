-- 0018_post_citation.sql — first-class quotations and reverse citation index.

ALTER TABLE public.discussion_post
    ADD COLUMN quotations jsonb DEFAULT '[]'::jsonb NOT NULL;

ALTER TABLE public.thread_view
    ADD COLUMN quotations jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE public.post_citation (
    quoted_kind text NOT NULL,
    quoted_scope_id uuid NOT NULL,
    quoted_source_seq bigint NOT NULL,
    quoting_kind text NOT NULL,
    quoting_scope_id uuid NOT NULL,
    quoting_source_seq bigint NOT NULL,
    occurred_at bigint NOT NULL,
    CONSTRAINT post_citation_quoted_kind_check
        CHECK ((quoted_kind = ANY (ARRAY['discussion_post'::text, 'game_post'::text]))),
    CONSTRAINT post_citation_quoting_kind_check
        CHECK ((quoting_kind = ANY (ARRAY['discussion_post'::text, 'game_post'::text])))
);

ALTER TABLE ONLY public.post_citation
    ADD CONSTRAINT post_citation_pkey PRIMARY KEY (
        quoting_kind,
        quoting_scope_id,
        quoting_source_seq,
        quoted_kind,
        quoted_scope_id,
        quoted_source_seq
    );

CREATE INDEX post_citation_quoted_idx
    ON public.post_citation (
        quoted_kind,
        quoted_scope_id,
        quoted_source_seq,
        quoting_source_seq
    );
