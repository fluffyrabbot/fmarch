import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULTS = Object.freeze({
  projectId: "9d285d67-c11b-4508-9efb-fad042787b4c",
  apiServiceId: "18b6f450-3739-4f21-8e01-f58c63cec834",
  frontendServiceId: "23787c98-db56-4ccc-869a-42dca74d7bc7",
  stagingEnvironment: "staging",
  productionEnvironment: "production",
  stagingApiUrl: "https://fmarch-staging.up.railway.app",
  stagingFrontendUrl: "https://fmarch-frontend-staging.up.railway.app",
  productionApiUrl: "https://fmarch-production.up.railway.app",
  productionFrontendUrl: "https://fmarch-frontend-production.up.railway.app",
  localDatabaseUrl: "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch",
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

export function parseArguments(argv) {
  const unknown = argv.filter((argument) => argument !== "--check");
  assert.deepEqual(unknown, [], `unknown production promotion argument: ${unknown.join(", ")}`);
  return { checkOnly: argv.includes("--check") };
}

export function validateRepositoryState({
  status,
  branch,
  head,
  originMain,
  productionIsAncestor,
}) {
  assert.equal(status, "", "production promotion requires a clean worktree");
  assert.equal(branch, "main", "production promotion must run from main");
  assert.equal(head, originMain, "HEAD must equal origin/main before production promotion");
  assert.equal(
    productionIsAncestor,
    true,
    "origin/production must be an ancestor of the promoted main commit",
  );
}

export function validateServiceBranches(config, expectedBranch, serviceIds = DEFAULTS) {
  const services = config.services ?? config;
  for (const serviceId of [serviceIds.apiServiceId, serviceIds.frontendServiceId]) {
    assert.equal(
      services[serviceId]?.source?.branch,
      expectedBranch,
      `Railway service ${serviceId} must watch ${expectedBranch}`,
    );
  }
}

export function validateHostedVariables({ stagingApi, stagingFrontend, productionApi, productionFrontend }) {
  for (const [name, variables, required] of [
    [
      "production API",
      productionApi,
      ["DATABASE_URL", "WORKOS_CLIENT_ID", "WORKOS_ISSUER", "WORKOS_JWKS_URL"],
    ],
    [
      "production frontend",
      productionFrontend,
      [
        "FMARCH_API_BASE_URL",
        "FMARCH_API_INTERNAL_URL",
        "ORIGIN",
        "WORKOS_API_KEY",
        "WORKOS_CLIENT_ID",
        "WORKOS_COOKIE_PASSWORD",
        "WORKOS_REDIRECT_URI",
      ],
    ],
  ]) {
    for (const key of required) {
      assert.ok(variables[key], `${name} is missing ${key}`);
    }
    assert.equal(variables.FMARCH_DEV_AUTH, undefined, `${name} must not enable FMARCH_DEV_AUTH`);
    assert.equal(
      variables.FMARCH_FRONTEND_FIXTURE_SESSION,
      undefined,
      `${name} must not enable fixture sessions`,
    );
  }

  assert.equal(productionFrontend.FMARCH_API_BASE_URL, DEFAULTS.productionApiUrl);
  assert.equal(productionFrontend.ORIGIN, DEFAULTS.productionFrontendUrl);
  assert.equal(
    productionFrontend.WORKOS_REDIRECT_URI,
    `${DEFAULTS.productionFrontendUrl}/auth/callback`,
  );
  assert.equal(
    productionApi.WORKOS_CLIENT_ID,
    productionFrontend.WORKOS_CLIENT_ID,
    "production API and frontend must use the same WorkOS client",
  );
  assert.notEqual(productionApi.WORKOS_CLIENT_ID, stagingApi.WORKOS_CLIENT_ID);
  assert.notEqual(productionFrontend.WORKOS_CLIENT_ID, stagingFrontend.WORKOS_CLIENT_ID);
  assert.notEqual(productionFrontend.WORKOS_API_KEY, stagingFrontend.WORKOS_API_KEY);
  assert.notEqual(
    productionFrontend.WORKOS_COOKIE_PASSWORD,
    stagingFrontend.WORKOS_COOKIE_PASSWORD,
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

export function localProofRuntime(env) {
  if (env.DATABASE_URL) {
    return { startLocalPostgres: false, env: { ...env } };
  }
  return {
    startLocalPostgres: true,
    env: { ...env, DATABASE_URL: DEFAULTS.localDatabaseUrl },
  };
}

export function railwayArguments(projectId, args, { linked = false } = {}) {
  return linked ? args : [...args, "--project", projectId];
}

async function main() {
  const { checkOnly } = parseArguments(process.argv.slice(2));
  const config = runtimeConfig();

  run("git", ["fetch", "--quiet", "origin", "main", "production"]);
  const head = text("git", ["rev-parse", "HEAD"]);
  const productionIsAncestor =
    spawnSync("git", ["merge-base", "--is-ancestor", "origin/production", head]).status === 0;
  validateRepositoryState({
    status: text("git", ["status", "--porcelain"]),
    branch: text("git", ["branch", "--show-current"]),
    head,
    originMain: text("git", ["rev-parse", "origin/main"]),
    productionIsAncestor,
  });

  run("railway", [
    "link",
    "--project",
    config.projectId,
    "--environment",
    config.stagingEnvironment,
    "--json",
  ]);

  const [stagingConfig, productionConfig] = await Promise.all([
    railwayJson(
      config,
      ["environment", "config", "--environment", config.stagingEnvironment, "--json"],
      { linked: true },
    ),
    railwayJson(
      config,
      [
        "environment",
        "config",
        "--environment",
        config.productionEnvironment,
        "--json",
      ],
      { linked: true },
    ),
  ]);
  validateServiceBranches(stagingConfig, "main", config);
  validateServiceBranches(productionConfig, "production", config);

  const [stagingApi, stagingFrontend, productionApi, productionFrontend] = await Promise.all([
    variables(config, config.stagingEnvironment, config.apiServiceId),
    variables(config, config.stagingEnvironment, config.frontendServiceId),
    variables(config, config.productionEnvironment, config.apiServiceId),
    variables(config, config.productionEnvironment, config.frontendServiceId),
  ]);
  validateHostedVariables({ stagingApi, stagingFrontend, productionApi, productionFrontend });

  await validateEnvironment(config, config.stagingEnvironment, head, {
    apiUrl: config.stagingApiUrl,
    frontendUrl: config.stagingFrontendUrl,
  });

  const proof = localProofRuntime(process.env);
  if (proof.startLocalPostgres) {
    run("npm", ["run", "dev:postgres", "--", "start"], { stdio: "inherit" });
  }
  run("npm", ["run", "proof:lanes", "--", "--mode", "full", "--run"], {
    env: proof.env,
    stdio: "inherit",
  });

  if (checkOnly) {
    console.log(`production promotion check passed for ${head}`);
    return;
  }

  run("git", ["push", "origin", `${head}:refs/heads/production`], { stdio: "inherit" });
  await waitForProduction(config, head);
  await validateEnvironment(config, config.productionEnvironment, head, {
    apiUrl: config.productionApiUrl,
    frontendUrl: config.productionFrontendUrl,
  });
  console.log(`production promotion completed for ${head}`);
}

function runtimeConfig() {
  return {
    ...DEFAULTS,
    projectId: process.env.FMARCH_RAILWAY_PROJECT_ID ?? DEFAULTS.projectId,
    stagingEnvironment:
      process.env.FMARCH_RAILWAY_STAGING_ENVIRONMENT ?? DEFAULTS.stagingEnvironment,
    productionEnvironment:
      process.env.FMARCH_RAILWAY_PRODUCTION_ENVIRONMENT ?? DEFAULTS.productionEnvironment,
  };
}

async function validateEnvironment(config, environment, commit, urls) {
  const [apiDeployment, frontendDeployment, apiDomains, frontendDomains] = await Promise.all([
    latestDeployment(config, environment, config.apiServiceId),
    latestDeployment(config, environment, config.frontendServiceId),
    domains(config, environment, config.apiServiceId),
    domains(config, environment, config.frontendServiceId),
  ]);
  validateDeployment(apiDeployment, commit, `${environment} API`);
  validateDeployment(frontendDeployment, commit, `${environment} frontend`);
  validateDomainList(apiDomains, new URL(urls.apiUrl).host, `${environment} API`);
  validateDomainList(frontendDomains, new URL(urls.frontendUrl).host, `${environment} frontend`);
  await Promise.all([
    health(`${urls.apiUrl}/healthz`, (body) => body.ok === true, `${environment} API`),
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
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.ok, true, `${label} health returned ${response.status}`);
  const body = await response.json();
  assert.equal(predicate(body), true, `${label} health payload was not ready`);
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

async function railwayJson(config, args, options) {
  const output = execFileSync("railway", railwayArguments(config.projectId, args, options), {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(output);
}

function text(command, args) {
  return execFileSync(command, args, { encoding: "utf8" }).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { ...options, encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`production promotion blocked: ${error.message}`);
    process.exitCode = 1;
  }
}
