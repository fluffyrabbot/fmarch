# Proof Lane Architecture Refactor

Status: active; leaf execution and fast truthful selection delivered 2026-07-26;
command proof cost boundaries and bounded generated-shrink execution delivered
2026-08-06; physical command-target extraction and exact selector ownership
delivered 2026-08-08; manifest-v5 resource scheduling, run receipts, disposable
local proof databases, and the role-smoke/visual artifact handoff delivered
2026-08-20; runner-scoped mutable npm proof leaves delivered 2026-08-23.

## Delivered foundation

The manifest now contains executable leaves only. The human-facing
`test:local-postgres-ci` and `test:frontend-role-proof:quick` aliases remain in
`package.json`, but their baseline/commands/projections and frontend constituent
lanes are represented directly in the manifest. Selection deduplicates by a
canonical execution key after cost ordering, and the manifest contract rejects
an npm leaf that invokes another declared leaf.

The remaining work packages below are intentionally narrowed: resume, migration
or retirement of direct legacy callers outside the manifest, and measured
expansion beyond the initial conservative resource capacities.

### Mash-scale timing observation — 2026-08-23

A serial push receipt recorded `test:mash-scale-acceptance` failing its
scheduler ceiling (9.7s against 5s) while the reported Darwin host observation
was a load average near 21 with `mediaanalysisd` using roughly 328% CPU.
Isolated reruns, both with and without the Batch A resolver diff, passed; the
later serial 44-lane Batch B sweep also passed the scheduler in 928ms. Treat
this as host-contention evidence, not a resolver regression or a reason to
relax the product ceiling. Preserve the receipt and host-load evidence if it
recurs. The planned migration is now complete: the 2026-08-23 five-lane
`--jobs 2` receipt exercised mash-scale with a runner-owned disposable database
and artifact root. That receipt proves isolation, not a throughput improvement
while `cargo-target` and `postgres-admin` remain capacity-one resources.

The original command lane accumulated 365 tests and later measured 1,059s on a
warm checkout. It is now four truthful leaves: hermetic unit/boundary tests,
parallel ordinary Postgres integration, serial cancellation/concurrency proof,
and an explicit semantic/generated audit. The ordinary Postgres lane retains
126 transaction, authorization, persistence, projection, and representative
resolution boundaries. Its extracted target discovers no semantic-audit cases;
the 2026-08-08 full-sweep receipt measured 131.1 seconds and the independent
baseline recorder measured 129.9 seconds with four isolated SQLx workers.

The selector now compares against `origin/main`, so another worktree's stale
local `main` ref cannot manufacture a large historical diff. Push mode is the
touched closure plus two measured sentinels with a 60-second budget. The former
all-active behavior is explicit sprint mode; full mode still runs every leaf.
Every `--run` records timing observations under ignored
`target/proof-lanes/timings.json`, while `--record` remains the deliberate path
for updating the tracked baseline. `--measure`/`--measure-all` rewrite that
baseline from isolated measurement: each lane is run once to warm it, then
timed, so an entry states what the lane costs on a warm checkout rather than
what it cost following whichever lane happened to precede it. Warm-up runs the
lane's own command rather than a build-only stand-in: `cargo test --no-run`
builds the test binaries but leaves the doctest target cold, which charged the
timed run a one-time rustdoc build and mismeasured `cargo test -p domain` at
229s against a true warm cost of 10.6s. Lanes whose work is proportional to the
diff declare `"measurement": "diff-sensitive"` and refuse repetition-measurement,
because a second run with no edit between measures an empty pass; workspace
Clippy is the one such lane and stays on `--record`.

Estimates prefer the tracked baseline and fall back to runtime observations only
for lanes it has never measured. Runtime numbers absorb the previous lane's
leftover compilation and so overstate by construction; letting them win would
re-bury every measurement the first time anyone ran `--run`. Observations from a
failed lane are never served as cost, and observations for lanes the manifest no
longer declares are pruned on load.

## Problem

The proof selector now has a sound path-to-leaf model, a fast ordinary push
path, physically separate ordinary and semantic-audit command targets, and
runner-owned mutable npm leaves. The remaining resource-model work is:

- Manifest-scheduled mutable npm leaves receive an injected disposable database
  and run-scoped artifact directory. Direct compatibility callers retain their
  self-managed scratch lifecycle only outside the canonical runner.
