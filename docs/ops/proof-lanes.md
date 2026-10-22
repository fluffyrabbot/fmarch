# Proof lanes

`npm run proof:lanes` maps a diff to the narrowest truthful set of executable
proof lanes and, with `--run`, executes them. The manifest is
[proof-lane-manifest.json](proof-lane-manifest.json); the selector is
`tools/proof_lane_select.mjs`. [AGENTS.md](../../AGENTS.md) owns when each mode
is required and where proof runs; [Cachy canonical
verification](cachy-canonical-verification.md) owns the Linux worker's
admission, resource quotas, and environment identity. This document owns the
lane model, run semantics, and the proof cache.

## Manifest model

The manifest holds executable leaves only. Human-facing aggregates such as
`test:local-postgres-ci` and `test:frontend-role-proof:quick` stay in
`package.json`, but their constituents are represented directly, and the
manifest contract rejects an npm leaf that invokes another declared leaf.
Dependencies are expressed with `depends_on`, so each leaf executes once.

Each lane declares an argv command and environment additions, an execution
class (`hermetic`, `postgres`, `browser`, or `hosted`), dependencies, a timeout,
mode placement, typed resource requirements, and the artifact it produces.
Lanes claiming a capability declare it in `completion_evidence`; the
[completion registry](completion-registry.json) references the canonical lane
and the scorecard validates both sides.

Areas map paths to lanes. A canonical crate area owns its reverse Cargo
closure: dependents select their `dependency_lanes`, while only direct
behavioral owners forward `also_triggers` edges. File, prefix, and glob
selectors have explicit kinds; literal Svelte route brackets stay literal.
Generated contract checks remain explicit lanes rather than inferred edges.

### Inputs

The manifest separates broad `cache_inputs` context from narrow typed
`execution_inputs`. Lane inputs select direct consumers; package inputs follow
the compiled Cargo dependency closure; target inputs belong only to directly
selected tests or binaries. Selection and cache keys use the same resolved
selectors, and dependency-only matches never forward `also_triggers`.

Cargo metadata must resolve against the committed lockfile. Runtime consumers
retain package manifests, build scripts, and production sources but omit
dependency integration-test trees. Browser and opaque Cargo/Postgres harnesses
declare `cargo_inputs.builds` as exact binary target/profile pairs (an empty
array declares no Rust build); live harnesses derive their Cargo arguments from
the same declarations. Unknown, missing, duplicate, or contradictory
declarations fail validation before execution.

Admission fails closed before any execution or cache lookup when a selected
source or fixture path is a symlink (including missing-file ancestors and
directory links hiding glob matches) or is ignored by Git: an executor must not
read data omitted from its key. New external file reads must update the owning
lane, target, or package declaration.

### Cargo target selection

Every `cargo test` leaf declares `assertion_targets` and selects exactly the
library, binary, or integration targets containing test declarations. The
contract resolves them through live Cargo metadata and rejects missing targets,
broad package discovery, and targets with no Rust, Tokio, or SQLx test. From the
other side, every assertion-bearing workspace target must appear in some lane's
inventory; the escape hatch is to hold no assertions, never to go unlisted.
The workspace has no doctests, so lanes do not invoke rustdoc; workspace Clippy
is the compilation authority.

## Modes and tiers

- **inner** (default) — the touched closure.
- **push** — the touched closure plus the bounded `push_sentinels` set, kept
  within `push_sentinel_budget_seconds`. The sentinels include both
  dependency-policy lanes, because a newly published advisory turns them red
  with no code change.
- **sprint** — push plus every active-tier area.
- **full** — every lane; frozen lanes may reuse a matching cache entry.
- **full `--force`** — every lane, no reuse. Use for release checkpoints and
  periodic exhaustive audits.

Areas are `active` or `frozen`. Frozen areas must cite registry capabilities
that are all complete. A tier never exempts an area from diff selection:
touching a frozen path, directly or through its closure, re-arms its lanes.
Re-declare tiers at sprint boundaries.

Selection compares against `origin/main` (override with `--base`), so a stale
worktree-local `main` cannot manufacture a large diff. Rename discovery keeps
both sides and uses NUL-delimited paths.

## Running

`--run` writes a receipt under ignored `target/proof-lanes/`, bound to the Git
SHA, dirty-worktree digest, manifest digest, selected graph, and sanitized local
database identity. Local receipts never qualify a release: the release
coordinator accepts only a signed Cachy `audit` envelope whose verification
steps all passed (see [Railway releases](railway-staging-target.md)).

- `--jobs N` enables the manifest resource scheduler; the default is serial.
  Admission is ranked by recorded lane cost so the critical path starts first.
  Named locks are cross-run filesystem admissions bounded by
  `runner.lock_capacities`.
- `--only <lane>` selects one fresh dependency closure. A focused run gates
  even on a quarantined lane.
- `--resume <receipt>` retries a failed graph for the same commit, manifest, and
  dirty digest, re-running any artifact producer a retried lane consumes. It
  carries `--jobs`, `--keep-going`, and `--skip` forward. Resume never reads or
  writes the proof cache.
- `--keep-going` runs every dependency-satisfied lane and reports all failures;
  a genuine dependency still blocks its consumer.
- `--skip <lane,...>` records an exclusion: skipped lanes are never green, their
  dependents block, and the verdict states the count.

