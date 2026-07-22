-- 0002_workos_identity.sql — append-only external identity and live-ticket schema.

CREATE TABLE public.platform_principal (
    principal_user_id text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    global_capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    CONSTRAINT platform_principal_id_check CHECK ((length(TRIM(BOTH FROM principal_user_id)) > 0)),
    CONSTRAINT platform_principal_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT platform_principal_disabled_shape_check CHECK ((((status = 'active'::text) AND (disabled_at IS NULL)) OR ((status = 'disabled'::text) AND (disabled_at IS NOT NULL))))
);

CREATE TABLE public.external_identity (
    provider text NOT NULL,
    subject text NOT NULL,
    principal_user_id text NOT NULL,
    display_label text,
    created_at bigint NOT NULL,
    last_seen_at bigint NOT NULL,
    CONSTRAINT external_identity_provider_check CHECK ((length(TRIM(BOTH FROM provider)) > 0)),
    CONSTRAINT external_identity_subject_check CHECK ((length(TRIM(BOTH FROM subject)) > 0)),
    CONSTRAINT external_identity_seen_check CHECK ((last_seen_at >= created_at))
);

CREATE TABLE public.auth_websocket_ticket (
    token_hash text NOT NULL,
    auth_kind text NOT NULL,
    session_reference text NOT NULL,
    access_expires_at bigint NOT NULL,
    principal_user_id text NOT NULL,
    audience text NOT NULL,
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    slot_id text,
    after_seq bigint DEFAULT 0 NOT NULL,
    issued_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    consumed_at bigint,
    CONSTRAINT auth_websocket_ticket_auth_kind_check CHECK ((auth_kind = ANY (ARRAY['workos'::text, 'legacy-dev'::text]))),
    CONSTRAINT auth_websocket_ticket_access_expiry_check CHECK ((access_expires_at > issued_at)),
    CONSTRAINT auth_websocket_ticket_after_seq_check CHECK ((after_seq >= 0)),
    CONSTRAINT auth_websocket_ticket_audience_check CHECK ((length(TRIM(BOTH FROM audience)) > 0)),
    CONSTRAINT auth_websocket_ticket_channel_check CHECK ((length(TRIM(BOTH FROM channel_id)) > 0)),
    CONSTRAINT auth_websocket_ticket_expiry_check CHECK ((expires_at > issued_at)),
    CONSTRAINT auth_websocket_ticket_principal_check CHECK ((length(TRIM(BOTH FROM principal_user_id)) > 0))
);

ALTER TABLE ONLY public.platform_principal
    ADD CONSTRAINT platform_principal_pkey PRIMARY KEY (principal_user_id);

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_pkey PRIMARY KEY (provider, subject);

ALTER TABLE ONLY public.auth_websocket_ticket
    ADD CONSTRAINT auth_websocket_ticket_pkey PRIMARY KEY (token_hash);

CREATE INDEX auth_websocket_ticket_expiry_idx ON public.auth_websocket_ticket USING btree (expires_at) WHERE (consumed_at IS NULL);

CREATE INDEX auth_websocket_ticket_session_idx ON public.auth_websocket_ticket USING btree (auth_kind, session_reference);

CREATE INDEX external_identity_principal_idx ON public.external_identity USING btree (principal_user_id);

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_principal_user_id_fkey FOREIGN KEY (principal_user_id) REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT;
