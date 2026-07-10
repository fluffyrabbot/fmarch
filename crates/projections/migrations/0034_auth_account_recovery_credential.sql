-- 0034_auth_account_recovery_credential.sql -- single-use account recovery.
--
-- Recovery credentials are independent of game invites. Only a SHA-256 token
-- hash is stored; the raw high-entropy credential is returned once at issuance.

CREATE TABLE auth_account_recovery_credential (
    recovery_id UUID PRIMARY KEY,
    account_id  TEXT NOT NULL REFERENCES auth_account (account_id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  BIGINT NOT NULL,
    expires_at  BIGINT NOT NULL,
    used_at     BIGINT NULL,
    revoked_at  BIGINT NULL,
    CHECK (expires_at > created_at),
    CHECK (used_at IS NULL OR revoked_at IS NULL)
);

CREATE INDEX auth_account_recovery_account_idx
    ON auth_account_recovery_credential (account_id, created_at DESC);

CREATE INDEX auth_account_recovery_active_idx
    ON auth_account_recovery_credential (expires_at)
    WHERE used_at IS NULL AND revoked_at IS NULL;
