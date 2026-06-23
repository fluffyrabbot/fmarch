-- 0024_thread_view_media.sql -- optional tablet-safe thread media metadata.
--
-- Media metadata is folded with channel thread posts so live cold loads can
-- render already-processed image variants without exposing original uploads.

ALTER TABLE thread_view
    ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;
