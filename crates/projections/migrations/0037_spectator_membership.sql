-- Explicit game-scoped read-only spectator grants. A spectator never occupies
-- a player slot, so this projection is deliberately separate from both slot
-- occupancy and private-channel membership.

CREATE TABLE IF NOT EXISTS spectator_membership (
    game_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (game_id, user_id)
);
