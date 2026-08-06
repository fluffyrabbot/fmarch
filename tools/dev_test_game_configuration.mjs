import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  devTestGameEarliestReachedProofPath,
} from "./dev_test_game_earliest_reached_proof_contract.mjs";
import {
  devTestGameHostDecidesProofPath,
} from "./dev_test_game_host_decides_proof_contract.mjs";
import {
  devTestGameHostDecidesRaceProofPath,
} from "./dev_test_game_host_decides_race_proof_contract.mjs";

export const defaultDatabaseUrl =
  "postgres://fmarch:fmarch@localhost:5544/fmarch";
export const defaultGameName = "local";
export const defaultApiStartupTimeoutMs = 15 * 60 * 1000;
export const liveProjectionProofBurstSize = 5;
export const defaultLiveProjectionProofCapacity = 4;

const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function buildDevTestGamePaths({
  repoRoot = defaultRepoRoot,
  env = process.env,
} = {}) {
  const normalizedRepoRoot = path.resolve(repoRoot);
  const frontendRoot = path.join(normalizedRepoRoot, "frontend");
  const artifactDir = path.join(
    normalizedRepoRoot,
    "target",
    "dev-test-game",
  );
  const configuredMediaRoot = env.FMARCH_MEDIA_ROOT;
  if (
    configuredMediaRoot !== undefined &&
    configuredMediaRoot.trim() === ""
  ) {
    throw new Error("FMARCH_MEDIA_ROOT must not be empty");
  }
  const mediaRoot =
    configuredMediaRoot === undefined
      ? path.join(artifactDir, "media-store")
      : path.resolve(normalizedRepoRoot, configuredMediaRoot);
  const canonicalSession = Object.freeze({
    json: path.join(artifactDir, "session.json"),
    markdown: path.join(artifactDir, "session.md"),
    proofRun: path.join(artifactDir, "proof-run.json"),
  });
  const hostSetupSession = Object.freeze({
    json: path.join(artifactDir, "host-setup-session.json"),
    markdown: path.join(artifactDir, "host-setup-session.md"),
    proofRun: path.join(artifactDir, "host-setup-proof.json"),
  });
  const proof = Object.freeze({
    earliestReached: path.join(
      normalizedRepoRoot,
      devTestGameEarliestReachedProofPath,
    ),
    hostDecides: path.join(
      normalizedRepoRoot,
      devTestGameHostDecidesProofPath,
    ),
    hostDecidesRace: path.join(
      normalizedRepoRoot,
      devTestGameHostDecidesRaceProofPath,
    ),
    hostSetup: hostSetupSession.proofRun,
  });
  return Object.freeze({
    repoRoot: normalizedRepoRoot,
    frontendRoot,
    frontendPackageJson: path.join(frontendRoot, "package.json"),
    artifactDir,
    mediaRoot,
    namedGames: path.join(artifactDir, "named-games.json"),
    session: Object.freeze({
      canonical: canonicalSession,
      hostSetup: hostSetupSession,
    }),
    proof,
  });
}

export const defaultDevTestGamePaths = buildDevTestGamePaths();

export function normalizeDevTestGameConfiguration({
  rawArgs = process.argv.slice(2),
  env = process.env,
  repoRoot = defaultRepoRoot,
} = {}) {
  const args = parseArgs(rawArgs);
  const paths = buildDevTestGamePaths({ repoRoot, env });
  const verificationMode = args.help ? null : selectedVerificationMode(args);
  return Object.freeze({
    args,
    paths,
    databaseUrl: args.databaseUrl ?? env.DATABASE_URL ?? defaultDatabaseUrl,
    gameName: args.name ?? env.FMARCH_DEV_TEST_GAME_NAME ?? defaultGameName,
    apiBaseUrl: args.apiBaseUrl,
    frontendBaseUrl: args.frontendBaseUrl,
    apiStartupTimeoutMs:
      args.apiStartupTimeoutMs ?? defaultApiStartupTimeoutMs,
    verificationMode,
  });
}

export function completeDevTestGameConfiguration({
  configuration,
  registry,
  randomUuid = () => crypto.randomUUID(),
}) {
  const selection = selectGame({
    args: configuration.args,
    gameName: configuration.gameName,
    registry,
    randomUuid,
  });
  const tokenPrefix =
    configuration.args.tokenPrefix ??
    `dev-test-${configuration.gameName}-${selection.game}-${randomUuid()}`;
  return Object.freeze({
    ...configuration,
    game: selection.game,
    seedMode: selection.seedMode,
    tokenPrefix,
  });
}

export function liveProjectionProofConfig(env = process.env) {
  const capacity = Number(
    env.FMARCH_LIVE_PROJECTION_CAPACITY ??
      defaultLiveProjectionProofCapacity,
  );
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new Error(
      "FMARCH_LIVE_PROJECTION_CAPACITY must be a positive integer",
    );
  }
  if (capacity >= liveProjectionProofBurstSize) {
    throw new Error(
      `FMARCH_LIVE_PROJECTION_CAPACITY must stay below the ${liveProjectionProofBurstSize}-message lag proof burst`,
    );
  }
  return Object.freeze({ capacity, burstSize: liveProjectionProofBurstSize });
}

