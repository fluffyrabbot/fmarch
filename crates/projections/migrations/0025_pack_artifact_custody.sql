-- 0025_pack_artifact_custody.sql — immutable, content-addressed rule-pack custody.
--
-- The embedded registry is a creation-time catalog, not historical storage.
-- Every game_index PackRef is therefore backed by one canonical, semantically
-- validated artifact whose bytes survive registry replacement and are portable
-- in completed-game archives.

CREATE TABLE public.pack_artifact (
    content_hash text PRIMARY KEY,
    pack_key text NOT NULL,
    pack_version bigint NOT NULL,
    artifact_schema_version smallint NOT NULL,
    canonical_json text NOT NULL,
    CONSTRAINT pack_artifact_identity_key
        UNIQUE (pack_key, pack_version, content_hash),
    CONSTRAINT pack_artifact_content_hash_check CHECK (
        content_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT pack_artifact_key_check CHECK (
        length(pack_key) > 0 AND pack_key = btrim(pack_key)
    ),
    CONSTRAINT pack_artifact_version_check CHECK (
        pack_version BETWEEN 1 AND 4294967295
    ),
    CONSTRAINT pack_artifact_schema_version_check CHECK (
        artifact_schema_version = 1
    ),
    CONSTRAINT pack_artifact_document_check CHECK (
        jsonb_typeof(canonical_json::jsonb) = 'object'
    )
);

ALTER TABLE public.game_index
    ADD CONSTRAINT game_index_pack_artifact_fkey
    FOREIGN KEY (pack_key, pack_version, pack_content_hash)
    REFERENCES public.pack_artifact (pack_key, pack_version, content_hash)
    ON DELETE RESTRICT;

CREATE FUNCTION public.pack_artifact_immutable_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'pack_artifact is immutable: % is forbidden', TG_OP;
END;
$$;

CREATE TRIGGER pack_artifact_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.pack_artifact
    FOR EACH STATEMENT EXECUTE FUNCTION public.pack_artifact_immutable_guard();
