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
| `crates/api/src/lib.rs` (~9.7k); `authentication.rs` (~0.7k) | Auth attempt rate-limit persistence/auditing and credential-delivery intent create/cancel/audit extracted behind typed records; router composition, auth/session HTTP handlers, community reads/writes, game transport, live publication, and command adaptation remain concentrated | Thin composition root plus route-family modules with typed request contexts | route families → application/domain ports; composition root → route families; authentication → ApiState/identity_delivery ports | Continue with remaining auth/session route handlers, community, game transport, and live-publication ownership |
| `crates/projections/src/lib.rs` (~9.1k) | Event dispatch and unrelated game, community, identity, media-reference, scheduler, and private-channel projections | Projection dispatcher plus one module per projection family and shared SQL primitives | family projectors → shared transaction primitives; dispatcher → families | Extract effect/private-channel projectors using the typed records established by the Clippy cleanup |
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
provider-neutral worker/adapter boundary; HTTP handlers, DTOs, session auth,
and `ApiState` builders stay in the composition root.

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
- authentication attempt/delivery ownership is typed and carries no local lint
  expectations; remaining auth/session HTTP handlers and live publication
  functions await route-family extraction and typed records;
- direct wire enum payload ownership remains until transport allocation is
  benchmark-driven or the adapter boundary is reshaped;

Each extraction must remove the expectations it supersedes. Adding an exact
expectation requires a reason that names the missing boundary and an update to
this inventory when it creates a new debt category.

## Completion boundary

`foundation.maintainable-core` remains open until every concentration above is
addressable through coherent modules, the exact lint-debt register is cleared
or justified by measured design constraints, and the existing narrow, sprint,
and full proof contracts remain intact. Lower line counts alone do not satisfy
the capability.
