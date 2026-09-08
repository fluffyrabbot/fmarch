import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CANONICAL_RELEASE_TOPOLOGY, assertFullCommit } from "./release_coordinator_contract.mjs";

export const CANONICAL_RELEASE_REMOTE_NAME = "origin";
export const CANONICAL_RELEASE_REMOTE_URL = "https://github.com/fluffyrabbot/fmarch.git";
export const PRODUCTION_PROMOTION_LOCK_REF = "refs/heads/release-locks/production";
export const RELEASE_GIT_TIMEOUT_MS = 2 * 60 * 1_000;
export const RELEASE_GIT_CREDENTIAL_HELPER = "!gh auth git-credential";
export const RELEASE_GIT_ASKPASS = "/usr/bin/false";

const digestPattern = /^[0-9a-f]{64}$/u;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const releaseGitCommandConfig = Object.freeze([
  ["credential.helper", ""],
  ["credential.https://github.com.helper", ""],
  ["credential.https://github.com.helper", RELEASE_GIT_CREDENTIAL_HELPER],
  ["http.sslVerify", "true"],
  ["http.https://github.com/.sslVerify", "true"],
  ["core.hooksPath", "/dev/null"],
  ["core.fsmonitor", "false"],
  ["core.attributesFile", "/dev/null"],
]);

