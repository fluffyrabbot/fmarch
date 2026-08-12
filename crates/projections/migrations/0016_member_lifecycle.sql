-- 0016_member_lifecycle.sql — durable, append-only member data-lifecycle authority.

CREATE TABLE public.member_lifecycle_event (
    principal_user_id text NOT NULL REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT,
    seq bigint NOT NULL,
    kind text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at bigint NOT NULL,
    CONSTRAINT member_lifecycle_event_pkey PRIMARY KEY (principal_user_id, seq),
    CONSTRAINT member_lifecycle_event_seq_check CHECK (seq > 0),
    CONSTRAINT member_lifecycle_event_kind_check CHECK (kind IN (
        'MemberDeactivated',
        'MemberErasureRequested',
        'MemberCredentialsErased',
        'MemberAuthorshipPseudonymized',
        'MemberPersonalExportRecorded'
    ))
);

CREATE TABLE public.member_lifecycle_projection (
    principal_user_id text PRIMARY KEY REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT,
    status text NOT NULL DEFAULT 'active',
    last_seq bigint NOT NULL DEFAULT 0,
    deactivated_at bigint,
    erasure_requested_at bigint,
    credentials_erased_at bigint,
    authorship_pseudonymized_at bigint,
    personal_export_recorded_at bigint,
    pseudonym text,
    CONSTRAINT member_lifecycle_projection_status_check CHECK (status IN ('active', 'deactivated', 'erasure_in_progress', 'erased')),
    CONSTRAINT member_lifecycle_projection_seq_check CHECK (last_seq >= 0)
);

CREATE TABLE public.member_personal_export (
    export_id uuid PRIMARY KEY,
    principal_user_id text NOT NULL REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT,
    requested_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    artifact_json jsonb NOT NULL,
    recorded_seq bigint NOT NULL,
    CONSTRAINT member_personal_export_expiry_check CHECK (expires_at > requested_at),
    CONSTRAINT member_personal_export_seq_check CHECK (recorded_seq > 0)
);

-- A redaction is an overlay, not a rewrite of the immutable game stream or
-- persona-name history. Public presentation layers must prefer this name.
CREATE TABLE public.game_persona_redaction (
    game_id uuid NOT NULL,
    persona_id text NOT NULL,
    replacement_public_name text NOT NULL,
    redacted_at bigint NOT NULL,
    PRIMARY KEY (game_id, persona_id)
);

CREATE INDEX member_lifecycle_event_principal_seq_idx
    ON public.member_lifecycle_event (principal_user_id, seq);
CREATE INDEX member_personal_export_principal_requested_idx
    ON public.member_personal_export (principal_user_id, requested_at DESC);
