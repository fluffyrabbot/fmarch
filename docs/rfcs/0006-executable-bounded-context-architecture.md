<!-- architecture-fitness-contract:v1 -->

# RFC 0006 — Executable bounded-context architecture

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-30 |
| **Accepted** | 2026-08-30 |
| **Decision owner** | Project owner |
| **Target** | Runtime boundaries, event persistence, projections, database authority, and migration sequencing |
| **Related** | [RFC 0003](0003-community-platform-v2.md), [RFC 0004](0004-principal-profile-privacy-boundary.md), [RFC 0005](0005-closed-community-admission.md), [event sourcing](../arch/02-event-sourcing.md), [security](../arch/06-security.md) |

## Summary

Replace the persistence-centered application architecture with explicit bounded
contexts over a small typed event-journal and projector platform. HTTP and
WebSocket code become adapters. Context application services own decisions.
Context Postgres adapters own their schemas. The public, operator, projector,
and privacy runtimes receive different authorities.

This is a greenfield cutover. Development data, current event encodings, and
wire protocol v2 may be reset. Runtime dual writes, compatibility event kinds,
and transitional generic repositories are forbidden. Each vertical migration
lands in one working state and deletes the superseded path in the same atomic
change.

The companion `tools/architecture_fitness.mjs` distinguishes three things that
must not be conflated:

1. **hard bans** already true and enforced now;
2. **ratchets** that freeze the current dependency-debt ceiling while allowing
   edges to be removed;
3. **target bans** that describe the accepted end state but remain reported debt
   until the owning migration removes them.

## Current state and preserved strengths

The current system has strong domain ideas worth carrying forward:

- credential principals, privacy subjects, member profiles, game personas, and
  game slots are distinct identities;
- game and forum posts have separate authority and provenance;
- expected-version appends, idempotent command receipts, encrypted event bodies,
  deterministic resolution, and fail-closed startup checks are good mechanisms;
- pure `forum`, `attention`, `social`, `trust_safety`,
  `community_membership`, `content_reference`, `domain`, and `game_platform`
  code already demonstrates useful context ownership.

The defect is integration ownership. `api` performs application work,
`projections` both appends and reads, command decisions depend on derived tables,
privacy key access enters generic projection code, and one server/pool joins the
public and operator planes. This RFC changes those dependencies without merging
the domain concepts that are already separate.

## Target dependency DAG

Arrows mean “may depend on.” An omitted arrow is forbidden.

```text
public_runtime ───────────────> http_adapter, websocket_adapter, runtime_config
operator_runtime ─────────────> operator_adapter, operator_queries, runtime_config
projector_runtime ────────────> context_projectors, projector_platform
privacy_runtime ──────────────> privacy_application, privacy_vault_adapter

http_adapter / websocket_adapter
  ├───────────────────────────> transport_contract
  ├───────────────────────────> context application/query ports
  └───────────────────────────> authenticated actor/request context values

context application service
  ├───────────────────────────> its context domain
  ├───────────────────────────> its repository/journal/outbox ports
  └───────────────────────────> explicitly named integration ports

context Postgres adapter
  ├───────────────────────────> its context application ports and domain values
  ├───────────────────────────> typed event-journal adapter
  └───────────────────────────> its owned schema only

context projector
  ├───────────────────────────> its context event codec
  ├───────────────────────────> projector platform
  └───────────────────────────> its owned read schema only

event-journal platform ───────> envelope crypto, SQL driver, no domain context
projector platform ───────────> journal-reader port, cursor/generation store
transport_contract ──────────> serialization primitives only
pure context domain ─────────> smaller pure value/context crates only
```

The product remains a modular monolith where that preserves simplicity. Process
separation is mandatory only at materially different authority or resource
boundaries:

- the public gateway does not receive raw key, archive, migration, operator, or
  broad mutation authority;
- the operator/proof plane has its own private listener and read-only database
  role;
