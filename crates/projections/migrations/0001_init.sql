-- 0001_init.sql — the append-only event store (doc 02 / doc 10).
--
-- A single immutable, ordered log. There is NO UPDATE and NO DELETE on this
-- table, ever. Corrections are new (compensating) events, never mutations.
--
-- RULING: `occurred_at` is BIGINT logical time (LogicalTime = u64, docs 09/10),
-- NOT the doc-02 illustrative TIMESTAMPTZ. Determinism requires that every
-- timestamp reaching a fold be captured as data at write time, not read from a
-- wall clock; a logical u64 makes that explicit and replay-exact.

CREATE TABLE IF NOT EXISTS events (
    seq          BIGSERIAL   PRIMARY KEY,           -- global total order
    stream_id    UUID        NOT NULL,              -- aggregate id (usually game_id)
    stream_seq   BIGINT      NOT NULL,              -- per-stream monotonic order
    kind         TEXT        NOT NULL,              -- EventKind discriminant tag
    version      SMALLINT    NOT NULL,              -- schema version of this kind
    payload      JSONB       NOT NULL,              -- typed body
    actor        JSONB       NOT NULL,              -- ActorId (tagged JSON, see below)
    occurred_at  BIGINT      NOT NULL,              -- LogicalTime (u64), deterministic
    causation_id UUID        NULL,                  -- command/event that caused this
    meta         JSONB       NOT NULL DEFAULT '{}', -- audit metadata
    -- Optimistic concurrency: a conflicting concurrent append at the same
    -- (stream_id, stream_seq) is rejected by this unique constraint. Retry.
    CONSTRAINT events_stream_seq_unique UNIQUE (stream_id, stream_seq)
);

-- The UNIQUE constraint already provides a (stream_id, stream_seq) index used to
-- compute current_max and to order a stream load; `seq` is the PK (indexed).
-- An explicit stream-ordered index name documents the load path.
CREATE INDEX IF NOT EXISTS events_stream_order_idx ON events (stream_id, stream_seq);

-- Belt-and-suspenders: forbid mutation of history at the database level. Any
-- UPDATE or DELETE against `events` raises, so an append-only invariant cannot
-- be violated even by a buggy/rogue query path. (doc 02: "no UPDATE, no DELETE")
CREATE OR REPLACE FUNCTION events_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'events is append-only: % is forbidden', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_update ON events;
CREATE TRIGGER events_no_update
    BEFORE UPDATE OR DELETE OR TRUNCATE ON events
    FOR EACH STATEMENT EXECUTE FUNCTION events_forbid_mutation();
