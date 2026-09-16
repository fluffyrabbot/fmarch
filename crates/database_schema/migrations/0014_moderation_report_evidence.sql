-- Reports capture the complete public revision they admitted. Historical
-- reports have no such fact; mark that absence rather than copying today's body.
ALTER TABLE public.moderation_report
    ADD COLUMN evidence jsonb DEFAULT '{"status":"not_captured"}'::jsonb NOT NULL;

-- Only migration/replay may represent historical absence. Current producers
-- must explicitly supply Captured evidence; an omitted field never defaults.
ALTER TABLE public.moderation_report ALTER COLUMN evidence DROP DEFAULT;
ALTER TABLE public.moderation_report
    ADD CONSTRAINT moderation_report_evidence_shape CHECK (
        jsonb_typeof(evidence) = 'object'
        AND evidence ? 'status'
        AND (
            evidence = '{"status":"not_captured"}'::jsonb
            OR (
                evidence ->> 'status' = 'captured'
                AND evidence ? 'content'
                AND jsonb_typeof(evidence -> 'content') = 'object'
            )
        )
    );
