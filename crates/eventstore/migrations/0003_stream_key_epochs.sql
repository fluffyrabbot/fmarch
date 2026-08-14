-- 0003_stream_key_epochs.sql -- random per-stream DEKs with explicit epochs.
--
-- Greenfield cut: existing v2 rows were encrypted directly by the runtime KEK
-- and cannot be upgraded without decrypting history. Refuse that ambiguous
-- transition and replace the row-level KEK id with an immutable DEK epoch.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM events) THEN
        RAISE EXCEPTION 'stream-key epoch migration requires an empty greenfield event store';
    END IF;
END
$$;

CREATE TABLE event_stream_keys (
    stream_id    UUID     NOT NULL,
    key_epoch    BIGINT   NOT NULL CHECK (key_epoch > 0),
    wrap_version SMALLINT NOT NULL CHECK (wrap_version = 1),
    wrap_kid     TEXT     NOT NULL CHECK (
        octet_length(wrap_kid) BETWEEN 1 AND 128
        AND wrap_kid = btrim(wrap_kid)
    ),
    wrap_nonce   BYTEA    NOT NULL CHECK (octet_length(wrap_nonce) = 24),
    wrapped_dek  BYTEA    NOT NULL CHECK (octet_length(wrapped_dek) = 48),
    PRIMARY KEY (stream_id, key_epoch)
);

CREATE TABLE event_stream_key_state (
    stream_id   UUID   PRIMARY KEY,
    active_epoch BIGINT NOT NULL CHECK (active_epoch > 0),
    FOREIGN KEY (stream_id, active_epoch)
        REFERENCES event_stream_keys (stream_id, key_epoch)
        DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX event_stream_keys_wrap_kid_idx
    ON event_stream_keys (wrap_kid, stream_id, key_epoch);

-- Every persisted direct runtime-KEK envelope first installs an authenticated
-- sentinel in the same transaction. This bounded KID catalog makes readiness
-- independent of private-projection and delivery-intent row counts.
CREATE TABLE event_direct_key_sentinel (
    kid                 TEXT     PRIMARY KEY,
    sentinel_version    SMALLINT NOT NULL,
    sentinel_nonce      BYTEA    NOT NULL,
    sentinel_ciphertext BYTEA    NOT NULL,
    CONSTRAINT event_direct_key_sentinel_kid_check CHECK (
        octet_length(kid) BETWEEN 1 AND 128
        AND kid = btrim(kid)
    ),
    CONSTRAINT event_direct_key_sentinel_version_check
        CHECK (sentinel_version = 1),
    CONSTRAINT event_direct_key_sentinel_nonce_check
        CHECK (octet_length(sentinel_nonce) = 24),
    CONSTRAINT event_direct_key_sentinel_ciphertext_check
        CHECK (octet_length(sentinel_ciphertext) = 56)
);

CREATE FUNCTION event_direct_key_sentinel_immutable() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'event direct-key sentinel is immutable: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_direct_key_sentinel_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON event_direct_key_sentinel
    FOR EACH STATEMENT EXECUTE FUNCTION event_direct_key_sentinel_immutable();

-- A KEK rewrap may replace only the wrapping envelope. The DEK identity and
-- epoch are permanent, and key rows cannot be removed while history exists.
CREATE OR REPLACE FUNCTION event_stream_keys_guard_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'event stream keys are append-only: deletion and truncation are forbidden';
    END IF;
    IF NEW.stream_id <> OLD.stream_id OR NEW.key_epoch <> OLD.key_epoch THEN
        RAISE EXCEPTION 'event stream key identity is immutable';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_keys_guard
    BEFORE UPDATE OR DELETE ON event_stream_keys
    FOR EACH ROW EXECUTE FUNCTION event_stream_keys_guard_mutation();

CREATE TRIGGER event_stream_keys_truncate_guard
    BEFORE TRUNCATE ON event_stream_keys
    FOR EACH STATEMENT EXECUTE FUNCTION event_stream_keys_guard_mutation();

CREATE OR REPLACE FUNCTION event_stream_key_state_monotonic() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'event stream key state cannot be removed or truncated';
    END IF;
    IF NEW.stream_id <> OLD.stream_id OR NEW.active_epoch <= OLD.active_epoch THEN
        RAISE EXCEPTION 'active event stream key epoch must increase monotonically';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_key_state_guard
    BEFORE UPDATE OR DELETE ON event_stream_key_state
    FOR EACH ROW EXECUTE FUNCTION event_stream_key_state_monotonic();

CREATE TRIGGER event_stream_key_state_truncate_guard
    BEFORE TRUNCATE ON event_stream_key_state
    FOR EACH STATEMENT EXECUTE FUNCTION event_stream_key_state_monotonic();

ALTER TABLE events
    DROP CONSTRAINT events_sealed_body_shape,
    DROP COLUMN sealed_kid,
    ADD COLUMN stream_key_epoch BIGINT NOT NULL,
    ADD CONSTRAINT events_stream_key_epoch_fk
        FOREIGN KEY (stream_id, stream_key_epoch)
        REFERENCES event_stream_keys (stream_id, key_epoch),
    ADD CONSTRAINT events_sealed_body_shape CHECK (
        sealed_version = 3
        AND stream_key_epoch > 0
        AND octet_length(sealed_nonce) = 24
        AND octet_length(sealed_body) >= 16
    );

COMMENT ON COLUMN events.sealed_body IS
    'XChaCha20-Poly1305 ciphertext under the stream DEK identified by stream_key_epoch; clear headers, sealed_version, and epoch are AAD';
COMMENT ON TABLE event_stream_keys IS
    'Per-stream DEKs wrapped by runtime KEKs; rewrap changes this table only and never event history';
COMMENT ON TABLE event_direct_key_sentinel IS
    'Immutable authenticated proof for every runtime KID used directly by a persisted private projection or delivery credential';
