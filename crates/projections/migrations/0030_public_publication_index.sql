-- 0030_public_publication_index.sql — generic public-content bridge.
--
-- Source aggregates retain their own projections and authorization models. This
-- index is the only input to public engagement families, so adding a source
-- requires one source adapter rather than a global kind switch.

CREATE TABLE public.publication_surface (
    surface_id uuid NOT NULL,
    search_group text NOT NULL,
    title text NOT NULL,
    href text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    updated_seq bigint NOT NULL,
    CONSTRAINT publication_surface_pkey PRIMARY KEY (surface_id)
);

CREATE TABLE public.public_publication (
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    body text NOT NULL,
    href text NOT NULL,
    author_profile_id uuid,
    occurred_at bigint NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    CONSTRAINT public_publication_pkey PRIMARY KEY (surface_id, source_seq),
    CONSTRAINT public_publication_surface_id_fkey
        FOREIGN KEY (surface_id) REFERENCES public.publication_surface(surface_id)
        ON DELETE CASCADE
);

CREATE INDEX public_publication_surface_page_idx
    ON public.public_publication (surface_id, source_seq DESC)
    WHERE visible;

CREATE INDEX public_publication_author_idx
    ON public.public_publication (author_profile_id, source_seq DESC)
    WHERE author_profile_id IS NOT NULL;

-- Public quotation edges are generic publication identities. They are a
-- derived, rebuildable index; a source that is not public never receives an
-- endpoint here.
CREATE TABLE public.public_citation (
    quoted_surface_id uuid NOT NULL,
    quoted_source_seq bigint NOT NULL,
    quoting_surface_id uuid NOT NULL,
    quoting_source_seq bigint NOT NULL,
    occurred_at bigint NOT NULL,
    CONSTRAINT public_citation_pkey PRIMARY KEY (
        quoting_surface_id, quoting_source_seq,
        quoted_surface_id, quoted_source_seq
    ),
    CONSTRAINT public_citation_quoted_fkey FOREIGN KEY
        (quoted_surface_id, quoted_source_seq)
        REFERENCES public.public_publication(surface_id, source_seq) ON DELETE CASCADE,
    CONSTRAINT public_citation_quoting_fkey FOREIGN KEY
        (quoting_surface_id, quoting_source_seq)
        REFERENCES public.public_publication(surface_id, source_seq) ON DELETE CASCADE
);

CREATE INDEX public_citation_quoted_page_idx
    ON public.public_citation (quoted_surface_id, quoted_source_seq, quoting_source_seq DESC);
