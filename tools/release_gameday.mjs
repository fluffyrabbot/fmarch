import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  deploymentImageDigest,
  validateDeploymentArtifact,
  validateHealth,
} from "./release_coordinator_contract.mjs";
import {
  canonicalDeploymentPolicy,
  parseMigrationCompletion,
} from "./release_coordinator.mjs";
import {
  assertGameDayReceipt,
  buildGameDayReceipt,
  validateGameDayInputs,
} from "./release_gameday_contract.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const railwayEnvironment = Object.freeze({
  projectId: "9d285d67-c11b-4508-9efb-fad042787b4c",
  environmentId: "e109e500-2a4c-48a3-96f2-e92a9edb63e4",
  environment: "staging",
  migratorServiceId: "7c2c2665-2be2-4938-84e5-7580a964d610",
  apiServiceId: "18b6f450-3739-4f21-8e01-f58c63cec834",
  frontendServiceId: "23787c98-db56-4ccc-869a-42dca74d7bc7",
  runtimeImage: "ghcr.io/fluffyrabbot/fmarch-runtime",
  frontendImage: "ghcr.io/fluffyrabbot/fmarch-frontend",
  apiHealthUrl: "https://fmarch-staging.up.railway.app/readyz",
  frontendHealthUrl: "https://fmarch-frontend-staging.up.railway.app/healthz",
});
const terminalStates = new Set([
  "SUCCESS",
  "FAILED",
  "CRASHED",
  "NEEDS_APPROVAL",
  "SLEEPING",
  "SKIPPED",
  "REMOVED",
  "REMOVING",
]);

function parseArguments(argv) {
  const result = { execute: false, delaySeconds: 15 };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--current-receipt") result.currentReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--rollback-receipt") result.rollbackReceipt = requiredValue(argv, ++index, argument);
    else if (argument === "--confirm") result.confirmation = requiredValue(argv, ++index, argument);
    else if (argument === "--delay-seconds") result.delaySeconds = Number(requiredValue(argv, ++index, argument));
    else if (argument === "--output") result.output = requiredValue(argv, ++index, argument);
    else if (argument === "--execute") result.execute = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else throw new Error(`unknown release game-day argument: ${argument}`);
  }
  assert.ok(Number.isInteger(result.delaySeconds) && result.delaySeconds >= 10 && result.delaySeconds <= 60);
  return result;
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function hostedEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("PG") || key.includes("PASSWORD") || key.includes("DATABASE_URL") || key.includes("PRIVATE_KEY")) {
      delete env[key];
    }
  }
  return {
    ...env,
    RAILWAY_CALLER: "skill:use-railway@1.3.7",
    RAILWAY_AGENT_SESSION: `fmarch-release-gameday-${process.pid}`,
  };
}

function commandText(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: hostedEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || "").trim().slice(-4_000);
    throw new Error(`${path.basename(command)} ${args[0] ?? ""} failed${diagnostic ? `: ${diagnostic}` : ""}`);
  }
  return { status: result.status, output: String(result.stdout ?? "").trim() };
}

function railwayJson(args) {
  const { output } = commandText("railway", [
    ...args,
    "--project",
    railwayEnvironment.projectId,
    "--environment",
    railwayEnvironment.environment,
    "--json",
  ]);
  return output ? JSON.parse(output) : null;
}

function railwayApi(query, variables) {
  const { output } = commandText("railway", [
    "api",
    query,
    "--variables",
    JSON.stringify(variables),
    "--compact",
  ]);
  const response = JSON.parse(output);
  assert.equal(response.errors, undefined, "Railway GraphQL API returned errors");
  return response.data;
}

function latestDeployment(serviceId) {
  return railwayJson(["deployment", "list", "--service", serviceId, "--limit", "1"])[0] ?? null;
}

function deploymentLogs(deploymentId, serviceId) {
  return commandText("railway", [
    "logs",
    deploymentId,
    "--project",
    railwayEnvironment.projectId,
    "--environment",
    railwayEnvironment.environment,
    "--service",
    serviceId,
    "--lines",
    "200",
    "--json",
  ]).output;
}

