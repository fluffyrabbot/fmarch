-- 0012_day_event_auto_resolution.sql — stable auto-resolution seeds and indexed work.

ALTER TABLE public.day_event
    ADD COLUMN auto_seed BIGINT,
    ADD COLUMN resolution_evidence JSONB;

ALTER TABLE public.day_event
    ADD CONSTRAINT day_event_auto_seed_check CHECK (auto_seed IS NULL OR auto_seed >= 0),
    ADD CONSTRAINT day_event_resolution_evidence_check CHECK (
        resolution_evidence IS NULL OR jsonb_typeof(resolution_evidence) = 'object'
    );

ALTER TABLE public.day_event_schedule_work
    ADD COLUMN auto_resolve_pending BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX day_event_schedule_work_auto_resolve_idx
    ON public.day_event_schedule_work (game_id)
    WHERE auto_resolve_pending;
