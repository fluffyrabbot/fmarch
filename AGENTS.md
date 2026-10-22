# Agent Workflow

This repo is a one-developer, pre-1.0 workspace. Prefer repository-owned proof
on the canonical Cachy worker, task branches, and atomic history over PR ceremony.

## Default stance

- Assume greenfield/no external users unless the user says otherwise.
- Cut directly to the architecturally superior shape, and resolve breakage with
  further refactor instead of preserving transitional compatibility by default.
- Keep commits atomic and intentional. Each commit should describe one coherent
  change.
- Give every task a named branch and its own worktree. Preserve unexpected dirty
  or unpublished work on a named branch before reconciling it.
- On the editing Mac, create task worktrees only under
  `/Users/fluffypro/apps/.fleet-worktrees/fmarch-<task>-<date>`. Keep
  `/Users/fluffypro/apps/fmarch` as the main checkout; do not create sibling
  `fmarch-*` directories directly in `/Users/fluffypro/apps`. Canonical workers
  retain their fleet-managed worktree locations.
- At task completion, retire inactive, clean worktrees whose commits are
  contained in freshly fetched `origin/main`, using `git worktree remove` from
  outside the checkout. First check active task references and open files or
  process working directories, unpublished commits, and untracked/ignored
  files. Preserve unexpected files and unfinished work; do not force removal.
  Retain published branches independently of checkout cleanup. Keep unfinished
  experiment checkouts under the standard worktree root, using
  `git worktree move` only after checking that they are inactive.
- Worktree retirement does not authorize deleting external build targets,
  databases, proof receipts, or benchmark evidence. Review those resources
  separately, and report retained worktrees and their reason at task completion.
- Push the task checkpoint to origin before verification. Fast-forward `main`
  only after the required canonical proof passes.
- Treat `main` as the sole development trunk. Railway staging follows `main`;
  Railway production follows only the explicit `production` release pointer.
  Never use a long-lived pre-production development branch.
- Treat Git remotes as the source of truth for history. Never synchronize source
  working directories or build caches between machines. The supervised Cachy
  worker owns ordinary proof; GitHub-hosted CI is not required for this workflow.

## Verification preference

- Run routine application proof on fluffycachy. On the editing machine, commit
  and push a clean task branch, then run `npm run proof:remote`. Inspect the
  signed fleet receipt before landing code. Planning and bounded Node/static
  checks may run on the Mac; ordinary Cargo/full-proof commands must not fall
  back to the editing machine.
- Code, workflow and test changes require a passing Linux receipt for their
  pushed checkpoint. Documentation-only changes use relevant contract checks
  and cite the unchanged qualified code checkpoint.
- Use `npm run proof:remote -- --mode push` for ordinary changes and `--mode
  sprint` for active-frontier checkpoints. The default remains full. The worker
  pins the comparison commit when queued. After success, use the fleet `land`
  command with that job ID; it rejects moved source or default branches.
  Local `proof:lanes` modes remain useful for planning on the Mac.
- A 24 GiB host permits one closure-heavy local Rust build at a time across all
  workspaces. Execution-bearing `npm run proof:lanes` modes acquire the shared
  host lock through `scripts/with-heavy-build-lock.py`; they default to serial
  lanes, and must fail closed if unregistered Cargo/rustc work is already
  running or appears later. Do not bypass the lock merely to reduce queue time.
  The direct API compile gate is `npm run check:api`; do not invoke
  `cargo check -p api` directly because its closure is heavyweight enough to
  preempt another workspace's registered lane. Run schema upgrade proof through
  `npm run test:database-schema-upgrade` for the same reason; its migrator build
  is covered by the shared lock. All local migration harnesses must launch
  through `runFmarchMigrations`; the shared helper acquires the host lock before
  spawning `fmarch-migrate`, so callers must not spawn that Cargo command
  directly.
  Use an isolated overflow checkout only when its host, target, and database
  resources are independent.
- Use the narrowest truthful gate for the touched area, then broaden only
  when the change crosses boundaries.
- Compute that gate mechanically: `npm run proof:lanes` maps the current diff
  (vs `origin/main`, including uncommitted work) to the required lane set via
  `docs/ops/proof-lane-manifest.json`. Add `--run` to execute it:
  `--mode push --run` before ordinary pushes, `--mode sprint --run` for an
  active-frontier checkpoint, and `--mode full --run` for the content-addressed
  full sweep, which may reuse frozen lanes whose proof key still matches. Use
  `--mode full --force --run` for release checkpoints and periodic exhaustive
  audits. [Proof lanes](docs/ops/proof-lanes.md) owns the lane model, run flags,
  and cache semantics.
