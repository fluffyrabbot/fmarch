# Human-Run Test Games

This is the local one-developer path for opening a seeded fmarch game in a browser.
It is a developer harness, not a production or beta-readiness claim.

## Prerequisite

The harness migrator uses `DATABASE_MIGRATION_URL`. Standalone SQLx test gates
use `DATABASE_URL`; do not confuse that test connection with the restricted
application role used by a running API. The local migrator default is:

```sh
DATABASE_MIGRATION_URL=postgres://fmarch:fmarch@127.0.0.1:5544/fmarch
```

For the container-backed local database, fmarch requires both Podman and
`podman-compose`; Docker is not a local prerequisite. Start the repo-local
service through the wrapper, which verifies both tools and forces
`PODMAN_COMPOSE_PROVIDER=podman-compose` before it invokes `podman compose`:

```sh
npm run dev:postgres:podman -- up -d postgres
```

To inspect the resolved Compose configuration with that same provider policy:

```sh
npm run dev:postgres:podman -- config
```

The non-container repo-local helper remains available when a local Postgres
cluster is preferred. It initializes a cluster under `target/local-postgres`,
starts it on `127.0.0.1:5544`, creates the `fmarch` database if needed, and
prints the exact `DATABASE_URL`:

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

The one-command local path starts repo-local Postgres, leases a disposable
database at that local endpoint, prebuilds the Rust API, enables the
debug-build deterministic identity delivery gateway, runs the test-game
harness, drops the disposable database, and stops Postgres when the harness
exits:

```sh
npm run dev:test-game:local
```

Any `dev:test-game` option can be forwarded after `--`:

```sh
npm run dev:test-game:local -- --name local --reset
```

To run the underlying harness against an already-started database:

```sh
DATABASE_MIGRATION_URL=postgres://fmarch:fmarch@127.0.0.1:5544/fmarch npm run dev:test-game
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

Primary outputs under `target/dev-test-game/` are `session.json`/`session.md`,
`proof-run.json`, `named-games.json`, and the generated spine manifest, proof
graph, readiness checklist, and next-action reports. Their JSON/Markdown
companions link the detailed seed, identity, recovery, and operator receipts;
use those manifests rather than a separately maintained artifact list.

Open a role login URL from `session.md` and submit. Invite tokens are prefilled
in invite URLs; refreshed session credentials are repeated in the artifact for
recovery/debug use.

## Repeated Runs

Named-game reuse applies to the underlying harness against a retained database.
The default `dev:test-game:local` wrapper leases and drops a disposable database;
use an already-started database when you need to resume the same game later.

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
npm run test:database-schema:static
npm run test:dev-test-game-contract
```

The schema gate requires local Postgres. It checks migration and catalog
contracts against scratch databases. Ordinary changes append migrations and
update the generated snapshot; they never rewrite an applied baseline. See
[database schema evolution](database-schema-evolution.md) for the upgrade lane:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:database-schema
```

The broader serial local database lane includes that contract plus every
commands/projections test:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:local-postgres-ci
```

The core gameplay live gate is the faster role-URL proof lane. The local command
starts repo-local Postgres, prebuilds the Rust API, runs the seeded live browser
proof, validates `proof-run.json`, runs the core-loop and hardening admin
proofs, regenerates release readiness, and stops Postgres when it exits:

```sh
npm run test:dev-test-game-core-live:local
```

The full dev-test-game spine keeps the broader local proof chain intact. The
local command starts repo-local Postgres, runs the core gameplay live gate plus
seed fixtures, backup/restore, identity, admin spine, proof graph, next-action,
and final release-readiness refreshes, then stops Postgres:

```sh
npm run test:dev-test-game-live:local
```

For an already-started database, use the underlying spine command:

```sh
DATABASE_MIGRATION_URL=postgres://fmarch:fmarch@127.0.0.1:5544/fmarch npm run test:dev-test-game-live
```

The saved proof artifact validator is:

```sh
npm run test:dev-test-game-proof
```

The local release-readiness checklist generator is:

```sh
npm run test:dev-test-game-readiness
```

The default next-action handoff is strictly local-development guidance. Once
the core, hardening, ops, seed/demo, and identity-adapter rows are current, it
reports `all-artifacts-fresh` instead of promoting hosted identity work.
Hosted identity is a deferred operator/release item, not a blocker for the next
seeded-game feature.

