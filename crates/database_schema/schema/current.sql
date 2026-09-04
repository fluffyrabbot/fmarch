-- GENERATED FILE: canonical owner-neutral PostgreSQL schema for fmarch epoch 1.
-- Regenerate with: npm run generate:database-schema

--
-- PostgreSQL database dump
--


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: event_direct_envelope_write_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_direct_envelope_write_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $_$
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
$_$;


--
-- Name: event_direct_key_sentinel_guard_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_direct_key_sentinel_guard_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: event_direct_key_sentinel_lock_transition(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_direct_key_sentinel_lock_transition() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- ASCII `FMKEK_V1`, shared with the application lifecycle transaction.
    PERFORM pg_advisory_xact_lock(5065787916851041841);
    RETURN NULL;
END;
$$;


--
-- Name: event_stream_key_state_monotonic(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_stream_key_state_monotonic() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'event stream key state cannot be removed or truncated';
    END IF;
    IF NEW.stream_id <> OLD.stream_id OR NEW.active_epoch <= OLD.active_epoch THEN
        RAISE EXCEPTION 'active event stream key epoch must increase monotonically';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: event_stream_key_wrap_write_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_stream_key_wrap_write_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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
$$;


--
-- Name: event_stream_keys_guard_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.event_stream_keys_guard_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'event stream keys are append-only: deletion and truncation are forbidden';
    END IF;
    IF NEW.stream_id <> OLD.stream_id OR NEW.key_epoch <> OLD.key_epoch THEN
        RAISE EXCEPTION 'event stream key identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: events_forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.events_forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only: % is forbidden', TG_OP;
END;
$$;


--
-- Name: pack_artifact_immutable_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pack_artifact_immutable_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'pack_artifact is immutable: % is forbidden', TG_OP;
END;
$$;


--
-- Name: privacy_subject_irreversible_erasure(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.privacy_subject_irreversible_erasure() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.lifecycle_state = 'erased' AND NEW.lifecycle_state <> 'erased' THEN
        RAISE EXCEPTION 'an erased privacy subject cannot be reactivated';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: subject_erasure_state_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subject_erasure_state_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF OLD.state = 'complete' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'completed subject erasure state is immutable';
    END IF;
    IF NEW.attempt_count < OLD.attempt_count THEN
        RAISE EXCEPTION 'subject erasure attempt_count cannot decrease';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: subject_privacy_append_only_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subject_privacy_append_only_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP;
END;
$$;


--
-- Name: subject_private_claim_reject_tombstoned(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.subject_private_claim_reject_tombstoned() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    subject_state text;
BEGIN
    -- Claim issuance and erasure serialize on this row. A trigger-level lock is
    -- required even if a future caller forgets the application-level lock.
    SELECT lifecycle_state INTO subject_state
    FROM public.privacy_subject
    WHERE subject_id = NEW.subject_id
    FOR UPDATE;
    IF subject_state IS DISTINCT FROM 'active' OR EXISTS (
        SELECT 1 FROM public.subject_tombstone WHERE subject_id = NEW.subject_id
    ) THEN
        RAISE EXCEPTION 'cannot add a private claim for a destroyed subject';
    END IF;
    RETURN NEW;
END;
$$;


--
-- Name: workos_provider_session_guard_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.workos_provider_session_guard_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF TG_OP = 'TRUNCATE' THEN
        RAISE EXCEPTION 'WorkOS provider-session custody cannot be truncated';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'active' OR NEW.logged_out_at IS NOT NULL THEN
            RAISE EXCEPTION 'WorkOS provider-session custody must begin active';
        END IF;
        IF EXISTS (
            SELECT 1
            FROM public.workos_provider_session_tombstone AS tombstone
            WHERE tombstone.provider_session_hash = encode(
                sha256(convert_to(NEW.provider_session_id, 'UTF8')),
                'hex'
            )
        ) OR EXISTS (
            SELECT 1
            FROM public.workos_subject_tombstone AS tombstone
            WHERE tombstone.provider_subject_hash = encode(
                sha256(convert_to(NEW.subject, 'UTF8')),
                'hex'
            )
        ) THEN
            RAISE EXCEPTION 'tombstoned WorkOS provider custody cannot be recreated';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF EXISTS (
            SELECT 1
            FROM public.subject_erasure_outbox AS outbox
            JOIN public.subject_erasure AS erasure USING (erasure_id)
            WHERE outbox.principal_id = OLD.principal_id
              AND erasure.state = 'pending'
              AND erasure.claim_token IS NOT NULL
        ) AND EXISTS (
            SELECT 1
            FROM public.workos_provider_session_tombstone AS tombstone
            WHERE tombstone.provider_session_hash = encode(
                sha256(convert_to(OLD.provider_session_id, 'UTF8')),
                'hex'
            )
        ) THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'WorkOS provider-session custody can be deleted only by claimed subject erasure with a permanent tombstone';
    END IF;

    IF NEW.provider_session_id <> OLD.provider_session_id
       OR NEW.subject <> OLD.subject
       OR NEW.principal_id <> OLD.principal_id
       OR NEW.method_id <> OLD.method_id
       OR NEW.created_at <> OLD.created_at
       OR NEW.method_kind <> OLD.method_kind THEN
        RAISE EXCEPTION 'WorkOS provider-session identity is immutable';
    END IF;

    IF OLD.status = 'logged_out' AND NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'logged-out WorkOS provider-session custody is immutable';
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'active' THEN
        IF NEW.logged_out_at IS NOT NULL
           OR NEW.last_seen_at < OLD.last_seen_at
           OR NEW.access_expires_at < OLD.access_expires_at THEN
            RAISE EXCEPTION 'active WorkOS provider-session observation must be monotonic';
        END IF;
        RETURN NEW;
    END IF;

    IF OLD.status = 'active' AND NEW.status = 'logged_out' THEN
        IF NEW.last_seen_at <> OLD.last_seen_at
           OR NEW.access_expires_at <> OLD.access_expires_at
           OR NEW.logged_out_at IS NULL THEN
            RAISE EXCEPTION 'WorkOS provider-session logout may only seal the active row';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'invalid WorkOS provider-session lifecycle transition';
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_counter (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    counter_id text NOT NULL,
    template_id text NOT NULL,
    consumed_action text NOT NULL,
    cadence_policy text NOT NULL,
    phase_scope text NOT NULL,
    limit_count integer NOT NULL,
    used_count integer NOT NULL,
    remaining_count integer NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: action_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_grant (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    grant_id text NOT NULL,
    kind text NOT NULL,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    uses integer NOT NULL,
    vote_weight double precision,
    grant_option text
);


--
-- Name: action_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_history (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    template_id text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL
);


--
-- Name: action_submission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_submission (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    actor_slot text NOT NULL,
    action_id text NOT NULL,
    template_id text NOT NULL,
    grant_id text,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    instant_resolved boolean DEFAULT false NOT NULL
);


--
-- Name: auth_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_account (
    account_id text NOT NULL,
    principal_id uuid NOT NULL,
    password_hash text NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    method_id uuid NOT NULL,
    method_kind text GENERATED ALWAYS AS ('classic_password'::text) STORED
);


--
-- Name: auth_account_recovery_credential; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_account_recovery_credential (
    recovery_id uuid NOT NULL,
    account_id text NOT NULL,
    token_hash text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    used_at bigint,
    revoked_at bigint,
    CONSTRAINT auth_account_recovery_credential_check CHECK ((expires_at > created_at)),
    CONSTRAINT auth_account_recovery_credential_check1 CHECK (((used_at IS NULL) OR (revoked_at IS NULL)))
);


--
-- Name: auth_credential_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_credential_attempt (
    scope_hash text NOT NULL,
    window_started_at bigint NOT NULL,
    failure_count integer NOT NULL,
    blocked_until bigint,
    updated_at bigint NOT NULL,
    CONSTRAINT auth_credential_attempt_check CHECK (((blocked_until IS NULL) OR (blocked_until >= updated_at))),
    CONSTRAINT auth_credential_attempt_failure_count_check CHECK ((failure_count > 0))
);


--
-- Name: auth_delivery_intent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_delivery_intent (
    delivery_id uuid NOT NULL,
    delivery_kind text NOT NULL,
    account_id text NOT NULL,
    principal_id uuid NOT NULL,
    credential_hash text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at bigint,
    delivered_at bigint,
    last_error text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    provider_id text NOT NULL,
    outcome_kind text NOT NULL,
    outcome_code text,
    provider_receipt_id text,
    claim_token uuid,
    claim_expires_at bigint,
    credential_envelope jsonb,
    credential_expires_at bigint NOT NULL,
    credential_envelope_kid text GENERATED ALWAYS AS ((credential_envelope ->> 'kid'::text)) STORED,
    CONSTRAINT auth_delivery_intent_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT auth_delivery_intent_credential_envelope_check CHECK (((credential_envelope IS NULL) OR (jsonb_typeof(credential_envelope) = 'object'::text))),
    CONSTRAINT auth_delivery_intent_credential_envelope_kid_shape CHECK ((((credential_envelope IS NULL) AND (credential_envelope_kid IS NULL)) OR ((credential_envelope IS NOT NULL) AND (credential_envelope_kid IS NOT NULL)))),
    CONSTRAINT auth_delivery_intent_credential_expiry_check CHECK ((credential_expires_at > created_at)),
    CONSTRAINT auth_delivery_intent_delivery_kind_check CHECK ((delivery_kind = ANY (ARRAY['invite'::text, 'recovery'::text, 'community_invitation'::text]))),
    CONSTRAINT auth_delivery_intent_delivery_shape_check CHECK ((((status = 'queued'::text) AND (outcome_kind = 'queued'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'processing'::text) AND (outcome_kind = 'processing'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NOT NULL) AND (claim_expires_at IS NOT NULL)) OR ((status = 'delivered'::text) AND (outcome_kind = 'delivered'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NOT NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NOT NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'retryable_failed'::text) AND (outcome_kind = 'retryable_failure'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'permanent_failed'::text) AND (outcome_kind = 'permanent_failure'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'cancelled'::text) AND (outcome_kind = 'cancelled'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (credential_envelope IS NULL)))),
    CONSTRAINT auth_delivery_intent_outcome_kind_check CHECK ((outcome_kind = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failure'::text, 'permanent_failure'::text, 'cancelled'::text]))),
    CONSTRAINT auth_delivery_intent_provider_id_check CHECK ((length(TRIM(BOTH FROM provider_id)) > 0)),
    CONSTRAINT auth_delivery_intent_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failed'::text, 'permanent_failed'::text, 'cancelled'::text])))
);


--
-- Name: auth_registration_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_registration_attempt (
    scope_hash text NOT NULL,
    window_started_at bigint NOT NULL,
    attempt_count integer NOT NULL,
    blocked_until bigint,
    updated_at bigint NOT NULL,
    CONSTRAINT auth_registration_attempt_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT auth_registration_attempt_check CHECK (((blocked_until IS NULL) OR (blocked_until >= updated_at)))
);


--
-- Name: auth_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_session (
    token_hash text NOT NULL,
    principal_id uuid NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    revoked_at bigint,
    authenticated_via_method_id uuid,
    idle_expires_at bigint NOT NULL,
    assurance text NOT NULL,
    authenticated_at bigint NOT NULL,
    workos_session_id text,
    local_proof_instance_id text,
    workos_signing_key_id text,
    CONSTRAINT auth_session_assurance_check CHECK ((assurance = ANY (ARRAY['password'::text, 'external_sso'::text, 'dev'::text]))),
    CONSTRAINT auth_session_authenticated_at_check CHECK ((authenticated_at <= created_at)),
    CONSTRAINT auth_session_idle_expiry_check CHECK (((idle_expires_at > created_at) AND (idle_expires_at <= expires_at))),
    CONSTRAINT auth_session_local_proof_instance_shape_check CHECK ((((assurance = 'dev'::text) AND (local_proof_instance_id IS NOT NULL) AND (local_proof_instance_id ~ '^[0-9a-f]{64}$'::text)) OR ((assurance <> 'dev'::text) AND (local_proof_instance_id IS NULL)))),
    CONSTRAINT auth_session_workos_session_shape_check CHECK ((((assurance = 'external_sso'::text) AND (workos_session_id IS NOT NULL) AND (authenticated_via_method_id IS NOT NULL) AND (workos_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'::text)) OR ((assurance = 'external_sso'::text) AND (workos_session_id IS NULL) AND (revoked_at IS NOT NULL)) OR ((assurance IS DISTINCT FROM 'external_sso'::text) AND (workos_session_id IS NULL)))),
    CONSTRAINT auth_session_workos_signing_key_shape_check CHECK ((((assurance = 'external_sso'::text) AND (workos_signing_key_id IS NOT NULL) AND ((octet_length(workos_signing_key_id) >= 1) AND (octet_length(workos_signing_key_id) <= 256)) AND (workos_signing_key_id ~ '^[!-~]+$'::text)) OR ((assurance <> 'external_sso'::text) AND (workos_signing_key_id IS NULL))))
);


--
-- Name: auth_websocket_ticket; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_websocket_ticket (
    token_hash text NOT NULL,
    session_reference text NOT NULL,
    access_expires_at bigint NOT NULL,
    audience text NOT NULL,
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    slot_id text,
    after_seq bigint DEFAULT 0 NOT NULL,
    issued_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    CONSTRAINT auth_websocket_ticket_access_expiry_check CHECK ((access_expires_at > issued_at)),
    CONSTRAINT auth_websocket_ticket_after_seq_check CHECK ((after_seq >= 0)),
    CONSTRAINT auth_websocket_ticket_audience_check CHECK ((length(TRIM(BOTH FROM audience)) > 0)),
    CONSTRAINT auth_websocket_ticket_channel_check CHECK ((length(TRIM(BOTH FROM channel_id)) > 0)),
    CONSTRAINT auth_websocket_ticket_expiry_check CHECK ((expires_at > issued_at))
);


--
-- Name: authentication_method; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.authentication_method (
    method_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    last_authenticated_at bigint,
    CONSTRAINT authentication_method_disabled_shape_check CHECK ((((status = 'active'::text) AND (disabled_at IS NULL)) OR ((status = 'disabled'::text) AND (disabled_at IS NOT NULL)))),
    CONSTRAINT authentication_method_kind_check CHECK ((kind = ANY (ARRAY['classic_password'::text, 'workos'::text]))),
    CONSTRAINT authentication_method_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: command_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_receipt (
    principal_id uuid NOT NULL,
    command_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    stream_seqs bigint[] NOT NULL,
    command_fingerprint bytea NOT NULL,
    CONSTRAINT command_receipt_fingerprint_check CHECK ((octet_length(command_fingerprint) = 32))
);


--
-- Name: community_invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_invitation (
    invitation_id uuid NOT NULL,
    sponsoring_membership_id uuid NOT NULL,
    target_index text NOT NULL,
    expires_at bigint NOT NULL,
    status text NOT NULL,
    admitted_membership_id uuid,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    revision bigint NOT NULL,
    CONSTRAINT community_invitation_revision_check CHECK ((revision > 0)),
    CONSTRAINT community_invitation_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'accepted'::text, 'revoked'::text]))),
    CONSTRAINT community_invitation_status_shape_check CHECK ((((status = 'accepted'::text) AND (admitted_membership_id IS NOT NULL)) OR ((status = ANY (ARRAY['issued'::text, 'revoked'::text])) AND (admitted_membership_id IS NULL)))),
    CONSTRAINT community_invitation_target_check CHECK (((length(target_index) = 64) AND (target_index ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT community_invitation_time_check CHECK (((expires_at > created_at) AND (updated_at >= created_at)))
);


--
-- Name: community_invitation_credential; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_invitation_credential (
    token_hash text NOT NULL,
    invitation_id uuid NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    consumed_at bigint,
    revoked_at bigint,
    CONSTRAINT community_invitation_credential_hash_check CHECK (((length(token_hash) = 64) AND (token_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT community_invitation_credential_terminal_check CHECK ((NOT ((consumed_at IS NOT NULL) AND (revoked_at IS NOT NULL)))),
    CONSTRAINT community_invitation_credential_time_check CHECK ((expires_at > created_at))
);


--
-- Name: community_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_membership (
    membership_id uuid NOT NULL,
    active_principal_id uuid,
    status text NOT NULL,
    origin_kind text NOT NULL,
    admission_invitation_id uuid,
    sponsoring_membership_id uuid,
    admitted_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    revision bigint NOT NULL,
    retained_alias text,
    CONSTRAINT community_membership_origin_shape_check CHECK ((((origin_kind = 'founder'::text) AND (admission_invitation_id IS NULL) AND (sponsoring_membership_id IS NULL)) OR ((origin_kind = 'invitation'::text) AND (admission_invitation_id IS NOT NULL) AND (sponsoring_membership_id IS NOT NULL) AND (sponsoring_membership_id <> membership_id)))),
    CONSTRAINT community_membership_principal_shape_check CHECK ((((status = ANY (ARRAY['active'::text, 'suspended'::text])) AND (active_principal_id IS NOT NULL) AND (retained_alias IS NULL)) OR ((status = 'withdrawn'::text) AND (retained_alias IS NULL)) OR ((status = 'redacted'::text) AND (active_principal_id IS NULL) AND (retained_alias IS NOT NULL)))),
    CONSTRAINT community_membership_revision_check CHECK ((revision > 0)),
    CONSTRAINT community_membership_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'withdrawn'::text, 'redacted'::text]))),
    CONSTRAINT community_membership_time_check CHECK ((updated_at >= admitted_at))
);


--
-- Name: completed_game_detached_alias; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.completed_game_detached_alias (
    game_id uuid NOT NULL,
    subject_ref_sha256 text NOT NULL,
    detached_alias text NOT NULL,
    alias_version smallint NOT NULL,
    CONSTRAINT completed_game_detached_alias_shape_check CHECK ((detached_alias ~ '^Archived player [0-9a-f]{20}$'::text)),
    CONSTRAINT completed_game_detached_alias_subject_ref_check CHECK ((subject_ref_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT completed_game_detached_alias_version_check CHECK ((alias_version = 1))
);


--
-- Name: day_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_event (
    game_id uuid NOT NULL,
    event_id text NOT NULL,
    definition jsonb NOT NULL,
    state text NOT NULL,
    phase_id text,
    opened_at bigint,
    locked_at bigint,
    cancelled_reason text,
    decision jsonb,
    winner_slots jsonb DEFAULT '[]'::jsonb NOT NULL,
    reward_keys_applied jsonb DEFAULT '[]'::jsonb NOT NULL,
    scheduled_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    open_due_at bigint,
    open_observed_at bigint,
    lock_due_at bigint,
    lock_observed_at bigint,
    auto_seed bigint,
    resolution_evidence jsonb,
    CONSTRAINT day_event_auto_seed_check CHECK (((auto_seed IS NULL) OR (auto_seed >= 0))),
    CONSTRAINT day_event_definition_check CHECK ((jsonb_typeof(definition) = 'object'::text)),
    CONSTRAINT day_event_lock_observation_check CHECK ((((lock_due_at IS NULL) = (lock_observed_at IS NULL)) AND ((lock_due_at IS NULL) OR (lock_observed_at >= lock_due_at)))),
    CONSTRAINT day_event_open_observation_check CHECK ((((open_due_at IS NULL) = (open_observed_at IS NULL)) AND ((open_due_at IS NULL) OR (open_observed_at >= open_due_at)))),
    CONSTRAINT day_event_resolution_evidence_check CHECK (((resolution_evidence IS NULL) OR (jsonb_typeof(resolution_evidence) = 'object'::text))),
    CONSTRAINT day_event_reward_keys_check CHECK ((jsonb_typeof(reward_keys_applied) = 'array'::text)),
    CONSTRAINT day_event_state_check CHECK ((state = ANY (ARRAY['scheduled'::text, 'open'::text, 'locked'::text, 'resolved'::text, 'cancelled'::text]))),
    CONSTRAINT day_event_winner_slots_check CHECK ((jsonb_typeof(winner_slots) = 'array'::text))
);


--
-- Name: day_event_narrative; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_event_narrative (
    game_id uuid NOT NULL,
    event_id text NOT NULL,
    lifecycle text NOT NULL,
    template_key text NOT NULL,
    template_hash text NOT NULL,
    channel_id text NOT NULL,
    body_template text,
    source_seq bigint,
    rendered_body text,
    status text DEFAULT 'armed'::text NOT NULL,
    published_seq bigint,
    body_template_private jsonb,
    rendered_body_private jsonb,
    body_template_private_kid text GENERATED ALWAYS AS ((body_template_private ->> 'kid'::text)) STORED,
    rendered_body_private_kid text GENERATED ALWAYS AS ((rendered_body_private ->> 'kid'::text)) STORED,
    CONSTRAINT day_event_narrative_channel_check CHECK (((channel_id = 'main'::text) OR (channel_id ~~ 'private:event:_%'::text))),
    CONSTRAINT day_event_narrative_delivery_check CHECK ((((status = 'armed'::text) AND (source_seq IS NULL) AND (rendered_body IS NULL) AND (rendered_body_private IS NULL) AND (published_seq IS NULL)) OR ((status = 'pending'::text) AND (source_seq IS NOT NULL) AND (((channel_id = 'main'::text) AND (rendered_body IS NOT NULL)) OR ((channel_id ~~ 'private:event:_%'::text) AND (rendered_body_private IS NOT NULL))) AND (published_seq IS NULL)) OR ((status = 'published'::text) AND (source_seq IS NOT NULL) AND (((channel_id = 'main'::text) AND (rendered_body IS NOT NULL)) OR ((channel_id ~~ 'private:event:_%'::text) AND (rendered_body_private IS NOT NULL))) AND (published_seq IS NOT NULL)))),
    CONSTRAINT day_event_narrative_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['opened'::text, 'locked'::text, 'resolved'::text, 'cancelled'::text]))),
    CONSTRAINT day_event_narrative_rendered_private_kid_shape CHECK ((((rendered_body_private IS NULL) AND (rendered_body_private_kid IS NULL)) OR ((rendered_body_private IS NOT NULL) AND (rendered_body_private_kid IS NOT NULL)))),
    CONSTRAINT day_event_narrative_rendered_storage_check CHECK ((((rendered_body IS NULL) AND (rendered_body_private IS NULL)) OR ((channel_id = 'main'::text) AND (rendered_body IS NOT NULL) AND (rendered_body_private IS NULL)) OR ((channel_id ~~ 'private:event:_%'::text) AND (rendered_body IS NULL) AND (rendered_body_private IS NOT NULL)))),
    CONSTRAINT day_event_narrative_status_check CHECK ((status = ANY (ARRAY['armed'::text, 'pending'::text, 'published'::text]))),
    CONSTRAINT day_event_narrative_template_hash_check CHECK ((template_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT day_event_narrative_template_private_kid_shape CHECK ((((body_template_private IS NULL) AND (body_template_private_kid IS NULL)) OR ((body_template_private IS NOT NULL) AND (body_template_private_kid IS NOT NULL)))),
    CONSTRAINT day_event_narrative_template_storage_check CHECK ((((channel_id = 'main'::text) AND (body_template IS NOT NULL) AND (btrim(body_template) <> ''::text) AND (body_template_private IS NULL)) OR ((channel_id ~~ 'private:event:_%'::text) AND (body_template IS NULL) AND (body_template_private IS NOT NULL))))
);


--
-- Name: day_event_participation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_event_participation (
    game_id uuid NOT NULL,
    event_id text NOT NULL,
    actor_slot text NOT NULL,
    payload jsonb NOT NULL,
    phase_id text NOT NULL,
    submitted_seq bigint NOT NULL,
    CONSTRAINT day_event_participation_payload_check CHECK ((jsonb_typeof(payload) = 'object'::text))
);


--
-- Name: day_event_schedule_work; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_event_schedule_work (
    game_id uuid NOT NULL,
    next_due_at bigint,
    wake_seq bigint DEFAULT 0 NOT NULL,
    updated_seq bigint NOT NULL,
    auto_resolve_pending boolean DEFAULT false NOT NULL,
    narrative_pending boolean DEFAULT false NOT NULL,
    CONSTRAINT day_event_schedule_work_updated_check CHECK ((updated_seq >= wake_seq)),
    CONSTRAINT day_event_schedule_work_wake_check CHECK ((wake_seq >= 0))
);


--
-- Name: day_event_scheduler_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_event_scheduler_state (
    game_id uuid NOT NULL,
    last_observed_wake_seq bigint DEFAULT 0 NOT NULL,
    lease_owner uuid,
    lease_until bigint,
    retry_not_before bigint,
    last_attempt_at bigint,
    last_success_at bigint,
    last_failure_at bigint,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    total_attempts bigint DEFAULT 0 NOT NULL,
    total_successes bigint DEFAULT 0 NOT NULL,
    last_error text,
    CONSTRAINT day_event_scheduler_state_attempt_check CHECK (((total_attempts >= 0) AND (total_successes >= 0) AND (total_successes <= total_attempts))),
    CONSTRAINT day_event_scheduler_state_failure_check CHECK ((consecutive_failures >= 0)),
    CONSTRAINT day_event_scheduler_state_lease_check CHECK (((lease_owner IS NULL) = (lease_until IS NULL))),
    CONSTRAINT day_event_scheduler_state_wake_check CHECK ((last_observed_wake_seq >= 0))
);


--
-- Name: day_program; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_program (
    game_id uuid NOT NULL,
    program_id text NOT NULL,
    version bigint NOT NULL,
    display_name text NOT NULL,
    theme_ref text,
    content_hash text NOT NULL,
    document jsonb NOT NULL,
    attached_seq bigint NOT NULL,
    CONSTRAINT day_program_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT day_program_display_name_check CHECK ((btrim(display_name) <> ''::text)),
    CONSTRAINT day_program_document_check CHECK ((jsonb_typeof(document) = 'object'::text)),
    CONSTRAINT day_program_version_check CHECK ((version > 0))
);


--
-- Name: day_vote_outcome; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_vote_outcome (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    source_seq bigint NOT NULL,
    event_index integer NOT NULL,
    status text NOT NULL,
    winner_slot text,
    contenders jsonb NOT NULL,
    tallies jsonb NOT NULL,
    votes jsonb NOT NULL,
    weights jsonb NOT NULL,
    majority double precision,
    thresholds jsonb NOT NULL,
    total_weight double precision NOT NULL,
    tiebreak text,
    reason text
);


--
-- Name: delayed_death_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delayed_death_queue (
    game_id uuid NOT NULL,
    queue_id text NOT NULL,
    target_slot text NOT NULL,
    cause text NOT NULL,
    effect text NOT NULL,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: discussion_area; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_area (
    area_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    created_seq bigint NOT NULL
);


--
-- Name: discussion_post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_post (
    source_seq bigint NOT NULL,
    topic_id uuid NOT NULL,
    body text NOT NULL,
    created_seq bigint NOT NULL,
    author_profile_id uuid,
    created_at bigint DEFAULT 0 NOT NULL,
    quotations jsonb DEFAULT '[]'::jsonb NOT NULL,
    mentions jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: discussion_topic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_topic (
    topic_id uuid NOT NULL,
    area_id uuid NOT NULL,
    title text NOT NULL,
    post_count bigint DEFAULT 0 NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    moderated_seq bigint,
    author_profile_id uuid,
    posting_state text DEFAULT 'open'::text NOT NULL,
    visibility text DEFAULT 'visible'::text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    created_at bigint DEFAULT 0 NOT NULL,
    updated_at bigint DEFAULT 0 NOT NULL,
    last_post_seq bigint,
    last_post_at bigint,
    CONSTRAINT discussion_topic_posting_state_check CHECK ((posting_state = ANY (ARRAY['open'::text, 'locked'::text]))),
    CONSTRAINT discussion_topic_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);


--
-- Name: engine_snapshot_checkpoint; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.engine_snapshot_checkpoint (
    game_id uuid NOT NULL,
    stream_seq bigint NOT NULL,
    result_version smallint NOT NULL,
    snapshot jsonb NOT NULL,
    last_resolution jsonb
);


--
-- Name: investigation_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investigation_memory (
    game_id uuid NOT NULL,
    investigator_slot text NOT NULL,
    target_slot text NOT NULL,
    mode text NOT NULL,
    memory_scope text DEFAULT 'Target'::text NOT NULL,
    source_action text NOT NULL,
    template_id text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    result_private jsonb NOT NULL,
    result_private_kid text GENERATED ALWAYS AS ((result_private ->> 'kid'::text)) STORED,
    CONSTRAINT investigation_memory_result_private_kid_present CHECK ((result_private_kid IS NOT NULL))
);


--
-- Name: player_info_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_info_result (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    kind text NOT NULL,
    actor_slot text NOT NULL,
    target_slot text NOT NULL,
    source_action text NOT NULL,
    template_id text NOT NULL,
    result_private jsonb NOT NULL,
    result_private_kid text GENERATED ALWAYS AS ((result_private ->> 'kid'::text)) STORED,
    CONSTRAINT player_info_result_private_kid_present CHECK ((result_private_kid IS NOT NULL))
);


--
-- Name: player_investigation_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_investigation_result (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    mode text NOT NULL,
    target_slot text NOT NULL,
    result_private jsonb NOT NULL,
    result_private_kid text GENERATED ALWAYS AS ((result_private ->> 'kid'::text)) STORED,
    CONSTRAINT player_investigation_result_private_kid_present CHECK ((result_private_kid IS NOT NULL))
);


--
-- Name: private_channel_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_channel_member (
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    kind text NOT NULL,
    slot_id text NOT NULL,
    source text NOT NULL,
    private jsonb NOT NULL,
    private_kid text GENERATED ALWAYS AS ((private ->> 'kid'::text)) STORED,
    CONSTRAINT private_channel_member_private_kid_present CHECK ((private_kid IS NOT NULL))
);


--
-- Name: slot_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_state (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    alive boolean DEFAULT true NOT NULL,
    role_revealed boolean DEFAULT false NOT NULL,
    alignment_revealed boolean DEFAULT false NOT NULL,
    status text DEFAULT 'alive'::text NOT NULL,
    private jsonb,
    private_kid text GENERATED ALWAYS AS ((private ->> 'kid'::text)) STORED,
    CONSTRAINT slot_state_private_kid_shape CHECK ((((private IS NULL) AND (private_kid IS NULL)) OR ((private IS NOT NULL) AND (private_kid IS NOT NULL))))
);


--
-- Name: thread_view; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_view (
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    stream_seq bigint NOT NULL,
    channel_id text NOT NULL,
    author_kind text NOT NULL,
    author_slot_id text,
    phase_id text,
    occurred_at bigint NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    body text,
    body_private jsonb,
    quotations jsonb DEFAULT '[]'::jsonb NOT NULL,
    body_private_kid text GENERATED ALWAYS AS ((body_private ->> 'kid'::text)) STORED,
    embed jsonb,
    CONSTRAINT thread_view_author_shape CHECK ((((author_kind = 'slot'::text) AND (author_slot_id IS NOT NULL) AND (btrim(author_slot_id) <> ''::text)) OR ((author_kind = ANY (ARRAY['host_narrator'::text, 'system'::text])) AND (author_slot_id IS NULL)))),
    CONSTRAINT thread_view_body_private_kid_shape CHECK ((((body_private IS NULL) AND (body_private_kid IS NULL)) OR ((body_private IS NOT NULL) AND (body_private_kid IS NOT NULL)))),
    CONSTRAINT thread_view_body_storage CHECK ((((channel_id = 'main'::text) AND (body IS NOT NULL) AND (body_private IS NULL)) OR ((channel_id <> 'main'::text) AND (body IS NULL) AND (body_private IS NOT NULL))))
);


--
-- Name: event_direct_key_reference; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.event_direct_key_reference AS
 SELECT 'investigation_memory.result_private'::text AS surface,
    investigation_memory.result_private_kid AS kid
   FROM public.investigation_memory
UNION ALL
 SELECT 'player_info_result.result_private'::text AS surface,
    player_info_result.result_private_kid AS kid
   FROM public.player_info_result
UNION ALL
 SELECT 'player_investigation_result.result_private'::text AS surface,
    player_investigation_result.result_private_kid AS kid
   FROM public.player_investigation_result
UNION ALL
 SELECT 'private_channel_member.private'::text AS surface,
    private_channel_member.private_kid AS kid
   FROM public.private_channel_member
UNION ALL
 SELECT 'slot_state.private'::text AS surface,
    slot_state.private_kid AS kid
   FROM public.slot_state
  WHERE (slot_state.private_kid IS NOT NULL)
UNION ALL
 SELECT 'thread_view.body_private'::text AS surface,
    thread_view.body_private_kid AS kid
   FROM public.thread_view
  WHERE (thread_view.body_private_kid IS NOT NULL)
UNION ALL
 SELECT 'day_event_narrative.body_template_private'::text AS surface,
    day_event_narrative.body_template_private_kid AS kid
   FROM public.day_event_narrative
  WHERE (day_event_narrative.body_template_private_kid IS NOT NULL)
UNION ALL
 SELECT 'day_event_narrative.rendered_body_private'::text AS surface,
    day_event_narrative.rendered_body_private_kid AS kid
   FROM public.day_event_narrative
  WHERE (day_event_narrative.rendered_body_private_kid IS NOT NULL)
UNION ALL
 SELECT 'auth_delivery_intent.credential_envelope'::text AS surface,
    auth_delivery_intent.credential_envelope_kid AS kid
   FROM public.auth_delivery_intent
  WHERE (auth_delivery_intent.credential_envelope_kid IS NOT NULL);


--
-- Name: VIEW event_direct_key_reference; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.event_direct_key_reference IS 'Exact indexed census of every persisted runtime-KEK direct envelope';


--
-- Name: event_direct_key_sentinel; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_direct_key_sentinel (
    kid text NOT NULL,
    sentinel_version smallint,
    sentinel_nonce bytea,
    sentinel_ciphertext bytea,
    lifecycle text DEFAULT 'writable'::text NOT NULL,
    retirement_target_kid text,
    retirement_started_at timestamp with time zone,
    rehearsal_token uuid,
    rehearsed_at timestamp with time zone,
    retired_at timestamp with time zone,
    CONSTRAINT event_direct_key_sentinel_ciphertext_check CHECK ((octet_length(sentinel_ciphertext) = 56)),
    CONSTRAINT event_direct_key_sentinel_kid_check CHECK (((octet_length(kid) >= 1) AND (octet_length(kid) <= 128) AND (kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'::text))),
    CONSTRAINT event_direct_key_sentinel_lifecycle_check CHECK ((((lifecycle = 'writable'::text) AND (retirement_target_kid IS NULL) AND (retirement_started_at IS NULL) AND (rehearsal_token IS NULL) AND (rehearsed_at IS NULL) AND (retired_at IS NULL) AND (sentinel_version IS NOT NULL) AND (sentinel_nonce IS NOT NULL) AND (sentinel_ciphertext IS NOT NULL)) OR ((lifecycle = 'retiring'::text) AND (retirement_target_kid IS NOT NULL) AND (retirement_target_kid <> kid) AND (retirement_started_at IS NOT NULL) AND (retired_at IS NULL) AND (sentinel_version IS NOT NULL) AND (sentinel_nonce IS NOT NULL) AND (sentinel_ciphertext IS NOT NULL) AND (((rehearsal_token IS NULL) AND (rehearsed_at IS NULL)) OR ((rehearsal_token IS NOT NULL) AND (rehearsed_at IS NOT NULL)))) OR ((lifecycle = 'retired'::text) AND (retirement_target_kid IS NOT NULL) AND (retirement_target_kid <> kid) AND (retirement_started_at IS NOT NULL) AND (rehearsal_token IS NOT NULL) AND (rehearsed_at IS NOT NULL) AND (retired_at IS NOT NULL) AND (sentinel_version IS NULL) AND (sentinel_nonce IS NULL) AND (sentinel_ciphertext IS NULL)))),
    CONSTRAINT event_direct_key_sentinel_nonce_check CHECK ((octet_length(sentinel_nonce) = 24)),
    CONSTRAINT event_direct_key_sentinel_retirement_target_kid_check CHECK (((retirement_target_kid IS NULL) OR ((octet_length(retirement_target_kid) >= 1) AND (octet_length(retirement_target_kid) <= 128) AND (retirement_target_kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'::text)))),
    CONSTRAINT event_direct_key_sentinel_version_check CHECK ((sentinel_version = 1))
);


--
-- Name: TABLE event_direct_key_sentinel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.event_direct_key_sentinel IS 'Authenticated runtime-KEK registry with forward-only writable, retiring, and retired tombstone custody';


--
-- Name: COLUMN event_direct_key_sentinel.rehearsal_token; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.event_direct_key_sentinel.rehearsal_token IS 'Durable evidence that the retiring KID was absent from the process keyring and had no verified live references';


--
-- Name: event_stream_key_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_stream_key_state (
    stream_id uuid NOT NULL,
    active_epoch bigint NOT NULL,
    CONSTRAINT event_stream_key_state_active_epoch_check CHECK ((active_epoch > 0))
);


--
-- Name: event_stream_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_stream_keys (
    stream_id uuid NOT NULL,
    key_epoch bigint NOT NULL,
    wrap_version smallint NOT NULL,
    wrap_kid text NOT NULL,
    wrap_nonce bytea NOT NULL,
    wrapped_dek bytea NOT NULL,
    CONSTRAINT event_stream_keys_key_epoch_check CHECK ((key_epoch > 0)),
    CONSTRAINT event_stream_keys_wrap_kid_check CHECK (((octet_length(wrap_kid) >= 1) AND (octet_length(wrap_kid) <= 128) AND (wrap_kid ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'::text))),
    CONSTRAINT event_stream_keys_wrap_nonce_check CHECK ((octet_length(wrap_nonce) = 24)),
    CONSTRAINT event_stream_keys_wrap_version_check CHECK ((wrap_version = 1)),
    CONSTRAINT event_stream_keys_wrapped_dek_check CHECK ((octet_length(wrapped_dek) = 48))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    seq bigint NOT NULL,
    stream_id uuid NOT NULL,
    stream_seq bigint NOT NULL,
    kind text NOT NULL,
    version smallint NOT NULL,
    occurred_at bigint NOT NULL,
    sealed_version smallint NOT NULL,
    sealed_nonce bytea NOT NULL,
    sealed_body bytea NOT NULL,
    stream_key_epoch bigint NOT NULL,
    CONSTRAINT events_sealed_body_shape CHECK (((sealed_version = 3) AND (stream_key_epoch > 0) AND (octet_length(sealed_nonce) = 24) AND (octet_length(sealed_body) >= 16)))
);


--
-- Name: events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_seq_seq OWNED BY public.events.seq;


--
-- Name: external_identity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_identity (
    provider text NOT NULL,
    subject text NOT NULL,
    principal_id uuid NOT NULL,
    display_label text,
    created_at bigint NOT NULL,
    last_seen_at bigint NOT NULL,
    method_id uuid NOT NULL,
    method_kind text GENERATED ALWAYS AS ('workos'::text) STORED,
    CONSTRAINT external_identity_provider_check CHECK ((length(TRIM(BOTH FROM provider)) > 0)),
    CONSTRAINT external_identity_seen_check CHECK ((last_seen_at >= created_at)),
    CONSTRAINT external_identity_subject_check CHECK ((length(TRIM(BOTH FROM subject)) > 0))
);


--
-- Name: game_authority; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_authority (
    game_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    role text NOT NULL
);


--
-- Name: game_cohost_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_cohost_policy (
    game_id uuid NOT NULL,
    denied text[] DEFAULT '{}'::text[] NOT NULL,
    source_seq bigint NOT NULL
);


--
-- Name: game_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_index (
    game_id uuid NOT NULL,
    pack_key text NOT NULL,
    status text NOT NULL,
    phase_id text,
    created_seq bigint NOT NULL,
    started_seq bigint,
    completed_seq bigint,
    updated_seq bigint NOT NULL,
    pack_version bigint NOT NULL,
    pack_content_hash text NOT NULL,
    CONSTRAINT game_index_pack_content_hash_check CHECK ((pack_content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT game_index_pack_key_check CHECK (((length(pack_key) > 0) AND (pack_key = btrim(pack_key)))),
    CONSTRAINT game_index_pack_version_check CHECK (((pack_version >= 1) AND (pack_version <= '4294967295'::bigint))),
    CONSTRAINT game_index_status_check CHECK ((status = ANY (ARRAY['setup'::text, 'active'::text, 'completed'::text])))
);


--
-- Name: game_invitation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_invitation (
    token_hash text NOT NULL,
    principal_id uuid NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    redeemed_at bigint,
    redeemed_session_token_hash text,
    invited_by_principal_id uuid NOT NULL,
    revoked_at bigint,
    game uuid,
    account_id text NOT NULL
);


--
-- Name: game_persona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona (
    game_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    registered_seq bigint NOT NULL
);


--
-- Name: game_persona_name_claim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona_name_claim (
    game_id uuid NOT NULL,
    normalized_name text NOT NULL,
    persona_id uuid NOT NULL,
    first_claimed_seq bigint NOT NULL
);


--
-- Name: game_persona_name_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona_name_history (
    game_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    effective_seq bigint NOT NULL,
    public_name text NOT NULL
);


--
-- Name: game_persona_public; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona_public (
    game_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    current_public_name text NOT NULL,
    registered_seq bigint NOT NULL,
    renamed_seq bigint
);


--
-- Name: game_persona_redaction; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona_redaction (
    game_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    replacement_public_name text NOT NULL,
    redacted_at bigint NOT NULL
);


--
-- Name: game_persona_subject_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_persona_subject_binding (
    game_id uuid NOT NULL,
    persona_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    current_claim_id uuid,
    lifecycle text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT game_persona_subject_binding_lifecycle_check CHECK ((((lifecycle = 'active'::text) AND (current_claim_id IS NOT NULL)) OR ((lifecycle = 'redacted'::text) AND (current_claim_id IS NULL))))
);


--
-- Name: game_private_citation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_private_citation (
    game_id uuid NOT NULL,
    quoted_source_seq bigint NOT NULL,
    quoting_source_seq bigint NOT NULL,
    occurred_at bigint NOT NULL
);


--
-- Name: game_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_result (
    game_id uuid NOT NULL,
    winner text NOT NULL,
    reason text NOT NULL,
    metadata jsonb NOT NULL,
    phase_id text NOT NULL,
    source_seq bigint NOT NULL,
    event_index integer NOT NULL
);


--
-- Name: game_thread_visibility_change; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_thread_visibility_change (
    id bigint NOT NULL,
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    visibility text NOT NULL,
    moderation_seq bigint NOT NULL,
    CONSTRAINT game_thread_visibility_change_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);


--
-- Name: game_thread_visibility_change_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.game_thread_visibility_change_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: game_thread_visibility_change_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.game_thread_visibility_change_id_seq OWNED BY public.game_thread_visibility_change.id;


--
-- Name: host_phase_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_phase_control (
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    stream_seq bigint NOT NULL,
    prompt_id text NOT NULL,
    source_phase_id text NOT NULL,
    target_phase_id text NOT NULL,
    reason text NOT NULL,
    skipped_phase_id text,
    occurred_at bigint NOT NULL
);


--
-- Name: host_prompt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_prompt (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    prompt_id text NOT NULL,
    kind text NOT NULL,
    subject_slot text,
    reason text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decision jsonb,
    resolved_at bigint,
    public_resolution jsonb
);


--
-- Name: identity_lifecycle_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_lifecycle_audit (
    id bigint NOT NULL,
    event_at bigint NOT NULL,
    event_kind text NOT NULL,
    actor_principal_id uuid,
    principal_id uuid,
    redacted_actor_alias text,
    redacted_principal_alias text,
    token_hash text,
    related_token_hash text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: identity_lifecycle_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_lifecycle_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_lifecycle_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_lifecycle_audit_id_seq OWNED BY public.identity_lifecycle_audit.id;


--
-- Name: media_upload_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.media_upload_ledger (
    upload_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    encoded_bytes bigint NOT NULL,
    content_id text,
    created_at bigint NOT NULL,
    CONSTRAINT media_upload_ledger_encoded_bytes_check CHECK ((encoded_bytes > 0))
);


--
-- Name: member_inbox_cursor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_inbox_cursor (
    principal_id uuid NOT NULL,
    read_through_seq bigint DEFAULT 0 NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT member_inbox_cursor_read_through_seq_check CHECK ((read_through_seq >= 0))
);


--
-- Name: member_inbox_item; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_inbox_item (
    principal_id uuid NOT NULL,
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    reason text NOT NULL,
    occurred_at bigint NOT NULL,
    CONSTRAINT member_inbox_item_reason_check CHECK ((reason = ANY (ARRAY['watch'::text, 'mention'::text])))
);


--
-- Name: member_lifecycle_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_lifecycle_event (
    principal_id uuid NOT NULL,
    seq bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at bigint NOT NULL,
    subject_id uuid,
    CONSTRAINT member_lifecycle_event_kind_check CHECK ((kind = ANY (ARRAY['MemberDeactivated'::text, 'MemberErasureRequested'::text, 'MemberCredentialsErased'::text, 'MemberAuthorshipPseudonymized'::text, 'MemberPersonalExportRecorded'::text]))),
    CONSTRAINT member_lifecycle_event_seq_check CHECK ((seq > 0))
);


--
-- Name: member_lifecycle_projection; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_lifecycle_projection (
    principal_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL,
    deactivated_at bigint,
    erasure_requested_at bigint,
    credentials_erased_at bigint,
    authorship_pseudonymized_at bigint,
    personal_export_recorded_at bigint,
    pseudonym text,
    subject_id uuid,
    CONSTRAINT member_lifecycle_projection_seq_check CHECK ((last_seq >= 0)),
    CONSTRAINT member_lifecycle_projection_status_check CHECK ((status = ANY (ARRAY['active'::text, 'deactivated'::text, 'erasure_in_progress'::text, 'erased'::text])))
);


--
-- Name: member_personal_export; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_personal_export (
    export_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    requested_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    envelope jsonb NOT NULL,
    recorded_seq bigint NOT NULL,
    subject_id uuid NOT NULL,
    CONSTRAINT member_personal_export_envelope_shape CHECK (((jsonb_typeof(envelope) = 'object'::text) AND ((envelope ->> 'scheme'::text) = 'fmarch-subject-claim-v1'::text) AND ((envelope ->> 'alg'::text) = 'XChaCha20Poly1305'::text) AND (jsonb_typeof((envelope -> 'nonce'::text)) = 'string'::text) AND (jsonb_typeof((envelope -> 'ciphertext'::text)) = 'string'::text))),
    CONSTRAINT member_personal_export_expiry_check CHECK ((expires_at > requested_at)),
    CONSTRAINT member_personal_export_seq_check CHECK ((recorded_seq > 0))
);


--
-- Name: member_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.member_profile (
    profile_id uuid NOT NULL,
    active_principal_id uuid,
    handle_hmac bytea,
    lifecycle text DEFAULT 'active'::text NOT NULL,
    redacted_alias text,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    revision bigint NOT NULL,
    subject_id uuid NOT NULL,
    current_claim_id uuid,
    CONSTRAINT member_profile_active_redacted_shape_check CHECK ((((lifecycle = 'active'::text) AND (active_principal_id IS NOT NULL) AND (current_claim_id IS NOT NULL) AND (handle_hmac IS NOT NULL) AND (octet_length(handle_hmac) = 32) AND (redacted_alias IS NULL)) OR ((lifecycle = 'redacted'::text) AND (active_principal_id IS NULL) AND (current_claim_id IS NULL) AND (handle_hmac IS NULL) AND (redacted_alias IS NOT NULL)))),
    CONSTRAINT member_profile_lifecycle_check CHECK ((lifecycle = ANY (ARRAY['active'::text, 'redacted'::text])))
);


--
-- Name: membership_ancestry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.membership_ancestry (
    ancestor_membership_id uuid NOT NULL,
    descendant_membership_id uuid NOT NULL,
    depth integer NOT NULL,
    CONSTRAINT membership_ancestry_depth_check CHECK ((depth >= 0)),
    CONSTRAINT membership_ancestry_self_shape_check CHECK ((((depth = 0) AND (ancestor_membership_id = descendant_membership_id)) OR ((depth > 0) AND (ancestor_membership_id <> descendant_membership_id))))
);


--
-- Name: moderation_case; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_case (
    case_id uuid NOT NULL,
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    status text NOT NULL,
    report_count bigint DEFAULT 0 NOT NULL,
    opened_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    action_reason text,
    CONSTRAINT moderation_case_report_count_check CHECK ((report_count >= 0)),
    CONSTRAINT moderation_case_status_check CHECK ((status = ANY (ARRAY['open'::text, 'hidden'::text, 'dismissed'::text, 'restored'::text])))
);


--
-- Name: moderation_case_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_case_history (
    source_seq bigint NOT NULL,
    case_id uuid NOT NULL,
    event_kind text NOT NULL,
    actor_principal_id uuid NOT NULL,
    reason text,
    occurred_at bigint NOT NULL
);


--
-- Name: moderation_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_report (
    report_id uuid NOT NULL,
    case_id uuid NOT NULL,
    reporter_principal_id uuid NOT NULL,
    reason_family text NOT NULL,
    details text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    submitted_seq bigint NOT NULL,
    submitted_at bigint NOT NULL,
    CONSTRAINT moderation_report_reason_family_check CHECK ((reason_family = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'sexual_content'::text, 'self_harm'::text, 'mention_abuse'::text, 'other'::text])))
);


--
-- Name: moderation_target_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.moderation_target_state (
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    visibility text NOT NULL,
    reason text NOT NULL,
    moderator_principal_id uuid NOT NULL,
    updated_seq bigint NOT NULL,
    CONSTRAINT moderation_target_state_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);


--
-- Name: pack_artifact; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pack_artifact (
    content_hash text NOT NULL,
    pack_key text NOT NULL,
    pack_version bigint NOT NULL,
    artifact_schema_version smallint NOT NULL,
    canonical_json text NOT NULL,
    CONSTRAINT pack_artifact_content_hash_check CHECK ((content_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT pack_artifact_document_check CHECK ((jsonb_typeof((canonical_json)::jsonb) = 'object'::text)),
    CONSTRAINT pack_artifact_key_check CHECK (((length(pack_key) > 0) AND (pack_key = btrim(pack_key)))),
    CONSTRAINT pack_artifact_schema_version_check CHECK ((artifact_schema_version = 1)),
    CONSTRAINT pack_artifact_version_check CHECK (((pack_version >= 1) AND (pack_version <= '4294967295'::bigint)))
);


--
-- Name: phase_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phase_state (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    deadline bigint,
    phase_opened_at bigint
);


--
-- Name: platform_principal; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_principal (
    principal_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    global_capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    CONSTRAINT platform_principal_disabled_shape_check CHECK ((((status = 'active'::text) AND (disabled_at IS NULL)) OR ((status = 'disabled'::text) AND (disabled_at IS NOT NULL)))),
    CONSTRAINT platform_principal_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text])))
);


--
-- Name: player_notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_notification (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    effect text NOT NULL,
    status text NOT NULL
);


--
-- Name: post_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_policy (
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    allow_media_only boolean DEFAULT false NOT NULL
);


--
-- Name: privacy_subject; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.privacy_subject (
    subject_id uuid NOT NULL,
    principal_id uuid,
    created_at bigint NOT NULL,
    lifecycle_state text DEFAULT 'active'::text NOT NULL,
    CONSTRAINT privacy_subject_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['active'::text, 'erasure_pending'::text, 'erased'::text])))
);


--
-- Name: profile_mute; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_mute (
    relationship_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    target_profile_id uuid NOT NULL,
    active boolean NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT profile_mute_version_check CHECK ((version > 0))
);


--
-- Name: public_citation; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_citation (
    quoted_surface_id uuid NOT NULL,
    quoted_source_seq bigint NOT NULL,
    quoting_surface_id uuid NOT NULL,
    quoting_source_seq bigint NOT NULL,
    occurred_at bigint NOT NULL
);


--
-- Name: public_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_profile (
    profile_id uuid NOT NULL,
    handle text NOT NULL,
    display_name text NOT NULL,
    bio text NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    revision bigint NOT NULL
);


--
-- Name: public_publication; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_publication (
    surface_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    body text NOT NULL,
    href text NOT NULL,
    author_profile_id uuid,
    occurred_at bigint NOT NULL,
    visible boolean DEFAULT true NOT NULL
);


--
-- Name: public_search_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_search_document (
    surface_id uuid NOT NULL,
    document_type text NOT NULL,
    source_seq bigint NOT NULL,
    title_text text NOT NULL,
    body text NOT NULL,
    href text NOT NULL,
    author_profile_id uuid,
    published_at bigint NOT NULL,
    updated_seq bigint NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, title_text), 'A'::"char") || setweight(to_tsvector('english'::regconfig, body), 'B'::"char"))) STORED,
    CONSTRAINT public_search_document_shape_check CHECK ((((document_type = ANY (ARRAY['discussion'::text, 'profile'::text, 'game'::text])) AND (source_seq = 0) AND (title_text <> ''::text)) OR ((document_type = ANY (ARRAY['discussion_post'::text, 'game_post'::text])) AND (source_seq > 0) AND (title_text = ''::text)))),
    CONSTRAINT public_search_document_type_check CHECK ((document_type = ANY (ARRAY['discussion'::text, 'discussion_post'::text, 'profile'::text, 'game'::text, 'game_post'::text])))
);


--
-- Name: public_watch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_watch (
    subscription_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    surface_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    read_through_seq bigint DEFAULT 0 NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT public_watch_read_through_seq_check CHECK ((read_through_seq >= 0))
);


--
-- Name: public_watch_period; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_watch_period (
    subscription_id uuid NOT NULL,
    started_seq bigint NOT NULL,
    ended_seq bigint,
    CONSTRAINT public_watch_period_bounds_check CHECK (((ended_seq IS NULL) OR (ended_seq > started_seq)))
);


--
-- Name: publication_surface; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.publication_surface (
    surface_id uuid NOT NULL,
    search_group text NOT NULL,
    title text NOT NULL,
    href text NOT NULL,
    visible boolean DEFAULT true NOT NULL,
    updated_seq bigint NOT NULL,
    CONSTRAINT publication_surface_search_group_check CHECK ((search_group = ANY (ARRAY['discussions'::text, 'profiles'::text, 'games'::text])))
);


--
-- Name: sheriff_badge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheriff_badge (
    game_id uuid NOT NULL,
    badge_id text NOT NULL,
    owner_slot text,
    vote_weight double precision,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    reason text NOT NULL,
    destroyed boolean NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: slot_effect; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_effect (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    effect text NOT NULL,
    source_slot text NOT NULL,
    source_action text,
    phase_id text,
    phase_kind text,
    phase_number integer,
    duration text DEFAULT 'Persistent'::text NOT NULL,
    visibility text DEFAULT 'Hidden'::text NOT NULL
);


--
-- Name: slot_occupancy_epoch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_occupancy_epoch (
    game_id uuid NOT NULL,
    occupancy_id uuid NOT NULL,
    transition_id uuid NOT NULL,
    slot_id text NOT NULL,
    persona_id uuid NOT NULL,
    began_seq bigint NOT NULL,
    ended_seq bigint,
    start_reason text NOT NULL,
    end_reason text
);


--
-- Name: slot_status_tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_status_tag (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    tag text NOT NULL
);


--
-- Name: spectator_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spectator_membership (
    game_id uuid NOT NULL,
    principal_id uuid NOT NULL
);


--
-- Name: subject_authority_binding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_authority_binding (
    singleton boolean DEFAULT true NOT NULL,
    authority_id uuid NOT NULL,
    authority_revision text NOT NULL,
    manifest_sha256 text NOT NULL,
    bound_at bigint NOT NULL,
    CONSTRAINT subject_authority_binding_manifest_check CHECK ((manifest_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT subject_authority_binding_revision_check CHECK ((length(authority_revision) > 0)),
    CONSTRAINT subject_authority_binding_singleton_check CHECK (singleton)
);


--
-- Name: subject_erasure; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_erasure (
    erasure_id uuid NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    claim_token uuid,
    claim_owner text,
    claim_expires_at bigint,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_attempt_at bigint,
    completed_at bigint,
    CONSTRAINT subject_erasure_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT subject_erasure_claim_shape_check CHECK ((((claim_token IS NULL) AND (claim_owner IS NULL) AND (claim_expires_at IS NULL)) OR ((state = 'pending'::text) AND (claim_token IS NOT NULL) AND (length(claim_owner) > 0) AND (claim_expires_at IS NOT NULL)))),
    CONSTRAINT subject_erasure_completion_shape_check CHECK ((((state = 'pending'::text) AND (completed_at IS NULL)) OR ((state = 'complete'::text) AND (completed_at IS NOT NULL) AND (claim_token IS NULL) AND (claim_owner IS NULL) AND (claim_expires_at IS NULL)))),
    CONSTRAINT subject_erasure_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'complete'::text])))
);


--
-- Name: subject_erasure_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_erasure_outbox (
    erasure_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    receipt_id uuid NOT NULL,
    replacement_alias text NOT NULL,
    key_fingerprint_sha256 text NOT NULL,
    requested_at bigint NOT NULL,
    authority_id uuid,
    authority_revision text,
    authority_manifest_sha256 text,
    payload_version smallint DEFAULT 1 NOT NULL,
    CONSTRAINT subject_erasure_outbox_alias_check CHECK ((length(replacement_alias) > 0)),
    CONSTRAINT subject_erasure_outbox_authority_check CHECK ((((authority_id IS NULL) AND (authority_revision IS NULL) AND (authority_manifest_sha256 IS NULL)) OR ((authority_id IS NOT NULL) AND (length(authority_revision) > 0) AND (authority_manifest_sha256 ~ '^[0-9a-f]{64}$'::text)))),
    CONSTRAINT subject_erasure_outbox_fingerprint_check CHECK ((key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT subject_erasure_outbox_payload_version_check CHECK ((payload_version = 1))
);


--
-- Name: subject_key_destruction_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_key_destruction_receipt (
    receipt_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    key_fingerprint_sha256 text NOT NULL,
    key_was_present boolean NOT NULL,
    destroyed_at bigint NOT NULL,
    erasure_id uuid NOT NULL,
    CONSTRAINT subject_key_destruction_receipt_fingerprint_check CHECK ((key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: subject_private_claim; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_private_claim (
    claim_id uuid NOT NULL,
    subject_id uuid NOT NULL,
    claim_kind text NOT NULL,
    scope_id uuid NOT NULL,
    scope_key text,
    envelope jsonb NOT NULL,
    created_at bigint NOT NULL,
    CONSTRAINT subject_private_claim_kind_check CHECK ((claim_kind = ANY (ARRAY['profile'::text, 'game_persona_presentation'::text]))),
    CONSTRAINT subject_private_claim_scope_check CHECK ((((claim_kind = 'profile'::text) AND (scope_key IS NULL)) OR ((claim_kind = 'game_persona_presentation'::text) AND (scope_key IS NOT NULL) AND (length(scope_key) > 0))))
);


--
-- Name: subject_tombstone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subject_tombstone (
    subject_id uuid NOT NULL,
    replacement_alias text NOT NULL,
    destroyed_at bigint NOT NULL,
    CONSTRAINT subject_tombstone_alias_check CHECK ((length(replacement_alias) > 0))
);


--
-- Name: visit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_history (
    game_id uuid NOT NULL,
    actor_slot text NOT NULL,
    target_slot text NOT NULL,
    template_id text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    visible boolean NOT NULL
);


--
-- Name: vote_ballot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_ballot (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    actor_slot text NOT NULL,
    target text NOT NULL
);


--
-- Name: workos_provider_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workos_provider_session (
    provider_session_id text NOT NULL,
    subject text NOT NULL,
    principal_id uuid NOT NULL,
    method_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at bigint NOT NULL,
    last_seen_at bigint NOT NULL,
    access_expires_at bigint NOT NULL,
    logged_out_at bigint,
    method_kind text GENERATED ALWAYS AS ('workos'::text) STORED,
    CONSTRAINT workos_provider_session_id_check CHECK ((provider_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'::text)),
    CONSTRAINT workos_provider_session_logout_shape_check CHECK ((((status = 'active'::text) AND (logged_out_at IS NULL)) OR ((status = 'logged_out'::text) AND (logged_out_at IS NOT NULL) AND (logged_out_at >= last_seen_at)))),
    CONSTRAINT workos_provider_session_status_check CHECK ((status = ANY (ARRAY['active'::text, 'logged_out'::text]))),
    CONSTRAINT workos_provider_session_subject_check CHECK ((length(TRIM(BOTH FROM subject)) > 0)),
    CONSTRAINT workos_provider_session_time_check CHECK (((last_seen_at >= created_at) AND (access_expires_at > last_seen_at)))
);


--
-- Name: workos_provider_session_tombstone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workos_provider_session_tombstone (
    provider_session_hash text NOT NULL,
    tombstoned_at bigint NOT NULL,
    reason text NOT NULL,
    CONSTRAINT workos_provider_session_tombstone_hash_check CHECK ((provider_session_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workos_provider_session_tombstone_reason_check CHECK ((reason = ANY (ARRAY['logout'::text, 'link_completed'::text, 'method_disabled'::text, 'subject_erasure'::text])))
);


--
-- Name: workos_session_exchange; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workos_session_exchange (
    provider_session_id text NOT NULL,
    access_token_hash text NOT NULL,
    exchanged_at bigint NOT NULL,
    access_expires_at bigint NOT NULL,
    linking_session_hash text,
    CONSTRAINT workos_session_exchange_assertion_hash_check CHECK ((access_token_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workos_session_exchange_expiry_check CHECK ((access_expires_at > exchanged_at)),
    CONSTRAINT workos_session_exchange_linking_session_hash_check CHECK (((linking_session_hash IS NULL) OR (linking_session_hash ~ '^[0-9a-f]{64}$'::text))),
    CONSTRAINT workos_session_exchange_provider_session_id_check CHECK ((provider_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'::text))
);


--
-- Name: workos_signing_key_tombstone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workos_signing_key_tombstone (
    signing_key_id text NOT NULL,
    retired_at bigint NOT NULL,
    retired_by_principal_id uuid NOT NULL,
    reason text NOT NULL,
    CONSTRAINT workos_signing_key_tombstone_key_shape_check CHECK ((((octet_length(signing_key_id) >= 1) AND (octet_length(signing_key_id) <= 256)) AND (signing_key_id ~ '^[!-~]+$'::text))),
    CONSTRAINT workos_signing_key_tombstone_reason_check CHECK (((reason = btrim(reason)) AND ((octet_length(reason) >= 1) AND (octet_length(reason) <= 512)) AND (reason !~ '[[:cntrl:]]'::text)))
);


--
-- Name: workos_subject_tombstone; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.workos_subject_tombstone (
    provider_subject_hash text NOT NULL,
    tombstoned_at bigint NOT NULL,
    reason text NOT NULL,
    CONSTRAINT workos_subject_tombstone_hash_check CHECK ((provider_subject_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workos_subject_tombstone_reason_check CHECK ((reason = 'subject_erasure'::text))
);


--
-- Name: events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN seq SET DEFAULT nextval('public.events_seq_seq'::regclass);


--
-- Name: game_thread_visibility_change id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_thread_visibility_change ALTER COLUMN id SET DEFAULT nextval('public.game_thread_visibility_change_id_seq'::regclass);


--
-- Name: identity_lifecycle_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_lifecycle_audit ALTER COLUMN id SET DEFAULT nextval('public.identity_lifecycle_audit_id_seq'::regclass);


--
-- Name: action_counter action_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_counter
    ADD CONSTRAINT action_counter_pkey PRIMARY KEY (game_id, slot_id, counter_id);


--
-- Name: action_grant action_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_grant
    ADD CONSTRAINT action_grant_pkey PRIMARY KEY (game_id, slot_id, grant_id, source_slot, source_action, phase_id);


--
-- Name: action_history action_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_history
    ADD CONSTRAINT action_history_pkey PRIMARY KEY (game_id, slot_id, template_id, phase_id);


--
-- Name: action_submission action_submission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_submission
    ADD CONSTRAINT action_submission_pkey PRIMARY KEY (game_id, action_id);


--
-- Name: auth_account auth_account_method_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_method_id_key UNIQUE (method_id);


--
-- Name: auth_account auth_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_pkey PRIMARY KEY (account_id);


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_pkey PRIMARY KEY (recovery_id);


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_credential_attempt auth_credential_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credential_attempt
    ADD CONSTRAINT auth_credential_attempt_pkey PRIMARY KEY (scope_hash);


--
-- Name: auth_delivery_intent auth_delivery_intent_credential_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_credential_hash_key UNIQUE (credential_hash);


--
-- Name: auth_delivery_intent auth_delivery_intent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_pkey PRIMARY KEY (delivery_id);


--
-- Name: auth_registration_attempt auth_registration_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_registration_attempt
    ADD CONSTRAINT auth_registration_attempt_pkey PRIMARY KEY (scope_hash);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (token_hash);


--
-- Name: auth_websocket_ticket auth_websocket_ticket_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_websocket_ticket
    ADD CONSTRAINT auth_websocket_ticket_pkey PRIMARY KEY (token_hash);


--
-- Name: authentication_method authentication_method_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authentication_method
    ADD CONSTRAINT authentication_method_identity_key UNIQUE (method_id, principal_id, kind);


--
-- Name: authentication_method authentication_method_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authentication_method
    ADD CONSTRAINT authentication_method_pkey PRIMARY KEY (method_id);


--
-- Name: command_receipt command_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipt
    ADD CONSTRAINT command_receipt_pkey PRIMARY KEY (principal_id, command_id);


--
-- Name: community_invitation community_invitation_admitted_membership_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation
    ADD CONSTRAINT community_invitation_admitted_membership_id_key UNIQUE (admitted_membership_id);


--
-- Name: community_invitation_credential community_invitation_credential_invitation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation_credential
    ADD CONSTRAINT community_invitation_credential_invitation_id_key UNIQUE (invitation_id);


--
-- Name: community_invitation_credential community_invitation_credential_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation_credential
    ADD CONSTRAINT community_invitation_credential_pkey PRIMARY KEY (token_hash);


--
-- Name: community_invitation community_invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation
    ADD CONSTRAINT community_invitation_pkey PRIMARY KEY (invitation_id);


--
-- Name: community_membership community_membership_admission_invitation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_membership
    ADD CONSTRAINT community_membership_admission_invitation_id_key UNIQUE (admission_invitation_id);


--
-- Name: community_membership community_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_membership
    ADD CONSTRAINT community_membership_pkey PRIMARY KEY (membership_id);


--
-- Name: completed_game_detached_alias completed_game_detached_alias_game_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completed_game_detached_alias
    ADD CONSTRAINT completed_game_detached_alias_game_alias_key UNIQUE (game_id, detached_alias);


--
-- Name: completed_game_detached_alias completed_game_detached_alias_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.completed_game_detached_alias
    ADD CONSTRAINT completed_game_detached_alias_pkey PRIMARY KEY (game_id, subject_ref_sha256);


--
-- Name: day_event_narrative day_event_narrative_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_narrative
    ADD CONSTRAINT day_event_narrative_pkey PRIMARY KEY (game_id, event_id, lifecycle);


--
-- Name: day_event_participation day_event_participation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_participation
    ADD CONSTRAINT day_event_participation_pkey PRIMARY KEY (game_id, event_id, actor_slot);


--
-- Name: day_event day_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event
    ADD CONSTRAINT day_event_pkey PRIMARY KEY (game_id, event_id);


--
-- Name: day_event_schedule_work day_event_schedule_work_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_schedule_work
    ADD CONSTRAINT day_event_schedule_work_pkey PRIMARY KEY (game_id);


--
-- Name: day_event_scheduler_state day_event_scheduler_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_scheduler_state
    ADD CONSTRAINT day_event_scheduler_state_pkey PRIMARY KEY (game_id);


--
-- Name: day_program day_program_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_program
    ADD CONSTRAINT day_program_pkey PRIMARY KEY (game_id, program_id, version);


--
-- Name: day_vote_outcome day_vote_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_vote_outcome
    ADD CONSTRAINT day_vote_outcome_pkey PRIMARY KEY (game_id, phase_id);


--
-- Name: delayed_death_queue delayed_death_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delayed_death_queue
    ADD CONSTRAINT delayed_death_queue_pkey PRIMARY KEY (game_id, queue_id);


--
-- Name: discussion_area discussion_area_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_area
    ADD CONSTRAINT discussion_area_pkey PRIMARY KEY (area_id);


--
-- Name: discussion_area discussion_area_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_area
    ADD CONSTRAINT discussion_area_slug_key UNIQUE (slug);


--
-- Name: discussion_post discussion_post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_pkey PRIMARY KEY (source_seq);


--
-- Name: discussion_topic discussion_topic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_pkey PRIMARY KEY (topic_id);


--
-- Name: engine_snapshot_checkpoint engine_snapshot_checkpoint_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.engine_snapshot_checkpoint
    ADD CONSTRAINT engine_snapshot_checkpoint_pkey PRIMARY KEY (game_id);


--
-- Name: event_direct_key_sentinel event_direct_key_sentinel_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_direct_key_sentinel
    ADD CONSTRAINT event_direct_key_sentinel_pkey PRIMARY KEY (kid);


--
-- Name: event_stream_key_state event_stream_key_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_stream_key_state
    ADD CONSTRAINT event_stream_key_state_pkey PRIMARY KEY (stream_id);


--
-- Name: event_stream_keys event_stream_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_stream_keys
    ADD CONSTRAINT event_stream_keys_pkey PRIMARY KEY (stream_id, key_epoch);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (seq);


--
-- Name: events events_stream_seq_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_stream_seq_unique UNIQUE (stream_id, stream_seq);


--
-- Name: external_identity external_identity_method_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_method_id_key UNIQUE (method_id);


--
-- Name: external_identity external_identity_method_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_method_subject_key UNIQUE (method_id, subject);


--
-- Name: external_identity external_identity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_pkey PRIMARY KEY (provider, subject);


--
-- Name: game_authority game_authority_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_authority
    ADD CONSTRAINT game_authority_pkey PRIMARY KEY (game_id, principal_id, role);


--
-- Name: game_cohost_policy game_cohost_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_cohost_policy
    ADD CONSTRAINT game_cohost_policy_pkey PRIMARY KEY (game_id);


--
-- Name: game_index game_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_index
    ADD CONSTRAINT game_index_pkey PRIMARY KEY (game_id);


--
-- Name: game_invitation game_invitation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_invitation
    ADD CONSTRAINT game_invitation_pkey PRIMARY KEY (token_hash);


--
-- Name: game_persona_name_claim game_persona_name_claim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_name_claim
    ADD CONSTRAINT game_persona_name_claim_pkey PRIMARY KEY (game_id, normalized_name);


--
-- Name: game_persona_name_history game_persona_name_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_name_history
    ADD CONSTRAINT game_persona_name_history_pkey PRIMARY KEY (game_id, persona_id, effective_seq);


--
-- Name: game_persona game_persona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona
    ADD CONSTRAINT game_persona_pkey PRIMARY KEY (game_id, persona_id);


--
-- Name: game_persona_public game_persona_public_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_public
    ADD CONSTRAINT game_persona_public_pkey PRIMARY KEY (game_id, persona_id);


--
-- Name: game_persona_redaction game_persona_redaction_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_redaction
    ADD CONSTRAINT game_persona_redaction_pkey PRIMARY KEY (game_id, persona_id);


--
-- Name: game_persona_subject_binding game_persona_subject_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_subject_binding
    ADD CONSTRAINT game_persona_subject_binding_pkey PRIMARY KEY (game_id, persona_id);


--
-- Name: game_private_citation game_private_citation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_private_citation
    ADD CONSTRAINT game_private_citation_pkey PRIMARY KEY (game_id, quoting_source_seq, quoted_source_seq);


--
-- Name: game_result game_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_result
    ADD CONSTRAINT game_result_pkey PRIMARY KEY (game_id);


--
-- Name: game_thread_visibility_change game_thread_visibility_change_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_thread_visibility_change
    ADD CONSTRAINT game_thread_visibility_change_pkey PRIMARY KEY (id);


--
-- Name: host_phase_control host_phase_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_phase_control
    ADD CONSTRAINT host_phase_control_pkey PRIMARY KEY (game_id, prompt_id, stream_seq);


--
-- Name: host_prompt host_prompt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_prompt
    ADD CONSTRAINT host_prompt_pkey PRIMARY KEY (game_id, prompt_id);


--
-- Name: identity_lifecycle_audit identity_lifecycle_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_lifecycle_audit
    ADD CONSTRAINT identity_lifecycle_audit_pkey PRIMARY KEY (id);


--
-- Name: investigation_memory investigation_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigation_memory
    ADD CONSTRAINT investigation_memory_pkey PRIMARY KEY (game_id, investigator_slot, target_slot, mode);


--
-- Name: media_upload_ledger media_upload_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_upload_ledger
    ADD CONSTRAINT media_upload_ledger_pkey PRIMARY KEY (upload_id);


--
-- Name: member_inbox_cursor member_inbox_cursor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_inbox_cursor
    ADD CONSTRAINT member_inbox_cursor_pkey PRIMARY KEY (principal_id);


--
-- Name: member_inbox_item member_inbox_item_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_inbox_item
    ADD CONSTRAINT member_inbox_item_pkey PRIMARY KEY (principal_id, surface_id, source_seq, reason);


--
-- Name: member_lifecycle_event member_lifecycle_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_event
    ADD CONSTRAINT member_lifecycle_event_pkey PRIMARY KEY (principal_id, seq);


--
-- Name: member_lifecycle_projection member_lifecycle_projection_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_projection
    ADD CONSTRAINT member_lifecycle_projection_pkey PRIMARY KEY (principal_id);


--
-- Name: member_personal_export member_personal_export_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_export
    ADD CONSTRAINT member_personal_export_pkey PRIMARY KEY (export_id);


--
-- Name: member_profile member_profile_active_principal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_active_principal_id_key UNIQUE (active_principal_id);


--
-- Name: member_profile member_profile_handle_hmac_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_handle_hmac_key UNIQUE (handle_hmac);


--
-- Name: member_profile member_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_pkey PRIMARY KEY (profile_id);


--
-- Name: member_profile member_profile_subject_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_subject_id_key UNIQUE (subject_id);


--
-- Name: membership_ancestry membership_ancestry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_ancestry
    ADD CONSTRAINT membership_ancestry_pkey PRIMARY KEY (ancestor_membership_id, descendant_membership_id);


--
-- Name: moderation_case_history moderation_case_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_case_history
    ADD CONSTRAINT moderation_case_history_pkey PRIMARY KEY (source_seq);


--
-- Name: moderation_case moderation_case_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_case
    ADD CONSTRAINT moderation_case_pkey PRIMARY KEY (case_id);


--
-- Name: moderation_case moderation_case_target_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_case
    ADD CONSTRAINT moderation_case_target_key UNIQUE (surface_id, source_seq);


--
-- Name: moderation_report moderation_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_report
    ADD CONSTRAINT moderation_report_pkey PRIMARY KEY (report_id);


--
-- Name: moderation_target_state moderation_target_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_target_state
    ADD CONSTRAINT moderation_target_state_pkey PRIMARY KEY (surface_id, source_seq);


--
-- Name: pack_artifact pack_artifact_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_artifact
    ADD CONSTRAINT pack_artifact_identity_key UNIQUE (pack_key, pack_version, content_hash);


--
-- Name: pack_artifact pack_artifact_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_artifact
    ADD CONSTRAINT pack_artifact_pkey PRIMARY KEY (content_hash);


--
-- Name: phase_state phase_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase_state
    ADD CONSTRAINT phase_state_pkey PRIMARY KEY (game_id);


--
-- Name: platform_principal platform_principal_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_principal
    ADD CONSTRAINT platform_principal_pkey PRIMARY KEY (principal_id);


--
-- Name: player_info_result player_info_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_info_result
    ADD CONSTRAINT player_info_result_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: player_investigation_result player_investigation_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_investigation_result
    ADD CONSTRAINT player_investigation_result_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: player_notification player_notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_notification
    ADD CONSTRAINT player_notification_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: post_policy post_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_policy
    ADD CONSTRAINT post_policy_pkey PRIMARY KEY (game_id, channel_id);


--
-- Name: privacy_subject privacy_subject_exact_owner_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_subject
    ADD CONSTRAINT privacy_subject_exact_owner_unique UNIQUE (subject_id, principal_id);


--
-- Name: privacy_subject privacy_subject_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_subject
    ADD CONSTRAINT privacy_subject_pkey PRIMARY KEY (subject_id);


--
-- Name: privacy_subject privacy_subject_principal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_subject
    ADD CONSTRAINT privacy_subject_principal_id_key UNIQUE (principal_id);


--
-- Name: private_channel_member private_channel_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_channel_member
    ADD CONSTRAINT private_channel_member_pkey PRIMARY KEY (game_id, channel_id, slot_id);


--
-- Name: profile_mute profile_mute_member_target_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_mute
    ADD CONSTRAINT profile_mute_member_target_key UNIQUE (principal_id, target_profile_id);


--
-- Name: profile_mute profile_mute_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_mute
    ADD CONSTRAINT profile_mute_pkey PRIMARY KEY (relationship_id);


--
-- Name: public_citation public_citation_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_citation
    ADD CONSTRAINT public_citation_pkey PRIMARY KEY (quoting_surface_id, quoting_source_seq, quoted_surface_id, quoted_source_seq);


--
-- Name: public_profile public_profile_handle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_profile
    ADD CONSTRAINT public_profile_handle_key UNIQUE (handle);


--
-- Name: public_profile public_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_profile
    ADD CONSTRAINT public_profile_pkey PRIMARY KEY (profile_id);


--
-- Name: public_publication public_publication_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_publication
    ADD CONSTRAINT public_publication_pkey PRIMARY KEY (surface_id, source_seq);


--
-- Name: public_search_document public_search_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_search_document
    ADD CONSTRAINT public_search_document_pkey PRIMARY KEY (surface_id, document_type, source_seq);


--
-- Name: public_watch public_watch_member_target_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_watch
    ADD CONSTRAINT public_watch_member_target_key UNIQUE (principal_id, surface_id);


--
-- Name: public_watch_period public_watch_period_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_watch_period
    ADD CONSTRAINT public_watch_period_pkey PRIMARY KEY (subscription_id, started_seq);


--
-- Name: public_watch public_watch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_watch
    ADD CONSTRAINT public_watch_pkey PRIMARY KEY (subscription_id);


--
-- Name: publication_surface publication_surface_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.publication_surface
    ADD CONSTRAINT publication_surface_pkey PRIMARY KEY (surface_id);


--
-- Name: sheriff_badge sheriff_badge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheriff_badge
    ADD CONSTRAINT sheriff_badge_pkey PRIMARY KEY (game_id, badge_id);


--
-- Name: slot_effect slot_effect_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_effect
    ADD CONSTRAINT slot_effect_pkey PRIMARY KEY (game_id, slot_id, effect);


--
-- Name: slot_occupancy_epoch slot_occupancy_epoch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_occupancy_epoch
    ADD CONSTRAINT slot_occupancy_epoch_pkey PRIMARY KEY (game_id, occupancy_id);


--
-- Name: slot_state slot_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_state
    ADD CONSTRAINT slot_state_pkey PRIMARY KEY (game_id, slot_id);


--
-- Name: slot_status_tag slot_status_tag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_status_tag
    ADD CONSTRAINT slot_status_tag_pkey PRIMARY KEY (game_id, slot_id, tag);


--
-- Name: spectator_membership spectator_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spectator_membership
    ADD CONSTRAINT spectator_membership_pkey PRIMARY KEY (game_id, principal_id);


--
-- Name: subject_authority_binding subject_authority_binding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_authority_binding
    ADD CONSTRAINT subject_authority_binding_pkey PRIMARY KEY (singleton);


--
-- Name: subject_erasure_outbox subject_erasure_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_pkey PRIMARY KEY (erasure_id);


--
-- Name: subject_erasure_outbox subject_erasure_outbox_principal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_principal_id_key UNIQUE (principal_id);


--
-- Name: subject_erasure_outbox subject_erasure_outbox_receipt_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_receipt_id_key UNIQUE (receipt_id);


--
-- Name: subject_erasure_outbox subject_erasure_outbox_replacement_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_replacement_alias_key UNIQUE (replacement_alias);


--
-- Name: subject_erasure_outbox subject_erasure_outbox_subject_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_subject_id_key UNIQUE (subject_id);


--
-- Name: subject_erasure subject_erasure_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure
    ADD CONSTRAINT subject_erasure_pkey PRIMARY KEY (erasure_id);


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_erasure_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_key_destruction_receipt
    ADD CONSTRAINT subject_key_destruction_receipt_erasure_id_key UNIQUE (erasure_id);


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_key_destruction_receipt
    ADD CONSTRAINT subject_key_destruction_receipt_pkey PRIMARY KEY (receipt_id);


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_subject_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_key_destruction_receipt
    ADD CONSTRAINT subject_key_destruction_receipt_subject_id_key UNIQUE (subject_id);


--
-- Name: subject_private_claim subject_private_claim_id_subject_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_private_claim
    ADD CONSTRAINT subject_private_claim_id_subject_key UNIQUE (claim_id, subject_id);


--
-- Name: subject_private_claim subject_private_claim_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_private_claim
    ADD CONSTRAINT subject_private_claim_pkey PRIMARY KEY (claim_id);


--
-- Name: subject_tombstone subject_tombstone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_tombstone
    ADD CONSTRAINT subject_tombstone_pkey PRIMARY KEY (subject_id);


--
-- Name: subject_tombstone subject_tombstone_replacement_alias_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_tombstone
    ADD CONSTRAINT subject_tombstone_replacement_alias_key UNIQUE (replacement_alias);


--
-- Name: thread_view thread_view_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_view
    ADD CONSTRAINT thread_view_pkey PRIMARY KEY (game_id, source_seq);


--
-- Name: visit_history visit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_history
    ADD CONSTRAINT visit_history_pkey PRIMARY KEY (game_id, source_action, actor_slot, target_slot);


--
-- Name: vote_ballot vote_ballot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballot
    ADD CONSTRAINT vote_ballot_pkey PRIMARY KEY (game_id, phase_id, actor_slot);


--
-- Name: workos_provider_session workos_provider_session_identity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_identity_key UNIQUE (provider_session_id, principal_id, method_id);


--
-- Name: workos_provider_session workos_provider_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_pkey PRIMARY KEY (provider_session_id);


--
-- Name: workos_provider_session_tombstone workos_provider_session_tombstone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session_tombstone
    ADD CONSTRAINT workos_provider_session_tombstone_pkey PRIMARY KEY (provider_session_hash);


--
-- Name: workos_session_exchange workos_session_exchange_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_session_exchange
    ADD CONSTRAINT workos_session_exchange_pkey PRIMARY KEY (access_token_hash);


--
-- Name: workos_signing_key_tombstone workos_signing_key_tombstone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_signing_key_tombstone
    ADD CONSTRAINT workos_signing_key_tombstone_pkey PRIMARY KEY (signing_key_id);


--
-- Name: workos_subject_tombstone workos_subject_tombstone_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_subject_tombstone
    ADD CONSTRAINT workos_subject_tombstone_pkey PRIMARY KEY (provider_subject_hash);


--
-- Name: action_counter_slot_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_counter_slot_template_idx ON public.action_counter USING btree (game_id, slot_id, template_id);


--
-- Name: action_grant_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_grant_slot_idx ON public.action_grant USING btree (game_id, slot_id, grant_id, phase_number);


--
-- Name: action_history_slot_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_history_slot_template_idx ON public.action_history USING btree (game_id, slot_id, template_id, phase_number);


--
-- Name: action_submission_actor_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_submission_actor_phase_idx ON public.action_submission USING btree (game_id, phase_id, actor_slot);


--
-- Name: auth_account_disabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_disabled_idx ON public.auth_account USING btree (disabled_at) WHERE (disabled_at IS NOT NULL);


--
-- Name: auth_account_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_principal_idx ON public.auth_account USING btree (principal_id);


--
-- Name: auth_account_recovery_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_recovery_account_idx ON public.auth_account_recovery_credential USING btree (account_id, created_at DESC);


--
-- Name: auth_account_recovery_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_recovery_active_idx ON public.auth_account_recovery_credential USING btree (expires_at) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: auth_credential_attempt_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_credential_attempt_blocked_idx ON public.auth_credential_attempt USING btree (blocked_until) WHERE (blocked_until IS NOT NULL);


--
-- Name: auth_credential_attempt_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_credential_attempt_updated_idx ON public.auth_credential_attempt USING btree (updated_at);


--
-- Name: auth_delivery_intent_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_account_idx ON public.auth_delivery_intent USING btree (account_id, created_at DESC);


--
-- Name: auth_delivery_intent_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_claim_idx ON public.auth_delivery_intent USING btree (claim_expires_at) WHERE (status = 'processing'::text);


--
-- Name: auth_delivery_intent_credential_envelope_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_credential_envelope_kid_idx ON public.auth_delivery_intent USING btree (credential_envelope_kid, delivery_id) WHERE (credential_envelope_kid IS NOT NULL);


--
-- Name: auth_delivery_intent_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_principal_idx ON public.auth_delivery_intent USING btree (principal_id);


--
-- Name: auth_delivery_intent_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_retry_idx ON public.auth_delivery_intent USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['queued'::text, 'retryable_failed'::text]));


--
-- Name: auth_registration_attempt_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_registration_attempt_blocked_idx ON public.auth_registration_attempt USING btree (blocked_until) WHERE (blocked_until IS NOT NULL);


--
-- Name: auth_registration_attempt_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_registration_attempt_updated_idx ON public.auth_registration_attempt USING btree (updated_at);


--
-- Name: auth_session_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_expiry_idx ON public.auth_session USING btree (expires_at);


--
-- Name: auth_session_method_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_method_idx ON public.auth_session USING btree (authenticated_via_method_id) WHERE (authenticated_via_method_id IS NOT NULL);


--
-- Name: auth_session_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_principal_idx ON public.auth_session USING btree (principal_id);


--
-- Name: auth_session_workos_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_workos_session_idx ON public.auth_session USING btree (workos_session_id) WHERE (workos_session_id IS NOT NULL);


--
-- Name: auth_session_workos_signing_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_workos_signing_key_idx ON public.auth_session USING btree (workos_signing_key_id) WHERE ((revoked_at IS NULL) AND (workos_signing_key_id IS NOT NULL));


--
-- Name: auth_websocket_ticket_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_websocket_ticket_expiry_idx ON public.auth_websocket_ticket USING btree (LEAST(expires_at, access_expires_at));


--
-- Name: auth_websocket_ticket_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_websocket_ticket_session_idx ON public.auth_websocket_ticket USING btree (session_reference);


--
-- Name: authentication_method_classic_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX authentication_method_classic_unique ON public.authentication_method USING btree (principal_id) WHERE (kind = 'classic_password'::text);


--
-- Name: authentication_method_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX authentication_method_principal_idx ON public.authentication_method USING btree (principal_id, status);


--
-- Name: command_receipt_stream_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX command_receipt_stream_idx ON public.command_receipt USING btree (stream_id);


--
-- Name: community_invitation_credential_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_invitation_credential_expiry_idx ON public.community_invitation_credential USING btree (expires_at) WHERE ((consumed_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: community_invitation_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_invitation_expiry_idx ON public.community_invitation USING btree (expires_at) WHERE (status = 'issued'::text);


--
-- Name: community_invitation_sponsor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_invitation_sponsor_idx ON public.community_invitation USING btree (sponsoring_membership_id, status, invitation_id);


--
-- Name: community_membership_active_principal_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX community_membership_active_principal_unique ON public.community_membership USING btree (active_principal_id) WHERE (active_principal_id IS NOT NULL);


--
-- Name: community_membership_sponsor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_membership_sponsor_idx ON public.community_membership USING btree (sponsoring_membership_id) WHERE (sponsoring_membership_id IS NOT NULL);


--
-- Name: community_membership_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_membership_status_idx ON public.community_membership USING btree (status, membership_id);


--
-- Name: day_event_narrative_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_narrative_pending_idx ON public.day_event_narrative USING btree (game_id, event_id, lifecycle) WHERE (status = 'pending'::text);


--
-- Name: day_event_narrative_rendered_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_narrative_rendered_private_kid_idx ON public.day_event_narrative USING btree (rendered_body_private_kid, game_id, event_id, lifecycle) WHERE (rendered_body_private_kid IS NOT NULL);


--
-- Name: day_event_narrative_template_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_narrative_template_private_kid_idx ON public.day_event_narrative USING btree (body_template_private_kid, game_id, event_id, lifecycle) WHERE (body_template_private_kid IS NOT NULL);


--
-- Name: day_event_participation_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_participation_page_idx ON public.day_event_participation USING btree (game_id, event_id, submitted_seq, actor_slot);


--
-- Name: day_event_schedule_work_auto_resolve_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_schedule_work_auto_resolve_idx ON public.day_event_schedule_work USING btree (game_id) WHERE auto_resolve_pending;


--
-- Name: day_event_schedule_work_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_schedule_work_due_idx ON public.day_event_schedule_work USING btree (next_due_at, game_id) WHERE (next_due_at IS NOT NULL);


--
-- Name: day_event_schedule_work_narrative_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_schedule_work_narrative_idx ON public.day_event_schedule_work USING btree (game_id) WHERE narrative_pending;


--
-- Name: day_event_schedule_work_wake_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_schedule_work_wake_idx ON public.day_event_schedule_work USING btree (wake_seq, game_id);


--
-- Name: day_event_scheduler_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_scheduler_claim_idx ON public.day_event_scheduler_state USING btree (retry_not_before, lease_until, game_id);


--
-- Name: day_event_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_event_state_idx ON public.day_event USING btree (game_id, state, event_id);


--
-- Name: day_program_attached_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_program_attached_idx ON public.day_program USING btree (game_id, attached_seq DESC);


--
-- Name: day_vote_outcome_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_vote_outcome_source_idx ON public.day_vote_outcome USING btree (game_id, source_seq, event_index);


--
-- Name: delayed_death_queue_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delayed_death_queue_target_idx ON public.delayed_death_queue USING btree (game_id, target_slot, effect);


--
-- Name: discussion_post_topic_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussion_post_topic_order_idx ON public.discussion_post USING btree (topic_id, source_seq DESC);


--
-- Name: discussion_topic_area_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussion_topic_area_page_idx ON public.discussion_topic USING btree (area_id, updated_seq DESC, topic_id DESC) WHERE (visibility = 'visible'::text);


--
-- Name: event_direct_key_sentinel_lifecycle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_direct_key_sentinel_lifecycle_idx ON public.event_direct_key_sentinel USING btree (lifecycle, kid);


--
-- Name: event_direct_key_sentinel_single_retiring_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX event_direct_key_sentinel_single_retiring_idx ON public.event_direct_key_sentinel USING btree (lifecycle) WHERE (lifecycle = 'retiring'::text);


--
-- Name: event_stream_keys_wrap_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX event_stream_keys_wrap_kid_idx ON public.event_stream_keys USING btree (wrap_kid, stream_id, key_epoch);


--
-- Name: external_identity_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_identity_principal_idx ON public.external_identity USING btree (principal_id);


--
-- Name: game_index_public_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_index_public_page_idx ON public.game_index USING btree (updated_seq DESC, game_id DESC) WHERE (status = ANY (ARRAY['active'::text, 'completed'::text]));


--
-- Name: game_invitation_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_invitation_account_idx ON public.game_invitation USING btree (account_id);


--
-- Name: game_invitation_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_invitation_expiry_idx ON public.game_invitation USING btree (expires_at) WHERE (redeemed_at IS NULL);


--
-- Name: game_invitation_game_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_invitation_game_idx ON public.game_invitation USING btree (game) WHERE (game IS NOT NULL);


--
-- Name: game_invitation_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_invitation_principal_idx ON public.game_invitation USING btree (principal_id);


--
-- Name: game_invitation_revocation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_invitation_revocation_idx ON public.game_invitation USING btree (revoked_at) WHERE (revoked_at IS NOT NULL);


--
-- Name: game_persona_subject_binding_erasure_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_persona_subject_binding_erasure_idx ON public.game_persona_subject_binding USING btree (subject_id) WHERE (lifecycle = 'active'::text);


--
-- Name: game_persona_subject_binding_subject_erasure_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_persona_subject_binding_subject_erasure_idx ON public.game_persona_subject_binding USING btree (subject_id, game_id, persona_id);


--
-- Name: game_persona_subject_binding_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX game_persona_subject_binding_subject_idx ON public.game_persona_subject_binding USING btree (game_id, subject_id);


--
-- Name: game_private_citation_quoted_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_private_citation_quoted_idx ON public.game_private_citation USING btree (game_id, quoted_source_seq, quoting_source_seq);


--
-- Name: game_thread_visibility_change_game_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_thread_visibility_change_game_idx ON public.game_thread_visibility_change USING btree (game_id, id);


--
-- Name: host_phase_control_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX host_phase_control_phase_idx ON public.host_phase_control USING btree (game_id, source_phase_id, target_phase_id, stream_seq);


--
-- Name: host_prompt_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX host_prompt_phase_idx ON public.host_prompt USING btree (game_id, phase_id, event_index);


--
-- Name: identity_lifecycle_audit_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_actor_idx ON public.identity_lifecycle_audit USING btree (actor_principal_id);


--
-- Name: identity_lifecycle_audit_event_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_event_at_idx ON public.identity_lifecycle_audit USING btree (event_at DESC, id DESC);


--
-- Name: identity_lifecycle_audit_event_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_event_kind_idx ON public.identity_lifecycle_audit USING btree (event_kind, id DESC);


--
-- Name: identity_lifecycle_audit_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_principal_idx ON public.identity_lifecycle_audit USING btree (principal_id, id DESC);


--
-- Name: investigation_memory_investigator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investigation_memory_investigator_idx ON public.investigation_memory USING btree (game_id, investigator_slot, mode);


--
-- Name: investigation_memory_result_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investigation_memory_result_private_kid_idx ON public.investigation_memory USING btree (result_private_kid, game_id, investigator_slot, target_slot, mode);


--
-- Name: media_upload_ledger_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX media_upload_ledger_principal_idx ON public.media_upload_ledger USING btree (principal_id, created_at);


--
-- Name: member_inbox_item_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_inbox_item_page_idx ON public.member_inbox_item USING btree (principal_id, source_seq DESC);


--
-- Name: member_lifecycle_event_principal_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_lifecycle_event_principal_seq_idx ON public.member_lifecycle_event USING btree (principal_id, seq);


--
-- Name: member_lifecycle_event_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_lifecycle_event_subject_idx ON public.member_lifecycle_event USING btree (subject_id);


--
-- Name: member_lifecycle_projection_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_lifecycle_projection_subject_idx ON public.member_lifecycle_projection USING btree (subject_id);


--
-- Name: member_personal_export_principal_requested_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_personal_export_principal_requested_idx ON public.member_personal_export USING btree (principal_id, requested_at DESC);


--
-- Name: member_personal_export_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_personal_export_subject_idx ON public.member_personal_export USING btree (subject_id);


--
-- Name: member_profile_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX member_profile_subject_idx ON public.member_profile USING btree (subject_id);


--
-- Name: membership_ancestry_descendant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX membership_ancestry_descendant_idx ON public.membership_ancestry USING btree (descendant_membership_id, depth);


--
-- Name: moderation_case_history_case_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_case_history_case_idx ON public.moderation_case_history USING btree (case_id, source_seq);


--
-- Name: moderation_case_queue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_case_queue_idx ON public.moderation_case USING btree (status, updated_seq DESC, case_id DESC);


--
-- Name: moderation_report_active_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX moderation_report_active_dedupe_idx ON public.moderation_report USING btree (case_id, reporter_principal_id, reason_family) WHERE active;


--
-- Name: moderation_report_rate_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX moderation_report_rate_idx ON public.moderation_report USING btree (reporter_principal_id, submitted_at DESC);


--
-- Name: player_info_result_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_info_result_audience_idx ON public.player_info_result USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: player_info_result_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_info_result_private_kid_idx ON public.player_info_result USING btree (result_private_kid, game_id, phase_id, event_index, audience_slot);


--
-- Name: player_investigation_result_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_investigation_result_audience_idx ON public.player_investigation_result USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: player_investigation_result_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_investigation_result_private_kid_idx ON public.player_investigation_result USING btree (result_private_kid, game_id, phase_id, event_index, audience_slot);


--
-- Name: player_notification_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_notification_audience_idx ON public.player_notification USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: private_channel_member_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_channel_member_private_kid_idx ON public.private_channel_member USING btree (private_kid, game_id, channel_id, slot_id);


--
-- Name: private_channel_member_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_channel_member_slot_idx ON public.private_channel_member USING btree (game_id, slot_id, channel_id);


--
-- Name: profile_mute_member_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_mute_member_page_idx ON public.profile_mute USING btree (principal_id, active, updated_seq DESC, relationship_id DESC);


--
-- Name: profile_mute_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_mute_target_idx ON public.profile_mute USING btree (target_profile_id, active);


--
-- Name: public_citation_quoted_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_citation_quoted_page_idx ON public.public_citation USING btree (quoted_surface_id, quoted_source_seq, quoting_source_seq DESC);


--
-- Name: public_publication_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_publication_author_idx ON public.public_publication USING btree (author_profile_id, source_seq DESC) WHERE (author_profile_id IS NOT NULL);


--
-- Name: public_publication_surface_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_publication_surface_page_idx ON public.public_publication USING btree (surface_id, source_seq DESC) WHERE visible;


--
-- Name: public_search_document_author_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_search_document_author_idx ON public.public_search_document USING btree (author_profile_id, updated_seq DESC) WHERE (author_profile_id IS NOT NULL);


--
-- Name: public_search_document_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_search_document_vector_idx ON public.public_search_document USING gin (search_vector) WHERE visible;


--
-- Name: public_watch_member_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_watch_member_idx ON public.public_watch USING btree (principal_id, active, updated_seq DESC);


--
-- Name: public_watch_period_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_watch_period_lookup_idx ON public.public_watch_period USING btree (subscription_id, started_seq, ended_seq);


--
-- Name: public_watch_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_watch_target_idx ON public.public_watch USING btree (surface_id, active);


--
-- Name: sheriff_badge_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sheriff_badge_owner_idx ON public.sheriff_badge USING btree (game_id, owner_slot) WHERE (owner_slot IS NOT NULL);


--
-- Name: slot_effect_by_effect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_effect_by_effect_idx ON public.slot_effect USING btree (game_id, effect, slot_id);


--
-- Name: slot_occupancy_epoch_open_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slot_occupancy_epoch_open_persona_idx ON public.slot_occupancy_epoch USING btree (game_id, persona_id) WHERE (ended_seq IS NULL);


--
-- Name: slot_occupancy_epoch_open_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX slot_occupancy_epoch_open_slot_idx ON public.slot_occupancy_epoch USING btree (game_id, slot_id) WHERE (ended_seq IS NULL);


--
-- Name: slot_state_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_state_private_kid_idx ON public.slot_state USING btree (private_kid, game_id, slot_id) WHERE (private_kid IS NOT NULL);


--
-- Name: slot_status_tag_by_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_status_tag_by_tag_idx ON public.slot_status_tag USING btree (game_id, tag, slot_id);


--
-- Name: subject_erasure_pending_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subject_erasure_pending_claim_idx ON public.subject_erasure USING btree (claim_expires_at, erasure_id) WHERE (state = 'pending'::text);


--
-- Name: subject_private_claim_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subject_private_claim_scope_idx ON public.subject_private_claim USING btree (claim_kind, scope_id, scope_key, created_at);


--
-- Name: subject_private_claim_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subject_private_claim_subject_idx ON public.subject_private_claim USING btree (subject_id, created_at, claim_id);


--
-- Name: thread_view_body_private_kid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX thread_view_body_private_kid_idx ON public.thread_view USING btree (body_private_kid, game_id, source_seq) WHERE (body_private_kid IS NOT NULL);


--
-- Name: thread_view_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX thread_view_page_idx ON public.thread_view USING btree (game_id, channel_id, source_seq DESC);


--
-- Name: visit_history_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visit_history_actor_idx ON public.visit_history USING btree (game_id, actor_slot, phase_number, phase_id);


--
-- Name: visit_history_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visit_history_target_idx ON public.visit_history USING btree (game_id, target_slot, phase_number, phase_id);


--
-- Name: vote_ballot_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vote_ballot_target_idx ON public.vote_ballot USING btree (game_id, phase_id, target);


--
-- Name: workos_provider_session_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workos_provider_session_principal_idx ON public.workos_provider_session USING btree (principal_id, status);


--
-- Name: workos_session_exchange_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workos_session_exchange_expiry_idx ON public.workos_session_exchange USING btree (access_expires_at);


--
-- Name: workos_session_exchange_provider_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX workos_session_exchange_provider_session_idx ON public.workos_session_exchange USING btree (provider_session_id);


--
-- Name: auth_delivery_intent auth_delivery_intent_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auth_delivery_intent_direct_envelope_guard BEFORE INSERT OR UPDATE OF credential_envelope ON public.auth_delivery_intent FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('credential_envelope');


--
-- Name: completed_game_detached_alias completed_game_detached_alias_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER completed_game_detached_alias_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.completed_game_detached_alias FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: day_event_narrative day_event_narrative_rendered_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER day_event_narrative_rendered_direct_envelope_guard BEFORE INSERT OR UPDATE OF rendered_body_private ON public.day_event_narrative FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('rendered_body_private');


--
-- Name: day_event_narrative day_event_narrative_template_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER day_event_narrative_template_direct_envelope_guard BEFORE INSERT OR UPDATE OF body_template_private ON public.day_event_narrative FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('body_template_private');


--
-- Name: event_direct_key_sentinel event_direct_key_sentinel_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_direct_key_sentinel_guard BEFORE DELETE OR UPDATE ON public.event_direct_key_sentinel FOR EACH ROW EXECUTE FUNCTION public.event_direct_key_sentinel_guard_mutation();


--
-- Name: event_direct_key_sentinel event_direct_key_sentinel_transition_lock; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_direct_key_sentinel_transition_lock BEFORE UPDATE ON public.event_direct_key_sentinel FOR EACH STATEMENT EXECUTE FUNCTION public.event_direct_key_sentinel_lock_transition();


--
-- Name: event_direct_key_sentinel event_direct_key_sentinel_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_direct_key_sentinel_truncate_guard BEFORE TRUNCATE ON public.event_direct_key_sentinel FOR EACH STATEMENT EXECUTE FUNCTION public.event_direct_key_sentinel_guard_mutation();


--
-- Name: event_stream_key_state event_stream_key_state_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_stream_key_state_guard BEFORE DELETE OR UPDATE ON public.event_stream_key_state FOR EACH ROW EXECUTE FUNCTION public.event_stream_key_state_monotonic();


--
-- Name: event_stream_key_state event_stream_key_state_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_stream_key_state_truncate_guard BEFORE TRUNCATE ON public.event_stream_key_state FOR EACH STATEMENT EXECUTE FUNCTION public.event_stream_key_state_monotonic();


--
-- Name: event_stream_keys event_stream_key_wrap_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_stream_key_wrap_guard BEFORE INSERT OR UPDATE OF wrap_version, wrap_kid, wrap_nonce, wrapped_dek ON public.event_stream_keys FOR EACH ROW EXECUTE FUNCTION public.event_stream_key_wrap_write_guard();


--
-- Name: event_stream_keys event_stream_keys_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_stream_keys_guard BEFORE DELETE OR UPDATE ON public.event_stream_keys FOR EACH ROW EXECUTE FUNCTION public.event_stream_keys_guard_mutation();


--
-- Name: event_stream_keys event_stream_keys_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER event_stream_keys_truncate_guard BEFORE TRUNCATE ON public.event_stream_keys FOR EACH STATEMENT EXECUTE FUNCTION public.event_stream_keys_guard_mutation();


--
-- Name: events events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_no_update BEFORE DELETE OR UPDATE OR TRUNCATE ON public.events FOR EACH STATEMENT EXECUTE FUNCTION public.events_forbid_mutation();


--
-- Name: investigation_memory investigation_memory_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER investigation_memory_direct_envelope_guard BEFORE INSERT OR UPDATE OF result_private ON public.investigation_memory FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');


--
-- Name: pack_artifact pack_artifact_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER pack_artifact_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.pack_artifact FOR EACH STATEMENT EXECUTE FUNCTION public.pack_artifact_immutable_guard();


--
-- Name: player_info_result player_info_result_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER player_info_result_direct_envelope_guard BEFORE INSERT OR UPDATE OF result_private ON public.player_info_result FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');


--
-- Name: player_investigation_result player_investigation_result_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER player_investigation_result_direct_envelope_guard BEFORE INSERT OR UPDATE OF result_private ON public.player_investigation_result FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('result_private');


--
-- Name: privacy_subject privacy_subject_no_reactivation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER privacy_subject_no_reactivation BEFORE UPDATE OF lifecycle_state ON public.privacy_subject FOR EACH ROW EXECUTE FUNCTION public.privacy_subject_irreversible_erasure();


--
-- Name: private_channel_member private_channel_member_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER private_channel_member_direct_envelope_guard BEFORE INSERT OR UPDATE OF private ON public.private_channel_member FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('private');


--
-- Name: slot_state slot_state_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER slot_state_direct_envelope_guard BEFORE INSERT OR UPDATE OF private ON public.slot_state FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('private');


--
-- Name: subject_authority_binding subject_authority_binding_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_authority_binding_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.subject_authority_binding FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: subject_erasure subject_erasure_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_erasure_no_delete BEFORE DELETE OR TRUNCATE ON public.subject_erasure FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: subject_erasure_outbox subject_erasure_outbox_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_erasure_outbox_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.subject_erasure_outbox FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: subject_erasure subject_erasure_state_transition_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_erasure_state_transition_guard BEFORE UPDATE ON public.subject_erasure FOR EACH ROW EXECUTE FUNCTION public.subject_erasure_state_guard();


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_key_destruction_receipt_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.subject_key_destruction_receipt FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: subject_private_claim subject_private_claim_active_subject_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_private_claim_active_subject_only BEFORE INSERT ON public.subject_private_claim FOR EACH ROW EXECUTE FUNCTION public.subject_private_claim_reject_tombstoned();


--
-- Name: subject_private_claim subject_private_claim_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_private_claim_no_update BEFORE UPDATE OR TRUNCATE ON public.subject_private_claim FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: subject_tombstone subject_tombstone_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER subject_tombstone_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.subject_tombstone FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: thread_view thread_view_direct_envelope_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER thread_view_direct_envelope_guard BEFORE INSERT OR UPDATE OF body_private ON public.thread_view FOR EACH ROW EXECUTE FUNCTION public.event_direct_envelope_write_guard('body_private');


--
-- Name: workos_provider_session workos_provider_session_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workos_provider_session_guard BEFORE INSERT OR DELETE OR UPDATE ON public.workos_provider_session FOR EACH ROW EXECUTE FUNCTION public.workos_provider_session_guard_mutation();


--
-- Name: workos_provider_session_tombstone workos_provider_session_tombstone_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workos_provider_session_tombstone_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.workos_provider_session_tombstone FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: workos_provider_session workos_provider_session_truncate_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workos_provider_session_truncate_guard BEFORE TRUNCATE ON public.workos_provider_session FOR EACH STATEMENT EXECUTE FUNCTION public.workos_provider_session_guard_mutation();


--
-- Name: workos_signing_key_tombstone workos_signing_key_tombstone_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workos_signing_key_tombstone_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.workos_signing_key_tombstone FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: workos_subject_tombstone workos_subject_tombstone_no_mutation; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER workos_subject_tombstone_no_mutation BEFORE DELETE OR UPDATE OR TRUNCATE ON public.workos_subject_tombstone FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();


--
-- Name: auth_account auth_account_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT;


--
-- Name: auth_account auth_account_method_identity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_method_identity_fkey FOREIGN KEY (method_id, principal_id, method_kind) REFERENCES public.authentication_method(method_id, principal_id, kind) ON DELETE RESTRICT;


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.auth_account(account_id) ON DELETE CASCADE;


--
-- Name: auth_delivery_intent auth_delivery_intent_credential_envelope_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_credential_envelope_kid_fkey FOREIGN KEY (credential_envelope_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: auth_session auth_session_method_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_method_fkey FOREIGN KEY (authenticated_via_method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT;


--
-- Name: auth_session auth_session_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: auth_session auth_session_workos_provider_session_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_workos_provider_session_fkey FOREIGN KEY (workos_session_id, principal_id, authenticated_via_method_id) REFERENCES public.workos_provider_session(provider_session_id, principal_id, method_id) ON DELETE RESTRICT;


--
-- Name: auth_websocket_ticket auth_websocket_ticket_session_reference_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_websocket_ticket
    ADD CONSTRAINT auth_websocket_ticket_session_reference_fkey FOREIGN KEY (session_reference) REFERENCES public.auth_session(token_hash) ON DELETE CASCADE;


--
-- Name: authentication_method authentication_method_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.authentication_method
    ADD CONSTRAINT authentication_method_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: community_invitation community_invitation_admitted_membership_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation
    ADD CONSTRAINT community_invitation_admitted_membership_fkey FOREIGN KEY (admitted_membership_id) REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT;


--
-- Name: community_invitation_credential community_invitation_credential_invitation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation_credential
    ADD CONSTRAINT community_invitation_credential_invitation_fkey FOREIGN KEY (invitation_id) REFERENCES public.community_invitation(invitation_id) ON DELETE CASCADE;


--
-- Name: community_invitation community_invitation_sponsor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_invitation
    ADD CONSTRAINT community_invitation_sponsor_fkey FOREIGN KEY (sponsoring_membership_id) REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT;


--
-- Name: community_membership community_membership_active_principal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_membership
    ADD CONSTRAINT community_membership_active_principal_fkey FOREIGN KEY (active_principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: community_membership community_membership_admission_invitation_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_membership
    ADD CONSTRAINT community_membership_admission_invitation_fkey FOREIGN KEY (admission_invitation_id) REFERENCES public.community_invitation(invitation_id) ON DELETE RESTRICT;


--
-- Name: community_membership community_membership_sponsor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_membership
    ADD CONSTRAINT community_membership_sponsor_fkey FOREIGN KEY (sponsoring_membership_id) REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT;


--
-- Name: day_event_narrative day_event_narrative_event_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_narrative
    ADD CONSTRAINT day_event_narrative_event_fkey FOREIGN KEY (game_id, event_id) REFERENCES public.day_event(game_id, event_id) ON DELETE CASCADE;


--
-- Name: day_event_narrative day_event_narrative_rendered_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_narrative
    ADD CONSTRAINT day_event_narrative_rendered_private_kid_fkey FOREIGN KEY (rendered_body_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: day_event_narrative day_event_narrative_template_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_narrative
    ADD CONSTRAINT day_event_narrative_template_private_kid_fkey FOREIGN KEY (body_template_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: day_event_participation day_event_participation_event_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_event_participation
    ADD CONSTRAINT day_event_participation_event_fkey FOREIGN KEY (game_id, event_id) REFERENCES public.day_event(game_id, event_id) ON DELETE CASCADE;


--
-- Name: discussion_post discussion_post_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_author_profile_id_fkey FOREIGN KEY (author_profile_id) REFERENCES public.member_profile(profile_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: discussion_post discussion_post_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.discussion_topic(topic_id) ON DELETE CASCADE;


--
-- Name: discussion_topic discussion_topic_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.discussion_area(area_id);


--
-- Name: discussion_topic discussion_topic_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_author_profile_id_fkey FOREIGN KEY (author_profile_id) REFERENCES public.member_profile(profile_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: event_direct_key_sentinel event_direct_key_sentinel_retirement_target_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_direct_key_sentinel
    ADD CONSTRAINT event_direct_key_sentinel_retirement_target_fk FOREIGN KEY (retirement_target_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: event_stream_key_state event_stream_key_state_stream_id_active_epoch_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_stream_key_state
    ADD CONSTRAINT event_stream_key_state_stream_id_active_epoch_fkey FOREIGN KEY (stream_id, active_epoch) REFERENCES public.event_stream_keys(stream_id, key_epoch) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: event_stream_keys event_stream_keys_wrap_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_stream_keys
    ADD CONSTRAINT event_stream_keys_wrap_kid_fkey FOREIGN KEY (wrap_kid) REFERENCES public.event_direct_key_sentinel(kid) NOT VALID;


--
-- Name: events events_stream_key_epoch_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_stream_key_epoch_fk FOREIGN KEY (stream_id, stream_key_epoch) REFERENCES public.event_stream_keys(stream_id, key_epoch);


--
-- Name: external_identity external_identity_method_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT;


--
-- Name: external_identity external_identity_method_identity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_method_identity_fkey FOREIGN KEY (method_id, principal_id, method_kind) REFERENCES public.authentication_method(method_id, principal_id, kind) ON DELETE RESTRICT;


--
-- Name: external_identity external_identity_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: game_index game_index_pack_artifact_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_index
    ADD CONSTRAINT game_index_pack_artifact_fkey FOREIGN KEY (pack_key, pack_version, pack_content_hash) REFERENCES public.pack_artifact(pack_key, pack_version, content_hash) ON DELETE RESTRICT;


--
-- Name: game_invitation game_invitation_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_invitation
    ADD CONSTRAINT game_invitation_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.auth_account(account_id);


--
-- Name: game_persona_name_claim game_persona_name_claim_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_name_claim
    ADD CONSTRAINT game_persona_name_claim_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: game_persona_name_history game_persona_name_history_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_name_history
    ADD CONSTRAINT game_persona_name_history_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: game_persona_public game_persona_public_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_public
    ADD CONSTRAINT game_persona_public_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: game_persona_redaction game_persona_redaction_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_redaction
    ADD CONSTRAINT game_persona_redaction_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: game_persona_subject_binding game_persona_subject_binding_claim_subject_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_subject_binding
    ADD CONSTRAINT game_persona_subject_binding_claim_subject_fkey FOREIGN KEY (current_claim_id, subject_id) REFERENCES public.subject_private_claim(claim_id, subject_id) ON DELETE RESTRICT;


--
-- Name: game_persona_subject_binding game_persona_subject_binding_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_subject_binding
    ADD CONSTRAINT game_persona_subject_binding_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: game_persona_subject_binding game_persona_subject_binding_subject_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_persona_subject_binding
    ADD CONSTRAINT game_persona_subject_binding_subject_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: investigation_memory investigation_memory_result_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigation_memory
    ADD CONSTRAINT investigation_memory_result_private_kid_fkey FOREIGN KEY (result_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: media_upload_ledger media_upload_ledger_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.media_upload_ledger
    ADD CONSTRAINT media_upload_ledger_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: member_lifecycle_event member_lifecycle_event_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_event
    ADD CONSTRAINT member_lifecycle_event_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: member_lifecycle_event member_lifecycle_event_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_event
    ADD CONSTRAINT member_lifecycle_event_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: member_lifecycle_projection member_lifecycle_projection_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_projection
    ADD CONSTRAINT member_lifecycle_projection_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: member_lifecycle_projection member_lifecycle_projection_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_lifecycle_projection
    ADD CONSTRAINT member_lifecycle_projection_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: member_personal_export member_personal_export_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_export
    ADD CONSTRAINT member_personal_export_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: member_personal_export member_personal_export_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_personal_export
    ADD CONSTRAINT member_personal_export_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: member_profile member_profile_active_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_active_principal_id_fkey FOREIGN KEY (subject_id, active_principal_id) REFERENCES public.privacy_subject(subject_id, principal_id) ON DELETE RESTRICT;


--
-- Name: member_profile member_profile_current_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_current_claim_id_fkey FOREIGN KEY (current_claim_id, subject_id) REFERENCES public.subject_private_claim(claim_id, subject_id) ON DELETE SET NULL (current_claim_id);


--
-- Name: member_profile member_profile_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: membership_ancestry membership_ancestry_ancestor_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_ancestry
    ADD CONSTRAINT membership_ancestry_ancestor_fkey FOREIGN KEY (ancestor_membership_id) REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT;


--
-- Name: membership_ancestry membership_ancestry_descendant_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.membership_ancestry
    ADD CONSTRAINT membership_ancestry_descendant_fkey FOREIGN KEY (descendant_membership_id) REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT;


--
-- Name: moderation_case_history moderation_case_history_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_case_history
    ADD CONSTRAINT moderation_case_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_case(case_id) ON DELETE CASCADE;


--
-- Name: moderation_report moderation_report_case_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.moderation_report
    ADD CONSTRAINT moderation_report_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_case(case_id) ON DELETE CASCADE;


--
-- Name: player_info_result player_info_result_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_info_result
    ADD CONSTRAINT player_info_result_private_kid_fkey FOREIGN KEY (result_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: player_investigation_result player_investigation_result_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_investigation_result
    ADD CONSTRAINT player_investigation_result_private_kid_fkey FOREIGN KEY (result_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: privacy_subject privacy_subject_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_subject
    ADD CONSTRAINT privacy_subject_principal_id_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: private_channel_member private_channel_member_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_channel_member
    ADD CONSTRAINT private_channel_member_private_kid_fkey FOREIGN KEY (private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: profile_mute profile_mute_target_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_mute
    ADD CONSTRAINT profile_mute_target_profile_id_fkey FOREIGN KEY (target_profile_id) REFERENCES public.member_profile(profile_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: public_citation public_citation_quoted_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_citation
    ADD CONSTRAINT public_citation_quoted_fkey FOREIGN KEY (quoted_surface_id, quoted_source_seq) REFERENCES public.public_publication(surface_id, source_seq) ON DELETE CASCADE;


--
-- Name: public_citation public_citation_quoting_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_citation
    ADD CONSTRAINT public_citation_quoting_fkey FOREIGN KEY (quoting_surface_id, quoting_source_seq) REFERENCES public.public_publication(surface_id, source_seq) ON DELETE CASCADE;


--
-- Name: public_profile public_profile_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_profile
    ADD CONSTRAINT public_profile_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.member_profile(profile_id) ON DELETE CASCADE;


--
-- Name: public_publication public_publication_surface_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_publication
    ADD CONSTRAINT public_publication_surface_id_fkey FOREIGN KEY (surface_id) REFERENCES public.publication_surface(surface_id) ON DELETE CASCADE;


--
-- Name: public_search_document public_search_document_surface_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_search_document
    ADD CONSTRAINT public_search_document_surface_id_fkey FOREIGN KEY (surface_id) REFERENCES public.publication_surface(surface_id) ON DELETE CASCADE;


--
-- Name: public_watch_period public_watch_period_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_watch_period
    ADD CONSTRAINT public_watch_period_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.public_watch(subscription_id) ON DELETE CASCADE;


--
-- Name: slot_occupancy_epoch slot_occupancy_epoch_persona_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_occupancy_epoch
    ADD CONSTRAINT slot_occupancy_epoch_persona_fkey FOREIGN KEY (game_id, persona_id) REFERENCES public.game_persona(game_id, persona_id) ON DELETE RESTRICT;


--
-- Name: slot_state slot_state_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_state
    ADD CONSTRAINT slot_state_private_kid_fkey FOREIGN KEY (private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: subject_erasure subject_erasure_erasure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure
    ADD CONSTRAINT subject_erasure_erasure_id_fkey FOREIGN KEY (erasure_id) REFERENCES public.subject_erasure_outbox(erasure_id) ON DELETE RESTRICT;


--
-- Name: subject_erasure_outbox subject_erasure_outbox_exact_owner_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_erasure_outbox
    ADD CONSTRAINT subject_erasure_outbox_exact_owner_fkey FOREIGN KEY (subject_id, principal_id) REFERENCES public.privacy_subject(subject_id, principal_id) ON DELETE RESTRICT;


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_erasure_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_key_destruction_receipt
    ADD CONSTRAINT subject_key_destruction_receipt_erasure_id_fkey FOREIGN KEY (erasure_id) REFERENCES public.subject_erasure_outbox(erasure_id) ON DELETE RESTRICT;


--
-- Name: subject_key_destruction_receipt subject_key_destruction_receipt_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_key_destruction_receipt
    ADD CONSTRAINT subject_key_destruction_receipt_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject_tombstone(subject_id) ON DELETE RESTRICT;


--
-- Name: subject_private_claim subject_private_claim_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_private_claim
    ADD CONSTRAINT subject_private_claim_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: subject_tombstone subject_tombstone_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subject_tombstone
    ADD CONSTRAINT subject_tombstone_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;


--
-- Name: thread_view thread_view_body_private_kid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_view
    ADD CONSTRAINT thread_view_body_private_kid_fkey FOREIGN KEY (body_private_kid) REFERENCES public.event_direct_key_sentinel(kid);


--
-- Name: workos_provider_session workos_provider_session_external_identity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_external_identity_fkey FOREIGN KEY (method_id, subject) REFERENCES public.external_identity(method_id, subject) ON DELETE RESTRICT;


--
-- Name: workos_provider_session workos_provider_session_method_identity_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_method_identity_fkey FOREIGN KEY (method_id, principal_id, method_kind) REFERENCES public.authentication_method(method_id, principal_id, kind) ON DELETE RESTRICT;


--
-- Name: workos_provider_session workos_provider_session_principal_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_principal_fkey FOREIGN KEY (principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- Name: workos_session_exchange workos_session_exchange_linking_session_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_session_exchange
    ADD CONSTRAINT workos_session_exchange_linking_session_fkey FOREIGN KEY (linking_session_hash) REFERENCES public.auth_session(token_hash) ON DELETE RESTRICT;


--
-- Name: workos_session_exchange workos_session_exchange_provider_session_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_session_exchange
    ADD CONSTRAINT workos_session_exchange_provider_session_fkey FOREIGN KEY (provider_session_id) REFERENCES public.workos_provider_session(provider_session_id) ON DELETE RESTRICT;


--
-- Name: workos_signing_key_tombstone workos_signing_key_tombstone_retired_by_principal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.workos_signing_key_tombstone
    ADD CONSTRAINT workos_signing_key_tombstone_retired_by_principal_id_fkey FOREIGN KEY (retired_by_principal_id) REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT;


--
-- PostgreSQL database dump complete
--
