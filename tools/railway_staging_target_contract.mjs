import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await contract();
console.log("railway staging target contract passed");

async function contract() {
  const source = Object.fromEntries(
    await Promise.all(
      [
        "Dockerfile",
        ".dockerignore",
        "railway.toml",
        "Dockerfile.frontend",
        "deploy/railway/frontend.railway.toml",
        "frontend/package.json",
        "frontend/svelte.config.js",
        "deploy/railway/api.env.example",
        "deploy/railway/frontend.env.example",
        "docs/ops/release-secret-custody.json",
        "docs/ops/railway-staging-target.md",
        "tools/production_promotion.mjs",
        "package.json",
        "crates/server/src/main.rs",
        "crates/server/src/bin/fmarch-migrate.rs",
        "crates/server/src/bin/fmarch-event-key-admin.rs",
        "crates/api/src/lib.rs",
        "crates/media/src/repository.rs",
        "crates/projections/src/schema.rs",
      ].map(async (relativePath) => [relativePath, await read(relativePath)]),
    ),
  );

  assert.match(source.Dockerfile, /cargo build --release --locked -p server --bins/);
  assert.match(source.Dockerfile, /^FROM rust:[^\n]+@sha256:[a-f0-9]{64} AS builder$/m);
  assert.match(source.Dockerfile, /^FROM debian:[^\n]+@sha256:[a-f0-9]{64} AS runtime$/m);
  assert.match(source.Dockerfile, /org\.opencontainers\.image\.source=/);
  assert.match(source.Dockerfile, /COPY docs \.\/docs/);
  assert.doesNotMatch(source.Dockerfile, /\/var\/lib\/fmarch\/media/);
  assert.match(source.Dockerfile, /apt-get install --yes --no-install-recommends ca-certificates/);
  assert.match(source.Dockerfile, /COPY --from=builder \/app\/target\/release\/fmarch-migrate \/usr\/local\/bin\/fmarch-migrate/);
  assert.match(source.Dockerfile, /COPY --from=builder \/app\/target\/release\/fmarch-event-key-admin \/usr\/local\/bin\/fmarch-event-key-admin/);
  assert.match(source.Dockerfile, /USER fmarch/);
  assert.match(source.Dockerfile, /CMD \["fmarch-server"\]/);
  assert.match(source[".dockerignore"], /^target$/m);
  assert.match(source["railway.toml"], /healthcheckPath = "\/readyz"/);
  assert.match(source["railway.toml"], /preDeployCommand = "fmarch-migrate"/);
  assert.match(source["railway.toml"], /numReplicas = 2/);
  assert.doesNotMatch(source["railway.toml"], /watchPatterns/);

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
  assert.match(source["deploy/railway/frontend.railway.toml"], /dockerfilePath = "Dockerfile\.frontend"/);
  assert.match(source["deploy/railway/frontend.railway.toml"], /healthcheckPath = "\/healthz"/);
  assert.doesNotMatch(source["deploy/railway/frontend.railway.toml"], /watchPatterns/);

  assert.match(source["deploy/railway/api.env.example"], /DATABASE_URL=\$\{\{Postgres\.DATABASE_URL\}\}/);
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
  assert.match(source["deploy/railway/api.env.example"], /^WORKOS_ISSUER=https:\/\//m);
  assert.match(source["deploy/railway/api.env.example"], /^WORKOS_JWKS_URL=https:\/\//m);
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
  assert.match(source["deploy/railway/frontend.env.example"], /^ORIGIN=https:\/\//m);
  assert.match(source["deploy/railway/frontend.env.example"], /^FMARCH_API_BASE_URL=https:\/\//m);
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_CLIENT_ID=/m);
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_API_KEY=/m);
  assert.match(source["deploy/railway/frontend.env.example"], /^WORKOS_REDIRECT_URI=https:\/\//m);
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
      "auth-source-signing",
      "event-runtime-wrap",
      "event-archive",
      "object-storage",
      "subject-key-authority",
      "workos",
    ],
  );

  assert.match(source["crates/server/src/main.rs"], /platform_port/);
  assert.match(source["crates/server/src/main.rs"], /format!\("\[::\]:\{port\}"\)/);
  assert.doesNotMatch(source["crates/server/src/main.rs"], /\.run\(&pool\)\.await/);
  assert.match(source["crates/server/src/main.rs"], /ensure_schema_ready\(&pool\)/);
  assert.match(
    source["crates/server/src/main.rs"],
    /classic authentication requires FMARCH_IDENTITY_DELIVERY_ENDPOINT/,
  );
  assert.match(source["crates/server/src/main.rs"], /dev_auth_enabled && debug_build/);
  assert.match(source["crates/server/src/bin/fmarch-migrate.rs"], /MIGRATOR\.run\(&pool\)\.await/);
  assert.match(source["crates/api/src/lib.rs"], /route\("\/readyz", get\(readyz\)\)/);
  assert.match(
    source["crates/api/src/lib.rs"],
    /projections::ensure_schema_ready\(&state\.pool\)/,
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
  assert.match(source["crates/projections/src/schema.rs"], /pub static MIGRATOR/);
  assert.match(source["tools/production_promotion.mjs"], /\$\{urls\.apiUrl\}\/readyz/);
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
    "production services must watch `production`, never `main`.",
    "separate Postgres service instances",
    "subject-authority buckets",
    "--bootstrap-subject-authority",
    "npm run promote:production -- --check",
    "npm run proof:lanes -- --mode full --run",
    "fmarch-frontend-staging.up.railway.app",
    "fmarch-frontend-production.up.railway.app",
  ]) {
    assert.ok(runbook.includes(requiredText), `runbook missing ${requiredText}`);
  }
  assert.match(
    source["package.json"],
    /"promote:production": "node tools\/production_promotion\.mjs"/,
  );
  assert.match(source["tools/production_promotion.mjs"], /origin\/production must be an ancestor/);
}

async function read(relativePath) {
  return await readFile(path.join(root, relativePath), "utf8");
}
