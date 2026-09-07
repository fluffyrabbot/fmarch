# Cachy canonical verification

Status: implementation under qualification on 2026-09-06. Canonical authority
has not changed; a failed or incomplete Linux sweep is not a landing receipt.

## Submit a checkpoint

Commit and push a clean task branch, then run `npm run proof:remote` from that
worktree. The helper uses `~/apps/fluffyfleet` (override with
`FLUFFYFLEET_ROOT`), fetches origin, checks that the remote branch still equals
HEAD, and enqueues that immutable commit on Cachy. Inspect its signed receipt
with `node scripts/fleet.mjs job TASK_ID --host cachy --evidence` in fluffyfleet.
No source working directories or build caches are synchronized between hosts.

The worker creates its own named task branch and worktree. An SSH disconnect
does not stop a queued job. A worker restart reports unfinished work as
`attention`; `node scripts/fleet.mjs resume TASK_ID --verify-only --keep-worktree`
submits another supervised attempt at the same source SHA. Receipt reuse must
also match the proof environment identity.

Ordinary execution-bearing `proof:lanes` calls on the Mac exit before Cargo.
`FMARCH_LOCAL_PLATFORM_PROOF=1` is an explicit exception for a named Mac-specific
acceptance check. Linux Chromium proof does not certify Safari, iOS, or native
macOS behavior.

## Ownership and admission

The Linux workflow is `heavy` and runs the existing 66-lane repository DAG with
two compatible lanes, while Cargo, database administration and browser resource
claims retain their individual capacity-one constraints. It acquires the same
`/tmp/closure-heavy-rust-build.lock` as MeSH. The fleet admits one heavy job; a
manual contender exits 75 without starting its command. Unregistered Cargo
process detection remains enabled.

Cachy's user worker has `MemoryHigh=18G`, `MemoryMax=22G`, and `CPUQuota=1200%`.
Cargo uses two build jobs. The workflow command budget is four hours; individual
lane timeouts, mailbox expiry and renewable worker leases remain independent.
Repository build commands live here, not in the fleet control plane.

fmarch owns its external build root from `.fluffyfleet.json`, its PostgreSQL
cluster below that root, and loopback port 15544. Its shared cache is serialized
by admission; every run has distinct proof artifacts. MeSH uses a separate
build root. Failed worktrees and logs are retained for diagnosis.

## Environment identity

The provisioning script requires Rust 1.95.0, Node 26.8.1 and npm 12.0.2. It builds
PostgreSQL 16.15 with OpenSSL from the SHA-256-pinned upstream source archive,
inside an fmarch-only toolchain root. `FMARCH_DEV_POSTGRES_BIN` selects this
installation without introducing ambient `PG*` authority into admin commands.
The Playwright dependency pins Chromium.

`tools/linux_proof_environment.mjs` records the OS/kernel, package versions,
compiler version, PostgreSQL version/configuration/binary hash, Chromium
version/binary hash, and every installed font's hash. The snapshot is stored
under `target/proof-environments/<sha>.json`; its content hash enters both lane
cache keys and resume context. Environment drift invalidates reuse. Linux visual samples live in
`tools/fixtures/frontend-visual-baselines/linux-x64`, with an explicit Chromium
binary and font-set identity. The existing baseline is retained separately.
Changed visual identity fails closed until screenshots are reviewed and
`write:frontend-visual-baseline` is explicitly run on the owning platform. A rolling
OS update requires fresh qualification; the runner never silently substitutes
a different required Node, npm, Rust or PostgreSQL version.

## Qualification and authority gate

Before changing AGENTS.md and the fleet preferred host together:

1. Pass all 66 lanes in a fresh Linux build/evidence root.
2. Pass a normal warm full sweep at the same immutable source commit.
3. Record source/environment identities, cache decisions, durations, peak memory
   and disk usage, and signed terminal receipts.
4. Prove MeSH contention and interrupted-job recovery without a second Cargo
   closure or a false passing receipt.
5. Keep explicit platform-specific Mac acceptance separate from Linux proof.

Shared-admission and deliberate-restart probes have passed. The first broad
sweep exposed Linux directory-fsync behavior, a spectator-test delivery race,
mobile layout/caret issues and missing PostgreSQL TLS support; fixes are being
qualified. Full cold/warm receipts remain required. Do not promote host labels
or replace cost baselines based on prerequisite probes or partial sweeps.
