import {assertAuthenticatedReceipt, stagingOrigins} from './hosted_authenticated_acceptance.mjs';
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";

export const RELEASE_RECEIPT_VERSION = 7;
export const RELEASE_EVIDENCE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const RELEASE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
export const CANONICAL_RELEASE_TOPOLOGY = Object.freeze({
  version: 1,
  project_id: "9d285d67-c11b-4508-9efb-fad042787b4c",
  services: Object.freeze({
    migrator: "7c2c2665-2be2-4938-84e5-7580a964d610",
    api: "18b6f450-3739-4f21-8e01-f58c63cec834",
    frontend: "23787c98-db56-4ccc-869a-42dca74d7bc7",
  }),
  images: Object.freeze({
    runtime: "ghcr.io/fluffyrabbot/fmarch-runtime",
    frontend: "ghcr.io/fluffyrabbot/fmarch-frontend",
  }),
  environments: Object.freeze({
    staging: Object.freeze({
      id: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
      name: "staging",
      origins: Object.freeze({
        api: "https://fmarch-staging.up.railway.app",
        frontend: "https://fmarch-frontend-staging.up.railway.app",
        internal_api: "http://fmarch.railway.internal:8080",
      }),
    }),
    production: Object.freeze({
      id: "c1378737-84cc-45ba-8474-9c868baf7cfb",
      name: "production",
      origins: Object.freeze({
        api: "https://fmarch-production.up.railway.app",
        frontend: "https://fmarch-frontend-production.up.railway.app",
        internal_api: "http://fmarch.railway.internal:8080",
      }),
    }),
  }),
});
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

function canonicalInstant(value, label) {
  assertNonemptyString(value, label);
  const instant = new Date(value);
  assert.equal(Number.isNaN(instant.getTime()), false, `${label} must be a valid timestamp`);
  assert.equal(instant.toISOString(), value, `${label} must be canonical ISO-8601`);
  return instant.getTime();
}

export function canonicalReleaseTopology(environment) {
  const environmentTopology = CANONICAL_RELEASE_TOPOLOGY.environments[environment];
  assert.ok(environmentTopology, `unsupported release environment ${environment}`);
  return {
    version: CANONICAL_RELEASE_TOPOLOGY.version,
    project_id: CANONICAL_RELEASE_TOPOLOGY.project_id,
    environment: {
      id: environmentTopology.id,
      name: environmentTopology.name,
    },
    services: { ...CANONICAL_RELEASE_TOPOLOGY.services },
    origins: { ...environmentTopology.origins },
  };
}

export function assertCanonicalReleaseTopology(topology, environment) {
  assert.deepEqual(
    topology,
    canonicalReleaseTopology(environment),
    `${environment} release topology drifted from the canonical Railway authority`,
  );
  return topology;
}

export function assertFreshReleaseEvidence(
  value,
  label,
  {
    now = new Date(),
    maxAgeMilliseconds = RELEASE_EVIDENCE_MAX_AGE_MS,
    clockSkewMilliseconds = RELEASE_CLOCK_SKEW_MS,
  } = {},
) {
  const nowMilliseconds = now instanceof Date ? now.getTime() : new Date(now).getTime();
  assert.equal(Number.isNaN(nowMilliseconds), false, "release evidence reference time is invalid");
  const evidenceMilliseconds = canonicalInstant(value, label);
  assert.ok(
    evidenceMilliseconds <= nowMilliseconds + clockSkewMilliseconds,
    `${label} is unreasonably in the future`,
  );
  assert.ok(
    nowMilliseconds - evidenceMilliseconds <= maxAgeMilliseconds,
    `${label} is older than the release freshness window`,
  );
  return evidenceMilliseconds;
}

