import {runHostedAcceptance} from './hosted_acceptance.mjs';
import {prepareAuthenticatedAcceptance} from './hosted_authenticated_acceptance.mjs';
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadCompletionRegistry, validateRegistry } from "./completeness_scorecard.mjs";
import { defaultFleetPublicKeyPath, loadFleetReleaseProof } from "./fleet_release_proof.mjs";
import { publishImmutableJson } from "./immutable_json_receipt.mjs";
import { revalidateCanonicalProductionHostedVariables } from "./release_hosted_variable_authority.mjs";
import {
  TERMINAL_DEPLOYMENT_STATES,
  CANONICAL_RELEASE_TOPOLOGY,
  DATABASE_ONE_SHOT_PLATFORM_WAIT_TIMEOUT_MS,
  DATABASE_ONE_SHOT_TIMEOUT_VARIABLES,
  RELEASE_CLOCK_SKEW_MS,
  RELEASE_EVIDENCE_MAX_AGE_MS,
  assertFullCommit,
  assertImageDigest,
  assertReleaseReceipt,
  assertRuntimeValidationAttestation,
  assertFreshStagingReleaseReceipt,
  assertFreshReleaseEvidence,
  bindReleaseAttempt,
  buildReleaseReceipt,
  canonicalReleaseTopology,
  deploymentImageDigest,
  receiptDigest,
  validateDeploymentArtifact,
  validateHealth,
  validateProductionReleaseReadiness,
  validateReleaseRepository,
} from "./release_coordinator_contract.mjs";
import { validateRuntimeImage } from "./exact_image_content_smoke.mjs";
import {
  assertCanonicalReleaseRemote,
  assertProductionPromotionLease,
  assertStagingReleaseMutationLease,
  acquireStagingReleaseMutationLease,
  canonicalReleaseFetchArguments,
  createStagingReleaseMutationLeaseIntent,
  releaseStagingReleaseMutationLease,
  releaseGitEnvironment,
  resumeStagingReleaseMutationLease,
  withStagingReleaseMutationLease,
} from "./release_git_authority.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const callerSession = `fmarch-release-${process.pid}`;
const SUBPROCESS_TIMEOUT_MS = Object.freeze({
  git: 2 * 60 * 1_000,
  railway: 5 * 60 * 1_000,
  podman: 45 * 60 * 1_000,
  node: 5 * 60 * 1_000,
});
export const PRODUCTION_MUTATION_FRESHNESS_RESERVE_MS = 60 * 60 * 1_000 + RELEASE_CLOCK_SKEW_MS;
export const ONE_SHOT_RAILWAY_WAIT_TIMEOUT_MS = DATABASE_ONE_SHOT_PLATFORM_WAIT_TIMEOUT_MS;
const ONE_SHOT_HISTORY_LIMIT = 50;
const ONE_SHOT_HISTORY_RECOVERY_TIMEOUT_MS = 60_000;
const MAX_ONE_SHOT_GENERATIONS = 2;
const productionMutationsStarted = new WeakSet();

export function parseArguments(argv) {
  const result = { environment: "staging", check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment") result.environment = requiredValue(argv, ++index, argument);
    else if (argument === "--commit") result.commit = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-receipt") result.fleetReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-public-key") result.fleetPublicKey = requiredValue(argv, ++index, argument);
    else if (argument === "--fleet-job") result.fleetJob = requiredValue(argv, ++index, argument);
    else if (argument === "--reuse-staging-receipt") result.reuseStagingReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--production-lock") result.productionLock = requiredValue(argv, ++index, argument);
    else if (argument === "--resume-lease") result.resumeLease = requiredValue(argv, ++index, argument);
    else if (argument === "--schema-epoch-reset") result.schemaEpochReset = Number.parseInt(requiredValue(argv, ++index, argument), 10);
    else if (argument === "--output") result.output = requiredValue(argv, ++index, argument);
    else if (argument === "--check") result.check = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`unknown release coordinator argument: ${argument}`);
  }
  assert.ok(["staging", "production"].includes(result.environment), "--environment must be staging or production");
  assert.equal(
    result.environment === "production" && result.resumeLease !== undefined,
    false,
    "--resume-lease is staging-only",
  );
  assert.equal(
    result.environment === "staging" && result.output !== undefined && !result.check,
    false,
    "--output is production-only for mutating releases; staging receipts use the canonical lease-scoped path",
  );
  if (result.schemaEpochReset !== undefined) {
    assert.ok(Number.isSafeInteger(result.schemaEpochReset) && result.schemaEpochReset > 0, "--schema-epoch-reset must be a positive epoch");
  }
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

export function runtimeConfig(environment, env = process.env) {
  const topology = canonicalReleaseTopology(environment);
  const imageRepositories = CANONICAL_RELEASE_TOPOLOGY.images;
  const legacyOverrides = {
    FMARCH_RAILWAY_PROJECT_ID: topology.project_id,
    FMARCH_RAILWAY_STAGING_ENVIRONMENT_ID:
      CANONICAL_RELEASE_TOPOLOGY.environments.staging.id,
    FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT_ID:
      CANONICAL_RELEASE_TOPOLOGY.environments.production.id,
    FMARCH_RAILWAY_API_SERVICE_ID: topology.services.api,
    FMARCH_RAILWAY_MIGRATOR_SERVICE_ID: topology.services.migrator,
    FMARCH_RAILWAY_FRONTEND_SERVICE_ID: topology.services.frontend,
    FMARCH_RUNTIME_IMAGE: imageRepositories.runtime,
    FMARCH_FRONTEND_IMAGE: imageRepositories.frontend,
    FMARCH_STAGING_API_URL: CANONICAL_RELEASE_TOPOLOGY.environments.staging.origins.api,
    FMARCH_STAGING_FRONTEND_URL:
      CANONICAL_RELEASE_TOPOLOGY.environments.staging.origins.frontend,
    FMARCH_PRODUCTION_API_URL:
      CANONICAL_RELEASE_TOPOLOGY.environments.production.origins.api,
    FMARCH_PRODUCTION_FRONTEND_URL:
      CANONICAL_RELEASE_TOPOLOGY.environments.production.origins.frontend,
  };
  for (const [key, expected] of Object.entries(legacyOverrides)) {
    if (env[key] !== undefined) {
      assert.equal(env[key], expected, `${key} cannot override the canonical release topology`);
    }
  }
  return {
    topology,
    projectId: topology.project_id,
    environmentId: topology.environment.id,
    environment,
    apiServiceId: topology.services.api,
    migratorServiceId: topology.services.migrator,
    frontendServiceId: topology.services.frontend,
    runtimeImage: imageRepositories.runtime,
    frontendImage: imageRepositories.frontend,
    apiUrl: topology.origins.api,
    frontendUrl: topology.origins.frontend,
  };
}

export function stagingCoordinatorMutationLeaseBindings({ fleetProof, schemaEpochReset = null }) {
  assert.ok(fleetProof && typeof fleetProof === "object", "staging lease requires fleet proof");
  return {
    fleet_job_id: fleetProof.job_id,
    fleet_receipt_sha256: fleetProof.receipt_sha256,
    schema_epoch_reset: schemaEpochReset,
  };
}

function commandText(command, args, options = {}) {
  const baseEnvironment = options.env ?? process.env;
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: path.basename(command) === "git" ? releaseGitEnvironment(baseEnvironment) : baseEnvironment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? SUBPROCESS_TIMEOUT_MS[path.basename(command)] ?? 2 * 60 * 1_000,
  }).trim();
}

