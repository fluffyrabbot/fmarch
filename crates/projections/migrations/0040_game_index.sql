-- 0040_game_index.sql -- public, capability-safe game discovery read model.
--
-- Game setup remains absent from the public query until GameStarted. The index
-- carries only public lifecycle facts: game id, pack, phase, status, and event
-- sequence positions. It deliberately excludes hosts, seats, roles, private channels, and
-- all command or audit data.

CREATE TABLE game_index (
    game_id      UUID PRIMARY KEY,
    pack         TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('setup', 'active', 'completed')),
    phase_id     TEXT NULL,
    created_seq   BIGINT NOT NULL,
    started_seq   BIGINT NULL,
    completed_seq BIGINT NULL,
    updated_seq   BIGINT NOT NULL
);

CREATE INDEX game_index_public_page_idx
    ON game_index (updated_seq DESC, game_id DESC)
    WHERE status IN ('active', 'completed');
