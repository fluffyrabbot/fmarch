-- 0001_baseline.sql — complete greenfield event-store and projection schema.
--
-- This workspace has no deployed users or durable upgrade obligations. The
-- schema is intentionally expressed as one current-state baseline; future
-- pre-1.0 schema changes should keep this file current until migration history
-- becomes a product compatibility boundary. The projection-baseline contract
-- keeps this directory single-file and verifies the resulting catalog exactly.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: events_forbid_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.events_forbid_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only: % is forbidden', TG_OP;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: action_counter; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_counter (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    counter_id text NOT NULL,
    template_id text NOT NULL,
    consumed_action text NOT NULL,
    cadence_policy text NOT NULL,
    phase_scope text NOT NULL,
    limit_count integer NOT NULL,
    used_count integer NOT NULL,
    remaining_count integer NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: action_grant; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_grant (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    grant_id text NOT NULL,
    kind text NOT NULL,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    uses integer NOT NULL,
    vote_weight double precision,
    grant_option text
);


--
-- Name: action_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_history (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    template_id text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    targets jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text NOT NULL
);


--
-- Name: auth_account; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_account (
    account_id text NOT NULL,
    principal_user_id text NOT NULL,
    password_hash text NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    global_capabilities text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: auth_account_recovery_credential; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_account_recovery_credential (
    recovery_id uuid NOT NULL,
    account_id text NOT NULL,
    token_hash text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    used_at bigint,
    revoked_at bigint,
    CONSTRAINT auth_account_recovery_credential_check CHECK ((expires_at > created_at)),
    CONSTRAINT auth_account_recovery_credential_check1 CHECK (((used_at IS NULL) OR (revoked_at IS NULL)))
);


--
-- Name: auth_credential_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_credential_attempt (
    scope_hash text NOT NULL,
    window_started_at bigint NOT NULL,
    failure_count integer NOT NULL,
    blocked_until bigint,
    updated_at bigint NOT NULL,
    CONSTRAINT auth_credential_attempt_check CHECK (((blocked_until IS NULL) OR (blocked_until >= updated_at))),
    CONSTRAINT auth_credential_attempt_failure_count_check CHECK ((failure_count > 0))
);


--
-- Name: auth_delivery_intent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_delivery_intent (
    delivery_id uuid NOT NULL,
    delivery_kind text NOT NULL,
    account_id text NOT NULL,
    principal_user_id text NOT NULL,
    credential_hash text NOT NULL,
    credential_expires_at bigint NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at bigint,
    delivered_at bigint,
    last_error text,
    created_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    provider_id text NOT NULL,
    outcome_kind text NOT NULL,
    outcome_code text,
    provider_receipt_id text,
    claim_token uuid,
    claim_expires_at bigint,
    credential_envelope jsonb,
    CONSTRAINT auth_delivery_intent_attempt_count_check CHECK ((attempt_count >= 0)),
    CONSTRAINT auth_delivery_intent_credential_expiry_check CHECK ((credential_expires_at > created_at)),
    CONSTRAINT auth_delivery_intent_credential_envelope_check CHECK (((credential_envelope IS NULL) OR (jsonb_typeof(credential_envelope) = 'object'::text))),
    CONSTRAINT auth_delivery_intent_delivery_kind_check CHECK ((delivery_kind = ANY (ARRAY['invite'::text, 'recovery'::text]))),
    CONSTRAINT auth_delivery_intent_delivery_shape_check CHECK ((((status = 'queued'::text) AND (outcome_kind = 'queued'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'processing'::text) AND (outcome_kind = 'processing'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NOT NULL) AND (claim_expires_at IS NOT NULL)) OR ((status = 'delivered'::text) AND (outcome_kind = 'delivered'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NOT NULL) AND (outcome_code IS NULL) AND (provider_receipt_id IS NOT NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'retryable_failed'::text) AND (outcome_kind = 'retryable_failure'::text) AND (next_attempt_at IS NOT NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)) OR ((status = 'permanent_failed'::text) AND (outcome_kind = 'permanent_failure'::text) AND (next_attempt_at IS NULL) AND (delivered_at IS NULL) AND (outcome_code IS NOT NULL) AND (provider_receipt_id IS NULL) AND (claim_token IS NULL) AND (claim_expires_at IS NULL)))),
    CONSTRAINT auth_delivery_intent_outcome_kind_check CHECK ((outcome_kind = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failure'::text, 'permanent_failure'::text]))),
    CONSTRAINT auth_delivery_intent_provider_id_check CHECK ((length(TRIM(BOTH FROM provider_id)) > 0)),
    CONSTRAINT auth_delivery_intent_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'delivered'::text, 'retryable_failed'::text, 'permanent_failed'::text])))
);


