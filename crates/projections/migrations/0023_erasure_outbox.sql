-- 0023_erasure_outbox.sql — crash-safe, externally completed subject erasure.

ALTER TABLE public.privacy_subject
    ADD CONSTRAINT privacy_subject_exact_owner_unique
        UNIQUE (subject_id, principal_user_id);

ALTER TABLE public.privacy_subject
    DROP CONSTRAINT privacy_subject_lifecycle_state_check,
    ADD CONSTRAINT privacy_subject_lifecycle_state_check
        CHECK (lifecycle_state IN ('active', 'erasure_pending', 'erased'));

-- Immutable work payload. This is committed with the authentication cutoff,
-- before any object-authority mutation is attempted.
CREATE TABLE public.subject_erasure_outbox (
    erasure_id uuid PRIMARY KEY,
    subject_id uuid NOT NULL UNIQUE,
    principal_user_id text NOT NULL UNIQUE,
    receipt_id uuid NOT NULL UNIQUE,
    replacement_alias text NOT NULL UNIQUE,
    key_fingerprint_sha256 text NOT NULL,
    requested_at bigint NOT NULL,
    authority_id uuid,
    authority_revision text,
    authority_manifest_sha256 text,
    payload_version smallint NOT NULL DEFAULT 1,
    CONSTRAINT subject_erasure_outbox_exact_owner_fkey
        FOREIGN KEY (subject_id, principal_user_id)
        REFERENCES public.privacy_subject (subject_id, principal_user_id)
        ON DELETE RESTRICT,
    CONSTRAINT subject_erasure_outbox_fingerprint_check
        CHECK (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
    CONSTRAINT subject_erasure_outbox_alias_check
        CHECK (length(replacement_alias) > 0),
    CONSTRAINT subject_erasure_outbox_payload_version_check
        CHECK (payload_version = 1),
    CONSTRAINT subject_erasure_outbox_authority_check CHECK (
        (authority_id IS NULL
         AND authority_revision IS NULL
         AND authority_manifest_sha256 IS NULL)
        OR
        (authority_id IS NOT NULL
         AND length(authority_revision) > 0
         AND authority_manifest_sha256 ~ '^[0-9a-f]{64}$')
    )
);

-- Mutable delivery state is deliberately separate from the create-only
-- payload. Claims are short database transactions; object-store I/O happens
-- only after the claim transaction commits.
CREATE TABLE public.subject_erasure (
    erasure_id uuid PRIMARY KEY
        REFERENCES public.subject_erasure_outbox(erasure_id) ON DELETE RESTRICT,
    state text NOT NULL DEFAULT 'pending',
    claim_token uuid,
    claim_owner text,
    claim_expires_at bigint,
    attempt_count integer NOT NULL DEFAULT 0,
    last_attempt_at bigint,
    completed_at bigint,
    CONSTRAINT subject_erasure_state_check
        CHECK (state IN ('pending', 'complete')),
    CONSTRAINT subject_erasure_attempt_count_check
        CHECK (attempt_count >= 0),
    CONSTRAINT subject_erasure_claim_shape_check CHECK (
        (claim_token IS NULL AND claim_owner IS NULL AND claim_expires_at IS NULL)
        OR
        (state = 'pending'
         AND claim_token IS NOT NULL
         AND length(claim_owner) > 0
         AND claim_expires_at IS NOT NULL)
    ),
    CONSTRAINT subject_erasure_completion_shape_check CHECK (
        (state = 'pending' AND completed_at IS NULL)
        OR
        (state = 'complete'
         AND completed_at IS NOT NULL
         AND claim_token IS NULL
         AND claim_owner IS NULL
         AND claim_expires_at IS NULL)
    )
);

ALTER TABLE public.subject_key_destruction_receipt
    ADD COLUMN erasure_id uuid NOT NULL UNIQUE
        REFERENCES public.subject_erasure_outbox(erasure_id) ON DELETE RESTRICT;

CREATE INDEX subject_erasure_pending_claim_idx
    ON public.subject_erasure (claim_expires_at, erasure_id)
    WHERE state = 'pending';

-- Every request/finalize scrub below is principal-scoped. These indexes keep
-- the owner-locked transaction bounded under the service's 5s statement
-- timeout instead of turning account erasure into unrelated table scans.
CREATE INDEX auth_delivery_intent_principal_idx
    ON public.auth_delivery_intent (principal_user_id);
CREATE INDEX auth_websocket_ticket_principal_idx
    ON public.auth_websocket_ticket (principal_user_id);
CREATE INDEX thread_view_author_user_idx
    ON public.thread_view (author_user)
    WHERE author_user IS NOT NULL;
CREATE INDEX identity_lifecycle_audit_actor_idx
    ON public.identity_lifecycle_audit (actor_user_id);
CREATE INDEX game_persona_private_principal_erasure_idx
    ON public.game_persona_private (principal_user_id);

-- Restore reconciliation classifies authenticated journal subjects in one
-- batched membership query. Foreign keys do not create their own indexes;
-- these leading subject keys prevent correlated history probes from scanning
-- the lifecycle/export tables for every journal record.
CREATE INDEX member_lifecycle_event_subject_idx
    ON public.member_lifecycle_event (subject_id);
CREATE INDEX member_lifecycle_projection_subject_idx
    ON public.member_lifecycle_projection (subject_id);
CREATE INDEX member_personal_export_subject_idx
    ON public.member_personal_export (subject_id);

CREATE TRIGGER subject_erasure_outbox_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.subject_erasure_outbox
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

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

CREATE TRIGGER subject_erasure_state_transition_guard
    BEFORE UPDATE ON public.subject_erasure
    FOR EACH ROW EXECUTE FUNCTION public.subject_erasure_state_guard();

CREATE TRIGGER subject_erasure_no_delete
    BEFORE DELETE OR TRUNCATE ON public.subject_erasure
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();
