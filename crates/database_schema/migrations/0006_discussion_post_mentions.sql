-- Community mention edges (RFC 0007, slice 2: community mention write model).
-- The decided mention list is denormalized onto the post row beside the
-- existing quotations column so the thread page emits mention chrome without
-- a join. Every existing row backfills to the empty list, which is also how
-- pre-mention events upcast. Delivery lives in member_inbox_item, not here:
-- this column is the edge, the inbox row is the link.

ALTER TABLE public.discussion_post
    ADD COLUMN mentions jsonb DEFAULT '[]'::jsonb NOT NULL;
