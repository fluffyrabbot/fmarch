-- 0007_security_capacity_ledgers.sql — bound provider exchanges and stored media.

-- A provider session can cross the WorkOS/app boundary only once. The insert
-- shares the local-session transaction, so a failed exchange does not burn it.
CREATE TABLE public.workos_session_exchange (
    provider_session_id TEXT PRIMARY KEY,
    access_token_hash TEXT NOT NULL UNIQUE,
    subject TEXT NOT NULL,
    exchanged_at BIGINT NOT NULL,
    access_expires_at BIGINT NOT NULL,
    CONSTRAINT workos_session_exchange_expiry_check CHECK (access_expires_at > exchanged_at)
);

CREATE INDEX workos_session_exchange_expiry_idx
    ON public.workos_session_exchange (access_expires_at);

CREATE TABLE public.media_upload_ledger (
    upload_id UUID PRIMARY KEY,
    principal_user_id TEXT NOT NULL REFERENCES public.platform_principal(principal_user_id) ON DELETE RESTRICT,
    encoded_bytes BIGINT NOT NULL CHECK (encoded_bytes > 0),
    content_id TEXT,
    created_at BIGINT NOT NULL
);

CREATE INDEX media_upload_ledger_principal_idx
    ON public.media_upload_ledger (principal_user_id, created_at);
