# 16 — Maintainable core boundary

## Decision

The 1.0 core is organized by ownership and dependency direction, not by file
size alone. A module should own one stable design decision, expose the smallest
contract needed by its callers, and depend inward on domain types rather than
outward on HTTP, SQL, fixture, or orchestration details.

This workspace is greenfield. Internal compatibility facades are not a goal:
extract the superior boundary directly, repair callers in the same atomic
change, and retain the public event, pack, wire, and HTTP contracts only when
those contracts are still intentional.

## Mechanical baseline

- `rust-toolchain.toml` pins Rust 1.95.0 with `clippy` and `rustfmt`.
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` is
  warning-clean.
- Every crate area and the workspace-manifest area in
  `docs/ops/proof-lane-manifest.json` arms `cargo:clippy-workspace`.
- `tools/proof_lane_select.test.mjs` protects the lane command, toolchain path,
  and per-crate coverage from manifest drift.
- Exact `#[expect(...)]` annotations are an explicit refactor queue. Broad
  module- or workspace-level lint allowances are not permitted.

## Responsibility inventory

The line counts below are a 2026-08-05 orientation snapshot, not a target.

| Surface | Current concentration | Superior ownership boundary | Dependency direction | Next extraction |
|---|---|---|---|---|
| `crates/domain/src/pack.rs` façade; `pack/model.rs` (~1.9k); `pack/validation.rs` (~8.5k) | Closed first-level boundary: serialized schema/defaults are separate from loading, derived indexes, diagnostics, and ordering | `pack/model` owns declarative types; `pack/validation` owns `PackValidationContext` and validation behavior; `validation_tests` owns private contract tests | validation → model; resolver/commands → public pack façade | Split validation families only when their next independent change requires it; do not re-complect model ownership |
| `crates/domain/src/resolver.rs` (~9.2k); `resolver/action.rs` (~1.0k); `resolver/trigger.rs` (~0.4k); `resolver/outcome.rs` (~1.4k) | Kill/protection, trigger-fixpoint, duel, and day-vote/outcome ownership are closed behind typed boundaries; action collection/ordering and result construction remain concentrated | Resolver coordinator plus bounded action, trigger, and outcome families | outcome → action/trigger/domain state/validated pack; trigger → action resolution/domain state/validated pack; coordinator → bounded families | Split remaining action collection or result construction only when its next independent change requires it; continue the maintainable-core frontier at remaining API route families |
| `crates/api/src/lib.rs` (~1.0k); `game_http.rs` (~2.6k); `community_http.rs` (~1.4k); `auth_http.rs` (~3.9k); `authentication.rs` (~0.7k); `live_projection.rs` (~0.2k); `live_delivery.rs` (~0.9k) | Auth, community, game-read HTTP, live delivery transport, attempt/delivery orchestration, and live publication are closed behind typed boundaries; router composition and command adaptation/import remain concentrated | Thin composition root plus route-family modules with typed request contexts | route families → application/domain ports; composition root → route families; authentication → identity-delivery ports; live transport → game-read adapters/live-publication port | Split remaining command/import transport only when its next independent change requires it |
| `crates/projections/src/lib.rs` (~8.2k); `effect_projection.rs` (~0.3k); `private_channel_projection.rs` (~0.3k) | Effect and encrypted private-channel folding, reads, mutations, and rebuild hooks are closed behind typed family boundaries; dispatcher plus unrelated game, community, identity, media-reference, and scheduler projections remain concentrated | Projection dispatcher plus one module per projection family and shared SQL/encryption primitives | family projectors → shared transaction/encryption primitives; dispatcher → families | Split the next family only when it has an independent change; continue the active frontier at API community transport |
| `crates/commands/src/day_runtime.rs` | DayEvent write/runtime (schedule, participate, resolve, sealed automation, narrative publish); see [17](17-day-runtime-ownership.md) | Sole emitter of `DayEvent*` and sole write-path caller of `game_platform` day_schedule / auto_resolution / narrative | day_runtime → shared command helpers + pure game_platform; day_scheduler → day_runtime only | Keep phase lifecycle in lib; further split only if program attach or narrative needs an independent change |
| `crates/commands/tests/pipeline.rs` (~77.1k) | Cross-domain command scenarios, fixtures, helpers, and operator proof cases | Shared hermetic harness plus scenario-family integration modules | scenario modules → harness/public command API; never scenario ↔ scenario | Split by command family while preserving serial Postgres proof semantics |
| `tools/dev_test_game.mjs` / `.test.mjs` (~27.5k/~30.0k) | CLI parsing, environment setup, orchestration, browser roles, evidence assembly, and contract tests | Small CLI/composition root over scenario, runtime, artifact, and assertion libraries | CLI → orchestration → scenario/runtime ports; artifacts depend only on normalized results | Extract proof-runner configuration and artifact assembly before further scenario growth |

