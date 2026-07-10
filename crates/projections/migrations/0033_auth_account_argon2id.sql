-- 0033_auth_account_argon2id.sql -- cut local accounts to PHC credentials.
--
-- This pre-1.0 workspace has no durable account population. Removing the
-- separate salt column makes password_hash the single credential record; it
-- now contains a self-describing Argon2id PHC string with its own salt and
-- parameters. Existing local sessions are discarded with the obsolete
-- credentials so no pre-Argon login remains authorized.

TRUNCATE auth_account, auth_session CASCADE;

ALTER TABLE auth_account
    DROP COLUMN password_salt;
