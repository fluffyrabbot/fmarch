# Railway Staging Target

This is the repeatable bootstrap for fmarch's first externally reachable staging target. It creates a real target that can later produce hosted matrix and identity evidence. It does not make a hosted, release, or production readiness claim by itself.

## Target Shape

Create one Railway project in one region with three image-backed services, one
managed database, and two purpose-separated object stores:

| Service | OCI artifact | Public | Persistent state |
| --- | --- | --- | --- |
| `api` | exact runtime digest | yes | Railway Postgres, shared media Bucket, plus a dedicated shared subject-authority Bucket |
| `migrator` | the same exact runtime digest | no | none; one-shot schema/ACL authority |
| `frontend` | exact frontend digest from the same commit | yes | none |
| `Postgres` | Railway managed database | no | Railway managed database storage/backups |
| `media` | Railway Bucket | no | S3-compatible canonical media and variants |
| `subject-authority` | Railway Bucket | no | immutable authority genesis, wrapped subject keys, and revocation journal |

The local release coordinator builds `Dockerfile` and `Dockerfile.frontend`
for `linux/amd64`, labels both with the full pushed commit, publishes unique
SHA tags to public GHCR, resolves their digests, and pins Railway to those
digests. Railway performs no application build. The runtime image contains
both `fmarch-server` and `fmarch-migrate`; service-specific commands and
credentials preserve the authority split without duplicating the artifact.

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

| Railway environment | Release pointer | Deployment rule |
| --- | --- | --- |
| `staging` | `main` | Run `npm run release:staging -- --commit <full-sha> --fleet-receipt <signed-envelope.json> --fleet-job <job-id>` after a Cachy `audit` proof. |
| `production` | `production` | Reuse the exact staging-proven digests, complete production coordination, then advance the pointer with an expected-value lease. |

The canonical Railway domains are:

| Environment | API | Frontend |
| --- | --- | --- |
| `staging` | `https://fmarch-staging.up.railway.app` | `https://fmarch-frontend-staging.up.railway.app` |
| `production` | `https://fmarch-production.up.railway.app` | `https://fmarch-frontend-production.up.railway.app` |

Release authority also pins project `9d285d67-c11b-4508-9efb-fad042787b4c`,
staging environment `e109e500-2a4c-48a3-96f2-e92a9edb63e4`, production
environment `c1378737-84cc-45ba-8474-9c868baf7cfb`, migrator service
`7c2c2665-2be2-4938-84e5-7580a964d610`, API service
`18b6f450-3739-4f21-8e01-f58c63cec834`, and frontend service
`23787c98-db56-4ccc-869a-42dca74d7bc7`. These IDs and the canonical origins
are receipt data, not ambient operator overrides. A conflicting legacy
`FMARCH_RAILWAY_*` or URL override stops the coordinator before any mutation.

The `production` branch is a release pointer, not a place to work. It may only
identify a commit already reachable from `origin/main`. Production promotion
requires a clean worktree, the required signed canonical-worker audit proof, successful staging
migrator/API/frontend deployments, API and frontend health checks, and Railway
deployment metadata showing that all three services run the same commit.
Release Git authority is pinned to the singular fetch and push URL
`https://github.com/fluffyrabbot/fmarch.git`; configured `origin` fetch and push
URLs must both match before any release fetch, lock, or pointer operation, and
network operations address that URL directly. Release Git subprocesses scrub
ambient `GIT_*`, proxy, and CA-bundle authority; ignore system/global Git
configuration; force verified TLS; and reinject only the repository-owned
`gh auth git-credential` helper. Ambient askpass authority is removed and Git
uses a fixed noninteractive failing askpass. Local and worktree configuration
keys are enumerated with includes disabled and executable indirection is
rejected before any deeper checkout inspection. Local configuration may not
delegate through `include`/`includeIf` or define URL rewrites, credentials,
proxies, TLS/CA settings, hooks, fsmonitor, alternate attribute files, SSH
commands, protocol overrides, or legacy Git proxies. Release commands also
disable hooks, fsmonitor, replacement objects, and external attributes. Posture rejects
replace refs, grafts, sparse checkout, and any tracked assume-unchanged or
skip-worktree flag before trusting the checkout.

