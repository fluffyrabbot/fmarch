-- Mention-abuse report reason (RFC 0007, slice 3: community read contract and
-- surface). Mentions are a push channel, so mass-addressing must be reportable
-- rather than only rate-limited. The reason family is a closed CHECK set, so
-- admitting the value is a schema change: widen the constraint, leave every
-- existing report untouched.

ALTER TABLE public.moderation_report
    DROP CONSTRAINT moderation_report_reason_family_check;

ALTER TABLE public.moderation_report
    ADD CONSTRAINT moderation_report_reason_family_check CHECK ((reason_family = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'sexual_content'::text, 'self_harm'::text, 'mention_abuse'::text, 'other'::text])));
