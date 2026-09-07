# Developing and operating fmarch

Run commands from the repository root. [README](../README.md) introduces the
product; [the architecture index](arch/README.md) maps its contracts.
[AGENTS.md](../AGENTS.md) owns the local proof and publishing policy.

## Prepare the checkout

Use the pinned Rust toolchain in `rust-toolchain.toml`, Node/npm compatible with
the locked frontend toolchain, Python 3 for host-lock wrappers, and local
Postgres binaries or Podman plus `podman-compose` for database-backed work.
Browser lanes also require their configured Chromium/Playwright runtime.

```sh
npm ci
npm --prefix frontend ci
bash scripts/check-build-posture.sh --apply
```

Cargo `target/` must be a symlink onto an external writable build root. The
posture script uses `FMARCH_EXTERNAL_BUILD_ROOT`, otherwise the configured
writable `/Volumes/rabbitx10/build/fmarch`; it fails closed if neither is
available. Do not start overlapping heavy Rust builds or bypass the shared
host lock.

## Choose a local environment

| Task | Entry point | Guide |
|---|---|---|
| Visual/component work with fixture data | `npm run ui:dev` | [UI workbench](ui-workbench.md) |
| Full seeded game with disposable Postgres | `npm run dev:test-game:local` | [Human-run test games](ops/human-run-test-games.md) |
| Manage a local database separately | `npm run dev:postgres -- start` | [Human-run test games](ops/human-run-test-games.md#prerequisite) |
| Verify UI behavior | Quick, browser, or live-stack lane | [Frontend proof](ops/frontend-proof.md) |

The workbench opens `http://127.0.0.1:5173/_dev/ui` and needs no Rust API or
Postgres. The full harness prints role entry URLs and writes session details
under `target/dev-test-game/`. Its local wrapper owns disposable database and
server cleanup on exit. `.env.example` documents standalone runtime settings;
its placeholder keys are not usable hosted credentials. Fixture and debug
identity modes are local-only.

## Change and verify

1. Work directly on `main`, keeping each change coherent.
2. Inspect the required lanes with `npm run proof:lanes`.
3. Use focused checks during development (`npm run check:api` for the heavy API
   compile gate, or the frontend proof entry points for UI work).
4. Run `npm run proof:lanes -- --mode push --run` before an ordinary push.
5. Commit only the intended paths and push after proof passes.

Sprint/full modes, frozen-lane reuse, exhaustive release proof, receipt
maintenance, and host constraints are specified once in [AGENTS.md](../AGENTS.md).
A bundle build or old passing artifact does not substitute for the selected
proof boundary.

## Schema and generated contracts

- [Database schema evolution](ops/database-schema-evolution.md) owns append-only
  migration changes, epoch/checksum updates, generated snapshots, and upgrade
  proof. `fmarch-migrate` is the only normal schema writer; local harnesses call
  it through `runFmarchMigrations` under the shared lock.
- [Wire protocol](arch/04-wire-protocol.md#type-generation-workflow) owns the
  Rust→TypeScript exporter workflow. Do not hand-edit generated copies.
- [Completion registry](ops/completion-registry.json) owns capability status.
  Regenerate the scorecard with `npm run generate:completeness-scorecard` when
  intentionally updating that registry; prose alone cannot mark a feature done.

## Release and recovery

Publishing Git history and deploying services are separate operations. Staging
uses the exact pushed `main` commit; production uses an explicit `production`
release pointer. Railway runs pinned images with source auto-deploy disabled.

Follow the prerequisites and environment configuration in
[the release runbook](ops/railway-staging-target.md), then use:

```sh
npm run release:staging -- --commit <full-pushed-main-sha>
npm run promote:production -- --check
npm run promote:production
```

The coordinator sequences migrator, API, and frontend, verifies digests and
commit attribution, and records a receipt. Promotion requires a clean pushed
`main`, staging evidence, and local proof. Its `--check` mode performs remote
reads and local proof/setup; it does not advance the release pointer.

Use [release game day](ops/release-game-day.md) for release failure/recovery
rehearsals, [runtime KEK rotation](ops/runtime-kek-rotation.md) for event keys,
and [profile index rotation](ops/profile-handle-index-rotation.md) for the
blind index. Do not substitute manual table changes, image rebuilds, or branch
movement for the receipt-bound procedures.
