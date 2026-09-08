import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CANONICAL_RELEASE_REMOTE_URL,
  PRODUCTION_PROMOTION_LOCK_REF,
  STAGING_RELEASE_MUTATION_LOCK_REF,
  RELEASE_GIT_ASKPASS,
  RELEASE_GIT_CREDENTIAL_HELPER,
  assertCanonicalReleaseRemote,
  assertReleaseGitPosture,
  assertProductionPromotionLease,
  assertStagingReleaseMutationLease,
  acquireStagingReleaseMutationLease,
  canonicalReleaseFetchArguments,
  createProductionPromotionLockIntent,
  createStagingReleaseMutationLeaseIntent,
  isForbiddenReleaseGitConfigKey,
  productionPointerPushArgumentsForAuthority,
  reconcileStagingReleaseMutationLease,
  releaseStagingReleaseMutationLease,
  releaseGitEnvironment,
  resumeStagingReleaseMutationLease,
  validateReleaseGitPosture,
  validateCanonicalReleaseRemote,
  validateStagingReleaseMutationLeaseIntent,
  withStagingReleaseMutationLease,
} from "./release_git_authority.mjs";

const commit = "a".repeat(40);
const prior = "b".repeat(40);
const token = "c".repeat(40);
const fleetReceiptSha256 = "d".repeat(64);
const stagingReceiptSha256 = "e".repeat(64);
const fleetJobId = "job-123";
const stagingBindings = {
  fleet_job_id: fleetJobId,
  fleet_receipt_sha256: fleetReceiptSha256,
  schema_epoch_reset: null,
};

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

test("staging lease binds the shared remote token, parent tree, and complete operation", () => {
  const document = createStagingReleaseMutationLeaseIntent({
    operationKind: "release-coordinator",
    operationIdentity: "fmarch-staging-release-00000000-0000-4000-8000-000000000000",
    releaseCommit: commit,
    bindings: stagingBindings,
    createdAt: new Date("2026-09-07T12:00:00.000Z"),
  });
  const expected = {
    token,
    releaseCommit: commit,
    operationKind: "release-coordinator",
    bindings: stagingBindings,
  };
  const snapshot = {
    remoteToken: token,
    fetchedToken: token,
    message: JSON.stringify(document),
    parent: commit,
    tree: "f".repeat(40),
    expectedTree: "f".repeat(40),
  };
  assert.deepEqual(assertStagingReleaseMutationLease(expected, { inspect: () => snapshot }), document);
  assert.deepEqual(
    validateStagingReleaseMutationLeaseIntent(document, {
      releaseCommit: commit,
      operationKind: "release-coordinator",
      bindings: stagingBindings,
    }),
    document,
  );
  assert.throws(
    () => assertStagingReleaseMutationLease(expected, {
      inspect: () => ({ ...snapshot, remoteToken: prior }),
    }),
    /not held remotely/,
  );
  assert.throws(
    () => assertStagingReleaseMutationLease(expected, {
      inspect: () => ({ ...snapshot, parent: prior }),
    }),
    /parent drifted/,
  );
  assert.throws(
    () => assertStagingReleaseMutationLease(expected, {
      inspect: () => ({ ...snapshot, tree: prior }),
    }),
    /tree drifted/,
  );
  assert.equal(STAGING_RELEASE_MUTATION_LOCK_REF, "refs/heads/release-locks/staging");
});

test("staging lease acquisition is exclusive and reconciles a lost CAS response", () => {
  const intent = createStagingReleaseMutationLeaseIntent({
    operationKind: "release-coordinator",
    releaseCommit: commit,
    bindings: stagingBindings,
  });
  let remote = null;
  let inspections = 0;
  const acquired = acquireStagingReleaseMutationLease(intent, {
    inspect: () => {
      inspections += 1;
      return remote;
    },
    createToken: () => token,
    mutate: (candidate) => {
      assert.equal(remote, null, "CAS requires an absent shared ref");
      remote = candidate;
      throw new Error("injected lost push response");
    },
    assertLease: (lease) => assert.equal(lease.token, remote),
  });
  assert.equal(acquired.token, token);
  assert.equal(acquired.resumed, false);
  assert.equal(inspections, 2, "lost acquire response must perform one reconciliation read");
  assert.throws(
    () => acquireStagingReleaseMutationLease(intent, {
      inspect: () => remote,
      createToken: () => prior,
      mutate: () => assert.fail("contender must not attempt a CAS while the ref exists"),
      assertLease: () => {},
    }),
    /already leased.*resume that exact operation/,
  );
});