The manifest `quarantine` list carries lane, owner, expiry, and reason.
Quarantined lanes run and report but do not gate a plain non-zero exit;
timeouts, spawn failures, leaked child groups, and cleanup failures still gate.
A run relying on an expired in-plan quarantine fails, and an expired entry
outside the plan warns. The terminal verdict reads `proof passed: N of M
lane(s)` and names every lane left failed, blocked, skipped, quarantined, or
preempted.

If the shared heavy-build lock detects a late competitor, it writes a pid-scoped
marker and exits 69 (`PREEMPTED_EXIT_CODE`). The executor records the in-flight
lane as `preempted`, and the sweep supervisor resumes the receipt exactly once.
The `last-run.json` pointer records the runner pid and is only actionable when
it matches the marker.

### Resource isolation

The runner uses the declared loopback proof endpoint, or starts the repo-local
server through `tools/dev_postgres.mjs`; it never adopts an ambient
`DATABASE_URL`. Each Postgres resource receives a generated
`fmarch_proof_<run>_<lane>_<url-env>` database through its declared URL
variable. Databases are dropped on success and named in the receipt when
retained after failure; a multi-database leaf receives distinct named leases.
Each lane has a run-scoped artifact root, and artifact consumers receive their
producer's exact path through a hard dependency. POSIX children run in their
own process group, drained on timeout or interruption before locks and
databases release.

Hosted lanes, lanes claiming the `network` lock, and the dependency-policy
lanes always execute: their inputs change outside the repository. Build posture,
current-date contract checks, and cache maintenance are execution-only.

### Timings

Every `--run` records observations under ignored
`target/proof-lanes/timings.json`. `node tools/proof_lane_select.mjs --record
<lane-id>` promotes a stable observation into the tracked
[proof-lane-timings.json](proof-lane-timings.json). `--measure` and
`--measure-all` warm each lane with its own command and then time it; lanes
declaring `"measurement": "diff-sensitive"` (workspace Clippy) refuse
repetition measurement. Estimates prefer the tracked baseline because runtime
observations absorb the previous lane's compilation. Promote baselines only
from qualified Cachy measurements with their host identity recorded.

## Proof cache

A lane is reusable in full mode only when every owning area is frozen and an
immutable entry under `target/proof-lanes/cache/` matches its proof key. The key
binds the lane and hard-dependency graph, transitive Cargo sources, manifest
paths, fixtures, every migration, the root and frontend lockfiles, the pinned
and runtime toolchains, and the selector, cache, and runner sources. Loading
verifies the lane record and a recursive artifact digest, then copies producer
artifacts into the new run before consumers start. Malformed or incomplete
entries are ordinary misses. Forced runs may populate missing keys but never
rewrite a valid entry. Entries from an older input schema stay integrity-checked
and retained but are reported as `input-contract-changed` and never reused.

### Administration

- `npm run proof:cache -- explain <lane-id>` names every changed file
  fingerprint, toolchain field, or execution-contract component relative to the
  newest prior valid entry.
- `npm run proof:cache -- gc --dry-run` writes an immutable plan under
  `target/proof-lanes/cache-maintenance/plans/`. Current keys, keys referenced
  by the newest terminal full or release receipts (`--keep-receipts`, default
  ten), and in-flight keys are protected. In-flight receipts (`running`,
  `preempted`) are capped by recency like terminal ones, so abandoned runners
  cannot grow the protected floor without bound. Corrupt entries are
  quarantined. `--max-bytes` fails closed when protected evidence alone exceeds
  it.
- `npm run proof:cache -- gc --apply <plan-path>` takes the shared host lock,
  revalidates the plan digest and its complete cache and reachability basis,
  writes an immutable intent, executes exactly the reviewed actions, writes a
  result with the post-inventory digest, and refuses replay.
- `npm run proof:cache -- audit` (a push sentinel) validates plan, intent,
  result, recovery, and action linkage plus historical post-inventory hashes.
- `npm run proof:cache -- audit --recover <plan-id>` writes a fresh plan from
  current state with linkage to the failed one; review and apply it normally.
  Recovery never replays an attempted plan.
- `npm run proof:cache -- audit --quarantine-staging` moves revalidated stages
  owned by dead writer PIDs into the maintenance quarantine. Live-writer stages
  are never moved.

Every maintenance receipt publishes through one durable protocol: exclusive
same-directory stage, stage-directory sync, file sync, atomic no-clobber
hard-link publication, publication-directory sync, stage removal, and final
directory sync. Hard links are used because POSIX rename may replace an
existing name. The maintenance contract kills a real child at each durable
boundary and requires each crash to leave an auditable orphan that converges
through a planned recovery.

## Measured decisions

- Darwin full-sweep experiments on 2026-08-27 found no reproducible gain from
  `--jobs 2`: an apparent 13.9% win reversed to an 11.3% loss when run order
  was swapped, because the second run inherited a warm Cargo target. Parallel
  admission later became worthwhile only with the Linux CPU-budgeted scheduler
  and the build/run split described in the Cachy document.
- Sharding the 140-case semantic-audit tail across four SQLx databases improved
  the median by 1.02% against a 15% promotion gate and was removed. Profile the
  residual critical path before proposing another topology change.
- The original commands lane is four leaves: hermetic unit/boundary tests,
  parallel ordinary Postgres integration, serial cancellation/concurrency proof,
  and the semantic/generated audit, which only owned inputs or full proof arm.
- Mash-scale timing ceilings are product contracts. A miss under heavy host
  load is host-contention evidence, not a reason to relax the ceiling; preserve
  the receipt and load evidence if it recurs.
