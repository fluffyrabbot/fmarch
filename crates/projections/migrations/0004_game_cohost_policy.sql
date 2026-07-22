-- Per-game cohost permission denylist (doc 14 / 06).
-- Empty denied list = full co-GM mutator parity with host for game-run acts.
-- Primary host is never subject to this list; structural acts stay HostOf-only.

CREATE TABLE public.game_cohost_policy (
    game_id uuid PRIMARY KEY,
    denied text[] NOT NULL DEFAULT '{}',
    source_seq bigint NOT NULL
);
