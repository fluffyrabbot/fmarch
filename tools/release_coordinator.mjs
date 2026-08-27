import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  TERMINAL_DEPLOYMENT_STATES,
  assertFullCommit,
  assertImageDigest,
  assertReleaseReceipt,
  bindReleaseAttempt,
  buildReleaseReceipt,
  deploymentImageDigest,
  receiptDigest,
  validateDeploymentArtifact,
  validateHealth,
  validateProofReceipt,
  validateReleaseRepository,
} from "./release_coordinator_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const callerSession = `fmarch-release-${process.pid}`;
const defaults = Object.freeze({
  projectId: "9d285d67-c11b-4508-9efb-fad042787b4c",
  apiServiceId: "18b6f450-3739-4f21-8e01-f58c63cec834",
  frontendServiceId: "23787c98-db56-4ccc-869a-42dca74d7bc7",
  runtimeImage: "ghcr.io/fluffyrabbot/fmarch-runtime",
  frontendImage: "ghcr.io/fluffyrabbot/fmarch-frontend",
  stagingApiUrl: "https://fmarch-staging.up.railway.app",
  stagingFrontendUrl: "https://fmarch-frontend-staging.up.railway.app",
  productionApiUrl: "https://fmarch-production.up.railway.app",
  productionFrontendUrl: "https://fmarch-frontend-production.up.railway.app",
});

export function parseArguments(argv) {
  const result = { environment: "staging", check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment") result.environment = requiredValue(argv, ++index, argument);
    else if (argument === "--commit") result.commit = requiredValue(argv, ++index, argument);
    else if (argument === "--proof-receipt") result.proofReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--runtime-digest") result.runtimeDigest = requiredValue(argv, ++index, argument);
    else if (argument === "--frontend-digest") result.frontendDigest = requiredValue(argv, ++index, argument);
    else if (argument === "--reuse-staging-receipt") result.reuseStagingReceipt = requiredValue(argv, ++index, argument);
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

function runtimeConfig(environment, env = process.env) {
  const migratorServiceId = env.FMARCH_RAILWAY_MIGRATOR_SERVICE_ID;
  assert.match(
    migratorServiceId ?? "",
    /^[0-9a-f-]{36}$/iu,
    "FMARCH_RAILWAY_MIGRATOR_SERVICE_ID must name the migrator service",
  );
  return {
    projectId: env.FMARCH_RAILWAY_PROJECT_ID ?? defaults.projectId,
    environment,
    apiServiceId: env.FMARCH_RAILWAY_API_SERVICE_ID ?? defaults.apiServiceId,
    migratorServiceId,
    frontendServiceId: env.FMARCH_RAILWAY_FRONTEND_SERVICE_ID ?? defaults.frontendServiceId,
    runtimeImage: env.FMARCH_RUNTIME_IMAGE ?? defaults.runtimeImage,
    frontendImage: env.FMARCH_FRONTEND_IMAGE ?? defaults.frontendImage,
    apiUrl:
      environment === "staging"
        ? env.FMARCH_STAGING_API_URL ?? defaults.stagingApiUrl
        : env.FMARCH_PRODUCTION_API_URL ?? defaults.productionApiUrl,
    frontendUrl:
      environment === "staging"
        ? env.FMARCH_STAGING_FRONTEND_URL ?? defaults.stagingFrontendUrl
        : env.FMARCH_PRODUCTION_FRONTEND_URL ?? defaults.productionFrontendUrl,
  };
}

function commandText(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  }).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "inherit",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || "").trim().slice(-4_000);
    throw new Error(`${path.basename(command)} ${args[0] ?? ""} failed${diagnostic ? `: ${diagnostic}` : ""}`);
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
    RAILWAY_CALLER: "skill:use-railway@1.3.7",
    RAILWAY_AGENT_SESSION: callerSession,
  };
}

