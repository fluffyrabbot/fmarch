-- 0038_auth_registration_attempt.sql -- bounded public account registration.
--
-- Registration quota is intentionally separate from credential failures: a
-- successful signup also consumes capacity. Scope hashes contain only a
-- normalized trusted source bucket and never a raw account identifier.

CREATE TABLE auth_registration_attempt (
    scope_hash        TEXT PRIMARY KEY,
    window_started_at BIGINT NOT NULL,
    attempt_count     INTEGER NOT NULL,
    blocked_until     BIGINT NULL,
    updated_at        BIGINT NOT NULL,
    CHECK (attempt_count > 0),
    CHECK (blocked_until IS NULL OR blocked_until >= updated_at)
);

CREATE INDEX auth_registration_attempt_updated_idx
    ON auth_registration_attempt (updated_at);

CREATE INDEX auth_registration_attempt_blocked_idx
    ON auth_registration_attempt (blocked_until)
    WHERE blocked_until IS NOT NULL;
