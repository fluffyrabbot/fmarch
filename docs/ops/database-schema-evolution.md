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

The coordinator journals epoch reset intent and every phase as immutable files
under `target/releases/<environment>/schema-epoch-reset/`, keyed by exact
environment, epoch, commit, runtime digest, and canonical Railway topology. It
records the prior migrator deployment before dispatching the destructive reset.
After interruption it inspects the succeeding Railway deployment and requires
the expected image digest. A failed or log-ambiguous successor is re-dispatched
once with that same digest; the binary reads the database ledger to distinguish
committed completion from work that still must run. Migration completion is
likewise recovered only from a same-digest deployment and exact-commit record.

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
A retry after commit but before
stdout reconstructs the same audit/completion from that ledger and never
repeats the drop. The filesystem phase journal is orchestration evidence, not
the authority for whether the database transaction committed. If a Railway
reset or SQLx migrator process is `FAILED`/`CRASHED`, or succeeds without its
terminal log, the coordinator re-dispatches the same digest once so the reset
can read the ledger or SQLx can verify its already-committed history; other
terminal states fail closed.

The canonical `cargo:server` Postgres lane exercises the test-only
`after-commit-before-output` failpoint, exact ledger recovery without a second
drop, changed-inventory refusal, and a successful migration after recovery.

Epoch one has one exceptional cutover: staging briefly applied a rewritten
`0001` checksum before append-only history existed. Freeze the pre-rewrite
`0001`, apply the durable mute FK as `0002`, and recreate staging once. Recreate
production only on its first epoch-one promotion. No later schema edit may use
this exception.
