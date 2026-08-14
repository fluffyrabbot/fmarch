-- Replace individually visible logical fields with one authenticated event body.
-- Pre-1.0/greenfield: there is deliberately no plaintext compatibility bridge.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM events) THEN
        RAISE EXCEPTION 'sealed event-body migration requires an empty greenfield event store';
    END IF;
END
$$;

ALTER TABLE events
    ADD COLUMN sealed_version SMALLINT NOT NULL,
    ADD COLUMN sealed_kid TEXT NOT NULL,
    ADD COLUMN sealed_nonce BYTEA NOT NULL,
    ADD COLUMN sealed_body BYTEA NOT NULL,
    DROP COLUMN payload,
    DROP COLUMN actor,
    DROP COLUMN causation_id,
    DROP COLUMN meta;

ALTER TABLE events
    ADD CONSTRAINT events_sealed_body_shape CHECK (
        sealed_version = 2
        AND octet_length(sealed_kid) BETWEEN 1 AND 128
        AND sealed_kid = btrim(sealed_kid)
        AND octet_length(sealed_nonce) = 24
        AND octet_length(sealed_body) >= 16
    );

COMMENT ON COLUMN events.sealed_body IS
    'Raw XChaCha20-Poly1305 ciphertext and tag for payload, actor, causation_id, and meta; all clear row headers, sealed_version, and sealed_kid are AAD';
