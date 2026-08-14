-- 0026_runtime_kek_retirement.sql — forward-only runtime KEK retirement and
-- exact direct-envelope reference custody.

DROP TRIGGER event_direct_key_sentinel_no_mutation ON public.event_direct_key_sentinel;
DROP FUNCTION public.event_direct_key_sentinel_immutable();

ALTER TABLE public.event_direct_key_sentinel
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
        REFERENCES public.event_direct_key_sentinel (kid);

-- Statement timing acquires the global lock before PostgreSQL takes any source
-- row lock. This preserves a single lock order with application-driven
-- rotations and prevents advisory-lock/row-lock inversion.
CREATE FUNCTION public.event_direct_key_sentinel_lock_transition() RETURNS trigger AS $$
BEGIN
    -- ASCII `FMKEK_V1`, shared with the application lifecycle transaction.
    PERFORM pg_advisory_xact_lock(5065787916851041841);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_direct_key_sentinel_transition_lock
    BEFORE UPDATE ON public.event_direct_key_sentinel
    FOR EACH STATEMENT EXECUTE FUNCTION public.event_direct_key_sentinel_lock_transition();

CREATE FUNCTION public.event_direct_key_sentinel_guard_mutation() RETURNS trigger AS $$
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
            FROM public.event_direct_key_sentinel
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
    BEFORE UPDATE OR DELETE ON public.event_direct_key_sentinel
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_key_sentinel_guard_mutation();

CREATE TRIGGER event_direct_key_sentinel_truncate_guard
    BEFORE TRUNCATE ON public.event_direct_key_sentinel
    FOR EACH STATEMENT EXECUTE FUNCTION public.event_direct_key_sentinel_guard_mutation();

CREATE INDEX event_direct_key_sentinel_lifecycle_idx
    ON public.event_direct_key_sentinel (lifecycle, kid);
CREATE UNIQUE INDEX event_direct_key_sentinel_single_retiring_idx
    ON public.event_direct_key_sentinel (lifecycle)
    WHERE lifecycle = 'retiring';

-- Stream wraps are first-class registry references. The forward-enforced FK
-- preserves pre-registry orphan wraps for authenticated adoption by `begin`,
-- while the trigger locks the selected writable KID so a raw or stale writer
-- cannot cross the writable -> retiring fence.
ALTER TABLE public.event_stream_keys
    DROP CONSTRAINT event_stream_keys_wrap_kid_check,
    ADD CONSTRAINT event_stream_keys_wrap_kid_check CHECK (
        octet_length(wrap_kid) BETWEEN 1 AND 128
        AND wrap_kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    ),
    ADD CONSTRAINT event_stream_keys_wrap_kid_fkey
        FOREIGN KEY (wrap_kid)
        REFERENCES public.event_direct_key_sentinel (kid)
        NOT VALID;

CREATE FUNCTION public.event_stream_key_wrap_write_guard() RETURNS trigger AS $$
BEGIN
    PERFORM 1
    FROM public.event_direct_key_sentinel
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
    ON public.event_stream_keys
    FOR EACH ROW EXECUTE FUNCTION public.event_stream_key_wrap_write_guard();

COMMENT ON TABLE public.event_direct_key_sentinel IS
    'Authenticated runtime-KEK registry with forward-only writable, retiring, and retired tombstone custody';
COMMENT ON COLUMN public.event_direct_key_sentinel.rehearsal_token IS
    'Durable evidence that the retiring KID was absent from the process keyring and had no verified live references';

