-- 0033_publication_search_group_check.sql — search_group vocabulary is a schema fact.

ALTER TABLE public.publication_surface
    ADD CONSTRAINT publication_surface_search_group_check
    CHECK (search_group IN ('discussions', 'profiles', 'games'));
