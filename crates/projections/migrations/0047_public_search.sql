-- 0047_public_search.sql -- rebuildable, public-only community search documents.
--
-- Search documents contain presentation-safe text and canonical public links.
-- Private channels and credential principals never enter this projection.

CREATE TABLE public_search_document (
    document_kind TEXT NOT NULL CHECK (document_kind IN (
        'discussion_topic',
        'discussion_post',
        'profile',
        'game',
        'game_post'
    )),
    document_key  TEXT NOT NULL,
    scope_kind    TEXT NOT NULL CHECK (scope_kind IN ('discussion', 'profile', 'game')),
    scope_id      UUID NOT NULL,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,
    href          TEXT NOT NULL,
    updated_seq   BIGINT NOT NULL,
    published_at  BIGINT NOT NULL,
    search_vector TSVECTOR GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(body, '')), 'B')
    ) STORED,
    PRIMARY KEY (document_kind, document_key)
);

CREATE INDEX public_search_document_vector_idx
    ON public_search_document USING GIN (search_vector);

CREATE INDEX public_search_document_scope_idx
    ON public_search_document (scope_kind, scope_id);

CREATE INDEX public_search_document_page_idx
    ON public_search_document (updated_seq DESC, document_kind, document_key);
