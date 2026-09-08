-- Make the configured identity-delivery adapter a database-owned authority.
-- Retained generations prevent an old rolling process from silently resuming
-- work after an endpoint change or provider cutover. The bearer token is
-- deliberately excluded from the persisted configuration fingerprint so
-- credential rotation does not require a delivery generation change.

CREATE TABLE public.auth_delivery_provider_authority (
    generation_id text PRIMARY KEY,
    configuration_fingerprint text NOT NULL,
    activated_at bigint NOT NULL,
    last_bound_at bigint NOT NULL,
    circuit_version bigint DEFAULT 0 NOT NULL,
    retired_at bigint,
    suspended_at bigint,
    suspension_code text,
    -- Diagnostic correlation only. This deliberately is not a foreign key:
    -- privacy erasure may delete the delivery row while the provider-wide
    -- suspension must remain in force for every other principal.
    suspension_observation_id uuid,
    probe_token uuid,
    probe_expires_at bigint,
    CONSTRAINT auth_delivery_provider_authority_generation_check
        CHECK (
            octet_length(generation_id) BETWEEN 1 AND 128
            AND btrim(generation_id) = generation_id
        ),
    CONSTRAINT auth_delivery_provider_authority_fingerprint_check
        CHECK (configuration_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT auth_delivery_provider_authority_circuit_version_check
        CHECK (circuit_version >= 0),
    CONSTRAINT auth_delivery_provider_authority_probe_check
        CHECK (
            (probe_token IS NULL AND probe_expires_at IS NULL)
            OR
            (probe_token IS NOT NULL AND probe_expires_at IS NOT NULL)
        ),
    CONSTRAINT auth_delivery_provider_authority_time_check
        CHECK (
            last_bound_at >= activated_at
            AND (retired_at IS NULL OR retired_at >= activated_at)
            AND (suspended_at IS NULL OR suspended_at >= activated_at)
            AND (
                probe_expires_at IS NULL
                OR (
                    suspended_at IS NOT NULL
                    AND probe_expires_at > suspended_at
                )
            )
        ),
    CONSTRAINT auth_delivery_provider_authority_lifecycle_check
        CHECK (
            (
                retired_at IS NULL
                AND (
                    (
                        suspended_at IS NULL
                        AND suspension_code IS NULL
                        AND suspension_observation_id IS NULL
                        AND probe_token IS NULL
                        AND probe_expires_at IS NULL
                    )
                    OR
                    (
                        suspended_at IS NOT NULL
                        AND suspension_code = 'provider_unavailable'
                        AND suspension_observation_id IS NOT NULL
                    )
                )
            )
            OR
            (
                retired_at IS NOT NULL
                AND suspended_at IS NULL
                AND suspension_code IS NULL
                AND suspension_observation_id IS NULL
                AND probe_token IS NULL
                AND probe_expires_at IS NULL
            )
        )
);

-- There may be no active generation before the first process binds startup,
-- but every steady state has at most one. Startup serializes generation
-- mutation; runtime enqueue and claim transactions share-lock the active row.
CREATE UNIQUE INDEX auth_delivery_provider_authority_one_active
    ON public.auth_delivery_provider_authority ((true))
    WHERE retired_at IS NULL;

-- Generation identity is append-only, retirement is irreversible, and every
-- circuit mutation advances a monotonic CAS version. Keep these invariants in
-- PostgreSQL so a rolling process cannot weaken them with stale application
-- logic.
CREATE FUNCTION public.auth_delivery_provider_authority_invariant_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.generation_id <> OLD.generation_id
       OR NEW.configuration_fingerprint <> OLD.configuration_fingerprint
       OR NEW.activated_at <> OLD.activated_at
    THEN
        RAISE EXCEPTION 'identity delivery provider generation identity is immutable'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.last_bound_at < OLD.last_bound_at THEN
        RAISE EXCEPTION 'identity delivery provider binding time cannot move backwards'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.circuit_version < OLD.circuit_version THEN
        RAISE EXCEPTION 'identity delivery provider circuit version cannot move backwards'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.retired_at IS NOT NULL
       AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
    THEN
        RAISE EXCEPTION 'identity delivery provider retirement is irreversible'
            USING ERRCODE = '23514';
    END IF;
    IF OLD.suspended_at IS NOT NULL
       AND NEW.suspended_at IS NOT NULL
       AND NEW.suspended_at < OLD.suspended_at
    THEN
        RAISE EXCEPTION 'identity delivery provider suspension time cannot move backwards'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_delivery_provider_authority_invariant_guard
BEFORE UPDATE
ON public.auth_delivery_provider_authority
FOR EACH ROW
EXECUTE FUNCTION public.auth_delivery_provider_authority_invariant_guard();

-- This fence intentionally contains no principal, account, credential, or
-- delivery identifier. It survives subject erasure long enough to prove that
-- no bounded provider call from a retired generation can still be in flight.
CREATE TABLE public.auth_delivery_provider_attempt_fence (
    attempt_token uuid PRIMARY KEY,
    generation_id text NOT NULL,
    started_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    CONSTRAINT auth_delivery_provider_attempt_fence_time_check
        CHECK (expires_at > started_at),
    CONSTRAINT auth_delivery_provider_attempt_fence_generation_fkey
        FOREIGN KEY (generation_id)
        REFERENCES public.auth_delivery_provider_authority(generation_id)
        ON UPDATE RESTRICT
        ON DELETE RESTRICT
);

CREATE INDEX auth_delivery_provider_attempt_fence_expiry_idx
    ON public.auth_delivery_provider_attempt_fence (expires_at, generation_id);

-- A processing row created before delivery-v2 never gave the remote provider
-- a hard effect deadline. No local timestamp can prove that handler quiesced,
-- so the authority cut requires operators to drain old workers and claims
-- before migration rather than manufacturing a generation fence.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.auth_delivery_intent
        WHERE status = 'processing'
    ) THEN
        RAISE EXCEPTION 'identity delivery provider-authority migration requires a drained processing queue';
    END IF;
