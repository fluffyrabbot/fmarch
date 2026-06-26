# Human-Run Test Games

This is the local one-developer path for opening a seeded fmarch game in a browser.
It is a developer harness, not a production or beta-readiness claim.

## Prerequisite

Postgres must be reachable through `DATABASE_URL`. The default is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch
```

With Docker running, the repo-local service is:

```sh
docker compose up -d postgres
```

If Docker is unavailable, use the repo-local helper. It initializes a Postgres
cluster under `target/local-postgres`, starts it on `127.0.0.1:5544`, creates the
`fmarch` database if needed, and prints the exact `DATABASE_URL`:

```sh
npm run dev:postgres -- start
```

The helper also supports:

```sh
npm run dev:postgres -- status
npm run dev:postgres -- print-env
npm run dev:postgres -- stop
```

## Start A Game

The one-command local path starts repo-local Postgres, prebuilds the Rust API,
runs the test-game harness, and stops Postgres when the harness exits:

```sh
npm run dev:test-game:local
```

Any `dev:test-game` option can be forwarded after `--`:

```sh
npm run dev:test-game:local -- --name local --reset
```

To run the underlying harness against an already-started database:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run dev:test-game
```

The command starts a Rust API, starts the SvelteKit frontend, seeds one
`mafiascum` D01 game through `/commands`, creates invite-backed browser role
credentials for `admin`, `host`, `player`, `actionPlayer`, `deniedPlayer`, and
`cohost`, prints role entry URLs with the invite prefilled, and keeps the
servers alive until Ctrl-C.

On a cold Rust target directory, the API step can spend a few minutes compiling
before `/healthz` is reachable. The harness prints the selected API URL, the
Cargo process id, Cargo compile progress, and periodic health-wait updates so a
real build is distinguishable from a stuck server.

To make that compile phase explicit before starting the browser harness, run:

```sh
npm run dev:test-game:prebuild
```

It also writes:

```text
target/dev-test-game/session.json
target/dev-test-game/session.md
target/dev-test-game/proof-run.json
target/dev-test-game/ops-artifacts.json
target/dev-test-game/ops-artifacts.md
target/dev-test-game/ops-admin-proof.json
target/dev-test-game/seed-fixture-summary.json
target/dev-test-game/seed-fixture-summary.md
target/dev-test-game/seed-admin-proof.json
target/dev-test-game/release-readiness-checklist.json
target/dev-test-game/release-readiness-checklist.md
target/dev-test-game/release-admin-proof.json
target/dev-test-game/backup-admin-proof.json
target/dev-test-game/identity-admin-proof.json
target/dev-test-game/named-games.json
```

Open a role invite URL from `session.md` and submit. The invite token is
prefilled in the URL and repeated in the artifact for recovery/debug use.

## Repeated Runs

By default, the friendly name is `local`.

```sh
npm run dev:test-game -- --name local
```

If that named game already exists in `target/dev-test-game/named-games.json`, the
harness reuses the same game id and does not reseed it. To make a fresh clean
game under the same name:

```sh
npm run dev:test-game -- --name local --reset
```

To require reuse and fail if the name is unknown:

```sh
npm run dev:test-game -- --name local --reuse
```

`--reset` does not delete append-only event history. It creates a fresh game id
for the friendly name, preserving the event-store invariant.

## Proof Commands

The no-server contract gate is:

```sh
npm run test:dev-postgres-contract
npm run test:dev-test-game-contract
```

The live local gate is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live
```

The saved proof artifact validator is:

```sh
npm run test:dev-test-game-proof
```

The local release-readiness checklist generator is:

```sh
npm run test:dev-test-game-readiness
```

The local release-readiness admin browser proof is:

```sh
npm run test:dev-test-game-release-admin-proof
```

The local ops artifact bundle generator is:

```sh
npm run test:dev-test-game-ops
```

The local seed/demo fixture summary generator is:

```sh
npm run test:dev-test-game-seed-fixture
```

After the live gate has written the dev-test-game proof, ops bundle, and seed
fixture, the local identity-adapter proof for replacing dev tokens without
changing role surfaces and proving local lifecycle recovery is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-identity
```

That command also writes `target/dev-test-game/identity-admin-proof.json` by
clicking from the seeded admin overview into the native local identity-adapter
detail route, where lifecycle checks and admin/host/player role surfaces are
visible without raw invite-token echoes.