- the privacy worker/key broker alone owns subject-key provisioning and
  destruction authority;
- projector workers receive journal read and schema-specific projection write
  authority, never command authority.

Cross-context workflows use typed integration facts and explicit coordinators.
No context reaches into another context’s tables. Closed-community admission is
the intentional exception requiring atomic coordination; its coordinator may
call narrow stored APIs or receive an enumerated grant, never a universal role.

## Fitness enforcement: hard bans, ratchets, and target bans

### Active hard bans

These fail `npm run test:architecture-fitness` immediately:

| Policy | Enforced rule |
|---|---|
| `hard:pure-context-inward-only` | Pure context manifests cannot depend on runtime, transport, persistence, HTTP, object-store, or operator crates. |
| `hard:event-journal-no-outward-dependencies` | `eventstore` cannot depend on API, command, projection, capability, wire, server, or operator layers. |
| `hard:api-does-not-import-operations-plane` | `api` cannot acquire `operator_api`, `operator_proof`, or `server`. |
| `hard:public-server-does-not-import-proof-engine` | The public server cannot directly acquire `operator_proof`; its existing `operator_api` edge is target debt, not permission to deepen it. |
| `hard:wire-does-not-import-runtime-or-privacy` | `wire` cannot acquire runtime, database, journal, identity/private-claim, SQL, or operator implementations. |

### Dependency ratchets

These policies record the existing direct **workspace-package** dependencies of
the four integration hubs, including both explicit `path` declarations and
dependencies inherited from `[workspace.dependencies]`:

- `ratchet:server-direct-workspace-dependencies`
- `ratchet:api-direct-workspace-dependencies`
- `ratchet:projections-direct-workspace-dependencies`
- `ratchet:wire-direct-workspace-dependencies`

Removing a listed edge passes without changing the checker. Adding a new edge
fails. A migration that introduces a replacement crate must remove the old edge
in the same atomic change or amend the ratchet explicitly with this RFC’s
migration ledger. Ratchet amendments may not silently increase total
cross-context authority.

When a target edge is removed, delete it from the ratchet allowance and promote
the corresponding target rule to an active hard ban in the same commit. The
ratchet therefore moves in one direction; it is not a permanent allowlist for
the current architecture.

### Accepted target bans

These are reported by the checker but do not fail today. They become hard bans
as their migration steps land:

| Policy | End-state rule |
|---|---|
| `target:public-runtime-is-adapter-only` | The public runtime owns composition and transport only; it does not import commands, projections, SQL, identity/privacy implementations, media storage, operator code, or domain engines. |
| `target:http-api-has-no-persistence` | HTTP code has no SQL, eventstore, projections, command implementation, identity implementation, schema, or object-storage dependency. |
| `target:wire-has-no-internal-dependencies` | The transport contract contains DTOs and serialization primitives only. Mapping belongs to adapters. |
| `target:event-journal-is-context-neutral` | The event journal has no game/domain or principal dependency. Context codecs own those values. |
| `target:monolithic-projections-have-no-write-authority` | The monolithic projection crate disappears; no read projector can append canonical facts or open privacy claims through a global authority. |

Target bans are architecture decisions, not lint warnings. “Reported debt” means
the scheduled migration owns their removal, not that new uses are acceptable.

## Typed event codec contract

The journal persists an encrypted, context-neutral envelope:

```rust
pub struct PersistedEnvelope {
    pub stream_id: StreamId,
    pub stream_seq: StreamVersion,
    pub context: ContextTag,
    pub kind: EventKindTag,
    pub schema_version: EventSchemaVersion,
    pub occurred_at: LogicalTime,
    pub actor: EncodedActor,
    pub causation_id: Option<CommandId>,
    pub sealed_body: SealedBytes,
}

pub trait EventCodec {
    type Event;

    fn encode(event: &Self::Event) -> Result<EncodedEvent, EncodeError>;
    fn decode(envelope: OpenedEnvelope<'_>) -> Result<Self::Event, DecodeError>;
}

pub trait GameJournal {
    async fn load(&self, id: GameId) -> Result<Versioned<GameAggregate>, LoadError>;
    async fn append(
        &self,
        id: GameId,
        expected: ExpectedVersion,
        events: NonEmpty<GameEvent>,
    ) -> Result<Commit, AppendError>;
}
```

