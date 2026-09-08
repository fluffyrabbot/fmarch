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
export const STAGING_RELEASE_MUTATION_LOCK_REF = "refs/heads/release-locks/staging";
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
  {
    root = repoRoot,
    environment = process.env,
    postureInspection = false,
    input = undefined,
  } = {},
) {
  return execFileSync("git", args, {
    cwd: root,
    env: postureInspection
      ? isolatedReleaseGitEnvironment(environment, { commandConfig: false })
      : releaseGitEnvironment(environment),
    encoding: "utf8",
    input,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: RELEASE_GIT_TIMEOUT_MS,
  }).trim();
}

function assertSha256(value, label) {
  assert.match(value ?? "", digestPattern, `${label} is invalid`);
  return value;
}

function assertCanonicalInstant(value, label) {
  assert.equal(new Date(value).toISOString(), value, `${label} is invalid`);
  return value;
}

function assertStagingReleaseMutationBindings(operationKind, bindings) {
  assert.ok(bindings && typeof bindings === "object" && !Array.isArray(bindings));
  if (operationKind === "release-coordinator") {
    assert.deepEqual(
      Object.keys(bindings).sort(),
      ["fleet_job_id", "fleet_receipt_sha256", "schema_epoch_reset"],
      "staging coordinator lease bindings drifted",
    );
    assert.match(bindings.fleet_job_id ?? "", /\S/u, "staging coordinator fleet job is invalid");
    assertSha256(bindings.fleet_receipt_sha256, "staging coordinator fleet receipt digest");
    assert.ok(
      bindings.schema_epoch_reset === null ||
        (Number.isSafeInteger(bindings.schema_epoch_reset) && bindings.schema_epoch_reset > 0),
      "staging coordinator schema epoch reset decision is invalid",
    );
  } else if (operationKind === "release-game-day") {
    assert.deepEqual(
      Object.keys(bindings).sort(),
      [
        "current_receipt_sha256",
        "delay_seconds",
        "rollback_commit",
        "rollback_receipt_sha256",
      ],
      "staging game-day lease bindings drifted",
    );
    assertSha256(bindings.current_receipt_sha256, "game-day current receipt digest");
    assertFullCommit(bindings.rollback_commit, "game-day rollback commit");
    assertSha256(bindings.rollback_receipt_sha256, "game-day rollback receipt digest");
    assert.ok(
      Number.isSafeInteger(bindings.delay_seconds) && bindings.delay_seconds > 0,
      "game-day delay is invalid",
    );
  } else {
    assert.fail(`unsupported staging release mutation operation ${operationKind}`);
  }
  return bindings;
}

export function createStagingReleaseMutationLeaseIntent({
  operationKind,
  operationIdentity = `fmarch-staging-release-${randomUUID()}`,
  releaseCommit,
  bindings,
  createdAt = new Date(),
}) {
  assert.match(
    operationIdentity ?? "",
    /^fmarch-staging-release-[0-9a-f-]+$/u,
    "staging release mutation identity is invalid",
  );
  assertFullCommit(releaseCommit);
  assertStagingReleaseMutationBindings(operationKind, bindings);
  return {
    version: 1,
    kind: "fmarch-staging-release-mutation-lease",
    operation_kind: operationKind,
    operation_identity: operationIdentity,
    created_at: createdAt.toISOString(),
    release_commit: releaseCommit,
    environment: "staging",
    project_id: CANONICAL_RELEASE_TOPOLOGY.project_id,
    environment_id: CANONICAL_RELEASE_TOPOLOGY.environments.staging.id,
    git_remote_url: CANONICAL_RELEASE_REMOTE_URL,
    topology: CANONICAL_RELEASE_TOPOLOGY,
    bindings: structuredClone(bindings),
  };
}

function validateStagingReleaseMutationLeaseIntentShape(document) {
  assert.equal(document?.version, 1, "staging release mutation lease version drifted");
  assert.equal(
    document?.kind,
    "fmarch-staging-release-mutation-lease",
    "staging release mutation lease kind drifted",
  );
  assert.match(
    document.operation_identity ?? "",
    /^fmarch-staging-release-[0-9a-f-]+$/u,
    "staging release mutation identity is invalid",
  );
  assertCanonicalInstant(document.created_at, "staging release mutation creation time");
  assertFullCommit(document.release_commit);
  assert.equal(document.environment, "staging");
  assert.equal(document.project_id, CANONICAL_RELEASE_TOPOLOGY.project_id);
  assert.equal(document.environment_id, CANONICAL_RELEASE_TOPOLOGY.environments.staging.id);
  assert.equal(document.git_remote_url, CANONICAL_RELEASE_REMOTE_URL);
  assert.deepEqual(document.topology, CANONICAL_RELEASE_TOPOLOGY);
  assertStagingReleaseMutationBindings(document.operation_kind, document.bindings);
  return document;
}