async function waitForMigrationEvidence(deploymentId, expectedCommit, timeoutMilliseconds = 60_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const completion = parseMigrationCompletion(
      deploymentLogs(deploymentId, railwayEnvironment.migratorServiceId),
    );
    if (completion) {
      assert.equal(completion.release_commit, expectedCommit, "migration evidence commit drifted");
      return completion;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("migrator emitted no exact-commit completion evidence");
}

async function assertNoMigrationEvidence(deploymentId, observationMilliseconds = 12_000) {
  const deadline = Date.now() + observationMilliseconds;
  while (Date.now() < deadline) {
    assert.equal(
      parseMigrationCompletion(deploymentLogs(deploymentId, railwayEnvironment.migratorServiceId)),
      null,
      "failed migrator unexpectedly emitted completion evidence",
    );
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
}

function serviceSnapshot() {
  return railwayJson(["service", "list"]);
}

function serviceById(services, serviceId) {
  const service = services.find((candidate) => candidate.id === serviceId);
  assert.ok(service, `Railway service ${serviceId} is missing from staging`);
  return service;
}

function exactImage(repository, digest) {
  return `${repository}@${digest}`;
}

function updateAndStart({ serviceId, image, digest, startCommand, policy }) {
  const previousId = latestDeployment(serviceId)?.id ?? null;
  const updated = railwayApi(
    "mutation Update($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input) }",
    {
      serviceId,
      environmentId: railwayEnvironment.environmentId,
      input: {
        source: { image: exactImage(image, digest) },
        startCommand,
        railwayConfigFile: null,
        ...policy,
      },
    },
  );
  assert.equal(updated.serviceInstanceUpdate, true, "Railway service policy update failed");
  const deployed = railwayApi(
    "mutation Deploy($serviceId: String!, $environmentId: String!) { serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId) }",
    { serviceId, environmentId: railwayEnvironment.environmentId },
  );
  assert.equal(deployed.serviceInstanceDeploy, true, "Railway service deployment did not start");
  return previousId;
}

async function waitForDeployment({ serviceId, previousId, digest, statuses, timeoutMilliseconds = 5 * 60_000 }) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const deployment = latestDeployment(serviceId);
    if (deployment && deployment.id !== previousId) {
      const actualDigest = deploymentImageDigest(deployment);
      if (actualDigest) assert.equal(actualDigest, digest, "Railway started the wrong injected artifact");
      if (terminalStates.has(deployment.status)) {
        assert.ok(statuses.includes(deployment.status), `deployment terminated as ${deployment.status}`);
        return deployment;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Railway deployment did not reach the expected terminal state");
}

async function deployAndWait({ serviceId, image, digest, startCommand, policy, statuses = ["SUCCESS"] }) {
  const previousId = updateAndStart({ serviceId, image, digest, startCommand, policy });
  return await waitForDeployment({ serviceId, previousId, digest, statuses });
}

async function health(url, commit, kind) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.ok, true, `${kind} health returned ${response.status}`);
  const body = await response.json();
  validateHealth(body, commit, kind);
  return body;
}

async function assertServing(commit) {
  const [api, frontend] = await Promise.all([
    health(railwayEnvironment.apiHealthUrl, commit, "api"),
    health(railwayEnvironment.frontendHealthUrl, commit, "frontend"),
  ]);
  return { api, frontend };
}

function assertUnchangedServingDeployments(before) {
  const after = serviceSnapshot();
  assert.equal(
    serviceById(after, railwayEnvironment.apiServiceId).deploymentId,
    before.api,
    "migrator failure replaced the serving API deployment",
  );
  assert.equal(
    serviceById(after, railwayEnvironment.frontendServiceId).deploymentId,
    before.frontend,
    "migrator failure replaced the serving frontend deployment",
  );
}

async function measureScenario(name, run) {
  const started = new Date();
  const startedMilliseconds = Date.now();
  const details = await run();
  const finished = new Date();
  return {
    name,
    status: "passed",
    started_at: started.toISOString(),
    finished_at: finished.toISOString(),
    duration_milliseconds: Date.now() - startedMilliseconds,
    ...details,
  };
}

async function deployCanonicalMigrator(receipt) {
  const deployment = await deployAndWait({
    serviceId: railwayEnvironment.migratorServiceId,
    image: railwayEnvironment.runtimeImage,
    digest: receipt.images.runtime,
    startCommand: "fmarch-migrate",
    policy: canonicalDeploymentPolicy("migrator"),
  });
  await waitForMigrationEvidence(deployment.id, receipt.commit);
  return deployment;
}

async function deployApplication(receipt) {
  const [api, frontend] = await Promise.all([
    deployAndWait({
      serviceId: railwayEnvironment.apiServiceId,
      image: railwayEnvironment.runtimeImage,
      digest: receipt.images.runtime,
      startCommand: "fmarch-server",
      policy: canonicalDeploymentPolicy("api"),
    }),
    deployAndWait({
      serviceId: railwayEnvironment.frontendServiceId,
      image: railwayEnvironment.frontendImage,
      digest: receipt.images.frontend,
      startCommand: "node build",
      policy: canonicalDeploymentPolicy("frontend"),
    }),
  ]);
  await assertServing(receipt.commit);
  return { api, frontend };
}

async function runSearchSentinel(receipt) {
  commandText("node", ["tools/public_search_staging_canary.mjs"]);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = commandText("node", [
      "tools/public_search_staging_sentinel.mjs",
      "--expected-commit",
      receipt.commit,
      "--expected-image-digest",
      receipt.images.runtime,
    ], { allowFailure: true });
    const sentinel = JSON.parse(await readFile(
      path.join(repoRoot, "target", "public-search-staging-sentinel", "receipt.json"),
      "utf8",
    ));
    if (result.status === 0 && sentinel.status === "passed") return sentinel;
    assert.equal(sentinel.status, "insufficient", "search sentinel failed after game-day restore");
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("search telemetry remained insufficient after game-day restore");
}

function verifyPlatformSources(receipt) {
  const services = serviceSnapshot();
  const migrator = serviceById(services, railwayEnvironment.migratorServiceId);
  const api = serviceById(services, railwayEnvironment.apiServiceId);
  const frontend = serviceById(services, railwayEnvironment.frontendServiceId);
  assert.equal(migrator.source?.image, exactImage(railwayEnvironment.runtimeImage, receipt.images.runtime));
  assert.equal(api.source?.image, exactImage(railwayEnvironment.runtimeImage, receipt.images.runtime));
  assert.equal(frontend.source?.image, exactImage(railwayEnvironment.frontendImage, receipt.images.frontend));
  return { migrator, api, frontend };
}

async function recoverCurrentRelease(receipt) {
  await deployCanonicalMigrator(receipt);
  await deployApplication(receipt);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  if (args.help) {
    console.log("Usage: node tools/release_gameday.mjs --current-receipt PATH --rollback-receipt PATH --confirm staging:<current-sha> [--delay-seconds 15] [--output PATH] [--execute]");
    return;
  }
  assert.ok(args.currentReceipt, "--current-receipt is required");
  assert.ok(args.rollbackReceipt, "--rollback-receipt is required");
  const currentReceipt = JSON.parse(await readFile(path.resolve(args.currentReceipt), "utf8"));
  const rollbackReceipt = JSON.parse(await readFile(path.resolve(args.rollbackReceipt), "utf8"));
  validateGameDayInputs({ currentReceipt, rollbackReceipt, confirmation: args.confirmation });
  verifyPlatformSources(currentReceipt);
  await assertServing(currentReceipt.commit);
  if (!args.execute) {
    console.log(JSON.stringify({
      status: "checked",
      environment: "staging",
      current_commit: currentReceipt.commit,
      rollback_commit: rollbackReceipt.commit,
      mutation_required: true,
    }, null, 2));
    return;
  }

  const initialServices = serviceSnapshot();
  const servingBeforeMigratorDrills = {
    api: serviceById(initialServices, railwayEnvironment.apiServiceId).deploymentId,
    frontend: serviceById(initialServices, railwayEnvironment.frontendServiceId).deploymentId,
  };
  const scenarios = {};
  let restored = false;
  try {
    scenarios.delayed_migrator = await measureScenario("delayed_migrator", async () => {
      const deployment = await deployAndWait({
        serviceId: railwayEnvironment.migratorServiceId,
        image: railwayEnvironment.runtimeImage,
        digest: currentReceipt.images.runtime,
        startCommand: `/bin/sh -c "sleep ${args.delaySeconds}; exec fmarch-migrate"`,
        policy: canonicalDeploymentPolicy("migrator"),
      });
      await waitForMigrationEvidence(deployment.id, currentReceipt.commit);
      assertUnchangedServingDeployments(servingBeforeMigratorDrills);
      await assertServing(currentReceipt.commit);
      return { deployment_id: deployment.id, injected_delay_seconds: args.delaySeconds };
    });

    scenarios.failed_migrator = await measureScenario("failed_migrator", async () => {
      const deployment = await deployAndWait({
        serviceId: railwayEnvironment.migratorServiceId,
        image: railwayEnvironment.runtimeImage,
        digest: currentReceipt.images.runtime,
        startCommand: "/bin/false",
        policy: canonicalDeploymentPolicy("migrator"),
        statuses: ["SUCCESS"],
      });
      await assertNoMigrationEvidence(deployment.id);
      assertUnchangedServingDeployments(servingBeforeMigratorDrills);
      await assertServing(currentReceipt.commit);
      return {
        deployment_id: deployment.id,
        platform_terminal_status: deployment.status,
        completion_record_observed: false,
      };
    });

    scenarios.exact_digest_retry = await measureScenario("exact_digest_retry", async () => {
      const deployment = await deployCanonicalMigrator(currentReceipt);
      return { deployment_id: deployment.id, runtime_digest: currentReceipt.images.runtime };
    });

    scenarios.api_readiness_failure = await measureScenario("api_readiness_failure", async () => {
      const policy = {
        ...canonicalDeploymentPolicy("api"),
        healthcheckTimeout: 20,
        restartPolicyType: "NEVER",
        restartPolicyMaxRetries: 0,
      };
      const deployment = await deployAndWait({
        serviceId: railwayEnvironment.apiServiceId,
        image: railwayEnvironment.runtimeImage,
        digest: currentReceipt.images.runtime,
        startCommand: "sleep 300",
        policy,
        statuses: ["FAILED", "CRASHED"],
      });
      await assertServing(currentReceipt.commit);
      return { deployment_id: deployment.id, terminal_status: deployment.status, healthcheck_path: "/readyz" };
    });

    let wrongDigestDeployment;
    scenarios.wrong_digest_detection = await measureScenario("wrong_digest_detection", async () => {
      wrongDigestDeployment = await deployAndWait({
        serviceId: railwayEnvironment.apiServiceId,
        image: railwayEnvironment.runtimeImage,
        digest: rollbackReceipt.images.runtime,
        startCommand: "fmarch-server",
        policy: canonicalDeploymentPolicy("api"),
      });
      assert.throws(
        () => validateDeploymentArtifact(wrongDigestDeployment, currentReceipt.images.runtime, "game-day API"),
        /expected OCI digest/,
      );
      return {
        deployment_id: wrongDigestDeployment.id,
        expected_digest: currentReceipt.images.runtime,
        observed_digest: deploymentImageDigest(wrongDigestDeployment),
      };
    });

    scenarios.application_rollback = await measureScenario("application_rollback", async () => {
      const frontend = await deployAndWait({
        serviceId: railwayEnvironment.frontendServiceId,
        image: railwayEnvironment.frontendImage,
        digest: rollbackReceipt.images.frontend,
        startCommand: "node build",
        policy: canonicalDeploymentPolicy("frontend"),
      });
      await assertServing(rollbackReceipt.commit);
      return {
        api_deployment_id: wrongDigestDeployment.id,
        frontend_deployment_id: frontend.id,
        release_commit: rollbackReceipt.commit,
        migration_reversal_attempted: false,
        schema_head: currentReceipt.schema_head,
      };
    });

    scenarios.current_release_restore = await measureScenario("current_release_restore", async () => {
      const deployments = await deployApplication(currentReceipt);
      return {
        api_deployment_id: deployments.api.id,
        frontend_deployment_id: deployments.frontend.id,
        release_commit: currentReceipt.commit,
      };
    });
    const sentinel = await runSearchSentinel(currentReceipt);
    const finalServices = verifyPlatformSources(currentReceipt);
    await assertServing(currentReceipt.commit);
    restored = true;
    const finalState = {
      environment: "staging",
      release_commit: currentReceipt.commit,
      runtime_digest: currentReceipt.images.runtime,
      frontend_digest: currentReceipt.images.frontend,
      migrator_deployment_id: finalServices.migrator.deploymentId,
      api_deployment_id: finalServices.api.deploymentId,
      frontend_deployment_id: finalServices.frontend.deploymentId,
      api_ready: true,
      frontend_healthy: true,
      search_sentinel: sentinel.status,
      search_sentinel_receipt_sha256: sentinel.receipt_sha256,
      schema_head: currentReceipt.schema_head,
    };
    const receipt = buildGameDayReceipt({ currentReceipt, rollbackReceipt, scenarios, finalState });
    assertGameDayReceipt(receipt);
    const output = path.resolve(
      args.output ?? path.join(repoRoot, "target", "releases", "staging", `${currentReceipt.commit}.game-day.json`),
    );
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ status: "passed", environment: "staging", receipt: output, receipt_sha256: receipt.receipt_sha256 }, null, 2));
  } finally {
    if (!restored) {
      console.error("release game day interrupted; restoring the exact current staging release");
      await recoverCurrentRelease(currentReceipt);
      console.error("exact current staging release restored");
    }
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  main().catch((error) => {
    console.error(`release game day failed: ${error.message}`);
    process.exitCode = 1;
  });
}