function validateRepository(commit, environment) {
  run("git", ["fetch", "--quiet", "origin", "main", "production"]);
  const head = commandText("git", ["rev-parse", "HEAD"]);
  const originMain = commandText("git", ["rev-parse", "origin/main"]);
  const originProduction = commandText("git", ["rev-parse", "origin/production"]);
  return validateReleaseRepository({
    status: commandText("git", ["status", "--porcelain"]),
    branch: commandText("git", ["branch", "--show-current"]),
    commit,
    head,
    originMain,
    originProduction,
    pushed: spawnSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"], { cwd: repoRoot }).status === 0,
    environment,
  });
}

async function discoverProofReceipt(commit, explicitPath) {
  if (explicitPath) {
    const receipt = JSON.parse(await readFile(path.resolve(explicitPath), "utf8"));
    validateProofReceipt(receipt, commit);
    return receipt;
  }
  const directory = path.join(repoRoot, "target", "proof-lanes", "runs");
  const candidates = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const receipt = JSON.parse(await readFile(path.join(directory, entry.name, "receipt.json"), "utf8"));
      if (
        receipt.state === "passed" &&
        receipt.context?.commit === commit &&
        receipt.context?.mode === "full"
      ) candidates.push(receipt);
    } catch {
      // Partial and interrupted proof directories are expected and ineligible.
    }
  }
  candidates.sort((left, right) => String(right.finished_at).localeCompare(String(left.finished_at)));
  assert.ok(candidates[0], `no passed full proof receipt exists for ${commit}`);
  validateProofReceipt(candidates[0], commit);
  return candidates[0];
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

function pullExistingImage(tag, commit) {
  const pull = spawnSync("podman", ["pull", "--platform", "linux/amd64", tag], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (pull.status !== 0) {
    const diagnostic = String(pull.stderr || pull.stdout);
    if (/manifest unknown|name unknown|not found|404/iu.test(diagnostic)) return null;
    throw new Error(`cannot inspect existing immutable image ${tag}: ${diagnostic.trim().slice(-2_000)}`);
  }
  const image = inspectLocalImage(tag);
  assert.equal(image.revision, commit, `${tag} exists but its revision label does not match`);
  assertImageDigest(image.digest, `${tag} digest`);
  return image.digest;
}

async function buildOrReuseImage({ repository, dockerfile, commit }) {
  const tag = `${repository}:${commit}`;
  const existing = pullExistingImage(tag, commit);
  if (existing) return existing;
  run("podman", [
    "build",
    "--platform",
    "linux/amd64",
    "--build-arg",
    `FMARCH_RELEASE_COMMIT=${commit}`,
    "--file",
    dockerfile,
    "--tag",
    tag,
    ".",
  ]);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "fmarch-image-push-"));
  try {
    const digestFile = path.join(temporary, "digest");
    run("podman", ["push", "--digestfile", digestFile, tag]);
    const digest = (await readFile(digestFile, "utf8")).trim();
    assertImageDigest(digest, `${repository} pushed digest`);
    const pulled = pullExistingImage(tag, commit);
    assert.equal(pulled, digest, `${repository} registry digest changed after push`);
    return digest;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function resolveArtifacts(args, config, commit) {
  if (args.reuseStagingReceipt) {
    const receipt = assertReleaseReceipt(
      JSON.parse(await readFile(path.resolve(args.reuseStagingReceipt), "utf8")),
    );
    assert.equal(receipt.environment, "staging", "production can reuse only a staging receipt");
    assert.equal(receipt.commit, commit, "staging receipt commit does not match production release");
    return { runtimeDigest: receipt.images.runtime, frontendDigest: receipt.images.frontend };
  }
  if (args.runtimeDigest || args.frontendDigest) {
    assert.ok(args.runtimeDigest && args.frontendDigest, "both image digests must be supplied together");
    return {
      runtimeDigest: assertImageDigest(args.runtimeDigest, "runtime digest"),
      frontendDigest: assertImageDigest(args.frontendDigest, "frontend digest"),
    };
  }
  assert.equal(args.environment, "staging", "production must reuse exact staging image digests");
  const [runtimeDigest, frontendDigest] = await Promise.all([
    buildOrReuseImage({ repository: config.runtimeImage, dockerfile: "Dockerfile", commit }),
    buildOrReuseImage({ repository: config.frontendImage, dockerfile: "Dockerfile.frontend", commit }),
  ]);
  return { runtimeDigest, frontendDigest };
}

async function bindAttempt(environment, commit, runtimeDigest, frontendDigest) {
  const attemptPath = path.join(
    repoRoot,
    "target",
    "releases",
    environment,
    `${commit}.attempt.json`,
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
    existing,
  });
  if (!existing) {
    await mkdir(path.dirname(attemptPath), { recursive: true });
    await writeFile(attemptPath, `${JSON.stringify(attempt, null, 2)}\n`, { flag: "wx" });
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
    config.environment,
    "--json",
  ], { env: scrubHostedEnvironment(process.env) });
}

