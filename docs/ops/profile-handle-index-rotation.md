# Profile handle-index rotation

`member_profile.handle_hmac` is a keyed blind index for active-handle uniqueness. It is derived from the sealed profile claim and is deliberately absent from canonical profile events. Rotation is therefore a projection reindex, never an event-history migration.

This is a drained maintenance cut. Do not change `FMARCH_PROFILE_HANDLE_INDEX_KEY` or `FMARCH_PROFILE_HANDLE_INDEX_KID` on a live API service before the reindex completes.

## Authority boundary

The canonical operator surface is a local, short-lived shell. It opens an SSH-only Railway database tunnel, uses `railway run --service api` only to read current API variables, then spawns the admin binary with the exact fresh-environment allowlist in [`deploy/railway/profile-index-admin.env.example`](../../deploy/railway/profile-index-admin.env.example). It executes a locally built `fmarch-profile-index-admin` once and exits. No Railway service, service variable, persistent file, log, or admin command argument may contain replacement material.

The outer `railway run` process necessarily receives the API environment. It must do no work except the fixed allowlist copy below, run with xtrace off, and never print, redirect, or persist its environment. The admin child receives only application-database, profile-index, and subject-authority custody; it rejects migration/key-admin, event, media, authentication, and ambient `PG*` authority.

Never use `railway run env`, `railway run printenv`, `railway variable list --kv`, or `railway variable list --json` during this procedure. Those commands can disclose secret values. Never create a `profile-index-admin` Railway service: there is no durable runner to clean up and no replacement key is ever a service variable.

## Preconditions

- Work from a clean, pushed `main` commit whose SHA exactly matches the active staging API deployment. Build the local binary from that commit before opening the protected shell:

  ```sh
  cargo build --release -p server --bin fmarch-profile-index-admin
  ```

- Confirm the API has exactly two replicas and its active public KID. Choose a new, unused KID using only letters, digits, `.`, `_`, or `-`. The binary independently checks that KIDs and key material differ.
- This SSH-tunnel procedure is permitted only when the API `DATABASE_URL` has exactly one `sslmode=require`. It must fail closed for `verify-ca` or `verify-full`: rewriting their hostname to loopback would not preserve certificate-name verification. Do not weaken an API URL to make the tunnel work; use a separately reviewed runner that preserves the database hostname instead.
- Confirm an offline escrow copy of the current key already exists. It is the only recovery copy; do not export the old key from Railway during this run. Hold it for the 30-day recovery window.
- Declare a maintenance window and freeze `main` pushes, manual API deploys, and profile-projection jobs until two replicas are healthy again. A concurrent source deployment could defeat the drain.
- Inventory every profile writer: both API replicas, the in-process subject-erasure worker, any profile-projection rebuild, operator maintenance job, and pre-lease/legacy binary. `--writers-drained` is an acknowledgement, not a distributed shutdown.

## Tunnel and protected child

In each terminal, set the non-secret selectors below. `API_SERVICE` and `POSTGRES_SERVICE` are required Railway service names or IDs; do not assume generic service names. `CURRENT_KID` is the active API KID and `REPLACEMENT_KID` is the new public KID.

```sh
set -euo pipefail
set +x
PROJECT_ID=replace-with-railway-project-id
ENVIRONMENT=staging
API_SERVICE=replace-with-api-service-name-or-id
POSTGRES_SERVICE=replace-with-postgres-service-name-or-id
API_BASE_URL=https://fmarch-staging.up.railway.app
TUNNEL_PORT=5546
CURRENT_KID=replace-with-confirmed-active-public-kid
REPLACEMENT_KID=replace-with-new-unused-public-kid
ADMIN_BINARY="$PWD/target/release/fmarch-profile-index-admin"
test -x "$ADMIN_BINARY"
```

In the first terminal, establish a private tunnel to the explicitly selected environment-local Postgres service. Pick an unused loopback port; this is not a public proxy.

```sh
railway connect "$POSTGRES_SERVICE" --ssh --tunnel-only --port "$TUNNEL_PORT" --project "$PROJECT_ID" --environment "$ENVIRONMENT"
```

Keep that command running. In the second terminal, use the same selectors and local binary path from the preceding block.

Define this fixed local helper. It accepts only `plan` or `reindex`; replacement material enters over standard input. The Node launcher validates `sslmode=require`, verifies the API's active KID against the locally selected public KID, rewrites only host and port to the SSH tunnel, and uses `spawnSync(..., { env: childEnv })` to make a fresh child environment. It adds `--writers-drained --execute` only for `reindex`. It never puts replacement material in the admin command arguments or prints the rewritten URL.

