-- 0027_workos_session_lifecycle.sql — exact-assertion replay and upstream logout custody.

-- Existing WorkOS app sessions predate custody of the signed provider `sid`.
-- The unvalidated constraint leaves those rows in place without granting them
-- authority: runtime eligibility rejects a missing sid, while every new write
-- is checked and must carry canonical provider-session custody.
ALTER TABLE public.auth_session
    ADD COLUMN workos_session_id text;

ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_workos_session_shape_check
    CHECK (
        (
            assurance = 'external_sso'
            AND workos_session_id IS NOT NULL
            AND authenticated_via_method_id IS NOT NULL
            AND workos_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'
        )
        OR (
            assurance = 'external_sso'
            AND workos_session_id IS NULL
            AND revoked_at IS NOT NULL
        )
        OR (
            assurance IS DISTINCT FROM 'external_sso'
            AND workos_session_id IS NULL
        )
    ) NOT VALID;

CREATE INDEX auth_session_workos_session_idx
    ON public.auth_session (workos_session_id)
    WHERE workos_session_id IS NOT NULL;

-- A provider session is a durable security boundary, distinct from both an
-- access-token assertion and a local app session. Once logged out, its row is
-- a tombstone: an access token minted earlier but presented later cannot
-- recreate local authority.
ALTER TABLE public.external_identity
    ADD CONSTRAINT external_identity_method_subject_key UNIQUE (method_id, subject);

