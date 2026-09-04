# Proof Lane Architecture Refactor

Status: active; leaf execution and fast truthful selection delivered 2026-07-26;
command proof cost boundaries and bounded generated-shrink execution delivered
2026-08-06; physical command-target extraction and exact selector ownership
delivered 2026-08-08; manifest-v5 resource scheduling, run receipts, disposable
local proof databases, and the role-smoke/visual artifact handoff delivered
2026-08-20; runner-scoped mutable npm proof leaves and canonical spine-leaf
reuse delivered 2026-08-23.

### Content-addressed cache operations — 2026-08-30

Frozen-lane reuse now has an operator surface separate from proof execution.
`npm run proof:cache -- explain <lane-id>` recomputes the canonical key and
compares it with the newest prior valid entry. Its stable report enumerates
added, removed, and changed file fingerprints, toolchain fields, and hashed
execution-contract components, so a miss is attributable rather than merely
reported.

`npm run proof:cache -- gc --dry-run` plans retention without mutation and
writes an immutable receipt under
`target/proof-lanes/cache-maintenance/plans/`.
Current frozen-lane keys and keys referenced by in-flight receipts are absolute
roots. The newest terminal full or release receipts (ten by default, controlled
by `--keep-receipts`) preserve historical reachability. Every other valid entry
is unreachable and eligible for deletion; invalid identity, artifact symlinks,
and digest corruption are quarantined instead. `--max-bytes` is a fail-closed
ceiling: GC never evicts a protected key to satisfy it, and reports an
unsatisfied budget when the protected floor is already larger.

Mutation requires `--apply <plan-path>` and acquires the same shared host lock
as proof execution. The plan binds its policy, repository root, current proof
keys, hashes of terminal and in-flight receipts, every cache entry's complete
filesystem digest, protected roots, exact actions, and expected byte totals.
Apply verifies the plan's self-digest, recomputes that complete basis under the
lock, and fails before mutation if anything drifted. It then writes an immutable
application intent, executes exactly the reviewed actions, writes a terminal
result containing the post-inventory digest, and refuses any replay of the same
plan. That serialization closes the interval between cache lookup,
running-receipt persistence, and artifact materialization; the running-receipt
roots remain a second conservative defense. Cache administration never rewrites
an immutable entry in place.

`npm run proof:cache -- audit` is the read-only maintenance sentinel. It checks
every plan, application intent/result pair, and recovery receipt for its
self-digest and one-to-one linkage. For completed applications it also derives
the exact changed-action list and post-inventory digest from the historical
reviewed plan, so later legitimate cache writes cannot create false drift.
Missing results and terminal failures fail the sentinel. Recovery uses
`audit --recover <plan-id>` under the shared host lock to write a fresh plan
from current cache and reachability state plus immutable source-to-recovery
linkage. The operator reviews and applies that fresh plan through the ordinary
two-phase path; the source issue clears only when a linked recovery application
has completed. No interrupted or failed plan can be replayed.

The maintenance contract kills a real child process at each durable boundary:
immediately after intent persistence, after the first of multiple cache
actions, and after all actions but before result persistence. Each crash must
leave an auditable orphan, preserve the current protected key, reject replay of
the source plan, and converge through a newly planned recovery to a clean
receipt graph. This exercises partial filesystem mutation rather than
constructing orphan receipts directly.

Plans, application intents/results, and recovery links now share one durable
immutable writer. It creates an exclusive same-directory stage, syncs the stage
directory entry, writes and syncs the receipt inode, publishes the final name
with an atomic no-clobber hard link, syncs that publication, removes the stage,
and syncs the final directory state. Hard-link publication is used instead of
plain rename because POSIX rename may replace an existing final name; receipt
immutability requires atomic publication and exclusion together.

The SIGKILL contract covers every publication boundary and accepts only two
final-name outcomes: absent or byte-for-byte complete. Staging names bind a
writer PID and random nonce. Read-only audit ignores a stage while that PID is
alive, reports dead-writer stages with their complete filesystem digest, and
never mistakes quarantine storage for live receipt topology. Explicit
`audit --quarantine-staging` runs under the shared host lock, rescans and
revalidates the staged bytes and dead owner immediately before moving them into
the maintenance quarantine. It cannot move a live writer's stage.