--
-- Name: auth_invite; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_invite (
    token_hash text NOT NULL,
    principal_user_id text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    redeemed_at bigint,
    redeemed_session_token_hash text,
    global_capabilities text[] DEFAULT '{}'::text[] NOT NULL,
    invited_by_user_id text NOT NULL,
    revoked_at bigint,
    game uuid,
    account_id text NOT NULL
);


--
-- Name: auth_registration_attempt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_registration_attempt (
    scope_hash text NOT NULL,
    window_started_at bigint NOT NULL,
    attempt_count integer NOT NULL,
    blocked_until bigint,
    updated_at bigint NOT NULL,
    CONSTRAINT auth_registration_attempt_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT auth_registration_attempt_check CHECK (((blocked_until IS NULL) OR (blocked_until >= updated_at)))
);


--
-- Name: auth_session; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_session (
    token_hash text NOT NULL,
    principal_user_id text NOT NULL,
    created_at bigint NOT NULL,
    expires_at bigint NOT NULL,
    revoked_at bigint,
    global_capabilities text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: command_receipt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_receipt (
    principal_user_id text NOT NULL,
    command_id uuid NOT NULL,
    stream_id uuid NOT NULL,
    stream_seqs bigint[] NOT NULL
);


--
-- Name: day_vote_outcome; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.day_vote_outcome (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    source_seq bigint NOT NULL,
    event_index integer NOT NULL,
    status text NOT NULL,
    winner_slot text,
    contenders jsonb NOT NULL,
    tallies jsonb NOT NULL,
    votes jsonb NOT NULL,
    weights jsonb NOT NULL,
    majority double precision,
    thresholds jsonb NOT NULL,
    total_weight double precision NOT NULL,
    tiebreak text,
    reason text
);


--
-- Name: delayed_death_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delayed_death_queue (
    game_id uuid NOT NULL,
    queue_id text NOT NULL,
    target_slot text NOT NULL,
    cause text NOT NULL,
    effect text NOT NULL,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: discussion_area; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_area (
    area_id uuid NOT NULL,
    slug text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    created_seq bigint NOT NULL
);


--
-- Name: discussion_post; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_post (
    source_seq bigint NOT NULL,
    topic_id uuid NOT NULL,
    body text NOT NULL,
    created_seq bigint NOT NULL,
    author_profile_id uuid,
    created_at bigint DEFAULT 0 NOT NULL
);


--
-- Name: discussion_topic; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discussion_topic (
    topic_id uuid NOT NULL,
    area_id uuid NOT NULL,
    title text NOT NULL,
    post_count bigint DEFAULT 0 NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    moderated_seq bigint,
    author_profile_id uuid,
    posting_state text DEFAULT 'open'::text NOT NULL,
    visibility text DEFAULT 'visible'::text NOT NULL,
    version bigint DEFAULT 0 NOT NULL,
    created_at bigint DEFAULT 0 NOT NULL,
    updated_at bigint DEFAULT 0 NOT NULL,
    last_post_seq bigint,
    last_post_at bigint,
    CONSTRAINT discussion_topic_posting_state_check CHECK ((posting_state = ANY (ARRAY['open'::text, 'locked'::text]))),
    CONSTRAINT discussion_topic_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    seq bigint NOT NULL,
    stream_id uuid NOT NULL,
    stream_seq bigint NOT NULL,
    kind text NOT NULL,
    version smallint NOT NULL,
    payload jsonb NOT NULL,
    actor jsonb NOT NULL,
    occurred_at bigint NOT NULL,
    causation_id uuid,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: events_seq_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_seq_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_seq_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_seq_seq OWNED BY public.events.seq;


--
-- Name: game_authority; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_authority (
    game_id uuid NOT NULL,
    user_id text NOT NULL,
    role text NOT NULL
);


--
-- Name: game_index; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_index (
    game_id uuid NOT NULL,
    pack text NOT NULL,
    status text NOT NULL,
    phase_id text,
    created_seq bigint NOT NULL,
    started_seq bigint,
    completed_seq bigint,
    updated_seq bigint NOT NULL,
    CONSTRAINT game_index_status_check CHECK ((status = ANY (ARRAY['setup'::text, 'active'::text, 'completed'::text])))
);


--
-- Name: game_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_result (
    game_id uuid NOT NULL,
    winner text NOT NULL,
    reason text NOT NULL,
    metadata jsonb NOT NULL,
    phase_id text NOT NULL,
    source_seq bigint NOT NULL,
    event_index integer NOT NULL
);


--
-- Name: host_phase_control; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_phase_control (
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    stream_seq bigint NOT NULL,
    prompt_id text NOT NULL,
    source_phase_id text NOT NULL,
    target_phase_id text NOT NULL,
    reason text NOT NULL,
    skipped_phase_id text,
    occurred_at bigint NOT NULL
);


--
-- Name: host_prompt; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.host_prompt (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    prompt_id text NOT NULL,
    kind text NOT NULL,
    subject_slot text,
    reason text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    decision jsonb,
    resolved_by text,
    resolved_at bigint,
    public_resolution jsonb
);


--
-- Name: identity_lifecycle_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.identity_lifecycle_audit (
    id bigint NOT NULL,
    event_at bigint NOT NULL,
    event_kind text NOT NULL,
    actor_user_id text,
    principal_user_id text NOT NULL,
    token_hash text,
    related_token_hash text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: identity_lifecycle_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.identity_lifecycle_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: identity_lifecycle_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.identity_lifecycle_audit_id_seq OWNED BY public.identity_lifecycle_audit.id;


--
-- Name: investigation_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investigation_memory (
    game_id uuid NOT NULL,
    investigator_slot text NOT NULL,
    target_slot text NOT NULL,
    mode text NOT NULL,
    memory_scope text DEFAULT 'Target'::text NOT NULL,
    result jsonb NOT NULL,
    source_action text NOT NULL,
    template_id text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: phase_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.phase_state (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    locked boolean DEFAULT false NOT NULL,
    deadline bigint
);


--
-- Name: player_info_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_info_result (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    kind text NOT NULL,
    actor_slot text NOT NULL,
    target_slot text NOT NULL,
    source_action text NOT NULL,
    template_id text NOT NULL,
    result jsonb NOT NULL
);


--
-- Name: player_investigation_result; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_investigation_result (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    mode text NOT NULL,
    target_slot text NOT NULL,
    result jsonb NOT NULL
);


--
-- Name: player_notification; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.player_notification (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    event_index integer NOT NULL,
    audience_slot text NOT NULL,
    effect text NOT NULL,
    status text NOT NULL
);


--
-- Name: post_policy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_policy (
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    allow_media_only boolean DEFAULT false NOT NULL
);


--
-- Name: private_channel_member; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.private_channel_member (
    game_id uuid NOT NULL,
    channel_id text NOT NULL,
    kind text NOT NULL,
    slot_id text NOT NULL,
    role_key text NOT NULL,
    reveals_alignment text NOT NULL,
    source text NOT NULL
);


--
-- Name: profile_editor; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_editor (
    profile_id uuid NOT NULL,
    principal_user_id text NOT NULL,
    last_edit_seq bigint NOT NULL
);


--
-- Name: profile_public; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profile_public (
    profile_id uuid NOT NULL,
    handle text NOT NULL,
    display_name text NOT NULL,
    bio text NOT NULL,
    visibility text NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    CONSTRAINT profile_public_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'members'::text])))
);


--
-- Name: public_search_document; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.public_search_document (
    document_kind text NOT NULL,
    document_key text NOT NULL,
    scope_kind text NOT NULL,
    scope_id uuid NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    href text NOT NULL,
    updated_seq bigint NOT NULL,
    published_at bigint NOT NULL,
    search_vector tsvector GENERATED ALWAYS AS ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(body, ''::text)), 'B'::"char"))) STORED,
    CONSTRAINT public_search_document_document_kind_check CHECK ((document_kind = ANY (ARRAY['discussion_topic'::text, 'discussion_post'::text, 'profile'::text, 'game'::text, 'game_post'::text]))),
    CONSTRAINT public_search_document_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['discussion'::text, 'profile'::text, 'game'::text])))
);


