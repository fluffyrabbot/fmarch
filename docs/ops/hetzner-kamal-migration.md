# Hetzner + Kamal migration

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-10-21 |
| **Decision owner** | Project owner |
| **Target** | Hosting, database operations, backups, release coordinator |
| **Replaces** | [railway-staging-target](railway-staging-target.md), [release-game-day](release-game-day.md) once production cuts over |
| **Related** | [database-schema-evolution](database-schema-evolution.md), [runtime-kek-rotation](runtime-kek-rotation.md), [cachy-canonical-verification](cachy-canonical-verification.md), [member-data-lifecycle draft](../policy-drafts/member-data-lifecycle.md) |

## Summary

Move fmarch off Railway to Hetzner Cloud US, deployed with Kamal 2. Self-run
PostgreSQL 16 with a cross-region standby. Keep backups and object storage at
a second provider, Backblaze B2, and put Cloudflare in front for DNS and
caching. WorkOS and Resend stay as they are.

Staging moves first. Production stays on Railway until staging on the new
host has passed a full release cycle, a restore drill, and a failover drill.
Then production cuts over in one maintenance window and all Railway tooling
is deleted in one commit.

The move is also a deliberate reduction of release ceremony. About 14,500
lines of release tooling exist today, and most of them defend against
Railway's asynchronous, outcome-unknown deployment model rather than against
real release risks. The target is roughly 1,000 lines, keeping every
guarantee that protects data or proves what is serving.

## Why

- **Cost curve.** Railway, AWS and GCP all charge a per-component floor plus
  per-GB egress. Hetzner charges a small fixed price per VM, includes traffic,
  and its prices have been stable for years. At current scale the floor
  dominates; with growth, egress dominates. Hetzner wins in both regimes.
  Estimated production cost is about €45–65/mo and staging about €25–35/mo,
  at list prices on 2026-10-21. Check the order page before provisioning.
- **Backup redundancy.** Railway holds the database, its backups and both
  buckets in one account. After this move, losing any single provider account
  loses no durable data.
- **Closes the production storage gate.** The Railway runbook notes that
  Railway Buckets have no object-lock/WORM boundary and asks for "enforced
  object retention and KMS custody" before production. B2 Object Lock plus AWS
  KMS meet both requirements.
- **Ceremony reduction.** The coordinator's largest subsystems exist because
  a Railway deploy can succeed, fail, or end up unknown without the caller
  finding out. Over SSH, a one-shot migrator is a process with an exit code.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Hetzner Cloud **US**: primary in Ashburn (`ash`), standby in Hillsboro (`hil`) | Owner choice for a mostly North American player base. US locations include much less traffic per VM than EU, so Cloudflare caching of static frontend assets is required, not optional |
