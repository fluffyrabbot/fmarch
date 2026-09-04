-- Game slot mentions (RFC 0007, slice 4: game slot mentions).
--
-- Two facts land here. The decided slot list is denormalized onto the post row
-- beside the existing quotations column so a game thread emits mention chrome
-- without a join; on a private channel the list travels inside body_private
-- instead, exactly as quotations already do, so a private room's membership
-- never reaches a column readable from main.
--
-- Delivery is slot-addressed. RFC 0007 §7 asks for the phase-scoped,
-- occupancy-at-read-time player_notification family, and this table is that
-- family rather than that table: player_notification is keyed by the resolution
-- coordinates (phase_id, event_index) and requires a phase, so it can neither
-- distinguish two mentions of one slot in one phase nor hold a mention made in
-- setup discussion, which is deliberately outside a phase. The addressing
-- property the RFC argues for is preserved exactly: the row names a seat, never
-- a principal, and the player rail resolves who is sitting there at read time,
-- so replacement transfers a pending mention with the seat for free.

ALTER TABLE public.thread_view
    ADD COLUMN mentions jsonb DEFAULT '[]'::jsonb NOT NULL;

CREATE TABLE public.slot_mention_notification (
    game_id uuid NOT NULL,
    audience_slot text NOT NULL,
    source_seq bigint NOT NULL,
    channel_id text NOT NULL,
    phase_id text,
    occurred_at bigint NOT NULL
);

ALTER TABLE ONLY public.slot_mention_notification
    ADD CONSTRAINT slot_mention_notification_pkey PRIMARY KEY (game_id, audience_slot, source_seq);

CREATE INDEX slot_mention_notification_audience_idx ON public.slot_mention_notification USING btree (game_id, audience_slot, source_seq DESC);
