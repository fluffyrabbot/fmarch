-- 0045_auth_delivery_credential_envelope.sql -- sealed provider payload.
--
-- The delivery worker must be able to hand a one-time credential to a real provider,
-- but the raw value must never be queryable in Postgres or appear in audit metadata.

ALTER TABLE auth_delivery_intent
    ADD COLUMN credential_envelope JSONB;

UPDATE auth_delivery_intent
SET status = 'permanent_failed',
    outcome_kind = 'permanent_failure',
    outcome_code = 'credential_unavailable',
    next_attempt_at = NULL,
    delivered_at = NULL,
    last_error = 'credential_unavailable',
    updated_at = EXTRACT(EPOCH FROM NOW())::BIGINT
WHERE credential_envelope IS NULL
  AND status IN ('queued', 'retryable_failed');

ALTER TABLE auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_credential_envelope_check
        CHECK (credential_envelope IS NULL OR jsonb_typeof(credential_envelope) = 'object');
