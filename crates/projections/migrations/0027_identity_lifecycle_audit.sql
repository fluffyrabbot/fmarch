CREATE TABLE IF NOT EXISTS identity_lifecycle_audit (
    id BIGSERIAL PRIMARY KEY,
    event_at BIGINT NOT NULL,
    event_kind TEXT NOT NULL,
    actor_user_id TEXT NULL,
    principal_user_id TEXT NOT NULL,
    token_hash TEXT NULL,
    related_token_hash TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS identity_lifecycle_audit_event_at_idx
    ON identity_lifecycle_audit (event_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS identity_lifecycle_audit_principal_idx
    ON identity_lifecycle_audit (principal_user_id, id DESC);

CREATE INDEX IF NOT EXISTS identity_lifecycle_audit_event_kind_idx
    ON identity_lifecycle_audit (event_kind, id DESC);