### Full-sweep resource experiment — 2026-08-27

Two clean, same-commit Darwin full sweeps passed all 62 manifest lanes at
`95d1a1ae45e04b036e3cb31af4b89bf97160ffe1`. The default jobs=1 run
(`run-20260828005214939-66886253`) completed in 2,229.80s with 1.152 GiB peak
RSS, zero swaps, and 92.11% aggregate CPU use. The opt-in jobs=2 run
(`run-20260828012938699-7b61e8c8`) completed in 1,920.56s with 0.972 GiB peak
RSS, zero swaps, and 90.38% aggregate CPU use. That observed wall-clock delta
is 309.24s, or 13.87%.

The jobs=2 receipt exercised compatible Node/browser work beside one Cargo
lane while the `cargo-target` resource continued to exclude overlapping
Cargo/rustc closures. PostgreSQL administration, disposable databases, and
run-scoped artifact ownership also remained isolated. The 131-case commands
PostgreSQL lane passed in 98.34s and the complete semantic audit passed in
525.05s, including all 140 stable serial case IDs.

These runs were sequential, so jobs=2 inherited the warmer Cargo target left
by jobs=1. The Cargo evidence wrappers make that visible: aggregate
compile/discovery time for the server, media, and API producers fell from
369.0s in jobs=1 to 2.0s in jobs=2, while their observed test-body time changed
from 197.8s to 224.8s. The 13.87% result is therefore end-to-end evidence for
these two runs, not an isolated scheduler-only speedup claim. Serial remains
the canonical default. Promotion of jobs=2 still requires a second independent
clean full sweep showing at least 10% wall-time improvement, zero swaps, and
peak RSS below 20 GiB. The machine-readable observation is tracked in
`docs/ops/proof-lane-full-experiment-2026-08-27.json`; ignored receipts remain
the authoritative per-lane execution evidence.

#### Independent jobs=2 confirmation — no-go

A counter-ordered confirmation on clean commit
`615bb79d297819235ec6f8578aa610ca5787f713` ran jobs=2 first after a complete
serial warm-up, then jobs=1 on the unchanged worktree. Both runs passed all 62
lanes directly with zero swaps and peak RSS far below 20 GiB. Jobs=2
(`run-20260828042753634-6e0a5764`) took 2,118.86s and 1.064 GiB peak RSS;
jobs=1 (`run-20260828050325238-34fc76f8`) took 1,903.50s and 0.921 GiB peak
RSS. Jobs=2 was 215.36s, or 11.31%, slower. The required independent 10%
improvement did not occur, so serial is the confirmed default.

The counter-order deliberately exposed cache sensitivity instead of hiding it.
Jobs=2 paid 294.2s of compile/discovery across the server, media, and API
evidence producers plus 27.93s before semantic-audit execution; jobs=1 paid
2.1s and 0.49s respectively. Even in the slower arm those compile/discovery
phases were 15.2% of wall time, below the 25% threshold for a compilation
experiment. Clippy also varied from 170.2s to 1.4s, so the earlier apparent
jobs=2 gain is not reproducible scheduler evidence.

Semantic work remains the next target. The instrumented 140-case tail averaged
195.304s across the confirmation pair. Its 31 Mafia Universe cases averaged
68.163s, 34.9% of the tail, and
`host_resolve_phase_carries_mafia_universe_culture_aliases` was the slowest
repeatable case at a 4.317s two-run mean. Profile that case's setup commands,
resolution, projection rebuild, and resolution-audit phases before changing
topology or assertions.

### Semantic-audit shard no-go — 2026-08-27

The 140 leftover `host_resolve` cases were assigned to four deterministic,
duration-balanced SQLx shards after two warm serial baselines of 648.0s and
615.8s (631.9s median). Two same-commit warm shard executions both passed the
complete corpus without a flaky result, at 672.88s and 577.97s (625.43s
median). That is a 1.02% median improvement, below the required 15% promotion
gate of 537.12s.

The test-harness trace showed the long residual semantic tests occupying worker
slots while the four shard bodies entered serially. The lane's critical path
therefore was not the isolated 140-case tail. The shard assignment and
four-database topology were removed as a measured no-go; stable case IDs, the
140-case completeness contract, serial baseline data, and per-case timing
artifacts remain. Any future optimization must profile the residual critical
path before proposing another topology change.