export function validateFleetProofReceipt(
  receipt,
  {
    expectedCommit,
    publicKeyPem,
    expectedWorkflow,
    expectedTrustRootSha256,
    expectedJobId,
    expectedHost = "cachy",
    expectedRepository = "fmarch",
    expectedPlatform = "linux",
    expectedVerificationMode = "audit",
    now = new Date(),
    maxAgeMilliseconds = RELEASE_EVIDENCE_MAX_AGE_MS,
  },
) {
  assertFullCommit(expectedCommit);
  assertNonemptyString(expectedJobId, "expected fleet job id");
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
  assert.equal(document.jobId, expectedJobId, "fleet job id drifted");
  assert.equal(document.taskId, document.jobId, "fleet receipt task/job identity drifted");
  assertFreshReleaseEvidence(document.completedAt, "fleet receipt completion time", {
    now,
    maxAgeMilliseconds,
  });

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
  assert.equal(evidence?.outcome, "finished", "fleet evidence did not finish");
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
      .filter((step) => step.label?.startsWith("setup: "))
      .map((step) => step.label.slice("setup: ".length)),
    expectedWorkflow?.setup ?? [],
    "fleet setup commands are missing or differ",
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

export function validateHealth(body, expectedCommit, kind, topology = null) {
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
    if (topology !== null) {
      assert.deepEqual(
        body?.database_identity,
        {
          project_id: topology.project_id,
          environment_id: topology.environment.id,
          environment: topology.environment.name,
        },
        "API readiness database identity does not match the canonical Railway target",
      );
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

export function bindReleaseAttempt({
  environment,
  commit,
  runtimeDigest,
  frontendDigest,
  fleetProof,
  topology = canonicalReleaseTopology(environment),
  promotionLeaseCommit = null,
  createdAt = new Date(),
  existing = null,
}) {
  assert.ok(["staging", "production"].includes(environment), "unsupported release environment");
  assertFullCommit(commit);
  assertImageDigest(runtimeDigest, "runtime digest");
  assertImageDigest(frontendDigest, "frontend digest");
  assertFleetProofAttestation(fleetProof, commit);
  assertCanonicalReleaseTopology(topology, environment);
  if (environment === "production") {
    assertFullCommit(promotionLeaseCommit, "production promotion lease commit");
  } else {
    assert.equal(promotionLeaseCommit, null, "staging must not claim a production promotion lease");
  }
  const createdAtValue = existing?.created_at ?? createdAt.toISOString();
  canonicalInstant(createdAtValue, "release attempt creation time");
  const base = {
    version: 3,
    kind: "fmarch-release-attempt",
    environment,
    commit,
    created_at: createdAtValue,
    images: { runtime: runtimeDigest, frontend: frontendDigest },
    topology,
    promotion_lease_commit: promotionLeaseCommit,
    fleet_job_id: fleetProof.job_id,
    fleet_receipt_sha256: fleetProof.receipt_sha256,
  };
  const attempt = { ...base, receipt_sha256: receiptDigest(base) };
  if (existing) {
    const { receipt_sha256: existingDigest, ...existingBase } = existing;
    assert.equal(existingDigest, receiptDigest(existingBase), "release attempt receipt was tampered with");
    assert.deepEqual(
      existing,
      attempt,
      "release retry must reuse the exact commit, proof, topology, and image digests",
    );
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
  topology = canonicalReleaseTopology(environment),
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
  validateHealth(health.api, commit, "api", topology);
  validateHealth(health.frontend, commit, "frontend");
  assertFleetProofAttestation(fleetProof, commit);
  assertCanonicalReleaseTopology(topology, environment);
  assert.equal(
    attemptReceipt?.receipt_sha256,
    bindReleaseAttempt({
      environment,
      commit,
      runtimeDigest,
      frontendDigest,
      fleetProof,
      topology,
      promotionLeaseCommit: attemptReceipt?.promotion_lease_commit ?? null,
      existing: attemptReceipt,
    }).receipt_sha256,
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
    topology,
    promotion_lease_commit: attemptReceipt.promotion_lease_commit,
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
    attempt: attemptReceipt,
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
  assert.ok(["staging", "production"].includes(receipt.environment), "unsupported release environment");
  assertFullCommit(receipt.commit);
  assertCanonicalReleaseTopology(receipt.topology, receipt.environment);
  assertImageDigest(receipt.images?.runtime, "runtime digest");
  assertImageDigest(receipt.images?.frontend, "frontend digest");
  assertRuntimeValidationAttestation(receipt.runtime_validation, receipt.images?.runtime);
  assertFleetProofAttestation(receipt.fleet_proof, receipt.commit);
  assert.equal(receipt.images?.migrator_api_digest_equal, true);
  for (const service of ["migrator", "api", "frontend"]) {
    assertNonemptyString(receipt.deployments?.[service], `${service} deployment id`);
  }
  assert.match(receipt.schema_head ?? "", /^\d{4}_[a-z0-9_]+\.sql$/u, "schema head is invalid");
  assert.ok(receipt.attempt, "release attempt receipt is missing");
  const attempt = bindReleaseAttempt({
    environment: receipt.environment,
    commit: receipt.commit,
    runtimeDigest: receipt.images.runtime,
    frontendDigest: receipt.images.frontend,
    fleetProof: receipt.fleet_proof,
    topology: receipt.topology,
    promotionLeaseCommit: receipt.promotion_lease_commit,
    existing: receipt.attempt,
  });
  assert.equal(
    receipt.promotion_lease_commit,
    attempt.promotion_lease_commit,
    "release receipt promotion lease binding is invalid",
  );
  assert.equal(
    receipt.attempt_receipt_sha256,
    attempt.receipt_sha256,
    "release attempt receipt binding is invalid",
  );
  assertNonemptyString(receipt.generated_at, "release generation time");
  assert.equal(
    new Date(receipt.generated_at).toISOString(),
    receipt.generated_at,
    "release generation time is not canonical ISO-8601",
  );
  validateHealth(receipt.health?.api, receipt.commit, "api", receipt.topology);
  validateHealth(receipt.health?.frontend, receipt.commit, "frontend");
  assertSchemaEpochReset(receipt.schema_epoch_reset, receipt);
  const { receipt_sha256: actual, ...base } = receipt;
  assert.equal(actual, receiptDigest(base), "release receipt digest does not match its contents");
  if (receipt.environment === "staging") {
    assert.equal(receipt.release_readiness, null);
    assert.equal(receipt.sentinel?.status, "passed", "staging release requires a passed search sentinel");
    assertHostedReleaseAcceptance(receipt.hosted_acceptance, receipt.commit);
  } else if (receipt.environment === "production") {
    assertProductionReleaseReadiness(receipt.release_readiness);
    assert.equal(receipt.sentinel, null, "production release must not contain a staging sentinel");
    assert.equal(receipt.hosted_acceptance, null, "production release must not contain staging acceptance");
  }
  const serialized = JSON.stringify(receipt).toUpperCase();
  for (const forbidden of ["DATABASE_URL", "PASSWORD", "TOKEN", "SECRET", "PRIVATE_KEY"]) {
    assert.equal(serialized.includes(forbidden), false, `release receipt contains forbidden ${forbidden}`);
  }
  return receipt;
}

export function assertFreshStagingReleaseReceipt(
  receipt,
  {
    now = new Date(),
    maxAgeMilliseconds = RELEASE_EVIDENCE_MAX_AGE_MS,
  } = {},
) {
  const validated = assertReleaseReceipt(receipt);
  assert.equal(validated.environment, "staging", "production requires a staging release receipt");
  const generatedAt = assertFreshReleaseEvidence(
    validated.generated_at,
    "staging release generation time",
    { now, maxAgeMilliseconds },
  );
  const attemptAt = assertFreshReleaseEvidence(
    validated.attempt.created_at,
    "staging release intent time",
    { now, maxAgeMilliseconds },
  );
  const fleetAt = assertFreshReleaseEvidence(
    validated.fleet_proof.completed_at,
    "staging fleet proof completion time",
    { now, maxAgeMilliseconds },
  );
  const hostedAt = assertFreshReleaseEvidence(
    validated.hosted_acceptance.generatedAt,
    "staging hosted acceptance time",
    { now, maxAgeMilliseconds },
  );
  for (const [label, evidenceAt] of [
    ["release intent", attemptAt],
    ["fleet proof", fleetAt],
    ["hosted acceptance", hostedAt],
  ]) {
    assert.ok(
      evidenceAt <= generatedAt + RELEASE_CLOCK_SKEW_MS,
      `staging ${label} cannot postdate its release receipt`,
    );
  }
  return validated;
}

function assertSchemaEpochReset(reset, receipt) {
  if (reset === null) return;
  assert.equal(reset?.version, 1, "schema epoch reset version drifted");
  assert.equal(reset?.kind, "fmarch-schema-epoch-reset", "schema epoch reset kind drifted");
  assert.equal(reset.environment, receipt.environment, "schema epoch reset environment drifted");
  assert.equal(reset.commit, receipt.commit, "schema epoch reset commit drifted");
  assert.equal(reset.runtime_digest, receipt.images.runtime, "schema epoch reset image drifted");
  assert.ok(Number.isSafeInteger(reset.epoch) && reset.epoch > 0, "schema epoch reset epoch is invalid");
  assertNonemptyString(reset.audit_deployment_id, "schema epoch reset audit deployment id");
  assertNonemptyString(reset.deployment_id, "schema epoch reset deployment id");
  assert.ok(
    reset.prior_counts !== null &&
      typeof reset.prior_counts === "object" &&
      !Array.isArray(reset.prior_counts),
    "schema epoch reset prior counts are missing",
  );
  const { receipt_sha256: actual, ...base } = reset;
  assert.equal(actual, receiptDigest(base), "schema epoch reset receipt was tampered with");
}

export function assertHostedReleaseAcceptance(receipt, commit) {
  assert.equal(receipt?.status, 'passed', 'Staging release requires live hosted acceptance');
  assert.equal(receipt.checkerCommit, commit, 'Hosted checker must match release commit');
  assert.equal(receipt.target?.commit, commit, 'Hosted target must match release commit');
  assert.equal(receipt.target?.api, stagingOrigins.api);
  assert.equal(receipt.target?.frontend, stagingOrigins.frontend);
  canonicalInstant(receipt.generatedAt, "hosted acceptance generation time");
  assertAuthenticatedReceipt(receipt.authenticatedJourneys);
  return receipt;
}