For a real operator-provided packet, use the separate hosted-evidence lane.
It requires `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH` to resolve outside
`tools/fixtures/`, refreshes the evidence intake, its browser admin proof, the
family progression artifacts, and readiness.
It never writes a fixture packet or makes release/production claims:

```sh
FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=/secure/operator-evidence/hosted-identity-redacted.json \
  npm run test:dev-test-game-identity:hosted-evidence
```

The existing `test:dev-test-game-identity:operator` lane remains a synthetic
target-local predicate test and must not be used to ingest a real operator
packet.

The operator proof target is
`target/dev-test-game/hosted-identity-evidence-operator-admin-proof.json`. It
remains a local predicate proof and does not prove live hosted account, session,
or invite traffic. The release runbook owns the later hosted deployment and
operations handoffs; the default local next-action surface does not promote
either one.

The hosted deployment evidence lane accepts a raw hosted matrix packet through
`FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH`. Start by checking the operator
template, then copy it to a private filled packet and point the env var at that
copy:

```sh
npm run test:dev-test-game-hosted-matrix-raw-evidence-template-proof
```

The source-controlled operator checklist is a separate local contract and admin
handoff proof. It supports the later release-runbook handoff without changing
the default local next-action selector or making a hosted deployment claim:

```sh
npm run test:dev-test-game-hosted-evidence-operator-checklist
npm run test:dev-test-game-hosted-evidence-operator-checklist-admin-proof
```

With no live hosted packet configured, the release-runbook
`hosted-deployment` blocker stays pointed at the raw-capture proof target until
real externally captured evidence is present:

```sh
npm run test:dev-test-game-real-hosted-matrix-raw-capture:handoff
```

To inspect the difference between fixture-only handoff and real capture
metadata, compare the checked examples:

```sh
FMARCH_HOSTED_MATRIX_FRONTEND_URL=https://fmarch-demo.example.test FMARCH_HOSTED_MATRIX_API_URL=https://api.fmarch-demo.example.test FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.operator-fixture.json npm run test:dev-test-game-real-hosted-matrix-raw-capture
FMARCH_HOSTED_MATRIX_FRONTEND_URL=https://fmarch-demo.example.test FMARCH_HOSTED_MATRIX_API_URL=https://api.fmarch-demo.example.test FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json npm run test:dev-test-game-real-hosted-matrix-raw-capture
```

The template lives at
`tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.template.json`. The
real-capture intake requires the raw hosted matrix evidence contract plus
real hosted values for `frontendBaseUrl`, `apiBaseUrl`,
`capture.externallyCaptured=true`, `capture.capturedAt`,
`capture.captureSource`, redaction booleans for raw role credentials, invite
tokens, and session cookies, and `capture.retention.policy`. A passed intake can
advance hosted target preflight to external hosted-matrix normalization, but it
still keeps `releaseReady` and `productionReady` false until the broader hosted
deployment, operations, rollback, and release-readiness evidence exists.
The raw-capture intake, target preflight, and hosted evidence lane carry a
SHA-256 of the raw packet. If the packet changes, rerun capture, preflight, and
the lane; readiness will not reuse the older hosted proof.

The hosted identity evidence lane accepts a redacted operator packet through
`FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH`. To inspect the packet shape and admin
handoff without making a hosted-readiness claim, exercise the placeholder
template:

```sh
FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_identity_evidence.placeholder.json npm run test:dev-test-game-hosted-identity-evidence
FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=tools/fixtures/dev_test_game_hosted_identity_evidence.placeholder.json npm run test:dev-test-game-hosted-identity-evidence-admin-proof
```

That placeholder keeps `releaseReady` and `productionReady` false. It proves
only the redacted packet schema, role-surface adapter comparison, and seeded
admin detail visibility; hosted accounts, sessions, invite delivery, recovery,
abuse controls, session-secret policy, and audit retention remain unproven.

The fixture-backed progression summary lists the first operator packet families
that can move from missing to provided while keeping hosted readiness blocked:

```sh
npm run test:dev-test-game-hosted-identity-progression-summary
npm run test:dev-test-game-hosted-identity-progression-admin-proof:batch
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=hosted-account-lifecycle npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=invite-delivery npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=account-recovery npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=abuse-and-rate-limit npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=session-secret-policy npm run test:dev-test-game-hosted-identity-progression-admin-proof
FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=hosted-audit-retention-export npm run test:dev-test-game-hosted-identity-progression-admin-proof
npm run test:dev-test-game-hosted-identity-evidence-admin-proof
npm run test:dev-test-game-hosted-identity-operator-admin-proof
```

