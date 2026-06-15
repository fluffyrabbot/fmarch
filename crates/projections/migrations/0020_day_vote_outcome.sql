-- 0020_day_vote_outcome.sql -- official engine day vote outcomes.
--
-- Running votecount remains a mutable current-ballot projection. This table is
-- folded only from engine-emitted DayVoteOutcome rows inside ResolutionApplied,
-- so clients can read the canonical pack-policy result without recomputing it
-- from vote_ballot.

CREATE TABLE IF NOT EXISTS day_vote_outcome (
    game_id      UUID NOT NULL,
    phase_id     TEXT NOT NULL,
    source_seq   BIGINT NOT NULL,
    event_index  INTEGER NOT NULL,
    status       TEXT NOT NULL,
    winner_slot  TEXT NULL,
    contenders   JSONB NOT NULL,
    tallies      JSONB NOT NULL,
    votes        JSONB NOT NULL,
    weights      JSONB NOT NULL,
    majority     DOUBLE PRECISION NULL,
    thresholds   JSONB NOT NULL,
    total_weight DOUBLE PRECISION NOT NULL,
    tiebreak     TEXT NULL,
    reason       TEXT NULL,
    PRIMARY KEY (game_id, phase_id)
);

CREATE INDEX IF NOT EXISTS day_vote_outcome_source_idx
    ON day_vote_outcome (game_id, source_seq, event_index);
