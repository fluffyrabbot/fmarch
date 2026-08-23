-- 0031_thread_view_prephase_posts.sql — make pre-phase thread posts explicit.
--
-- Game setup discussion can legitimately precede the first authoritative
-- phase. `NULL` is the only representation of that absence; an empty string
-- would be a malformed phase identity and makes replay ambiguous.
ALTER TABLE public.thread_view
    ALTER COLUMN phase_id DROP NOT NULL;
