import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArguments,
  localProofRuntime,
  railwayArguments,
  validateDeployment,
  validateDomainList,
  validateHostedVariables,
  validateRepositoryState,
  validateServiceBranches,
} from "./production_promotion.mjs";

const apiServiceId = "api";
const frontendServiceId = "frontend";
const serviceIds = { apiServiceId, frontendServiceId };

test("promotion arguments are fail closed", () => {
  assert.deepEqual(parseArguments([]), { checkOnly: false });
  assert.deepEqual(parseArguments(["--check"]), { checkOnly: true });
  assert.throws(() => parseArguments(["--force"]), /unknown production promotion argument/);
});

test("promotion proof preserves an explicit database or provisions the repo-local default", () => {
  const explicit = localProofRuntime({ DATABASE_URL: "postgres://explicit/db", KEEP: "yes" });
  assert.equal(explicit.startLocalPostgres, false);
  assert.equal(explicit.env.DATABASE_URL, "postgres://explicit/db");
  assert.equal(explicit.env.KEEP, "yes");

  const local = localProofRuntime({ KEEP: "yes" });
  assert.equal(local.startLocalPostgres, true);
  assert.equal(local.env.DATABASE_URL, "postgres://fmarch:fmarch@127.0.0.1:5544/fmarch");
  assert.equal(local.env.KEEP, "yes");
});

test("Railway commands use explicit project flags except after an explicit link", () => {
  assert.deepEqual(railwayArguments("project-id", ["environment", "config", "--json"]), [
    "environment",
    "config",
    "--json",
    "--project",
    "project-id",
  ]);
  assert.deepEqual(
    railwayArguments("project-id", ["environment", "config", "--json"], { linked: true }),
    ["environment", "config", "--json"],
  );
});

test("repository state requires clean synchronized main and an ancestor release pointer", () => {
  const ready = {
    status: "",
    branch: "main",
    head: "abc",
    originMain: "abc",
    productionIsAncestor: true,
  };
  assert.doesNotThrow(() => validateRepositoryState(ready));
  assert.throws(() => validateRepositoryState({ ...ready, status: " M file" }), /clean worktree/);
  assert.throws(() => validateRepositoryState({ ...ready, branch: "feature" }), /from main/);
  assert.throws(
    () => validateRepositoryState({ ...ready, productionIsAncestor: false }),
    /must be an ancestor/,
  );
});

test("Railway services must watch the environment's canonical branch", () => {
  const config = {
    services: {
      [apiServiceId]: { source: { branch: "production" } },
      [frontendServiceId]: { source: { branch: "production" } },
    },
  };
  assert.doesNotThrow(() => validateServiceBranches(config, "production", serviceIds));
  config.services[frontendServiceId].source.branch = "main";
  assert.throws(() => validateServiceBranches(config, "production", serviceIds), /must watch/);
});

test("hosted variables require isolated production identity credentials", () => {
  const stagingApi = { WORKOS_CLIENT_ID: "staging-client" };
  const stagingFrontend = {
    WORKOS_CLIENT_ID: "staging-client",
    WORKOS_API_KEY: "staging-key",
    WORKOS_COOKIE_PASSWORD: "staging-cookie",
  };
  const productionApi = {
    DATABASE_URL: "postgres://postgres.railway.internal/db",
    WORKOS_CLIENT_ID: "production-client",
    WORKOS_ISSUER: "https://api.workos.com/user_management/production",
    WORKOS_JWKS_URL: "https://api.workos.com/sso/jwks/production",
  };
  const productionFrontend = {
    FMARCH_API_BASE_URL: "https://fmarch-production.up.railway.app",
    FMARCH_API_INTERNAL_URL: "http://fmarch.railway.internal:4000",
    ORIGIN: "https://fmarch-frontend-production.up.railway.app",
    WORKOS_API_KEY: "production-key",
    WORKOS_CLIENT_ID: "production-client",
    WORKOS_COOKIE_PASSWORD: "production-cookie",
    WORKOS_REDIRECT_URI:
      "https://fmarch-frontend-production.up.railway.app/auth/callback",
  };
  const ready = { stagingApi, stagingFrontend, productionApi, productionFrontend };
  assert.doesNotThrow(() => validateHostedVariables(ready));
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionFrontend: { ...productionFrontend, WORKOS_API_KEY: "staging-key" },
      }),
    /Expected.*not.*strictly equal|strictly unequal/i,
  );
  assert.throws(
    () => validateHostedVariables({ ...ready, productionApi: { DATABASE_URL: "db" } }),
    /missing WORKOS_CLIENT_ID/,
  );
  assert.throws(
    () =>
      validateHostedVariables({
        ...ready,
        productionApi: { ...productionApi, WORKOS_CLIENT_ID: "different-production-client" },
      }),
    /same WorkOS client/,
  );
});

test("deployment and domain checks require the promoted commit and active canonical host", () => {
  const deployment = { status: "SUCCESS", meta: { commitHash: "abc" } };
  assert.doesNotThrow(() => validateDeployment(deployment, "abc", "staging API"));
  assert.throws(() => validateDeployment({ ...deployment, status: "BUILDING" }, "abc", "API"));
  assert.throws(() => validateDeployment(deployment, "def", "API"), /promoted commit/);

  const domains = { domains: [{ domain: "fmarch-staging.up.railway.app", syncStatus: "ACTIVE" }] };
  assert.doesNotThrow(() =>
    validateDomainList(domains, "fmarch-staging.up.railway.app", "staging API"),
  );
  assert.throws(() => validateDomainList(domains, "wrong.example", "API"), /missing/);
});