| D2 | **Self-run PostgreSQL 16** from the PGDG apt repository, running natively on the DB host rather than in a container | Owner choice. 16 matches the pinned 16.15 proof toolchain. Native install keeps pgBackRest, WAL archiving and major-version upgrades simple |
| D3 | Async streaming standby in `hil` over **WireGuard**; **manual** failover via a scripted runbook, not Patroni | `ash` and `hil` are in different Hetzner network zones, so a private network cannot span them. Automatic failover across a ~70 ms WAN without a third witness risks split-brain, which is worse than a 30-minute manual RTO before 1.0 |
| D4 | **pgBackRest** to B2 with continuous WAL archiving, `archive_timeout = 60s`, weekly full and daily differential backups, 35-day PITR window | RPO ≤ 60 s even if the standby is lost; 35 days covers a slow-to-notice corruption |
| D5 | **Backblaze B2** for all buckets. Each bucket and environment has its own application key, and no key can list or read another bucket | Cheap storage, free egress to Cloudflare, S3-compatible, has Object Lock. A second provider from compute |
| D6 | **Split the subject authority into two buckets**: `subject-journal` (manifest and revocations, long Object Lock: 35 days in staging, 10 years in production) and `subject-keys` (wrapped subject keys, 35-day Object Lock) | `destroy` crypto-shreds by deleting the key object (`crates/identity/src/subject_privacy.rs`), so the key bucket can only hold deleted versions for the backup window. Manifest and revocations are create-only and must stay immutable much longer. Bucket default retention is provider-neutral; per-object lock headers are not |
| D7 | **AWS KMS** wraps `FMARCH_SUBJECT_AUTHORITY_WRAP_KEY`. The API holds only ciphertext plus an IAM key restricted to `kms:Decrypt` on that one key, with an `aws:SourceIp` condition pinned to the environment's app-host IPs | Owner choice. Meets the KMS custody gate. A leaked credential is useless off-host, and KMS logs every unwrap. About $1/mo per key |
| D8 | **Kamal 2** for application deploys. Two Kamal services (`fmarch-api`, `fmarch-frontend`) with `staging` and `production` destinations | Deploys the existing digest-pinned GHCR images, gates traffic on `/readyz` through kamal-proxy, and provides deploy locks and rollback. No Kubernetes |
| D9 | **OpenTofu** (`hcloud`, `b2`, `aws`, `cloudflare`, `tls` providers) plus cloud-init for hosts, load balancers, firewalls, volumes, buckets, KMS and DNS. One shared module in `infra/modules/environment`, one root per environment. State lives in a B2 bucket with OpenTofu's native client-side state encryption; a tiny local-state `infra/bootstrap` root creates that bucket once | Rebuilding a lost environment from code is the disaster-recovery story. State holds generated credentials, so it is encrypted before it leaves the operator's machine |
| D10 | **Cloudflare** proxied DNS → public Hetzner load balancer (TLS with a Cloudflare Origin CA certificate, Full strict) → kamal-proxy on each app host over the private network. Origins are `<domain>` / `api.<domain>` and `staging.<domain>` / `api-staging.<domain>` | Keeps today's separate frontend/API origin shape. WebSockets pass through all three hops. Cloudflare absorbs static egress (see D1). Hetzner-managed certificates need Hetzner DNS, so the origin certificate comes from Cloudflare. Universal SSL covers one wildcard level, hence `api-staging` rather than `api.staging` |
| D15 | A second, **private-only Hetzner load balancer** (public interface disabled) carries frontend-to-API server-side calls over plain HTTP inside the private network. kamal-proxy lists its private IP as an extra API host | The frontend reaches the API without leaving the private network or depending on Cloudflare, and no public listener serves the API without TLS |
| D11 | Staging keeps production's **multi-node shape** (two app hosts), without the standby | The hosted multi-node race gate must keep proving cross-replica behavior |
| D12 | Database target attestation keeps `FMARCH_DATABASE_ENVIRONMENT` and **replaces the Railway project/environment IDs with one `FMARCH_DATABASE_INSTANCE_ID` UUID**, generated when the database is provisioned | Keeps the marker that stops a staging process from opening production, without platform identifiers. Greenfield cutover, no compatibility path |
| D13 | Technical backup deletion cadence is **35 days** for every copy: B2 hidden versions and the fluffycachy pull copy | A destroyed subject key becomes unrecoverable from every copy within 36 days. This is the value the member-data-lifecycle draft cites for "backup deletion cadence" |
| D16 | **Ransomware protection is Object Lock in place**, not a separate vault bucket. `media`, `subject-keys` and `pgbackrest` carry a 35-day compliance lock; deletes and overwrites become hidden versions, and the lifecycle rule `daysFromHidingToDeleting = 1` purges them once the lock lapses. The third copy is a nightly pull to fluffycachy | B2 lets an application key hide a locked object but never remove a locked version, so a compromised host cannot destroy history inside the window. pgBackRest's own expiry keeps working because its deletes become hides. A dated-snapshot vault would store each object 35 times |
| D14 | Railway tooling is deleted **at production cutover**, in one commit | Production depends on the coordinator until then. Deleting it all at once avoids a long period with two ways to release |

## Target topology (per environment)

