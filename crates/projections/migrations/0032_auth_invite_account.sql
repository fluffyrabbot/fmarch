-- 0032_auth_invite_account.sql -- bind every invite to an account credential.
--
-- Pre-account invites are ephemeral local credentials, so discard any that
-- cannot be upgraded instead of preserving an unauthenticated redemption path.

ALTER TABLE auth_invite
    ADD COLUMN IF NOT EXISTS account_id TEXT NULL
        REFERENCES auth_account (account_id);

DELETE FROM auth_invite
WHERE account_id IS NULL;

ALTER TABLE auth_invite
    ALTER COLUMN account_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS auth_invite_account_idx
    ON auth_invite (account_id);
