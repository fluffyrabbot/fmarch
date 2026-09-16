-- A post is the destination; the event first delivering a reason orders attention.
-- Edits can introduce a new mention long after the post's creation sequence.
ALTER TABLE public.member_inbox_item ADD COLUMN delivery_seq bigint;

UPDATE public.member_inbox_item SET delivery_seq = source_seq;

-- Recover the first mention's event position from retained revision history.
-- Revision N began when revision N-1 was superseded. Keeping the earliest
-- occurrence also preserves remove/re-add deduplication across the upgrade.
WITH versions AS (
    SELECT source_seq, revision, mentions, superseded_seq
    FROM public.discussion_post_revision
    UNION ALL
    SELECT source_seq, revision, mentions, NULL::bigint
    FROM public.discussion_post
), delivered_versions AS (
    SELECT source_seq, mentions,
           LAG(superseded_seq, 1, source_seq)
               OVER (PARTITION BY source_seq ORDER BY revision) AS delivery_seq
    FROM versions
), first_mentions AS (
    SELECT version.source_seq, profile.active_principal_id AS principal_id,
           MIN(version.delivery_seq) AS delivery_seq
    FROM delivered_versions AS version
    CROSS JOIN LATERAL jsonb_array_elements(version.mentions) AS mention
    JOIN public.member_profile AS profile
      ON profile.profile_id = (mention->>'profile_id')::uuid
    GROUP BY version.source_seq, profile.active_principal_id
)
UPDATE public.member_inbox_item AS item
SET delivery_seq = first_mentions.delivery_seq
FROM first_mentions
WHERE item.reason = 'mention'
  AND item.source_seq = first_mentions.source_seq
  AND item.principal_id = first_mentions.principal_id;

ALTER TABLE public.member_inbox_item
    ALTER COLUMN delivery_seq SET NOT NULL,
    ADD CONSTRAINT member_inbox_item_delivery_seq_check
        CHECK (delivery_seq >= source_seq AND source_seq > 0);

DROP INDEX public.member_inbox_item_page_idx;
CREATE INDEX member_inbox_item_page_idx
    ON public.member_inbox_item USING btree (principal_id, delivery_seq DESC);