```sh
profile_index_admin() {
  mode=$1
  case "$mode" in plan|reindex) ;; *) return 64 ;; esac
  railway run --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service "$API_SERVICE" --no-local -- node -e '
    const { spawnSync } = require("node:child_process");
    const { readFileSync } = require("node:fs");
    const [adminBinary, currentKid, replacementKid, mode, tunnelPort] = process.argv.slice(1);
    if (!["plan", "reindex"].includes(mode)) process.exit(64);
    if (!/^[1-9]\d{0,4}$/.test(tunnelPort) || Number(tunnelPort) > 65535) process.exit(64);
    const input = readFileSync(0, "utf8");
    const replacement = /^([^\r\n]+)\r?\n$/.exec(input)?.[1];
    if (!replacement) process.exit(64);
    let localDatabaseUrl;
    try {
      const url = new URL(process.env.DATABASE_URL);
      if (url.searchParams.getAll("sslmode").length !== 1 || url.searchParams.get("sslmode") !== "require") process.exit(64);
      url.hostname = "127.0.0.1";
      url.port = tunnelPort;
      localDatabaseUrl = url.toString();
    } catch {
      process.exit(64);
    }
    const childEnv = {
      DATABASE_URL: localDatabaseUrl,
      FMARCH_PROFILE_HANDLE_INDEX_KEY: process.env.FMARCH_PROFILE_HANDLE_INDEX_KEY,
      FMARCH_PROFILE_HANDLE_INDEX_KID: process.env.FMARCH_PROFILE_HANDLE_INDEX_KID,
      FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY: replacement,
      FMARCH_SUBJECT_AUTHORITY_ENDPOINT: process.env.FMARCH_SUBJECT_AUTHORITY_ENDPOINT,
      FMARCH_SUBJECT_AUTHORITY_REGION: process.env.FMARCH_SUBJECT_AUTHORITY_REGION,
      FMARCH_SUBJECT_AUTHORITY_BUCKET: process.env.FMARCH_SUBJECT_AUTHORITY_BUCKET,
      FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID: process.env.FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID,
      FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY: process.env.FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY,
      FMARCH_SUBJECT_AUTHORITY_URL_STYLE: process.env.FMARCH_SUBJECT_AUTHORITY_URL_STYLE ?? "path",
      FMARCH_SUBJECT_KEY_AUTHORITY_REVISION: process.env.FMARCH_SUBJECT_KEY_AUTHORITY_REVISION,
      FMARCH_SUBJECT_AUTHORITY_ID: process.env.FMARCH_SUBJECT_AUTHORITY_ID,
      FMARCH_SUBJECT_AUTHORITY_WRAP_KID: process.env.FMARCH_SUBJECT_AUTHORITY_WRAP_KID,
      FMARCH_SUBJECT_AUTHORITY_WRAP_KEY: process.env.FMARCH_SUBJECT_AUTHORITY_WRAP_KEY,
      FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: process.env.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID,
      FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: process.env.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY
    };
    if (Object.values(childEnv).some((value) => typeof value !== "string")) process.exit(64);
    if (childEnv.FMARCH_PROFILE_HANDLE_INDEX_KID !== currentKid) process.exit(64);
    const args = ["profile-handle-index", mode, "--expect-current-kid", currentKid, "--replacement-kid", replacementKid];
    if (mode === "reindex") args.push("--writers-drained", "--execute");
    const child = spawnSync(adminBinary, args, { env: childEnv, stdio: "inherit" });
    process.exit(child.error || child.status !== 0 ? child.status ?? 1 : 0);
  ' "$ADMIN_BINARY" "$CURRENT_KID" "$REPLACEMENT_KID" "$mode" "$TUNNEL_PORT"
}
```

Create one replacement secret but do not export it. It remains only long enough to audit, reindex, and set the active API variable:

```sh
replacement_key="$(openssl rand -base64 48)"
profile_index_admin plan <<EOF
$replacement_key
EOF
```

The plan report is secret-free: status, read-only flag, current/replacement KIDs, active-profile count, and drain requirement. Read it in the terminal and transcribe only those fields into the receipt. Do not redirect or pipe `railway run` output to a file, `tee`, `jq`, or another process.

## Two-replica Railway drain and cut

1. Confirm `deploy.numReplicas = 2`, no multi-region override, no active deployment, and the expected deployment commit. The API scale is the first writer drain, not sufficient evidence by itself.

2. Scale the API to zero with explicit selectors:

   ```sh
   railway environment edit --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service-config "$API_SERVICE" deploy.numReplicas 0 --message "drain API for profile handle-index rotation"
   ```

   Observe terminal deployment state with `railway deployment list`, then require Railway's service/replica view to show **zero live API replicas**. A successful config update alone is not drain evidence. If the scale-down deployment fails or is not terminal within ten minutes, stop: do not run the admin helper.

3. Stop every non-API writer from the inventory. Record the subject-erasure worker as stopped with API, and each profile rebuild, operator maintenance job, and legacy-writer sweep as `stopped` or `absent`. Keep API at zero; do not start an old binary.

4. Re-run the plan with the same in-memory secret. Its count and current KID must be expected after the drain:

   ```sh
   profile_index_admin plan <<EOF
   $replacement_key
   EOF
   ```