Required properties:

1. Each context owns one exhaustive current event enum. There is no global
   business-event super-enum and no caller-constructed string/JSON `EventInput`.
2. Storage tags remain strings/numbers only as a private encoding detail. Only a
   context codec can construct an `EncodedEvent` accepted by its journal port.
3. Decode and upcast return `Result`. Unknown context, kind, version, malformed
   payload, or failed upcast is a hard error. Projectors may not silently skip it.
4. A context owns all historical upcasts for its events. The generic journal
   neither imports the context nor knows its current version.
5. Startup readiness and every rebuild scan prove that all reachable envelopes
   decode before serving or activating a generation.
6. Each codec has fixture-corpus tests for every retained version, encode/decode
   round trips, upcast idempotence, and unsupported-version rejection.
7. Cross-context integration facts use their own small typed contracts and
   transactional outbox. They are not aliases for private aggregate events.

Because this repository has no external users, the first cut resets development
streams to the new v1 codecs rather than preserving the current untyped event
universe.

## Authoritative and derived state inventory

“Synchronous” does not automatically mean authoritative. Canonical facts,
invariant guards, and replaceable query projections have different contracts.

| Class | Surfaces | Consistency and recovery contract |
|---|---|---|
| Canonical facts | Typed event journal; immutable pack/content artifacts; sealed privacy claims; external key-vault revocation journal | Append-only or explicitly irreversible. Never rebuilt from a read model. Unknown encoding fails closed. |
| Operational authority | Principals, authentication methods, credential status, sessions, membership/invitation state, privacy lifecycle and tombstone | Context-owned transactional state. Only the owning application role mutates it. Audit facts/outbox commit with the transition. |
| Synchronous invariant guards | Expected stream version, command receipt, uniqueness reservations, current subject tombstone, public-publication visibility/deny overlay | Minimal rows used to prevent invalid writes or disclosure. Must commit atomically with the owning decision and have fail-closed semantics. |
| Validated write cache | `GameAggregate` snapshot/checkpoint and other context aggregate snapshots | Rebuildable from typed events, checksummed, and accepted only at the exact journal version. Corruption falls back to replay; it never becomes an independent source of truth. |
| Derived context views | Thread pages, game index, vote tallies, slot presentation, public profile presentation, membership ancestry | Cursor-driven and generation-owned. May lag. Commands do not authorize from them. |
| Derived integration views | Search documents, citations, inbox items, watch feeds, public discovery, moderation queues | Independently rebuildable. Failure cannot roll back canonical source writes. Public reads still join/check the synchronous visibility guard. |
| Operations evidence | Projection audits, resolution traces, proof reports, performance/fuzz reports | Read-only operations-plane products. Never imported by the public runtime or used as product authority. |

`public_publication` is a special synchronous security index: source contexts may
write it only through a narrow typed port/stored API. Absence means not public.
A hide/redact transition commits an immediate deny/tombstone before asynchronous
search, citation, and inbox cleanup. This preserves RFC 0003’s fail-closed public
boundary without placing all read-model work inside a source transaction.

## Context, schema, and role ownership

All schemas have a NOLOGIN owner. Login/runtime roles receive exact table/view
or stored-API grants. The public query role receives `SELECT` only on reviewed
views; it never receives blanket schema/table rights.

