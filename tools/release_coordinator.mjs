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
import { revalidateCanonicalHostedVariables } from "./release_hosted_variable_authority.mjs";
import {
  TERMINAL_DEPLOYMENT_STATES,
  CANONICAL_RELEASE_TOPOLOGY,
  RELEASE_CLOCK_SKEW_MS,
  RELEASE_EVIDENCE_MAX_AGE_MS,
  assertFullCommit,
  assertImageDigest,
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
  canonicalReleaseFetchArguments,
  releaseGitEnvironment,
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
    else if (argument === "--schema-epoch-reset") result.schemaEpochReset = Number.parseInt(requiredValue(argv, ++index, argument), 10);
    else if (argument === "--output") result.output = requiredValue(argv, ++index, argument);
    else if (argument === "--check") result.check = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`unknown release coordinator argument: ${argument}`);
  }
  assert.ok(["staging", "production"].includes(result.environment), "--environment must be staging or production");
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

function releaseAttemptPath(environment, commit, promotionLeaseCommit = null) {
  return path.join(
    repoRoot,
    "target",
    "releases",
    environment,
    environment === "production"
      ? `${commit}.${promotionLeaseCommit}.attempt.json`
      : `${commit}.attempt.json`,
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
  const priorAttempt = await optionalJson(releaseAttemptPath("staging", commit));
  if (priorAttempt) {
    const attempt = bindReleaseAttempt({
      environment: "staging",
      commit,
      runtimeDigest: priorAttempt.images?.runtime,
      frontendDigest: priorAttempt.images?.frontend,
      fleetProof,
      topology: config.topology,
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
) {
  const attemptPath = path.join(
    releaseAttemptPath(environment, commit, promotionLeaseCommit),
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

async function revalidateHostedVariableAuthority(config) {
  return await revalidateCanonicalHostedVariables(config, {
    load: async (_config, environmentId, serviceId) =>
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
      ),
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
    revalidateHostedVariables = revalidateHostedVariableAuthority,
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

function latestDeployment(config, serviceId) {
  return railwayJson(config, ["deployment", "list", "--service", serviceId, "--limit", "1"])[0] ?? null;
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
    await withProductionMutationAuthority(config, () =>
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
  const imageReference = `${image}@${digest}`;
  await detachGitSource(config, serviceId, imageReference);
  if (variables && Object.keys(variables).length > 0) {
    const variablesData = await withProductionMutationAuthority(config, () =>
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
  const previousId = latestDeployment(config, serviceId)?.id ?? null;
  const updateData = await withProductionMutationAuthority(config, () =>
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
  const deployData = await withProductionMutationAuthority(
    config,
    () => railwayApi(
      "mutation Deploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }",
      { serviceId, environmentId: config.environmentId },
    ),
  );
  assert.equal(deployData.serviceInstanceDeploy, true, `${label} deployment was not started`);
  return await waitForNewDeployment(config, serviceId, previousId, digest, label, {
    allowTerminalFailure,
  });
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

export async function waitForNewDeployment(
  config,
  serviceId,
  previousId,
  expectedDigest,
  label,
  {
    load = () => latestDeployment(config, serviceId),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = 15 * 60 * 1_000,
    pollMilliseconds = 10_000,
    allowTerminalFailure = false,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const deployment = await load();
    if (deployment && deployment.id !== previousId) {
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
  throw new Error(`${label} did not reach a terminal deployment state in 15 minutes`);
}

async function waitForOneShotTerminal(
  config,
  serviceId,
  previousId,
  expectedDigest,
  label,
  {
    load = () => latestDeployment(config, serviceId),
    now = () => Date.now(),
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMilliseconds = 15 * 60 * 1_000,
    pollMilliseconds = 10_000,
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const deployment = await load();
    if (deployment && deployment.id !== previousId) {
      const actualDigest = deploymentImageDigest(deployment);
      if (actualDigest) {
        assert.equal(actualDigest, expectedDigest, `${label} started from an unexpected digest`);
      }
      if (TERMINAL_DEPLOYMENT_STATES.has(deployment.status)) return deployment;
    }
    await sleep(pollMilliseconds);
  }
  throw new Error(`${label} did not reach a terminal deployment state in 15 minutes`);
}

export async function recoverOneShotDeployment({
  previousDeploymentId,
  currentDeployment,
  awaitTerminal,
  readCompletion,
  redeploy,
  validateCandidate = () => {},
  label,
}) {
  if (!currentDeployment) {
    assert.equal(previousDeploymentId, null, `${label} recovery found no Railway deployment`);
  }
  let candidate = currentDeployment ?? { id: null, status: "BASELINE" };
  if (candidate.id === previousDeploymentId) {
    candidate = await redeploy();
  } else if (!TERMINAL_DEPLOYMENT_STATES.has(candidate.status)) {
    candidate = await awaitTerminal();
  }
  validateCandidate(candidate);

  if (candidate.status === "SUCCESS") {
    const completion = await readCompletion(candidate, { allowMissing: true });
    if (completion) return { deployment: candidate, completion, recovered: false };
  } else if (!["FAILED", "CRASHED"].includes(candidate.status)) {
    throw new Error(`${label} stopped in non-retryable state ${candidate.status}`);
  }

  const recovered = await redeploy();
  validateCandidate(recovered);
  assert.equal(recovered.status, "SUCCESS", `${label} recovery deployment is ${recovered.status}`);
  const completion = await readCompletion(recovered, { allowMissing: false });
  assert.ok(completion, `${label} recovery emitted no completion evidence`);
  return { deployment: recovered, completion, recovered: true };
}

function databaseIdentityVariables(config) {
  return {
    FMARCH_DATABASE_ENVIRONMENT: config.environment,
    FMARCH_DATABASE_PROJECT_ID: config.projectId,
    FMARCH_DATABASE_ENVIRONMENT_ID: config.environmentId,
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
    const completion = parseMigrationCompletion(await load());
    if (completion) {
      assert.equal(
        completion.release_commit,
        expectedCommit,
        "migration completion record does not match the release commit",
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

export function validateEpochResetAudit(audit, { environment, epoch, commit }) {
  assert.equal(audit?.kind, "fmarch-schema-epoch-reset-audit", "schema epoch reset audit kind drifted");
  assert.equal(audit.environment, environment, "schema epoch reset audit environment drifted");
  assert.equal(audit.epoch, epoch, "schema epoch reset audit epoch drifted");
  assert.equal(audit.release_commit, commit, "schema epoch reset audit commit drifted");
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

function epochResetOperation(config, digest, commit, epoch, auditEvidence) {
  const base = {
    version: 1,
    kind: "fmarch-schema-epoch-reset-operation",
    key: `${config.environment}:${epoch}:${commit}`,
    environment: config.environment,
    epoch,
    commit,
    runtime_digest: digest,
    audit_inventory_sha256: auditEvidence.inventory_sha256,
    expected_inventory: auditEvidence.prior_counts,
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
  const auditDeployment = await deployConfiguredImage(config, {
    serviceId,
    image: config.runtimeImage,
    digest,
    startCommand: "fmarch-schema-epoch-reset",
    label: `${config.environment} schema epoch reset audit`,
    deploymentPolicy: canonicalDeploymentPolicy("migrator"),
    variables: {
      ...databaseIdentityVariables(config),
      FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT: config.environment,
      FMARCH_SCHEMA_EPOCH_RESET_EPOCH: String(epoch),
      FMARCH_SCHEMA_EPOCH_RESET_CONFIRM: confirmation,
    },
  });
  const audit = (await waitForResetLogRows(
    config,
    auditDeployment.id,
    serviceId,
    ["audit"],
    "schema epoch reset audit deployment",
  )).audit;
  validateEpochResetAudit(audit, { environment: config.environment, epoch, commit });
  return {
    audit_deployment_id: auditDeployment.id,
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
  const deploy = () => deployConfiguredImage(config, {
      serviceId,
      image: config.runtimeImage,
      digest,
      startCommand: "fmarch-schema-epoch-reset --execute",
      label: `${config.environment} schema epoch reset`,
      deploymentPolicy: canonicalDeploymentPolicy("migrator"),
      variables: {
        ...databaseIdentityVariables(config),
        FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT: config.environment,
        FMARCH_SCHEMA_EPOCH_RESET_EPOCH: String(epoch),
        FMARCH_SCHEMA_EPOCH_RESET_CONFIRM: `${config.environment}:${epoch}:${commit}`,
        FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY: expectedInventory,
        FMARCH_SCHEMA_EPOCH_RESET_EXPECTED_INVENTORY_SHA256: plan.audit_inventory_sha256,
      },
      allowTerminalFailure: true,
    });
  const readCompletion = async (deployment, { allowMissing }) => {
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
      { environment: config.environment, epoch, commit },
    );
    assert.equal(parsed.audit.execute, true, "schema epoch reset execution audit is not mutating");
    assert.equal(parsed.complete.release_commit, commit);
    assert.equal(parsed.complete.environment, config.environment);
    assert.equal(parsed.complete.epoch, epoch);
    assert.deepEqual(
      parsed.complete.prior_counts,
      auditEvidence.prior_counts,
      "schema epoch reset execution no longer matches its greenfield audit",
    );
    return parsed;
  };
  const outcome = await recoverOneShotDeployment({
    previousDeploymentId: plan.previous_deployment_id,
    currentDeployment: latestDeployment(config, serviceId),
    awaitTerminal: () => waitForOneShotTerminal(
      config,
      serviceId,
      plan.previous_deployment_id,
      digest,
      `${config.environment} schema epoch reset recovery`,
    ),
    readCompletion,
    redeploy: deploy,
    validateCandidate: (deployment) => {
      assert.equal(
        deploymentImageDigest(deployment),
        digest,
        `${config.environment} schema epoch reset recovery digest drifted`,
      );
    },
    label: `${config.environment} schema epoch reset`,
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
    deployment_id: deployment.id,
    prior_counts: parsed.complete.prior_counts,
  };
  return {
    schema_epoch_reset: { ...base, receipt_sha256: receiptDigest(base) },
  };
}

async function deployOrRecoverMigrator(config, digest, commit, plan) {
  const serviceId = config.migratorServiceId;
  const deploy = () => deployConfiguredImage(config, {
      serviceId,
      image: config.runtimeImage,
      digest,
      startCommand: "fmarch-migrate",
      label: `${config.environment} migrator`,
      deploymentPolicy: canonicalDeploymentPolicy("migrator"),
      variables: databaseIdentityVariables(config),
      allowTerminalFailure: true,
    });
  const readCompletion = async (deployment, { allowMissing }) => {
    try {
      return await waitForMigrationCompletion(config, deployment.id, serviceId, commit);
    } catch (error) {
      if (allowMissing && /emitted no exact-commit completion record/u.test(error.message)) return null;
      throw error;
    }
  };
  const outcome = await recoverOneShotDeployment({
    previousDeploymentId: plan.previous_deployment_id,
    currentDeployment: latestDeployment(config, serviceId),
    awaitTerminal: () => waitForOneShotTerminal(
      config,
      serviceId,
      plan.previous_deployment_id,
      digest,
      `${config.environment} migrator recovery`,
    ),
    readCompletion,
    redeploy: deploy,
    validateCandidate: (deployment) => {
      assert.equal(
        deploymentImageDigest(deployment),
        digest,
        `${config.environment} migrator recovery digest drifted`,
      );
    },
    label: `${config.environment} migrator`,
  });
  const { deployment } = outcome;
  return {
    deployment: {
      id: deployment.id,
      status: "SUCCESS",
      meta: { imageDigest: digest },
    },
  };
}

async function coordinateEpochReset(config, digest, commit, epoch) {
  const currentAuditEvidence = await deployEpochResetAudit(config, digest, commit, epoch);
  const operation = epochResetOperation(
    config,
    digest,
    commit,
    epoch,
    currentAuditEvidence,
  );
  const journalDirectory = path.join(
    repoRoot,
    "target",
    "releases",
    config.environment,
    "schema-epoch-reset",
    `${commit}-epoch-${epoch}`,
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
    audit: async () => currentAuditEvidence,
    planReset: async (auditEvidence) => ({
      previous_deployment_id: latestDeployment(config, config.migratorServiceId)?.id ?? null,
      audit_inventory_sha256: auditEvidence.inventory_sha256,
      expected_inventory: auditEvidence.prior_counts,
    }),
    executeOrRecoverReset: (plan, auditEvidence) =>
      deployOrRecoverEpochReset(config, digest, commit, epoch, plan, auditEvidence),
    planMigration: async (resetEvidence) => ({
      previous_deployment_id: resetEvidence.schema_epoch_reset.deployment_id,
    }),
    executeOrRecoverMigration: (plan) =>
      deployOrRecoverMigrator(config, digest, commit, plan),
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

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log("Usage: node tools/release_coordinator.mjs --environment staging|production --commit <40-char-sha> --fleet-receipt <signed-fleet-envelope.json> --fleet-job <exact-job-id> [--fleet-public-key path] [--reuse-staging-receipt path] [--production-lock <lease-commit>] [--schema-epoch-reset N] [--check]");
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
  } else {
    await prepareAuthenticatedAcceptance(acceptanceEnv, {api: config.apiUrl, frontend: config.frontendUrl});
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
    migrator = await deployImage(
      config,
      config.migratorServiceId,
      config.runtimeImage,
      runtimeDigest,
      "fmarch-migrate",
      `${args.environment} migrator`,
      "migrator",
      databaseIdentityVariables(config),
    );
  }
  await waitForMigrationCompletion(
    config,
    migrator.id,
    config.migratorServiceId,
    commit,
  );
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
    deployImage(config, config.frontendServiceId, config.frontendImage, frontendDigest, "node build", `${args.environment} frontend`, "frontend"),
  ]);
  const [apiHealth, frontendHealth] = await Promise.all([
    fetchHealth(`${config.apiUrl}/readyz`, commit, "api", config.topology),
    fetchHealth(`${config.frontendUrl}/healthz`, commit, "frontend"),
  ]);
  const sentinel = args.environment === "staging"
    ? await runStagingSentinel(config, commit, runtimeDigest)
    : null;
  const hostedAcceptance = args.environment === 'staging' ? await runHostedAcceptance(acceptanceEnv) : null;
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
  const output = path.resolve(
    args.output ?? path.join(repoRoot, "target", "releases", args.environment, `${commit}.json`),
  );
  await withProductionMutationAuthority(config, () => publishImmutableJson(output, receipt));
  console.log(JSON.stringify({ status: "passed", environment: args.environment, commit, runtimeDigest, frontendDigest, receipt: output }, null, 2));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`release coordination failed: ${error.message}`);
    process.exitCode = 1;
  });
}
