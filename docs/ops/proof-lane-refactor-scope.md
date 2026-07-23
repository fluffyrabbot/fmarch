# Proof Lane Architecture Refactor

Status: proposed followup after the staged-release landing.

## Problem

The proof selector has a sound path-to-lane model, but the executable lane set
is not yet a clean execution graph:

- `cargo:commands` combines 347 tests in a 74,625-line `pipeline.rs`; 55 tests
  are generated/minimizer cases and 223 are integration-named cases. A clean
  serial run took about fourteen minutes on the current development machine.
- `test:local-postgres-ci` invokes the projection baseline and the command and
  projection crate suites already represented by leaf lanes. Full mode
  therefore repeats its most expensive work.
- `test:frontend-role-proof:quick` nests `test:frontend-contract` and
  `test:frontend-static-role-contract`, which are also selected independently.
- Database-dependent npm lanes rely on ambient `DATABASE_URL`; concurrent runs
  can share the mutable `fmarch` database and contaminate one another.
- Only six of 27 lanes have recorded costs. Execution has no timeout, checkpoint,
  resume token, structured receipt, or resource scheduler.

The desired shape is a manifest-owned DAG of independently executable leaf
lanes. Aggregates remain useful user-facing aliases, but they must not appear as
leaves beside the work they contain.

## Target Model

Move the manifest to version 2. Each lane declares:

- an argv-based command and explicit environment additions;
- execution class: `hermetic`, `postgres`, `browser`, or `hosted`;
- dependencies on other lanes, if any;
- a timeout and expected cost band;
- whether it runs in `inner`, `push`, `full`, or only when directly armed;
- resource requirements and an isolation strategy;
- the artifact or receipt it produces.

The runner expands dependencies once, deduplicates by lane ID, provisions each
resource once per run, schedules only resource-compatible work concurrently,
and writes one receipt containing the commit, selected areas, commands,
durations, exit statuses, and artifact paths. A failed receipt can be resumed
only for the same commit and manifest digest.

## Work Packages

### 1. Make execution observable and resumable

- Record duration for every executed lane automatically; keep `--record` only
  for deliberate remeasurement.
- Add per-lane timeout enforcement, compact live progress, and a final table.
- Persist ignored receipts under `target/proof-lanes/` and support
  `--resume <receipt>` plus `--only <lane>` for exact failure reproduction.
- Include the git SHA, dirty-state digest, manifest digest, and database identity
  in each receipt so stale success cannot be reused.

### 2. Remove aggregate duplication

- Keep `test:frontend-role-proof:quick` and `test:local-postgres-ci` as optional
  human-facing aliases, but remove them from `manifest.lanes`.
- Represent their constituent leaf lanes directly.
- Add a contract that rejects a lane command containing another declared lane
  unless the relationship is expressed as `depends_on`; dependency expansion
  must execute each leaf once.

### 3. Split command proof by semantic cost

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

### 4. Own Postgres as a run resource

- Start or reuse the repo-local server once through `tools/dev_postgres.mjs`.
- Create a run-scoped database, then create a lane-scoped database for every
  mutating lane. Never point two lanes at the same database.
- Pass `DATABASE_URL` explicitly and remove databases after success; retain and
  name a failed database in the receipt for diagnosis.
- Permit Postgres lanes to run concurrently only after lane-scoped isolation is
  proven. Until then, serialize them with an explicit resource lock.

### 5. Schedule by dependency and resource

- Run hermetic Rust and Node lanes concurrently within a conservative worker
  limit.
- Serialize browser lanes that share screenshot/artifact directories until
  those directories are also run-scoped.
- Keep hosted evidence and production promotion outside local proof; local full
  proof may validate their contracts but must not perform hosted mutations.

## Acceptance Criteria

- Full selection contains only leaf work and executes no test body twice.
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

1. Add receipts, automatic timings, `--only`, and commit-safe `--resume` without
   changing lane membership.
2. Introduce manifest-v2 dependencies/resources and reject nested aggregate
   work.
3. Add run-scoped Postgres and artifact directories, keeping execution serial.
4. Split the command pipeline and assign fast versus exhaustive modes.
5. Enable bounded parallel scheduling only after isolation contracts pass.
6. Measure a full sweep, update cost bands, and then simplify the compatibility
   npm aliases that are no longer operationally useful.

## Non-Goals

This refactor does not move proof authority to GitHub, introduce a pre-production
development branch, or weaken full-mode coverage. `main` remains the development
trunk; the `production` branch remains only an explicit release pointer.
