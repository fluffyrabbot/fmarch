-- 0021_game_pack_ref.sql — persist the complete content-addressed pack identity.

ALTER TABLE public.game_index
    RENAME COLUMN pack TO pack_key;

ALTER TABLE public.game_index
    ADD COLUMN pack_version bigint NOT NULL,
    ADD COLUMN pack_content_hash text NOT NULL,
    ADD CONSTRAINT game_index_pack_key_check CHECK (
        length(pack_key) > 0 AND pack_key = btrim(pack_key)
    ),
    ADD CONSTRAINT game_index_pack_version_check CHECK (
        pack_version BETWEEN 1 AND 4294967295
    ),
    ADD CONSTRAINT game_index_pack_content_hash_check CHECK (
        pack_content_hash ~ '^[0-9a-f]{64}$'
    );