Production mutation is serialized by the remote
`refs/heads/release-locks/production` lease. Its commit binds the release
commit and tree, expected prior production pointer, signed fleet job and
receipt, staging receipt digest, nullable schema-reset epoch, canonical Git
URL, and complete Railway topology. The promoter passes that exact lease
commit to the production coordinator. Direct production coordination without
it is forbidden, and the coordinator re-fetches and proves the lease before
each production-side Railway mutation and once more before publishing its
immutable receipt. That same boundary re-reads the exact staging receipt and
signed fleet envelope from their bound paths, verifies their digests, commit,
topology, images, reset decision, trust root, and all freshness clocks, and only
then checks the remote lease as the last pre-mutation step. The first production
mutation additionally requires a 65-minute freshness reserve (the promoter's
one-hour coordinator deadline plus clock-skew allowance); later mutations still
require strictly live evidence. `FAILED` or `CRASHED` one-shot reset/migrator deployments
may be re-dispatched with the same digest; approval and other ambiguous
terminal states remain operator-visible and fail closed. All release Git,
Railway, and Podman subprocesses have bounded timeouts; a timeout unwinds the
promoter and releases only its exact lease.

Do not retain a Git source or enable image auto-updates on these services.
`tools/release_coordinator.mjs` is the only release sequencer. It runs from a
clean `main` checkout or a clean detached checkout of the exact `origin/main`
commit: it deploys and
builds runtime and frontend images from one temporary `git archive` of that
commit, never from the live worktree. Every new attempt uses a unique registry
tag, records the push-returned digest, then pulls and validates the exact
`repository@digest`; a pre-existing commit tag is never release provenance.
An already-published staging attempt resumes only from its receipt-bound
immutable digests after identity/content revalidation. It then
first disconnects the canonical Git source without stopping the last successful
deployment, then
restores the complete service policy that source cutover would otherwise clear
(replica count, restart policy, health checks, and the API schema gate), then
waits for both Railway's one-shot migrator deployment and the migrator's
exact-commit completion record before deploying API and frontend, verifies
their reported digests and embedded `release_commit`, and finally produces the
environment receipt. A failed migrator starts neither later deployment. A
failed API or frontend may be retried only with the same receipt-bound digest.
The bounded API schema gate still tolerates normal migration progress but never
migrates or weakens checksum/ACL failures.

Immediately before the production pointer CAS, promotion revalidates staging,
fleet, and production-attempt freshness, then rechecks exact live production
sources, deployments, canonical non-redirecting health origins, the remote
production pointer, and the held lease. A long-paused promoter therefore
cannot resume with expired evidence or after losing its lease.

After coordinator or Railway topology changes, execute the staging-only release
game day in [release-game-day.md](release-game-day.md). Its receipt proves slow
and failed migrations, API readiness failure, wrong-digest detection,
same-digest recovery, schema-compatible application rollback, and exact current
release restoration without touching production.

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

The profile-handle blind-index key and its non-secret KID are API-only,
environment-local variables. They must never be copied to the migrator,
frontend, or key-admin shell, and staging and production must use different
values and KIDs.

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

