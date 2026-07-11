-- 0044_auth_delivery_outbox_worker.sql -- lease-claimed identity delivery outbox.
--
-- Provider calls happen only after an intent is committed. The lease makes concurrent
-- workers safe, and the durable provider receipt gives providers one stable idempotency key.

ALTER TABLE auth_delivery_intent
    ADD COLUMN provider_receipt_id TEXT,
    ADD COLUMN claim_token UUID,
    ADD COLUMN claim_expires_at BIGINT;

UPDATE auth_delivery_intent
SET provider_receipt_id = CONCAT('legacy-', provider_id, '-', delivery_id)
WHERE status = 'delivered';

ALTER TABLE auth_delivery_intent
    DROP CONSTRAINT auth_delivery_intent_status_check,
    DROP CONSTRAINT auth_delivery_intent_outcome_kind_check,
    DROP CONSTRAINT auth_delivery_intent_delivery_shape_check,
    ADD CONSTRAINT auth_delivery_intent_status_check
        CHECK (status IN ('queued', 'processing', 'delivered', 'retryable_failed', 'permanent_failed')),
    ADD CONSTRAINT auth_delivery_intent_outcome_kind_check
        CHECK (outcome_kind IN ('queued', 'processing', 'delivered', 'retryable_failure', 'permanent_failure')),
    ADD CONSTRAINT auth_delivery_intent_delivery_shape_check
        CHECK (
            (status = 'queued' AND outcome_kind = 'queued' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL AND outcome_code IS NULL AND provider_receipt_id IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
            OR (status = 'processing' AND outcome_kind = 'processing' AND next_attempt_at IS NULL AND delivered_at IS NULL AND outcome_code IS NULL AND provider_receipt_id IS NULL AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL)
            OR (status = 'delivered' AND outcome_kind = 'delivered' AND next_attempt_at IS NULL AND delivered_at IS NOT NULL AND outcome_code IS NULL AND provider_receipt_id IS NOT NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
            OR (status = 'retryable_failed' AND outcome_kind = 'retryable_failure' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL AND outcome_code IS NOT NULL AND provider_receipt_id IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
            OR (status = 'permanent_failed' AND outcome_kind = 'permanent_failure' AND next_attempt_at IS NULL AND delivered_at IS NULL AND outcome_code IS NOT NULL AND provider_receipt_id IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL)
        );

CREATE INDEX auth_delivery_intent_claim_idx
    ON auth_delivery_intent (claim_expires_at)
    WHERE status = 'processing';
