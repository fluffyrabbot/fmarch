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
client frame ─▶ decode (CBOR, versioned)
             ─▶ authenticate (session) ─────────────┐
             ─▶ claim durable command_id receipt ────┤ retry boundary
             ─▶ resolve capability for this action ──┤ trust boundary
             ─▶ load aggregate state @ stream_seq ───┘
             ─▶ validate (domain rules; phase open? vote legal? slot alive?)
             ─▶ produce events
             ─▶ BEGIN tx
                   insert command receipt claim (principal, command_id)
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
- **Validation is total.** Every command handler can state its preconditions; illegal
  transitions (voting in a locked phase, posting as a dead slot) are rejected with a typed
  domain error, not a panic. Errors are actionable and cross the boundary cleanly.
- **Optimistic concurrency** via the `(stream_id, stream_seq)` unique constraint
  ([02](02-event-sourcing.md)). On conflict: reload, revalidate, retry (bounded).
- **Idempotency** is keyed by `(principal, command_id)`, not by the per-connection envelope
  id. A duplicate command id returns the stored ack from the first committed attempt and
  does not run validation or append again.

## Live delivery

WebSocket per connected client. The server pushes **projection deltas** — framed,
versioned, and *filtered by the client's capabilities* so a client only ever receives what
it may see (a spectator never receives scumchat frames; the bytes don't leave the server).

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
- `events.seq` is the durable resume cursor. `LISTEN/NOTIFY` may wake fan-out workers, but
  it is not the delivery log; reconnects and missed wakeups catch up by querying committed
  events after the last delivered `seq`.
- Subscriptions are scoped: a client subscribes to a game / channel set, and the server
  resolves visibility per delta. Visibility is computed from the `channel_membership` and
  `slot_state` projections, never trusted from the client.
- Connection backpressure: the live projection broadcast is bounded. A receiver that falls
  behind gets `ResyncRequired`, cold-loads current REST projections, and continues on the same
  socket; only a failed socket send ends that delivery loop. This bounds memory without turning
  a recoverable broadcast gap into an unnecessary reconnect. Each lag emits the structured
  `live_projection_receiver_lagged` warning with `game_id`, an ephemeral `connection_id`, and
  `dropped_messages`; it contains no principal credentials or projection payload.

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
- `GET /auth/session` verifies a WorkOS access token, maps its immutable `sub` to one stable
  local `platform_principal`, and returns only server-derived principal/capability data.
  SvelteKit AuthKit owns the encrypted browser session and forwards its short-lived access
  token to the API. Passwords, MFA, recovery, verification, and session refresh do not cross
  the API boundary. Legacy account/session endpoints are absent whenever WorkOS verification
  is configured; they remain available only behind `FMARCH_DEV_AUTH=1` for deterministic
  scratch-database proof lanes.
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
  committed projections and `commands::operator_proof` service code.
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
