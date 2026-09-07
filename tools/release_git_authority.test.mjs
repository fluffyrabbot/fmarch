import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_RELEASE_REMOTE_URL,
  PRODUCTION_PROMOTION_LOCK_REF,
  RELEASE_GIT_CREDENTIAL_HELPER,
  assertCanonicalReleaseRemote,
  assertReleaseGitPosture,
  assertProductionPromotionLease,
  canonicalReleaseFetchArguments,
  createProductionPromotionLockIntent,
  isForbiddenReleaseGitConfigKey,
  productionPointerPushArgumentsForAuthority,
  releaseGitEnvironment,
  validateReleaseGitPosture,
  validateCanonicalReleaseRemote,
} from "./release_git_authority.mjs";

const commit = "a".repeat(40);
const prior = "b".repeat(40);
const token = "c".repeat(40);
const fleetReceiptSha256 = "d".repeat(64);
const stagingReceiptSha256 = "e".repeat(64);
const fleetJobId = "job-123";

test("release Git authority pins singular fetch and push URLs", () => {
  const authority = {
    fetchUrls: [CANONICAL_RELEASE_REMOTE_URL],
    pushUrls: [CANONICAL_RELEASE_REMOTE_URL],
  };
  assert.equal(validateCanonicalReleaseRemote(authority), CANONICAL_RELEASE_REMOTE_URL);
  assert.equal(
    assertCanonicalReleaseRemote({ readUrls: () => authority }),
    CANONICAL_RELEASE_REMOTE_URL,
  );
  assert.throws(
    () => validateCanonicalReleaseRemote({ ...authority, pushUrls: ["https://attacker.invalid/fmarch.git"] }),
    /push authority/,
  );
  assert.throws(
    () => validateCanonicalReleaseRemote({ ...authority, fetchUrls: [...authority.fetchUrls, CANONICAL_RELEASE_REMOTE_URL] }),
    /fetch authority/,
  );
});

test("release fetches and production pointer CAS name the pinned URL", () => {
  assert.deepEqual(canonicalReleaseFetchArguments(["main", "production"]), [
    "fetch",
    "--quiet",
    "--no-tags",
    CANONICAL_RELEASE_REMOTE_URL,
    "+refs/heads/main:refs/remotes/origin/main",
    "+refs/heads/production:refs/remotes/origin/production",
  ]);
  assert.deepEqual(productionPointerPushArgumentsForAuthority(commit, prior), [
    `--force-with-lease=refs/heads/production:${prior}`,
    CANONICAL_RELEASE_REMOTE_URL,
    `${commit}:refs/heads/production`,
  ]);
});

test("production lease binds exact remote token and complete release intent", () => {
  const document = createProductionPromotionLockIntent({
    identity: "fmarch-production-promotion-00000000-0000-4000-8000-000000000000",
    releaseCommit: commit,
    expectedProductionCommit: prior,
    fleetJobId,
    fleetReceiptSha256,
    stagingReceiptSha256,
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
  });
  const expected = {
    token,
    releaseCommit: commit,
    expectedProductionCommit: prior,
    fleetJobId,
    fleetReceiptSha256,
    stagingReceiptSha256,
  };
  const snapshot = {
    remoteToken: token,
    fetchedToken: token,
    message: JSON.stringify(document),
    parent: commit,
    tree: "f".repeat(40),
    expectedTree: "f".repeat(40),
  };
  assert.deepEqual(assertProductionPromotionLease(expected, { inspect: () => snapshot }), document);
  assert.throws(
    () => assertProductionPromotionLease(expected, { inspect: () => ({ ...snapshot, remoteToken: prior }) }),
    /not held remotely/,
  );
  assert.throws(
    () => assertProductionPromotionLease(expected, {
      inspect: () => ({ ...snapshot, message: JSON.stringify({ ...document, fleet_job_id: "other" }) }),
    }),
    /fleet job drifted/,
  );
  assert.equal(PRODUCTION_PROMOTION_LOCK_REF, "refs/heads/release-locks/production");
});