| Context/platform | Target schema | Owned state | Runtime role/authority |
|---|---|---|---|
| Event journal | `journal` | Envelopes, stream versions, encrypted stream keys, command outbox | `fmarch_journal_append`; projector-specific read grants; separate key-admin role |
| Identity | `identity` | Principals, accounts, auth methods, external identities, sessions, recovery, login attempts, delivery intents | `fmarch_identity_rw`; public gateway calls identity service, not tables |
| Privacy | `privacy` | Subject lifecycle, sealed claims, tombstones, erasure intents and receipts, vault binding | `fmarch_privacy_rw`; key provision/destroy only in privacy worker/broker |
| Membership | `membership` | Community memberships, invitations, invitation credentials, ancestry | `fmarch_membership_rw`; admission coordinator gets named operations only |
| Game | `game` | Game aggregate snapshots/guards, persona/occupancy facts, game event streams, content write guards | `fmarch_game_command` |
| Forum | `forum` | Area/topic aggregate guards and forum event streams | `fmarch_forum_command` |
| Social | `social` | Profile aggregate guards and mute relationship streams | `fmarch_social_command` |
| Attention | `attention` | Watches and read cursors | `fmarch_attention_command` |
| Trust and safety | `trust_safety` | Reports, cases, decisions, visibility deny facts | `fmarch_trust_safety_command` |
| Publication registry | `publication` | Stable public content identity and synchronous visibility guard | owner-only tables; named publish/hide APIs granted to source/safety roles |
| Media | `media` | Upload ledger, canonical content references, variant metadata | `fmarch_media_rw`; bucket credential scoped to media runtime |
| Context projections | `<context>_read` | Context-owned derived views and projector cursors/generations | one projector writer per schema; public query role gets selected views |
| Integration projections | `discovery_read` | Search, citations, inbox/discovery materializations | integration projector writer; public query role gets selected views |
| Operator evidence | `ops_read` plus immutable artifact storage | Proof/audit metadata and artifact references | `fmarch_operator_ro`; no product mutation grant |

No application role receives `SELECT`, `INSERT`, `UPDATE`, or `DELETE` over every
schema. A process that needs two authorities is either an explicitly reviewed
coordinator or incorrectly drawn.

## Minimal `GameAggregate` state

The write aggregate contains only state needed to accept or reject a game
command and to deterministically produce events:

```rust
pub struct GameAggregate {
    pub id: GameId,
    pub version: StreamVersion,
    pub lifecycle: GameLifecycle,
    pub pack: ImmutablePackRef,
    pub authority: GameAuthority,          // host, cohosts, permission classes
    pub slots: SlotWriteState,              // existence, lifecycle, status/effects
    pub occupancy: CurrentOccupancy,        // slot -> persona/epoch, never user -> slot
    pub phase: PhaseWriteState,             // phase id, open/locked, deadline
    pub channels: ChannelWritePolicy,       // posting policy and slot/persona membership
    pub ballots: CurrentBallots,
    pub actions: CurrentActionState,        // submissions, grants, cadence counters
    pub day_events: CurrentDayEventState,
    pub engine: EngineCheckpointRef,        // version/hash and last applied resolution
}
```

The aggregate excludes post bodies/history, rendered personas, profile claims,
search documents, inbox rows, audit reports, and transport DTOs. Large immutable
content and pack data are referenced by authenticated hashes. Quotation/content
existence and uniqueness may use small synchronous write-guard indexes rather
than pulling a thread read model into the aggregate.

Command execution follows optimistic compute/short commit:

1. load and validate a checksummed snapshot plus typed event tail;
2. resolve the authenticated actor through an explicit authority port;
3. decide and run deterministic engine computation outside a database
   transaction;
4. begin a short transaction, revalidate ephemeral session/subject cutoff,
   compare the expected stream version, append typed events, update minimal
   guards/snapshot, and enqueue integration facts;
5. retry from step 1 on version conflict.

Hammer detection is a cheap aggregate ballot-policy decision, not a full
resolver preview under the stream lock. Full phase resolution may be expensive,
but only its compare-and-append phase holds the journal lock.

