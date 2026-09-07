# 03 — Backend (Rust service)

The Rust API runtime terminates HTTP and WebSocket, handles commands, maintains
projections, and publishes live updates. SvelteKit is a separate frontend server
and same-origin session boundary. A separate one-shot migrator owns schema
changes; release API replicas only verify schema and authority readiness.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **tokio** | async, multi-threaded scheduler |
| HTTP / WS | **axum** | REST for cold loads & uploads, WS for live |
| DB access | **sqlx** | compile-checked queries against Postgres |
| DB | **Postgres** | event log + projections in one boring, durable store |
| Serialization | **serde** (+ `ciborium` for CBOR) | one derive, many formats; see [04](04-wire-protocol.md) |
| Type export | **ts-rs + explicit wire renderer** | generate TS types from Rust (single source of truth) |
| Hashing | **blake3** | content addressing for media ([07](07-images.md)) |
| Passwords | **argon2** (argon2id) | see [06](06-security.md) |

No ORM. No bespoke event-store database. Postgres with `sqlx` is plenty and operationally
boring, which is exactly what a years-running substrate wants.

## Request shape: commands and queries

The backend is **CQRS-flavored** but pragmatic:

- **Commands** mutate. They flow: `decode → resolve capability → load aggregate → validate
  → append events → update synchronous projections (same tx) → ack`. A command never
  writes a projection without writing the events that justify it.
- **Queries** read projections only. They never touch the event log directly (except admin
  / replay tooling).

### Command handling pipeline

```
HTTP JSON command ─▶ decode (versioned typed envelope)
             ─▶ preliminary session validation
             ─▶ reserve global + per-principal command admission
             ─▶ prepare bounded external references
             ─▶ reserve authority-transaction capacity
             ─▶ BEGIN tx
                   try-lock game stream ────────────────┐ canonical lock plan
                   lock actor + target owners by UUID ──┤
                   lock + revalidate exact session ─────┤ trust/retirement fence
                   insert command receipt claim (principal, command_id)
                   resolve capability for this action ──┤
                   load aggregate state @ stream_seq ───┤
                   validate + produce events ────────────┘
                   append events  (optimistic concurrency on (stream_id, stream_seq))
                   fold into synchronous projections
                   store ack on command receipt
                 COMMIT
             ─▶ NOTIFY new seq        (best-effort wakeup for async fan-out)
             ─▶ ack to caller
```

- **Capability resolution happens once, at the boundary**, and the resolved capability is
  passed inward to the domain. Inner code does not re-derive authority or consult ambient
  globals. See [06-security](06-security.md).
- **Authenticated mutations are transaction-fenced.** The command transaction locks and
  revalidates the exact session before claiming a receipt or changing domain state. It first locks
  the game stream, then the actor and every command-declared cross-principal owner in canonical UUID
  order, and only then takes the session fence. This prevents domain code from discovering a target
  identity after locking the actor and forming a cross-principal cycle. Session, method, principal,
  or WorkOS-key retirement therefore either waits for an earlier command to commit or wins first and
  makes the command reject; retirement cannot return while older detached authorization later commits.
  One five-second lease starts before pool checkout and covers the complete command transaction;
  timeout or commit ambiguity closes the owned connection within a separate one-second cleanup
  reserve, which is compile-time ordered below the seven-second cutoff budget.
  Global and one-per-principal admission happen before the lock-bearing transaction, the stream lock
  fails fast as a retryable conflict, and authority-lock waits have a bounded timeout. The shared
  authority-transaction budget is capped at database-pool capacity minus three: one connection is
  accounted for by the durable LISTEN loop and two remain outside this authority-fenced workload.
  This is a workload ceiling, not a priority reservation against unrelated pool consumers. The live
  delivery sub-budget is at most one less than the shared authority budget, so socket fan-out cannot
  monopolize every command/cutoff permit. Cross-principal authority grants also revalidate the locked
  target as active; authority removal may still target an existing inactive owner.
- **Other security-sensitive HTTP mutations use the same commit-point rule.** The API's
  `AuthorizedUnitOfWork` owns a non-escapable transaction plus freshly locked authorization for
  community invitation and stewardship writes. Identity lifecycle and private-export services
  accept only an opaque exact-session proof and revalidate it after their canonical owner lock.
  Hosted game invitations resolve current `GlobalAdmin` or `HostOf(game)` inside the insertion
  transaction; account, session, and invitation revocation similarly recheck the initiating
  administrator at the commit boundary.
