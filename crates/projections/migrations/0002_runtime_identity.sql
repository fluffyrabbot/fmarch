-- 0002_runtime_identity.sql — append-only delivery, receipt, and external identity schema.

ALTER TABLE public.auth_delivery_intent
    ADD COLUMN credential_expires_at bigint;

-- Existing delivery credentials predate explicit expiry tracking. Expire them
-- closed instead of extending an unknown credential lifetime.
UPDATE public.auth_delivery_intent
SET credential_expires_at = created_at + 1;

ALTER TABLE public.auth_delivery_intent
    ALTER COLUMN credential_expires_at SET NOT NULL;

ALTER TABLE public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_credential_expiry_check CHECK ((credential_expires_at > created_at));

ALTER TABLE public.auth_delivery_intent
    DROP CONSTRAINT auth_delivery_intent_delivery_shape_check,
    DROP CONSTRAINT auth_delivery_intent_outcome_kind_check,
    DROP CONSTRAINT auth_delivery_intent_status_check;

ALTER TABLE public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_delivery_shape_check CHECK ((((status = 'queued'::text) AND (outcome_kind = 'queued'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'processing'::text) AND (outcome_kind = 'processing'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NOT NULL) AND (claim_expires_at IS NOT NULL)) OR ((status = 'delivered'::text) AND (outcome_kind = 'delivered'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NOT NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NOT NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'retryable_failed'::text) AND (outcome_kind = 'retryable_failure'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'permanent_failed'::text) AND (outcome_kind = 'permanent_failure'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'cancelled'::text) AND (outcome_kind = 'cancelled'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL) AND (credential_envelope IS NULL)))),
    ADD CONSTRAINT auth_delivery_intent_outcome_kind_check CHECK ((outcome_kind = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failure'::text, 'permanent_failure'::text, 'cancelled'::text]))),
    ADD CONSTRAINT auth_delivery_intent_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failed'::text, 'permanent_failed'::text, 'cancelled'::text])));

ALTER TABLE public.command_receipt
    ADD COLUMN command_fingerprint bytea;

-- Legacy receipts cannot prove a request fingerprint. A zero sentinel makes
-- every future reuse of those command ids fail closed as a conflict.
UPDATE public.command_receipt
SET command_fingerprint = decode(repeat('00', 32), 'hex');

ALTER TABLE public.command_receipt
    ALTER COLUMN command_fingerprint SET NOT NULL;

ALTER TABLE public.command_receipt
    ADD CONSTRAINT command_receipt_fingerprint_check CHECK ((octet_length(command_fingerprint) = 32));

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
