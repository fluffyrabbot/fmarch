-- Reason-derived member inbox (RFC 0007, slice 1: inbox generalisation, no
-- product change). The inbox becomes principal-keyed with an explicit reason
-- instead of subscription-keyed: a mention has no subscription behind it, so
-- every row must stand without one. Watch fan-out remains the only writer in
-- this slice; 'mention' rows arrive with the mention write model.

CREATE TABLE public.member_inbox_item (
    principal_id uuid NOT NULL,
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    reason text NOT NULL,
    occurred_at bigint NOT NULL,
    CONSTRAINT member_inbox_item_reason_check CHECK ((reason = ANY (ARRAY['watch'::text, 'mention'::text])))
);

ALTER TABLE ONLY public.member_inbox_item
    ADD CONSTRAINT member_inbox_item_pkey PRIMARY KEY (principal_id, surface_id, source_seq, reason);

CREATE INDEX member_inbox_item_page_idx ON public.member_inbox_item USING btree (principal_id, source_seq DESC);

CREATE TABLE public.member_inbox_cursor (
    principal_id uuid NOT NULL,
    read_through_seq bigint DEFAULT 0 NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT member_inbox_cursor_read_through_seq_check CHECK ((read_through_seq >= 0))
);

ALTER TABLE ONLY public.member_inbox_cursor
    ADD CONSTRAINT member_inbox_cursor_pkey PRIMARY KEY (principal_id);

-- Carry watch history across the rebaseline. A principal holds at most one
-- subscription stream per surface, so each backfilled row is unique; the
-- conflict guard only absorbs concurrent fan-out replays.
INSERT INTO public.member_inbox_item (principal_id, surface_id, source_seq, reason, occurred_at)
SELECT subscription.principal_id, item.surface_id, item.source_seq, 'watch', item.occurred_at
FROM public.public_inbox_item AS item
JOIN public.public_watch AS subscription
  ON subscription.subscription_id = item.subscription_id
ON CONFLICT (principal_id, surface_id, source_seq, reason) DO NOTHING;

DROP TABLE public.public_inbox_item;
