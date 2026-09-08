import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { preflightWorkosOidc } from "./workos_oidc_preflight.mjs";
import { loadCompletionRegistry, validateRegistry } from "./completeness_scorecard.mjs";
import { defaultFleetPublicKeyPath, loadFleetReleaseProof } from "./fleet_release_proof.mjs";
import {
  revalidateCanonicalHostedVariables,
  revalidateCanonicalProductionHostedVariables,
  validateDatabaseAuthorityVariables,
  validateHostedVariables,
} from "./release_hosted_variable_authority.mjs";
import {
  CANONICAL_RELEASE_TOPOLOGY,
  assertFullCommit,
  assertFreshReleaseEvidence,
  assertFreshStagingReleaseReceipt,
  assertReleaseReceipt,
  validateDeploymentArtifact,
  validateHealth,
  validateProductionReleaseReadiness,
} from "./release_coordinator_contract.mjs";
import {
  CANONICAL_RELEASE_REMOTE_URL,
  PRODUCTION_PROMOTION_LOCK_REF,
  assertCanonicalReleaseRemote,
  assertProductionPromotionLease,
  canonicalReleaseFetchArguments,
  createProductionPromotionLockIntent,
  productionPointerPushArgumentsForAuthority,
  readProductionPromotionLease,
  releaseGitEnvironment,
  validateProductionPromotionLeaseIntent,
} from "./release_git_authority.mjs";

export { PRODUCTION_PROMOTION_LOCK_REF } from "./release_git_authority.mjs";
export {
  revalidateCanonicalHostedVariables,
  revalidateCanonicalProductionHostedVariables,
  validateDatabaseAuthorityVariables,
  validateHostedVariables,
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const callerSession = `fmarch-production-promotion-${process.pid}`;
const SUBPROCESS_TIMEOUT_MS = Object.freeze({
  git: 2 * 60 * 1_000,
  railway: 5 * 60 * 1_000,
  node: 60 * 60 * 1_000,
});
const stagingTopology = CANONICAL_RELEASE_TOPOLOGY.environments.staging;
const productionTopology = CANONICAL_RELEASE_TOPOLOGY.environments.production;
const DEFAULTS = Object.freeze({
  projectId: CANONICAL_RELEASE_TOPOLOGY.project_id,
  apiServiceId: CANONICAL_RELEASE_TOPOLOGY.services.api,
  migratorServiceId: CANONICAL_RELEASE_TOPOLOGY.services.migrator,
  frontendServiceId: CANONICAL_RELEASE_TOPOLOGY.services.frontend,
  stagingEnvironment: stagingTopology.name,
  stagingEnvironmentId: stagingTopology.id,
  productionEnvironment: productionTopology.name,
  productionEnvironmentId: productionTopology.id,
  stagingApiUrl: stagingTopology.origins.api,
  stagingFrontendUrl: stagingTopology.origins.frontend,
  productionApiUrl: productionTopology.origins.api,
  productionFrontendUrl: productionTopology.origins.frontend,
  internalApiUrl: stagingTopology.origins.internal_api,
});

const terminalDeploymentStates = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "NEEDS_APPROVAL",
  "SLEEPING",
  "SKIPPED",
  "REMOVED",
  "REMOVING",
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function parseArguments(argv) {
  const result = { checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--check") result.checkOnly = true;
    else if (argument === "--fleet-receipt") result.fleetReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-public-key") result.fleetPublicKey = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-job") result.fleetJob = requiredValue(argv, ++index, argument);
    else if (argument === "--resume-lock") {
      result.resumeLock = requiredValue(argv, ++index, argument);
      assertFullCommit(result.resumeLock, "production promotion resume lock");
    }
    else throw new Error(`unknown production promotion argument: ${argument}`);
  }
  assert.equal(
    result.checkOnly && result.resumeLock !== undefined,
    false,
    "--check cannot adopt a production promotion lease",
  );
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  assert.ok(value && !value.startsWith("--"), `${flag} requires a value`);
  return value;
}

export function validateRepositoryState({
  status,
  branch,
  head,
  originMain,
  productionIsAncestor,
  resumeLock,
  headIsAncestorOfOriginMain = false,
}) {
  assert.equal(status, "", "production promotion requires a clean worktree");
  if (resumeLock) {
    assertFullCommit(resumeLock, "production promotion resume lock");
    assert.equal(
      headIsAncestorOfOriginMain,
      true,
      "resumed production release commit must remain reachable from origin/main",
    );
  } else {
    assert.equal(branch, "main", "production promotion must run from main");
    assert.equal(head, originMain, "HEAD must equal origin/main before production promotion");
  }
  assert.equal(
    productionIsAncestor,
    true,
    "origin/production must be an ancestor of the promoted main commit",
  );
}

export async function revalidatePromotionHostedVariables(
  config,
  { resumeLock = null } = {},
  options = {},
) {
  return resumeLock
    ? await revalidateCanonicalProductionHostedVariables(config, options)
    : await revalidateCanonicalHostedVariables(config, options);
}

