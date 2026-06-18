-- 0022_action_grant_option.sql -- expose selected grant_options.
--
-- Stores the explicit selected option for Grant actions that declare
-- `grant_options`; plain single-payload grants leave this NULL.

ALTER TABLE action_grant
    ADD COLUMN IF NOT EXISTS grant_option TEXT;