test("staging acquire reports its exact candidate token after post-CAS ambiguity", () => {
  const intent = createStagingReleaseMutationLeaseIntent({
    operationKind: "release-coordinator",
    releaseCommit: commit,
    bindings: stagingBindings,
  });
  assert.throws(
    () => acquireStagingReleaseMutationLease(intent, {
      inspect: () => null,
      createToken: () => token,
      mutate: () => {},
      assertLease: () => { throw new Error("lease snapshot unavailable"); },
    }),
    new RegExp(`acquisition may have committed as ${token}.*--resume-lease ${token}`, "u"),
  );
});

test("staging release CAS avoids post-success races and classifies lost responses", () => {
  let inspected = false;
  assert.equal(
    reconcileStagingReleaseMutationLease({
      operation: "release",
      token,
      mutate: () => {},
      inspect: () => {
        inspected = true;
        return prior;
      },
    }),
    null,
  );
  assert.equal(inspected, false, "successful delete must not inspect after another owner can acquire");

  assert.equal(
    reconcileStagingReleaseMutationLease({
      operation: "release",
      token,
      mutate: () => { throw new Error("lost delete response"); },
      inspect: () => null,
    }),
    null,
  );
  assert.throws(
    () => releaseStagingReleaseMutationLease(token, {
      mutate: () => { throw new Error("delete rejected"); },
      inspect: () => token,
    }),
    /delete rejected/,
  );
  assert.throws(
    () => releaseStagingReleaseMutationLease(token, {
      mutate: () => { throw new Error("lost delete response"); },
      inspect: () => prior,
    }),
    (error) => {
      assert.equal(error.code, "STAGING_RELEASE_LEASE_AUTHORITY_VIOLATION");
      assert.equal(error.releaseMutationLeaseToken, token);
      assert.equal(error.observedReleaseMutationLeaseToken, prior);
      assert.doesNotMatch(error.message, /remains held/u);
      return true;
    },
  );
  assert.throws(
    () => releaseStagingReleaseMutationLease(token, {
      mutate: () => { throw new Error("lost delete response"); },
      inspect: () => { throw new Error("lease read timed out"); },
    }),
    (error) => {
      assert.equal(error.code, "STAGING_RELEASE_LEASE_RELEASE_AMBIGUOUS");
      assert.equal(error.releaseMutationLeaseToken, token);
      assert.match(error.message, /release outcome is unknown/);
      assert.doesNotMatch(error.message, /remains held/u);
      return true;
    },
  );
});

