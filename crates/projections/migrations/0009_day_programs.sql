-- 0009_day_programs.sql — immutable inline DayProgram attachments.

CREATE TABLE public.day_program (
    game_id uuid NOT NULL,
    program_id text NOT NULL,
    version bigint NOT NULL,
    display_name text NOT NULL,
    theme_ref text,
    content_hash text NOT NULL,
    document jsonb NOT NULL,
    attached_seq bigint NOT NULL,
    CONSTRAINT day_program_pkey PRIMARY KEY (game_id, program_id, version),
    CONSTRAINT day_program_version_check CHECK (version > 0),
    CONSTRAINT day_program_display_name_check CHECK (btrim(display_name) <> ''),
    CONSTRAINT day_program_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT day_program_document_check CHECK (jsonb_typeof(document) = 'object')
);

CREATE INDEX day_program_attached_idx
    ON public.day_program (game_id, attached_seq DESC);
