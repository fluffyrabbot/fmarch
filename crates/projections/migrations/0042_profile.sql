-- 0042_profile.sql -- authorization-safe public and owner-only profile views.
--
-- The public projection deliberately omits principal_user_id. The editor
-- projection is the private ownership boundary used by authenticated writes.

CREATE TABLE profile_public (
    profile_id   UUID PRIMARY KEY,
    handle       TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    bio          TEXT NOT NULL,
    visibility   TEXT NOT NULL CHECK (visibility IN ('public', 'members')),
    created_seq  BIGINT NOT NULL,
    updated_seq  BIGINT NOT NULL
);

CREATE INDEX profile_public_visible_handle_idx
    ON profile_public (handle)
    WHERE visibility = 'public';

CREATE TABLE profile_editor (
    profile_id        UUID PRIMARY KEY REFERENCES profile_public (profile_id) ON DELETE CASCADE,
    principal_user_id TEXT NOT NULL UNIQUE,
    last_edit_seq     BIGINT NOT NULL
);
