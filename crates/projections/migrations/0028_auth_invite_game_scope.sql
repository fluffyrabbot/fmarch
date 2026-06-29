-- 0028_auth_invite_game_scope.sql -- optional game scope for delegated invites.
--
-- GlobalAdmin-issued invites may stay global. Host-issued invites are authorized
-- through HostOf(game), so recording the game keeps the local identity adapter's
-- issuance boundary inspectable without changing role-surface authorization.

ALTER TABLE auth_invite
    ADD COLUMN IF NOT EXISTS game UUID NULL;

CREATE INDEX IF NOT EXISTS auth_invite_game_idx
    ON auth_invite (game)
    WHERE game IS NOT NULL;
