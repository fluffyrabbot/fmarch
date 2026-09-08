# Database schema evolution

The schema owner has four distinct artifacts:

- `migrations/*.sql` is immutable, append-only deployment history.
- `schema/epoch.json` binds the ordered versions and SHA-256 checksums.
- `schema/current.sql` is a generated, owner-neutral snapshot of the catalog
  obtained after applying every migration. It is proof input, never deployment
  input.
- `schema/authority.json` is the separately normalized owner/ACL fingerprint.
  It replaces the credential-specific owner login with `$schema_owner` while
  preserving the exact application and key-admin role grants.

`fmarch-migrate` remains the only normal schema writer. The API and
`fmarch-schema-gate` keep application authority and may only wait for and verify
the embedded migration set. A checksum mismatch, failed migration, or database
newer than the binary remains terminal.

## Ordinary schema changes

1. Add the next contiguous `NNNN_descriptive_name.sql` file. Do not edit an
   existing migration.
2. Append its filename, version, and checksum to `schema/epoch.json`.
3. Run `npm run generate:database-schema` against repo-local disposable
   Postgres. Commit the regenerated snapshot and epoch checksum.
4. Run the previous-to-current upgrade lane. When authority intentionally
   changes, run that proof once with `--write-authority`, review the normalized
   fingerprint, and commit its epoch checksum.
5. Run the static contract and previous-to-current upgrade lane. Direct or
   destructive forward DDL is allowed while the product is greenfield; the
   migration must still yield the same catalog/ACL result as a fresh database.
6. Release through the exact-commit coordinator. Ordinary releases never
   recreate a persistent database or change `_sqlx_migrations` manually.

## Epoch resets

Squashing is not an ordinary migration operation. It creates a new epoch and
requires deliberate recreation of every persistent environment. Before an
epoch reset, record environment, exact commit, prior epoch/head, a
catalog-derived count for every base or partitioned table, and the re-bootstrap
sources. `_sqlx_migrations` is the only table permitted to be nonempty. Stop if
any application table is nonempty or if any data-bearing relation kind cannot
be classified.

For each environment, recreate the isolated application database/schema using
the schema-owner credential, leaving no hand-edited SQLx rows. Then run the
coordinator: migrator and ACL verification first, API/frontend health second,
and environment-specific bootstrap/sentinel last. Record the new migration
checksums and the coordinator release receipt. Staging must be proven before
the production release pointer advances.

The coordinator journals the high-level epoch reset and every database one-shot
as immutable files under `target/releases/<environment>/`. Before reset audit,
reset execution, and post-reset migration, it records an exact intent containing
the environment, epoch/phase, commit, runtime repository and digest, canonical
variable hash, production lease when applicable, generation, start command,
and deterministic operation ID. Railway returns the exact deployment ID through
`serviceInstanceDeployV2`; the coordinator durably binds and waits for that ID.
If the V2 response is lost, bounded history may recover one exact command/image
match, while zero or multiple matches remain outcome-unknown. `FAILED` or
`CRASHED` closes a generation and permits one journaled successor. `SUCCESS`
without the exact operation-and-commit log is ambiguous and is never
redispatched. Ordinary migration uses this same protocol rather than relying on
mutable latest-deployment state.

The requested reset epoch must equal `schema/epoch.json` at the exact release
Git commit, and `fmarch-schema-epoch-reset` independently requires the same
epoch embedded in its image at build time. Every persistent database first has
a create-only identity bound explicitly to the canonical Railway project UUID,
environment UUID, and environment name. Normal migrator/reset paths only
verify that owner-only row; they never create, relabel, or repair it. The reset
binary owns a private
`fmarch_release_authority.schema_epoch_reset_completion` ledger outside the
dropped `public` schema. It validates exact database-owner-only schema/table ACLs,
relation shape, primary key, row-security state, and trigger absence before
trusting it. `DROP/CREATE public` and insertion of the exact
environment–epoch–commit prior-count evidence commit in one transaction under
the shared database-operation advisory lock. Execute takes `ACCESS EXCLUSIVE`
locks on the complete, stably ordered public data-relation inventory, recounts,
and requires the exact audit inventory plus digest supplied by the coordinator
before `DROP`; a post-audit insert therefore aborts without destroying data.
A retry after commit but before stdout reconstructs the same audit/completion
from that ledger and never repeats the drop. The filesystem phase journal is
orchestration evidence, not the authority for whether the database transaction
committed. Only an exact Railway `FAILED`/`CRASHED` result permits the single
successor generation, allowing the reset ledger or SQLx history to prove an
already-committed operation. Missing logs after Railway `SUCCESS` and every
other terminal state fail closed for operator investigation.

Both binaries require a journal-derived `--operation-id` and share a bounded
maintenance policy: 30-second pool acquisition, 60-second lock wait,
five-minute statement execution, and ten-minute overall operation. The
coordinator's 15-minute exact-deployment wait is strictly larger. Cancellation
closes the physical SQLx connections and releases session locks; the migrator
also reapplies the deadlines after the frozen epoch-one baseline resets session
settings. That immutable baseline is bounded by the five-minute process-side
statement cap while its embedded timeout resets are active; subsequent lock
waits again use the 60-second session limit. Debug integration tests may only
shorten the canonical values.

The canonical `cargo:server` Postgres lane exercises the test-only
`after-commit-before-output` failpoint, exact ledger recovery without a second
drop, changed-inventory refusal, and a successful migration after recovery. It
also holds the shared operation lock and proves both binaries exit within short
debug deadlines, leave a reset canary and revoked privilege untouched, and
retain no database sessions after cancellation.

Epoch one has one exceptional cutover: staging briefly applied a rewritten
`0001` checksum before append-only history existed. Freeze the pre-rewrite
`0001`, apply the durable mute FK as `0002`, and recreate staging once. Recreate
production only on its first epoch-one promotion. No later schema edit may use
this exception.