--
-- Name: sheriff_badge; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sheriff_badge (
    game_id uuid NOT NULL,
    badge_id text NOT NULL,
    owner_slot text,
    vote_weight double precision,
    source_slot text NOT NULL,
    source_action text NOT NULL,
    reason text NOT NULL,
    destroyed boolean NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL
);


--
-- Name: slot_effect; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_effect (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    effect text NOT NULL,
    source_slot text NOT NULL,
    source_action text,
    phase_id text,
    phase_kind text,
    phase_number integer,
    duration text DEFAULT 'Persistent'::text NOT NULL,
    visibility text DEFAULT 'Hidden'::text NOT NULL
);


--
-- Name: slot_occupancy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_occupancy (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    occupant_user_id text NOT NULL
);


--
-- Name: slot_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_state (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    alive boolean DEFAULT true NOT NULL,
    role_key text,
    role_revealed boolean DEFAULT false NOT NULL,
    alignment_revealed boolean DEFAULT false NOT NULL,
    alignment text,
    status text DEFAULT 'alive'::text NOT NULL
);


--
-- Name: slot_status_tag; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.slot_status_tag (
    game_id uuid NOT NULL,
    slot_id text NOT NULL,
    tag text NOT NULL
);


--
-- Name: spectator_membership; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spectator_membership (
    game_id uuid NOT NULL,
    user_id text NOT NULL
);


