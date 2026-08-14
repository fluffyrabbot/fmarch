# Runtime KEK rotation and retirement

Runtime event KEKs wrap per-stream DEKs and directly seal a closed registry of
private projection and identity-delivery envelopes. Rotate them with the
deployable `fmarch-event-key-admin` binary; never pass key bytes as arguments or
write them into its JSON reports.

## Preconditions

- Work from a clean, pushed `main` commit and the intended environment's
  `DATABASE_URL`.
- Generate a new canonical base64-encoded 32-byte key and a never-before-used
  KID that starts with an ASCII letter or digit and then contains only ASCII
  letters, digits, `.`, `_`, `:`, or `-`. Keep the
  old key in offline escrow until all backups containing old-KID ciphertext
  have expired.
- Configure the new key as `FMARCH_EVENT_WRAP_KEY`/`FMARCH_EVENT_WRAP_KID` and
  retain the old pair temporarily in `FMARCH_EVENT_WRAP_KEYS=old-kid=old-key`.
  Deploy every API replica and pass startup/readiness before proceeding.
- Use the exact image built for that deployment. The runtime image contains
  `fmarch-event-key-admin`; its stdout is one secret-free JSON report.

## Online migration

Preview all references without changing state:

```sh
fmarch-event-key-admin runtime-kek plan \
  --retiring-kid old-kid \
  --expect-active-kid new-kid
```

Fence the old KID and migrate in bounded, restart-safe batches:

```sh
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
env -u FMARCH_EVENT_WRAP_KEYS \
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
env -u FMARCH_EVENT_WRAP_KEYS \
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
writes. They are not a security boundary against a PostgreSQL table owner that
can disable triggers or alter the schema. Until the deployment uses distinct
migration-owner and least-privilege runtime roles, compromise of the shared
database-owner credential remains outside this guarantee.