- The tracked baseline covers every lane, while checkpoint/resume support and
  evidence-backed expansion of conservative resource capacities remain open.

The desired shape is a manifest-owned DAG of independently executable leaf
lanes. Aggregates remain useful user-facing aliases, but they must not appear as
leaves beside the work they contain.

## Target Model

Move the manifest to version 5. Migrated lanes declare:

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

### 4. Split command proof by semantic cost — delivered 2026-08-08

- `cargo:commands-unit` owns hermetic command and boundary tests.
- `cargo:commands-pg` owns 126 ordinary Postgres transaction, authorization,
  persistence, projection, and representative resolution cases and runs with
  four test workers. The extracted target reports 126 passed and zero ignored;
  the 2026-08-08 full sweep measured 130.58 seconds of test execution with a
  131.1-second receipt, and the independent recorder measured 129.9 seconds.
- `cargo:commands-concurrency` owns the serial cancellation matrix.
- `cargo:commands-audit` owns a dedicated 217-case `semantic_audit` integration
  target, including the 29-family generated matrix, and remains in full mode.
  The 2026-08-08 full sweep measured 566.56 seconds of test execution with a
  567.0-second receipt, and the independent recorder measured 550.92 seconds
  with a 552.2-second receipt. Earlier pre-extraction runs on the 2026-08-06
  host measured 407.9 and 413.5 seconds, so the extraction makes no
  execution-speed claim: its gain is removing the audit corpus from ordinary
  target compilation and discovery and arming it only for owned inputs or full
  proof. The lane declares the 8 MiB test-thread stack required by the deepest
  EpicMafia replay rather than depending on host defaults.
- `operator_proof::minimizer` is an in-process library; generated tests reuse
  their SQLx pool instead of spawning Cargo and reconnecting to Postgres.
- The generated shrink matrix owns one SQLx-isolated database per test run and
  drains its 58-case manifest through eight named worker runtimes. Each worker
  owns one connection and an explicit 8 MiB stack; aggregate entries are sorted
  by family and seed before publication. Two unchanged measured runs completed
  in 153.91s and 165.53s on 2026-08-06; the same matrix took 208.97s on the
  slower 2026-08-08 host and produced the same SHA-256 digest
  (`8b571b10dd894ff6285454680b94b06e7baa5df1fff2aecc001121d00a52532d`).
- The 55 derived minimized/nonminimal/bad-expectation fixtures were deleted;
  generated audit evidence is disposable under `target/operator-proof`, while
  `night-passing.json` remains the single CLI fixture.
- The former 71k-line residual source is physically split into 109 ordinary
  residual cases, 217 direct audit cases, and one source-shared support module;
  the 17 DayEvent cases keep the ordinary lane at 126 cases. Selector contracts
  prove ordinary-case edits do not arm the audit, audit-case edits do, and
  shared-support edits honestly arm both targets.

### 5. Own Postgres as a run resource — delivered conservatively 2026-08-20

- The runner uses the declared local loopback proof endpoint, or initializes the
  repo-local server through `tools/dev_postgres.mjs` when that endpoint is
  absent. It never adopts an arbitrary ambient `DATABASE_URL`.
- Every migrated Cargo or scoped npm Postgres lane receives a generated
  `fmarch_proof_<run>_<lane>` database and an injected declared URL environment
  (`DATABASE_URL` or `DATABASE_MIGRATION_URL`); it is removed on success and
  named in the receipt if retained after failure.
- The local-endpoint guard applies to both `DATABASE_URL` and
  `FMARCH_DEV_POSTGRES_*` overrides. Provisioning is bounded by the lane
  deadline; a failed database cleanup is recorded as retained rather than
  silently treated as removed.
- Legacy `--record` and `--measure` intentionally refuse runner-owned
  Postgres leaves until their scoped warm-up protocol exists; they must not
  bypass disposal by inheriting an ambient connection URL.
- The shared Cargo target and `postgres-admin` capacities are both one. This
  proves isolation without prematurely claiming concurrent SQLx work is faster.

### 6. Schedule by dependency and resource — delivered conservatively 2026-08-20

