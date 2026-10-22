# fmarch hosting infrastructure

OpenTofu configuration for the Hetzner + Kamal hosting described in
[the migration RFC](../docs/ops/hetzner-kamal-migration.md). Staging is
built first (slice S1); production reuses the same module in S5.

| Path | Purpose |
|---|---|
| `bootstrap/` | One-time root that creates the B2 bucket holding all OpenTofu state |
| `modules/environment/` | Everything one environment needs: network, firewall, app and DB hosts, PGDATA volume, public and private load balancers, PostgreSQL CA, Cloudflare origin certificate and DNS, B2 buckets and keys, KMS key and decrypt-only IAM user |
| `environments/staging/` | Staging root: encrypted B2 backend plus the module call |
| `scripts/configure-db.sh` | Configures PostgreSQL, TLS, pgBackRest and the migrator env file on the DB host from OpenTofu outputs |
| `scripts/wrap-authority-key.sh` | Encrypts the subject-authority wrapping key under the environment's KMS key |

`npm run test:infra-contract` checks the safety invariants (locked buckets,
least-privilege keys, IP-pinned KMS decrypt, encrypted state, secret-free
user data, SSH-only public firewall) without needing OpenTofu or credentials.

## Credentials

Keep everything under `~/secure/fmarch/`. OpenTofu reads provider
credentials from the environment:

| Variable | Scope |
|---|---|
| `HCLOUD_TOKEN` | Read/write token for the Hetzner project of that environment |
| `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY` | B2 key that can create buckets and keys |
| `AWS_PROFILE` | AWS profile that can manage KMS keys and IAM users |
| `CLOUDFLARE_API_TOKEN` | Zone DNS edit plus SSL and Certificates edit on the zone |

The filled-in `infra.tfvars` (from `environments/staging/staging.tfvars.example`)
lives at `~/secure/fmarch/staging/infra.tfvars`, never in the repository.

## One-time setup

1. Set the Cloudflare zone's SSL/TLS mode to **Full (strict)**. It is a
   zone-wide setting shared by staging and production, so it is set by hand
   rather than by either environment.
2. Create the state bucket:

   ```sh
   tofu -chdir=infra/bootstrap init -var bootstrap_state_path="$HOME/secure/fmarch/tofu-bootstrap.tfstate" -var state_passphrase="$FMARCH_TOFU_PASSPHRASE" -var bucket_prefix=<prefix>
   tofu -chdir=infra/bootstrap apply -var bootstrap_state_path="$HOME/secure/fmarch/tofu-bootstrap.tfstate" -var state_passphrase="$FMARCH_TOFU_PASSPHRASE" -var bucket_prefix=<prefix>
   tofu -chdir=infra/bootstrap output -json state_key
   ```

   Copy the bucket name and key into `~/secure/fmarch/staging/infra.tfvars`.

## Build staging

```sh
tofu -chdir=infra/environments/staging init -var-file="$HOME/secure/fmarch/staging/infra.tfvars"
tofu -chdir=infra/environments/staging apply -var-file="$HOME/secure/fmarch/staging/infra.tfvars"
infra/scripts/configure-db.sh staging
infra/scripts/wrap-authority-key.sh staging
```

`configure-db.sh` waits for cloud-init, installs the PostgreSQL TLS
material, writes `postgresql.conf` and `pg_hba.conf`, creates the
`fmarch_owner` login (`CREATEROLE`, not superuser) and the `fmarch`
database, creates the pgBackRest stanza, takes the first full backup,
enables the weekly full and daily differential timers, and writes
`/etc/fmarch/migrator.env`. Check the result with:

```sh
ssh deploy@<db public ip> sudo -u postgres pgbackrest --stanza=fmarch check
```

## Rebuilding and renewal

- **Hosts, networks, load balancers and DNS** are disposable. Destroying
  and re-applying them is the rebuild path. The DB host reattaches the same
  PGDATA volume; rerun `configure-db.sh` afterwards.
- **The PGDATA volume, all B2 buckets and the KMS key** carry
  `prevent_destroy`. Buckets are under compliance Object Lock and cannot be
  emptied early by anyone, including the account owner.
- **PostgreSQL server certificate:** valid for one year. Any `tofu apply`
  within 30 days of expiry replaces it; then rerun `configure-db.sh`. The
  CA is valid for five years.
- **State recovery:** the state bucket keeps every version for 90 days
  after it is replaced. State is encrypted with the passphrase in
  `~/secure/fmarch`; losing that passphrase loses the state, but not the
  infrastructure, which can be re-imported.

## Not in this slice

Kamal configuration and the release script come in S3. App-host secrets
(bucket keys, KMS decrypt credential, the PostgreSQL CA for clients) are read
from these outputs by that release path. The production standby and
WireGuard come in S5.
