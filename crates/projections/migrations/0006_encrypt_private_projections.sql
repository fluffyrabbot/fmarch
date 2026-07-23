-- 0006_encrypt_private_projections.sql — erase plaintext private projections and seal rebuilt state.

-- Private projections are rebuildable caches. Drop their pre-encryption rows
-- rather than retaining plaintext or attempting key handling inside Postgres;
-- active streams can be replayed through the application crypto boundary.
TRUNCATE TABLE
    investigation_memory,
    player_info_result,
    player_investigation_result,
    private_channel_member,
    slot_state,
    thread_view;

ALTER TABLE investigation_memory
    DROP COLUMN result,
    ADD COLUMN result_private JSONB NOT NULL;

ALTER TABLE player_info_result
    DROP COLUMN result,
    ADD COLUMN result_private JSONB NOT NULL;

ALTER TABLE player_investigation_result
    DROP COLUMN result,
    ADD COLUMN result_private JSONB NOT NULL;

ALTER TABLE private_channel_member
    DROP COLUMN role_key,
    DROP COLUMN reveals_alignment,
    ADD COLUMN private JSONB NOT NULL;

ALTER TABLE slot_state
    DROP COLUMN role_key,
    DROP COLUMN alignment,
    ADD COLUMN private JSONB;

ALTER TABLE thread_view
    DROP COLUMN body,
    ADD COLUMN body TEXT,
    ADD COLUMN body_private JSONB,
    ADD CONSTRAINT thread_view_body_storage
        CHECK (
            (channel_id = 'main' AND body IS NOT NULL AND body_private IS NULL)
            OR
            (channel_id <> 'main' AND body IS NULL AND body_private IS NOT NULL)
        );
