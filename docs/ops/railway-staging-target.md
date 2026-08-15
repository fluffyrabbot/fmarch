# Railway Staging Target

This is the repeatable bootstrap for fmarch's first externally reachable staging target. It creates a real target that can later produce hosted matrix and identity evidence. It does not make a hosted, release, or production readiness claim by itself.

## Target Shape

Create one Railway project in one region with three repo-backed services, one
managed database, and two purpose-separated object stores:

| Service | Repository root | Public | Persistent state |
| --- | --- | --- | --- |
| `api` | repository root | yes | Railway Postgres, shared media Bucket, plus a dedicated shared subject-authority Bucket |
| `migrator` | repository root | no | none; one-shot schema/ACL authority |
| `frontend` | repository root | yes | none |
| `Postgres` | Railway managed database | no | Railway managed database storage/backups |
| `media` | Railway Bucket | no | S3-compatible canonical media and variants |
| `subject-authority` | Railway Bucket | no | immutable authority genesis, wrapped subject keys, and revocation journal |

All repo-backed services retain the repository root as their Railway root
directory because frontend server routes import shared root-level `tools/`
modules. The `api` service uses the root `Dockerfile`. Configure `migrator` with
`/deploy/railway/migrator.railway.toml` and `frontend` with
`/deploy/railway/frontend.railway.toml`. The former runs the exact image's
`fmarch-migrate` binary once; the latter selects `Dockerfile.frontend`.

Run the API at two replicas. Both use the same S3-compatible `media` bucket and
never receive schema-owner or key-admin authority. The separate one-shot
`migrator` receives `DATABASE_MIGRATION_URL` plus the two role-bootstrap
passwords, applies migrations through the schema-owner connection, reconciles exact ACLs, and
audits the authority catalog. The API receives only an application
`DATABASE_URL` whose login is `fmarch_application`; its bounded, read-only
`fmarch-schema-gate` pre-deploy command waits for the corresponding schema/ACL
state and fails closed before a new replica is admitted. This shape is required
by the canonical hosted multi-node race gate; a one-replica mounted-volume or
database-owner API cannot close 1.0.

## Branch And Environment Model

`main` is the only development trunk. Do not introduce a long-lived `develop`,
`staging`, or `preprod` branch. Railway environments, not development branches,
own the release boundary:

| Railway environment | Git source | Deployment rule |
| --- | --- | --- |
| `staging` | `main` | Deploy migrator, API, and frontend after every push so all three attest the exact same `main` SHA. |
| `production` | `production` | Deploy all three only when the release pointer is explicitly advanced to a verified `main` commit. |

The canonical Railway domains are:

| Environment | API | Frontend |
| --- | --- | --- |
| `staging` | `https://fmarch-staging.up.railway.app` | `https://fmarch-frontend-staging.up.railway.app` |
| `production` | `https://fmarch-production.up.railway.app` | `https://fmarch-frontend-production.up.railway.app` |

The `production` branch is a release pointer, not a place to work. It may only
identify a commit already reachable from `origin/main`. Production promotion
requires a clean worktree, the required local proof, successful staging
migrator/API/frontend deployments, API and frontend health checks, and Railway
deployment metadata showing that all three services run the same commit.

Do not configure service watch paths on any repo-backed service. Skipping a
migrator, API, or frontend build for an apparently unrelated commit breaks the exact-SHA
release invariant and makes that `main` commit intentionally unpromotable.

