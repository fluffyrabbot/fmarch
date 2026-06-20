-- 0019_private_channel_member.sql -- setup private channel metadata.
--
-- Rebuildable private channel membership folded from PrivateChannelDeclared.
-- This table stores metadata only; private post bodies remain outside the
-- channel-scoped thread_view projection.

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