function run(command, args, options = {}) {
  const baseEnvironment = options.env ?? process.env;
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: path.basename(command) === "git" ? releaseGitEnvironment(baseEnvironment) : baseEnvironment,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    maxBuffer: 32 * 1024 * 1024,
    timeout: options.timeout ?? SUBPROCESS_TIMEOUT_MS[path.basename(command)] ?? 2 * 60 * 1_000,
  });
  if (result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || "").trim().slice(-4_000);
    const timedOut = result.error?.code === "ETIMEDOUT";
    throw new Error(`${path.basename(command)} ${args[0] ?? ""} failed${timedOut ? " after its bounded timeout" : ""}${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  return String(result.stdout ?? "").trim();
}

function scrubHostedEnvironment(env) {
  const scrubbed = { ...env };
  for (const key of Object.keys(scrubbed)) {
    if (
      key.startsWith("PG") ||
      key.includes("PASSWORD") ||
      key.includes("DATABASE_URL") ||
      key.includes("PRIVATE_KEY")
    ) delete scrubbed[key];
  }
  return {
    ...scrubbed,
    RAILWAY_CALLER: "skill:use-railway@1.4.0",
    RAILWAY_AGENT_SESSION: callerSession,
  };
}

function validateRepository(commit, environment) {
  assertCanonicalReleaseRemote();
  run("git", canonicalReleaseFetchArguments(["main", "production"]));
  const head = commandText("git", ["rev-parse", "HEAD"]);
  const originMain = commandText("git", ["rev-parse", "origin/main"]);
  const originProduction = commandText("git", ["rev-parse", "origin/production"]);
  validateReleaseRepository({
    status: commandText("git", ["status", "--porcelain"]),
    branch: commandText("git", ["branch", "--show-current"]),
    commit,
    head,
    originMain,
    originProduction,
    productionIsAncestor:
      spawnSync("git", ["merge-base", "--is-ancestor", originProduction, commit], {
        cwd: repoRoot,
        env: releaseGitEnvironment(),
        timeout: SUBPROCESS_TIMEOUT_MS.git,
      }).status === 0,
    pushed: spawnSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"], {
      cwd: repoRoot,
      env: releaseGitEnvironment(),
      timeout: SUBPROCESS_TIMEOUT_MS.git,
    }).status === 0,
    environment,
  });
  return { originMain, originProduction };
}

function inspectLocalImage(reference) {
  const raw = commandText("podman", ["image", "inspect", reference, "--format", "json"]);
  const parsed = JSON.parse(raw);
  const image = Array.isArray(parsed) ? parsed[0] : parsed;
  return {
    digest: image.Digest ?? image.Digest,
    revision: image.Config?.Labels?.["org.opencontainers.image.revision"] ?? null,
  };
}

async function verifyPublishedImage(repository, digest, commit, operations = {}) {
  assertImageDigest(digest, `${repository} digest`);
  const immutableReference = `${repository}@${digest}`;
  const pull = operations.pull ?? ((reference) => run(
    "podman",
    ["pull", "--platform", "linux/amd64", reference],
  ));
  const inspect = operations.inspect ?? inspectLocalImage;
  await pull(immutableReference);
  const image = await inspect(immutableReference);
  assert.equal(image.revision, commit, `${immutableReference} revision label does not match`);
  assert.equal(image.digest, digest, `${immutableReference} resolved to an unexpected digest`);
  return immutableReference;
}

export async function publishFreshImage(
  { repository, dockerfile, commit, attemptIdentity, contextPath },
  operations = {},
) {
  assertFullCommit(commit);
  assert.match(attemptIdentity ?? "", /^[0-9a-f]{24}$/u, "image attempt identity is invalid");
  assert.equal(path.isAbsolute(contextPath), true, "image build context must be an absolute snapshot");
  const tag = `${repository}:release-${commit}-${attemptIdentity}`;
  const build = operations.build ?? ((reference) => run("podman", [
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `FMARCH_RELEASE_COMMIT=${commit}`,
    "--file",
    path.join(contextPath, dockerfile),
    "--tag",
    reference,
    contextPath,
  ]));
  const push = operations.push ?? (async (reference) => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), "fmarch-image-push-"));
    try {
      const digestFile = path.join(temporary, "digest");
      run("podman", ["push", "--digestfile", digestFile, reference]);
      return (await readFile(digestFile, "utf8")).trim();
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
  const pull = operations.pull ?? ((reference) => run(
    "podman",
    ["pull", "--platform", "linux/amd64", reference],
  ));
  const inspect = operations.inspect ?? inspectLocalImage;

  await build(tag);
  const digest = assertImageDigest(await push(tag), `${repository} pushed digest`);
  await verifyPublishedImage(repository, digest, commit, { pull, inspect });
  return digest;
}

function releaseAttemptPath(
  environment,
  commit,
  promotionLeaseCommit = null,
  stagingMutationLeaseCommit = null,
) {
  const leaseCommit = environment === "production"
    ? assertFullCommit(promotionLeaseCommit, "production promotion lock token")
    : assertFullCommit(stagingMutationLeaseCommit, "staging release mutation lease token");
  return path.join(
    repoRoot,
    "target",
    "releases",
    environment,
    `${commit}.${leaseCommit}.attempt.json`,
  );
}

async function optionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function withImmutableReleaseBuildContext(commit, action) {
  assertFullCommit(commit);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "fmarch-release-context-"));
  const archivePath = path.join(temporary, "source.tar");
  const contextPath = path.join(temporary, "context");
  try {
    await mkdir(contextPath);
    run("git", ["archive", "--format=tar", "--output", archivePath, commit]);
    run("tar", ["-xf", archivePath, "-C", contextPath], { timeout: 5 * 60 * 1_000 });
    return await action(contextPath);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function resolveArtifacts(
  args,
  config,
  commit,
  fleetProof,
  { reusableStagingReceipt = null } = {},
) {
  if (args.reuseStagingReceipt) {
    assert.equal(args.environment, "production", "only production may reuse a staging receipt");
    const receipt = assertFreshStagingReleaseReceipt(
      reusableStagingReceipt ??
        JSON.parse(await readFile(path.resolve(args.reuseStagingReceipt), "utf8")),
    );
    assert.equal(receipt.environment, "staging", "production can reuse only a staging receipt");
    assert.equal(receipt.commit, commit, "staging receipt commit does not match production release");
    assert.deepEqual(
      receipt.fleet_proof,
      fleetProof,
      "production must reuse the exact signed fleet proof bound by staging",
    );
    return {
      runtimeDigest: receipt.images.runtime,
      frontendDigest: receipt.images.frontend,
      runtimeValidation: assertRuntimeValidationAttestation(
        receipt.runtime_validation,
        receipt.images.runtime,
      ),
      stagingReceipt: receipt,
    };
  }
  assert.equal(args.environment, "staging", "production must reuse exact staging image digests");
  const priorAttempt = await optionalJson(
    releaseAttemptPath("staging", commit, null, config.stagingMutationLease?.token),
  );
  if (priorAttempt) {
    const attempt = bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest: priorAttempt.images?.runtime,
      frontendDigest: priorAttempt.images?.frontend,
      fleetProof,
      topology: config.topology,
      stagingMutationLeaseCommit: config.stagingMutationLease?.token,
      existing: priorAttempt,
    });
    assertFreshReleaseEvidence(attempt.created_at, "staging release intent time");
    await Promise.all([
      verifyPublishedImage(config.runtimeImage, attempt.images.runtime, commit),
      verifyPublishedImage(config.frontendImage, attempt.images.frontend, commit),
    ]);
    return {
      runtimeDigest: attempt.images.runtime,
      frontendDigest: attempt.images.frontend,
    };
  }
  const attemptIdentity = createHash("sha256")
    .update(`${fleetProof.job_id}:${fleetProof.receipt_sha256}:${randomUUID()}`)
    .digest("hex")
    .slice(0, 24);
  const [runtimeDigest, frontendDigest] = await withImmutableReleaseBuildContext(
    commit,
    async (contextPath) => Promise.all([
      publishFreshImage({
        repository: config.runtimeImage,
        dockerfile: "Dockerfile",
        commit,
        attemptIdentity,
        contextPath,
      }),
      publishFreshImage({
        repository: config.frontendImage,
        dockerfile: "Dockerfile.frontend",
        commit,
        attemptIdentity,
        contextPath,
      }),
    ]),
  );
  return { runtimeDigest, frontendDigest };
}

export function releaseRuntimeValidation({
  environment,
  runtimeRepository,
  runtimeDigest,
  reusedRuntimeValidation = null,
  validate = validateRuntimeImage,
}) {
  if (environment === "production") {
    assert.ok(reusedRuntimeValidation, "production requires the staging runtime attestation");
    return assertRuntimeValidationAttestation(reusedRuntimeValidation, runtimeDigest);
  }
  assert.equal(environment, "staging", "unsupported release environment");
  assert.equal(reusedRuntimeValidation, null, "staging must validate its runtime image directly");
  const attestation = validate({ reference: `${runtimeRepository}@${runtimeDigest}` });
  return assertRuntimeValidationAttestation(attestation, runtimeDigest);
}

async function bindAttempt(
  environment,
  commit,
  runtimeDigest,
  frontendDigest,
  fleetProof,
  topology,
  promotionLeaseCommit = null,
  stagingMutationLeaseCommit = null,
) {
  const attemptPath = path.join(
    releaseAttemptPath(
      environment,
      commit,
      promotionLeaseCommit,
      stagingMutationLeaseCommit,
    ),
  );
  let existing = null;
  try {
    existing = JSON.parse(await readFile(attemptPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const attempt = bindReleaseAttempt({
    environment,
    commit,
    runtimeDigest,
    frontendDigest,
    fleetProof,
    topology,
    promotionLeaseCommit,
    stagingMutationLeaseCommit,
    existing,
  });
  assertFreshReleaseEvidence(attempt.created_at, `${environment} release intent time`);
  if (!existing) {
    await publishImmutableJson(attemptPath, attempt);
  }
  return attempt;
}

function railwayJson(config, args) {
  const output = railwayText(config, args);
  return output ? JSON.parse(output) : null;
}

function railwayText(config, args) {
  return commandText("railway", [
    ...args,
    "--project",
    config.projectId,
    "--environment",
    config.environmentId,
    "--json",
  ], { env: scrubHostedEnvironment(process.env) });
}

export async function revalidateProductionHostedVariableAuthority(
  config,
  { load } = {},
) {
  return await revalidateCanonicalProductionHostedVariables(config, {
    load:
      load ??
      (async (_config, environmentId, serviceId) =>
        JSON.parse(
          commandText(
            "railway",
            [
              "variable",
              "list",
              "--project",
              config.projectId,
              "--environment",
              environmentId,
              "--service",
              serviceId,
              "--json",
            ],
            { env: scrubHostedEnvironment(process.env) },
          ),
        )),
  });
}

function railwayApi(query, variables) {
  const response = JSON.parse(commandText("railway", [
    "api",
    query,
    "--variables",
    JSON.stringify(variables),
    "--compact",
  ], { env: scrubHostedEnvironment(process.env) }));
  assert.equal(response.errors, undefined, "Railway GraphQL API returned errors");
  return response.data;
}

export function bindProductionMutationEvidence({
  promotionLeaseCommit,
  commit,
  stagingReceiptPath,
  stagingReceipt,
  fleetReceiptPath,
  fleetPublicKeyPath,
  expectedFleetJob,
  fleetProof,
  now = new Date(),
}) {
  assertFullCommit(promotionLeaseCommit, "production promotion lock token");
  assertFullCommit(commit);
  assert.ok(stagingReceiptPath, "production mutation authority requires a staging receipt path");
  assert.ok(fleetReceiptPath, "production mutation authority requires a fleet receipt path");
  assert.ok(fleetPublicKeyPath, "production mutation authority requires a fleet public key path");
  const receipt = assertFreshStagingReleaseReceipt(stagingReceipt, { now });
  assert.equal(receipt.commit, commit, "production mutation staging commit drifted");
  assert.deepEqual(
    receipt.fleet_proof,
    fleetProof,
    "production mutation fleet proof drifted from staging",
  );
  assert.equal(fleetProof.job_id, expectedFleetJob, "production mutation fleet job drifted");
  const base = {
    version: 1,
    kind: "fmarch-production-mutation-evidence",
    promotion_lease_commit: promotionLeaseCommit,
    commit,
    staging_receipt_path: path.resolve(stagingReceiptPath),
    staging_receipt_sha256: receipt.receipt_sha256,
    staging_generated_at: receipt.generated_at,
    staging_attempt_created_at: receipt.attempt.created_at,
    staging_fleet_completed_at: receipt.fleet_proof.completed_at,
    staging_hosted_acceptance_generated_at: receipt.hosted_acceptance.generatedAt,
    staging_topology: structuredClone(receipt.topology),
    staging_images: structuredClone(receipt.images),
    schema_epoch_reset: receipt.schema_epoch_reset?.epoch ?? null,
    fleet_receipt_path: path.resolve(fleetReceiptPath),
    fleet_public_key_path: path.resolve(fleetPublicKeyPath),
    fleet_job_id: fleetProof.job_id,
    fleet_receipt_sha256: fleetProof.receipt_sha256,
    fleet_completed_at: fleetProof.completed_at,
    fleet_trust_root_sha256: fleetProof.trust_root_sha256,
  };
  return { ...base, authority_sha256: receiptDigest(base) };
}

export async function assertProductionMutationAuthority(
  config,
  {
    readStagingReceipt = async (receiptPath) =>
      JSON.parse(await readFile(receiptPath, "utf8")),
    reloadFleetProof = loadFleetReleaseProof,
    revalidateHostedVariables = revalidateProductionHostedVariableAuthority,
    assertLease = assertProductionPromotionLease,
    now = () => new Date(),
    minimumFreshnessReserveMilliseconds = 0,
  } = {},
) {
  if (config.environment !== "production") return true;
  assert.ok(config.productionLease, "production Railway mutation requires a promotion lease");
  const authority = config.productionMutationEvidence;
  assert.equal(
    authority?.kind,
    "fmarch-production-mutation-evidence",
    "production Railway mutation requires fresh evidence authority",
  );
  const { authority_sha256: authoritySha256, ...authorityBase } = authority;
  assert.equal(
    authoritySha256,
    receiptDigest(authorityBase),
    "production mutation evidence authority was tampered with",
  );
  assert.ok(
    Number.isSafeInteger(minimumFreshnessReserveMilliseconds) &&
      minimumFreshnessReserveMilliseconds >= 0 &&
      minimumFreshnessReserveMilliseconds < RELEASE_EVIDENCE_MAX_AGE_MS,
    "production mutation freshness reserve is invalid",
  );
  await revalidateHostedVariables(config);
  const referenceTime = typeof now === "function" ? now() : now;
  const maxAgeMilliseconds =
    RELEASE_EVIDENCE_MAX_AGE_MS - minimumFreshnessReserveMilliseconds;
  const receipt = assertFreshStagingReleaseReceipt(
    await readStagingReceipt(authority.staging_receipt_path),
    { now: referenceTime, maxAgeMilliseconds },
  );
  assert.equal(receipt.commit, authority.commit, "production mutation staging commit changed");
  assert.equal(
    receipt.receipt_sha256,
    authority.staging_receipt_sha256,
    "production mutation staging receipt changed",
  );
  assert.equal(receipt.generated_at, authority.staging_generated_at);
  assert.equal(receipt.attempt.created_at, authority.staging_attempt_created_at);
  assert.equal(receipt.fleet_proof.completed_at, authority.staging_fleet_completed_at);
  assert.equal(
    receipt.hosted_acceptance.generatedAt,
    authority.staging_hosted_acceptance_generated_at,
  );
  assert.deepEqual(receipt.topology, authority.staging_topology);
  assert.deepEqual(receipt.images, authority.staging_images);
  assert.equal(receipt.schema_epoch_reset?.epoch ?? null, authority.schema_epoch_reset);

  const currentFleetProof = await reloadFleetProof({
    repoRoot,
    commit: authority.commit,
    receiptPath: authority.fleet_receipt_path,
    publicKeyPath: authority.fleet_public_key_path,
    expectedJobId: authority.fleet_job_id,
    now: referenceTime,
    maxAgeMilliseconds,
  });
  assert.deepEqual(
    currentFleetProof,
    receipt.fleet_proof,
    "production mutation signed fleet proof changed from staging",
  );
  assert.equal(currentFleetProof.receipt_sha256, authority.fleet_receipt_sha256);
  assert.equal(currentFleetProof.completed_at, authority.fleet_completed_at);
  assert.equal(currentFleetProof.trust_root_sha256, authority.fleet_trust_root_sha256);

  assert.equal(config.productionLease.token, authority.promotion_lease_commit);
  assert.equal(config.productionLease.releaseCommit, authority.commit);
  assert.equal(config.productionLease.fleetJobId, authority.fleet_job_id);
  assert.equal(config.productionLease.fleetReceiptSha256, authority.fleet_receipt_sha256);
  assert.equal(config.productionLease.stagingReceiptSha256, authority.staging_receipt_sha256);
  assert.equal(config.productionLease.schemaEpochReset, authority.schema_epoch_reset);
  await assertLease(config.productionLease);
  return true;
}

export async function withProductionMutationAuthority(
  config,
  mutation,
  verification = {},
) {
  assert.equal(typeof mutation, "function", "production mutation must be callable");
  const production = config.environment === "production";
  const minimumFreshnessReserveMilliseconds =
    production && !productionMutationsStarted.has(config)
      ? PRODUCTION_MUTATION_FRESHNESS_RESERVE_MS
      : 0;
  await assertProductionMutationAuthority(config, {
    ...verification,
    minimumFreshnessReserveMilliseconds,
  });
  const result = await mutation();
  if (production) productionMutationsStarted.add(config);
  return result;
}

export async function assertStagingMutationAuthority(
  config,
  { assertLease = assertStagingReleaseMutationLease } = {},
) {
  if (config.environment !== "staging") return true;
  assert.ok(
    config.stagingMutationLease,
    "staging Railway mutation requires the shared release mutation lease",
  );
  assert.equal(config.stagingMutationLease.operationKind, "release-coordinator");
  await assertLease(config.stagingMutationLease);
  return true;
}

export async function withReleaseMutationAuthority(config, mutation, verification = {}) {
  assert.equal(typeof mutation, "function", "release mutation must be callable");
  if (config.environment === "production") {
    return await withProductionMutationAuthority(config, mutation, verification);
  }
  await assertStagingMutationAuthority(config, verification);
  return await mutation();
}

export function serviceSourceCutoverAction(source, expectedImage = null) {
  if (source == null) return "connect";
  if (source?.repo === "fluffyrabbot/fmarch" && source.image == null) return "disconnect";
  if (source?.repo == null && typeof source?.image === "string") {
    return expectedImage == null || source.image === expectedImage ? "ready" : "update";
  }
  throw new Error("Railway service source is neither canonical Git nor an image source");
}

function railwayService(config, serviceId) {
  const services = railwayJson(config, ["service", "list"]);
  const service = services.find((candidate) => candidate.id === serviceId);
  assert.ok(service, `Railway service ${serviceId} does not exist in ${config.environment}`);
  return service;
}

async function detachGitSource(config, serviceId, imageReference) {
  let service = railwayService(config, serviceId);
  let action = serviceSourceCutoverAction(service.source, imageReference);
  if (action === "disconnect") {
    await withReleaseMutationAuthority(config, () =>
      railwayJson(config, ["service", "source", "disconnect", "--service", serviceId]),
    );
    service = railwayService(config, serviceId);
    assert.equal(service.source, null, `Railway service ${serviceId} retained its Git source`);
    action = "connect";
  }
  assert.ok(["connect", "ready", "update"].includes(action), `unsupported Railway source action ${action}`);
}

async function deployConfiguredImage(
  config,
  {
    serviceId,
    image,
    digest,
    startCommand,
    label,
    variables = null,
    deploymentPolicy = {},
    allowTerminalFailure = false,
  },
) {
  const deploymentId = await configureAndDispatchImage(config, {
    serviceId,
    image,
    digest,
    startCommand,
    label,
    variables,
    deploymentPolicy,
  });
  return await waitForDeployment(config, serviceId, deploymentId, digest, label, {
    allowTerminalFailure,
  });
}

async function configureAndDispatchImage(
  config,
  {
    serviceId,
    image,
    digest,
    startCommand,
    label,
    variables = null,
    deploymentPolicy = {},
  },
) {
  const imageReference = `${image}@${digest}`;
  await detachGitSource(config, serviceId, imageReference);
  if (variables && Object.keys(variables).length > 0) {
    const variablesData = await withReleaseMutationAuthority(config, () =>
      railwayApi(
        "mutation Upsert($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }",
        {
          input: {
            projectId: config.projectId,
            environmentId: config.environmentId,
            serviceId,
            variables,
            replace: false,
            skipDeploys: true,
          },
        },
      ),
    );
    assert.equal(variablesData.variableCollectionUpsert, true, `${label} variables were not updated`);
  }
  const updateData = await withReleaseMutationAuthority(config, () =>
    railwayApi(
      "mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }",
      {
        serviceId,
        environmentId: config.environmentId,
        input: {
          source: { image: imageReference },
          startCommand,
          railwayConfigFile: null,
          ...deploymentPolicy,
        },
      },
    ),
  );
  assert.equal(updateData.serviceInstanceUpdate, true, `${label} service configuration was not updated`);
  const deployData = await withReleaseMutationAuthority(
    config,
    () => railwayApi(
      "mutation Deploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId) }",
      { serviceId, environmentId: config.environmentId },
    ),
  );
  assertNonemptyDeploymentId(
    deployData.serviceInstanceDeployV2,
    `${label} deployment ID`,
  );
  return deployData.serviceInstanceDeployV2;
}

export function canonicalDeploymentPolicy(kind) {
  if (kind === "migrator") {
    return {
      numReplicas: 1,
      restartPolicyType: "NEVER",
      restartPolicyMaxRetries: 0,
      preDeployCommand: null,
      healthcheckPath: null,
      healthcheckTimeout: null,
    };
  }
  if (kind === "api") {
    return {
      numReplicas: 2,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      preDeployCommand: ["fmarch-schema-gate"],
      healthcheckPath: "/readyz",
      healthcheckTimeout: 120,
    };
  }
  if (kind === "frontend") {
    return {
      numReplicas: 1,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 3,
      preDeployCommand: null,
      healthcheckPath: "/healthz",
      healthcheckTimeout: 120,
    };
  }
  throw new Error(`unknown Railway deployment policy ${kind}`);
}

function assertNonemptyDeploymentId(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(value.trim(), value, `${label} must not contain surrounding whitespace`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  return value;
}

function deploymentById(config, serviceId, deploymentId) {
  assertNonemptyDeploymentId(deploymentId, "Railway deployment ID");
  const deployment = railwayApi(
    "query Deployment($id: String!) { deployment(id: $id) { id status projectId environmentId serviceId meta } }",
    { id: deploymentId },
  ).deployment;
  assert.equal(deployment.id, deploymentId, "Railway returned the wrong deployment ID");
  assert.equal(deployment.projectId, config.projectId, "Railway deployment project drifted");
  assert.equal(
    deployment.environmentId,
    config.environmentId,
    "Railway deployment environment drifted",
  );
  assert.equal(deployment.serviceId, serviceId, "Railway deployment service drifted");
  return deployment;
}

export async function waitForDeployment(
  config,
  serviceId,
  deploymentId,
  expectedDigest,
  label,
  {
    load = () => deploymentById(config, serviceId, deploymentId),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = ONE_SHOT_RAILWAY_WAIT_TIMEOUT_MS,
    pollMilliseconds = 10_000,
    allowTerminalFailure = false,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const deployment = await load();
    if (deployment) {
      assert.equal(deployment.id, deploymentId, `${label} deployment ID drifted`);
      const digest = deploymentImageDigest(deployment);
      if (TERMINAL_DEPLOYMENT_STATES.has(deployment.status)) {
        if (allowTerminalFailure && ["FAILED", "CRASHED"].includes(deployment.status)) {
          assert.equal(digest, expectedDigest, `${label} failed from an unexpected digest`);
          return deployment;
        }
        validateDeploymentArtifact(deployment, expectedDigest, label);
        return deployment;
      }
      if (digest && digest !== expectedDigest) {
        throw new Error(`${label} started with unexpected digest ${digest}`);
      }
    }
    await sleep(pollMilliseconds);
  }
  throw new Error(`${label} did not reach a terminal deployment state within its bounded wait`);
}

async function waitForOneShotTerminal(
  config,
  serviceId,
  deploymentId,
  expectedDigest,
  label,
  {
    load = () => deploymentById(config, serviceId, deploymentId),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = ONE_SHOT_RAILWAY_WAIT_TIMEOUT_MS,
    pollMilliseconds = 10_000,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const deployment = await load();
    if (deployment) {
      assert.equal(deployment.id, deploymentId, `${label} deployment ID drifted`);
      const actualDigest = deploymentImageDigest(deployment);
      if (actualDigest) {
        assert.equal(actualDigest, expectedDigest, `${label} started from an unexpected digest`);
      }
      if (TERMINAL_DEPLOYMENT_STATES.has(deployment.status)) return deployment;
    }
    await sleep(pollMilliseconds);
  }
  throw new Error(`${label} did not reach a terminal deployment state within its bounded wait`);
}

export function bindDatabaseOneShotIntent({
  config,
  commit,
  phase,
  generation,
  repository,
  digest,
  startCommand,
  variables,
}) {
  assertFullCommit(commit);
  assert.match(phase ?? "", /^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "database one-shot phase is invalid");
  assert.ok(
    Number.isSafeInteger(generation) && generation >= 0,
    "database one-shot generation is invalid",
  );
  assert.equal(typeof repository, "string", "database one-shot repository is invalid");
  assert.ok(repository.length > 0, "database one-shot repository is empty");
  assertImageDigest(digest, "database one-shot image digest");
  assert.equal(typeof startCommand, "string", "database one-shot start command is invalid");
  assert.ok(startCommand.length > 0, "database one-shot start command is empty");
  assert.equal(
    startCommand.includes("--operation-id"),
    false,
    "database one-shot start command already contains an operation ID",
  );
  assert.ok(
    variables && typeof variables === "object" && !Array.isArray(variables),
    "database one-shot variables are invalid",
  );
  const promotionLeaseCommit = config.environment === "production"
    ? assertFullCommit(config.productionLease?.token, "production promotion lock token")
    : null;
  const stagingMutationLeaseCommit = config.environment === "staging"
    ? assertFullCommit(
      config.stagingMutationLease?.token,
      "staging release mutation lease token",
    )
    : null;
  const identity = {
    version: 1,
    kind: "fmarch-database-one-shot-operation-id",
    environment: config.environment,
    project_id: config.projectId,
    environment_id: config.environmentId,
    service_id: config.migratorServiceId,
    release_commit: commit,
    promotion_lease_commit: promotionLeaseCommit,
    ...(config.environment === "staging"
      ? { staging_mutation_lease_commit: stagingMutationLeaseCommit }
      : {}),
    phase,
    generation,
    repository,
    digest,
    start_command_base: startCommand,
    variables_sha256: receiptDigest(variables),
  };
  const operationId = receiptDigest(identity);
  const base = {
    ...identity,
    kind: "fmarch-database-one-shot-intent",
    operation_id: operationId,
    start_command: `${startCommand} --operation-id ${operationId}`,
  };
  delete base.start_command_base;
  return { ...base, receipt_sha256: receiptDigest(base) };
}

function validateDatabaseOneShotIntent(actual, expected) {
  const { receipt_sha256: actualDigest, ...base } = actual ?? {};
  assert.equal(
    actualDigest,
    receiptDigest(base),
    "database one-shot intent journal was tampered with",
  );
  assert.deepEqual(actual, expected, "database one-shot intent belongs to another operation");
  return actual;
}

function databaseOneShotDispatch(intent, deploymentId) {
  assertNonemptyDeploymentId(deploymentId, "database one-shot deployment ID");
  const base = {
    version: 1,
    kind: "fmarch-database-one-shot-dispatch",
    operation_id: intent.operation_id,
    intent_receipt_sha256: intent.receipt_sha256,
    deployment_id: deploymentId,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

function validateDatabaseOneShotDispatch(actual, intent) {
  const { receipt_sha256: actualDigest, ...base } = actual ?? {};
  assert.equal(
    actualDigest,
    receiptDigest(base),
    "database one-shot dispatch journal was tampered with",
  );
  assert.equal(actual?.kind, "fmarch-database-one-shot-dispatch");
  assert.equal(actual.operation_id, intent.operation_id, "database one-shot dispatch operation drifted");
  assert.equal(
    actual.intent_receipt_sha256,
    intent.receipt_sha256,
    "database one-shot dispatch intent drifted",
  );
  assertNonemptyDeploymentId(actual.deployment_id, "database one-shot deployment ID");
  return actual;
}

function databaseOneShotFailure(intent, deployment) {
  assert.ok(
    ["FAILED", "CRASHED"].includes(deployment.status),
    "only an exact failed database one-shot may close a generation",
  );
  const base = {
    version: 1,
    kind: "fmarch-database-one-shot-failure",
    operation_id: intent.operation_id,
    intent_receipt_sha256: intent.receipt_sha256,
    deployment_id: deployment.id,
    status: deployment.status,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

function validateDatabaseOneShotFailure(actual, intent, deployment) {
  const expected = databaseOneShotFailure(intent, deployment);
  const { receipt_sha256: actualDigest, ...base } = actual ?? {};
  assert.equal(
    actualDigest,
    receiptDigest(base),
    "database one-shot failure journal was tampered with",
  );
  assert.deepEqual(actual, expected, "database one-shot failure belongs to another deployment");
  return actual;
}

function deploymentStartCommand(deployment) {
  return deployment?.meta?.serviceManifest?.deploy?.startCommand ?? null;
}

function validateDatabaseOneShotDeployment(
  deployment,
  intent,
  { allowMissingDigest = false } = {},
) {
  assert.equal(deployment?.id != null, true, "database one-shot deployment is missing");
  const digest = deploymentImageDigest(deployment);
  if (allowMissingDigest && digest == null) {
    // Railway may not populate imageDigest until a queued deployment initializes.
  } else {
    assert.equal(digest, intent.digest, "database one-shot deployment digest drifted");
  }
  assert.equal(
    deploymentStartCommand(deployment),
    intent.start_command,
    "database one-shot deployment start command drifted",
  );
  return deployment;
}

export function databaseOneShotDisarmInput() {
  return { startCommand: "/bin/false", railwayConfigFile: null };
}

async function disarmConfiguredDatabaseOneShot(config, label) {
  const updateData = await withReleaseMutationAuthority(config, () =>
    railwayApi(
      "mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }",
      {
        serviceId: config.migratorServiceId,
        environmentId: config.environmentId,
        input: databaseOneShotDisarmInput(),
      },
    ),
  );
  assert.equal(
    updateData.serviceInstanceUpdate,
    true,
    `${label} service could not be disarmed after its one-shot`,
  );
}

export async function runJournaledDatabaseOneShot(options) {
  assert.equal(typeof options?.disarm, "function");
  let activeIntent = null;
  let commandIsDisarmed = true;
  const disarm = async (deploymentId, intent) => {
    commandIsDisarmed = false;
    await options.disarm(deploymentId, intent);
    commandIsDisarmed = true;
  };
  try {
    return await runJournaledDatabaseOneShotGenerations({
      ...options,
      disarm,
      markActive(intent) {
        activeIntent = intent;
        commandIsDisarmed = false;
      },
    });
  } catch (error) {
    if (activeIntent && !commandIsDisarmed) {
      try {
        await disarm(null, activeIntent);
      } catch (disarmError) {
        throw new AggregateError(
          [error, disarmError],
          `${options.label} failed and its one-shot command could not be disarmed`,
        );
      }
    }
    throw error;
  }
}

async function runJournaledDatabaseOneShotGenerations({
  intentForGeneration,
  loadRecord,
  publishRecord,
  findMatchingDeployments,
  dispatch,
  awaitTerminal,
  disarm,
  markActive,
  readCompletion,
  label,
  maxGenerations = MAX_ONE_SHOT_GENERATIONS,
  recoverMissingIntent = false,
}) {
  assert.equal(typeof intentForGeneration, "function");
  assert.ok(Number.isSafeInteger(maxGenerations) && maxGenerations > 0);
  let priorFailure = null;
  for (let generation = 0; generation < maxGenerations; generation += 1) {
    const expectedIntent = intentForGeneration(generation);
    markActive(expectedIntent);
    let intent = await loadRecord(generation, "intent");
    const existingIntent = intent != null;
    if (existingIntent) validateDatabaseOneShotIntent(intent, expectedIntent);
    else {
      if (generation > 0) {
        assert.ok(priorFailure, `${label} next generation has no exact failed predecessor`);
      }
      await publishRecord(generation, "intent", expectedIntent);
      intent = expectedIntent;
    }

    let dispatchRecord = await loadRecord(generation, "dispatch");
    if (dispatchRecord) validateDatabaseOneShotDispatch(dispatchRecord, intent);
    else {
      const recovering = existingIntent || recoverMissingIntent;
      let matches = await findMatchingDeployments(intent, { recovering });
      assert.ok(Array.isArray(matches), `${label} deployment history is invalid`);
      for (const match of matches) {
        validateDatabaseOneShotDeployment(match, intent, { allowMissingDigest: true });
      }
      assert.ok(
        matches.length <= 1,
        `${label} has multiple deployments for one operation ID; refusing split-brain recovery`,
      );
      let deploymentId;
      if (matches.length === 1) deploymentId = matches[0].id;
      else if (recovering) {
        throw new Error(
          `${label} has a durable intent but no exact deployment; outcome is unknown and must not be redispatched`,
        );
      } else {
        try {
          deploymentId = await dispatch(intent);
        } catch (error) {
          // The V2 mutation may have committed even though its response was
          // lost. Remove the mutable command before waiting for deployment
          // history to converge; this does not cancel any captured snapshot.
          await disarm(null, intent);
          matches = await findMatchingDeployments(intent, {
            recovering: true,
            dispatchError: error,
          });
          assert.ok(Array.isArray(matches), `${label} deployment history is invalid`);
          for (const match of matches) {
            validateDatabaseOneShotDeployment(match, intent, { allowMissingDigest: true });
          }
          assert.ok(
            matches.length <= 1,
            `${label} has multiple deployments for one operation ID; refusing split-brain recovery`,
          );
          if (matches.length === 0) throw error;
          deploymentId = matches[0].id;
        }
      }
      dispatchRecord = databaseOneShotDispatch(intent, deploymentId);
      await publishRecord(generation, "dispatch", dispatchRecord);
    }

    // V2 has already captured the exact deployment snapshot. Disarm the
    // mutable service immediately after its ID is durable, before waiting, so
    // a manual/ambient redeploy cannot duplicate the database operation.
    await disarm(dispatchRecord.deployment_id, intent);
    let deployment;
    try {
      deployment = await awaitTerminal(dispatchRecord.deployment_id, intent);
    } finally {
      // The operation-bound command is a temporary capability. Remove it even
      // after a wait timeout or unexpected terminal result; exact-ID recovery
      // can still adopt the already-created deployment without leaving an
      // ambient/manual redeploy path armed.
      await disarm(dispatchRecord.deployment_id, intent);
    }
    assert.equal(
      deployment.id,
      dispatchRecord.deployment_id,
      `${label} terminal deployment ID drifted`,
    );
    validateDatabaseOneShotDeployment(deployment, intent);
    if (deployment.status === "SUCCESS") {
      const completion = await readCompletion(deployment, intent, { allowMissing: true });
      assert.ok(
        completion,
        `${label} succeeded without exact operation completion evidence; outcome is ambiguous and must not be redeployed`,
      );
      return { deployment, completion, intent, generation };
    }
    if (!["FAILED", "CRASHED"].includes(deployment.status)) {
      throw new Error(`${label} stopped in non-retryable state ${deployment.status}`);
    }

    const expectedFailure = databaseOneShotFailure(intent, deployment);
    const existingFailure = await loadRecord(generation, "failure");
    if (existingFailure) {
      validateDatabaseOneShotFailure(existingFailure, intent, deployment);
      priorFailure = existingFailure;
    } else {
      await publishRecord(generation, "failure", expectedFailure);
      priorFailure = expectedFailure;
    }
  }
  throw new Error(`${label} exhausted its bounded recovery generations`);
}

export function databaseIdentityVariables(config) {
  return {
    FMARCH_DATABASE_ENVIRONMENT: config.environment,
    FMARCH_DATABASE_PROJECT_ID: config.projectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: config.environmentId,
  };
}

export function oneShotDatabaseVariables(config) {
  return {
    ...databaseIdentityVariables(config),
    ...DATABASE_ONE_SHOT_TIMEOUT_VARIABLES,
  };
}

async function deployImage(config, serviceId, image, digest, startCommand, label, kind, variables = null) {
  return await deployConfiguredImage(config, {
    serviceId,
    image,
    digest,
    startCommand,
    label,
    variables,
    deploymentPolicy: canonicalDeploymentPolicy(kind),
  });
}

function releaseJournalScope(config, commit) {
  assertFullCommit(commit);
  const token = config.environment === "production"
    ? assertFullCommit(config.productionLease?.token, "production promotion lock token")
    : assertFullCommit(
      config.stagingMutationLease?.token,
      "staging release mutation lease token",
    );
  return `${commit}-${token}`;
}

function oneShotJournalDirectory(config, commit, phase) {
  return path.join(
    repoRoot,
    "target",
    "releases",
    config.environment,
    "database-one-shots",
    releaseJournalScope(config, commit),
    phase,
  );
}

function oneShotRecordPath(directory, generation, record) {
  assert.ok(Number.isSafeInteger(generation) && generation >= 0);
  assert.ok(["intent", "dispatch", "failure"].includes(record));
  return path.join(directory, `generation-${String(generation).padStart(2, "0")}-${record}.json`);
}

async function loadOptionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function matchingOneShotDeployments(config, intent) {
  const deployments = railwayJson(config, [
    "deployment",
    "list",
    "--service",
    config.migratorServiceId,
    "--limit",
    String(ONE_SHOT_HISTORY_LIMIT),
  ]);
  assert.ok(Array.isArray(deployments), "Railway deployment history is invalid");
  const matches = deployments.filter(
    (deployment) => deploymentStartCommand(deployment) === intent.start_command,
  );
  for (const deployment of matches) {
    const digest = deploymentImageDigest(deployment);
    if (digest != null) {
      assert.equal(digest, intent.digest, "database one-shot history digest drifted");
    }
  }
  return matches;
}

async function findMatchingOneShotDeployments(
  config,
  intent,
  {
    recovering = false,
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = ONE_SHOT_HISTORY_RECOVERY_TIMEOUT_MS,
    pollMilliseconds = 2_000,
  } = {},
) {
  if (!recovering) return matchingOneShotDeployments(config, intent);
  const deadline = now() + timeoutMilliseconds;
  do {
    const matches = matchingOneShotDeployments(config, intent);
    if (matches.length > 0) return matches;
    await sleep(pollMilliseconds);
  } while (now() < deadline);
  return [];
}

async function coordinateDatabaseOneShot({
  config,
  commit,
  phase,
  digest,
  startCommand,
  variables,
  label,
  readCompletion,
}) {
  const directory = oneShotJournalDirectory(config, commit, phase);
  const intentForGeneration = (generation) =>
    bindDatabaseOneShotIntent({
      config,
      commit,
      phase,
      generation,
      repository: config.runtimeImage,
      digest,
      startCommand,
      variables,
    });
  return await runJournaledDatabaseOneShot({
    intentForGeneration,
    loadRecord: (generation, record) =>
      loadOptionalJson(oneShotRecordPath(directory, generation, record)),
    publishRecord: (generation, record, receipt) =>
      publishImmutableJson(oneShotRecordPath(directory, generation, record), receipt),
    findMatchingDeployments: (intent, options) =>
      findMatchingOneShotDeployments(config, intent, options),
    dispatch: (intent) =>
      configureAndDispatchImage(config, {
        serviceId: config.migratorServiceId,
        image: config.runtimeImage,
        digest,
        startCommand: intent.start_command,
        label,
        variables,
        deploymentPolicy: canonicalDeploymentPolicy("migrator"),
      }),
    awaitTerminal: (deploymentId, intent) =>
      waitForOneShotTerminal(
        config,
        config.migratorServiceId,
        deploymentId,
        intent.digest,
        label,
      ),
    disarm: () => disarmConfiguredDatabaseOneShot(config, label),
    readCompletion,
    label,
    recoverMissingIntent:
      config.environment === "staging" && config.stagingMutationLease?.resumed === true,
  });
}

export function parseResetLogRows(output) {
  const messages = parseStructuredLogRows(output);
  return {
    audit: messages.find((message) => message.kind === "fmarch-schema-epoch-reset-audit"),
    complete: messages.find((message) => message.kind === "fmarch-schema-epoch-reset-complete"),
  };
}

function parseStructuredLogRows(output) {
  return String(output)
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line);
        if (typeof row?.kind === "string") return [row];
        const message = String(row.message ?? row);
        const start = message.indexOf("{");
        return start < 0 ? [] : [JSON.parse(message.slice(start))];
      } catch {
        return [];
      }
    });
}

export function parseMigrationCompletion(output) {
  return parseStructuredLogRows(output).find(
    (message) => message.kind === "fmarch-database-migration-complete",
  ) ?? null;
}

export async function waitForMigrationCompletion(
  config,
  deploymentId,
  serviceId,
  expectedCommit,
  expectedOperationId,
  {
    load = () => railwayText(config, [
      "logs",
      deploymentId,
      "--service",
      serviceId,
      "--lines",
      "200",
    ]),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = 60_000,
    pollMilliseconds = 2_000,
  } = {},
) {
  assert.match(
    expectedOperationId ?? "",
    /^[0-9a-f]{64}$/u,
    "migration operation ID must be a lowercase SHA-256 digest",
  );
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const completion = parseMigrationCompletion(await load());
    if (completion) {
      assert.equal(
        completion.release_commit,
        expectedCommit,
        "migration completion record does not match the release commit",
      );
      assert.equal(
        completion.operation_id,
        expectedOperationId,
        "migration completion record does not match the journaled operation",
      );
      return completion;
    }
    await sleep(pollMilliseconds);
  }
  throw new Error("migrator emitted no exact-commit completion record within 60 seconds");
}

export async function waitForResetLogRows(
  config,
  deploymentId,
  serviceId,
  required,
  label,
  {
    load = () => railwayText(config, [
      "logs",
      deploymentId,
      "--service",
      serviceId,
      "--lines",
      "200",
    ]),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = 60_000,
    pollMilliseconds = 2_000,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const parsed = parseResetLogRows(await load());
    if (required.every((field) => parsed[field] != null)) return parsed;
    await sleep(pollMilliseconds);
  }
  throw new Error(`${label} emitted no ${required.join(" and ")} record within 60 seconds`);
}

export function validateEpochResetAudit(audit, { environment, epoch, commit, operationId }) {
  assert.equal(audit?.kind, "fmarch-schema-epoch-reset-audit", "schema epoch reset audit kind drifted");
  assert.equal(audit.environment, environment, "schema epoch reset audit environment drifted");
  assert.equal(audit.epoch, epoch, "schema epoch reset audit epoch drifted");
  assert.equal(audit.release_commit, commit, "schema epoch reset audit commit drifted");
  assert.equal(audit.operation_id, operationId, "schema epoch reset audit operation drifted");
  assert.equal(audit.execute, false, "pre-reset audit must not mutate the database");
  assert.ok(
    audit.counts?.application_tables &&
      typeof audit.counts.application_tables === "object" &&
      !Array.isArray(audit.counts.application_tables) &&
      Object.keys(audit.counts.application_tables).length > 0,
    "schema epoch reset application inventory is empty or invalid",
  );
  for (const [table, count] of Object.entries(audit.counts.application_tables)) {
    assert.equal(
      Number(count),
      0,
      `schema epoch reset refuses non-greenfield ${table} state`,
    );
  }
  assert.ok(
    Number.isSafeInteger(Number(audit.counts.sqlx_migrations)) &&
      Number(audit.counts.sqlx_migrations) >= 0,
    "schema epoch reset SQLx inventory is invalid",
  );
  const inventorySha256 = createHash("sha256")
    .update(JSON.stringify(audit.counts))
    .digest("hex");
  assert.equal(audit.inventory_sha256, inventorySha256, "schema epoch reset inventory digest drifted");
  return audit;
}

function epochResetOperation(config, digest, commit, epoch) {
  const base = {
    version: 1,
    kind: "fmarch-schema-epoch-reset-operation",
    key: `${config.environment}:${epoch}:${commit}`,
    environment: config.environment,
    epoch,
    commit,
    promotion_lease_commit: config.productionLease?.token ?? null,
    ...(config.environment === "staging"
      ? {
        staging_mutation_lease_commit: assertFullCommit(
          config.stagingMutationLease?.token,
          "staging release mutation lease token",
        ),
      }
      : {}),
    runtime_digest: digest,
    topology: config.topology,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

function epochResetPhase(operation, phase, evidence) {
  const base = {
    version: 1,
    kind: "fmarch-schema-epoch-reset-phase",
    operation_key: operation.key,
    operation_receipt_sha256: operation.receipt_sha256,
    phase,
    evidence,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

function validateEpochResetOperation(actual, expected) {
  const { receipt_sha256: digest, ...base } = actual ?? {};
  assert.equal(digest, receiptDigest(base), "schema epoch reset operation journal was tampered with");
  assert.deepEqual(actual, expected, "schema epoch reset journal belongs to a different operation");
  return actual;
}

function validateEpochResetPhase(actual, operation, phase) {
  const { receipt_sha256: digest, ...base } = actual ?? {};
  assert.equal(digest, receiptDigest(base), `schema epoch reset ${phase} phase was tampered with`);
  assert.equal(actual.kind, "fmarch-schema-epoch-reset-phase");
  assert.equal(actual.operation_key, operation.key, `schema epoch reset ${phase} operation drifted`);
  assert.equal(
    actual.operation_receipt_sha256,
    operation.receipt_sha256,
    `schema epoch reset ${phase} intent drifted`,
  );
  assert.equal(actual.phase, phase, `schema epoch reset phase drifted from ${phase}`);
  return actual;
}

export async function runEpochResetJournal({
  operation,
  loadPhase,
  publishPhase,
  audit,
  planReset,
  executeOrRecoverReset,
  planMigration,
  executeOrRecoverMigration,
}) {
  let intent = await loadPhase("intent");
  if (intent) validateEpochResetOperation(intent, operation);
  else {
    await publishPhase("intent", operation);
    intent = operation;
  }

  let auditPhase = await loadPhase("audit-complete");
  if (auditPhase) validateEpochResetPhase(auditPhase, operation, "audit-complete");
  else {
    auditPhase = epochResetPhase(operation, "audit-complete", await audit());
    await publishPhase("audit-complete", auditPhase);
  }

  let resetStarted = await loadPhase("reset-started");
  if (resetStarted) validateEpochResetPhase(resetStarted, operation, "reset-started");
  else {
    resetStarted = epochResetPhase(
      operation,
      "reset-started",
      await planReset(auditPhase.evidence),
    );
    await publishPhase("reset-started", resetStarted);
  }

  let resetComplete = await loadPhase("reset-complete");
  if (resetComplete) validateEpochResetPhase(resetComplete, operation, "reset-complete");
  else {
    resetComplete = epochResetPhase(
      operation,
      "reset-complete",
      await executeOrRecoverReset(resetStarted.evidence, auditPhase.evidence),
    );
    await publishPhase("reset-complete", resetComplete);
  }

  let migrationStarted = await loadPhase("migration-started");
  if (migrationStarted) {
    validateEpochResetPhase(migrationStarted, operation, "migration-started");
  } else {
    migrationStarted = epochResetPhase(
      operation,
      "migration-started",
      await planMigration(resetComplete.evidence),
    );
    await publishPhase("migration-started", migrationStarted);
  }

  let migrationComplete = await loadPhase("migration-complete");
  if (migrationComplete) {
    validateEpochResetPhase(migrationComplete, operation, "migration-complete");
  } else {
    migrationComplete = epochResetPhase(
      operation,
      "migration-complete",
      await executeOrRecoverMigration(migrationStarted.evidence, resetComplete.evidence),
    );
    await publishPhase("migration-complete", migrationComplete);
  }

  return {
    schemaEpochReset: resetComplete.evidence.schema_epoch_reset,
    migrator: migrationComplete.evidence.deployment,
  };
}

async function deployEpochResetAudit(config, digest, commit, epoch) {
  const serviceId = config.migratorServiceId;
  const confirmation = `${config.environment}:${epoch}:${commit}`;
  const outcome = await coordinateDatabaseOneShot({
    config,
    commit,
    phase: `schema-epoch-${epoch}-audit`,
    digest,
    startCommand: "fmarch-schema-epoch-reset",
    label: `${config.environment} schema epoch reset audit`,
    variables: {
      ...oneShotDatabaseVariables(config),
      FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT: config.environment,
      FMARCH_SCHEMA_EPOCH_RESET_EPOCH: String(epoch),
      FMARCH_SCHEMA_EPOCH_RESET_CONFIRM: confirmation,
    },
    readCompletion: async (deployment, intent, { allowMissing }) => {
      try {
        const audit = (await waitForResetLogRows(
          config,
          deployment.id,
          serviceId,
          ["audit"],
          "schema epoch reset audit deployment",
        )).audit;
        return validateEpochResetAudit(audit, {
          environment: config.environment,
          epoch,
          commit,
          operationId: intent.operation_id,
        });
      } catch (error) {
        if (allowMissing && /emitted no audit record/u.test(error.message)) return null;
        throw error;
      }
    },
  });
  const audit = outcome.completion;
  return {
    audit_deployment_id: outcome.deployment.id,
    audit_operation_id: outcome.intent.operation_id,
    inventory_sha256: audit.inventory_sha256,
    prior_counts: audit.counts,
  };
}

async function deployOrRecoverEpochReset(config, digest, commit, epoch, plan, auditEvidence) {
  const serviceId = config.migratorServiceId;
  assert.equal(
    plan.audit_inventory_sha256,
    auditEvidence.inventory_sha256,
    "schema epoch reset start plan no longer binds its audit inventory",
  );
  assert.deepEqual(
    plan.expected_inventory,
    auditEvidence.prior_counts,
    "schema epoch reset start plan inventory drifted",
  );
  const expectedInventory = JSON.stringify(plan.expected_inventory);
  const outcome = await coordinateDatabaseOneShot({
    config,
    commit,
    phase: `schema-epoch-${epoch}-execute`,
    digest,
    startCommand: "fmarch-schema-epoch-reset --execute",
    label: `${config.environment} schema epoch reset`,
    variables: {
      ...oneShotDatabaseVariables(config),
      FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT: config.environment,
      FMARCH_SCHEMA_EPOCH_RESET_EPOCH: String(epoch),
      FMARCH_SCHEMA_EPOCH_RESET_CONFIRM: `${config.environment}:${epoch}:${commit}`,
      FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY: expectedInventory,
      FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY_SHA256: plan.audit_inventory_sha256,
    },
    readCompletion: async (deployment, intent, { allowMissing }) => {
      let parsed;
      try {
        parsed = await waitForResetLogRows(
          config,
          deployment.id,
          serviceId,
          ["audit", "complete"],
          "schema epoch reset deployment",
        );
      } catch (error) {
        if (allowMissing && /emitted no audit and complete record/u.test(error.message)) return null;
        throw error;
      }
      validateEpochResetAudit(
        { ...parsed.audit, execute: false },
        {
          environment: config.environment,
          epoch,
          commit,
          operationId: intent.operation_id,
        },
      );
      assert.equal(parsed.audit.execute, true, "schema epoch reset execution audit is not mutating");
      assert.equal(parsed.complete.release_commit, commit);
      assert.equal(parsed.complete.operation_id, intent.operation_id);
      assert.equal(parsed.complete.environment, config.environment);
      assert.equal(parsed.complete.epoch, epoch);
      assert.deepEqual(
        parsed.complete.prior_counts,
        auditEvidence.prior_counts,
        "schema epoch reset execution no longer matches its greenfield audit",
      );
      return parsed;
    },
  });
  const { deployment, completion: parsed } = outcome;
  const base = {
    version: 1,
    kind: "fmarch-schema-epoch-reset",
    environment: config.environment,
    epoch,
    commit,
    runtime_digest: digest,
    audit_deployment_id: auditEvidence.audit_deployment_id,
    audit_operation_id: auditEvidence.audit_operation_id,
    deployment_id: deployment.id,
    operation_id: outcome.intent.operation_id,
    prior_counts: parsed.complete.prior_counts,
  };
  return {
    schema_epoch_reset: { ...base, receipt_sha256: receiptDigest(base) },
  };
}

async function deployOrRecoverMigrator(config, digest, commit, phase) {
  const serviceId = config.migratorServiceId;
  const outcome = await coordinateDatabaseOneShot({
    config,
    commit,
    phase,
    digest,
    startCommand: "fmarch-migrate",
    label: `${config.environment} migrator`,
    variables: oneShotDatabaseVariables(config),
    readCompletion: async (deployment, intent, { allowMissing }) => {
      try {
        return await waitForMigrationCompletion(
          config,
          deployment.id,
          serviceId,
          commit,
          intent.operation_id,
        );
      } catch (error) {
        if (allowMissing && /emitted no exact-commit completion record/u.test(error.message)) {
          return null;
        }
        throw error;
      }
    },
  });
  const { deployment } = outcome;
  return {
    deployment: {
      id: deployment.id,
      status: "SUCCESS",
      meta: { imageDigest: digest, operationId: outcome.intent.operation_id },
    },
  };
}

async function coordinateEpochReset(config, digest, commit, epoch) {
  const operation = epochResetOperation(config, digest, commit, epoch);
  const journalDirectory = path.join(
    repoRoot,
    "target",
    "releases",
    config.environment,
    "schema-epoch-reset",
    `${releaseJournalScope(config, commit)}-epoch-${epoch}`,
  );
  const loadPhase = async (phase) => {
    try {
      return JSON.parse(await readFile(path.join(journalDirectory, `${phase}.json`), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  };
  const publishPhase = async (phase, receipt) => {
    await publishImmutableJson(path.join(journalDirectory, `${phase}.json`), receipt);
  };
  return await runEpochResetJournal({
    operation,
    loadPhase,
    publishPhase,
    audit: () => deployEpochResetAudit(config, digest, commit, epoch),
    planReset: async (auditEvidence) => ({
      audit_inventory_sha256: auditEvidence.inventory_sha256,
      expected_inventory: auditEvidence.prior_counts,
    }),
    executeOrRecoverReset: (plan, auditEvidence) =>
      deployOrRecoverEpochReset(config, digest, commit, epoch, plan, auditEvidence),
    planMigration: async () => ({ phase: `schema-epoch-${epoch}-migrate` }),
    executeOrRecoverMigration: (plan) =>
      deployOrRecoverMigrator(config, digest, commit, plan.phase),
  });
}

async function fetchHealth(url, commit, kind, topology = null) {
  const expected = new URL(url);
  const response = await fetch(expected, {
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.ok, true, `${kind} health returned ${response.status}`);
  assert.equal(response.url, expected.href, `${kind} health response URL drifted`);
  assert.equal(new URL(response.url).origin, expected.origin, `${kind} health response origin drifted`);
  const body = await response.json();
  validateHealth(body, commit, kind, topology);
  return body;
}

function parseLastJsonLine(output, label) {
  const lines = String(output).trim().split("\n").reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {
      // Railway may emit connection diagnostics before the command result.
    }
  }
  throw new Error(`${label} emitted no JSON result`);
}

async function runStagingSentinel(config, commit, runtimeDigest) {
  await assertStagingMutationAuthority(config);
  const corpusOutput = commandText("railway", [
    "ssh",
    "--project",
    config.projectId,
    "--environment",
    config.environmentId,
    "--service",
    config.apiServiceId,
    "fmarch-staging-search-corpus",
    "reconcile",
  ], { env: scrubHostedEnvironment(process.env) });
  const corpus = parseLastJsonLine(corpusOutput, "staging corpus reconciliation");
  assert.equal(corpus.proof, "fmarch-staging-search-corpus");
  assert.equal(corpus.status, "ready");
  assert.equal(corpus.projected_public_game, true);
  assert.equal(corpus.projected_search_match, true);
  const hostedEnvironment = scrubHostedEnvironment(process.env);
  await assertStagingMutationAuthority(config);
  run("node", ["tools/public_search_staging_canary.mjs"], {
    env: hostedEnvironment,
  });
  const receiptPath = path.join(repoRoot, "target", "public-search-staging-sentinel", "receipt.json");
  const receipt = await waitForStagingSentinelReceipt({
    load: async () => {
      const result = spawnSync("node", [
        "tools/public_search_staging_sentinel.mjs",
        "--expected-commit",
        commit,
        "--expected-image-digest",
        runtimeDigest,
      ], {
        cwd: repoRoot,
        env: hostedEnvironment,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
        timeout: SUBPROCESS_TIMEOUT_MS.node,
      });
      if (![0, 2].includes(result.status)) {
        const diagnostic = String(result.stderr || result.stdout || "").trim().slice(-4_000);
        throw new Error(`public-search staging sentinel failed${diagnostic ? `: ${diagnostic}` : ""}`);
      }
      return JSON.parse(await readFile(receiptPath, "utf8"));
    },
  });
  return {
    status: receipt.status,
    receipt_sha256: receipt.receipt_sha256 ?? null,
    corpus,
  };
}

export async function waitForStagingSentinelReceipt({
  load,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  timeoutMilliseconds = 60_000,
  pollMilliseconds = 2_000,
}) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const receipt = await load();
    if (receipt?.status === "passed") return receipt;
    assert.equal(receipt?.status, "insufficient", "public-search staging sentinel failed");
    await sleep(pollMilliseconds);
  }
  throw new Error("public-search staging telemetry remained insufficient for 60 seconds");
}

function schemaDocumentAtCommit(commit) {
  assertFullCommit(commit);
  return JSON.parse(commandText("git", [
    "show",
    `${commit}:crates/database_schema/schema/epoch.json`,
  ]));
}

function schemaHead(commit) {
  const document = schemaDocumentAtCommit(commit);
  const head = document.migrations?.at(-1)?.filename;
  assert.match(head ?? "", /^\d{4}_[a-z0-9_]+\.sql$/u, "release has no schema head");
  return head;
}

export async function checkedInSchemaEpoch(commit) {
  const document = schemaDocumentAtCommit(commit);
  assert.ok(Number.isSafeInteger(document.epoch) && document.epoch > 0, "checked-in schema epoch is invalid");
  return document.epoch;
}

export function validateRequestedSchemaEpoch(requestedEpoch, checkedInEpoch) {
  assert.equal(
    requestedEpoch,
    checkedInEpoch,
    `--schema-epoch-reset must equal checked-in schema epoch ${checkedInEpoch}`,
  );
  return requestedEpoch;
}

export function releaseOutputPath(config, commit, requestedPath = null) {
  assertFullCommit(commit);
  if (requestedPath) return path.resolve(requestedPath);
  const filename = config.environment === "staging"
    ? `${commit}.${assertFullCommit(
      config.stagingMutationLease?.token,
      "staging release mutation lease token",
    )}.json`
    : `${commit}.json`;
  return path.join(repoRoot, "target", "releases", config.environment, filename);
}

export function validateCompletedStagingReleaseReceipt(
  receipt,
  { commit, lease, fleetProof, schemaEpochReset = null },
) {
  const completed = assertReleaseReceipt(receipt);
  assert.equal(completed.environment, "staging", "completed receipt is not staging-scoped");
  assert.equal(completed.commit, commit, "completed staging receipt commit drifted");
  assert.equal(
    completed.staging_mutation_lease_commit,
    lease.token,
    "completed staging receipt lease drifted",
  );
  assert.deepEqual(completed.fleet_proof, fleetProof, "completed staging fleet proof drifted");
  assert.equal(
    completed.schema_epoch_reset?.epoch ?? null,
    schemaEpochReset,
    "completed staging schema epoch reset decision drifted",
  );
  return completed;
}

export async function revalidateCompletedStagingRelease(
  config,
  receipt,
  {
    assertAuthority = assertStagingMutationAuthority,
    loadDeployment = (serviceId, deploymentId) =>
      deploymentById(config, serviceId, deploymentId),
    loadServices = () => railwayJson(config, ["service", "list"]),
    loadDomains = (serviceId) =>
      railwayJson(config, ["domain", "list", "--service", serviceId]),
    loadHealth = async (url, commit, kind, topology) =>
      fetchHealth(url, commit, kind, topology),
  } = {},
) {
  assertReleaseReceipt(receipt);
  assert.equal(receipt.environment, "staging");
  await assertAuthority(config);
  const deploymentSpecifications = [
    ["migrator", config.migratorServiceId, receipt.images.runtime],
    ["api", config.apiServiceId, receipt.images.runtime],
    ["frontend", config.frontendServiceId, receipt.images.frontend],
  ];
  for (const [label, serviceId, digest] of deploymentSpecifications) {
    const deployment = await loadDeployment(serviceId, receipt.deployments[label]);
    validateDeploymentArtifact(deployment, digest, `${label} completed receipt`);
  }
  const services = await loadServices();
  assert.ok(Array.isArray(services), "staging service inventory is invalid");
  for (const [label, serviceId, digest] of deploymentSpecifications) {
    const service = services.find((candidate) => candidate.id === serviceId);
    assert.ok(service, `${label} staging service is missing`);
    assert.equal(
      service.source?.repo ?? null,
      null,
      `${label} staging service retained a racing Git source`,
    );
    assert.equal(
      service.deploymentId,
      receipt.deployments[label],
      `${label} serving deployment drifted from completed receipt`,
    );
    const repository = label === "frontend" ? config.frontendImage : config.runtimeImage;
    assert.equal(
      service.source?.image,
      `${repository}@${digest}`,
      `${label} serving image drifted from completed receipt`,
    );
  }
  for (const [label, serviceId, expectedUrl] of [
    ["api", config.apiServiceId, config.apiUrl],
    ["frontend", config.frontendServiceId, config.frontendUrl],
  ]) {
    const domainInventory = await loadDomains(serviceId);
    const expectedDomain = new URL(expectedUrl).host;
    const domain = domainInventory?.domains?.find(
      (candidate) => candidate.domain === expectedDomain,
    );
    assert.ok(domain, `${label} staging domain ${expectedDomain} is missing`);
    assert.equal(domain.syncStatus, "ACTIVE", `${label} staging domain is not active`);
  }
  await Promise.all([
    loadHealth(`${config.apiUrl}/readyz`, receipt.commit, "api", config.topology),
    loadHealth(`${config.frontendUrl}/healthz`, receipt.commit, "frontend", null),
  ]);
  await assertAuthority(config);
  return true;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log("Usage: node tools/release_coordinator.mjs --environment staging|production --commit <40-char-sha> --fleet-receipt <signed-fleet-envelope.json> --fleet-job <exact-job-id> [--fleet-public-key path] [--reuse-staging-receipt path] [--production-lock <lease-commit>] [--resume-lease <staging-lease-commit>] [--schema-epoch-reset N] [--output <production-receipt-path>] [--check]");
    return;
  }
  const commit = assertFullCommit(args.commit ?? commandText("git", ["rev-parse", "HEAD"]));
  const repository = validateRepository(commit, args.environment);
  if (args.schemaEpochReset !== undefined) {
    validateRequestedSchemaEpoch(args.schemaEpochReset, await checkedInSchemaEpoch(commit));
  }
  const expectedFleetJob = args.fleetJob ?? process.env.FMARCH_FLEET_JOB_ID;
  assert.ok(expectedFleetJob, "release requires --fleet-job or FMARCH_FLEET_JOB_ID");
  const fleetReceiptPath = args.fleetReceipt ?? process.env.FMARCH_FLEET_RECEIPT;
  const fleetPublicKeyPath =
    args.fleetPublicKey ??
    process.env.FMARCH_FLEET_PUBLIC_KEY ??
    defaultFleetPublicKeyPath();
  const fleetProof = await loadFleetReleaseProof({
    repoRoot,
    commit,
    receiptPath: fleetReceiptPath,
    publicKeyPath: fleetPublicKeyPath,
    expectedJobId: expectedFleetJob,
  });
  let releaseReadiness = null;
  if (args.environment === "production") {
    const registry = await loadCompletionRegistry({ root: repoRoot });
    await validateRegistry(registry, { root: repoRoot });
    releaseReadiness = validateProductionReleaseReadiness(registry);
  }
  const config = runtimeConfig(args.environment);
  const acceptanceEnv = {...process.env, FMARCH_HOSTED_EXPECTED_COMMIT: commit, FMARCH_HOSTED_MATRIX_API_URL: config.apiUrl, FMARCH_HOSTED_MATRIX_FRONTEND_URL: config.frontendUrl, FMARCH_HOSTED_AUTHENTICATED: '1'};
  if (args.check) {
    console.log(`release coordination check passed for ${args.environment} ${commit}`);
    return;
  }
  let promotionLeaseCommit = null;
  let reusableStagingReceipt = null;
  if (args.environment === "production") {
    assert.ok(args.reuseStagingReceipt, "production requires --reuse-staging-receipt");
    reusableStagingReceipt = assertFreshStagingReleaseReceipt(
      JSON.parse(await readFile(path.resolve(args.reuseStagingReceipt), "utf8")),
    );
    assert.equal(reusableStagingReceipt.commit, commit, "staging receipt commit drifted");
    assert.deepEqual(reusableStagingReceipt.fleet_proof, fleetProof, "staging fleet proof drifted");
    assert.equal(
      args.schemaEpochReset ?? null,
      reusableStagingReceipt.schema_epoch_reset?.epoch ?? null,
      "production schema epoch reset decision must exactly match staging",
    );
    promotionLeaseCommit = assertFullCommit(
      args.productionLock,
      "production promotion lock token",
    );
    config.productionLease = {
      token: promotionLeaseCommit,
      releaseCommit: commit,
      expectedProductionCommit: repository.originProduction,
      fleetJobId: fleetProof.job_id,
      fleetReceiptSha256: fleetProof.receipt_sha256,
      stagingReceiptSha256: reusableStagingReceipt.receipt_sha256,
      schemaEpochReset: args.schemaEpochReset ?? null,
    };
    config.productionMutationEvidence = bindProductionMutationEvidence({
      promotionLeaseCommit,
      commit,
      stagingReceiptPath: args.reuseStagingReceipt,
      stagingReceipt: reusableStagingReceipt,
      fleetReceiptPath,
      fleetPublicKeyPath,
      expectedFleetJob,
      fleetProof,
    });
    assertProductionPromotionLease(config.productionLease);
  }

  const coordinateRelease = async () => {
    const output = releaseOutputPath(
      config,
      commit,
      args.environment === "production" ? args.output ?? null : null,
    );
    if (args.environment === "staging") {
      const completed = await optionalJson(output);
      if (completed) {
        assert.equal(
          config.stagingMutationLease.resumed,
          true,
          `staging release output already exists; resume its exact lease with --resume-lease ${completed.staging_mutation_lease_commit ?? "<unknown>"}`,
        );
        validateCompletedStagingReleaseReceipt(completed, {
          commit,
          lease: config.stagingMutationLease,
          fleetProof,
          schemaEpochReset: args.schemaEpochReset ?? null,
        });
        await revalidateCompletedStagingRelease(config, completed);
        return {
          receipt: completed,
          output,
          replay: "completed-receipt",
          runtimeDigest: completed.images.runtime,
          frontendDigest: completed.images.frontend,
        };
      }
      await assertStagingMutationAuthority(config);
      await prepareAuthenticatedAcceptance(acceptanceEnv, {
        api: config.apiUrl,
        frontend: config.frontendUrl,
      });
    }

    const artifacts = await resolveArtifacts(args, config, commit, fleetProof, {
      reusableStagingReceipt,
    });
    const { runtimeDigest, frontendDigest, runtimeValidation: reusedRuntimeValidation } = artifacts;
    const runtimeValidation = releaseRuntimeValidation({
      environment: args.environment,
      runtimeRepository: config.runtimeImage,
      runtimeDigest,
      reusedRuntimeValidation,
    });
    const attemptReceipt = await bindAttempt(
      args.environment,
      commit,
      runtimeDigest,
      frontendDigest,
      fleetProof,
      config.topology,
      promotionLeaseCommit,
      config.stagingMutationLease?.token ?? null,
    );
    let schemaEpochReset = null;
    let migrator;
    if (args.schemaEpochReset !== undefined) {
      const reset = await coordinateEpochReset(
        config,
        runtimeDigest,
        commit,
        args.schemaEpochReset,
      );
      schemaEpochReset = reset.schemaEpochReset;
      migrator = reset.migrator;
    } else {
      migrator = (await deployOrRecoverMigrator(
        config,
        runtimeDigest,
        commit,
        "migrate",
      )).deployment;
    }
    const [api, frontend] = await Promise.all([
      deployImage(
        config,
        config.apiServiceId,
        config.runtimeImage,
        runtimeDigest,
        "fmarch-server",
        `${args.environment} API`,
        "api",
        databaseIdentityVariables(config),
      ),
      deployImage(
        config,
        config.frontendServiceId,
        config.frontendImage,
        frontendDigest,
        "node build",
        `${args.environment} frontend`,
        "frontend",
      ),
    ]);
    const [apiHealth, frontendHealth] = await Promise.all([
      fetchHealth(`${config.apiUrl}/readyz`, commit, "api", config.topology),
      fetchHealth(`${config.frontendUrl}/healthz`, commit, "frontend"),
    ]);
    const sentinel = args.environment === "staging"
      ? await runStagingSentinel(config, commit, runtimeDigest)
      : null;
    if (args.environment === "staging") await assertStagingMutationAuthority(config);
    const hostedAcceptance = args.environment === "staging"
      ? await runHostedAcceptance(acceptanceEnv)
      : null;
    const receipt = buildReleaseReceipt({
      environment: args.environment,
      commit,
      runtimeDigest,
      frontendDigest,
      deployments: { migrator, api, frontend },
      health: { api: apiHealth, frontend: frontendHealth },
      schemaHead: schemaHead(commit),
      fleetProof,
      attemptReceipt,
      runtimeValidation,
      releaseReadiness,
      sentinel,
      hostedAcceptance,
      schemaEpochReset,
      topology: config.topology,
    });
    await withReleaseMutationAuthority(config, () => publishImmutableJson(output, receipt));
    return {
      receipt,
      output,
      replay: null,
      runtimeDigest,
      frontendDigest,
    };
  };

  if (args.environment === "production") {
    const result = await coordinateRelease();
    console.log(JSON.stringify({
      status: "passed",
      environment: "production",
      commit,
      runtimeDigest: result.runtimeDigest,
      frontendDigest: result.frontendDigest,
      receipt: result.output,
    }, null, 2));
    return result.receipt;
  }

  const bindings = stagingCoordinatorMutationLeaseBindings({
    fleetProof,
    schemaEpochReset: args.schemaEpochReset ?? null,
  });
  const result = await withStagingReleaseMutationLease(
    {
      acquire: async () => args.resumeLease
        ? resumeStagingReleaseMutationLease({
          token: args.resumeLease,
          releaseCommit: commit,
          operationKind: "release-coordinator",
          bindings,
        })
        : acquireStagingReleaseMutationLease(
          createStagingReleaseMutationLeaseIntent({
            operationKind: "release-coordinator",
            releaseCommit: commit,
            bindings,
          }),
        ),
      release: async (token) => releaseStagingReleaseMutationLease(token),
    },
    async (lease) => {
      config.stagingMutationLease = lease;
      return await coordinateRelease();
    },
  );
  console.log(JSON.stringify({
    status: "passed",
    replay: result.replay,
    environment: "staging",
    commit,
    runtimeDigest: result.runtimeDigest,
    frontendDigest: result.frontendDigest,
    receipt: result.output,
  }, null, 2));
  return result.receipt;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`release coordination failed: ${error.message}`);
    process.exitCode = 1;
  });
}
