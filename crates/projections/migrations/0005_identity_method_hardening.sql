-- 0005_identity_method_hardening.sql — immutable authentication time and method-detail integrity.

-- Session rotation changes the session instance, not the authentication
-- ceremony that established authority. The original authentication timestamp
-- is required from first issuance and immutable in application code.
ALTER TABLE public.auth_session
    ADD COLUMN authenticated_at bigint NOT NULL,
    ADD CONSTRAINT auth_session_authenticated_at_check CHECK ((authenticated_at <= created_at));

-- Detail rows duplicate principal_id for the still-supported operational
-- account/invite queries. A composite identity key makes that duplication
-- checkable: the detail kind and principal must match the authentication-method
-- umbrella exactly.
ALTER TABLE public.authentication_method
    ADD CONSTRAINT authentication_method_identity_key UNIQUE (method_id, principal_id, kind);

ALTER TABLE public.auth_account
    ADD COLUMN method_kind text GENERATED ALWAYS AS ('classic_password'::text) STORED;

ALTER TABLE public.auth_account
    ADD CONSTRAINT auth_account_method_identity_fkey
    FOREIGN KEY (method_id, principal_id, method_kind)
    REFERENCES public.authentication_method(method_id, principal_id, kind)
    ON DELETE RESTRICT;

ALTER TABLE public.external_identity
    ADD COLUMN method_kind text GENERATED ALWAYS AS ('workos'::text) STORED;

ALTER TABLE public.external_identity
    ADD CONSTRAINT external_identity_method_identity_fkey
    FOREIGN KEY (method_id, principal_id, method_kind)
    REFERENCES public.authentication_method(method_id, principal_id, kind)
    ON DELETE RESTRICT;
