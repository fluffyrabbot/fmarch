-- 0008_command_receipt.sql -- durable network command idempotency.
--
-- The WebSocket/HTTP envelope id is per-connection correlation only. A
-- command_id is durable across reconnects and retries; once a command commits,
-- resubmitting the same (principal, command_id) returns the original ack instead
-- of appending a duplicate event.

CREATE TABLE IF NOT EXISTS command_receipt (
    principal_user_id TEXT NOT NULL,
    command_id        UUID NOT NULL,
    stream_id         UUID NOT NULL,
    stream_seqs       BIGINT[] NOT NULL,
    PRIMARY KEY (principal_user_id, command_id)
);

CREATE INDEX IF NOT EXISTS command_receipt_stream_idx
    ON command_receipt (stream_id);
