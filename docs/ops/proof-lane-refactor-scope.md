# Proof Lane Architecture Refactor

Status: active; leaf execution and fast truthful selection delivered 2026-07-26.

## Delivered foundation

The manifest now contains executable leaves only. The human-facing
`test:local-postgres-ci` and `test:frontend-role-proof:quick` aliases remain in
`package.json`, but their baseline/commands/projections and frontend constituent
lanes are represented directly in the manifest. Selection deduplicates by a
canonical execution key after cost ordering, and the manifest contract rejects
an npm leaf that invokes another declared leaf.

The remaining work packages below are still intentionally open: structured
receipts and resume, run-scoped Postgres and artifacts, semantic command suite
splitting, and resource-aware scheduling.

The motivating push sweep executed the commands integration suite twice
(847.7s through `test:local-postgres-ci`, then 789.4s through
`cargo:commands`). The leaf plan now selects `cargo:commands` exactly once and
orders its latest measured ~14.8-minute cost after the cheaper local lanes.

The selector now compares against `origin/main`, so another worktree's stale
local `main` ref cannot manufacture a large historical diff. Push mode is the
touched closure plus two measured sentinels with a 60-second budget. The former
all-active behavior is explicit sprint mode; full mode still runs every leaf.
Every `--run` records timing observations under ignored
`target/proof-lanes/timings.json`, while `--record` remains the deliberate path
for updating the tracked baseline.

## Problem

The proof selector now has a sound path-to-leaf model and a fast ordinary push
path, but the executable suites and resource model still contain the dominant
latency:

- `cargo:commands` combines 365 tests in a 77,063-line `pipeline.rs`; 360 cases
  provision SQLx test databases. A clean serial run took about thirteen minutes
  on the current development machine and still dominates any truthful change
  that reaches the command boundary.
- Database-dependent npm lanes rely on ambient `DATABASE_URL`; concurrent runs
  can share the mutable `fmarch` database and contaminate one another.
- The tracked baseline does not yet cover every lane. Execution has no timeout,
  checkpoint, resume token, structured receipt, or resource scheduler.

The desired shape is a manifest-owned DAG of independently executable leaf
lanes. Aggregates remain useful user-facing aliases, but they must not appear as
leaves beside the work they contain.

## Target Model

Move the manifest to version 2. Each lane declares:

- an argv-based command and explicit environment additions;
- execution class: `hermetic`, `postgres`, `browser`, or `hosted`;
- dependencies on other lanes, if any;
- a timeout and expected cost band;
- whether it runs in `inner`, `push`, `sprint`, `full`, or only when directly armed;
- resource requirements and an isolation strategy;
- the artifact or receipt it produces.

The runner expands dependencies once, deduplicates by lane ID, provisions each
resource once per run, schedules only resource-compatible work concurrently,
and writes one receipt containing the commit, selected areas, commands,
durations, exit statuses, and artifact paths. A failed receipt can be resumed
only for the same commit and manifest digest.

## Work Packages

### 1. Make execution observable and resumable — timing observations delivered

- Every executed lane records its duration, command, status, and timestamp under
  ignored `target/proof-lanes/`; `--record` deliberately promotes a stable
  measurement into the tracked baseline.
- Add per-lane timeout enforcement, compact live progress, and a final table.
- Persist ignored receipts under `target/proof-lanes/` and support
  `--resume <receipt>` plus `--only <lane>` for exact failure reproduction.
- Include the git SHA, dirty-state digest, manifest digest, and database identity
  in each receipt so stale success cannot be reused.

### 2. Remove aggregate duplication — delivered 2026-07-26

- Keep `test:frontend-role-proof:quick` and `test:local-postgres-ci` as optional
  human-facing aliases, but remove them from `manifest.lanes`.
- Represent their constituent leaf lanes directly.
- Add a contract that rejects a lane command containing another declared lane
  unless the relationship is expressed as `depends_on`; dependency expansion
  must execute each leaf once.

### 3. Make selection worktree-safe and mode costs explicit — delivered 2026-07-26

- Use `origin/main` as the default base while retaining `--base` as an explicit
  override.
- Keep ordinary push proof to the touched closure plus a measured sentinel set.
- Preserve the former active-frontier sweep as explicit sprint mode.
- Contract-test the stale-local-main regression and the sentinel cost budget.

### 4. Split command proof by semantic cost

Replace `crates/commands/tests/pipeline.rs` with focused integration binaries:

- transaction and command/projection correctness;
- host, audit, rebuild, and authorization behavior;
- checked-in generated-fixture replay;
- generated search and minimizer reduction;
- small hermetic generator/minimizer contracts.

The ordinary command integration lane belongs in push closure. Exhaustive
generated search/reduction belongs in full mode and is directly re-armed by
changes to generators, minimizer code, or their fixtures. Shared test support
moves to a private `tests/support/` module rather than another catch-all binary.

### 5. Own Postgres as a run resource

- Start or reuse the repo-local server once through `tools/dev_postgres.mjs`.
- Create a run-scoped database, then create a lane-scoped database for every
  mutating lane. Never point two lanes at the same database.
- Pass `DATABASE_URL` explicitly and remove databases after success; retain and
  name a failed database in the receipt for diagnosis.
- Permit Postgres lanes to run concurrently only after lane-scoped isolation is
  proven. Until then, serialize them with an explicit resource lock.

### 6. Schedule by dependency and resource

- Run hermetic Rust and Node lanes concurrently within a conservative worker
  limit.
- Serialize browser lanes that share screenshot/artifact directories until
  those directories are also run-scoped.
- Keep hosted evidence and production promotion outside local proof; local full
  proof may validate their contracts but must not perform hosted mutations.

## Acceptance Criteria

- Full selection contains only leaf work and executes no test body twice.
- A stale worktree-local `main` ref cannot expand a clean `origin/main` checkout.
- The push sentinel set has complete tracked timings and stays within its
  declared 60-second budget.
- A clean machine can run `npm run proof:lanes -- --mode full --run` without
  manually exporting `DATABASE_URL`.
- Two simultaneous proof runs cannot share a writable database or artifact
  directory.
- Killing and resuming a run never reuses success from a different commit,
  manifest, or dirty-state digest.
- A lane failure prints one exact rerun command and preserves its diagnostic
  artifacts.
- Manifest contracts cover dependency cycles, duplicate nested work, missing
  timeouts/resources, invalid mode placement, and receipt freshness.
- The fast push path excludes exhaustive minimizer search unless its owned
  inputs changed; full mode still includes it.
- After one measured full sweep, all lane timings are populated and the full
  wall-clock target is documented from evidence rather than guessed.

## Recommended Implementation Order

1. Split the command pipeline and assign fast versus exhaustive modes.
2. Introduce manifest-v2 dependencies/resources, timeouts, structured receipts,
   `--only`, and commit-safe `--resume`.
3. Add run-scoped Postgres and artifact directories, keeping execution serial.
4. Enable bounded parallel scheduling only after isolation contracts pass.
5. Measure a full sweep, update cost bands, and then simplify the compatibility
   npm aliases that are no longer operationally useful.

## Non-Goals

This refactor does not move proof authority to GitHub, introduce a pre-production
development branch, or weaken full-mode coverage. `main` remains the development
trunk; the `production` branch remains only an explicit release pointer.
