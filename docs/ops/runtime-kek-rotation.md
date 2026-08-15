# Runtime KEK rotation and retirement

Runtime event KEKs wrap per-stream DEKs and directly seal a closed registry of
private projection and identity-delivery envelopes. Rotate them with the
deployable `fmarch-event-key-admin` binary; never pass key bytes as arguments or
write them into its JSON reports.

## Preconditions

- Work from a clean, pushed `main` commit and a protected ephemeral shell built
  from `deploy/railway/key-admin.env.example`. It receives the intended
  environment's `DATABASE_KEY_ADMIN_URL` for fixed role `fmarch_key_admin`; it
  must not receive `DATABASE_URL` or `DATABASE_MIGRATION_URL`. The URL must
  contain exactly one explicit `sslmode=require`, `sslmode=verify-ca`, or
  `sslmode=verify-full`; omitted, `disable`, `allow`, and `prefer` modes are
  forbidden for this KEK-bearing administrative process.
- Generate a new canonical base64-encoded 32-byte key and a never-before-used
  KID that starts with an ASCII letter or digit and then contains only ASCII
  letters, digits, `.`, `_`, `:`, or `-`. Keep the
  old key in offline escrow until all backups containing old-KID ciphertext
  have expired.
- Configure the new key as `FMARCH_EVENT_WRAP_KEY`/`FMARCH_EVENT_WRAP_KID` and
  retain the old pair temporarily in `FMARCH_EVENT_WRAP_KEYS=old-kid=old-key`.
  Deploy every API replica and pass startup/readiness before proceeding.
- Use the exact image built for that deployment. The runtime image contains
  `fmarch-event-key-admin`; its stdout is one secret-free JSON report. Never
  add `DATABASE_KEY_ADMIN_URL` to the API, frontend, or migrator service. Destroy
  the shell/container after the bounded operation.

## Online migration

Preview all references without changing state:

```sh
env -u DATABASE_URL -u DATABASE_MIGRATION_URL \
  fmarch-event-key-admin runtime-kek plan \
  --retiring-kid old-kid \
  --expect-active-kid new-kid
```

Fence the old KID and migrate in bounded, restart-safe batches:

```sh
env -u DATABASE_URL -u DATABASE_MIGRATION_URL \
  fmarch-event-key-admin runtime-kek migrate \
  --retiring-kid old-kid \
  --expect-active-kid new-kid \
  --batch-size 256 \
  --execute
```

The first mutation waits for old-key writers, changes the registry row to
`retiring`, and prevents any new old-KID envelope. Re-running `migrate` resumes
unfinished batches; after a completed rehearsal or retirement it returns an
audited no-op. Do not manually edit the lifecycle registry, generated KID
columns, or reference view.

## Removal rehearsal and retirement

Run the admin binary once with the old KID omitted from its historical keyring.
This one-off process uses the same database and new active key.

```sh
env -u DATABASE_URL -u DATABASE_MIGRATION_URL -u FMARCH_EVENT_WRAP_KEYS \
  fmarch-event-key-admin runtime-kek rehearse \
    --retiring-kid old-kid \
    --expect-active-kid new-kid \
    --execute
```

Rehearsal rechecks zero stream and direct-envelope references, authenticates
the remaining online keys, and stores write-once evidence. The command never
emits the rehearsal token.

Now remove the old entry from the hosted `FMARCH_EVENT_WRAP_KEYS`, redeploy all
API replicas, and require the exact deployed commit to pass startup custody
audit and `/readyz`. Only after that successful removal rollout may the
operator finalize retirement:

```sh
env -u DATABASE_URL -u DATABASE_MIGRATION_URL -u FMARCH_EVENT_WRAP_KEYS \
  fmarch-event-key-admin runtime-kek retire \
    --retiring-kid old-kid \
    --expect-active-kid new-kid \
    --execute
```

Retirement repeats the zero-reference checks, consumes the durable evidence,
nulls obsolete online sentinel bytes, and leaves a permanent KID tombstone.
Startup/readiness reject a configured active or historical key whose tombstone
is retired, so a skipped or rolled-back removal deployment fails closed.

A retired KID must never be reused even with different key material.

## Restore discipline

A backup captured before migration can still contain ciphertext under the old
KID. Restore it only into an isolated environment with the escrowed old key,
run this complete migration and removal rehearsal there, and prove application
reads before promotion. Deleting escrow is safe only after every such backup is
expired or independently proven migrated. Archive KEKs and subject-authority
keys are separate custody domains and are not rotated by this procedure.

## Trust boundary

The row locks, triggers, generated KID columns, and foreign keys protect against
stale application replicas, interrupted operators, and concurrent online
writes. The long-lived `fmarch_application` role cannot mutate lifecycle rows,
disable triggers, alter the schema, or assume the isolated schema-owner role. The
one-shot `fmarch_key_admin` role receives only the registered lifecycle/reseal
surface and likewise cannot alter schema or triggers. The migrator reconciles
and audits exact ownership, role membership, default ACLs, `PUBLIC` revocations,
and forbidden extra privileges before either credential is admitted.

The direct schema-owner database credential remains a higher trust boundary:
compromise of that migrator-only secret can rewrite schema and
disable these database guards. `DATABASE_MIGRATION_URL` remains stored only on
the one-shot Railway migrator service and is absent from API, frontend, and
key-admin processes. Rotate it under the release-secret custody procedure, not
after every successful migrator run; during rotation, drain or terminate
sessions authenticated with the retiring credential before treating revocation
as effective. It is never colocated with event KEKs. A compromised PostgreSQL
administrator remains outside the runtime-KEK guarantee.

This split has a deliberate residual risk. A compromised application process
still holds broad business DML and active runtime KEKs, and can therefore corrupt
permitted business state or expose plaintext it can normally decrypt. Isolating
the migrator and key-admin protects DDL, migration history, database guards, and
the KEK lifecycle; it does not protect all business integrity or plaintext from
an already-compromised API.