function latestDeployment(config, serviceId) {
  return railwayJson(config, ["deployment", "list", "--service", serviceId, "--limit", "1"])[0] ?? null;
}

export function serviceSourceCutoverAction(source) {
  if (source?.repo === "fluffyrabbot/fmarch" && source.image == null) return "disconnect";
  if (source?.repo == null && typeof source?.image === "string") return "ready";
  throw new Error("Railway service source is neither canonical Git nor an image source");
}

async function ensureImageSource(config, serviceId) {
  const services = railwayJson(config, ["service", "list"]);
  const service = services.find((candidate) => candidate.id === serviceId);
  assert.ok(service, `Railway service ${serviceId} does not exist in ${config.environment}`);
  if (serviceSourceCutoverAction(service.source) === "ready") return;
  railwayJson(config, ["service", "source", "disconnect", "--service", serviceId]);
  const updated = railwayJson(config, ["service", "list"])
    .find((candidate) => candidate.id === serviceId);
  assert.equal(updated?.source?.repo ?? null, null, `Railway service ${serviceId} retained its Git source`);
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
  } = {},
) {
  const deadline = now() + timeoutMilliseconds;
  while (now() < deadline) {
    const deployment = await load();
    if (deployment && deployment.id !== previousId) {
      const digest = deploymentImageDigest(deployment);
      if (TERMINAL_DEPLOYMENT_STATES.has(deployment.status)) {
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

async function deployImage(config, serviceId, image, digest, label) {
  await ensureImageSource(config, serviceId);
  const previousId = latestDeployment(config, serviceId)?.id ?? null;
  railwayJson(config, [
    "environment",
    "edit",
    "--service-config",
    serviceId,
    "source.image",
    `${image}@${digest}`,
    "--message",
    `Release ${label} ${digest}`,
  ]);
  return await waitForNewDeployment(config, serviceId, previousId, digest, label);
}

export function parseResetLogRows(output) {
  const messages = String(output)
    .trim()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line);
        const message = String(row.message ?? row);
        const start = message.indexOf("{");
        return start < 0 ? [] : [JSON.parse(message.slice(start))];
      } catch {
        return [];
      }
    });
  return {
    audit: messages.find((message) => message.kind === "fmarch-schema-epoch-reset-audit"),
    complete: messages.find((message) => message.kind === "fmarch-schema-epoch-reset-complete"),
  };
}

export function validateEpochResetAudit(audit, { environment, epoch, commit }) {
  assert.equal(audit?.kind, "fmarch-schema-epoch-reset-audit", "schema epoch reset audit kind drifted");
  assert.equal(audit.environment, environment, "schema epoch reset audit environment drifted");
  assert.equal(audit.epoch, epoch, "schema epoch reset audit epoch drifted");
  assert.equal(audit.release_commit, commit, "schema epoch reset audit commit drifted");
  assert.equal(audit.execute, false, "pre-reset audit must not mutate the database");
  for (const field of ["platform_principal", "member_profile", "profile_mute"]) {
    assert.equal(
      Number(audit.counts?.[field]),
      0,
      `schema epoch reset refuses non-greenfield ${field} state`,
    );
  }
  return audit;
}

