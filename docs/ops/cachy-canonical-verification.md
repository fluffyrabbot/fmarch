# Make Cachy the canonical fmarch verification host

Status: assessed on 2026-09-06; authority has **not** changed.

## Recommendation

Make `fluffycachy` authoritative for routine and full Linux application proof.
Keep the Mac as the editor/controller and for explicitly named macOS/Safari
acceptance checks. A routine proof request from the Mac should enqueue an
immutable Git commit on Cachy and return its receipt; it should never silently
fall back to compiling Cargo locally.

This is feasible with the existing runner. The main work is reproducible host
configuration, admission shared with MeSH, and qualifying the complete Linux
proof set. Moving the current shell command alone would move the contention
problem and leave the evidence claim ambiguous.

## Evidence from this round

Cachy has 16 logical CPUs, 27.15 GiB RAM, and approximately 210 GiB free in its
apps filesystem at inspection time. Installed tools include Rust/Cargo 1.95.0,
Node 26.8.1, npm 12.0.2, PostgreSQL 18.6, Podman 6.1.1, Clang 22.1.8,
cargo-deny 0.20.2, and Python 3.14.7. Docker is absent; Podman is available.

The committed Linux fleet contract profile passed through the real dispatcher:
proof-harness/architecture checks, frontend contracts, and static schema checks.
This profile deliberately does not claim full proof coverage.

The repository's own PostgreSQL helper successfully initialized an isolated
cluster on loopback port 15546, queried PostgreSQL, and stopped it. The exact
Playwright Chromium revision 1223 was initially absent. Installing the
repository's pinned browser succeeded, and headless Chromium 148.0.7778.96
launched and rendered a page. These are prerequisite probes, not full
application acceptance.

After the browser installation, the real
`npm run test:frontend-csp-browser` check also passed on Cachy, including the
production nonce CSP and provider-logout continuation proof. This demonstrates
one application browser lane on Linux; it does not qualify all 66 lanes.

## Existing machinery to retain

`docs/ops/proof-lane-manifest.json` defines 66 lanes:

| Execution class | Count |
|---|---:|
| Hermetic | 27 |
| Cargo | 16 |
| PostgreSQL | 17 |
| Browser | 5 |
| Hosted/network | 1 |

Nineteen lanes request a PostgreSQL resource, and 36 request the Cargo lock;
execution classes and resource claims intentionally overlap. The runner allows
two compatible lanes, while `cargo-target`, database administration, browser,
frontend-worktree, container-engine, and network each have capacity one.

Keep this repository-owned graph, its disposable database ownership, artifact
producer/consumer relationships, and content-addressed receipts. The fleet
should schedule the whole repository run, not duplicate its lane DAG.

`tools/proof_lane_cache.mjs` already fingerprints OS, architecture, OS release,
Node/npm, Rust/Cargo, and PostgreSQL. Darwin receipts therefore must not be
reused as Linux passes. Populate a fresh Linux evidence baseline. Keep build
caches local to their owning host; only Git history and proof evidence travel
between machines.

## Required changes

### 1. Make admission global to the worker host

The fleet mailbox limits Cachy to two jobs and one `heavy` job. That limit only
covers mailbox submissions. Direct dispatch, manual SSH commands, and existing
remote-check scripts can bypass it. The current MeSH Linux fleet profile also
omits `resourceClass: heavy`, despite running Cargo.

Before switching authority:

- Mark every Cargo-bearing worker workflow, including MeSH and canonical
  fmarch, as `heavy`. Keep the current fmarch contract-only profile lightweight
  until it actually invokes Cargo.
- Route normal work through the supervised mailbox. Have direct/manual Cargo
  entrypoints acquire the same host lock used by
  `scripts/with-heavy-build-lock.py`; `/tmp/closure-heavy-rust-build.lock` is
  already shared by the fmarch and MeSH wrappers.
- Preserve busy/preemption behavior. Never set
  `HOST_ALLOW_UNREGISTERED_CARGO=1` to make a queue appear healthy.
- Add explicit service/cgroup limits. The existing worker service reports
  unlimited memory and CPU. A starting envelope to qualify is one Cargo
  closure, two Cargo build jobs, `MemoryHigh=18G`, `MemoryMax=22G`, and
  `CPUQuota=1200%`. These are proposed ceilings, not measured safe peak
  requirements; measure the cold largest closure before finalizing them.

