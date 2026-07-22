-- 0003_authentication_methods.sql — authentication-method umbrella, backend-issued
-- app sessions, and method-bound websocket tickets.
--
-- Classic (username + password) and WorkOS become coexisting first-class sign-in
-- methods on one platform principal. Detail rows (auth_account, external_identity)
-- link up to authentication_method; auth_session becomes the single backend-owned
-- app session for every method. method_id linkage columns are nullable in SQL
-- because pre-refactor rows may exist; the application writes them for all new
-- rows and lazily upgrades old rows on next successful authentication.

CREATE TABLE public.authentication_method (
    method_id uuid NOT NULL,
    principal_user_id text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    created_at bigint NOT NULL,
    disabled_at bigint,
    last_authenticated_at bigint,
    CONSTRAINT authentication_method_kind_check CHECK ((kind = ANY (ARRAY['classic_password'::text, 'workos'::text]))),
    CONSTRAINT authentication_method_status_check CHECK ((status = ANY (ARRAY['active'::text, 'disabled'::text]))),
    CONSTRAINT authentication_method_disabled_shape_check CHECK ((((status = 'active'::text) AND (disabled_at IS NULL)) OR ((status = 'disabled'::text) AND (disabled_at IS NOT NULL))))
);

ALTER TABLE ONLY public.authentication_method
    ADD CONSTRAINT authentication_method_pkey PRIMARY KEY (method_id);

ALTER TABLE ONLY public.authentication_method
    ADD CONSTRAINT authentication_method_principal_user_id_fkey FOREIGN KEY (principal_user_id) REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT;

CREATE INDEX authentication_method_principal_idx ON public.authentication_method USING btree (principal_user_id, status);

-- At most one classic-password method per principal.
CREATE UNIQUE INDEX authentication_method_classic_unique ON public.authentication_method USING btree (principal_user_id) WHERE (kind = 'classic_password'::text);

ALTER TABLE public.auth_account
    ADD COLUMN method_id uuid;

ALTER TABLE ONLY public.auth_account
    ADD CONSTRAINT auth_account_method_id_key UNIQUE (method_id),
    ADD CONSTRAINT auth_account_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT;

ALTER TABLE public.external_identity
    ADD COLUMN method_id uuid;

ALTER TABLE ONLY public.external_identity
    ADD CONSTRAINT external_identity_method_id_key UNIQUE (method_id),
    ADD CONSTRAINT external_identity_method_id_fkey FOREIGN KEY (method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT;

-- auth_session is the single backend-owned app session. Sessions issued without
-- a method (dev sessions, admin session grants) carry a NULL method reference
-- and record their assurance instead.
ALTER TABLE public.auth_session
    ADD COLUMN authenticated_via_method_id uuid,
    ADD COLUMN idle_expires_at bigint,
    ADD COLUMN assurance text;

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_method_fkey FOREIGN KEY (authenticated_via_method_id) REFERENCES public.authentication_method(method_id) ON DELETE RESTRICT,
    ADD CONSTRAINT auth_session_assurance_check CHECK (((assurance IS NULL) OR (assurance = ANY (ARRAY['password'::text, 'external_sso'::text, 'dev'::text, 'admin_grant'::text])))),
    ADD CONSTRAINT auth_session_idle_expiry_check CHECK (((idle_expires_at IS NULL) OR (idle_expires_at > created_at)));

CREATE INDEX auth_session_method_idx ON public.auth_session USING btree (authenticated_via_method_id) WHERE (authenticated_via_method_id IS NOT NULL);

-- Websocket tickets speak method kinds. The retired values stay in the CHECK
-- because ADD CONSTRAINT re-validates existing (possibly unexpired) rows; the
-- redeem path fails closed on them. A later migration may tighten the set once
-- no pre-refactor ticket can remain unexpired.
ALTER TABLE public.auth_websocket_ticket
    DROP CONSTRAINT auth_websocket_ticket_auth_kind_check;

ALTER TABLE public.auth_websocket_ticket
    ADD CONSTRAINT auth_websocket_ticket_auth_kind_check CHECK ((auth_kind = ANY (ARRAY['classic'::text, 'workos'::text, 'dev'::text, 'legacy-dev'::text])));
