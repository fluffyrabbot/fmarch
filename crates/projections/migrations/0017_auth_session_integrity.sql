-- 0017_auth_session_integrity.sql — canonical session ownership and websocket provenance.

-- Every session has both absolute and idle expiry from issuance.
ALTER TABLE public.auth_session
    DROP CONSTRAINT auth_session_idle_expiry_check;

ALTER TABLE public.auth_session
    ADD CONSTRAINT auth_session_idle_expiry_check
    CHECK (idle_expires_at > created_at AND idle_expires_at <= expires_at);

ALTER TABLE ONLY public.auth_session
    ADD CONSTRAINT auth_session_principal_id_fkey
    FOREIGN KEY (principal_id)
    REFERENCES public.platform_principal(principal_id)
    ON DELETE RESTRICT;

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
