-- 0025_auth_invite.sql -- single-use invite redemption.
--
-- Invites are an identity issuance path, not a capability model. Redeeming an
-- invite creates an opaque auth_session row; role-surface authorization still
-- flows through committed game projections and auth_session global capabilities.

CREATE TABLE IF NOT EXISTS auth_invite (
    token_hash                  TEXT PRIMARY KEY,
    principal_user_id           TEXT NOT NULL,
    created_at                  BIGINT NOT NULL,
    expires_at                  BIGINT NOT NULL,
    redeemed_at                 BIGINT NULL,
    redeemed_session_token_hash TEXT NULL,
    global_capabilities         TEXT[] NOT NULL DEFAULT '{}',
    invited_by_user_id          TEXT NOT NULL
);

ALTER TABLE auth_invite
    ADD COLUMN IF NOT EXISTS redeemed_session_token_hash TEXT NULL;

CREATE INDEX IF NOT EXISTS auth_invite_principal_idx
    ON auth_invite (principal_user_id);

CREATE INDEX IF NOT EXISTS auth_invite_expiry_idx
    ON auth_invite (expires_at)
    WHERE redeemed_at IS NULL;
