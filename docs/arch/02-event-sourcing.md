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
  occurred_at  BIGINT     NOT NULL         -- LogicalTime (u64); deterministic, not wall-clock (docs 09/10)
  sealed_body  JSONB      NOT NULL         -- AEAD envelope over payload, actor, causation, and audit metadata
```

> Shipped in [03-backend](03-backend.md)'s `eventstore` crate. Only the structural header is
> queryable. `payload`, `actor`, `causation_id`, and `meta` form one authenticated encrypted
> body whose AAD binds it to the stream, position, kind, version, and logical time. The canonical
> loader is the only production boundary that opens it. A DB trigger hard-rejects
> `UPDATE`/`DELETE`/`TRUNCATE` on `events`.

- **Streams** are aggregates. The natural aggregate is the **game**; a game's entire
  history is one stream, which keeps a game internally consistent and easy to replay,
  archive, or export as a unit. Platform-level streams (users, auth) are separate.
- `(stream_id, stream_seq)` uniqueness gives **optimistic concurrency**: a command reads
  the current `stream_seq`, computes new events at `stream_seq+1…`, and the unique
  constraint rejects a conflicting concurrent append. Retry on conflict.
- Append-only. There is no `UPDATE` and no `DELETE` on `events`. Ever. Corrections are new
  events (a `PostEdited`, a `VoteWithdrawn`), not mutations.

## Projection replay audits

Projection rebuilds are also exposed as an operator audit command:

```bash
DATABASE_URL=postgres://... cargo run -p projections --bin audit_rebuild -- <game_uuid>
```

The command snapshots each rebuildable projection table for the game, replays the event stream
inside a rollback-only transaction, compares the rebuilt rows to the live rows, prints a JSON
`ProjectionAuditReport`, and exits non-zero if any table drifts. It currently proves projection
row determinism.

Stored resolution envelopes have a narrower command-side audit:

```bash
DATABASE_URL=postgres://... cargo run -p operator_proof --bin audit_resolution -- <game_uuid>
```

That command scans stored `ResolutionApplied` / `ResolutionTrace` pairs, reruns ordinary
`ResolvePhase` envelopes from the event-stream prefix using the stored seed/run id/logical time,
reruns PK `ResolveHostPrompt` envelopes from `HostPromptIssued` + `HostPromptResolved`, prints a
JSON `ResolutionEnvelopeAuditReport`, and exits non-zero on drift. Revote and skip-next-day prompt
decisions do not produce resolution envelopes; their `PhaseAdvanced` consequences are covered by
the host phase-control projection audit.

Stored traces can also be inspected without rerunning the resolver:

```bash
DATABASE_URL=postgres://... cargo run -p operator_proof --bin inspect_trace -- <game_uuid> [run_id]
```

`inspect_trace` and the host/cohost-only REST trace endpoint flatten `ResolutionTrace` decisions,
edges, generated actions, effect changes, visibility rows, and notes into stream-sequence anchored
rows for operator dispute review. Seeded fuzzing, large-graph performance checks, and saved
resolution-diff browser views are part of the operator proof baseline; richer interactive graph
exploration remains future operator UX.

## Event taxonomy (illustrative, not exhaustive)

Grouped by aggregate concern. Names are stable contracts once shipped.

**Game lifecycle:** `GameCreated`, `HostAssigned`, `CohostAdded`, `SignupsOpened`,
`SlotAdded`, `GamePersonaRegistered`, `SlotOccupancyStarted`, `GameStarted`, `GameCompleted`, `GameArchived`

**Persona / occupancy:** `GamePersonaRegistered`, `GamePersonaRenamed`,
`SlotOccupancyStarted`, `SlotOccupancyEnded`, `ReplacementRequested`, `SlotModkilled`.
Replacement is a shared-transition pair of immutable occupancy facts; principals remain
in the private persona projection and never become slot-authorship facts.

**Phase:** `PhaseAdvanced` (typed), `DeadlineSet`, `DeadlineExtended`, `ThreadLocked`,
`ThreadUnlocked`

**Posting:** `PostSubmitted`, `PostEdited`, `PostRetracted`

**Voting:** `VoteSubmitted`, `VoteWithdrawn` (platform stream kinds; see
[10-event-schema](10-event-schema.md)). Official vote outcome is engine
`DayVoteOutcome` inside `ResolutionApplied`. Hammer may lock the main thread via
`ThreadLocked` (vote_hammer)—there is no separate `HammerReached` event. Host
votecount publish is a command/projection, not a `VotecountPosted` fact.

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
| `player_notification` | one row per `EffectNotification` audience slot, including private engine notices such as Cupid lover knowledge |
| `phase_state` | current phase, deadline, lock status per game |
| `channel_membership` | who can read/post where (drives authz reads) |
| `game_index` | public board listing: active/completed games, pack, status, current phase, and stable page cursor |
| `discussion_area` / `discussion_topic` / `discussion_post` | public non-game areas, visible topic lifecycle, and paginated post threads |
| `publication_surface` / `public_publication` | source-agnostic public index with canonical links across discussions, profiles, games, and public main-thread posts |
| `moderation_case` / `moderation_report` / `moderation_case_history` | durable public-content reports, current GlobalMod review state, and append-only reasoned action history |
| `moderation_target_state` | reversible public visibility overlay for individually moderated discussion and main-thread posts |
| `pack_artifact` | immutable content-addressed cache of the canonical typed pack attachment carried by `GameCreated`; recreated from the stream and exact-identity-bound to `game_index` |
| `public_watch` / `public_watch_period` | one member/target watch stream, current membership, monotonic read cursor, and historical active intervals |
| `public_inbox_item` | privacy-safe per-member references to public posts published during active watch intervals |
| `profile_mute` | one private member/profile relationship stream, current active state, replay version, and bounded member-owned list cursor |
| `public_citation` / `game_private_citation` | rebuildable reverse indexes for public publications and private game-channel posts; folded from quoting events, never written onto the quoted post's stream |

`game_index` folds `GameCreated`, `GameStarted`, `PhaseAdvanced`, and `GameCompleted`
synchronously with the game stream. Setup rows remain rebuildable but are excluded from the
public query until a game starts; the public row deliberately contains no host, slot, role,
private-channel, command, or audit data. The board uses the event stream's
`(updated_seq, game_id)` keyset cursor, so an older page remains stable while newer game
lifecycle events arrive.

Non-game discussion uses independent area and topic streams in the same append-only event log.
`DiscussionAreaCreated`, `DiscussionTopicCreated`, `DiscussionPostSubmitted`, and
the orthogonal `DiscussionTopicPostingStateChanged` / `DiscussionTopicVisibilityChanged` events
fold synchronously into their own projection tables. The pure `community` write model decides
those events from typed commands before the persistence adapter appends them against the topic's
expected stream version. A concurrent lock or hide therefore invalidates a stale reply rather
than allowing it across the moderation boundary. Public queries expose profile-backed authorship
without credential principals; hidden topics are excluded, and the topic index uses
`(updated_seq, topic_id)` keyset pagination. Topic creation and posting require an enabled account
with a public profile. Moderation transitions require `GlobalMod` or `GlobalAdmin`, also backed
by an enabled account, resolved at the API boundary.

Profiles likewise use a dedicated append-only stream per profile, but a profile is not a user
record. The pure `social::profile` model separates an opaque `PrincipalId` (authorization), a
`PrivacySubjectId` (erasure), a `ProfileId` (social identity), and a `RedactedProfileAlias`
(retained attribution). `profile_application` validates a typed command, seals the editable
presentation into a subject-private claim, and appends only subject/claim references with a
`PrivacySubject` actor. Projections never receive raw profile input or create private claims.

`member_profile` is the durable profile identity used by discussion authorship. While active it
binds `active_principal_id`, a current private claim, and a keyed blind handle index; after
redaction all three are cleared and only `redacted_alias` remains. `public_profile` is a dependent
plaintext materialization that exists only for active `public` profiles. Public reads, publication/
search materialization, current discussion attribution, and mute targets use that table. `private`
is owner-only and decrypts through `profile_application`; it has no plaintext profile projection.
There is deliberately no `members` string until an explicit audience model exists. A private or
redacted transition deletes the public row and its surface in the same transaction, so it cannot
leave stale searchable data, public attribution, or mute relationships behind. Profile updates
carry the stream `revision` they read and append against that expected version.

Public search is a synchronous, rebuildable projection rather than an independent source of
truth. `public_search_document` is deliberately separate from `public_publication`: the latter is
the generic engagement identity used by moderation, citations, watches, and inboxes, while the
former owns only search ranking and presentation. Each visible discussion, public profile, and
active/completed game contributes one title-bearing surface document. Discussion and `main`
game-thread posts contribute body-only post documents, so a parent title is indexed once rather
than copied into every post vector. Topic hiding and profile visibility changes remove the entire
affected scope in the same transaction; game and profile rebuilds recreate identical documents.
Queries use `websearch_to_tsquery`, weighted rank, structured safe highlight segments, and the full
`(rank, updated_seq, document_type, document_key)` ordering tuple. The versioned opaque cursor is
bound to the normalized query and filter. Search documents store only presentation-safe text and
canonical public URLs. Private channels, credential principals, authorization state, and
engagement signals never enter this projection. Public game-post results resolve through the
read-only `/games/{game}` surface rather than a capability-scoped player route.

Public-publication moderation is event-sourced rather than implemented as destructive post edits. An
authenticated report opens or appends to one target-keyed moderation case stream; one active
report per reporter, target, and reason family is enforced under a transaction-scoped target lock,
and each reporter is bounded to ten submissions per rolling day. Reporter receipts reveal only the
report id, submission time, and current disposition. `GlobalMod`/`GlobalAdmin` reads expose the
review evidence and append-only case history through a separate capability boundary. Reason-bearing
hide, dismiss, and restore commands use the case's expected version. Hide and restore update the
`moderation_target_state` overlay and exact public search document in the same transaction; public
discussion and game-thread reads exclude only targets whose overlay is hidden. The original post
and case events remain immutable, so rebuilding a case reproduces both audit history and final
public/search visibility. Private-channel targets are rejected before a case can open.

Community watches are also event-sourced. Each authenticated member and public target pair owns
one durable subscription stream with explicit enable, disable, and read-cursor events. The current
projection keeps one membership row plus append-only active periods, so unsubscribe/resubscribe
gaps remain meaningful during replay. A watch begins at the target's current latest public post;
it does not manufacture historical unread work. Read advancement is strictly monotonic and cannot
move beyond the target's current public sequence.

Public discussion and `main` game-thread post folds synchronously fan out a reference into
`public_inbox_item` for every subscription period active at that global event sequence. Authors
do not receive their own update. Inbox rows contain no post body, author identity, credential
principal, private audience, or engagement signal: presentation resolves only the public target
title and canonical post URL. Topic/game visibility and `moderation_target_state` are applied at
read time, so hiding a post immediately suppresses its inbox entry and restoring it reveals the
same immutable reference. Topic, game, and subscription rebuilds use the historical periods to
reproduce exactly the updates that existed while each watch was active.

Member mutes use one durable relationship stream per authenticated member and target public
profile. `CommunityMemberMuted` and `CommunityMemberUnmuted` preserve the reversible decision
history while `profile_mute` exposes only the member's current active relationships.
Self-mutes and duplicate transitions are rejected under a transaction-scoped relationship lock.
The relationship is never global moderation: anonymous and other-member reads are unchanged.

Authenticated public-search, discussion-list, discussion-thread, public-game-thread, and watched
inbox queries apply the active mute relationship as a private read-time overlay. Contributions are
matched through public profile authorship; credential principals never cross the response boundary.
The overlay is applied before keyset limits, so cursors remain stable and pages remain full.
Unmuting immediately restores the same immutable posts and inbox references without rewriting the
shared search, discussion, game, or subscription history. Relationship replay deterministically
reproduces both active and inactive final states.

Completed games export as a `CompletedGameExport` that serde-flattens the `StreamExport` v2 fields,
so existing browser consumers retain the top-level stream/version/events/checksum contract. The
stream contains exact stored headers and sealed bodies—never decoded roles, private posts, action
targets, actor identity, or audit metadata. A second wrapper checksum covers a sorted manifest of
deterministic game-scoped detached persona aliases. Each lookup reference is a domain-separated
hash of game plus authenticated subject ID; it contains neither the raw subject ID, a subject claim,
PII, nor an erasure tombstone, and cannot be correlated across games.

Import authenticates every body, derives the exact persona-subject set from those bodies, and
rejects missing, extra, reordered, or non-canonical aliases. Event insertion, detached-alias rows,
the first projection rebuild, and a second deterministic replay audit share one transaction; any
failure leaves zero event rows for the target stream. The rebuilt archive uses detached aliases and
requires no `privacy_subject`, `subject_private_claim`, or external subject-key material. The current
archive remains coupled to a trusted event-key ring; cross-custody archive-key wrapping is a separate
operational boundary, not an implied property.

The sealed `GameCreated` body carries the exact canonical pack artifact once, including its complete
content address. That authenticated attachment travels with `StreamExport`; import verifies it before
folding and recreates `pack_artifact` custody in the same transaction. Historical replay therefore
survives replacement or removal of the corresponding embedded-registry entry and never accepts pack
bytes supplied outside the authenticated event archive.

### Update strategy

- **Synchronous, same transaction** for projections that must never lag the write a user
  just made (e.g. your own post appearing, your vote in the count). The command handler
  appends events and updates these projections in **one DB transaction**. Strong
  read-your-writes, no eventual-consistency surprises in the hot path.
- **Asynchronous listeners** use Postgres `LISTEN/NOTIFY` on `fmarch_live` (payload:
  game id) as a best-effort wakeup for live fan-out. Persist emits the notify in
  the same transaction as the append, so Postgres delivers it only after commit.
  `NOTIFY` is not the delivery log; the durable source of truth is the committed
  `events.seq` cursor. A listener that misses a notification catches up by
  querying events after its last delivered `seq`. See [03-backend](03-backend.md).

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
- Network retries use durable command receipts keyed by `(principal, command_id)`: if a
  command committed but its ack was lost, retry returns the original ack instead of
  appending duplicate events.

Continue to [03-backend](03-backend.md).