| Component | Production | Staging |
|---|---|---|
| App hosts | 2 × shared-vCPU VM (~3 vCPU / 4 GB), `ash`. Each runs `fmarch-api` and `fmarch-frontend` | same |
| Load balancers | Public Hetzner LB (HTTPS) and private-only Hetzner LB (HTTP, D15), `ash`, private-network targets | same |
| DB primary | Dedicated-vCPU VM (~2 vCPU / 8 GB) plus Hetzner Volume for `PGDATA`, `ash` | Shared-vCPU VM plus volume |
| DB standby | Small VM plus volume, `hil`, WireGuard to primary | none |
| Firewalls | Public interfaces accept only SSH from the operator CIDR; load balancers reach kamal-proxy over the private network. DB: PostgreSQL listens only on its private IP, `pg_hba` admits only `hostssl` from the private subnet (plus WireGuard in production) | same |
| B2 buckets | `media`, `subject-journal`, `subject-keys`, `pgbackrest`, all locked (D6, D16) | same, separate keys, 35-day journal lock |
| KMS | one key, `us-east-1` | its own key |

App hosts reach the DB primary over the Hetzner private network with
`sslmode=verify-full` against a per-environment private CA. The API keeps its
existing two-replica semantics: one container per app host, both sharing the
`media` and subject buckets.

## Backups and redundancy

| Data | Primary copy | Second copy | Third copy | Restore target |
|---|---|---|---|---|
| Postgres | primary volume (`ash`) | streaming standby (`hil`, production) | pgBackRest repo in B2 `pgbackrest` (client-side encrypted, base + WAL, 35 d, locked) | PITR to any point in 35 d |
| Media | B2 `media` (locked, hidden versions 35 d) | nightly pull to fluffycachy | — | any object version in 35 d |
| Subject journal | B2 `subject-journal` (locked 10 y in production) | nightly pull to fluffycachy | — | full |
| Subject keys | B2 `subject-keys` (locked, hidden versions 35 d) | nightly pull to fluffycachy (35 d) | — | full, minus keys destroyed > 36 d ago (intended) |
| pgBackRest repo | B2 `pgbackrest` | nightly pull to fluffycachy | — | PITR from the local copy if B2 is unreachable |
| Secrets | `~/secure/fmarch` on the operator Mac | offline escrow (existing practice) | — | — |

Rules:

- **No application key can remove a locked version.** Bucket keys get
  `listFiles`, `readFiles`, `writeFiles` and `deleteFiles` (which hides)
  but never `bypassGovernance`, `writeFileRetentions`,
  `writeFileLegalHolds` or `writeBucketRetentions`. Compliance mode refuses
  version deletion even for the account owner until the lock lapses.
- **B2 keeps old versions by default.** Every locked bucket except
  `subject-journal` sets the lifecycle rule `daysFromHidingToDeleting = 1`.
  Otherwise a "deleted" key survives as a hidden version after the lock
  lapses and crypto-shredding silently fails. The erasure smoke in S2 checks
  that a destroyed key has no versions 36 days later on staging.
- **The fluffycachy pull copy uses read-only keys** and keeps 35 days of
  history with `rclone sync --backup-dir` rotation. It is the copy that
  survives losing the B2 account itself.

### Restore drill (new proof lane)

`node tools/hosted_restore_drill.mjs --environment staging` (added in S4) runs nightly on fluffycachy
against the most recent staging backup:

1. `pgbackrest restore` into a scratch PostgreSQL 16 instance at a random
   point inside the PITR window.
2. Run `fmarch-migrate` against it (a no-op apply at head that reconciles
   ACLs and audits the authority catalog), then `fmarch-schema-gate`.
3. Boot one API process against the restored database and the pulled
   `subject-journal`/`subject-keys` copies. Require `/readyz` to be fully
   true and one subject key to unwrap.
4. Write a signed receipt with the restore point, duration, and backup label.

The existing `test:live-stack-backup-restore-drill` lane stays. It proves,
on fixture games, that a restore preserves application state. The hosted
drill proves that the real backups restore at all. The hosted drill reuses
that lane's post-restore assertions instead of writing new ones.

The same command with `--environment production` runs weekly. If the newest production
receipt is older than 8 days, `release.mjs --environment production` refuses to run.

### Failover drill

