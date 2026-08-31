# Agent Workflow

This repo is currently a one-developer, pre-1.0 workspace. Prefer local proof,
direct `main` work, and atomic history over PR ceremony.

## Default stance

- Assume greenfield/no external users unless the user says otherwise.
- Cut directly to the architecturally superior shape, and resolve breakage with
  further refactor instead of preserving transitional compatibility by default.
- Keep commits atomic and intentional. Each commit should describe one coherent
  change.
- Work directly on `main` unless the user explicitly asks for a branch.
- Push directly to `main` after the relevant local proof is green.
- Treat `main` as the sole development trunk. Railway staging follows `main`;
  Railway production follows only the explicit `production` release pointer.
  Never use a long-lived pre-production development branch.
- Treat GitHub primarily as remote backup/history, not as the source of truth for
  CI/CD, until the project is ready for beta/1.0 release discipline.

## Local proof preference

- Prefer local CI/proof for as long as practical.
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
- Use the narrowest truthful local gate for the touched area, then broaden only
  when the change crosses boundaries.
- Compute that gate mechanically: `npm run proof:lanes` maps the current diff
  (vs `origin/main`, including uncommitted work) to the required lane set via
  `docs/ops/proof-lane-manifest.json`, expanding touched crates through the
  reverse cargo dependency closure and `also_triggers` edges. Add `--run` to
  execute the selected lanes: `--mode push --run` before ordinary pushes,
  `--mode sprint --run` for an active-frontier checkpoint, and
  `--mode full --run` for the content-addressed full sweep. Full mode selects
  every lane, but may reuse an immutable passing result for a frozen lane when
  its proof key still matches the lane's transitive sources, migrations, locks,
  toolchain, command, and fixtures. Use `--mode full --force --run` to execute
  every lane for release checkpoints and periodic exhaustive audits.
- Tier discipline: `frozen` areas are completed surfaces trusted between full
  sweeps — their lanes leave the inner loop, never existence. Editing frozen
  paths is allowed (greenfield stance stands) but automatically re-arms their
  lanes plus the dependent closure; that escalation is the cost signal, not a
  prohibition. Push mode adds only its bounded sentinel set to the touched
  closure; sprint mode adds every active-tier area. Re-declare tiers at sprint
  boundaries (current frontier = active), use sprint mode during frontier-wide
  checkpoints, and run `--mode full --run` before landing a sprint to `main` so
  the freeze stays honest without rerunning unchanged frozen universes. Run a
  forced full sweep for explicit release checkpoints and periodic exhaustive
  audits. Validate manifest integrity with
  `npm run test:proof-lane-contract`. Normal `--run` executions record current
  costs under ignored `target/proof-lanes/`; deliberately promote a stable cost
  into the tracked baseline with
  `node tools/proof_lane_select.mjs --record <lane-id>`.
- Inspect a frozen lane's current cache decision with
  `npm run proof:cache -- explain <lane-id>`. The explanation names every
  changed input fingerprint, toolchain field, or execution-contract component
  relative to the newest prior valid entry. Plan retention with
  `npm run proof:cache -- gc --dry-run`; it writes an immutable maintenance plan
  under `target/proof-lanes/cache-maintenance/plans/`. After reviewing that
  exact receipt, apply it with
  `npm run proof:cache -- gc --apply <plan-path>`. GC retains current keys, keys
  referenced by the newest terminal full or release receipts, and all in-flight
  keys. Applying a reviewed plan serializes through the shared host lock,
  revalidates the plan digest and complete cache/reachability basis, quarantines
  corrupt entries, writes immutable application intent/result receipts, refuses
  replay, and fails closed when protected evidence alone exceeds `--max-bytes`.
  Audit the complete maintenance receipt graph with
  `npm run proof:cache -- audit`; this is also a bounded push sentinel. It
  validates plan, intent, result, recovery, action, and historical
  post-inventory hashes and fails on missing or tampered linkage. Recover an
  interrupted or failed application with
  `npm run proof:cache -- audit --recover <plan-id>`, review the newly written
  current-state plan, then apply that new plan normally. Recovery never replays
  an attempted plan.
- For frontend browser/readiness work, prefer the role proof and artifact
  contract lanes before pushing.
- For Postgres-backed Rust work, use a local `DATABASE_URL` proof lane and run
  SQLx-heavy tests serially when needed.
- If podman is unavailable, a repo-local Postgres under `target/` is an
  acceptable local proof substitute.
- Canonical `--run` stays on this Darwin checkout. fluffycachy is Mesh's remote
  verification lane, not fmarch's proof host. A Linux green result does not
  cover Darwin browser, visual, CSP, tablet, live-stack, or auth-invite lanes,
  and remote wall-clocks must not be `--record`ed into
  `docs/ops/proof-lane-timings.json`. Isolated overflow of platform-neutral
  Cargo/Postgres leaves is allowed only from a dedicated verify checkout that
  does not share Mesh's `mesh-verify` tree or a writable database with another
  run. See `docs/ops/proof-lane-refactor-scope.md`.
- Cargo `target/` must be a symlink onto an external writable build root, never
  a real directory in the checkout. Discovery is
  `FMARCH_EXTERNAL_BUILD_ROOT` if set, otherwise
  `/Volumes/rabbitx10/build/fmarch` when that volume is writable, otherwise
  fail closed. `bash scripts/check-build-posture.sh --apply` creates the
  destination and symlink when missing. A fluffycachy `fmarch-verify` tree sets
  `FMARCH_EXTERNAL_BUILD_ROOT` and applies posture; that does not move proof
  authority.

## Publishing

- When local proof is green, commit and push in one shell command when possible,
  for example:

  ```sh
  git add <paths> && git commit -m "<atomic message>" && git push origin main
  ```

- Open a PR only when it is useful as a reviewable checkpoint or backup marker.
- Prefer fast-forward-only integration. Avoid merge commits for normal solo flow.

## Deployment promotion

- A push to `main` is allowed to deploy staging automatically. It must not deploy
  production.
- Promote production only from a clean, pushed `main` commit after the required
  local proof, both staging health checks, and commit-attribution checks pass.
- Advance the remote `production` branch to that exact commit as the explicit
  release action. Do not develop on `production`, merge production back into
  `main`, or use it as a compatibility branch.
- Keep staging and production state isolated: separate Railway environments,
  Postgres instances, volumes, domains, variables, and WorkOS environments.

## Followup habit

- After each round, suggest a detailed recommended followup that builds directly
  on the completed work.