- `--run` is serial by default; `--jobs N` is an opt-in scheduler bounded by
  manifest locks. It expands `depends_on`, stops admitting work after a failure,
  waits for already-started independent work, and writes a run receipt.
- Named locks are cross-run filesystem admissions, not merely in-process
  counters. A lane deadline covers resource provisioning as well as its child
  process; POSIX children run in their own process group, which is drained on
  timeout, interruption, or an orphaned wrapper exit before locks/DBs release.
- Role smoke and visual regression now use distinct run-scoped artifact roots;
  visual receives the exact producer path through a hard dependency. The TLS
  proof also puts its temporary cluster and evidence under its lane root.
- Auth-invite, day-event live-stack, mash-scale, exact-image, and the event-key
  rehearsal now declare typed runner resources and no `legacy` lock. Their
  direct compatibility aliases preserve self-managed scratch databases only
  outside runner context, where applicable. Hosted evidence and production
  promotion remain outside parallel local proof.

### 7. Keep canonical `--run` on the Darwin checkout

The remaining resource work is isolation and scheduling on this machine, not a
host swap. Mesh ratified fluffycachy as its remote verification default because
closure-heavy `cargo check` was pathologically slow on Darwin and because Linux
gtk/webkit is a required Mesh surface. fmarch's expensive leaves are serial
Postgres suites and Chromium. `scripts/check-build-posture.sh` keeps `target/`
as a symlink onto an external writable root: `FMARCH_EXTERNAL_BUILD_ROOT` if
set, otherwise `/Volumes/rabbitx10/build/fmarch` when that volume is writable,
otherwise fail closed. `--apply` creates the destination and symlink when
missing. The Darwin volume is the preferred location on this machine, not the
invariant.

Do not make fluffycachy the canonical fmarch proof host:

- Browser, visual-regression, CSP, tablet, live-stack, and auth-invite lanes
  are Darwin evidence. A green Linux result is not a substitute.
- Both machines are in the same RAM class (~24–27 GiB). fluffycachy already
  owns Mesh `mesh-verify` and Neoretro x86_64 evidence; parking the fmarch
  spine there creates cross-repo contention without fixing shared `DATABASE_URL`.
- The `~/apps/fmarch` tree on fluffycachy is not a proof environment (no
  `target/`, no `node_modules`, no Postgres on 5544).
- Tracked timings are host-dependent. The 2026-08-06 host measured
  `cargo:commands-audit` at ~408–414s; the recorded 2026-08-08/09 baseline is
  552.2s. Remote wall-clocks must not be `--record`ed into
  `docs/ops/proof-lane-timings.json`.

Optional later overflow, not authority: a dedicated `fmarch-verify` checkout
on fluffycachy may run isolated platform-neutral Cargo/Postgres leaves
(`cargo:commands-audit`, maybe `cargo:api` / `cargo:commands-pg`) after it sets
`FMARCH_EXTERNAL_BUILD_ROOT`, runs `bash scripts/check-build-posture.sh --apply`,
has repo-local Postgres, and shares no writable database with another run.
That is extra evidence beside Darwin push/sprint/full.

## Acceptance Criteria

- Full selection contains only leaf work and executes no test body twice.
- A stale worktree-local `main` ref cannot expand a clean `origin/main` checkout.
- The push sentinel set has complete tracked timings and stays within its
  declared 60-second budget.
- A clean machine can run `npm run proof:lanes -- --mode full --run` without
  manually exporting `DATABASE_URL`.
- Migrated lanes in two simultaneous proof runs cannot share a writable
  database or declared artifact directory.
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

1. Migrate or retire direct legacy callers, including the identity-spine and
   non-manifest live-stack aliases, to the same runner contract without
   reintroducing a global legacy lock.
2. Add `--only` and commit-safe `--resume` on top of the existing receipt
   schema.
3. Run a measured Darwin jobs=2 full sweep, then raise only capacities supported
   by the receipt evidence.
4. Simplify compatibility npm aliases that are no longer operationally useful.

## Non-Goals

This refactor does not move proof authority to GitHub or fluffycachy, introduce
a pre-production development branch, or weaken full-mode coverage. `main`
remains the development trunk; the `production` branch remains only an explicit
release pointer. Ordinary `--run` stays on the Darwin checkout. Artifact root
discovery does not change that host rule.