### Orchestration honesty — 2026-09-04

A full sweep that took five sequential resume cycles motivated four scheduler
changes that trade fail-fast for honest, complete reporting, plus one network
isolation. None touch lane duration; they attack the fail-fast and preemption
losses that dominated wall clock.

- `--keep-going` runs every dependency-satisfied lane and reports all failures
  at the end. Without it, one red blanket-blocks the queue and the next problem
  only surfaces a cycle later; the dependency-aware block is unchanged, so a
  genuine dependency still blocks its consumer.
- `--skip <lane,...>` excludes a known-bad lane from a `--run`. Skipped lanes
  appear in the receipt in a `skipped` state that is never green and never
  counted as passing, their dependents block, and the run verdict states the
  skip count. It replaces the `#[ignore]` hack with a recorded, visible
  exclusion.
- A declared `quarantine` list carries a lane, an owner, an expiry, and a
  reason. Quarantined lanes run and report but do not gate: a failure is
  recorded as `quarantined`, distinct from `failed`, and does not set the run's
  failure. The expiry is the load-bearing part — a run that relies on an
  in-plan quarantine past its expiry fails loudly, so quarantine cannot become
  a place reds go to die. Shape is validated by the proof-lane contract; expiry
  is enforced at run time so the contract does not rot as dates pass. The first
  entry quarantines `cargo:api` for its pre-existing
  `command_authority_lease_cannot_starve_workos_key_retirement` 503-vs-200 red
  (present at `0163867c`, unfixed and unowned), which under fail-fast blocked
  30-34 downstream lanes.
- `test:dependency-policy` is split on the network boundary.
  `test:dependency-policy:offline` (policy check plus `cargo deny`, measured
  1.2s, deterministic) declares no network resource; `test:dependency-policy:audit`
  (the two `npm audit` calls, pinned to a long fetch timeout and retries) is the
  only half that claims the `network` lock. During this change the audit half
  ran the full 300s pinned timeout and then failed with an npm registry error —
  a live demonstration that this outage would otherwise block the deterministic
  half and, under fail-fast, ~30 lanes. The audit baseline is therefore a
  labeled `network-boundary-estimate` pending a healthy re-measure via
  `--measure test:dependency-policy:audit`; the `test:dependency-policy`
  aggregate remains a human alias outside the lane table.

Preemption disambiguation deviates from a literal per-lane retry by necessity.
The heavy-build lock wraps the entire sweep: `proof_lane_select.mjs` re-execs
the whole run under `scripts/with-heavy-build-lock.py`, whose competitor monitor
watches the whole `node` group and, on a late competitor, must fail closed by
terminating that group. A per-lane retry inside `proof_lane_execution.mjs` is
therefore impossible — the executor is the process being killed. Instead the
lock writes a pid-scoped marker and returns a distinct exit code (69, kept in
sync with `PREEMPTED_EXIT_CODE`) before terminating; the executor reads the
marker and records the in-flight lane as `preempted` (distinct from `failed`)
with the receipt state and `preempted_by`; and the sweep supervisor in
`proof_lane_select.mjs` auto-resumes the receipt exactly once, so a transient
preemption self-heals and a persistent one surfaces without looping.

### Orchestration honesty remediation — 2026-09-04

Review of the change above found that the new non-gating states were honest
about themselves but not about their consequences, and that the auto-resume
lost the shape of the run it resumed. Six corrections:

- **Stranded dependents are counted.** A quarantined or skipped lane blocks its
  dependents, and `blocked` never set the run's failure, so a run could exit
  zero while reporting only the quarantine. With `cargo:api` quarantined the
  casualty was `check:release-topology-evidence`. The terminal verdict now
  reads `proof passed: N of M lane(s)` against the plan and names every lane
  left failed, blocked, skipped, quarantined, or preempted, via the exported
  `summarizeLaneStates`. Release remains fail-closed independently:
  `validateProofReceipt` already required every selected lane to be `passed`.
- **The auto-resume preserves how the sweep runs.** `--jobs`, `--keep-going`,
  and `--skip` are not recorded in the receipt, so resuming with a bare
  `--resume` downgraded a parallel keep-going sweep to a serial fail-fast one.
  `resumeArgv` carries the run-shape flags across; selection flags stay out
  because the receipt owns the plan.
