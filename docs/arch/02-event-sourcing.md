# 02 — Event sourcing & projections

The event log is the source of truth. Everything users see is a **projection** derived
from it. This document defines the log, the projections, and the rules that keep replay
honest over years.

## Why, concretely

We are not adopting event sourcing for fashion. The domain ([01](01-domain-model.md))
demands capabilities that event sourcing gives away for free and that a mutable-CRUD
schema makes painful or impossible:

- **As-of queries** — "votecount at post #847", "who was alive entering Night 2".
- **Honest mutation** — edits, replacements, deaths recorded, never silently overwritten.
- **Rebuildable read models** — change how the votecount renders? Rebuild the projection
  from the log; no data migration of derived state.
- **End-game reveal** — role visibility is a projection flag, flipped at game end. The
  data was always present and access-controlled.

The cost — you must think about schema evolution up front — is a cost we want to pay
anyway for a professional-grade substrate.

## The event store

A single append-only table. Events are **immutable** and **ordered**.

```
events
  seq          BIGSERIAL  PRIMARY KEY      -- global total order
  stream_id    UUID       NOT NULL         -- aggregate id (usually game_id)
  stream_seq   BIGINT     NOT NULL         -- per-stream order; (stream_id, stream_seq) UNIQUE
  kind         TEXT       NOT NULL         -- variant tag, e.g. "VoteSubmitted"
  version      SMALLINT   NOT NULL         -- schema version of this event type
  payload      JSONB      NOT NULL         -- typed body (see evolution rules below)
  actor        JSONB      NOT NULL         -- ActorId enum, serialized {type,id} (Slot/Host/System/User) — not a UUID
  occurred_at  BIGINT     NOT NULL         -- LogicalTime (u64); deterministic, not wall-clock (docs 09/10)
  causation_id UUID                        -- command/event that caused this (nullable)
  meta         JSONB      NOT NULL DEFAULT '{}'  -- capability used, request id, run_id, for audit
```

> Shipped in [03-backend](03-backend.md)'s `eventstore` crate. `actor` is `JSONB` (not a
> UUID) because `ActorId` is a 4-variant enum and slot/user ids are strings; `occurred_at` is
> `BIGINT` logical time, not `TIMESTAMPTZ`, to honor the determinism rule. A DB-level trigger
> hard-rejects `UPDATE`/`DELETE`/`TRUNCATE` on `events`, enforcing append-only in Postgres
> itself.

- **Streams** are aggregates. The natural aggregate is the **game**; a game's entire
  history is one stream, which keeps a game internally consistent and easy to replay,
  archive, or export as a unit. Platform-level streams (users, auth) are separate.
- `(stream_id, stream_seq)` uniqueness gives **optimistic concurrency**: a command reads
  the current `stream_seq`, computes new events at `stream_seq+1…`, and the unique
  constraint rejects a conflicting concurrent append. Retry on conflict.
- Append-only. There is no `UPDATE` and no `DELETE` on `events`. Ever. Corrections are new
  events (a `PostEdited`, a `VoteRetracted`), not mutations.

## Event taxonomy (illustrative, not exhaustive)

Grouped by aggregate concern. Names are stable contracts once shipped.

**Game lifecycle:** `GameCreated`, `HostAssigned`, `CohostAdded`, `SignupsOpened`,
`SlotAdded`, `SlotAssigned`, `GameStarted`, `GameCompleted`, `GameArchived`

**Membership / replacement:** `ReplacementRequested`, `ReplacementCompleted`
(carries `slot_id`, `outgoing_user`, `incoming_user`), `SlotModkilled`

**Phase:** `PhaseAdvanced` (typed), `DeadlineSet`, `DeadlineExtended`, `ThreadLocked`,
`ThreadUnlocked`

**Posting:** `PostSubmitted`, `PostEdited`, `PostRetracted`

**Voting:** `VoteCast`, `VoteRetracted`, `HammerReached` (server-detected),
`VotecountPosted`

