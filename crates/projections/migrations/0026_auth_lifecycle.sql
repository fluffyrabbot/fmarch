-- 0026_auth_lifecycle.sql -- identity lifecycle controls.
--
-- Invite revocation is separate from redemption so local and future hosted
-- identity flows can distinguish "used" from "invalidated before use".

ALTER TABLE auth_invite
    ADD COLUMN IF NOT EXISTS revoked_at BIGINT NULL;

CREATE INDEX IF NOT EXISTS auth_invite_revocation_idx
    ON auth_invite (revoked_at)
    WHERE revoked_at IS NOT NULL;
