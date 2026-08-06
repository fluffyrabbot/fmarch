import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildDevTestGamePaths,
  completeDevTestGameConfiguration,
  defaultApiStartupTimeoutMs,
  defaultDatabaseUrl,
  defaultGameName,
  devTestGameHelp,
  liveProjectionProofConfig,
  normalizeDevTestGameConfiguration,
  parseArgs,
  selectGame,
} from "./dev_test_game_configuration.mjs";
import {
  devTestGameEarliestReachedProofPath,
} from "./dev_test_game_earliest_reached_proof_contract.mjs";
import {
  devTestGameHostDecidesProofPath,
} from "./dev_test_game_host_decides_proof_contract.mjs";
import {
  devTestGameHostDecidesRaceProofPath,
} from "./dev_test_game_host_decides_race_proof_contract.mjs";

const repoRoot = path.resolve("/tmp/fmarch-dev-test-game-configuration");

test("CLI parsing preserves every flag, normalization rule, and immutable result", () => {
  const args = parseArgs([
    "--api-base-url",
    "https://api.example.test/",
    "--api-port",
    "4101",
    "--api-startup-timeout-ms",
    "900000",
    "--frontend-base-url",
    "https://app.example.test/",
    "--database-url",
    "postgres://db/fmarch",
    "--frontend-port",
    "4102",
    "--game",
    "game-a",
    "--name",
    "morning",
    "--reset",
    "--reuse",
    "--token-prefix",
    "proof",
    "--verify-host-setup-only",
    "--no-keepalive",
  ]);
  assert.deepEqual(args, {
    apiBaseUrl: "https://api.example.test",
    apiPort: 4101,
    apiStartupTimeoutMs: 900000,
    frontendBaseUrl: "https://app.example.test",
    databaseUrl: "postgres://db/fmarch",
    frontendPort: 4102,
    game: "game-a",
    name: "morning",
    reset: true,
    reuse: true,
    tokenPrefix: "proof",
    verifyHostSetupOnly: true,
    noKeepalive: true,
  });
  assert.equal(Object.isFrozen(args), true);
  assert.equal(parseArgs(["-h"]).help, true);
  assert.equal(
    parseArgs(["--verify-earliest-reached-only"]).verifyEarliestReachedOnly,
    true,
  );
  assert.equal(
    parseArgs(["--verify-host-decides-only"]).verifyHostDecidesOnly,
    true,
  );
  assert.equal(parseArgs(["--verify"]).verify, true);
  assert.throws(() => parseArgs(["--frontend-port", "nope"]), /positive integer/);
  assert.throws(() => parseArgs(["--game"]), /requires a value/);
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});

test("normalization resolves CLI over environment over defaults and one verification mode", () => {
  const defaults = normalizeDevTestGameConfiguration({
    rawArgs: [],
    env: {},
    repoRoot,
  });
  assert.equal(defaults.databaseUrl, defaultDatabaseUrl);
  assert.equal(defaults.gameName, defaultGameName);
  assert.equal(defaults.apiStartupTimeoutMs, defaultApiStartupTimeoutMs);
  assert.equal(defaults.apiBaseUrl, undefined);
  assert.equal(defaults.frontendBaseUrl, undefined);
  assert.equal(defaults.verificationMode, null);

  const fromEnvironment = normalizeDevTestGameConfiguration({
    rawArgs: ["--verify-host-decides-only"],
    env: {
      DATABASE_URL: "postgres://environment/fmarch",
      FMARCH_DEV_TEST_GAME_NAME: "environment-name",
      FMARCH_LIVE_PROJECTION_CAPACITY: "3",
    },
    repoRoot,
  });
  assert.equal(fromEnvironment.databaseUrl, "postgres://environment/fmarch");
  assert.equal(fromEnvironment.gameName, "environment-name");
  assert.equal(fromEnvironment.verificationMode, "host-decides");

  const fromCli = normalizeDevTestGameConfiguration({
    rawArgs: [
      "--database-url",
      "postgres://cli/fmarch",
      "--name",
      "cli-name",
      "--api-startup-timeout-ms",
      "1234",
      "--verify",
    ],
    env: {
      DATABASE_URL: "postgres://environment/fmarch",
      FMARCH_DEV_TEST_GAME_NAME: "environment-name",
    },
    repoRoot,
  });
  assert.equal(fromCli.databaseUrl, "postgres://cli/fmarch");
  assert.equal(fromCli.gameName, "cli-name");
  assert.equal(fromCli.apiStartupTimeoutMs, 1234);
  assert.equal(fromCli.verificationMode, "full");
  assert.equal(Object.isFrozen(fromCli), true);
  assert.equal(Object.isFrozen(fromCli.paths), true);
  assert.equal(Object.isFrozen(fromCli.paths.session), true);

  assert.throws(
    () =>
      normalizeDevTestGameConfiguration({
        rawArgs: ["--verify", "--verify-host-setup-only"],
        env: {},
        repoRoot,
      }),
    /only one dev-test-game verification mode/,
  );
  assert.equal(
    normalizeDevTestGameConfiguration({
      rawArgs: ["--help", "--verify", "--verify-host-setup-only"],
      env: {},
      repoRoot,
    }).verificationMode,
    null,
  );
});