test("release Git rejects ambient authority, replacements, grafts, sparse state, and index concealment", () => {
  const environment = releaseGitEnvironment({
    PATH: process.env.PATH,
    GH_TOKEN: "deliberate-credential-authority",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "url.https://attacker.invalid/.insteadOf",
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_OBJECT_DIRECTORY: "/attacker/objects",
    SSL_CERT_FILE: "/attacker/ca.pem",
    SSL_CERT_DIR: "/attacker/certs",
    CURL_CA_BUNDLE: "/attacker/curl-ca.pem",
    HTTPS_PROXY: "https://attacker.invalid",
    RSYNC_PROXY: "https://attacker.invalid",
    GH_HOST: "attacker.invalid",
  });
  assert.equal(environment.GIT_OBJECT_DIRECTORY, undefined);
  assert.equal(environment.SSL_CERT_FILE, undefined);
  assert.equal(environment.SSL_CERT_DIR, undefined);
  assert.equal(environment.CURL_CA_BUNDLE, undefined);
  assert.equal(environment.HTTPS_PROXY, undefined);
  assert.equal(environment.RSYNC_PROXY, undefined);
  assert.equal(environment.GH_HOST, undefined);
  assert.equal(environment.GH_TOKEN, "deliberate-credential-authority");
  assert.equal(environment.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(environment.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(environment.GIT_CONFIG_VALUE_2, RELEASE_GIT_CREDENTIAL_HELPER);
  assert.equal(environment.GIT_CONFIG_VALUE_3, "true");
  assert.equal(environment.GIT_CONFIG_VALUE_5, "/dev/null");
  assert.equal(environment.GIT_CONFIG_VALUE_6, "false");
  assert.equal(environment.GIT_NO_REPLACE_OBJECTS, "1");
  assert.throws(
    () => validateReleaseGitPosture({ replaceRefs: ["refs/replace/abc"] }),
    /refs\/replace/,
  );
  assert.throws(() => validateReleaseGitPosture({ grafts: "abc def" }), /graft/);
  assert.throws(() => validateReleaseGitPosture({ sparseCheckout: true }), /sparse/);
  assert.throws(
    () => validateReleaseGitPosture({ trackedFlags: ["h .fluffyfleet.json"] }),
    /index flags/,
  );
  assert.throws(
    () => validateReleaseGitPosture({ transportConfigKeys: ["url.x.insteadof"] }),
    /transport authority/,
  );
  for (const key of [
    "url.https://attacker.invalid/.insteadof",
    "URL.https://attacker.invalid/.PUSHINSTEADOF",
    "http.sslverify",
    "http.https://github.com/.sslcainfo",
    "http.sslbackend",
    "remote.origin.proxy",
    "core.gitproxy",
    "credential.helper",
    "core.hookspath",
    "core.fsmonitor",
    "include.path",
    "includeif.gitdir:/tmp/example.path",
  ]) {
    assert.equal(isForbiddenReleaseGitConfigKey(key), true, `${key} must be rejected`);
  }
  assert.equal(isForbiddenReleaseGitConfigKey("user.name"), false);
});

test("release Git isolates global transport attacks and rejects unsafe local keys", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fmarch-release-git-transport-"));
  const repository = path.join(directory, "repo");
  const globalConfig = path.join(directory, "ambient-global.gitconfig");
  mkdirSync(repository);
  const ambient = { ...process.env, GIT_CONFIG_GLOBAL: globalConfig };
  const git = (args, options = {}) => execFileSync("git", args, {
    cwd: options.cwd ?? repository,
    encoding: "utf8",
    env: options.env ?? ambient,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    git(["init", "--quiet"]);
    git(["remote", "add", "origin", CANONICAL_RELEASE_REMOTE_URL]);
    git([
      "config",
      "--file",
      globalConfig,
      "url.https://attacker.invalid/.insteadOf",
      "https://github.com/",
    ]);
    git(["config", "--file", globalConfig, "http.sslVerify", "false"]);
    git([
      "config",
      "--file",
      globalConfig,
      "http.https://github.com/.sslCAInfo",
      path.join(directory, "attacker-ca.pem"),
    ]);
    assert.match(git(["remote", "get-url", "origin"]), /^https:\/\/attacker\.invalid\//u);

    const isolated = releaseGitEnvironment(ambient);
    assert.equal(git(["remote", "get-url", "origin"], { env: isolated }), CANONICAL_RELEASE_REMOTE_URL);
    assert.equal(git(["config", "--get", "http.sslVerify"], { env: isolated }), "true");
    assert.equal(git(["config", "--get", "core.hooksPath"], { env: isolated }), "/dev/null");
    assert.equal(git(["config", "--get", "core.fsmonitor"], { env: isolated }), "false");
    assert.throws(
      () => git(["config", "--get", "http.https://github.com/.sslCAInfo"], { env: isolated }),
    );
    assert.doesNotThrow(() => assertReleaseGitPosture({ root: repository, environment: ambient }));

    git(["config", "url.https://attacker.invalid/.insteadOf", "https://github.com/"]);
    assert.throws(
      () => assertReleaseGitPosture({ root: repository, environment: ambient }),
      /transport authority/,
    );
    git(["config", "--unset-all", "url.https://attacker.invalid/.insteadOf"]);

    git(["config", "http.sslVerify", "false"]);
    assert.throws(
      () => assertReleaseGitPosture({ root: repository, environment: ambient }),
      /transport authority/,
    );
    git(["config", "--unset-all", "http.sslVerify"]);

    git([
      "config",
      "http.https://github.com/.sslCAInfo",
      path.join(directory, "local-attacker-ca.pem"),
    ]);
    assert.throws(
      () => assertReleaseGitPosture({ root: repository, environment: ambient }),
      /transport authority/,
    );
    git(["config", "--unset-all", "http.https://github.com/.sslCAInfo"]);

    const included = path.join(directory, "changing-transport-authority.gitconfig");
    writeFileSync(included, "[http]\n\tsslVerify = false\n");
    git(["config", "include.path", included]);
    assert.throws(
      () => assertReleaseGitPosture({ root: repository, environment: ambient }),
      /transport authority/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release Git environment disables the reproduced replace-ref archive attack", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fmarch-release-git-"));
  const git = (args, options = {}) => execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    env: options.env ?? process.env,
  }).trim();
  git(["init", "--quiet"]);
  git(["config", "user.name", "release-test"]);
  git(["config", "user.email", "release-test@example.invalid"]);
  writeFileSync(path.join(directory, ".fluffyfleet.json"), "canonical\n");
  git(["add", ".fluffyfleet.json"]);
  git(["commit", "--quiet", "-m", "canonical"]);
  const canonical = git(["rev-parse", "HEAD"]);
  writeFileSync(path.join(directory, ".fluffyfleet.json"), "attacker\n");
  git(["commit", "--quiet", "-am", "replacement"]);
  const replacement = git(["rev-parse", "HEAD"]);
  git(["replace", canonical, replacement]);
  assert.equal(git(["show", `${canonical}:.fluffyfleet.json`]), "attacker");
  assert.equal(
    git(["show", `${canonical}:.fluffyfleet.json`], { env: releaseGitEnvironment(process.env) }),
    "canonical",
  );
  git(["update-index", "--assume-unchanged", ".fluffyfleet.json"]);
  writeFileSync(path.join(directory, ".fluffyfleet.json"), "concealed attacker policy\n");
  assert.equal(git(["status", "--porcelain"]), "");
  const flags = git(["ls-files", "-v"]).split("\n");
  assert.throws(
    () => validateReleaseGitPosture({ replaceRefs: [], trackedFlags: flags }),
    /index flags/,
  );
});
