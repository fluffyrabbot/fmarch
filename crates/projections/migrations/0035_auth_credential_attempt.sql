-- 0035_auth_credential_attempt.sql -- shared public credential throttling.
--
-- Scope hashes combine the normalized account id with either the conservative
-- direct-source bucket or an explicitly trusted edge-provided source identity.
-- No raw account id, source address, password, invite, or recovery credential
-- is stored in this policy table.

CREATE TABLE auth_credential_attempt (
    scope_hash        TEXT PRIMARY KEY,
    window_started_at BIGINT NOT NULL,
    failure_count     INTEGER NOT NULL,
    blocked_until     BIGINT NULL,
    updated_at        BIGINT NOT NULL,
    CHECK (failure_count > 0),
    CHECK (blocked_until IS NULL OR blocked_until >= updated_at)
);

CREATE INDEX auth_credential_attempt_updated_idx
    ON auth_credential_attempt (updated_at);

CREATE INDEX auth_credential_attempt_blocked_idx
    ON auth_credential_attempt (blocked_until)
    WHERE blocked_until IS NOT NULL;