The local backup/restore drill for this spine is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-backup-restore
```

That command also writes `target/dev-test-game/backup-admin-proof.json` by
clicking from the seeded admin overview into the native local backup/restore
detail route, where dump/restore checks and restored role sessions are visible.

That live gate first runs `npm run dev:test-game:prebuild`, then starts the API
and frontend, seeds a fresh `live-proof` game, verifies host and player browser
entry through `/auth/login`, checks that those browser sessions came from
invite-issued `fmarch_session` cookies, verifies host/player capabilities
through `/auth/session?game=...`, drives a small core-loop proof, then checks
the generated session artifact and validates `target/dev-test-game/proof-run.json`
against the current `session.json`. It writes
`target/dev-test-game/release-readiness-checklist.{json,md}` from the validated
proof run, then writes `target/dev-test-game/ops-artifacts.{json,md}` with
redacted role entry URLs, source artifact checksums, command and lane counts,
and a local proof boundary. It then writes
`target/dev-test-game/seed-fixture-summary.{json,md}` with redacted role URLs,
seeded slots, local demo scenarios, and proof-lane mappings, then writes
`target/dev-test-game/seed-admin-proof.json` by clicking from the seeded admin
overview into the native local seed fixture detail route. The final readiness
checklist pass consumes the ops bundle plus the seed fixture summary and its
admin browser proof, and promotes only those local checks. It then writes
`target/dev-test-game/release-admin-proof.json` by clicking from the seeded
admin overview into the native release-readiness detail route, where passed
local checks and remaining unproven release items are visible.

The core-loop proof uses the generated role URLs: the host page locks D01
through the hydrated phase control, the player page submits a vote into the
locked phase and renders `Reject PhaseLocked` recovery, and the host page unlocks
D01 again so the human-run game remains usable after verification.

The action-loop proof continues in the same seeded game: the host page resolves
D01 and advances to N01, the `actionPlayer` page renders a live `factional_kill`
action, recovers from an invalid self-action, submits the legal action, and then
the host page resolves N01 and advances to D02.

The private-channel proof uses the same invite-backed role surfaces: the player
page opens the pack-declared `private:mafia_day_chat`, submits a private
`SubmitPost` ACK, and a separate `deniedPlayer` page renders the 403 `Back to
board` recovery for that same channel.

The multiplayer-hardening proof promotes the first retry, reconnect,
concurrent-vote, and stale-client behaviors into the same browser harness: the
player page replays one `SubmitPost` with the same durable `command_id` and
verifies the original ACK plus exactly one projected post, drops and
automatically reconnects the player live projection while a server-side post
lands, refreshes command state after a stale locked-phase vote reject, submits
two concurrent D02 votes from separate role pages and verifies converged browser
plus API votecount, keeps a second action-player page frozen on N01 until its
stale `factional_kill` rejects with `Reject PhaseLocked` and refreshes to D02
without the stale action control, and the host page sends a stale `UnlockThread`
and verifies the `Reject PhaseLocked` recovery message while D02 remains open.

`proof-run.json` is the compact machine-checkable truth surface for this local
harness. It records the passed lanes, seed game identity, artifact paths, and
explicit non-claims. The validator recomputes it from `session.json` and fails
when the proof-run artifact is stale, missing a required lane, or claims
production/release readiness.

The release-readiness checklist is intentionally not a release gate. It keeps
`releaseReady: false` and `productionReady: false`. Without an explicit
backup/restore artifact, it keeps `backup-restore-drill` unproven. After
`npm run test:dev-test-game-backup-restore`, the checklist consumes
`target/live-stack-backup-restore-drill/local-backup-restore-proof.json` plus
`target/live-stack-backup-restore-drill/local-live-stack.dump`, then attaches
`target/dev-test-game/backup-admin-proof.json`, and promotes only the local
dump/restore check with its seeded admin overview-to-detail browser proof. After
`npm run test:dev-test-game-ops`, the
checklist consumes `target/dev-test-game/ops-artifacts.json` plus
`target/dev-test-game/ops-admin-proof.json` and promotes only the local ops
artifact bundle with its seeded admin overview-to-detail browser proof. After
`npm run test:dev-test-game-seed-fixture`,
the checklist consumes `target/dev-test-game/seed-fixture-summary.json` plus
`target/dev-test-game/seed-admin-proof.json` and promotes only the local
seed/demo fixture inventory with its seeded admin overview-to-detail browser
proof. After
`npm run test:dev-test-game-identity`, the checklist consumes
`target/auth-invite-role-proof/invite-role-proof.json` plus
`target/dev-test-game/identity-admin-proof.json`, and promotes only the local
identity-adapter proof that invite-issued opaque sessions preserve the same role
URL and capability architecture through local session rotation, session
revocation, revoked-invite rejection, replacement-invite recovery, and a seeded
admin overview-to-local-identity-adapter-detail browser proof without raw
credential echoes.
Hosted account lifecycle, invite delivery, account recovery, rate limits, abuse
controls, production session-secret policy, hosted audit retention/export,
hosted deployment, hosted demo fixtures and sanitized demo-data policy,
production-like backup storage/PITR, exhaustive race coverage, hosted
observability/operations, and a human release runbook remain outside that local
proof.

## Boundary

This proves a local seeded browser test-game workflow for one developer, plus
specific duplicate-command, player reconnect, concurrent vote race, stale player
vote, stale action conflict, stale host control recovery, local artifact-bundle,
local seed/demo fixture inventory, local identity-adapter shape, and local
backup/restore lanes. It does not prove hosted production account lifecycle,
invite delivery, account recovery, rate limits, abuse controls, production
session-secret policy, hosted deployment, hosted demo fixtures,
production-like backup/PITR, exhaustive race coverage, hosted
logs/metrics/traces, upload or transcode behavior, beta readiness, or
rollback/delete semantics for existing append-only games. The harness still
uses an internal root dev session only to mint local invites; production
accounts/sessions/invites remain a later identity layer over the same role
surfaces.
