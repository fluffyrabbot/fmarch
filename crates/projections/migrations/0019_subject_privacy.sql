-- 0019_subject_privacy.sql — subject-owned claims with externally destructible keys.

CREATE TABLE public.subject_authority_binding (
    singleton boolean PRIMARY KEY DEFAULT TRUE,
    authority_id uuid NOT NULL,
    authority_revision text NOT NULL,
    manifest_sha256 text NOT NULL,
    bound_at bigint NOT NULL,
    CONSTRAINT subject_authority_binding_singleton_check CHECK (singleton),
    CONSTRAINT subject_authority_binding_revision_check CHECK (length(authority_revision) > 0),
    CONSTRAINT subject_authority_binding_manifest_check
        CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE public.privacy_subject (
    subject_id uuid PRIMARY KEY,
    principal_user_id text UNIQUE REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT,
    created_at bigint NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'active',
    CONSTRAINT privacy_subject_lifecycle_state_check
        CHECK (lifecycle_state IN ('active', 'erased'))
);

CREATE TABLE public.subject_private_claim (
    claim_id uuid PRIMARY KEY,
    subject_id uuid NOT NULL REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT,
    claim_kind text NOT NULL,
    scope_id uuid NOT NULL,
    scope_key text,
    envelope jsonb NOT NULL,
    created_at bigint NOT NULL,
    CONSTRAINT subject_private_claim_kind_check CHECK (claim_kind IN ('profile', 'game_persona')),
    CONSTRAINT subject_private_claim_scope_check CHECK (
        (claim_kind = 'profile' AND scope_key IS NULL)
        OR (claim_kind = 'game_persona' AND scope_key IS NOT NULL AND length(scope_key) > 0)
    )
);

CREATE TABLE public.subject_tombstone (
    subject_id uuid PRIMARY KEY REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT,
    replacement_alias text NOT NULL UNIQUE,
    destroyed_at bigint NOT NULL,
    CONSTRAINT subject_tombstone_alias_check CHECK (length(replacement_alias) > 0)
);

CREATE TABLE public.subject_key_destruction_receipt (
    receipt_id uuid PRIMARY KEY,
    subject_id uuid NOT NULL UNIQUE REFERENCES public.subject_tombstone(subject_id) ON DELETE RESTRICT,
    key_fingerprint_sha256 text NOT NULL,
    key_was_present boolean NOT NULL,
    destroyed_at bigint NOT NULL,
    CONSTRAINT subject_key_destruction_receipt_fingerprint_check
        CHECK (key_fingerprint_sha256 ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.member_profile
    ADD COLUMN subject_id uuid REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT,
    ADD COLUMN current_claim_id uuid REFERENCES public.subject_private_claim(claim_id) ON DELETE SET NULL;

ALTER TABLE public.member_profile
    ALTER COLUMN subject_id SET NOT NULL;

ALTER TABLE ONLY public.member_profile
    ADD CONSTRAINT member_profile_active_principal_id_fkey
        FOREIGN KEY (active_principal_id)
        REFERENCES public.platform_principal(principal_user_id)
        ON DELETE RESTRICT,
    ADD CONSTRAINT member_profile_subject_id_key UNIQUE (subject_id),
    ADD CONSTRAINT member_profile_active_redacted_shape_check CHECK (
        (
            lifecycle = 'active'
            AND active_principal_id IS NOT NULL
            AND current_claim_id IS NOT NULL
            AND handle_hmac IS NOT NULL
            AND octet_length(handle_hmac) = 32
            AND redacted_alias IS NULL
        )
        OR
        (
            lifecycle = 'redacted'
            AND active_principal_id IS NULL
            AND current_claim_id IS NULL
            AND handle_hmac IS NULL
            AND redacted_alias IS NOT NULL
        )
    );

ALTER TABLE public.game_persona_private
    ADD COLUMN subject_id uuid REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT,
    ADD COLUMN current_claim_id uuid REFERENCES public.subject_private_claim(claim_id) ON DELETE SET NULL;

ALTER TABLE public.member_lifecycle_projection
    ADD COLUMN subject_id uuid REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;

ALTER TABLE public.member_lifecycle_event
    ADD COLUMN subject_id uuid REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT;

ALTER TABLE public.member_personal_export
    RENAME COLUMN artifact_json TO envelope;

ALTER TABLE public.member_personal_export
    ADD COLUMN subject_id uuid NOT NULL REFERENCES public.privacy_subject(subject_id) ON DELETE RESTRICT,
    ADD CONSTRAINT member_personal_export_envelope_shape CHECK (
        jsonb_typeof(envelope) = 'object'
        AND envelope->>'scheme' = 'fmarch-subject-claim-v1'
        AND envelope->>'alg' = 'XChaCha20Poly1305'
        AND jsonb_typeof(envelope->'nonce') = 'string'
        AND jsonb_typeof(envelope->'ciphertext') = 'string'
    );

CREATE INDEX subject_private_claim_subject_idx
    ON public.subject_private_claim (subject_id, created_at, claim_id);
CREATE INDEX subject_private_claim_scope_idx
    ON public.subject_private_claim (claim_kind, scope_id, scope_key, created_at);
CREATE INDEX member_profile_subject_idx ON public.member_profile (subject_id);
CREATE INDEX game_persona_private_subject_idx
    ON public.game_persona_private (subject_id, game_id, persona_id);

CREATE FUNCTION public.subject_privacy_append_only_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION '% is append-only: % is forbidden', TG_TABLE_NAME, TG_OP;
END;
$$;

CREATE TRIGGER subject_authority_binding_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.subject_authority_binding
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

CREATE TRIGGER subject_tombstone_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.subject_tombstone
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

CREATE TRIGGER subject_key_destruction_receipt_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE ON public.subject_key_destruction_receipt
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

CREATE TRIGGER subject_private_claim_no_update
    BEFORE UPDATE OR TRUNCATE ON public.subject_private_claim
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

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

CREATE TRIGGER subject_private_claim_active_subject_only
    BEFORE INSERT ON public.subject_private_claim
    FOR EACH ROW EXECUTE FUNCTION public.subject_private_claim_reject_tombstoned();

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

CREATE TRIGGER privacy_subject_no_reactivation
    BEFORE UPDATE OF lifecycle_state ON public.privacy_subject
    FOR EACH ROW EXECUTE FUNCTION public.privacy_subject_irreversible_erasure();