Every quarter, and once in staging before production cutover:
`tools/db_failover.mjs --environment <env> --promote hil`. It fences the old
primary, promotes the standby, updates `DATABASE_URL` in the Kamal secrets,
redeploys the API, and rebuilds the old primary as the new standby. The
target is a 30-minute RTO.

## Release flow after migration

One script, `tools/release.mjs --environment staging|production --commit <sha>`:

1. **Repository check:** clean tree; `origin` URL equals the canonical URL;
   `<sha>` is an ancestor of `origin/main`.
2. **Proof check:** a signed Cachy receipt passes for `<sha>`'s code
   checkpoint, through `fleet_release_proof.mjs`. A docs-only commit on top
   of `<sha>` does **not** invalidate it.
3. **Images:** reuse or publish the `<sha>` runtime and frontend images and
   resolve their digests (`release_image_proof.mjs`). Production requires the
   digests recorded in the staging receipt.
4. **Preflight:** `kamal config -d <env>` resolves. Staging and production
   share no secret value, database instance ID, bucket or WorkOS client. The
   API container's own startup still fails closed on anything malformed.
5. **Lock:** `kamal lock acquire -d <env> -m "release <sha>"`. Kamal's lock
   is the only lease.
6. **Migrate:** `ssh <db-host> docker run --rm --network host --env-file
   /etc/fmarch/migrator.env ghcr.io/...@sha256:<digest> fmarch-migrate
   --operation-id <sha256(env, sha)>`.
   Migrator credentials live only on the DB host. The exit code is the
   outcome; a non-zero exit stops the release with the API untouched.
7. **Deploy:** `kamal deploy -d <env> --version <sha> --skip-push` for the
   API, then the frontend, with `boot.limit: 1` (one host at a time). The
   container command is `fmarch-schema-gate && exec fmarch-server`, and
   kamal-proxy moves traffic only after `/readyz` returns fully true. The
   script then checks that every running container's image digest equals the
   expected digest.
8. **Acceptance:** `/healthz` and `/readyz` on both origins with the expected
   commit; `hosted_acceptance.mjs`; `hosted_authenticated_acceptance.mjs`
   with a release-minted acceptance session; the public-search sentinel.
9. **Receipt:** write `target/releases/<env>/<sha>.json` with commit,
   digests, Cachy job ID, acceptance results and timestamps. Release the lock.
10. **Production only:** `git push --force-with-lease=production:<old>
    origin <sha>:production`.

Rollback is `kamal rollback -d <env> <previous-sha>`. The existing rule
stands: schema is forward-only, so an application rollback targets only a
schema-compatible release and never runs the migrator.

## Ceremony: keep and cut

### Keep

| Guarantee | Where it lives after migration |
|---|---|
| Build once, pin by digest, promote the staging-proven digest | `release_image_proof.mjs`, release steps 3 and 7 |
| Signed Cachy receipt bound to the commit | `fleet_release_proof.mjs`, step 2 |
| Least-privilege roles: migrator / application / key-admin split | Unchanged in the app and database; migrator credentials only on the DB host |
| Schema gate before a replica takes traffic | Container command plus kamal-proxy `/readyz` healthcheck |
| Staging acceptance before production, against the same digests | `hosted_acceptance.mjs`, `hosted_authenticated_acceptance.mjs`, `release_acceptance_key.mjs`, search sentinel |
| Cross-environment isolation | Preflight in step 4, plus separate Hetzner, B2, KMS and WorkOS resources per environment |
| Production pointer moves only by fast-forward | `git push --force-with-lease` in step 10 |
| Database target attestation | Environment identity marker, using `FMARCH_DATABASE_INSTANCE_ID` (D12) |
| **New:** a backup that has actually been restored | Restore drill lane |

### Cut