The former partial/complete admin-proof aliases were retired. Use the named
progression, evidence, or operator command above; each now identifies the exact
predicate it proves.

Those progression admin proofs are local role-surface checks. They prove the
seeded admin detail can show the specific missing redacted packet and the
fixture-backed recovered packet for that evidence family; they do not prove real
hosted identity traffic, release readiness, or production readiness.
The `hosted-account-lifecycle`, `invite-delivery`, `account-recovery`,
`abuse-and-rate-limit`, `session-secret-policy`, and
`hosted-audit-retention-export` progressions are the first operator-packet
flows: each admin proof reads a redacted packet with only that evidence family
provided, so the admin handoff shows one family as provided while hosted
identity readiness remains blocked on the remaining hosted identity packets.
The evidence admin proof (and the deprecated complete alias) can exercise an
all-families redacted packet and prove the seeded admin detail can show all six
evidence-family sections as provided while `releaseReady` and `productionReady`
remain false.
The operator admin proof writes a target-local example packet under
`target/operator-evidence/`, proves that non-fixture path through the same
seeded admin role URL, and records that the hosted-production-identity
readiness item clears only for an operator-provided packet path. It is still a
local predicate proof and does not prove live hosted identity traffic, release
readiness, or production readiness.
When the explicit hosted-identity next-action lane is run, this predicate is a
one-way handoff: before the operator proof is current it selects the local
operator predicate command; after a current operator proof it selects the real
hosted packet-intake command instead of rerunning the predicate. Exercise that
selector with:

```sh
npm run test:dev-test-game-next-action:hosted-identity
```

The selector rejects fixture-backed, path-mismatched, or incomplete operator
proofs and returns to the operator predicate recovery command.
Readable hosted packets are content-addressed with a SHA-256 recorded in the
evidence and admin proof. Readiness skips a default proof when the current
packet digest no longer matches; an explicitly supplied stale proof fails the
lane instead of being silently promoted.
The admin spine terminal batch receipt records the default next-action blocker
and the opt-in hosted-identity predicate as one `next-action-sequence-handoff`
pair, while still keeping their source artifacts separate:
`target/dev-test-game/next-action-admin-proof.json` for the canonical sequence
blocker and `target/dev-test-game/hosted-identity-next-action-admin-proof.json`
for the hosted-identity predicate.
To run that predicate as an explicit opt-in identity spine phase, use:

```sh
npm run test:dev-test-game-identity:operator:local
```