export function selectGame({
  args,
  gameName,
  registry,
  randomUuid = () => crypto.randomUUID(),
}) {
  if (args.reset && args.reuse) {
    throw new Error("--reset and --reuse are mutually exclusive");
  }
  const registered = registry[gameName]?.game;
  if (args.reuse) {
    const reuseGame = args.game ?? registered;
    if (reuseGame === undefined) {
      throw new Error(
        `no named game '${gameName}' exists to reuse; run with --reset first`,
      );
    }
    return Object.freeze({ game: reuseGame, seedMode: "reuse" });
  }
  if (args.reset) {
    return Object.freeze({
      game: args.game ?? randomUuid(),
      seedMode: "seed",
    });
  }
  if (registered !== undefined && args.game === undefined) {
    return Object.freeze({ game: registered, seedMode: "reuse-if-present" });
  }
  return Object.freeze({
    game: args.game ?? randomUuid(),
    seedMode: "seed",
  });
}

export function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    switch (value) {
      case "--api-base-url":
        parsed.apiBaseUrl = requireValue(values, ++index, value).replace(
          /\/$/,
          "",
        );
        break;
      case "--api-port":
        parsed.apiPort = parsePositiveInt(
          requireValue(values, ++index, value),
          value,
        );
        break;
      case "--api-startup-timeout-ms":
        parsed.apiStartupTimeoutMs = parsePositiveInt(
          requireValue(values, ++index, value),
          value,
        );
        break;
      case "--frontend-base-url":
        parsed.frontendBaseUrl = requireValue(values, ++index, value).replace(
          /\/$/,
          "",
        );
        break;
      case "--database-url":
        parsed.databaseUrl = requireValue(values, ++index, value);
        break;
      case "--frontend-port":
        parsed.frontendPort = parsePositiveInt(
          requireValue(values, ++index, value),
          value,
        );
        break;
      case "--game":
        parsed.game = requireValue(values, ++index, value);
        break;
      case "--name":
        parsed.name = requireValue(values, ++index, value);
        break;
      case "--reset":
        parsed.reset = true;
        break;
      case "--reuse":
        parsed.reuse = true;
        break;
      case "--token-prefix":
        parsed.tokenPrefix = requireValue(values, ++index, value);
        break;
      case "--verify":
        parsed.verify = true;
        break;
      case "--verify-host-setup-only":
        parsed.verifyHostSetupOnly = true;
        break;
      case "--verify-earliest-reached-only":
        parsed.verifyEarliestReachedOnly = true;
        break;
      case "--verify-host-decides-only":
        parsed.verifyHostDecidesOnly = true;
        break;
      case "--no-keepalive":
        parsed.noKeepalive = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${value}`);
    }
  }
  return Object.freeze(parsed);
}

export function devTestGameHelp() {
  return `Usage: npm run dev:test-game -- [options]

Starts a local Rust API and SvelteKit frontend, seeds one mafiascum D01 game,
creates browser-login tokens, prints role URLs, and writes target/dev-test-game/session.md.
With --verify, it also writes target/dev-test-game/proof-run.json.

Options:
  --api-base-url URL       Use an existing API instead of starting cargo run -p server
  --api-port PORT          Port for a started API
  --api-startup-timeout-ms Milliseconds to wait for a started API (default: ${defaultApiStartupTimeoutMs})
  --frontend-base-url URL  Use an existing frontend instead of starting Vite
  --database-url URL       DATABASE_URL for a started API (default: ${defaultDatabaseUrl})
  --frontend-port PORT     Port for a started frontend
  --name NAME              Friendly named game slot (default: ${defaultGameName})
  --game UUID              Use a specific game id
  --reset                  Seed a fresh game for the name
  --reuse                  Reuse the named or explicit game without reseeding
  --token-prefix TEXT      Prefix for generated opaque login tokens
  --verify                 Verify host and player browser entry before returning
  --verify-host-setup-only Verify only the host setup role URL browser proof
  --verify-earliest-reached-only Verify only the disposable EarliestReached role URL browser proof
  --verify-host-decides-only     Verify only the disposable HostDecides role URL browser proof
  --no-keepalive           Stop started servers after seeding and writing artifacts
  --help                   Show this help
`;
}

function selectedVerificationMode(args) {
  const selected = [
    [args.verify, "full"],
    [args.verifyHostSetupOnly, "host-setup"],
    [args.verifyEarliestReachedOnly, "earliest-reached"],
    [args.verifyHostDecidesOnly, "host-decides"],
  ].filter(([enabled]) => enabled);
  if (selected.length > 1) {
    throw new Error("only one dev-test-game verification mode may be selected");
  }
  return selected[0]?.[1] ?? null;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function requireValue(values, index, flag) {
  const value = values[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