A queue should delay competing work instead of allowing it to consume the
same memory and then aborting one proof. Keep the process detector as a
backstop for commands launched outside admission.

### 2. Pin the complete proof environment

Rust is already pinned to 1.95.0. Pin a tested Node/npm pair and browser build
rather than inheriting rolling CachyOS upgrades. Install the matching browser
libraries/fonts and record their identity alongside visual evidence.

The native PostgreSQL probe used 18.6, while `docker-compose.yml` pins
PostgreSQL 16. Use the repository's PostgreSQL 16 container through Podman, or
explicitly migrate and qualify the database contract on 18. Do not silently
mix versions. The existing helper can use `/usr/bin` or explicit `FMARCH_DEV_POSTGRES_BIN`, so
Homebrew paths are not a fundamental blocker.

Give fmarch its own writable build/cache root and database endpoint. Never use
MeSH's `mesh-verify` checkout, target, or database. Use a stable, serialized
fmarch Cargo cache for warm runs, with per-run proof artifacts and disposable
databases. The current contract-only profile's per-task root is intentionally
isolated; replacing it with a persistent root for full proof requires testing
cache ownership and interrupted-run recovery.

### 3. Qualify the full Linux proof graph

Run a cold complete sweep, then a warm sweep with normal cache policy, in an
isolated Git worktree on Cachy. Exercise interruption/restart and a competing
MeSH request: the latter must wait or receive a busy result without launching a
second Cargo closure.

The browser scripts use Playwright Chromium, not macOS-only browser APIs, so
most browser/CSP/viewport checks are plausible Linux candidates. A Linux
viewport test does not certify actual Safari, iOS, or native Mac behavior.
Visual baseline samples currently have no platform partition. Compare Linux
results against their intended visual claims; introduce a Linux baseline
identity where rasterization/fonts differ, rather than overwriting Darwin
baselines merely to make the check pass.

The hosted/network lane is dependency auditing. Its failure must remain
separate from local determinism or browser correctness. Verify any live-stack
or auth fixture configuration is local/disposable before running the full
sweep; never import production credentials into the proof host.

### 4. Carry long runs through the existing supervisor

The fleet worker currently gives each command 1,800 seconds. Existing proof
notes already record a full sweep longer than that. A single full-sweep
command needs an explicitly larger worker command budget while retaining the
runner's individual lane timeouts and heartbeat/receipt protocol. Keep queue
expiry, claim lease renewal, command timeout, and individual lane timeout as
separate settings; they serve different purposes.

Persist the exact SHA, environment identity, selected lanes, cache decisions,
logs, and terminal receipt. An SSH disconnect must not terminate the job.
The mailbox/supervised worker provides this; a long foreground SSH session
does not provide the desired operating model.

### 5. Change authority only after qualification

Update `AGENTS.md`, the proof architecture documentation, and the fleet host
preference together. Define the Linux receipt as required for ordinary
landing, and list any residual Mac-specific acceptance separately. Update
cost baselines only from the new canonical environment after qualification;
existing Darwin timings are not interchangeable.

The Mac entrypoint should require a pushed task checkpoint when work is dirty,
then enqueue the immutable SHA. The current fleet CLI resolves the configured
remote default branch when creating a task; it cannot yet select a pushed
feature checkpoint. Add an explicit remote-ref input, resolve it after fetch,
and bind that SHA into the signed job and returned receipt. Never synchronize working directories. Make
"run locally anyway" explicit, because implicit fallback would recreate the
problem this change is meant to solve.

## Acceptance criteria

- Cold and warm full Linux sweeps pass at the same immutable commit.
- No full run writes to a developer checkout or another repository's cache/DB.
- A concurrent MeSH request cannot start a second heavyweight closure.
- Disconnect, worker restart, and proof preemption produce recoverable state
  and truthful terminal evidence.
- The environment and visual baseline identities are explicit.
- Routine work on the Mac starts no Cargo jobs; the Mac displays the remote
  receipt and retains only explicitly required platform-specific checks.

The next implementation round should establish shared admission and the
pinned PostgreSQL/browser environment first, then qualify the complete sweep.
Changing the preferred-host label before those checks pass is insufficient.
