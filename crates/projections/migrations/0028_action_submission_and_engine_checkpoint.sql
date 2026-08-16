-- 0028_action_submission_and_engine_checkpoint.sql — current action submissions and a discardable official-resolve checkpoint.

-- Withdraw/capacity checks read action_submission instead of decrypting the
-- sealed tape. Official ResolvePhase may persist a StateSnapshot that rebuild
-- deletes; instant and host-prompt envelopes stay in the stream tail.

CREATE TABLE public.action_submission (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    actor_slot text NOT NULL,
    action_id text NOT NULL,
    template_id text NOT NULL,
    grant_id text,
    targets jsonb NOT NULL DEFAULT '[]'::jsonb,
    instant_resolved boolean NOT NULL DEFAULT false
);

ALTER TABLE ONLY public.action_submission
    ADD CONSTRAINT action_submission_pkey PRIMARY KEY (game_id, action_id);

CREATE INDEX action_submission_actor_phase_idx
    ON public.action_submission (game_id, phase_id, actor_slot);

CREATE TABLE public.engine_snapshot_checkpoint (
    game_id uuid NOT NULL,
    stream_seq bigint NOT NULL,
    result_version smallint NOT NULL,
    snapshot jsonb NOT NULL,
    last_resolution jsonb
);

ALTER TABLE ONLY public.engine_snapshot_checkpoint
    ADD CONSTRAINT engine_snapshot_checkpoint_pkey PRIMARY KEY (game_id);