function isolatedReleaseGitEnvironment(environment, { commandConfig }) {
  const scrubbed = { ...environment };
  for (const name of Object.keys(scrubbed)) {
    if (
      name.startsWith("GIT_") ||
      /^(?:[a-z][a-z0-9+.-]*|all|no)_proxy$/iu.test(name) ||
      /^(?:SSL_CERT_FILE|SSL_CERT_DIR|CURL_CA_BUNDLE|GH_HOST|SSH_ASKPASS|SSH_ASKPASS_REQUIRE)$/u.test(
        name,
      )
    ) {
      delete scrubbed[name];
    }
  }
  const result = {
    ...scrubbed,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ASKPASS: RELEASE_GIT_ASKPASS,
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  if (commandConfig) {
    result.GIT_CONFIG_COUNT = String(releaseGitCommandConfig.length);
    for (const [index, [key, value]] of releaseGitCommandConfig.entries()) {
      result[`GIT_CONFIG_KEY_${index}`] = key;
      result[`GIT_CONFIG_VALUE_${index}`] = value;
    }
  }
  return result;
}

export function releaseGitEnvironment(environment = process.env) {
  return isolatedReleaseGitEnvironment(environment, { commandConfig: true });
}

function lines(value) {
  return String(value).trim().split("\n").map((line) => line.trim()).filter(Boolean);
}

function gitText(
  args,
  { root = repoRoot, environment = process.env, postureInspection = false } = {},
) {
  return execFileSync("git", args, {
    cwd: root,
    env: postureInspection
      ? isolatedReleaseGitEnvironment(environment, { commandConfig: false })
      : releaseGitEnvironment(environment),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: RELEASE_GIT_TIMEOUT_MS,
  }).trim();
}

export function validateReleaseGitPosture({
  replaceRefs = [],
  grafts = "",
  sparseCheckout = false,
  trackedFlags = [],
  transportConfigKeys = [],
}) {
  assert.deepEqual(replaceRefs, [], "release Git rejects refs/replace authority");
  assert.equal(grafts.trim(), "", "release Git rejects legacy graft authority");
  assert.equal(sparseCheckout, false, "release Git rejects sparse checkout");
  const nonDefaultFlags = trackedFlags.filter((entry) => !entry.startsWith("H "));
  assert.deepEqual(
    nonDefaultFlags,
    [],
    "release Git rejects assume-unchanged, skip-worktree, and non-default index flags",
  );
  assert.equal(
    transportConfigKeys.length,
    0,
    "release Git rejects URL, proxy, TLS, and legacy transport authority from local Git configuration",
  );
  return true;
}

export function isForbiddenReleaseGitConfigKey(key) {
  const normalized = String(key).trim().toLowerCase();
  return (
    /^url\..+\.(?:insteadof|pushinsteadof)$/u.test(normalized) ||
    /^http(?:\.|$)/u.test(normalized) ||
    /^credential(?:\.|$)/u.test(normalized) ||
    /^remote\..+\.(?:proxy|proxyauthmethod|uploadpack|receivepack|vcs)$/u.test(normalized) ||
    /^(?:core\.(?:askpass|attributesfile|fsmonitor|gitproxy|hookspath|sshcommand)|ssh\.variant)$/u.test(
      normalized,
    ) ||
    /^protocol\..+\.allow$/u.test(normalized) ||
    normalized === "include.path" ||
    /^includeif\..+\.path$/u.test(normalized)
  );
}

export function assertReleaseGitPosture({
  inspect,
  root = repoRoot,
  environment = process.env,
} = {}) {
  if (inspect !== undefined) return validateReleaseGitPosture(inspect());

  let configKeys = [];
  try {
    configKeys = lines(gitText(
      ["config", "--no-includes", "--show-scope", "--name-only", "--get-regexp", ".*"],
      { root, environment, postureInspection: true },
    )).map((entry) => {
      const match = /^(?:local|worktree)\s+(.+)$/u.exec(entry);
      assert.ok(match, "release Git config enumeration escaped local/worktree scope");
      return match[1];
    });
  } catch (error) {
    if (error?.status !== 1) throw error;
  }
  const forbiddenConfigKeys = configKeys.filter(isForbiddenReleaseGitConfigKey);
  validateReleaseGitPosture({ transportConfigKeys: forbiddenConfigKeys });

  const load = () => {
    const commonDirectoryValue = gitText(["rev-parse", "--git-common-dir"], {
      root,
      environment,
    });
    const commonDirectory = path.resolve(root, commonDirectoryValue);
    const graftsPath = path.join(commonDirectory, "info", "grafts");
    const grafts = existsSync(graftsPath) ? readFileSync(graftsPath, "utf8") : "";
    let sparseCheckout = false;
    try {
      sparseCheckout = gitText(["config", "--no-includes", "--bool", "core.sparseCheckout"], {
        root,
        environment,
      }) === "true";
    } catch (error) {
      if (error?.status !== 1) throw error;
    }
    return {
      replaceRefs: lines(gitText(
        ["for-each-ref", "--format=%(refname)", "refs/replace"],
        { root, environment },
      )),
      grafts,
      sparseCheckout,
      trackedFlags: lines(gitText(["ls-files", "-v"], { root, environment })),
      transportConfigKeys: [],
    };
  };
  return validateReleaseGitPosture(load());
}

export function validateCanonicalReleaseRemote({ fetchUrls, pushUrls }) {
  assert.deepEqual(
    fetchUrls,
    [CANONICAL_RELEASE_REMOTE_URL],
    `release Git fetch authority must be exactly ${CANONICAL_RELEASE_REMOTE_URL}`,
  );
  assert.deepEqual(
    pushUrls,
    [CANONICAL_RELEASE_REMOTE_URL],
    `release Git push authority must be exactly ${CANONICAL_RELEASE_REMOTE_URL}`,
  );
  return CANONICAL_RELEASE_REMOTE_URL;
}

export function assertCanonicalReleaseRemote({ readUrls } = {}) {
  if (readUrls === undefined) assertReleaseGitPosture();
  const load = readUrls ?? (() => ({
    fetchUrls: lines(gitText(["remote", "get-url", "--all", CANONICAL_RELEASE_REMOTE_NAME])),
    pushUrls: lines(
      gitText(["remote", "get-url", "--push", "--all", CANONICAL_RELEASE_REMOTE_NAME]),
    ),
  }));
  return validateCanonicalReleaseRemote(load());
}

export function canonicalReleaseFetchArguments(branches) {
  assert.ok(Array.isArray(branches) && branches.length > 0, "release fetch requires branches");
  const refspecs = branches.map((branch) => {
    assert.match(branch, /^(?:main|production)$/u, "release fetch branch is not canonical");
    return `+refs/heads/${branch}:refs/remotes/${CANONICAL_RELEASE_REMOTE_NAME}/${branch}`;
  });
  return ["fetch", "--quiet", "--no-tags", CANONICAL_RELEASE_REMOTE_URL, ...refspecs];
}

export function productionPointerPushArgumentsForAuthority(commit, expectedProductionCommit) {
  assertFullCommit(commit, "production commit");
  assertFullCommit(expectedProductionCommit, "expected production pointer");
  return [
    `--force-with-lease=refs/heads/production:${expectedProductionCommit}`,
    CANONICAL_RELEASE_REMOTE_URL,
    `${commit}:refs/heads/production`,
  ];
}

export function createProductionPromotionLockIntent({
  identity,
  releaseCommit,
  expectedProductionCommit,
  fleetJobId,
  fleetReceiptSha256,
  stagingReceiptSha256,
  schemaEpochReset = null,
  createdAt = new Date(),
}) {
  assert.match(identity ?? "", /^fmarch-production-promotion-[0-9a-f-]+$/u);
  assertFullCommit(releaseCommit);
  assertFullCommit(expectedProductionCommit, "expected production pointer");
  assert.match(fleetJobId ?? "", /\S/u, "fleet job id is required");
  assert.match(fleetReceiptSha256 ?? "", digestPattern, "fleet receipt digest is invalid");
  assert.match(stagingReceiptSha256 ?? "", digestPattern, "staging receipt digest is invalid");
  assert.ok(
    schemaEpochReset === null || (Number.isSafeInteger(schemaEpochReset) && schemaEpochReset > 0),
    "promotion lock schema epoch reset is invalid",
  );
  const createdAtValue = createdAt.toISOString();
  return {
    version: 1,
    kind: "fmarch-production-promotion-lock",
    identity,
    created_at: createdAtValue,
    release_commit: releaseCommit,
    expected_production_commit: expectedProductionCommit,
    fleet_job_id: fleetJobId,
    fleet_receipt_sha256: fleetReceiptSha256,
    staging_receipt_sha256: stagingReceiptSha256,
    schema_epoch_reset: schemaEpochReset,
    git_remote_url: CANONICAL_RELEASE_REMOTE_URL,
    topology: CANONICAL_RELEASE_TOPOLOGY,
  };
}

function validateLockIntent(document, expected) {
  assert.equal(document?.version, 1, "production promotion lock version drifted");
  assert.equal(document?.kind, "fmarch-production-promotion-lock", "promotion lock kind drifted");
  assert.match(document.identity ?? "", /^fmarch-production-promotion-[0-9a-f-]+$/u);
  assert.equal(new Date(document.created_at).toISOString(), document.created_at);
  assert.equal(document.release_commit, expected.releaseCommit, "promotion lock commit drifted");
  assert.equal(
    document.expected_production_commit,
    expected.expectedProductionCommit,
    "promotion lock prior production pointer drifted",
  );
  assert.equal(document.fleet_job_id, expected.fleetJobId, "promotion lock fleet job drifted");
  assert.equal(
    document.fleet_receipt_sha256,
    expected.fleetReceiptSha256,
    "promotion lock fleet receipt drifted",
  );
  assert.equal(
    document.staging_receipt_sha256,
    expected.stagingReceiptSha256,
    "promotion lock staging receipt drifted",
  );
  assert.equal(
    document.schema_epoch_reset,
    expected.schemaEpochReset,
    "promotion lock schema epoch reset decision drifted",
  );
  assert.equal(document.git_remote_url, CANONICAL_RELEASE_REMOTE_URL, "promotion lock Git authority drifted");
  assert.deepEqual(document.topology, CANONICAL_RELEASE_TOPOLOGY, "promotion lock topology drifted");
  return document;
}

function defaultLeaseSnapshot(token, releaseCommit) {
  assertCanonicalReleaseRemote();
  const remote = gitText(["ls-remote", "--refs", CANONICAL_RELEASE_REMOTE_URL, PRODUCTION_PROMOTION_LOCK_REF]);
  const [remoteToken, remoteRef, ...extra] = remote ? remote.split(/\s+/u) : [];
  assert.equal(remoteRef, PRODUCTION_PROMOTION_LOCK_REF, "production promotion lock ref drifted");
  assert.equal(extra.length, 0, "production promotion lock returned ambiguous state");
  const localRef = `refs/fmarch-release-leases/${token}-${randomUUID()}`;
  gitText([
    "fetch",
    "--quiet",
    "--no-tags",
    CANONICAL_RELEASE_REMOTE_URL,
    `+${PRODUCTION_PROMOTION_LOCK_REF}:${localRef}`,
  ]);
  const fetchedToken = gitText(["rev-parse", localRef]);
  try {
    const message = gitText(["show", "-s", "--format=%B", localRef]);
    const parent = gitText(["show", "-s", "--format=%P", localRef]);
    const tree = gitText(["show", "-s", "--format=%T", localRef]);
    const expectedTree = gitText(["show", "-s", "--format=%T", releaseCommit]);
    return { remoteToken, fetchedToken, message, parent, tree, expectedTree };
  } finally {
    gitText(["update-ref", "-d", localRef, fetchedToken]);
  }
}

export function assertProductionPromotionLease(
  {
    token,
    releaseCommit,
    expectedProductionCommit,
    fleetJobId,
    fleetReceiptSha256,
    stagingReceiptSha256,
    schemaEpochReset = null,
  },
  { inspect = defaultLeaseSnapshot } = {},
) {
  assertFullCommit(token, "production promotion lock token");
  assertFullCommit(releaseCommit);
  const snapshot = inspect(token, releaseCommit);
  assert.equal(snapshot.remoteToken, token, "production promotion lease is not held remotely");
  assert.equal(snapshot.fetchedToken, token, "fetched production promotion lease drifted");
  assert.equal(snapshot.parent, releaseCommit, "promotion lock parent does not bind the release commit");
  assert.equal(snapshot.tree, snapshot.expectedTree, "promotion lock tree does not bind the release commit");
  let document;
  try {
    document = JSON.parse(snapshot.message);
  } catch {
    assert.fail("production promotion lock intent is not valid JSON");
  }
  return validateLockIntent(document, {
    releaseCommit,
    expectedProductionCommit,
    fleetJobId,
    fleetReceiptSha256,
    stagingReceiptSha256,
    schemaEpochReset,
  });
}