- **`--skip` is valid with `--resume`.** It had to be, or the automatic resume
  would execute the lanes the operator excluded.
- **Quarantine no longer absorbs infrastructure failures.** Lane stdio is
  inherited rather than captured, so the runner cannot attribute a red to the
  entry's named `test`; the attribution it *can* make is that a timeout, spawn
  failure, leaked child group, or cleanup failure is not the declared red.
  Those gate. A plain non-zero exit is what quarantine covers.
- **`--only <lane> --run` gates.** A deliberately focused run is the one case
  where the operator is asking about that lane, so quarantine does not apply.
  An expired quarantine on a lane outside the plan now warns on every run,
  since its hard gate only fires on runs that select it.
- **Preemption labelling is no longer racy, and the pointer is pid-checked.**
  `killpg` can deliver a lane child's close event before the runner's own
  SIGTERM handler, which recorded a phantom red inside a preempted run; the
  marker is now consulted wherever an abnormal end is observed. The
  `last-run.json` pointer records the runner pid and is only actionable when it
  matches the preemption marker, so a preemption during the (not short)
  selection phase cannot auto-resume a stale receipt. Cache GC also treats
  `preempted` receipts as in-flight, since evicting what a pending resume
  references would silently force those lanes to re-run.

Receipts now record `quarantine`, `skipped_lane_ids`, and `keep_going` in their
context, so a receipt is readable on its own rather than only against the
manifest it was run from.

## Delivered foundation

The manifest now contains executable leaves only. The human-facing
`test:local-postgres-ci` and `test:frontend-role-proof:quick` aliases remain in
`package.json`, but their baseline/commands/projections and frontend constituent
lanes are represented directly in the manifest. Selection deduplicates by a
canonical execution key after cost ordering, and the manifest contract rejects
an npm leaf that invokes another declared leaf.

The work packages below record the delivered architecture. The independent
jobs=2 experiment is resolved as a measured no-go, so serial remains the
default.

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
runner-owned mutable npm leaves. The resource-model result is:

- Manifest-scheduled mutable npm leaves receive injected disposable databases
  and run-scoped artifact directories. The backup/restore drill owns separately
  named source and restore leases; aggregate compatibility aliases retain their
  self-managed scratch lifecycle only outside the canonical runner.
- The tracked baseline covers every lane, checkpoint/resume is commit-safe, and
  the first jobs=2 full experiment passed without weakening conservative
  capacity-one Cargo and Postgres administration resources.

The desired shape is a manifest-owned DAG of independently executable leaf
lanes. Aggregates remain useful user-facing aliases, but they must not appear as
leaves beside the work they contain.

## Target Model

Move the manifest to version 6. Migrated lanes declare:

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
- Persist schema-3 ignored receipts under `target/proof-lanes/`; `--only <lane>`
  selects one fresh dependency closure and `--resume <receipt>` retries a
  failed closed graph while re-running any artifact producer needed by the
  retry.
- Bind every receipt to the Git SHA, canonical dirty-worktree digest, manifest
  digest, selected lane graph, and sanitized local database identity. Release
  coordination accepts only clean, exact-commit full receipts.

### Content-address frozen full sweeps — delivered 2026-08-29

- Full mode still selects every manifest lane. A lane is reusable only when
  every area that owns it is frozen and an immutable schema-1 cache entry under
  `target/proof-lanes/cache/` matches its current proof key.
- The key binds the exact lane and hard-dependency execution graph, transitive
  workspace Cargo package sources for canonical crate-owned lanes, explicit
  manifest-owned paths for specialized semantic/proof lanes, generated-artifact
  fixtures, every migration, root and frontend dependency locks, the pinned and
  runtime Rust/Node/Postgres toolchains, and the selector/cache/runner sources.
  Unrelated active-frontier source is intentionally absent.
- Cache loading verifies the successful lane record and a recursive artifact
  digest. Cached producer artifacts are copied into the new run before any
  consumer starts, so artifact dependencies retain the same run-local boundary
  as executed producers. Missing, malformed, corrupt, or incomplete entries are
  ordinary cache misses and execute normally.
