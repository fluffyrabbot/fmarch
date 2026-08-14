-- 0004_runtime_kek_retirement.sql -- forward-only runtime KEK custody.
--
-- The authenticated sentinel catalog is also the durable lifecycle registry for
-- every runtime KEK which has written stream wraps or direct envelopes. A KID
-- is never deleted or reused: retirement advances writable -> retiring ->
-- retired, then destroys only the online sentinel material.

DROP TRIGGER event_direct_key_sentinel_no_mutation ON event_direct_key_sentinel;
DROP FUNCTION event_direct_key_sentinel_immutable();

ALTER TABLE event_direct_key_sentinel
    DROP CONSTRAINT event_direct_key_sentinel_kid_check,
    ALTER COLUMN sentinel_version DROP NOT NULL,
    ALTER COLUMN sentinel_nonce DROP NOT NULL,
    ALTER COLUMN sentinel_ciphertext DROP NOT NULL,
    ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'writable',
    ADD COLUMN retirement_target_kid TEXT,
    ADD COLUMN retirement_started_at TIMESTAMPTZ,
    ADD COLUMN rehearsal_token UUID,
    ADD COLUMN rehearsed_at TIMESTAMPTZ,
    ADD COLUMN retired_at TIMESTAMPTZ,
    ADD CONSTRAINT event_direct_key_sentinel_kid_check CHECK (
        octet_length(kid) BETWEEN 1 AND 128
        AND kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ),
    ADD CONSTRAINT event_direct_key_sentinel_lifecycle_check CHECK (
        (
            lifecycle = 'writable'
            AND retirement_target_kid IS NULL
            AND retirement_started_at IS NULL
            AND rehearsal_token IS NULL
            AND rehearsed_at IS NULL
            AND retired_at IS NULL
            AND sentinel_version IS NOT NULL
            AND sentinel_nonce IS NOT NULL
            AND sentinel_ciphertext IS NOT NULL
        )
        OR
        (
            lifecycle = 'retiring'
            AND retirement_target_kid IS NOT NULL
            AND retirement_target_kid <> kid
            AND retirement_started_at IS NOT NULL
            AND retired_at IS NULL
            AND sentinel_version IS NOT NULL
            AND sentinel_nonce IS NOT NULL
            AND sentinel_ciphertext IS NOT NULL
            AND (
                (rehearsal_token IS NULL AND rehearsed_at IS NULL)
                OR
                (rehearsal_token IS NOT NULL AND rehearsed_at IS NOT NULL)
            )
        )
        OR
        (
            lifecycle = 'retired'
            AND retirement_target_kid IS NOT NULL
            AND retirement_target_kid <> kid
            AND retirement_started_at IS NOT NULL
            AND rehearsal_token IS NOT NULL
            AND rehearsed_at IS NOT NULL
            AND retired_at IS NOT NULL
            AND sentinel_version IS NULL
            AND sentinel_nonce IS NULL
            AND sentinel_ciphertext IS NULL
        )
    ),
    ADD CONSTRAINT event_direct_key_sentinel_retirement_target_kid_check CHECK (
        retirement_target_kid IS NULL
        OR (
            octet_length(retirement_target_kid) BETWEEN 1 AND 128
            AND retirement_target_kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
        )
    ),
    ADD CONSTRAINT event_direct_key_sentinel_retirement_target_fk
        FOREIGN KEY (retirement_target_kid)
        REFERENCES event_direct_key_sentinel (kid);

-- Statement timing acquires the global lock before PostgreSQL takes any source
-- row lock. This preserves a single lock order with application-driven
-- rotations and prevents advisory-lock/row-lock inversion.
CREATE FUNCTION event_direct_key_sentinel_lock_transition() RETURNS trigger AS $$
BEGIN
    -- ASCII `FMKEK_V1`, shared with the application lifecycle transaction.
    PERFORM pg_advisory_xact_lock(5065787916851041841);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_direct_key_sentinel_transition_lock
    BEFORE UPDATE ON event_direct_key_sentinel
    FOR EACH STATEMENT EXECUTE FUNCTION event_direct_key_sentinel_lock_transition();

