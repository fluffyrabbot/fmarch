import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertCompleteExactImageTiming,
  createExactImageTiming,
  exactImageTimingPhases,
} from "./exact_image_content_smoke.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await contract();
console.log("railway staging target contract passed");

async function contract() {
  const source = Object.fromEntries(
    await Promise.all(
      [
        "Dockerfile",
        ".dockerignore",
        ".env.example",
        "railway.toml",
        "deploy/railway/migrator.railway.toml",
        "Dockerfile.frontend",
        "deploy/railway/frontend.railway.toml",
        "frontend/package.json",
        "frontend/svelte.config.js",
        "deploy/railway/api.env.example",
        "deploy/railway/migrator.env.example",
        "deploy/railway/key-admin.env.example",
        "deploy/railway/profile-index-admin.env.example",
        "deploy/railway/frontend.env.example",
        "docs/ops/release-secret-custody.json",
        "docs/ops/profile-handle-index-rotation.md",
        "docs/ops/profile-handle-index-rotation-receipt.schema.json",
        "tools/profile_handle_index_rotation_receipt.mjs",
        "docs/ops/railway-staging-target.md",
        "docs/ops/release-game-day.md",
        "tools/production_promotion.mjs",
        "tools/release_coordinator.mjs",
        "tools/release_coordinator_contract.mjs",
        "tools/database_one_shot_policy.mjs",
        "tools/database_schema_upgrade_proof.mjs",
        "tools/database_tls_boundary.mjs",
        "tools/release_gameday.mjs",
        "tools/release_hosted_variable_authority.mjs",
        "tools/run_fmarch_migrations.mjs",
        "tools/release_git_authority.mjs",
        "tools/workos_oidc_preflight.mjs",
        "package.json",
        "crates/server/src/main.rs",
        "crates/server/src/bin/fmarch-migrate.rs",
        "crates/server/src/bin/fmarch-schema-gate.rs",
        "crates/server/src/bin/fmarch-schema-epoch-reset.rs",
        "crates/server/src/one_shot_database.rs",
        "crates/server/tests/schema_epoch_reset_recovery.rs",
        "crates/server/src/bin/fmarch-staging-search-corpus.rs",
        "crates/server/src/bin/fmarch-event-key-admin.rs",
        "crates/api/src/lib.rs",
        "crates/media/src/repository.rs",
        "crates/database_schema/src/schema.rs",
        "crates/database_schema/src/authority.rs",
      ].map(async (relativePath) => [relativePath, await read(relativePath)]),
    ),
  );

  assert.match(source.Dockerfile, /^# syntax=docker\/dockerfile:1\.7$/m);
  assert.match(source.Dockerfile, /^FROM rust:[^\n]+@sha256:[a-f0-9]{64} AS chef$/m);
  assert.match(source.Dockerfile, /^FROM chef AS planner$/m);
  assert.match(source.Dockerfile, /^FROM chef AS builder$/m);
  assert.match(
    source.Dockerfile,
    /cargo install --locked --version 0\.1\.78 cargo-chef/,
  );
  assert.match(source.Dockerfile, /cargo chef prepare --recipe-path recipe\.json/);
  assert.match(source.Dockerfile, /COPY --from=planner \/app\/recipe\.json \.\/recipe\.json/);
  assert.match(
    source.Dockerfile,
    /cargo chef cook --release --locked --package server --bins --recipe-path recipe\.json/,
  );
  assert.match(source.Dockerfile, /cargo build --release --locked -p server --bins/);
  for (const target of ["/usr/local/cargo/registry", "/usr/local/cargo/git", "/app/target"]) {
    assert.match(
      source.Dockerfile,
      new RegExp(
        `--mount=type=cache,id=\\$\\{FMARCH_CARGO_CACHE_NAMESPACE\\}-[^,]+,target=${target.replaceAll("/", "\\/")}`,
      ),
    );
  }
  assert.match(source.Dockerfile, /^FROM debian:[^\n]+@sha256:[a-f0-9]{64} AS runtime-base$/m);
  assert.match(source.Dockerfile, /^FROM runtime-base AS runtime$/m);
  assert.match(source.Dockerfile, /org\.opencontainers\.image\.source=/);
  assert.match(source.Dockerfile, /COPY docs \.\/docs/);
  assert.doesNotMatch(source.Dockerfile, /\/var\/lib\/fmarch\/media/);
  assert.match(source.Dockerfile, /apt-get install --yes --no-install-recommends ca-certificates/);
  assert.match(source.Dockerfile, /COPY --from=builder \/out\/fmarch-migrate \/usr\/local\/bin\/fmarch-migrate/);
  assert.match(source.Dockerfile, /COPY --from=builder \/out\/fmarch-schema-gate \/usr\/local\/bin\/fmarch-schema-gate/);
  assert.match(source.Dockerfile, /COPY --from=builder \/out\/fmarch-staging-search-corpus \/usr\/local\/bin\/fmarch-staging-search-corpus/);
  assert.match(source.Dockerfile, /COPY --from=builder \/out\/fmarch-event-key-admin \/usr\/local\/bin\/fmarch-event-key-admin/);
  assert.match(source.Dockerfile, /USER fmarch/);
  assert.match(source.Dockerfile, /CMD \["\/bin\/false"\]/);
  assert.match(source[".dockerignore"], /^target$/m);
  assert.match(source[".dockerignore"], /^\*\*\/target$/m);
  let clock = 0;
  const timing = createExactImageTiming({ now: () => clock });
  for (const phase of exactImageTimingPhases) {
    timing.measure(phase, () => {
      clock += 7;
    });
  }
  const timingSnapshot = timing.snapshot();
  assert.equal(assertCompleteExactImageTiming(timingSnapshot), true);
  assert.equal(timingSnapshot.total_milliseconds, 21);
  assert.deepEqual(
    timingSnapshot.phases.map((phase) => phase.milliseconds),
    [7, 7, 7],
  );
  const failedTiming = createExactImageTiming({ now: () => clock });
  assert.throws(
    () => failedTiming.measure("dockerfile_policy", () => { throw new Error("expected failure"); }),
    /expected failure/,
  );
  assert.throws(
    () => assertCompleteExactImageTiming(failedTiming.snapshot()),
    /failed during dockerfile_policy/,
  );
  assert.match(source["railway.toml"], /healthcheckPath = "\/readyz"/);
  assert.match(source["railway.toml"], /startCommand = "fmarch-server"/);
  assert.match(source["railway.toml"], /preDeployCommand = "fmarch-schema-gate"/);
  assert.doesNotMatch(source["railway.toml"], /fmarch-migrate/);
  assert.match(source["railway.toml"], /numReplicas = 2/);
  assert.doesNotMatch(source["railway.toml"], /watchPatterns/);
  assert.doesNotMatch(source["railway.toml"], /^\[build\]$/m);
  assert.doesNotMatch(source["deploy/railway/migrator.railway.toml"], /^\[build\]$/m);
  assert.doesNotMatch(source["deploy/railway/frontend.railway.toml"], /^\[build\]$/m);
  assert.match(source["deploy/railway/frontend.railway.toml"], /startCommand = "node build"/);
  for (const binary of [
    "fmarch-server",
    "fmarch-migrate",
    "fmarch-schema-gate",
    "fmarch-schema-epoch-reset",
    "fmarch-staging-search-corpus",
    "fmarch-event-key-admin",
    "fmarch-profile-index-admin",
  ]) {
    assert.match(
      source.Dockerfile,
      new RegExp(`COPY --from=builder /out/${binary} `),
    );
  }
  assert.match(source.Dockerfile, /org\.opencontainers\.image\.revision="\$\{FMARCH_RELEASE_COMMIT\}"/);
  assert.match(source["Dockerfile.frontend"], /org\.opencontainers\.image\.revision="\$\{FMARCH_RELEASE_COMMIT\}"/);
  assert.match(source["tools/release_coordinator.mjs"], /source\.image/);
  assert.match(source["tools/release_coordinator.mjs"], /kind === "api"/);
  assert.match(source["tools/release_coordinator.mjs"], /waitForMigrationCompletion/);
  assert.match(
    source["crates/server/src/bin/fmarch-migrate.rs"],
    /fmarch-database-migration-complete/,
  );
  assert.match(source["docs/ops/release-game-day.md"], /application rollback never runs the\s+migrator/i);
  assert.match(source["tools/release_coordinator.mjs"], /coordinateDatabaseOneShot\(\{/);
  assert.match(source["tools/release_coordinator.mjs"], /Promise\.all\(\[/);
  assert.match(source["tools/release_coordinator_contract.mjs"], /migrator_api_digest_equal/);
  assert.match(source["tools/release_git_authority.mjs"], /CANONICAL_RELEASE_REMOTE_URL/);
  assert.match(
    source["tools/release_git_authority.mjs"],
    /STAGING_RELEASE_MUTATION_LOCK_REF = "refs\/heads\/release-locks\/staging"/,
  );
  for (const leaseOperation of [
    "createStagingReleaseMutationLeaseIntent",
    "assertStagingReleaseMutationLease",
    "acquireStagingReleaseMutationLease",
    "resumeStagingReleaseMutationLease",
    "releaseStagingReleaseMutationLease",
    "withStagingReleaseMutationLease",
  ]) {
    assert.match(source["tools/release_git_authority.mjs"], new RegExp(`export (?:async )?function ${leaseOperation}`));
  }
  assert.match(
    source["tools/release_git_authority.mjs"],
    /--force-with-lease=\$\{STAGING_RELEASE_MUTATION_LOCK_REF}:\$\{expected}/,
  );
  assert.match(
    source["tools/release_git_authority.mjs"],
    /staging release mutation lease \$\{token} remains held/,
  );
  assert.match(source["tools/release_git_authority.mjs"], /GIT_CONFIG_NOSYSTEM: "1"/);
  assert.match(source["tools/release_git_authority.mjs"], /GIT_CONFIG_GLOBAL: "\/dev\/null"/);
  assert.match(source["tools/release_git_authority.mjs"], /!gh auth git-credential/);
  assert.match(source["tools/release_git_authority.mjs"], /SSL_CERT_FILE/);
  assert.match(source["tools/release_git_authority.mjs"], /core\.hooksPath/);
  assert.match(source["tools/release_git_authority.mjs"], /includeif/);
  assert.match(source["tools/release_coordinator.mjs"], /redirect: "error"/);
  assert.match(source["tools/production_promotion.mjs"], /redirect: "error"/);
  assert.match(source["tools/release_coordinator.mjs"], /timeout:/);
  assert.match(source["tools/production_promotion.mjs"], /timeout:/);
  assert.match(
    source["deploy/railway/migrator.railway.toml"],
    /startCommand = "\/bin\/false"/,
  );
  assert.match(source["deploy/railway/migrator.railway.toml"], /numReplicas = 1/);
  assert.match(
    source["deploy/railway/migrator.railway.toml"],
    /restartPolicyType = "NEVER"/,
  );
  assert.doesNotMatch(source["deploy/railway/migrator.railway.toml"], /healthcheckPath/);
  assert.doesNotMatch(source["deploy/railway/migrator.railway.toml"], /watchPatterns/);

  assert.match(source["frontend/svelte.config.js"], /@sveltejs\/adapter-node/);
  assert.match(source["frontend/svelte.config.js"], /mode:\s*"nonce"/);
  assert.doesNotMatch(source["frontend/svelte.config.js"], /unsafe-inline|unsafe-eval/);
  assert.match(source["frontend/package.json"], /"@sveltejs\/adapter-node": "5\.5\.7"/);
  assert.match(source["Dockerfile.frontend"], /COPY frontend\/package\.json frontend\/package-lock\.json/);
  assert.match(source["Dockerfile.frontend"], /COPY \. \./);
  assert.match(
    source["Dockerfile.frontend"],
    /^FROM node:[^\n]+@sha256:[a-f0-9]{64} AS (?:builder|runtime)$/gm,
  );
  assert.match(source["Dockerfile.frontend"], /npm ci --ignore-scripts/);
  assert.match(source["Dockerfile.frontend"], /npm prune --omit=dev/);
  assert.match(
    source["Dockerfile.frontend"],
    /COPY --from=builder \/app\/frontend\/node_modules \.\/node_modules/,
  );
  assert.match(source["Dockerfile.frontend"], /CMD \["node", "build"\]/);
  assert.match(source["deploy/railway/frontend.railway.toml"], /healthcheckPath = "\/healthz"/);
  assert.doesNotMatch(source["deploy/railway/frontend.railway.toml"], /watchPatterns/);

  assert.match(
    source["deploy/railway/api.env.example"],
    /^DATABASE_URL=<required-postgresql-url-for-fmarch_application-with-sslmode=require>$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_DATABASE_PROJECT_ID=9d285d67-c11b-4508-9efb-fad042787b4c$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_DATABASE_ENVIRONMENT_ID=e109e500-2a4c-48a3-96f2-e92a9edb63e4$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_DATABASE_ENVIRONMENT=staging$/m,
  );
  for (const forbidden of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  ]) {
    assert.doesNotMatch(
      source["deploy/railway/api.env.example"],
      new RegExp(`^${forbidden}=`, "m"),
    );
  }
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_SCHEMA_GATE_TIMEOUT_MS=180000$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_SCHEMA_GATE_INTERVAL_MS=1000$/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^DATABASE_MIGRATION_URL=\$\{\{Postgres\.DATABASE_URL\}\}\?sslmode=require$/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_APPLICATION_PASSWORD=/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_KEY_ADMIN_PASSWORD=/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_AUTHORITY_REVISION=/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_PROJECT_ID=9d285d67-c11b-4508-9efb-fad042787b4c$/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_ENVIRONMENT_ID=e109e500-2a4c-48a3-96f2-e92a9edb63e4$/m,
  );
  assert.match(
    source["deploy/railway/migrator.env.example"],
    /^FMARCH_DATABASE_ENVIRONMENT=staging$/m,
  );
  for (const [key, value] of [
    ["FMARCH_DB_ACQUIRE_TIMEOUT_MS", "30000"],
    ["FMARCH_DB_LOCK_TIMEOUT_MS", "60000"],
    ["FMARCH_DB_STATEMENT_TIMEOUT_MS", "300000"],
    ["FMARCH_DB_OPERATION_TIMEOUT_MS", "600000"],
  ]) {
    assert.match(
      source["deploy/railway/migrator.env.example"],
      new RegExp(`^${key}=${value}$`, "m"),
    );
    assert.match(source["tools/database_one_shot_policy.mjs"], new RegExp(`${key}: "${value}"`));
  }
  assert.doesNotMatch(
    source["deploy/railway/api.env.example"],
    /^FMARCH_DB_OPERATION_TIMEOUT_MS=/m,
  );
  assert.match(
    source["tools/release_coordinator.mjs"],
    /revalidateCanonicalProductionHostedVariables\(config/,
  );
  assert.doesNotMatch(
    source["tools/release_coordinator.mjs"],
    /revalidateCanonicalHostedVariables/,
  );
  assert.match(
    source["tools/production_promotion.mjs"],
    /revalidatePromotionHostedVariables\([\s\S]*?resumeLock: args\.resumeLock/,
  );
  assert.match(
    source["tools/release_hosted_variable_authority.mjs"],
    /loadCanonicalProductionHostedVariables[\s\S]*?productionEnvironmentId/,
  );
  assert.match(source["tools/release_coordinator.mjs"], /serviceInstanceDeployV2/);
  assert.doesNotMatch(source["tools/release_coordinator.mjs"], /serviceInstanceDeploy\(/);
  assert.match(
    source["tools/release_coordinator.mjs"],
    /deployment\(id: \$id\).*id status projectId environmentId serviceId meta/,
  );
  assert.match(source["tools/release_coordinator.mjs"], /fmarch-database-one-shot-intent/);
  assert.match(source["tools/release_coordinator.mjs"], /--resume-lease/);
  assert.match(source["tools/release_coordinator.mjs"], /withStagingReleaseMutationLease/);
  assert.match(source["tools/release_coordinator.mjs"], /withReleaseMutationAuthority/);
  assert.match(
    source["tools/release_coordinator.mjs"],
    /--output is production-only for mutating releases/,
  );
  assert.match(source["tools/release_coordinator.mjs"], /start_command: `\$\{startCommand\} --operation-id/);
  assert.match(source["tools/release_coordinator.mjs"], /succeeded without exact operation completion evidence/);
  const coordinatorDisarm = source["tools/release_coordinator.mjs"].slice(
    source["tools/release_coordinator.mjs"].indexOf("async function disarmConfiguredDatabaseOneShot"),
    source["tools/release_coordinator.mjs"].indexOf("export async function runJournaledDatabaseOneShot"),
  );
  assert.match(coordinatorDisarm, /serviceInstanceUpdate/);
  assert.match(coordinatorDisarm, /databaseOneShotDisarmInput/);
  assert.doesNotMatch(coordinatorDisarm, /serviceInstanceDeploy/);
  assert.ok(
    source["tools/release_coordinator.mjs"].indexOf("await disarm(dispatchRecord.deployment_id, intent)") <
      source["tools/release_coordinator.mjs"].indexOf("deployment = await awaitTerminal"),
    "database one-shot must disarm before waiting on the exact deployment",
  );
  assert.match(source["tools/release_gameday.mjs"], /serviceInstanceDeployV2/);
  assert.doesNotMatch(source["tools/release_gameday.mjs"], /serviceInstanceDeploy\(/);
  assert.match(source["tools/release_gameday.mjs"], /bindDatabaseOneShotIntent/);
  assert.match(source["tools/release_gameday.mjs"], /runJournaledDatabaseOneShot/);
  assert.match(source["tools/release_gameday.mjs"], /findMatchingGameDayOneShotDeployments/);
  assert.match(source["tools/release_gameday.mjs"], /fmarch-game-day-active-database-one-shot/);
  assert.match(source["tools/release_gameday.mjs"], /active_receipt_sha256/);
  assert.match(source["tools/release_gameday.mjs"], /--resume-lease/);
  assert.match(source["tools/release_gameday.mjs"], /withStagingReleaseMutationLease/);
  assert.match(source["tools/release_gameday.mjs"], /withGameDayMutationAuthority/);
  assert.match(source["tools/release_gameday.mjs"], /does not accept --output/);
  assert.ok(
    source["tools/release_gameday.mjs"].indexOf("await publishActive(specification.receipt, expected, stagingMutationLease)") <
      source["tools/release_gameday.mjs"].indexOf("return await resume(specification.receipt, expected)"),
    "game-day active one-shot fence must be durable before dispatch recovery begins",
  );
  const gameDayRecovery = source["tools/release_gameday.mjs"].slice(
    source["tools/release_gameday.mjs"].indexOf("export async function recoverCurrentRelease"),
    source["tools/release_gameday.mjs"].indexOf("export function gameDayOutputPath"),
  );
  assert.ok(
    gameDayRecovery.indexOf("await restoreApplication(receipt, stagingMutationLease)") <
      gameDayRecovery.indexOf("await oneShots.resumePending(receipt)"),
    "game-day recovery must restore the serving application before one-shot reconciliation",
  );
  assert.ok(
    gameDayRecovery.indexOf("await oneShots.resumePending(receipt)") <
      gameDayRecovery.indexOf('await restoreMigrator(receipt, "interrupted-restore", oneShots)'),
    "game-day recovery must reconcile pending one-shots before the canonical restore migrator",
  );
  assert.match(
    source["tools/release_gameday.mjs"],
    /startCommand: "\/bin\/false",[\s\S]*?statuses: \["FAILED", "CRASHED"\]/,
  );
  assert.match(
    source["tools/release_gameday.mjs"],
    /timeoutMilliseconds = DATABASE_ONE_SHOT_PLATFORM_WAIT_TIMEOUT_MS/,
  );
  const gameDayDisarm = source["tools/release_gameday.mjs"].slice(
    source["tools/release_gameday.mjs"].indexOf("function disarmOneShotService"),
    source["tools/release_gameday.mjs"].indexOf("async function waitForDeployment"),
  );
  assert.match(gameDayDisarm, /serviceInstanceUpdate/);
  assert.match(gameDayDisarm, /startCommand: "\/bin\/false"/);
  assert.doesNotMatch(gameDayDisarm, /serviceInstanceDeploy/);
  assert.match(
    source["tools/database_tls_boundary.mjs"],
    /\["--operation-id", localMigrationOperationId\]/,
  );
  assert.match(
    source["tools/database_schema_upgrade_proof.mjs"],
    /\["--operation-id", localMigrationOperationId\]/,
  );
  for (const forbidden of [
    "DATABASE_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_AUTH_SOURCE_SIGNING_KEY",
    "FMARCH_EVENT_WRAP_KEY",
    "FMARCH_EVENT_WRAP_KEYS",
    "FMARCH_EVENT_ARCHIVE_KEY",
    "FMARCH_EVENT_ARCHIVE_KEYS",
    "FMARCH_PROFILE_HANDLE_INDEX_KEY",
    "FMARCH_PROFILE_HANDLE_INDEX_KID",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID",
    "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY",
    "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY",
    "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY",
    "WORKOS_API_KEY",
    "WORKOS_COOKIE_PASSWORD",
    "FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN",
  ]) {
    assert.doesNotMatch(
      source["deploy/railway/migrator.env.example"],
      new RegExp(`^${forbidden}=`, "m"),
    );
  }
  assert.match(
    source["deploy/railway/key-admin.env.example"],
    /^DATABASE_KEY_ADMIN_URL=<required-postgresql-url-for-fmarch_key_admin-with-sslmode=require>$/m,
  );
  assert.match(source["deploy/railway/key-admin.env.example"], /^FMARCH_EVENT_WRAP_KEY=/m);
  assert.match(source["deploy/railway/key-admin.env.example"], /^FMARCH_EVENT_ARCHIVE_KEY=/m);
  assert.doesNotMatch(
    source["deploy/railway/key-admin.env.example"],
    /^(?:DATABASE_URL|DATABASE_MIGRATION_URL|FMARCH_DATABASE_APPLICATION_PASSWORD|FMARCH_DATABASE_KEY_ADMIN_PASSWORD|FMARCH_PROFILE_HANDLE_INDEX_KEY|FMARCH_PROFILE_HANDLE_INDEX_KID)=/m,
  );
  const profileIndexAdminTemplate = source["deploy/railway/profile-index-admin.env.example"];
  assert.match(
    profileIndexAdminTemplate,
    /^DATABASE_URL=<required-fmarch_application-url-rewritten-to-127.0.0.1-tunnel-port-with-sslmode=require>$/m,
  );
  assert.deepEqual(
    [...profileIndexAdminTemplate.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
      (match) => match[1],
    ),
    [
      "DATABASE_URL",
      "FMARCH_PROFILE_HANDLE_INDEX_KEY",
      "FMARCH_PROFILE_HANDLE_INDEX_KID",
      "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
      "FMARCH_SUBJECT_AUTHORITY_ENDPOINT",
      "FMARCH_SUBJECT_AUTHORITY_REGION",
      "FMARCH_SUBJECT_AUTHORITY_BUCKET",
      "FMARCH_SUBJECT_AUTHORITY_ACCESS_KEY_ID",
      "FMARCH_SUBJECT_AUTHORITY_SECRET_ACCESS_KEY",
      "FMARCH_SUBJECT_AUTHORITY_URL_STYLE",
      "FMARCH_SUBJECT_KEY_AUTHORITY_REVISION",
      "FMARCH_SUBJECT_AUTHORITY_ID",
      "FMARCH_SUBJECT_AUTHORITY_WRAP_KID",
      "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY",
      "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID",
      "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY",
    ],
  );
  for (const forbidden of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
    "FMARCH_AUTH_SOURCE_SIGNING_KEY",
    "FMARCH_EVENT_WRAP_KEY",
    "FMARCH_EVENT_ARCHIVE_KEY",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "WORKOS_API_KEY",
    "WORKOS_COOKIE_PASSWORD",
    "FMARCH_SUBJECT_KEY_DIR",
    "FMARCH_SUBJECT_AUTHORITY_ALLOW_HTTP",
  ]) {
    assert.doesNotMatch(profileIndexAdminTemplate, new RegExp(`^${forbidden}=`, "m"));
  }
  assert.doesNotMatch(
    source["deploy/railway/frontend.env.example"],
    /^(?:DATABASE_URL|DATABASE_MIGRATION_URL|DATABASE_KEY_ADMIN_URL|FMARCH_DATABASE_APPLICATION_PASSWORD|FMARCH_DATABASE_KEY_ADMIN_PASSWORD|FMARCH_PROFILE_HANDLE_INDEX_KEY|FMARCH_PROFILE_HANDLE_INDEX_KID)=/m,
  );
  assert.match(source["deploy/railway/api.env.example"], /AWS_ENDPOINT_URL=\$\{\{media\.ENDPOINT\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /AWS_ACCESS_KEY_ID=\$\{\{media\.ACCESS_KEY_ID\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /AWS_SECRET_ACCESS_KEY=\$\{\{media\.SECRET_ACCESS_KEY\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /AWS_S3_BUCKET_NAME=\$\{\{media\.BUCKET\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /AWS_DEFAULT_REGION=\$\{\{media\.REGION\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /AWS_S3_URL_STYLE=virtual-host/);
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_OBJECT_STORAGE_CREDENTIAL_KID=/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_AUTH_SOURCE_SIGNING_KID=/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_WORKOS_CREDENTIAL_KID=/m,
  );
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /FMARCH_MEDIA_ROOT/);
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_MEDIA_READ_MAX_IN_FLIGHT=16$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_MEDIA_READ_MAX_IN_FLIGHT_BYTES=67108864$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_MEDIA_RECONCILIATION_INTERVAL_MS=5000$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_MEDIA_RECONCILIATION_TIMEOUT_MS=2000$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_MEDIA_RECONCILIATION_BATCH_SIZE=1$/m,
  );
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /^FMARCH_SUBJECT_KEY_DIR=/m);
  for (const variable of [
    "ENDPOINT",
    "ACCESS_KEY_ID",
    "SECRET_ACCESS_KEY",
    "BUCKET",
    "REGION",
  ]) {
    assert.match(
      source["deploy/railway/api.env.example"],
      new RegExp(`^FMARCH_SUBJECT_AUTHORITY_${variable}=\\$\\{\\{subject-authority\\.${variable}\\}\\}$`, "m"),
    );
  }
  for (const variable of [
    "FMARCH_SUBJECT_AUTHORITY_ID",
    "FMARCH_SUBJECT_AUTHORITY_WRAP_KID",
    "FMARCH_SUBJECT_AUTHORITY_WRAP_KEY",
    "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID",
    "FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY",
  ]) {
    assert.match(source["deploy/railway/api.env.example"], new RegExp(`^${variable}=`, "m"));
  }
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_SUBJECT_KEY_AUTHORITY_REVISION=/m,
  );
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /^FMARCH_BIND=/m);
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /^RAILWAY_RUN_UID=/m);
  assert.match(source["deploy/railway/api.env.example"], /^WORKOS_CLIENT_ID=/m);
  assert.match(
    source[".env.example"],
    /^# WORKOS_ISSUER=https:\/\/api\.workos\.com\/user_management\/client_replace_me$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^WORKOS_ISSUER=https:\/\/api\.workos\.com\/user_management\/client_replace_me$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^WORKOS_JWKS_URL=https:\/\/api\.workos\.com\/sso\/jwks\/client_replace_me$/m,
  );
  assert.match(source["deploy/railway/api.env.example"], /^FMARCH_CLASSIC_AUTH=0$/m);
  assert.match(
    source["deploy/railway/api.env.example"],
    /FMARCH_BOOTSTRAP_ADMIN_WORKOS_USER_ID=/,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^# FMARCH_IDENTITY_DELIVERY_ENDPOINT=https:\/\/.+/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^# FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN=\$\{\{IDENTITY_DELIVERY_AUTH_TOKEN\}\}/m,
  );
  assert.doesNotMatch(
    source["deploy/railway/api.env.example"],
    /FMARCH_IDENTITY_DELIVERY_AUTH_TOKEN=(?!\$\{\{IDENTITY_DELIVERY_AUTH_TOKEN\}\})\S+/,
  );
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /FMARCH_DEV_AUTH/);
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_PROFILE_HANDLE_INDEX_KEY=<required-at-least-32-byte-opaque-secret>$/m,
  );
  assert.match(
    source["deploy/railway/api.env.example"],
    /^FMARCH_PROFILE_HANDLE_INDEX_KID=staging-YYYY-MM-DD$/m,
  );
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^ORIGIN=https:\/\/fmarch-frontend-staging\.up\.railway\.app$/m,
  );
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^FMARCH_API_BASE_URL=https:\/\/fmarch-staging\.up\.railway\.app$/m,
  );
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^FMARCH_API_INTERNAL_URL=http:\/\/fmarch\.railway\.internal:8080$/m,
  );
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_CLIENT_ID=/m);
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_API_KEY=/m);
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^WORKOS_REDIRECT_URI=https:\/\/fmarch-frontend-staging\.up\.railway\.app\/auth\/callback$/m,
  );
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_COOKIE_PASSWORD=/m);
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^FMARCH_AUTH_SOURCE_SIGNING_KID=/m,
  );
  assert.match(
    source["deploy/railway/frontend.env.example"],
    /^FMARCH_WORKOS_CREDENTIAL_KID=/m,
  );

  const custody = JSON.parse(source["docs/ops/release-secret-custody.json"]);
  assert.deepEqual(custody.environments, ["staging", "production"]);
  assert.deepEqual(
    custody.families.map((family) => family.id),
    [
      "database-authority",
      "auth-source-signing",
      "event-runtime-wrap",
      "event-archive",
      "profile-handle-index",
      "object-storage",
      "subject-key-authority",
      "workos",
    ],
  );
  const profileHandleIndexCustody = custody.families.find(
    (family) => family.id === "profile-handle-index",
  );
  assert.deepEqual(profileHandleIndexCustody.secret_variables, [
    "FMARCH_PROFILE_HANDLE_INDEX_KEY",
    "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
  ]);
  assert.deepEqual(profileHandleIndexCustody.consumers, [
    "api",
    "fmarch-profile-index-admin",
  ]);
  assert.deepEqual(profileHandleIndexCustody.receipt_contract, {
    schema: "docs/ops/profile-handle-index-rotation-receipt.schema.json",
    storage:
      "access-controlled append-only release-evidence ledger outside repository, Railway variables, application database, and service logs",
    recovery_window_days: 30,
    retention_after_escrow_destruction_years: 7,
  });
  assert.match(profileHandleIndexCustody.rotation, /SSH database tunnel/);
  assert.match(profileHandleIndexCustody.rotation, /replacement-key service variable/);
  assert.doesNotMatch(profileHandleIndexCustody.custody, /env -i/);

  const profileIndexRunbook = source["docs/ops/profile-handle-index-rotation.md"];
  for (const requiredText of [
    "railway connect \"$POSTGRES_SERVICE\" --ssh --tunnel-only",
    "railway run --project",
    "spawnSync(adminBinary, args, { env: childEnv",
    "FMARCH_PROFILE_HANDLE_INDEX_REPLACEMENT_KEY",
    "deploy.numReplicas 0",
    "deploy.numReplicas 2",
    "--writers-drained --execute",
    "railway variable set",
    "profile_handle_index_rotation",
    "profile_handle_index_escrow_destruction",
    "30 calendar days",
    "seven years after the destruction receipt",
    "railway service status",
    "profile_handle_index_rotation_receipt.mjs",
  ]) {
    assert.ok(profileIndexRunbook.includes(requiredText), `profile-index runbook missing ${requiredText}`);
  }
  assert.match(
    profileIndexRunbook,
    /Never use `railway run env`, `railway run printenv`/,
  );
  assert.doesNotMatch(profileIndexRunbook, /env -i/);
  assert.match(
    profileIndexRunbook,
    /^API_SERVICE=replace-with-api-service-name-or-id$/m,
  );
  assert.match(
    profileIndexRunbook,
    /^POSTGRES_SERVICE=replace-with-postgres-service-name-or-id$/m,
  );
  assert.doesNotMatch(profileIndexRunbook, /^API_SERVICE=api$/m);
  assert.doesNotMatch(profileIndexRunbook, /railway connect Postgres/);
  assert.match(
    profileIndexRunbook,
    /FMARCH_PROFILE_HANDLE_INDEX_KID: process\.env\.FMARCH_PROFILE_HANDLE_INDEX_KID/,
  );
  assert.match(
    profileIndexRunbook,
    /childEnv\.FMARCH_PROFILE_HANDLE_INDEX_KID !== currentKid/,
  );
  assert.match(
    profileIndexRunbook,
    /FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID: process\.env\.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KID/,
  );
  assert.match(
    profileIndexRunbook,
    /FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY: process\.env\.FMARCH_SUBJECT_AUTHORITY_JOURNAL_KEY/,
  );
  assert.match(
    profileIndexRunbook,
    /FMARCH_SUBJECT_AUTHORITY_URL_STYLE: process\.env\.FMARCH_SUBJECT_AUTHORITY_URL_STYLE \?\? "path"/,
  );

  const profileIndexReceiptSchema = JSON.parse(
    source["docs/ops/profile-handle-index-rotation-receipt.schema.json"],
  );
  assert.equal(
    profileIndexReceiptSchema.$schema,
    "https://json-schema.org/draft/2020-12/schema",
  );
  assert.deepEqual(
    profileIndexReceiptSchema.oneOf.map((entry) => entry.$ref),
    [
      "#/$defs/rotation_receipt",
      "#/$defs/escrow_destruction_receipt",
    ],
  );
  for (const [name, definition] of Object.entries(profileIndexReceiptSchema.$defs)) {
    assertClosedReceiptObjects(definition, `$defs.${name}`);
  }
  assert.equal(
    profileIndexReceiptSchema.$defs.rotation_receipt.properties.recovery_escrow
      .properties.recovery_window_days.const,
    30,
  );
  assert.equal(
    profileIndexReceiptSchema.$defs.escrow_destruction_receipt.properties
      .recovery_window_days.const,
    30,
  );
  assert.equal(
    profileIndexReceiptSchema.$defs.escrow_destruction_receipt.properties
      .retention_years.const,
    7,
  );
  assert.match(profileIndexReceiptSchema.$defs.timestamp.pattern, /Z\$/);
  assert.equal(
    profileIndexReceiptSchema.$defs.escrow_destruction_receipt.required.includes(
      "retain_until",
    ),
    true,
  );
  assert.match(
    source["tools/profile_handle_index_rotation_receipt.mjs"],
    /validateEscrowDestructionReceipt/,
  );
  assert.match(
    source["tools/profile_handle_index_rotation_receipt.mjs"],
    /rotationReceiptSha256/,
  );

  assert.match(source["crates/server/src/main.rs"], /platform_port/);
  assert.match(source["crates/server/src/main.rs"], /format!\("\[::\]:\{port\}"\)/);
  assert.doesNotMatch(source["crates/server/src/main.rs"], /\.run\(&pool\)\.await/);
  assert.match(source["crates/server/src/main.rs"], /ensure_schema_ready\(&pool\)/);
  assert.match(
    source["crates/server/src/main.rs"],
    /require_profile_handle_index_configuration\(\)\?/,
  );
  assert.match(
    source["crates/server/src/main.rs"],
    /classic authentication requires FMARCH_IDENTITY_DELIVERY_ENDPOINT/,
  );
  assert.match(source["crates/server/src/main.rs"], /dev_auth_enabled && debug_build/);
  assert.match(
    source["crates/server/src/bin/fmarch-migrate.rs"],
    /tokio::time::timeout\(timeouts\.statement\(\), server::MIGRATOR\.run\(&mut \*connection\)\)/,
  );
  assert.match(source["crates/server/src/bin/fmarch-migrate.rs"], /connection\.close_on_drop\(\)/);
  assert.match(source["crates/server/src/bin/fmarch-migrate.rs"], /pg_advisory_lock/);
  assert.ok(
    source["crates/server/src/bin/fmarch-migrate.rs"].indexOf("operation_lock.close_on_drop()") <
      source["crates/server/src/bin/fmarch-migrate.rs"].indexOf("debug_operation_delay().await?"),
    "migrator outer-deadline failpoint must run while owning a close-on-drop database session",
  );
  assert.match(source["crates/server/src/bin/fmarch-migrate.rs"], /verify_database_environment_identity/);
  assert.match(source["crates/server/src/bin/fmarch-migrate.rs"], /--operation-id <64-lowercase-hex>/);
  assert.match(source["crates/server/src/bin/fmarch-schema-epoch-reset.rs"], /--bind-database-identity/);
  assert.match(
    source["crates/server/src/bin/fmarch-schema-epoch-reset.rs"],
    /--execute.*--operation-id <64-lowercase-hex>/,
  );
  assert.match(source["crates/server/src/bin/fmarch-schema-epoch-reset.rs"], /ACCESS EXCLUSIVE/);
  const resetConnection = source["crates/server/src/bin/fmarch-schema-epoch-reset.rs"].indexOf(
    "connection.close_on_drop()",
  );
  const resetDelay = source["crates/server/src/bin/fmarch-schema-epoch-reset.rs"].indexOf(
    "debug_operation_delay().await?",
    resetConnection,
  );
  assert.ok(
    resetConnection >= 0 && resetConnection < resetDelay,
    "schema-reset outer-deadline failpoint must run while owning a close-on-drop database session",
  );
  for (const [name, value] of [
    ["ACQUIRE_TIMEOUT_MS", "30_000"],
    ["LOCK_TIMEOUT_MS", "60_000"],
    ["STATEMENT_TIMEOUT_MS", "300_000"],
    ["OPERATION_TIMEOUT_MS", "600_000"],
  ]) {
    assert.match(
      source["crates/server/src/one_shot_database.rs"],
      new RegExp(`pub const ${name}: u64 = ${value}`),
    );
  }
  assert.match(
    source["crates/server/src/one_shot_database.rs"],
    /Err\(format!\("\{name\} is required"\)\)/,
  );
  assert.match(
    source["crates/server/src/one_shot_database.rs"],
    /cfg!\(debug_assertions\)[\s\S]*?is unavailable in this build/,
  );
  for (const binary of [
    "crates/server/src/bin/fmarch-migrate.rs",
    "crates/server/src/bin/fmarch-schema-epoch-reset.rs",
  ]) {
    assert.match(source[binary], /validate_debug_operation_delay\(\)\?/);
    assert.match(source[binary], /debug_operation_delay\(\)\.await\?/);
  }
  assert.match(
    source["crates/server/tests/schema_epoch_reset_recovery.rs"],
    /shared_lock_contention_is_bounded_and_leaves_no_database_side_effects/,
  );
  assert.match(source["crates/database_schema/src/authority.rs"], /acl\.grantee <> relation\.relowner/);
  assert.match(
    source["crates/server/src/bin/fmarch-migrate.rs"],
    /DATABASE_MIGRATION_URL/,
  );
  assert.match(
    source["crates/server/src/bin/fmarch-schema-gate.rs"],
    /DATABASE_URL/,
  );
  assert.match(
    source["crates/server/src/bin/fmarch-staging-search-corpus.rs"],
    /RAILWAY_ENVIRONMENT_NAME/,
  );
  assert.match(
    source["crates/server/src/bin/fmarch-staging-search-corpus.rs"],
    /staging-only; refusing environment/,
  );
  assert.match(source["crates/api/src/lib.rs"], /route\("\/readyz", get\(readyz\)\)/);
  assert.match(
    source["crates/api/src/lib.rs"],
    /database_schema::ensure_schema_ready\(&state\.pool\)/,
  );
  assert.match(
    source["crates/api/src/lib.rs"],
    /verify_database_environment_identity_marker/,
  );
  assert.match(source["crates/api/src/lib.rs"], /database_identity: database_identity\.ok/);
  assert.match(source["crates/database_schema/src/authority.rs"], /COMMENT ON DATABASE/);
  assert.match(
    source["crates/database_schema/src/authority.rs"],
    /shobj_description\(database\.oid, 'pg_database'\)/,
  );
  assert.match(
    source["crates/api/src/lib.rs"],
    /state\.media_store\.check_readiness\(\)/,
  );
  assert.match(
    source["crates/api/src/lib.rs"],
    /store\.check_readiness\(\)\.await/,
  );
  assert.match(
    source["crates/media/src/repository.rs"],
    /list_with_delimiter\(Some\(&prefix\)\)/,
  );
  assert.match(source["crates/database_schema/src/schema.rs"], /pub static MIGRATOR/);
  assert.match(source["tools/production_promotion.mjs"], /\$\{urls\.apiUrl\}\/readyz/);
  assert.match(source["tools/production_promotion.mjs"], /revalidateCanonicalHostedVariables/);
  assert.match(source["tools/production_promotion.mjs"], /cannot override the canonical release topology/);
  assert.match(source["tools/production_promotion.mjs"], /migratorDeployment/);
  assert.match(source["tools/release_hosted_variable_authority.mjs"], /DATABASE_MIGRATION_URL/);
  assert.match(source["tools/release_hosted_variable_authority.mjs"], /DATABASE_KEY_ADMIN_URL/);
  assert.match(source["tools/release_hosted_variable_authority.mjs"], /fmarch_application/);
  assert.match(
    source["tools/release_hosted_variable_authority.mjs"],
    /separate PostgreSQL server endpoints because fixed database roles are cluster-global/,
  );
  assert.match(
    source["tools/release_hosted_variable_authority.mjs"],
    /sslmode must be require, verify-ca, or verify-full/,
  );
  assert.match(
    source["tools/production_promotion.mjs"],
    /body\.database_schema === true/,
  );
  assert.match(
    source["tools/production_promotion.mjs"],
    /body\.object_storage === true/,
  );
  assert.match(
    source["tools/production_promotion.mjs"],
    /body\.subject_authority === true/,
  );
  assert.match(source["tools/production_promotion.mjs"], /preflightWorkosOidc/);
  assert.match(
    source["tools/release_hosted_variable_authority.mjs"],
    /frontend must use the canonical private API URL/,
  );
  assert.match(
    source["tools/release_hosted_variable_authority.mjs"],
    /API and frontend must use the same WorkOS client/,
  );
  assert.match(
    source["tools/workos_oidc_preflight.mjs"],
    /\/user_management\/\$\{clientId\}\/\.well-known\/openid-configuration/,
  );
  assert.match(
    source["tools/workos_oidc_preflight.mjs"],
    /WORKOS_ISSUER must exactly match OIDC discovery/,
  );
  assert.match(
    source["tools/workos_oidc_preflight.mjs"],
    /WORKOS_JWKS_URL must exactly match OIDC discovery/,
  );

  const runbook = source["docs/ops/railway-staging-target.md"];
  for (const requiredText of [
    "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    "FMARCH_HOSTED_MATRIX_API_URL",
    "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
    "FMARCH_DEV_AUTH=1",
    "test:dev-test-game-real-hosted-matrix-raw-capture",
    "`main` is the only development trunk",
    "`production` branch is a release pointer",
    "Do not retain a Git source or enable image auto-updates on these services.",
    "separate Postgres service instances",
    "different database name on the same PostgreSQL server is not isolation",
    "reconciler governs the current database only",
    "shared clusters are unsupported",
    "`sslmode=require`, `sslmode=verify-ca`, or `sslmode=verify-full`",
    "subject-authority buckets",
    "fmarch_application",
    "fmarch_key_admin",
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "fmarch-schema-gate",
    "7c2c2665-2be2-4938-84e5-7580a964d610",
    "migrator, API, and frontend",
    "--bootstrap-subject-authority",
    "npm run promote:production -- --check",
    "--fleet-receipt",
    "refs/heads/release-locks/staging",
    "--resume-lease",
    "Mutating staging releases do not accept `--output`",
    "A staging failure never deletes the lease.",
    "outcome-unknown",
    "Local proof-lane cache output is never release authority.",
    "--force-with-lease",
    "fmarch-frontend-staging.up.railway.app",
    "fmarch-frontend-production.up.railway.app",
    "npm run preflight:workos-oidc",
    "client-scoped discovery document",
  ]) {
    assert.ok(runbook.includes(requiredText), `runbook missing ${requiredText}`);
  }
  assert.match(
    source["package.json"],
    /"promote:production": "node tools\/production_promotion\.mjs"/,
  );
  assert.match(
    source["package.json"],
    /"preflight:workos-oidc": "node tools\/workos_oidc_preflight\.mjs"/,
  );
  assert.match(source["tools/production_promotion.mjs"], /origin\/production must be an ancestor/);
}

function assertClosedReceiptObjects(schema, location) {
  if (schema?.type === "object") {
    assert.equal(
      schema.additionalProperties,
      false,
      `profile-index receipt ${location} must reject unstructured evidence`,
    );
  }
  for (const [name, child] of Object.entries(schema?.properties ?? {})) {
    assertClosedReceiptObjects(child, `${location}.properties.${name}`);
  }
  for (const [index, child] of (schema?.oneOf ?? []).entries()) {
    assertClosedReceiptObjects(child, `${location}.oneOf[${index}]`);
  }
  if (schema?.items) assertClosedReceiptObjects(schema.items, `${location}.items`);
}

async function read(relativePath) {
  return await readFile(path.join(root, relativePath), "utf8");
}
