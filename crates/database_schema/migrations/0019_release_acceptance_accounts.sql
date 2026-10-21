-- Release acceptance accounts. A staging release mints short sessions for
-- exactly two stable principals (one admitted member, one outsider) so that
-- authenticated acceptance needs no human, browser, mailbox, or identity
-- provider. Each principal holds one release_acceptance method, its session
-- assurance names that origin, and its membership has neither invitation nor
-- sponsor; like the active-status sponsor rule, the domain decision forbids
-- such a membership from sponsoring an invitation. The minting secret never
-- reaches the database; the server admits the route only when its verified
-- database identity is staging.

ALTER TABLE public.authentication_method
    DROP CONSTRAINT authentication_method_kind_check;
ALTER TABLE public.authentication_method
    ADD CONSTRAINT authentication_method_kind_check
    CHECK (kind IN ('classic_password', 'workos', 'release_acceptance'));

CREATE UNIQUE INDEX authentication_method_release_acceptance_unique
    ON public.authentication_method (principal_id)
    WHERE kind = 'release_acceptance';

ALTER TABLE public.auth_session
    DROP CONSTRAINT auth_session_assurance_check;
ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_assurance_check
    CHECK (assurance IN ('password', 'external_sso', 'dev', 'release_acceptance'));

ALTER TABLE public.community_membership
    DROP CONSTRAINT community_membership_origin_shape_check;
ALTER TABLE public.community_membership
    ADD CONSTRAINT community_membership_origin_shape_check CHECK (
        (origin_kind IN ('founder', 'release_acceptance')
            AND admission_invitation_id IS NULL
            AND sponsoring_membership_id IS NULL)
        OR
        (origin_kind = 'invitation'
            AND admission_invitation_id IS NOT NULL
            AND sponsoring_membership_id IS NOT NULL
            AND sponsoring_membership_id <> membership_id)
    );

CREATE TABLE public.release_acceptance_account (
    role text NOT NULL,
    principal_id uuid NOT NULL,
    method_id uuid NOT NULL,
    method_kind text GENERATED ALWAYS AS ('release_acceptance'::text) STORED,
    created_at bigint NOT NULL,
    CONSTRAINT release_acceptance_account_pkey PRIMARY KEY (role),
    CONSTRAINT release_acceptance_account_principal_key UNIQUE (principal_id),
    CONSTRAINT release_acceptance_account_method_key UNIQUE (method_id),
    CONSTRAINT release_acceptance_account_role_check CHECK (role IN ('member', 'outsider')),
    CONSTRAINT release_acceptance_account_created_at_check CHECK (created_at > 0),
    CONSTRAINT release_acceptance_account_principal_fkey FOREIGN KEY (principal_id)
        REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT,
    CONSTRAINT release_acceptance_account_method_identity_fkey
        FOREIGN KEY (method_id, principal_id, method_kind)
        REFERENCES public.authentication_method(method_id, principal_id, kind) ON DELETE RESTRICT
);