CREATE FUNCTION event_direct_key_sentinel_guard_mutation() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'event direct-key sentinel registry rows cannot be deleted or truncated';
    END IF;

    IF NEW.kid <> OLD.kid THEN
        RAISE EXCEPTION 'event direct-key registry KID is immutable';
    END IF;

    IF OLD.lifecycle = 'retired' THEN
        RAISE EXCEPTION 'retired event direct-key registry row is an immutable tombstone';
    END IF;

    IF OLD.lifecycle = 'writable' THEN
        IF EXISTS (
            SELECT 1
            FROM event_direct_key_sentinel
            WHERE lifecycle = 'retiring' AND kid <> OLD.kid
        ) THEN
            RAISE EXCEPTION 'another runtime KEK rotation is already in flight';
        END IF;
        IF NEW.lifecycle <> 'retiring' THEN
            RAISE EXCEPTION 'event direct-key lifecycle may only advance writable to retiring';
        END IF;
        IF NEW.sentinel_version IS DISTINCT FROM OLD.sentinel_version
            OR NEW.sentinel_nonce IS DISTINCT FROM OLD.sentinel_nonce
            OR NEW.sentinel_ciphertext IS DISTINCT FROM OLD.sentinel_ciphertext THEN
            RAISE EXCEPTION 'event direct-key sentinel material is immutable before retirement';
        END IF;
        IF NEW.rehearsal_token IS NOT NULL OR NEW.rehearsed_at IS NOT NULL THEN
            RAISE EXCEPTION 'event direct-key retirement must begin before rehearsal evidence is recorded';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.lifecycle = 'retiring' THEN
        IF NEW.lifecycle NOT IN ('retiring', 'retired') THEN
            RAISE EXCEPTION 'event direct-key lifecycle may only advance retiring to retired';
        END IF;
        IF NEW.retirement_target_kid IS DISTINCT FROM OLD.retirement_target_kid
            OR NEW.retirement_started_at IS DISTINCT FROM OLD.retirement_started_at THEN
            RAISE EXCEPTION 'event direct-key retirement identity is immutable';
        END IF;
        IF NEW.lifecycle = 'retiring'
            AND (
                NEW.sentinel_version IS DISTINCT FROM OLD.sentinel_version
                OR NEW.sentinel_nonce IS DISTINCT FROM OLD.sentinel_nonce
                OR NEW.sentinel_ciphertext IS DISTINCT FROM OLD.sentinel_ciphertext
                OR NEW.retired_at IS NOT NULL
            ) THEN
            RAISE EXCEPTION 'event direct-key sentinel material is immutable while retiring';
        END IF;
        IF OLD.rehearsal_token IS NOT NULL
            AND (
                NEW.rehearsal_token IS DISTINCT FROM OLD.rehearsal_token
                OR NEW.rehearsed_at IS DISTINCT FROM OLD.rehearsed_at
            ) THEN
            RAISE EXCEPTION 'event direct-key rehearsal evidence is write-once';
        END IF;
        IF NEW.lifecycle = 'retired'
            AND (
                NEW.rehearsal_token IS DISTINCT FROM OLD.rehearsal_token
                OR NEW.rehearsed_at IS DISTINCT FROM OLD.rehearsed_at
            ) THEN
            RAISE EXCEPTION 'event direct-key retirement requires the rehearsed evidence';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'unknown event direct-key lifecycle %', OLD.lifecycle;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_direct_key_sentinel_guard
    BEFORE UPDATE OR DELETE ON event_direct_key_sentinel
    FOR EACH ROW EXECUTE FUNCTION event_direct_key_sentinel_guard_mutation();

CREATE TRIGGER event_direct_key_sentinel_truncate_guard
    BEFORE TRUNCATE ON event_direct_key_sentinel
    FOR EACH STATEMENT EXECUTE FUNCTION event_direct_key_sentinel_guard_mutation();

CREATE INDEX event_direct_key_sentinel_lifecycle_idx
    ON event_direct_key_sentinel (lifecycle, kid);
CREATE UNIQUE INDEX event_direct_key_sentinel_single_retiring_idx
    ON event_direct_key_sentinel (lifecycle)
    WHERE lifecycle = 'retiring';

-- Stream wraps are first-class registry references. The forward-enforced FK
-- preserves pre-registry orphan wraps for authenticated adoption by `begin`,
-- while the trigger locks the selected writable KID so a raw or stale writer
-- cannot cross the writable -> retiring fence.
ALTER TABLE event_stream_keys
    DROP CONSTRAINT event_stream_keys_wrap_kid_check,
    ADD CONSTRAINT event_stream_keys_wrap_kid_check CHECK (
        octet_length(wrap_kid) BETWEEN 1 AND 128
        AND wrap_kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ),
    ADD CONSTRAINT event_stream_keys_wrap_kid_fkey
        FOREIGN KEY (wrap_kid)
        REFERENCES event_direct_key_sentinel (kid)
        NOT VALID;

CREATE FUNCTION event_stream_key_wrap_write_guard() RETURNS trigger AS $$
BEGIN
    PERFORM 1
    FROM event_direct_key_sentinel
    WHERE kid = NEW.wrap_kid AND lifecycle = 'writable'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'runtime KEK % is not writable for an event stream-key wrap',
            NEW.wrap_kid;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_stream_key_wrap_guard
    BEFORE INSERT OR UPDATE OF wrap_version, wrap_kid, wrap_nonce, wrapped_dek
    ON event_stream_keys
    FOR EACH ROW EXECUTE FUNCTION event_stream_key_wrap_write_guard();

-- The standalone eventstore schema owns no projection or delivery tables, but
-- retirement still consumes the same authoritative view contract as the full
-- application schema. The projections migrator replaces this empty census
-- with its exact UNION ALL inventory.
CREATE VIEW event_direct_key_reference AS
    SELECT NULL::TEXT AS surface, NULL::TEXT AS kid
    WHERE FALSE;

COMMENT ON TABLE event_direct_key_sentinel IS
    'Authenticated runtime-KEK registry with forward-only writable, retiring, and retired tombstone custody';
COMMENT ON COLUMN event_direct_key_sentinel.rehearsal_token IS
    'Durable evidence that the retiring KID was absent from the process keyring and had no verified live references';
