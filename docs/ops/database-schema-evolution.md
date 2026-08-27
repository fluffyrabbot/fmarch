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
epoch reset, record environment, exact commit, prior epoch/head, row counts for
identity/profile/mute/event/search state, and the re-bootstrap sources. Stop if
the audit finds state outside the declared reset plan.

For each environment, recreate the isolated application database/schema using
the schema-owner credential, leaving no hand-edited SQLx rows. Then run the
coordinator: migrator and ACL verification first, API/frontend health second,
and environment-specific bootstrap/sentinel last. Record the new migration
checksums and the coordinator release receipt. Staging must be proven before
the production release pointer advances.

Epoch one has one exceptional cutover: staging briefly applied a rewritten
`0001` checksum before append-only history existed. Freeze the pre-rewrite
`0001`, apply the durable mute FK as `0002`, and recreate staging once. Recreate
production only on its first epoch-one promotion. No later schema edit may use
this exception.