async function deployEpochReset(config, digest, commit, epoch) {
  const serviceId = config.migratorServiceId;
  await ensureImageSource(config, serviceId);
  const confirmation = `${config.environment}:${epoch}:${commit}`;
  const previousId = latestDeployment(config, serviceId)?.id ?? null;
  railwayJson(config, [
    "environment",
    "edit",
    "--service-config",
    serviceId,
    "source.image",
    `${config.runtimeImage}@${digest}`,
    "--service-config",
    serviceId,
    "deploy.startCommand",
    "fmarch-schema-epoch-reset",
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT.value",
    config.environment,
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_EPOCH.value",
    String(epoch),
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_CONFIRM.value",
    confirmation,
    "--message",
    `Audit ${config.environment} schema before epoch ${epoch} reset at ${commit}`,
  ]);
  const auditDeployment = await waitForNewDeployment(
    config,
    serviceId,
    previousId,
    digest,
    `${config.environment} schema epoch reset audit`,
  );
  const auditLogs = railwayText(config, [
    "logs",
    auditDeployment.id,
    "--service",
    serviceId,
    "--lines",
    "200",
  ]);
  const audit = parseResetLogRows(auditLogs).audit;
  assert.ok(audit, "schema epoch reset audit deployment emitted no audit record");
  validateEpochResetAudit(audit, { environment: config.environment, epoch, commit });

  railwayJson(config, [
    "environment",
    "edit",
    "--service-config",
    serviceId,
    "deploy.startCommand",
    "fmarch-schema-epoch-reset --execute",
    "--message",
    `Reset ${config.environment} schema epoch ${epoch} at ${commit}`,
  ]);
  const deployment = await waitForNewDeployment(
    config,
    serviceId,
    auditDeployment.id,
    digest,
    `${config.environment} schema epoch reset`,
  );
  const resetLogs = railwayText(config, [
    "logs",
    deployment.id,
    "--service",
    serviceId,
    "--lines",
    "200",
  ]);
  const parsed = parseResetLogRows(resetLogs);
  assert.ok(parsed.audit, "schema epoch reset deployment emitted no audit record");
  assert.ok(parsed.complete, "schema epoch reset deployment emitted no completion record");
  assert.equal(parsed.complete.release_commit, commit);
  assert.equal(parsed.complete.environment, config.environment);
  assert.equal(parsed.complete.epoch, epoch);
  const base = {
    version: 1,
    kind: "fmarch-schema-epoch-reset",
    environment: config.environment,
    epoch,
    commit,
    runtime_digest: digest,
    audit_deployment_id: auditDeployment.id,
    deployment_id: deployment.id,
    prior_counts: parsed.complete.prior_counts,
  };
  return { ...base, receipt_sha256: receiptDigest(base) };
}

async function deployMigratorAfterReset(config, digest, resetDeploymentId) {
  const serviceId = config.migratorServiceId;
  railwayJson(config, [
    "environment",
    "edit",
    "--service-config",
    serviceId,
    "source.image",
    `${config.runtimeImage}@${digest}`,
    "--service-config",
    serviceId,
    "deploy.startCommand",
    "fmarch-migrate",
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_ENVIRONMENT.value",
    "null",
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_EPOCH.value",
    "null",
    "--service-config",
    serviceId,
    "variables.FMARCH_SCHEMA_EPOCH_RESET_CONFIRM.value",
    "null",
    "--message",
    `Restore ${config.environment} migrator after schema epoch reset`,
  ]);
  return await waitForNewDeployment(
    config,
    serviceId,
    resetDeploymentId,
    digest,
    `${config.environment} migrator`,
  );
}

