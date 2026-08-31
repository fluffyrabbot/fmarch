-- Remove every session whose authority cannot be proven under the new model.
-- Delegated-admin sessions are gone; legacy Dev sessions have no process
-- issuer; legacy WorkOS sessions have no verified signing-key provenance.
-- No authority-bearing row is relabeled or backfilled with invented origin.

DELETE FROM public.auth_websocket_ticket AS ticket
USING public.auth_session AS session
WHERE ticket.session_reference = session.token_hash
  AND (
      session.assurance IN ('admin_grant', 'dev', 'external_sso')
      OR cardinality(session.global_capabilities) <> 0
  );

-- The redundant ticket kind was caller-maintained metadata and could disagree
-- with the referenced session. Delete any conservatively suspicious legacy
-- row before replacing that metadata with referential integrity.
DELETE FROM public.auth_websocket_ticket
WHERE auth_kind IN ('admin_grant', 'dev');

-- Preserve the one-time assertion replay record while severing the reference
-- to a session whose old provenance is no longer admissible. Deleting the
-- exchange would make an already-consumed signed assertion reusable.
UPDATE public.workos_session_exchange AS exchange
SET linking_session_hash = NULL
FROM public.auth_session AS session
WHERE exchange.linking_session_hash = session.token_hash
  AND (
      session.assurance IN ('admin_grant', 'dev', 'external_sso')
      OR cardinality(session.global_capabilities) <> 0
  );

DELETE FROM public.auth_session
WHERE assurance IN ('admin_grant', 'dev', 'external_sso')
   OR cardinality(global_capabilities) <> 0;

-- A legacy invitation that carried authority is a capability credential, not
-- an ordinary invitation. Invalidate it rather than silently converting it to
-- a weaker but still redeemable credential before removing the authority copy.
DELETE FROM public.game_invitation
WHERE cardinality(global_capabilities) <> 0;

DELETE FROM public.auth_websocket_ticket AS ticket
WHERE NOT EXISTS (
    SELECT 1
    FROM public.auth_session AS session
    WHERE session.token_hash = ticket.session_reference
);

ALTER TABLE public.auth_session
    ADD COLUMN local_proof_instance_id text,
    ADD COLUMN workos_signing_key_id text;

-- Global authority has exactly one durable home: platform_principal. Hosted
-- sessions and invitations carry identity/provenance only; classic account
-- details never duplicate principal authority.
ALTER TABLE public.auth_session
    DROP COLUMN global_capabilities;
ALTER TABLE public.game_invitation
    DROP COLUMN global_capabilities;
ALTER TABLE public.auth_account
    DROP COLUMN global_capabilities;

ALTER TABLE public.auth_session
    DROP CONSTRAINT auth_session_assurance_check;
ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_assurance_check
    CHECK (assurance IN ('password', 'external_sso', 'dev'));

ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_local_proof_instance_shape_check
    CHECK (
        (
            assurance = 'dev'
            AND local_proof_instance_id IS NOT NULL
            AND local_proof_instance_id ~ '^[0-9a-f]{64}$'
        )
        OR (
            assurance <> 'dev'
            AND local_proof_instance_id IS NULL
        )
    ),
    ADD CONSTRAINT auth_session_workos_signing_key_shape_check
    CHECK (
        (
            assurance = 'external_sso'
            AND workos_signing_key_id IS NOT NULL
            AND octet_length(workos_signing_key_id) BETWEEN 1 AND 256
            AND workos_signing_key_id ~ '^[!-~]+$'
        )
        OR (
            assurance <> 'external_sso'
            AND workos_signing_key_id IS NULL
        )
    );

CREATE INDEX auth_session_workos_signing_key_idx
    ON public.auth_session (workos_signing_key_id)
    WHERE revoked_at IS NULL AND workos_signing_key_id IS NOT NULL;

-- A retired provider key can never become admissible again. The tombstone is
-- append-only at the database boundary and is consulted under the same
-- per-key transaction lock used by WorkOS session issuance.
CREATE TABLE public.workos_signing_key_tombstone (
    signing_key_id text PRIMARY KEY,
    retired_at bigint NOT NULL,
    retired_by_principal_id uuid NOT NULL
        REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT,
    reason text NOT NULL,
    CONSTRAINT workos_signing_key_tombstone_key_shape_check
        CHECK (
            octet_length(signing_key_id) BETWEEN 1 AND 256
            AND signing_key_id ~ '^[!-~]+$'
        ),
    CONSTRAINT workos_signing_key_tombstone_reason_check
        CHECK (
            reason = btrim(reason)
            AND octet_length(reason) BETWEEN 1 AND 512
            AND reason !~ '[[:cntrl:]]'
        )
);
CREATE TRIGGER workos_signing_key_tombstone_no_mutation
    BEFORE DELETE OR UPDATE OR TRUNCATE
    ON public.workos_signing_key_tombstone
    FOR EACH STATEMENT
    EXECUTE FUNCTION public.subject_privacy_append_only_guard();

DROP INDEX public.auth_websocket_ticket_session_idx;
DROP INDEX public.auth_websocket_ticket_principal_idx;
DROP INDEX public.auth_websocket_ticket_expiry_idx;
ALTER TABLE public.auth_websocket_ticket
    DROP COLUMN auth_kind,
    DROP COLUMN principal_id,
    DROP COLUMN consumed_at,
    ADD CONSTRAINT auth_websocket_ticket_session_reference_fkey
        FOREIGN KEY (session_reference)
        REFERENCES public.auth_session(token_hash)
        ON DELETE CASCADE;
CREATE INDEX auth_websocket_ticket_session_idx
    ON public.auth_websocket_ticket (session_reference);
CREATE INDEX auth_websocket_ticket_expiry_idx
    ON public.auth_websocket_ticket (LEAST(expires_at, access_expires_at));