| Area | Today | Replacement | Why it can go |
|---|---|---|---|
| Journaled one-shot dispatch, outcome-unknown recovery, never-redispatch rules, deployment-history matching, Git-source detachment, epoch-reset journal (`release_coordinator.mjs`, `release_coordinator_contract.mjs` and test, `railway_deployment_history.mjs`, `staging_release_abandon.mjs`, `database_one_shot_policy.mjs`) | ~5,700 lines | Synchronous migrator `docker run` (step 6); epoch reset becomes a documented manual `fmarch-schema-epoch-reset` command | A process exit code is not ambiguous |
| Production promotion coordinator: promotion lock, lease resume, receipt reuse, Railway deployment validation (`production_promotion.mjs` and test) | ~2,650 lines | `release.mjs --environment production` (steps 3, 8, 10) | Same guarantees in one flow shared with staging |
| Remote git-ref staging lease, abandonment fences, `--resume-lease`, and Git transport isolation: scrubbing `GIT_*`, includes, askpass, proxies, CA bundles (`release_git_authority.mjs` and test) | ~1,500 lines | `kamal lock`; step 1; `--force-with-lease` for the pointer | Solo operator; the leases have themselves held releases hostage (3abb479a). The transport threat is a hostile Git config on the operator's own Mac, where the attacker already holds the GHCR token and SSH keys |
| Hosted variable authority (`release_hosted_variable_authority.mjs`) | ~1,100 lines | Step 4 plus fail-closed app startup | Most of it validates Railway variable shapes; the app already refuses bad configuration |
| Game day (`release_gameday.mjs`, contract and test, `release-game-day.md`) | ~1,850 lines | A quarterly manual drill: deploy an image that fails `/readyz` to staging, watch kamal-proxy keep the old one, `kamal rollback` | Most of its cohorts test Railway's early deployment status. Kamal's readiness-gated boot and rollback are tested by Kamal |
| Railway target contract (`railway_staging_target_contract.mjs`, `railway-staging-target.md`, `railway.toml`, `deploy/railway/*.railway.toml`) | ~1,850 lines | `config/deploy*.yml`, `infra/`, this document | The platform is gone |
| Receipt versions 7 and 8 | multiple schemas | One release receipt (step 9) | One shape, one reader |
| Release must use an audit of the current `main` tip | forced re-audit after docs FFs | Step 2: receipt for `<sha>`'s code checkpoint | Docs-only commits don't change what ships |
| Debug operation delay in `crates/server/src/one_shot_database.rs` | part of 277 lines | Keep the timeouts and `--operation-id` (it labels migrator logs) | Only game day used it |

`security_release_baseline.mjs`, `exact_image_content_smoke.mjs` and the
`dev_test_game_release_*` readiness tools are outside this cut and stay.

## Application changes

1. **KMS unwrap (D7).** The API accepts
   `FMARCH_SUBJECT_AUTHORITY_WRAP_KEY_CIPHERTEXT`, `FMARCH_SUBJECT_AUTHORITY_KMS_KEY_ARN`
   and decrypt-only AWS credentials in place of the plaintext key. It calls
   one SigV4-signed `TrentService.Decrypt` at startup with the encryption
   context `fmarch:environment=<env>`, `fmarch:purpose=subject-authority-wrap`
   (the IAM policy requires both), using the `aws-sigv4`
   crate and the existing HTTP client rather than the full `aws-sdk-kms`
   dependency tree. Readiness re-runs the decrypt so a revoked key takes
   replicas out of service. The plaintext variable is removed from hosted
   configuration; development keeps a local plaintext path behind
   `release_commit() == "development"`.
2. **Subject authority split (D6).** Split `FMARCH_SUBJECT_AUTHORITY_*` into
   `FMARCH_SUBJECT_JOURNAL_*` (manifest and revocations) and
   `FMARCH_SUBJECT_KEYS_*` (wrapped keys). Bootstrap writes the manifest to
   the journal store; `create`/`load`/`destroy` use the key store;
   `record_revocation` uses the journal store. `/readyz` reports both.
3. **Database instance identity (D12).** Replace
   `FMARCH_DATABASE_PROJECT_ID`/`FMARCH_DATABASE_ENVIRONMENT_ID` with
   `FMARCH_DATABASE_INSTANCE_ID` in `crates/server/src/lib.rs`, the identity
   marker table (new migration), `fmarch-schema-epoch-reset` and
   `fmarch-staging-search-corpus`.
