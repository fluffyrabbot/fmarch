import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const RELEASE_RECEIPT_VERSION = 1;
export const TERMINAL_DEPLOYMENT_STATES = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "NEEDS_APPROVAL",
  "SLEEPING",
  "SKIPPED",
  "REMOVED",
  "REMOVING",
]);

const fullCommitPattern = /^[0-9a-f]{40}$/u;
const imageDigestPattern = /^sha256:[0-9a-f]{64}$/u;

export function assertFullCommit(commit, label = "release commit") {
  assert.match(commit ?? "", fullCommitPattern, `${label} must be a full lowercase Git SHA`);
  return commit;
}

export function assertImageDigest(digest, label) {
  assert.match(digest ?? "", imageDigestPattern, `${label} must be a sha256 OCI digest`);
  return digest;
}

export function validateReleaseRepository({
  status,
  branch,
  commit,
  head,
  originMain,
  originProduction,
  pushed,
  environment,
}) {
  assert.equal(status, "", "release coordination requires a clean worktree");
  assert.ok(
    branch === "main" || branch === "",
    "release coordination must run from main or a detached exact-commit release checkout",
  );
  assertFullCommit(commit);
  assert.equal(head, commit, "the requested release commit must equal HEAD");
  assert.equal(originMain, commit, "the requested release commit must equal origin/main");
  assert.equal(pushed, true, "the requested release commit must already be pushed");
  assert.ok(["staging", "production"].includes(environment), "unsupported release environment");
  if (environment === "production") {
    assert.equal(
      originProduction,
      commit,
      "production coordination requires the production pointer at the exact release commit",
    );
  }
  return true;
}

export function validateProofReceipt(receipt, expectedCommit, requiredMode = "full") {
  assert.equal(receipt?.schema, 2, "release proof receipt schema must be 2");
  assert.equal(receipt.state, "passed", "release proof receipt must have passed");
  assert.equal(receipt.context?.commit, expectedCommit, "proof receipt commit does not match release");
  assert.equal(receipt.context?.mode, requiredMode, `release proof must use ${requiredMode} mode`);
  assert.match(
    receipt.context?.manifest_sha256 ?? "",
    /^[0-9a-f]{64}$/u,
    "proof receipt must bind the proof manifest",
  );
  assert.ok(receipt.finished_at, "proof receipt must be terminal");
  return true;
}

export function deploymentImageDigest(deployment) {
  return (
    deployment?.meta?.imageDigest ??
    deployment?.meta?.image_digest ??
    deployment?.imageDigest ??
    null
  );
}

export function validateDeploymentArtifact(deployment, expectedDigest, label) {
  assert.ok(deployment, `${label} has no Railway deployment`);
  assert.equal(deployment.status, "SUCCESS", `${label} deployment is ${deployment.status}`);
  assert.equal(
    deploymentImageDigest(deployment),
    expectedDigest,
    `${label} does not run the expected OCI digest`,
  );
  assert.ok(deployment.id, `${label} deployment has no id`);
  return deployment;
}

