# Profile handle-index rotation

`member_profile.handle_hmac` is a keyed blind index for active-handle
uniqueness. It is derived from the sealed profile claim and is deliberately not
stored in canonical profile events. Replaying a profile stream therefore uses
the key active at replay time, which makes rotation a projection reindex rather
than an event-history migration.

This is a maintenance cut, not an environment-variable rollout. Do not change
`FMARCH_PROFILE_HANDLE_INDEX_KEY` or `FMARCH_PROFILE_HANDLE_INDEX_KID` on a live
API service before the reindex has completed.

## Preconditions

- The deployed API is this version or later: compatible profile writers take a
  shared PostgreSQL advisory lease, and startup audits every active reservation.
- A protected, short-lived operator shell has only the application
  `DATABASE_URL`, the subject-key authority configuration, the current active
  `FMARCH_PROFILE_HANDLE_INDEX_KEY` and `FMARCH_PROFILE_HANDLE_INDEX_KID`, and
  the new `FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY`. It has no migration,
  key-admin, event-encryption, authentication-signing, or media credentials.
- The replacement key is a distinct non-placeholder value of at least 32 bytes.
  Pick a new public KID before starting; it must differ from the current KID.
- Every API replica, worker, script, and older binary that can create or update
  a profile has an identified stop/drain procedure. The command's
  `--writers-drained` flag is an operator acknowledgement, not a distributed
  shutdown mechanism.

## Rotation

1. In the protected shell, first perform the read-only audit. It verifies the
   active key against every sealed profile claim and reports only KIDs and a
   count:

   ```sh
   fmarch-profile-index-admin profile-handle-index plan \
     --expect-current-kid profile-index-v1 \
     --replacement-kid profile-index-v2
   ```

2. Drain and stop every profile writer, including all API replicas and
   background/operator jobs. Confirm no pre-lease version remains connected.
   Keep the API stopped for the rest of the procedure.

3. Re-run the plan if the drain took material time, then run the guarded cut:

   ```sh
   fmarch-profile-index-admin profile-handle-index reindex \
     --expect-current-kid profile-index-v1 \
     --replacement-kid profile-index-v2 \
     --writers-drained --execute
   ```

   The command takes an exclusive advisory lease, validates every current
   token/claim pair, and updates all active reservations in one database
   transaction. It never accepts or prints key material. A failure rolls the
   transaction back; leave the old API configuration in place and investigate.

4. Still with traffic drained, atomically set the API service's
   `FMARCH_PROFILE_HANDLE_INDEX_KEY` and
   `FMARCH_PROFILE_HANDLE_INDEX_KID=profile-index-v2` to the replacement
   values. Remove `FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY` from the shell
   and service configuration. The API must contain only the replacement active
   key; do not leave the prior key in any live service variable. Deploy/restart
   the API.

5. Require the API's startup audit/readiness to pass. Exercise an owner profile
   read and prove that creating a second profile with an existing handle is
   rejected. Record the KID, operator report count, deployment commit, and
   proof with the release record. Only after that successful redeploy and proof,
   retire the prior key from hosted release-secret custody: ensure no live
   service variable retains it, mark its KID retired in the release record, and
   retain a recovery copy solely in offline escrow. Destroy that escrowed copy
   when the declared recovery window is over.

## Recovery

After a successful reindex, the old API configuration will correctly fail its
startup audit because the stored reservations now use the replacement key. Keep
it stopped; do not bypass the audit. If the replacement deployment cannot be
repaired, remain drained and perform a deliberate reverse cut: configure the
maintenance shell with the replacement as the current key/KID and the prior
secret as `FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY`, then reindex back with
new explicit KIDs. Only restart a service after its configured key matches the
stored projection.
