# Railway Staging Target

This is the repeatable bootstrap for fmarch's first externally reachable staging target. It creates a real target that can later produce hosted matrix and identity evidence. It does not make a hosted, release, or production readiness claim by itself.

## Target Shape

Create one Railway project in one region with three services:

| Service | Repository root | Public | Persistent state |
| --- | --- | --- | --- |
| `api` | repository root | yes | Railway Postgres plus one mounted Railway Volume |
| `frontend` | repository root | yes | none |
| `Postgres` | Railway managed database | no | Railway managed database storage/backups |

Both services retain the repository root as their Railway root directory because frontend server routes import shared root-level `tools/` modules. The `api` service uses the root `Dockerfile` and `railway.toml`. Configure the `frontend` service's Config-as-Code path as `/deploy/railway/frontend.railway.toml`; that file selects `Dockerfile.frontend` for the frontend service only.

Keep the API at one replica for this first target. `FMARCH_MEDIA_ROOT` is a mounted filesystem, and the server applies SQL migrations during startup. Scaling, shared media storage, and controlled migration ownership are later hardening work, not properties of this bootstrap.

## Branch And Environment Model

`main` is the only development trunk. Do not introduce a long-lived `develop`,
`staging`, or `preprod` branch. Railway environments, not development branches,
own the release boundary:

| Railway environment | Git source | Deployment rule |
| --- | --- | --- |
| `staging` | `main` | Deploy automatically after a push touches the service's watch paths. |
| `production` | `production` | Deploy only when the release pointer is explicitly advanced to a verified `main` commit. |

The `production` branch is a release pointer, not a place to work. It may only
identify a commit already reachable from `origin/main`. Production promotion
requires a clean worktree, the required local proof, successful staging API and
frontend health checks, and Railway deployment metadata showing that both
staging services run the same commit.

Staging and production must have separate Postgres service instances, media
volumes, public domains, variables, and WorkOS environments. Never duplicate a
resolved database URL or runtime secret across those boundaries. Railway
template references such as `${{Postgres.DATABASE_URL}}` are safe because they
resolve inside the selected environment.

## Provisioning

1. Create a Railway project and add a managed PostgreSQL service named `Postgres`.
2. Add an `api` service from this repository. Leave its root directory at the repository root and use the default `/railway.toml` config path.
3. Add a Railway Volume to `api`, mounted at `/var/lib/fmarch/media`. Railway mounts volumes as `root`; the image entrypoint creates or repairs that directory while privileged, then drops permanently to the unprivileged `fmarch` account (UID 10001) before starting the server. Do not set a Railway runtime UID override.
4. Create a WorkOS AuthKit environment and configure its sign-in endpoint as `https://<frontend>/auth/sign-in` and redirect URI as `https://<frontend>/auth/callback`. Copy `deploy/railway/api.env.example` into Railway Variables, set `DATABASE_URL` as the reference to `Postgres.DATABASE_URL`, and fill in the WorkOS client id, issuer, and JWKS URL. For a fresh database, set `FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID` to the immutable WorkOS user id that should receive the first GlobalAdmin grant; an optional label is display-only. Startup grants it only when no active GlobalAdmin exists. Remove the bootstrap variables after the first successful boot.
5. Do not set `FMARCH_BIND`. When a platform supplies `PORT`, the server binds `0.0.0.0:$PORT`; local development still defaults to `127.0.0.1:4000`, and an explicit `FMARCH_BIND` overrides either behavior.
6. Deploy `api`, generate a public Railway domain, and verify `GET /healthz` returns `{ "ok": true }`.
7. Add a `frontend` service from the same repository. Leave its root directory at the repository root, then set its Config-as-Code path to `/deploy/railway/frontend.railway.toml`.
8. Generate the frontend public domain. Replace the example values in `deploy/railway/frontend.env.example` with the two real HTTPS URLs, the same WorkOS client id, a WorkOS API key, the exact callback URI, and a random cookie password of at least 32 characters. Add them as Railway Variables for `frontend`.
9. Redeploy `frontend`, sign in as the bootstrapped GlobalAdmin, create the first game from `/admin`, choose a pack, and complete `/g/<game>/setup`. Verify a player follows the host-issued WorkOS sign-in link, start the game, refresh the setup and host surfaces, and confirm the started game appears on the board. Browser commands and one-time WebSocket tickets are bound to the verified WorkOS session and local principal rather than caller-supplied identifiers.