export function validateHealth(body, expectedCommit, kind) {
  assert.equal(body?.release_commit, expectedCommit, `${kind} health commit does not match release`);
  if (kind === "api") {
    for (const field of [
      "ok",
      "database_schema",
      "event_encryption",
      "object_storage",
      "subject_authority",
    ]) {
      assert.equal(body?.[field], true, `API readiness field ${field} is not true`);
    }
  } else if (kind === "frontend") {
    assert.equal(body?.status, "ok", "frontend health status is not ok");
  } else throw new Error(`unknown health kind ${kind}`);
  return true;
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function receiptDigest(receiptWithoutDigest) {
  return createHash("sha256").update(canonicalJson(receiptWithoutDigest)).digest("hex");
}

export function bindReleaseAttempt({ environment, commit, runtimeDigest, frontendDigest, existing = null }) {
  assert.ok(["staging", "production"].includes(environment), "unsupported release environment");
  assertFullCommit(commit);
  assertImageDigest(runtimeDigest, "runtime digest");
  assertImageDigest(frontendDigest, "frontend digest");
  const base = {
    version: 1,
    kind: "fmarch-release-attempt",
    environment,
    commit,
    images: { runtime: runtimeDigest, frontend: frontendDigest },
  };
  const attempt = { ...base, receipt_sha256: receiptDigest(base) };
  if (existing) {
    const { receipt_sha256: existingDigest, ...existingBase } = existing;
    assert.equal(existingDigest, receiptDigest(existingBase), "release attempt receipt was tampered with");
    assert.deepEqual(existing, attempt, "release retry must reuse the exact commit and image digests");
    return existing;
  }
  return attempt;
}

export function buildReleaseReceipt({
  environment,
  commit,
  runtimeDigest,
  frontendDigest,
  deployments,
  health,
  schemaHead,
  proofReceipt,
  attemptReceipt,
  sentinel = null,
  schemaEpochReset = null,
  generatedAt = new Date(),
}) {
  assertFullCommit(commit);
  assertImageDigest(runtimeDigest, "runtime digest");
  assertImageDigest(frontendDigest, "frontend digest");
  assert.ok(["staging", "production"].includes(environment), "unsupported release environment");
  validateDeploymentArtifact(deployments.migrator, runtimeDigest, "migrator");
  validateDeploymentArtifact(deployments.api, runtimeDigest, "API");
  validateDeploymentArtifact(deployments.frontend, frontendDigest, "frontend");
  validateHealth(health.api, commit, "api");
  validateHealth(health.frontend, commit, "frontend");
  validateProofReceipt(proofReceipt, commit);
  assert.equal(
    attemptReceipt?.receipt_sha256,
    bindReleaseAttempt({ environment, commit, runtimeDigest, frontendDigest, existing: attemptReceipt }).receipt_sha256,
    "release receipt requires its exact artifact attempt binding",
  );
  assert.match(schemaHead ?? "", /^\d{4}_[a-z0-9_]+\.sql$/u, "schema head is invalid");
  if (environment === "staging") {
    assert.equal(sentinel?.status, "passed", "staging release requires a passed search sentinel");
  } else {
    assert.equal(sentinel, null, "production release must not run the synthetic staging sentinel");
  }
  const base = {
    version: RELEASE_RECEIPT_VERSION,
    kind: "fmarch-exact-commit-release",
    environment,
    commit,
    generated_at: generatedAt.toISOString(),
    images: {
      runtime: runtimeDigest,
      frontend: frontendDigest,
      migrator_api_digest_equal: true,
    },
    deployments: {
      migrator: deployments.migrator.id,
      api: deployments.api.id,
      frontend: deployments.frontend.id,
    },
    schema_head: schemaHead,
    schema_epoch_reset: schemaEpochReset,
    proof_receipt: proofReceipt.id,
    attempt_receipt_sha256: attemptReceipt.receipt_sha256,
    health,
    sentinel,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

export function assertReleaseReceipt(receipt) {
  assert.equal(receipt?.version, RELEASE_RECEIPT_VERSION, "release receipt version drifted");
  assert.equal(receipt.kind, "fmarch-exact-commit-release", "release receipt kind drifted");
  assertFullCommit(receipt.commit);
  assertImageDigest(receipt.images?.runtime, "runtime digest");
  assertImageDigest(receipt.images?.frontend, "frontend digest");
  assert.equal(receipt.images?.migrator_api_digest_equal, true);
  const { receipt_sha256: actual, ...base } = receipt;
  assert.equal(actual, receiptDigest(base), "release receipt digest does not match its contents");
  const serialized = JSON.stringify(receipt).toUpperCase();
  for (const forbidden of ["DATABASE_URL", "PASSWORD", "TOKEN", "SECRET", "PRIVATE_KEY"]) {
    assert.equal(serialized.includes(forbidden), false, `release receipt contains forbidden ${forbidden}`);
  }
  return receipt;
}