- **Validation is total.** Every command handler can state its preconditions; illegal
  transitions (voting in a locked phase, posting as a dead slot) are rejected with a typed
  domain error, not a panic. Errors are actionable and cross the boundary cleanly.
- **Optimistic concurrency** via the `(stream_id, stream_seq)` unique constraint
  ([02](02-event-sourcing.md)). On conflict: reload, revalidate, retry (bounded).
- **Idempotency** is keyed by `(principal, command_id)`, not by the per-connection envelope
  id. A duplicate command id returns the stored ack from the first committed attempt and
  does not run validation or append again. A lost commit acknowledgement is a distinct retryable
  outcome: the client must retry the exact same command id so the receipt resolves whether the first
  attempt committed, never invent a replacement id that could duplicate the mutation.

## Live delivery

One ticketed WebSocket per connected live surface. The server pushes **binary
CBOR projection deltas** — framed, versioned, and *filtered by the client's
capabilities* so a client only ever receives what it may see (a spectator never
receives scumchat frames; the bytes don't leave the server). Commands remain on
authenticated REST/JSON; the WebSocket is a server-to-client projection channel.

```
            append committed ─▶ NOTIFY ─▶ fan-out task
                                              │  for each subscribed connection:
                                              │    is this event visible to its caps?
                                              │      yes ─▶ encode delta (CBOR) ─▶ send
                                              │      no  ─▶ drop
```

- Fan-out is **async** ([02](02-event-sourcing.md)) — it must not block the committing
  command. The author's own synchronous projections already reflect their action; everyone
  else gets the delta a beat later.
- `events.seq` is the durable resume cursor. Each API process holds one `LISTEN`
  on `fmarch_live`. Persist emits `NOTIFY` with the game id after the append
  transaction commits. That wakeup is not the delivery log; reconnects and
  missed notifications catch up by querying committed events after the last
  delivered `seq`. A long interval fallback covers a dropped `NOTIFY`.
- Subscriptions are scoped: a client subscribes to a game / channel set, and the server
  resolves visibility per delta. Visibility is computed from the `channel_membership` and
  `slot_state` projections, never trusted from the client.
- Connection backpressure: the live projection broadcast is bounded. A receiver that falls
  behind receives at most one terminal `ResyncRequired`, then the server ends
  that socket generation. The browser retires it, remints a ticket, validates a
  fresh `Hello`, and refreshes authoritative REST state before applying deltas.
  See [04-wire-protocol](04-wire-protocol.md) for the generation contract. Each lag emits the structured
  `live_projection_receiver_lagged` warning with `game_id`, an ephemeral `connection_id`, and
  `dropped_messages`; it contains no principal credentials or projection payload.
- Every outbound application batch first joins the global signing-key-retirement and principal-cutoff
  gates in shared mode, then revalidates the exact session, resolves the current game capabilities,
  and holds the owner, session, plus every existing row supporting the granted role, slot, and
  private-channel scope through one whole-batch socket deadline. That single five-second lease begins
  before the first cutoff gate and includes all session/capability lock acquisition plus socket I/O;
  database wait time can only reduce the remaining send budget. The final guard rejects stale ticket
  scope and checks host/player-only delta audiences before encoding. Session/key retirement and
  game-authority removal take conflicting mutation locks, so on a healthy database their receipts
  cannot precede a still-running authorized send. An exclusive cutoff writer therefore drains the
  already-entered batch set once and prevents fresh delivery readers from overtaking it; it never
  accumulates one five-second wait per session. Delivery guards wait behind a small dedicated
  semaphore capped below the shared authority budget; fan-out pressure is backpressure, not mass
  authorization failure. The server rejects an idle-transaction timeout below ten seconds so it cannot
  undercut the five-second delivery deadline. Destructive identity work begins through one authority
  transaction constructor whose local seven-second lock wait outlasts that delivery deadline and whose
  ten-second statement budget remains inside the HTTP deadline. It also polls inbound control/close frames alongside
  projection wakes, releasing global and per-principal admission on a quiet peer disconnect. A failed
  guard release advances already-emitted envelope ids, closes the socket, and permits no later batch.
  A cancelled or failed application-frame send instead drops the socket without another poll: a sink
  may already have buffered that frame, so a later Close write is forbidden from flushing it after the
  authority guard is gone.
  This is a healthy-database linearizability guarantee: termination of the guard's PostgreSQL backend
  during an in-flight socket write can release the database fence before that write reports failure.

## Cold loads & uploads over REST

Not everything is a live delta. Initial page load, deep history pagination, and image
upload go over plain HTTP:

- `GET` endpoints read projections, paginated, capability-filtered.
- Authenticated `GET /games/{game}/notifications` returns projected
  `player_notification` rows. Hosts/cohosts read all rows for audit; slot occupants read only
  rows addressed to their current slot; unrelated principals receive `NotAuthorized`.
- Authenticated `GET /games/{game}/host-phase-controls` returns projected
  `host_phase_control` audit rows for host/admin prompt decisions that moved phase state.
  Hosts/cohosts may read it; unrelated principals receive `NotAuthorized`.
- Authenticated `GET /games/{game}/resolution-traces?run_id=...` returns host/cohost-only
  stored `ResolutionTrace` inspection rows, with each decision/edge/generated/effect/visibility
  row anchored to the persisted `ResolutionApplied` stream sequence when one exists.
- Auth is API-owned: classic and WorkOS sign-in both produce opaque `fmss_`
  app sessions. `GET /auth/session` returns server-derived principal and
  capability data; live sockets require one-time tickets tied to those sessions.
  SvelteKit owns browser cookie handling and optional AuthKit ceremony, not
  application authority. Exact method, retirement, and debug-only bootstrap
  rules live in [06-security](06-security.md).

- Image upload is a `POST` that runs the ingest pipeline ([07](07-images.md)) and returns
  a content-addressed handle.
- A reconnecting client cold-loads the current projection state, then resumes the live
  stream from the latest `seq` it has — no lost-update gap.

## Module ownership

| Owner | Responsibility |
|---|---|
| `domain` | Pure slot-based engine, packs, resolver, event/result validation and folds |
| `game_platform` | Pure game personas, occupancy vocabulary, DayPrograms and DayEvents |
| `principal`, `identity`, `community_membership` | Principal identity, authentication/lifecycle, membership domain |
| `forum`, `social`, `attention`, `content_reference` | Discussion writes, public engagement, inbox reasons, typed content references |
| `profile_application`, `membership_application`, `game_persona_application` | Application coordination across explicit domain ports |
| `content_registry`, `profile_handle_index`, `trust_safety` | Embedded content custody, private handle indexing, moderation |
| `commands` | Game command transactions, capability admission, engine/platform orchestration |
| `eventstore`, `projections`, `database_schema` | Stream persistence, read-model folds, sole catalog authority |
| `caps` | Scoped capability types and resolution |
| `media` | Canonical image ingest, variants, local/object-store adapters |
| `wire` | Versioned live envelopes and generated browser contracts |
| `api`, `operator_api`, `operator_proof` | Gameplay/auth transport, operator transport, audit/report services |
| `server` | Runtime composition, configuration, schema gate, migrator and protected operator binaries |

`wire` exports the shared browser contract; route-local HTTP DTOs also live in
their API families. Domain events remain separate from transport envelopes.
[RFC 0006](../rfcs/0006-executable-bounded-context-architecture.md) defines the
executable dependency rules. [16](16-maintainable-core.md) records finer module
ownership and the remaining refactor frontier.

## Operational posture

- **Schema:** use the migrator through the local migration helper or hosted
  release coordinator. [Schema evolution](../ops/database-schema-evolution.md)
  owns the procedure; event payload evolution remains an event-store concern.
- **Capacity and telemetry:** admission, database waits, authority leases, live
  limits, overload responses, and evidence are specified in
  [12-capacity-and-overload](12-capacity-and-overload.md). Exact retirement and
  disclosure guarantees live in [06-security](06-security.md).
- **Determinism:** folds consume captured event data. Resolver randomness and
  logical time are explicit inputs; replay does not consult wall clocks or
  external services.
- **Proof:** select lanes mechanically under [AGENTS.md](../../AGENTS.md).
  Postgres-backed command tests require a database and serial execution where
  specified; the default command crate suite is not a database-free gate.
  Heavy builds use the shared host lock. Operator subprocess and minimizer
  proof lives in `operator_proof`, outside production command ownership.

Continue to [04-wire-protocol](04-wire-protocol.md).