-- Stored generated KIDs turn the JSON envelope inventory into indexed,
-- constraint-backed references. Nullable envelope columns yield nullable KIDs;
-- a non-null envelope without a KID is rejected by its storage check below.
ALTER TABLE public.investigation_memory
    ADD COLUMN result_private_kid TEXT
        GENERATED ALWAYS AS (result_private ->> 'kid') STORED,
    ADD CONSTRAINT investigation_memory_result_private_kid_present
        CHECK (result_private_kid IS NOT NULL),
    ADD CONSTRAINT investigation_memory_result_private_kid_fkey
        FOREIGN KEY (result_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.player_info_result
    ADD COLUMN result_private_kid TEXT
        GENERATED ALWAYS AS (result_private ->> 'kid') STORED,
    ADD CONSTRAINT player_info_result_private_kid_present
        CHECK (result_private_kid IS NOT NULL),
    ADD CONSTRAINT player_info_result_private_kid_fkey
        FOREIGN KEY (result_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.player_investigation_result
    ADD COLUMN result_private_kid TEXT
        GENERATED ALWAYS AS (result_private ->> 'kid') STORED,
    ADD CONSTRAINT player_investigation_result_private_kid_present
        CHECK (result_private_kid IS NOT NULL),
    ADD CONSTRAINT player_investigation_result_private_kid_fkey
        FOREIGN KEY (result_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.private_channel_member
    ADD COLUMN private_kid TEXT GENERATED ALWAYS AS (private ->> 'kid') STORED,
    ADD CONSTRAINT private_channel_member_private_kid_present
        CHECK (private_kid IS NOT NULL),
    ADD CONSTRAINT private_channel_member_private_kid_fkey
        FOREIGN KEY (private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.slot_state
    ADD COLUMN private_kid TEXT GENERATED ALWAYS AS (private ->> 'kid') STORED,
    ADD CONSTRAINT slot_state_private_kid_shape CHECK (
        (private IS NULL AND private_kid IS NULL)
        OR (private IS NOT NULL AND private_kid IS NOT NULL)
    ),
    ADD CONSTRAINT slot_state_private_kid_fkey
        FOREIGN KEY (private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.thread_view
    ADD COLUMN body_private_kid TEXT
        GENERATED ALWAYS AS (body_private ->> 'kid') STORED,
    ADD CONSTRAINT thread_view_body_private_kid_shape CHECK (
        (body_private IS NULL AND body_private_kid IS NULL)
        OR (body_private IS NOT NULL AND body_private_kid IS NOT NULL)
    ),
    ADD CONSTRAINT thread_view_body_private_kid_fkey
        FOREIGN KEY (body_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.day_event_narrative
    ADD COLUMN body_template_private_kid TEXT
        GENERATED ALWAYS AS (body_template_private ->> 'kid') STORED,
    ADD COLUMN rendered_body_private_kid TEXT
        GENERATED ALWAYS AS (rendered_body_private ->> 'kid') STORED,
    ADD CONSTRAINT day_event_narrative_template_private_kid_shape CHECK (
        (body_template_private IS NULL AND body_template_private_kid IS NULL)
        OR (body_template_private IS NOT NULL AND body_template_private_kid IS NOT NULL)
    ),
    ADD CONSTRAINT day_event_narrative_rendered_private_kid_shape CHECK (
        (rendered_body_private IS NULL AND rendered_body_private_kid IS NULL)
        OR (rendered_body_private IS NOT NULL AND rendered_body_private_kid IS NOT NULL)
    ),
    ADD CONSTRAINT day_event_narrative_template_private_kid_fkey
        FOREIGN KEY (body_template_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid),
    ADD CONSTRAINT day_event_narrative_rendered_private_kid_fkey
        FOREIGN KEY (rendered_body_private_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

ALTER TABLE public.auth_delivery_intent
    ADD COLUMN credential_envelope_kid TEXT
        GENERATED ALWAYS AS (credential_envelope ->> 'kid') STORED,
    ADD CONSTRAINT auth_delivery_intent_credential_envelope_kid_shape CHECK (
        (credential_envelope IS NULL AND credential_envelope_kid IS NULL)
        OR (credential_envelope IS NOT NULL AND credential_envelope_kid IS NOT NULL)
    ),
    ADD CONSTRAINT auth_delivery_intent_credential_envelope_kid_fkey
        FOREIGN KEY (credential_envelope_kid)
        REFERENCES public.event_direct_key_sentinel (kid);

CREATE INDEX investigation_memory_result_private_kid_idx
    ON public.investigation_memory (
        result_private_kid, game_id, investigator_slot, target_slot, mode
    );
CREATE INDEX player_info_result_private_kid_idx
    ON public.player_info_result (
        result_private_kid, game_id, phase_id, event_index, audience_slot
    );
CREATE INDEX player_investigation_result_private_kid_idx
    ON public.player_investigation_result (
        result_private_kid, game_id, phase_id, event_index, audience_slot
    );
CREATE INDEX private_channel_member_private_kid_idx
    ON public.private_channel_member (
        private_kid, game_id, channel_id, slot_id
    );
CREATE INDEX slot_state_private_kid_idx
    ON public.slot_state (private_kid, game_id, slot_id)
    WHERE private_kid IS NOT NULL;
CREATE INDEX thread_view_body_private_kid_idx
    ON public.thread_view (body_private_kid, game_id, source_seq)
    WHERE body_private_kid IS NOT NULL;
CREATE INDEX day_event_narrative_template_private_kid_idx
    ON public.day_event_narrative (
        body_template_private_kid, game_id, event_id, lifecycle
    )
    WHERE body_template_private_kid IS NOT NULL;
CREATE INDEX day_event_narrative_rendered_private_kid_idx
    ON public.day_event_narrative (
        rendered_body_private_kid, game_id, event_id, lifecycle
    )
    WHERE rendered_body_private_kid IS NOT NULL;
CREATE INDEX auth_delivery_intent_credential_envelope_kid_idx
    ON public.auth_delivery_intent (credential_envelope_kid, delivery_id)
    WHERE credential_envelope_kid IS NOT NULL;

-- A stale process may know the old key material, but after the registry row is
-- retiring it cannot insert or replace an old-KID envelope. FOR SHARE also
-- makes the writable -> retiring transition wait for an already-running write.
CREATE FUNCTION public.event_direct_envelope_write_guard() RETURNS trigger AS $$
DECLARE
    old_envelope JSONB;
    new_envelope JSONB;
    new_kid TEXT;
BEGIN
    new_envelope := to_jsonb(NEW) -> TG_ARGV[0];
    IF TG_OP = 'UPDATE' THEN
        old_envelope := to_jsonb(OLD) -> TG_ARGV[0];
        IF new_envelope IS NOT DISTINCT FROM old_envelope THEN
            RETURN NEW;
        END IF;
    END IF;

    IF new_envelope IS NULL OR new_envelope = 'null'::JSONB THEN
        RETURN NEW;
    END IF;
    new_kid := new_envelope ->> 'kid';
    IF new_kid IS NULL OR new_kid !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
        RAISE EXCEPTION 'direct envelope in %.% has an invalid KID', TG_TABLE_NAME, TG_ARGV[0];
    END IF;

    PERFORM 1
    FROM public.event_direct_key_sentinel
    WHERE kid = new_kid AND lifecycle = 'writable'
    FOR SHARE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'runtime KEK % is not writable for direct envelope %.%',
            new_kid, TG_TABLE_NAME, TG_ARGV[0];
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER investigation_memory_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF result_private ON public.investigation_memory
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');
CREATE TRIGGER player_info_result_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF result_private ON public.player_info_result
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');
CREATE TRIGGER player_investigation_result_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF result_private ON public.player_investigation_result
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');
CREATE TRIGGER private_channel_member_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF private ON public.private_channel_member
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('private');
CREATE TRIGGER slot_state_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF private ON public.slot_state
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('private');
CREATE TRIGGER thread_view_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF body_private ON public.thread_view
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('body_private');
CREATE TRIGGER day_event_narrative_template_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF body_template_private ON public.day_event_narrative
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('body_template_private');
CREATE TRIGGER day_event_narrative_rendered_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF rendered_body_private ON public.day_event_narrative
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('rendered_body_private');
CREATE TRIGGER auth_delivery_intent_direct_envelope_guard
    BEFORE INSERT OR UPDATE OF credential_envelope ON public.auth_delivery_intent
    FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('credential_envelope');

CREATE VIEW public.event_direct_key_reference AS
    SELECT 'investigation_memory.result_private'::TEXT AS surface, result_private_kid AS kid
    FROM public.investigation_memory
    UNION ALL
    SELECT 'player_info_result.result_private', result_private_kid
    FROM public.player_info_result
    UNION ALL
    SELECT 'player_investigation_result.result_private', result_private_kid
    FROM public.player_investigation_result
    UNION ALL
    SELECT 'private_channel_member.private', private_kid
    FROM public.private_channel_member
    UNION ALL
    SELECT 'slot_state.private', private_kid
    FROM public.slot_state WHERE private_kid IS NOT NULL
    UNION ALL
    SELECT 'thread_view.body_private', body_private_kid
    FROM public.thread_view WHERE body_private_kid IS NOT NULL
    UNION ALL
    SELECT 'day_event_narrative.body_template_private', body_template_private_kid
    FROM public.day_event_narrative WHERE body_template_private_kid IS NOT NULL
    UNION ALL
    SELECT 'day_event_narrative.rendered_body_private', rendered_body_private_kid
    FROM public.day_event_narrative WHERE rendered_body_private_kid IS NOT NULL
    UNION ALL
    SELECT 'auth_delivery_intent.credential_envelope', credential_envelope_kid
    FROM public.auth_delivery_intent WHERE credential_envelope_kid IS NOT NULL;

COMMENT ON VIEW public.event_direct_key_reference IS
    'Exact indexed census of every persisted runtime-KEK direct envelope';
