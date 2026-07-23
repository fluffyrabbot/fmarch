-- 0011_day_event_scheduler.sql — indexed schedule work and replica-safe worker state.

CREATE TABLE public.day_event_schedule_work (
    game_id UUID NOT NULL,
    next_due_at BIGINT,
    wake_seq BIGINT NOT NULL DEFAULT 0,
    updated_seq BIGINT NOT NULL,
    CONSTRAINT day_event_schedule_work_pkey PRIMARY KEY (game_id),
    CONSTRAINT day_event_schedule_work_wake_check CHECK (wake_seq >= 0),
    CONSTRAINT day_event_schedule_work_updated_check CHECK (updated_seq >= wake_seq)
);

CREATE INDEX day_event_schedule_work_due_idx
    ON public.day_event_schedule_work (next_due_at, game_id)
    WHERE next_due_at IS NOT NULL;

CREATE INDEX day_event_schedule_work_wake_idx
    ON public.day_event_schedule_work (wake_seq, game_id);

CREATE TABLE public.day_event_scheduler_state (
    game_id UUID NOT NULL,
    last_observed_wake_seq BIGINT NOT NULL DEFAULT 0,
    lease_owner UUID,
    lease_until BIGINT,
    retry_not_before BIGINT,
    last_attempt_at BIGINT,
    last_success_at BIGINT,
    last_failure_at BIGINT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    total_attempts BIGINT NOT NULL DEFAULT 0,
    total_successes BIGINT NOT NULL DEFAULT 0,
    last_error TEXT,
    CONSTRAINT day_event_scheduler_state_pkey PRIMARY KEY (game_id),
    CONSTRAINT day_event_scheduler_state_wake_check CHECK (last_observed_wake_seq >= 0),
    CONSTRAINT day_event_scheduler_state_lease_check CHECK (
        (lease_owner IS NULL) = (lease_until IS NULL)
    ),
    CONSTRAINT day_event_scheduler_state_failure_check CHECK (consecutive_failures >= 0),
    CONSTRAINT day_event_scheduler_state_attempt_check CHECK (
        total_attempts >= 0 AND total_successes >= 0 AND total_successes <= total_attempts
    )
);

CREATE INDEX day_event_scheduler_claim_idx
    ON public.day_event_scheduler_state (retry_not_before, lease_until, game_id);