- Tier discipline: `frozen` areas are completed surfaces trusted between full
  sweeps — their lanes leave the inner loop, never existence. Editing frozen
  paths is allowed (greenfield stance stands) but automatically re-arms their
  lanes plus the dependent closure; that escalation is the cost signal, not a
  prohibition. Re-declare tiers at sprint boundaries (current frontier =
  active), use sprint mode during frontier-wide checkpoints, and run
  `--mode full --run` before landing a sprint to `main` so the freeze stays
  honest. Validate manifest integrity with `npm run test:proof-lane-contract`.
  Promote a stable cost into the tracked baseline only deliberately, with
  `node tools/proof_lane_select.mjs --record <lane-id>`.
- Proof-cache maintenance is two-phase: `npm run proof:cache -- explain
  <lane-id>` diagnoses a miss; `gc --dry-run` writes a plan, and only that
  reviewed plan may be applied with `gc --apply <plan-path>`. Audit with
  `npm run proof:cache -- audit`; recover a failed application with
  `audit --recover <plan-id>` and apply the new plan. Never replay an attempted
  plan or hand-edit cache entries. Details are in
  [proof lanes](docs/ops/proof-lanes.md#proof-cache).
- For frontend browser/readiness work, prefer the role proof and artifact
  contract lanes on the canonical worker before landing.
- For Postgres-backed Rust work, use the canonical worker-owned `DATABASE_URL`
  proof lane and run SQLx-heavy tests serially when needed. The pinned native
  PostgreSQL installation is provisioned by the Linux workflow.
- fluffycachy is canonical for the complete Linux application proof graph,
  including Chromium browser, visual, CSP, tablet viewport, live-stack and
  auth-invite lanes. Native macOS/Safari acceptance remains explicit and
  separate; `FMARCH_LOCAL_PLATFORM_PROOF=1` opts into a named Mac-only check.
  The worker uses a separate fmarch cache/database and the same host-wide heavy
  lock as MeSH. Never bypass admission or borrow MeSH's writable resources.
  See `docs/ops/cachy-canonical-verification.md` for the qualified source,
  environment, cold/warm receipts and operating commands.
- Existing Darwin timings are historical. Promote new timing baselines only
  from qualified Cachy measurements, with the host/environment recorded; do not
  mix measurements from different hosts or silently replace visual identities.
- Cargo `target/` must be a symlink onto an external writable build root, never
  a real directory in the checkout. Discovery is
  `FMARCH_EXTERNAL_BUILD_ROOT` if set, otherwise
  `/Volumes/rabbitx10/build/fmarch` when that volume is writable, otherwise
  fail closed. `bash scripts/check-build-posture.sh --apply` creates the
  destination and symlink when missing. The Linux fleet profile sets its owned
  `FMARCH_EXTERNAL_BUILD_ROOT`; `scripts/linux-proof.sh` applies posture and
  starts the pinned isolated PostgreSQL environment under the shared host lock.

## Publishing

- Commit and push a task checkpoint, then submit its proof:

  ```sh
  git add <paths>
  git commit -m "<atomic message>"
  git push origin HEAD
  npm run proof:remote
  ```

- After the signed canonical receipt passes for that checkpoint, integrate it
  with a fast-forward to `main`. Never use a passing receipt for a different
  code checkpoint or a failed/partial sweep as landing evidence.

- Open a PR only when it is useful as a reviewable checkpoint or backup marker.
- Prefer fast-forward-only integration. Avoid merge commits for normal solo flow.

## Deployment promotion

- A push to `main` publishes history. Release staging with the exact-commit
  coordinator; Railway services use pinned images with Git sources and image
  auto-updates disabled. Follow
  [the release runbook](docs/ops/railway-staging-target.md). A push must not
  deploy production.
- Promote production only from a clean, pushed `main` commit after the required
  canonical proof, both staging health checks, and commit-attribution checks pass.
- Advance the remote `production` branch to that exact commit as the explicit
  release action. Do not develop on `production`, merge production back into
  `main`, or use it as a compatibility branch.
- Keep staging and production state isolated: separate Railway environments,
  Postgres instances, volumes, domains, variables, and WorkOS environments.

## Followup habit

- After each round, suggest a detailed recommended followup that builds directly
  on the completed work.
