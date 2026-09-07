import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_RELEASE_REMOTE_URL,
  PRODUCTION_PROMOTION_LOCK_REF,
  assertCanonicalReleaseRemote,
  assertProductionPromotionLease,
  canonicalReleaseFetchArguments,
  createProductionPromotionLockIntent,
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
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "url.https://attacker.invalid/.insteadOf",
    GIT_CONFIG_VALUE_0: "https://github.com/",
    GIT_OBJECT_DIRECTORY: "/attacker/objects",
  });
  assert.equal(environment.GIT_CONFIG_COUNT, undefined);
  assert.equal(environment.GIT_OBJECT_DIRECTORY, undefined);
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
    () => validateReleaseGitPosture({ authorityConfig: ["file:.git/config url.x.insteadof y"] }),
    /URL rewriting/,
  );
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
