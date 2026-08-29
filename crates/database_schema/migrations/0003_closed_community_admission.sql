-- Separate existing-member game invitations from community admission, then
-- introduce the membership, invitation, credential, and ancestry projections
-- required by RFC 0005.

ALTER TABLE public.auth_invite RENAME TO game_invitation;
ALTER TABLE public.game_invitation RENAME CONSTRAINT auth_invite_pkey TO game_invitation_pkey;
ALTER TABLE public.game_invitation RENAME CONSTRAINT auth_invite_account_id_fkey TO game_invitation_account_id_fkey;
ALTER INDEX public.auth_invite_account_idx RENAME TO game_invitation_account_idx;
ALTER INDEX public.auth_invite_expiry_idx RENAME TO game_invitation_expiry_idx;
ALTER INDEX public.auth_invite_game_idx RENAME TO game_invitation_game_idx;
ALTER INDEX public.auth_invite_principal_idx RENAME TO game_invitation_principal_idx;
ALTER INDEX public.auth_invite_revocation_idx RENAME TO game_invitation_revocation_idx;

ALTER TABLE public.auth_delivery_intent
    DROP CONSTRAINT auth_delivery_intent_delivery_kind_check;
ALTER TABLE public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_delivery_kind_check
    CHECK (delivery_kind IN ('invite', 'recovery', 'community_invitation'));

-- Delivery targets can be prospective accounts. The durable intent remains
-- owned by principal_id, while account_id is the normalized recipient address
-- and must not require an auth_account to exist before delivery.
ALTER TABLE public.auth_delivery_intent
    DROP CONSTRAINT auth_delivery_intent_account_id_fkey;

CREATE TABLE public.community_membership (
    membership_id uuid PRIMARY KEY,
    active_principal_id uuid,
    status text NOT NULL,
    origin_kind text NOT NULL,
    admission_invitation_id uuid UNIQUE,
    sponsoring_membership_id uuid,
    admitted_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    revision bigint NOT NULL,
    retained_alias text,
    CONSTRAINT community_membership_origin_shape_check CHECK (
        (origin_kind = 'founder' AND admission_invitation_id IS NULL AND sponsoring_membership_id IS NULL)
        OR
        (origin_kind = 'invitation' AND admission_invitation_id IS NOT NULL AND sponsoring_membership_id IS NOT NULL AND sponsoring_membership_id <> membership_id)
    ),
    CONSTRAINT community_membership_principal_shape_check CHECK (
        (status IN ('active', 'suspended') AND active_principal_id IS NOT NULL AND retained_alias IS NULL)
        OR (status = 'withdrawn' AND retained_alias IS NULL)
        OR (status = 'redacted' AND active_principal_id IS NULL AND retained_alias IS NOT NULL)
    ),
    CONSTRAINT community_membership_revision_check CHECK (revision > 0),
    CONSTRAINT community_membership_status_check CHECK (status IN ('active', 'suspended', 'withdrawn', 'redacted')),
    CONSTRAINT community_membership_time_check CHECK (updated_at >= admitted_at),
    CONSTRAINT community_membership_active_principal_fkey FOREIGN KEY (active_principal_id)
        REFERENCES public.platform_principal(principal_id) ON DELETE RESTRICT,
    CONSTRAINT community_membership_sponsor_fkey FOREIGN KEY (sponsoring_membership_id)
        REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX community_membership_active_principal_unique
    ON public.community_membership(active_principal_id)
    WHERE active_principal_id IS NOT NULL;
CREATE INDEX community_membership_sponsor_idx
    ON public.community_membership(sponsoring_membership_id)
    WHERE sponsoring_membership_id IS NOT NULL;
CREATE INDEX community_membership_status_idx
    ON public.community_membership(status, membership_id);

CREATE TABLE public.community_invitation (
    invitation_id uuid PRIMARY KEY,
    sponsoring_membership_id uuid NOT NULL,
    target_index text NOT NULL,
    expires_at bigint NOT NULL,
    status text NOT NULL,
    admitted_membership_id uuid UNIQUE,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    revision bigint NOT NULL,
    CONSTRAINT community_invitation_revision_check CHECK (revision > 0),
    CONSTRAINT community_invitation_status_check CHECK (status IN ('issued', 'accepted', 'revoked')),
    CONSTRAINT community_invitation_status_shape_check CHECK (
        (status = 'accepted' AND admitted_membership_id IS NOT NULL)
        OR (status IN ('issued', 'revoked') AND admitted_membership_id IS NULL)
    ),
    CONSTRAINT community_invitation_target_check CHECK (length(target_index) = 64 AND target_index ~ '^[0-9a-f]{64}$'),
    CONSTRAINT community_invitation_time_check CHECK (expires_at > created_at AND updated_at >= created_at),
    CONSTRAINT community_invitation_sponsor_fkey FOREIGN KEY (sponsoring_membership_id)
        REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT,
    CONSTRAINT community_invitation_admitted_membership_fkey FOREIGN KEY (admitted_membership_id)
        REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT
);

ALTER TABLE public.community_membership
    ADD CONSTRAINT community_membership_admission_invitation_fkey
    FOREIGN KEY (admission_invitation_id)
    REFERENCES public.community_invitation(invitation_id)
    ON DELETE RESTRICT;

CREATE INDEX community_invitation_sponsor_idx
    ON public.community_invitation(sponsoring_membership_id, status, invitation_id);
CREATE INDEX community_invitation_expiry_idx
    ON public.community_invitation(expires_at)
    WHERE status = 'issued';

CREATE TABLE public.community_invitation_credential (
    token_hash text PRIMARY KEY,
    invitation_id uuid NOT NULL UNIQUE,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    consumed_at bigint,
    revoked_at bigint,
    CONSTRAINT community_invitation_credential_hash_check CHECK (length(token_hash) = 64 AND token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT community_invitation_credential_terminal_check CHECK (NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)),
    CONSTRAINT community_invitation_credential_time_check CHECK (expires_at > created_at),
    CONSTRAINT community_invitation_credential_invitation_fkey FOREIGN KEY (invitation_id)
        REFERENCES public.community_invitation(invitation_id) ON DELETE CASCADE
);

CREATE INDEX community_invitation_credential_expiry_idx
    ON public.community_invitation_credential(expires_at)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE public.membership_ancestry (
    ancestor_membership_id uuid NOT NULL,
    descendant_membership_id uuid NOT NULL,
    depth integer NOT NULL,
    CONSTRAINT membership_ancestry_pkey PRIMARY KEY (ancestor_membership_id, descendant_membership_id),
    CONSTRAINT membership_ancestry_depth_check CHECK (depth >= 0),
    CONSTRAINT membership_ancestry_self_shape_check CHECK (
        (depth = 0 AND ancestor_membership_id = descendant_membership_id)
        OR (depth > 0 AND ancestor_membership_id <> descendant_membership_id)
    ),
    CONSTRAINT membership_ancestry_ancestor_fkey FOREIGN KEY (ancestor_membership_id)
        REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT,
    CONSTRAINT membership_ancestry_descendant_fkey FOREIGN KEY (descendant_membership_id)
        REFERENCES public.community_membership(membership_id) ON DELETE RESTRICT
);

CREATE INDEX membership_ancestry_descendant_idx
    ON public.membership_ancestry(descendant_membership_id, depth);
