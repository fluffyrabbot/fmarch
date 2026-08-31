# 03 — Backend (Rust service)

A single Rust service is the whole backend: it terminates HTTP and WebSocket, runs command
handling against the event store, maintains projections, and pushes deltas to clients.

## Stack

| Concern | Choice | Notes |
|---|---|---|
| Runtime | **tokio** | async, multi-threaded scheduler |
| HTTP / WS | **axum** | REST for cold loads & uploads, WS for live |
| DB access | **sqlx** | compile-checked queries against Postgres |
| DB | **Postgres** | event log + projections in one boring, durable store |
| Serialization | **serde** (+ `ciborium` for CBOR) | one derive, many formats; see [04](04-wire-protocol.md) |
| Type export | **ts-rs** or **specta** | generate TS types from Rust (single source of truth) |
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
  behind gets `ResyncRequired`, cold-loads current REST projections, and continues on the same
  socket; only a failed socket send ends that delivery loop. This bounds memory without turning
  a recoverable broadcast gap into an unnecessary reconnect. Each lag emits the structured
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
- Auth is multi-method and API-owned (source of truth: [06-security](06-security.md)).
  `GET /auth/session` validates an **opaque app-session bearer** (`fmss_…` → `auth_session`)
  and returns only server-derived principal/capability data (optional game-scoped caps).
  `POST /auth/sessions` creates that session via `method: "classic"` (password) or
  `method: "workos"` (one-time WorkOS access-token exchange). Classic account, recovery,
  invite, and session-lifecycle routes are first-class (default on; disable with
  `FMARCH_CLASSIC_AUTH=0`). WorkOS is additive when configured. Production `/auth/*`
  routes are always mounted and their availability is runtime policy. Arbitrary-principal
  `POST /auth/local-proof/sessions` is compiled only into debug builds and additionally
  requires `FMARCH_DEV_AUTH=1`, an explicit loopback listener, and a fresh per-process
  `FMARCH_LOCAL_PROOF_SECRET`. Verifier construction also generates an independent,
  non-secret process instance id persisted on each Dev session; even two simultaneous
  processes configured with the same secret reject one another's sessions. Every bearer,
  stored reference, and locked rotation must match the process instance exactly. WebSockets
  always require one-time tickets backed by those
  same sessions—there is no query-parameter principal form. None of these gates affects
  classic production auth.
  Frontend AuthKit (if used) is browser ceremony only; it does not own the API session.
  WorkOS assertion verification first acquires a dedicated bounded semaphore, then charges the
  signed-edge source budget; a shed 503 never consumes source quota. Verified signing-key
  provenance is persisted on each external session.
  `POST /auth/workos-signing-key-retirements` is a recent-method, GlobalAdmin-only production
  command. Retirement commands serialize globally before caller-session locking, then append an
  immutable key tombstone, revoke only matching live sessions, and audit the event atomically;
  historical expired/revoked rows remain inert. Issuance, linking, and rotation share the per-key
  admission gate and cannot make a retired key admissible again.
- Image upload is a `POST` that runs the ingest pipeline ([07](07-images.md)) and returns
  a content-addressed handle.
- A reconnecting client cold-loads the current projection state, then resumes the live
  stream from the latest `seq` it has — no lost-update gap.

## Module shape (intended crate/module layout)

```
crates/
  domain/        # pure: entities, events, folds, validation. No IO, no tokio, no sqlx.
  eventstore/    # append + load streams over Postgres; upcaster pipeline.
  projections/   # fold functions + projection tables; sync + async runners.
  api/           # public axum app: gameplay HTTP routes, WS handler, framing, session auth.
  operator_api/  # host/operator audit routes, proof-run status pages, HTML report views.
  caps/          # capability types + resolution at the boundary.
  media/         # blob ingest, transcode, addressing.
  wire/          # serde types shared with TS export (ts-rs/specta).
  server/        # binary: wiring, config, migrations, startup.
```

- `domain` is **pure and IO-free** so it's exhaustively testable and so folds are
  deterministic (a hard requirement for replay, [02](02-event-sourcing.md)).
- `operator_api` keeps proof-run status, projection/resolution audits, and HTML inspection
  pages out of the gameplay transport surface while still deriving authority from the same
  committed projections and `operator_proof` service code.
- `wire` is the **only** place types crossing the network are defined; TS is generated from
  it ([04](04-wire-protocol.md)). Domain events and wire frames are deliberately *separate*
  types — the wire is a projection of the domain, not the domain itself.

## Operational posture

- **Migrations** via `sqlx migrate` (projection tables and indexes; never the `events`
  payload shape — that evolves in code via upcasters).
- **Observability**: structured logging (`tracing`), one span per command with the
  capability used, request id, and resulting events; metrics on command latency, append
  conflicts, fan-out lag, WS connection count. HTTP admission, database waits, request
  deadlines, live-connection limits, and overload responses follow the explicit contract in
  [12-capacity-and-overload](12-capacity-and-overload.md).
- **Determinism guard**: folds must not call `now()`/RNG/network; this is enforced by
  construction (the `domain` crate doesn't depend on anything that could).
- **Test tiers**: the default `cargo test -p commands` is hermetic and parallel-safe.
  Subprocess audit/minimizer tests keep their report on a `--write-report`/`--output`
  file with the child's stdout redirected off the inherited pipe, so a fanned-out spawn
  never wedges the parent (a macOS stdout-pipe CLOEXEC race). The one test that shells out
  to a *nested* `cargo test` is `#[ignore]`d; run it explicitly with
  `cargo test -p commands -- --ignored`, ideally on Linux CI where nested-cargo spawns are
  safe.

Continue to [04-wire-protocol](04-wire-protocol.md).