**Roles / reveal:** `RoleAssigned` (encrypted payload; see [06](06-security.md)),
`SlotKilled` (death), `RoleRevealed`

**Channels:** `ChannelCreated`, `ChannelMemberAdded`, `ChannelMemberRemoved`,
`ChannelVisibilityChanged`

Each event type has a **version** and an append-only payload (next section).

## Schema evolution rules (non-negotiable)

A game runs for months; archives must replay years later in current code. Treat every
event like a wire-protocol author would (cf. [04](04-wire-protocol.md)):

1. **Additive only.** You may add optional fields. You may not remove, rename, or
   repurpose a field. You may not change a field's type or meaning.
2. **New meaning ⇒ new version or new type.** If semantics change, bump `version` and have
   the deserializer **upcast** old versions to the current in-memory shape, or introduce a
   new event type and stop emitting the old one.
3. **Old events are forever valid.** Replay code must handle every version that was ever
   written. Upcasters are kept indefinitely; they are cheap and they are the contract.
4. **No "fix it in the database."** A wrong event is corrected by a compensating event,
   never by editing history.

A small **upcaster pipeline** sits between the store and the domain: raw row → version
upcast → current typed event. Domain logic only ever sees the current shape.

## Projections (read models)

Projections are derived tables, **rebuildable from the log at any time**. They exist purely
to make reads fast and queries simple.

Examples:

| Projection | Answers |
|---|---|
| `thread_view` | rendered, paginated posts for a channel (with edit/retract applied) |
| `votecount` | **running** tally per phase (folded from vote submissions, as-of any post); the **official** outcome is the engine's `DayVoteOutcome`, not this projection — see [09](09-engine-and-packs.md), [10](10-event-schema.md) |
| `slot_state` | per-slot lifecycle, current occupant, role-visibility flag |
| `phase_state` | current phase, deadline, lock status per game |
| `channel_membership` | who can read/post where (drives authz reads) |
| `game_index` | board listing: active games, hosts, phase, deadline |

### Update strategy

- **Synchronous, same transaction** for projections that must never lag the write a user
  just made (e.g. your own post appearing, your vote in the count). The command handler
  appends events and updates these projections in **one DB transaction**. Strong
  read-your-writes, no eventual-consistency surprises in the hot path.
- **Asynchronous listeners** (Postgres `LISTEN/NOTIFY` on new `seq`) for fan-out work that
  can lag slightly: pushing deltas to other connected clients, the board index,
  notifications. See [03-backend](03-backend.md).

This split keeps the author's own experience strictly consistent while letting broadcast
and secondary read models scale independently.

### Rebuild

A projection is `(events) → state`. Rebuilding = truncate the projection table, replay the
log through its folding function. This is how we:
- change a read model's shape without migrating derived data,
- recover from a projection bug,
- bring a brand-new projection online over historical games.

Rebuild must be **deterministic**: same log ⇒ same projection, every time. No wall-clock,
no RNG, no external calls inside a fold. Anything nondeterministic must have been captured
*as event data* at write time (e.g. the deadline timestamp is in `DeadlineSet`, not read
from `now()` during replay).

## Snapshots (later, if needed)

Replaying a long game from event #1 on every load is wasteful. When it matters, add
**snapshots**: a periodic serialized projection state at `seq = N`, so replay starts from
the snapshot and applies only events after it. Snapshots are an optimization — they are
always discardable and re-derivable. Not needed for v1.

## What this buys the rest of the system

- The **running votecount** ([01](01-domain-model.md)) is a fold over
  `VoteSubmitted`/`VoteWithdrawn` within a phase — trivially as-of any point; the
  **official** outcome is the engine-resolved `DayVoteOutcome` ([09](09-engine-and-packs.md)).
- **Replacement** is one event that preserves all slot-attached history.
- **End-game reveal** flips a flag in `slot_state`; a rebuild proves it was always correct.
- The **wire protocol** ([04](04-wire-protocol.md)) ships projection *deltas*, which are
  just the events the client is allowed to see, framed compactly.

Continue to [03-backend](03-backend.md).