The profile-handle blind-index key belongs only to the API process. It is not
an event-encryption key and must not be reused for one. Startup validates the
key/KID and audits every active reservation before the API becomes ready. Rotate
it only with the protected, drained
[`fmarch-profile-index-admin`](profile-handle-index-rotation.md) maintenance
workflow: audit the active configuration, stop every profile writer, atomically
reindex active reservations using the replacement-only secret, then atomically
switch the API key/KID while traffic remains drained. A direct service-variable
flip is unsafe. The reindex command requires both `--writers-drained` and
`--execute`, but its acknowledgement does not substitute for actually draining
pre-lease binaries or out-of-band writers.

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
2. Add a private `migrator` service and configure the deployment shape from
   `deploy/railway/migrator.railway.toml`. The coordinator owns its digest-pinned
   image source. Copy
   `deploy/railway/migrator.env.example`. Generate distinct, URI-safe
   application and key-admin passwords in each environment. Only this service
   receives the environment-local `${{Postgres.DATABASE_URL}}` composed as
   `DATABASE_MIGRATION_URL` with exactly one secure `sslmode` and both password
   values. It has no public domain, TCP proxy, event keys, bucket
   credentials, or identity credentials. Its `NEVER` restart policy preserves
   one-shot semantics.
   Set `FMARCH_DATABASE_PROJECT_ID`, `FMARCH_DATABASE_ENVIRONMENT_ID`, and
   `FMARCH_DATABASE_ENVIRONMENT` to the repository-owned canonical values for
   that environment. Before the first normal migration, run the exact release
   image once with `fmarch-schema-epoch-reset --bind-database-identity` and set
   `FMARCH_DATABASE_IDENTITY_BIND_CONFIRM` to
   `<project-uuid>:<environment-uuid>:<environment-name>:<release-commit>`.
   This is the sole create-only bootstrap: remove the confirmation afterward.
   Bootstrap binds both an immutable database-owner-only private ledger and a
   matching database-global comment marker. Normal migrator/reset runs verify
   both and refuse an absent, swapped, relabeled, or additionally granted
   identity authority.
3. Run the coordinator. Its migrator phase must create/reconcile the fixed
   `fmarch_application` and `fmarch_key_admin` login roles, apply migrations
   through the schema-owner connection, reconcile exact privileges/default
   ACLs, and exit successfully. Repeat this reconciliation after every restore;
   migration history alone is not ACL evidence.
4. Add an `api` service using the deployment shape in `railway.toml`; the
   coordinator owns its digest-pinned image source. Construct its only database secret,
   `DATABASE_URL`, with username `fmarch_application` and the application
   password held by the migrator; percent-encode the password when composing
   the URL and include exactly one secure `sslmode`. Do not copy the owner URL
   or either standalone password onto API.
   Set the same canonical `FMARCH_DATABASE_PROJECT_ID`,
   `FMARCH_DATABASE_ENVIRONMENT_ID`, and `FMARCH_DATABASE_ENVIRONMENT` values
   on API. The pre-deploy schema gate and server read the owner-controlled
   global marker through the application connection, while `/readyz` rechecks
   and publishes the actual nonsecret identity. Release acceptance compares
   that attestation to repository topology, so a coherent URL-and-variable swap
   to the other environment still fails before promotion.
   Generate a distinct opaque `FMARCH_PROFILE_HANDLE_INDEX_KEY` of at least 32
   bytes and a public `FMARCH_PROFILE_HANDLE_INDEX_KID`; add both to this API
   service only. Release startup fails before readiness if either is missing or
   malformed. Do not reuse the event wrapping or archive key.
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
8. Let the coordinator deploy `api` only after migrator success; require its bounded `fmarch-schema-gate` pre-deploy command to
   prove the migrator-completed schema and authority audit through the
   application credential before Railway admits two replicas. Generate a public Railway domain, verify `GET /healthz` returns dependency-free process liveness, and require `GET /readyz` to return `{ "ok": true, "database_schema": true, "object_storage": true, "subject_authority": true }` while both replicas are present. Readiness revalidates the authority manifest, so bucket or credential loss removes the replica from service. Railway admission and release promotion consume `/readyz`, not `/healthz`.
9. Add a `frontend` service using `deploy/railway/frontend.railway.toml`; the
   coordinator owns its independently digest-pinned frontend image source.
10. Generate the frontend public domain. Copy the canonical environment URLs from `deploy/railway/frontend.env.example`, including the exact environment-scoped private API authority `http://fmarch.railway.internal:8080`; it receives app-session and one-time WorkOS bearers and must never be replaced with a public or third-party URL. Use the same WorkOS client id as the API, add an environment-isolated WorkOS API key, preserve the exact callback URI, and generate an opaque random cookie password of at least 32 characters. Promotion rejects short values and documented, example, variable-reference, or placeholder-shaped values without printing the secret. Add them as Railway Variables for `frontend`.
11. Verify that the migrator service UUID is the canonical
    `7c2c2665-2be2-4938-84e5-7580a964d610`. Release tooling binds this UUID,
    both environment UUIDs, the API/frontend service UUIDs, and all public
    origins into the immutable attempt and terminal receipts; it does not
    accept an operator-selected replacement target.
