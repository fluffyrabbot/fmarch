-- 0029_auth_account.sql -- local account credential adapter.
--
-- Accounts are an identity credential boundary over the existing auth_session
-- model. Successful account login creates the same opaque session rows used by
-- invite redemption and session grants; role-surface authorization still flows
-- through committed game projections and auth_session global capabilities.

CREATE TABLE IF NOT EXISTS auth_account (
    account_id          TEXT PRIMARY KEY,
    principal_user_id   TEXT NOT NULL,
    password_salt       TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    created_at          BIGINT NOT NULL,
    disabled_at         BIGINT NULL,
    global_capabilities TEXT[] NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS auth_account_principal_idx
    ON auth_account (principal_user_id);

CREATE INDEX IF NOT EXISTS auth_account_disabled_idx
    ON auth_account (disabled_at)
    WHERE disabled_at IS NOT NULL;
