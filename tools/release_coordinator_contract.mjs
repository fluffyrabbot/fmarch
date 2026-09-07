import {assertAuthenticatedReceipt, stagingOrigins} from './hosted_authenticated_acceptance.mjs';
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";

export const RELEASE_RECEIPT_VERSION = 4;
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

const runtimeBinaryInventory = Object.freeze([
  "fmarch-server",
  "fmarch-migrate",
  "fmarch-schema-gate",
  "fmarch-schema-epoch-reset",
  "fmarch-staging-search-corpus",
  "fmarch-event-key-admin",
  "fmarch-profile-index-admin",
]);

export function assertRuntimeValidationAttestation(attestation, expectedDigest) {
  assertImageDigest(expectedDigest, "runtime digest");
  assert.equal(attestation?.status, "passed", "runtime image validation did not pass");
  assert.equal(
    attestation?.policy,
    "immutable-linux-amd64-runtime-v1",
    "runtime image validation policy drifted",
  );
  assert.equal(attestation.runtime_digest, expectedDigest, "runtime attestation digest drifted");
  assert.match(
    attestation.runtime_reference ?? "",
    new RegExp(`@${expectedDigest.replaceAll("/", "\\/")}$`, "u"),
    "runtime attestation must target the immutable digest",
  );
  assert.equal(attestation.platform, "linux/amd64", "runtime image validation platform drifted");
  assert.equal(attestation.runtime_uid, 10001, "runtime image must run as UID 10001");
  assert.equal(attestation.runtime_content_directories, false);
  assert.deepEqual(attestation.binary_inventory, runtimeBinaryInventory);
  assert.match(attestation.registry_hash ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(attestation.host_registry_hash, attestation.registry_hash);
  assert.match(attestation.validation_report_sha256 ?? "", /^[0-9a-f]{64}$/u);
  return attestation;
}

export function validateReleaseRepository({
  status,
  branch,
  commit,
  head,
  originMain,
  originProduction,
  productionIsAncestor = null,
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
    assertFullCommit(originProduction, "production pointer");
    assert.equal(productionIsAncestor, true, "production pointer must be an ancestor of the release commit");
  }
  return true;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertNonemptyString(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.notEqual(value.trim(), "", `${label} must not be empty`);
  return value;
}

export function validateFleetProofReceipt(
  receipt,
  {
    expectedCommit,
    publicKeyPem,
    expectedWorkflow,
    expectedTrustRootSha256,
    expectedJobId = null,
    expectedHost = "cachy",
    expectedRepository = "fmarch",
    expectedPlatform = "linux",
    expectedVerificationMode = "audit",
  },
) {
  assertFullCommit(expectedCommit);
  assert.equal(receipt?.queueState, "finished", "fleet proof job is not finished");
  const document = receipt?.document;
  assert.equal(document?.schemaVersion, 1, "fleet receipt schema drifted");
  assert.equal(document?.signature?.algorithm, "ed25519", "fleet receipt must use Ed25519");
  assertNonemptyString(document.signature?.value, "fleet receipt signature");
  const { signature: _signature, ...unsignedDocument } = document;
  const publicKey = createPublicKey(assertNonemptyString(publicKeyPem, "fleet public key"));
  assert.equal(
    verify(
      null,
      Buffer.from(canonicalJson(unsignedDocument)),
      publicKey,
      Buffer.from(document.signature.value, "base64"),
    ),
    true,
    "invalid fleet worker receipt signature",
  );

  assert.equal(document.state, "finished", "fleet receipt is not terminal");
  assert.equal(document.error, null, "fleet receipt records an error");
  assert.equal(document.host, expectedHost, "fleet receipt came from the wrong host");
  assertNonemptyString(document.jobId, "fleet job id");
  if (expectedJobId !== null) assert.equal(document.jobId, expectedJobId, "fleet job id drifted");
  assert.equal(document.taskId, document.jobId, "fleet receipt task/job identity drifted");
  assertNonemptyString(document.completedAt, "fleet receipt completion time");

  const task = document.task;
  const evidence = document.evidence;
  assert.equal(task?.schemaVersion, 1, "fleet task schema drifted");
  assert.equal(task?.state, "finished", "fleet task is not finished");
  assert.equal(task?.id, document.taskId, "fleet task id drifted");
  assert.equal(task?.repository, expectedRepository, "fleet task repository drifted");
  assert.equal(task?.host, expectedHost, "fleet task host drifted");
  assert.equal(task?.baseSha, expectedCommit, "fleet proof does not bind the release commit");
  assert.equal(task?.resultSha, expectedCommit, "fleet worker verified a different result commit");
  assertFullCommit(task?.comparisonSha, "fleet comparison commit");
  assert.equal(
    task?.verificationMode,
    expectedVerificationMode,
    `release proof must use ${expectedVerificationMode} mode`,
  );
  assert.match(task?.remoteRef ?? "", /^(?!main$|production$)[A-Za-z0-9][A-Za-z0-9._/-]*$/u, "fleet proof must name a task branch");

  assert.equal(evidence?.schemaVersion, 1, "fleet evidence schema drifted");
  assert.equal(evidence?.verifyOnly, true, "release proof must be verification-only");
  assert.equal(evidence?.outcome, "passed", "fleet evidence did not pass");
  assert.equal(evidence?.error, null, "fleet evidence records an error");
  assert.equal(evidence?.taskId, task.id, "fleet evidence task id drifted");
  assert.equal(evidence?.repository, expectedRepository, "fleet evidence repository drifted");
  assert.equal(evidence?.host, expectedHost, "fleet evidence host drifted");
  assert.equal(evidence?.platform, expectedPlatform, "fleet evidence platform drifted");
  assert.equal(evidence?.baseSha, task.baseSha, "fleet evidence base commit drifted");
  assert.equal(evidence?.resultSha, task.resultSha, "fleet evidence result commit drifted");
  assert.equal(evidence?.comparisonSha, task.comparisonSha, "fleet evidence comparison commit drifted");
  assert.equal(evidence?.verificationMode, task.verificationMode, "fleet evidence mode drifted");
  assert.equal(evidence?.workflow?.profile, expectedPlatform, "fleet workflow profile drifted");
  assert.equal(
    evidence?.workflow?.environment?.FLEET_COMPARISON_SHA,
    task.comparisonSha,
    "fleet workflow comparison commit drifted",
  );
  assert.equal(
    evidence?.workflow?.environment?.FLEET_VERIFICATION_MODE,
    task.verificationMode,
    "fleet workflow mode drifted",
  );
  assert.deepEqual(evidence?.workflow?.setup, expectedWorkflow?.setup ?? [], "fleet setup workflow drifted");
  assert.deepEqual(evidence?.workflow?.verify, expectedWorkflow?.verify, "fleet verify workflow drifted");
  assert.ok(Array.isArray(expectedWorkflow?.verify) && expectedWorkflow.verify.length > 0, "release workflow has no verification command");
  assert.ok(Array.isArray(evidence?.steps) && evidence.steps.length > 0, "fleet receipt has no executed steps");
  assert.equal(
    evidence.steps.every((step) => step.ok === true && step.status === 0 && step.timedOut === false),
    true,
    "fleet receipt contains an unsuccessful step",
  );
  assert.deepEqual(
    evidence.steps
      .filter((step) => step.label?.startsWith("verify: "))
      .map((step) => step.label.slice("verify: ".length)),
    expectedWorkflow.verify,
    "fleet verification commands are missing or differ",
  );

  const trustRoot = publicKey.export({ type: "spki", format: "der" });
  const trustRootSha256 = sha256(trustRoot);
  assert.match(expectedTrustRootSha256 ?? "", /^[0-9a-f]{64}$/u, "release policy must pin a fleet trust root");
  assert.equal(trustRootSha256, expectedTrustRootSha256, "fleet receipt key is not the pinned Cachy trust root");
  return {
    version: 1,
    kind: "fmarch-fleet-release-proof",
    job_id: document.jobId,
    task_id: task.id,
    host: expectedHost,
    repository: expectedRepository,
    platform: expectedPlatform,
    verification_mode: expectedVerificationMode,
    commit: expectedCommit,
    comparison_commit: task.comparisonSha,
    remote_ref: task.remoteRef,
    completed_at: document.completedAt,
    trust_root_sha256: trustRootSha256,
    receipt_sha256: sha256(canonicalJson(receipt)),
  };
}

export function assertFleetProofAttestation(attestation, expectedCommit) {
  assert.equal(attestation?.version, 1, "fleet proof attestation version drifted");
  assert.equal(attestation?.kind, "fmarch-fleet-release-proof", "fleet proof attestation kind drifted");
  assert.equal(attestation?.host, "cachy", "release proof is not from canonical Cachy");
  assert.equal(attestation?.repository, "fmarch", "release proof repository drifted");
  assert.equal(attestation?.platform, "linux", "release proof platform drifted");
  assert.equal(attestation?.verification_mode, "audit", "release proof is not a forced full audit");
  assert.equal(attestation?.commit, expectedCommit, "release proof attestation commit drifted");
  assertFullCommit(attestation?.comparison_commit, "fleet comparison commit");
  assertNonemptyString(attestation?.job_id, "fleet job id");
  assert.equal(attestation?.task_id, attestation.job_id, "fleet task/job identity drifted");
  assert.match(attestation?.remote_ref ?? "", /^(?!main$|production$)[A-Za-z0-9][A-Za-z0-9._/-]*$/u);
  assertNonemptyString(attestation?.completed_at, "fleet completion time");
  assert.match(attestation?.trust_root_sha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.match(attestation?.receipt_sha256 ?? "", /^[0-9a-f]{64}$/u);
  return attestation;
}

export function validateProductionReleaseReadiness(registry) {
  assert.equal(registry?.version, 1, "completion registry version drifted");
  const requiredSections = new Set(
    (registry.sections ?? [])
      .filter((section) => section.required_for === "platform" || section.required_for === "release")
      .map((section) => section.id),
  );
  assert.ok(requiredSections.size > 0, "completion registry has no required release surface");
  const requiredItems = (registry.items ?? []).filter((item) => requiredSections.has(item.section));
  const incomplete = requiredItems.filter((item) => item.status !== "complete");
  assert.equal(
    incomplete.length,
    0,
    `production release readiness is incomplete: ${incomplete.map((item) => `${item.id}=${item.status}`).join(", ")}`,
  );
  const base = {
    version: 1,
    kind: "fmarch-production-release-readiness",
    status: "passed",
    registry_sha256: sha256(canonicalJson(registry)),
    required_sections: [...requiredSections].sort(),
    completed_items: requiredItems.map((item) => item.id).sort(),
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

export function assertProductionReleaseReadiness(attestation) {
  assert.equal(attestation?.version, 1, "release readiness attestation version drifted");
  assert.equal(attestation?.kind, "fmarch-production-release-readiness", "release readiness attestation kind drifted");
  assert.equal(attestation?.status, "passed", "production release readiness did not pass");
  assert.match(attestation?.registry_sha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.ok(Array.isArray(attestation?.required_sections) && attestation.required_sections.length > 0);
  assert.ok(Array.isArray(attestation?.completed_items) && attestation.completed_items.length > 0);
  const { receipt_sha256: actual, ...base } = attestation;
  assert.equal(actual, receiptDigest(base), "release readiness attestation was tampered with");
  return attestation;
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
  fleetProof,
  attemptReceipt,
  runtimeValidation,
  releaseReadiness = null,
  sentinel = null,
  hostedAcceptance = null,
  schemaEpochReset = null,
  generatedAt = new Date(),
}) {
  assertFullCommit(commit);
  assertImageDigest(runtimeDigest, "runtime digest");
  assertImageDigest(frontendDigest, "frontend digest");
  assertRuntimeValidationAttestation(runtimeValidation, runtimeDigest);
  assert.ok(["staging", "production"].includes(environment), "unsupported release environment");
  validateDeploymentArtifact(deployments.migrator, runtimeDigest, "migrator");
  validateDeploymentArtifact(deployments.api, runtimeDigest, "API");
  validateDeploymentArtifact(deployments.frontend, frontendDigest, "frontend");
  validateHealth(health.api, commit, "api");
  validateHealth(health.frontend, commit, "frontend");
  assertFleetProofAttestation(fleetProof, commit);
  assert.equal(
    attemptReceipt?.receipt_sha256,
    bindReleaseAttempt({ environment, commit, runtimeDigest, frontendDigest, existing: attemptReceipt }).receipt_sha256,
    "release receipt requires its exact artifact attempt binding",
  );
  assert.match(schemaHead ?? "", /^\d{4}_[a-z0-9_]+\.sql$/u, "schema head is invalid");
  if (environment === "staging") {
    assert.equal(releaseReadiness, null, "staging must not claim production release readiness");
    assert.equal(sentinel?.status, "passed", "staging release requires a passed search sentinel");
    assertHostedReleaseAcceptance(hostedAcceptance, commit);
  } else {
    assertProductionReleaseReadiness(releaseReadiness);
    assert.equal(sentinel, null, "production release must not run the synthetic staging sentinel");
    assert.equal(hostedAcceptance, null, "production must not run synthetic staging acceptance");
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
    runtime_validation: runtimeValidation,
    deployments: {
      migrator: deployments.migrator.id,
      api: deployments.api.id,
      frontend: deployments.frontend.id,
    },
    schema_head: schemaHead,
    schema_epoch_reset: schemaEpochReset,
    fleet_proof: fleetProof,
    release_readiness: releaseReadiness,
    attempt_receipt_sha256: attemptReceipt.receipt_sha256,
    health,
    sentinel,
    hosted_acceptance: hostedAcceptance,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

export function assertReleaseReceipt(receipt) {
  assert.equal(receipt?.version, RELEASE_RECEIPT_VERSION, "release receipt version drifted");
  assert.equal(receipt.kind, "fmarch-exact-commit-release", "release receipt kind drifted");
  assertFullCommit(receipt.commit);
  assertImageDigest(receipt.images?.runtime, "runtime digest");
  assertImageDigest(receipt.images?.frontend, "frontend digest");
  assertRuntimeValidationAttestation(receipt.runtime_validation, receipt.images?.runtime);
  assertFleetProofAttestation(receipt.fleet_proof, receipt.commit);
  assert.equal(receipt.images?.migrator_api_digest_equal, true);
  const { receipt_sha256: actual, ...base } = receipt;
  assert.equal(actual, receiptDigest(base), "release receipt digest does not match its contents");
  if (receipt.environment === "staging") {
    assert.equal(receipt.release_readiness, null);
    assertHostedReleaseAcceptance(receipt.hosted_acceptance, receipt.commit);
  } else if (receipt.environment === "production") {
    assertProductionReleaseReadiness(receipt.release_readiness);
  } else {
    assert.fail(`unsupported release environment ${receipt.environment}`);
  }
  const serialized = JSON.stringify(receipt).toUpperCase();
  for (const forbidden of ["DATABASE_URL", "PASSWORD", "TOKEN", "SECRET", "PRIVATE_KEY"]) {
    assert.equal(serialized.includes(forbidden), false, `release receipt contains forbidden ${forbidden}`);
  }
  return receipt;
}

export function assertHostedReleaseAcceptance(receipt, commit) {
  assert.equal(receipt?.status, 'passed', 'Staging release requires live hosted acceptance');
  assert.equal(receipt.checkerCommit, commit, 'Hosted checker must match release commit');
  assert.equal(receipt.target?.commit, commit, 'Hosted target must match release commit');
  assert.equal(receipt.target?.api, stagingOrigins.api);
  assert.equal(receipt.target?.frontend, stagingOrigins.frontend);
  assertAuthenticatedReceipt(receipt.authenticatedJourneys);
  return receipt;
}
