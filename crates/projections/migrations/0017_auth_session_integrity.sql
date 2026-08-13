-- 0017_auth_session_integrity.sql — canonical session ownership and websocket provenance.

-- Nullable idle deadlines were a transitional shape. Retire any such bearer
-- before making the deadline mandatory; no credential is allowed to escape
-- both absolute and idle expiry policy.
UPDATE public.auth_session
SET revoked_at = COALESCE(revoked_at, created_at),
    idle_expires_at = expires_at
WHERE idle_expires_at IS NULL;

ALTER TABLE public.auth_session
    ALTER COLUMN idle_expires_at SET NOT NULL;

ALTER TABLE public.auth_session
    DROP CONSTRAINT auth_session_idle_expiry_check;

ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_idle_expiry_check
    CHECK (idle_expires_at > created_at AND idle_expires_at <= expires_at);

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_principal_user_id_fkey
    FOREIGN KEY (principal_user_id)
    REFERENCES public.platform_principal(principal_user_id)
    ON DELETE RESTRICT;

ALTER TABLE public.auth_websocket_ticket
    DROP CONSTRAINT auth_websocket_ticket_auth_kind_check;

ALTER TABLE public.auth_websocket_ticket
    ADD CONSTRAINT auth_websocket_ticket_auth_kind_check
    CHECK (auth_kind IN ('classic', 'workos', 'dev', 'admin_grant'));

-- A durable visibility outbox lets every API instance observe moderation
-- changes without coupling websocket correctness to process-local broadcasts.
CREATE TABLE public.game_thread_visibility_change (
    id bigserial PRIMARY KEY,
    game_id uuid NOT NULL,
    source_seq bigint NOT NULL,
    visibility text NOT NULL,
    moderation_seq bigint NOT NULL,
    CONSTRAINT game_thread_visibility_change_visibility_check
        CHECK (visibility IN ('visible', 'hidden'))
);

CREATE INDEX game_thread_visibility_change_game_idx
    ON public.game_thread_visibility_change (game_id, id);
