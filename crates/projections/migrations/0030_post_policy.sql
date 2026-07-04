-- 0030_post_policy.sql -- host-toggleable channel post policy.

CREATE TABLE IF NOT EXISTS post_policy (
    game_id UUID NOT NULL,
    channel_id TEXT NOT NULL,
    allow_media_only BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (game_id, channel_id)
);
