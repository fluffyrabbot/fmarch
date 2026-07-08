-- 0031_game_result.sql -- terminal engine win result.
--
-- Folded only from the trailing engine WinReached inside ResolutionApplied so
-- clients can read the canonical winner without replaying the event log. One
-- row per game; rebuild converges on the same terminal fact.

CREATE TABLE IF NOT EXISTS game_result (
    game_id     UUID PRIMARY KEY,
    winner      TEXT NOT NULL,
    reason      TEXT NOT NULL,
    metadata    JSONB NOT NULL,
    phase_id    TEXT NOT NULL,
    source_seq  BIGINT NOT NULL,
    event_index INTEGER NOT NULL
);
