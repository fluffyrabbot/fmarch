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

## Provisioning

1. Create a Railway project and add a managed PostgreSQL service named `Postgres`.
2. Add an `api` service from this repository. Leave its root directory at the repository root and use the default `/railway.toml` config path.
3. Add a Railway Volume to `api`, mounted at `/var/lib/fmarch/media`.
4. Copy `deploy/railway/api.env.example` into Railway Variables. Set `DATABASE_URL` as the reference to `Postgres.DATABASE_URL`; do not paste the resolved URL into source control.
5. Do not set `FMARCH_BIND`. When a platform supplies `PORT`, the server binds `0.0.0.0:$PORT`; local development still defaults to `127.0.0.1:4000`, and an explicit `FMARCH_BIND` overrides either behavior.
6. Deploy `api`, generate a public Railway domain, and verify `GET /healthz` returns `{ "ok": true }`.
7. Add a `frontend` service from the same repository. Leave its root directory at the repository root, then set its Config-as-Code path to `/deploy/railway/frontend.railway.toml`.
8. Generate the frontend public domain. Replace the example values in `deploy/railway/frontend.env.example` with the two real HTTPS URLs and add them as Railway Variables for `frontend`.
9. Redeploy `frontend`, then verify its board, login, and a seeded role URL through an external browser. The frontend makes server-side API requests with `FMARCH_API_BASE_URL` and builds its live WebSocket URL from that same value.

Never set `FMARCH_DEV_AUTH=1` or `FMARCH_FRONTEND_FIXTURE_SESSION=1` on either hosted service. They are local proof modes, not hosted-target configuration.

## Secrets And Evidence

Only Railway receives runtime secrets such as the resolved `DATABASE_URL` and future identity-provider credentials. The repository has examples and variable names, not secret values.

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
