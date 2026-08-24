-- 0032_publication_search_vector.sql — indexed, weighted public search.
--
-- The public-content bridge remains the sole rebuildable search source. Copying
-- the surface title here lets the vector and its GIN index live on one table.

ALTER TABLE public.public_publication
    ADD COLUMN surface_title text NOT NULL DEFAULT '',
    ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english'::regconfig, surface_title), 'A')
        || setweight(to_tsvector('english'::regconfig, body), 'B')
    ) STORED;

CREATE INDEX public_publication_search_idx
    ON public.public_publication USING GIN (search_vector)
    WHERE visible;