That local command starts repo-local Postgres, runs
`test:dev-test-game-identity:operator` with `DATABASE_URL`, and stops Postgres
when the spine exits. If Postgres is already running, the underlying command is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-identity:operator
```

The default `npm run test:dev-test-game-identity` spine does not consume that
operator packet and keeps the hosted-production-identity readiness blocker
visible.

The local release-readiness admin browser proof is:

```sh
npm run test:dev-test-game-release-admin-proof
```

The matching artifact contract writes
`target/dev-test-game/release-admin-proof-contract.json` and verifies that the
release-readiness diagnostics listed in
`target/dev-test-game/release-readiness-checklist.json` are also browser-visible
in `target/dev-test-game/release-admin-proof.json`:

```sh
npm run test:dev-test-game-release-admin-proof-contract
```

The ordered aggregate admin-spine browser proof is:

```sh
npm run test:dev-test-game-admin-spine
```

The seeded admin overview-to-local-admin-spine detail browser proof is:

```sh
npm run test:dev-test-game-admin-spine-admin-proof
```

The seeded admin overview-to-local-proof-freshness detail browser proof is:

```sh
npm run test:dev-test-game-proof-freshness-admin-proof
```

The proof-freshness detail includes a `local-next-action` handoff link to the
ranked recovery receipt, so stale or missing artifacts point at the generated
next local command instead of leaving recovery selection implicit.

The generated spine manifest, which records proof command order, evidence env
wiring, current artifact freshness statuses, per-artifact refresh commands for
the aggregate bundle and each admin proof surface, terminal graph/next-action
artifacts, and the final proof-freshness command/artifact without claiming release
or production readiness, is:

```sh
npm run test:dev-test-game-spine-manifest
```

The local-spine-manifest detail links to the proof-freshness dashboard and the
ranked next-action receipt, making the manifest a navigable proof graph rather
than only a static artifact inventory.

The generated proof graph, which records local proof nodes, role URLs, artifact
paths, dependency edges, and recovery commands without release or production
claims, and fails if it no longer covers every aggregate admin-spine proof
surface, is:

```sh
npm run test:dev-test-game-proof-graph
```

The seeded admin overview-to-local-proof-graph detail browser proof is:

```sh
npm run test:dev-test-game-proof-graph-admin-proof
```

The generated next-action receipt, which reads the spine manifest and emits the
highest-priority stale or missing development-spine recovery/freshness command
plus a ranked selection trace without claiming release or production readiness,
is:

```sh
npm run test:dev-test-game-next-action
```

The seeded admin overview-to-local-next-action detail browser proof is:

```sh
npm run test:dev-test-game-next-action-admin-proof
```

The seeded admin overview-to-local-spine-manifest detail browser proof is:

```sh
npm run test:dev-test-game-spine-manifest-admin-proof
```

The local-admin-spine detail links back to the local-spine-manifest detail so
the aggregate admin proof can be followed into the generated command and
artifact freshness graph.

The local ops artifact bundle generator is:

```sh
npm run test:dev-test-game-ops
```

The ops bundle checksums the session, proof run, core-loop admin proof, and
hardening admin proof, plus backup/restore artifacts when supplied. It is an
upstream input to release readiness and never reads the readiness checklist;
the declarative ops plan therefore has one acyclic `ops -> ops admin ->
readiness` direction.

The local seed/demo fixture summary generator is:

```sh
npm run test:dev-test-game-seed-fixture
```

After the live gate has written the dev-test-game proof, ops bundle, and seed
fixture, the local identity-adapter proof for replacing dev tokens without
changing role surfaces, proving local lifecycle recovery, and proving a host
can issue a game-scoped local player invite from the seeded host role URL is:

```sh
npm run test:dev-test-game-identity:local
```

That command also writes `target/dev-test-game/identity-admin-proof.json` by
clicking from the seeded admin overview into the native local identity-adapter
detail route, where lifecycle/delegated-issuance checks and admin/host/player
role surfaces are visible without raw invite-token echoes. The delegated
issuance check clicks the seeded host console's player-invite control, verifies
the stored local game scope, and redeems that invite through the existing player
role URL. The live-stack proof also verifies the same player-invite panel
retargets from the current host-console slot projection after replacement.
Direct identity spine invocations refresh the existing ops and seed/demo spine
artifacts before consuming them in identity readiness. The full live spine has
already produced those prerequisites, so its embedded identity phase keeps the
identity-only plan and does not repeat those producers.

The local backup/restore drill for this spine is:

```sh
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-backup-restore
```

That command also writes `target/dev-test-game/backup-admin-proof.json` by
clicking from the seeded admin overview into the native local backup/restore
detail route, where dump/restore checks and restored role sessions are visible.

## Scenario and receipt ownership

The core live spine drives role URLs against the real local API and validates
command receipts plus refreshed projections. Its scenario modules own exact
posting, voting, phase, host-prompt, action, replacement, and private-channel
recovery steps. The full spine adds seed, identity, backup/restore, and operator
artifact linkage.

`target/dev-test-game/proof-run.json` records executed gameplay evidence;
`spine-manifest.json` and `proof-graph.json` describe artifact dependencies.
Read their current generated Markdown companions and readiness checklist for
missing, stale, or failed evidence. The command recipes above are entry points,
not a second handwritten inventory of every assertion.

## Boundary

This is a local developer harness. Its receipts cover the scenarios executed by
that run: gameplay and stale-command recovery, replacement authority, private
rooms, local identity, backup/restore, and artifact linkage. Inspect
`proof-run.json`, the spine manifest, and the generated readiness checklist for
the exact scenario set instead of treating this document as a passing receipt.

Local identity/bootstrap and fixture delivery do not establish hosted delivery,
distributed abuse protection, production backup/PITR, observability retention,
or human release approval. The full media upload/variant path has separate
[frontend live-stack proof](frontend-proof.md); a test-game receipt only covers
it when its executed scenario records that evidence. `--reset` creates another
game identity and never authorizes deleting append-only history.

The [proof-product freeze](proof-product-freeze.md) limits further local-only
admin-proof growth. Use [the release runbook](railway-staging-target.md) and
its referenced evidence procedures for hosted work.
