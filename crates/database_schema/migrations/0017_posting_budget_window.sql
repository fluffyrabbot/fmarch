-- Per-principal posting budgets. One fixed window per (principal, budget);
-- the row is admission bookkeeping, not an event, and carries no content.
-- A charge is taken in the same transaction as the append it admits, so a
-- rejected or rolled-back write never consumes budget.
CREATE TABLE public.posting_budget_window (
    principal_id uuid NOT NULL,
    budget text NOT NULL,
    window_started_at bigint NOT NULL,
    used integer NOT NULL,
    updated_at bigint NOT NULL,
    CONSTRAINT posting_budget_window_pkey PRIMARY KEY (principal_id, budget),
    CONSTRAINT posting_budget_window_budget_check CHECK (budget IN (
        'post_minute', 'post_hour', 'topic_hour', 'edit_ten_minutes',
        'report_hour', 'mention_ten_minutes'
    )),
    CONSTRAINT posting_budget_window_used_check CHECK (used > 0),
    CONSTRAINT posting_budget_window_clock_check
        CHECK (window_started_at > 0 AND updated_at >= window_started_at)
);

CREATE INDEX posting_budget_window_updated_at_idx
    ON public.posting_budget_window (updated_at);
