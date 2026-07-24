-- 0013_day_event_narrative.sql — immutable narrative templates and retryable delivery work.

CREATE TABLE public.day_event_narrative (
    game_id UUID NOT NULL,
    event_id TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    template_key TEXT NOT NULL,
    template_hash TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    body_template TEXT NOT NULL,
    source_seq BIGINT,
    rendered_body TEXT,
    status TEXT NOT NULL DEFAULT 'armed',
    published_seq BIGINT,
    CONSTRAINT day_event_narrative_pkey PRIMARY KEY (game_id, event_id, lifecycle),
    CONSTRAINT day_event_narrative_event_fkey
        FOREIGN KEY (game_id, event_id)
        REFERENCES public.day_event(game_id, event_id)
        ON DELETE CASCADE,
    CONSTRAINT day_event_narrative_lifecycle_check CHECK (
        lifecycle IN ('opened', 'locked', 'resolved', 'cancelled')
    ),
    CONSTRAINT day_event_narrative_template_hash_check CHECK (
        template_hash ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT day_event_narrative_channel_check CHECK (
        channel_id = 'main'
    ),
    CONSTRAINT day_event_narrative_body_check CHECK (
        btrim(body_template) <> ''
    ),
    CONSTRAINT day_event_narrative_status_check CHECK (
        status IN ('armed', 'pending', 'published')
    ),
    CONSTRAINT day_event_narrative_delivery_check CHECK (
        (status = 'armed' AND source_seq IS NULL AND rendered_body IS NULL AND published_seq IS NULL)
        OR
        (status = 'pending' AND source_seq IS NOT NULL AND rendered_body IS NOT NULL AND published_seq IS NULL)
        OR
        (status = 'published' AND source_seq IS NOT NULL AND rendered_body IS NOT NULL AND published_seq IS NOT NULL)
    )
);

CREATE INDEX day_event_narrative_pending_idx
    ON public.day_event_narrative (game_id, event_id, lifecycle)
    WHERE status = 'pending';

ALTER TABLE public.day_event_schedule_work
    ADD COLUMN narrative_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX day_event_schedule_work_narrative_idx
    ON public.day_event_schedule_work (game_id)
    WHERE narrative_pending;
