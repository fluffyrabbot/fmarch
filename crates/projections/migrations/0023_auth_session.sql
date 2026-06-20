-- 0023_auth_session.sql -- opaque browser session lookup.
--
-- The browser keeps only an opaque session token. The API stores a hash of that
-- token and derives capabilities from committed projections at the trust
-- boundary instead of accepting capability claims from the cookie.

CREATE TABLE IF NOT EXISTS auth_session (
    token_hash        TEXT PRIMARY KEY,
    principal_user_id TEXT NOT NULL,
    created_at        BIGINT NOT NULL,
    expires_at        BIGINT NOT NULL,
    revoked_at        BIGINT NULL,
    global_capabilities TEXT[] NOT NULL DEFAULT '{}'
);

ALTER TABLE auth_session
    ADD COLUMN IF NOT EXISTS global_capabilities TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS auth_session_principal_idx
    ON auth_session (principal_user_id);

CREATE INDEX IF NOT EXISTS auth_session_expiry_idx
    ON auth_session (expires_at);