12. Redeploy `frontend`, sign in as the bootstrapped GlobalAdmin, create the first game from `/admin`, choose a pack, and complete `/g/<game>/setup`. Verify a player follows the host-issued WorkOS sign-in link, start the game, refresh the setup and host surfaces, and confirm the started game appears on the board. Log out and require the browser to traverse the constrained WorkOS session-logout endpoint before returning to the canonical frontend root; then complete a fresh WorkOS sign-in. If classic-plus-WorkOS is enabled, also attach WorkOS to a recently authenticated Classic principal, require the link flow to traverse the same provider logout, and prove a fresh WorkOS sign-in succeeds afterward. Browser commands and one-time WebSocket tickets are bound to the verified WorkOS session and local principal rather than caller-supplied identifiers.

## Canonical Release Proof

A release checkpoint uses the forced full Cachy workflow, not a local cache receipt:

```sh
npm run proof:remote -- --mode audit
node "$FLUFFYFLEET_ROOT/scripts/fleet.mjs" job <job-id> --host cachy --evidence > <signed-envelope.json>
```

Inspect the signed envelope, record its exact `<job-id>`, then land that same job through the fleet `land`
command. The coordinator verifies the envelope again against Cachy's configured
receipt public key and binds its digest, job, task branch, comparison commit,
workflow, and trust-root fingerprint into the staging release receipt. Pass the
same envelope to production promotion; a different valid job is not a substitute
for the proof staging actually consumed. `--fleet-job <job-id>` is mandatory,
and the signed completion time must be canonical, no more than five minutes in
the future, and no more than 24 hours old when consumed.

## Production Promotion

After a `main` commit has deployed successfully to staging, run the fail-closed
preflight:

```sh
npm run promote:production -- --check --fleet-receipt <signed-envelope.json> --fleet-job <job-id>
```

The preflight requires a clean synchronized `main`, a fast-forwardable
`origin/production`, successful staging migrator, API, and frontend deployments
bound by a passed exact-commit staging receipt, active canonical domains, healthy staging
endpoints, exact canonical frontend origins/callbacks/public and private API URLs, matching
API/frontend WorkOS client ids, live discovery-aligned WorkOS issuer/JWKS
metadata in both environments, complete production variables, and a completion registry in which
every platform/release item—including human approval—is complete. It proves that API uses only
`fmarch_application`, migrator alone has the owner URL/bootstrap passwords,
no deployed service contains `DATABASE_KEY_ADMIN_URL`, and every database
credential and identity secret is isolated from staging. The supplied envelope must be an
Ed25519-signed, verification-only Cachy receipt for the exact commit and the repository's
`audit` workflow (`full --force`). Local proof-lane cache output is never release authority.
The staging release intent, fleet completion, hosted acceptance, and terminal
staging receipt must all be within the same 24-hour promotion window.

Promote the verified commit with:

```sh
npm run promote:production -- --fleet-receipt <signed-envelope.json> --fleet-job <job-id>
```

The command reuses the staging-proven digests, sequences migrator before API/frontend,
verifies both production health endpoints, publishes the immutable lease-scoped
release receipt, and only
then advances the release pointer.
It does not offer a force flag or a proof bypass.

The underlying sequence is:

1. Verify the worktree is clean and `HEAD` equals `origin/main`.
2. Verify the signed Cachy receipt against the configured worker trust root, exact
   commit, task branch, `audit` mode, workflow commands, and successful step set.
3. Require every platform/release completion-registry item to be complete; source,
   external-evidence, and human gates are all fail-closed.
4. Verify the staging receipt, digest-pinned service sources, API dependency
   readiness, frontend health, and embedded release commit.
5. Invoke the coordinator, which alone owns each service's Git-to-image source
   cutover. A null source left by an interrupted prior cutover is a resumable
   intermediate state, while any foreign Git source remains rejected.
6. Reuse the staging runtime/frontend digests, wait for
   migrator success, deploy API/frontend, and verify digest plus health commit
   attribution before publishing the immutable release receipt.
