-- 0039_auth_delivery_intent.sql -- local durable identity delivery adapter.
--
-- Credential issuance persists a redacted intent before the deterministic local
-- adapter marks it delivered. Raw invite and recovery credentials never enter
-- this table; credential_hash is the existing SHA-256 boundary.

CREATE TABLE auth_delivery_intent (
    delivery_id      UUID PRIMARY KEY,
    delivery_kind    TEXT NOT NULL CHECK (delivery_kind IN ('invite', 'recovery')),
    account_id       TEXT NOT NULL REFERENCES auth_account (account_id) ON DELETE CASCADE,
    principal_user_id TEXT NOT NULL,
    credential_hash  TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL CHECK (status IN ('queued', 'delivered', 'retryable_failed')),
    attempt_count    INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at  BIGINT NULL,
    delivered_at     BIGINT NULL,
    last_error       TEXT NULL,
    created_at       BIGINT NOT NULL,
    updated_at       BIGINT NOT NULL,
    CHECK (
        (status = 'queued' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL)
        OR (status = 'delivered' AND next_attempt_at IS NULL AND delivered_at IS NOT NULL)
        OR (status = 'retryable_failed' AND next_attempt_at IS NOT NULL AND delivered_at IS NULL)
    )
);

CREATE INDEX auth_delivery_intent_account_idx
    ON auth_delivery_intent (account_id, created_at DESC);

CREATE INDEX auth_delivery_intent_retry_idx
    ON auth_delivery_intent (next_attempt_at)
    WHERE status IN ('queued', 'retryable_failed');