## Privacy lifecycle and receipts

### Provisioning

```text
Reserved
   │ durable SubjectId reservation
   ▼
ProvisioningKey
   │ idempotent vault create(subject, provisioning_nonce)
   ▼
KeyProvisioned ── vault receipt/epoch committed ──> Active
   └── retry/reconcile; never usable before Active
```

External key creation never occurs while a database transaction remains open.
An abandoned reservation contains no claim and grants no read authority. The
reconciler can retry the same nonce or safely retire it.

### Erasure

```text
Active
  │ commit auth cutoff + subject tombstone + ErasureRequested
  ▼
ErasurePending
  ├──> KeyDestroyed receipt + external revocation-journal receipt
  ├──> IdentityRedacted receipt
  ├──> MembershipRedacted receipt
  ├──> SocialRedacted receipt
  ├──> GameRedacted receipt
  ├──> Forum/Attention/Safety/Media receipts when subject-bearing
  └──> projection-generation cleanup receipts
                 │ complete required receipt manifest + digest
                 ▼
               Erased
```

Required durable receipts are:

- `ErasureIntentCommitted`, naming subject, request, tombstone alias, and policy
  manifest version;
- `AuthenticationCutoffCommitted`;
- `SubjectKeyDestroyed`, naming vault authority/epoch and immutable external
  revocation receipt without including key material;
- one idempotent `ContextSubjectRedacted` per required context, including the
  context schema epoch and consumed integration-event position;
- `ProjectionSubjectCleanup` per independently generated public read family;
- terminal `ErasureCompleted`, containing the sorted receipt-set digest.

The versioned required-context manifest is code-owned. A new subject-bearing
context cannot become ready until it registers its redactor and receipt proof.
Every public/private claim read checks the central tombstone until terminal
completion, so delayed cleanup cannot republish or disclose erased material.
Contexts own their redaction logic; privacy orchestration never issues SQL
against game, membership, social, or forum tables.

Claim sealing/opening also avoids network I/O under database locks. Seal/open
outside the transaction against a subject epoch, then recheck active epoch and
tombstone before committing materialization. A concurrent tombstone wins and
the result is discarded.

## Shadow projection rebuild protocol

Destructive in-place rebuild is forbidden in a live runtime. Every projector has
an immutable identity, active generation pointer, and per-generation contiguous
journal cursor.

1. Allocate `building_generation` without changing `active_generation`.
2. Decode and project canonical events from cursor zero into generation-scoped
   rows. Unknown/invalid events fail the build; no event is skipped.
3. Run active and building consumers independently until the building cursor is
   near the journal high-water mark.
4. Acquire the projector’s short activation lock. Capture high-water `H`, apply
   the building generation contiguously through `H`, and record its row-set
   digest, codec set, schema epoch, and cursor.
5. In one transaction, verify the current active pointer and building receipt,
   then flip `active_generation` to the new generation. Readers select through
   that pointer/view.
6. Release the lock. Normal consumption resumes from `H`; events committed after
   `H` remain in the journal and cannot be lost.
7. Retain the old generation until deterministic audit and a bounded rollback
   window pass. Garbage collection operates from an immutable reviewed plan.

Crash behavior is explicit:

- a crash before the pointer flip leaves an inert building generation;
- a crash during activation rolls back the pointer transaction;
- a crash after activation resumes from the committed cursor;
- no step deletes the active generation before a verified replacement exists.

Security-critical visibility guards are not casually generation-swapped. A
global tombstone/deny overlay remains outside derived generations and always
wins. Generation absence is treated as not visible.

## Atomic migration sequence

Every numbered item is an independently green, reviewable change. Scaffolding
may land before a cut, but production traffic has exactly one write path at the
end of every item.

1. **Land this RFC and fitness ratchet.** Enforce current hard bans, freeze new
   integration-hub edges, and report target debt.