test("path normalization owns every media, session, registry, and proof destination", () => {
  const paths = buildDevTestGamePaths({
    repoRoot,
    env: { FMARCH_MEDIA_ROOT: "target/custom-media" },
  });
  assert.equal(paths.repoRoot, repoRoot);
  assert.equal(paths.frontendRoot, path.join(repoRoot, "frontend"));
  assert.equal(
    paths.frontendPackageJson,
    path.join(repoRoot, "frontend", "package.json"),
  );
  assert.equal(
    paths.artifactDir,
    path.join(repoRoot, "target", "dev-test-game"),
  );
  assert.equal(paths.mediaRoot, path.join(repoRoot, "target", "custom-media"));
  assert.equal(
    paths.namedGames,
    path.join(repoRoot, "target", "dev-test-game", "named-games.json"),
  );
  assert.deepEqual(paths.session.canonical, {
    json: path.join(repoRoot, "target", "dev-test-game", "session.json"),
    markdown: path.join(repoRoot, "target", "dev-test-game", "session.md"),
    proofRun: path.join(repoRoot, "target", "dev-test-game", "proof-run.json"),
  });
  assert.deepEqual(paths.session.hostSetup, {
    json: path.join(repoRoot, "target", "dev-test-game", "host-setup-session.json"),
    markdown: path.join(repoRoot, "target", "dev-test-game", "host-setup-session.md"),
    proofRun: path.join(repoRoot, "target", "dev-test-game", "host-setup-proof.json"),
  });
  assert.equal(
    paths.proof.earliestReached,
    path.join(repoRoot, devTestGameEarliestReachedProofPath),
  );
  assert.equal(
    paths.proof.hostDecides,
    path.join(repoRoot, devTestGameHostDecidesProofPath),
  );
  assert.equal(
    paths.proof.hostDecidesRace,
    path.join(repoRoot, devTestGameHostDecidesRaceProofPath),
  );
  assert.equal(paths.proof.hostSetup, paths.session.hostSetup.proofRun);
  assert.equal(Object.isFrozen(paths.proof), true);

  const defaults = buildDevTestGamePaths({ repoRoot, env: {} });
  assert.equal(
    defaults.mediaRoot,
    path.join(repoRoot, "target", "dev-test-game", "media-store"),
  );
  assert.throws(
    () => buildDevTestGamePaths({ repoRoot, env: { FMARCH_MEDIA_ROOT: "  " } }),
    /must not be empty/,
  );
});

test("game selection preserves reset, reuse, idempotent naming, and token inputs", () => {
  const registry = {
    local: { game: "registered-game" },
  };
  assert.deepEqual(selectGame({ args: {}, gameName: "local", registry }), {
    game: "registered-game",
    seedMode: "reuse-if-present",
  });
  assert.deepEqual(
    selectGame({ args: { reuse: true }, gameName: "local", registry }),
    { game: "registered-game", seedMode: "reuse" },
  );
  assert.deepEqual(
    selectGame({
      args: { reset: true },
      gameName: "local",
      registry,
      randomUuid: () => "fresh-game",
    }),
    { game: "fresh-game", seedMode: "seed" },
  );
  assert.throws(
    () => selectGame({ args: { reset: true, reuse: true }, gameName: "local", registry }),
    /mutually exclusive/,
  );
  assert.throws(
    () => selectGame({ args: { reuse: true }, gameName: "missing", registry: {} }),
    /no named game 'missing'/,
  );

  const ids = ["fresh-game", "token-suffix"];
  const completed = completeDevTestGameConfiguration({
    configuration: normalizeDevTestGameConfiguration({
      rawArgs: ["--reset", "--name", "night"],
      env: {},
      repoRoot,
    }),
    registry: {},
    randomUuid: () => ids.shift(),
  });
  assert.equal(completed.game, "fresh-game");
  assert.equal(completed.seedMode, "seed");
  assert.equal(completed.tokenPrefix, "dev-test-night-fresh-game-token-suffix");
  assert.equal(Object.isFrozen(completed), true);
});

test("live projection lag configuration and help defaults remain exact", () => {
  assert.deepEqual(liveProjectionProofConfig({}), {
    capacity: 4,
    burstSize: 5,
  });
  assert.deepEqual(
    liveProjectionProofConfig({ FMARCH_LIVE_PROJECTION_CAPACITY: "3" }),
    { capacity: 3, burstSize: 5 },
  );
  assert.throws(
    () => liveProjectionProofConfig({ FMARCH_LIVE_PROJECTION_CAPACITY: "5" }),
    /must stay below/,
  );
  assert.throws(
    () => liveProjectionProofConfig({ FMARCH_LIVE_PROJECTION_CAPACITY: "0" }),
    /positive integer/,
  );

  const help = devTestGameHelp();
  assert.match(help, /^Usage: npm run dev:test-game -- \[options\]/);
  assert.match(help, new RegExp(`default: ${defaultApiStartupTimeoutMs}`));
  assert.match(help, new RegExp(`default: ${defaultDatabaseUrl.replaceAll("/", "\\/")}`));
  assert.match(help, new RegExp(`default: ${defaultGameName}`));
  for (const flag of [
    "--api-base-url",
    "--api-port",
    "--api-startup-timeout-ms",
    "--frontend-base-url",
    "--database-url",
    "--frontend-port",
    "--name",
    "--game",
    "--reset",
    "--reuse",
    "--token-prefix",
    "--verify",
    "--verify-host-setup-only",
    "--verify-earliest-reached-only",
    "--verify-host-decides-only",
    "--no-keepalive",
    "--help",
  ]) {
    assert.match(help, new RegExp(flag));
  }
  assert.equal(help.endsWith("\n"), true);
});