7. Serialize production mutation through the remote
   `refs/heads/release-locks/production` compare-and-swap lock. Immediately
   before advancing the pointer, fetch production configuration and deployment
   state again by the pinned project/environment/service UUIDs, recheck exact
   deployment IDs, digests, domains, and live health, fetch `origin/production`,
   then advance it with `--force-with-lease` bound to the observed SHA.
   Contending promoters and concurrent pointer movement are both rejected.

If any service fails, leave the release pointer unchanged, diagnose the failed deployment,
and do not move the release pointer until the trio
can be proven together. Do not deploy a dirty local directory to production.
If coordination and immutable receipt publication succeed but the final Git
pointer update fails, rerun the promotion. Each acquired lease owns
`target/releases/production/<commit>.<lease>.json`; a new lease never adopts an
old-token receipt or overwrites it. The new holder revalidates the staging
proof and immutable digests, safely reconciles the already-live exact deployment,
publishes its own current-token receipt, and then retries the expected-value
pointer update. This avoids both stale-authority adoption and an immutable
fixed-path recovery wedge.
The promotion lock is removed with an exact lease in a `finally` path. If the
operator process is killed and leaves the remote lock ref behind, inspect the
lock commit and the exact production receipt/live state before deleting that
ref with a lease; never replace or blindly steal it.

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

## Public Search Staging Corpus

The public-search canary owns one deterministic, non-personal staging game declared in
`docs/ops/public-search-staging-sentinel.json`. Install or verify it only after the exact API deployment
is successful:

```sh
railway ssh \
  --project 9d285d67-c11b-4508-9efb-fad042787b4c \
  --environment e109e500-2a4c-48a3-96f2-e92a9edb63e4 \
  --service 18b6f450-3739-4f21-8e01-f58c63cec834 \
  -- fmarch-staging-search-corpus reconcile
```

The command refuses every environment except Railway `staging`, accepts only the application
`DATABASE_URL`, and verifies schema, database-role, and event-key authority before mutation. It
uses a fixed non-login machine principal and drives `CreateGame` followed by `StartGame` through
the production command pipeline with durable command ids. `CreateGame` grants that principal only
the corpus game's scoped host authority; no platform identity, authentication method, or global
capability is created. SQL access is read-only: it inspects the owner/lifecycle and verifies the
resulting public game and search projections. Re-running the command appends no facts. Run it again
after any staging database recreation; owner, pack, lifecycle, or projection drift fails closed
instead of creating a second corpus.

After every exact API deployment, run the declared post-deploy sentinel once. It executes the
bounded canary and then evaluates only that deployment's application telemetry:

```sh
npm run run:public-search-staging-sentinel
```

The canary receipt records only aggregate corpus-match counts. It never persists the expected href,
query terms, result content, response bodies, cursors, or request metadata. The evaluator fails on
commit-attribution, telemetry-shape/privacy, or latency drift and reports missing/non-empty evidence
as insufficient. It makes no synthetic weekly-availability claim; introduce that gate only when
beta traffic is representative enough to support it. `npm run promote:production` consumes this
same strict sentinel after exact-SHA staging health and before production
coordination, so a release decision cannot bypass it. The `production`
release pointer remains unchanged until that coordination has completed.

## Secrets And Evidence

Railway receives deployed runtime secrets such as the resolved application
`DATABASE_URL`, WorkOS API key, and AuthKit cookie password. The protected
operator environment alone receives `DATABASE_KEY_ADMIN_URL`; it is never a
Railway service variable. The repository has examples and variable names, not
secret values. The Rust API receives public WorkOS verification metadata, never
the WorkOS API key, schema-owner URL, role-bootstrap passwords, or key-admin URL.
It receives the environment-local profile-handle blind-index key and KID; that
key is neither a frontend nor a migrator credential.

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
carries a repeatable Railway staging bootstrap and a single pinned topology. It
does not mutate or by itself prove that topology exists in live Railway state.
The contract does not prove a Railway account exists, that a deployment
succeeded, that either URL is externally reachable, or that any hosted
identity, operations, release, or production requirement has been met.