2. **Remove live destructive rebuild authority.** Delete runtime rebuild routes;
   retain only exclusive/offline test rebuild until the shadow protocol lands.
   Add the concrete concurrent append/rebuild counterexample test.
3. **Install the context-neutral typed journal.** Add typed codecs, decode audit,
   expected-version append, transactional integration outbox, and codec fixture
   corpus. Reset development streams; do not dual-write old/new envelopes.
4. **Make forum the reference vertical slice.** Add forum application, journal,
   Postgres, query, and projector owners. Move decisions out of HTTP, delete
   forum writes from `projections`, and promote every removed edge to a hard ban.
5. **Cut social, attention, and trust-safety separately.** Preserve their domain
   ownership. Keep only publication visibility synchronous; move search,
   citations, and inbox work to cursor-driven projectors.
6. **Replace `commands` with `GameApplication` and `GameAggregate`.** Migrate one
   command family at a time behind the same adapter, then delete the old family
   immediately. Finish with optimistic compute/short commit and remove
   projection-based authorization/write validation.
7. **Land projector generations.** Convert remaining synchronous read models to
   cursor-owned context projectors, implement build/catch-up/activate/audit, then
   permanently hard-ban projector append authority.
8. **Rebuild privacy provisioning and erasure.** Inject narrow vault ports, add
   provisioning receipts, central tombstone, context redaction consumers, and
   terminal receipt digest. Delete the process-global key store and
   cross-context erasure SQL.
9. **Split schemas, owners, roles, and pools.** Move each context’s tables with
   its service cut. Admission receives only its named coordination operations.
   Replace the universal `public` schema/application role contract.
10. **Split runtime processes.** Create public gateway, command/identity,
    projector, privacy, and private operator runtimes with independent listeners,
    credentials, bulkheads, and egress. Remove operator/proof code from the public
    binary.
11. **Rebaseline transport v3.** Make the wire schema implementation-free,
    generate client DTOs, update all clients/fixtures atomically, and delete v2.
12. **Delete migration debt.** Remove superseded crates/tables/events, reduce all
    ratchet allowlists to the target DAG, reset development databases, execute
    the full local proof sweep, and record the final dependency graph receipt.

An edge may move only inward during this sequence. Temporary compatibility
routes, dual event kinds, dual writes, and a generic “all contexts” repository
are explicitly rejected.

## Trade-offs and preserved invariants

- Derived reads become eventually consistent. Commands return committed facts
  and journal version directly; a caller may wait for a named projector cursor
  only where a product requirement truly needs it.
- Small security/invariant guards remain synchronous. Search, inbox, audit, and
  rendering work do not.
- Optimistic game computation may repeat after a conflict. Deterministic replay
  makes recomputation preferable to holding database/stream locks throughout.
- More roles and workers add operational objects, but they make real trust and
  failure boundaries visible. Contexts need not become network microservices.
- Typed codecs add context-local code. Do not DRY them into a transport-selected
  generic event model.
- Game and forum commands, events, authors, and authorization stay separate.
  Shared `ContentRef`, quotation validation, envelope crypto, journal mechanics,
  and projector mechanics remain appropriate shared infrastructure.
- Principal, privacy subject, profile, game persona, and slot identities remain
  distinct throughout migration.

## Proof and completion criteria

The architecture is complete only when:

1. all accepted target bans are active hard bans and target debt is zero;
2. every production dependency edge conforms to the target DAG;
3. every event row passes the owning typed codec audit;
4. commands authorize from aggregate/operational authority, not query
   projections;
5. concurrent append/rebuild proof demonstrates no lost projection update;
6. privacy provisioning and erasure crash/retry matrices end in a valid state
   with complete receipts;
7. database catalog proof shows schema ownership and least-privilege grants;
8. the public binary contains no operator/proof or raw privacy-key authority;
9. wire generation proves no internal implementation dependency; and
10. the repository’s forced full local proof sweep passes from a reset database.
