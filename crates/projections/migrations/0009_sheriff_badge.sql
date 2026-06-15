-- 0008_sheriff_badge.sql -- folded badge ownership state.
--
-- Rebuildable badge facts folded from `BadgeChanged` inner events. Sheriff
-- badge ownership affects later day vote weight, so it is state, not UI-only
-- annotation.

CREATE TABLE IF NOT EXISTS sheriff_badge (
    game_id        UUID NOT NULL,
    badge_id       TEXT NOT NULL,
    owner_slot     TEXT NULL,
    vote_weight    DOUBLE PRECISION NULL,
    source_slot    TEXT NOT NULL,
    source_action  TEXT NOT NULL,
    reason         TEXT NOT NULL,
    destroyed      BOOLEAN NOT NULL,
    phase_id       TEXT NOT NULL,
    phase_kind     TEXT NOT NULL,
    phase_number   INTEGER NOT NULL,
    PRIMARY KEY (game_id, badge_id)
);

CREATE INDEX IF NOT EXISTS sheriff_badge_owner_idx
    ON sheriff_badge (game_id, owner_slot)
    WHERE owner_slot IS NOT NULL;