--
-- Name: thread_view; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.thread_view (
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    stream_seq bigint NOT NULL,
    channel_id text NOT NULL,
    author_slot text,
    author_user text,
    phase_id text NOT NULL,
    body text NOT NULL,
    occurred_at bigint NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT thread_view_author_present CHECK (((author_slot IS NOT NULL) OR (author_user IS NOT NULL)))
);


--
-- Name: visit_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visit_history (
    game_id uuid NOT NULL,
    actor_slot text NOT NULL,
    target_slot text NOT NULL,
    template_id text NOT NULL,
    source_action text NOT NULL,
    phase_id text NOT NULL,
    phase_kind text NOT NULL,
    phase_number integer NOT NULL,
    visible boolean NOT NULL
);


--
-- Name: vote_ballot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vote_ballot (
    game_id uuid NOT NULL,
    phase_id text NOT NULL,
    actor_slot text NOT NULL,
    target text NOT NULL
);


--
-- Name: events seq; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN seq SET DEFAULT nextval('public.events_seq_seq'::regclass);


--
-- Name: identity_lifecycle_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_lifecycle_audit ALTER COLUMN id SET DEFAULT nextval('public.identity_lifecycle_audit_id_seq'::regclass);


--
-- Name: action_counter action_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_counter
    ADD CONSTRAINT action_counter_pkey PRIMARY KEY (game_id, slot_id, counter_id);


--
-- Name: action_grant action_grant_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_grant
    ADD CONSTRAINT action_grant_pkey PRIMARY KEY (game_id, slot_id, grant_id, source_slot, source_action, phase_id);


--
-- Name: action_history action_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_history
    ADD CONSTRAINT action_history_pkey PRIMARY KEY (game_id, slot_id, template_id, phase_id);


--
-- Name: auth_account auth_account_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_pkey PRIMARY KEY (account_id);


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_pkey PRIMARY KEY (recovery_id);


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_token_hash_key UNIQUE (token_hash);


--
-- Name: auth_credential_attempt auth_credential_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_credential_attempt
    ADD CONSTRAINT auth_credential_attempt_pkey PRIMARY KEY (scope_hash);


--
-- Name: auth_delivery_intent auth_delivery_intent_credential_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_credential_hash_key UNIQUE (credential_hash);


--
-- Name: auth_delivery_intent auth_delivery_intent_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_pkey PRIMARY KEY (delivery_id);


--
-- Name: auth_invite auth_invite_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_invite
    ADD CONSTRAINT auth_invite_pkey PRIMARY KEY (token_hash);


--
-- Name: auth_registration_attempt auth_registration_attempt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_registration_attempt
    ADD CONSTRAINT auth_registration_attempt_pkey PRIMARY KEY (scope_hash);


--
-- Name: auth_session auth_session_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_pkey PRIMARY KEY (token_hash);


--
-- Name: command_receipt command_receipt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_receipt
    ADD CONSTRAINT command_receipt_pkey PRIMARY KEY (principal_user_id, command_id);


--
-- Name: day_vote_outcome day_vote_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.day_vote_outcome
    ADD CONSTRAINT day_vote_outcome_pkey PRIMARY KEY (game_id, phase_id);


--
-- Name: delayed_death_queue delayed_death_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delayed_death_queue
    ADD CONSTRAINT delayed_death_queue_pkey PRIMARY KEY (game_id, queue_id);


--
-- Name: discussion_area discussion_area_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_area
    ADD CONSTRAINT discussion_area_pkey PRIMARY KEY (area_id);


--
-- Name: discussion_area discussion_area_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_area
    ADD CONSTRAINT discussion_area_slug_key UNIQUE (slug);


--
-- Name: discussion_post discussion_post_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_pkey PRIMARY KEY (source_seq);


