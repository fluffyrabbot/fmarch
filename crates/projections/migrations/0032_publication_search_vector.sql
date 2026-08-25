-- 0032_publication_search_vector.sql — dedicated indexed public search documents.
--
-- Public publications remain canonical engagement identities. Search owns a
-- separate rebuildable document projection so surface titles are indexed once.

CREATE TABLE public.public_search_document (
    surface_id uuid NOT NULL,
    document_type text NOT NULL,
    source_seq bigint NOT NULL,
    title_text text NOT NULL,
    body text NOT NULL,
    href text NOT NULL,
    author_profile_id uuid,
    published_at bigint NOT NULL,
    updated_seq bigint NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, title_text), 'A')
        || setweight(to_tsvector('english'::regconfig, body), 'B')
    ) STORED,
    CONSTRAINT public_search_document_pkey
        PRIMARY KEY (surface_id, document_type, source_seq),
    CONSTRAINT public_search_document_surface_id_fkey
        FOREIGN KEY (surface_id) REFERENCES public.publication_surface(surface_id)
        ON DELETE CASCADE,
    CONSTRAINT public_search_document_type_check CHECK (
        document_type IN (
            'discussion', 'discussion_post', 'profile', 'game', 'game_post'
        )
    ),
    CONSTRAINT public_search_document_shape_check CHECK (
        (document_type IN ('discussion', 'profile', 'game') AND source_seq = 0 AND title_text <> '')
        OR
        (document_type IN ('discussion_post', 'game_post') AND source_seq > 0 AND title_text = '')
    )
);

CREATE INDEX public_search_document_vector_idx
    ON public.public_search_document USING GIN (search_vector)
    WHERE visible;

CREATE INDEX public_search_document_author_idx
    ON public.public_search_document (author_profile_id, updated_seq DESC)
    WHERE author_profile_id IS NOT NULL;