async function fetchHealth(url, commit, kind) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.ok, true, `${kind} health returned ${response.status}`);
  const body = await response.json();
  validateHealth(body, commit, kind);
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
    config.environment,
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
  run("npm", ["run", "run:public-search-staging-sentinel", "--", "--expected-commit", commit, "--expected-image-digest", runtimeDigest], {
    env: scrubHostedEnvironment(process.env),
  });
  const receiptPath = path.join(repoRoot, "target", "public-search-staging-sentinel", "receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  assert.equal(receipt.status, "passed", "public-search staging sentinel did not pass");
  return {
    status: receipt.status,
    receipt_sha256: receipt.receipt_sha256 ?? null,
    corpus,
  };
}

async function schemaHead() {
  try {
    const epoch = JSON.parse(
      await readFile(path.join(repoRoot, "crates", "database_schema", "schema", "epoch.json"), "utf8"),
    );
    return epoch.migrations.at(-1).filename;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const migrations = (await readdir(
      path.join(repoRoot, "crates", "database_schema", "migrations"),
    )).filter((filename) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(filename)).sort();
    assert.ok(migrations.length > 0, "release has no database migration head");
    return migrations.at(-1);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log("Usage: node tools/release_coordinator.mjs --environment staging|production --commit <40-char-sha> [--proof-receipt path] [--reuse-staging-receipt path] [--schema-epoch-reset N] [--check]");
    return;
  }
  const commit = assertFullCommit(args.commit ?? commandText("git", ["rev-parse", "HEAD"]));
  validateRepository(commit, args.environment);
  const proofReceipt = await discoverProofReceipt(commit, args.proofReceipt);
  const config = runtimeConfig(args.environment);
  if (args.check) {
    console.log(`release coordination check passed for ${args.environment} ${commit}`);
    return;
  }
  const { runtimeDigest, frontendDigest } = await resolveArtifacts(args, config, commit);
  const attemptReceipt = await bindAttempt(
    args.environment,
    commit,
    runtimeDigest,
    frontendDigest,
  );
  let schemaEpochReset = null;
  let migrator;
  if (args.schemaEpochReset !== undefined) {
    schemaEpochReset = await deployEpochReset(
      config,
      runtimeDigest,
      commit,
      args.schemaEpochReset,
    );
    migrator = await deployMigratorAfterReset(
      config,
      runtimeDigest,
      schemaEpochReset.deployment_id,
    );
  } else {
    migrator = await deployImage(
      config,
      config.migratorServiceId,
      config.runtimeImage,
      runtimeDigest,
      `${args.environment} migrator`,
    );
  }
  const [api, frontend] = await Promise.all([
    deployImage(config, config.apiServiceId, config.runtimeImage, runtimeDigest, `${args.environment} API`),
    deployImage(config, config.frontendServiceId, config.frontendImage, frontendDigest, `${args.environment} frontend`),
  ]);
  const [apiHealth, frontendHealth] = await Promise.all([
    fetchHealth(`${config.apiUrl}/readyz`, commit, "api"),
    fetchHealth(`${config.frontendUrl}/healthz`, commit, "frontend"),
  ]);
  const sentinel = args.environment === "staging"
    ? await runStagingSentinel(config, commit, runtimeDigest)
    : null;
  const receipt = buildReleaseReceipt({
    environment: args.environment,
    commit,
    runtimeDigest,
    frontendDigest,
    deployments: { migrator, api, frontend },
    health: { api: apiHealth, frontend: frontendHealth },
    schemaHead: await schemaHead(),
    proofReceipt,
    attemptReceipt,
    sentinel,
    schemaEpochReset,
  });
  const output = path.resolve(
    args.output ?? path.join(repoRoot, "target", "releases", args.environment, `${commit}.json`),
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: "passed", environment: args.environment, commit, runtimeDigest, frontendDigest, receipt: output }, null, 2));
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`release coordination failed: ${error.message}`);
    process.exitCode = 1;
  });
}
