-- 0043_auth_delivery_gateway_outcome.sql -- provider-neutral delivery outcomes.
--
-- The durable intent remains redacted. Provider selection and typed outcomes are
-- saved separately from raw credentials so a real provider can replace the local
-- deterministic gateway without changing invite or recovery role surfaces.

ALTER TABLE auth_delivery_intent
    ADD COLUMN provider_id TEXT,
    ADD COLUMN outcome_kind TEXT,
    ADD COLUMN outcome_code TEXT;

UPDATE auth_delivery_intent
SET provider_id = 'local-deterministic',
    outcome_kind = CASE status
        WHEN 'queued' THEN 'queued'
        WHEN 'delivered' THEN 'delivered'
        WHEN 'retryable_failed' THEN 'retryable_failure'
    END,
    outcome_code = CASE
        WHEN status = 'retryable_failed' THEN last_error
        ELSE NULL
    END;

ALTER TABLE auth_delivery_intent
    ALTER COLUMN provider_id SET NOT NULL,
    ALTER COLUMN outcome_kind SET NOT NULL,
    DROP CONSTRAINT auth_delivery_intent_status_check,
    DROP CONSTRAINT auth_delivery_intent_check,
    ADD CONSTRAINT auth_delivery_intent_status_check
        CHECK (status IN ('queued', 'delivered', 'retryable_failed', 'permanent_failed')),
    ADD CONSTRAINT auth_delivery_intent_outcome_kind_check
        CHECK (outcome_kind IN ('queued', 'delivered', 'retryable_failure', 'permanent_failure')),
    ADD CONSTRAINT auth_delivery_intent_provider_id_check
        CHECK (length(trim(provider_id)) > 0),
    ADD CONSTRAINT auth_delivery_intent_delivery_shape_check
        CHECK (
            (status = 'queued' AND outcome_kind = 'queued' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL AND outcome_code IS NULL)
            OR (status = 'delivered' AND outcome_kind = 'delivered' AND next_attempt_at IS NULL AND delivered_at IS NOT NULL AND outcome_code IS NULL)
            OR (status = 'retryable_failed' AND outcome_kind = 'retryable_failure' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL AND outcome_code IS NOT NULL)
            OR (status = 'permanent_failed' AND outcome_kind = 'permanent_failure' AND next_attempt_at IS NULL AND delivered_at IS NULL AND outcome_code IS NOT NULL)
        );