test("staging lease resumes exactly and classifies action-failure ownership", async () => {
  const resumed = resumeStagingReleaseMutationLease(
    {
      token,
      releaseCommit: commit,
      operationKind: "release-coordinator",
      bindings: stagingBindings,
    },
    { assertLease: (lease) => assert.equal(lease.token, token) },
  );
  assert.equal(resumed.resumed, true);
  assert.throws(
    () => resumeStagingReleaseMutationLease(
      {
        token: prior,
        releaseCommit: commit,
        operationKind: "release-coordinator",
        bindings: stagingBindings,
      },
      { assertLease: () => { throw new Error("remote token mismatch"); } },
    ),
    /remote token mismatch/,
  );

  let releases = 0;
  await assert.rejects(
    withStagingReleaseMutationLease(
      {
        acquire: async () => resumed,
        release: async () => { releases += 1; },
        inspect: async () => token,
      },
      async () => { throw new Error("live state drifted"); },
    ),
    new RegExp(`live state drifted.*lease ${token} remains held.*--resume-lease ${token}`, "u"),
  );
  assert.equal(releases, 0, "failed actions retain the shared lease");

  for (const observed of [null, prior]) {
    await assert.rejects(
      withStagingReleaseMutationLease(
        {
          acquire: async () => resumed,
          release: async () => assert.fail("authority-lost actions must not release"),
          inspect: async () => observed,
        },
        async () => { throw new Error("mutation authority revalidation failed"); },
      ),
      (error) => {
        assert.equal(error.code, "STAGING_RELEASE_LEASE_AUTHORITY_VIOLATION");
        assert.equal(error.releaseMutationLeaseToken, token);
        assert.equal(error.observedReleaseMutationLeaseToken, observed);
        assert.doesNotMatch(error.message, /remains held/u);
        return true;
      },
    );
  }

  await assert.rejects(
    withStagingReleaseMutationLease(
      {
        acquire: async () => resumed,
        release: async () => assert.fail("ambiguous actions must not release"),
        inspect: async () => { throw new Error("lease inspection timed out"); },
      },
      async () => { throw new Error("mutation failed"); },
    ),
    (error) => {
      assert.equal(error.code, "STAGING_RELEASE_LEASE_ACTION_AMBIGUOUS");
      assert.equal(error.releaseMutationLeaseToken, token);
      assert.match(error.message, /ownership is unknown/);
      assert.doesNotMatch(error.message, /remains held/u);
      return true;
    },
  );

  const value = await withStagingReleaseMutationLease(
    {
      acquire: async () => resumed,
      release: async (released) => {
        assert.equal(released, token);
        releases += 1;
      },
    },
    async () => "completed-after-immutable-receipt",
  );
  assert.equal(value, "completed-after-immutable-receipt");
  assert.equal(releases, 1);

  await assert.rejects(
    withStagingReleaseMutationLease(
      {
        acquire: async () => resumed,
        release: async () => {
          const error = new Error("release outcome is unknown");
          error.code = "STAGING_RELEASE_LEASE_RELEASE_AMBIGUOUS";
          throw error;
        },
      },
      async () => "receipt-is-durable",
    ),
    (error) => {
      assert.equal(error.code, "STAGING_RELEASE_LEASE_RELEASE_AMBIGUOUS");
      assert.doesNotMatch(error.message, /remains held/u);
      return true;
    },
  );
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
    SSH_ASKPASS: "/attacker/askpass",
    SSH_ASKPASS_REQUIRE: "force",
  });
  assert.equal(environment.GIT_OBJECT_DIRECTORY, undefined);
  assert.equal(environment.SSL_CERT_FILE, undefined);
  assert.equal(environment.SSL_CERT_DIR, undefined);
  assert.equal(environment.CURL_CA_BUNDLE, undefined);
  assert.equal(environment.HTTPS_PROXY, undefined);
  assert.equal(environment.RSYNC_PROXY, undefined);
  assert.equal(environment.GH_HOST, undefined);
  assert.equal(environment.SSH_ASKPASS, undefined);
  assert.equal(environment.SSH_ASKPASS_REQUIRE, undefined);
  assert.equal(environment.GIT_ASKPASS, RELEASE_GIT_ASKPASS);
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

test("release Git rejects fsmonitor before deeper posture inspection can execute it", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fmarch-release-git-fsmonitor-"));
  const repository = path.join(directory, "repo");
  mkdirSync(repository);
  const git = (args) => execFileSync("git", args, {
    cwd: repository,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  try {
    git(["init", "--quiet"]);
    writeFileSync(path.join(repository, "tracked.txt"), "tracked\n");
    git(["add", "tracked.txt"]);
    git(["config", "core.fsmonitor", "/usr/bin/touch"]);
    const before = readdirSync(repository).sort();

    assert.throws(() => assertReleaseGitPosture({ root: repository }), /transport authority/);
    assert.deepEqual(
      readdirSync(repository).sort(),
      before,
      "the forbidden fsmonitor command must not create its hook-argument files",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("release Git never invokes ambient askpass authority", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "fmarch-release-git-askpass-"));
  const askpass = path.join(directory, "ambient-askpass.sh");
  const marker = path.join(directory, "askpass-ran");
  writeFileSync(askpass, `#!/bin/sh\n/usr/bin/touch "${marker}"\nprintf 'attacker\\n'\n`);
  chmodSync(askpass, 0o700);
  const environment = releaseGitEnvironment({
    ...process.env,
    GIT_ASKPASS: askpass,
    SSH_ASKPASS: askpass,
    SSH_ASKPASS_REQUIRE: "force",
  });
  try {
    assert.throws(() => execFileSync(
      "git",
      ["-c", "credential.helper=", "credential", "fill"],
      {
        cwd: directory,
        env: environment,
        input: "protocol=https\nhost=credentials.example.invalid\n\n",
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      },
    ));
    assert.equal(existsSync(marker), false, "ambient askpass must never execute");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
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