5. Run the guarded cut. It obtains the exclusive maintenance lease, verifies every sealed claim/token pair, and updates all active reservations in one transaction. A failure rolls back; leave API at zero and investigate.

   ```sh
   profile_index_admin reindex <<EOF
   $replacement_key
   EOF
   ```

6. While API traffic remains zero, stage the replacement active configuration without an intermediate deployment. API must never receive `FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY`.

   ```sh
   railway variable set --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service "$API_SERVICE" --skip-deploys --stdin FMARCH_PROFILE_HANDLE_INDEX_KEY <<EOF
   $replacement_key
   EOF
   railway variable set --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service "$API_SERVICE" --skip-deploys "FMARCH_PROFILE_HANDLE_INDEX_KID=$REPLACEMENT_KID"
   ```

   Inspect the API Variables view, or use `railway variable list` without `--kv` or `--json`, to verify the replacement-only variable is absent. Do not record the variable output. Once both active values are staged, remove the local replacement:

   ```sh
   unset replacement_key
   ```

7. Restore exactly two replicas. Capture the replacement deployment ID and the locked `main` SHA from Railway's deployment view, then poll the same ID every 10–15 seconds for at most ten minutes. It must reach terminal `SUCCESS`; any terminal failure, a different deployment ID/commit, or timeout leaves API at zero and enters recovery. Only after that success, require the service view to show exactly two live replicas and run readiness.

   ```sh
   railway environment edit --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service-config "$API_SERVICE" deploy.numReplicas 2 --message "restore API after profile handle-index rotation"
   # Repeat this lookup every 10–15 seconds; keep the same deployment ID and commit.
   railway deployment list --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service "$API_SERVICE" --limit 5 --json
   ```

   After that deployment reaches `SUCCESS` for the locked commit:

   ```sh
   railway service status --project "$PROJECT_ID" --environment "$ENVIRONMENT" --service "$API_SERVICE" --json
   curl --fail --silent --show-error "$API_BASE_URL/readyz"
   ```

   Require two live replicas, `/readyz`, an owner-profile read, and a rejected attempt to create a second profile with an existing handle. Use a controlled staging account; the receipt records only passed booleans, never a principal, handle, cookie, or request trace.

8. Only after all checks pass, unfreeze normal staging deploys. The old key stays solely in existing offline escrow and is absent from every live service variable.

## Recovery

Never restart the old-key API against a successfully reindexed projection; its startup audit must fail.

- If `reindex` fails, its transaction is rolled back. Keep API at zero, retain the old configuration, diagnose, then restore two replicas.
- If reindex succeeds but setting API variables fails, remain drained. Make a deliberate reverse cut with replacement key/current KID as the active configuration and offline old key/old KID as replacement. Do not perform a direct service-variable flip.
- If API variables were staged but deployment fails, remain at zero. Call the helper with new KID as `CURRENT_KID`, old KID as `REPLACEMENT_KID`, and deliver the escrowed old key over its standard input. After the reverse reindex, restore old API key/KID while at zero, then restore two replicas.

Every recovery is a new maintenance event. Record a separate redacted incident entry; do not overwrite a rotation receipt or include a secret in it.

## Receipt and retention

Use [`profile-handle-index-rotation-receipt.schema.json`](profile-handle-index-rotation-receipt.schema.json). It permits only two immutable, secret-free records:

1. `profile_handle_index_rotation`, written immediately after the successful two-replica redeploy. It records public KIDs, active-profile counts, deployed commit/deployment ID, drain/redeploy booleans, the tunnel/allowlist path, and the 30-day escrow deadline.
2. `profile_handle_index_escrow_destruction`, written after the recovery window and old-key escrow destruction. It links the prior receipt by SHA-256 over the exact stored UTF-8 bytes, not a key value, and records its seven-year `retain_until` deadline.

Store receipts in an access-controlled, append-only release-evidence ledger outside the repository, Railway variables, application database, and service logs. Closed schema objects prohibit free-form command output, URLs, secret names/values, handles, principal IDs, and operator PII. Before append, validate a protected local copy without emitting its contents:

```sh
node tools/profile_handle_index_rotation_receipt.mjs --rotation "$ROTATION_RECEIPT"
```

The command prints only a pass/fail line and the rotation receipt SHA-256. Use that exact digest in the later destruction receipt, then validate the linked pair before appending the destruction record:

```sh
node tools/profile_handle_index_rotation_receipt.mjs --rotation "$ROTATION_RECEIPT" --destruction "$DESTRUCTION_RECEIPT"
```

Write every receipt timestamp in UTC (`Z`). Hold the old key in offline escrow for **30 calendar days** after the successful redeploy. At day 30, confirm no recovery needs it, destroy the escrowed bytes, and append the destruction receipt. Set its `retention_years` to `7` and `retain_until` no earlier than seven calendar years after destruction. Retain the linked pair for **seven years after the destruction receipt**, or longer under an incident or legal hold. A delayed destruction receipt delays the retention clock; it never authorizes early destruction.
