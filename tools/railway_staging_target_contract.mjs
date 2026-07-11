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
        "docs/ops/railway-staging-target.md",
        "crates/server/src/main.rs",
      ].map(async (relativePath) => [relativePath, await read(relativePath)]),
    ),
  );

  assert.match(source.Dockerfile, /cargo build --release --locked -p server/);
  assert.match(source.Dockerfile, /COPY docs \.\/docs/);
  assert.match(source.Dockerfile, /USER fmarch/);
  assert.match(source.Dockerfile, /CMD \["fmarch-server"\]/);
  assert.match(source[".dockerignore"], /^target$/m);
  assert.match(source["railway.toml"], /healthcheckPath = "\/healthz"/);

  assert.match(source["frontend/svelte.config.js"], /@sveltejs\/adapter-node/);
  assert.match(source["frontend/package.json"], /"@sveltejs\/adapter-node": "5\.5\.7"/);
  assert.match(source["Dockerfile.frontend"], /COPY frontend\/package\.json frontend\/package-lock\.json/);
  assert.match(source["Dockerfile.frontend"], /COPY \. \./);
  assert.match(source["Dockerfile.frontend"], /npm ci/);
  assert.match(source["Dockerfile.frontend"], /CMD \["node", "build"\]/);
  assert.match(source["deploy/railway/frontend.railway.toml"], /dockerfilePath = "Dockerfile\.frontend"/);
  assert.match(source["deploy/railway/frontend.railway.toml"], /healthcheckPath = "\/"/);

  assert.match(source["deploy/railway/api.env.example"], /DATABASE_URL=\$\{\{Postgres\.DATABASE_URL\}\}/);
  assert.match(source["deploy/railway/api.env.example"], /FMARCH_MEDIA_ROOT=\/var\/lib\/fmarch\/media/);
  assert.doesNotMatch(source["deploy/railway/api.env.example"], /FMARCH_DEV_AUTH/);
  assert.match(source["deploy/railway/frontend.env.example"], /^ORIGIN=https:\/\//m);
  assert.match(source["deploy/railway/frontend.env.example"], /^FMARCH_API_BASE_URL=https:\/\//m);

  assert.match(source["crates/server/src/main.rs"], /platform_port/);
  assert.match(source["crates/server/src/main.rs"], /format!\("0\.0\.0\.0:\{port\}"\)/);

  const runbook = source["docs/ops/railway-staging-target.md"];
  for (const requiredText of [
    "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    "FMARCH_HOSTED_MATRIX_API_URL",
    "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
    "FMARCH_DEV_AUTH=1",
    "test:dev-test-game-real-hosted-matrix-raw-capture",
  ]) {
    assert.ok(runbook.includes(requiredText), `runbook missing ${requiredText}`);
  }
}

async function read(relativePath) {
  return await readFile(path.join(root, relativePath), "utf8");
}