export function validateStagingReleaseMutationLeaseIntent(document, expected) {
  validateStagingReleaseMutationLeaseIntentShape(document);
  assert.equal(
    document.operation_kind,
    expected.operationKind,
    "staging release mutation operation kind drifted",
  );
  assert.equal(
    document.release_commit,
    expected.releaseCommit,
    "staging release mutation commit drifted",
  );
  assert.deepEqual(
    document.bindings,
    expected.bindings,
    "staging release mutation inputs drifted",
  );
  return document;
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

function validateLockIntentShape(document) {
  assert.equal(document?.version, 1, "production promotion lock version drifted");
  assert.equal(document?.kind, "fmarch-production-promotion-lock", "promotion lock kind drifted");
  assert.match(document.identity ?? "", /^fmarch-production-promotion-[0-9a-f-]+$/u);
  assert.equal(new Date(document.created_at).toISOString(), document.created_at);
  assertFullCommit(document.release_commit, "promotion lock release commit");
  assertFullCommit(
    document.expected_production_commit,
    "promotion lock prior production pointer",
  );
  assert.match(document.fleet_job_id ?? "", /\S/u, "promotion lock fleet job is invalid");
  assert.match(
    document.fleet_receipt_sha256 ?? "",
    digestPattern,
    "promotion lock fleet receipt digest is invalid",
  );
  assert.match(
    document.staging_receipt_sha256 ?? "",
    digestPattern,
    "promotion lock staging receipt digest is invalid",
  );
  assert.ok(
    document.schema_epoch_reset === null ||
      (Number.isSafeInteger(document.schema_epoch_reset) && document.schema_epoch_reset > 0),
    "promotion lock schema epoch reset is invalid",
  );
  assert.equal(
    document.git_remote_url,
    CANONICAL_RELEASE_REMOTE_URL,
    "promotion lock Git authority drifted",
  );
  assert.deepEqual(document.topology, CANONICAL_RELEASE_TOPOLOGY, "promotion lock topology drifted");
  return document;
}

export function validateProductionPromotionLeaseIntent(document, expected) {
  validateLockIntentShape(document);
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

export function readProductionPromotionLease(
  { token, releaseCommit },
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
  validateLockIntentShape(document);
  assert.equal(
    document.release_commit,
    releaseCommit,
    "promotion lock intent does not bind its release commit parent",
  );
  return document;
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
  options = {},
) {
  const document = readProductionPromotionLease({ token, releaseCommit }, options);
  return validateProductionPromotionLeaseIntent(document, {
    releaseCommit,
    expectedProductionCommit,
    fleetJobId,
    fleetReceiptSha256,
    stagingReceiptSha256,
    schemaEpochReset,
  });
}

function remoteReleaseMutationLease(ref = STAGING_RELEASE_MUTATION_LOCK_REF) {
  assert.equal(ref, STAGING_RELEASE_MUTATION_LOCK_REF, "unsupported release mutation lease ref");
  assertCanonicalReleaseRemote();
  const output = gitText(["ls-remote", "--refs", CANONICAL_RELEASE_REMOTE_URL, ref]);
  if (!output) return null;
  const [token, observedRef, ...extra] = output.split(/\s+/u);
  assert.equal(observedRef, ref, "staging release mutation lease ref drifted");
  assert.equal(extra.length, 0, "staging release mutation lease returned ambiguous state");
  return assertFullCommit(token, "staging release mutation lease token");
}

function defaultStagingLeaseSnapshot(token, releaseCommit) {
  const remoteToken = remoteReleaseMutationLease();
  const localRef = `refs/fmarch-release-leases/staging-${token}-${randomUUID()}`;
  gitText([
    "fetch",
    "--quiet",
    "--no-tags",
    CANONICAL_RELEASE_REMOTE_URL,
    `+${STAGING_RELEASE_MUTATION_LOCK_REF}:${localRef}`,
  ]);
  const fetchedToken = gitText(["rev-parse", localRef]);
  try {
    return {
      remoteToken,
      fetchedToken,
      message: gitText(["show", "-s", "--format=%B", localRef]),
      parent: gitText(["show", "-s", "--format=%P", localRef]),
      tree: gitText(["show", "-s", "--format=%T", localRef]),
      expectedTree: gitText(["show", "-s", "--format=%T", releaseCommit]),
    };
  } finally {
    gitText(["update-ref", "-d", localRef, fetchedToken]);
  }
}

export function readStagingReleaseMutationLease(
  { token, releaseCommit },
  { inspect = defaultStagingLeaseSnapshot } = {},
) {
  assertFullCommit(token, "staging release mutation lease token");
  assertFullCommit(releaseCommit);
  const snapshot = inspect(token, releaseCommit);
  assert.equal(snapshot.remoteToken, token, "staging release mutation lease is not held remotely");
  assert.equal(snapshot.fetchedToken, token, "fetched staging release mutation lease drifted");
  assert.equal(snapshot.parent, releaseCommit, "staging release mutation lease parent drifted");
  assert.equal(snapshot.tree, snapshot.expectedTree, "staging release mutation lease tree drifted");
  let document;
  try {
    document = JSON.parse(snapshot.message);
  } catch {
    assert.fail("staging release mutation lease intent is not valid JSON");
  }
  validateStagingReleaseMutationLeaseIntentShape(document);
  assert.equal(document.release_commit, releaseCommit, "staging lease intent parent drifted");
  return document;
}

export function assertStagingReleaseMutationLease(
  { token, releaseCommit, operationKind, bindings },
  options = {},
) {
  return validateStagingReleaseMutationLeaseIntent(
    readStagingReleaseMutationLease({ token, releaseCommit }, options),
    { releaseCommit, operationKind, bindings },
  );
}

function defaultStagingLeaseToken(intent) {
  const result = execFileSync(
    "git",
    ["commit-tree", `${intent.release_commit}^{tree}`, "-p", intent.release_commit],
    {
      cwd: repoRoot,
      encoding: "utf8",
      input: `${JSON.stringify(intent)}\n`,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: RELEASE_GIT_TIMEOUT_MS,
      env: {
        ...releaseGitEnvironment(),
        GIT_AUTHOR_NAME: "fmarch staging release coordinator",
        GIT_AUTHOR_EMAIL: "release@fmarch.invalid",
        GIT_COMMITTER_NAME: "fmarch staging release coordinator",
        GIT_COMMITTER_EMAIL: "release@fmarch.invalid",
      },
    },
  ).trim();
  return assertFullCommit(result, "staging release mutation lease token");
}

function mutateStagingLease(operation, token) {
  const refspec = operation === "acquire"
    ? `${token}:${STAGING_RELEASE_MUTATION_LOCK_REF}`
    : `:${STAGING_RELEASE_MUTATION_LOCK_REF}`;
  const expected = operation === "acquire" ? "" : token;
  gitText([
    "push",
    `--force-with-lease=${STAGING_RELEASE_MUTATION_LOCK_REF}:${expected}`,
    CANONICAL_RELEASE_REMOTE_URL,
    refspec,
  ]);
}

export function reconcileStagingReleaseMutationLease({ operation, token, mutate, inspect }) {
  assert.ok(["acquire", "release"].includes(operation), "unknown staging lease mutation");
  assertFullCommit(token, "staging release mutation lease token");
  try {
    mutate();
    return operation === "acquire" ? token : null;
  } catch (error) {
    let observed;
    try {
      observed = inspect();
    } catch (inspectionError) {
      if (operation === "release") {
        const ambiguous = new AggregateError(
          [error, inspectionError],
          `staging release mutation lease ${token} release outcome is unknown; inspect ` +
            `${STAGING_RELEASE_MUTATION_LOCK_REF} before attempting resume or abandonment`,
        );
        ambiguous.code = "STAGING_RELEASE_LEASE_RELEASE_AMBIGUOUS";
        ambiguous.releaseMutationLeaseToken = token;
        throw ambiguous;
      }
      throw inspectionError;
    }
    const expected = operation === "acquire" ? token : null;
    if (observed === expected) return expected;
    if (operation === "release" && observed !== token) {
      const authorityError = new Error(
        `staging release mutation lease release lost authority to ${observed ?? "no token"}`,
        { cause: error },
      );
      authorityError.code = "STAGING_RELEASE_LEASE_AUTHORITY_VIOLATION";
      authorityError.releaseMutationLeaseToken = token;
      authorityError.observedReleaseMutationLeaseToken = observed;
      throw authorityError;
    }
    throw error;
  }
}

export function acquireStagingReleaseMutationLease(
  intent,
  {
    inspect = () => remoteReleaseMutationLease(),
    createToken = defaultStagingLeaseToken,
    mutate = (token) => mutateStagingLease("acquire", token),
    assertLease = assertStagingReleaseMutationLease,
  } = {},
) {
  validateStagingReleaseMutationLeaseIntentShape(intent);
  const existing = inspect();
  assert.equal(
    existing,
    null,
    `staging release mutations are already leased by ${existing}; resume that exact operation`,
  );
  const token = assertFullCommit(createToken(intent), "staging release mutation lease token");
  try {
    reconcileStagingReleaseMutationLease({
      operation: "acquire",
      token,
      mutate: () => mutate(token, intent),
      inspect,
    });
    const lease = {
      token,
      releaseCommit: intent.release_commit,
      operationKind: intent.operation_kind,
      bindings: structuredClone(intent.bindings),
      resumed: false,
    };
    assertLease(lease);
    return lease;
  } catch (error) {
    throw ambiguousStagingLeaseAcquisitionError(error, token);
  }
}

export function resumeStagingReleaseMutationLease(
  { token, releaseCommit, operationKind, bindings },
  { assertLease = assertStagingReleaseMutationLease } = {},
) {
  const lease = {
    token: assertFullCommit(token, "staging release mutation resume lease"),
    releaseCommit: assertFullCommit(releaseCommit),
    operationKind,
    bindings: structuredClone(bindings),
    resumed: true,
  };
  assertLease(lease);
  return lease;
}

export function releaseStagingReleaseMutationLease(
  token,
  {
    inspect = () => remoteReleaseMutationLease(),
    mutate = (leaseToken) => mutateStagingLease("release", leaseToken),
  } = {},
) {
  reconcileStagingReleaseMutationLease({
    operation: "release",
    token,
    mutate: () => mutate(token),
    inspect,
  });
}

function retainedStagingLeaseError(error, token) {
  const retained = new Error(
    `${error?.message ?? error}; staging release mutation lease ${token} remains held; ` +
      `resume only with --resume-lease ${token}`,
    { cause: error },
  );
  retained.code = error?.code;
  retained.releaseMutationLeaseToken = token;
  return retained;
}

function ambiguousStagingLeaseAcquisitionError(error, token) {
  const ambiguous = new Error(
    `${error?.message ?? error}; staging release mutation lease acquisition may have committed ` +
      `as ${token}; inspect ${STAGING_RELEASE_MUTATION_LOCK_REF} and, only when it equals this ` +
      `token, resume with --resume-lease ${token}`,
    { cause: error },
  );
  ambiguous.code = error?.code;
  ambiguous.releaseMutationLeaseToken = token;
  return ambiguous;
}

async function classifyStagingLeaseActionFailure(error, token, inspect) {
  let observed;
  try {
    observed = await inspect();
  } catch (inspectionError) {
    const ambiguous = new AggregateError(
      [error, inspectionError],
      `staging release mutation action failed and lease ${token} ownership is unknown; ` +
        `inspect ${STAGING_RELEASE_MUTATION_LOCK_REF} before attempting resume or abandonment`,
    );
    ambiguous.code = "STAGING_RELEASE_LEASE_ACTION_AMBIGUOUS";
    ambiguous.releaseMutationLeaseToken = token;
    return ambiguous;
  }
  if (observed === token) return retainedStagingLeaseError(error, token);
  const authorityError = new Error(
    `${error?.message ?? error}; staging release mutation action lost lease authority: ` +
      `${STAGING_RELEASE_MUTATION_LOCK_REF} now holds ${observed ?? "no token"}`,
    { cause: error },
  );
  authorityError.code = "STAGING_RELEASE_LEASE_AUTHORITY_VIOLATION";
  authorityError.releaseMutationLeaseToken = token;
  authorityError.observedReleaseMutationLeaseToken = observed;
  return authorityError;
}

export async function withStagingReleaseMutationLease(
  { acquire, release, inspect = () => remoteReleaseMutationLease() },
  action,
) {
  const lease = await acquire();
  let result;
  try {
    result = await action(lease);
  } catch (error) {
    throw await classifyStagingLeaseActionFailure(error, lease.token, inspect);
  }
  try {
    await release(lease.token);
  } catch (error) {
    if (
      error?.code === "STAGING_RELEASE_LEASE_AUTHORITY_VIOLATION" ||
      error?.code === "STAGING_RELEASE_LEASE_RELEASE_AMBIGUOUS" ||
      error?.code === "STAGING_RELEASE_LEASE_ACTION_AMBIGUOUS"
    ) throw error;
    throw retainedStagingLeaseError(error, lease.token);
  }
  return result;
}