- `npm run proof:lanes -- --mode full --force --run` disables reuse and executes
  every selected lane. Successful forced runs may populate missing keys but do
  not mutate an already-valid immutable entry.

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
- Every migrated Cargo or scoped npm Postgres resource receives a generated
  `fmarch_proof_<run>_<lane>_<url-env>` database and an injected declared URL
  environment (`DATABASE_URL`, `DATABASE_MIGRATION_URL`, or a leaf-specific
  equivalent); it is removed on success and all leased databases are named in
  the receipt if retained after failure.
- A lane may own multiple named Postgres resources. They are provisioned
  sequentially under one `postgres-admin` admission for the entire lane, while
  distinct URL environments prevent a source/restore pair from aliasing one
  database.
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
- Auth-invite, day-event live-stack, backup/restore, mash-scale, exact-image,
  and the event-key rehearsal now declare typed runner resources and no
  `legacy` lock. The identity and backup/restore spines invoke their canonical
  npm leaves rather than raw tool files, and the redundant direct frontend
  live-role alias is retired. Aggregate compatibility aliases preserve
  self-managed scratch databases only outside runner context, where applicable.
  Hosted evidence and production promotion remain outside parallel local proof.

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

### 8. Select assertion-bearing Cargo targets — delivered 2026-08-28

- A workspace-wide `cargo test --workspace --doc -- --list` inventory found zero
  doctests in every package. Workspace Clippy remains the compilation authority;
  proof leaves no longer invoke rustdoc merely to rediscover an empty corpus.
- All 22 `cargo test` leaves declare `assertion_targets`. Their argv selects the
  exact library, binary, or integration targets that contain test declarations.
  The manifest contract resolves the declarations through live Cargo metadata,
  rejects missing targets, rejects broad package discovery, and rejects a
  selected target whose source contains no Rust, Tokio, or SQLx test declaration.
- `cargo:database-schema` selects only `database_authority`. The public-platform
  bundle selects the assertion-bearing `attention`, `social`, and `trust_safety`
  libraries; zero-test `forum` and `content_reference` targets are dormant.
  Equivalent exact selection removes empty library, binary, and rustdoc work
  from projections, operator proof, API, server, and the other Cargo leaves
  without removing an assertion.
- `profile_application` has no tests, so its standalone 43.7-second proof leaf
  is deleted. A contract proves that profile changes still arm strict workspace
  Clippy plus the projections and identity closures.
- The completed semantic audit, minimizer, principal, game-persona, profile
  handle, and profile application areas are frozen. Direct edits still re-arm
  their lanes and every full sweep still includes the semantic audit; unrelated
  sprint sweeps no longer inherit its 7–9 minute cost.

## Acceptance Criteria

- Full selection contains only leaf work and executes no test body twice.
- A stale worktree-local `main` ref cannot expand a clean `origin/main` checkout.
- The push sentinel set has complete tracked timings and stays within its
  declared 60-second budget.
- A clean machine can run `npm run proof:lanes -- --mode full --run` without
  manually exporting `DATABASE_URL`.
- A second unchanged full sweep reuses eligible frozen lanes, while changing a
  transitive source, migration, lockfile, toolchain, command, fixture, or proof
  runner invalidates the affected proof key. `--mode full --force --run` reuses
  none.
- Migrated lanes in two simultaneous proof runs cannot share a writable
  database or declared artifact directory.
- A multi-database leaf receives distinct source and restore URLs and records
  both leases in its receipt.
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

## Recommended Followup

1. Add disposable stage timing around the Mafia Universe `culture_aliases`
   case: setup command fan-out, phase resolution, projection rebuild, and
   resolution audit.
2. Capture two warm isolated executions and optimize only the dominant stage,
   preserving the same assertions, fixtures, event envelopes, and rebuild
   checks.
3. Require at least a 15% median case improvement with identical results before
   promoting the optimization, then confirm the complete 140-case tail and the
   full semantic-audit lane twice.

## Non-Goals

This refactor does not move proof authority to GitHub or fluffycachy, introduce
a pre-production development branch, or weaken full-mode coverage. `main`
remains the development trunk; the `production` branch remains only an explicit
release pointer. Ordinary `--run` stays on the Darwin checkout. Artifact root
discovery does not change that host rule.
