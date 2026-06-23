-- 0019_private_channel_member.sql -- setup private channel metadata.
--
-- Rebuildable private channel membership folded from PrivateChannelDeclared.
-- This table stores metadata only; private post bodies are decrypted from the
-- event log at the projection boundary and remain access-controlled by channel
-- membership at API read time.

CREATE TABLE IF NOT EXISTS private_channel_member (
    game_id           UUID NOT NULL,
    channel_id        TEXT NOT NULL,
    kind              TEXT NOT NULL,
    slot_id           TEXT NOT NULL,
    role_key          TEXT NOT NULL,
    reveals_alignment TEXT NOT NULL,
    source            TEXT NOT NULL,
    PRIMARY KEY (game_id, channel_id, slot_id)
);

CREATE INDEX IF NOT EXISTS private_channel_member_slot_idx
    ON private_channel_member (game_id, slot_id, channel_id);
