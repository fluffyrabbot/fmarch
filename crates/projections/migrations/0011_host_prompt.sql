-- 0011_host_prompt.sql -- host/admin prompts emitted by the resolution engine.
--
-- These are durable operational prompts, not UI-only state. Engine policies
-- such as Beloved Princess write one row per prompt so hosts/admin tools can
-- inspect and rebuild pending intervention points from the event log.

CREATE TABLE IF NOT EXISTS host_prompt (
    game_id      UUID    NOT NULL,
    phase_id     TEXT    NOT NULL,
    event_index  INTEGER NOT NULL,
    prompt_id    TEXT    NOT NULL,
    kind         TEXT    NOT NULL,
    subject_slot TEXT,
    reason       TEXT    NOT NULL,
    phase_kind   TEXT    NOT NULL,
    phase_number INTEGER NOT NULL,
    metadata     JSONB   NOT NULL DEFAULT '{}'::jsonb,
    status       TEXT    NOT NULL DEFAULT 'pending',
    decision     JSONB,
    resolved_by  TEXT,
    resolved_at  BIGINT,
    PRIMARY KEY (game_id, prompt_id)
);

CREATE INDEX IF NOT EXISTS host_prompt_phase_idx
    ON host_prompt (game_id, phase_id, event_index);
