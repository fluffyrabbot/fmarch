-- 0033_publication_search_title_backfill.sql — copy surface titles onto pre-0032 publications.
--
-- 0032 added surface_title with DEFAULT '' and a STORED vector. Rows that
-- already existed kept the empty default, so title-only terms stopped matching.
-- The generated vector recomputes as this UPDATE lands.

UPDATE public.public_publication AS p
SET surface_title = s.title
FROM public.publication_surface AS s
WHERE s.surface_id = p.surface_id
  AND p.surface_title <> s.title;