## First closed boundary: API media HTTP

`crates/api/src/media_http.rs` now owns upload and projected-reference media
routes, admission, content inspection, quota reservation/release, immutable
asset response headers, and the public upload response types. The API
composition root merges that route family and re-exports the response types;
command-side media-reference normalization remains with command preparation.

This is an ownership improvement rather than a file move: HTTP media concerns
no longer share a module with authentication, community, game command, and
live-publication orchestration.

## Closed API boundary: authentication attempt and delivery orchestration

`crates/api/src/authentication.rs` owns credential-attempt scope persistence,
rate-limit auditing, and delivery-intent creation, cancellation, and audit rows.
`AuthAttemptAudit`, `AuthCredentialDeliveryRequest`, and `AuthDeliveryAudit`
collapse the former high-arity helpers without changing SQL, JSON audit keys,
status codes, or transaction boundaries. `identity_delivery.rs` remains the
provider-neutral worker/adapter boundary; `auth_http.rs` consumes both through
its typed HTTP state.

## Closed API boundary: auth, account, and session HTTP

`crates/api/src/auth_http.rs` owns the auth router fragment, request/response
DTOs, account registration/login/recovery and method lifecycle, session
issue/rotate/logout/revoke behavior, invites, credential-delivery retry, and
HTTP-focused authentication helpers. `AuthHttpState` is the bounded dependency
set for those handlers: pool, attempt policy, delivery gateway, password
admission, verifier, session policy, and ticket issuance configuration.

The API composition root owns one `AuthHttpState`, mounts the route family as a
unit, and delegates its public test/configuration builders. WebSocket ticket
creation and connection-session orchestration live in `live_delivery.rs`; they
consume only the narrow authentication helpers and typed auth state. The
boundary contract prevents auth handlers and DTOs from returning to the root,
persistence from leaving `authentication.rs`, provider execution from leaving
`identity_delivery.rs`, or WebSocket sessions from drifting into the HTTP
family. Public URLs, JSON, status codes, transaction and audit behavior, rate
limits, bearer semantics, and session revocation remain unchanged.

## Closed API boundary: live projection publication

`crates/api/src/live_projection.rs` owns the bounded broadcast publisher,
vote-count snapshot loading, changed/cleared delta construction, dirty-surface
publication record, subscription, and receiver lag/closure translation.
`LiveProjectionChangeSet` is the typed command-to-publication handoff and
`LiveProjectionPublisher` is the sole channel owner. The composition root keeps
command authorization and adaptation; live delivery owns WebSocket
authentication, durable cross-instance polling, and audience-specific thread,
host, prompt, and private hydration.

The boundary preserves subscribe-before-hydrate ordering, current-delta-before-
clear ordering, empty-clean suppression, channel bounds, lag-triggered resync,
delivery delay, and scoped private refreshes. Unit tests cover publication
assembly and lag continuation; the source boundary contract prevents those
responsibilities or their removed high-arity lint expectation from drifting
back into `lib.rs`.

## Closed API boundary: live WebSocket delivery

`crates/api/src/live_delivery.rs` owns ticket request/response handling, ticket
persistence and redemption, connection and per-principal admission,
authenticated session rechecks, subscribe-before-hydrate startup, durable
cross-instance event wake (`EventWake` / `PollEventWake`), lag/resync handling,
audience-scoped snapshot assembly, binary-CBOR frame emission, and the `/ws`
plus `/auth/websocket-tickets` routes behind `LiveDeliveryState`. It consumes
only narrow auth helpers, game-read adapters, and
`LiveProjectionPublisher`/`Receive` contracts.

The composition root mounts the delivery family as one router fragment and
re-exports `WebsocketTicketResponse`. Command submission/preparation,
completed-game import, auth persistence, game/community/media HTTP, and live
change classification/publication remain outside. Ticket TTL/audience/single-use
/session binding, capacity limits, initial ordering, private filtering, lag
continuation, event-sequence polling, envelope IDs, protocol version, and
disconnect behavior remain unchanged.

