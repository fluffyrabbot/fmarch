-- 0010_day_event_schedules.sql — captured phase clocks and DayEvent due evidence.

ALTER TABLE public.phase_state
    ADD COLUMN phase_opened_at BIGINT;

ALTER TABLE public.day_event
    ADD COLUMN open_due_at BIGINT,
    ADD COLUMN open_observed_at BIGINT,
    ADD COLUMN lock_due_at BIGINT,
    ADD COLUMN lock_observed_at BIGINT;

ALTER TABLE public.day_event
    ADD CONSTRAINT day_event_open_observation_check CHECK (
        (open_due_at IS NULL) = (open_observed_at IS NULL)
        AND (open_due_at IS NULL OR open_observed_at >= open_due_at)
    ),
    ADD CONSTRAINT day_event_lock_observation_check CHECK (
        (lock_due_at IS NULL) = (lock_observed_at IS NULL)
        AND (lock_due_at IS NULL OR lock_observed_at >= lock_due_at)
    );