CREATE TABLE public.workos_provider_session (
    provider_session_id text PRIMARY KEY,
    subject text NOT NULL,
    principal_user_id text NOT NULL,
    method_id uuid NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_at bigint NOT NULL,
    last_seen_at bigint NOT NULL,
    access_expires_at bigint NOT NULL,
    logged_out_at bigint,
    method_kind text GENERATED ALWAYS AS ('workos'::text) STORED,
    CONSTRAINT workos_provider_session_id_check
        CHECK (provider_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$'),
    CONSTRAINT workos_provider_session_subject_check
        CHECK (length(trim(subject)) > 0),
    CONSTRAINT workos_provider_session_status_check
        CHECK (status IN ('active', 'logged_out')),
    CONSTRAINT workos_provider_session_time_check
        CHECK (
            last_seen_at >= created_at
            AND access_expires_at > last_seen_at
        ),
    CONSTRAINT workos_provider_session_logout_shape_check
        CHECK (
            (status = 'active' AND logged_out_at IS NULL)
            OR (
                status = 'logged_out'
                AND logged_out_at IS NOT NULL
                AND logged_out_at >= last_seen_at
            )
        ),
    CONSTRAINT workos_provider_session_principal_fkey
        FOREIGN KEY (principal_user_id)
        REFERENCES public.platform_principal(principal_user_id)
        ON DELETE RESTRICT,
    CONSTRAINT workos_provider_session_method_identity_fkey
        FOREIGN KEY (method_id, principal_user_id, method_kind)
        REFERENCES public.authentication_method(method_id, principal_user_id, kind)
        ON DELETE RESTRICT,
    CONSTRAINT workos_provider_session_external_identity_fkey
        FOREIGN KEY (method_id, subject)
        REFERENCES public.external_identity(method_id, subject)
        ON DELETE RESTRICT
);

ALTER TABLE public.workos_provider_session
    ADD CONSTRAINT workos_provider_session_identity_key
    UNIQUE (provider_session_id, principal_user_id, method_id);

CREATE INDEX workos_provider_session_principal_idx
    ON public.workos_provider_session (principal_user_id, status);

-- Any provider sessions observed before this migration lack local `sid`
-- custody. Preserve their assertion history and retire the complete provider
-- session so no already-minted sibling assertion can cross the new boundary.
INSERT INTO public.workos_provider_session (
    provider_session_id,
    subject,
    principal_user_id,
    method_id,
    status,
    created_at,
    last_seen_at,
    access_expires_at,
    logged_out_at
)
SELECT exchange.provider_session_id,
       exchange.subject,
       identity.principal_user_id,
       identity.method_id,
       'logged_out',
       MIN(exchange.exchanged_at),
       MAX(exchange.exchanged_at),
       MAX(exchange.access_expires_at),
       MAX(exchange.exchanged_at)
FROM public.workos_session_exchange AS exchange
JOIN public.external_identity AS identity
  ON identity.provider = 'workos'
 AND identity.subject = exchange.subject
WHERE identity.method_id IS NOT NULL
GROUP BY exchange.provider_session_id,
         exchange.subject,
         identity.principal_user_id,
         identity.method_id;

-- Permanent deny evidence retains only a one-way fingerprint of the
-- high-entropy provider sid. The PII-bound provider-session row may therefore
-- be removed during subject erasure without reopening old offline assertions.
CREATE TABLE public.workos_provider_session_tombstone (
    provider_session_hash text PRIMARY KEY,
    tombstoned_at bigint NOT NULL,
    reason text NOT NULL,
    CONSTRAINT workos_provider_session_tombstone_hash_check
        CHECK (provider_session_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workos_provider_session_tombstone_reason_check
        CHECK (reason IN ('logout', 'link_completed', 'method_disabled', 'subject_erasure', 'migration_cutover'))
);

INSERT INTO public.workos_provider_session_tombstone (
    provider_session_hash,
    tombstoned_at,
    reason
)
SELECT encode(sha256(convert_to(provider_session_id, 'UTF8')), 'hex'),
       logged_out_at,
       'migration_cutover'
FROM public.workos_provider_session
WHERE status = 'logged_out';

-- An old assertion row whose external-identity binding is incomplete cannot
-- enter the new custody registry. Retire its sid permanently; the unvalidated
-- foreign key below grandfathers only that historical assertion evidence while
-- rejecting every new unmatched exchange.
INSERT INTO public.workos_provider_session_tombstone (
    provider_session_hash,
    tombstoned_at,
    reason
)
SELECT encode(sha256(convert_to(exchange.provider_session_id, 'UTF8')), 'hex'),
       MAX(exchange.exchanged_at),
       'migration_cutover'
FROM public.workos_session_exchange AS exchange
LEFT JOIN public.workos_provider_session AS provider_session
  ON provider_session.provider_session_id = exchange.provider_session_id
WHERE provider_session.provider_session_id IS NULL
GROUP BY exchange.provider_session_id
ON CONFLICT DO NOTHING;

CREATE TRIGGER workos_provider_session_tombstone_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE
    ON public.workos_provider_session_tombstone
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

-- Erasure must also deny an assertion minted for the same WorkOS subject by a
-- provider session that this application never observed. Only the one-way
-- fingerprint survives; the raw external subject remains erasable.
CREATE TABLE public.workos_subject_tombstone (
    provider_subject_hash text PRIMARY KEY,
    tombstoned_at bigint NOT NULL,
    reason text NOT NULL,
    CONSTRAINT workos_subject_tombstone_hash_check
        CHECK (provider_subject_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workos_subject_tombstone_reason_check
        CHECK (reason = 'subject_erasure')
);

CREATE TRIGGER workos_subject_tombstone_no_mutation
    BEFORE UPDATE OR DELETE OR TRUNCATE
    ON public.workos_subject_tombstone
    FOR EACH STATEMENT EXECUTE FUNCTION public.subject_privacy_append_only_guard();

ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_workos_provider_session_fkey
    FOREIGN KEY (
        workos_session_id,
        principal_user_id,
        authenticated_via_method_id
    )
    REFERENCES public.workos_provider_session (
        provider_session_id,
        principal_user_id,
        method_id
    )
    ON DELETE RESTRICT
    NOT VALID;

-- A WorkOS session may mint several distinct access tokens. Each exact signed
-- assertion can be exchanged once; the provider session id is lifecycle
-- metadata and therefore deliberately non-unique.
ALTER TABLE public.workos_session_exchange
    DROP CONSTRAINT workos_session_exchange_pkey,
    DROP CONSTRAINT workos_session_exchange_access_token_hash_key,
    DROP COLUMN subject;

ALTER TABLE public.workos_session_exchange
    ADD COLUMN linking_session_hash text,
    ADD CONSTRAINT workos_session_exchange_pkey PRIMARY KEY (access_token_hash),
    ADD CONSTRAINT workos_session_exchange_provider_session_fkey
        FOREIGN KEY (provider_session_id)
        REFERENCES public.workos_provider_session(provider_session_id)
        ON DELETE RESTRICT
        NOT VALID,
    ADD CONSTRAINT workos_session_exchange_assertion_hash_check
        CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT workos_session_exchange_linking_session_hash_check
        CHECK (
            linking_session_hash IS NULL
            OR linking_session_hash ~ '^[0-9a-f]{64}$'
        ),
    ADD CONSTRAINT workos_session_exchange_linking_session_fkey
        FOREIGN KEY (linking_session_hash)
        REFERENCES public.auth_session(token_hash)
        ON DELETE RESTRICT,
    ADD CONSTRAINT workos_session_exchange_provider_session_id_check
        CHECK (provider_session_id ~ '^session_[0-9A-HJKMNP-TV-Z]{26}$');

CREATE INDEX workos_session_exchange_provider_session_idx
    ON public.workos_session_exchange (provider_session_id);

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
            WHERE outbox.principal_user_id = OLD.principal_user_id
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
       OR NEW.principal_user_id <> OLD.principal_user_id
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

CREATE TRIGGER workos_provider_session_guard
    BEFORE INSERT OR UPDATE OR DELETE ON public.workos_provider_session
    FOR EACH ROW EXECUTE FUNCTION public.workos_provider_session_guard_mutation();

CREATE TRIGGER workos_provider_session_truncate_guard
    BEFORE TRUNCATE ON public.workos_provider_session
    FOR EACH STATEMENT EXECUTE FUNCTION public.workos_provider_session_guard_mutation();