## Closed API boundary: public community HTTP

`crates/api/src/community_http.rs` owns the public search, personalized inbox,
subscriptions, member mutes, discussion, moderation, and profile route family.
Its request/query DTOs, cursor and target decoders, community admission,
capability checks, response adaptation, validation, and projection-error
mapping live behind `CommunityHttpState`, whose dependency set is only the
Postgres pool and the configured authentication boundary.

The composition root mounts the route family as one fragment. It retains game
transport, commands, live delivery, auth/account/session persistence, media,
and admin game bootstrap. The public game thread consumes one narrow
optional-community-viewer helper so personalized post filtering has a single
bearer/admission rule without pulling the game route into the community owner.
The source contract prevents community handlers and DTOs from returning to the
root, direct SQL persistence from entering the HTTP module, or unrelated
transport from drifting across the boundary. URLs, methods, JSON shapes,
cursor encodings, status codes, moderation limits, visibility rules,
transactions, timestamps, and personalized filtering remain unchanged.

## Closed API boundary: game reads

`crates/api/src/game_http.rs` owns public and operator game discovery, public
threads, vote and endgame reads, completed exports, channel threads, player
notifications/investigations/command state, and host phase, prompt, console,
and setup reads. `GameHttpState` carries only the configured authentication
boundary and pool. Request/query DTOs, public response types, cursor parsing,
capability admission, pack/program adaptation, host task selection, and
projection-to-wire response assembly stay with that owner.

The composition root mounts the read family as one router fragment and
re-exports the established public Rust response API. Command submission and
preparation, completed-game import writes, WebSocket connection/resync
orchestration (`live_delivery.rs`), and live publication remain outside.
WebSocket hydration and private media authorization consume explicit pool-based
adapters for vote counts, thread access/data, host console authority/state, and
player-private reads; neither consumer receives `GameHttpState` or duplicates
the REST rules.
The source boundary contract protects those dependency directions. URLs,
methods, JSON and wire shapes, ordering, cursor semantics, visibility rules,
capability decisions, export contents, and audience filters remain unchanged.

## Closed projection boundaries: effects and private channels

`crates/projections/src/effect_projection.rs` owns persistent role and engine
effect folding, effect clearing, player-facing effect notifications, the typed
effect input and public row, deterministic reads, SQL upsert/delete semantics,
and its rebuild/audit table declaration. Top-level effect events and
resolution-wrapped inner events enter the same family projector, preserving
their distinct event-index rules and the existing projection order.

`crates/projections/src/private_channel_projection.rs` owns declared, granted,
member-revoked, and channel-revoked membership folding; payload decoding; the
typed encrypted row/input records; sealed SQL writes; deterministic decrypted
reads; and encrypted snapshot identity/redaction hooks. It consumes the shared
slot, encryption, transaction, and audit primitives without exposing private
fields to the composition root.

The root remains the sole event dispatcher and rebuild/snapshot orchestrator,
and re-exports both public reader contracts. The family boundary contract
prevents row types, mutation helpers, decoders, readers, or audit metadata from
drifting back into `lib.rs`, and forbids wildcard imports or local lint
suppression. Event order, visibility, conflict behavior, ciphertext context,
rebuild hashes, and public projection APIs remain unchanged.

## Closed domain boundary: pack model and validation

`crates/domain/src/pack.rs` is now the public façade over two inward-facing
owners. `pack/model.rs` contains the serialized schema and defaults;
`pack/validation.rs` contains decoding, diagnostics, derived ordering, and a
single `PackValidationContext` that computes cross-reference indexes once per
validation pass. Action, target-lynch, and vote-policy validators consume that
context instead of independent high-arity parameter lists.

The private IR-version mapping tests live in the test-only
`pack/validation_tests.rs` sibling. No pack-specific Clippy expectation remains.
Public pack exports, JSON fields/defaults, validation diagnostics, and golden
semantics remain unchanged.

## Closed resolver boundary: trigger fixpoint

`crates/domain/src/resolver/trigger.rs` is the single owner of trigger
observation matching, ordered night-frontier collection, generated trigger
events and kill decisions, fixpoint iteration, loop-cap diagnostics, and win-
trigger reconciliation. `TriggerResolutionContext` carries the immutable pack
and state inputs plus the event, kill, CPR, decision, and note sinks. Its
optional `TriggerCascadeContext` makes the night-only guard/hide dependency
cascade explicit between rounds rather than maintaining a second trigger loop.
`ProducedKillCollection` preserves the coordinator contract explicitly: generic
day/duel/win callers receive generated kill records, while the night pipeline
uses them only as the next fixpoint frontier and avoids needless minimizer work.