--
-- Name: discussion_topic discussion_topic_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_pkey PRIMARY KEY (topic_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (seq);


--
-- Name: events events_stream_seq_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_stream_seq_unique UNIQUE (stream_id, stream_seq);


--
-- Name: game_authority game_authority_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_authority
    ADD CONSTRAINT game_authority_pkey PRIMARY KEY (game_id, user_id, role);


--
-- Name: game_index game_index_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_index
    ADD CONSTRAINT game_index_pkey PRIMARY KEY (game_id);


--
-- Name: game_result game_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_result
    ADD CONSTRAINT game_result_pkey PRIMARY KEY (game_id);


--
-- Name: host_phase_control host_phase_control_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_phase_control
    ADD CONSTRAINT host_phase_control_pkey PRIMARY KEY (game_id, prompt_id, stream_seq);


--
-- Name: host_prompt host_prompt_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.host_prompt
    ADD CONSTRAINT host_prompt_pkey PRIMARY KEY (game_id, prompt_id);


--
-- Name: identity_lifecycle_audit identity_lifecycle_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.identity_lifecycle_audit
    ADD CONSTRAINT identity_lifecycle_audit_pkey PRIMARY KEY (id);


--
-- Name: investigation_memory investigation_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investigation_memory
    ADD CONSTRAINT investigation_memory_pkey PRIMARY KEY (game_id, investigator_slot, target_slot, mode);


--
-- Name: phase_state phase_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.phase_state
    ADD CONSTRAINT phase_state_pkey PRIMARY KEY (game_id);


--
-- Name: player_info_result player_info_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_info_result
    ADD CONSTRAINT player_info_result_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: player_investigation_result player_investigation_result_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_investigation_result
    ADD CONSTRAINT player_investigation_result_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: player_notification player_notification_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.player_notification
    ADD CONSTRAINT player_notification_pkey PRIMARY KEY (game_id, phase_id, event_index, audience_slot);


--
-- Name: post_policy post_policy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_policy
    ADD CONSTRAINT post_policy_pkey PRIMARY KEY (game_id, channel_id);


--
-- Name: private_channel_member private_channel_member_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.private_channel_member
    ADD CONSTRAINT private_channel_member_pkey PRIMARY KEY (game_id, channel_id, slot_id);


--
-- Name: profile_editor profile_editor_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_editor
    ADD CONSTRAINT profile_editor_pkey PRIMARY KEY (profile_id);


--
-- Name: profile_editor profile_editor_principal_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_editor
    ADD CONSTRAINT profile_editor_principal_user_id_key UNIQUE (principal_user_id);


--
-- Name: profile_public profile_public_handle_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_public
    ADD CONSTRAINT profile_public_handle_key UNIQUE (handle);


--
-- Name: profile_public profile_public_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_public
    ADD CONSTRAINT profile_public_pkey PRIMARY KEY (profile_id);


--
-- Name: public_search_document public_search_document_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.public_search_document
    ADD CONSTRAINT public_search_document_pkey PRIMARY KEY (document_kind, document_key);


--
-- Name: sheriff_badge sheriff_badge_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sheriff_badge
    ADD CONSTRAINT sheriff_badge_pkey PRIMARY KEY (game_id, badge_id);


--
-- Name: slot_effect slot_effect_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_effect
    ADD CONSTRAINT slot_effect_pkey PRIMARY KEY (game_id, slot_id, effect);


--
-- Name: slot_occupancy slot_occupancy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_occupancy
    ADD CONSTRAINT slot_occupancy_pkey PRIMARY KEY (game_id, slot_id);


--
-- Name: slot_state slot_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_state
    ADD CONSTRAINT slot_state_pkey PRIMARY KEY (game_id, slot_id);


--
-- Name: slot_status_tag slot_status_tag_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.slot_status_tag
    ADD CONSTRAINT slot_status_tag_pkey PRIMARY KEY (game_id, slot_id, tag);


--
-- Name: spectator_membership spectator_membership_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spectator_membership
    ADD CONSTRAINT spectator_membership_pkey PRIMARY KEY (game_id, user_id);


--
-- Name: thread_view thread_view_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.thread_view
    ADD CONSTRAINT thread_view_pkey PRIMARY KEY (game_id, source_seq);


--
-- Name: visit_history visit_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visit_history
    ADD CONSTRAINT visit_history_pkey PRIMARY KEY (game_id, source_action, actor_slot, target_slot);


--
-- Name: vote_ballot vote_ballot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vote_ballot
    ADD CONSTRAINT vote_ballot_pkey PRIMARY KEY (game_id, phase_id, actor_slot);


--
-- Name: action_counter_slot_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_counter_slot_template_idx ON public.action_counter USING btree (game_id, slot_id, template_id);


--
-- Name: action_grant_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_grant_slot_idx ON public.action_grant USING btree (game_id, slot_id, grant_id, phase_number);


--
-- Name: action_history_slot_template_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX action_history_slot_template_idx ON public.action_history USING btree (game_id, slot_id, template_id, phase_number);


--
-- Name: auth_account_disabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_disabled_idx ON public.auth_account USING btree (disabled_at) WHERE (disabled_at IS NOT NULL);


--
-- Name: auth_account_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_principal_idx ON public.auth_account USING btree (principal_user_id);


--
-- Name: auth_account_recovery_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_recovery_account_idx ON public.auth_account_recovery_credential USING btree (account_id, created_at DESC);


--
-- Name: auth_account_recovery_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_account_recovery_active_idx ON public.auth_account_recovery_credential USING btree (expires_at) WHERE ((used_at IS NULL) AND (revoked_at IS NULL));


--
-- Name: auth_credential_attempt_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_credential_attempt_blocked_idx ON public.auth_credential_attempt USING btree (blocked_until) WHERE (blocked_until IS NOT NULL);


--
-- Name: auth_credential_attempt_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_credential_attempt_updated_idx ON public.auth_credential_attempt USING btree (updated_at);


--
-- Name: auth_delivery_intent_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_account_idx ON public.auth_delivery_intent USING btree (account_id, created_at DESC);


--
-- Name: auth_delivery_intent_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_claim_idx ON public.auth_delivery_intent USING btree (claim_expires_at) WHERE (status = 'processing'::text);


--
-- Name: auth_delivery_intent_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_delivery_intent_retry_idx ON public.auth_delivery_intent USING btree (next_attempt_at) WHERE (status = ANY (ARRAY['queued'::text, 'retryable_failed'::text]));


--
-- Name: auth_invite_account_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_invite_account_idx ON public.auth_invite USING btree (account_id);


--
-- Name: auth_invite_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_invite_expiry_idx ON public.auth_invite USING btree (expires_at) WHERE (redeemed_at IS NULL);


--
-- Name: auth_invite_game_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_invite_game_idx ON public.auth_invite USING btree (game) WHERE (game IS NOT NULL);


--
-- Name: auth_invite_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_invite_principal_idx ON public.auth_invite USING btree (principal_user_id);


--
-- Name: auth_invite_revocation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_invite_revocation_idx ON public.auth_invite USING btree (revoked_at) WHERE (revoked_at IS NOT NULL);


--
-- Name: auth_registration_attempt_blocked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_registration_attempt_blocked_idx ON public.auth_registration_attempt USING btree (blocked_until) WHERE (blocked_until IS NOT NULL);


--
-- Name: auth_registration_attempt_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_registration_attempt_updated_idx ON public.auth_registration_attempt USING btree (updated_at);


--
-- Name: auth_session_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_expiry_idx ON public.auth_session USING btree (expires_at);


--
-- Name: auth_session_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_session_principal_idx ON public.auth_session USING btree (principal_user_id);


--
-- Name: command_receipt_stream_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX command_receipt_stream_idx ON public.command_receipt USING btree (stream_id);


--
-- Name: day_vote_outcome_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX day_vote_outcome_source_idx ON public.day_vote_outcome USING btree (game_id, source_seq, event_index);


--
-- Name: delayed_death_queue_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX delayed_death_queue_target_idx ON public.delayed_death_queue USING btree (game_id, target_slot, effect);


--
-- Name: discussion_post_topic_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussion_post_topic_order_idx ON public.discussion_post USING btree (topic_id, source_seq DESC);


--
-- Name: discussion_topic_area_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discussion_topic_area_page_idx ON public.discussion_topic USING btree (area_id, updated_seq DESC, topic_id DESC) WHERE (visibility = 'visible'::text);


--
-- Name: events_stream_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX events_stream_order_idx ON public.events USING btree (stream_id, stream_seq);


--
-- Name: game_index_public_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX game_index_public_page_idx ON public.game_index USING btree (updated_seq DESC, game_id DESC) WHERE (status = ANY (ARRAY['active'::text, 'completed'::text]));


--
-- Name: host_phase_control_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX host_phase_control_phase_idx ON public.host_phase_control USING btree (game_id, source_phase_id, target_phase_id, stream_seq);


--
-- Name: host_prompt_phase_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX host_prompt_phase_idx ON public.host_prompt USING btree (game_id, phase_id, event_index);


--
-- Name: identity_lifecycle_audit_event_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_event_at_idx ON public.identity_lifecycle_audit USING btree (event_at DESC, id DESC);


--
-- Name: identity_lifecycle_audit_event_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_event_kind_idx ON public.identity_lifecycle_audit USING btree (event_kind, id DESC);


--
-- Name: identity_lifecycle_audit_principal_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX identity_lifecycle_audit_principal_idx ON public.identity_lifecycle_audit USING btree (principal_user_id, id DESC);


--
-- Name: investigation_memory_investigator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX investigation_memory_investigator_idx ON public.investigation_memory USING btree (game_id, investigator_slot, mode);


--
-- Name: player_info_result_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_info_result_audience_idx ON public.player_info_result USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: player_investigation_result_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_investigation_result_audience_idx ON public.player_investigation_result USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: player_notification_audience_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX player_notification_audience_idx ON public.player_notification USING btree (game_id, audience_slot, phase_id, event_index);


--
-- Name: private_channel_member_slot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX private_channel_member_slot_idx ON public.private_channel_member USING btree (game_id, slot_id, channel_id);


--
-- Name: profile_public_visible_handle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX profile_public_visible_handle_idx ON public.profile_public USING btree (handle) WHERE (visibility = 'public'::text);


--
-- Name: public_search_document_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_search_document_page_idx ON public.public_search_document USING btree (updated_seq DESC, document_kind, document_key);


--
-- Name: public_search_document_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_search_document_scope_idx ON public.public_search_document USING btree (scope_kind, scope_id);


--
-- Name: public_search_document_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX public_search_document_vector_idx ON public.public_search_document USING gin (search_vector);


--
-- Name: sheriff_badge_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sheriff_badge_owner_idx ON public.sheriff_badge USING btree (game_id, owner_slot) WHERE (owner_slot IS NOT NULL);


--
-- Name: slot_effect_by_effect_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_effect_by_effect_idx ON public.slot_effect USING btree (game_id, effect, slot_id);


--
-- Name: slot_occupancy_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_occupancy_user_idx ON public.slot_occupancy USING btree (game_id, occupant_user_id);


--
-- Name: slot_status_tag_by_tag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX slot_status_tag_by_tag_idx ON public.slot_status_tag USING btree (game_id, tag, slot_id);


--
-- Name: thread_view_page_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX thread_view_page_idx ON public.thread_view USING btree (game_id, channel_id, source_seq DESC);


--
-- Name: visit_history_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visit_history_actor_idx ON public.visit_history USING btree (game_id, actor_slot, phase_number, phase_id);


--
-- Name: visit_history_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visit_history_target_idx ON public.visit_history USING btree (game_id, target_slot, phase_number, phase_id);


--
-- Name: vote_ballot_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vote_ballot_target_idx ON public.vote_ballot USING btree (game_id, phase_id, target);


--
-- Name: events events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER events_no_update BEFORE DELETE OR UPDATE OR TRUNCATE ON public.events FOR EACH STATEMENT EXECUTE FUNCTION public.events_forbid_mutation();


--
-- Name: auth_account_recovery_credential auth_account_recovery_credential_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_account_recovery_credential
    ADD CONSTRAINT auth_account_recovery_credential_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.auth_account(account_id) ON DELETE CASCADE;


--
-- Name: auth_delivery_intent auth_delivery_intent_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_delivery_intent
    ADD CONSTRAINT auth_delivery_intent_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.auth_account(account_id) ON DELETE CASCADE;


--
-- Name: auth_invite auth_invite_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_invite
    ADD CONSTRAINT auth_invite_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.auth_account(account_id);


--
-- Name: discussion_post discussion_post_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_author_profile_id_fkey FOREIGN KEY (author_profile_id) REFERENCES public.profile_public(profile_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: discussion_post discussion_post_topic_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_post
    ADD CONSTRAINT discussion_post_topic_id_fkey FOREIGN KEY (topic_id) REFERENCES public.discussion_topic(topic_id) ON DELETE CASCADE;


--
-- Name: discussion_topic discussion_topic_area_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_area_id_fkey FOREIGN KEY (area_id) REFERENCES public.discussion_area(area_id);


--
-- Name: discussion_topic discussion_topic_author_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discussion_topic
    ADD CONSTRAINT discussion_topic_author_profile_id_fkey FOREIGN KEY (author_profile_id) REFERENCES public.profile_public(profile_id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: profile_editor profile_editor_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profile_editor
    ADD CONSTRAINT profile_editor_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profile_public(profile_id) ON DELETE CASCADE;


--
-- Community moderation: typed cases, reports, audit history, and visibility overlay.
--

CREATE TABLE public.moderation_case (
    case_id uuid NOT NULL,
    target_kind text NOT NULL,
    scope_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    status text NOT NULL,
    report_count bigint DEFAULT 0 NOT NULL,
    opened_at bigint NOT NULL,
    updated_at bigint NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    action_reason text,
    CONSTRAINT moderation_case_report_count_check CHECK ((report_count >= 0)),
    CONSTRAINT moderation_case_status_check CHECK ((status = ANY (ARRAY['open'::text, 'hidden'::text, 'dismissed'::text, 'restored'::text]))),
    CONSTRAINT moderation_case_target_kind_check CHECK ((target_kind = ANY (ARRAY['discussion_post'::text, 'game_post'::text])))
);

CREATE TABLE public.moderation_report (
    report_id uuid NOT NULL,
    case_id uuid NOT NULL,
    reporter_principal_id text NOT NULL,
    reason_family text NOT NULL,
    details text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    submitted_seq bigint NOT NULL,
    submitted_at bigint NOT NULL,
    CONSTRAINT moderation_report_reason_family_check CHECK ((reason_family = ANY (ARRAY['spam'::text, 'harassment'::text, 'hate'::text, 'sexual_content'::text, 'self_harm'::text, 'other'::text])))
);

CREATE TABLE public.moderation_case_history (
    source_seq bigint NOT NULL,
    case_id uuid NOT NULL,
    event_kind text NOT NULL,
    actor_principal_id text NOT NULL,
    reason text,
    occurred_at bigint NOT NULL
);

CREATE TABLE public.moderation_target_state (
    target_kind text NOT NULL,
    scope_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    visibility text NOT NULL,
    reason text NOT NULL,
    moderator_principal_id text NOT NULL,
    updated_seq bigint NOT NULL,
    CONSTRAINT moderation_target_state_target_kind_check CHECK ((target_kind = ANY (ARRAY['discussion_post'::text, 'game_post'::text]))),
    CONSTRAINT moderation_target_state_visibility_check CHECK ((visibility = ANY (ARRAY['visible'::text, 'hidden'::text])))
);

ALTER TABLE ONLY public.moderation_case
    ADD CONSTRAINT moderation_case_pkey PRIMARY KEY (case_id);
ALTER TABLE ONLY public.moderation_case
    ADD CONSTRAINT moderation_case_target_key UNIQUE (target_kind, scope_id, source_seq);
ALTER TABLE ONLY public.moderation_report
    ADD CONSTRAINT moderation_report_pkey PRIMARY KEY (report_id);
ALTER TABLE ONLY public.moderation_case_history
    ADD CONSTRAINT moderation_case_history_pkey PRIMARY KEY (source_seq);
ALTER TABLE ONLY public.moderation_target_state
    ADD CONSTRAINT moderation_target_state_pkey PRIMARY KEY (target_kind, scope_id, source_seq);

CREATE INDEX moderation_case_queue_idx ON public.moderation_case USING btree (status, updated_seq DESC, case_id DESC);
CREATE INDEX moderation_report_rate_idx ON public.moderation_report USING btree (reporter_principal_id, submitted_at DESC);
CREATE UNIQUE INDEX moderation_report_active_dedupe_idx ON public.moderation_report USING btree (case_id, reporter_principal_id, reason_family) WHERE active;
CREATE INDEX moderation_case_history_case_idx ON public.moderation_case_history USING btree (case_id, source_seq);

ALTER TABLE ONLY public.moderation_report
    ADD CONSTRAINT moderation_report_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_case(case_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.moderation_case_history
    ADD CONSTRAINT moderation_case_history_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_case(case_id) ON DELETE CASCADE;


--
-- Community subscriptions: durable membership periods, monotonic read cursors,
-- and privacy-safe in-app update references.
--

CREATE TABLE public.community_subscription (
    subscription_id uuid NOT NULL,
    principal_user_id text NOT NULL,
    target_kind text NOT NULL,
    scope_id uuid NOT NULL,
    active boolean DEFAULT true NOT NULL,
    read_through_seq bigint DEFAULT 0 NOT NULL,
    created_seq bigint NOT NULL,
    updated_seq bigint NOT NULL,
    version bigint NOT NULL,
    CONSTRAINT community_subscription_read_through_seq_check CHECK ((read_through_seq >= 0)),
    CONSTRAINT community_subscription_target_kind_check CHECK ((target_kind = ANY (ARRAY['discussion_topic'::text, 'game_thread'::text])))
);

CREATE TABLE public.community_subscription_period (
    subscription_id uuid NOT NULL,
    started_seq bigint NOT NULL,
    ended_seq bigint,
    CONSTRAINT community_subscription_period_bounds_check CHECK (((ended_seq IS NULL) OR (ended_seq > started_seq)))
);

CREATE TABLE public.community_inbox_item (
    subscription_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    target_kind text NOT NULL,
    scope_id uuid NOT NULL,
    occurred_at bigint NOT NULL,
    CONSTRAINT community_inbox_item_target_kind_check CHECK ((target_kind = ANY (ARRAY['discussion_topic'::text, 'game_thread'::text])))
);

ALTER TABLE ONLY public.community_subscription
    ADD CONSTRAINT community_subscription_pkey PRIMARY KEY (subscription_id);
ALTER TABLE ONLY public.community_subscription
    ADD CONSTRAINT community_subscription_member_target_key UNIQUE (principal_user_id, target_kind, scope_id);
ALTER TABLE ONLY public.community_subscription_period
    ADD CONSTRAINT community_subscription_period_pkey PRIMARY KEY (subscription_id, started_seq);
ALTER TABLE ONLY public.community_inbox_item
    ADD CONSTRAINT community_inbox_item_pkey PRIMARY KEY (subscription_id, source_seq);

CREATE INDEX community_subscription_member_idx ON public.community_subscription USING btree (principal_user_id, active, updated_seq DESC);
CREATE INDEX community_subscription_target_idx ON public.community_subscription USING btree (target_kind, scope_id, active);
CREATE INDEX community_subscription_period_lookup_idx ON public.community_subscription_period USING btree (subscription_id, started_seq, ended_seq);
CREATE INDEX community_inbox_item_page_idx ON public.community_inbox_item USING btree (subscription_id, source_seq DESC);

ALTER TABLE ONLY public.community_subscription_period
    ADD CONSTRAINT community_subscription_period_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.community_subscription(subscription_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.community_inbox_item
    ADD CONSTRAINT community_inbox_item_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.community_subscription(subscription_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--