export function validateCoordinatedServiceSources(config, serviceIds = DEFAULTS, receipt = null) {
  const services = config.services ?? config;
  for (const [label, serviceId, repository] of [
    ["migrator", serviceIds.migratorServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["API", serviceIds.apiServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["frontend", serviceIds.frontendServiceId, CANONICAL_RELEASE_TOPOLOGY.images.frontend],
  ]) {
    assert.ok(serviceId, `Railway ${label} service id is required`);
    const source = services[serviceId]?.source ?? {};
    assert.equal(source.repo ?? null, null, `Railway ${label} must not retain a racing Git source`);
    assert.match(
      source.image ?? "",
      new RegExp(`^${escapeRegex(repository)}@sha256:[0-9a-f]{64}$`, "u"),
      `Railway ${label} must use its canonical digest-pinned OCI image`,
    );
  }
  if (receipt) {
    assert.equal(
      services[serviceIds.migratorServiceId].source.image,
      services[serviceIds.apiServiceId].source.image,
      "migrator and API must use the same runtime image reference",
    );
    assert.equal(
      services[serviceIds.apiServiceId].source.image,
      `${CANONICAL_RELEASE_TOPOLOGY.images.runtime}@${receipt.images.runtime}`,
      `${receipt.environment} API image does not exactly match the canonical release receipt`,
    );
    assert.equal(
      services[serviceIds.frontendServiceId].source.image,
      `${CANONICAL_RELEASE_TOPOLOGY.images.frontend}@${receipt.images.frontend}`,
      `${receipt.environment} frontend image does not exactly match the canonical release receipt`,
    );
  }
}

export function validateProductionSourceCutover(config, serviceIds = DEFAULTS) {
  const services = config.services ?? config;
  for (const [label, serviceId, repository] of [
    ["migrator", serviceIds.migratorServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["API", serviceIds.apiServiceId, CANONICAL_RELEASE_TOPOLOGY.images.runtime],
    ["frontend", serviceIds.frontendServiceId, CANONICAL_RELEASE_TOPOLOGY.images.frontend],
  ]) {
    assert.ok(services[serviceId], `Railway production ${label} service is missing`);
    const source = services[serviceId]?.source ?? {};
    const coordinated = new RegExp(
      `^${escapeRegex(repository)}@sha256:[0-9a-f]{64}$`,
      "u",
    ).test(source.image ?? "");
    const detachable = source.repo === "fluffyrabbot/fmarch" && source.image == null;
    const interruptedCutover = source.repo == null && source.image == null;
    assert.equal(
      coordinated || detachable || interruptedCutover,
      true,
      `Railway production ${label} source is neither coordinated, safely detachable, nor an interrupted cutover`,
    );
  }
}

export function validateSecretCustodyPolicy(policy) {
  assert.equal(policy?.version, 2, "secret custody policy version must be 2");
  assert.deepEqual(policy.environments, ["staging", "production"]);
  assert.equal(policy.rules?.environment_isolation_required, true);
  assert.equal(policy.rules?.repository_secret_values_forbidden, true);
  assert.equal(policy.rules?.rotation_marker_required, true);
  assert.equal(policy.rules?.retirement_requires_successful_redeploy, true);
  assert.deepEqual(
    policy.families?.map((family) => family.id),
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
  for (const family of policy.families ?? []) {
    assert.ok(family.owner, `${family.id} must name an owner`);
    assert.ok(family.custody, `${family.id} must name its custody boundary`);
    assert.ok(family.secret_variables?.length > 0, `${family.id} must name secret variables`);
    assert.match(
      family.rotation_marker ?? "",
      /^[A-Z][A-Z0-9_]+(?:KID|REVISION)$/,
      `${family.id} must name a non-secret rotation marker`,
    );
    assert.ok(family.consumers?.length > 0, `${family.id} must name consumers`);
    assert.ok(family.rotation?.includes("deploy"), `${family.id} rotation must include deployment`);
    assert.ok(
      family.rotation?.match(/retire|revoke/),
      `${family.id} rotation must define retirement`,
    );
  }
}

function secretCustodyPolicy() {
  return JSON.parse(
    readFileSync(
      new URL("../docs/ops/release-secret-custody.json", import.meta.url),
      "utf8",
    ),
  );
}

export function validateDeployment(deployment, expectedCommit, label) {
  assert.ok(deployment, `${label} has no Railway deployment`);
  assert.equal(deployment.status, "SUCCESS", `${label} deployment is ${deployment.status}`);
  assert.equal(
    deployment.meta?.commitHash,
    expectedCommit,
    `${label} does not run the promoted commit`,
  );
}

export function validateDomainList(result, expectedDomain, label) {
  const domain = result.domains?.find((candidate) => candidate.domain === expectedDomain);
  assert.ok(domain, `${label} is missing ${expectedDomain}`);
  assert.equal(domain.syncStatus, "ACTIVE", `${label} domain is ${domain.syncStatus}`);
}

function scrubPrivilegedDatabaseEnvironment(env) {
  const scrubbed = { ...env };
  for (const key of Object.keys(scrubbed)) {
    if (key.startsWith("PG")) delete scrubbed[key];
  }
  for (const key of [
    "DATABASE_MIGRATION_URL",
    "DATABASE_KEY_ADMIN_URL",
    "FMARCH_DATABASE_APPLICATION_PASSWORD",
    "FMARCH_DATABASE_KEY_ADMIN_PASSWORD",
  ]) {
    delete scrubbed[key];
  }
  return {
    ...scrubbed,
    RAILWAY_CALLER: "skill:use-railway@1.4.0",
    RAILWAY_AGENT_SESSION: callerSession,
  };
}

export function railwayArguments(projectId, args) {
  assert.equal(
    projectId,
    CANONICAL_RELEASE_TOPOLOGY.project_id,
    "Railway command project drifted from the canonical release topology",
  );
  return [...args, "--project", projectId];
}

export function productionPointerPushArguments(commit, expectedProductionCommit) {
  return productionPointerPushArgumentsForAuthority(commit, expectedProductionCommit);
}

export function productionReceiptPathForLease(commit, promotionLockToken, root = repoRoot) {
  assertFullCommit(commit);
  assertFullCommit(promotionLockToken, "production promotion lock token");
  return path.resolve(
    root,
    "target",
    "releases",
    "production",
    `${commit}.${promotionLockToken}.json`,
  );
}

export async function finalizeProductionPointer({
  commit,
  expectedProductionCommit,
  pointerAlreadyAdvanced = false,
  revalidate,
  revalidateEvidence = async () => {},
  assertLease = async () => {},
  refreshProductionPointer,
  pushPointer,
}) {
  await revalidateEvidence();
  await revalidate();
  const currentProductionCommit = await refreshProductionPointer();
  assert.equal(
    currentProductionCommit,
    pointerAlreadyAdvanced ? commit : expectedProductionCommit,
    pointerAlreadyAdvanced
      ? "production pointer no longer identifies the resumed release"
      : "production pointer moved after promotion preflight",
  );
  await assertLease();
  if (!pointerAlreadyAdvanced) {
    await pushPointer(productionPointerPushArguments(commit, expectedProductionCommit));
  }
}

export async function withProductionPromotionLock({ acquire, release }, action) {
  const token = await acquire();
  let result;
  try {
    result = await action(token);
  } catch (error) {
    throw retainedPromotionLeaseError(error, token);
  }
  try {
    await release(token);
  } catch (error) {
    throw retainedPromotionLeaseError(error, token);
  }
  return result;
}

function retainedPromotionLeaseError(error, token) {
  const retained = new Error(
    `${error?.message ?? error}; production promotion lease ${token} remains held; ` +
      `resume only with --resume-lock ${token}`,
    { cause: error },
  );
  retained.code = error?.code;
  retained.promotionLockToken = token;
  return retained;
}

export function reconcilePromotionLockMutation({ operation, token, mutate, inspect }) {
  assert.ok(["acquire", "release"].includes(operation), "unknown promotion lock mutation");
  let mutationError = null;
  try {
    mutate();
  } catch (error) {
    mutationError = error;
  }
  const observed = inspect();
  const expected = operation === "acquire" ? token : null;
  if (observed === expected) return expected;
  if (mutationError) throw mutationError;
  assert.equal(
    observed,
    expected,
    `production promotion lock ${operation} did not reach its exact state`,
  );
  return expected;
}

function remotePromotionLock() {
  assertCanonicalReleaseRemote();
  const output = text("git", [
    "ls-remote",
    "--refs",
    CANONICAL_RELEASE_REMOTE_URL,
    PRODUCTION_PROMOTION_LOCK_REF,
  ]);
  if (!output) return null;
  const [commit, ref, ...extra] = output.split(/\s+/u);
  assert.equal(ref, PRODUCTION_PROMOTION_LOCK_REF, "production promotion lock ref drifted");
  assert.equal(extra.length, 0, "production promotion lock returned ambiguous state");
  assert.match(commit, /^[0-9a-f]{40}$/u, "production promotion lock token is invalid");
  return commit;
}

function acquireProductionPromotionLock({
  commit,
  expectedProductionCommit,
  fleetProof,
  stagingReceipt,
}) {
  assertCanonicalReleaseRemote();
  const existing = remotePromotionLock();
  assert.equal(
    existing,
    null,
    `production promotion is already locked by ${existing}; recover that exact operation before retrying`,
  );
  const identity = `fmarch-production-promotion-${randomUUID()}`;
  const message = JSON.stringify(createProductionPromotionLockIntent({
    identity,
    releaseCommit: commit,
    expectedProductionCommit,
    fleetJobId: fleetProof.job_id,
    fleetReceiptSha256: fleetProof.receipt_sha256,
    stagingReceiptSha256: stagingReceipt.receipt_sha256,
    schemaEpochReset: stagingReceipt.schema_epoch_reset?.epoch ?? null,
  }));
  const tokenResult = spawnSync(
    "git",
    ["commit-tree", `${commit}^{tree}`, "-p", commit],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: `${message}\n`,
      timeout: SUBPROCESS_TIMEOUT_MS.git,
      env: {
        ...releaseGitEnvironment(),
        GIT_AUTHOR_NAME: "fmarch release coordinator",
        GIT_AUTHOR_EMAIL: "release@fmarch.invalid",
        GIT_COMMITTER_NAME: "fmarch release coordinator",
        GIT_COMMITTER_EMAIL: "release@fmarch.invalid",
      },
    },
  );
  assert.equal(tokenResult.status, 0, "could not create the production promotion lock token");
  const token = String(tokenResult.stdout).trim();
  assert.match(token, /^[0-9a-f]{40}$/u, "production promotion lock token is invalid");
  reconcilePromotionLockMutation({
    operation: "acquire",
    token,
    mutate: () => run(
      "git",
      [
        "push",
        `--force-with-lease=${PRODUCTION_PROMOTION_LOCK_REF}:`,
        CANONICAL_RELEASE_REMOTE_URL,
        `${token}:${PRODUCTION_PROMOTION_LOCK_REF}`,
      ],
      { stdio: "inherit" },
    ),
    inspect: remotePromotionLock,
  });
  return token;
}

function releaseProductionPromotionLock(token) {
  assertCanonicalReleaseRemote();
  reconcilePromotionLockMutation({
    operation: "release",
    token,
    mutate: () => run(
      "git",
      [
        "push",
        `--force-with-lease=${PRODUCTION_PROMOTION_LOCK_REF}:${token}`,
        CANONICAL_RELEASE_REMOTE_URL,
        `:${PRODUCTION_PROMOTION_LOCK_REF}`,
      ],
      { stdio: "inherit" },
    ),
    inspect: remotePromotionLock,
  });
}

function gitCommitIsAncestor(ancestor, descendant) {
  assertFullCommit(ancestor, "promotion lock prior production pointer");
  assertFullCommit(descendant, "promotion release commit");
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    cwd: repoRoot,
    env: releaseGitEnvironment(),
    timeout: SUBPROCESS_TIMEOUT_MS.git,
  });
  if (result.error) throw result.error;
  assert.ok(
    result.status === 0 || result.status === 1,
    "could not validate the promotion lock prior production pointer",
  );
  return result.status === 0;
}

export function resumeProductionPromotionLock(
  {
    token,
    commit,
    fleetProof,
    stagingReceipt,
  },
  {
    loadLease = readProductionPromotionLease,
    loadCurrentProductionCommit = refreshCanonicalProductionPointer,
    isAncestor = gitCommitIsAncestor,
  } = {},
) {
  assertFullCommit(token, "production promotion resume lock");
  assertFullCommit(commit, "promotion release commit");
  const leaseIntent = loadLease({ token, releaseCommit: commit });
  const currentProductionCommit = loadCurrentProductionCommit();
  assertFullCommit(currentProductionCommit, "current production pointer");
  const expectedProductionCommit = leaseIntent.expected_production_commit;
  validateProductionPromotionLeaseIntent(
    leaseIntent,
    promotionLeaseExpectation({
      token,
      commit,
      expectedProductionCommit,
      fleetProof,
      stagingReceipt,
    }),
  );
  assert.equal(
    isAncestor(expectedProductionCommit, commit),
    true,
    "promotion lock prior production pointer is not an ancestor of the release commit",
  );
  assert.ok(
    currentProductionCommit === expectedProductionCommit || currentProductionCommit === commit,
    "production pointer is neither the promotion lock prior pointer nor its release commit",
  );
  return {
    token,
    expectedProductionCommit,
    pointerAlreadyAdvanced: currentProductionCommit === commit,
  };
}

function refreshCanonicalProductionPointer() {
  assertCanonicalReleaseRemote();
  run("git", canonicalReleaseFetchArguments(["production"]));
  return text("git", ["rev-parse", "origin/production"]);
}

export function validateReusableProductionReceipt(
  receipt,
  { commit, stagingReceipt, fleetProof, releaseReadiness },
) {
  const validated = assertReleaseReceipt(receipt);
  assert.equal(validated.environment, "production", "only a production receipt can resume promotion");
  assert.equal(validated.commit, commit, "existing production receipt commit drifted");
  assert.equal(
    validated.images.runtime,
    stagingReceipt.images.runtime,
    "existing production runtime image drifted from staging",
  );
  assert.equal(
    validated.images.frontend,
    stagingReceipt.images.frontend,
    "existing production frontend image drifted from staging",
  );
  assert.deepEqual(
    validated.runtime_validation,
    stagingReceipt.runtime_validation,
    "existing production runtime validation drifted from staging",
  );
  assert.deepEqual(
    validated.fleet_proof,
    fleetProof,
    "existing production fleet proof drifted",
  );
  assert.deepEqual(
    validated.release_readiness,
    releaseReadiness,
    "existing production readiness drifted",
  );
  assert.equal(
    validated.schema_epoch_reset?.epoch ?? null,
    stagingReceipt.schema_epoch_reset?.epoch ?? null,
    "existing production schema epoch reset drifted from staging",
  );
  return validated;
}

function optionalReceipt(receiptPath) {
  try {
    return JSON.parse(readFileSync(receiptPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function revalidateCanonicalProduction(config, receipt) {
  const productionConfig = await railwayJson(config, [
    "environment",
    "config",
    "--environment",
    config.productionEnvironmentId,
    "--json",
  ]);
  validateCoordinatedServiceSources(productionConfig, config, receipt);
  await revalidateCanonicalProductionHostedVariables(config, { load: variables });
  await validateCoordinatedEnvironment(
    config,
    { id: config.productionEnvironmentId, name: config.productionEnvironment },
    receipt,
    {
      apiUrl: config.productionApiUrl,
      frontendUrl: config.productionFrontendUrl,
    },
  );
}

function promotionLeaseExpectation({
  token,
  commit,
  expectedProductionCommit,
  fleetProof,
  stagingReceipt,
}) {
  return {
    token,
    releaseCommit: commit,
    expectedProductionCommit,
    fleetJobId: fleetProof.job_id,
    fleetReceiptSha256: fleetProof.receipt_sha256,
    stagingReceiptSha256: stagingReceipt.receipt_sha256,
    schemaEpochReset: stagingReceipt.schema_epoch_reset?.epoch ?? null,
  };
}

export async function revalidatePromotionEvidence({
  stagingReceiptPath,
  stagingReceipt,
  productionReceipt,
  fleetReceiptPath,
  fleetPublicKeyPath,
  expectedFleetJob,
  commit,
}) {
  const currentStagingReceipt = assertFreshStagingReleaseReceipt(
    JSON.parse(readFileSync(stagingReceiptPath, "utf8")),
  );
  assert.equal(
    currentStagingReceipt.receipt_sha256,
    stagingReceipt.receipt_sha256,
    "staging receipt changed during production promotion",
  );
  const currentFleetProof = await loadFleetReleaseProof({
    repoRoot,
    commit,
    receiptPath: fleetReceiptPath,
    publicKeyPath: fleetPublicKeyPath,
    expectedJobId: expectedFleetJob,
  });
  assert.deepEqual(currentFleetProof, stagingReceipt.fleet_proof, "fleet proof changed during promotion");
  assertFreshReleaseEvidence(
    productionReceipt.attempt.created_at,
    "production release intent time",
  );
  assertFreshReleaseEvidence(
    productionReceipt.generated_at,
    "production release generation time",
  );
}

async function finalizeCanonicalProductionPointer(
  config,
  receipt,
  commit,
  expectedProductionCommit,
  authority,
  pointerAlreadyAdvanced = false,
) {
  await finalizeProductionPointer({
    commit,
    expectedProductionCommit,
    pointerAlreadyAdvanced,
    revalidate: () => revalidateCanonicalProduction(config, receipt),
    refreshProductionPointer: refreshCanonicalProductionPointer,
    revalidateEvidence: () => revalidatePromotionEvidence({
      ...authority,
      productionReceipt: receipt,
      commit,
    }),
    assertLease: () => assertProductionPromotionLease(
      promotionLeaseExpectation({
        token: authority.promotionLockToken,
        commit,
        expectedProductionCommit,
        fleetProof: authority.fleetProof,
        stagingReceipt: authority.stagingReceipt,
      }),
    ),
    pushPointer: (arguments_) => run("git", ["push", ...arguments_], { stdio: "inherit" }),
  });
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const { checkOnly } = args;
  const config = runtimeConfig();
  validateSecretCustodyPolicy(secretCustodyPolicy());

  assertCanonicalReleaseRemote();
  run("git", canonicalReleaseFetchArguments(["main", "production"]));
  const head = text("git", ["rev-parse", "HEAD"]);
  const originProduction = text("git", ["rev-parse", "origin/production"]);
  const originMain = text("git", ["rev-parse", "origin/main"]);
  const stagingReceiptPath = path.resolve(
    process.env.FMARCH_STAGING_RELEASE_RECEIPT ??
      path.join(
        repoRoot,
        "target",
        "releases",
        "staging",
        `${head}.json`,
      ),
  );
  const stagingReceipt = assertFreshStagingReleaseReceipt(
    JSON.parse(readFileSync(stagingReceiptPath, "utf8")),
  );
  assert.equal(stagingReceipt.environment, "staging");
  assert.equal(stagingReceipt.commit, head, "staging receipt does not match the promoted commit");
  const productionIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", "origin/production", head], {
      cwd: repoRoot,
      env: releaseGitEnvironment(),
      timeout: SUBPROCESS_TIMEOUT_MS.git,
    }).status === 0;
  validateRepositoryState({
    status: text("git", ["status", "--porcelain"]),
    branch: text("git", ["branch", "--show-current"]),
    head,
    originMain,
    productionIsAncestor,
    resumeLock: args.resumeLock,
    headIsAncestorOfOriginMain: args.resumeLock
      ? gitCommitIsAncestor(head, originMain)
      : false,
  });
  const fleetReceiptPath = args.fleetReceipt ?? process.env.FMARCH_FLEET_RECEIPT;
  const fleetPublicKeyPath =
    args.fleetPublicKey ??
    process.env.FMARCH_FLEET_PUBLIC_KEY ??
    defaultFleetPublicKeyPath();
  const expectedFleetJob = args.fleetJob ?? process.env.FMARCH_FLEET_JOB_ID;
  assert.ok(expectedFleetJob, "production promotion requires --fleet-job or FMARCH_FLEET_JOB_ID");
  const fleetProof = await loadFleetReleaseProof({
    repoRoot,
    commit: head,
    receiptPath: fleetReceiptPath,
    publicKeyPath: fleetPublicKeyPath,
    expectedJobId: expectedFleetJob,
  });
  assert.deepEqual(
    stagingReceipt.fleet_proof,
    fleetProof,
    "production must reuse the exact signed fleet proof bound by staging",
  );
  const completionRegistry = await loadCompletionRegistry();
  await validateRegistry(completionRegistry);
  const releaseReadiness = validateProductionReleaseReadiness(completionRegistry);

  const productionConfig = await railwayJson(
    config,
    [
      "environment",
      "config",
      "--environment",
      config.productionEnvironmentId,
      "--json",
    ],
  );
  validateProductionSourceCutover(productionConfig, config);
  if (!args.resumeLock) {
    const stagingConfig = await railwayJson(
      config,
      ["environment", "config", "--environment", config.stagingEnvironmentId, "--json"],
    );
    validateCoordinatedServiceSources(stagingConfig, config, stagingReceipt);
  }

  const { stagingApi, productionApi } = await revalidatePromotionHostedVariables(
    config,
    { resumeLock: args.resumeLock },
    { load: variables },
  );
  const oidcPreflights = [
    preflightWorkosOidc({
      label: "production",
      clientId: productionApi.WORKOS_CLIENT_ID,
      issuer: productionApi.WORKOS_ISSUER,
      jwksUrl: productionApi.WORKOS_JWKS_URL,
    }),
  ];
  if (!args.resumeLock) {
    oidcPreflights.push(preflightWorkosOidc({
      label: "staging",
      clientId: stagingApi.WORKOS_CLIENT_ID,
      issuer: stagingApi.WORKOS_ISSUER,
      jwksUrl: stagingApi.WORKOS_JWKS_URL,
    }));
  }
  await Promise.all(oidcPreflights);

  if (!args.resumeLock) {
    await validateCoordinatedEnvironment(
      config,
      { id: config.stagingEnvironmentId, name: config.stagingEnvironment },
      stagingReceipt,
      {
        apiUrl: config.stagingApiUrl,
        frontendUrl: config.stagingFrontendUrl,
      },
    );
  }

  if (checkOnly) {
    console.log(`production promotion check passed for ${head}`);
    return;
  }

  let promotionSession;
  await withProductionPromotionLock(
    {
      acquire: () => {
        if (args.resumeLock) {
          promotionSession = resumeProductionPromotionLock({
            token: args.resumeLock,
            commit: head,
            fleetProof,
            stagingReceipt,
          });
          return promotionSession.token;
        }
        const currentProductionCommit = refreshCanonicalProductionPointer();
        assert.equal(
          gitCommitIsAncestor(currentProductionCommit, head),
          true,
          "current production pointer is not an ancestor of the release commit",
        );
        const token = acquireProductionPromotionLock({
          commit: head,
          expectedProductionCommit: currentProductionCommit,
          fleetProof,
          stagingReceipt,
        });
        promotionSession = {
          token,
          expectedProductionCommit: currentProductionCommit,
          pointerAlreadyAdvanced: false,
        };
        return token;
      },
      release: (token) => releaseProductionPromotionLock(token),
    },
    async (promotionLockToken) => {
      assert.equal(promotionSession.token, promotionLockToken);
      const { expectedProductionCommit, pointerAlreadyAdvanced } = promotionSession;
      const promotionAuthority = {
        promotionLockToken,
        stagingReceiptPath,
        stagingReceipt,
        fleetProof,
        fleetReceiptPath,
        fleetPublicKeyPath,
        expectedFleetJob,
      };
      assertProductionPromotionLease(promotionLeaseExpectation({
        token: promotionLockToken,
        commit: head,
        expectedProductionCommit,
        fleetProof,
        stagingReceipt,
      }));
      const productionReceiptPath = productionReceiptPathForLease(
        head,
        promotionLockToken,
      );
      const existingProductionReceipt = optionalReceipt(productionReceiptPath);
      if (existingProductionReceipt) {
        const reusable = validateReusableProductionReceipt(existingProductionReceipt, {
          commit: head,
          stagingReceipt,
          fleetProof,
          releaseReadiness,
        });
        assert.equal(
          reusable.attempt.promotion_lease_commit,
          promotionLockToken,
          "existing production receipt was authorized by a different promotion lease",
        );
        await finalizeCanonicalProductionPointer(
          config,
          reusable,
          head,
          expectedProductionCommit,
          promotionAuthority,
          pointerAlreadyAdvanced,
        );
        console.log(`production promotion resumed from durable receipt for ${head}`);
        return;
      }

      assert.equal(
        pointerAlreadyAdvanced,
        false,
        "advanced production pointer has no exact lease-scoped receipt; retaining the lease",
      );

      const coordinatorArguments = [
        "tools/release_coordinator.mjs",
        "--environment",
        "production",
        "--commit",
        head,
        "--reuse-staging-receipt",
        stagingReceiptPath,
        "--fleet-receipt",
        fleetReceiptPath,
        "--fleet-public-key",
        fleetPublicKeyPath,
        "--fleet-job",
        expectedFleetJob,
        "--production-lock",
        promotionLockToken,
        "--output",
        productionReceiptPath,
      ];
      if (stagingReceipt.schema_epoch_reset) {
        coordinatorArguments.push(
          "--schema-epoch-reset",
          String(stagingReceipt.schema_epoch_reset.epoch),
        );
      }
      run(process.execPath, coordinatorArguments, {
        env: scrubPrivilegedDatabaseEnvironment(process.env),
        stdio: "inherit",
      });
      const productionReceipt = validateReusableProductionReceipt(
        JSON.parse(readFileSync(productionReceiptPath, "utf8")),
        { commit: head, stagingReceipt, fleetProof, releaseReadiness },
      );
      assert.equal(
        productionReceipt.attempt.promotion_lease_commit,
        promotionLockToken,
        "production receipt was not authorized by the held promotion lease",
      );
      await finalizeCanonicalProductionPointer(
        config,
        productionReceipt,
        head,
        expectedProductionCommit,
        promotionAuthority,
      );
      console.log(`production promotion completed for ${head}`);
    },
  );
}

export function runtimeConfig(env = process.env) {
  const legacyOverrides = {
    FMARCH_RAILWAY_PROJECT_ID: DEFAULTS.projectId,
    FMARCH_RAILWAY_MIGRATOR_SERVICE_ID: DEFAULTS.migratorServiceId,
    FMARCH_RAILWAY_API_SERVICE_ID: DEFAULTS.apiServiceId,
    FMARCH_RAILWAY_FRONTEND_SERVICE_ID: DEFAULTS.frontendServiceId,
    FMARCH_RAILWAY_STAGING_ENVIRONMENT: DEFAULTS.stagingEnvironment,
    FMARCH_RAILWAY_STAGING_ENVIRONMENT_ID: DEFAULTS.stagingEnvironmentId,
    FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT: DEFAULTS.productionEnvironment,
    FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT_ID: DEFAULTS.productionEnvironmentId,
    FMARCH_STAGING_API_URL: DEFAULTS.stagingApiUrl,
    FMARCH_STAGING_FRONTEND_URL: DEFAULTS.stagingFrontendUrl,
    FMARCH_PRODUCTION_API_URL: DEFAULTS.productionApiUrl,
    FMARCH_PRODUCTION_FRONTEND_URL: DEFAULTS.productionFrontendUrl,
  };
  for (const [key, expected] of Object.entries(legacyOverrides)) {
    if (env[key] !== undefined) {
      assert.equal(env[key], expected, `${key} cannot override the canonical release topology`);
    }
  }
  return { ...DEFAULTS };
}

async function validateCoordinatedEnvironment(config, environment, receipt, urls) {
  const { id: environmentId, name: environmentName } = environment;
  const [migratorDeployment, apiDeployment, frontendDeployment, apiDomains, frontendDomains] =
    await Promise.all([
      latestDeployment(config, environmentId, config.migratorServiceId),
      latestDeployment(config, environmentId, config.apiServiceId),
      latestDeployment(config, environmentId, config.frontendServiceId),
      domains(config, environmentId, config.apiServiceId),
      domains(config, environmentId, config.frontendServiceId),
    ]);
  validateDeploymentArtifact(migratorDeployment, receipt.images.runtime, `${environmentName} migrator`);
  validateDeploymentArtifact(apiDeployment, receipt.images.runtime, `${environmentName} API`);
  validateDeploymentArtifact(frontendDeployment, receipt.images.frontend, `${environmentName} frontend`);
  assert.equal(
    migratorDeployment.id,
    receipt.deployments.migrator,
    `${environmentName} migrator receipt is stale`,
  );
  assert.equal(apiDeployment.id, receipt.deployments.api, `${environmentName} API receipt is stale`);
  assert.equal(
    frontendDeployment.id,
    receipt.deployments.frontend,
    `${environmentName} frontend receipt is stale`,
  );
  validateDomainList(apiDomains, new URL(urls.apiUrl).host, `${environmentName} API`);
  validateDomainList(frontendDomains, new URL(urls.frontendUrl).host, `${environmentName} frontend`);
  const [apiBody, frontendBody] = await Promise.all([
    health(`${urls.apiUrl}/readyz`, () => true, `${environmentName} API`),
    health(`${urls.frontendUrl}/healthz`, () => true, `${environmentName} frontend`),
  ]);
  validateHealth(apiBody, receipt.commit, "api", receipt.topology);
  validateHealth(frontendBody, receipt.commit, "frontend");
}

async function validateEnvironment(config, environment, commit, urls) {
  const [
    migratorDeployment,
    apiDeployment,
    frontendDeployment,
    apiDomains,
    frontendDomains,
  ] = await Promise.all([
    latestDeployment(config, environment, config.migratorServiceId),
    latestDeployment(config, environment, config.apiServiceId),
    latestDeployment(config, environment, config.frontendServiceId),
    domains(config, environment, config.apiServiceId),
    domains(config, environment, config.frontendServiceId),
  ]);
  validateDeployment(migratorDeployment, commit, `${environment} migrator`);
  validateDeployment(apiDeployment, commit, `${environment} API`);
  validateDeployment(frontendDeployment, commit, `${environment} frontend`);
  validateDomainList(apiDomains, new URL(urls.apiUrl).host, `${environment} API`);
  validateDomainList(frontendDomains, new URL(urls.frontendUrl).host, `${environment} frontend`);
  await Promise.all([
    health(
      `${urls.apiUrl}/readyz`,
      (body) =>
        body.ok === true &&
        body.database_schema === true &&
        body.object_storage === true &&
        body.subject_authority === true,
      `${environment} API`,
    ),
    health(
      `${urls.frontendUrl}/healthz`,
      (body) => body.status === "ok",
      `${environment} frontend`,
    ),
  ]);
}

async function waitForProduction(config, commit) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const services = [
    [config.migratorServiceId, "production migrator"],
    [config.apiServiceId, "production API"],
    [config.frontendServiceId, "production frontend"],
  ];
  const completed = new Set();

  while (Date.now() < deadline && completed.size !== services.length) {
    for (const [serviceId, label] of services) {
      if (completed.has(serviceId)) continue;
      const deployment = await latestDeployment(
        config,
        config.productionEnvironment,
        serviceId,
      );
      if (deployment?.meta?.commitHash !== commit) continue;
      if (!terminalDeploymentStates.has(deployment.status)) continue;
      validateDeployment(deployment, commit, label);
      completed.add(serviceId);
    }
    if (completed.size !== services.length) await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  assert.equal(completed.size, services.length, "production deployments did not finish in 15 minutes");
}

async function health(url, predicate, label) {
  const expected = new URL(url);
  const response = await fetch(expected, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.ok, true, `${label} health returned ${response.status}`);
  assert.equal(response.url, expected.href, `${label} health response URL drifted`);
  assert.equal(new URL(response.url).origin, expected.origin, `${label} health origin drifted`);
  const body = await response.json();
  assert.equal(predicate(body), true, `${label} health payload was not ready`);
  return body;
}

async function variables(config, environment, service) {
  return await railwayJson(config, [
    "variable",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--json",
  ]);
}

async function domains(config, environment, service) {
  return await railwayJson(config, [
    "domain",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--json",
  ]);
}

async function latestDeployment(config, environment, service) {
  const deployments = await railwayJson(config, [
    "deployment",
    "list",
    "--environment",
    environment,
    "--service",
    service,
    "--limit",
    "1",
    "--json",
  ]);
  return deployments[0];
}

async function railwayJson(config, args) {
  const output = execFileSync("railway", railwayArguments(config.projectId, args), {
    cwd: repoRoot,
    encoding: "utf8",
    env: scrubPrivilegedDatabaseEnvironment(process.env),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: SUBPROCESS_TIMEOUT_MS.railway,
  });
  return JSON.parse(output);
}

function text(command, args) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: path.basename(command) === "git" ? releaseGitEnvironment() : process.env,
    encoding: "utf8",
    timeout: SUBPROCESS_TIMEOUT_MS[command] ?? 2 * 60 * 1_000,
  }).trim();
}

function run(command, args, options = {}) {
  const timeout = options.timeout ?? SUBPROCESS_TIMEOUT_MS[path.basename(command)] ?? 2 * 60 * 1_000;
  const baseEnvironment = options.env ?? process.env;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    ...options,
    env: path.basename(command) === "git" ? releaseGitEnvironment(baseEnvironment) : baseEnvironment,
    encoding: "utf8",
    timeout,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed${result.error?.code === "ETIMEDOUT" ? ` after ${timeout}ms` : ""}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`production promotion blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
