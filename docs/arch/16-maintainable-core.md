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
| `crates/domain/src/resolver.rs` (~11.6k); `resolver/trigger.rs` (~0.4k) | Trigger observation and fixpoint ownership are closed behind a typed boundary; action collection, ordering, interference, outcomes, day vote, and result construction remain concentrated | Resolver coordinator plus bounded action, trigger, outcome, and day-vote families | trigger → coordinator-owned action resolution/domain state/validated pack; coordinator → trigger and remaining families | Extract the kill-action family around the established `ActionResolutionContext` without reopening trigger ownership |
| `crates/api/src/lib.rs` (~10.4k) | Router composition, auth/session flows, community reads/writes, game transport, live publication, and command adaptation | Thin composition root plus route-family modules with typed request contexts | route families → application/domain ports; composition root → route families | Continue with authentication delivery/rate-limit ownership after the media route family |
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

The coordinator retains day-vote observation production and supplies typed
`TriggerObservation` values to the family. Generated kills enter the existing
`ActionResolutionContext`/`KillAction` pair, which also replaced the former
high-arity kill helper. Target-state interference now consumes a typed action
record. No trigger or superseded action-specific lint expectation remains, and
the resolver boundary contract prevents the fixpoint implementation from
returning to the coordinator. Event order, trace payloads, loop-cap behavior,
seeded determinism, and generated goldens remain unchanged.

## Exact lint-debt register

The strict baseline intentionally records, rather than hides, remaining
boundary pressure:

- resolver remaining action, event-builder, guard/witch, and vote paths await
  typed resolution contexts; trigger fixpoint ownership is closed;
- command submission, action validation, prompt reconstruction, and operator
  proof audit functions await bounded request contexts;
- authentication delivery/audit and live publication functions await route-
  family extraction and typed records;
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
