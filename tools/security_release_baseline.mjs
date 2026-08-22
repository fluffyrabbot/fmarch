import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateSecretCustodyPolicy } from "./production_promotion.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactPath = path.join(root, "target", "security-release-baseline", "report.json");

const sensitiveKey = /(?:authorization|cookie|credential|email|login_name|password|principal_id|secret|session|signed_url|token|workos_user_id)/i;
const sensitiveTextPatterns = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i,
  /\bfmss_[A-Za-z0-9._~-]+/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk_[A-Za-z0-9_-]{16,}\b/,
  /[?&](?:token|signature|x-amz-signature|x-amz-credential)=(?!\[redacted\])[^&#\s]+/i,
  /\b[A-Z0-9._%+-]+@(?!example\.(?:com|test)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
];

export function redactSecurityEvidence(value) {
  if (Array.isArray(value)) return value.map(redactSecurityEvidence);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        sensitiveKey.test(key) ? "[redacted]" : redactSecurityEvidence(child),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
    .replace(/\bfmss_[A-Za-z0-9._~-]+/gi, "[redacted-session]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-access-key]")
    .replace(/\bsk_[A-Za-z0-9_-]{16,}\b/g, "[redacted-provider-key]")
    .replace(
      /([?&](?:token|signature|x-amz-signature|x-amz-credential)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .replace(
      /\b[A-Z0-9._%+-]+@(?!example\.(?:com|test)\b)[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    );
}

export function assertNoSensitiveEvidence(value) {
  const serialized = JSON.stringify(value);
  for (const pattern of sensitiveTextPatterns) {
    assert.doesNotMatch(serialized, pattern, `security evidence contains ${pattern}`);
  }
  inspectSensitiveKeys(value);
}

function inspectSensitiveKeys(value, location = "$.") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => inspectSensitiveKeys(child, `${location}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKey.test(key)) {
      assert.equal(child, "[redacted]", `${location}${key} must be redacted`);
    } else {
      inspectSensitiveKeys(child, `${location}${key}.`);
    }
  }
}

export function validateTelemetrySource(source, label) {
  const events = source.match(/tracing::(?:trace|debug|info|warn|error)!\([\s\S]*?\);/g) ?? [];
  for (const event of events) {
    assert.doesNotMatch(
      event,
      /(?:principal_id|workos_user_id|login_name)\s*=/,
      `${label} logs a concrete identity`,
    );
    assert.doesNotMatch(
      event,
      /(?:error|message|path)\s*=\s*%|%(?:error|message|path)\b/,
      `${label} logs an unbounded error or request path`,
    );
  }
}

export function assertPinnedDockerfileBases(dockerfile, label) {
  const stages = new Set();
  for (const line of dockerfile.match(/^FROM .+$/gim) ?? []) {
    const match = /^FROM\s+(\S+)(?:\s+AS\s+([A-Za-z0-9][A-Za-z0-9_.-]*))?$/i.exec(line);
    assert.ok(match, `${label} has an invalid FROM instruction: ${line}`);
    const [, base, stage] = match;
    if (!stages.has(base)) {
      assert.match(
        base,
        /@sha256:[a-f0-9]{64}$/,
        `${label} external base must be pinned: ${line}`,
      );
    }
    if (stage) stages.add(stage);
  }
}

export async function validateSecurityReleaseBaseline() {
  const source = Object.fromEntries(
    await Promise.all(
      [
        "Dockerfile",
        "Dockerfile.frontend",
        "frontend/svelte.config.js",
        "frontend/src/hooks.server.js",
        "crates/server/src/main.rs",
        "crates/server/src/admission.rs",
        "crates/api/src/lib.rs",
        "crates/api/src/identity_delivery.rs",
        "deploy/railway/api.env.example",
        "deploy/railway/frontend.env.example",
        "deny.toml",
        "docs/ops/dependency-policy.json",
        "package.json",
      ].map(async (relativePath) => [
        relativePath,
        await readFile(path.join(root, relativePath), "utf8"),
      ]),
    ),
  );

  const csp = source["frontend/svelte.config.js"];
  assert.match(csp, /mode:\s*"nonce"/);
  assert.match(csp, /"script-src": \["self", "strict-dynamic"\]/);
  assert.match(csp, /"script-src-attr": \["none"\]/);
  assert.match(csp, /"style-src-attr": \[/);
  assert.match(csp, /"unsafe-hashes"/);
  assert.match(csp, /sha256-S8qMpvofolR8Mpjy4kQvEm7m1q8clzU4dfDH0AmvZjo=/);
  assert.match(csp, /"object-src": \["none"\]/);
  assert.match(csp, /"frame-ancestors": \["none"\]/);
  assert.match(csp, /"frame-src": \["https:\/\/www\.youtube-nocookie\.com"\]/);
  assert.doesNotMatch(csp, /unsafe-eval|unsafe-inline/);
  assert.doesNotMatch(csp, /"connect-src"[^\n]*"https:"/);
  for (const frontendPath of await filesUnder(path.join(root, "frontend", "src"))) {
    if (!frontendPath.endsWith(".svelte") && !frontendPath.endsWith(".html")) continue;
    const frontendSource = await readFile(frontendPath, "utf8");
    assert.doesNotMatch(
      frontendSource,
      /\bstyle\s*=|(?:\s|<)style:/,
      `${path.relative(root, frontendPath)} must not bypass nonce CSP with style attributes`,
    );
  }

  for (const [name, dockerfile] of [
    ["API", source.Dockerfile],
    ["frontend", source["Dockerfile.frontend"]],
  ]) {
    assertPinnedDockerfileBases(dockerfile, name);
    assert.match(dockerfile, /org\.opencontainers\.image\.source=/);
    assert.match(dockerfile, /\nUSER (?:fmarch|node)\n/);
  }
  assert.match(source.Dockerfile, /cargo build --release --locked/);
  assert.match(source["Dockerfile.frontend"], /npm ci --ignore-scripts/);
  assert.match(source["Dockerfile.frontend"], /npm prune --omit=dev/);

  const dependencyPolicy = JSON.parse(source["docs/ops/dependency-policy.json"]);
  assert.equal(dependencyPolicy.version, 1);
  assert.deepEqual(dependencyPolicy.rust.checks, [
    "advisories",
    "licenses",
    "sources",
    "bans",
  ]);
  assert.equal(dependencyPolicy.npm.audit_level, "moderate");
  assert.match(source["deny.toml"], /unknown-registry = "deny"/);
  assert.match(source["deny.toml"], /unknown-git = "deny"/);
  assert.match(source["deny.toml"], /RUSTSEC-2024-0436/);
  assert.match(
    source["package.json"],
    /"test:dependency-policy": "node tools\/dependency_policy\.mjs/,
  );

  for (const relativePath of [
    "crates/server/src/main.rs",
    "crates/server/src/admission.rs",
    "crates/api/src/lib.rs",
    "crates/api/src/identity_delivery.rs",
  ]) {
    validateTelemetrySource(source[relativePath], relativePath);
  }

  for (const [relativePath, requiredMarkers] of [
    [
      "deploy/railway/api.env.example",
      [
        "FMARCH_AUTH_SOURCE_SIGNING_KID",
        "FMARCH_EVENT_WRAP_KID",
        "FMARCH_EVENT_ARCHIVE_KID",
        "FMARCH_PROFILE_HANDLE_INDEX_KID",
        "FMARCH_OBJECT_STORAGE_CREDENTIAL_KID",
        "FMARCH_WORKOS_CREDENTIAL_KID",
      ],
    ],
    [
      "deploy/railway/frontend.env.example",
      ["FMARCH_AUTH_SOURCE_SIGNING_KID", "FMARCH_WORKOS_CREDENTIAL_KID"],
    ],
  ]) {
    for (const marker of requiredMarkers) {
      assert.match(source[relativePath], new RegExp(`^${marker}=\\S+`, "m"));
    }
  }

  const policy = JSON.parse(
    await readFile(path.join(root, "docs", "ops", "release-secret-custody.json"), "utf8"),
  );
  validateSecretCustodyPolicy(policy);

  const canary = {
    authorization: "Bearer canary-secret-token",
    principal_id: "principal-canary",
    contact: "operator@private.invalid",
    provider: "sk_canaryprovidersecret000000",
    object: "AKIAIOSFODNN7EXAMPLE",
    media: "https://objects.example.test/item?X-Amz-Signature=canary-signature",
  };
  const redactedCanary = redactSecurityEvidence(canary);
  assertNoSensitiveEvidence(redactedCanary);
  const report = {
    version: 1,
    ok: true,
    boundary:
      "Local source, runtime-header, telemetry-field, secret-custody, graph-aware dependency advisory/license/source, pinned-container, and evidence-redaction contract; not third-party penetration testing, compliance certification, hosted telemetry retention, or production incident readiness.",
    checks: [
      "nonce-csp",
      "locked-dependencies",
      "dependency-advisory-license-source-policy",
      "pinned-container-bases",
      "bounded-telemetry-fields",
      "environment-secret-custody-and-rotation",
      "operator-evidence-redaction",
    ],
    redaction_canary: redactedCanary,
  };
  assertNoSensitiveEvidence(report);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    }),
  );
  return nested.flat();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await validateSecurityReleaseBaseline();
  console.log(`security release baseline passed; wrote ${path.relative(root, artifactPath)}`);
}