4. **Frontend internal API URL.** `frontend/src/lib/server/api-base.mjs`
   currently accepts only `http://fmarch.railway.internal:8080`. It will
   accept an `http://` URL whose host is an RFC 1918 address (the
   environment's private load balancer, D15) and reject anything else.
5. **Container command.** The runtime image's default command becomes
   `fmarch-schema-gate && exec fmarch-server`, and `FMARCH_BIND=[::]:8080`
   is set by Kamal. The `PORT` fallback stays for local platforms.

## Slices

Each slice is one atomic, Cachy-proven checkpoint on `main`.

| Slice | Content | Done when |
|---|---|---|
| **S1 — Staging infrastructure** | [`infra/`](../../infra/README.md) OpenTofu module and cloud-init for staging; PGDG PostgreSQL 16 with private CA; pgBackRest to B2; B2 buckets, keys and lifecycle rules (including `daysFromHidingToDeleting = 1`); KMS key and IAM policy; Cloudflare DNS | `tofu apply` from empty builds staging, `infra/scripts/configure-db.sh staging` brings PostgreSQL and pgBackRest up, and `pgbackrest check` passes. Hosts, networks, load balancers and DNS can be destroyed and rebuilt from code; the locked buckets and the KMS key carry `prevent_destroy` and survive a rebuild |
| **S2 — Application changes** | Items 1–5 above plus updated `deploy/` env examples | Cachy full proof passes. A new hosted-storage conformance check against B2 passes: `PutMode::Create` conditional create is honored (else fail closed), delete removes visibility, and a locked journal object refuses deletion. Erasure smoke: a destroyed subject key has no remaining versions after 48 h |
| **S3 — Kamal release path** | `config/deploy.yml` plus staging destination; `tools/release.mjs`; container-digest verification; new receipt shape | `npm run release:staging` (now `tools/release.mjs`) deploys a Cachy-proven commit end to end and acceptance passes |
| **S4 — Drills** | Restore drill lane and schedule on fluffycachy; `tools/db_failover.mjs`; fluffycachy pull-copy job | One passing restore receipt, one staging failover-and-rebuild, one manual game-day drill, all recorded under `target/` and cited in the completeness scorecard |
| **S5 — Production cutover** | Production infrastructure from the same module (plus standby); WorkOS production redirect URIs updated to the new origins; maintenance window: scale Railway API to zero, final `pg_dump -Fc` from Railway, restore as the schema owner, run the migrator so it reconciles exact ACLs and the identity marker, `rclone sync` media and subject objects into the split buckets, `release.mjs --environment production`, cut DNS | Production `/readyz` fully true on the new host, authenticated acceptance passes, first production restore receipt written |
| **S6 — Railway deletion** | Delete every file in the Cut table, `railway.toml`, `deploy/railway/`, their proof-lane manifest entries and npm scripts (`promote:production` becomes `release:production`); archive the Railway project after 14 days of unused standby | `npm run test:proof-lane-contract` passes, and no `railway` reference remains outside git history |

Staging data is disposable, so S1–S4 start from an empty staging database.
Production data moves only in S5. Before the dump, confirm Railway's
PostgreSQL major version with `SHOW server_version`; if it is above 16, the
new hosts install that major version instead, and the proof toolchain pin is
raised to match in the same slice.

## Operating cost of the new shape

Work that moves from Railway to the operator:

- **OS patching:** unattended-upgrades for security patches; a monthly
  reboot window, one app host at a time, with the DB primary rebooted only
  after a standby check.
- **PostgreSQL minor upgrades:** quarterly, standby first and then a planned
  switchover.
- **TLS:** Cloudflare edge certificates and Hetzner LB certificates are
  managed. The private Postgres CA has a 5-year root and 1-year server
  certificates, renewed by a script that runs from the release machine.
- **Monitoring:** Hetzner metrics alerts (CPU, disk ≥ 80 %); a Cloudflare
  health check on both `/readyz` endpoints; pgBackRest `check` and
  restore-drill receipt freshness reported by the scorecard.
