# Proof Lane Architecture Refactor

Status: active; leaf execution and fast truthful selection delivered 2026-07-26;
command proof cost boundaries delivered 2026-08-06.

## Delivered foundation

The manifest now contains executable leaves only. The human-facing
`test:local-postgres-ci` and `test:frontend-role-proof:quick` aliases remain in
`package.json`, but their baseline/commands/projections and frontend constituent
lanes are represented directly in the manifest. Selection deduplicates by a
canonical execution key after cost ordering, and the manifest contract rejects
an npm leaf that invokes another declared leaf.

The remaining work packages below are still intentionally open: structured
receipts and resume, run-scoped Postgres and artifacts, physical command-test
family extraction, and resource-aware scheduling.

The original command lane accumulated 365 tests and later measured 1,059s on a
warm checkout. It is now four truthful leaves: hermetic unit/boundary tests,
parallel ordinary Postgres integration, serial cancellation/concurrency proof,
and an explicit semantic/generated audit. The ordinary Postgres lane retains
126 transaction, authorization, persistence, projection, and representative
resolution boundaries and measured 85.02s with four isolated SQLx workers.

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

- `crates/commands/tests/pipeline.rs` remains a large residual source module even
  though its execution costs now have separate ownership. Physical family
  extraction is still needed for reviewability and path-precise audit arming.
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

### 4. Split command proof by semantic cost — first boundary delivered 2026-08-06

- `cargo:commands-unit` owns hermetic command and boundary tests.
- `cargo:commands-pg` owns 126 ordinary Postgres transaction, authorization,
  persistence, projection, and representative resolution cases and runs with
  four test workers. It completes in 85.02 seconds, down from the former
  1,059.3-second aggregate command lane.
- `cargo:commands-concurrency` owns the serial cancellation matrix.
- `cargo:commands-audit` owns 217 ignored-but-compiled semantic and generated
  cases, including the 29-family generated matrix, and remains in full mode.
  Its four-worker run completes in 638.58 seconds; the lane declares the 8 MiB
  test-thread stack required by the deepest EpicMafia replay rather than
  depending on host defaults.
- `operator_proof::minimizer` is an in-process library; generated tests reuse
  their SQLx pool instead of spawning Cargo and reconnecting to Postgres.
- The 55 derived minimized/nonminimal/bad-expectation fixtures were deleted;
  generated audit evidence is disposable under `target/operator-proof`, while
  `night-passing.json` remains the single CLI fixture.

The next physical extraction should move the semantic audit and its generator
support into a dedicated integration module so changes can arm it by path
without mapping the residual pipeline file as a whole.

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

1. Extract the semantic audit into a dedicated integration module without
   changing the delivered lane split.
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