## Production Promotion

After a `main` commit has deployed successfully to staging:

1. Verify the worktree is clean and `HEAD` equals `origin/main`.
2. Run the diff-selected push proof (`npm run proof:lanes -- --mode push`) when
   that command is present on the commit; otherwise run the narrow deployment
   contract (`npm run test:railway-staging-target`). At sprint boundaries, run
   the full proof sweep before promotion.
3. Verify both staging health endpoints and confirm the latest successful API
   and frontend Railway deployments carry the same `main` commit SHA.
4. Fast-forward the remote `production` branch to that exact SHA. Railway
   production services must watch `production`, never `main`.
5. Observe terminal `SUCCESS` for both production services and verify their
   deployment metadata carries the promoted SHA before calling the release
   complete.

If either service fails, leave the last successful deployment running, diagnose
the failed deployment, and do not move the release pointer again until the pair
can be proven together. Do not deploy a dirty local directory to production.

Never set `FMARCH_DEV_AUTH=1` or `FMARCH_FRONTEND_FIXTURE_SESSION=1` on either hosted service. They are local proof modes, not hosted-target configuration. The API container must retain its default privileged entrypoint so it can prepare the mounted volume and drop to UID 10001; do not configure `RAILWAY_RUN_UID`.

## Secrets And Evidence

Only Railway receives runtime secrets such as the resolved `DATABASE_URL`, WorkOS API key, and AuthKit cookie password. The repository has examples and variable names, not secret values. The Rust API receives public verification metadata, never the WorkOS API key.

Keep the following evidence packets in a private operator-controlled location outside this repository:

| Packet | Environment variable | Contents |
| --- | --- | --- |
| hosted matrix capture | `FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH` | redacted real-target URLs, capture time/source, race/reload/reconnect/stale observations, and redaction/retention metadata |
| hosted identity capture | `FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH` | redacted account, invite, recovery, abuse, session-secret, and audit-retention evidence |

Do not include passwords, invite tokens, session cookies, bearer tokens, resolved database URLs, or personal data in either packet.

## Hosted Handoff

After both URLs are externally reachable, use a protected operator shell to set the real values:

```sh
export FMARCH_HOSTED_MATRIX_FRONTEND_URL=https://fmarch-staging.example.com
export FMARCH_HOSTED_MATRIX_API_URL=https://api.fmarch-staging.example.com
export FMARCH_HOSTED_MATRIX_GROUP_ID=<real-hosted-game-id>
export FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH=/secure/fmarch/hosted-matrix.json
export FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH=/secure/fmarch/hosted-identity.json

npm run test:dev-test-game-hosted-evidence-operator-checklist
npm run test:dev-test-game-real-hosted-matrix-raw-capture
npm run test:dev-test-game-hosted-target-preflight
npm run test:dev-test-game-hosted-evidence-lane
npm run test:dev-test-game-identity:hosted-evidence
```

The exact hosted-matrix packet schema and its no-secret boundary remain in `tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.template.json`. The broader operator flow remains in `docs/dev-test-game-hosted-evidence-operator-checklist.md`.

## Boundary

Passing the local Railway configuration contract proves that this repository carries a repeatable Railway staging bootstrap. It does not prove a Railway account exists, that a deployment succeeded, that either URL is externally reachable, or that any hosted identity, operations, release, or production requirement has been met.