END;
$$;

-- Preserve any pre-authority terminal history as retired, never-reusable
-- generations. A nonterminal legacy generation intentionally blocks startup
-- until it is resolved instead of guessing which endpoint owns the work.
INSERT INTO public.auth_delivery_provider_authority (
    generation_id,
    configuration_fingerprint,
    activated_at,
    last_bound_at,
    retired_at,
    suspended_at,
    suspension_code,
    suspension_observation_id,
    probe_token,
    probe_expires_at
)
SELECT provider_id,
       repeat('0', 64),
       min(created_at),
       max(updated_at),
       max(updated_at),
       NULL,
       NULL,
       NULL,
       NULL,
       NULL
FROM public.auth_delivery_intent
GROUP BY provider_id;

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_provider_generation_fkey
    FOREIGN KEY (provider_id)
    REFERENCES public.auth_delivery_provider_authority(generation_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT;

-- Database-owned rollout fence. INSERT takes the active provider row lock
-- before publishing a queue item. A legacy claim reaches this trigger with the
-- delivery row already locked, so it takes the same provider lock before it can
-- enter processing; new code already holds the provider lock. Finalization
-- never takes provider-before-delivery, avoiding an inverse lock cycle.
CREATE FUNCTION public.auth_delivery_intent_provider_authority_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    provider_is_operable boolean;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status <> 'queued' THEN
        RAISE EXCEPTION 'identity delivery intents must enter through queued state'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.provider_id <> OLD.provider_id THEN
        RAISE EXCEPTION 'identity delivery provider generation is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT'
       OR (
           TG_OP = 'UPDATE'
           AND NEW.status = 'processing'
           AND (
               OLD.status <> 'processing'
               OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
           )
       )
    THEN
        SELECT TRUE
        INTO provider_is_operable
        FROM public.auth_delivery_provider_authority
        WHERE generation_id = NEW.provider_id
          AND retired_at IS NULL
          AND suspended_at IS NULL
        FOR SHARE;

        IF provider_is_operable IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'identity delivery provider generation is not active and operable'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_delivery_intent_provider_authority_guard
BEFORE INSERT OR UPDATE OF status, provider_id, claim_token
ON public.auth_delivery_intent
FOR EACH ROW
EXECUTE FUNCTION public.auth_delivery_intent_provider_authority_guard();

-- Every transition into a fresh processing lease publishes a provider attempt
-- fence in the same transaction. This covers old application binaries as soon
-- as the migration lands and remains after privacy erasure removes the intent.
CREATE FUNCTION public.auth_delivery_intent_attempt_fence_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO public.auth_delivery_provider_attempt_fence (
        attempt_token,
        generation_id,
        started_at,
        expires_at
    ) VALUES (
        NEW.claim_token,
        NEW.provider_id,
        NEW.updated_at,
        NEW.claim_expires_at
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER auth_delivery_intent_attempt_fence_insert
AFTER UPDATE OF status, claim_token, claim_expires_at
ON public.auth_delivery_intent
FOR EACH ROW
WHEN (
    NEW.status = 'processing'
    AND NEW.claim_token IS NOT NULL
    AND NEW.claim_expires_at IS NOT NULL
    AND (
        OLD.status <> 'processing'
        OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
    )
)
EXECUTE FUNCTION public.auth_delivery_intent_attempt_fence_insert();