The outcome family owns day-vote observation production and supplies typed
`TriggerObservation` values to the trigger family; the coordinator supplies
night and broader phase observations. Generated kills enter the action family
described below. The resolver boundary contract prevents the fixpoint
implementation from returning to the coordinator. Event order, trace payloads,
loop-cap behavior, seeded determinism, and generated goldens remain unchanged.

## Closed resolver boundary: kill and protection resolution

`crates/domain/src/resolver/action.rs` is the single owner of kill resolution,
protection interception and retaliation, CPR and dependency deaths, stacked
attacker attribution, death-reveal selection, and target-state interference
events and trace decisions. `ActionResolutionContext` and `KillAction` separate
resolution state from one kill request. `ProtectionResolutionContext` expresses
the guard/witch policy sinks, while `CounterUseInput` replaces the former
positional counter-event builder.

The action family also owns the `ProtectionSource`, `KillRecord`, guard/hide
dependency, and interference records shared with the coordinator and trigger
fixpoint. The coordinator still owns action collection, precedence, redirect,
and broad phase orchestration, but it cannot implement kill resolution, stacked
attribution, or protection-policy event construction. The boundary contract
enforces that ownership and forbids local lint suppression. The superseded
event-builder and guard/witch high-arity allowances are removed without changes
to event order, trace payloads, seeded determinism, or generated goldens.

## Closed resolver boundary: day vote and outcomes

`crates/domain/src/resolver/outcome.rs` is the single owner of weighted ballot
collection, hammer and threshold evaluation, deterministic tie resolution,
ordinary and vote-duel outcomes, veto and prompt events, lynch effects, and the
post-lynch trigger and win handoff. `DayVoteResolutionContext` carries the
pre-vote badges and mutable event/trace sinks produced by the coordinator.
`OutcomeDecisionInput` replaces the positional decision signature and makes the
complete threshold, contender, tiebreak, and seeded-random inputs explicit.

Both ordinary duel resolution and vote-duel declaration live with the outcome
family so their kill, trigger, event, and trace construction cannot drift back
into the coordinator. The resolver boundary contract enforces the ownership and
forbids local lint suppression. Announcement order, prompt order, seeded tie
selection, win-trigger handoff, and generated golden semantics remain unchanged.

## Exact lint-debt register

The strict baseline intentionally records, rather than hides, remaining
boundary pressure:

- resolver action, trigger, and outcome boundaries are typed and carry no local
  lint expectations; remaining coordinator concentration is tracked as an
  ownership frontier rather than hidden lint debt;
- command submission, action validation, prompt reconstruction, and operator
  proof audit functions await bounded request contexts;
- auth, community, game-read HTTP, live delivery, authentication
  attempt/delivery, and live-publication ownership are typed and carry no local
  lint expectations; remaining command/import transport await a bounded context;
- effect and private-channel projection ownership is typed and carries no local
  lint expectations; unrelated projection families remain deliberately
  separate rather than hidden behind a generic SQL projector;
- direct wire enum payload ownership remains until transport allocation is
  benchmark-driven or the adapter boundary is reshaped;

Each extraction must remove the expectations it supersedes. Adding an exact
expectation requires a reason that names the missing boundary and an update to
this inventory when it creates a new debt category.

## Proof product freeze

Local proof orchestration under `tools/dev_test_game*` and
`target/dev-test-game/*-admin-proof.json` is a developer harness, not a product
completion surface. The freeze ban list (no new local-only admin UI, no
re-export-only `*-admin-proof` npm scripts, no further `dev_test_game.mjs`
growth without artifact-assembly extraction, no treating local admin-proof JSON
as product done) lives in
[proof-product-freeze](../ops/proof-product-freeze.md). Hosted packet
validators, proof lanes, and local diagnostics remain allowed.

## Completion boundary

`foundation.maintainable-core` remains open until every concentration above is
addressable through coherent modules, the exact lint-debt register is cleared
or justified by measured design constraints, and the existing narrow, sprint,
and full proof contracts remain intact. Lower line counts alone do not satisfy
the capability.
