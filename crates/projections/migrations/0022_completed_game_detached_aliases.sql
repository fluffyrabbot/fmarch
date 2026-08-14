-- 0022_completed_game_detached_aliases.sql — portable, non-PII completed-game persona aliases.

CREATE TABLE public.completed_game_detached_alias (
    game_id uuid NOT NULL,
    subject_ref_sha256 text NOT NULL,
    detached_alias text NOT NULL,
    alias_version smallint NOT NULL,
    CONSTRAINT completed_game_detached_alias_pkey
        PRIMARY KEY (game_id, subject_ref_sha256),
    CONSTRAINT completed_game_detached_alias_game_alias_key
        UNIQUE (game_id, detached_alias),
    CONSTRAINT completed_game_detached_alias_subject_ref_check
        CHECK (subject_ref_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT completed_game_detached_alias_version_check
        CHECK (alias_version = 1),
    CONSTRAINT completed_game_detached_alias_shape_check
        CHECK (detached_alias ~ '^Archived player [0-9a-f]{20}$')
);

CREATE TRIGGER completed_game_detached_alias_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.completed_game_detached_alias
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();
