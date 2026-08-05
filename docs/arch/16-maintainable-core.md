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

The line counts below are a 2026-08-04 orientation snapshot, not a target.

| Surface | Current concentration | Superior ownership boundary | Dependency direction | Next extraction |
|---|---|---|---|---|
| `crates/domain/src/pack.rs` (~10.8k) | Pack schema, defaults, cross-reference validation, action-policy validation, ordering, and in-file tests | `pack/model` owns declarative types; `pack/validation` owns validation contexts and diagnostics; integration tests own contract fixtures | validation → model; resolver/commands → validated pack | First: introduce `PackValidationContext`, separate model from validation, and move in-file tests out of the production module |
| `crates/domain/src/resolver.rs` (~12.0k) | Action collection, ordering, interference, trigger fixpoint, outcomes, day vote, and result construction | Resolver coordinator plus bounded action, trigger, outcome, and day-vote families | family modules → domain state/validated pack; coordinator → families | Follow pack extraction so resolver contexts consume a stable validated model |
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

## Exact lint-debt register

The strict baseline intentionally records, rather than hides, remaining
boundary pressure:

- pack validation and resolver high-arity functions await typed validation and
  resolution contexts;
- command submission, action validation, prompt reconstruction, and operator
  proof audit functions await bounded request contexts;
- authentication delivery/audit and live publication functions await route-
  family extraction and typed records;
- direct wire enum payload ownership remains until transport allocation is
  benchmark-driven or the adapter boundary is reshaped;
- the pack module's in-file test placement remains only until the next pack
  extraction.

Each extraction must remove the expectations it supersedes. Adding an exact
expectation requires a reason that names the missing boundary and an update to
this inventory when it creates a new debt category.

## Completion boundary

`foundation.maintainable-core` remains open until every concentration above is
addressable through coherent modules, the exact lint-debt register is cleared
or justified by measured design constraints, and the existing narrow, sprint,
and full proof contracts remain intact. Lower line counts alone do not satisfy
the capability.
