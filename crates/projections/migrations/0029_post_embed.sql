-- 0029_post_embed.sql — first-class main-thread YouTube embeds.

ALTER TABLE public.thread_view
    ADD COLUMN embed jsonb;
