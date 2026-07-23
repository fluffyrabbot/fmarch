-- 0008_day_events.sql — first-class mash DayEvent state and participation.

CREATE TABLE public.day_event (
    game_id UUID NOT NULL,
    event_id TEXT NOT NULL,
    definition JSONB NOT NULL,
    state TEXT NOT NULL,
    phase_id TEXT,
    opened_at BIGINT,
    locked_at BIGINT,
    cancelled_reason TEXT,
    decision JSONB,
    winner_slots JSONB NOT NULL DEFAULT '[]'::jsonb,
    reward_keys_applied JSONB NOT NULL DEFAULT '[]'::jsonb,
    scheduled_seq BIGINT NOT NULL,
    updated_seq BIGINT NOT NULL,
    CONSTRAINT day_event_pkey PRIMARY KEY (game_id, event_id),
    CONSTRAINT day_event_state_check CHECK (
        state IN ('scheduled', 'open', 'locked', 'resolved', 'cancelled')
    ),
    CONSTRAINT day_event_definition_check CHECK (jsonb_typeof(definition) = 'object'),
    CONSTRAINT day_event_winner_slots_check CHECK (jsonb_typeof(winner_slots) = 'array'),
    CONSTRAINT day_event_reward_keys_check CHECK (jsonb_typeof(reward_keys_applied) = 'array')
);

CREATE INDEX day_event_state_idx
    ON public.day_event (game_id, state, event_id);

CREATE TABLE public.day_event_participation (
    game_id UUID NOT NULL,
    event_id TEXT NOT NULL,
    actor_slot TEXT NOT NULL,
    payload JSONB NOT NULL,
    phase_id TEXT NOT NULL,
    submitted_seq BIGINT NOT NULL,
    CONSTRAINT day_event_participation_pkey PRIMARY KEY (game_id, event_id, actor_slot),
    CONSTRAINT day_event_participation_event_fkey
        FOREIGN KEY (game_id, event_id)
        REFERENCES public.day_event(game_id, event_id)
        ON DELETE CASCADE,
    CONSTRAINT day_event_participation_payload_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX day_event_participation_page_idx
    ON public.day_event_participation (game_id, event_id, submitted_seq, actor_slot);
