-- 0012_host_phase_control.sql -- host/admin prompt phase-control audit rows.
--
-- Host prompt decisions such as revote and skip-next-day append PhaseAdvanced
-- events with provenance. This projection makes those decisions inspectable
-- without scanning raw event JSON.

CREATE TABLE IF NOT EXISTS host_phase_control (
    game_id          UUID    NOT NULL,
    source_seq       BIGINT  NOT NULL,
    stream_seq       BIGINT  NOT NULL,
    prompt_id        TEXT    NOT NULL,
    source_phase_id  TEXT    NOT NULL,
    target_phase_id  TEXT    NOT NULL,
    reason           TEXT    NOT NULL,
    skipped_phase_id TEXT,
    occurred_at      BIGINT  NOT NULL,
    PRIMARY KEY (game_id, prompt_id, stream_seq)
);

CREATE INDEX IF NOT EXISTS host_phase_control_phase_idx
    ON host_phase_control (game_id, source_phase_id, target_phase_id, stream_seq);