Railway GitHub-push deployments are independent: reference-variable ordering
does not order multiple services triggered by the same push. The bounded API
schema gate therefore tolerates normal migrator progress but never migrates. If
the migrator cannot finish within the checked 180-second bound, Railway must leave the prior API
deployment serving; after the migrator reaches `SUCCESS`, redeploy the API at
that exact SHA. Do not lengthen the gate into an unbounded availability wait.
See Railway's
[deployment dependency boundary](https://docs.railway.com/deployments/deployment-actions#when-ordering-does-not-apply).

Staging and production must have separate Postgres service instances, media
buckets, subject-authority buckets, public domains, variables, and WorkOS environments. A
different database name on the same PostgreSQL server is not isolation: the
fixed `fmarch_application` and `fmarch_key_admin` roles are cluster-global.
Each environment therefore needs a dedicated server endpoint. The authority
reconciler governs the current database only; it does not revoke `PUBLIC
CONNECT` across arbitrary databases on a shared cluster, so
shared clusters are unsupported rather than partially isolated. Promotion normalizes hostname and
effective port and rejects a shared server even when database paths and
passwords differ. Never duplicate a
resolved database URL or runtime secret across those boundaries. Railway
template references such as `${{Postgres.DATABASE_URL}}` are safe only on the
environment-local migrator; that owner URL must never appear on API, frontend,
or in a key-admin shell.

The database authority split is fixed, not operator-selectable:

| Process | Credential | Role/authority |
| --- | --- | --- |
| `migrator` | `DATABASE_MIGRATION_URL` | Railway schema-owner login; the binary migrates, reconciles ACLs, audits both restricted roles, and exits |
| `api` and `fmarch-schema-gate` | `DATABASE_URL` | `fmarch_application`, long-lived exact application DML only |
| protected one-shot operator shell | `DATABASE_KEY_ADMIN_URL` | `fmarch_key_admin`, only the registered runtime-KEK lifecycle/reseal surface |

The API and frontend receive neither role-bootstrap password. The migrator
receives both bootstrap passwords but never a key-admin URL or event KEK. The
key-admin URL and event KEKs exist together only in a protected ephemeral shell
using `deploy/railway/key-admin.env.example`; they are not Railway service
variables.

The schema owner is confined to the one-shot migrator and owns the application
schema, tables, sequences, functions, and `_sqlx_migrations`. ACL reconciliation
revokes prior grants before applying the checked manifest. The application and key-admin roles are
LOGIN roles with `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS`; neither inherits or can assume the owner. `PUBLIC` has no database
`CREATE`/`TEMP`, schema access, table/sequence access, or default function
`EXECUTE`. Every connection proves its expected `current_user`/`session_user`
and fixed `search_path`; do not place a transaction-pooling proxy between these
processes and Postgres. Do not set ambient `PG*` connection variables such as
`PGOPTIONS`, `PGSERVICE`, or `PGSSLMODE`; each process-specific URL is the sole
authority for endpoint, database, user, TLS mode, and session options. Every
hosted API, migrator, and protected key-admin URL must contain exactly one explicit
`sslmode=require`, `sslmode=verify-ca`, or `sslmode=verify-full`; promotion
rejects an omitted mode and `disable`, `allow`, or `prefer` for API/migrator,
and the key-admin operator contract applies the same rule. Process startup rejects ownership, dangerous role
attributes or memberships, missing or extra object privileges, unsafe PUBLIC
authority, disabled lifecycle triggers, and an unsafe session/search path.

This is an authority reduction, not complete application-compromise containment.
The API keeps broad business DML and active runtime KEKs, so a compromised API
can corrupt the business state its role may mutate and expose plaintext it may
normally decrypt. The split protects DDL, migration history, database guards,
and KEK lifecycle operations from that process; it does not guarantee all
business integrity or plaintext confidentiality after API compromise.

## Provisioning

1. Create a Railway project and add a managed PostgreSQL service named `Postgres`.
2. Add a private `migrator` service from this repository. Leave its root at the
   repository root, set its Config-as-Code path to
   `/deploy/railway/migrator.railway.toml`, and copy
   `deploy/railway/migrator.env.example`. Generate distinct, URI-safe
   application and key-admin passwords in each environment. Only this service
   receives the environment-local `${{Postgres.DATABASE_URL}}` composed as
   `DATABASE_MIGRATION_URL` with exactly one secure `sslmode` and both password
   values. It has no public domain, TCP proxy, event keys, bucket
   credentials, or identity credentials. Its `NEVER` restart policy preserves
   one-shot semantics.
3. Deploy `migrator` once. It must create/reconcile the fixed
   `fmarch_application` and `fmarch_key_admin` login roles, apply migrations
   through the schema-owner connection, reconcile exact privileges/default
   ACLs, and exit successfully. Repeat this reconciliation after every restore;
   migration history alone is not ACL evidence.
4. Add an `api` service from this repository. Leave its root directory at the
   repository root and use `/railway.toml`. Construct its only database secret,
   `DATABASE_URL`, with username `fmarch_application` and the application
   password held by the migrator; percent-encode the password when composing
   the URL and include exactly one secure `sslmode`. Do not copy the owner URL
   or either standalone password onto API.
5. Add a Railway Bucket named `media`. Bind its S3 endpoint, bucket, region,
   access key, and secret key to both API replicas through Railway reference
   variables. Use the bucket's globally unique `BUCKET` value rather than its
   display-only `RAILWAY_BUCKET_NAME`, and declare the credential's URL style;
   current Railway buckets use `virtual-host`. The media adapter composes the
   bucket hostname from Railway's published base endpoint before handing the
   complete endpoint to `object_store`. Do not mount a per-replica media volume
   in staging or production.
6. Add a second Railway Bucket named `subject-authority`. It is a shared authority for both API replicas, not a mounted volume, and must never be the media bucket or be cloned across staging and production. Bind its five S3 reference variables plus an independently generated authority UUID, wrapping key/KID, journal-authentication key/KID, and revision from `deploy/railway/api.env.example`. Before the first normal API start, run the exact release image once with `fmarch-server --bootstrap-subject-authority`; this create-only command writes and verifies the immutable manifest and refuses an existing authority. Normal startup never creates a manifest: it binds an empty database to that genesis, lists and reconciles revocations, and verifies every active subject key before listeners start. Copy the remaining template values into Railway Variables. Create a WorkOS AuthKit environment and configure its sign-in endpoint as `https://<frontend>/auth/sign-in`, redirect URI as `https://<frontend>/auth/callback`, and default sign-out redirect/application homepage as the exact canonical root `https://<frontend>/`. The application deliberately sends no caller-controlled `return_to`; do not configure a wildcard or alternate sign-out target. Fill in the WorkOS client id, issuer, and JWKS URL. The template is explicitly WorkOS-only (`FMARCH_CLASSIC_AUTH=0`). A hosted classic-plus-WorkOS deployment must instead set `FMARCH_CLASSIC_AUTH=1` and configure `FMARCH_IDENTITY_DELIVERY_ENDPOINT`, `FMARCH_IDENTITY_DELIVERY_PROVIDER_ID`, and `FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN` for a real HTTPS provider; startup fails closed when classic is enabled without that transport. For a fresh database, set `FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID` to the immutable WorkOS user id that should receive the first GlobalAdmin grant; an optional label is display-only. Startup grants it only when no active GlobalAdmin exists. Remove the bootstrap variables after the first successful boot.
   This closes database-only rollback; Railway Bucket administration is not an object-lock/WORM
   boundary. If coordinated database-plus-authority rollback is in scope, deploy the same adapter
   against storage with enforced object retention and KMS custody before production promotion.
7. Do not set `FMARCH_BIND`. When a platform supplies `PORT`, the server binds `[::]:$PORT` for public IPv4 and private-network IPv6 reachability; local development still defaults to `127.0.0.1:4000`, and an explicit `FMARCH_BIND` overrides either behavior.
8. Deploy `api`; require its bounded `fmarch-schema-gate` pre-deploy command to
   prove the migrator-completed schema and authority audit through the
   application credential before Railway admits two replicas. Generate a public Railway domain, verify `GET /healthz` returns dependency-free process liveness, and require `GET /readyz` to return `{ "ok": true, "database_schema": true, "object_storage": true, "subject_authority": true }` while both replicas are present. Readiness revalidates the authority manifest, so bucket or credential loss removes the replica from service. Railway admission and release promotion consume `/readyz`, not `/healthz`.
9. Add a `frontend` service from the same repository. Leave its root directory at the repository root, then set its Config-as-Code path to `/deploy/railway/frontend.railway.toml`.
10. Generate the frontend public domain. Copy the canonical environment URLs from `deploy/railway/frontend.env.example`, including the exact environment-scoped private API authority `http://fmarch.railway.internal:8080`; it receives app-session and one-time WorkOS bearers and must never be replaced with a public or third-party URL. Use the same WorkOS client id as the API, add an environment-isolated WorkOS API key, preserve the exact callback URI, and generate an opaque random cookie password of at least 32 characters. Promotion rejects short values and documented, example, variable-reference, or placeholder-shaped values without printing the secret. Add them as Railway Variables for `frontend`.
11. Record the new migrator service UUID as
    `FMARCH_RAILWAY_MIGRATOR_SERVICE_ID` in the protected release-operator
    environment. It is intentionally not guessed or checked into source until
    the live service exists; promotion fails closed when it is absent.
12. Redeploy `frontend`, sign in as the bootstrapped GlobalAdmin, create the first game from `/admin`, choose a pack, and complete `/g/<game>/setup`. Verify a player follows the host-issued WorkOS sign-in link, start the game, refresh the setup and host surfaces, and confirm the started game appears on the board. Log out and require the browser to traverse the constrained WorkOS session-logout endpoint before returning to the canonical frontend root; then complete a fresh WorkOS sign-in. If classic-plus-WorkOS is enabled, also attach WorkOS to a recently authenticated Classic principal, require the link flow to traverse the same provider logout, and prove a fresh WorkOS sign-in succeeds afterward. Browser commands and one-time WebSocket tickets are bound to the verified WorkOS session and local principal rather than caller-supplied identifiers.

## Production Promotion

After a `main` commit has deployed successfully to staging, run the fail-closed
preflight:

```sh
npm run promote:production -- --check
```

The preflight requires a clean synchronized `main`, a fast-forwardable
`origin/production`, successful staging migrator, API, and frontend deployments
carrying the exact `main` SHA, active canonical domains, healthy staging
endpoints, exact canonical frontend origins/callbacks/public and private API URLs, matching
API/frontend WorkOS client ids, live discovery-aligned WorkOS issuer/JWKS
metadata in both environments, and complete production variables. It proves that API uses only
`fmarch_application`, migrator alone has the owner URL/bootstrap passwords,
no deployed service contains `DATABASE_KEY_ADMIN_URL`, and every database
credential and identity secret is isolated from staging. It then runs the full proof-lane sweep. When
`DATABASE_URL` is unset, the command starts the repo-local Postgres and supplies
its canonical URL to every selected proof lane.

Promote the verified commit with:

```sh
npm run promote:production
```

The command advances the release pointer, observes terminal `SUCCESS` for the
migrator, API, and frontend at that SHA, and verifies both production health endpoints.
It does not offer a force flag or a proof bypass.

The underlying sequence is:

1. Verify the worktree is clean and `HEAD` equals `origin/main`.
2. Run the full proof sweep (`npm run proof:lanes -- --mode full --run`). Production
   promotion is a sprint boundary, so it deliberately pays the full validation
   cost rather than selecting only the current diff's push lanes.
3. Verify staging API dependency readiness, frontend health, and confirm the
   latest successful migrator, API, and frontend Railway deployments carry the same
   `main` commit SHA.
4. Fast-forward the remote `production` branch to that exact SHA. Railway
   production services must watch `production`, never `main`.
5. Observe terminal `SUCCESS` for all three production services and verify their
   deployment metadata carries the promoted SHA before calling the release
   complete.

If any service fails, leave the last successful API/frontend deployment running, diagnose
the failed deployment, and do not move the release pointer again until the trio
can be proven together. Do not deploy a dirty local directory to production.

After a database restore, run the exact-commit migrator before exposing the
restored API. The restore path omits archived ownership/ACL state, so an existing
`_sqlx_migrations` row does not prove current grants. Restore authenticated
archives as the schema owner without disabling triggers, reconcile ACLs, pass
the catalog audit and application schema gate, then admit network traffic.
Credential rotation must drain or terminate old sessions before revocation is
considered effective; changing a password or revoking `CONNECT` does not kill
an already-established connection. The same rule applies when repairing a
stale PostgreSQL parameter ACL: reconciliation prevents future `SET` authority,
but cannot reset `session_replication_role` in a backend that already changed
it. The greenfield role cut must run before the first application session; any
later authority repair requires an explicit session drain before admission.

## WorkOS Verification Metadata

WorkOS verification metadata is public, but it is still an authentication
boundary. For the default WorkOS domain, each application client has its own
discovery document and verification paths:

```text
discovery  https://api.workos.com/user_management/<client_id>/.well-known/openid-configuration
issuer     https://api.workos.com/user_management/<client_id>
JWKS       https://api.workos.com/sso/jwks/<client_id>
```

Do not use the legacy global `https://api.workos.com/` issuer. After replacing
`client_replace_me` in `deploy/railway/api.env.example`, export its three
`WORKOS_*` verification values and run:

```sh
npm run preflight:workos-oidc
```

The preflight fetches the client-scoped discovery document, requires its
`issuer` and `jwks_uri` to exactly equal the API configuration, then requires
the discovered JWKS to contain at least one keyed RS256 signing key compatible
with the API verifier. It sends no WorkOS API key, cookie password, or user
data. Production promotion runs the same check
for both staging and production. If a custom AuthKit domain is introduced,
configure the exact metadata returned by this same client-scoped discovery
endpoint rather than deriving a replacement by hand.

### WorkOS Session Cutoff

Each accepted assertion is consumed once by its exact SHA-256
`workos_session_exchange.access_token_hash`. Its canonical `sid` is bound in
`workos_provider_session`, and every local session minted from it records the
same value in `auth_session.workos_session_id`. Logout revokes that entire local
scope and appends only the `sid` fingerprint to
`workos_provider_session_tombstone`; method disable does the same for every
observed `sid` on the method. WorkOS linking consumes its assertion and then
immediately seals the link-only provider session. The API returns the fixed
single-`session_id` WorkOS logout URL, and the frontend rejects any alternate
origin, path, query shape, fragment, or `return_to` before navigating.
If the first internal link response is lost or unreadable, the frontend repeats
that byte-identical request once. The API replays the committed URL only when
both `workos_session_exchange.access_token_hash` and `linking_session_hash`
match; it performs no second attachment or audit transition.

An AuthKit browser can retain an assertion for a provider `sid` already sealed
by logout, linking, method disable, or migration cutover. The API verifies the
assertion, proves that the provider-session fingerprint—not its subject—is the
deny reason, and returns HTTP 409 with exactly the fixed WorkOS logout URL. The
login and link callbacks reject every near-match and navigate through that URL
before a new ceremony. Subject-erasure fingerprints never receive this recovery
response and remain an opaque authorization failure.

Subject erasure first appends the SHA-256 WorkOS `sub` fingerprint to
`workos_subject_tombstone`, so an assertion from an unobserved sibling provider
session cannot recreate the erased identity after its raw binding is removed.
The two tombstone tables are append-only denial evidence and contain neither
raw provider identifiers nor bearer assertions. Configure WorkOS's default
sign-out redirect/application homepage to the exact canonical frontend root;
that provider setting, not a caller-supplied return URL, completes the redirect.

Never set `FMARCH_DEV_AUTH=1` or `FMARCH_FRONTEND_FIXTURE_SESSION=1` on any hosted service. They are local proof modes, not hosted-target configuration.

## Secrets And Evidence

Railway receives deployed runtime secrets such as the resolved application
`DATABASE_URL`, WorkOS API key, and AuthKit cookie password. The protected
operator environment alone receives `DATABASE_KEY_ADMIN_URL`; it is never a
Railway service variable. The repository has examples and variable names, not
secret values. The Rust API receives public WorkOS verification metadata, never
the WorkOS API key, schema-owner URL, role-bootstrap passwords, or key-admin URL.

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

Passing the local Railway configuration contract proves that this repository
carries a repeatable Railway staging bootstrap. This round does not mutate live
Railway state. In particular, the migrator service has not yet been provisioned,
so its unknown live UUID must be supplied later as
`FMARCH_RAILWAY_MIGRATOR_SERVICE_ID`; promotion intentionally refuses to guess
it. The contract does not prove a Railway account exists, that a deployment
succeeded, that either URL is externally reachable, or that any hosted
identity, operations, release, or production requirement has been met.
