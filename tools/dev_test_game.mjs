import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertDevTestGameProofRun,
  buildDevTestGameProofRun,
} from "./dev_test_game_proof_contract.mjs";
import {
  replacementActionReconnectScenario,
  replacementIncomingActionScenario,
  replacementStaleActionAfterResolveScenario,
} from "./dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementConcurrentActionRaceScenario,
  replacementConcurrentPrivatePostRaceScenario,
  replacementConcurrentVoteRaceScenario,
  replacementStalePrivatePostAfterResolveScenario,
  replacementStalePrivatePostAfterCompleteScenario,
} from "./dev_test_game_replacement_private_scenario_cases.mjs";
import {
  playerInvalidActionRecoveryMessage,
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenarios.mjs";
import {
  assertLiveStaleD02VoteTransitionRecovery,
  assertLiveStaleN01ActionTransitionRecovery,
} from "./dev_test_game_core_loop_transition_recovery_scenario_assertions.mjs";
import {
  assertPrivateChannelContext,
  assertPrivateChannelId,
  assertPrivateChannelRouteContext,
} from "./dev_test_game_core_loop_private_channel_context_assertions.mjs";
import {
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelStalePostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  assertNightThreeProgressionBrowserProof,
  nightThreeActionTargetFromCommandState,
  nightThreeProgressionActionId,
  nightThreeProgressionBrowserScenario,
} from "./dev_test_game_core_loop_night_three_progression_scenarios.mjs";
import {
  assertRevoteProgressionBrowserProof,
  revoteNoLynchTargetFromCommandState,
  revoteProgressionBrowserScenario,
  revoteProgressionVoteActionId,
} from "./dev_test_game_core_loop_revote_progression_scenarios.mjs";
import {
  assertTerminalRecoveryBrowserProof,
  terminalRecoveryBrowserScenario,
} from "./dev_test_game_core_loop_terminal_recovery_scenarios.mjs";
import {
  assertCompletedPlayerEndgameRefreshBrowserProof,
  completedPlayerEndgameRefreshScenario,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";
import {
  createUnexpectedMediaResponseGuard,
} from "./dev_test_game_media_response_guard.mjs";
import {
  assertLiveCompletedPrivateChannelPostRejectOutcome,
  assertLivePrivateChannelSubmitPostAckOutcome,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";
import {
  buildSetupCommandEvidence,
  runSeededSetupBootstrapScenario,
  seedPreSetupCommandPlanForGame,
  seedSetupCommandPlanForGame,
  verifyHostSetupPolicyCommandRoundTrip,
  waitForHostSetupCommand,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";
import {
  assertVanillizerRoleActionBrowserProof,
  vanillizerRoleActionScenario,
  vanillizerSeedCommandPlan,
} from "./dev_test_game_vanillizer_scenario.mjs";

export {
  seedPreSetupCommandPlanForGame,
  seedSetupCommandPlanForGame,
  seededSetupRoster,
} from "./dev_test_game_setup_bootstrap_scenario.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const sessionJsonPath = path.join(artifactDir, "session.json");
const sessionMdPath = path.join(artifactDir, "session.md");
const proofRunJsonPath = path.join(artifactDir, "proof-run.json");
const hostSetupSessionJsonPath = path.join(artifactDir, "host-setup-session.json");
const hostSetupSessionMdPath = path.join(artifactDir, "host-setup-session.md");
const hostSetupProofJsonPath = path.join(artifactDir, "host-setup-proof.json");
const namedGamesPath = path.join(artifactDir, "named-games.json");
export const defaultDatabaseUrl = "postgres://fmarch:fmarch@localhost:5544/fmarch";
export const defaultGameName = "local";
export const defaultApiStartupTimeoutMs = 15 * 60 * 1000;
const factionDayChatChannel = "private:mafia_day_chat";
const factionDayChatPostBody = "Faction day chat post from dev:test-game.";
const hardeningRetryChannel = "main";
const host = "127.0.0.1";
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

function isStaleVotePhaseLockedMessage(message) {
  return (
    String(message ?? "").includes("stale projection") ||
    String(message ?? "").includes("stale vote state")
  );
}

let apiServer;
let vite;
let args;
let databaseUrl;
let game;
let gameName;
let tokenPrefix;
let tokens;
let expiresAt;
let apiBaseUrl;
let frontendBaseUrl;
let seedMode;
let commandEnvelopeId = 1;
let serverOutput = "";
let apiServerExit;
let apiStartupTimeoutMs = defaultApiStartupTimeoutMs;
let proofStabilityAudit;
let identityBootstrap;
let localAccounts;

export async function main(rawArgs = process.argv.slice(2), env = process.env) {
  args = parseArgs(rawArgs);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.verify && args.verifyHostSetupOnly) {
    throw new Error("--verify and --verify-host-setup-only are mutually exclusive");
  }

  databaseUrl = args.databaseUrl ?? env.DATABASE_URL ?? defaultDatabaseUrl;
  gameName = args.name ?? env.FMARCH_DEV_TEST_GAME_NAME ?? defaultGameName;
  const registry = await readNamedGames();
  const selection = selectGame({ args, gameName, registry });
  game = selection.game;
  seedMode = selection.seedMode;
  tokenPrefix = args.tokenPrefix ?? `dev-test-${gameName}-${game}-${crypto.randomUUID()}`;
  tokens = createTokenSet(tokenPrefix);
  expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
  apiBaseUrl = args.apiBaseUrl;
  frontendBaseUrl = args.frontendBaseUrl;
  apiStartupTimeoutMs = args.apiStartupTimeoutMs ?? defaultApiStartupTimeoutMs;
  commandEnvelopeId = 1;
  serverOutput = "";
  apiServerExit = undefined;
  identityBootstrap = undefined;
  localAccounts = new Map();

  await mkdir(artifactDir, { recursive: true });
  if (apiBaseUrl === undefined) {
    await assertPostgresReachable(databaseUrl);
    apiBaseUrl = await startApi();
  } else {
    await waitForHealth(apiBaseUrl);
  }

  const seedResult = await seedGame();
  const sessions = await createSessions();
  const sessionArtifacts = args.verifyHostSetupOnly
    ? sessionArtifactsForPaths({
        jsonPath: hostSetupSessionJsonPath,
        markdownPath: hostSetupSessionMdPath,
        proofRunPath: hostSetupProofJsonPath,
      })
    : sessionArtifactsForPaths({
        jsonPath: sessionJsonPath,
        markdownPath: sessionMdPath,
        proofRunPath: proofRunJsonPath,
      });

  if (frontendBaseUrl === undefined) {
    frontendBaseUrl = await startFrontend(apiBaseUrl);
  }

  let card = buildSessionCard({
    game,
    gameName,
    seedMode: seedResult.mode,
    databaseUrl,
    apiBaseUrl,
    frontendBaseUrl,
    seedCommands: seedResult.commands,
    identityBootstrap,
    sessions,
    artifacts: sessionArtifacts,
  });
  if (seedResult.shouldRunSetupBootstrap) {
    const setupBootstrap = await bootstrapSeededGameThroughSetup(card);
    const postSetup = await seedPostSetupGameplayCommands();
    card = buildSessionCard({
      game,
      gameName,
      seedMode: seedResult.mode,
      databaseUrl,
      apiBaseUrl,
      frontendBaseUrl,
      seedCommands: [...seedResult.commands, ...postSetup.commands],
      setupBootstrap,
      identityBootstrap,
      sessions,
      artifacts: sessionArtifacts,
    });
  }
  await writeSessionArtifacts(card, sessionArtifacts);
  await writeNamedGame(gameName, card);
  printSessionCard(card);

  if (args.verify || args.verifyHostSetupOnly) {
    const verification = args.verifyHostSetupOnly
      ? await verifyHostSetupOnly(card)
      : await verifySessionCard(card);
    card.verification = verification;
    await writeSessionArtifacts(card, sessionArtifacts);
    const hostSetupProof = buildDevTestGameHostSetupProof(card, verification);
    await writeFile(
      hostSetupProofJsonPath,
      `${JSON.stringify(hostSetupProof, null, 2)}\n`,
    );
    if (args.verifyHostSetupOnly) {
      console.log(`\nverified host setup browser proof: ${path.relative(repoRoot, hostSetupProofJsonPath)}`);
    } else {
      const proofRun = buildDevTestGameProofRun(card);
      assertDevTestGameProofRun(proofRun);
      await writeFile(proofRunJsonPath, `${JSON.stringify(proofRun, null, 2)}\n`);
      console.log(`\nverified browser entry: ${verification.roles.join(", ")}`);
    }
  }

  if (args.noKeepalive) {
    await shutdown();
  } else {
    console.log("\nKeeping the API and frontend alive. Press Ctrl-C to stop.");
    await new Promise(() => {});
  }
}

export function buildDevTestGameHostSetupProof(
  card,
  verification,
  { generatedAt = new Date().toISOString() } = {},
) {
  return {
    proof: "dev-test-game-host-setup-proof",
    status: "passed",
    game: card.game,
    generatedAt,
    proofBoundary:
      "Local dev-test-game host setup role URL browser proof over the seeded setup route plus a disposable setup game. Proves setup route rendering, policy round-trip, stale duplicate AddSlot rejection, setup refresh after reject, roster assignment, role assignment, and readiness recovery; it does not prove the full core loop, multiplayer hardening, hosted deployment, beta readiness, or production readiness.",
    hostSetup: verification.hostSetup,
    mediaResponseGuard: verification.mediaResponseGuard,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  process.on("SIGINT", () => {
    shutdown().then(() => process.exit(130));
  });
  process.on("SIGTERM", () => {
    shutdown().then(() => process.exit(143));
  });
  main().catch(async (error) => {
    await shutdown();
    if (serverOutput !== "") {
      error.serverOutput = serverOutput.slice(-4000);
    }
    console.error(error);
    process.exit(1);
  });
}

async function startApi() {
  const port = args.apiPort ?? (await freePort());
  if (args.apiPort !== undefined) {
    await assertPortAvailable(port, "API");
  }
  const baseUrl = `http://${host}:${port}`;
  console.log(`starting Rust API on ${baseUrl} with cargo run -p server`);
  apiServer = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      FMARCH_BIND: `${host}:${port}`,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  console.log(`Rust API process pid: ${apiServer.pid}`);
  apiServer.stdout.on("data", (chunk) => {
    recordServerOutput(chunk);
  });
  apiServer.stderr.on("data", (chunk) => {
    recordServerOutput(chunk);
  });
  apiServer.once("error", (error) => {
    apiServerExit = { error };
  });
  apiServer.once("exit", (code, signal) => {
    apiServerExit = { code, signal };
  });
  await waitForHealth(baseUrl, {
    label: "Rust API",
    timeoutMs: apiStartupTimeoutMs,
    progress: () => lastServerOutputLine(),
    beforeRetry: () => {
      if (apiServerExit !== undefined) {
        throw new Error(
          `rust server exited before healthcheck: ${JSON.stringify(apiServerExit)}\n${serverOutput}`,
        );
      }
    },
  });
  return baseUrl;
}

async function startFrontend(currentApiBaseUrl) {
  process.env.FMARCH_API_BASE_URL = currentApiBaseUrl;
  if (args.frontendPort !== undefined) {
    await assertPortAvailable(args.frontendPort, "frontend");
  }
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer: createViteServer } = await import(
      frontendRequire.resolve("vite")
    );
    vite = await createViteServer({
      root: frontendRoot,
      server: {
        host,
        port: args.frontendPort ?? 0,
        strictPort: args.frontendPort !== undefined,
        proxy: {
          "/commands": currentApiBaseUrl,
          "/games": currentApiBaseUrl,
          "/ws": {
            target: currentApiBaseUrl,
            ws: true,
          },
        },
      },
      logLevel: "error",
    });
  } finally {
    process.chdir(previousCwd);
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit dev server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

async function seedGame() {
  if (seedMode === "reuse") {
    return { mode: "reused", commands: [], shouldRunSetupBootstrap: false };
  }
  const commands = [];
  const plan = seedPreSetupCommandPlanForGame(game);
  for (let index = 0; index < plan.length; index += 1) {
    const [principalUserId, command] = plan[index];
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      if (index === 0 && result.body.body?.error === "UnknownGame") {
        if (seedMode === "reuse-if-present") {
          return { mode: "reused", commands: [], shouldRunSetupBootstrap: false };
        }
        throw new Error(
          `game ${game} already exists; rerun with --reuse to use it or --reset to create a fresh named game`,
        );
      }
      throw new Error(`seed command rejected: ${JSON.stringify(result)}`);
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return { mode: "seeded", commands, shouldRunSetupBootstrap: true };
}

export function seedPostSetupCommandPlanForGame(game) {
  return [
    ["host_h", { AddCohost: { game, user: "cohost_c" } }],
    [
      "player-seed",
      { SubmitVote: { game, actor_slot: "slot-3", target: { Slot: "slot_5" } } },
    ],
    [
      "player-target",
      { SubmitVote: { game, actor_slot: "slot-2", target: { Slot: "slot_5" } } },
    ],
    [
      "player-mira",
      { SubmitVote: { game, actor_slot: "slot-7", target: { Slot: "slot_5" } } },
    ],
    [
      "player-mira",
      {
        SubmitPost: {
          game,
          channel_id: "main",
          actor_slot: "slot-7",
          body: "Seeded browser test-game thread post from dev:test-game.",
        },
      },
    ],
  ];
}

export function seedCommandPlanForGame(game) {
  return [
    ...seedSetupCommandPlanForGame(game),
    ...seedPostSetupCommandPlanForGame(game),
  ];
}

async function seedPostSetupGameplayCommands() {
  const commands = [];
  for (const [principalUserId, command] of seedPostSetupCommandPlanForGame(game)) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return { commands };
}

async function createSessions() {
  identityBootstrap = await seedRootAdminSession();
  await ensureLocalAccount({ principalUserId: "player-rowan" });

  return {
    admin: await createInviteCredential({
      inviteToken: tokens.admin,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
      returnTo: "/admin",
      expectedCapabilityKind: "GlobalAdmin",
    }),
    host: await createInviteCredential({
      inviteToken: tokens.host,
      principalUserId: "host_h",
      returnTo: `/g/${game}/host`,
      expectedCapabilityKind: "HostOf",
    }),
    hostSetup: await createInviteCredential({
      inviteToken: tokens.hostSetup,
      principalUserId: "host_h",
      returnTo: `/g/${game}/setup`,
      expectedCapabilityKind: "HostOf",
    }),
    player: await createInviteCredential({
      inviteToken: tokens.player,
      principalUserId: "player-mira",
      returnTo: `/g/${game}`,
      expectedCapabilityKind: "SlotOccupant",
    }),
    actionPlayer: await createInviteCredential({
      inviteToken: tokens.actionPlayer,
      principalUserId: "player-goon-a",
      returnTo: `/g/${game}`,
      expectedCapabilityKind: "SlotOccupant",
    }),
    deniedPlayer: await createInviteCredential({
      inviteToken: tokens.deniedPlayer,
      principalUserId: "player-target",
      returnTo: `/g/${game}`,
      expectedCapabilityKind: "SlotOccupant",
    }),
    cohost: await createInviteCredential({
      inviteToken: tokens.cohost,
      principalUserId: "cohost_c",
      returnTo: `/g/${game}/host`,
      expectedCapabilityKind: "CohostOf",
    }),
  };
}

async function seedRootAdminSession() {
  await runSql(databaseUrl, `
    INSERT INTO auth_session (
      token_hash,
      principal_user_id,
      created_at,
      expires_at,
      revoked_at,
      global_capabilities
    )
    VALUES (
      ${sqlLiteral(hashSessionToken(tokens.rootAdmin))},
      'root_admin',
      0,
      ${Number(expiresAt)},
      NULL,
      ARRAY['GlobalAdmin']::TEXT[]
    )
    ON CONFLICT (token_hash) DO UPDATE SET
      principal_user_id = EXCLUDED.principal_user_id,
      expires_at = EXCLUDED.expires_at,
      revoked_at = NULL,
      global_capabilities = EXCLUDED.global_capabilities;
  `);
  const session = await fetchJson(`${apiBaseUrl}/auth/session`, {
    headers: { authorization: `Bearer ${tokens.rootAdmin}` },
  });
  const capabilityKinds = (session.capabilities ?? []).map(
    (capability) => capability.kind,
  );
  if (
    session.principal_user_id !== "root_admin" ||
    !capabilityKinds.includes("GlobalAdmin")
  ) {
    throw new Error(
      `root admin seed did not resolve GlobalAdmin: ${JSON.stringify(session)}`,
    );
  }
  return {
    status: "passed",
    devSessionEndpointEnabled: false,
    rootSessionSource: "auth_session",
    browserCredentialIssuer: "/auth/accounts + /auth/invites",
    browserCredentialKinds: ["account", "account-bound-invite"],
    browserSessionGrantUsage: false,
    rootPrincipalUserId: session.principal_user_id,
    rootCapabilityKinds: capabilityKinds,
    rawRootTokenStored: false,
    boundary:
      "Root GlobalAdmin is seeded directly into the local auth_session table so the dev-test-game spine keeps /auth/dev-session disabled while every browser role enters through account login or account-bound invite redemption.",
  };
}

export function createTokenSet(prefix) {
  return Object.freeze({
    rootAdmin: `${prefix}-root-admin`,
    admin: `${prefix}-admin`,
    host: `${prefix}-host`,
    hostSetup: `${prefix}-host-setup`,
    player: `${prefix}-player`,
    actionPlayer: `${prefix}-action-player`,
    deniedPlayer: `${prefix}-denied-player`,
    replacementPlayer: `${prefix}-replacement-player`,
    cohost: `${prefix}-cohost`,
  });
}

async function createInviteCredential({
  inviteToken,
  principalUserId,
  returnTo,
  globalCapabilities = [],
  expectedCapabilityKind,
}) {
  const account = await ensureLocalAccount({
    principalUserId,
    globalCapabilities,
  });
  const invite = await fetchJson(`${apiBaseUrl}/auth/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.rootAdmin}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      account_id: account.accountId,
      expected_principal_user_id: principalUserId,
      expires_at: expiresAt,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    principalUserId: invite.principal_user_id,
    accountId: account.accountId,
    password: account.password,
    credentialKind: "invite",
    token: inviteToken,
    inviteToken,
    loginUrl: roleLoginUrl({
      frontendBaseUrl: frontendBaseUrl ?? "(frontend pending)",
      session: { inviteToken, returnTo },
    }),
    directUrl: frontendBaseUrl === undefined ? null : `${frontendBaseUrl}${returnTo}`,
    returnTo,
    expectedCapabilityKind,
    globalCapabilities: invite.global_capabilities ?? [],
  };
}

async function ensureLocalAccount({ principalUserId, globalCapabilities = [] }) {
  const existing = localAccounts.get(principalUserId);
  if (existing !== undefined) {
    return existing;
  }
  const account = {
    accountId: `${principalUserId}-${crypto.randomUUID()}@local.fmarch.test`,
    password: `${tokenPrefix}-account-${principalUserId}`,
  };
  const created = await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.rootAdmin}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      account_id: account.accountId,
      password: account.password,
      principal_user_id: principalUserId,
      global_capabilities: globalCapabilities,
    }),
  });
  if (created.principal_user_id !== principalUserId) {
    throw new Error(`local account principal drifted for ${principalUserId}`);
  }
  localAccounts.set(principalUserId, account);
  return account;
}

function localAccountForPrincipal(principalUserId) {
  const account = localAccounts.get(principalUserId);
  if (account === undefined) {
    throw new Error(`local account was not seeded for ${principalUserId}`);
  }
  return account;
}

async function createAccountLoginCredential({
  principalUserId,
  returnTo,
  globalCapabilities = [],
  expectedCapabilityKind,
}) {
  const account = await ensureLocalAccount({
    principalUserId,
    globalCapabilities,
  });
  const credential = {
    principalUserId,
    credentialKind: "account",
    accountId: account.accountId,
    password: account.password,
    returnTo,
    expectedCapabilityKind,
    globalCapabilities,
  };
  return {
    ...credential,
    loginUrl: roleLoginUrl({ frontendBaseUrl, session: credential }),
    directUrl: `${frontendBaseUrl}${returnTo}`,
  };
}

function roleLoginUrl({ frontendBaseUrl, session }) {
  const params = new URLSearchParams({ returnTo: session.returnTo });
  if (session.credentialKind === "invite" || session.inviteToken !== undefined) {
    params.set("invite", session.inviteToken);
    if (session.accountId !== undefined) {
      params.set("account", session.accountId);
    }
  } else if (session.credentialKind === "account") {
    params.set("account", session.accountId);
  }
  return `${frontendBaseUrl}/auth/login?${params.toString()}`;
}

async function sendCommand(principalUserId, command) {
  const response = await sendCommandResult(principalUserId, command);
  if (response.body?.kind !== "Ack") {
    throw new Error(`seed command rejected: ${JSON.stringify(response)}`);
  }
  return commandSummary(principalUserId, command, response);
}

async function sendCommandResult(principalUserId, command) {
  return await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      id: commandEnvelopeId++,
      body: {
        kind: "Command",
        body: {
          command_id: crypto.randomUUID(),
          principal_user_id: principalUserId,
          command,
        },
      },
    }),
  });
}

function commandSummary(principalUserId, command, response) {
  return {
    principalUserId,
    command,
    streamSeqs: response.body.body.stream_seqs,
  };
}

export function buildSessionCard({
  game,
  gameName,
  seedMode,
  databaseUrl,
  apiBaseUrl,
  frontendBaseUrl,
  seedCommands,
  setupBootstrap = null,
  identityBootstrap = null,
  sessions,
  artifacts = sessionArtifactsForPaths({
    jsonPath: sessionJsonPath,
    markdownPath: sessionMdPath,
    proofRunPath: proofRunJsonPath,
  }),
}) {
  const withFrontendUrls = Object.fromEntries(
    Object.entries(sessions).map(([role, session]) => [
      role,
      {
        ...session,
        loginUrl: roleLoginUrl({ frontendBaseUrl, session }),
        directUrl: `${frontendBaseUrl}${session.returnTo}`,
      },
    ]),
  );
  return {
    status: "ready",
    name: gameName,
    game,
    pack: "mafiascum",
    phase: "D01",
    seedMode,
    databaseUrl,
    apiBaseUrl,
    frontendBaseUrl,
    seedCommandCount:
      seedCommands.length + (setupBootstrap?.commandCount ?? 0),
    directSeedCommandCount: seedCommands.length,
    setupBootstrap,
    identityBootstrap,
    sessions: withFrontendUrls,
    artifacts,
  };
}

function sessionArtifactsForPaths({ jsonPath, markdownPath, proofRunPath }) {
  return Object.freeze({
    json: path.relative(repoRoot, jsonPath),
    markdown: path.relative(repoRoot, markdownPath),
    proofRun: path.relative(repoRoot, proofRunPath),
  });
}

async function writeSessionArtifacts(card, artifacts) {
  await writeFile(
    path.join(repoRoot, artifacts.json),
    `${JSON.stringify(card, null, 2)}\n`,
  );
  await writeFile(path.join(repoRoot, artifacts.markdown), markdownSessionCard(card));
}

function printSessionCard(card) {
  console.log("\nfmarch dev test game is ready");
  console.log(`name: ${card.name}`);
  console.log(`game: ${card.game}`);
  console.log(`seed: ${card.seedMode}`);
  console.log(`frontend: ${card.frontendBaseUrl}`);
  console.log(`api: ${card.apiBaseUrl}`);
  console.log(`artifact: ${card.artifacts.markdown}`);
  for (const [role, session] of Object.entries(card.sessions)) {
    console.log(`\n${role}`);
    console.log(`  url:    ${session.loginUrl}`);
    const token = session.inviteToken ?? session.token;
    if (token !== undefined) {
      console.log(`  token:  ${token}`);
    }
    if (session.accountId !== undefined) {
      console.log(`  account: ${session.accountId}`);
      if (typeof session.password === "string") {
        console.log(`  password: ${session.password}`);
      }
    }
  }
}

export function markdownSessionCard(card) {
  const lines = [
    "# fmarch Dev Test Game",
    "",
    `- status: ${card.status}`,
    `- name: ${card.name}`,
    `- game: ${card.game}`,
    `- pack: ${card.pack}`,
    `- phase: ${card.phase}`,
    `- seed: ${card.seedMode}`,
    `- frontend: ${card.frontendBaseUrl}`,
    `- api: ${card.apiBaseUrl}`,
    ...(card.setupBootstrap === null
      ? []
      : [
          `- setup bootstrap: ${card.setupBootstrap.status} via ${card.setupBootstrap.roleUrl}`,
          `- setup bootstrap commands: ${card.setupBootstrap.commandCount}`,
        ]),
    ...(card.identityBootstrap === null
      ? []
      : [
          `- identity bootstrap: ${card.identityBootstrap.rootSessionSource} -> ${card.identityBootstrap.browserCredentialIssuer}`,
          `- dev session endpoint enabled: ${card.identityBootstrap.devSessionEndpointEnabled}`,
        ]),
    "",
    "Open a role login URL, enter the seeded account password, and submit. Invite tokens and account IDs are prefilled in the URL; session tokens are repeated below for recovery/debug use.",
    "",
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    const token = session.inviteToken ?? session.token;
    lines.push(
      `## ${role}`,
      "",
      `Role login URL: ${session.loginUrl}`,
      "",
      ...(token === undefined ? [] : [`Credential token: ${token}`]),
      ...(session.accountId === undefined
        ? []
        : [
            `Account: ${session.accountId}`,
            ...(typeof session.password === "string"
              ? [`Password: ${session.password}`]
              : []),
          ]),
      "",
    );
  }
  if (card.verification !== undefined) {
    lines.push("## Verification", "", `Roles: ${card.verification.roles.join(", ")}`, "");
    if (card.verification.sessions !== undefined) {
      for (const [role, verified] of Object.entries(card.verification.sessions)) {
        lines.push(
          "",
          `- ${role}: ${verified.capabilityKinds.join(", ")} via ${verified.cookie.valuePrefix}...`,
        );
      }
      lines.push("");
    }
    if (card.verification.proofStability !== undefined) {
      const hostConfirmClicks = card.verification.proofStability.hostConfirmClicks;
      lines.push(
        "## Proof Stability Audit",
        "",
        `Status: ${card.verification.proofStability.status}`,
        "",
        `Host confirms: ${hostConfirmClicks.total} total; ${hostConfirmClicks.concurrentClickCount ?? 0} concurrent browser clicks; ${hostConfirmClicks.retryClickCount} retried; ${hostConfirmClicks.domFallbackCount} DOM fallbacks; ${hostConfirmClicks.forceFallbackCount} force fallbacks`,
        "",
      );
      if (hostConfirmClicks.events.length > 0) {
        lines.push("Host confirm retry/fallback events:", "");
        for (const event of hostConfirmClicks.events) {
          lines.push(
            `- ${event.actionId} ${event.roleLabel}: ${event.method} after ${event.attempts} attempts`,
          );
        }
        lines.push("");
      }
    }
    if (card.verification.coreLoop !== undefined) {
      lines.push(
        "## Core Loop Proof",
        "",
        `Status: ${card.verification.coreLoop.status}`,
        "",
        `Proof: ${card.verification.coreLoop.proof}`,
        "",
        `Rejected vote: ${card.verification.coreLoop.rejectedVote.message}`,
        "",
      );
    }
    if (card.verification.dayVoteResolution !== undefined) {
      lines.push(
        "## Day Vote Resolution Proof",
        "",
        `Status: ${card.verification.dayVoteResolution.status}`,
        "",
        `Proof: ${card.verification.dayVoteResolution.proof}`,
        "",
        `Outcome: ${card.verification.dayVoteResolution.dayVoteOutcome.status} ${card.verification.dayVoteResolution.dayVoteOutcome.winner_slot}`,
        "",
      );
    }
    if (card.verification.dayVoteNoLynch !== undefined) {
      lines.push(
        "## Day Vote No-Lynch Proof",
        "",
        `Status: ${card.verification.dayVoteNoLynch.status}`,
        "",
        `Proof: ${card.verification.dayVoteNoLynch.proof}`,
        "",
        `Outcome: ${card.verification.dayVoteNoLynch.dayVoteOutcome.status} ${card.verification.dayVoteNoLynch.dayVoteOutcome.tallies.no_lynch}`,
        "",
      );
    }
    if (card.verification.vanillizerRoleAction !== undefined) {
      lines.push(
        "## Vanillizer Role Action Proof",
        "",
        `Status: ${card.verification.vanillizerRoleAction.status}`,
        "",
        `Proof: ${card.verification.vanillizerRoleAction.proof}`,
        "",
        `Actor role URL: ${card.verification.vanillizerRoleAction.actorRoleUrl}`,
        "",
        `Target role URL: ${card.verification.vanillizerRoleAction.targetRoleUrl}`,
        "",
        `Target role: ${card.verification.vanillizerRoleAction.targetBefore.commandState.role.key} -> ${card.verification.vanillizerRoleAction.targetAfterReload.commandState.role.key}`,
        "",
      );
    }
    if (card.verification.cohostConsole !== undefined) {
      lines.push(
        "## Cohost Console Proof",
        "",
        `Status: ${card.verification.cohostConsole.status}`,
        "",
        `Proof: ${card.verification.cohostConsole.proof}`,
        "",
        `Extend deadline: ${card.verification.cohostConsole.extendDeadline.statusMessage}`,
        "",
        `Host-only controls visible: ${card.verification.cohostConsole.hostOnlyControlsVisible}`,
        "",
        `Host-only resolve: ${card.verification.cohostConsole.hostOnlyResolveReject.statusMessage}`,
        "",
      );
    }
    if (card.verification.cohostLaterPhaseDeadline !== undefined) {
      lines.push(
        "## Cohost Later-Phase Deadline Proof",
        "",
        `Status: ${card.verification.cohostLaterPhaseDeadline.status}`,
        "",
        `Proof: ${card.verification.cohostLaterPhaseDeadline.proof}`,
        "",
        `Extend deadline: ${card.verification.cohostLaterPhaseDeadline.extendDeadline.statusMessage}`,
        "",
        `Phase after reload: ${card.verification.cohostLaterPhaseDeadline.reload.phaseAfterReload.id} deadline ${card.verification.cohostLaterPhaseDeadline.reload.phaseAfterReload.deadline}`,
        "",
      );
    }
    if (card.verification.actionLoop !== undefined) {
      lines.push(
        "## Action Loop Proof",
        "",
        `Status: ${card.verification.actionLoop.status}`,
        "",
        `Proof: ${card.verification.actionLoop.proof}`,
        "",
        `Invalid action: ${card.verification.actionLoop.invalidAction.message}`,
        "",
        `Legal action: ${card.verification.actionLoop.legalAction.message}`,
        "",
      );
      if (card.verification.actionLoop.d02VoteNightTransition !== undefined) {
        lines.push(
          `D02 vote/night: ${card.verification.actionLoop.d02VoteNightTransition.dayVoteOutcome.status} -> ${card.verification.actionLoop.d02VoteNightTransition.n02ActionSurface.commandState.phase.phaseId}`,
          "",
        );
      }
    }
    if (card.verification.invalidActionRecovery !== undefined) {
      lines.push(
        "## Invalid Action Recovery Proof",
        "",
        `Status: ${card.verification.invalidActionRecovery.status}`,
        "",
        `Proof: ${card.verification.invalidActionRecovery.proof}`,
        "",
        `Reject: ${card.verification.invalidActionRecovery.reject.message}`,
        "",
        `Receipt: ${card.verification.invalidActionRecovery.currentReceipt.message}`,
        "",
        `Legal action visible: ${card.verification.invalidActionRecovery.legalActionVisible}`,
        "",
      );
    }
    if (card.verification.resolutionReceipts !== undefined) {
      lines.push(
        "## Resolution Receipt Proof",
        "",
        `Status: ${card.verification.resolutionReceipts.status}`,
        "",
        `Proof: ${card.verification.resolutionReceipts.proof}`,
        "",
        `Target notice: ${card.verification.resolutionReceipts.targetNotice.effect} ${card.verification.resolutionReceipts.targetNotice.status}`,
        "",
        `Normal player notice leaked: ${card.verification.resolutionReceipts.normalPlayerNoticeVisible}`,
        "",
      );
    }
    if (card.verification.deadPlayerRecovery !== undefined) {
      lines.push(
        "## Dead Player Recovery Proof",
        "",
        `Status: ${card.verification.deadPlayerRecovery.status}`,
        "",
        `Proof: ${card.verification.deadPlayerRecovery.proof}`,
        "",
        `Actor status: ${card.verification.deadPlayerRecovery.commandState.actorStatus}`,
        "",
        `Direct vote: ${card.verification.deadPlayerRecovery.directVote.statusMessage}`,
        "",
        `Direct post: ${card.verification.deadPlayerRecovery.directPost.statusMessage}`,
        "",
        `Direct action: ${card.verification.deadPlayerRecovery.directAction.statusMessage}`,
        "",
      );
    }
    if (card.verification.playerActionBoundary !== undefined) {
      lines.push(
        "## Player Action Boundary Proof",
        "",
        `Status: ${card.verification.playerActionBoundary.status}`,
        "",
        `Proof: ${card.verification.playerActionBoundary.proof}`,
        "",
        `Factional kill visible: ${card.verification.playerActionBoundary.factionalKillVisible}`,
        "",
        `Direct factional kill: ${card.verification.playerActionBoundary.directFactionalKill.statusMessage}`,
        "",
      );
    }
    if (card.verification.privateChannel !== undefined) {
      lines.push(
        "## Private Channel Proof",
        "",
        `Status: ${card.verification.privateChannel.status}`,
        "",
        `Proof: ${card.verification.privateChannel.proof}`,
        "",
        `Allowed post: ${card.verification.privateChannel.allowed.submitPost.message}`,
        "",
        `Denied route: ${card.verification.privateChannel.denied.status} ${card.verification.privateChannel.denied.actionLabel}`,
        "",
      );
    }
    if (card.verification.replacementConsole !== undefined) {
      lines.push(
        "## Replacement Console Proof",
        "",
        `Status: ${card.verification.replacementConsole.status}`,
        "",
        `Proof: ${card.verification.replacementConsole.proof}`,
        "",
        `Host-issued invite: ${card.verification.replacementConsole.hostIssuedInvite.statusText}`,
        "",
        `Redeemed invite recovery: ${card.verification.replacementConsole.redeemedInviteRecovery.message}`,
        "",
        `Revoked replacement session recovery: ${card.verification.replacementConsole.replacementSessionRevocation.routeErrorStatus}`,
        "",
        `Replacement session refresh recovery: ${card.verification.replacementConsole.replacementSessionRefresh.postStatus.message}`,
        "",
        `Invalid replacement recovery: ${card.verification.replacementConsole.invalidReplacementRecovery.reject.error}`,
        "",
        `Process replacement: ${card.verification.replacementConsole.processReplacement.statusMessage}`,
        "",
        `Projected occupant: ${card.verification.replacementConsole.projectedReplacement.occupantLabel}`,
        "",
        `Replacement duplicate retry: ${card.verification.replacementConsole.replacementIdempotentRetry.retryReplacement.message}`,
        "",
        `Stale host invite recovery: ${card.verification.replacementConsole.staleHostInviteRecovery.retry.message}`,
        "",
        `Stale outgoing recovery: ${card.verification.replacementConsole.staleOutgoingPlayer.reject.message}`,
        "",
        `Stale replacement recovery: ${card.verification.replacementConsole.staleReplacementAfterSuccess.reject.error}`,
        "",
        `Incoming replacement: ${card.verification.replacementConsole.incomingPlayer.browserEntry.principalUserId} ${card.verification.replacementConsole.incomingPlayer.postStatus.message}`,
        "",
      );
    }
    if (card.verification.multiplayerHardening !== undefined) {
      lines.push(
        "## Multiplayer Hardening Proof",
        "",
        `Status: ${card.verification.multiplayerHardening.status}`,
        "",
        `Proof: ${card.verification.multiplayerHardening.proof}`,
        "",
        `Duplicate retry: ${card.verification.multiplayerHardening.idempotentRetry.retryPost.message}`,
        "",
        `Reconnect: attempt ${card.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.attempt} ${card.verification.multiplayerHardening.reconnect.reconnectRecoveryEvent.state}`,
        "",
        `Stale player vote: ${card.verification.multiplayerHardening.stalePlayerVote.reject.message}`,
        "",
        `Stale dead-target vote: ${card.verification.multiplayerHardening.staleDeadTargetVote.reject.message}`,
        "",
        `Dead current vote: ${card.verification.multiplayerHardening.deadCurrentVote.target.label} cleared`,
        "",
        `Concurrent vote race: ${card.verification.multiplayerHardening.concurrentVoteRace.targetSlot} count ${card.verification.multiplayerHardening.concurrentVoteRace.apiProjection.count}`,
        "",
        `Concurrent player vote/resolve race: ${card.verification.multiplayerHardening.concurrentPlayerVoteResolveRace.outcomeSummary}`,
        "",
        `Concurrent player action/advance race: ${card.verification.multiplayerHardening.concurrentPlayerActionAdvanceRace.reject.message}`,
        "",
        `Concurrent cohost deadline/resolve race: ${card.verification.multiplayerHardening.concurrentCohostDeadlineResolveRace.outcomeSummary}`,
        "",
        `Concurrent replacement private-post race: ${card.verification.multiplayerHardening.concurrentReplacementPrivatePostRace.outcomeSummary}`,
        "",
        `Concurrent replacement vote race: ${card.verification.multiplayerHardening.concurrentReplacementVoteRace.outcomeSummary}`,
        "",
        `Concurrent replacement action race: ${card.verification.multiplayerHardening.concurrentReplacementActionRace.outcomeSummary}`,
        "",
        `Incoming replacement action: ${card.verification.multiplayerHardening.replacementIncomingAction.outcomeSummary}`,
        "",
        `Replacement action reconnect: ${card.verification.multiplayerHardening.replacementActionReconnect.outcomeSummary}`,
        "",
        `Stale replacement action after resolve: ${card.verification.multiplayerHardening.replacementStaleActionAfterResolve.reject.message}`,
        "",
        `Host lifecycle: ${card.verification.multiplayerHardening.hostLifecycleControl.markDead.statusMessage}`,
        "",
        `Stale host lifecycle: ${card.verification.multiplayerHardening.staleHostLifecycle.reject.message}`,
        "",
        `Host modkill: ${card.verification.multiplayerHardening.hostModkillControl.modkill.statusMessage}`,
        "",
        `Stale host modkill: ${card.verification.multiplayerHardening.staleHostModkill.reject.message}`,
        "",
        `Concurrent host lifecycle race: ${card.verification.multiplayerHardening.concurrentHostLifecycleRace.reject.message}`,
        "",
        `Concurrent host complete race: ${card.verification.multiplayerHardening.concurrentHostCompleteRace.reject.message}`,
        "",
        `Concurrent host publish race: ${card.verification.multiplayerHardening.concurrentHostPublishRace.reject.message}`,
        "",
      );
      if (card.verification.multiplayerHardening.concurrentPlayerCompleteRace !== undefined) {
        lines.push(
          `Concurrent player complete race: ${card.verification.multiplayerHardening.concurrentPlayerCompleteRace.outcomeSummary}`,
          "",
        );
      }
      lines.push(
        `Action idempotent retry: ${card.verification.multiplayerHardening.actionIdempotentRetry.retry.message}`,
        "",
        `Stale same action: ${card.verification.multiplayerHardening.staleSameActionRecovery.reject.message}`,
        "",
        `Stale action conflict: ${card.verification.multiplayerHardening.staleActionConflict.reject.message}`,
        "",
        `Stale control: ${card.verification.multiplayerHardening.staleHostControl.reject.message}`,
        "",
        `Concurrent host resolve race: ${card.verification.multiplayerHardening.concurrentHostResolveRace.reject.message}`,
        "",
        `Concurrent host advance race: ${card.verification.multiplayerHardening.concurrentHostAdvanceRace.reject.message}`,
        "",
        `Concurrent host deadline race: ${card.verification.multiplayerHardening.concurrentHostDeadlineAdvanceRace.reject.message}`,
        "",
        `Concurrent host mixed advance race: ${card.verification.multiplayerHardening.concurrentHostMixedAdvanceRace.reject.message}`,
        "",
        `Stale host resolve: ${card.verification.multiplayerHardening.staleHostResolve.reject.message}`,
        "",
        `Stale host advance: ${card.verification.multiplayerHardening.staleHostAdvance.reject.message}`,
        "",
        `Stale host publish: ${card.verification.multiplayerHardening.staleHostPublish.reject.message}`,
        "",
        `Stale host prompt: ${card.verification.multiplayerHardening.staleHostPrompt.reject.message}`,
        "",
        `Stale host complete: ${card.verification.multiplayerHardening.staleHostComplete.reject.message}`,
        "",
        `Stale player complete: ${card.verification.multiplayerHardening.stalePlayerComplete.reject.message}`,
        "",
        `Stale host deadline: ${card.verification.multiplayerHardening.staleHostDeadline.reject.message}`,
        "",
        `Stale cohost deadline: ${card.verification.multiplayerHardening.staleCohostDeadline.reject.message}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function verifySessionCard(card) {
  resetProofStabilityAudit();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const mediaResponseGuard = createUnexpectedMediaResponseGuard({
    label: "dev-test-game-live-browser-proof",
  });
  mediaResponseGuard.attachBrowser(browser);
  const roles = [];
  const sessions = {};
  const roleEntries = {};
  let hostSetup;
  let cohostConsole;
  let cohostLaterPhaseDeadline;
  let coreLoop;
  let dayVoteResolution;
  let dayVoteNoLynch;
  let vanillizerRoleAction;
  let privateChannel;
  let actionLoop;
  let invalidActionRecovery;
  let resolutionReceipts;
  let deadPlayerRecovery;
  let playerActionBoundary;
  let multiplayerHardening;
  let replacementConsole;
  let concurrentActionPage;
  let privateChannelActionPage;
  let privateChannelStaleActionPage;
  let staleActionRetryPage;
  let staleSameActionPage;
  let staleActionPage;
  let staleDeadActionPage;
  let staleHostPage;
  let staleHostResolvePage;
  let staleHostAdvancePage;
  let staleHostPublishPage;
  let staleHostLifecyclePage;
  let staleHostModkillPage;
  let staleHostDeadlinePage;
  let staleCohostPage;
  let staleReplacementPage;
  try {
    for (const role of [
      "host",
      "hostSetup",
      "player",
      "actionPlayer",
      "deniedPlayer",
      "cohost",
    ]) {
      roleEntries[role] = await openVerifiedRoleEntry({
        browser,
        session: card.sessions[role],
        game: card.game,
        apiBaseUrl: card.apiBaseUrl,
        frontendBaseUrl: card.frontendBaseUrl,
      });
      sessions[role] = roleEntries[role].verification;
      roles.push(role);
    }
    hostSetup = await verifySeededHostSetupRoute({
      browser,
      setupPage: roleEntries.hostSetup.page,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    hostSetup = {
      ...hostSetup,
      setupBootstrap: card.setupBootstrap ?? null,
      setupCommandEvidence: card.setupBootstrap?.setupCommandEvidence ?? null,
    };
    concurrentActionPage = await roleEntries.actionPlayer.context.newPage();
    privateChannelActionPage = await roleEntries.actionPlayer.context.newPage();
    privateChannelStaleActionPage =
      await roleEntries.actionPlayer.context.newPage();
    staleActionRetryPage = await roleEntries.actionPlayer.context.newPage();
    staleSameActionPage = await roleEntries.actionPlayer.context.newPage();
    staleActionPage = await roleEntries.actionPlayer.context.newPage();
    staleDeadActionPage = await roleEntries.actionPlayer.context.newPage();
    staleHostPage = await roleEntries.host.context.newPage();
    staleHostResolvePage = await roleEntries.host.context.newPage();
    staleHostAdvancePage = await roleEntries.host.context.newPage();
    staleHostPublishPage = await roleEntries.host.context.newPage();
    staleHostLifecyclePage = await roleEntries.host.context.newPage();
    staleHostModkillPage = await roleEntries.host.context.newPage();
    staleHostDeadlinePage = await roleEntries.host.context.newPage();
    staleCohostPage = await roleEntries.cohost.context.newPage();
    staleReplacementPage = await roleEntries.player.context.newPage();
    cohostConsole = await verifySeededCohostConsole({
      cohostPage: roleEntries.cohost.page,
      staleCohostPage,
      game: card.game,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    cohostLaterPhaseDeadline = await verifyCohostLaterPhaseDeadlineExtension({
      browser,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    const staleHostDeadlineSetup = await freezeStaleHostDeadlinePage({
      staleHostDeadlinePage,
      game: card.game,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    coreLoop = await verifySeededCoreLoop({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
    });
    dayVoteResolution = await verifySeededDayVoteResolution({
      hostPage: roleEntries.host.page,
      actionPage: roleEntries.actionPlayer.page,
      targetPage: roleEntries.deniedPlayer.page,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    dayVoteNoLynch = await verifySeededDayVoteNoLynch({
      browser,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    vanillizerRoleAction = await verifySeededVanillizerRoleAction({
      browser,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    privateChannel = await verifySeededPrivateChannel({
      browser,
      playerPage: roleEntries.player.page,
      deniedPage: roleEntries.deniedPlayer.page,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    actionLoop = await verifySeededActionLoop({
      browser,
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      actionPage: roleEntries.actionPlayer.page,
      targetPage: roleEntries.deniedPlayer.page,
      concurrentActionPage,
      privateChannelActionPage,
      privateChannelStaleActionPage,
      staleActionRetryPage,
      staleSameActionPage,
      staleActionPage,
      staleDeadActionPage,
      staleHostPage,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    invalidActionRecovery = actionLoop.invalidActionRecovery;
    resolutionReceipts = actionLoop.resolutionReceipts;
    deadPlayerRecovery = actionLoop.deadPlayerRecovery;
    playerActionBoundary = actionLoop.playerActionBoundary;
    multiplayerHardening = await verifySeededMultiplayerHardening({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      actionPage: roleEntries.actionPlayer.page,
      concurrentActionRace: actionLoop.concurrentActionRace,
      actionIdempotentRetry: actionLoop.actionIdempotentRetry,
      staleSameActionRecovery: actionLoop.staleSameActionRecovery,
      staleActionConflict: actionLoop.staleActionConflict,
      privateChannelStaleActionReconnectRecovery:
        actionLoop.privateChannelStaleActionReconnectRecovery,
      staleDeadActionConflict: actionLoop.staleDeadActionConflict,
      staleHostPage,
      staleHostControlSetup: actionLoop.staleHostControlSetup,
      staleHostResolvePage,
      staleHostAdvancePage,
      staleHostPublishPage,
      staleHostLifecyclePage,
      staleHostModkillPage,
      staleHostDeadlinePage,
      staleHostDeadlineSetup,
      staleCohostPage,
      staleCohostDeadlineSetup: cohostConsole.staleDeadlineSetup,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    replacementConsole = await verifySeededReplacementConsole({
      browser,
      hostPage: roleEntries.host.page,
      staleOutgoingPage: staleReplacementPage,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    card.sessions.replacementPlayer = replacementConsole.replacementSessionRefresh.session;
    sessions.replacementPlayer = replacementConsole.replacementSessionRefresh.browserEntry;
    roles.push("replacementPlayer");
    mediaResponseGuard.assertNoUnexpectedMedia404({
      phase: "dev-test-game-live-browser-proof",
    });
  } finally {
    await concurrentActionPage?.close().catch(() => {});
    await privateChannelActionPage?.close().catch(() => {});
    await privateChannelStaleActionPage?.close().catch(() => {});
    await staleActionRetryPage?.close().catch(() => {});
    await staleSameActionPage?.close().catch(() => {});
    await staleActionPage?.close().catch(() => {});
    await staleDeadActionPage?.close().catch(() => {});
    await staleHostPage?.close().catch(() => {});
    await staleHostResolvePage?.close().catch(() => {});
    await staleHostAdvancePage?.close().catch(() => {});
    await staleHostPublishPage?.close().catch(() => {});
    await staleHostLifecyclePage?.close().catch(() => {});
    await staleHostModkillPage?.close().catch(() => {});
    await staleHostDeadlinePage?.close().catch(() => {});
    await staleCohostPage?.close().catch(() => {});
    await staleReplacementPage?.close().catch(() => {});
    await Promise.all(
      Object.values(roleEntries).map((entry) => entry.context.close()),
    );
    await browser.close();
  }
  return {
    status: "passed",
    roles,
    sessions,
    proofStability: buildProofStabilityAudit(),
    mediaResponseGuard: mediaResponseGuard.summary(),
    hostSetup,
    cohostConsole,
    cohostLaterPhaseDeadline,
    coreLoop,
    dayVoteResolution,
    dayVoteNoLynch,
    vanillizerRoleAction,
    privateChannel,
    actionLoop,
    invalidActionRecovery,
    resolutionReceipts,
    deadPlayerRecovery,
    playerActionBoundary,
    multiplayerHardening,
    replacementConsole,
  };
}

async function verifyHostSetupOnly(card) {
  resetProofStabilityAudit();
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const mediaResponseGuard = createUnexpectedMediaResponseGuard({
    label: "dev-test-game-host-setup-browser-proof",
  });
  mediaResponseGuard.attachBrowser(browser);
  let entry;
  try {
    entry = await openVerifiedRoleEntry({
      browser,
      session: card.sessions.hostSetup,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    const hostSetup = await verifySeededHostSetupRoute({
      browser,
      setupPage: entry.page,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    const hostSetupWithBootstrap = {
      ...hostSetup,
      setupBootstrap: card.setupBootstrap ?? null,
      setupCommandEvidence: card.setupBootstrap?.setupCommandEvidence ?? null,
    };
    mediaResponseGuard.assertNoUnexpectedMedia404({
      phase: "dev-test-game-host-setup-browser-proof",
    });
    return {
      status: "passed",
      roles: ["hostSetup"],
      sessions: {
        hostSetup: entry.verification,
      },
      proofStability: buildProofStabilityAudit(),
      mediaResponseGuard: mediaResponseGuard.summary(),
      hostSetup: hostSetupWithBootstrap,
    };
  } finally {
    await entry?.context.close().catch(() => {});
    await browser.close();
  }
}

async function bootstrapSeededGameThroughSetup(card) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  let entry;
  try {
    const bootstrapSession = await createAccountLoginCredential({
      principalUserId: "host_h",
      returnTo: `/g/${card.game}/setup`,
      expectedCapabilityKind: "HostOf",
    });
    entry = await openVerifiedRoleEntry({
      browser,
      session: bootstrapSession,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    const setupPage = entry.page;
    return await runSeededSetupBootstrapScenario({
      setupPage,
      game: card.game,
      frontendBaseUrl: card.frontendBaseUrl,
      bootstrapSession,
    });
  } finally {
    await entry?.context.close().catch(() => {});
    await browser.close();
  }
}

async function verifySeededHostSetupRoute({
  browser,
  setupPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const roleUrl = `${frontendBaseUrl}/g/${game}/setup`;
  await setupPage.getByTestId("host-setup-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage.getByTestId("host-setup-roster").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage.getByTestId("host-setup-roles").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage.getByTestId("host-setup-readiness-summary").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await setupPage.waitForFunction(
    () => window.__fmarchHostSetupState !== undefined,
    { timeout: 15000 },
  );

  const [
    surfaceGame,
    capabilityLabel,
    readinessSummary,
    mainPolicyText,
    startDisabled,
    hostHref,
    windowState,
  ] = await Promise.all([
    setupPage.getByTestId("host-setup-surface").getAttribute("data-game"),
    setupPage.getByTestId("host-setup-capability").innerText(),
    setupPage.getByTestId("host-setup-readiness-summary").innerText(),
    setupPage.getByTestId("host-setup-main-policy").innerText(),
    setupPage.getByTestId("host-setup-start-review").isDisabled(),
    setupPage.locator(`a[href="/g/${game}/host"]`).first().getAttribute("href"),
    setupPage.evaluate(() => ({
      setupState: window.__fmarchHostSetupState ?? null,
      readiness: window.__fmarchHostSetupReadiness ?? null,
    })),
  ]);
  const slotIds = (windowState.setupState?.slots ?? []).map((slot) => slot.slotId);
  const roleKeys = windowState.setupState?.pack?.roleKeys ?? [];
  const phaseId = windowState.setupState?.phase?.phaseId ?? null;
  const checks = windowState.readiness?.checks ?? [];
  if (
    setupPage.url() !== roleUrl ||
    surfaceGame !== game ||
    !capabilityLabel.includes(`HostOf(${game})`) ||
    readinessSummary !== "Started at D01" ||
    mainPolicyText !== "Media-only posts are disabled." ||
    startDisabled !== true ||
    hostHref !== `/g/${game}/host` ||
    phaseId !== "D01" ||
    !slotIds.includes("slot-7") ||
    !slotIds.includes("slot_4") ||
    !roleKeys.includes("mafia_goon") ||
    !roleKeys.includes("vanilla_townie") ||
    !checks.every((check) => check.state === "ready")
  ) {
    throw new Error(
      `host setup route proof drifted: ${JSON.stringify({
        url: setupPage.url(),
        roleUrl,
        surfaceGame,
        capabilityLabel,
        readinessSummary,
        mainPolicyText,
        startDisabled,
        hostHref,
        phaseId,
        slotIds,
        roleKeys,
        checks,
      })}`,
    );
  }

  const policyCommand = await verifyHostSetupPolicyCommandRoundTrip(setupPage);
  const setupMutationCommand = await verifyDisposableHostSetupRosterRoleCommand({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
  });

  return {
    status: "passed",
    proof:
      "Host setup role URL opens roster, role, policy, invite, and start recovery surface, then round-trips the post-policy command and restores the seeded policy.",
    roleUrl,
    capabilityLabel,
    readinessSummary,
    phaseId,
    startDisabled,
    hostHref,
    slotIds,
    roleKeys,
    mainPolicyText,
    policyCommand,
    setupMutationCommand,
    readyCheckIds: checks
      .filter((check) => check.state === "ready")
      .map((check) => check.id),
  };
}

async function verifyDisposableHostSetupRosterRoleCommand({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const setupGame = crypto.randomUUID();
  const seed = await seedHostSetupRosterRoleGame({ setupGame });
  const setupSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${setupGame}/setup`,
    expectedCapabilityKind: "HostOf",
  });
  const staleSetupSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${setupGame}/setup`,
    expectedCapabilityKind: "HostOf",
  });
  const entry = await openVerifiedRoleEntry({
    browser,
    session: setupSession,
    game: setupGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const staleEntry = await openVerifiedRoleEntry({
    browser,
    session: staleSetupSession,
    game: setupGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const page = entry.page;
  const stalePage = staleEntry.page;
  const addedSlotId = "slot_extra";
  const assignedPrincipalUserId = "setup-extra-player";
  const assignedRoleKey = "mafia_goon";
  try {
    await page.getByTestId("host-setup-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await stalePage.getByTestId("host-setup-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await page.getByTestId("host-setup-add-slot-form").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await stalePage.getByTestId("host-setup-add-slot-form").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const initialSummary = await page
      .getByTestId("host-setup-readiness-summary")
      .innerText();
    const initialState = await page.evaluate(
      () => window.__fmarchHostSetupState ?? null,
    );

    await page
      .getByTestId("host-setup-add-slot-form")
      .locator('input[name="slotId"]')
      .fill(addedSlotId);
    await page.getByRole("button", { name: "Add slot" }).click();
    const addSlot = await waitForHostSetupCommand({
      setupPage: page,
      statusTestId: "host-setup-add-slot-status",
      commandKind: "AddSlot",
      commandPredicate: (command) => command?.slot === addedSlotId,
      statePredicate: (state) =>
        (state?.slots ?? []).some((slot) => slot.slotId === addedSlotId),
    });

    await stalePage
      .getByTestId("host-setup-add-slot-form")
      .locator('input[name="slotId"]')
      .fill(addedSlotId);
    await stalePage.getByRole("button", { name: "Add slot" }).click();
    const duplicateAddSlotRecovery = await waitForHostSetupCommand({
      setupPage: stalePage,
      statusTestId: "host-setup-add-slot-status",
      commandKind: "AddSlot",
      expectedState: "reject",
      expectedError: "InvalidTarget",
      commandPredicate: (command) => command?.slot === addedSlotId,
      statePredicate: (state) =>
        (state?.slots ?? []).filter((slot) => slot.slotId === addedSlotId)
          .length === 1,
    });
    const staleStateAfterDuplicateReject = await stalePage.evaluate(
      () => window.__fmarchHostSetupState ?? null,
    );
    const duplicateSlotCountAfterReject = (
      staleStateAfterDuplicateReject?.slots ?? []
    ).filter((slot) => slot.slotId === addedSlotId).length;

    const rosterRow = page.getByTestId(`host-setup-slot-${addedSlotId}`);
    await rosterRow.locator('input[name="principalUserId"]').fill(
      assignedPrincipalUserId,
    );
    await rosterRow
      .getByRole("button", { name: "Assign", exact: true })
      .click();
    const assignSlot = await waitForHostSetupCommand({
      setupPage: page,
      statusTestId: "host-setup-assign-slot-status",
      commandKind: "AssignSlot",
      commandPredicate: (command) =>
        command?.slot === addedSlotId &&
        command?.user === assignedPrincipalUserId,
      statePredicate: (state) =>
        (state?.slots ?? []).some(
          (slot) =>
            slot.slotId === addedSlotId &&
            slot.occupantUserId === assignedPrincipalUserId,
        ),
    });

    const roleRow = page.getByTestId(`host-setup-role-${addedSlotId}`);
    await roleRow.locator('select[name="roleKey"]').selectOption(assignedRoleKey);
    await roleRow
      .getByRole("button", { name: "Assign role", exact: true })
      .click();
    const assignRole = await waitForHostSetupCommand({
      setupPage: page,
      statusTestId: "host-setup-assign-role-status",
      commandKind: "AssignRole",
      commandPredicate: (command) =>
        command?.slot === addedSlotId &&
        command?.role_key === assignedRoleKey,
      statePredicate: (state) =>
        (state?.slots ?? []).some(
          (slot) =>
            slot.slotId === addedSlotId &&
            slot.occupantUserId === assignedPrincipalUserId &&
            slot.roleKey === assignedRoleKey,
        ),
    });

    const finalState = await page.evaluate(
      () => window.__fmarchHostSetupState ?? null,
    );
    const finalReadiness = await page.evaluate(
      () => window.__fmarchHostSetupReadiness ?? null,
    );
    const finalSlot = (finalState?.slots ?? []).find(
      (slot) => slot.slotId === addedSlotId,
    );
    if (
      page.url() !== `${frontendBaseUrl}/g/${setupGame}/setup` ||
      initialSummary !== "Ready to start" ||
      initialState?.phase !== null ||
      duplicateAddSlotRecovery.error !== "InvalidTarget" ||
      duplicateSlotCountAfterReject !== 1 ||
      finalSlot?.occupantUserId !== assignedPrincipalUserId ||
      finalSlot?.roleKey !== assignedRoleKey ||
      finalReadiness?.summary !== "Ready to start" ||
      finalReadiness?.startAvailable !== true
    ) {
      throw new Error(
        `host setup roster/role command proof drifted: ${JSON.stringify({
          url: page.url(),
          expectedUrl: `${frontendBaseUrl}/g/${setupGame}/setup`,
          initialSummary,
          initialState,
          duplicateAddSlotRecovery,
          staleStateAfterDuplicateReject,
          finalState,
          finalReadiness,
        })}`,
      );
    }
    return {
      status: "passed",
      proof:
        "A disposable pre-start setup role URL added a slot, assigned its occupant, assigned its role, and refreshed to ready setup state.",
      game: setupGame,
      roleUrl: `${frontendBaseUrl}/g/${setupGame}/setup`,
      sessionPrincipalUserId: setupSession.principalUserId,
      seed,
      addedSlotId,
      assignedPrincipalUserId,
      assignedRoleKey,
      initialSummary,
      duplicateAddSlotRecovery: {
        ...duplicateAddSlotRecovery,
        refreshedSlotCount: (staleStateAfterDuplicateReject?.slots ?? []).length,
        duplicateSlotCountAfterReject,
        refreshedReadinessSummary:
          duplicateAddSlotRecovery.readinessSummary ?? null,
      },
      finalSummary: finalReadiness.summary,
      finalStartAvailable: finalReadiness.startAvailable,
      finalSlot,
      commands: {
        addSlot,
        assignSlot,
        assignRole,
      },
      setupCommandEvidence: buildSetupCommandEvidence({
        addSlot,
        assignSlot,
        assignRole,
        setPostPolicy: null,
        startGame: null,
      }),
    };
  } finally {
    await entry.context.close().catch(() => {});
    await staleEntry.context.close().catch(() => {});
  }
}

async function seedHostSetupRosterRoleGame({ setupGame }) {
  const plan = [
    ["host_h", { CreateGame: { game: setupGame, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game: setupGame, slot: "slot_1" } }],
    [
      "host_h",
      { AssignSlot: { game: setupGame, slot: "slot_1", user: "setup-player-one" } },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: setupGame,
          slot: "slot_1",
          role_key: "vanilla_townie",
        },
      },
    ],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game: setupGame,
    commands: commands.length,
    initialSlotId: "slot_1",
    initialPrincipalUserId: "setup-player-one",
    initialRoleKey: "vanilla_townie",
  };
}

async function openVerifiedRoleEntry({
  browser,
  session,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(session.loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
    const credential = session.inviteToken ?? session.token;
    const prefilled = await page.getByTestId("auth-login-token").inputValue();
    if (typeof credential === "string" && prefilled !== credential) {
      await page.getByTestId("auth-login-token").fill(credential);
    }
    if (session.accountId !== undefined) {
      await page.getByTestId("auth-login-account").fill(session.accountId);
      await page.getByTestId("auth-login-password").fill(session.password);
    }
    await Promise.all([
      page.waitForURL(session.directUrl, { timeout: 15000 }),
      page.getByTestId("auth-login-submit").click(),
    ]);
    await page.waitForLoadState("networkidle");
    const cookies = await page.context().cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    if (sessionCookie === undefined) {
      throw new Error(`${session.principalUserId} login did not set fmarch_session cookie`);
    }
    const resolved = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    });
    const capabilityKinds = (resolved.capabilities ?? []).map((capability) => capability.kind);
    if (
      session.expectedCapabilityKind !== undefined &&
      !capabilityKinds.includes(session.expectedCapabilityKind)
    ) {
      throw new Error(
        `${session.principalUserId} session missing ${session.expectedCapabilityKind}: ${JSON.stringify(
          resolved,
        )}`,
      );
    }
    const body = await page.locator("body").innerText();
    if (!body.includes(game)) {
      throw new Error(`authenticated page for ${session.principalUserId} did not show ${game}`);
    }
    const cookiePrefix =
      session.credentialKind === "account" ? "account-session-" : "invite-session-";
    return {
      context,
      page,
      verification: {
        principalUserId: resolved.principal_user_id,
        capabilityKinds,
        cookie: {
          httpOnly: sessionCookie.httpOnly,
          sameSite: sessionCookie.sameSite,
          secure: sessionCookie.secure,
          valuePrefix: sessionCookie.value.slice(0, cookiePrefix.length),
        },
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function verifySeededCohostConsole({
  cohostPage,
  staleCohostPage,
  game,
  frontendBaseUrl,
}) {
  await cohostPage.getByTestId("host-console-surface").waitFor({ state: "visible" });
  const capability = await cohostPage.getByTestId("host-console-capability").innerText();
  if (!capability.includes(`CohostOf(${game})`)) {
    throw new Error(`cohost console capability drifted: ${capability}`);
  }
  const extendDeadline = await confirmHostAction(cohostPage, "extend_deadline");
  const command = extendDeadline.commandStatus?.requestEnvelope?.body?.body?.command;
  if (
    extendDeadline.commandStatus?.state !== "ack" ||
    command?.ExtendDeadline?.game !== game ||
    command?.ExtendDeadline?.phase !== "D01"
  ) {
    throw new Error(`cohost ExtendDeadline drifted: ${JSON.stringify(extendDeadline)}`);
  }
  const hostOnlyControlsVisible = await hostActionVisible(cohostPage, "resolve_phase");
  if (hostOnlyControlsVisible) {
    throw new Error("cohost console exposed host-only resolve_phase control");
  }
  const hostOnlyResolveReject = await sendBrowserCommand(cohostPage, {
    principalUserId: "cohost_c",
    commandId: crypto.randomUUID(),
    command: {
      ResolvePhase: {
        game,
        seed: 918273,
      },
    },
  });
  const rejectBody = hostOnlyResolveReject.serverEnvelope?.body;
  if (
    rejectBody?.kind !== "Reject" ||
    rejectBody?.body?.error !== "NotHost" ||
    hostOnlyResolveReject.requestEnvelope?.body?.body?.principal_user_id !== "cohost_c"
  ) {
    throw new Error(
      `cohost host-only ResolvePhase did not reject as NotHost: ${JSON.stringify(
        hostOnlyResolveReject,
      )}`,
    );
  }
  const phaseAfterReject = await cohostPage.evaluate(() => window.__fmarchHostProjection?.phase);
  if (phaseAfterReject?.id !== "D01" || phaseAfterReject?.locked !== false) {
    throw new Error(
      `cohost host-only reject mutated phase state: ${JSON.stringify(phaseAfterReject)}`,
    );
  }
  const staleDeadlineSetup = await freezeStaleCohostDeadlinePage({
    staleCohostPage,
    game,
    frontendBaseUrl,
  });
  return {
    status: "passed",
    capabilityLabel: capability,
    extendDeadline,
    hostOnlyControlsVisible,
    hostOnlyResolveReject: {
      ...hostOnlyResolveReject,
      statusMessage: `Reject ${rejectBody.body.error}: ${rejectBody.body.message}`,
    },
    phaseAfterReject,
    staleDeadlineSetup,
    proof:
      "The seeded cohost role URL opened the host console with CohostOf authority, exposed only the delegated deadline control, extended the D01 deadline through the hydrated host-console command path, and rejected a direct host-only ResolvePhase command as NotHost without mutating phase state.",
  };
}

async function verifyCohostLaterPhaseDeadlineExtension({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  if (browser === null || browser === undefined) {
    throw new Error("cohost later-phase deadline proof requires a Playwright browser");
  }
  const proofGame = crypto.randomUUID();
  const seed = await seedLaterPhaseCohostDeadlineGame({ game: proofGame });
  const expectedDeadline = seed.initialDeadline + 86_400;
  const cohostSession = await createAccountLoginCredential({
    principalUserId: "cohost_c",
    returnTo: `/g/${proofGame}/host`,
    expectedCapabilityKind: "CohostOf",
  });
  const cohostEntry = await openVerifiedRoleEntry({
    browser,
    session: cohostSession,
    game: proofGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    const initialResponse = await cohostEntry.page.goto(
      `${frontendBaseUrl}/g/${proofGame}/host`,
      { waitUntil: "networkidle" },
    );
    if (initialResponse === null || !initialResponse.ok()) {
      throw new Error(
        `cohost later-phase deadline initial load failed: ${initialResponse?.status() ?? null}`,
      );
    }
    await cohostEntry.page.waitForFunction(
      (expected) =>
        window.__fmarchHostProjection?.phase?.id === "D02" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostProjection?.phase?.deadline === expected.initialDeadline,
      { initialDeadline: seed.initialDeadline },
    );
    await cohostEntry.page
      .getByTestId("critical-host-action-extend_deadline")
      .waitFor({ state: "visible" });
    const capabilityLabel = await cohostEntry.page
      .getByTestId("host-console-capability")
      .innerText();
    const setupPhase = await cohostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupDeadlineActions = await visibleHostControlActions(
      cohostEntry.page,
      "deadline",
    );
    const setupPhaseActions = await visibleHostControlActions(cohostEntry.page, "phase");
    const extendDeadline = await confirmHostAction(cohostEntry.page, "extend_deadline");
    await cohostEntry.page.waitForFunction(
      (expected) =>
        window.__fmarchHostProjection?.phase?.id === "D02" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostProjection?.phase?.deadline === expected.deadline,
      { deadline: expectedDeadline },
    );
    const command =
      extendDeadline.commandStatus?.requestEnvelope?.body?.body?.command
        ?.ExtendDeadline;
    const commandPrincipal =
      extendDeadline.commandStatus?.requestEnvelope?.body?.body?.principal_user_id;
    const phaseAfterExtend = await cohostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const deadlineActionsAfterExtend = await visibleHostControlActions(
      cohostEntry.page,
      "deadline",
    );
    const phaseActionsAfterExtend = await visibleHostControlActions(
      cohostEntry.page,
      "phase",
    );
    const reloadResponse = await cohostEntry.page.goto(
      `${frontendBaseUrl}/g/${proofGame}/host`,
      { waitUntil: "networkidle" },
    );
    if (reloadResponse === null || !reloadResponse.ok()) {
      throw new Error(
        `cohost later-phase deadline reload failed: ${reloadResponse?.status() ?? null}`,
      );
    }
    await cohostEntry.page.waitForFunction(
      (expected) =>
        window.__fmarchHostProjection?.phase?.id === "D02" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostProjection?.phase?.deadline === expected.deadline,
      { deadline: expectedDeadline },
    );
    const phaseAfterReload = await cohostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const deadlineActionsAfterReload = await visibleHostControlActions(
      cohostEntry.page,
      "deadline",
    );
    const phaseActionsAfterReload = await visibleHostControlActions(
      cohostEntry.page,
      "phase",
    );
    const apiStateAfterReload = await fetchHostConsoleState({
      apiBaseUrl,
      game: proofGame,
      principalUserId: "cohost_c",
    });
    const reload = {
      routeResponseStatus: reloadResponse.status(),
      phaseAfterReload,
      deadlineActionsAfterReload,
      phaseActionsAfterReload,
      apiPhaseAfterReload: apiStateAfterReload.phase,
    };
    if (
      !capabilityLabel.includes(`CohostOf(${proofGame})`) ||
      setupPhase?.id !== "D02" ||
      setupPhase?.locked !== false ||
      setupPhase?.deadline !== seed.initialDeadline ||
      setupDeadlineActions.includes("extend_deadline") !== true ||
      setupPhaseActions.length !== 0 ||
      extendDeadline.commandStatus?.state !== "ack" ||
      commandPrincipal !== "cohost_c" ||
      command?.game !== proofGame ||
      command?.phase !== "D02" ||
      command?.at !== expectedDeadline ||
      phaseAfterExtend?.id !== "D02" ||
      phaseAfterExtend?.locked !== false ||
      phaseAfterExtend?.deadline !== expectedDeadline ||
      deadlineActionsAfterExtend.includes("extend_deadline") !== true ||
      phaseActionsAfterExtend.length !== 0 ||
      reload.routeResponseStatus !== 200 ||
      phaseAfterReload?.id !== "D02" ||
      phaseAfterReload?.locked !== false ||
      phaseAfterReload?.deadline !== expectedDeadline ||
      deadlineActionsAfterReload.includes("extend_deadline") !== true ||
      phaseActionsAfterReload.length !== 0 ||
      apiStateAfterReload.phase?.phase_id !== "D02" ||
      apiStateAfterReload.phase?.locked !== false ||
      apiStateAfterReload.phase?.deadline !== expectedDeadline
    ) {
      throw new Error(
        `cohost later-phase deadline proof drifted: ${JSON.stringify({
          proofGame,
          capabilityLabel,
          setupPhase,
          setupDeadlineActions,
          setupPhaseActions,
          extendDeadline,
          command,
          commandPrincipal,
          phaseAfterExtend,
          deadlineActionsAfterExtend,
          phaseActionsAfterExtend,
          reload,
        })}`,
      );
    }
    return {
      status: "passed",
      game: proofGame,
      seed,
      initialDeadline: seed.initialDeadline,
      expectedDeadline,
      cohostEntry: cohostEntry.verification,
      capabilityLabel,
      setupPhase,
      setupDeadlineActions,
      setupPhaseActions,
      extendDeadline,
      command,
      commandPrincipal,
      phaseAfterExtend,
      deadlineActionsAfterExtend,
      phaseActionsAfterExtend,
      reload,
      proof:
        "A disposable seeded local game advanced to open D02 with a real D02 deadline, the delegated cohost role URL submitted ExtendDeadline through the hydrated host-console control for D02, and a reload plus API read both converged to the updated D02 deadline with host-only phase controls still absent.",
    };
  } finally {
    await cohostEntry.context.close().catch(() => {});
  }
}

async function hostActionVisible(page, actionId) {
  return await page.getByTestId(`critical-host-action-${actionId}`).isVisible().catch(() => false);
}

async function freezeStaleCohostDeadlinePage({ staleCohostPage, game, frontendBaseUrl }) {
  await staleCohostPage.goto(`${frontendBaseUrl}/g/${game}/host`, { waitUntil: "networkidle" });
  await staleCohostPage.locator('[data-testid="critical-host-action-extend_deadline"]').waitFor({
    state: "visible",
  });
  await staleCohostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D01" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const stalePhase = await staleCohostPage.evaluate(() => window.__fmarchHostProjection?.phase);
  const roleUrl = staleCohostPage.url();
  const deadlineActions = await visibleHostControlActions(staleCohostPage, "deadline");
  const phaseActions = await visibleHostControlActions(staleCohostPage, "phase");
  const closedStatus = await staleCohostPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D01" ||
    stalePhase?.locked !== false ||
    !deadlineActions.includes("extend_deadline") ||
    phaseActions.length !== 0 ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale cohost deadline setup drifted: ${JSON.stringify({
        stalePhase,
        deadlineActions,
        phaseActions,
        closedStatus,
      })}`,
    );
  }
  return {
    roleUrl,
    stalePhase,
    deadlineActions,
    phaseActions,
    closedStatus,
  };
}

async function freezeStaleHostDeadlinePage({ staleHostDeadlinePage, game, frontendBaseUrl }) {
  await staleHostDeadlinePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostDeadlinePage
    .locator('[data-testid="critical-host-action-extend_deadline"]')
    .waitFor({
      state: "visible",
    });
  await staleHostDeadlinePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D01" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const stalePhase = await staleHostDeadlinePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const roleUrl = staleHostDeadlinePage.url();
  const deadlineActions = await visibleHostControlActions(staleHostDeadlinePage, "deadline");
  const phaseActions = await visibleHostControlActions(staleHostDeadlinePage, "phase");
  const closedStatus = await staleHostDeadlinePage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D01" ||
    stalePhase?.locked !== false ||
    !deadlineActions.includes("extend_deadline") ||
    !phaseActions.includes("resolve_phase") ||
    !phaseActions.includes("lock_thread") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host deadline setup drifted: ${JSON.stringify({
        stalePhase,
        deadlineActions,
        phaseActions,
        closedStatus,
      })}`,
    );
  }
  return {
    roleUrl,
    stalePhase,
    deadlineActions,
    phaseActions,
    closedStatus,
  };
}

async function freezeStaleHostResolvePage({ staleHostResolvePage, game, frontendBaseUrl }) {
  await staleHostResolvePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostResolvePage
    .locator('[data-testid="critical-host-action-resolve_phase"]')
    .waitFor({ state: "visible" });
  await staleHostResolvePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const stalePhase = await staleHostResolvePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const roleUrl = staleHostResolvePage.url();
  const phaseActions = await visibleHostControlActions(staleHostResolvePage, "phase");
  const deadlineActions = await visibleHostControlActions(staleHostResolvePage, "deadline");
  const closedStatus = await staleHostResolvePage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D02" ||
    stalePhase?.locked !== false ||
    !phaseActions.includes("resolve_phase") ||
    !phaseActions.includes("lock_thread") ||
    !deadlineActions.includes("extend_deadline") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host resolve setup drifted: ${JSON.stringify({
        stalePhase,
        phaseActions,
        deadlineActions,
        closedStatus,
      })}`,
    );
  }
  return {
    roleUrl,
    stalePhase,
    phaseActions,
    deadlineActions,
    closedStatus,
  };
}

async function freezeStaleHostAdvancePage({ staleHostAdvancePage, game, frontendBaseUrl }) {
  await staleHostAdvancePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostAdvancePage
    .locator('[data-testid="critical-host-action-advance_phase"]')
    .waitFor({ state: "visible" });
  await staleHostAdvancePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === true,
  );
  const stalePhase = await staleHostAdvancePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const roleUrl = staleHostAdvancePage.url();
  const phaseActions = await visibleHostControlActions(staleHostAdvancePage, "phase");
  const deadlineActions = await visibleHostControlActions(staleHostAdvancePage, "deadline");
  const closedStatus = await staleHostAdvancePage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D02" ||
    stalePhase?.locked !== true ||
    !phaseActions.includes("unlock_thread") ||
    !phaseActions.includes("advance_phase") ||
    phaseActions.includes("resolve_phase") ||
    !deadlineActions.includes("extend_deadline") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host advance setup drifted: ${JSON.stringify({
        stalePhase,
        phaseActions,
        deadlineActions,
        closedStatus,
      })}`,
    );
  }
  return {
    roleUrl,
    stalePhase,
    phaseActions,
    deadlineActions,
    closedStatus,
  };
}

async function freezeStaleHostPublishPage({
  staleHostPublishPage,
  game,
  frontendBaseUrl,
  concurrentVoteRace,
}) {
  await staleHostPublishPage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostPublishPage
    .locator('[data-testid="critical-host-action-publish_votecount"]')
    .waitFor({ state: "visible" });
  await staleHostPublishPage.waitForFunction(
    ({ expectedTarget, expectedCount }) =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false &&
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === expectedTarget && row.count === expectedCount,
      ),
    {
      expectedTarget: concurrentVoteRace.targetSlot,
      expectedCount: concurrentVoteRace.apiProjection.count,
    },
  );
  const stalePhase = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const votecountRows = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostVotecountProjection ?? [],
  );
  const votecountActions = await visibleHostControlActions(staleHostPublishPage, "votecount");
  const closedStatus = await staleHostPublishPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D02" ||
    stalePhase?.locked !== false ||
    !votecountRows.some(
      (row) =>
        row.target === concurrentVoteRace.targetSlot &&
        row.count === concurrentVoteRace.apiProjection.count,
    ) ||
    !votecountActions.includes("publish_votecount") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host publish setup drifted: ${JSON.stringify({
        stalePhase,
        votecountRows,
        votecountActions,
        closedStatus,
      })}`,
    );
  }
  return {
    stalePhase,
    votecountRows,
    votecountActions,
    closedStatus,
  };
}

async function freezeStaleHostPublishAfterClearPage({
  staleHostPublishPage,
  game,
  frontendBaseUrl,
  targetSlot,
}) {
  await staleHostPublishPage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostPublishPage
    .locator('[data-testid="critical-host-action-publish_votecount"]')
    .waitFor({ state: "visible" });
  await staleHostPublishPage.waitForFunction(
    (expectedTarget) =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false &&
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === expectedTarget && Number(row.count) >= 1,
      ),
    targetSlot,
  );
  const stalePhase = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const votecountRows = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostVotecountProjection ?? [],
  );
  const votecountActions = await visibleHostControlActions(staleHostPublishPage, "votecount");
  const closedStatus = await staleHostPublishPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  const targetRow = votecountRows.find((row) => row.target === targetSlot);
  const staleBody =
    targetRow === undefined ? null : `Official votecount for D02\n- ${targetSlot}: ${targetRow.count}`;
  if (
    stalePhase?.id !== "D02" ||
    stalePhase?.locked !== false ||
    targetRow === undefined ||
    Number(targetRow.count) < 1 ||
    !votecountActions.includes("publish_votecount") ||
    closedStatus?.state !== "closed" ||
    staleBody === null
  ) {
    throw new Error(
      `stale host publish-after-clear setup drifted: ${JSON.stringify({
        targetSlot,
        stalePhase,
        votecountRows,
        votecountActions,
        closedStatus,
        staleBody,
      })}`,
    );
  }
  return {
    stalePhase,
    votecountRows,
    votecountActions,
    closedStatus,
    staleBody,
  };
}

async function freezeStaleHostLifecyclePage({
  staleHostLifecyclePage,
  game,
  frontendBaseUrl,
}) {
  await staleHostLifecyclePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostLifecyclePage
    .locator('[data-testid="critical-host-action-mark_dead"]')
    .waitFor({ state: "visible" });
  await staleHostLifecyclePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false &&
      window.__fmarchHostProjection?.replacement?.lifecycleLabel === "Alive",
  );
  const stalePhase = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const replacement = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const lifecycleActions = await visibleHostControlActions(
    staleHostLifecyclePage,
    "slot-lifecycle",
  );
  const closedStatus = await staleHostLifecyclePage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D02" ||
    stalePhase?.locked !== false ||
    replacement?.lifecycleLabel !== "Alive" ||
    !lifecycleActions.includes("mark_dead") ||
    !lifecycleActions.includes("modkill_slot") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host lifecycle setup drifted: ${JSON.stringify({
        stalePhase,
        replacement,
        lifecycleActions,
        closedStatus,
      })}`,
    );
  }
  return {
    stalePhase,
    replacement,
    lifecycleActions,
    closedStatus,
  };
}

async function verifySeededCoreLoop({ hostPage, playerPage, game, apiBaseUrl }) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
  const staleVotePage = await playerPage.context().newPage();
  let staleVoteRoleUrl = null;
  let playerCommandStateBeforeClose = null;
  let voteControlBeforeClose = null;
  let currentVoteBeforeClose = null;
  let apiVotecountBeforeReject = null;
  let closedStatus = null;
  try {
    await gotoPlayerBoard(staleVotePage, game);
    await staleVotePage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        window.__fmarchPlayerProjection?.commandState?.voteTargets?.length > 0,
    );
    staleVoteRoleUrl = staleVotePage.url();
    playerCommandStateBeforeClose = await staleVotePage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    voteControlBeforeClose = await playerCommandControlState(
      staleVotePage,
      "submit_vote",
    );
    currentVoteBeforeClose = await staleVotePage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    apiVotecountBeforeReject = normalizedVotecountRows(
      await fetchJson(`${apiBaseUrl}/games/${game}/votecount`),
    );
    await staleVotePage.waitForFunction(
      () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    );
    closedStatus = await staleVotePage.evaluate(() =>
      window.__fmarchClosePlayerLiveProjection(),
    );
  } catch (error) {
    await staleVotePage.close().catch(() => {});
    throw error;
  }
  const lock = await confirmHostAction(hostPage, "lock_thread");
  await waitForHostProjectionPhaseLocked(hostPage, true);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  const playerCommandStateLockedBeforeVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const playerLockedBeforeVote = playerCommandStateLockedBeforeVote?.phase;
  const lockedVoteControl = await playerCommandControlState(playerPage, "submit_vote");
  await staleVotePage.locator('[data-action="submit_vote"]').click();
  await staleVotePage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  await staleVotePage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  await staleVotePage.locator('[data-action="submit_vote"]').waitFor({
    state: "detached",
  });
  const rejectedVote = await staleVotePage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const rejectedVoteReceipt = await staleVotePage.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const rejectedVoteReceiptText = await staleVotePage
    .getByTestId("player-command-status")
    .innerText();
  const rejectedVoteDispatchPlan = await staleVotePage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const staleVoteCommandStateAfterReject = await staleVotePage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const staleVoteControlAfterReject = await playerCommandControlState(
    staleVotePage,
    "submit_vote",
  );
  const staleVoteCurrentVoteAfterReject = await staleVotePage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  const apiVotecountAfterReject = normalizedVotecountRows(
    await fetchJson(`${apiBaseUrl}/games/${game}/votecount`),
  );
  await staleVotePage.close();
  if (
    playerCommandStateBeforeClose?.game !== game ||
    playerCommandStateBeforeClose?.phase?.locked !== false ||
    playerCommandStateBeforeClose?.voteTargets?.some((target) => target.kind === "slot") !==
      true ||
    voteControlBeforeClose?.exists !== true ||
    voteControlBeforeClose?.disabled !== false ||
    currentVoteBeforeClose?.hasVote !==
      String(playerCommandStateBeforeClose?.currentVote !== null) ||
    closedStatus?.state !== "closed" ||
    lockedVoteControl.exists !== false ||
    rejectedVote.error !== "PhaseLocked" ||
    rejectedVote.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(rejectedVote.streamSeqs) ||
    rejectedVote.requestEnvelope?.body?.body?.command?.SubmitVote?.game !== game ||
    rejectedVote.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !==
      "slot-7" ||
    rejectedVote.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
      "slot-2" ||
    rejectedVoteReceipt?.actionId !== "submit_vote" ||
    rejectedVoteReceipt?.state !== "reject" ||
    rejectedVoteReceipt?.commandTrace?.projectionRefreshKeys?.includes(
      "commandState",
    ) !== true ||
    !rejectedVoteReceiptText.includes("Reject PhaseLocked") ||
    !isStaleVotePhaseLockedMessage(rejectedVote.message) ||
    rejectedVoteDispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
    rejectedVoteDispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
    staleVoteCommandStateAfterReject?.phase?.locked !== true ||
    JSON.stringify(staleVoteCommandStateAfterReject?.currentVote ?? null) !==
      JSON.stringify(playerCommandStateBeforeClose?.currentVote ?? null) ||
    staleVoteCommandStateAfterReject?.voteTargets?.length !== 0 ||
    staleVoteControlAfterReject.exists !== false ||
    staleVoteCurrentVoteAfterReject.hasVote !== currentVoteBeforeClose?.hasVote ||
    JSON.stringify(apiVotecountAfterReject) !==
      JSON.stringify(apiVotecountBeforeReject)
  ) {
    throw new Error(
      `locked player vote boundary drifted: ${JSON.stringify({
        staleVoteRoleUrl,
        playerCommandStateBeforeClose,
        voteControlBeforeClose,
        currentVoteBeforeClose,
        closedStatus,
        playerCommandStateLockedBeforeVote,
        lockedVoteControl,
        rejectedVote,
        rejectedVoteReceipt,
        rejectedVoteReceiptText,
        rejectedVoteDispatchPlan,
        staleVoteCommandStateAfterReject,
        staleVoteControlAfterReject,
        staleVoteCurrentVoteAfterReject,
        apiVotecountBeforeReject,
        apiVotecountAfterReject,
      })}`,
    );
  }
  const playerProjectionAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  await expectHostPhaseActions(hostPage, [
    "unlock_thread",
    "advance_phase",
    "advance_phase_by_deadline",
  ]);
  const unlock = await confirmHostAction(hostPage, "unlock_thread");
  await waitForHostProjectionPhaseLocked(hostPage, false);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
  );
  const playerUnlockedAfterRecovery = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );

  return {
    status: "passed",
    hostActions: {
      initial: ["resolve_phase", "lock_thread"],
      locked: ["unlock_thread", "advance_phase", "advance_phase_by_deadline"],
      restored: ["resolve_phase", "lock_thread"],
    },
    lock,
    lockedVoteControl,
    rejectedVote,
    staleVoteBrowserProof: {
      roleUrl: staleVoteRoleUrl,
      commandStateBeforeClose: playerCommandStateBeforeClose,
      voteControlBeforeClose,
      currentVoteBeforeClose,
      closedStatus,
      receipt: rejectedVoteReceipt,
      receiptStatusText: rejectedVoteReceiptText,
      dispatchPlan: rejectedVoteDispatchPlan,
      commandStateAfterReject: staleVoteCommandStateAfterReject,
      voteControlAfterReject: staleVoteControlAfterReject,
      currentVoteAfterReject: staleVoteCurrentVoteAfterReject,
      apiVotecountBeforeReject,
      apiVotecountAfterReject,
      votecountUnchanged:
        JSON.stringify(apiVotecountAfterReject) ===
        JSON.stringify(apiVotecountBeforeReject),
    },
    unlock,
    playerPhases: {
      lockedBeforeVote: playerLockedBeforeVote,
      afterReject: playerProjectionAfterReject,
      unlockedAfterRecovery: playerUnlockedAfterRecovery,
    },
    proof:
      "The seeded host role URL locked D01 through the hydrated host phase control, a frozen seeded player role URL clicked its stale SubmitVote control, rendered a PhaseLocked recovery receipt, refreshed to locked command-state truth without changing votecount state, then the host role URL unlocked D01 so the human-run game remains usable.",
  };
}

async function verifySeededDayVoteResolution({
  hostPage,
  actionPage,
  targetPage,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const dayVoteGame = crypto.randomUUID();
  const seed = await seedDayVoteResolutionGame({ game: dayVoteGame });
  const hostProofPage = await hostPage.context().newPage();
  const voterPage = await actionPage.context().newPage();
  const targetProofPage = await targetPage.context().newPage();
  try {
    await hostProofPage.goto(`${frontendBaseUrl}/g/${dayVoteGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostProofPage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "D01" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "slot-2" && row.count === 3,
        ),
    );
    const hostBeforeVote = {
      phase: await hostProofPage.evaluate(() => window.__fmarchHostProjection?.phase),
      votecount: await hostProofPage.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
      phaseActions: await visibleHostPhaseActions(hostProofPage),
    };

    await gotoPlayerBoard(voterPage, dayVoteGame);
    await voterPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
    );
    const voterBeforeVote = await voterPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const voterCurrentVoteBefore = await voterPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const voterWithdrawBefore = await playerCommandControlState(
      voterPage,
      "withdraw_vote",
    );
    const voterVoteButtons = await voterPage
      .locator('[data-action^="submit_vote"]')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          action: node.getAttribute("data-action"),
          text: node.textContent?.trim() ?? "",
          disabled: node.disabled === true,
        })),
      );
    await voterPage.locator('[data-action="submit_vote"]').click();
    await voterPage.waitForFunction(
      () => window.__fmarchPlayerCommandStatus?.state === "ack",
    );
    await voterPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === "slot-2" && row.count === 4,
        ),
    );
    await voterPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          "slot-2",
    );
    const finalVote = await voterPage.evaluate(() => window.__fmarchPlayerCommandStatus);
    const voterAfterVote = await voterPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const voterCurrentVoteAfter = await voterPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const voterWithdrawAfter = await playerCommandControlState(voterPage, "withdraw_vote");
    const voterVotecountAfterVote = await voterPage.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );

    const resolveDay = await confirmHostAction(hostProofPage, "resolve_phase");
    await waitForHostProjectionPhase(hostProofPage, { phaseId: "D01", locked: true });
    await hostProofPage.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ),
    );
    const hostAfterResolve = {
      phase: await hostProofPage.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostProofPage),
      dayVoteOutcomes: await hostProofPage.evaluate(
        () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
      ),
      outcomePanel: await hostProofPage
        .locator('[data-testid="host-day-vote-outcome-latest"]')
        .innerText(),
      outcomeTally: await hostProofPage
        .locator('[data-testid="host-day-vote-outcome-tally-slot-2"]')
        .innerText(),
    };

    await gotoPlayerBoard(targetProofPage, dayVoteGame);
    await targetProofPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
        window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ) &&
        window.__fmarchPlayerProjection?.notifications?.some(
          (notice) =>
            notice.effect === "player_killed" && notice.status === "day_vote",
        ),
    );
    const targetCommandState = await targetProofPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const targetNotice = await targetProofPage.evaluate(
      () =>
        window.__fmarchPlayerProjection?.notifications?.find(
          (notice) =>
            notice.effect === "player_killed" && notice.status === "day_vote",
        ) ?? null,
    );
    const targetControls = {
      vote: await playerCommandControlState(targetProofPage, "submit_vote"),
      withdraw: await playerCommandControlState(targetProofPage, "withdraw_vote"),
      post: await playerCommandControlState(targetProofPage, "submit_post"),
    };
    const targetDayVoteOutcomes = await targetProofPage.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const targetOutcomePanel = await targetProofPage
      .locator('[data-testid="player-day-vote-outcome-latest"]')
      .innerText();
    const targetOutcomeTally = await targetProofPage
      .locator('[data-testid="player-day-vote-outcome-tally-slot-2"]')
      .innerText();

    const dayVoteOutcomes = await fetchJson(
      `${apiBaseUrl}/games/${dayVoteGame}/day-vote-outcomes`,
    );
    const dayVoteOutcome =
      dayVoteOutcomes.find((delta) => delta.kind === "DayVoteOutcomeApplied")?.body ??
      null;
    const hostState = await fetchHostConsoleState({
      apiBaseUrl,
      game: dayVoteGame,
      slot: "slot-2",
    });
    const hostSlot = hostState.slots?.find?.((slot) => slot.slot_id === "slot-2");

    if (
      finalVote?.state !== "ack" ||
      finalVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !==
        "slot_4" ||
      finalVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
        "slot-2" ||
      !voterBeforeVote?.voteTargets?.some(
        (target) => target.kind === "slot" && target.slotId === "slot-2",
      ) ||
      !voterBeforeVote?.voteTargets?.some((target) => target.kind === "no_lynch") ||
      voterBeforeVote?.currentVote !== null ||
      voterCurrentVoteBefore.hasVote !== "false" ||
      !voterCurrentVoteBefore.text.includes("No current vote") ||
      voterWithdrawBefore.exists !== true ||
      voterWithdrawBefore.disabled !== true ||
      voterWithdrawBefore.reason !== "No current vote" ||
      !voterVoteButtons.some(
        (button) =>
          button.action === "submit_vote" &&
          button.text.includes("Vote Slot 2") &&
          button.disabled === false,
      ) ||
      !voterVoteButtons.some(
        (button) =>
          button.action === "submit_vote:no_lynch" &&
          button.text.includes("Vote no lynch") &&
          button.disabled === false,
      ) ||
      voterAfterVote?.currentVote?.kind !== "slot" ||
      voterAfterVote?.currentVote?.slotId !== "slot-2" ||
      voterCurrentVoteAfter.hasVote !== "true" ||
      !voterCurrentVoteAfter.text.includes("Slot 2") ||
      voterWithdrawAfter.exists !== true ||
      voterWithdrawAfter.disabled !== false ||
      !voterVotecountAfterVote.some(
        (row) => row.target === "slot-2" && row.count === 4,
      ) ||
      resolveDay.commandStatus?.state !== "ack" ||
      dayVoteOutcome?.phase_id !== "D01" ||
      dayVoteOutcome?.status !== "Lynch" ||
      dayVoteOutcome?.winner_slot !== "slot-2" ||
      dayVoteOutcome?.tallies?.["slot-2"] !== 4 ||
      hostAfterResolve.phase?.id !== "D01" ||
      hostAfterResolve.phase?.locked !== true ||
      !hostAfterResolve.dayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      !hostAfterResolve.outcomePanel.includes("D01 Lynch") ||
      !hostAfterResolve.outcomePanel.includes("Slot 2 was eliminated") ||
      !hostAfterResolve.outcomeTally.includes("4/3") ||
      hostSlot?.alive !== false ||
      hostSlot?.status !== "dead" ||
      targetCommandState?.actorSlot !== "slot-2" ||
      targetCommandState?.actorAlive !== false ||
      targetCommandState?.actorStatus !== "dead" ||
      !targetDayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      !targetOutcomePanel.includes("D01 Lynch") ||
      !targetOutcomePanel.includes("Slot 2 was eliminated") ||
      !targetOutcomeTally.includes("4/3") ||
      targetNotice?.audience_slot !== "slot-2" ||
      targetNotice?.effect !== "player_killed" ||
      targetNotice?.status !== "day_vote" ||
      !Object.values(targetControls).every((control) => control.disabled === true)
    ) {
      throw new Error(
        `day vote resolution proof drifted: ${JSON.stringify({
          dayVoteGame,
          seed,
          hostBeforeVote,
          voterBeforeVote,
          voterCurrentVoteBefore,
          voterWithdrawBefore,
          voterVoteButtons,
          finalVote,
          voterAfterVote,
          voterCurrentVoteAfter,
          voterWithdrawAfter,
          voterVotecountAfterVote,
          resolveDay,
          hostAfterResolve,
          dayVoteOutcomes,
          hostSlot,
          targetCommandState,
          targetNotice,
          targetControls,
          targetDayVoteOutcomes,
          targetOutcomePanel,
          targetOutcomeTally,
        })}`,
      );
    }

    return {
      status: "passed",
      game: dayVoteGame,
      seed,
      hostBeforeVote,
      voterBeforeVote,
      voterCurrentVoteBefore,
      voterWithdrawBefore,
      voterVoteButtons,
      finalVote,
      voterAfterVote,
      voterCurrentVoteAfter,
      voterWithdrawAfter,
      voterVotecountAfterVote,
      resolveDay,
      hostAfterResolve,
      dayVoteOutcome,
      hostSlot,
      targetCommandState,
      targetNotice,
      targetControls,
      targetDayVoteOutcomes,
      targetOutcomePanel,
      targetOutcomeTally,
      proof:
        "A disposable seeded day-vote game loaded host/action-player/target role URLs, the action-player browser rendered projection-derived slot and no-lynch vote controls, showed no current vote with Withdraw disabled, cast the fourth Slot 2 vote through /commands, refreshed current_vote to Slot 2 with Withdraw enabled, the host browser resolved D01, /day-vote-outcomes exposed the official Lynch result, the host and target player role URLs rendered the official day-vote outcome panel, the host projection marked Slot 2 dead, and the target player role URL saw the day_vote death notice with closed controls.",
    };
  } finally {
    await hostProofPage.close().catch(() => {});
    await voterPage.close().catch(() => {});
    await targetProofPage.close().catch(() => {});
  }
}

async function seedDayVoteResolutionGame({
  game,
  slotSevenRoleKey = "vanilla_townie",
  slotFourRoleKey = "vanilla_townie",
}) {
  const plan = [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game, slot: "slot-7" } }],
    ["host_h", { AddSlot: { game, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game, slot: "slot-3" } }],
    ["host_h", { AddSlot: { game, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game, slot: "slot_5" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-7", user: "player-mira" } }],
    ["host_h", { AssignRole: { game, slot: "slot-7", role_key: slotSevenRoleKey } }],
    ["host_h", { AssignSlot: { game, slot: "slot-2", user: "player-target" } }],
    ["host_h", { AssignRole: { game, slot: "slot-2", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-3", user: "player-seed" } }],
    ["host_h", { AssignRole: { game, slot: "slot-3", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot_4", user: "player-goon-a" } }],
    ["host_h", { AssignRole: { game, slot: "slot_4", role_key: slotFourRoleKey } }],
    ["host_h", { AssignSlot: { game, slot: "slot_5", user: "player-goon-b" } }],
    ["host_h", { AssignRole: { game, slot: "slot_5", role_key: "vanilla_townie" } }],
    ["host_h", { StartGame: { game, phase: "D01" } }],
    [
      "player-seed",
      { SubmitVote: { game, actor_slot: "slot-3", target: { Slot: "slot-2" } } },
    ],
    [
      "player-mira",
      { SubmitVote: { game, actor_slot: "slot-7", target: { Slot: "slot-2" } } },
    ],
    [
      "player-goon-b",
      { SubmitVote: { game, actor_slot: "slot_5", target: { Slot: "slot-2" } } },
    ],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game,
    commands: commands.length,
    preseededVotes: 3,
    targetSlot: "slot-2",
    resolvingVoterSlot: "slot_4",
    slotSevenRoleKey,
    slotFourRoleKey,
  };
}

async function verifySeededDayVoteNoLynch({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const noLynchGame = crypto.randomUUID();
  const seed = await seedDayVoteNoLynchGame({ game: noLynchGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${noLynchGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const miraVoterSession = await createAccountLoginCredential({
    principalUserId: "player-mira",
    returnTo: `/g/${noLynchGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const seedVoterSession = await createAccountLoginCredential({
    principalUserId: "player-seed",
    returnTo: `/g/${noLynchGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const survivorSession = await createAccountLoginCredential({
    principalUserId: "player-target",
    returnTo: `/g/${noLynchGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: noLynchGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const miraVoterEntry = await openVerifiedRoleEntry({
    browser,
    session: miraVoterSession,
    game: noLynchGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const seedVoterEntry = await openVerifiedRoleEntry({
    browser,
    session: seedVoterSession,
    game: noLynchGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const survivorEntry = await openVerifiedRoleEntry({
    browser,
    session: survivorSession,
    game: noLynchGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    await gotoPlayerBoard(miraVoterEntry.page, noLynchGame);
    await miraVoterEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    await waitForEnabledNoLynchVoteControl(miraVoterEntry.page, "slot-7");
    await seedVoterEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    await waitForEnabledNoLynchVoteControl(seedVoterEntry.page, "slot-2");
    await miraVoterEntry.page.locator('[data-action="submit_vote:no_lynch"]').click();
    await miraVoterEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-mira" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch",
    );
    await waitForPlayerVotecount(miraVoterEntry.page, { target: "no_lynch", count: 1 });
    const miraNoLynchVote = await miraVoterEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const miraVotecountAfterVote = await miraVoterEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );

    await seedVoterEntry.page.locator('[data-action="submit_vote:no_lynch"]').click();
    await seedVoterEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-seed" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch",
    );
    await waitForPlayerVotecount(seedVoterEntry.page, {
      target: "no_lynch",
      count: 2,
    });
    const seedNoLynchVote = await seedVoterEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const seedVotecountAfterVote = await seedVoterEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );

    await hostEntry.page.goto(`${frontendBaseUrl}/g/${noLynchGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "D01" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "no_lynch" && row.count === 2,
        ),
    );
    const hostBeforeResolve = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      votecount: await hostEntry.page.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
    };

    const resolveDay = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "D01", locked: true });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ),
    );
    const hostAfterResolve = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      dayVoteOutcomes: await hostEntry.page.evaluate(
        () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
      ),
      outcomePanel: await hostEntry.page
        .locator('[data-testid="host-day-vote-outcome-latest"]')
        .innerText(),
      outcomeTally: await hostEntry.page
        .locator('[data-testid="host-day-vote-outcome-tally-no_lynch"]')
        .innerText(),
    };

    await gotoPlayerBoard(survivorEntry.page, noLynchGame);
    await survivorEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_3" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
        window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ),
    );
    const survivorCommandState = await survivorEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const survivorNotifications = await survivorEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const survivorDayVoteOutcomes = await survivorEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const survivorOutcomePanel = await survivorEntry.page
      .locator('[data-testid="player-day-vote-outcome-latest"]')
      .innerText();
    const survivorOutcomeTally = await survivorEntry.page
      .locator('[data-testid="player-day-vote-outcome-tally-no_lynch"]')
      .innerText();

    const dayVoteOutcomes = await fetchJson(
      `${apiBaseUrl}/games/${noLynchGame}/day-vote-outcomes`,
    );
    const dayVoteOutcome =
      dayVoteOutcomes.find((delta) => delta.kind === "DayVoteOutcomeApplied")?.body ??
      null;
    const hostState = await fetchHostConsoleState({
      apiBaseUrl,
      game: noLynchGame,
      slot: "slot_3",
    });
    const survivorSlot = hostState.slots?.find?.((slot) => slot.slot_id === "slot_3");
    const dayVoteDeathNotices = survivorNotifications.filter(
      (notice) => notice.effect === "player_killed" && notice.status === "day_vote",
    );

    if (
      resolveDay.commandStatus?.state !== "ack" ||
      dayVoteOutcome?.phase_id !== "D01" ||
      dayVoteOutcome?.status !== "NoLynch" ||
      dayVoteOutcome?.winner_slot !== null ||
      dayVoteOutcome?.tallies?.no_lynch !== 2 ||
      miraNoLynchVote?.state !== "ack" ||
      miraNoLynchVote?.requestEnvelope?.body?.body?.principal_user_id !==
        "player-mira" ||
      miraNoLynchVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target !==
        "NoLynch" ||
      seedNoLynchVote?.state !== "ack" ||
      seedNoLynchVote?.requestEnvelope?.body?.body?.principal_user_id !==
        "player-seed" ||
      seedNoLynchVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target !==
        "NoLynch" ||
      !miraVotecountAfterVote.some(
        (row) => row.target === "no_lynch" && row.count === 1,
      ) ||
      !seedVotecountAfterVote.some(
        (row) => row.target === "no_lynch" && row.count === 2,
      ) ||
      hostAfterResolve.phase?.id !== "D01" ||
      hostAfterResolve.phase?.locked !== true ||
      !hostAfterResolve.dayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "NoLynch" &&
          row.winnerSlot === null,
      ) ||
      !hostAfterResolve.outcomePanel.includes("D01 NoLynch") ||
      !hostAfterResolve.outcomePanel.includes("without an elimination") ||
      !hostAfterResolve.outcomeTally.includes("No lynch") ||
      !hostAfterResolve.outcomeTally.includes("2/2") ||
      survivorSlot?.alive !== true ||
      survivorSlot?.status !== "alive" ||
      survivorCommandState?.actorSlot !== "slot_3" ||
      survivorCommandState?.actorAlive !== true ||
      survivorCommandState?.actorStatus !== "alive" ||
      dayVoteDeathNotices.length !== 0 ||
      !survivorDayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "NoLynch" &&
          row.winnerSlot === null,
      ) ||
      !survivorOutcomePanel.includes("D01 NoLynch") ||
      !survivorOutcomePanel.includes("without an elimination") ||
      !survivorOutcomeTally.includes("No lynch") ||
      !survivorOutcomeTally.includes("2/2")
    ) {
      throw new Error(
        `day vote no-lynch proof drifted: ${JSON.stringify({
          noLynchGame,
          seed,
          seedVoterSession: {
            principalUserId: seedVoterSession.principalUserId,
            credentialKind: seedVoterSession.credentialKind,
            expectedCapabilityKind: seedVoterSession.expectedCapabilityKind,
          },
          seedVoterBrowserEntry: seedVoterEntry.verification,
          miraNoLynchVote,
          miraVotecountAfterVote,
          seedNoLynchVote,
          seedVotecountAfterVote,
          hostBeforeResolve,
          resolveDay,
          hostAfterResolve,
          dayVoteOutcomes,
          survivorSlot,
          survivorCommandState,
          survivorNotifications,
          survivorDayVoteOutcomes,
          survivorOutcomePanel,
          survivorOutcomeTally,
        })}`,
      );
    }

    return {
      status: "passed",
      game: noLynchGame,
      seed,
      seedVoterSession: {
        principalUserId: seedVoterSession.principalUserId,
        credentialKind: seedVoterSession.credentialKind,
        expectedCapabilityKind: seedVoterSession.expectedCapabilityKind,
      },
      seedVoterBrowserEntry: seedVoterEntry.verification,
      miraNoLynchVote,
      miraVotecountAfterVote,
      seedNoLynchVote,
      seedVotecountAfterVote,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      dayVoteOutcome,
      survivorSlot,
      survivorCommandState,
      survivorNotifications,
      survivorDayVoteOutcomes,
      survivorOutcomePanel,
      survivorOutcomeTally,
      proof:
        "A disposable seeded no-lynch game loaded two player role URLs, both players clicked the Vote no lynch control through /commands, the host role URL resolved those no_lynch votes, /day-vote-outcomes exposed the official NoLynch result, both host and surviving-player role URLs rendered the no-elimination outcome panel, and the surviving player stayed alive without a day_vote death notice.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await miraVoterEntry.context.close().catch(() => {});
    await survivorEntry.context.close().catch(() => {});
    await seedVoterEntry.context.close().catch(() => {});
  }
}

async function seedDayVoteNoLynchGame({ game }) {
  const plan = [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game, slot: "slot-7" } }],
    ["host_h", { AddSlot: { game, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game, slot: "slot_3" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-7", user: "player-mira" } }],
    ["host_h", { AssignRole: { game, slot: "slot-7", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-2", user: "player-seed" } }],
    ["host_h", { AssignRole: { game, slot: "slot-2", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot_3", user: "player-target" } }],
    ["host_h", { AssignRole: { game, slot: "slot_3", role_key: "mafia_goon" } }],
    ["host_h", { StartGame: { game, phase: "D01" } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game,
    commands: commands.length,
    preseededNoLynchVotes: 0,
    browserNoLynchVoteSlots: ["slot-7", "slot-2"],
    survivorSlot: "slot_3",
  };
}

async function verifySeededVanillizerRoleAction({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const scenario = vanillizerRoleActionScenario();
  const vanillizerGame = crypto.randomUUID();
  const seed = await seedVanillizerRoleActionGame(vanillizerGame);
  const sessionSpecs = {
    host: {
      principalUserId: "host_h",
      returnTo: `/g/${vanillizerGame}/host`,
      expectedCapabilityKind: "HostOf",
    },
    actor: {
      principalUserId: scenario.actor.principalUserId,
      returnTo: `/g/${vanillizerGame}`,
      expectedCapabilityKind: "SlotOccupant",
    },
    target: {
      principalUserId: scenario.target.principalUserId,
      returnTo: `/g/${vanillizerGame}`,
      expectedCapabilityKind: "SlotOccupant",
    },
  };
  const sessionEntries = Object.fromEntries(
    await Promise.all(
      Object.entries(sessionSpecs).map(async ([key, spec]) => [
        key,
        await createAccountLoginCredential({
          ...spec,
        }),
      ]),
    ),
  );
  const entries = Object.fromEntries(
    await Promise.all(
      Object.entries(sessionEntries).map(async ([key, session]) => [
        key,
        await openVerifiedRoleEntry({
          browser,
          session,
          game: vanillizerGame,
          apiBaseUrl,
          frontendBaseUrl,
        }),
      ]),
    ),
  );

  try {
    await gotoPlayerBoard(entries.actor.page, vanillizerGame);
    await gotoPlayerBoard(entries.target.page, vanillizerGame);
    await entries.actor.page.waitForFunction(
      ({ roleKey, templateId, targetSlot }) => {
        const state = window.__fmarchPlayerProjection?.commandState;
        return (
          state?.phase?.phaseId === "N01" &&
          state?.phase?.locked === false &&
          state?.role?.key === roleKey &&
          state?.actions?.some(
            (action) =>
              action.templateId === templateId &&
              action.targetOptions?.includes(targetSlot),
          )
        );
      },
      {
        roleKey: scenario.actor.roleKey,
        templateId: scenario.templateId,
        targetSlot: scenario.target.slotId,
      },
    );
    await entries.target.page.waitForFunction(
      ({ roleKey, templateId }) => {
        const state = window.__fmarchPlayerProjection?.commandState;
        return (
          state?.phase?.phaseId === "N01" &&
          state?.role?.key === roleKey &&
          state?.actions?.some((action) => action.templateId === templateId)
        );
      },
      {
        roleKey: scenario.target.initialRoleKey,
        templateId: scenario.target.initialActionTemplateId,
      },
    );
    const actorBefore = {
      commandState: await entries.actor.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      roleCard: await playerRoleCardSnapshot(entries.actor.page),
      buttons: await playerCommandButtons(entries.actor.page),
    };
    const targetBefore = {
      commandState: await entries.target.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      roleCard: await playerRoleCardSnapshot(entries.target.page),
      buttons: await playerCommandButtons(entries.target.page),
    };

    const targetOption = entries.actor.page.getByTestId(
      `player-action-target-${scenario.templateId}-${scenario.target.slotId}`,
    );
    await targetOption.locator("input").check();
    const trigger = entries.actor.page.getByTestId(
      `player-action-trigger-${scenario.templateId}`,
    );
    await entries.actor.page.waitForFunction(
      ({ templateId, targetSlot }) =>
        document
          .querySelector(`[data-testid="player-action-trigger-${templateId}"]`)
          ?.getAttribute("data-target-slots") === targetSlot,
      { templateId: scenario.templateId, targetSlot: scenario.target.slotId },
    );
    const selectedTarget = await trigger.getAttribute("data-target-slots");
    await trigger.click();
    const confirmationMessage = await entries.actor.page
      .getByTestId(`player-action-confirmation-message-${scenario.templateId}`)
      .innerText();
    await entries.actor.page
      .getByTestId(`player-action-confirm-${scenario.templateId}`)
      .click();
    await entries.actor.page.waitForFunction(
      ({ templateId, targetSlot }) => {
        const status = window.__fmarchPlayerCommandStatus;
        const submitted = status?.requestEnvelope?.body?.body?.command?.SubmitAction;
        return (
          status?.state === "ack" &&
          submitted?.template_id === templateId &&
          submitted?.targets?.[0] === targetSlot
        );
      },
      {
        templateId: scenario.templateId,
        targetSlot: scenario.target.slotId,
      },
    );
    const submit = await entries.actor.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    await entries.actor.page.waitForFunction(
      ({ templateId, targetSlot }) =>
        window.__fmarchPlayerProjection?.commandState?.currentActions?.some(
          (action) =>
            action.templateId === templateId && action.targets?.[0] === targetSlot,
        ),
      { templateId: scenario.templateId, targetSlot: scenario.target.slotId },
    );
    const actorAfterSubmit = await entries.actor.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );

    await gotoHostConsole(entries.host.page, vanillizerGame);
    await waitForHostProjectionPhase(entries.host.page, {
      phaseId: "N01",
      locked: false,
    });
    const resolveNight = (await confirmHostAction(entries.host.page, "resolve_phase"))
      .commandStatus;
    await waitForHostProjectionPhase(entries.host.page, {
      phaseId: "N01",
      locked: true,
    });
    await entries.target.page.waitForFunction(
      ({ roleKey }) =>
        window.__fmarchPlayerProjection?.commandState?.role?.key === roleKey,
      { roleKey: scenario.target.resolvedRoleKey },
    );
    const targetAfterResolve = {
      commandState: await entries.target.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      roleCard: await playerRoleCardSnapshot(entries.target.page),
    };

    const advanceDay = (await confirmHostAction(entries.host.page, "advance_phase"))
      .commandStatus;
    await waitForHostProjectionPhase(entries.host.page, {
      phaseId: "D02",
      locked: false,
    });
    const resolveDay = (await confirmHostAction(entries.host.page, "resolve_phase"))
      .commandStatus;
    await waitForHostProjectionPhase(entries.host.page, {
      phaseId: "D02",
      locked: true,
    });
    const advanceNextNight = (
      await confirmHostAction(entries.host.page, "advance_phase")
    ).commandStatus;
    await waitForHostProjectionPhase(entries.host.page, {
      phaseId: scenario.nextEligiblePhaseId,
      locked: false,
    });
    await entries.target.page.waitForFunction(
      ({ phaseId, roleKey }) => {
        const state = window.__fmarchPlayerProjection?.commandState;
        return (
          state?.phase?.phaseId === phaseId &&
          state?.phase?.locked === false &&
          state?.role?.key === roleKey &&
          state?.actions?.length === 0
        );
      },
      {
        phaseId: scenario.nextEligiblePhaseId,
        roleKey: scenario.target.resolvedRoleKey,
      },
    );
    await entries.actor.page.waitForFunction(
      ({ phaseId, roleKey, templateId }) => {
        const state = window.__fmarchPlayerProjection?.commandState;
        return (
          state?.phase?.phaseId === phaseId &&
          state?.role?.key === roleKey &&
          state?.actions?.some((action) => action.templateId === templateId)
        );
      },
      {
        phaseId: scenario.nextEligiblePhaseId,
        roleKey: scenario.actor.roleKey,
        templateId: scenario.templateId,
      },
    );
    const actorAtNextNight = {
      commandState: await entries.actor.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      roleCard: await playerRoleCardSnapshot(entries.actor.page),
    };

    await entries.target.page.reload({ waitUntil: "networkidle" });
    await entries.target.page.getByTestId("player-surface").waitFor({ state: "visible" });
    await entries.target.page.waitForFunction(
      ({ phaseId, roleKey }) => {
        const state = window.__fmarchPlayerProjection?.commandState;
        return (
          state?.phase?.phaseId === phaseId &&
          state?.role?.key === roleKey &&
          state?.actions?.length === 0
        );
      },
      {
        phaseId: scenario.nextEligiblePhaseId,
        roleKey: scenario.target.resolvedRoleKey,
      },
    );
    const targetAfterReload = {
      commandState: await entries.target.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      roleCard: await playerRoleCardSnapshot(entries.target.page),
      buttons: await playerCommandButtons(entries.target.page),
    };
    const apiStateAfterReload = await fetchHostConsoleState({
      apiBaseUrl,
      game: vanillizerGame,
      slot: scenario.target.slotId,
    });
    const apiTargetAfterReload = apiStateAfterReload.slots?.find(
      (slot) => slot.slot_id === scenario.target.slotId,
    );
    const proof = {
      status: "passed",
      game: vanillizerGame,
      seed,
      actorRoleUrl: entries.actor.page.url(),
      targetRoleUrl: entries.target.page.url(),
      hostRoleUrl: entries.host.page.url(),
      actorBefore,
      targetBefore,
      selectedTarget,
      confirmationMessage,
      submit,
      actorAfterSubmit,
      resolveNight,
      targetAfterResolve,
      advanceDay,
      resolveDay,
      advanceNextNight,
      actorAtNextNight,
      targetAfterReload,
      apiTargetAfterReload,
      proof:
        "A disposable seeded N01 game opened Vanillizer, Cop target, and host role URLs; the Vanillizer selected the Cop through the browser target picker, confirmed vanillaize through /commands, and the host resolved and advanced through D02 into N02. The target role URL changed from Cop to Vanilla townie, lost its investigate action, and reloaded durably while the Vanillizer retained its own action.",
    };
    assertVanillizerRoleActionBrowserProof({
      proof,
      expectedGame: vanillizerGame,
      includeEvidenceInError: true,
    });
    return proof;
  } finally {
    await Promise.all(
      Object.values(entries).map((entry) => entry.context.close().catch(() => {})),
    );
  }
}

async function seedVanillizerRoleActionGame(game) {
  const plan = vanillizerSeedCommandPlan(game);
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game,
    commands: commands.length,
    phaseId: vanillizerRoleActionScenario().phaseId,
  };
}

async function playerRoleCardSnapshot(page) {
  const root = page.getByTestId("player-role-card");
  await root.waitFor({ state: "visible" });
  return {
    roleKey: await root.getAttribute("data-role-key"),
    alignment: await root.getAttribute("data-role-alignment"),
    state: await root.getAttribute("data-role-state"),
    name: await page.getByTestId("player-role-card-name").innerText(),
    description: await page.getByTestId("player-role-card-description").innerText(),
    status: await page.getByTestId("player-role-card-status").innerText(),
  };
}

async function verifySeededActionLoop({
  browser,
  hostPage,
  playerPage,
  actionPage,
  targetPage,
  concurrentActionPage,
  privateChannelActionPage,
  privateChannelStaleActionPage,
  staleActionRetryPage,
  staleSameActionPage,
  staleActionPage,
  staleDeadActionPage,
  staleHostPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
  const resolveDay = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D01", locked: true });
  await actionPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  const d01LockedActionSurface = {
    roleUrl: actionPage.url(),
    commandState: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    buttons: await playerCommandButtons(actionPage),
  };
  const staleDeadlineAdvanceSetup = await freezeStaleDeadlineAdvancePage({
    staleHostPage,
    game,
    frontendBaseUrl,
  });
  const deadlineAdvance = await verifyHostDeadlineAdvance({
    hostPage,
    game,
    apiBaseUrl,
  });
  const advanceNight = deadlineAdvance.advance;
  const staleDeadlineAdvance = await submitStaleDeadlineAdvanceRecovery({
    staleHostPage,
    staleDeadlineAdvanceSetup,
    apiBaseUrl,
    game,
  });
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false });

  await actionPage.locator('[data-action="submit_invalid_action:factional_kill"]').waitFor({
    state: "visible",
  });
  const n01Phase = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const n01ActionSurface = {
    roleUrl: actionPage.url(),
    commandState: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    buttons: await playerCommandButtons(actionPage),
  };
  const playerActionBoundary = await verifySeededPlayerActionBoundary({
    playerPage,
    game,
  });
  const dayNightTransition = {
    status: "passed",
    hostRoleUrl: hostPage.url(),
    actionRoleUrl: n01ActionSurface.roleUrl,
    normalPlayerRoleUrl: playerActionBoundary.roleUrl,
    resolveDayState: resolveDay.commandStatus?.state ?? null,
    advanceNightState: advanceNight.commandStatus?.state ?? null,
    dayLockedActionSurface: d01LockedActionSurface,
    nightActionSurface: n01ActionSurface,
    normalPlayerNightSurface: {
      roleUrl: playerActionBoundary.roleUrl,
      phase: playerActionBoundary.phase,
      commandActions: playerActionBoundary.commandActions,
      buttons: playerActionBoundary.commandButtons,
      factionalKillVisible: playerActionBoundary.factionalKillVisible,
      directRejectError:
        playerActionBoundary.directFactionalKill?.serverEnvelope?.body?.body?.error ??
        null,
    },
  };
  if (
    !dayNightTransition.hostRoleUrl.includes(`/g/${game}/host`) ||
    !dayNightTransition.actionRoleUrl.includes(`/g/${game}`) ||
    !dayNightTransition.normalPlayerRoleUrl.includes(`/g/${game}`) ||
    dayNightTransition.resolveDayState !== "ack" ||
    dayNightTransition.advanceNightState !== "ack" ||
    d01LockedActionSurface.commandState?.phase?.phaseId !== "D01" ||
    d01LockedActionSurface.commandState?.phase?.locked !== true ||
    d01LockedActionSurface.buttons.some((button) =>
      String(button.action ?? "").startsWith("submit_action"),
    ) ||
    d01LockedActionSurface.buttons.some((button) =>
      String(button.action ?? "").startsWith("submit_vote"),
    ) ||
    n01ActionSurface.commandState?.phase?.phaseId !== "N01" ||
    n01ActionSurface.commandState?.phase?.locked !== false ||
    n01ActionSurface.commandState?.actions?.some(
      (action) => action.templateId === "factional_kill",
    ) !== true ||
    !n01ActionSurface.buttons.some(
      (button) => button.action === "submit_action:factional_kill" && !button.disabled,
    ) ||
    !n01ActionSurface.buttons.some(
      (button) => button.action === "submit_invalid_action:factional_kill",
    ) ||
    playerActionBoundary.phase?.phaseId !== "N01" ||
    playerActionBoundary.commandActions?.length !== 0 ||
    playerActionBoundary.factionalKillVisible !== false ||
    playerActionBoundary.directFactionalKill?.serverEnvelope?.body?.body?.error !==
      "InvalidTarget"
  ) {
    throw new Error(
      `day/night transition role surface drifted: ${JSON.stringify({
        dayNightTransition,
      })}`,
    );
  }
  const concurrentActionSetup = await freezeStaleActionPage({
    staleActionPage: concurrentActionPage,
    game,
  });
  const actionRetrySetup = await freezeStaleActionPage({
    staleActionPage: staleActionRetryPage,
    game,
  });
  const staleSameActionSetup = await freezeStaleActionPage({
    staleActionPage: staleSameActionPage,
    game,
  });
  const staleActionSetup = await freezeStaleActionPage({ staleActionPage, game });
  const privateChannelStaleActionSetup =
    await freezeStalePrivateChannelActionPage({
      page: privateChannelStaleActionPage,
      game,
      frontendBaseUrl,
    });
  const staleDeadActionSetup = await freezeStaleActionPage({
    staleActionPage: staleDeadActionPage,
    game,
  });
  const staleDeadActionConflict = await submitStaleDeadActionConflict({
    hostPage,
    actionPage,
    staleDeadActionPage,
    staleDeadActionSetup,
    game,
    apiBaseUrl,
  });
  const privateChannelInvalidActionRecovery =
    await verifyPrivateChannelInvalidActionRecovery({
      page: privateChannelActionPage,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
  const invalidActionRecovery = await verifySeededInvalidActionRecovery({
    actionPage,
  });
  const invalidAction = invalidActionRecovery.reject;

  let concurrentActionRace = await submitConcurrentActionRace({
    actionPage,
    concurrentActionPage,
    concurrentActionSetup,
    apiBaseUrl,
    game,
  });
  const legalAction = concurrentActionRace.ack;
  const submittedCommand = legalAction.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (submittedCommand?.template_id !== "factional_kill") {
    throw new Error(`expected factional_kill SubmitAction: ${JSON.stringify(submittedCommand)}`);
  }
  const targetSlot = submittedCommand.targets?.[0];
  if (typeof targetSlot !== "string" || targetSlot === "slot_4") {
    throw new Error(`expected non-self factional kill target: ${JSON.stringify(submittedCommand)}`);
  }
  await actionPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const actionIdempotentRetry = await submitActionIdempotentRetry({
    staleActionRetryPage,
    actionRetrySetup,
    legalAction,
    apiBaseUrl,
    game,
  });
  const staleSameActionRecovery = await submitStaleSameActionRecovery({
    staleSameActionPage,
    staleSameActionSetup,
    legalAction,
    apiBaseUrl,
    game,
  });

  const resolveNight = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: true });
  const targetState = await fetchResolvedSlotState({ apiBaseUrl, game, slot: targetSlot });
  if (targetState?.alive !== false || targetState?.status !== "dead") {
    throw new Error(`resolved action did not kill ${targetSlot}: ${JSON.stringify(targetState)}`);
  }
  const concurrentActionRaceReload = await verifyConcurrentActionRaceReload({
    actionPage,
    hostPage,
    game,
    apiBaseUrl,
    targetSlot,
  });
  concurrentActionRace = {
    ...concurrentActionRace,
    resolvedTargetSlot: targetState,
    roleReloadAfterRace: concurrentActionRaceReload,
  };
  const staleHostControlSetup = await freezeStaleHostControlPage({
    staleHostPage,
    game,
    frontendBaseUrl,
  });
  const advanceDay = await confirmHostAction(hostPage, "advance_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  await actionPage.waitForFunction(() =>
    document
      .querySelector('[data-testid="player-votecount-deadline"]')
      ?.innerText.includes("Day 2"),
  );
  const d02PhaseText = await actionPage.getByTestId("player-votecount-deadline").innerText();
  const d02Phase = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const resolutionReceipts = await verifySeededResolutionReceipts({
    playerPage,
    actionPage,
    targetPage,
    game,
    apiBaseUrl,
    resolvedTargetSlot: targetState,
    legalAction,
  });
  const d02ActionSurface = {
    roleUrl: actionPage.url(),
    commandState: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    buttons: await playerCommandButtons(actionPage),
  };
  const d02NormalPlayerSurface = {
    roleUrl: playerPage.url(),
    commandState: await playerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    buttons: await playerCommandButtons(playerPage),
  };
  const nightResolutionTransition = {
    status: "passed",
    hostRoleUrl: hostPage.url(),
    actionRoleUrl: d02ActionSurface.roleUrl,
    targetRoleUrl: targetPage.url(),
    normalPlayerRoleUrl: d02NormalPlayerSurface.roleUrl,
    legalActionState: legalAction.state,
    legalActionTemplateId: submittedCommand.template_id,
    legalActionTarget: targetSlot,
    resolveNightState: resolveNight.commandStatus?.state ?? null,
    resolvedTargetSlot: targetState,
    targetReceiptSurface: {
      roleUrl: targetPage.url(),
      targetSlot: resolutionReceipts.targetSlot,
      targetNotice: resolutionReceipts.targetNotice,
      targetPrivateQueueItem: resolutionReceipts.targetPrivateQueueItem,
      targetCommandState: resolutionReceipts.targetCommandState,
    },
    advanceDayState: advanceDay.commandStatus?.state ?? null,
    d02ActionSurface,
    d02NormalPlayerSurface,
  };
  if (
    !nightResolutionTransition.hostRoleUrl.includes(`/g/${game}/host`) ||
    !nightResolutionTransition.actionRoleUrl.includes(`/g/${game}`) ||
    !nightResolutionTransition.targetRoleUrl.includes(`/g/${game}`) ||
    !nightResolutionTransition.normalPlayerRoleUrl.includes(`/g/${game}`) ||
    nightResolutionTransition.legalActionState !== "ack" ||
    nightResolutionTransition.legalActionTemplateId !== "factional_kill" ||
    nightResolutionTransition.legalActionTarget !== targetSlot ||
    nightResolutionTransition.resolveNightState !== "ack" ||
    nightResolutionTransition.resolvedTargetSlot?.alive !== false ||
    nightResolutionTransition.resolvedTargetSlot?.status !== "dead" ||
    nightResolutionTransition.targetReceiptSurface.targetNotice?.audience_slot !==
      targetSlot ||
    nightResolutionTransition.targetReceiptSurface.targetNotice?.effect !==
      "player_killed" ||
    nightResolutionTransition.targetReceiptSurface.targetNotice?.status !==
      "factional_kill" ||
    nightResolutionTransition.targetReceiptSurface.targetPrivateQueueItem?.effect !==
      "player_killed" ||
    nightResolutionTransition.targetReceiptSurface.targetCommandState?.actorSlot !==
      targetSlot ||
    nightResolutionTransition.targetReceiptSurface.targetCommandState?.actorAlive !==
      false ||
    nightResolutionTransition.targetReceiptSurface.targetCommandState?.phase?.phaseId !==
      "D02" ||
    nightResolutionTransition.targetReceiptSurface.targetCommandState?.actions?.length !==
      0 ||
    nightResolutionTransition.advanceDayState !== "ack" ||
    d02ActionSurface.commandState?.phase?.phaseId !== "D02" ||
    d02ActionSurface.commandState?.phase?.locked !== false ||
    d02ActionSurface.commandState?.actions?.length !== 0 ||
    d02ActionSurface.buttons.some((button) =>
      String(button.action ?? "").startsWith("submit_action"),
    ) ||
    !d02ActionSurface.buttons.some((button) =>
      String(button.action ?? "").startsWith("submit_vote"),
    ) ||
    d02NormalPlayerSurface.commandState?.phase?.phaseId !== "D02" ||
    d02NormalPlayerSurface.commandState?.phase?.locked !== false ||
    d02NormalPlayerSurface.commandState?.actions?.length !== 0 ||
    !d02NormalPlayerSurface.buttons.some((button) =>
      String(button.action ?? "").startsWith("submit_vote"),
    )
  ) {
    throw new Error(
      `night resolution transition role surface drifted: ${JSON.stringify({
        nightResolutionTransition,
      })}`,
    );
  }
  const deadPlayerRecovery = await verifySeededDeadPlayerRecovery({
    targetPage,
    game,
    targetSlot,
  });
  const staleActionConflict = await submitStaleActionConflict({
    staleActionPage,
    staleActionSetup,
    apiBaseUrl,
    game,
  });
  const privateChannelStaleActionReconnectRecovery =
    await submitPrivateChannelStaleActionReconnectRecovery({
      page: privateChannelStaleActionPage,
      setup: privateChannelStaleActionSetup,
      apiBaseUrl,
      game,
    });
  const d02VoteNightTransition = await verifySeededD02VoteNightTransition({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
  });

  return {
    status: "passed",
    resolveDay,
    advanceNight,
    dayNightTransition,
    nightResolutionTransition,
    n01Phase,
    invalidAction,
    invalidActionRecovery,
    privateChannelInvalidActionRecovery,
    legalAction,
    playerActionBoundary,
    deadlineAdvance,
    staleDeadlineAdvance,
    concurrentActionRace,
    actionIdempotentRetry,
    staleSameActionRecovery,
    resolutionReceipts,
    deadPlayerRecovery,
    resolveNight,
    resolvedTargetSlot: targetState,
    advanceDay,
    d02Phase,
    d02PhaseText,
    staleDeadActionConflict,
    staleActionConflict,
    privateChannelStaleActionReconnectRecovery,
    d02VoteNightTransition,
    staleHostControlSetup,
    proof:
      "The seeded host role URL resolved D01 and advanced to N01 through deadline-expiry evidence while a stale host deadline control rejected with current-phase recovery, the action-player role URL rendered factional_kill, a frozen stale action page recovered after Slot 4 was temporarily marked dead, a private-channel action-player role URL recovered from an invalid self-action without losing channel context, the live action-player recovered from an invalid self-action, two action-player pages raced factional_kill with one ACK and one ActionAlreadySubmitted recovery, a frozen action retry page replayed the winning command_id and got the original ACK, a frozen same-action page rejected with ActionAlreadySubmitted recovery, then the host role URL resolved N01 and advanced the same game to D02 while the target role URL received the private kill receipt, day vote controls returned for living role URLs, a stale action-player page recovered a frozen N01 action through a PhaseLocked refresh, and a disposable D02 role proof submitted the deciding day vote, resolved that vote, advanced to N02, and restored the living mafia-goon night action surface.",
  };
}

async function verifySeededD02VoteNightTransition({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const transitionGame = crypto.randomUUID();
  const seed = await seedD02VoteNightTransitionGame({ game: transitionGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${transitionGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const actionSession = await createAccountLoginCredential({
    principalUserId: "player-goon-a",
    returnTo: `/g/${transitionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const playerSession = await createAccountLoginCredential({
    principalUserId: "player-mira",
    returnTo: `/g/${transitionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const targetSession = await createAccountLoginCredential({
    principalUserId: "player-target",
    returnTo: `/g/${transitionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: transitionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const actionEntry = await openVerifiedRoleEntry({
    browser,
    session: actionSession,
    game: transitionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: playerSession,
    game: transitionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const targetEntry = await openVerifiedRoleEntry({
    browser,
    session: targetSession,
    game: transitionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, { phaseId: "D02", locked: false }),
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const hostBeforeVote = {
      roleUrl: hostEntry.page.url(),
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      votecount: await hostEntry.page.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
    };
    const actionBeforeVote = {
      roleUrl: actionEntry.page.url(),
      commandState: await actionEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      currentVote: await playerCurrentVoteSnapshot(actionEntry.page),
      buttons: await playerCommandButtons(actionEntry.page),
    };
    const voteTarget = actionBeforeVote.commandState?.voteTargets?.find(
      (target) => target.kind === "slot" && target.slotId === "slot-2",
    );
    const voteButton = actionBeforeVote.buttons.find(
      (button) =>
        button.action === "submit_vote" &&
        voteTarget?.label !== undefined &&
        button.text?.includes(voteTarget.label) &&
        button.disabled === false,
    );
    if (
      hostBeforeVote.phase?.id !== "D02" ||
      hostBeforeVote.phase?.locked !== false ||
      !hostBeforeVote.phaseActions.includes("resolve_phase") ||
      !hostBeforeVote.phaseActions.includes("lock_thread") ||
      voteTarget?.slotId !== "slot-2" ||
      voteButton === undefined ||
      actionBeforeVote.commandState?.currentVote !== null ||
      actionBeforeVote.currentVote.hasVote !== "false"
    ) {
      throw new Error(
        `D02 vote setup drifted: ${JSON.stringify({
          seed,
          hostBeforeVote,
          actionBeforeVote,
          voteTarget,
          voteButton,
        })}`,
      );
    }

    const staleD02VoteTransitionPage = await actionEntry.context.newPage();
    const staleD02VoteTransitionSetup =
      await freezeStaleD02VoteTransitionPage({
        page: staleD02VoteTransitionPage,
        game: transitionGame,
        voteTarget,
      });

    await actionEntry.page
      .locator('[data-action="submit_vote"]', { hasText: voteTarget.label })
      .first()
      .click();
    await actionEntry.page.waitForFunction(
      (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target?.Slot === targetSlot &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          targetSlot &&
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === targetSlot && row.count === 3,
        ),
      voteTarget.slotId,
    );
    const finalVote = await actionEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const actionAfterVote = {
      commandState: await actionEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      currentVote: await playerCurrentVoteSnapshot(actionEntry.page),
      votecount: await actionEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.votecount ?? [],
      ),
    };
    const apiVotecountAfterVote = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/votecount`,
    );
    const apiVoteRow = normalizedVotecountRows(apiVotecountAfterVote).find(
      (row) => row.phaseId === "D02" && row.target === voteTarget.slotId,
    );
    if (
      finalVote?.state !== "ack" ||
      finalVote?.requestEnvelope?.body?.body?.principal_user_id !== "player-goon-a" ||
      finalVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !==
        "slot_4" ||
      finalVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
        voteTarget.slotId ||
      actionAfterVote.commandState?.currentVote?.slotId !== voteTarget.slotId ||
      actionAfterVote.currentVote.hasVote !== "true" ||
      !actionAfterVote.currentVote.text.includes(voteTarget.label) ||
      !actionAfterVote.votecount.some(
        (row) => row.target === voteTarget.slotId && row.count === 3,
      ) ||
      apiVoteRow?.count !== 3
    ) {
      throw new Error(
        `D02 final vote drifted: ${JSON.stringify({
          finalVote,
          actionAfterVote,
          apiVoteRow,
        })}`,
      );
    }

    const resolveD02 = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "D02", locked: true });
    await hostEntry.page.waitForFunction(
      (targetSlot) =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D02" &&
            row.status === "Lynch" &&
            row.winnerSlot === targetSlot,
        ),
      voteTarget.slotId,
    );
    const hostAfterResolve = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      dayVoteOutcomes: await hostEntry.page.evaluate(
        () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
      ),
      outcomePanel: await hostEntry.page
        .locator('[data-testid="host-day-vote-outcome-latest"]')
        .innerText(),
    };
    const apiDayVoteOutcomes = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`,
    );
    const dayVoteOutcome = normalizeDayVoteOutcomeRows(apiDayVoteOutcomes).find(
      (row) => row.phaseId === "D02" && row.winnerSlot === voteTarget.slotId,
    );
    const hostSlotAfterResolve = await fetchResolvedSlotState({
      apiBaseUrl,
      game: transitionGame,
      slot: voteTarget.slotId,
    });

    await gotoPlayerBoard(targetEntry.page, transitionGame);
    await targetEntry.page.waitForFunction(
      (targetSlot) =>
        window.__fmarchPlayerProjection?.notifications?.some(
          (notice) =>
            notice.audience_slot === targetSlot &&
            notice.effect === "player_killed" &&
            notice.status === "day_vote",
        ) &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false,
      voteTarget.slotId,
    );
    const targetReceiptSurface = {
      roleUrl: targetEntry.page.url(),
      targetNotice: await targetEntry.page.evaluate(
        (targetSlot) =>
          window.__fmarchPlayerProjection?.notifications?.find(
            (notice) =>
              notice.audience_slot === targetSlot &&
              notice.effect === "player_killed" &&
              notice.status === "day_vote",
          ) ?? null,
        voteTarget.slotId,
      ),
      targetCommandState: await targetEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      outcomePanel: await targetEntry.page
        .locator('[data-testid="player-day-vote-outcome-latest"]')
        .innerText(),
    };

    const advanceN02 = await confirmHostAction(hostEntry.page, "advance_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "N02", locked: false });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          window.__fmarchPlayerProjection?.commandState?.actions?.some(
            (action) => action.templateId === "factional_kill",
          ),
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const n02HostSurface = {
      roleUrl: hostEntry.page.url(),
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      deadlineActions: await visibleHostControlActions(hostEntry.page, "deadline"),
    };
    const n02ActionSurface = {
      roleUrl: actionEntry.page.url(),
      commandState: await actionEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      buttons: await playerCommandButtons(actionEntry.page),
    };
    const n02NormalPlayerSurface = {
      roleUrl: playerEntry.page.url(),
      commandState: await playerEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      buttons: await playerCommandButtons(playerEntry.page),
      factionalKillVisible: await playerEntry.page
        .locator('[data-action="submit_action:factional_kill"]')
        .isVisible()
        .catch(() => false),
    };
    const staleD02VoteAfterTransition =
      await submitStaleD02VoteAfterTransition({
        page: staleD02VoteTransitionPage,
        voteTarget,
      });
    const staleD02VoteTransitionScenario = {
      ...staleDayTwoVoteAfterTransitionRecoveryScenario(),
      actorSlot: "slot_4",
    };
    assertLiveStaleD02VoteTransitionRecovery({
      setup: staleD02VoteTransitionSetup,
      recovery: staleD02VoteAfterTransition,
      expectedGame: transitionGame,
      scenario: staleD02VoteTransitionScenario,
      includeEvidenceInError: true,
    });

    if (
      resolveD02.commandStatus?.state !== "ack" ||
      hostAfterResolve.phase?.id !== "D02" ||
      hostAfterResolve.phase?.locked !== true ||
      !hostAfterResolve.phaseActions.includes("advance_phase") ||
      !hostAfterResolve.dayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D02" &&
          row.status === "Lynch" &&
          row.winnerSlot === voteTarget.slotId,
      ) ||
      dayVoteOutcome?.status !== "Lynch" ||
      dayVoteOutcome?.winnerSlot !== voteTarget.slotId ||
      dayVoteOutcome?.tallies?.[voteTarget.slotId] !== 3 ||
      hostSlotAfterResolve?.alive !== false ||
      hostSlotAfterResolve?.status !== "dead" ||
      targetReceiptSurface.targetNotice?.audience_slot !== voteTarget.slotId ||
      targetReceiptSurface.targetNotice?.effect !== "player_killed" ||
      targetReceiptSurface.targetNotice?.status !== "day_vote" ||
      targetReceiptSurface.targetCommandState?.actorSlot !== voteTarget.slotId ||
      targetReceiptSurface.targetCommandState?.actorAlive !== false ||
      targetReceiptSurface.targetCommandState?.actorStatus !== "dead" ||
      targetReceiptSurface.targetCommandState?.phase?.phaseId !== "D02" ||
      advanceN02.commandStatus?.state !== "ack" ||
      n02HostSurface.phase?.id !== "N02" ||
      n02HostSurface.phase?.locked !== false ||
      !n02HostSurface.phaseActions.includes("resolve_phase") ||
      !n02HostSurface.phaseActions.includes("lock_thread") ||
      n02ActionSurface.commandState?.actorSlot !== "slot_4" ||
      n02ActionSurface.commandState?.actorAlive !== true ||
      n02ActionSurface.commandState?.phase?.phaseId !== "N02" ||
      n02ActionSurface.commandState?.phase?.locked !== false ||
      n02ActionSurface.commandState?.actions?.some(
        (action) => action.templateId === "factional_kill",
      ) !== true ||
      !n02ActionSurface.buttons.some(
        (button) =>
          button.action === "submit_action:factional_kill" && button.disabled === false,
      ) ||
      n02NormalPlayerSurface.commandState?.actorSlot !== "slot-7" ||
      n02NormalPlayerSurface.commandState?.phase?.phaseId !== "N02" ||
      n02NormalPlayerSurface.factionalKillVisible !== false
    ) {
      throw new Error(
        `D02 vote/night transition drifted: ${JSON.stringify({
          transitionGame,
          hostAfterResolve,
          dayVoteOutcome,
          hostSlotAfterResolve,
          targetReceiptSurface,
          advanceN02,
          n02HostSurface,
          n02ActionSurface,
          n02NormalPlayerSurface,
          staleD02VoteTransitionSetup,
          staleD02VoteAfterTransition,
        })}`,
      );
    }

    const n02ActionTarget =
      n02ActionSurface.commandState?.actions?.find(
        (action) => action.templateId === "factional_kill",
      )?.targets?.[0] ?? null;
    if (typeof n02ActionTarget !== "string" || n02ActionTarget === "") {
      throw new Error(
        `N02 action target missing: ${JSON.stringify(n02ActionSurface.commandState)}`,
      );
    }
    const n02ActionSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: "submit_action:factional_kill",
      confirmTestId: "player-action-confirm-factional_kill",
      waitArg: n02ActionTarget,
      waitFor: (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === "factional_kill" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.targets?.includes(targetSlot) &&
        document.querySelector('[data-action="submit_action:factional_kill"]') ===
          null,
    });
    // C5: exercise the night-action withdraw round-trip. The submitted
    // factional_kill now surfaces a withdraw affordance; withdrawing it restores
    // the submit action, and re-submitting the same target leaves N02 in the state
    // the downstream host resolution expects (the projected target is still killed).
    const n02WithdrawSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: "withdraw_action:factional_kill",
      confirmTestId: "player-action-withdraw-confirm-factional_kill",
      waitFor: () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.WithdrawAction?.actor_slot === "slot_4" &&
        document.querySelector('[data-action="withdraw_action:factional_kill"]') ===
          null &&
        document.querySelector('[data-action="submit_action:factional_kill"]') !==
          null,
    });
    const n02ActionAfterWithdraw = await playerProjectionSnapshot(actionEntry.page, {
      buttons: true,
      currentReceipt: true,
    });
    const n02ResubmitSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: "submit_action:factional_kill",
      confirmTestId: "player-action-confirm-factional_kill",
      waitArg: n02ActionTarget,
      waitFor: (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === "factional_kill" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.targets?.includes(targetSlot) &&
        document.querySelector('[data-action="submit_action:factional_kill"]') ===
          null,
    });
    const n02ActionAfterSubmit = await playerProjectionSnapshot(actionEntry.page, {
      buttons: true,
      currentReceipt: true,
      receiptStatusText: true,
    });

    const resolveN02 = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "N02", locked: true });
    const n02ResolvedTargetSlot = await fetchResolvedSlotState({
      apiBaseUrl,
      game: transitionGame,
      slot: n02ActionTarget,
    });
    const hostAfterResolveN02 = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      slots: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.slots ?? []),
    };

    const advanceD03 = await confirmHostAction(hostEntry.page, "advance_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "D03", locked: false });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const d03HostSurface = {
      roleUrl: hostEntry.page.url(),
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
      votecount: await hostEntry.page.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
    };
    const d03ActionSurface = {
      roleUrl: actionEntry.page.url(),
      commandState: await actionEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      buttons: await playerCommandButtons(actionEntry.page),
    };
    const d03NormalPlayerSurface = {
      roleUrl: playerEntry.page.url(),
      commandState: await playerEntry.page.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
      buttons: await playerCommandButtons(playerEntry.page),
    };

    if (
      n02ActionSubmission?.state !== "ack" ||
      n02ActionSubmission?.requestEnvelope?.body?.body?.principal_user_id !==
        "player-goon-a" ||
      n02ActionSubmission?.requestEnvelope?.body?.body?.command?.SubmitAction
        ?.actor_slot !== "slot_4" ||
      n02ActionSubmission?.requestEnvelope?.body?.body?.command?.SubmitAction
        ?.template_id !== "factional_kill" ||
      n02ActionSubmission?.requestEnvelope?.body?.body?.command?.SubmitAction
        ?.targets?.[0] !== n02ActionTarget ||
      n02WithdrawSubmission?.state !== "ack" ||
      n02WithdrawSubmission?.requestEnvelope?.body?.body?.command?.WithdrawAction
        ?.actor_slot !== "slot_4" ||
      n02ActionAfterWithdraw.buttons.some(
        (button) => button.action === "withdraw_action:factional_kill",
      ) ||
      !n02ActionAfterWithdraw.buttons.some(
        (button) => button.action === "submit_action:factional_kill",
      ) ||
      n02ResubmitSubmission?.state !== "ack" ||
      n02ResubmitSubmission?.requestEnvelope?.body?.body?.command?.SubmitAction
        ?.template_id !== "factional_kill" ||
      n02ResubmitSubmission?.requestEnvelope?.body?.body?.command?.SubmitAction
        ?.targets?.[0] !== n02ActionTarget ||
      n02ActionAfterSubmit.commandState?.phase?.phaseId !== "N02" ||
      n02ActionAfterSubmit.buttons.some(
        (button) => button.action === "submit_action:factional_kill",
      ) ||
      !n02ActionAfterSubmit.receiptStatusText.includes("Ack") ||
      resolveN02.commandStatus?.state !== "ack" ||
      hostAfterResolveN02.phase?.id !== "N02" ||
      hostAfterResolveN02.phase?.locked !== true ||
      !hostAfterResolveN02.phaseActions.includes("advance_phase") ||
      n02ResolvedTargetSlot?.slot_id !== n02ActionTarget ||
      n02ResolvedTargetSlot?.alive !== false ||
      n02ResolvedTargetSlot?.status !== "dead" ||
      advanceD03.commandStatus?.state !== "ack" ||
      d03HostSurface.phase?.id !== "D03" ||
      d03HostSurface.phase?.locked !== false ||
      !d03HostSurface.phaseActions.includes("resolve_phase") ||
      d03ActionSurface.commandState?.phase?.phaseId !== "D03" ||
      d03ActionSurface.commandState?.phase?.locked !== false ||
      d03ActionSurface.commandState?.actions?.length !== 0 ||
      !d03ActionSurface.buttons.some((button) =>
        String(button.action ?? "").startsWith("submit_vote"),
      ) ||
      d03NormalPlayerSurface.commandState?.phase?.phaseId !== "D03" ||
      d03NormalPlayerSurface.commandState?.phase?.locked !== false ||
      d03NormalPlayerSurface.commandState?.actions?.length !== 0 ||
      !d03NormalPlayerSurface.buttons.some((button) =>
        String(button.action ?? "").startsWith("submit_vote"),
      )
    ) {
      throw new Error(
        `N02 action/D03 transition drifted: ${JSON.stringify({
          transitionGame,
          n02ActionTarget,
          n02ActionSubmission,
          n02ActionAfterSubmit,
          resolveN02,
          hostAfterResolveN02,
          n02ResolvedTargetSlot,
          advanceD03,
          d03HostSurface,
          d03ActionSurface,
          d03NormalPlayerSurface,
        })}`,
      );
    }

    const d03TerminalVoteTarget =
      d03NormalPlayerSurface.commandState?.voteTargets?.find(
        (target) =>
          target.kind === "slot" &&
          String(target.label ?? "").toLowerCase().includes("slot 4"),
      ) ??
      d03NormalPlayerSurface.commandState?.voteTargets?.find(
        (target) => target.kind === "slot",
      );
    const d03TerminalVoteButton = d03NormalPlayerSurface.buttons.find(
      (button) =>
        button.action === "submit_vote" &&
        d03TerminalVoteTarget?.label !== undefined &&
        button.text?.includes(d03TerminalVoteTarget.label) &&
        button.disabled === false,
    );
    if (
      d03NormalPlayerSurface.commandState?.actorSlot !== "slot-7" ||
      d03TerminalVoteTarget?.kind !== "slot" ||
      typeof d03TerminalVoteTarget?.slotId !== "string" ||
      d03TerminalVoteButton === undefined
    ) {
      throw new Error(
        `D03 terminal vote setup drifted: ${JSON.stringify({
          d03NormalPlayerSurface,
          d03TerminalVoteTarget,
          d03TerminalVoteButton,
        })}`,
      );
    }
    const d03TerminalVoteSubmission = await submitPlayerCommandAndWait({
      page: playerEntry.page,
      actionId: "submit_vote",
      locatorOptions: { hasText: d03TerminalVoteTarget.label },
      waitArg: d03TerminalVoteTarget.slotId,
      waitFor: (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target?.Slot === targetSlot &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          targetSlot,
    });
    const d03TerminalPlayerAfterVote = await playerProjectionSnapshot(
      playerEntry.page,
      { currentVote: true, votecount: true },
    );
    const d03TerminalApiVotecountAfterVote = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/votecount`,
    );
    const d03TerminalApiVoteRow = normalizedVotecountRows(
      d03TerminalApiVotecountAfterVote,
    ).find(
      (row) =>
        row.phaseId === "D03" && row.target === d03TerminalVoteTarget.slotId,
    );

    const resolveD03 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "D03",
      locked: true,
    });
    const hostAfterResolveD03 = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
      slots: true,
    });
    const d03TerminalDayVoteOutcomes = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`,
    );
    const d03TerminalDayVoteOutcome = normalizeDayVoteOutcomeRows(
      d03TerminalDayVoteOutcomes,
    ).find((row) => row.phaseId === "D03");
    const d03TerminalResolvedSlot = await fetchResolvedSlotState({
      apiBaseUrl,
      game: transitionGame,
      slot: d03TerminalVoteTarget.slotId,
    });
    const d03RevotePrompt =
      hostAfterResolveD03.hostPrompts.find(
        (prompt) =>
          prompt.id === "D03:revote:NoMajority" &&
          prompt.label === "revote" &&
          prompt.status === "pending",
      ) ?? null;
    const d03RevotePromptActionId =
      d03RevotePrompt === null
        ? null
        : hostPromptPolicyActionId(
            d03RevotePrompt.id,
            "no_majority_continue_revote",
          );

    const d03TerminalAdvanceReject = await confirmHostPhaseAction(
      hostEntry.page,
      "advance_phase",
      { phaseId: "D03", locked: true, expectedState: "reject" },
    );
    const hostAfterTerminalAdvanceReject = await hostProjectionSnapshot(
      hostEntry.page,
      { slots: true },
    );
    const d03TerminalActivityStatusText = await hostEntry.page
      .locator('[data-testid="host-command-activity-status-advance_phase"][data-state="reject"]')
      .first()
      .innerText();
    const d03TerminalActivityRow = await hostEntry.page
      .locator('[data-testid="host-command-activity-advance_phase"][data-source="outcome"]')
      .first()
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      }));
    const d03TerminalDispatchPlan = await hostEntry.page.evaluate(
      () => window.__fmarchHostCommandDispatchBridgePlan,
    );
    const d03TerminalApiHostStateAfterReject = await fetchHostConsoleState({
      apiBaseUrl,
      game: transitionGame,
    });
    const d03TerminalHostReloadResponse = await hostEntry.page.goto(
      `${frontendBaseUrl}/g/${transitionGame}/host`,
      { waitUntil: "networkidle" },
    );
    await hostEntry.page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D03",
      locked: true,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D03" &&
            row.status === "NoMajority" &&
            row.winnerSlot === null,
        ),
      null,
      { timeout: 15000 },
    );
    const d03TerminalHostReloadAfterReject = {
      status: "passed",
      routeResponseStatus: d03TerminalHostReloadResponse?.status() ?? null,
      rejectReceiptStatusText: d03TerminalActivityStatusText,
      ...(await hostProjectionSnapshot(hostEntry.page, {
        surfaceText: true,
        dayVoteOutcomes: true,
        hostPrompts: true,
        promptActions: true,
        outcomePanel: true,
      })),
      apiPhase: d03TerminalApiHostStateAfterReject.phase,
    };
    const terminalScenario = terminalRecoveryBrowserScenario();
    assertTerminalRecoveryBrowserProof({
      proof: {
        d03TerminalVoteTarget,
        d03TerminalVoteSubmission,
        d03TerminalPlayerAfterVote,
        d03TerminalApiVoteRow,
        resolveD03,
        hostAfterResolveD03,
        d03RevotePrompt,
        d03RevotePromptActionId,
        d03TerminalDayVoteOutcome,
        d03TerminalResolvedSlot,
        d03TerminalAdvanceReject,
        hostAfterTerminalAdvanceReject,
        d03TerminalActivityStatusText,
        d03TerminalActivityRow,
        d03TerminalDispatchPlan,
        d03TerminalApiHostStateAfterReject,
        d03TerminalHostReloadAfterReject,
      },
      scenario: terminalScenario,
      includeEvidenceInError: true,
    });
    const d03RevotePromptResolution =
      d03RevotePromptActionId === null
        ? null
        : await confirmHostPhaseAction(hostEntry.page, d03RevotePromptActionId, {
            phaseId: "D03R1",
            locked: false,
          });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
            "D03R1" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
            "D03R1" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const hostAfterD03RevotePrompt = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
    });
    const actionAfterD03RevotePrompt = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, buttons: true },
    );
    const normalAfterD03RevotePrompt = await playerProjectionSnapshot(
      playerEntry.page,
      { roleUrl: true, buttons: true },
    );
    const apiPromptsAfterD03Revote = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/host-prompts?principal_user_id=host_h`,
    );
    const revoteScenario = revoteProgressionBrowserScenario();
    const d03RevoteBallotTarget = revoteNoLynchTargetFromCommandState({
      commandState: actionAfterD03RevotePrompt.commandState,
    });
    const d03RevoteNoLynchButton = actionAfterD03RevotePrompt.buttons.find(
      (button) =>
        button.action === revoteProgressionVoteActionId &&
        button.disabled === false,
    );
    if (d03RevoteBallotTarget?.kind !== "no_lynch" || d03RevoteNoLynchButton === undefined) {
      throw new Error(
        `D03R1 revote no-lynch setup drifted: ${JSON.stringify({
          actionAfterD03RevotePrompt,
          d03RevoteBallotTarget,
          d03RevoteNoLynchButton,
        })}`,
      );
    }
    const d03RevoteVoteSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: revoteProgressionVoteActionId,
      waitFor: () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-goon-a" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.actor_slot === "slot_4" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03R1" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch",
    });
    await waitForPlayerVotecount(actionEntry.page, {
      target: "no_lynch",
      count: 1,
    });
    const d03RevoteActionAfterVote = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, currentVote: true, votecount: true, buttons: true },
    );
    const d03RevoteApiVotecountAfterVote = normalizedVotecountRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/votecount`),
    );
    const d03RevoteApiNoLynchRow = d03RevoteApiVotecountAfterVote.find(
      (row) => row.phaseId === "D03R1" && row.target === "no_lynch",
    );
    const d03RevoteApiOriginalD03Row = d03RevoteApiVotecountAfterVote.find(
      (row) =>
        row.phaseId === "D03" && row.target === d03TerminalVoteTarget.slotId,
    );
    const d03RevoteApiStaleD03NoLynchRow = d03RevoteApiVotecountAfterVote.find(
      (row) => row.phaseId === "D03" && row.target === "no_lynch",
    );
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${transitionGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D03R1",
      locked: false,
    });
    const hostBeforeResolveD03R1 = await hostProjectionSnapshot(hostEntry.page, {
      votecount: true,
    });
    const resolveD03R1 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "D03R1",
      locked: true,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D03R1" &&
            row.status === "NoMajority" &&
            row.winnerSlot === null,
        ),
      null,
      { timeout: 15000 },
    );
    const hostAfterResolveD03R1 = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
      votecount: true,
      outcomePanel: true,
    });
    const d03R1DayVoteOutcomes = normalizeDayVoteOutcomeRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`),
    );
    const d03R1DayVoteOutcome = d03R1DayVoteOutcomes.find(
      (row) => row.phaseId === "D03R1",
    );
    const d03R1RevotePrompt =
      hostAfterResolveD03R1.hostPrompts.find(
        (prompt) =>
          prompt.id === "D03R1:revote:NoMajority" &&
          prompt.label === "revote" &&
          prompt.status === "pending",
      ) ?? null;
    const d03R1RevotePromptActionId =
      d03R1RevotePrompt === null
        ? null
        : hostPromptPolicyActionId(
            d03R1RevotePrompt.id,
            "no_majority_continue_revote",
          );
    const apiPromptsAfterResolveD03R1 = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/host-prompts?principal_user_id=host_h`,
    );
    const d03R1RevotePromptResolution =
      d03R1RevotePromptActionId === null
        ? null
        : await confirmHostPhaseAction(hostEntry.page, d03R1RevotePromptActionId, {
            phaseId: "D03R2",
            locked: false,
          });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
            "D03R2" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId ===
            "D03R2" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const hostAfterD03R1RevotePrompt = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
    });
    const actionAfterD03R1RevotePrompt = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, buttons: true },
    );
    const normalAfterD03R1RevotePrompt = await playerProjectionSnapshot(
      playerEntry.page,
      { roleUrl: true, buttons: true },
    );
    const apiPromptsAfterD03R1Revote = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/host-prompts?principal_user_id=host_h`,
    );
    const d03R2RevoteBallotTarget = revoteNoLynchTargetFromCommandState({
      commandState: actionAfterD03R1RevotePrompt.commandState,
    });
    const d03R2RevoteNoLynchButton =
      actionAfterD03R1RevotePrompt.buttons.find(
        (button) =>
          button.action === revoteProgressionVoteActionId &&
          button.disabled === false,
      );
    if (
      d03R2RevoteBallotTarget?.kind !== "no_lynch" ||
      d03R2RevoteNoLynchButton === undefined
    ) {
      throw new Error(
        `D03R2 revote no-lynch setup drifted: ${JSON.stringify({
          actionAfterD03R1RevotePrompt,
          d03R2RevoteBallotTarget,
          d03R2RevoteNoLynchButton,
        })}`,
      );
    }
    const d03R2RevoteVoteSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: revoteProgressionVoteActionId,
      waitFor: () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-goon-a" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.actor_slot === "slot_4" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D03R2" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch",
    });
    await waitForPlayerVotecount(actionEntry.page, {
      target: "no_lynch",
      count: 1,
    });
    const d03R2RevoteActionAfterVote = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, currentVote: true, votecount: true, buttons: true },
    );
    const d03R2RevoteApiVotecountAfterVote = normalizedVotecountRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/votecount`),
    );
    const d03R2RevoteApiNoLynchRow =
      d03R2RevoteApiVotecountAfterVote.find(
        (row) => row.phaseId === "D03R2" && row.target === "no_lynch",
      );
    const d03R2RevoteApiOriginalD03Row =
      d03R2RevoteApiVotecountAfterVote.find(
        (row) =>
          row.phaseId === "D03" && row.target === d03TerminalVoteTarget.slotId,
      );
    const d03R2RevoteApiD03R1NoLynchRow =
      d03R2RevoteApiVotecountAfterVote.find(
        (row) => row.phaseId === "D03R1" && row.target === "no_lynch",
      );
    const d03R2RevoteApiStaleD03NoLynchRow =
      d03R2RevoteApiVotecountAfterVote.find(
        (row) => row.phaseId === "D03" && row.target === "no_lynch",
      );
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${transitionGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D03R2",
      locked: false,
    });
    const hostBeforeResolveD03R2 = await hostProjectionSnapshot(hostEntry.page, {
      votecount: true,
    });
    const resolveD03R2 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "D03R2",
      locked: true,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D03R2" &&
            row.status === "NoMajority" &&
            row.winnerSlot === null,
        ),
      null,
      { timeout: 15000 },
    );
    const hostAfterResolveD03R2 = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
      votecount: true,
      outcomePanel: true,
    });
    const d03R2DayVoteOutcomes = normalizeDayVoteOutcomeRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`),
    );
    const d03R2DayVoteOutcome = d03R2DayVoteOutcomes.find(
      (row) => row.phaseId === "D03R2",
    );
    const d03R2RevotePrompt =
      hostAfterResolveD03R2.hostPrompts.find(
        (prompt) =>
          prompt.id === "D03R2:revote:NoMajority" &&
          prompt.label === "revote" &&
          prompt.status === "pending",
      ) ?? null;
    const d03R2RevotePromptActionId =
      d03R2RevotePrompt === null
        ? null
        : hostPromptPolicyActionId(d03R2RevotePrompt.id, "no_majority_no_lynch");
    const d03R2StaleContinuePolicyActionId =
      d03R2RevotePrompt === null
        ? null
        : hostPromptPolicyActionId(
            d03R2RevotePrompt.id,
            "no_majority_continue_revote",
          );
    const staleD03R2PolicyRecovery = await prepareStaleHostPromptRecovery({
      context: hostEntry.context,
      frontendBaseUrl,
      promptGame: transitionGame,
      actionId: d03R2StaleContinuePolicyActionId,
      promptId: d03R2RevotePrompt?.id,
    });
    const d03R2StaleContinuePolicySetup =
      staleD03R2PolicyRecovery.setup;
    const apiPromptsAfterResolveD03R2 = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/host-prompts?principal_user_id=host_h`,
    );
    const d03R2NoLynchPolicyResolution =
      d03R2RevotePromptActionId === null
        ? null
        : await confirmHostPhaseAction(hostEntry.page, d03R2RevotePromptActionId, {
            phaseId: "N03",
            locked: false,
          });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N03" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N03" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const hostAfterD03R2NoLynchPolicy = await hostProjectionSnapshot(hostEntry.page, {
      hostPrompts: true,
      promptActions: true,
      dayVoteOutcomes: true,
      outcomePanel: true,
    });
    const actionAfterD03R2NoLynchPolicy = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, buttons: true },
    );
    const normalAfterD03R2NoLynchPolicy = await playerProjectionSnapshot(
      playerEntry.page,
      { roleUrl: true, buttons: true },
    );
    const apiPromptsAfterD03R2NoLynchPolicy = await fetchJson(
      `${apiBaseUrl}/games/${transitionGame}/host-prompts?principal_user_id=host_h`,
    );
    const d03R2StaleContinuePolicyRecovery =
      await staleD03R2PolicyRecovery.submit({
        liveResolve: d03R2NoLynchPolicyResolution,
        apiBaseUrl,
        expectedReloadPhase: {
          id: "N03",
          locked: false,
          requiredPhaseActions: ["resolve_phase"],
        },
      });

    assertRevoteProgressionBrowserProof({
      proof: {
        d03RevotePrompt,
        d03RevotePromptActionId,
        d03RevotePromptResolution,
        hostAfterD03RevotePrompt,
        actionAfterD03RevotePrompt,
        normalAfterD03RevotePrompt,
        apiPromptsAfterD03Revote,
        d03RevoteVoteSubmission,
        d03RevoteActionAfterVote,
        d03RevoteApiNoLynchRow,
        d03RevoteApiOriginalD03Row,
        d03RevoteApiStaleD03NoLynchRow,
        hostBeforeResolveD03R1,
        resolveD03R1,
        hostAfterResolveD03R1,
        d03R1DayVoteOutcome,
        d03R1RevotePrompt,
        d03R1RevotePromptActionId,
        apiPromptsAfterResolveD03R1,
        d03R1RevotePromptResolution,
        hostAfterD03R1RevotePrompt,
        actionAfterD03R1RevotePrompt,
        normalAfterD03R1RevotePrompt,
        apiPromptsAfterD03R1Revote,
        d03R2RevoteVoteSubmission,
        d03R2RevoteActionAfterVote,
        d03R2RevoteApiNoLynchRow,
        d03R2RevoteApiOriginalD03Row,
        d03R2RevoteApiD03R1NoLynchRow,
        d03R2RevoteApiStaleD03NoLynchRow,
        hostBeforeResolveD03R2,
        resolveD03R2,
        hostAfterResolveD03R2,
        d03R2DayVoteOutcome,
        d03R2RevotePrompt,
        d03R2RevotePromptActionId,
        d03R2StaleContinuePolicyActionId,
        apiPromptsAfterResolveD03R2,
        d03R2NoLynchPolicyResolution,
        hostAfterD03R2NoLynchPolicy,
        actionAfterD03R2NoLynchPolicy,
        normalAfterD03R2NoLynchPolicy,
        apiPromptsAfterD03R2NoLynchPolicy,
        d03R2StaleContinuePolicySetup,
        d03R2StaleContinuePolicyRecovery,
      },
      scenario: revoteScenario,
      includeEvidenceInError: true,
    });

    const n03Scenario = nightThreeProgressionBrowserScenario();
    const n03ActionTarget = nightThreeActionTargetFromCommandState({
      commandState: actionAfterD03R2NoLynchPolicy.commandState,
      scenario: n03Scenario,
    });
    if (typeof n03ActionTarget !== "string" || n03ActionTarget === "") {
      throw new Error(
        `N03 action target missing: ${JSON.stringify(
          actionAfterD03R2NoLynchPolicy.commandState,
        )}`,
      );
    }
    const n03ActionSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: nightThreeProgressionActionId,
      confirmTestId: "player-action-confirm-factional_kill",
      waitArg: { scenario: n03Scenario, targetSlot: n03ActionTarget },
      waitFor: ({ scenario, targetSlot }) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === scenario.expectedPrincipalUserId &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.actor_slot === scenario.expectedActorSlot &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.template_id === scenario.templateId &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.targets?.includes(targetSlot) &&
        document.querySelector(`[data-action="${scenario.actionId}"]`) === null,
    });
    const n03ActionAfterSubmit = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
      currentReceipt: true,
      receiptStatusText: true,
    });
    const hostBeforeResolveN03 = await hostProjectionSnapshot(hostEntry.page);
    const resolveN03 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "N03",
      locked: true,
    });
    const n03ResolvedTargetSlot = await fetchResolvedSlotState({
      apiBaseUrl,
      game: transitionGame,
      slot: n03ActionTarget,
    });
    const hostAfterResolveN03 = await hostProjectionSnapshot(hostEntry.page, {
      slots: true,
    });
    const advanceD04 = await confirmHostPhaseAction(hostEntry.page, "advance_phase", {
      phaseId: "D04",
      locked: false,
    });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D04" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D04" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const d04HostSurface = await hostProjectionSnapshot(hostEntry.page, {
      roleUrl: true,
      slots: true,
      dayVoteOutcomes: true,
    });
    const d04ActionSurface = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
    });
    const d04TargetSurface = await playerProjectionSnapshot(playerEntry.page, {
      roleUrl: true,
      buttons: true,
      notifications: true,
    });

    assertNightThreeProgressionBrowserProof({
      proof: {
        n03ActionTarget,
        n03ActionSubmission,
        n03ActionAfterSubmit,
        hostBeforeResolveN03,
        resolveN03,
        hostAfterResolveN03,
        n03ResolvedTargetSlot,
        advanceD04,
        d04HostSurface,
        d04ActionSurface,
        d04TargetSurface,
      },
      scenario: n03Scenario,
      includeEvidenceInError: true,
    });

    const d04NoLynchTarget = revoteNoLynchTargetFromCommandState({
      commandState: d04ActionSurface.commandState,
    });
    const d04NoLynchButton = d04ActionSurface.buttons.find(
      (button) =>
        button.action === revoteProgressionVoteActionId &&
        button.disabled === false,
    );
    if (d04NoLynchTarget?.kind !== "no_lynch" || d04NoLynchButton === undefined) {
      throw new Error(
        `D04 no-lynch setup drifted: ${JSON.stringify({
          d04ActionSurface,
          d04NoLynchTarget,
          d04NoLynchButton,
        })}`,
      );
    }
    const d04NoLynchVoteSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: revoteProgressionVoteActionId,
      waitFor: () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-goon-a" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.actor_slot === "slot_4" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D04" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch",
    });
    await waitForPlayerVotecount(actionEntry.page, {
      target: "no_lynch",
      count: 1,
    });
    const d04ActionAfterNoLynchVote = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, currentVote: true, votecount: true, buttons: true },
    );
    const d04NoLynchApiVotecountAfterVote = normalizedVotecountRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/votecount`),
    );
    const d04NoLynchApiRow = d04NoLynchApiVotecountAfterVote.find(
      (row) => row.phaseId === "D04" && row.target === "no_lynch",
    );
    const hostBeforeResolveD04 = await hostProjectionSnapshot(hostEntry.page, {
      votecount: true,
    });
    const resolveD04 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "D04",
      locked: true,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D04" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ),
      null,
      { timeout: 15000 },
    );
    const hostAfterResolveD04 = await hostProjectionSnapshot(hostEntry.page, {
      dayVoteOutcomes: true,
      votecount: true,
      outcomePanel: true,
    });
    const d04DayVoteOutcomes = normalizeDayVoteOutcomeRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`),
    );
    const d04DayVoteOutcome = d04DayVoteOutcomes.find(
      (row) => row.phaseId === "D04",
    );
    const advanceN04 = await confirmHostPhaseAction(hostEntry.page, "advance_phase", {
      phaseId: "N04",
      locked: false,
    });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N04" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N04" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const n04HostSurface = await hostProjectionSnapshot(hostEntry.page, {
      phaseActions: true,
      dayVoteOutcomes: true,
    });
    const n04ActionSurface = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
    });
    const n04DeadPlayerSurface = await playerProjectionSnapshot(playerEntry.page, {
      roleUrl: true,
      buttons: true,
      notifications: true,
    });
    const n04NoActionState = {
      actionCount: n04ActionSurface.commandState?.actions?.length ?? null,
      actionSubmitControls: n04ActionSurface.buttons.filter((button) =>
        String(button.action ?? "").startsWith("submit_action"),
      ).length,
      statusBoundary: n04ActionSurface.commandState?.boundary ?? null,
    };
    if (
      n04NoActionState.actionCount !== 0 ||
      n04NoActionState.actionSubmitControls !== 0
    ) {
      throw new Error(
        `N04 no-action setup drifted: ${JSON.stringify(n04ActionSurface)}`,
      );
    }
    const hostBeforeResolveN04 = await hostProjectionSnapshot(hostEntry.page);
    const resolveN04 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "N04",
      locked: true,
    });
    const hostAfterResolveN04 = await hostProjectionSnapshot(hostEntry.page, {
      slots: true,
    });
    const advanceD05 = await confirmHostPhaseAction(hostEntry.page, "advance_phase", {
      phaseId: "D05",
      locked: false,
    });
    await Promise.all([
      gotoPlayerBoard(actionEntry.page, transitionGame),
      gotoPlayerBoard(playerEntry.page, transitionGame),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const d05HostSurface = await hostProjectionSnapshot(hostEntry.page, {
      roleUrl: true,
      slots: true,
      dayVoteOutcomes: true,
    });
    const d05ActionSurface = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
    });
    const d05DeadPlayerSurface = await playerProjectionSnapshot(playerEntry.page, {
      roleUrl: true,
      buttons: true,
      notifications: true,
    });
    const d05NoLynchTarget = revoteNoLynchTargetFromCommandState({
      commandState: d05ActionSurface.commandState,
    });
    const d05NoLynchButton = d05ActionSurface.buttons.find(
      (button) =>
        button.action === revoteProgressionVoteActionId &&
        button.disabled === false,
    );
    if (d05NoLynchTarget?.kind !== "no_lynch" || d05NoLynchButton === undefined) {
      throw new Error(
        `D05 no-lynch setup drifted: ${JSON.stringify({
          d05ActionSurface,
          d05NoLynchTarget,
          d05NoLynchButton,
        })}`,
      );
    }
    const d05NoLynchVoteSubmission = await submitPlayerCommandAndWait({
      page: actionEntry.page,
      actionId: revoteProgressionVoteActionId,
      waitFor: () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-goon-a" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.actor_slot === "slot_4" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D05" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch",
    });
    await waitForPlayerVotecount(actionEntry.page, {
      target: "no_lynch",
      count: 1,
    });
    const d05ActionAfterNoLynchVote = await playerProjectionSnapshot(
      actionEntry.page,
      { roleUrl: true, currentVote: true, votecount: true, buttons: true },
    );
    const d05NoLynchApiVotecountAfterVote = normalizedVotecountRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/votecount`),
    );
    const d05NoLynchApiRow = d05NoLynchApiVotecountAfterVote.find(
      (row) => row.phaseId === "D05" && row.target === "no_lynch",
    );
    const hostBeforeResolveD05 = await hostProjectionSnapshot(hostEntry.page, {
      votecount: true,
    });
    const resolveD05 = await confirmHostPhaseAction(hostEntry.page, "resolve_phase", {
      phaseId: "D05",
      locked: true,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D05" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
        ),
      null,
      { timeout: 15000 },
    );
    const hostAfterResolveD05 = await hostProjectionSnapshot(hostEntry.page, {
      dayVoteOutcomes: true,
      votecount: true,
      outcomePanel: true,
    });
    const d05DayVoteOutcomes = normalizeDayVoteOutcomeRows(
      await fetchJson(`${apiBaseUrl}/games/${transitionGame}/day-vote-outcomes`),
    );
    const d05DayVoteOutcome = d05DayVoteOutcomes.find(
      (row) => row.phaseId === "D05",
    );
    const advanceN05 = await confirmHostPhaseAction(hostEntry.page, "advance_phase", {
      phaseId: "N05",
      locked: false,
    });
    await gotoPlayerBoard(actionEntry.page, transitionGame);
    await actionEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
    );
    const n05ActionSurface = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
    });
    const completeN05 = await confirmHostPhaseAction(hostEntry.page, "complete_game");
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const hostAfterCompleteN05 = await hostProjectionSnapshot(hostEntry.page, {
      roleUrl: true,
      slots: true,
    });
    const hostActionsAfterCompleteN05 = await visibleHostControlActions(
      hostEntry.page,
      "roles",
    );
    const apiStateAfterCompleteN05 = await fetchHostConsoleState({
      apiBaseUrl,
      game: transitionGame,
    });
    const hostReloadAfterCompleteN05 = await hostEntry.page.reload({
      waitUntil: "networkidle",
    });
    if (hostReloadAfterCompleteN05 === null || !hostReloadAfterCompleteN05.ok()) {
      throw new Error(
        `N05 completed host reload failed with ${
          hostReloadAfterCompleteN05?.status() ?? "no response"
        }`,
      );
    }
    await hostEntry.page.getByTestId("host-console-surface").waitFor({
      state: "visible",
      timeout: 15000,
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true &&
        window.__fmarchHostProjection?.phase?.id === "N05",
      null,
      { timeout: 15000 },
    );
    const hostAfterCompleteReloadN05 = await hostProjectionSnapshot(
      hostEntry.page,
      {
        roleUrl: true,
        slots: true,
      },
    );
    const hostActionsAfterCompleteReloadN05 = await visibleHostControlActions(
      hostEntry.page,
      "roles",
    );
    await gotoPlayerBoard(actionEntry.page, transitionGame);
    await actionEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N05",
      null,
      { timeout: 15000 },
    );
    const completedActionSurface = await playerProjectionSnapshot(actionEntry.page, {
      roleUrl: true,
      buttons: true,
    });

    if (
      d04NoLynchVoteSubmission?.state !== "ack" ||
      d04NoLynchApiRow?.count !== 1 ||
      resolveD04?.commandStatus?.state !== "ack" ||
      d04DayVoteOutcome?.status !== "NoLynch" ||
      advanceN04?.commandStatus?.state !== "ack" ||
      n04ActionSurface.commandState?.phase?.phaseId !== "N04" ||
      n04NoActionState.actionCount !== 0 ||
      n04NoActionState.actionSubmitControls !== 0 ||
      resolveN04?.commandStatus?.state !== "ack" ||
      advanceD05?.commandStatus?.state !== "ack" ||
      d05ActionSurface.commandState?.phase?.phaseId !== "D05" ||
      d05NoLynchVoteSubmission?.state !== "ack" ||
      d05NoLynchApiRow?.count !== 1 ||
      resolveD05?.commandStatus?.state !== "ack" ||
      d05DayVoteOutcome?.status !== "NoLynch" ||
      advanceN05?.commandStatus?.state !== "ack" ||
      n05ActionSurface.commandState?.phase?.phaseId !== "N05" ||
      n05ActionSurface.commandState?.actions?.length !== 0 ||
      completeN05?.commandStatus?.state !== "ack" ||
      completeN05?.commandStatus?.requestEnvelope?.body?.body?.command
        ?.CompleteGame?.game !== transitionGame ||
      hostAfterCompleteN05.completed !== true ||
      hostAfterCompleteN05.phase?.id !== "N05" ||
      hostAfterCompleteN05.slots?.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      hostActionsAfterCompleteN05.includes("complete_game") ||
      apiStateAfterCompleteN05?.completed !== true ||
      hostReloadAfterCompleteN05.status() !== 200 ||
      hostAfterCompleteReloadN05.completed !== true ||
      hostAfterCompleteReloadN05.phase?.id !== "N05" ||
      hostAfterCompleteReloadN05.slots?.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      hostActionsAfterCompleteReloadN05.includes("complete_game") ||
      completedActionSurface.commandState?.gameCompleted !== true ||
      completedActionSurface.commandState?.phase?.phaseId !== "N05" ||
      completedActionSurface.commandState?.actions?.length !== 0 ||
      completedActionSurface.commandState?.voteTargets?.length !== 0 ||
      completedActionSurface.buttons?.some((button) => button.disabled !== true)
    ) {
      throw new Error(
        `late core-loop progression drifted: ${JSON.stringify({
          d04NoLynchVoteSubmission,
          d04NoLynchApiRow,
          resolveD04,
          d04DayVoteOutcome,
          advanceN04,
          n04ActionSurface,
          n04NoActionState,
          resolveN04,
          advanceD05,
          d05ActionSurface,
          d05NoLynchVoteSubmission,
          d05NoLynchApiRow,
          resolveD05,
          d05DayVoteOutcome,
          advanceN05,
          n05ActionSurface,
          completeN05,
          hostAfterCompleteN05,
          hostActionsAfterCompleteN05,
          apiStateAfterCompleteN05,
          hostReloadAfterCompleteN05Status: hostReloadAfterCompleteN05.status(),
          hostAfterCompleteReloadN05,
          hostActionsAfterCompleteReloadN05,
          completedActionSurface,
        })}`,
      );
    }

    return {
      status: "passed",
      game: transitionGame,
      seed,
      hostRoleUrl: hostEntry.page.url(),
      actionRoleUrl: actionEntry.page.url(),
      playerRoleUrl: playerEntry.page.url(),
      targetRoleUrl: targetEntry.page.url(),
      hostBeforeVote,
      actionBeforeVote,
      voteTarget,
      voteButton,
      finalVote,
      actionAfterVote,
      apiVoteRow,
      resolveD02,
      hostAfterResolve,
      dayVoteOutcome,
      hostSlotAfterResolve,
      targetReceiptSurface,
      advanceN02,
      n02HostSurface,
      n02ActionSurface,
      n02NormalPlayerSurface,
      staleD02VoteTransitionSetup,
      staleD02VoteAfterTransition,
      n02ActionTarget,
      n02ActionSubmission,
      n02ActionAfterSubmit,
      resolveN02,
      hostAfterResolveN02,
      n02ResolvedTargetSlot,
      advanceD03,
      d03HostSurface,
      d03ActionSurface,
      d03NormalPlayerSurface,
      d03TerminalVoteTarget,
      d03TerminalVoteButton,
      d03TerminalVoteSubmission,
      d03TerminalPlayerAfterVote,
      d03TerminalApiVoteRow,
      resolveD03,
      hostAfterResolveD03,
      d03RevotePrompt,
      d03RevotePromptActionId,
      d03TerminalDayVoteOutcome,
      d03TerminalResolvedSlot,
      d03TerminalAdvanceReject,
      hostAfterTerminalAdvanceReject,
      d03TerminalActivityStatusText,
      d03TerminalActivityRow,
      d03TerminalDispatchPlan,
      d03TerminalApiHostStateAfterReject,
      d03TerminalHostReloadAfterReject,
      d03RevotePromptResolution,
      hostAfterD03RevotePrompt,
      actionAfterD03RevotePrompt,
      normalAfterD03RevotePrompt,
      apiPromptsAfterD03Revote,
      d03RevoteBallotTarget,
      d03RevoteNoLynchButton,
      d03RevoteVoteSubmission,
      d03RevoteActionAfterVote,
      d03RevoteApiVotecountAfterVote,
      d03RevoteApiNoLynchRow,
      d03RevoteApiOriginalD03Row,
      d03RevoteApiStaleD03NoLynchRow,
      hostBeforeResolveD03R1,
      resolveD03R1,
      hostAfterResolveD03R1,
      d03R1DayVoteOutcomes,
      d03R1DayVoteOutcome,
      d03R1RevotePrompt,
      d03R1RevotePromptActionId,
      apiPromptsAfterResolveD03R1,
      d03R1RevotePromptResolution,
      hostAfterD03R1RevotePrompt,
      actionAfterD03R1RevotePrompt,
      normalAfterD03R1RevotePrompt,
      apiPromptsAfterD03R1Revote,
      d03R2RevoteBallotTarget,
      d03R2RevoteNoLynchButton,
      d03R2RevoteVoteSubmission,
      d03R2RevoteActionAfterVote,
      d03R2RevoteApiVotecountAfterVote,
      d03R2RevoteApiNoLynchRow,
      d03R2RevoteApiOriginalD03Row,
      d03R2RevoteApiD03R1NoLynchRow,
      d03R2RevoteApiStaleD03NoLynchRow,
      hostBeforeResolveD03R2,
      resolveD03R2,
      hostAfterResolveD03R2,
      d03R2DayVoteOutcomes,
      d03R2DayVoteOutcome,
      d03R2RevotePrompt,
      d03R2RevotePromptActionId,
      d03R2StaleContinuePolicyActionId,
      apiPromptsAfterResolveD03R2,
      d03R2NoLynchPolicyResolution,
      hostAfterD03R2NoLynchPolicy,
      actionAfterD03R2NoLynchPolicy,
      normalAfterD03R2NoLynchPolicy,
      apiPromptsAfterD03R2NoLynchPolicy,
      d03R2StaleContinuePolicySetup,
      d03R2StaleContinuePolicyRecovery,
      n03ActionTarget,
      n03ActionSubmission,
      n03ActionAfterSubmit,
      hostBeforeResolveN03,
      resolveN03,
      hostAfterResolveN03,
      n03ResolvedTargetSlot,
      advanceD04,
      d04HostSurface,
      d04ActionSurface,
      d04TargetSurface,
      d04NoLynchTarget,
      d04NoLynchButton,
      d04NoLynchVoteSubmission,
      d04ActionAfterNoLynchVote,
      d04NoLynchApiVotecountAfterVote,
      d04NoLynchApiRow,
      hostBeforeResolveD04,
      resolveD04,
      hostAfterResolveD04,
      d04DayVoteOutcomes,
      d04DayVoteOutcome,
      advanceN04,
      n04HostSurface,
      n04ActionSurface,
      n04NoActionState,
      n04DeadPlayerSurface,
      hostBeforeResolveN04,
      resolveN04,
      hostAfterResolveN04,
      advanceD05,
      d05HostSurface,
      d05ActionSurface,
      d05DeadPlayerSurface,
      d05NoLynchTarget,
      d05NoLynchButton,
      d05NoLynchVoteSubmission,
      d05ActionAfterNoLynchVote,
      d05NoLynchApiVotecountAfterVote,
      d05NoLynchApiRow,
      hostBeforeResolveD05,
      resolveD05,
      hostAfterResolveD05,
      d05DayVoteOutcomes,
      d05DayVoteOutcome,
      advanceN05,
      n05ActionSurface,
      completeN05,
      hostAfterCompleteN05,
      hostActionsAfterCompleteN05,
      apiStateAfterCompleteN05,
      hostReloadAfterCompleteN05: {
        status: hostReloadAfterCompleteN05.status(),
        ok: hostReloadAfterCompleteN05.ok(),
      },
      hostAfterCompleteReloadN05,
      hostActionsAfterCompleteReloadN05,
      completedActionSurface,
      proof:
        "A disposable seeded local game reached open D02 through real phase commands, the Slot 4 mafia-goon role URL submitted the deciding day vote, the host role URL resolved D02 into a day-vote kill with the target-only receipt, advanced to open N02 where the living mafia-goon role URL regained factional_kill while the normal player role URL did not, then the mafia-goon role URL submitted the N02 factional_kill, withdrew it through the picker withdraw affordance which restored the submit action, and re-submitted the same target before the host role URL resolved it, and the same role URLs advanced to open D03 day controls before Slot 7 submitted a D03 vote for Slot 4, host resolution recorded NoMajority and issued the D03 revote host prompt, host AdvancePhase rejected InvalidTarget instead of inventing a Night 3, the host role URL reloaded to the same locked D03 NoMajority recovery truth, resolving the revote prompt with the explicit continue-revote policy advanced the same host and player role URLs into open D03R1 controls, the action-player role URL submitted a no-lynch revote ballot whose API tally was keyed to D03R1 while the old D03 slot tally stayed separate, the host role URL resolved D03R1 back to locked NoMajority with a fresh pending D03R1 revote prompt, resolving that prompt with the explicit continue-revote policy advanced the same host and player role URLs into open D03R2 controls, then the action-player role URL submitted and the host role URL resolved a D03R2 no-lynch ballot with D03, D03R1, and D03R2 tallies kept separate before the host chose the explicit no-lynch policy and advanced the same host/player role URLs into open N03, while a frozen stale continue-revote host policy button rejected PromptAlreadyResolved and reloaded to open N03 controls; the same live role URLs then submitted and resolved the real N03 factional_kill, killed the projected target, and advanced to open D04 day controls. The D04 action-player role URL then submitted no-lynch, the host role URL resolved and advanced into open N04 with no legal action available, host resolution advanced the same game into open D05 controls, the D05 action-player no-lynch plus host resolution advanced into open N05 with no legal action remaining, and the same host/action-player role URLs completed the game with revealed endgame state and disabled player controls.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await actionEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
    await targetEntry.context.close().catch(() => {});
  }
}

async function freezeStaleD02VoteTransitionPage({ page, game, voteTarget }) {
  await gotoPlayerBoard(page, game);
  await page.waitForFunction(
    ({ targetSlot }) =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      window.__fmarchPlayerProjection?.commandState?.voteTargets?.some(
        (target) => target.kind === "slot" && target.slotId === targetSlot,
      ),
    { targetSlot: voteTarget.slotId },
    { timeout: 15000 },
  );
  await page.locator('[data-action="submit_vote"]', {
    hasText: voteTarget.label,
  }).first().waitFor({ state: "visible", timeout: 15000 });
  const roleUrl = page.url();
  const commandState = await page.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const buttons = await playerCommandButtons(page);
  const voteButton =
    buttons.find(
      (button) =>
        button.action === "submit_vote" &&
        button.text?.includes(voteTarget.label) &&
        button.disabled === false,
    ) ?? null;
  await page.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    null,
    { timeout: 15000 },
  );
  const closedStatus = await page.evaluate(
    () => window.__fmarchClosePlayerLiveProjection(),
  );
  return {
    roleUrl,
    visitedRolePath: rolePathFromUrl(roleUrl),
    commandState,
    buttons,
    voteButton,
    closedStatus,
  };
}

async function submitStaleD02VoteAfterTransition({ page, voteTarget }) {
  await page
    .locator('[data-action="submit_vote"]', { hasText: voteTarget.label })
    .first()
    .click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N02",
    null,
    { timeout: 15000 },
  );
  await page.waitForFunction(
    () =>
      document.querySelector(
        '[data-action="submit_action:factional_kill"]:not([disabled])',
      ) !== null,
    null,
    { timeout: 15000 },
  );
  const reject = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const dispatchPlan = await page.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const commandStateAfterReject = await page.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const currentReceipt = await page.evaluate(
    () => window.__fmarchPlayerProjection?.currentReceipt ?? null,
  );
  const receiptStatusText = await page
    .getByTestId("player-command-status")
    .innerText();
  const buttonsAfterReject = await playerCommandButtons(page);
  const currentVoteAfterReject = await playerCurrentVoteSnapshot(page);
  return {
    status: "passed",
    clickedAction: "submit_vote",
    reject,
    dispatchPlan,
    commandStateAfterReject,
    currentReceipt,
    receiptStatusText,
    buttonsAfterReject,
    currentVoteAfterReject,
  };
}

async function seedD02VoteNightTransitionGame({ game }) {
  const plan = [
    ...seedCommandPlanForGame(game),
    ["host_h", { ResolvePhase: { game, seed: 73_201 } }],
    ["host_h", { AdvancePhase: { game } }],
    ["host_h", { ResolvePhase: { game, seed: 73_202 } }],
    ["host_h", { AdvancePhase: { game } }],
    [
      "player-seed",
      { SubmitVote: { game, actor_slot: "slot-3", target: { Slot: "slot-2" } } },
    ],
    [
      "player-mira",
      { SubmitVote: { game, actor_slot: "slot-7", target: { Slot: "slot-2" } } },
    ],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `D02 vote/night transition seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game,
    commands: commands.length,
    finalVoterSlot: "slot_4",
    targetSlot: "slot-2",
    expectedD02VoteCount: 3,
  };
}

async function verifyHostDeadlineAdvance({ hostPage, game, apiBaseUrl }) {
  await expectHostPhaseActions(hostPage, [
    "unlock_thread",
    "advance_phase",
    "advance_phase_by_deadline",
  ]);
  await hostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D01" &&
      window.__fmarchHostProjection?.phase?.locked === true &&
      typeof window.__fmarchHostProjection?.phase?.deadline === "number",
  );
  const phaseBeforeAdvance = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const advance = await confirmHostAction(hostPage, "advance_phase_by_deadline");
  const command =
    advance.commandStatus?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline;
  if (
    command?.game !== game ||
    command?.phase !== "D01" ||
    command?.observed_at !== phaseBeforeAdvance.deadline + 1
  ) {
    throw new Error(
      `deadline advance command drifted: ${JSON.stringify({
        command,
        phaseBeforeAdvance,
      })}`,
    );
  }
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false });
  const hostStateAfterAdvance = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    hostStateAfterAdvance?.phase?.phase_id !== "N01" ||
    hostStateAfterAdvance?.phase?.locked !== false ||
    hostStateAfterAdvance?.phase?.deadline !== null
  ) {
    throw new Error(
      `deadline advance projection drifted: ${JSON.stringify(hostStateAfterAdvance?.phase)}`,
    );
  }
  const phaseAfterAdvance = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  return {
    status: "passed",
    phaseBeforeAdvance,
    advance,
    command,
    phaseAfterAdvance,
    apiPhaseAfterAdvance: hostStateAfterAdvance.phase,
    proof:
      "The seeded host role URL resolved D01 into a locked phase with the previously extended deadline, clicked the hydrated Advance by deadline control, sent AdvancePhaseByDeadline with observed_at one second after the stored deadline, and both browser/API host projections advanced to unlocked N01 with no carried deadline.",
  };
}

async function freezeStaleDeadlineAdvancePage({ staleHostPage, game, frontendBaseUrl }) {
  await staleHostPage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  await staleHostPage
    .locator('[data-testid="critical-host-action-advance_phase_by_deadline"]')
    .waitFor({ state: "visible" });
  await staleHostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D01" &&
      window.__fmarchHostProjection?.phase?.locked === true &&
      typeof window.__fmarchHostProjection?.phase?.deadline === "number",
  );
  const stalePhase = await staleHostPage.evaluate(() => window.__fmarchHostProjection?.phase);
  const visibleActions = await visibleHostPhaseActions(staleHostPage);
  const closedStatus = await staleHostPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "D01" ||
    stalePhase?.locked !== true ||
    typeof stalePhase?.deadline !== "number" ||
    !visibleActions.includes("advance_phase_by_deadline") ||
    !visibleActions.includes("unlock_thread") ||
    !visibleActions.includes("advance_phase") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale deadline advance setup drifted: ${JSON.stringify({
        stalePhase,
        visibleActions,
        closedStatus,
      })}`,
    );
  }
  return {
    stalePhase,
    visibleActions,
    closedStatus,
  };
}

async function submitStaleDeadlineAdvanceRecovery({
  staleHostPage,
  staleDeadlineAdvanceSetup,
  apiBaseUrl,
  game,
}) {
  const actionId = "advance_phase_by_deadline";
  const staleActionRoot = staleHostPage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId: "unlock_thread",
    roleLabel: "stale host",
  });
  await staleHostPage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "InvalidTarget",
    actionId,
  );
  await staleHostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "N01" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const reject = await staleHostPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await staleHostPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleHostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const visibleActionsAfterReject = await visibleHostPhaseActions(staleHostPage);
  const activityStatusText = await staleHostPage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostPage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    !reject?.message?.includes("deadline target is stale") ||
    phaseAfterReject?.id !== "N01" ||
    phaseAfterReject?.locked !== false ||
    !visibleActionsAfterReject.includes("resolve_phase") ||
    !visibleActionsAfterReject.includes("lock_thread") ||
    visibleActionsAfterReject.includes("advance_phase_by_deadline") ||
    !activityStatusText.includes("Reject InvalidTarget") ||
    !activityStatusText.includes("deadline target is stale") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    hostStateAfterReject.phase?.phase_id !== "N01" ||
    hostStateAfterReject.phase?.locked !== false ||
    hostStateAfterReject.phase?.deadline !== null
  ) {
    throw new Error(
      `stale deadline advance recovery drifted: ${JSON.stringify({
        staleDeadlineAdvanceSetup,
        reject,
        commandOutcomes,
        phaseAfterReject,
        visibleActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiPhase: hostStateAfterReject.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleDeadlineAdvanceSetup,
    reject,
    commandOutcomes,
    phaseAfterReject,
    visibleActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiPhaseAfterReject: hostStateAfterReject.phase,
    proof:
      "A stale seeded host role URL kept the old D01 Advance by deadline control, clicked it after the live host had advanced to N01, rendered Reject InvalidTarget with deadline-stale recovery copy, refreshed to current N01 controls, and did not append deadline evidence or move the phase again.",
  };
}

async function freezeStaleHostControlPage({ staleHostPage, game, frontendBaseUrl }) {
  await staleHostPage.goto(`${frontendBaseUrl}/g/${game}/host`, { waitUntil: "networkidle" });
  await staleHostPage.locator('[data-testid="critical-host-action-unlock_thread"]').waitFor({
    state: "visible",
  });
  await staleHostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "N01" &&
      window.__fmarchHostProjection?.phase?.locked === true,
  );
  const stalePhase = await staleHostPage.evaluate(() => window.__fmarchHostProjection?.phase);
  const visibleActions = await visibleHostPhaseActions(staleHostPage);
  const closedStatus = await staleHostPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    stalePhase?.id !== "N01" ||
    stalePhase?.locked !== true ||
    !visibleActions.includes("unlock_thread") ||
    !visibleActions.includes("advance_phase") ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host setup drifted: ${JSON.stringify({
        stalePhase,
        visibleActions,
        closedStatus,
      })}`,
    );
  }
  return {
    stalePhase,
    visibleActions,
    closedStatus,
  };
}

async function verifySeededInvalidActionRecovery({ actionPage }) {
  await actionPage.locator('[data-action="submit_invalid_action:factional_kill"]').click();
  await actionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "InvalidTarget",
  );
  const reject = await actionPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  await actionPage.waitForFunction(
    () =>
      Array.isArray(window.__fmarchPlayerProjection?.commandState?.actions) &&
      window.__fmarchPlayerProjection.commandState.actions.some(
        (action) => action.templateId === "factional_kill",
      ),
  );
  const commandState = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const legalActionVisible = await actionPage
    .locator('[data-action="submit_action:factional_kill"]')
    .isVisible();
  const currentReceipt = await actionPage.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await actionPage.getByTestId("player-command-status").innerText();
  if (
    reject?.error !== "InvalidTarget" ||
    commandState?.phase?.phaseId !== "N01" ||
    !commandState?.actions?.some((action) => action.templateId === "factional_kill") ||
    legalActionVisible !== true ||
    currentReceipt?.actionId !== "submit_invalid_action:factional_kill" ||
    currentReceipt?.state !== "reject" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !== true ||
    !receiptStatusText.includes(playerInvalidActionRecoveryMessage)
  ) {
    throw new Error(
      `invalid action recovery drifted: ${JSON.stringify({
        reject,
        commandState,
        legalActionVisible,
        currentReceipt,
        receiptStatusText,
      })}`,
    );
  }
  return {
    status: "passed",
    reject,
    commandState,
    legalActionVisible,
    currentReceipt,
    receiptStatusText,
    proof:
      "The action-player role URL submitted the seeded invalid self-action, rendered a current InvalidTarget command receipt, refreshed commandState, and kept the legal factional_kill action available without advancing phase.",
  };
}

async function verifyPrivateChannelInvalidActionRecovery({
  page,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const route = await openPrivateChannelRoleSurface({
    page,
    frontendBaseUrl,
    game,
    proofLabel: "private-channel invalid action",
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      window.__fmarchPlayerProjection?.commandState?.actions?.some(
        (action) => action.templateId === "factional_kill",
      ),
  );
  const setupSnapshot = await privateChannelRoleSnapshot(page);
  const invalidActionButton = setupSnapshot.buttons.find(
    (button) => button.action === "submit_invalid_action:factional_kill",
  );
  const legalActionButton = setupSnapshot.buttons.find(
    (button) => button.action === "submit_action:factional_kill",
  );
  assertPrivateChannelContext({
    context: setupSnapshot.channelContext,
    expectedChannelId: factionDayChatChannel,
    expectedActorSlot: "slot_4",
    requireCapabilityLabel: true,
    label: "private-channel invalid action setup",
    includeEvidenceInError: true,
  });
  if (
    invalidActionButton?.disabled !== false ||
    legalActionButton?.disabled !== false
  ) {
    throw new Error(
      `private-channel invalid action setup drifted: ${JSON.stringify({
        route,
        setupSnapshot,
        invalidActionButton,
        legalActionButton,
      })}`,
    );
  }

  await page.locator('[data-action="submit_invalid_action:factional_kill"]').click();
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "InvalidTarget" &&
      window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
        ?.SubmitAction?.action_id === "invalid_self_factional_kill",
  );
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.actions?.some(
        (action) => action.templateId === "factional_kill",
      ) &&
      document
        .querySelector("[data-testid='player-command-channel-context']")
        ?.getAttribute("data-channel-id") === "private:mafia_day_chat",
  );
  const reject = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const afterRejectSnapshot = await privateChannelRoleSnapshot(page);
  const currentReceipt = await page.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await page.getByTestId("player-command-status").innerText();
  const apiCommandStateAfterReject = await fetchPlayerSlotCommandState({
    apiBaseUrl,
    game,
    principalUserId: "player-goon-a",
    slotId: "slot_4",
  });
  const legalActionVisibleAfterReject = await page
    .locator('[data-action="submit_action:factional_kill"]')
    .isVisible();
  const privateThreadPagerVisible = await page
    .getByTestId("player-thread-pager")
    .isVisible();
  assertPrivateChannelRouteContext({
    context: afterRejectSnapshot.channelContext,
    expectedChannelId: factionDayChatChannel,
    expectedActorSlot: "slot_4",
    privateThreadPagerVisible,
    label: "private-channel invalid action recovery",
    includeEvidenceInError: true,
  });

  if (
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    reject?.requestEnvelope?.body?.body?.principal_user_id !== "player-goon-a" ||
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot !==
      "slot_4" ||
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id !==
      "factional_kill" ||
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] !==
      "slot_4" ||
    currentReceipt?.actionId !== "submit_invalid_action:factional_kill" ||
    currentReceipt?.state !== "reject" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
      "commandState",
    ) !== true ||
    !receiptStatusText.includes(playerInvalidActionRecoveryMessage) ||
    afterRejectSnapshot.commandState?.phase?.phaseId !== "N01" ||
    afterRejectSnapshot.commandState?.phase?.locked !== false ||
    !afterRejectSnapshot.commandState?.actions?.some(
      (action) => action.templateId === "factional_kill",
    ) ||
    legalActionVisibleAfterReject !== true ||
    !afterRejectSnapshot.buttons.some(
      (button) =>
        button.action === "submit_action:factional_kill" &&
        button.disabled === false,
    ) ||
    apiCommandStateAfterReject?.phase?.phase_id !== "N01" ||
    apiCommandStateAfterReject?.actions?.some(
      (action) => action.template_id === "factional_kill",
    ) !== true
  ) {
    throw new Error(
      `private-channel invalid action recovery drifted: ${JSON.stringify({
        route,
        reject,
        setupSnapshot,
        afterRejectSnapshot,
        currentReceipt,
        receiptStatusText,
        apiCommandStateAfterReject,
        legalActionVisibleAfterReject,
        privateThreadPagerVisible,
      })}`,
    );
  }

  return {
    status: "passed",
    laneId: coreLoopPrivateChannelInvalidActionLaneId,
    game,
    channel: factionDayChatChannel,
    route,
    setupSnapshot,
    invalidActionButton,
    legalActionButton,
    reject,
    afterRejectSnapshot,
    currentReceipt,
    receiptStatusText,
    apiCommandStateAfterReject,
    legalActionVisibleAfterReject,
    privateThreadPagerVisible,
    proof:
      "The action-player private-channel role URL submitted the seeded invalid self-action, rendered a current InvalidTarget command receipt, refreshed commandState, kept the legal factional_kill action available, and preserved the scoped private-channel context.",
  };
}

async function verifySeededDeadPlayerRecovery({ targetPage, game, targetSlot }) {
  await gotoPlayerBoard(targetPage, game);
  await targetPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === false,
  );
  const commandState = await targetPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const channelContext = await targetPage
    .getByTestId("player-command-channel-context")
    .evaluate((node) => ({
      actorSlot: node.getAttribute("data-actor-slot"),
      actorAlive: node.getAttribute("data-actor-alive"),
      actorStatus: node.getAttribute("data-actor-status"),
      text: node.textContent,
    }));
  const disabledControls = {
    vote: await playerCommandControlState(targetPage, "submit_vote"),
    withdraw: await playerCommandControlState(targetPage, "withdraw_vote"),
    post: await playerCommandControlState(targetPage, "submit_post"),
  };
  const actionControlCount = await targetPage.locator('[data-action^="submit_action"]').count();
  if (
    commandState?.actorSlot !== targetSlot ||
    commandState?.actorAlive !== false ||
    commandState?.actorStatus !== "dead" ||
    commandState?.phase?.phaseId !== "D02" ||
    commandState?.actions?.length !== 0 ||
    channelContext.actorAlive !== "false" ||
    channelContext.actorStatus !== "dead" ||
    !Object.values(disabledControls).every((control) => control.disabled === true) ||
    actionControlCount !== 0
  ) {
    throw new Error(
      `dead player role URL state drifted: ${JSON.stringify({
        commandState,
        channelContext,
        disabledControls,
        actionControlCount,
      })}`,
    );
  }

  const directVote = await sendDeadPlayerCommand(targetPage, {
    game,
    command: {
      SubmitVote: {
        game,
        actor_slot: targetSlot,
        target: { Slot: "slot_5" },
      },
    },
  });
  const directPost = await sendDeadPlayerCommand(targetPage, {
    game,
    command: {
      SubmitPost: {
        game,
        channel_id: "main",
        actor_slot: targetSlot,
        body: "Dead slot direct post recovery proof.",
        media: null,
      },
    },
  });
  const directAction = await sendDeadPlayerCommand(targetPage, {
    game,
    command: {
      SubmitAction: {
        game,
        action_id: "dead-player-factional-kill",
        actor_slot: targetSlot,
        template_id: "factional_kill",
        targets: ["slot_5"],
        grant_id: null,
      },
    },
  });

  await gotoPlayerBoard(targetPage, game);
  await targetPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === false,
  );
  const commandStateAfterRejects = await targetPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  if (
    commandStateAfterRejects?.actorSlot !== targetSlot ||
    commandStateAfterRejects?.actorAlive !== false ||
    commandStateAfterRejects?.actorStatus !== "dead" ||
    commandStateAfterRejects?.actions?.length !== 0
  ) {
    throw new Error(
      `dead player rejects mutated command state: ${JSON.stringify(
        commandStateAfterRejects,
      )}`,
    );
  }

  return {
    status: "passed",
    targetSlot,
    commandState,
    channelContext,
    disabledControls,
    actionControlCount,
    directVote,
    directPost,
    directAction,
    commandStateAfterRejects,
    proof:
      "The killed player role URL reached D02 with actorAlive=false, actorStatus=dead, disabled vote/post controls, no night actions, and direct vote/post/action commands all rejected as SlotNotAlive without restoring actions.",
  };
}

async function sendDeadPlayerCommand(page, { command }) {
  const raw = await sendBrowserCommand(page, {
    principalUserId: "player-target",
    commandId: crypto.randomUUID(),
    command,
  });
  const rejectBody = raw.serverEnvelope?.body;
  if (
    rejectBody?.kind !== "Reject" ||
    rejectBody?.body?.error !== "SlotNotAlive" ||
    raw.requestEnvelope?.body?.body?.principal_user_id !== "player-target"
  ) {
    throw new Error(`dead player command did not reject as SlotNotAlive: ${JSON.stringify(raw)}`);
  }
  return {
    ...raw,
    statusMessage: `Reject ${rejectBody.body.error}: ${rejectBody.body.message}`,
  };
}

async function verifySeededResolutionReceipts({
  playerPage,
  actionPage,
  targetPage,
  game,
  apiBaseUrl,
  resolvedTargetSlot,
  legalAction,
}) {
  const targetSlot = resolvedTargetSlot?.slot_id ?? resolvedTargetSlot?.slotId;
  if (targetSlot !== "slot-2") {
    throw new Error(`resolution receipt proof expected slot-2 target, got ${targetSlot}`);
  }
  const hostState = await fetchHostConsoleState({ apiBaseUrl, game, slot: targetSlot });
  const hostSlotReceipt = hostState?.slots?.find((row) => row.slot_id === targetSlot) ?? null;

  await gotoPlayerBoard(targetPage, game);
  await targetPage.waitForFunction(
    (slot) =>
      window.__fmarchPlayerProjection?.notifications?.some(
        (notice) =>
          notice.audience_slot === slot &&
          notice.effect === "player_killed" &&
          notice.status === "factional_kill",
      ),
    targetSlot,
  );
  const targetNotice = await targetPage.evaluate(
    (slot) =>
      window.__fmarchPlayerProjection?.notifications?.find(
        (notice) =>
          notice.audience_slot === slot &&
          notice.effect === "player_killed" &&
          notice.status === "factional_kill",
      ) ?? null,
    targetSlot,
  );
  const targetPrivateQueueItem = await targetPage.evaluate(
    () =>
      window.__fmarchPlayerProjection?.notifications?.find(
        (notice) => notice.effect === "player_killed",
      ) ?? null,
  );
  const targetCommandState = await targetPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );

  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02",
  );
  const normalPlayerNoticeVisible = await playerPage.evaluate(
    () =>
      window.__fmarchPlayerProjection?.notifications?.some(
        (notice) => notice.effect === "player_killed",
      ) === true,
  );
  if (normalPlayerNoticeVisible) {
    throw new Error("normal player role received a private player_killed notice");
  }

  await gotoPlayerBoard(actionPage, game);
  await actionPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02",
  );
  const actionPlayerNoticeVisible = await actionPage.evaluate(
    () =>
      window.__fmarchPlayerProjection?.notifications?.some(
        (notice) => notice.effect === "player_killed",
      ) === true,
  );
  if (actionPlayerNoticeVisible) {
    throw new Error("action player role received target-only player_killed notice");
  }
  const actionReceipt = {
    state: legalAction?.state ?? null,
    templateId:
      legalAction?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id ?? null,
    target:
      legalAction?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] ?? null,
  };

  if (
    hostSlotReceipt?.alive !== false ||
    hostSlotReceipt?.status !== "dead" ||
    targetNotice === null ||
    targetCommandState?.actorSlot !== targetSlot ||
    targetCommandState?.actions?.length !== 0 ||
    actionReceipt.state !== "ack" ||
    actionReceipt.templateId !== "factional_kill" ||
    actionReceipt.target !== targetSlot
  ) {
    throw new Error(
      `resolution receipt proof drifted: ${JSON.stringify({
        hostSlotReceipt,
        targetNotice,
        targetCommandState,
        actionReceipt,
      })}`,
    );
  }

  return {
    status: "passed",
    targetSlot,
    hostSlotReceipt,
    targetNotice,
    targetPrivateQueueItem,
    targetCommandState,
    actionReceipt,
    normalPlayerNoticeVisible,
    actionPlayerNoticeVisible,
    proof:
      "After N01 resolution, the seeded host role URL showed slot-2 dead, the killed player role URL loaded a principal-scoped player_killed factional_kill notice with no remaining actions, and the normal player plus action-player role URLs did not receive that target-only private notice while the action-player kept the submitted action ACK.",
  };
}

async function verifySeededPlayerActionBoundary({ playerPage, game }) {
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01",
  );
  await playerPage.waitForFunction(
    () =>
      Array.isArray(window.__fmarchPlayerProjection?.commandState?.actions) &&
      window.__fmarchPlayerProjection.commandState.actions.length === 0,
  );
  const roleUrl = playerPage.url();
  const phase = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandActions = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.actions ?? [],
  );
  const commandButtons = await playerCommandButtons(playerPage);
  const factionalKillVisible = await playerPage
    .locator('[data-action="submit_action:factional_kill"]')
    .isVisible()
    .catch(() => false);
  if (factionalKillVisible) {
    throw new Error("player role exposed factional_kill action control");
  }
  const commandId = crypto.randomUUID();
  const directRaw = await sendBrowserCommand(playerPage, {
    principalUserId: "player-mira",
    commandId,
    command: {
      SubmitAction: {
        game,
        action_id: "player-boundary-factional-kill",
        actor_slot: "slot-7",
        template_id: "factional_kill",
        targets: ["slot-2"],
        grant_id: null,
      },
    },
  });
  const rejectBody = directRaw.serverEnvelope?.body;
  if (
    rejectBody?.kind !== "Reject" ||
    rejectBody?.body?.error !== "InvalidTarget" ||
    directRaw.requestEnvelope?.body?.body?.principal_user_id !== "player-mira"
  ) {
    throw new Error(
      `player direct factional_kill did not reject as InvalidTarget: ${JSON.stringify(
        directRaw,
      )}`,
    );
  }
  const phaseAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const actionVisibleAfterReject = await playerPage
    .locator('[data-action="submit_action:factional_kill"]')
    .isVisible()
    .catch(() => false);
  if (phaseAfterReject?.phaseId !== "N01" || actionVisibleAfterReject) {
    throw new Error(
      `player action boundary reject drifted: ${JSON.stringify({
        phaseAfterReject,
        actionVisibleAfterReject,
      })}`,
    );
  }
  return {
    status: "passed",
    roleUrl,
    phase,
    commandActions,
    commandButtons,
    factionalKillVisible,
    directFactionalKill: {
      ...directRaw,
      statusMessage: `Reject ${rejectBody.body.error}: ${rejectBody.body.message}`,
    },
    phaseAfterReject,
    actionVisibleAfterReject,
    proof:
      "The seeded player role URL reached N01 with private-channel capability but no factional_kill control, and a direct SubmitAction factional_kill command from that browser session rejected as InvalidTarget without adding the action to the player surface.",
  };
}

async function freezeStaleActionPage({ staleActionPage, game }) {
  await gotoPlayerBoard(staleActionPage, game);
  const roleUrl = staleActionPage.url();
  const visitedRolePath = rolePathFromUrl(roleUrl);
  await staleActionPage.locator('[data-action="submit_action:factional_kill"]').waitFor({
    state: "visible",
  });
  await staleActionPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01",
  );
  const staleN01Phase = await staleActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const actionConfig = await staleActionPage.evaluate(() =>
    window.__fmarchPlayerProjection?.commandState?.actions?.find(
      (action) => action.templateId === "factional_kill",
    ),
  );
  await staleActionPage.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
  );
  const closedStatus = await staleActionPage.evaluate(
    () => window.__fmarchClosePlayerLiveProjection(),
  );
  return {
    roleUrl,
    visitedRolePath,
    staleN01Phase,
    actionConfig,
    closedStatus,
  };
}

async function freezeStalePrivateChannelActionPage({ page, game, frontendBaseUrl }) {
  const route = await openPrivateChannelRoleSurface({
    page,
    frontendBaseUrl,
    game,
    proofLabel: "stale private-channel action",
  });
  const roleUrl = page.url();
  const visitedRolePath = rolePathFromUrl(roleUrl);
  await page.locator('[data-action="submit_action:factional_kill"]').waitFor({
    state: "visible",
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
  );
  const snapshot = await privateChannelRoleSnapshot(page);
  const actionConfig = snapshot.commandState?.actions?.find(
    (action) => action.templateId === "factional_kill",
  );
  const actionButton = snapshot.buttons.find(
    (button) => button.action === "submit_action:factional_kill",
  );
  const closedStatus = await closePlayerLiveProjection(page);
  assertPrivateChannelContext({
    context: snapshot.channelContext,
    expectedChannelId: factionDayChatChannel,
    expectedActorSlot: "slot_4",
    requireCapabilityLabel: true,
    label: "stale private-channel action setup",
    includeEvidenceInError: true,
  });
  if (
    actionConfig?.templateId !== "factional_kill" ||
    actionButton?.disabled !== false ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale private-channel action setup drifted: ${JSON.stringify({
        route,
        snapshot,
        actionConfig,
        actionButton,
        closedStatus,
      })}`,
    );
  }
  return {
    route,
    roleUrl,
    visitedRolePath,
    staleN01Phase: snapshot.commandState?.phase ?? null,
    channelContextBeforeClose: snapshot.channelContext,
    actionConfig,
    actionButton,
    closedStatus,
  };
}

function liveStaleN01ToD02ActionTransitionScenario({
  targetSlot,
  expectedRefreshKeys = ["commandState", "dayVoteOutcomes"],
}) {
  return {
    ...staleNightOneActionAfterTransitionRecoveryScenario(),
    actorSlot: "slot_4",
    targetSlot: targetSlot ?? "",
    refreshedPhaseId: "D02",
    expectedRefreshKeys,
    checkpointActionState: "disabled:no legal action available",
    checkpointTargetSlots: "",
    receiptCount: 1,
  };
}

async function clickPlayerActionThroughConfirm(page) {
  await page.locator('[data-action="submit_action:factional_kill"]').click();
  const confirmButton = page.locator(
    '[data-testid="player-action-confirm-factional_kill"]',
  );
  await confirmButton.waitFor({ state: "visible" });
  await confirmButton.click();
}

async function submitPrivateChannelStaleActionReconnectRecovery({
  page,
  setup,
  apiBaseUrl,
  game,
}) {
  await clickPlayerActionThroughConfirm(page);
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
      document
        .querySelector("[data-testid='player-command-channel-context']")
        ?.getAttribute("data-channel-id") === "private:mafia_day_chat",
  );
  const reject = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const afterRejectSnapshot = await privateChannelRoleSnapshot(page);
  const phaseAfterReject = afterRejectSnapshot.commandState?.phase ?? null;
  const commandStateAfterReject = afterRejectSnapshot.commandState;
  const dispatchPlan = await page.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const currentReceipt = await page.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await page.getByTestId("player-command-status").innerText();
  const apiCommandStateAfterReject = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  const actionVisibleAfterRefresh = await page
    .locator('[data-action="submit_action:factional_kill"]')
    .isVisible();
  const privateThreadPagerVisibleAfterReject = await page
    .getByTestId("player-thread-pager")
    .isVisible();
  const submittedCommand =
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
  assertLiveStaleN01ActionTransitionRecovery({
    setup,
    recovery: {
      status: "passed",
      reject,
      commandStateAfterReject,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      actionVisibleAfterRefresh,
    },
    expectedGame: game,
    scenario: liveStaleN01ToD02ActionTransitionScenario({
      targetSlot: submittedCommand?.targets?.[0] ?? setup.actionConfig?.targets?.[0],
    }),
    includeEvidenceInError: true,
  });
  assertPrivateChannelRouteContext({
    context: afterRejectSnapshot.channelContext,
    expectedChannelId: factionDayChatChannel,
    expectedActorSlot: "slot_4",
    privateThreadPagerVisible: privateThreadPagerVisibleAfterReject,
    label: "private-channel stale action recovery",
    includeEvidenceInError: true,
  });
  if (
    reject?.requestEnvelope?.body?.body?.principal_user_id !== "player-goon-a" ||
    currentReceipt?.actionId !== "submit_action:factional_kill" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !==
      true ||
    commandStateAfterReject?.actorAlive !== true ||
    commandStateAfterReject?.actorStatus !== "alive" ||
    commandStateAfterReject?.phase?.locked !== false ||
    apiCommandStateAfterReject?.actor_slot !== "slot_4" ||
    apiCommandStateAfterReject?.actor_alive !== true ||
    apiCommandStateAfterReject?.actor_status !== "alive" ||
    apiCommandStateAfterReject?.phase?.phase_id !== "D02" ||
    apiCommandStateAfterReject?.phase?.locked !== false ||
    apiCommandStateAfterReject?.actions?.length !== 0
  ) {
    throw new Error(
      `private-channel stale action recovery drifted: ${JSON.stringify({
        setup,
        reject,
        afterRejectSnapshot,
        dispatchPlan,
        currentReceipt,
        receiptStatusText,
        apiCommandStateAfterReject,
        actionVisibleAfterRefresh,
        privateThreadPagerVisibleAfterReject,
      })}`,
    );
  }
  await page.goto(setup.roleUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
      document
        .querySelector("[data-testid='player-command-channel-context']")
        ?.getAttribute("data-channel-id") === "private:mafia_day_chat" &&
      typeof window.__fmarchDropPlayerLiveProjection === "function",
  );
  const reconnectAfterReject = await verifyRoleReconnectRecovery({
    page,
    game,
    principalUserId: "player-goon-a",
    actorSlot: "slot_4",
    postPrefix: "Private-channel stale action reconnect proof",
    channelId: factionDayChatChannel,
  });
  const buttonsAfterReconnect = await playerCommandButtons(page);
  const reconnectChannelContext = await playerPrivateChannelContext(page);
  const privateThreadPagerVisibleAfterReconnect = await page
    .getByTestId("player-thread-pager")
    .isVisible();
  assertPrivateChannelRouteContext({
    context: reconnectChannelContext,
    expectedChannelId: factionDayChatChannel,
    expectedActorSlot: "slot_4",
    privateThreadPagerVisible: privateThreadPagerVisibleAfterReconnect,
    label: "private-channel stale action reconnect",
    includeEvidenceInError: true,
  });
  if (
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectCommand?.command?.SubmitPost?.channel_id !==
      factionDayChatChannel ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredSnapshotContainsPost !== true ||
    reconnectAfterReject?.recoveredCommandState?.actorSlot !== "slot_4" ||
    reconnectAfterReject?.recoveredCommandState?.actorAlive !== true ||
    reconnectAfterReject?.recoveredCommandState?.actorStatus !== "alive" ||
    reconnectAfterReject?.recoveredCommandState?.phase?.phaseId !== "D02" ||
    reconnectAfterReject?.recoveredCommandState?.phase?.locked !== false ||
    reconnectAfterReject?.recoveredCommandState?.actions?.length !== 0 ||
    buttonsAfterReconnect.some(
      (button) => button.action === "submit_action:factional_kill",
    )
  ) {
    throw new Error(
      `private-channel stale action reconnect drifted: ${JSON.stringify({
        reconnectAfterReject,
        buttonsAfterReconnect,
        reconnectChannelContext,
        privateThreadPagerVisibleAfterReconnect,
      })}`,
    );
  }
  return {
    status: "passed",
    sourceRoleUrl: setup.roleUrl,
    visitedRolePath: setup.visitedRolePath,
    channel: factionDayChatChannel,
    staleN01Phase: setup.staleN01Phase,
    channelContextBeforeClose: setup.channelContextBeforeClose,
    actionConfig: setup.actionConfig,
    closedStatus: setup.closedStatus,
    reject,
    phaseAfterReject,
    commandStateAfterReject,
    channelContextAfterReject: afterRejectSnapshot.channelContext,
    dispatchPlan,
    currentReceipt,
    receiptStatusText,
    apiCommandStateAfterReject,
    actionVisibleAfterRefresh,
    privateThreadPagerVisibleAfterReject,
    reconnectAfterReject,
    reconnectChannelContext,
    privateThreadPagerVisibleAfterReconnect,
    buttonsAfterReconnect,
    proof:
      "A private-channel action-player role URL froze with a legal N01 factional_kill control, rejected that stale action after the game reached D02, preserved private-channel context and explicit PhaseLocked recovery copy, then reconnected on the same private route without regaining action controls.",
  };
}

async function submitConcurrentActionRace({
  actionPage,
  concurrentActionPage,
  concurrentActionSetup,
  apiBaseUrl,
  game,
}) {
  await Promise.all([
    actionPage.locator('[data-action="submit_action:factional_kill"]').click(),
    concurrentActionPage.locator('[data-action="submit_action:factional_kill"]').click(),
  ]);
  await Promise.all([
    actionPage
      .locator('[data-testid="player-action-confirm-factional_kill"]')
      .click(),
    concurrentActionPage
      .locator('[data-testid="player-action-confirm-factional_kill"]')
      .click(),
  ]);
  await Promise.all([
    actionPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.action_id === "role_factional_kill" &&
        (window.__fmarchPlayerCommandStatus?.state === "ack" ||
          window.__fmarchPlayerCommandStatus?.state === "reject"),
    ),
    concurrentActionPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.action_id === "role_factional_kill" &&
        (window.__fmarchPlayerCommandStatus?.state === "ack" ||
          window.__fmarchPlayerCommandStatus?.state === "reject"),
    ),
  ]);
  const liveOutcome = await actionPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const concurrentOutcome = await concurrentActionPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  const outcomes = [
    { pageRole: "live", outcome: liveOutcome, page: actionPage },
    { pageRole: "concurrent", outcome: concurrentOutcome, page: concurrentActionPage },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.SubmitAction;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    reject?.error !== "ActionAlreadySubmitted" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    sameArray(ack?.streamSeqs, reject?.streamSeqs) ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.actor_slot !== "slot_4" ||
    ackCommand?.action_id !== "role_factional_kill" ||
    ackCommand?.template_id !== "factional_kill" ||
    rejectCommand?.actor_slot !== "slot_4" ||
    rejectCommand?.action_id !== "role_factional_kill" ||
    rejectCommand?.template_id !== "factional_kill" ||
    rejectCommand?.targets?.[0] !== ackCommand?.targets?.[0] ||
    !reject?.message?.includes("refresh and use current controls")
  ) {
    throw new Error(
      `concurrent action race outcomes drifted: ${JSON.stringify({
        liveOutcome,
        concurrentOutcome,
      })}`,
    );
  }
  await Promise.all([
    actionPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
    ),
    concurrentActionPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
    ),
    actionPage.waitForFunction(
      () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
    ),
    concurrentActionPage.waitForFunction(
      () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
    ),
  ]);
  const [liveCommandStateAfterRace, concurrentCommandStateAfterRace] =
    await Promise.all([
      actionPage.evaluate(() => window.__fmarchPlayerProjection?.commandState),
      concurrentActionPage.evaluate(() => window.__fmarchPlayerProjection?.commandState),
    ]);
  const [liveReceipt, concurrentReceipt] = await Promise.all([
    actionPage.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
    ),
    concurrentActionPage.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
    ),
  ]);
  const [liveReceiptStatusText, concurrentReceiptStatusText] = await Promise.all([
    actionPage.getByTestId("player-command-status").innerText(),
    concurrentActionPage.getByTestId("player-command-status").innerText(),
  ]);
  const apiCommandStateAfterRace = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  if (
    liveCommandStateAfterRace?.actorSlot !== "slot_4" ||
    liveCommandStateAfterRace?.actorAlive !== true ||
    liveCommandStateAfterRace?.actorStatus !== "alive" ||
    liveCommandStateAfterRace?.phase?.phaseId !== "N01" ||
    liveCommandStateAfterRace?.phase?.locked !== false ||
    liveCommandStateAfterRace?.actions?.length !== 0 ||
    concurrentCommandStateAfterRace?.actorSlot !== "slot_4" ||
    concurrentCommandStateAfterRace?.actorAlive !== true ||
    concurrentCommandStateAfterRace?.actorStatus !== "alive" ||
    concurrentCommandStateAfterRace?.phase?.phaseId !== "N01" ||
    concurrentCommandStateAfterRace?.phase?.locked !== false ||
    concurrentCommandStateAfterRace?.actions?.length !== 0 ||
    apiCommandStateAfterRace?.actor_slot !== "slot_4" ||
    apiCommandStateAfterRace?.actor_alive !== true ||
    apiCommandStateAfterRace?.actor_status !== "alive" ||
    apiCommandStateAfterRace?.phase?.phase_id !== "N01" ||
    apiCommandStateAfterRace?.phase?.locked !== false ||
    apiCommandStateAfterRace?.actions?.length !== 0 ||
    liveReceipt?.actionId !== "submit_action:factional_kill" ||
    concurrentReceipt?.actionId !== "submit_action:factional_kill" ||
    (liveReceipt?.state !== "ack" && liveReceipt?.state !== "reject") ||
    (concurrentReceipt?.state !== "ack" && concurrentReceipt?.state !== "reject") ||
    ![liveReceiptStatusText, concurrentReceiptStatusText].some((text) =>
      text.includes("Ack"),
    ) ||
    ![liveReceiptStatusText, concurrentReceiptStatusText].some((text) =>
      text.includes("Reject ActionAlreadySubmitted"),
    )
  ) {
    throw new Error(
      `concurrent action race recovery drifted: ${JSON.stringify({
        liveCommandStateAfterRace,
        concurrentCommandStateAfterRace,
        liveReceipt,
        concurrentReceipt,
        liveReceiptStatusText,
        concurrentReceiptStatusText,
        apiCommandStateAfterRace,
      })}`,
    );
  }
  return {
    status: "passed",
    staleN01Phase: concurrentActionSetup.staleN01Phase,
    actionConfig: concurrentActionSetup.actionConfig,
    closedStatus: concurrentActionSetup.closedStatus,
    ackPageRole: ackEntry.pageRole,
    rejectPageRole: rejectEntry.pageRole,
    ack,
    reject,
    targetSlot: ackCommand.targets?.[0] ?? null,
    liveOutcome,
    concurrentOutcome,
    liveCommandStateAfterRace,
    concurrentCommandStateAfterRace,
    apiCommandStateAfterRace,
    liveReceipt,
    concurrentReceipt,
    liveReceiptStatusText,
    concurrentReceiptStatusText,
    actionVisibleAfterRefresh: false,
  };
}

async function verifyConcurrentActionRaceReload({
  actionPage,
  hostPage,
  game,
  apiBaseUrl,
  targetSlot,
}) {
  const [actionReload, hostReload] = await Promise.all([
    gotoPlayerBoard(actionPage, game),
    gotoHostConsole(hostPage, game),
  ]);
  await Promise.all([
    actionPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
    ),
    actionPage.waitForFunction(
      () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
    ),
    hostPage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "N01" &&
        window.__fmarchHostProjection?.phase?.locked === true,
    ),
  ]);
  const apiCommandStateAfterReload = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  const apiTargetSlotAfterReload = (
    await fetchHostConsoleState({ apiBaseUrl, game, slot: targetSlot })
  ).slots?.find?.((slot) => slot.slot_id === targetSlot);
  const roleReloadAfterRace = {
    status: "passed",
    actionRouteStatus: actionReload.status,
    hostRouteStatus: hostReload.status,
    actionCommandState: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    actionVisibleAfterReload: await actionPage.evaluate(
      () => document.querySelector('[data-action="submit_action:factional_kill"]') !== null,
    ),
    hostPhase: await hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    hostSlotsAfterReload: await hostPage.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    ),
    apiCommandState: apiCommandStateAfterReload,
    apiTargetSlot: apiTargetSlotAfterReload,
  };
  if (
    roleReloadAfterRace.actionRouteStatus !== 200 ||
    roleReloadAfterRace.hostRouteStatus !== 200 ||
    roleReloadAfterRace.actionCommandState?.actorSlot !== "slot_4" ||
    roleReloadAfterRace.actionCommandState?.phase?.phaseId !== "N01" ||
    roleReloadAfterRace.actionCommandState?.phase?.locked !== true ||
    roleReloadAfterRace.actionCommandState?.actions?.length !== 0 ||
    roleReloadAfterRace.actionVisibleAfterReload !== false ||
    roleReloadAfterRace.hostPhase?.id !== "N01" ||
    roleReloadAfterRace.hostPhase?.locked !== true ||
    roleReloadAfterRace.apiCommandState?.actor_slot !== "slot_4" ||
    roleReloadAfterRace.apiCommandState?.phase?.phase_id !== "N01" ||
    roleReloadAfterRace.apiCommandState?.phase?.locked !== true ||
    roleReloadAfterRace.apiCommandState?.actions?.length !== 0 ||
    roleReloadAfterRace.apiTargetSlot?.slot_id !== targetSlot ||
    roleReloadAfterRace.apiTargetSlot?.alive !== false ||
    roleReloadAfterRace.apiTargetSlot?.status !== "dead"
  ) {
    throw new Error(
      `concurrent action reload did not preserve locked N01 resolution truth: ${JSON.stringify(
        roleReloadAfterRace,
      )}`,
    );
  }
  return roleReloadAfterRace;
}

async function submitActionIdempotentRetry({
  staleActionRetryPage,
  actionRetrySetup,
  legalAction,
  apiBaseUrl,
  game,
}) {
  const legalSubmittedCommand =
    legalAction?.requestEnvelope?.body?.body?.command?.SubmitAction;
  await staleActionRetryPage.evaluate((fixedCommandId) => {
    window.__fmarchPlayerCommandIdFactory = () => fixedCommandId;
  }, legalAction.commandId);
  await clickPlayerActionThroughConfirm(staleActionRetryPage);
  await staleActionRetryPage.waitForFunction(
    () => window.__fmarchPlayerCommandStatus?.state === "ack",
  );
  const retry = await staleActionRetryPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  await staleActionRetryPage.evaluate(() => {
    delete window.__fmarchPlayerCommandIdFactory;
  });
  await staleActionRetryPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
  );
  await staleActionRetryPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const commandStateAfterRetry = await staleActionRetryPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const dispatchPlan = await staleActionRetryPage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const currentReceipt = await staleActionRetryPage.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await staleActionRetryPage
    .getByTestId("player-command-status")
    .innerText();
  const apiCommandStateAfterRetry = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  const retrySubmittedCommand =
    retry?.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (
    retry?.state !== "ack" ||
    retry?.commandId !== legalAction?.commandId ||
    retry?.serverEnvelope?.body?.kind !== "Ack" ||
    !sameArray(retry?.streamSeqs, legalAction?.streamSeqs) ||
    retrySubmittedCommand?.actor_slot !== "slot_4" ||
    retrySubmittedCommand?.action_id !== "role_factional_kill" ||
    retrySubmittedCommand?.template_id !== "factional_kill" ||
    retrySubmittedCommand?.targets?.[0] !== legalSubmittedCommand?.targets?.[0] ||
    dispatchPlan?.projectionRefreshKeys?.includes("notifications") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("investigationResults") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("dayVoteOutcomes") === true ||
    currentReceipt?.actionId !== "submit_action:factional_kill" ||
    currentReceipt?.state !== "ack" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !==
      true ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
      "dayVoteOutcomes",
    ) === true ||
    !receiptStatusText.includes("Ack") ||
    commandStateAfterRetry?.actorSlot !== "slot_4" ||
    commandStateAfterRetry?.actorAlive !== true ||
    commandStateAfterRetry?.actorStatus !== "alive" ||
    commandStateAfterRetry?.phase?.phaseId !== "N01" ||
    commandStateAfterRetry?.phase?.locked !== false ||
    commandStateAfterRetry?.actions?.length !== 0 ||
    apiCommandStateAfterRetry?.actor_slot !== "slot_4" ||
    apiCommandStateAfterRetry?.actor_alive !== true ||
    apiCommandStateAfterRetry?.actor_status !== "alive" ||
    apiCommandStateAfterRetry?.phase?.phase_id !== "N01" ||
    apiCommandStateAfterRetry?.phase?.locked !== false ||
    apiCommandStateAfterRetry?.actions?.length !== 0
  ) {
    throw new Error(
      `action idempotent retry drifted: ${JSON.stringify({
        legalAction,
        retry,
        commandStateAfterRetry,
        dispatchPlan,
        currentReceipt,
        receiptStatusText,
        apiCommandStateAfterRetry,
      })}`,
    );
  }
  return {
    status: "passed",
    staleN01Phase: actionRetrySetup.staleN01Phase,
    actionConfig: actionRetrySetup.actionConfig,
    closedStatus: actionRetrySetup.closedStatus,
    legalActionCommandId: legalAction.commandId,
    legalActionStreamSeqs: legalAction.streamSeqs,
    legalActionTarget: legalSubmittedCommand?.targets?.[0] ?? null,
    retry,
    commandStateAfterRetry,
    dispatchPlan,
    currentReceipt,
    receiptStatusText,
    apiCommandStateAfterRetry,
    actionVisibleAfterRefresh: false,
  };
}

async function submitStaleSameActionRecovery({
  staleSameActionPage,
  staleSameActionSetup,
  legalAction,
  apiBaseUrl,
  game,
}) {
  await clickPlayerActionThroughConfirm(staleSameActionPage);
  await staleSameActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "ActionAlreadySubmitted",
  );
  const reject = await staleSameActionPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  if (!reject.message.includes("refresh and use current controls")) {
    throw new Error(`stale same-action message drifted: ${JSON.stringify(reject)}`);
  }
  await staleSameActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
  );
  await staleSameActionPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const legalSubmittedCommand =
    legalAction?.requestEnvelope?.body?.body?.command?.SubmitAction;
  const phaseAfterReject = await staleSameActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandStateAfterReject = await staleSameActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const dispatchPlan = await staleSameActionPage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const currentReceipt = await staleSameActionPage.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await staleSameActionPage
    .getByTestId("player-command-status")
    .innerText();
  const apiCommandStateAfterReject = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  const submittedCommand =
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
  if (
    reject?.state !== "reject" ||
    reject?.error !== "ActionAlreadySubmitted" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    reject?.commandId === legalAction?.commandId ||
    submittedCommand?.actor_slot !== "slot_4" ||
    submittedCommand?.action_id !== "role_factional_kill" ||
    submittedCommand?.template_id !== "factional_kill" ||
    submittedCommand?.targets?.[0] !== legalSubmittedCommand?.targets?.[0] ||
    dispatchPlan?.projectionRefreshKeys?.includes("notifications") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("investigationResults") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("dayVoteOutcomes") === true ||
    currentReceipt?.actionId !== "submit_action:factional_kill" ||
    currentReceipt?.state !== "reject" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !==
      true ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
      "dayVoteOutcomes",
    ) === true ||
    !receiptStatusText.includes("Reject ActionAlreadySubmitted") ||
    !receiptStatusText.includes("refresh and use current controls") ||
    commandStateAfterReject?.actorSlot !== "slot_4" ||
    commandStateAfterReject?.actorAlive !== true ||
    commandStateAfterReject?.actorStatus !== "alive" ||
    commandStateAfterReject?.phase?.phaseId !== "N01" ||
    commandStateAfterReject?.phase?.locked !== false ||
    commandStateAfterReject?.actions?.length !== 0 ||
    apiCommandStateAfterReject?.actor_slot !== "slot_4" ||
    apiCommandStateAfterReject?.actor_alive !== true ||
    apiCommandStateAfterReject?.actor_status !== "alive" ||
    apiCommandStateAfterReject?.phase?.phase_id !== "N01" ||
    apiCommandStateAfterReject?.phase?.locked !== false ||
    apiCommandStateAfterReject?.actions?.length !== 0
  ) {
    throw new Error(
      `stale same-action recovery drifted: ${JSON.stringify({
        legalAction,
        reject,
        phaseAfterReject,
        commandStateAfterReject,
        dispatchPlan,
        currentReceipt,
        receiptStatusText,
        apiCommandStateAfterReject,
      })}`,
    );
  }
  return {
    status: "passed",
    sourceRoleUrl: staleSameActionSetup.roleUrl,
    visitedRolePath: staleSameActionSetup.visitedRolePath,
    staleN01Phase: staleSameActionSetup.staleN01Phase,
    actionConfig: staleSameActionSetup.actionConfig,
    closedStatus: staleSameActionSetup.closedStatus,
    legalActionCommandId: legalAction.commandId,
    legalActionTarget: legalSubmittedCommand?.targets?.[0] ?? null,
    reject,
    phaseAfterReject,
    commandStateAfterReject,
    dispatchPlan,
    currentReceipt,
    receiptStatusText,
    apiCommandStateAfterReject,
    actionVisibleAfterRefresh: false,
  };
}

async function submitStaleActionConflict({
  staleActionPage,
  staleActionSetup,
  apiBaseUrl,
  game,
}) {
  await clickPlayerActionThroughConfirm(staleActionPage);
  await staleActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  const reject = await staleActionPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  if (
    !reject.message.includes("stale action state") ||
    !reject.message.includes("current action controls")
  ) {
    throw new Error(`stale action message drifted: ${JSON.stringify(reject)}`);
  }
  await staleActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
  );
  await staleActionPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const phaseAfterReject = await staleActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandStateAfterReject = await staleActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const dispatchPlan = await staleActionPage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const currentReceipt = await staleActionPage.evaluate(() =>
    window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
  );
  const receiptStatusText = await staleActionPage
    .getByTestId("player-command-status")
    .innerText();
  const apiCommandStateAfterReject = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
  );
  const submittedCommand =
    reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
  assertLiveStaleN01ActionTransitionRecovery({
    setup: staleActionSetup,
    recovery: {
      status: "passed",
      reject,
      commandStateAfterReject,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      actionVisibleAfterRefresh: false,
    },
    expectedGame: game,
    scenario: liveStaleN01ToD02ActionTransitionScenario({
      targetSlot: submittedCommand?.targets?.[0],
      expectedRefreshKeys: [
        "notifications",
        "investigationResults",
        "commandState",
        "dayVoteOutcomes",
      ],
    }),
    includeEvidenceInError: true,
  });
  if (
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    dispatchPlan?.projectionRefreshKeys?.includes("notifications") !== true ||
    dispatchPlan?.projectionRefreshKeys?.includes("investigationResults") !== true ||
    currentReceipt?.actionId !== "submit_action:factional_kill" ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !==
      true ||
    currentReceipt?.commandTrace?.projectionRefreshKeys?.includes(
      "dayVoteOutcomes",
    ) !== true ||
    commandStateAfterReject?.actorAlive !== true ||
    commandStateAfterReject?.actorStatus !== "alive" ||
    commandStateAfterReject?.phase?.locked !== false ||
    apiCommandStateAfterReject?.actor_slot !== "slot_4" ||
    apiCommandStateAfterReject?.actor_alive !== true ||
    apiCommandStateAfterReject?.actor_status !== "alive" ||
    apiCommandStateAfterReject?.phase?.phase_id !== "D02" ||
    apiCommandStateAfterReject?.phase?.locked !== false ||
    apiCommandStateAfterReject?.actions?.length !== 0
  ) {
    throw new Error(
      `stale action recovery drifted: ${JSON.stringify({
        reject,
        phaseAfterReject,
        commandStateAfterReject,
        dispatchPlan,
        currentReceipt,
        receiptStatusText,
        apiCommandStateAfterReject,
      })}`,
    );
  }
  const reconnectAfterReject = await verifyRoleReconnectRecovery({
    page: staleActionPage,
    game,
    principalUserId: "player-goon-a",
    actorSlot: "slot_4",
    postPrefix: "Stale action reconnect proof",
    navigate: true,
  });
  const buttonsAfterReconnect = await playerCommandButtons(staleActionPage);
  if (
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredSnapshotContainsPost !== true ||
    reconnectAfterReject?.recoveredCommandState?.actorSlot !== "slot_4" ||
    reconnectAfterReject?.recoveredCommandState?.actorAlive !== true ||
    reconnectAfterReject?.recoveredCommandState?.actorStatus !== "alive" ||
    reconnectAfterReject?.recoveredCommandState?.phase?.phaseId !== "D02" ||
    reconnectAfterReject?.recoveredCommandState?.phase?.locked !== false ||
    reconnectAfterReject?.recoveredCommandState?.actions?.length !== 0 ||
    buttonsAfterReconnect.some(
      (button) => button.action === "submit_action:factional_kill",
    )
  ) {
    throw new Error(
      `stale action reconnect recovery drifted: ${JSON.stringify({
        reconnectAfterReject,
        buttonsAfterReconnect,
      })}`,
    );
  }
  return {
    status: "passed",
    sourceRoleUrl: staleActionSetup.roleUrl,
    visitedRolePath: staleActionSetup.visitedRolePath,
    staleN01Phase: staleActionSetup.staleN01Phase,
    actionConfig: staleActionSetup.actionConfig,
    closedStatus: staleActionSetup.closedStatus,
    reject,
    phaseAfterReject,
    commandStateAfterReject,
    dispatchPlan,
    currentReceipt,
    receiptStatusText,
    apiCommandStateAfterReject,
    reconnectAfterReject,
    buttonsAfterReconnect,
    actionVisibleAfterRefresh: false,
  };
}

async function submitStaleDeadActionConflict({
  hostPage,
  actionPage,
  staleDeadActionPage,
  staleDeadActionSetup,
  game,
  apiBaseUrl,
}) {
  const markDead = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: "slot_4",
    status: "dead",
  });
  const apiSlotAfterDead = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot_4",
  });
  await clickPlayerActionThroughConfirm(staleDeadActionPage);
  await staleDeadActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "SlotNotAlive",
  );
  const reject = await staleDeadActionPage.evaluate(
    () => window.__fmarchPlayerCommandStatus,
  );
  if (
    !reject.message.includes("actor is no longer alive") ||
    !reject.message.includes("current action controls")
  ) {
    throw new Error(`stale dead action message drifted: ${JSON.stringify(reject)}`);
  }
  await staleDeadActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "dead" &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
  );
  await staleDeadActionPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const commandStateAfterReject = await staleDeadActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );

  const restoreAlive = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: "slot_4",
    status: "alive",
  });
  const apiSlotAfterRestore = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot_4",
  });
  await actionPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).some(
        (action) => action.templateId === "factional_kill",
      ),
  );
  const liveCommandStateAfterRestore = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  return {
    status: "passed",
    sourceRoleUrl: staleDeadActionSetup.roleUrl,
    visitedRolePath: staleDeadActionSetup.visitedRolePath,
    staleN01Phase: staleDeadActionSetup.staleN01Phase,
    actionConfig: staleDeadActionSetup.actionConfig,
    closedStatus: staleDeadActionSetup.closedStatus,
    markDead,
    apiSlotAfterDead,
    reject,
    commandStateAfterReject,
    actionVisibleAfterRefresh: false,
    restoreAlive,
    apiSlotAfterRestore,
    liveCommandStateAfterRestore,
  };
}

async function setSlotLifecycleViaHost({ hostPage, game, slot, status }) {
  const raw = await sendBrowserCommand(hostPage, {
    principalUserId: "host_h",
    commandId: crypto.randomUUID(),
    command: {
      SetSlotStatus: {
        game,
        slot,
        status,
      },
    },
  });
  if (raw.serverEnvelope?.body?.kind !== "Ack") {
    throw new Error(`SetSlotStatus ${slot}=${status} did not ack: ${JSON.stringify(raw)}`);
  }
  return {
    state: "ack",
    slot,
    status,
    httpStatus: raw.httpStatus,
    requestEnvelope: raw.requestEnvelope,
    serverEnvelope: raw.serverEnvelope,
  };
}

async function verifySeededPrivateChannel({
  browser,
  playerPage,
  deniedPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const { url: privateUrl } = await openPrivateChannelRoleSurface({
    page: playerPage,
    frontendBaseUrl,
    game,
    proofLabel: "private channel member",
  });
  const channelContext = await playerPrivateChannelContext(playerPage);
  const channelContextId = channelContext.channelId;
  if (channelContextId !== factionDayChatChannel) {
    throw new Error(`private channel context drifted: ${channelContextId}`);
  }
  const submitPost = await submitPrivateChannelPost({
    page: playerPage,
    postBody: factionDayChatPostBody,
    expectedState: "ack",
  });
  await playerPage.waitForFunction((expectedBody) =>
    window.__fmarchPlayerProjection?.thread?.posts?.some(
      (post) => post.body === expectedBody,
    ),
    factionDayChatPostBody,
  );
  const submitPostCommand = submitPost.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    submitPostCommand?.channel_id !== factionDayChatChannel ||
    submitPostCommand?.actor_slot !== "slot-7" ||
    submitPostCommand?.body !== factionDayChatPostBody
  ) {
    throw new Error(`private channel SubmitPost drifted: ${JSON.stringify(submitPostCommand)}`);
  }
  const { thread: apiThread, postBodies: apiThreadPostBodies } =
    await fetchPrivateChannelThreadPostBodies({
      apiBaseUrl,
      game,
      principalUserId: "player-mira",
      limit: 50,
    });
  if (!apiThreadPostBodies.includes(factionDayChatPostBody)) {
    throw new Error(`private channel API thread missing submitted post: ${JSON.stringify(apiThread)}`);
  }

  const deniedResponse = await deniedPage.goto(privateUrl, { waitUntil: "networkidle" });
  if (deniedResponse === null || deniedResponse.status() !== 403) {
    throw new Error(
      `private channel denied route expected 403, got ${deniedResponse?.status() ?? "no response"}`,
    );
  }
  await deniedPage.getByTestId("route-error-surface").waitFor({ state: "visible" });
  const status = Number(
    await deniedPage.getByTestId("route-error-surface").getAttribute("data-status"),
  );
  const action = deniedPage.getByTestId("route-error-action");
  const actionLabel = await action.innerText();
  const actionHref = await action.getAttribute("href");
  if (status !== 403 || actionLabel !== "Back to board" || actionHref !== "/") {
    throw new Error(
      `private channel 403 recovery drifted: ${JSON.stringify({ status, actionLabel, actionHref })}`,
    );
  }
  await Promise.all([
    deniedPage.waitForURL(`${frontendBaseUrl}/`, { waitUntil: "networkidle" }),
    action.click(),
  ]);
  await deniedPage.getByTestId("board-surface").waitFor({ state: "visible" });
  const stalePostAfterPhaseTransition =
    await verifyStalePrivateChannelPostAfterPhaseTransition({
      browser,
      apiBaseUrl,
      frontendBaseUrl,
    });
  const completedGameRecovery = await verifyCompletedPrivateChannelRecovery({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
  });

  return {
    status: "passed",
    channel: factionDayChatChannel,
    allowed: {
      url: privateUrl,
      channelContextId,
      submitPost,
      apiThreadPostBodies,
    },
    denied: {
      url: privateUrl,
      status,
      actionLabel,
      actionHref,
      recoveredUrl: deniedPage.url(),
    },
    stalePostAfterPhaseTransition,
    completedGameRecovery,
    proof:
      "The seeded player role URL opened the pack-declared faction day chat, submitted a private-channel post through /commands, the denied player role URL rendered the 403 Back to board recovery for the same channel, a disposable private-channel role URL proved stale SubmitPost recovery after host phase resolution, and another disposable private-channel role URL proved completed-game stale SubmitPost recovery plus reload closure.",
  };
}

function privateChannelRoute() {
  return encodeURIComponent(factionDayChatChannel);
}

function privateChannelRoleUrl({ frontendBaseUrl, game }) {
  return `${frontendBaseUrl}/g/${game}/c/${privateChannelRoute()}`;
}

function privateChannelThreadEndpoint({
  apiBaseUrl,
  game,
  principalUserId,
  limit = 100,
}) {
  return `${apiBaseUrl}/games/${game}/channels/${privateChannelRoute()}/thread?principal_user_id=${principalUserId}&limit=${limit}`;
}

function playerCommandStateEndpoint({
  apiBaseUrl,
  game,
  principalUserId,
  slotId,
}) {
  return `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=${principalUserId}&slot_id=${slotId}`;
}

async function openPrivateChannelRoleSurface({
  page,
  frontendBaseUrl,
  game,
  proofLabel,
}) {
  const url = privateChannelRoleUrl({ frontendBaseUrl, game });
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (response === null || !response.ok()) {
    throw new Error(
      `${proofLabel} private-channel route failed with ${
        response?.status() ?? "no response"
      }`,
    );
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  await page
    .getByTestId("player-command-channel-context")
    .waitFor({ state: "visible" });
  return {
    url,
    responseStatus: response.status(),
  };
}

async function privateChannelRoleSnapshot(page) {
  return {
    commandState: await page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    channelContext: await playerPrivateChannelContext(page),
    buttons: await playerCommandButtons(page),
  };
}

async function closePlayerLiveProjection(page) {
  await page.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
  );
  return page.evaluate(() => window.__fmarchClosePlayerLiveProjection());
}

async function submitPrivateChannelPost({
  page,
  postBody,
  expectedState,
  expectedError,
}) {
  await page.locator('[data-testid="player-composer"] textarea').fill(postBody);
  await page.locator('[data-action="submit_post"]').click();
  await page.waitForFunction(
    ({ expectedBody, expectedChannel, expectedState, expectedError }) => {
      const status = window.__fmarchPlayerCommandStatus;
      const command =
        status?.requestEnvelope?.body?.body?.command?.SubmitPost;
      return (
        command?.body === expectedBody &&
        command?.channel_id === expectedChannel &&
        status?.state === expectedState &&
        (expectedError === null || status?.error === expectedError)
      );
    },
    {
      expectedBody: postBody,
      expectedChannel: factionDayChatChannel,
      expectedState,
      expectedError: expectedError ?? null,
    },
  );
  return page.evaluate(() => window.__fmarchPlayerCommandStatus);
}

async function fetchPrivateChannelThread({
  apiBaseUrl,
  game,
  principalUserId,
  limit = 100,
}) {
  return fetchJson(
    privateChannelThreadEndpoint({
      apiBaseUrl,
      game,
      principalUserId,
      limit,
    }),
  );
}

async function fetchPrivateChannelThreadPostBodies({
  apiBaseUrl,
  game,
  principalUserId,
  limit = 100,
}) {
  const thread = await fetchPrivateChannelThread({
    apiBaseUrl,
    game,
    principalUserId,
    limit,
  });
  return {
    thread,
    postBodies: (thread.posts ?? []).map((post) => post.body),
  };
}

async function fetchPlayerSlotCommandState({
  apiBaseUrl,
  game,
  principalUserId,
  slotId,
}) {
  return fetchJson(
    playerCommandStateEndpoint({
      apiBaseUrl,
      game,
      principalUserId,
      slotId,
    }),
  );
}

async function verifyStalePrivateChannelPostAfterPhaseTransition({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const setup = await openResolvedDayStalePlayerProof({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
    tokenLabel: "stale-private-post",
    slotSevenRoleKey: "encryptor",
    slotFourRoleKey: "mafia_goon",
    playerPathForGame: (game) => `/g/${game}/c/${privateChannelRoute()}`,
  });
  const {
    phaseClosureGame,
    seed,
    hostSession,
    playerSession,
    hostEntry,
    playerEntry,
    commandStateBeforeClose,
    currentVoteBeforeClose,
    buttonsBeforeClose,
    closedStatus,
    hostBeforeResolve,
    resolveDay,
    hostAfterResolve,
    apiCommandStateAfterResolve,
    apiDayVoteOutcomesAfterResolve,
  } = setup;
  try {
    const { channelContext } = await privateChannelRoleSnapshot(
      playerEntry.page,
    );
    const channelContextId = channelContext.channelId;
    const submitPostBeforeClose = buttonsBeforeClose.find(
      (button) => button.action === "submit_post",
    );
    const postBody =
      `Stale private-channel post after D01 phase closure ${crypto.randomUUID()}.`;
    assertPrivateChannelId({
      channelId: channelContextId,
      expectedChannelId: factionDayChatChannel,
      label: "stale private-channel post setup",
      includeEvidenceInError: true,
    });
    if (
      submitPostBeforeClose?.disabled !== false
    ) {
      throw new Error(
        `stale private-channel post setup drifted: ${JSON.stringify({
          phaseClosureGame,
          channelContextId,
          commandStateBeforeClose,
          submitPostBeforeClose,
          buttonsBeforeClose,
        })}`,
      );
    }

    const stalePost = await submitPrivateChannelPost({
      page: playerEntry.page,
      postBody,
      expectedState: "ack",
    });
    const receiptStatusText = await playerEntry.page
      .getByTestId("player-command-status")
      .innerText();
    await playerEntry.page.waitForFunction(
      ({ expectedBody }) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) =>
            post.body === expectedBody &&
            post.authorSlot === "slot-7",
        ) &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ),
      { expectedBody: postBody },
    );
    const projectedPost = await playerEntry.page.evaluate((expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.find(
        (post) => post.body === expectedBody,
      ),
    postBody);
    const commandStateAfterAck = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const channelContextAfterAck = await playerEntry.page
      .getByTestId("player-command-channel-context")
      .getAttribute("data-channel-id");
    assertPrivateChannelId({
      channelId: channelContextAfterAck,
      expectedChannelId: factionDayChatChannel,
      label: "stale private-channel post recovery",
      includeEvidenceInError: true,
    });
    const dispatchPlan = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentReceipt = await playerEntry.page.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find(
        (receipt) => receipt.current === true,
      ),
    );
    const buttonsAfterAck = await playerCommandButtons(playerEntry.page);
    const dayVoteOutcomesAfterAck = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const apiCommandStateAfterAck = await fetchPlayerSlotCommandState({
      apiBaseUrl,
      game: phaseClosureGame,
      principalUserId: "player-mira",
      slotId: "slot-7",
    });
    const { thread: apiThreadAfterAck } =
      await fetchPrivateChannelThreadPostBodies({
        apiBaseUrl,
        game: phaseClosureGame,
        principalUserId: "player-mira",
      });
    const submitPostAckProof = assertLivePrivateChannelSubmitPostAckOutcome({
      outcome: {
        commandStatus: stalePost,
        receiptStatusText,
        dispatchPlan,
        currentReceipt,
        projectedPost,
        commandStateAfterAck,
        buttonsAfterAck,
        dayVoteOutcomesAfterAck,
        apiCommandStateAfterAck,
        apiThreadAfterAck,
      },
      expectedGame: phaseClosureGame,
      postBody,
      expectedChannelId: factionDayChatChannel,
      expectedActorSlot: "slot-7",
      expectedWinnerSlot: "slot-2",
      includeEvidenceInError: true,
    });
    return {
      status: "passed",
      laneId: coreLoopPrivateChannelStalePostLaneId,
      game: phaseClosureGame,
      seed,
      channel: factionDayChatChannel,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      commandStateBeforeClose,
      currentVoteBeforeClose,
      submitPostBeforeClose,
      buttonsBeforeClose,
      closedStatus,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      apiCommandStateAfterResolve,
      apiDayVoteOutcomesAfterResolve,
      postBody,
      stalePost,
      receiptStatusText,
      projectedPost,
      channelContextAfterAck,
      commandStateAfterAck,
      dispatchPlan,
      buttonsAfterAck,
      dayVoteOutcomesAfterAck,
      apiCommandStateAfterAck,
      apiThreadAfterAck,
      submitPostAckProof,
      proof:
        "A disposable private-channel role URL froze on the faction day chat, a disposable host role URL resolved D01 and locked the phase, then the stale private SubmitPost ACKed while refreshing the private thread, locked commandState, and day-vote outcome truth.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyCompletedPrivateChannelRecovery({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  if (browser === null || browser === undefined) {
    throw new Error("completed private-channel proof requires a Playwright browser");
  }
  const completeGame = crypto.randomUUID();
  const seed = await seedPrivateChannelCompleteGame({ game: completeGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${completeGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const playerSession = await createAccountLoginCredential({
    principalUserId: "player-mira",
    returnTo: `/g/${completeGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: completeGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: playerSession,
    game: completeGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D01",
      locked: false,
    });
    await hostEntry.page
      .getByTestId("critical-host-action-complete_game")
      .waitFor({ state: "visible" });

    const completedRoute = await openPrivateChannelRoleSurface({
      page: playerEntry.page,
      frontendBaseUrl,
      game: completeGame,
      proofLabel: "completed",
    });
    const sourceRoleUrl = completedRoute.url;
    const visitedRolePath = rolePathFromUrl(sourceRoleUrl);
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === false,
    );
    const {
      commandState: commandStateBeforeComplete,
      channelContext: channelContextBeforeComplete,
      buttons: buttonsBeforeComplete,
    } = await privateChannelRoleSnapshot(playerEntry.page);
    const submitPostBeforeComplete = buttonsBeforeComplete.find(
      (button) => button.action === "submit_post",
    );
    const closedStatus = await closePlayerLiveProjection(playerEntry.page);

    const complete = await confirmHostAction(hostEntry.page, "complete_game");
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true ||
        (window.__fmarchHostProjection?.slots ?? []).every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    );
    const hostSlotsAfterComplete = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    );
    const hostActionsAfterComplete = await visibleHostControlActions(
      hostEntry.page,
      "roles",
    );
    const apiStateAfterComplete = await fetchHostConsoleState({
      apiBaseUrl,
      game: completeGame,
    });

    const postBody =
      `Completed private-channel stale post ${crypto.randomUUID()}.`;
    const reject = await submitPrivateChannelPost({
      page: playerEntry.page,
      postBody,
      expectedState: "reject",
      expectedError: "GameAlreadyCompleted",
    });
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0,
    );
    const {
      commandState: commandStateAfterReject,
      channelContext: channelContextAfterReject,
      buttons: buttonsAfterReject,
    } = await privateChannelRoleSnapshot(playerEntry.page);
    const dispatchPlan = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentReceipt = await playerEntry.page.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find(
        (receipt) => receipt.current === true,
      ),
    );
    const receiptStatusText = await playerEntry.page
      .getByTestId("player-command-status")
      .innerText();
    const threadPostBodiesAfterReject = await playerEntry.page.evaluate(() =>
      (window.__fmarchPlayerProjection?.thread?.posts ?? []).map(
        (post) => post.body,
      ),
    );
    const apiCommandStateAfterReject = await fetchPlayerSlotCommandState({
      apiBaseUrl,
      game: completeGame,
      principalUserId: "player-mira",
      slotId: "slot-7",
    });
    const { thread: apiThreadAfterReject, postBodies: apiThreadPostBodies } =
      await fetchPrivateChannelThreadPostBodies({
        apiBaseUrl,
        game: completeGame,
        principalUserId: "player-mira",
      });

    const reloadRoute = await openPrivateChannelRoleSurface({
      page: playerEntry.page,
      frontendBaseUrl,
      game: completeGame,
      proofLabel: "completed reload",
    });
    await playerEntry.page.waitForFunction(
      ({ expectedChannelId, rejectedBody }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        document
          .querySelector("[data-testid='player-command-channel-context']")
          ?.getAttribute("data-channel-id") === expectedChannelId &&
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).some(
          (post) => post.body === rejectedBody,
        ) === false,
      { expectedChannelId: factionDayChatChannel, rejectedBody: postBody },
    );
    const reloadProjection = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection,
    );
    const {
      channelContext: reloadChannelContext,
      buttons: reloadButtons,
    } = await privateChannelRoleSnapshot(playerEntry.page);
    const reloadThreadPostBodies = (
      reloadProjection?.thread?.posts ?? []
    ).map((post) => post.body);
    const reloadRejectedPostVisible =
      (await playerEntry.page.getByText(postBody, { exact: true }).count()) > 0;
    const reloadThreadPagerVisible = await playerEntry.page
      .getByTestId("player-thread-pager")
      .isVisible();
    const apiCommandStateAfterReload = await fetchPlayerSlotCommandState({
      apiBaseUrl,
      game: completeGame,
      principalUserId: "player-mira",
      slotId: "slot-7",
    });
    const { postBodies: apiThreadPostBodiesAfterReload } =
      await fetchPrivateChannelThreadPostBodies({
        apiBaseUrl,
        game: completeGame,
        principalUserId: "player-mira",
      });
    const reloadAfterReject = {
      status: "passed",
      routeResponseStatus: reloadRoute.responseStatus,
      threadPagerVisible: reloadThreadPagerVisible,
      recoveredCommandState: reloadProjection?.commandState ?? null,
      reloadChannelContext,
      reloadButtons,
      reloadThreadPostBodies,
      reloadRejectedPostVisible,
      apiCommandStateAfterReload,
      apiThreadPostBodiesAfterReload,
    };
    assertPrivateChannelContext({
      context: channelContextBeforeComplete,
      expectedChannelId: factionDayChatChannel,
      expectedActorSlot: "slot-7",
      requireCapabilityLabel: true,
      label: "completed private-channel setup",
      includeEvidenceInError: true,
    });
    assertPrivateChannelContext({
      context: channelContextAfterReject,
      expectedChannelId: factionDayChatChannel,
      expectedActorSlot: "slot-7",
      label: "completed private-channel reject recovery",
      includeEvidenceInError: true,
    });
    assertPrivateChannelRouteContext({
      context: reloadAfterReject.reloadChannelContext,
      expectedChannelId: factionDayChatChannel,
      expectedActorSlot: "slot-7",
      privateThreadPagerVisible: reloadAfterReject.threadPagerVisible,
      requireCapabilityLabel: true,
      label: "completed private-channel reload recovery",
      includeEvidenceInError: true,
    });
    const completedPostRejectProof =
      assertLiveCompletedPrivateChannelPostRejectOutcome({
      outcome: {
        commandStatus: reject,
        dispatchPlan,
        currentReceipt,
        receiptStatusText,
        commandStateAfterReject,
        buttonsAfterReject,
        apiCommandStateAfterReject,
        apiThreadPostBodies,
        reloadAfterReject,
        submitDisabledBeforeReject: submitPostBeforeComplete?.disabled,
        threadPostBodiesAfterReject,
      },
      expectedGame: completeGame,
      postBody,
      sourceRoleUrl,
      visitedRolePath,
      expectedChannelId: factionDayChatChannel,
      expectedActorSlot: "slot-7",
      expectedPrincipalUserId: "player-mira",
      includeEvidenceInError: true,
    });

    if (
      seed.privateChannel !== factionDayChatChannel ||
      commandStateBeforeComplete?.actorSlot !== "slot-7" ||
      commandStateBeforeComplete?.gameCompleted !== false ||
      submitPostBeforeComplete?.disabled !== false ||
      closedStatus?.state !== "closed" ||
      complete?.commandStatus?.state !== "ack" ||
      complete?.commandStatus?.requestEnvelope?.body?.body?.command?.CompleteGame
        ?.game !== completeGame ||
      hostSlotsAfterComplete.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      hostActionsAfterComplete.includes("complete_game") ||
      apiStateAfterComplete.completed !== true
    ) {
      throw new Error(
        `completed private-channel recovery drifted: ${JSON.stringify({
          completeGame,
          seed,
          commandStateBeforeComplete,
          channelContextBeforeComplete,
          buttonsBeforeComplete,
          submitPostBeforeComplete,
          closedStatus,
          complete,
          hostSlotsAfterComplete,
          hostActionsAfterComplete,
          apiStateAfterComplete,
          reject,
          commandStateAfterReject,
          channelContextAfterReject,
          buttonsAfterReject,
          dispatchPlan,
          currentReceipt,
          receiptStatusText,
          apiCommandStateAfterReject,
          apiThreadPostBodies,
          reloadAfterReject,
          postBody,
        })}`,
      );
    }

    return {
      status: "passed",
      laneId: coreLoopPrivateChannelCompletedPostLaneId,
      game: completeGame,
      seed,
      channel: factionDayChatChannel,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      sourceRoleUrl,
      visitedRolePath,
      commandStateBeforeComplete,
      channelContextBeforeComplete,
      buttonsBeforeComplete,
      submitPostBeforeComplete,
      closedStatus,
      complete,
      hostSlotsAfterComplete,
      hostActionsAfterComplete,
      apiStateAfterComplete,
      postBody,
      reject,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      commandStateAfterReject,
      channelContextAfterReject,
      buttonsAfterReject,
      apiCommandStateAfterReject,
      apiThreadAfterReject,
      apiThreadPostBodies,
      threadPostBodiesAfterReject,
      reloadAfterReject,
      completedPostRejectProof,
      proof:
        "A disposable private-channel role URL froze on the faction day chat, a disposable host role URL completed the game, then the stale private SubmitPost rejected GameAlreadyCompleted and the private-channel role URL reloaded into completed disabled controls without appending the rejected post.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function seedPrivateChannelCompleteGame({ game }) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(game)) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game,
    commands: commands.length,
    privateChannel: factionDayChatChannel,
    actorSlot: "slot-7",
    actorPrincipalUserId: "player-mira",
  };
}

async function playerPrivateChannelContext(page) {
  const context = page.getByTestId("player-command-channel-context");
  return {
    channelId: await context.getAttribute("data-channel-id"),
    actorSlot: await context.getAttribute("data-actor-slot"),
    actorStatus: await context.getAttribute("data-actor-status"),
    capabilityLabel: await context.getAttribute("data-capability-label"),
  };
}

async function verifySeededMultiplayerHardening({
  hostPage,
  playerPage,
  actionPage,
  concurrentActionRace,
  actionIdempotentRetry,
  staleSameActionRecovery,
  staleActionConflict,
  privateChannelStaleActionReconnectRecovery,
  staleDeadActionConflict,
  staleHostPage,
  staleHostControlSetup,
  staleHostResolvePage,
  staleHostAdvancePage,
  staleHostPublishPage,
  staleHostLifecyclePage,
  staleHostModkillPage,
  staleHostDeadlinePage,
  staleHostDeadlineSetup,
  staleCohostPage,
  staleCohostDeadlineSetup,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const { normalizeCommandResponse } = await importFrontendModule(
    "src/lib/app/command-boundary.mjs",
  );
  const { normalizeServerCommandEnvelope } = await importFrontendModule(
    "src/lib/components/host-action/host-command-boundary.mjs",
  );
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  const staleHostControl = await submitStaleHostControlRecovery({
    staleHostPage,
    staleHostControlSetup,
    apiBaseUrl,
    game,
  });

  const retryCommandId = crypto.randomUUID();
  const retryPostBody = `Idempotent retry post from dev:test-game ${retryCommandId}.`;
  const submitPostCommand = {
    SubmitPost: {
      game,
      channel_id: hardeningRetryChannel,
      actor_slot: "slot-7",
      body: retryPostBody,
    },
  };
  const firstPostRaw = await sendBrowserCommand(playerPage, {
    principalUserId: "player-mira",
    command: submitPostCommand,
    commandId: retryCommandId,
  });
  const retryPostRaw = await sendBrowserCommand(playerPage, {
    principalUserId: "player-mira",
    command: submitPostCommand,
    commandId: retryCommandId,
  });
  const firstPost = normalizeCommandResponse({
    commandId: retryCommandId,
    requestEnvelope: firstPostRaw.requestEnvelope,
    response: { status: firstPostRaw.httpStatus },
    serverEnvelope: firstPostRaw.serverEnvelope,
  });
  const retryPost = normalizeCommandResponse({
    commandId: retryCommandId,
    requestEnvelope: retryPostRaw.requestEnvelope,
    response: { status: retryPostRaw.httpStatus },
    serverEnvelope: retryPostRaw.serverEnvelope,
  });
  if (firstPost.state !== "ack" || retryPost.state !== "ack") {
    throw new Error(
      `expected duplicate command id to ack twice: ${JSON.stringify({ firstPost, retryPost })}`,
    );
  }
  if (!sameArray(firstPost.streamSeqs, retryPost.streamSeqs)) {
    throw new Error(
      `duplicate command id returned different stream seqs: ${JSON.stringify({
        first: firstPost.streamSeqs,
        retry: retryPost.streamSeqs,
      })}`,
    );
  }
  const mainThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${hardeningRetryChannel}/thread?principal_user_id=player-mira&limit=100`,
  );
  const retryPostCount = mainThread.posts.filter((post) => post.body === retryPostBody).length;
  if (retryPostCount !== 1) {
    throw new Error(
      `duplicate command id appended ${retryPostCount} matching posts: ${JSON.stringify(
        mainThread.posts.map((post) => post.body),
      )}`,
    );
  }

  const reconnect = await verifyPlayerReconnectRecovery({
    playerPage,
    game,
  });
  const stalePlayerVote = await verifyStalePlayerVoteRecovery({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    normalizeServerCommandEnvelope,
  });
  const stalePlayerVoteAfterChange = await verifyStalePlayerVoteAfterVotecountChange({
    playerPage,
    actionPage,
    game,
    apiBaseUrl,
    frontendBaseUrl,
    normalizeCommandResponse,
  });
  const stalePlayerWithdrawAfterChange = await verifyStalePlayerWithdrawAfterVoteChange({
    playerPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
  });
  const stalePlayerWithdrawAfterPhaseClosure =
    await verifyStalePlayerWithdrawAfterPhaseClosure({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const stalePlayerVoteAfterPhaseClosure =
    await verifyStalePlayerVoteAfterPhaseClosure({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const stalePlayerPostAfterPhaseClosure =
    await verifyStalePlayerPostAfterPhaseClosure({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const concurrentPlayerVoteResolveRace =
    await verifyConcurrentPlayerVoteResolveRace({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const concurrentPlayerActionAdvanceRace =
    await verifyConcurrentPlayerActionAdvanceRace({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
    });
  const concurrentCohostDeadlineResolveRace =
    await verifyConcurrentCohostDeadlineResolveRace({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
    });
  const concurrentReplacementPrivatePostRace =
    await verifyConcurrentReplacementPrivatePostRace({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const concurrentReplacementVoteRace = await verifyConcurrentReplacementVoteRace({
    browser: playerPage.context().browser(),
    apiBaseUrl,
    frontendBaseUrl,
    normalizeCommandResponse,
  });
  const concurrentReplacementActionRace =
    await verifyConcurrentReplacementActionRace({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const replacementIncomingAction =
    await verifyIncomingReplacementActionSubmission({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const replacementActionReconnect =
    await verifyReplacementActionReconnectRecovery({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const replacementStaleActionAfterResolve =
    await verifyStaleReplacementActionAfterResolve({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const replacementStalePrivatePostAfterResolve =
    await verifyStaleReplacementPrivatePostAfterResolve({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const replacementStalePrivatePostAfterComplete =
    await verifyStaleReplacementPrivatePostAfterComplete({
      browser: playerPage.context().browser(),
      apiBaseUrl,
      frontendBaseUrl,
      normalizeCommandResponse,
    });
  const staleDeadTargetVote = await verifyStaleDeadTargetVoteRecovery({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
  });
  const deadCurrentVote = await verifyDeadCurrentVoteRecovery({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const concurrentVoteRace = await verifyConcurrentVoteRace({
    playerPage,
    actionPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
  });
  const staleHostPublishAfterChange = await verifyStaleHostPublishAfterVotecountChange({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    frontendBaseUrl,
    concurrentVoteRace,
    normalizeCommandResponse,
  });
  const staleHostPublishSetup = await freezeStaleHostPublishPage({
    staleHostPublishPage,
    game,
    frontendBaseUrl,
    concurrentVoteRace,
  });
  const hostVotecountPublication = await verifyHostVotecountPublication({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    concurrentVoteRace,
  });
  const concurrentHostPublishRace = await verifyConcurrentHostPublishRace({
    hostPage,
    playerPage,
    apiBaseUrl,
  });
  const staleHostPublish = await submitStaleHostPublishRecovery({
    staleHostPublishPage,
    staleHostPublishSetup,
    hostVotecountPublication,
    playerPage,
    apiBaseUrl,
    game,
  });
  const staleHostLifecycleSetup = await freezeStaleHostLifecyclePage({
    staleHostLifecyclePage,
    game,
    frontendBaseUrl,
  });
  const hostLifecycleControl = await verifyHostLifecycleControl({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
    staleHostLifecyclePage,
    staleHostLifecycleSetup,
  });
  const staleHostLifecycle = hostLifecycleControl.staleDuplicateStatus;
  const staleHostModkillSetup = await freezeStaleHostLifecyclePage({
    staleHostLifecyclePage: staleHostModkillPage,
    game,
    frontendBaseUrl,
  });
  const hostModkillControl = await verifyHostModkillControl({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
    staleHostLifecyclePage: staleHostModkillPage,
    staleHostLifecycleSetup: staleHostModkillSetup,
  });
  const staleHostModkill = hostModkillControl.staleDuplicateStatus;
  const concurrentHostLifecycleRace = await verifyConcurrentHostLifecycleRace({
    hostPage,
    playerPage,
    apiBaseUrl,
    frontendBaseUrl,
    normalizeCommandResponse,
  });

  const staleHostDeadline = await submitStaleHostDeadlineRecovery({
    staleHostDeadlinePage,
    staleHostDeadlineSetup,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const staleCohostDeadline = await submitStaleCohostDeadlineRecovery({
    staleCohostPage,
    staleCohostDeadlineSetup,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const concurrentHostResolveRace = await verifyConcurrentHostResolveRace({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const concurrentHostAdvanceRace = await verifyConcurrentHostAdvanceRace({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const concurrentHostDeadlineAdvanceRace = await verifyConcurrentHostDeadlineAdvanceRace({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const concurrentHostMixedAdvanceRace = await verifyConcurrentHostMixedAdvanceRace({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const staleHostResolveSetup = await freezeStaleHostResolvePage({
    staleHostResolvePage,
    game,
    frontendBaseUrl,
  });
  const liveResolveForStaleHostResolve = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: true });
  const staleHostResolveRecovery = await submitStaleHostResolveRecovery({
    staleHostResolvePage,
    staleHostResolveSetup,
    liveResolveForStaleHostResolve,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const staleHostAdvanceSetup = await freezeStaleHostAdvancePage({
    staleHostAdvancePage,
    game,
    frontendBaseUrl,
  });
  const restoreAfterStaleHostResolve = await confirmHostAction(hostPage, "unlock_thread");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  const hostStateAfterResolveRestore = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    restoreAfterStaleHostResolve.commandStatus?.state !== "ack" ||
    hostStateAfterResolveRestore.phase?.phase_id !== "D02" ||
    hostStateAfterResolveRestore.phase?.locked !== false
  ) {
    throw new Error(
      `stale host resolve restore drifted: ${JSON.stringify({
        restoreAfterStaleHostResolve,
        apiPhase: hostStateAfterResolveRestore.phase,
      })}`,
    );
  }
  const staleHostResolve = {
    ...staleHostResolveRecovery,
    restoreAfterReject: restoreAfterStaleHostResolve,
    apiPhaseAfterRestore: hostStateAfterResolveRestore.phase,
  };
  const staleHostAdvance = await submitStaleHostAdvanceRecovery({
    staleHostAdvancePage,
    staleHostAdvanceSetup,
    restoreAfterStaleHostResolve,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const staleHostPrompt = await verifyStaleHostPromptRecovery({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const staleHostComplete = await verifyStaleHostCompleteRecovery({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
    game,
  });
  const concurrentHostCompleteRace = await verifyConcurrentHostCompleteRace({
    hostPage,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const concurrentPlayerCompleteRace = await verifyConcurrentPlayerCompleteRace({
    hostPage,
    playerPage,
    apiBaseUrl,
    frontendBaseUrl,
    normalizeCommandResponse,
  });
  const stalePlayerComplete = await verifyStalePlayerCompleteRecovery({
    playerPage,
    apiBaseUrl,
    frontendBaseUrl,
    normalizeCommandResponse,
  });

  return {
    status: "passed",
    idempotentRetry: {
      channel: hardeningRetryChannel,
      commandId: retryCommandId,
      body: retryPostBody,
      firstPost,
      retryPost,
      projectedPostCount: retryPostCount,
    },
    reconnect,
    stalePlayerVote,
    stalePlayerVoteAfterChange,
    stalePlayerWithdrawAfterChange,
    stalePlayerWithdrawAfterPhaseClosure,
    stalePlayerVoteAfterPhaseClosure,
    stalePlayerPostAfterPhaseClosure,
    concurrentPlayerVoteResolveRace,
    concurrentPlayerActionAdvanceRace,
    concurrentCohostDeadlineResolveRace,
    concurrentReplacementPrivatePostRace,
    concurrentReplacementVoteRace,
    concurrentReplacementActionRace,
    replacementIncomingAction,
    replacementActionReconnect,
    replacementStaleActionAfterResolve,
    replacementStalePrivatePostAfterResolve,
    replacementStalePrivatePostAfterComplete,
    staleDeadTargetVote,
    deadCurrentVote,
    concurrentVoteRace,
    staleHostPublishAfterChange,
    hostVotecountPublication,
    concurrentHostPublishRace,
    staleHostPublish,
    staleHostLifecycle,
    hostLifecycleControl,
    hostModkillControl,
    staleHostModkill,
    concurrentHostLifecycleRace,
    concurrentActionRace,
    actionIdempotentRetry,
    staleSameActionRecovery,
    staleDeadActionConflict,
    staleActionConflict,
    privateChannelStaleActionReconnectRecovery,
    staleHostControl,
    concurrentHostResolveRace,
    concurrentHostAdvanceRace,
    concurrentHostDeadlineAdvanceRace,
    concurrentHostMixedAdvanceRace,
    staleHostResolve,
    staleHostAdvance,
    staleHostPrompt,
    staleHostComplete,
    concurrentHostCompleteRace,
    concurrentPlayerCompleteRace,
    stalePlayerComplete,
    staleHostDeadline,
    staleCohostDeadline,
    proof:
      "The seeded player role URL replayed the same SubmitPost command_id through /commands and got the original ACK with one projected post, recovered a dropped live projection through reconnect, refreshed command state after a stale locked-phase vote reject, ACKed a stale player vote after another role changed the live votecount and refreshed to the current combined projection, ACKed a stale withdraw after the same slot's live ballot changed and refreshed to no current vote, rejected stale withdraw and submit-vote controls after host phase resolution with PhaseLocked and refreshed to locked commandState plus day-vote outcome truth, ACKed a stale submit-post control after host phase resolution while refreshing thread, locked commandState, and day-vote outcome truth, proved a player SubmitVote racing host ResolvePhase either serializes before resolution or rejects with PhaseLocked, then reloads player and host role URLs to locked day-vote outcome truth, proved a stale N01 factional_kill control racing host AdvancePhase rejects without appending, then action-player and host role URLs reload to open D02, proved a private-channel stale N01 factional_kill control rejects on D02 with explicit PhaseLocked recovery copy, keeps private-channel scope, and reconnects on the same private route without action controls, proved a cohost ExtendDeadline racing host ResolvePhase either serializes the deadline before resolution or rejects PhaseLocked, then reloads host and cohost role URLs to locked D01 deadline truth, proved stale Slot 7 private-post and vote commands plus a stale Slot 4 factional_kill command racing host ProcessReplacement either serialize before replacement or reject with NotYourSlot while the stale outgoing role loses command-state authority and Rowan becomes current occupant, proved an incoming Rowan Slot 4 factional_kill resolves and survives replacement reconnect into locked N01 without action controls while target kill receipts stay scoped, proved Rowan's stale replacement action after host N01 resolution rejects PhaseLocked, appends no action, and keeps target receipts scoped, proved Rowan's stale replacement private post after host D01 resolution ACKs while refreshing to locked private-channel and command-state truth, proved Rowan's stale replacement private post after CompleteGame rejects GameAlreadyCompleted while refreshing to completed-game truth, then reloaded Rowan's private channel route into completed-game disabled controls while Mira stayed forbidden, refreshed to the current legal vote target set after a stale dead-target vote rejected as InvalidTarget, cleared an existing current vote and live votecount row when its target was marked dead, proved two concurrent player vote commands converge, then reload both player role URLs, to the same current-vote and projected-votecount truth, proved a concurrent factional_kill race converges with one stored action and one ActionAlreadySubmitted recovery, then reloads action-player and host role URLs to locked N01 dead-target truth, proved two host role pages racing D02 resolve_phase converge with one ACK, one PhaseLocked recovery, and a restored open D02, proved two host role pages racing D02 advance_phase converge with one ACK, one InvalidTarget recovery, and open N02, proved two host role pages racing D01 advance_phase_by_deadline converge with one deadline evidence ACK, one InvalidTarget recovery, no duplicate deadline evidence, and open N01, proved two host role pages racing D01 advance_phase against advance_phase_by_deadline converge with one ACK, one InvalidTarget recovery, no duplicate deadline evidence, and open N01, proved a stale host PublishVotecount after a live non-empty votecount change publishes the current server-derived body instead of the frozen body, proved the seeded host role URL can publish that official votecount from the browser control into the public thread, proved two host role pages racing PublishVotecount converge with one official count, one InvalidTarget recovery, and reloaded host/player role URLs still showing one official post, proved a stale host PublishVotecount rejects without appending a duplicate official count, proved the seeded host role URL can mark Slot 7 dead and modkilled through browser controls while the affected player role URL loses controls with SlotNotAlive recovery before the seed is restored each time, proved stale host Mark dead and Modkill slot controls reject without duplicating a current lifecycle status, proved two host role pages racing Mark dead against Modkill slot converge to one terminal slot status with one InvalidTarget lifecycle recovery and disabled affected-player controls, proved stale host ResolvePhase recovery reloads the host console to locked D02 truth with current unlock/advance controls, proved stale host AdvancePhase recovery reloads the host console to open D02 truth with current resolve/lock controls, proved stale host ExtendDeadline recovery reloads the host console to open D02 truth with current deadline/phase controls, proved stale cohost ExtendDeadline recovery reloads the delegated host console to open D02 truth with host-only phase controls still absent, proved stale host ResolveHostPrompt recovery reloads the host console to resolved prompt truth with the stale prompt action hidden, proved two host role pages racing CompleteGame converge with one revealed endgame and one GameAlreadyCompleted recovery, proved stale host CompleteGame recovery reloads the host console to revealed endgame truth with complete_game hidden, proved a player SubmitPost racing CompleteGame either serializes before completion or rejects with GameAlreadyCompleted, then reloaded the public player board to Endgame with disabled controls and exactly the legal post outcome, proved stale player completed-game recovery reloads the public board to Endgame with no current vote, no vote targets, and no thread mutation, proved a frozen N01 action control replays the same command_id and receives the original ACK, proved another frozen N01 action control rejects and refreshes after its actor is temporarily marked dead, preserved another frozen N01 action page until it rejected with stale PhaseLocked recovery on D02, then stale seeded host phase/deadline/resolve/advance/prompt/complete-game, stale player completed-game, and cohost deadline role URLs clicked old controls, rendered command receipts, refreshed or reloaded to current projections, and exposed their current valid control sets.",
  };
}

async function verifyStaleHostPromptRecovery({
  hostPage,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const promptGame = crypto.randomUUID();
  const promptId = "D01:skip_next_day:slot_1";
  const actionId = "resolve_host_prompt-D01-skip_next_day-slot_1";
  const seed = await seedHostPromptRecoveryGame({ promptGame, promptId });
  const context = hostPage.context();
  const livePromptPage = await context.newPage();
  let stalePromptRecovery;
  try {
    stalePromptRecovery = await prepareStaleHostPromptRecovery({
      context,
      frontendBaseUrl,
      promptGame,
      actionId,
      promptId,
    });
    await livePromptPage.goto(`${frontendBaseUrl}/g/${promptGame}/host`, {
      waitUntil: "networkidle",
    });
    await livePromptPage
      .getByTestId(`critical-host-action-${actionId}`)
      .waitFor({ state: "visible" });
    const liveResolve = await confirmHostAction(livePromptPage, actionId);
    await livePromptPage.waitForFunction(
      (expectedPromptId) =>
        window.__fmarchHostPromptsProjection?.some(
          (prompt) => prompt.id === expectedPromptId && prompt.status === "resolved",
        ),
      promptId,
    );
    const staleRecovery = await stalePromptRecovery.submit({
      liveResolve,
      apiBaseUrl,
    });
    return {
      status: "passed",
      game: promptGame,
      promptId,
      actionId,
      seed,
      liveResolve,
      ...staleRecovery,
      proof:
        "A disposable local host-prompt game created a Beloved Princess skip-next-day prompt, froze one host role URL with the pending Resolve prompt control, resolved it from a live host role URL, then clicked the stale prompt control and recovered through PromptAlreadyResolved without ACK stream seqs while refreshing hostPrompts to the resolved state, then reloaded the host role URL to prove resolved prompt truth with the stale Resolve action hidden.",
    };
  } finally {
    await stalePromptRecovery?.close();
    await livePromptPage.close().catch(() => {});
  }
}

async function seedHostPromptRecoveryGame({ promptGame, promptId }) {
  const plan = [
    ["host_h", { CreateGame: { game: promptGame, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_1" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_2" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_3" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_5" } }],
    ["host_h", { AddSlot: { game: promptGame, slot: "slot_6" } }],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_1", user: "prompt-user-1" } }],
    [
      "host_h",
      { AssignRole: { game: promptGame, slot: "slot_1", role_key: "beloved_princess" } },
    ],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_2", user: "prompt-user-2" } }],
    [
      "host_h",
      { AssignRole: { game: promptGame, slot: "slot_2", role_key: "vanilla_townie" } },
    ],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_3", user: "prompt-user-3" } }],
    [
      "host_h",
      { AssignRole: { game: promptGame, slot: "slot_3", role_key: "vanilla_townie" } },
    ],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_4", user: "prompt-user-4" } }],
    ["host_h", { AssignRole: { game: promptGame, slot: "slot_4", role_key: "mafia_goon" } }],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_5", user: "prompt-user-5" } }],
    ["host_h", { AssignRole: { game: promptGame, slot: "slot_5", role_key: "mafia_goon" } }],
    ["host_h", { AssignSlot: { game: promptGame, slot: "slot_6", user: "prompt-user-6" } }],
    [
      "host_h",
      { AssignRole: { game: promptGame, slot: "slot_6", role_key: "vanilla_townie" } },
    ],
    ["host_h", { StartGame: { game: promptGame, phase: "D01" } }],
    [
      "prompt-user-2",
      { SubmitVote: { game: promptGame, actor_slot: "slot_2", target: { Slot: "slot_1" } } },
    ],
    [
      "prompt-user-3",
      { SubmitVote: { game: promptGame, actor_slot: "slot_3", target: { Slot: "slot_1" } } },
    ],
    [
      "prompt-user-4",
      { SubmitVote: { game: promptGame, actor_slot: "slot_4", target: { Slot: "slot_1" } } },
    ],
    [
      "prompt-user-5",
      { SubmitVote: { game: promptGame, actor_slot: "slot_5", target: { Slot: "slot_1" } } },
    ],
    ["host_h", { ResolvePhase: { game: promptGame, seed: 7421 } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game: promptGame,
    promptId,
    commands: commands.length,
  };
}

async function prepareStaleHostPromptRecovery({
  context,
  frontendBaseUrl,
  promptGame,
  actionId,
  promptId,
}) {
  if (
    actionId === null ||
    actionId === undefined ||
    promptId === null ||
    promptId === undefined
  ) {
    return {
      stalePromptPage: null,
      setup: null,
      submit: async () => null,
      close: async () => {},
    };
  }
  const stalePromptPage = await context.newPage();
  try {
    const setup = await freezeStaleHostPromptPage({
      stalePromptPage,
      frontendBaseUrl,
      promptGame,
      actionId,
      promptId,
    });
    return {
      stalePromptPage,
      setup,
      submit: async ({ liveResolve, apiBaseUrl, expectedReloadPhase } = {}) =>
        submitStaleHostPromptRecovery({
          stalePromptPage,
          setup,
          liveResolve,
          apiBaseUrl,
          frontendBaseUrl,
          promptGame,
          actionId,
          promptId,
          expectedReloadPhase,
        }),
      close: async () => {
        await stalePromptPage.close().catch(() => {});
      },
    };
  } catch (error) {
    await stalePromptPage.close().catch(() => {});
    throw error;
  }
}

async function freezeStaleHostPromptPage({
  stalePromptPage,
  frontendBaseUrl,
  promptGame,
  actionId,
  promptId,
}) {
  await stalePromptPage.goto(`${frontendBaseUrl}/g/${promptGame}/host`, {
    waitUntil: "networkidle",
  });
  await stalePromptPage
    .getByTestId(`critical-host-action-${actionId}`)
    .waitFor({ state: "visible" });
  await stalePromptPage.waitForFunction(
    (expectedPromptId) =>
      window.__fmarchHostPromptsProjection?.some(
        (prompt) => prompt.id === expectedPromptId && prompt.status === "pending",
      ),
    promptId,
  );
  const prompts = await stalePromptPage.evaluate(() => window.__fmarchHostPromptsProjection);
  const promptActions = await visibleHostControlActions(stalePromptPage, "host-prompts");
  const closedStatus = await stalePromptPage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    !prompts?.some((prompt) => prompt.id === promptId && prompt.status === "pending") ||
    !promptActions.includes(actionId) ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host prompt setup drifted: ${JSON.stringify({
        promptGame,
        promptId,
        prompts,
        promptActions,
        closedStatus,
      })}`,
    );
  }
  return {
    game: promptGame,
    promptId,
    promptActions,
    prompts,
    closedStatus,
  };
}

async function submitStaleHostPromptRecovery({
  stalePromptPage,
  setup,
  liveResolve,
  apiBaseUrl,
  frontendBaseUrl,
  promptGame,
  actionId,
  promptId,
  expectedReloadPhase,
}) {
  const action = await confirmHostAction(stalePromptPage, actionId, "reject");
  await stalePromptPage
    .waitForFunction(
      ({ expectedActionId, expectedPromptId }) =>
        window.__fmarchHostCommandStatuses?.[expectedActionId]?.error ===
          "PromptAlreadyResolved" &&
        (window.__fmarchHostPromptsProjection?.some(
          (prompt) => prompt.id === expectedPromptId && prompt.status === "resolved",
        ) ||
          document.querySelector(`[data-testid="critical-host-action-${expectedActionId}"]`) ===
            null),
      { expectedActionId: actionId, expectedPromptId: promptId },
      { timeout: 5000 },
    )
    .catch(() => {});
  const reject = action.commandStatus;
  const commandOutcomes = await stalePromptPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const promptsAfterReject = await stalePromptPage.evaluate(
    () => window.__fmarchHostPromptsProjection ?? [],
  );
  const promptActionsAfterReject = await visibleHostControlActions(
    stalePromptPage,
    "host-prompts",
  );
  const activityStatusText = await stalePromptPage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await stalePromptPage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await stalePromptPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const apiPromptsAfterReject = await fetchJson(
    `${apiBaseUrl}/games/${promptGame}/host-prompts?principal_user_id=host_h`,
  );
  const reloadResponse = await stalePromptPage.goto(
    `${frontendBaseUrl}/g/${promptGame}/host`,
    {
      waitUntil: "networkidle",
    },
  );
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale host prompt reload failed with ${
        reloadResponse?.status() ?? "no response"
      }`,
    );
  }
  await stalePromptPage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await stalePromptPage.waitForFunction(
    (expectedPromptId) =>
      window.__fmarchHostPromptsProjection?.some(
        (prompt) => prompt.id === expectedPromptId && prompt.status === "resolved",
      ),
    promptId,
  );
  const surfaceTextAfterReload = await stalePromptPage
    .getByTestId("host-console-surface")
    .innerText();
  const promptsAfterReload = await stalePromptPage.evaluate(
    () => window.__fmarchHostPromptsProjection ?? [],
  );
  const phaseAfterReload = await stalePromptPage.evaluate(
    () => window.__fmarchHostProjection?.phase ?? null,
  );
  const phaseActionsAfterReload = await visibleHostPhaseActions(stalePromptPage);
  const promptActionsAfterReload = await visibleHostControlActions(
    stalePromptPage,
    "host-prompts",
  );
  const apiPromptsAfterReload = await fetchJson(
    `${apiBaseUrl}/games/${promptGame}/host-prompts?principal_user_id=host_h`,
  );
  const staleHostPromptReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    promptsAfterReload,
    phase: phaseAfterReload,
    phaseActionsAfterReload,
    promptActionsAfterReload,
    apiPromptsAfterReload,
  };
  if (
    setup?.promptActions?.includes(actionId) !== true ||
    liveResolve?.commandStatus?.state !== "ack" ||
    !Array.isArray(liveResolve?.commandStatus?.streamSeqs) ||
    liveResolve.commandStatus.streamSeqs.length !== 2 ||
    liveResolve?.commandStatus?.requestEnvelope?.body?.body?.command?.ResolveHostPrompt
      ?.prompt_id !== promptId ||
    reject?.state !== "reject" ||
    reject?.error !== "PromptAlreadyResolved" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    commandOutcomes.find(
      (outcome) =>
        outcome.actionId === actionId &&
        outcome.state === "reject" &&
        outcome.error === "PromptAlreadyResolved",
    ) === undefined ||
    promptsAfterReject.find((prompt) => prompt.id === promptId)?.status !== "resolved" ||
    promptActionsAfterReject.includes(actionId) ||
    !activityStatusText.includes("Reject PromptAlreadyResolved") ||
    !activityStatusText.includes("host prompt selection is stale") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== "resolve_host_prompt" ||
    dispatchPlan?.projectionRefreshKeys?.includes("hostPrompts") !== true ||
    apiPromptsAfterReject.find((prompt) => (prompt.id ?? prompt.prompt_id) === promptId)
      ?.status !== "resolved" ||
    staleHostPromptReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostPromptReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject PromptAlreadyResolved",
    ) ||
    !staleHostPromptReloadAfterReject.rejectReceiptStatusText.includes(
      "host prompt selection is stale",
    ) ||
    staleHostPromptReloadAfterReject.promptsAfterReload.find(
      (prompt) => prompt.id === promptId,
    )?.status !== "resolved" ||
    staleHostPromptReloadAfterReject.promptActionsAfterReload.includes(actionId) ||
    staleHostPromptReloadAfterReject.apiPromptsAfterReload.find(
      (prompt) => (prompt.id ?? prompt.prompt_id) === promptId,
    )?.status !== "resolved" ||
    (expectedReloadPhase !== undefined &&
      ((staleHostPromptReloadAfterReject.phase?.id ??
        staleHostPromptReloadAfterReject.phase?.phase_id) !==
        expectedReloadPhase.id ||
        staleHostPromptReloadAfterReject.phase?.locked !==
          expectedReloadPhase.locked ||
        (expectedReloadPhase.requiredPhaseActions ?? []).some(
          (actionId) =>
            !staleHostPromptReloadAfterReject.phaseActionsAfterReload.includes(
              actionId,
            ),
        )))
  ) {
    throw new Error(
      `stale host prompt recovery drifted: ${JSON.stringify({
        setup,
        liveResolve,
        reject,
        commandOutcomes,
        promptsAfterReject,
        promptActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiPromptsAfterReject,
        staleHostPromptReloadAfterReject,
      })}`,
    );
  }
  return {
    setup,
    reject,
    commandOutcomes,
    promptsAfterReject,
    promptActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiPromptsAfterReject,
    staleHostPromptReloadAfterReject,
  };
}

async function verifyStaleHostCompleteRecovery({
  hostPage,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const completeGame = crypto.randomUUID();
  const actionId = "complete_game";
  const seed = await seedHostCompleteRecoveryGame({ completeGame });
  const context = hostPage.context();
  const staleCompletePage = await context.newPage();
  const liveCompletePage = await context.newPage();
  try {
    const setup = await freezeStaleHostCompletePage({
      staleCompletePage,
      frontendBaseUrl,
      completeGame,
      actionId,
    });
    await liveCompletePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
      waitUntil: "networkidle",
    });
    await liveCompletePage
      .getByTestId(`critical-host-action-${actionId}`)
      .waitFor({ state: "visible" });
    const liveComplete = await confirmHostAction(liveCompletePage, actionId);
    await liveCompletePage.waitForFunction(
      () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    );
    const staleRecovery = await submitStaleHostCompleteRecovery({
      staleCompletePage,
      setup,
      liveComplete,
      apiBaseUrl,
      frontendBaseUrl,
      completeGame,
      actionId,
    });
    return {
      status: "passed",
      game: completeGame,
      actionId,
      seed,
      liveComplete,
      ...staleRecovery,
      proof:
        "A disposable local endgame-reveal game froze one host role URL with the CompleteGame control while roles were private, completed the same game from a live host role URL, then clicked the stale reveal control and recovered through GameAlreadyCompleted without ACK stream seqs while refreshing the host projection to all slots revealed.",
    };
  } finally {
    await staleCompletePage.close().catch(() => {});
    await liveCompletePage.close().catch(() => {});
  }
}

async function verifyConcurrentHostCompleteRace({
  hostPage,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const completeGame = crypto.randomUUID();
  const actionId = "complete_game";
  const seed = await seedHostCompleteRecoveryGame({ completeGame });
  const context = hostPage.context();
  const firstCompletePage = await context.newPage();
  const secondCompletePage = await context.newPage();
  try {
    await Promise.all([
      firstCompletePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
        waitUntil: "networkidle",
      }),
      secondCompletePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    await Promise.all([
      firstCompletePage
        .getByTestId(`critical-host-action-${actionId}`)
        .waitFor({ state: "visible" }),
      secondCompletePage
        .getByTestId(`critical-host-action-${actionId}`)
        .waitFor({ state: "visible" }),
    ]);
    await Promise.all([
      firstCompletePage.waitForFunction(
        () =>
          (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
          window.__fmarchHostProjection.slots.every(
            (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
          ),
      ),
      secondCompletePage.waitForFunction(
        () =>
          (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
          window.__fmarchHostProjection.slots.every(
            (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
          ),
      ),
    ]);
    const setup = {
      firstSlots: await firstCompletePage.evaluate(
        () => window.__fmarchHostProjection?.slots ?? [],
      ),
      secondSlots: await secondCompletePage.evaluate(
        () => window.__fmarchHostProjection?.slots ?? [],
      ),
      firstRevealText: await firstCompletePage
        .getByTestId("host-console-endgame-reveal")
        .innerText(),
      secondRevealText: await secondCompletePage
        .getByTestId("host-console-endgame-reveal")
        .innerText(),
      firstRoleActions: await visibleHostControlActions(firstCompletePage, "roles"),
      secondRoleActions: await visibleHostControlActions(secondCompletePage, "roles"),
    };
    const race = await submitConcurrentHostCompleteRace({
      firstCompletePage,
      secondCompletePage,
      setup,
      apiBaseUrl,
      completeGame,
      actionId,
    });
    return {
      status: "passed",
      game: completeGame,
      actionId,
      seed,
      ...race,
      proof:
        "A disposable local endgame-reveal game opened two host role URLs with private role facts, confirmed CompleteGame concurrently with distinct command ids, proved one ACK plus one GameAlreadyCompleted recovery, and converged both host projections plus the API to one revealed completed game.",
    };
  } finally {
    await firstCompletePage.close().catch(() => {});
    await secondCompletePage.close().catch(() => {});
  }
}

async function submitConcurrentHostCompleteRace({
  firstCompletePage,
  secondCompletePage,
  setup,
  apiBaseUrl,
  completeGame,
  actionId,
}) {
  const firstBefore = await firstCompletePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );
  const secondBefore = await secondCompletePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );
  const firstRoot = firstCompletePage.getByTestId(`critical-host-action-${actionId}`);
  const secondRoot = secondCompletePage.getByTestId(`critical-host-action-${actionId}`);
  await Promise.all([
    firstRoot.getByTestId("critical-host-action-trigger").click(),
    secondRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    firstRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    secondRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [firstConfirmationMessage, secondConfirmationMessage] = await Promise.all([
    firstRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    secondRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: firstRoot,
      actionId,
      roleLabel: "first complete",
    },
    {
      actionRoot: secondRoot,
      actionId,
      roleLabel: "second complete",
    },
  ]);
  await Promise.all([
    firstCompletePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.CompleteGame !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: actionId, beforeCommandId: firstBefore?.commandId ?? null },
    ),
    secondCompletePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.CompleteGame !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: actionId, beforeCommandId: secondBefore?.commandId ?? null },
    ),
  ]);

  const [firstOutcome, secondOutcome] = await Promise.all([
    firstCompletePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
    secondCompletePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
  ]);
  const outcomes = [
    { raceRole: "first", outcome: firstOutcome },
    { raceRole: "second", outcome: secondOutcome },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.CompleteGame;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.CompleteGame;
  if (
    setup?.firstRoleActions?.includes(actionId) !== true ||
    setup?.secondRoleActions?.includes(actionId) !== true ||
    setup?.firstSlots?.length !== 1 ||
    setup?.secondSlots?.length !== 1 ||
    setup.firstSlots.some(
      (slot) => slot.role_revealed === true || slot.alignment_revealed === true,
    ) ||
    setup.secondSlots.some(
      (slot) => slot.role_revealed === true || slot.alignment_revealed === true,
    ) ||
    !setup.firstRevealText?.includes("0/1 slots revealed") ||
    !setup.secondRevealText?.includes("0/1 slots revealed") ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ack.streamSeqs.length !== 1 ||
    reject?.error !== "GameAlreadyCompleted" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.game !== completeGame ||
    rejectCommand?.game !== completeGame
  ) {
    throw new Error(
      `concurrent host complete race outcomes drifted: ${JSON.stringify({
        setup,
        firstOutcome,
        secondOutcome,
      })}`,
    );
  }

  await Promise.all([
    firstCompletePage.waitForFunction(
      () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    ),
    secondCompletePage.waitForFunction(
      () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    ),
  ]);

  const [
    firstSlotsAfterRace,
    secondSlotsAfterRace,
    firstRevealTextAfterRace,
    secondRevealTextAfterRace,
    firstRoleActionsAfterRace,
    secondRoleActionsAfterRace,
    firstActivityStatusText,
    secondActivityStatusText,
    firstActivityRow,
    secondActivityRow,
    firstDispatchPlan,
    secondDispatchPlan,
  ] = await Promise.all([
    firstCompletePage.evaluate(() => window.__fmarchHostProjection?.slots ?? []),
    secondCompletePage.evaluate(() => window.__fmarchHostProjection?.slots ?? []),
    firstCompletePage.getByTestId("host-console-endgame-reveal").innerText(),
    secondCompletePage.getByTestId("host-console-endgame-reveal").innerText(),
    visibleHostControlActions(firstCompletePage, "roles"),
    visibleHostControlActions(secondCompletePage, "roles"),
    firstCompletePage.getByTestId(`host-command-activity-status-${actionId}`).innerText(),
    secondCompletePage.getByTestId(`host-command-activity-status-${actionId}`).innerText(),
    firstCompletePage.getByTestId(`host-command-activity-${actionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    secondCompletePage.getByTestId(`host-command-activity-${actionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    firstCompletePage.evaluate(() => window.__fmarchHostCommandDispatchBridgePlan),
    secondCompletePage.evaluate(() => window.__fmarchHostCommandDispatchBridgePlan),
  ]);
  const apiStateAfterRace = await fetchHostConsoleState({
    apiBaseUrl,
    game: completeGame,
  });
  const activityTexts = [firstActivityStatusText, secondActivityStatusText];
  if (
    firstSlotsAfterRace.length !== 1 ||
    secondSlotsAfterRace.length !== 1 ||
    firstSlotsAfterRace.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    secondSlotsAfterRace.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    !firstRevealTextAfterRace.includes("All 1 slots revealed") ||
    !secondRevealTextAfterRace.includes("All 1 slots revealed") ||
    firstRoleActionsAfterRace.includes(actionId) ||
    secondRoleActionsAfterRace.includes(actionId) ||
    !activityTexts.some((text) => text.includes("Ack")) ||
    !activityTexts.some((text) => text.includes("Reject GameAlreadyCompleted")) ||
    firstActivityRow.source !== "outcome" ||
    firstActivityRow.actionId !== actionId ||
    firstActivityRow.dispatchKind !== actionId ||
    secondActivityRow.source !== "outcome" ||
    secondActivityRow.actionId !== actionId ||
    secondActivityRow.dispatchKind !== actionId ||
    [firstDispatchPlan, secondDispatchPlan].some(
      (plan) => plan?.projectionRefreshKeys?.includes("host") === true,
    ) !== true ||
    apiStateAfterRace.completed !== true ||
    apiStateAfterRace.slots?.length !== 1 ||
    apiStateAfterRace.slots.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    )
  ) {
    throw new Error(
      `concurrent host complete convergence drifted: ${JSON.stringify({
        firstSlotsAfterRace,
        secondSlotsAfterRace,
        firstRevealTextAfterRace,
        secondRevealTextAfterRace,
        firstRoleActionsAfterRace,
        secondRoleActionsAfterRace,
        firstActivityStatusText,
        secondActivityStatusText,
        firstActivityRow,
        secondActivityRow,
        firstDispatchPlan,
        secondDispatchPlan,
        apiStateAfterRace,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostCompleteRaceReload({
    firstCompletePage,
    secondCompletePage,
    completeGame,
    apiBaseUrl,
    actionId,
  });

  return {
    setup,
    firstConfirmationMessage,
    secondConfirmationMessage,
    ackRaceRole: ackEntry.raceRole,
    rejectRaceRole: rejectEntry.raceRole,
    ack,
    reject,
    firstOutcome,
    secondOutcome,
    firstSlotsAfterRace,
    secondSlotsAfterRace,
    firstRevealTextAfterRace,
    secondRevealTextAfterRace,
    firstRoleActionsAfterRace,
    secondRoleActionsAfterRace,
    firstActivityStatusText,
    secondActivityStatusText,
    firstActivityRow,
    secondActivityRow,
    firstDispatchPlan,
    secondDispatchPlan,
    apiStateAfterRace,
    roleReloadAfterRace,
  };
}

async function verifyConcurrentHostCompleteRaceReload({
  firstCompletePage,
  secondCompletePage,
  completeGame,
  apiBaseUrl,
  actionId,
}) {
  const [firstReload, secondReload] = await Promise.all([
    gotoHostConsole(firstCompletePage, completeGame),
    gotoHostConsole(secondCompletePage, completeGame),
  ]);
  await Promise.all([
    firstCompletePage.waitForFunction(
      () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    ),
    secondCompletePage.waitForFunction(
      () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    ),
  ]);
  const [
    firstSlotsAfterReload,
    secondSlotsAfterReload,
    firstRevealTextAfterReload,
    secondRevealTextAfterReload,
    firstRoleActionsAfterReload,
    secondRoleActionsAfterReload,
  ] = await Promise.all([
    firstCompletePage.evaluate(() => window.__fmarchHostProjection?.slots ?? []),
    secondCompletePage.evaluate(() => window.__fmarchHostProjection?.slots ?? []),
    firstCompletePage.getByTestId("host-console-endgame-reveal").innerText(),
    secondCompletePage.getByTestId("host-console-endgame-reveal").innerText(),
    visibleHostControlActions(firstCompletePage, "roles"),
    visibleHostControlActions(secondCompletePage, "roles"),
  ]);
  const apiStateAfterReload = await fetchHostConsoleState({
    apiBaseUrl,
    game: completeGame,
  });
  if (
    firstReload.status !== 200 ||
    secondReload.status !== 200 ||
    firstSlotsAfterReload.length !== 1 ||
    secondSlotsAfterReload.length !== 1 ||
    firstSlotsAfterReload.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    secondSlotsAfterReload.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    !firstRevealTextAfterReload.includes("All 1 slots revealed") ||
    !secondRevealTextAfterReload.includes("All 1 slots revealed") ||
    firstRoleActionsAfterReload.includes(actionId) ||
    secondRoleActionsAfterReload.includes(actionId) ||
    apiStateAfterReload.completed !== true ||
    apiStateAfterReload.slots?.length !== 1 ||
    apiStateAfterReload.slots.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    )
  ) {
    throw new Error(
      `concurrent host complete reload drifted: ${JSON.stringify({
        firstReload,
        secondReload,
        firstSlotsAfterReload,
        secondSlotsAfterReload,
        firstRevealTextAfterReload,
        secondRevealTextAfterReload,
        firstRoleActionsAfterReload,
        secondRoleActionsAfterReload,
        apiStateAfterReload,
      })}`,
    );
  }
  return {
    status: "passed",
    firstRouteStatus: firstReload.status,
    secondRouteStatus: secondReload.status,
    firstSlotsAfterReload,
    secondSlotsAfterReload,
    firstRevealTextAfterReload,
    secondRevealTextAfterReload,
    firstRoleActionsAfterReload,
    secondRoleActionsAfterReload,
    apiStateAfterReload,
  };
}

async function seedHostCompleteRecoveryGame({ completeGame }) {
  const plan = [
    ["host_h", { CreateGame: { game: completeGame, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game: completeGame, slot: "slot-7" } }],
    ["host_h", { AssignSlot: { game: completeGame, slot: "slot-7", user: "player-mira" } }],
    ["host_h", { AssignRole: { game: completeGame, slot: "slot-7", role_key: "godfather" } }],
    ["host_h", { StartGame: { game: completeGame, phase: "D01" } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game: completeGame,
    commands: commands.length,
  };
}

async function seedPlayerEndgameHistoryRecoveryGame({ completeGame }) {
  const plan = [
    ["host_h", { CreateGame: { game: completeGame, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game: completeGame, slot: "slot-7" } }],
    [
      "host_h",
      {
        AssignSlot: {
          game: completeGame,
          slot: "slot-7",
          user: "player-mira",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: completeGame,
          slot: "slot-7",
          role_key: "godfather",
        },
      },
    ],
    ["host_h", { AddSlot: { game: completeGame, slot: "slot-2" } }],
    [
      "host_h",
      {
        AssignSlot: {
          game: completeGame,
          slot: "slot-2",
          user: "player-target",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: completeGame,
          slot: "slot-2",
          role_key: "vanilla_townie",
        },
      },
    ],
    ["host_h", { AddSlot: { game: completeGame, slot: "slot-3" } }],
    [
      "host_h",
      {
        AssignSlot: {
          game: completeGame,
          slot: "slot-3",
          user: "player-seed",
        },
      },
    ],
    [
      "host_h",
      {
        AssignRole: {
          game: completeGame,
          slot: "slot-3",
          role_key: "vanilla_townie",
        },
      },
    ],
    ["host_h", { StartGame: { game: completeGame, phase: "D01" } }],
    [
      "player-target",
      {
        SubmitVote: {
          game: completeGame,
          actor_slot: "slot-2",
          target: "NoLynch",
        },
      },
    ],
    [
      "player-seed",
      {
        SubmitVote: {
          game: completeGame,
          actor_slot: "slot-3",
          target: "NoLynch",
        },
      },
    ],
    ["host_h", { ResolvePhase: { game: completeGame, seed: 73021 } }],
    ["host_h", { UnlockThread: { game: completeGame } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game: completeGame,
    commands: commands.length,
    slotCount: 3,
    voteHistoryPhaseId: "D01",
    voteHistoryStatus: "NoLynch",
    voteHistoryTarget: "no_lynch",
    voteHistoryActors: ["slot-2", "slot-3"],
    expectedThreadBodies: ["Phase D01 announcement: no deaths."],
  };
}

async function verifyConcurrentPlayerCompleteRace({
  hostPage,
  playerPage,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const completeGame = crypto.randomUUID();
  const postBody = `Concurrent player completion race post ${completeGame}`;
  const seed = await seedHostCompleteRecoveryGame({ completeGame });
  const playerRacePage = await playerPage.context().newPage();
  const hostRacePage = await hostPage.context().newPage();
  try {
    await Promise.all([
      gotoPlayerBoard(playerRacePage, completeGame),
      hostRacePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    await Promise.all([
      playerRacePage.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
          window.__fmarchPlayerProjection?.commandState?.gameCompleted === false,
      ),
      hostRacePage
        .getByTestId("critical-host-action-complete_game")
        .waitFor({ state: "visible" }),
    ]);
    const setupCommandState = await playerRacePage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(playerRacePage);
    const setupPostButton = setupButtons.find((button) => button.action === "submit_post");
    const setupHostSlots = await hostRacePage.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    );
    const setupHostActions = await visibleHostControlActions(hostRacePage, "roles");
    const postCommandId = crypto.randomUUID();
    const completeCommandId = crypto.randomUUID();
    const [postRaw, completeRaw] = await Promise.all([
      sendBrowserCommand(playerRacePage, {
        principalUserId: "player-mira",
        command: {
          SubmitPost: {
            game: completeGame,
            channel_id: hardeningRetryChannel,
            actor_slot: "slot-7",
            body: postBody,
            media: [],
          },
        },
        commandId: postCommandId,
      }),
      sendBrowserCommand(hostRacePage, {
        principalUserId: "host_h",
        command: { CompleteGame: { game: completeGame } },
        commandId: completeCommandId,
      }),
    ]);
    const post = normalizeCommandResponse({
      commandId: postCommandId,
      requestEnvelope: postRaw.requestEnvelope,
      response: { status: postRaw.httpStatus },
      serverEnvelope: postRaw.serverEnvelope,
    });
    const complete = normalizeCommandResponse({
      commandId: completeCommandId,
      requestEnvelope: completeRaw.requestEnvelope,
      response: { status: completeRaw.httpStatus },
      serverEnvelope: completeRaw.serverEnvelope,
    });
    const postAcked = post?.state === "ack";
    const postRejectedCompleted =
      post?.state === "reject" && post?.error === "GameAlreadyCompleted";
    const postSeq = postAcked ? post.streamSeqs?.[0] : null;
    const completeSeq = complete?.streamSeqs?.[0] ?? null;
    const acceptedSerialOrder =
      postAcked === true && Number.isInteger(postSeq) && postSeq < completeSeq;
    if (
      setupCommandState?.gameCompleted !== false ||
      setupCommandState?.actorSlot !== "slot-7" ||
      setupPostButton?.disabled !== false ||
      setupHostSlots.length !== 1 ||
      setupHostSlots.some(
        (slot) => slot.role_revealed === true || slot.alignment_revealed === true,
      ) ||
      setupHostActions.includes("complete_game") !== true ||
      complete?.state !== "ack" ||
      !Array.isArray(complete?.streamSeqs) ||
      complete.streamSeqs.length !== 1 ||
      post?.requestEnvelope?.body?.body?.command?.SubmitPost?.body !== postBody ||
      complete?.requestEnvelope?.body?.body?.command?.CompleteGame?.game !==
        completeGame ||
      (acceptedSerialOrder !== true && postRejectedCompleted !== true)
    ) {
      throw new Error(
        `concurrent player complete race outcomes drifted: ${JSON.stringify({
          completeGame,
          setupCommandState,
          setupButtons,
          setupHostSlots,
          setupHostActions,
          post,
          complete,
          postSeq,
          completeSeq,
        })}`,
      );
    }

    const [playerReloadResponse] = await Promise.all([
      playerRacePage.goto(`${frontendBaseUrl}/g/${completeGame}`, {
        waitUntil: "networkidle",
      }),
      hostRacePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (playerReloadResponse === null || !playerReloadResponse.ok()) {
      throw new Error(
        `public player complete reload failed with ${
          playerReloadResponse?.status() ?? "no response"
        }`,
      );
    }
    await Promise.all([
      playerRacePage.getByTestId("player-surface").waitFor({ state: "visible" }),
      playerRacePage.getByTestId("player-thread-pager").waitFor({
        state: "visible",
      }),
      playerRacePage.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
          (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
          (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
            0,
      ),
      hostRacePage.waitForFunction(
        () =>
          (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
          window.__fmarchHostProjection.slots.every(
            (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
          ),
      ),
    ]);
    const commandStateAfterRace = await playerRacePage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const buttonsAfterRace = await playerCommandButtons(playerRacePage);
    const playerSurfaceTextAfterReload = await playerRacePage
      .getByTestId("player-surface")
      .innerText();
    const threadPagerVisibleAfterReload = await playerRacePage
      .getByTestId("player-thread-pager")
      .isVisible();
    const reloadThreadPostBodies = await playerRacePage.evaluate(
      () => (window.__fmarchPlayerProjection?.thread?.posts ?? []).map((post) => post.body),
    );
    const reloadPostCount = reloadThreadPostBodies.filter(
      (body) => body === postBody,
    ).length;
    const reloadPostVisible =
      (await playerRacePage.getByText(postBody, { exact: true }).count()) > 0;
    const hostSlotsAfterRace = await hostRacePage.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    );
    const apiCommandStateAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiThreadAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/channels/${hardeningRetryChannel}/thread?principal_user_id=player-mira&limit=100`,
    );
    const apiStateAfterRace = await fetchHostConsoleState({
      apiBaseUrl,
      game: completeGame,
    });
    const apiThreadPostBodiesAfterRace = (apiThreadAfterRace.posts ?? []).map(
      (post) => post.body,
    );
    const apiThreadPostCount = apiThreadPostBodiesAfterRace.filter(
      (body) => body === postBody,
    ).length;
    const apiThreadHasPost = apiThreadPostCount > 0;
    const publicReloadAfterRace = {
      status: "passed",
      routeResponseStatus: playerReloadResponse.status(),
      surfaceText: playerSurfaceTextAfterReload,
      threadPagerVisible: threadPagerVisibleAfterReload,
      recoveredCommandState: commandStateAfterRace,
      reloadButtons: buttonsAfterRace,
      reloadThreadPostBodies,
      reloadPostCount,
      reloadPostVisible,
      apiCommandStateAfterReload: apiCommandStateAfterRace,
      apiThreadPostBodiesAfterReload: apiThreadPostBodiesAfterRace,
      apiThreadPostCount,
      apiStateAfterReload: apiStateAfterRace,
    };
    if (
      commandStateAfterRace?.gameCompleted !== true ||
      commandStateAfterRace?.actions?.length !== 0 ||
      commandStateAfterRace?.voteTargets?.length !== 0 ||
      !commandStateAfterRace?.boundary?.includes("game is complete") ||
      buttonsAfterRace.some((button) => button.disabled !== true) ||
      playerReloadResponse.status() !== 200 ||
      threadPagerVisibleAfterReload !== true ||
      !playerSurfaceTextAfterReload.includes("Endgame") ||
      !playerSurfaceTextAfterReload.includes("The game is complete.") ||
      reloadPostCount !== (postAcked ? 1 : 0) ||
      reloadPostVisible !== postAcked ||
      hostSlotsAfterRace.length !== 1 ||
      hostSlotsAfterRace.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      apiCommandStateAfterRace?.game_completed !== true ||
      apiCommandStateAfterRace?.actions?.length !== 0 ||
      apiCommandStateAfterRace?.vote_targets?.length !== 0 ||
      apiStateAfterRace.completed !== true ||
      apiStateAfterRace.slots?.length !== 1 ||
      apiStateAfterRace.slots.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      apiThreadHasPost !== postAcked ||
      apiThreadPostCount !== (postAcked ? 1 : 0) ||
      publicReloadAfterRace.status !== "passed"
    ) {
      throw new Error(
        `concurrent player complete race convergence drifted: ${JSON.stringify({
          completeGame,
          post,
          complete,
          commandStateAfterRace,
          buttonsAfterRace,
          playerSurfaceTextAfterReload,
          threadPagerVisibleAfterReload,
          reloadThreadPostBodies,
          reloadPostCount,
          reloadPostVisible,
          hostSlotsAfterRace,
          apiCommandStateAfterRace,
          apiThreadPostBodiesAfterRace,
          apiThreadPostCount,
          apiStateAfterRace,
        })}`,
      );
    }
    const outcomeSummary = postAcked
      ? `post seq ${postSeq} before complete seq ${completeSeq}`
      : "post rejected GameAlreadyCompleted after completion";
    return {
      status: "passed",
      game: completeGame,
      seed,
      postBody,
      setupCommandState,
      setupButtons,
      setupPostButton,
      setupHostSlots,
      setupHostActions,
      post,
      complete,
      postSeq,
      completeSeq,
      outcomeSummary,
      commandStateAfterRace,
      buttonsAfterRace,
      publicReloadAfterRace,
      hostSlotsAfterRace,
      apiCommandStateAfterRace,
      apiThreadHasPost,
      apiThreadPostCount,
      apiStateAfterRace,
      proof:
        "A disposable player role URL and host role URL raced SubmitPost against CompleteGame through /commands, accepted only post-before-complete ACK ordering or GameAlreadyCompleted rejection, then reloaded the public player board and API projections to a revealed completed game with disabled player controls and exactly the legal public post outcome.",
    };
  } finally {
    await playerRacePage.close().catch(() => {});
    await hostRacePage.close().catch(() => {});
  }
}

async function freezeStaleHostCompletePage({
  staleCompletePage,
  frontendBaseUrl,
  completeGame,
  actionId,
}) {
  await staleCompletePage.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
    waitUntil: "networkidle",
  });
  await staleCompletePage
    .getByTestId(`critical-host-action-${actionId}`)
    .waitFor({ state: "visible" });
  await staleCompletePage.waitForFunction(
    () =>
      (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
      (window.__fmarchHostProjection?.slots ?? []).every(
        (slot) => slot.role_revealed === false && slot.alignment_revealed === false,
      ),
  );
  const slots = await staleCompletePage.evaluate(
    () => window.__fmarchHostProjection?.slots ?? [],
  );
  const revealText = await staleCompletePage
    .getByTestId("host-console-endgame-reveal")
    .innerText();
  const roleActions = await visibleHostControlActions(staleCompletePage, "roles");
  const closedStatus = await staleCompletePage.evaluate(() =>
    window.__fmarchCloseHostLiveProjection?.(),
  );
  if (
    !roleActions.includes(actionId) ||
    !revealText.includes("0/1 slots revealed") ||
    slots.length !== 1 ||
    slots.some((slot) => slot.role_revealed === true || slot.alignment_revealed === true) ||
    closedStatus?.state !== "closed"
  ) {
    throw new Error(
      `stale host complete setup drifted: ${JSON.stringify({
        completeGame,
        roleActions,
        revealText,
        slots,
        closedStatus,
      })}`,
    );
  }
  return {
    game: completeGame,
    roleActions,
    revealText,
    slots,
    closedStatus,
  };
}

async function submitStaleHostCompleteRecovery({
  staleCompletePage,
  setup,
  liveComplete,
  apiBaseUrl,
  frontendBaseUrl,
  completeGame,
  actionId,
}) {
  const action = await confirmHostAction(staleCompletePage, actionId, "reject");
  await staleCompletePage.waitForFunction(
    () =>
        (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
        window.__fmarchHostProjection.slots.every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
  );
  const reject = action.commandStatus;
  const commandOutcomes = await staleCompletePage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const slotsAfterReject = await staleCompletePage.evaluate(
    () => window.__fmarchHostProjection?.slots ?? [],
  );
  const revealTextAfterReject = await staleCompletePage
    .getByTestId("host-console-endgame-reveal")
    .innerText();
  const roleActionsAfterReject = await visibleHostControlActions(
    staleCompletePage,
    "roles",
  );
  const activityStatusText = await staleCompletePage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleCompletePage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleCompletePage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const apiStateAfterReject = await fetchHostConsoleState({
    apiBaseUrl,
    game: completeGame,
  });
  const reloadResponse = await staleCompletePage.goto(
    `${frontendBaseUrl}/g/${completeGame}/host`,
    {
      waitUntil: "networkidle",
    },
  );
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale host complete reload failed with ${
        reloadResponse?.status() ?? "no response"
      }`,
    );
  }
  await staleCompletePage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await staleCompletePage.waitForFunction(
    () =>
      (window.__fmarchHostProjection?.slots ?? []).length === 1 &&
      window.__fmarchHostProjection.slots.every(
        (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
      ),
  );
  const surfaceTextAfterReload = await staleCompletePage
    .getByTestId("host-console-surface")
    .innerText();
  const slotsAfterReload = await staleCompletePage.evaluate(
    () => window.__fmarchHostProjection?.slots ?? [],
  );
  const revealTextAfterReload = await staleCompletePage
    .getByTestId("host-console-endgame-reveal")
    .innerText();
  const roleActionsAfterReload = await visibleHostControlActions(
    staleCompletePage,
    "roles",
  );
  const apiStateAfterReload = await fetchHostConsoleState({
    apiBaseUrl,
    game: completeGame,
  });
  const staleHostReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    slotsAfterReload,
    revealTextAfterReload,
    roleActionsAfterReload,
    apiStateAfterReload,
  };
  const reconnectAfterReject = await verifyHostReconnectRecovery({
    page: staleCompletePage,
    game: completeGame,
  });
  const roleActionsAfterReconnect = await visibleHostControlActions(
    staleCompletePage,
    "roles",
  );
  if (
    setup?.roleActions?.includes(actionId) !== true ||
    liveComplete?.commandStatus?.state !== "ack" ||
    !Array.isArray(liveComplete?.commandStatus?.streamSeqs) ||
    liveComplete.commandStatus.streamSeqs.length !== 1 ||
    liveComplete?.commandStatus?.requestEnvelope?.body?.body?.command?.CompleteGame
      ?.game !== completeGame ||
    reject?.state !== "reject" ||
    reject?.error !== "GameAlreadyCompleted" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    commandOutcomes.find(
      (outcome) =>
        outcome.actionId === actionId &&
        outcome.state === "reject" &&
        outcome.error === "GameAlreadyCompleted",
    ) === undefined ||
    slotsAfterReject.length !== 1 ||
    slotsAfterReject.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    !revealTextAfterReject.includes("All 1 slots revealed") ||
    roleActionsAfterReject.includes(actionId) ||
    !activityStatusText.includes("Reject GameAlreadyCompleted") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    apiStateAfterReject.completed !== true ||
    apiStateAfterReject.slots?.length !== 1 ||
    apiStateAfterReject.slots.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    staleHostReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject GameAlreadyCompleted",
    ) ||
    !staleHostReloadAfterReject.surfaceText.includes("All 1 slots revealed") ||
    staleHostReloadAfterReject.slotsAfterReload.length !== 1 ||
    staleHostReloadAfterReject.slotsAfterReload.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    !staleHostReloadAfterReject.revealTextAfterReload.includes(
      "All 1 slots revealed",
    ) ||
    staleHostReloadAfterReject.roleActionsAfterReload.includes(actionId) ||
    staleHostReloadAfterReject.apiStateAfterReload.completed !== true ||
    staleHostReloadAfterReject.apiStateAfterReload.slots?.length !== 1 ||
    staleHostReloadAfterReject.apiStateAfterReload.slots.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredHostProjection?.completed !== true ||
    reconnectAfterReject?.recoveredHostProjection?.slots?.length !== 1 ||
    reconnectAfterReject.recoveredHostProjection.slots.some(
      (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
    ) ||
    roleActionsAfterReconnect.includes(actionId)
  ) {
    throw new Error(
      `stale host complete recovery drifted: ${JSON.stringify({
        setup,
        liveComplete,
        reject,
        commandOutcomes,
        slotsAfterReject,
        revealTextAfterReject,
        roleActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiStateAfterReject,
        staleHostReloadAfterReject,
        reconnectAfterReject,
        roleActionsAfterReconnect,
      })}`,
    );
  }
  return {
    setup,
    game: completeGame,
    reject,
    commandOutcomes,
    slotsAfterReject,
    revealTextAfterReject,
    roleActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiStateAfterReject,
    staleHostReloadAfterReject,
    reconnectAfterReject,
    roleActionsAfterReconnect,
  };
}

async function verifyStalePlayerCompleteRecovery({
  playerPage,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const endgameScenario = completedPlayerEndgameRefreshScenario();
  const completeGame = crypto.randomUUID();
  const seed = await seedPlayerEndgameHistoryRecoveryGame({ completeGame });
  const context = playerPage.context();
  const stalePlayerPage = await context.newPage();
  try {
    await gotoPlayerBoard(stalePlayerPage, completeGame);
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === false,
    );
    const setupCommandState = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(stalePlayerPage);
    const staleVoteButton = setupButtons.find(
      (button) =>
        button.action === endgameScenario.clickedAction && button.disabled === false,
    );
    const closedStatus = await stalePlayerPage.evaluate(
      () => window.__fmarchClosePlayerLiveProjection?.(),
    );
    const completeCommandId = crypto.randomUUID();
    const completeRaw = await sendBrowserCommand(playerPage, {
      principalUserId: "host_h",
      command: { CompleteGame: { game: completeGame } },
      commandId: completeCommandId,
    });
    const liveComplete = normalizeCommandResponse({
      commandId: completeCommandId,
      requestEnvelope: completeRaw.requestEnvelope,
      response: { status: completeRaw.httpStatus },
      serverEnvelope: completeRaw.serverEnvelope,
    });
    if (
      setupCommandState?.actions?.length !== 0 ||
      !setupCommandState?.voteTargets?.some((target) => target.kind === "no_lynch") ||
      staleVoteButton === undefined ||
      closedStatus?.state !== "closed" ||
      liveComplete?.state !== "ack"
    ) {
      throw new Error(
        `stale player complete setup drifted: ${JSON.stringify({
          completeGame,
          seed,
          setupCommandState,
          setupButtons,
          staleVoteButton,
          closedStatus,
          liveComplete,
        })}`,
      );
    }

    await stalePlayerPage.locator(`[data-action="${staleVoteButton.action}"]`).click();
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "GameAlreadyCompleted",
    );
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        window.__fmarchPlayerProjection?.endgameSummary?.completed === true &&
        window.__fmarchPlayerProjection?.endgameSummary?.voteHistory?.some(
          (outcome) =>
            outcome.phaseId === "D01" && outcome.status === "NoLynch",
        ) &&
        document
          .querySelector('[data-testid="player-endgame-summary"]')
          ?.getAttribute("data-state") === "revealed",
    );
    const reject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const dispatchPlan = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const endgameSummaryAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.endgameSummary,
    );
    const endgameSurfaceAfterReject = await playerEndgameSummarySurface(
      stalePlayerPage,
    );
    const coldLoadEndpointsAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerColdLoadEndpoints,
    );
    const resyncKeysAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerResyncKeys,
    );
    const buttonsAfterReject = await playerCommandButtons(stalePlayerPage);
    const phaseAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState?.phase,
    );
    const currentVoteAfterReject = await stalePlayerPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiEndgameSummaryAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/endgame-summary`,
    );
    const manualResyncSnapshot = await stalePlayerPage.evaluate(
      () => window.__fmarchTriggerPlayerResync(0),
    );
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.endgameSummary?.completed === true &&
        window.__fmarchPlayerProjection?.endgameSummary?.voteHistory?.some(
          (outcome) =>
            outcome.phaseId === "D01" && outcome.status === "NoLynch",
        ) &&
        document
          .querySelector('[data-testid="player-endgame-summary"]')
          ?.getAttribute("data-state") === "revealed",
    );
    const manualEndgameResync = {
      fromSeq: 0,
      snapshotEndgameSummary: manualResyncSnapshot.endgameSummary,
      surface: await playerEndgameSummarySurface(stalePlayerPage),
    };
    const reloadResponse = await stalePlayerPage.goto(
      `${frontendBaseUrl}/g/${completeGame}`,
      {
        waitUntil: "networkidle",
      },
    );
    if (reloadResponse === null || !reloadResponse.ok()) {
      throw new Error(
        `stale public player complete reload failed with ${
          reloadResponse?.status() ?? "no response"
        }`,
      );
    }
    await stalePlayerPage.getByTestId("player-surface").waitFor({ state: "visible" });
    await stalePlayerPage.getByTestId("player-thread-pager").waitFor({
      state: "visible",
    });
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        window.__fmarchPlayerProjection?.endgameSummary?.completed === true &&
        window.__fmarchPlayerProjection?.endgameSummary?.voteHistory?.some(
          (outcome) =>
            outcome.phaseId === "D01" && outcome.status === "NoLynch",
        ) &&
        document
          .querySelector('[data-testid="player-endgame-summary"]')
          ?.getAttribute("data-state") === "revealed",
    );
    const reloadSurfaceText = await stalePlayerPage
      .getByTestId("player-surface")
      .innerText();
    const reloadThreadPagerVisible = await stalePlayerPage
      .getByTestId("player-thread-pager")
      .isVisible();
    const reloadCommandState = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const recoveredEndgameSummary = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.endgameSummary,
    );
    const reloadEndgameSurface = await playerEndgameSummarySurface(stalePlayerPage);
    const reloadButtons = await playerCommandButtons(stalePlayerPage);
    const reloadThreadPostBodies = await stalePlayerPage.evaluate(
      () =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).map((post) => post.body),
    );
    const reloadCurrentVote = await stalePlayerPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const apiCommandStateAfterReload = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiThreadAfterReload = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/channels/${hardeningRetryChannel}/thread?principal_user_id=player-mira&limit=100`,
    );
    const apiThreadPostBodiesAfterReload = (
      apiThreadAfterReload.posts ?? []
    ).map((post) => post.body);
    const apiStateAfterReload = await fetchHostConsoleState({
      apiBaseUrl,
      game: completeGame,
    });
    const stalePublicReloadAfterReject = {
      status: "passed",
      routeResponseStatus: reloadResponse.status(),
      surfaceText: reloadSurfaceText,
      threadPagerVisible: reloadThreadPagerVisible,
      recoveredCommandState: reloadCommandState,
      recoveredEndgameSummary,
      endgameSurface: reloadEndgameSurface,
      reloadButtons,
      reloadCurrentVote,
      reloadThreadPostBodies,
      apiCommandStateAfterReload,
      apiThreadPostBodiesAfterReload,
      apiStateAfterReload,
    };
    if (
      reject?.state !== "reject" ||
      reject?.error !== "GameAlreadyCompleted" ||
      reject?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(reject?.streamSeqs) ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      commandStateAfterReject?.gameCompleted !== true ||
      commandStateAfterReject?.actions?.length !== 0 ||
      commandStateAfterReject?.voteTargets?.length !== 0 ||
      !commandStateAfterReject?.boundary?.includes("game is complete") ||
      buttonsAfterReject.some((button) => button.disabled !== true) ||
      phaseAfterReject?.phaseId !== "D01" ||
      currentVoteAfterReject.hasVote !== "false" ||
      !currentVoteAfterReject.text.includes("No current vote") ||
      apiCommandStateAfterReject?.game_completed !== true ||
      apiCommandStateAfterReject?.actions?.length !== 0 ||
      apiCommandStateAfterReject?.vote_targets?.length !== 0 ||
      stalePublicReloadAfterReject.routeResponseStatus !== 200 ||
      stalePublicReloadAfterReject.threadPagerVisible !== true ||
      !stalePublicReloadAfterReject.surfaceText.includes("Endgame") ||
      !stalePublicReloadAfterReject.surfaceText.includes("The game is complete.") ||
      stalePublicReloadAfterReject.recoveredCommandState?.actorSlot !== "slot-7" ||
      stalePublicReloadAfterReject.recoveredCommandState?.gameCompleted !== true ||
      stalePublicReloadAfterReject.recoveredCommandState?.actions?.length !== 0 ||
      stalePublicReloadAfterReject.recoveredCommandState?.voteTargets?.length !== 0 ||
      !stalePublicReloadAfterReject.recoveredCommandState?.boundary?.includes(
        "game is complete",
      ) ||
      stalePublicReloadAfterReject.reloadButtons.some(
        (button) => button.disabled !== true,
      ) ||
      stalePublicReloadAfterReject.reloadCurrentVote.hasVote !== "false" ||
      !stalePublicReloadAfterReject.reloadCurrentVote.text.includes("No current vote") ||
      !sameArray(
        stalePublicReloadAfterReject.reloadThreadPostBodies,
        seed.expectedThreadBodies,
      ) ||
      stalePublicReloadAfterReject.apiCommandStateAfterReload?.game_completed !== true ||
      stalePublicReloadAfterReject.apiCommandStateAfterReload?.actions?.length !== 0 ||
      stalePublicReloadAfterReject.apiCommandStateAfterReload?.vote_targets?.length !==
        0 ||
      !sameArray(
        stalePublicReloadAfterReject.apiThreadPostBodiesAfterReload,
        seed.expectedThreadBodies,
      ) ||
      stalePublicReloadAfterReject.apiStateAfterReload?.completed !== true ||
      stalePublicReloadAfterReject.apiStateAfterReload?.slots?.length !==
        seed.slotCount ||
      stalePublicReloadAfterReject.apiStateAfterReload.slots.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      )
    ) {
      throw new Error(
        `stale player complete recovery drifted: ${JSON.stringify({
          completeGame,
          seed,
          setupCommandState,
          setupButtons,
          staleVoteButton,
          closedStatus,
          liveComplete,
          reject,
          commandStateAfterReject,
          dispatchPlan,
          buttonsAfterReject,
          phaseAfterReject,
          currentVoteAfterReject,
          apiCommandStateAfterReject,
          stalePublicReloadAfterReject,
        })}`,
      );
    }
    const proof = {
      status: "passed",
      game: completeGame,
      seed,
      setupCommandState,
      setupButtons,
      staleVoteButton,
      closedStatus,
      liveComplete,
      reject,
      commandStateAfterReject,
      dispatchPlan,
      endgameSummaryAfterReject,
      endgameSurfaceAfterReject,
      coldLoadEndpointsAfterReject,
      resyncKeysAfterReject,
      apiEndgameSummaryAfterReject,
      manualEndgameResync,
      buttonsAfterReject,
      phaseAfterReject,
      currentVoteAfterReject,
      apiCommandStateAfterReject,
      stalePublicReloadAfterReject,
      proof:
        "A disposable player role URL froze before completion with a projection-derived vote control after a D01 no-lynch resolved from two other players' ballots, the game completed from another browser command, then that stale player vote control rejected with GameAlreadyCompleted, refreshed commandState plus the reveal-gated endgame summary and vote history, recovered the same summary through explicit live resync, disabled vote/post controls, and reloaded the public player board to completed revealed Endgame truth with durable tallies and actor ballots, no current vote, no vote targets, and no thread mutation.",
    };
    assertCompletedPlayerEndgameRefreshBrowserProof({
      proof,
      scenario: endgameScenario,
      includeEvidenceInError: true,
    });
    return proof;
  } finally {
    await stalePlayerPage.close().catch(() => {});
  }
}

async function playerEndgameSummarySurface(page) {
  const root = page.getByTestId("player-endgame-summary");
  return {
    state: await root.getAttribute("data-state"),
    winnerText: await page.getByTestId("player-endgame-winner").innerText(),
    revealRows: await page
      .locator('[data-testid^="player-endgame-reveal-"]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          testId: row.getAttribute("data-testid"),
          text: row.textContent?.trim() ?? "",
        })),
      ),
    voteRows: await page
      .locator('[data-testid^="player-endgame-vote-D"]')
      .evaluateAll((rows) =>
        rows.map((row) => ({
          testId: row.getAttribute("data-testid"),
          text: row.textContent?.trim() ?? "",
        })),
      ),
  };
}

async function playerCommandButtons(page) {
  return await page.locator("[data-action]").evaluateAll((nodes) =>
    nodes.map((node) => ({
      action: node.getAttribute("data-action"),
      disabled: node.hasAttribute("disabled"),
      text: node.textContent,
    })),
  );
}

async function submitPlayerCommandAndWait({
  page,
  actionId,
  locatorOptions = {},
  confirmTestId = null,
  waitFor,
  waitArg,
  waitOptions,
}) {
  await page.locator(`[data-action="${actionId}"]`, locatorOptions).first().click();
  if (confirmTestId) {
    const confirmButton = page.locator(`[data-testid="${confirmTestId}"]`);
    await confirmButton.waitFor({ state: "visible" });
    await confirmButton.click();
  }
  await page.waitForFunction(waitFor, waitArg, waitOptions);
  return page.evaluate(() => window.__fmarchPlayerCommandStatus);
}

async function playerProjectionSnapshot(
  page,
  {
    roleUrl = false,
    commandState = true,
    buttons = false,
    currentVote = false,
    votecount = false,
    currentReceipt = false,
    receiptStatusText = false,
    notifications = false,
    factionalKillVisible = false,
  } = {},
) {
  const snapshot = {};
  if (roleUrl) {
    snapshot.roleUrl = page.url();
  }
  if (commandState) {
    snapshot.commandState = await page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
  }
  if (buttons) {
    snapshot.buttons = await playerCommandButtons(page);
  }
  if (currentVote) {
    snapshot.currentVote = await playerCurrentVoteSnapshot(page);
  }
  if (votecount) {
    snapshot.votecount = await page.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );
  }
  if (currentReceipt) {
    snapshot.currentReceipt = await page.evaluate(
      () => window.__fmarchPlayerProjection?.currentReceipt ?? null,
    );
  }
  if (receiptStatusText) {
    snapshot.receiptStatusText = await page
      .getByTestId("player-command-status")
      .innerText();
  }
  if (notifications) {
    snapshot.notifications = await page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
  }
  if (factionalKillVisible) {
    snapshot.factionalKillVisible = await page
      .locator('[data-action="submit_action:factional_kill"]')
      .isVisible()
      .catch(() => false);
  }
  return snapshot;
}

async function playerCommandControlState(page, action) {
  const locator = page.locator(`[data-action="${action}"]`);
  const count = await locator.count();
  if (count === 0) {
    return {
      exists: false,
      disabled: true,
      reason: "control absent",
      text: "",
    };
  }
  return locator.first().evaluate((node) => ({
    exists: true,
    disabled: node.hasAttribute("disabled"),
    reason: node.getAttribute("data-disabled-reason") ?? "",
    text: node.textContent?.trim() ?? "",
  }));
}

async function seedHostPublishRaceGame({ publishRaceGame }) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(publishRaceGame)) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return {
    game: publishRaceGame,
    commands: commands.length,
  };
}

async function verifyConcurrentHostPublishRace({
  hostPage,
  playerPage,
  apiBaseUrl,
}) {
  const publishRaceGame = crypto.randomUUID();
  const seed = await seedHostPublishRaceGame({ publishRaceGame });
  const { normalizeServerCommandEnvelope } = await importFrontendModule(
    "src/lib/components/host-action/host-command-boundary.mjs",
  );
  const firstHostPage = await hostPage.context().newPage();
  const secondHostPage = await hostPage.context().newPage();
  const playerRacePage = await playerPage.context().newPage();
  try {
    const [firstHostRoute, secondHostRoute, playerRoute] = await Promise.all([
      gotoHostConsole(firstHostPage, publishRaceGame),
      gotoHostConsole(secondHostPage, publishRaceGame),
      gotoPlayerBoard(playerRacePage, publishRaceGame),
    ]);
    await Promise.all([
      firstHostPage
        .getByTestId("critical-host-action-publish_votecount")
        .waitFor({ state: "visible" }),
      secondHostPage
        .getByTestId("critical-host-action-publish_votecount")
        .waitFor({ state: "visible" }),
      firstHostPage.waitForFunction(
        () => (window.__fmarchHostVotecountProjection ?? []).length > 0,
      ),
      secondHostPage.waitForFunction(
        () => (window.__fmarchHostVotecountProjection ?? []).length > 0,
      ),
      playerRacePage.waitForFunction(
        () => (window.__fmarchPlayerProjection?.votecount ?? []).length > 0,
      ),
    ]);
    const apiVotecountBeforeRace = await fetchJson(
      `${apiBaseUrl}/games/${publishRaceGame}/votecount`,
    );
    const expectedRows = normalizedVotecountRows(apiVotecountBeforeRace).filter(
      (row) => row.phaseId === "D01",
    );
    const targetRow = expectedRows.find((row) => Number(row.count) > 0);
    const expectedBody = officialVotecountBodyFromRows("D01", expectedRows);
    if (targetRow === undefined || expectedRows.length === 0) {
      throw new Error(
        `concurrent host publish setup had no D01 votecount rows: ${JSON.stringify(
          apiVotecountBeforeRace,
        )}`,
      );
    }

    const firstCommandId = crypto.randomUUID();
    const secondCommandId = crypto.randomUUID();
    const publishCommand = { PublishVotecount: { game: publishRaceGame } };
    const [firstRaw, secondRaw] = await Promise.all([
      sendBrowserCommand(firstHostPage, {
        principalUserId: "host_h",
        command: publishCommand,
        commandId: firstCommandId,
      }),
      sendBrowserCommand(secondHostPage, {
        principalUserId: "host_h",
        command: publishCommand,
        commandId: secondCommandId,
      }),
    ]);
    const outcomes = [
      {
        role: "first",
        status: normalizeServerCommandEnvelope({
          actionId: "publish_votecount",
          commandId: firstCommandId,
          requestEnvelope: firstRaw.requestEnvelope,
          response: { status: firstRaw.httpStatus },
          serverEnvelope: firstRaw.serverEnvelope,
        }),
      },
      {
        role: "second",
        status: normalizeServerCommandEnvelope({
          actionId: "publish_votecount",
          commandId: secondCommandId,
          requestEnvelope: secondRaw.requestEnvelope,
          response: { status: secondRaw.httpStatus },
          serverEnvelope: secondRaw.serverEnvelope,
        }),
      },
    ];
    const ackOutcome = outcomes.find((outcome) => outcome.status.state === "ack");
    const rejectOutcome = outcomes.find((outcome) => outcome.status.state === "reject");

    await Promise.all([
      playerRacePage.waitForFunction(
        () => typeof window.__fmarchTriggerPlayerResync === "function",
      ),
      firstHostPage.waitForFunction(
        () => typeof window.__fmarchTriggerHostResync === "function",
      ),
      secondHostPage.waitForFunction(
        () => typeof window.__fmarchTriggerHostResync === "function",
      ),
    ]);
    await Promise.all([
      playerRacePage.evaluate(() => window.__fmarchTriggerPlayerResync(0)),
      firstHostPage.evaluate(() => window.__fmarchTriggerHostResync(0)),
      secondHostPage.evaluate(() => window.__fmarchTriggerHostResync(0)),
    ]);
    await playerRacePage.waitForFunction(
      (body) =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).some(
          (post) => post.body === body && post.authorLabel === "host",
        ),
      expectedBody,
    );
    const playerOfficialPostCount = await playerRacePage.evaluate(
      (body) =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
          (post) => post.body === body && post.authorLabel === "host",
        ).length,
      expectedBody,
    );
    const apiThread = await fetchJson(
      `${apiBaseUrl}/games/${publishRaceGame}/channels/main/thread?principal_user_id=player-mira&limit=100`,
    );
    const apiOfficialPosts = (apiThread.posts ?? []).filter(
      (post) => post.body === expectedBody && post.author_user === "host",
    );
    const commandGames = outcomes.map(
      (outcome) =>
        outcome.status.requestEnvelope?.body?.body?.command?.PublishVotecount?.game ??
        null,
    );

    const roleReloadAfterRace = await reloadConcurrentHostPublishRace({
      firstHostPage,
      secondHostPage,
      playerRacePage,
      apiBaseUrl,
      game: publishRaceGame,
      targetRow,
      expectedBody,
    });

    if (
      outcomes.filter((outcome) => outcome.status.state === "ack").length !== 1 ||
      outcomes.filter((outcome) => outcome.status.state === "reject").length !== 1 ||
      ackOutcome?.status.serverEnvelope?.body?.kind !== "Ack" ||
      !Array.isArray(ackOutcome?.status.streamSeqs) ||
      rejectOutcome?.status.error !== "InvalidTarget" ||
      rejectOutcome?.status.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(rejectOutcome?.status.streamSeqs) ||
      !rejectOutcome?.status.message?.includes("official votecount is already published") ||
      commandGames.some((commandGame) => commandGame !== publishRaceGame) ||
      apiOfficialPosts.length !== 1 ||
      playerOfficialPostCount !== 1 ||
      roleReloadAfterRace.status !== "passed"
    ) {
      throw new Error(
        `concurrent host publish race drifted: ${JSON.stringify({
          seed,
          firstHostRoute,
          secondHostRoute,
          playerRoute,
          expectedRows,
          expectedBody,
          outcomes,
          commandGames,
          apiOfficialPosts,
          playerOfficialPostCount,
          roleReloadAfterRace,
        })}`,
      );
    }

    return {
      status: "passed",
      game: publishRaceGame,
      seed,
      firstHostRoute,
      secondHostRoute,
      playerRoute,
      targetSlot: targetRow.target,
      targetCount: targetRow.count,
      expectedRows,
      expectedBody,
      apiVotecountBeforeRace,
      firstOutcome: outcomes[0].status,
      secondOutcome: outcomes[1].status,
      ackRaceRole: ackOutcome.role,
      rejectRaceRole: rejectOutcome.role,
      ack: ackOutcome.status,
      reject: rejectOutcome.status,
      commandGames,
      apiOfficialPostCount: apiOfficialPosts.length,
      playerOfficialPostCount,
      roleReloadAfterRace,
      outcomeSummary: `${ackOutcome.role} ACK, ${rejectOutcome.role} rejected duplicate official count`,
      proof:
        `Two seeded host role URLs for disposable game ${publishRaceGame} submitted PublishVotecount concurrently through /commands, exactly one ACKed, the other rejected as InvalidTarget without stream seqs, only one official D01 votecount post appeared in the player browser and API thread, then both host URLs plus the player URL reloaded to the same one-post votecount truth.`,
    };
  } finally {
    await firstHostPage.close().catch(() => {});
    await secondHostPage.close().catch(() => {});
    await playerRacePage.close().catch(() => {});
  }
}

async function reloadConcurrentHostPublishRace({
  firstHostPage,
  secondHostPage,
  playerRacePage,
  apiBaseUrl,
  game,
  targetRow,
  expectedBody,
}) {
  const [firstHostRoute, secondHostRoute, playerRoute] = await Promise.all([
    gotoHostConsole(firstHostPage, game),
    gotoHostConsole(secondHostPage, game),
    gotoPlayerBoard(playerRacePage, game),
  ]);
  await Promise.all([
    firstHostPage.waitForFunction(
      (expected) =>
        (window.__fmarchHostVotecountProjection ?? []).some(
          (row) => row.target === expected.target && row.count === expected.count,
        ),
      targetRow,
    ),
    secondHostPage.waitForFunction(
      (expected) =>
        (window.__fmarchHostVotecountProjection ?? []).some(
          (row) => row.target === expected.target && row.count === expected.count,
        ),
      targetRow,
    ),
    playerRacePage.waitForFunction(
      (expected) =>
        (window.__fmarchPlayerProjection?.votecount ?? []).some(
          (row) => row.target === expected.target && row.count === expected.count,
        ),
      targetRow,
    ),
    playerRacePage.waitForFunction(
      (body) =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
          (post) => post.body === body && post.authorLabel === "host",
        ).length === 1,
      expectedBody,
    ),
  ]);
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/main/thread?principal_user_id=player-mira&limit=100`,
  );
  const apiOfficialPostCount = (apiThread.posts ?? []).filter(
    (post) => post.body === expectedBody && post.author_user === "host",
  ).length;
  const playerOfficialPostCount = await playerRacePage.evaluate(
    (body) =>
      (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
        (post) => post.body === body && post.authorLabel === "host",
      ).length,
    expectedBody,
  );
  const firstHostProjection = await firstHostPage.evaluate(
    () => window.__fmarchHostVotecountProjection ?? [],
  );
  const secondHostProjection = await secondHostPage.evaluate(
    () => window.__fmarchHostVotecountProjection ?? [],
  );
  const playerProjection = await playerRacePage.evaluate(
    () => window.__fmarchPlayerProjection?.votecount ?? [],
  );
  const apiVotecount = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  const apiProjection = normalizedVotecountRows(apiVotecount).find(
    (row) => row.phaseId === "D01" && row.target === targetRow.target,
  );
  if (
    firstHostRoute.status !== 200 ||
    secondHostRoute.status !== 200 ||
    playerRoute.status !== 200 ||
    !firstHostProjection.some(
      (row) => row.target === targetRow.target && row.count === targetRow.count,
    ) ||
    !secondHostProjection.some(
      (row) => row.target === targetRow.target && row.count === targetRow.count,
    ) ||
    !playerProjection.some(
      (row) => row.target === targetRow.target && row.count === targetRow.count,
    ) ||
    apiProjection?.count !== targetRow.count ||
    apiOfficialPostCount !== 1 ||
    playerOfficialPostCount !== 1
  ) {
    throw new Error(
      `concurrent host publish reload drifted: ${JSON.stringify({
        firstHostRoute,
        secondHostRoute,
        playerRoute,
        targetRow,
        firstHostProjection,
        secondHostProjection,
        playerProjection,
        apiProjection,
        apiOfficialPostCount,
        playerOfficialPostCount,
      })}`,
    );
  }
  return {
    status: "passed",
    firstHostRouteStatus: firstHostRoute.status,
    secondHostRouteStatus: secondHostRoute.status,
    playerRouteStatus: playerRoute.status,
    firstHostProjection,
    secondHostProjection,
    playerProjection,
    apiProjection,
    apiOfficialPostCount,
    playerOfficialPostCount,
  };
}

async function verifyHostVotecountPublication({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  concurrentVoteRace,
}) {
  const expectedBody = `Official votecount for D02\n- ${concurrentVoteRace.targetSlot}: ${concurrentVoteRace.apiProjection.count}`;
  await hostPage.waitForFunction(
    (expected) =>
      window.__fmarchHostVotecountProjection?.some(
        (row) => row.target === expected.target && row.count === expected.count,
      ),
    {
      target: concurrentVoteRace.targetSlot,
      count: concurrentVoteRace.apiProjection.count,
    },
  );
  const hostVotecountBeforePublish = await hostPage.evaluate(
    () => window.__fmarchHostVotecountProjection,
  );
  const publish = await confirmHostAction(hostPage, "publish_votecount");
  const publishedCommand =
    publish.commandStatus?.requestEnvelope?.body?.body?.command?.PublishVotecount;
  if (publishedCommand?.game !== game) {
    throw new Error(`PublishVotecount command drifted: ${JSON.stringify(publishedCommand)}`);
  }
  await playerPage.waitForFunction(
    (body) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) => post.body === body && post.authorLabel === "host",
      ),
    expectedBody,
  );
  const playerThreadPost = await playerPage.evaluate(
    (body) =>
      window.__fmarchPlayerProjection?.thread?.posts?.find(
        (post) => post.body === body && post.authorLabel === "host",
      ),
    expectedBody,
  );
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/main/thread?principal_user_id=player-mira&limit=100`,
  );
  const apiThreadPost = apiThread.posts?.find(
    (post) => post.body === expectedBody && post.author_user === "host",
  );
  if (apiThreadPost === undefined) {
    throw new Error(
      `published official votecount was missing from API thread: ${JSON.stringify(
        apiThread.posts?.map((post) => post.body),
      )}`,
    );
  }
  const activityStatusText = await hostPage
    .locator('[data-testid="host-command-activity-status-publish_votecount"]')
    .innerText();
  if (!activityStatusText.includes("Ack: stream seqs")) {
    throw new Error(`publish votecount activity status drifted: ${activityStatusText}`);
  }
  return {
    status: "passed",
    expectedBody,
    hostVotecountBeforePublish,
    publish,
    playerThreadPost,
    apiThreadPost,
    activityStatusText,
    proof:
      "The seeded host role URL clicked the hydrated Publish count control after D02 votes existed, sent a PublishVotecount command through /commands, rendered the ACK in host command activity, and the official projection-derived votecount post appeared in the player browser thread and API thread.",
  };
}

async function verifyStaleHostPublishAfterVotecountChange({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
  concurrentVoteRace,
  normalizeCommandResponse,
}) {
  const actionId = "publish_votecount";
  const staleHostPublishPage = await hostPage.context().newPage();
  try {
    const setup = await freezeStaleHostPublishPage({
      staleHostPublishPage,
      game,
      frontendBaseUrl,
      concurrentVoteRace,
    });
    const staleBody = officialVotecountBodyFromRows("D02", setup.votecountRows);
    const changeCommandId = crypto.randomUUID();
    const changeVoteRaw = await sendBrowserCommand(playerPage, {
      principalUserId: "player-mira",
      command: {
        SubmitVote: {
          game,
          actor_slot: "slot-7",
          target: "NoLynch",
        },
      },
      commandId: changeCommandId,
    });
    const changeVote = normalizeCommandResponse({
      commandId: changeCommandId,
      requestEnvelope: changeVoteRaw.requestEnvelope,
      response: { status: changeVoteRaw.httpStatus },
      serverEnvelope: changeVoteRaw.serverEnvelope,
    });
    if (changeVote.state !== "ack") {
      throw new Error(`votecount-change setup vote did not ack: ${JSON.stringify(changeVote)}`);
    }
    await hostPage.waitForFunction(
      (expected) => {
        const rows = window.__fmarchHostVotecountProjection ?? [];
        return (
          rows.some((row) => row.target === expected.target && row.count === 1) &&
          rows.some((row) => row.target === "no_lynch" && row.count === 1)
        );
      },
      { target: concurrentVoteRace.targetSlot },
    );
    await playerPage.waitForFunction(
      (expected) => {
        const rows = window.__fmarchPlayerProjection?.votecount ?? [];
        return (
          rows.some((row) => row.target === expected.target && row.count === 1) &&
          rows.some((row) => row.target === "no_lynch" && row.count === 1)
        );
      },
      { target: concurrentVoteRace.targetSlot },
    );
    const apiVotecountAfterChange = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
    const currentRows = normalizedVotecountRows(apiVotecountAfterChange).filter(
      (row) => row.phaseId === "D02",
    );
    const expectedBody = officialVotecountBodyFromRows("D02", currentRows);
    if (
      staleBody === expectedBody ||
      !currentRows.some((row) => row.target === concurrentVoteRace.targetSlot && row.count === 1) ||
      !currentRows.some((row) => row.target === "no_lynch" && row.count === 1)
    ) {
      throw new Error(
        `votecount-change setup did not create a distinct current body: ${JSON.stringify({
          staleBody,
          expectedBody,
          currentRows,
          apiVotecountAfterChange,
        })}`,
      );
    }

    const publish = await confirmHostAction(staleHostPublishPage, actionId);
    await playerPage.waitForFunction(
      (body) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === body && post.authorLabel === "host",
        ),
      expectedBody,
    );
    const apiThread = await fetchJson(
      `${apiBaseUrl}/games/${game}/channels/main/thread?principal_user_id=player-mira&limit=100`,
    );
    const apiExpectedPosts = (apiThread.posts ?? []).filter(
      (post) => post.body === expectedBody && post.author_user === "host",
    );
    const apiStalePosts = (apiThread.posts ?? []).filter(
      (post) => post.body === staleBody && post.author_user === "host",
    );
    const playerExpectedPostCount = await playerPage.evaluate(
      (body) =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
          (post) => post.body === body && post.authorLabel === "host",
        ).length,
      expectedBody,
    );
    const playerStalePostCount = await playerPage.evaluate(
      (body) =>
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
          (post) => post.body === body && post.authorLabel === "host",
        ).length,
      staleBody,
    );
    const activityStatusText = await staleHostPublishPage
      .getByTestId(`host-command-activity-status-${actionId}`)
      .innerText();
    const activityRow = await staleHostPublishPage
      .getByTestId(`host-command-activity-${actionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      }));
    const restoreCommandId = crypto.randomUUID();
    const restoreVoteRaw = await sendBrowserCommand(playerPage, {
      principalUserId: "player-mira",
      command: {
        SubmitVote: {
          game,
          actor_slot: "slot-7",
          target: { Slot: concurrentVoteRace.targetSlot },
        },
      },
      commandId: restoreCommandId,
    });
    const restoreVote = normalizeCommandResponse({
      commandId: restoreCommandId,
      requestEnvelope: restoreVoteRaw.requestEnvelope,
      response: { status: restoreVoteRaw.httpStatus },
      serverEnvelope: restoreVoteRaw.serverEnvelope,
    });
    if (
      publish.commandStatus?.state !== "ack" ||
      publish.commandStatus?.requestEnvelope?.body?.body?.command?.PublishVotecount?.game !==
        game ||
      apiExpectedPosts.length !== 1 ||
      apiStalePosts.length !== 0 ||
      playerExpectedPostCount !== 1 ||
      playerStalePostCount !== 0 ||
      !activityStatusText.includes("Ack: stream seqs") ||
      activityRow.source !== "outcome" ||
      activityRow.actionId !== actionId ||
      restoreVote.state !== "ack"
    ) {
      throw new Error(
        `stale host publish-after-change recovery drifted: ${JSON.stringify({
          setup,
          staleBody,
          changeVote,
          apiVotecountAfterChange,
          expectedBody,
          publish,
          apiExpectedPosts,
          apiStalePosts,
          playerExpectedPostCount,
          playerStalePostCount,
          activityStatusText,
          activityRow,
          restoreVote,
        })}`,
      );
    }
    await waitForPlayerVotecount(playerPage, {
      target: concurrentVoteRace.targetSlot,
      count: concurrentVoteRace.apiProjection.count,
    });
    await hostPage.waitForFunction(
      (expected) =>
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === expected.target && row.count === expected.count,
        ),
      {
        target: concurrentVoteRace.targetSlot,
        count: concurrentVoteRace.apiProjection.count,
      },
    );
    const apiVotecountAfterRestore = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
    const restoredRow = normalizedVotecountRows(apiVotecountAfterRestore).find(
      (row) => row.phaseId === "D02" && row.target === concurrentVoteRace.targetSlot,
    );
    if (restoredRow?.count !== concurrentVoteRace.apiProjection.count) {
      throw new Error(
        `stale publish-after-change restore did not return original count: ${JSON.stringify({
          restoredRow,
          apiVotecountAfterRestore,
        })}`,
      );
    }
    return {
      status: "passed",
      actionId,
      setup,
      staleBody,
      changeVote,
      apiVotecountAfterChange,
      currentRows,
      expectedBody,
      publish,
      apiExpectedPostCount: apiExpectedPosts.length,
      apiStalePostCount: apiStalePosts.length,
      playerExpectedPostCount,
      playerStalePostCount,
      activityStatusText,
      activityRow,
      restoreVote,
      apiVotecountAfterRestore,
      proof:
        "A stale seeded host page froze a non-empty D02 Publish count control, a live player changed the votecount to a different non-empty projection, then stale PublishVotecount ACKed from server truth and appended only the current official count before the original vote count was restored for the duplicate-publish proof.",
    };
  } finally {
    await staleHostPublishPage.close().catch(() => {});
  }
}

async function submitStaleHostPublishRecovery({
  staleHostPublishPage,
  staleHostPublishSetup,
  hostVotecountPublication,
  playerPage,
  apiBaseUrl,
  game,
}) {
  const actionId = "publish_votecount";
  const expectedBody = hostVotecountPublication.expectedBody;
  const staleActionRoot = staleHostPublishPage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId: "unlock_thread",
    roleLabel: "stale host",
  });
  await staleHostPublishPage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "InvalidTarget",
    actionId,
  );
  const reject = await staleHostPublishPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const votecountActionsAfterReject = await visibleHostControlActions(
    staleHostPublishPage,
    "votecount",
  );
  const activityStatusText = await staleHostPublishPage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostPublishPage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/main/thread?principal_user_id=player-mira&limit=100`,
  );
  const apiOfficialPosts = (apiThread.posts ?? []).filter(
    (post) => post.body === expectedBody && post.author_user === "host",
  );
  const playerOfficialPostCount = await playerPage.evaluate(
    (body) =>
      (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
        (post) => post.body === body && post.authorLabel === "host",
      ).length,
    expectedBody,
  );
  if (
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("official votecount is already published") ||
    commandOutcomes.find(
      (outcome) =>
        outcome.actionId === actionId &&
        outcome.state === "reject" &&
        outcome.error === "InvalidTarget",
    ) === undefined ||
    !votecountActionsAfterReject.includes(actionId) ||
    !activityStatusText.includes("Reject InvalidTarget") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    !Array.isArray(dispatchPlan?.projectionRefreshKeys) ||
    dispatchPlan.projectionRefreshKeys.length !== 0 ||
    apiOfficialPosts.length !== 1 ||
    playerOfficialPostCount !== 1
  ) {
    throw new Error(
      `stale host publish recovery drifted: ${JSON.stringify({
        staleHostPublishSetup,
        reject,
        commandOutcomes,
        votecountActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiOfficialPosts,
        playerOfficialPostCount,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleHostPublishSetup,
    reject,
    commandOutcomes,
    votecountActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiOfficialPostCount: apiOfficialPosts.length,
    playerOfficialPostCount,
  };
}

async function submitStaleHostPublishAfterClearRecovery({
  staleHostPublishPage,
  staleHostPublishSetup,
  playerPage,
  apiBaseUrl,
  game,
}) {
  const actionId = "publish_votecount";
  const expectedBody = "Official votecount for D02\n\nNo active ballots.";
  const staleBody = staleHostPublishSetup.staleBody;
  const staleActionRoot = staleHostPublishPage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId: "unlock_thread",
    roleLabel: "stale host",
  });
  await staleHostPublishPage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "ack",
    actionId,
  );
  const publish = await staleHostPublishPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  await playerPage.waitForFunction(
    (body) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) => post.body === body && post.authorLabel === "host",
      ),
    expectedBody,
  );
  const commandOutcomes = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const votecountActionsAfterPublish = await visibleHostControlActions(
    staleHostPublishPage,
    "votecount",
  );
  const activityStatusText = await staleHostPublishPage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostPublishPage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostPublishPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/main/thread?principal_user_id=player-mira&limit=100`,
  );
  const apiExpectedPosts = (apiThread.posts ?? []).filter(
    (post) => post.body === expectedBody && post.author_user === "host",
  );
  const apiStalePosts = (apiThread.posts ?? []).filter(
    (post) => post.body === staleBody && post.author_user === "host",
  );
  const playerExpectedPostCount = await playerPage.evaluate(
    (body) =>
      (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
        (post) => post.body === body && post.authorLabel === "host",
      ).length,
    expectedBody,
  );
  const playerStalePostCount = await playerPage.evaluate(
    (body) =>
      (window.__fmarchPlayerProjection?.thread?.posts ?? []).filter(
        (post) => post.body === body && post.authorLabel === "host",
      ).length,
    staleBody,
  );
  if (
    publish?.state !== "ack" ||
    publish?.requestEnvelope?.body?.body?.command?.PublishVotecount?.game !== game ||
    commandOutcomes.find(
      (outcome) => outcome.actionId === actionId && outcome.state === "ack",
    ) === undefined ||
    !votecountActionsAfterPublish.includes(actionId) ||
    !activityStatusText.includes("Ack: stream seqs") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    !Array.isArray(dispatchPlan?.projectionRefreshKeys) ||
    dispatchPlan.projectionRefreshKeys.length !== 0 ||
    apiExpectedPosts.length !== 1 ||
    apiStalePosts.length !== 0 ||
    playerExpectedPostCount !== 1 ||
    playerStalePostCount !== 0
  ) {
    throw new Error(
      `stale host publish-after-clear recovery drifted: ${JSON.stringify({
        staleHostPublishSetup,
        publish,
        commandOutcomes,
        votecountActionsAfterPublish,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiExpectedPosts,
        apiStalePosts,
        playerExpectedPostCount,
        playerStalePostCount,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleHostPublishSetup,
    expectedBody,
    staleBody,
    publish,
    commandOutcomes,
    votecountActionsAfterPublish,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiExpectedPostCount: apiExpectedPosts.length,
    apiStalePostCount: apiStalePosts.length,
    playerExpectedPostCount,
    playerStalePostCount,
    proof:
      "A stale seeded host page froze a non-empty D02 Publish count control, the live host killed the voted target so the server votecount became empty, then the stale PublishVotecount click ACKed from server truth and appended the empty official count without publishing the stale ballot row.",
  };
}

async function verifyHostLifecycleControl({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  normalizeCommandResponse,
  staleHostLifecyclePage,
  staleHostLifecycleSetup,
}) {
  const result = await verifyHostSlotLifecycleControl({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
    actionId: "mark_dead",
    lifecycleStatus: "dead",
    lifecycleLabel: "Dead",
    directPostBody: "Host lifecycle dead-slot recovery proof.",
    staleHostLifecyclePage,
    staleHostLifecycleSetup,
    proof:
      "The seeded host role URL clicked Mark dead for Slot 7, emitted SetSlotStatus through /commands, host and player browser projections rendered Slot 7 dead, the affected player role URL disabled vote/post/action controls and rejected a direct SubmitPost as SlotNotAlive, then the host restored Slot 7 alive so later seeded proofs continue from the canonical game state.",
  });
  return {
    ...result,
    markDead: result.action,
    hostReplacementAfterDead: result.hostReplacementAfterStatus,
    apiSlotAfterDead: result.apiSlotAfterStatus,
    playerCommandStateAfterDead: result.playerCommandStateAfterStatus,
  };
}

async function verifyHostModkillControl({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  normalizeCommandResponse,
  staleHostLifecyclePage,
  staleHostLifecycleSetup,
}) {
  const result = await verifyHostSlotLifecycleControl({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
    actionId: "modkill_slot",
    lifecycleStatus: "modkilled",
    lifecycleLabel: "Modkilled",
    directPostBody: "Host lifecycle modkill recovery proof.",
    staleHostLifecyclePage,
    staleHostLifecycleSetup,
    proof:
      "The seeded host role URL clicked Modkill slot for Slot 7, emitted SetSlotStatus through /commands, host and player browser projections rendered Slot 7 modkilled, the affected player role URL disabled vote/post/action controls and rejected a direct SubmitPost as SlotNotAlive, then the host restored Slot 7 alive so later seeded proofs continue from the canonical game state.",
  });
  return {
    ...result,
    modkill: result.action,
    hostReplacementAfterModkill: result.hostReplacementAfterStatus,
    apiSlotAfterModkill: result.apiSlotAfterStatus,
    playerCommandStateAfterModkill: result.playerCommandStateAfterStatus,
  };
}

async function verifyHostSlotLifecycleControl({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  normalizeCommandResponse,
  actionId,
  lifecycleStatus,
  lifecycleLabel,
  directPostBody,
  staleHostLifecyclePage,
  staleHostLifecycleSetup,
  proof,
}) {
  const targetSlot = "slot-7";
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    (slot) =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === slot &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive",
    targetSlot,
  );

  const action = await confirmHostAction(hostPage, actionId);
  const setSlotStatusCommand =
    action.commandStatus?.requestEnvelope?.body?.body?.command?.SetSlotStatus;
  if (
    setSlotStatusCommand?.game !== game ||
    setSlotStatusCommand?.slot !== targetSlot ||
    setSlotStatusCommand?.status !== lifecycleStatus
  ) {
    throw new Error(`${actionId} command drifted: ${JSON.stringify(setSlotStatusCommand)}`);
  }
  await hostPage.waitForFunction(
    (expected) =>
      window.__fmarchHostProjection?.replacement?.lifecycleLabel === expected,
    lifecycleLabel,
  );
  const hostReplacementAfterStatus = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const apiSlotAfterStatus = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: targetSlot,
  });
  await playerPage.waitForFunction(
    (expected) =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === expected.slot &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
      window.__fmarchPlayerProjection?.commandState?.actorStatus === expected.status &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
    { slot: targetSlot, status: lifecycleStatus },
  );
  const playerCommandStateAfterStatus = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const disabledControls = {
    vote: await playerCommandControlState(playerPage, "submit_vote"),
    withdraw: await playerCommandControlState(playerPage, "withdraw_vote"),
    post: await playerCommandControlState(playerPage, "submit_post"),
  };
  const actionControlCount = await playerPage.locator('[data-action^="submit_action"]').count();
  const directPostCommandId = crypto.randomUUID();
  const directPostRaw = await sendBrowserCommand(playerPage, {
    principalUserId: "player-mira",
    commandId: directPostCommandId,
    command: {
      SubmitPost: {
        game,
        channel_id: "main",
        actor_slot: targetSlot,
        body: directPostBody,
        media: null,
      },
    },
  });
  const directPost = normalizeCommandResponse({
    commandId: directPostCommandId,
    requestEnvelope: directPostRaw.requestEnvelope,
    response: { status: directPostRaw.httpStatus },
    serverEnvelope: directPostRaw.serverEnvelope,
  });
  if (
    apiSlotAfterStatus?.alive !== false ||
    apiSlotAfterStatus?.status !== lifecycleStatus ||
    playerCommandStateAfterStatus?.actorAlive !== false ||
    playerCommandStateAfterStatus?.actorStatus !== lifecycleStatus ||
    !Object.values(disabledControls).every((control) => control.disabled === true) ||
    actionControlCount !== 0 ||
    directPost.state !== "reject" ||
    directPost.error !== "SlotNotAlive" ||
    !directPost.message.includes("slot is no longer alive")
  ) {
    throw new Error(
      `host lifecycle ${lifecycleStatus} recovery drifted: ${JSON.stringify({
        apiSlotAfterStatus,
        playerCommandStateAfterStatus,
        disabledControls,
        actionControlCount,
        directPost,
      })}`,
    );
  }

  const staleDuplicateStatus =
    staleHostLifecyclePage === undefined || staleHostLifecycleSetup === undefined
      ? undefined
      : await submitStaleHostLifecycleRecovery({
          staleHostLifecyclePage,
          staleHostLifecycleSetup,
          actionId,
          lifecycleStatus,
          lifecycleLabel,
          apiBaseUrl,
          game,
          playerPage,
        });

  const restoreAlive = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: targetSlot,
    status: "alive",
  });
  await hostPage.waitForFunction(
    () => window.__fmarchHostProjection?.replacement?.lifecycleLabel === "Alive",
  );
  const hostReplacementAfterRestore = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const apiSlotAfterRestore = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: targetSlot,
  });
  await playerPage.waitForFunction(
    (slot) =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === slot &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive",
    targetSlot,
  );
  const playerCommandStateAfterRestore = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  if (
    apiSlotAfterRestore?.alive !== true ||
    apiSlotAfterRestore?.status !== "alive" ||
    playerCommandStateAfterRestore?.actorAlive !== true ||
    playerCommandStateAfterRestore?.actorStatus !== "alive"
  ) {
    throw new Error(
      `host lifecycle restore drifted: ${JSON.stringify({
        apiSlotAfterRestore,
        playerCommandStateAfterRestore,
      })}`,
    );
  }

  return {
    status: "passed",
    targetSlot,
    action,
    hostReplacementAfterStatus,
    apiSlotAfterStatus,
    playerCommandStateAfterStatus,
    disabledControls,
    actionControlCount,
    directPost,
    ...(staleDuplicateStatus === undefined ? {} : { staleDuplicateStatus }),
    restoreAlive,
    hostReplacementAfterRestore,
    apiSlotAfterRestore,
    playerCommandStateAfterRestore,
    proof,
  };
}

async function submitStaleHostLifecycleRecovery({
  staleHostLifecyclePage,
  staleHostLifecycleSetup,
  actionId,
  lifecycleStatus,
  lifecycleLabel,
  apiBaseUrl,
  game,
  playerPage,
}) {
  const action = await confirmHostAction(staleHostLifecyclePage, actionId, "reject");
  await staleHostLifecyclePage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "InvalidTarget",
    actionId,
  );
  const reject = action.commandStatus;
  const commandOutcomes = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const replacementAfterReject = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const lifecycleActionsAfterReject = await visibleHostControlActions(
    staleHostLifecyclePage,
    "slot-lifecycle",
  );
  const activityStatusText = await staleHostLifecyclePage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostLifecyclePage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const apiSlotAfterReject = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const playerCommandStateAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const reloadAfterReject = await gotoHostConsole(staleHostLifecyclePage, game);
  await staleHostLifecyclePage.waitForFunction(
    (expected) =>
      window.__fmarchHostProjection?.replacement?.lifecycleLabel === expected,
    lifecycleLabel,
  );
  const surfaceTextAfterReload = await staleHostLifecyclePage
    .getByTestId("host-console-surface")
    .innerText();
  const phaseAfterReload = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const replacementAfterReload = await staleHostLifecyclePage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const lifecycleActionsAfterReload = await visibleHostControlActions(
    staleHostLifecyclePage,
    "slot-lifecycle",
  );
  const apiSlotAfterReload = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const staleHostSlotLifecycleReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadAfterReject.status,
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    phaseAfterReload,
    replacementAfterReload,
    lifecycleActionsAfterReload,
    apiSlotAfterReload,
  };
  if (
    staleHostLifecycleSetup?.replacement?.lifecycleLabel !== "Alive" ||
    !staleHostLifecycleSetup?.lifecycleActions?.includes(actionId) ||
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("slot lifecycle changed or is already current") ||
    commandOutcomes.find(
      (outcome) =>
        outcome.actionId === actionId &&
        outcome.state === "reject" &&
        outcome.error === "InvalidTarget",
    ) === undefined ||
    replacementAfterReject?.lifecycleLabel !==
      staleHostLifecycleSetup.replacement.lifecycleLabel ||
    !lifecycleActionsAfterReject.includes(actionId) ||
    !activityStatusText.includes("Reject InvalidTarget") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    !Array.isArray(dispatchPlan?.projectionRefreshKeys) ||
    dispatchPlan.projectionRefreshKeys.length !== 0 ||
    apiSlotAfterReject?.alive !== false ||
    apiSlotAfterReject?.status !== lifecycleStatus ||
    playerCommandStateAfterReject?.actorAlive !== false ||
    playerCommandStateAfterReject?.actorStatus !== lifecycleStatus ||
    staleHostSlotLifecycleReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostSlotLifecycleReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject InvalidTarget",
    ) ||
    staleHostSlotLifecycleReloadAfterReject.phaseAfterReload?.id !== "D02" ||
    staleHostSlotLifecycleReloadAfterReject.phaseAfterReload?.locked !== false ||
    staleHostSlotLifecycleReloadAfterReject.replacementAfterReload
      ?.lifecycleLabel !== lifecycleLabel ||
    staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "mark_dead",
    ) ||
    staleHostSlotLifecycleReloadAfterReject.lifecycleActionsAfterReload.includes(
      "modkill_slot",
    ) ||
    staleHostSlotLifecycleReloadAfterReject.apiSlotAfterReload?.alive !== false ||
    staleHostSlotLifecycleReloadAfterReject.apiSlotAfterReload?.status !==
      lifecycleStatus
  ) {
    throw new Error(
      `stale host lifecycle recovery drifted: ${JSON.stringify({
        staleHostLifecycleSetup,
        action,
        reject,
        commandOutcomes,
        replacementAfterReject,
        lifecycleActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiSlotAfterReject,
        playerCommandStateAfterReject,
        staleHostSlotLifecycleReloadAfterReject,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    lifecycleStatus,
    setup: staleHostLifecycleSetup,
    reject,
    commandOutcomes,
    replacementAfterReject,
    lifecycleActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiSlotAfterReject,
    playerCommandStateAfterReject,
    staleHostSlotLifecycleReloadAfterReject,
  };
}

async function verifySeededReplacementConsole({
  browser,
  hostPage,
  staleOutgoingPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const hostIssuedInvite = await issueReplacementInviteFromHost({
    hostPage,
    game,
    frontendBaseUrl,
  });
  let staleHostInviteContext;
  let pendingIncomingPlayer;
  let replacementSessionRevocation;
  try {
    pendingIncomingPlayer = await verifyPendingReplacementPlayer({
      browser,
      replacementSession: hostIssuedInvite.session,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const redeemedInviteRecovery = await verifyRedeemedReplacementInviteRecovery({
      browser,
      replacementSession: hostIssuedInvite.session,
      frontendBaseUrl,
    });
    const invalidReplacementRecovery = await verifyInvalidReplacementRecovery({
      hostPage,
      pendingIncomingPlayer,
      replacementSession: hostIssuedInvite.session,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const staleHostInviteSetup = await openStaleHostInvitePage({
      browser,
      hostPage,
      game,
      frontendBaseUrl,
    });
    staleHostInviteContext = staleHostInviteSetup.context;
    const staleOutgoingSetup = await freezeStaleOutgoingReplacementPage({
      staleOutgoingPage,
      game,
    });
    const processReplacement = await confirmHostAction(hostPage, "process_replacement");
    const command = processReplacement.commandStatus?.requestEnvelope?.body?.body?.command;
    await hostPage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.replacement?.slotId === "slot-7" &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === "player-rowan",
    );
    const projectedReplacement = await hostPage.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );
    const apiState = await fetchHostConsoleState({
      apiBaseUrl,
      game,
      slot: "slot-7",
    });
    const apiSlot = apiState.slots?.find?.((slot) => slot.slot_id === "slot-7");
    const replacementIdempotentRetry = await verifyReplacementIdempotentRetry({
      hostPage,
      processReplacement,
      apiSlot,
      game,
      apiBaseUrl,
    });
    const staleHostInviteRecovery = await verifyStaleHostPlayerInviteRecovery({
      staleHostInvitePage: staleHostInviteSetup.page,
      staleHostInviteBefore: staleHostInviteSetup.before,
      game,
    });
    const staleOutgoingPlayer = await submitStaleOutgoingReplacementRecovery({
      staleOutgoingPage,
      staleOutgoingSetup,
      game,
    });
    const staleReplacementAfterSuccess = await verifyStaleReplacementAfterSuccess({
      hostPage,
      staleOutgoingPlayer,
      game,
      apiBaseUrl,
    });
    const incomingPlayer = await verifyIncomingReplacementPlayer({
      browser,
      replacementSession: hostIssuedInvite.session,
      replacementEntry: pendingIncomingPlayer.replacementEntry,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const stalePrivateChannel = await verifyReplacementStalePrivateChannel({
      staleOutgoingPage,
      replacementEntry: pendingIncomingPlayer.replacementEntry,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const stalePrivateReceipts = await verifyReplacementStalePrivateReceipts({
      staleOutgoingPage,
      replacementEntry: pendingIncomingPlayer.replacementEntry,
      game,
      apiBaseUrl,
    });
    replacementSessionRevocation =
      await verifyReplacementSessionRevocationRecovery({
        browser,
        replacementSession: hostIssuedInvite.session,
        replacementEntry: pendingIncomingPlayer.replacementEntry,
        game,
        apiBaseUrl,
        frontendBaseUrl,
      });
    const replacementSessionRefresh =
      await verifyReplacementSessionRefreshRecovery({
        replacementEntry: pendingIncomingPlayer.replacementEntry,
        game,
        apiBaseUrl,
        frontendBaseUrl,
      });
    const replacementStaleSessionAfterRefresh =
      await verifyReplacementStaleSessionAfterRefresh({
        staleEntry: replacementSessionRevocation.staleEntry,
        replacementSessionRefresh,
        game,
        apiBaseUrl,
        frontendBaseUrl,
      });
    const replacementReconnectRecovery = await verifyReplacementReconnectRecovery({
      replacementEntry: pendingIncomingPlayer.replacementEntry,
      game,
    });
    if (
      hostIssuedInvite?.status !== "passed" ||
      hostIssuedInvite?.session?.principalUserId !== "player-rowan" ||
      hostIssuedInvite?.session?.issuedBy?.principalUserId !== "host_h" ||
      hostIssuedInvite?.session?.issuedBy?.capabilityKind !== "HostOf" ||
      hostIssuedInvite?.session?.returnTo !== `/g/${game}` ||
      pendingIncomingPlayer?.status !== "passed" ||
      pendingIncomingPlayer?.capabilityLabel !== `PendingReplacement(${game})` ||
      pendingIncomingPlayer?.commandState?.actorStatus !== "pending_replacement" ||
      pendingIncomingPlayer?.controlCounts?.primaryButtons !== 0 ||
      redeemedInviteRecovery?.status !== "passed" ||
      redeemedInviteRecovery?.message !==
        "Session or invite token is missing, expired, or revoked" ||
      redeemedInviteRecovery?.sessionCookiePresent !== false ||
      invalidReplacementRecovery?.status !== "passed" ||
      invalidReplacementRecovery?.reject?.error !== "InvalidTarget" ||
      invalidReplacementRecovery?.apiSlotAfterReject?.occupant_user_id !==
        "player-mira" ||
      invalidReplacementRecovery?.pendingAfterReject?.commandState?.actorStatus !==
        "pending_replacement" ||
      invalidReplacementRecovery?.pendingAfterReject?.controlCounts?.primaryButtons !== 0 ||
      processReplacement.commandStatus?.state !== "ack" ||
      command?.ProcessReplacement?.game !== game ||
      command?.ProcessReplacement?.slot !== "slot-7" ||
      command?.ProcessReplacement?.outgoing_user !== "player-mira" ||
      command?.ProcessReplacement?.incoming_user !== "player-rowan" ||
      projectedReplacement?.slotId !== "slot-7" ||
      projectedReplacement?.occupantLabel !== "player-rowan" ||
      !projectedReplacement?.historyLabel?.includes("slot-7") ||
      apiSlot?.slot_id !== "slot-7" ||
      apiSlot?.occupant_user_id !== "player-rowan" ||
      replacementIdempotentRetry?.status !== "passed" ||
      replacementIdempotentRetry?.retryReplacement?.state !== "ack" ||
      replacementIdempotentRetry?.sameStreamSeqs !== true ||
      replacementIdempotentRetry?.apiSlotAfterRetry?.occupant_user_id !==
        "player-rowan" ||
      staleHostInviteRecovery?.status !== "passed" ||
      staleHostInviteRecovery?.beforeSubmit?.principalUserId !== "player-mira" ||
      staleHostInviteRecovery?.reject?.message?.includes("Invite target is stale") !==
        true ||
      staleHostInviteRecovery?.reject?.urlRendered !== false ||
      staleHostInviteRecovery?.retry?.state !== "ack" ||
      staleHostInviteRecovery?.retry?.target?.principalUserId !== "player-rowan" ||
      staleHostInviteRecovery?.retry?.target?.expectedOccupantUserId !==
        "player-rowan" ||
      staleHostInviteRecovery?.retry?.target?.slotId !== "slot-7" ||
      staleHostInviteRecovery?.retry?.loginUrl?.includes(`invite=player-${game}-`) !==
        true ||
      staleOutgoingPlayer?.reject?.error !== "NotYourSlot" ||
      staleOutgoingPlayer?.recoveredCommandState?.actorStatus !== "replaced" ||
      staleOutgoingPlayer?.buttonsDisabled !== true ||
      staleReplacementAfterSuccess?.status !== "passed" ||
      staleReplacementAfterSuccess?.reject?.error !== "InvalidTarget" ||
      staleReplacementAfterSuccess?.apiSlotAfterReject?.occupant_user_id !==
        "player-rowan" ||
      staleReplacementAfterSuccess?.staleOutgoingPlayer?.recoveredCommandState
        ?.actorStatus !== "replaced" ||
      incomingPlayer?.browserEntry?.principalUserId !== "player-rowan" ||
      incomingPlayer?.commandState?.actorSlot !== "slot-7" ||
      incomingPlayer?.postStatus?.state !== "ack" ||
      incomingPlayer?.vote?.serverEnvelope?.body?.kind !== "Ack" ||
      incomingPlayer?.privateReceiptIsolation?.targetKillVisible !== false ||
      stalePrivateChannel?.status !== "passed" ||
      stalePrivateChannel?.stalePost?.error !== "NotYourSlot" ||
      stalePrivateChannel?.staleRoute?.status !== 403 ||
      stalePrivateChannel?.staleControlCounts?.primaryButtons !== 0 ||
      stalePrivateChannel?.staleControlCounts?.actionButtons !== 0 ||
      stalePrivateChannel?.rowanRoute?.channelContextId !== factionDayChatChannel ||
      stalePrivateChannel?.rowanPost?.state !== "ack" ||
      stalePrivateChannel?.rowanPost?.requestEnvelope?.body?.body?.principal_user_id !==
        "player-rowan" ||
      stalePrivateChannel?.rowanPost?.requestEnvelope?.body?.body?.command?.SubmitPost
        ?.channel_id !== factionDayChatChannel ||
      stalePrivateChannel?.rowanPost?.requestEnvelope?.body?.body?.command?.SubmitPost
        ?.actor_slot !== "slot-7" ||
      stalePrivateChannel?.apiThreadPostBodies?.includes(
        stalePrivateChannel.rowanPostBody,
      ) !== true ||
      stalePrivateReceipts?.status !== "passed" ||
      stalePrivateReceipts?.staleNotifications?.status !== 403 ||
      stalePrivateReceipts?.staleInvestigationResults?.status !== 403 ||
      stalePrivateReceipts?.rowanNotifications?.status !== 200 ||
      stalePrivateReceipts?.rowanInvestigationResults?.status !== 200 ||
      stalePrivateReceipts?.rowanQueue?.count !== 0 ||
      stalePrivateReceipts?.rowanProjection?.targetKillVisible !== false ||
      stalePrivateReceipts?.rowanProjection?.actionResultVisible !== false ||
      replacementSessionRevocation?.status !== "passed" ||
      replacementSessionRevocation?.revokedPrincipalUserId !== "player-rowan" ||
      replacementSessionRevocation?.apiSessionStatus !== 401 ||
      replacementSessionRevocation?.routeErrorStatus !== 403 ||
      replacementSessionRevocation?.playerSurfaceVisible !== false ||
      replacementSessionRevocation?.controlCounts?.primaryButtons !== 0 ||
      replacementSessionRevocation?.controlCounts?.actionButtons !== 0 ||
      replacementSessionRefresh?.status !== "passed" ||
      replacementSessionRefresh?.session?.credentialKind !== "account" ||
      replacementSessionRefresh?.session?.principalUserId !== "player-rowan" ||
      replacementSessionRefresh?.login?.prefilledAccountId !== true ||
      replacementSessionRefresh?.login?.submittedAccountPassword !== true ||
      replacementSessionRefresh?.login?.usedInviteToken !== false ||
      replacementSessionRefresh?.login?.usedSessionGrant !== false ||
      replacementSessionRefresh?.browserEntry?.principalUserId !== "player-rowan" ||
      replacementSessionRefresh?.browserEntry?.cookie?.valuePrefix !==
        "account-session-" ||
      replacementSessionRefresh?.browserEntry?.capabilityKinds?.includes(
        "SlotOccupant",
      ) !== true ||
      replacementSessionRefresh?.commandState?.actorSlot !== "slot-7" ||
      replacementSessionRefresh?.postStatus?.state !== "ack" ||
      replacementSessionRefresh?.privateReceiptIsolation?.targetKillVisible !== false ||
      replacementStaleSessionAfterRefresh?.status !== "passed" ||
      replacementStaleSessionAfterRefresh?.apiSessionStatus !== 401 ||
      replacementStaleSessionAfterRefresh?.routeErrorStatus !== 403 ||
      replacementStaleSessionAfterRefresh?.playerSurfaceVisible !== false ||
      replacementStaleSessionAfterRefresh?.controlCounts?.primaryButtons !== 0 ||
      replacementStaleSessionAfterRefresh?.controlCounts?.actionButtons !== 0 ||
      replacementStaleSessionAfterRefresh?.freshCredentialKind !== "account" ||
      replacementStaleSessionAfterRefresh?.freshRoleUrlHasInvite !== false ||
      replacementStaleSessionAfterRefresh?.freshRoleUrlHasAccount !== true ||
      replacementStaleSessionAfterRefresh?.staleCookie?.valuePrefix !==
        "invite-session-" ||
      replacementReconnectRecovery?.status !== "passed" ||
      replacementReconnectRecovery?.principalUserId !== "player-rowan" ||
      replacementReconnectRecovery?.actorSlot !== "slot-7" ||
      replacementReconnectRecovery?.reconnectingStatus?.state !== "reconnecting" ||
      replacementReconnectRecovery?.reconnectRecoveryEvent?.state !== "recovered" ||
      replacementReconnectRecovery?.recoveredSnapshotContainsPost !== true ||
      replacementReconnectRecovery?.recoveredCommandState?.actorSlot !== "slot-7" ||
      replacementReconnectRecovery?.recoveredCommandState?.actorAlive !== true
    ) {
      throw new Error(
        `replacement console proof drifted: ${JSON.stringify({
          hostIssuedInvite,
          pendingIncomingPlayer,
          redeemedInviteRecovery,
          invalidReplacementRecovery,
          processReplacement,
          projectedReplacement,
          apiSlot,
          replacementIdempotentRetry,
          staleHostInviteRecovery,
          staleOutgoingPlayer,
          staleReplacementAfterSuccess,
          incomingPlayer,
          stalePrivateChannel,
          stalePrivateReceipts,
          replacementSessionRevocation:
            withoutStaleReplacementEntry(replacementSessionRevocation),
          replacementSessionRefresh,
          replacementStaleSessionAfterRefresh,
          replacementReconnectRecovery,
        })}`,
      );
    }
    return {
      status: "passed",
      hostIssuedInvite,
      pendingIncomingPlayer: withoutReplacementEntry(pendingIncomingPlayer),
      redeemedInviteRecovery,
      invalidReplacementRecovery,
      processReplacement,
      projectedReplacement,
      apiSlot,
      replacementIdempotentRetry,
      staleHostInviteRecovery,
      staleOutgoingPlayer,
      staleReplacementAfterSuccess,
      incomingPlayer,
      stalePrivateChannel,
      stalePrivateReceipts,
      replacementSessionRevocation:
        withoutStaleReplacementEntry(replacementSessionRevocation),
      replacementSessionRefresh,
      replacementStaleSessionAfterRefresh,
      replacementReconnectRecovery,
      proof:
        "The seeded host role URL issued the player-rowan replacement invite, proved that URL opens as a pending replacement surface before Slot 7 transfer, proved a fresh browser cannot redeem that already-used replacement invite into another session, rejected an invalid replacement attempt without granting Rowan slot authority, processed the valid Slot 7 replacement through the hydrated ProcessReplacement control, updated the host projection to player-rowan, preserved the stable slot history boundary, replayed the same ProcessReplacement command_id and received the original ACK without moving Slot 7, recovered a stale host player-invite form by rejecting the old player-mira target and retrying the current player-rowan target from the same role surface, recovered the stale outgoing player page with a NotYourSlot receipt plus disabled old Slot 7 controls, rejected a stale post-success replacement attempt without moving Slot 7 away from Rowan, proved the same incoming player-rowan role URL can act as Slot 7 without receiving target-only private receipts, proved Mira's stale browser cannot keep private-channel authority while Rowan can post in the same private channel as current Slot 7, proved Mira's stale private receipt endpoints reject while Rowan's current private queue stays readable and free of target-only private receipts, revoked that replacement browser session and proved the role path falls back to the shared 403 recovery boundary without player controls, granted a fresh local session and proved Rowan can log in without replaying the invite and act again as Slot 7, proved a separate stale browser context holding the revoked cookie remains unauthorized and control-free after the fresh session exists elsewhere, then dropped the fresh replacement role page's live projection and proved reconnect recovers current Slot 7 state plus a new Rowan post.",
    };
  } finally {
    await staleHostInviteContext?.close().catch(() => {});
    await replacementSessionRevocation?.staleEntry?.context.close().catch(() => {});
    await pendingIncomingPlayer?.replacementEntry?.context.close().catch(() => {});
  }
}

function withoutReplacementEntry(pendingIncomingPlayer) {
  const { replacementEntry, ...serializable } = pendingIncomingPlayer;
  return serializable;
}

function withoutStaleReplacementEntry(replacementSessionRevocation) {
  const { staleEntry, ...serializable } = replacementSessionRevocation;
  return serializable;
}

async function issueReplacementInviteFromHost({ hostPage, game, frontendBaseUrl }) {
  await hostPage.getByTestId("host-replacement-invite-panel").waitFor({
    state: "visible",
  });
  const targetLabel = await hostPage
    .getByTestId("host-replacement-invite-target")
    .innerText();
  const replacementAccount = localAccountForPrincipal("player-rowan");
  await hostPage
    .getByTestId("host-replacement-invite-account")
    .fill(replacementAccount.accountId);
  await hostPage.getByTestId("host-replacement-invite-submit").click();
  await hostPage.getByTestId("host-replacement-invite-url").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const statusText = await hostPage.getByTestId("host-replacement-invite-status").innerText();
  const statusState = await hostPage
    .getByTestId("host-replacement-invite-status")
    .getAttribute("data-state");
  const href = await hostPage.getByTestId("host-replacement-invite-url").getAttribute("href");
  const loginUrl = new URL(href, frontendBaseUrl);
  const inviteToken = loginUrl.searchParams.get("invite");
  const returnTo = loginUrl.searchParams.get("returnTo");
  const accountId = loginUrl.searchParams.get("account");
  const session = {
    principalUserId: "player-rowan",
    credentialKind: "invite",
    token: inviteToken,
    inviteToken,
    accountId,
    password: replacementAccount.password,
    loginUrl: loginUrl.toString(),
    directUrl: `${frontendBaseUrl}${returnTo}`,
    returnTo,
    expectedCapabilityKind: "SlotOccupant",
    globalCapabilities: [],
    issuedBy: {
      principalUserId: "host_h",
      capabilityKind: "HostOf",
      game,
      surface: "host-replacement-invite-panel",
    },
  };
  if (
    statusState !== "ack" ||
    !statusText.includes("Replacement invite issued") ||
    targetLabel !== "Slot 7 / player-rowan" ||
    loginUrl.origin !== frontendBaseUrl ||
    loginUrl.pathname !== "/auth/login" ||
    returnTo !== `/g/${game}` ||
    accountId !== replacementAccount.accountId ||
    typeof inviteToken !== "string" ||
    !inviteToken.startsWith(`replacement-${game}-`)
  ) {
    throw new Error(
      `host replacement invite proof drifted: ${JSON.stringify({
        statusState,
        statusText,
        targetLabel,
        loginUrl: loginUrl.toString(),
        returnTo,
        accountId,
        inviteTokenPrefix: inviteToken?.slice(0, `replacement-${game}-`.length),
      })}`,
    );
  }
  return {
    status: "passed",
    targetLabel,
    statusText,
    loginUrl: loginUrl.toString(),
    returnTo,
    inviteTokenPrefix: `replacement-${game}-`,
    tokenPresent: true,
    session,
    proof:
      "The seeded host role URL issued a local replacement invite for player-rowan through the host page action and rendered the resulting role URL before replacement processing.",
  };
}

async function openStaleHostInvitePage({ browser, hostPage, game, frontendBaseUrl }) {
  const hostCookies = await hostPage.context().cookies(frontendBaseUrl);
  const sessionCookie = hostCookies.find((cookie) => cookie.name === "fmarch_session");
  if (sessionCookie === undefined) {
    throw new Error("stale host invite proof requires an authenticated host cookie");
  }
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await context.addInitScript(() => {
    window.WebSocket = undefined;
  });
  await context.addCookies([sessionCookie]);
  const page = await context.newPage();
  try {
    await page.goto(`${frontendBaseUrl}/g/${game}/host`, { waitUntil: "networkidle" });
    await page.getByTestId("host-player-invite-panel").waitFor({ state: "visible" });
    await page
      .getByTestId("host-player-invite-account")
      .fill(localAccountForPrincipal("player-mira").accountId);
    const before = await readPlayerInviteTarget(page);
    if (
      before.principalUserId !== "player-mira" ||
      before.expectedOccupantUserId !== "player-mira" ||
      before.slotId !== "slot-7"
    ) {
      throw new Error(
        `stale host invite page was not pre-replacement: ${JSON.stringify(before)}`,
      );
    }
    return { context, page, before };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function readPlayerInviteTarget(page) {
  return {
    targetLabel: await page.getByTestId("host-player-invite-target").innerText(),
    accountId: await page.getByTestId("host-player-invite-account").inputValue(),
    principalUserId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="principalUserId"]')
      .inputValue(),
    slotId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="slotId"]')
      .inputValue(),
    expectedOccupantUserId: await page
      .getByTestId("host-player-invite-panel")
      .locator('input[name="expectedOccupantUserId"]')
      .inputValue(),
  };
}

async function verifyStaleHostPlayerInviteRecovery({
  staleHostInvitePage,
  staleHostInviteBefore,
  game,
}) {
  const submit = staleHostInvitePage.getByTestId("host-player-invite-submit");
  await submit.click();
  const status = staleHostInvitePage.getByTestId("host-player-invite-status");
  await status.waitFor({ state: "visible" });
  await staleHostInvitePage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-player-invite-status"]')
        ?.getAttribute("data-state") === "reject",
  );
  const message = await status.innerText();
  const urlRendered =
    (await staleHostInvitePage.getByTestId("host-player-invite-url").count()) > 0;
  const retry = staleHostInvitePage.getByTestId("host-player-invite-retry-submit");
  await retry.waitFor({ state: "visible" });
  const retryTarget = {
    principalUserId: await staleHostInvitePage
      .getByTestId("host-player-invite-retry")
      .locator('input[name="principalUserId"]')
      .inputValue(),
    slotId: await staleHostInvitePage
      .getByTestId("host-player-invite-retry")
      .locator('input[name="slotId"]')
      .inputValue(),
    expectedOccupantUserId: await staleHostInvitePage
      .getByTestId("host-player-invite-retry")
      .locator('input[name="expectedOccupantUserId"]')
      .inputValue(),
  };
  const retryAccount = localAccountForPrincipal("player-rowan");
  await staleHostInvitePage
    .getByTestId("host-player-invite-retry-account")
    .fill(retryAccount.accountId);
  await retry.click();
  await staleHostInvitePage.waitForFunction(
    () =>
      document
        .querySelector('[data-testid="host-player-invite-status"]')
        ?.getAttribute("data-state") === "ack",
  );
  const retryMessage = await status.innerText();
  const retryLoginUrl = await staleHostInvitePage
    .getByTestId("host-player-invite-url")
    .innerText();
  return {
    status: "passed",
    beforeSubmit: staleHostInviteBefore,
    reject: {
      state: "reject",
      message,
      urlRendered,
    },
    retry: {
      state: "ack",
      target: retryTarget,
      message: retryMessage,
      loginUrl: retryLoginUrl,
      inviteTokenPrefix: `player-${game}-`,
    },
    proof:
      "A stale seeded host role page loaded the player invite form for player-mira before replacement, submitted it after Slot 7 moved to player-rowan, rendered stale-target recovery without an invite URL, then retried the current player-rowan target from the same role surface and received a fresh player invite URL.",
  };
}

async function verifyPendingReplacementPlayer({
  browser,
  replacementSession,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(replacementSession.loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
    const prefilled = await page.getByTestId("auth-login-token").inputValue();
    if (prefilled !== replacementSession.inviteToken) {
      await page.getByTestId("auth-login-token").fill(replacementSession.inviteToken);
    }
    await page.getByTestId("auth-login-account").fill(replacementSession.accountId);
    await page.getByTestId("auth-login-password").fill(replacementSession.password);
    await Promise.all([
      page.waitForURL(replacementSession.directUrl, { timeout: 15000 }),
      page.getByTestId("auth-login-submit").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.getByTestId("player-surface").waitFor({ state: "visible" });
    await page.getByTestId("route-state-player-empty").waitFor({ state: "visible" });
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorStatus ===
        "pending_replacement",
    );
    const pending = await readPendingReplacementSurface({
      page,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    return {
      status: "passed",
      ...pending,
      replacementEntry: {
        context,
        page,
        verification: {
          principalUserId: pending.principalUserId,
          capabilityKinds: pending.capabilityKinds,
          cookie: pending.cookie,
        },
      },
      proof:
        "The host-issued player-rowan replacement URL opens before ProcessReplacement as an authenticated pending replacement surface with no current SlotOccupant capability, no command-state endpoint, and no player controls.",
    };
  } catch (error) {
    await context.close().catch(() => {});
    throw error;
  }
}

async function verifyRedeemedReplacementInviteRecovery({
  browser,
  replacementSession,
  frontendBaseUrl,
}) {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();
  try {
    await page.goto(replacementSession.loginUrl, { waitUntil: "networkidle" });
    await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
    const prefilled = await page.getByTestId("auth-login-token").inputValue();
    await page.getByTestId("auth-login-account").fill(replacementSession.accountId);
    await page.getByTestId("auth-login-password").fill(replacementSession.password);
    await page.getByTestId("auth-login-submit").click();
    await page.getByTestId("auth-login-reject").waitFor({
      state: "visible",
      timeout: 15000,
    });
    const message = await page.getByTestId("auth-login-reject").innerText();
    const cookies = await context.cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    const currentUrl = page.url();
    if (
      prefilled !== replacementSession.inviteToken ||
      message !== "Session or invite token is missing, expired, or revoked" ||
      sessionCookie !== undefined ||
      currentUrl === replacementSession.directUrl
    ) {
      throw new Error(
        `redeemed replacement invite recovery drifted: ${JSON.stringify({
          prefilled,
          expectedInviteToken: replacementSession.inviteToken,
          message,
          sessionCookiePresent: sessionCookie !== undefined,
          currentUrl,
          directUrl: replacementSession.directUrl,
        })}`,
      );
    }
    return {
      status: "passed",
      message,
      prefilledInviteToken: true,
      sessionCookiePresent: false,
      stayedOnLogin: currentUrl !== replacementSession.directUrl,
      proof:
        "A fresh browser opened the already-redeemed host-issued replacement invite URL, received the login reject message, and did not receive an fmarch_session cookie.",
    };
  } finally {
    await context.close().catch(() => {});
  }
}

async function verifyInvalidReplacementRecovery({
  hostPage,
  pendingIncomingPlayer,
  replacementSession,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const invalidActionId = "process_replacement_invalid_target";
  const attempt = await dispatchHostReplacementAttempt({
    hostPage,
    game,
    actionId: invalidActionId,
    label: "Invalid replacement",
    objectLabel: "Slot 7 / player-rowan",
    outcomeLabel: "Reject invalid replacement",
    outgoingPlayerId: "player-rowan",
    incomingPlayerId: "player-rowan",
  });
  const apiStateAfterReject = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const apiSlotAfterReject = apiStateAfterReject.slots?.find?.(
    (slot) => slot.slot_id === "slot-7",
  );
  const page = pendingIncomingPlayer.replacementEntry.page;
  await page.goto(replacementSession.directUrl, { waitUntil: "networkidle" });
  await page.getByTestId("route-state-player-empty").waitFor({ state: "visible" });
  const pendingAfterReject = await readPendingReplacementSurface({
    page,
    game,
    apiBaseUrl,
    frontendBaseUrl,
  });

  if (
    attempt.invalidReplacement.serverEnvelope?.body?.kind !== "Reject" ||
    attempt.invalidReplacement.actionId !== invalidActionId ||
    attempt.reject?.error !== "InvalidTarget" ||
    attempt.invalidReplacement.requestEnvelope?.body?.body?.principal_user_id !== "host_h" ||
    attempt.invalidReplacement.requestEnvelope?.body?.body?.command?.ProcessReplacement
      ?.outgoing_user !== "player-rowan" ||
    replacementAttemptVisibleReject(attempt, invalidActionId) !== true ||
    attempt.hostProjectionAfterReject?.occupantLabel !== "player-mira" ||
    apiSlotAfterReject?.slot_id !== "slot-7" ||
    apiSlotAfterReject?.occupant_user_id !== "player-mira" ||
    pendingAfterReject.principalUserId !== "player-rowan" ||
    pendingAfterReject.capabilityKinds.length !== 0 ||
    pendingAfterReject.capabilityLabel !== `PendingReplacement(${game})` ||
    pendingAfterReject.commandState?.actorStatus !== "pending_replacement" ||
    pendingAfterReject.coldLoadEndpoints?.commandStateEndpoint !== null ||
    pendingAfterReject.controlCounts.primaryButtons !== 0 ||
    pendingAfterReject.controlCounts.actionButtons !== 0
  ) {
    throw new Error(
      `invalid replacement recovery drifted: ${JSON.stringify({
        attempt,
        apiSlotAfterReject,
        pendingAfterReject,
      })}`,
    );
  }

  return {
    status: "passed",
    ...attempt,
    apiSlotAfterReject,
    pendingAfterReject,
    proof:
      "An invalid host ProcessReplacement with a stale outgoing user rejected as InvalidTarget, rendered a host command-activity recovery receipt, left Slot 7 owned by player-mira, and left the host-issued player-rowan URL pending with no SlotOccupant authority or controls.",
  };
}

async function verifyStaleReplacementAfterSuccess({
  hostPage,
  staleOutgoingPlayer,
  game,
  apiBaseUrl,
}) {
  const staleActionId = "process_replacement_stale_success";
  const attempt = await dispatchHostReplacementAttempt({
    hostPage,
    game,
    actionId: staleActionId,
    label: "Stale replacement",
    objectLabel: "Slot 7 / player-mira",
    outcomeLabel: "Reject stale replacement",
    outgoingPlayerId: "player-mira",
    incomingPlayerId: "player-rowan",
  });
  const apiStateAfterReject = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const apiSlotAfterReject = apiStateAfterReject.slots?.find?.(
    (slot) => slot.slot_id === "slot-7",
  );
  if (
    attempt.invalidReplacement.serverEnvelope?.body?.kind !== "Reject" ||
    attempt.invalidReplacement.actionId !== staleActionId ||
    attempt.reject?.error !== "InvalidTarget" ||
    attempt.invalidReplacement.requestEnvelope?.body?.body?.principal_user_id !==
      "host_h" ||
    attempt.invalidReplacement.requestEnvelope?.body?.body?.command?.ProcessReplacement
      ?.outgoing_user !== "player-mira" ||
    replacementAttemptVisibleReject(attempt, staleActionId) !== true ||
    attempt.hostProjectionAfterReject?.occupantLabel !== "player-rowan" ||
    apiSlotAfterReject?.slot_id !== "slot-7" ||
    apiSlotAfterReject?.occupant_user_id !== "player-rowan" ||
    staleOutgoingPlayer?.recoveredCommandState?.actorStatus !== "replaced" ||
    staleOutgoingPlayer?.buttonsDisabled !== true
  ) {
    throw new Error(
      `stale replacement after success drifted: ${JSON.stringify({
        attempt,
        apiSlotAfterReject,
        staleOutgoingPlayer,
      })}`,
    );
  }
  return {
    status: "passed",
    ...attempt,
    apiSlotAfterReject,
    staleOutgoingPlayer,
    proof:
      "After Slot 7 transferred to player-rowan, a stale host ProcessReplacement using player-mira as outgoing rejected as InvalidTarget, rendered a host command-activity receipt, left Slot 7 on player-rowan, and preserved the outgoing Mira page's replaced disabled recovery.",
  };
}

async function verifyReplacementIdempotentRetry({
  hostPage,
  processReplacement,
  apiSlot,
  game,
  apiBaseUrl,
}) {
  const originalBody = processReplacement.commandStatus?.requestEnvelope?.body?.body;
  const originalAck = processReplacement.commandStatus?.serverEnvelope?.body?.body;
  const commandId = originalBody?.command_id;
  const command = originalBody?.command;
  const retry = await sendBrowserCommand(hostPage, {
    principalUserId: "host_h",
    commandId,
    command,
  });
  const retryAck = retry.serverEnvelope?.body?.body;
  await hostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.replacement?.slotId === "slot-7" &&
      window.__fmarchHostProjection?.replacement?.occupantLabel === "player-rowan",
  );
  const hostProjectionAfterRetry = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  const apiStateAfterRetry = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const apiSlotAfterRetry = apiStateAfterRetry.slots?.find?.(
    (slot) => slot.slot_id === "slot-7",
  );
  const sameStreamSeqs = sameArray(originalAck?.stream_seqs, retryAck?.stream_seqs);
  if (
    processReplacement.commandStatus?.state !== "ack" ||
    retry.serverEnvelope?.body?.kind !== "Ack" ||
    retry.httpStatus !== 200 ||
    commandId === undefined ||
    command?.ProcessReplacement?.game !== game ||
    command?.ProcessReplacement?.slot !== "slot-7" ||
    command?.ProcessReplacement?.outgoing_user !== "player-mira" ||
    command?.ProcessReplacement?.incoming_user !== "player-rowan" ||
    sameStreamSeqs !== true ||
    apiSlot?.occupant_user_id !== "player-rowan" ||
    apiSlotAfterRetry?.slot_id !== "slot-7" ||
    apiSlotAfterRetry?.occupant_user_id !== "player-rowan" ||
    hostProjectionAfterRetry?.slotId !== "slot-7" ||
    hostProjectionAfterRetry?.occupantLabel !== "player-rowan" ||
    !hostProjectionAfterRetry?.historyLabel?.includes("slot-7")
  ) {
    throw new Error(
      `replacement idempotent retry drifted: ${JSON.stringify({
        processReplacement,
        retry,
        sameStreamSeqs,
        apiSlot,
        apiSlotAfterRetry,
        hostProjectionAfterRetry,
      })}`,
    );
  }
  return {
    status: "passed",
    commandId,
    originalStreamSeqs: originalAck.stream_seqs,
    retryStreamSeqs: retryAck.stream_seqs,
    sameStreamSeqs,
    retryReplacement: {
      state: "ack",
      message: `Ack: stream seqs ${retryAck.stream_seqs.join(", ")}`,
      httpStatus: retry.httpStatus,
      requestEnvelope: retry.requestEnvelope,
      serverEnvelope: retry.serverEnvelope,
    },
    hostProjectionAfterRetry,
    apiSlotAfterRetry,
    proof:
      "Replaying the successful ProcessReplacement command_id through /commands returned the original ACK stream seqs, left Slot 7 occupied by player-rowan, and preserved the stable slot-history projection.",
  };
}

async function dispatchHostReplacementAttempt({
  hostPage,
  game,
  actionId,
  label,
  objectLabel,
  outcomeLabel,
  outgoingPlayerId,
  incomingPlayerId,
}) {
  await hostPage.evaluate(
    async ({
      actionId: browserActionId,
      gameId,
      label: browserLabel,
      objectLabel: browserObjectLabel,
      outcomeLabel: browserOutcomeLabel,
      outgoingPlayerId: browserOutgoingPlayerId,
      incomingPlayerId: browserIncomingPlayerId,
    }) => {
      await window.__fmarchDispatchHostAction?.({
        type: "host-action/dispatch",
        actionId: browserActionId,
        label: browserLabel,
        objectLabel: browserObjectLabel,
        outcomeLabel: browserOutcomeLabel,
        payload: {
          kind: "process_replacement",
          gameId,
          slotId: "slot-7",
          outgoingPlayerId: browserOutgoingPlayerId,
          incomingPlayerId: browserIncomingPlayerId,
        },
        confirmationTrace: {
          kind: "confirmation-command-trace",
          confirmationKind: "confirmation-action",
          surface: "moderator-host",
          actionId: browserActionId,
          statusKey: browserActionId,
          dispatchKind: "process_replacement",
        },
      });
    },
    {
      actionId,
      gameId: game,
      label,
      objectLabel,
      outcomeLabel,
      outgoingPlayerId,
      incomingPlayerId,
    },
  );
  await hostPage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "InvalidTarget",
    actionId,
  );
  const invalidReplacement = await hostPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await hostPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const activityStatusText = await hostPage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await hostPage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      statusKey: node.getAttribute("data-confirmation-status-key"),
    }));
  const dispatchPlan = await hostPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostProjectionAfterReject = await hostPage.evaluate(
    () => window.__fmarchHostProjection?.replacement,
  );
  return {
    invalidReplacement,
    reject: invalidReplacement.serverEnvelope?.body?.body ?? null,
    commandOutcomes,
    activityStatusText,
    activityRow,
    dispatchPlan,
    hostProjectionAfterReject,
  };
}

function replacementAttemptVisibleReject(attempt, actionId) {
  return (
    attempt.commandOutcomes.some((outcome) => outcome.actionId === actionId) === true &&
    attempt.activityStatusText.includes("Reject InvalidTarget") &&
    attempt.activityStatusText.includes("replacement target is stale") &&
    attempt.activityStatusText.includes("current slot occupant") &&
    attempt.activityRow.source === "outcome" &&
    attempt.activityRow.actionId === actionId &&
    attempt.activityRow.dispatchKind === "process_replacement" &&
    attempt.dispatchPlan?.finalState === "reject" &&
    attempt.dispatchPlan?.projectionRefreshKeys?.length === 0
  );
}

async function readPendingReplacementSurface({
  page,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const cookies = await page.context().cookies(frontendBaseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
  if (sessionCookie === undefined) {
    throw new Error("pending replacement login did not set fmarch_session cookie");
  }
  const resolved = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
    headers: { authorization: `Bearer ${sessionCookie.value}` },
  });
  const capabilityKinds = (resolved.capabilities ?? []).map((capability) => capability.kind);
  const capabilityLabel = await page.getByTestId("player-capability").innerText();
  const routeStateText = await page.getByTestId("route-state-player-empty").innerText();
  const commandState = await page.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const controlCounts = {
    primaryButtons: await page.locator("[data-action]").count(),
    actionButtons: await page.locator("[data-template-id]").count(),
  };
  const coldLoadEndpoints = await page.evaluate(
    () => window.__fmarchPlayerColdLoadEndpoints,
  );
  if (
    resolved.principal_user_id !== "player-rowan" ||
    capabilityKinds.length !== 0 ||
    capabilityLabel !== `PendingReplacement(${game})` ||
    !routeStateText.includes("Replacement invite accepted") ||
    commandState?.actorStatus !== "pending_replacement" ||
    commandState?.actions?.length !== 0 ||
    coldLoadEndpoints?.commandStateEndpoint !== null ||
    controlCounts.primaryButtons !== 0 ||
    controlCounts.actionButtons !== 0
  ) {
    throw new Error(
      `pending replacement player proof drifted: ${JSON.stringify({
        resolved,
        capabilityKinds,
        capabilityLabel,
        routeStateText,
        commandState,
        coldLoadEndpoints,
        controlCounts,
      })}`,
    );
  }
  return {
    principalUserId: resolved.principal_user_id,
    capabilityKinds,
    capabilityLabel,
    routeStateText,
    commandState,
    coldLoadEndpoints,
    controlCounts,
    cookie: {
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
    },
  };
}

async function verifyIncomingReplacementPlayer({
  browser,
  replacementSession,
  replacementEntry = null,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  let ownedReplacementEntry = false;
  try {
    if (replacementEntry === null) {
      replacementEntry = await openVerifiedRoleEntry({
        browser,
        session: replacementSession,
        game,
        apiBaseUrl,
        frontendBaseUrl,
      });
      ownedReplacementEntry = true;
    } else {
      await replacementEntry.page.goto(replacementSession.directUrl, {
        waitUntil: "networkidle",
      });
    }
    const page = replacementEntry.page;
    await gotoPlayerBoard(page, game);
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    const cookies = await page.context().cookies(frontendBaseUrl);
    const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
    if (sessionCookie === undefined) {
      throw new Error("incoming replacement login did not set fmarch_session cookie");
    }
    const resolved = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    });
    const browserEntry = {
      principalUserId: resolved.principal_user_id,
      capabilityKinds: (resolved.capabilities ?? []).map((capability) => capability.kind),
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
      },
    };
    const commandState = await page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const replacementVoteTarget = commandState?.voteTargets?.find(
      (target) => target.kind === "slot",
    );
    if (replacementVoteTarget === undefined) {
      throw new Error(
        `incoming replacement player found no legal vote target: ${JSON.stringify(commandState)}`,
      );
    }
    const capabilityLabel = await page
      .getByTestId("player-command-channel-context")
      .getAttribute("data-capability-label");
    const stableHistoryVisible = await page
      .getByText("Seeded browser test-game thread post from dev:test-game.", {
        exact: true,
      })
      .isVisible()
      .catch(() => false);
    const rowanPostBody = `Replacement Rowan post from dev:test-game ${crypto.randomUUID()}.`;
    await page.locator("textarea").fill(rowanPostBody);
    await page.locator('[data-action="submit_post"]').click();
    await page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitPost?.body === expectedBody,
      rowanPostBody,
    );
    await page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === expectedBody && post.authorSlot === "slot-7",
        ),
      rowanPostBody,
    );
    const postStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
    const rowanProjectedPost = await page.evaluate((expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.find(
        (post) => post.body === expectedBody,
      ),
    rowanPostBody);
    const vote = await sendBrowserCommand(page, {
      principalUserId: "player-rowan",
      commandId: crypto.randomUUID(),
      command: {
        SubmitVote: {
          game,
          actor_slot: "slot-7",
          target: { Slot: replacementVoteTarget.slotId },
        },
      },
    });
    if (vote.serverEnvelope?.body?.kind !== "Ack") {
      throw new Error(`incoming replacement vote did not ack: ${JSON.stringify(vote)}`);
    }
    await page.evaluate(() => window.__fmarchTriggerPlayerResync?.(0));
    await page.waitForFunction(
      (targetSlot) =>
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === targetSlot && Number(row.count) >= 1,
        ),
      replacementVoteTarget.slotId,
    );
    const votecountAfterVote = await page.evaluate(
      () => window.__fmarchPlayerProjection?.votecount,
    );
    const notifications = await page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const investigationResults = await page.evaluate(
      () => window.__fmarchPlayerProjection?.investigationResults ?? [],
    );
    const privateReceiptIsolation = {
      targetKillVisible: notifications.some(
        (item) =>
          item.effect === "player_killed" ||
          item.status === "factional_kill" ||
          item.audience_slot === "slot-2",
      ),
      actionResultVisible: investigationResults.some(
        (item) =>
          item.actor_slot === "slot_4" ||
          item.action_id === "browser_factional_kill_n01" ||
          item.status === "factional_kill",
      ),
      notificationCount: notifications.length,
      investigationResultCount: investigationResults.length,
    };
    if (
      !browserEntry.capabilityKinds.includes("SlotOccupant") ||
      commandState?.actorSlot !== "slot-7" ||
      commandState?.actorAlive !== true ||
      !capabilityLabel?.includes("SlotOccupant") ||
      stableHistoryVisible !== true ||
      postStatus?.state !== "ack" ||
      postStatus?.requestEnvelope?.body?.body?.principal_user_id !== "player-rowan" ||
      postStatus?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
        "slot-7" ||
      rowanProjectedPost?.authorSlot !== "slot-7" ||
      commandState?.voteTargets?.some(
        (target) =>
          target.kind === "slot" && target.slotId === replacementVoteTarget.slotId,
      ) !== true ||
      vote.requestEnvelope?.body?.body?.principal_user_id !== "player-rowan" ||
      vote.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !== "slot-7" ||
      vote.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
        replacementVoteTarget.slotId ||
      vote.serverEnvelope?.body?.kind !== "Ack" ||
      privateReceiptIsolation.targetKillVisible !== false ||
      privateReceiptIsolation.actionResultVisible !== false
    ) {
      throw new Error(
        `incoming replacement player proof drifted: ${JSON.stringify({
          browserEntry,
          commandState,
          capabilityLabel,
          stableHistoryVisible,
          postStatus,
          rowanProjectedPost,
          replacementVoteTarget,
          vote,
          votecountAfterVote,
          privateReceiptIsolation,
        })}`,
      );
    }
    return {
      status: "passed",
      browserEntry,
      commandState,
      capabilityLabel,
      stableHistoryVisible,
      postStatus,
      rowanProjectedPost,
      replacementVoteTarget,
      vote,
      votecountAfterVote,
      privateReceiptIsolation,
      proof:
        "The incoming player-rowan role URL opened after replacement with SlotOccupant authority for slot-7, preserved Slot 7 thread history, submitted a new Slot 7 post and vote, and did not receive target-only kill or action private receipts.",
    };
  } finally {
    if (ownedReplacementEntry) {
      await replacementEntry?.context.close().catch(() => {});
    }
  }
}

async function verifyReplacementStalePrivateChannel({
  staleOutgoingPage,
  replacementEntry,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const channelRoute = encodeURIComponent(factionDayChatChannel);
  const privateUrl = `${frontendBaseUrl}/g/${game}/c/${channelRoute}`;
  const { normalizeCommandResponse } = await importFrontendModule(
    "src/lib/app/command-boundary.mjs",
  );
  const stalePostBody = `Stale Mira private post after replacement ${crypto.randomUUID()}.`;
  const stalePostCommandId = crypto.randomUUID();
  const stalePostRaw = await sendBrowserCommand(staleOutgoingPage, {
    principalUserId: "player-mira",
    commandId: stalePostCommandId,
    command: {
      SubmitPost: {
        game,
        channel_id: factionDayChatChannel,
        actor_slot: "slot-7",
        body: stalePostBody,
      },
    },
  });
  const stalePost = normalizeCommandResponse({
    commandId: stalePostCommandId,
    requestEnvelope: stalePostRaw.requestEnvelope,
    response: { status: stalePostRaw.httpStatus },
    serverEnvelope: stalePostRaw.serverEnvelope,
  });
  const commandStateAfterStalePost = await staleOutgoingPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const staleControlCounts = {
    primaryButtons: await staleOutgoingPage
      .locator("[data-action='submit_vote'], [data-action='withdraw_vote'], [data-action='submit_post']")
      .evaluateAll((nodes) => nodes.filter((node) => !node.disabled).length),
    actionButtons: await staleOutgoingPage
      .locator('[data-action^="submit_action:"]')
      .count(),
  };
  const staleRouteResponse = await staleOutgoingPage.goto(privateUrl, {
    waitUntil: "networkidle",
  });
  await staleOutgoingPage.getByTestId("route-error-surface").waitFor({
    state: "visible",
  });
  const staleRoute = {
    url: privateUrl,
    status: Number(
      await staleOutgoingPage
        .getByTestId("route-error-surface")
        .getAttribute("data-status"),
    ),
    responseStatus: staleRouteResponse?.status() ?? null,
    message: await staleOutgoingPage.getByTestId("route-error-surface").innerText(),
    actionLabel: await staleOutgoingPage.getByTestId("route-error-action").innerText(),
    actionHref: await staleOutgoingPage
      .getByTestId("route-error-action")
      .getAttribute("href"),
  };

  const rowanPage = replacementEntry?.page;
  if (rowanPage === undefined) {
    throw new Error("replacement stale private-channel proof requires replacement entry");
  }
  const rowanResponse = await rowanPage.goto(privateUrl, { waitUntil: "networkidle" });
  if (rowanResponse === null || !rowanResponse.ok()) {
    throw new Error(
      `replacement private channel route failed with ${
        rowanResponse?.status() ?? "no response"
      }`,
    );
  }
  await rowanPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const rowanChannelContext = rowanPage.getByTestId("player-command-channel-context");
  await rowanChannelContext.waitFor({ state: "visible" });
  const rowanRoute = {
    url: privateUrl,
    channelContextId: await rowanChannelContext.getAttribute("data-channel-id"),
    actorSlot: await rowanChannelContext.getAttribute("data-actor-slot"),
    capabilityLabel: await rowanChannelContext.getAttribute("data-capability-label"),
  };
  const rowanPostBody = `Replacement Rowan private-channel post ${crypto.randomUUID()}.`;
  await rowanPage.locator('[data-testid="player-composer"] textarea').fill(rowanPostBody);
  await rowanPage.locator('[data-action="submit_post"]').click();
  await rowanPage.waitForFunction(
    (expectedBody) =>
      window.__fmarchPlayerCommandStatus?.state === "ack" &&
      window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
        ?.SubmitPost?.body === expectedBody,
    rowanPostBody,
  );
  await rowanPage.waitForFunction(
    (expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) => post.body === expectedBody && post.authorSlot === "slot-7",
      ),
    rowanPostBody,
  );
  const rowanPost = await rowanPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${channelRoute}/thread?principal_user_id=player-rowan&limit=100`,
  );
  const apiThreadPostBodies = (apiThread.posts ?? []).map((post) => post.body);

  if (
    stalePost?.state !== "reject" ||
    stalePost?.error !== "NotYourSlot" ||
    !stalePost?.message?.includes("slot ownership changed") ||
    stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
      factionDayChatChannel ||
    stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
      "slot-7" ||
    commandStateAfterStalePost?.actorStatus !== "replaced" ||
    commandStateAfterStalePost?.actions?.length !== 0 ||
    staleControlCounts.primaryButtons !== 0 ||
    staleControlCounts.actionButtons !== 0 ||
    staleRoute.status !== 403 ||
    staleRoute.responseStatus !== 403 ||
    !staleRoute.message.includes("requires scoped channel capability") ||
    staleRoute.actionLabel !== "Back to board" ||
    staleRoute.actionHref !== "/" ||
    rowanRoute.channelContextId !== factionDayChatChannel ||
    rowanRoute.actorSlot !== "slot-7" ||
    !rowanRoute.capabilityLabel?.includes(
      `ChannelMember(${factionDayChatChannel})`,
    ) ||
    rowanPost?.state !== "ack" ||
    rowanPost?.requestEnvelope?.body?.body?.principal_user_id !== "player-rowan" ||
    rowanPost?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
      factionDayChatChannel ||
    rowanPost?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
      "slot-7" ||
    !apiThreadPostBodies.includes(rowanPostBody) ||
    apiThreadPostBodies.includes(stalePostBody)
  ) {
    throw new Error(
      `replacement stale private-channel proof drifted: ${JSON.stringify({
        stalePost,
        commandStateAfterStalePost,
        staleControlCounts,
        staleRoute,
        rowanRoute,
        rowanPost,
        stalePostBody,
        rowanPostBody,
        apiThreadPostBodies,
      })}`,
    );
  }

  return {
    status: "passed",
    channel: factionDayChatChannel,
    stalePost,
    commandStateAfterStalePost,
    staleControlCounts,
    staleRoute,
    rowanRoute,
    rowanPost,
    stalePostBody,
    rowanPostBody,
    apiThreadPostBodies,
    proof:
      "After Slot 7 replacement, Mira's stale browser cannot submit or route into the Slot 7 private channel, while Rowan's current replacement role URL opens the same channel and ACKs a private Slot 7 post.",
  };
}

async function verifyReplacementStalePrivateReceipts({
  staleOutgoingPage,
  replacementEntry,
  game,
  apiBaseUrl,
}) {
  const endpoints = {
    staleNotifications: `${apiBaseUrl}/games/${game}/notifications?principal_user_id=player-mira`,
    staleInvestigationResults: `${apiBaseUrl}/games/${game}/investigation-results?principal_user_id=player-mira`,
    rowanNotifications: `${apiBaseUrl}/games/${game}/notifications?principal_user_id=player-rowan`,
    rowanInvestigationResults: `${apiBaseUrl}/games/${game}/investigation-results?principal_user_id=player-rowan`,
  };
  const [
    staleNotifications,
    staleInvestigationResults,
    rowanNotifications,
    rowanInvestigationResults,
  ] = await Promise.all([
    fetchJsonStatus(endpoints.staleNotifications),
    fetchJsonStatus(endpoints.staleInvestigationResults),
    fetchJsonStatus(endpoints.rowanNotifications),
    fetchJsonStatus(endpoints.rowanInvestigationResults),
  ]);
  const rowanPage = replacementEntry?.page;
  if (rowanPage === undefined) {
    throw new Error("replacement stale private-receipt proof requires replacement entry");
  }
  await rowanPage.evaluate(() => window.__fmarchTriggerPlayerResync?.(0));
  await rowanPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7",
  );
  const rowanProjection = await rowanPage.evaluate(() => {
    const notifications = window.__fmarchPlayerProjection?.notifications ?? [];
    const investigationResults =
      window.__fmarchPlayerProjection?.investigationResults ?? [];
    return {
      notificationCount: notifications.length,
      investigationResultCount: investigationResults.length,
      targetKillVisible: notifications.some(
        (item) =>
          item.effect === "player_killed" ||
          item.status === "factional_kill" ||
          item.audience_slot === "slot-2",
      ),
      actionResultVisible: investigationResults.some(
        (item) =>
          item.actor_slot === "slot_4" ||
          item.action_id === "browser_factional_kill_n01" ||
          item.status === "factional_kill",
      ),
      notifications,
      investigationResults,
    };
  });
  const rowanQueue = {
    count: Number(
      await rowanPage.getByTestId("player-private-count").innerText(),
    ),
    emptyVisible: await rowanPage
      .getByTestId("player-private-empty")
      .isVisible()
      .catch(() => false),
    boundary: await rowanPage.getByTestId("player-private-boundary").innerText(),
  };
  const staleRouteStillForbidden = await staleOutgoingPage
    .getByTestId("route-error-surface")
    .getAttribute("data-status")
    .then((value) => Number(value) === 403)
    .catch(() => false);

  if (
    staleNotifications.status !== 403 ||
    staleNotifications.body?.error !== "NotAuthorized" ||
    !staleNotifications.body?.message?.includes(
      "cannot read player notifications",
    ) ||
    staleInvestigationResults.status !== 403 ||
    staleInvestigationResults.body?.error !== "NotAuthorized" ||
    !staleInvestigationResults.body?.message?.includes(
      "cannot read investigation results",
    ) ||
    rowanNotifications.status !== 200 ||
    !Array.isArray(rowanNotifications.body) ||
    rowanInvestigationResults.status !== 200 ||
    !Array.isArray(rowanInvestigationResults.body) ||
    rowanProjection.targetKillVisible !== false ||
    rowanProjection.actionResultVisible !== false ||
    rowanQueue.count !== 0 ||
    rowanQueue.emptyVisible !== true ||
    !rowanQueue.boundary.includes("delivered to you alone") ||
    staleRouteStillForbidden !== true
  ) {
    throw new Error(
      `replacement stale private-receipt proof drifted: ${JSON.stringify({
        endpoints,
        staleNotifications,
        staleInvestigationResults,
        rowanNotifications,
        rowanInvestigationResults,
        rowanProjection,
        rowanQueue,
        staleRouteStillForbidden,
      })}`,
    );
  }

  return {
    status: "passed",
    endpoints,
    staleNotifications,
    staleInvestigationResults,
    rowanNotifications,
    rowanInvestigationResults,
    rowanProjection,
    rowanQueue,
    staleRouteStillForbidden,
    proof:
      "After Slot 7 replacement, Mira's stale principal cannot read notification or investigation-result endpoints, while Rowan's current role surface keeps a readable empty private queue without target-only private receipts.",
  };
}

async function verifyReplacementSessionRevocationRecovery({
  browser,
  replacementSession,
  replacementEntry,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const page = replacementEntry?.page;
  const context = replacementEntry?.context;
  if (page === undefined || context === undefined) {
    throw new Error("replacement session revocation proof requires an open browser entry");
  }
  const cookies = await context.cookies(frontendBaseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
  if (sessionCookie === undefined) {
    throw new Error("replacement session revocation proof did not find fmarch_session");
  }
  const revocation = await revokeAuthSession({
    apiBaseUrl,
    token: sessionCookie.value,
  });
  const staleContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await staleContext.addCookies([
    {
      name: "fmarch_session",
      value: sessionCookie.value,
      url: frontendBaseUrl,
      httpOnly: sessionCookie.httpOnly,
      secure: sessionCookie.secure,
      sameSite: sessionCookie.sameSite,
    },
  ]);
  const stalePage = await staleContext.newPage();
  await stalePage.goto(replacementSession.directUrl, { waitUntil: "networkidle" });
  await stalePage.getByTestId("route-error-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const revokedPrincipalUserId =
    revocation.principal_user_id ?? revocation.principalUserId ?? null;
  const unauthorized = await fetchWithTimeout(
    `${apiBaseUrl}/auth/session?game=${game}`,
    {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    },
  );
  await page.goto(replacementSession.directUrl, { waitUntil: "networkidle" });
  await page.getByTestId("route-error-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const routeErrorStatus = Number(
    await page.getByTestId("route-error-surface").getAttribute("data-status"),
  );
  const routeErrorText = await page.getByTestId("route-error-panel").innerText();
  const routeErrorActionHref = await page
    .getByTestId("route-error-action")
    .getAttribute("href");
  const playerSurfaceVisible = await page
    .getByTestId("player-surface")
    .isVisible()
    .catch(() => false);
  const controlCounts = {
    primaryButtons: await page.locator("[data-action]").count(),
    actionButtons: await page.locator("[data-template-id]").count(),
  };
  if (
    revocation.status !== "revoked" ||
    revokedPrincipalUserId !== "player-rowan" ||
    unauthorized.status !== 401 ||
    routeErrorStatus !== 403 ||
    !routeErrorText.includes(
      `Game ${game} requires SlotOccupant, ChannelMember, or DeadViewer capability.`,
    ) ||
    routeErrorActionHref !== "/" ||
    playerSurfaceVisible !== false ||
    controlCounts.primaryButtons !== 0 ||
    controlCounts.actionButtons !== 0
  ) {
    throw new Error(
      `replacement session revocation recovery drifted: ${JSON.stringify({
        revocation,
        revokedPrincipalUserId,
        apiSessionStatus: unauthorized.status,
        routeErrorStatus,
        routeErrorText,
        routeErrorActionHref,
        playerSurfaceVisible,
        controlCounts,
      })}`,
    );
  }
  return {
    status: "passed",
    revokedPrincipalUserId,
    apiSessionStatus: unauthorized.status,
    routeErrorStatus,
    routeErrorActionHref,
    playerSurfaceVisible,
    controlCounts,
    sessionCookie: {
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
    },
    staleEntry: {
      context: staleContext,
      page: stalePage,
      sessionCookie: {
        value: sessionCookie.value,
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
      },
      directUrl: replacementSession.directUrl,
    },
    proof:
      "After the incoming replacement player proved Slot 7 ownership, the same browser session was revoked through /auth/session-revocations; the API rejected the old cookie, and reloading the role path rendered the shared 403 recovery surface without player controls.",
  };
}

async function verifyReplacementStaleSessionAfterRefresh({
  staleEntry,
  replacementSessionRefresh,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const page = staleEntry?.page;
  const context = staleEntry?.context;
  const sessionCookie = staleEntry?.sessionCookie;
  if (page === undefined || context === undefined || sessionCookie?.value === undefined) {
    throw new Error("stale replacement session proof requires an open stale browser entry");
  }
  const unauthorized = await fetchWithTimeout(
    `${apiBaseUrl}/auth/session?game=${game}`,
    {
      headers: { authorization: `Bearer ${sessionCookie.value}` },
    },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("route-error-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  const routeErrorStatus = Number(
    await page.getByTestId("route-error-surface").getAttribute("data-status"),
  );
  const routeErrorText = await page.getByTestId("route-error-panel").innerText();
  const routeErrorActionHref = await page
    .getByTestId("route-error-action")
    .getAttribute("href");
  const playerSurfaceVisible = await page
    .getByTestId("player-surface")
    .isVisible()
    .catch(() => false);
  const controlCounts = {
    primaryButtons: await page.locator("[data-action]").count(),
    actionButtons: await page.locator("[data-template-id]").count(),
  };
  const cookies = await context.cookies(frontendBaseUrl);
  const staleCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
  const freshRoleUrlHasInvite =
    replacementSessionRefresh?.session?.loginUrl?.includes("invite=") === true;
  const freshRoleUrlHasAccount =
    replacementSessionRefresh?.session?.loginUrl?.includes("account=") === true;
  if (
    replacementSessionRefresh?.status !== "passed" ||
    unauthorized.status !== 401 ||
    routeErrorStatus !== 403 ||
    !routeErrorText.includes(
      `Game ${game} requires SlotOccupant, ChannelMember, or DeadViewer capability.`,
    ) ||
    routeErrorActionHref !== "/" ||
    playerSurfaceVisible !== false ||
    controlCounts.primaryButtons !== 0 ||
    controlCounts.actionButtons !== 0 ||
    staleCookie?.value !== sessionCookie.value ||
    replacementSessionRefresh?.session?.credentialKind !== "account" ||
    freshRoleUrlHasInvite !== false ||
    freshRoleUrlHasAccount !== true
  ) {
    throw new Error(
      `stale replacement session after refresh drifted: ${JSON.stringify({
        refreshStatus: replacementSessionRefresh?.status,
        apiSessionStatus: unauthorized.status,
        routeErrorStatus,
        routeErrorText,
        routeErrorActionHref,
        playerSurfaceVisible,
        controlCounts,
        staleCookiePresent: staleCookie !== undefined,
        staleCookieValuePrefix: staleCookie?.value?.slice(0, "invite-session-".length),
        freshCredentialKind: replacementSessionRefresh?.session?.credentialKind,
        freshRoleUrlHasInvite,
        freshRoleUrlHasAccount,
      })}`,
    );
  }
  return {
    status: "passed",
    apiSessionStatus: unauthorized.status,
    routeErrorStatus,
    routeErrorActionHref,
    playerSurfaceVisible,
    controlCounts,
    staleCookie: {
      httpOnly: staleCookie.httpOnly,
      sameSite: staleCookie.sameSite,
      secure: staleCookie.secure,
      valuePrefix: staleCookie.value.slice(0, "invite-session-".length),
    },
    freshCredentialKind: replacementSessionRefresh.session.credentialKind,
    freshRoleUrlHasInvite,
    freshRoleUrlHasAccount,
    proof:
      "A separate browser context kept the revoked replacement cookie while a fresh account-backed replacement session was created elsewhere; reloading the stale role path still rendered the shared 403 recovery boundary without controls, and the old cookie remained unauthorized.",
  };
}

async function verifyReplacementSessionRefreshRecovery({
  replacementEntry,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const page = replacementEntry?.page;
  const context = replacementEntry?.context;
  if (page === undefined || context === undefined) {
    throw new Error("replacement session refresh proof requires an open browser entry");
  }
  const session = await createAccountLoginCredential({
    principalUserId: "player-rowan",
    returnTo: `/g/${game}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  await page.goto(session.loginUrl, { waitUntil: "networkidle" });
  await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
  const prefilledToken = await page.getByTestId("auth-login-token").inputValue();
  const prefilledAccountId = await page.getByTestId("auth-login-account").inputValue();
  await page.getByTestId("auth-login-password").fill(session.password);
  await Promise.all([
    page.waitForURL(session.directUrl, { timeout: 15000 }),
    page.getByTestId("auth-login-submit").click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.getByTestId("player-surface").waitFor({
    state: "visible",
    timeout: 15000,
  });
  await page.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
  );
  const cookies = await context.cookies(frontendBaseUrl);
  const sessionCookie = cookies.find((cookie) => cookie.name === "fmarch_session");
  if (sessionCookie === undefined) {
    throw new Error("replacement session refresh login did not set fmarch_session");
  }
  const resolved = await fetchJson(`${apiBaseUrl}/auth/session?game=${game}`, {
    headers: { authorization: `Bearer ${sessionCookie.value}` },
  });
  const browserEntry = {
    principalUserId: resolved.principal_user_id,
    capabilityKinds: (resolved.capabilities ?? []).map((capability) => capability.kind),
    cookie: {
      httpOnly: sessionCookie.httpOnly,
      sameSite: sessionCookie.sameSite,
      secure: sessionCookie.secure,
      valuePrefix: sessionCookie.value.slice(
        0,
        "account-session-".length,
      ),
    },
  };
  const commandState = await page.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const capabilityLabel = await page
    .getByTestId("player-command-channel-context")
    .getAttribute("data-capability-label");
  const controlCounts = {
    primaryButtons: await page.locator("[data-action]").count(),
    actionButtons: await page.locator("[data-template-id]").count(),
  };
  const refreshPostBody = `Replacement Rowan refreshed-session post from dev:test-game ${crypto.randomUUID()}.`;
  await page.locator("textarea").fill(refreshPostBody);
  await page.locator('[data-action="submit_post"]').click();
  await page.waitForFunction(
    (expectedBody) =>
      window.__fmarchPlayerCommandStatus?.state === "ack" &&
      window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
        ?.SubmitPost?.body === expectedBody,
    refreshPostBody,
  );
  await page.waitForFunction(
    (expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) => post.body === expectedBody && post.authorSlot === "slot-7",
      ),
    refreshPostBody,
  );
  const postStatus = await page.evaluate(() => window.__fmarchPlayerCommandStatus);
  const rowanProjectedPost = await page.evaluate((expectedBody) =>
    window.__fmarchPlayerProjection?.thread?.posts?.find(
      (post) => post.body === expectedBody,
    ),
  refreshPostBody);
  const notifications = await page.evaluate(
    () => window.__fmarchPlayerProjection?.notifications ?? [],
  );
  const investigationResults = await page.evaluate(
    () => window.__fmarchPlayerProjection?.investigationResults ?? [],
  );
  const privateReceiptIsolation = {
    targetKillVisible: notifications.some(
      (item) =>
        item.effect === "player_killed" ||
        item.status === "factional_kill" ||
        item.audience_slot === "slot-2",
    ),
    actionResultVisible: investigationResults.some(
      (item) =>
        item.actor_slot === "slot_4" ||
        item.action_id === "browser_factional_kill_n01" ||
        item.status === "factional_kill",
    ),
    notificationCount: notifications.length,
    investigationResultCount: investigationResults.length,
  };
  if (
    session.credentialKind !== "account" ||
    session.principalUserId !== "player-rowan" ||
    prefilledToken !== "" ||
    prefilledAccountId !== session.accountId ||
    browserEntry.principalUserId !== "player-rowan" ||
    !browserEntry.capabilityKinds.includes("SlotOccupant") ||
    commandState?.actorSlot !== "slot-7" ||
    commandState?.actorAlive !== true ||
    !capabilityLabel?.includes("SlotOccupant") ||
    controlCounts.primaryButtons <= 0 ||
    postStatus?.state !== "ack" ||
    postStatus?.requestEnvelope?.body?.body?.principal_user_id !== "player-rowan" ||
    postStatus?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
      "slot-7" ||
    rowanProjectedPost?.authorSlot !== "slot-7" ||
    privateReceiptIsolation.targetKillVisible !== false ||
    privateReceiptIsolation.actionResultVisible !== false
  ) {
    throw new Error(
      `replacement session refresh recovery drifted: ${JSON.stringify({
        session: {
          ...session,
          password: "<redacted>",
        },
        prefilledToken,
        prefilledAccountId,
        browserEntry,
        commandState,
        capabilityLabel,
        controlCounts,
        postStatus,
        rowanProjectedPost,
        privateReceiptIsolation,
      })}`,
    );
  }
  return {
    status: "passed",
    session: {
      ...session,
      password: undefined,
    },
    login: {
      prefilledAccountId: true,
      submittedAccountPassword: true,
      usedInviteToken: false,
      usedSessionGrant: false,
      landedOnDirectUrl: page.url() === session.directUrl,
    },
    browserEntry,
    commandState,
    capabilityLabel,
    controlCounts,
    postStatus,
    rowanProjectedPost,
    privateReceiptIsolation,
    proof:
      "After the replacement session was revoked, player-rowan signed in through the seeded account on the normal login page without replaying the invite or minting a session grant; the role path restored Slot 7 controls, ACKed a new Slot 7 post, and still withheld target-only private receipts.",
  };
}

async function verifyReplacementReconnectRecovery({ replacementEntry, game }) {
  const page = replacementEntry?.page;
  if (page === undefined) {
    throw new Error("replacement reconnect proof requires an open browser entry");
  }
  const reconnect = await verifyRoleReconnectRecovery({
    page,
    game,
    principalUserId: "player-rowan",
    actorSlot: "slot-7",
    postPrefix: "Replacement Rowan reconnect proof",
  });
  if (
    reconnect.status !== "passed" ||
    reconnect.principalUserId !== "player-rowan" ||
    reconnect.actorSlot !== "slot-7" ||
    reconnect.reconnectingStatus?.state !== "reconnecting" ||
    reconnect.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnect.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnect.recoveredSnapshotContainsPost !== true ||
    reconnect.reconnectCommand?.principalUserId !== "player-rowan" ||
    reconnect.reconnectCommand?.command?.SubmitPost?.actor_slot !== "slot-7" ||
    reconnect.recoveredCommandState?.actorSlot !== "slot-7" ||
    reconnect.recoveredCommandState?.actorAlive !== true
  ) {
    throw new Error(
      `replacement reconnect recovery drifted: ${JSON.stringify(reconnect)}`,
    );
  }
  return {
    ...reconnect,
    proof:
      "After the replacement player logged in with a fresh session, the same role page dropped its live projection, a server-side Slot 7 post was appended as player-rowan, and the reconnect recovery snapshot restored current Slot 7 command state plus the new Rowan post.",
  };
}

async function freezeStaleOutgoingReplacementPage({ staleOutgoingPage, game }) {
  await gotoPlayerBoard(staleOutgoingPage, game);
  await staleOutgoingPage.locator('[data-action="submit_vote"]').waitFor({
    state: "visible",
  });
  await staleOutgoingPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
  );
  await staleOutgoingPage.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
  );
  const commandState = await staleOutgoingPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const closedStatus = await staleOutgoingPage.evaluate(
    () => window.__fmarchClosePlayerLiveProjection(),
  );
  return { commandState, closedStatus };
}

async function submitStaleOutgoingReplacementRecovery({
  staleOutgoingPage,
  staleOutgoingSetup,
  game,
}) {
  await staleOutgoingPage.locator('[data-action="submit_vote"]').click();
  await staleOutgoingPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "NotYourSlot",
  );
  await staleOutgoingPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorStatus === "replaced" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
      (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
  );
  const reject = await staleOutgoingPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const recoveredCommandState = await staleOutgoingPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const commandReceipts = await staleOutgoingPage.evaluate(
    () => window.__fmarchPlayerCommandReceipts ?? [],
  );
  const contextState = await staleOutgoingPage
    .getByTestId("player-command-channel-context")
    .evaluate((node) => ({
      actorAlive: node.getAttribute("data-actor-alive"),
      actorStatus: node.getAttribute("data-actor-status"),
      capabilityLabel: node.getAttribute("data-capability-label"),
    }));
  const buttonsDisabled = await staleOutgoingPage.evaluate(() =>
    [
      ...document.querySelectorAll(
        "[data-action='submit_vote'], [data-action='withdraw_vote'], [data-action='submit_post']",
      ),
    ].every((button) => button.disabled === true),
  );
  const { normalizeCommandResponse } = await importFrontendModule(
    "src/lib/app/command-boundary.mjs",
  );
  const staleActionCommandId = crypto.randomUUID();
  const staleActionRaw = await sendBrowserCommand(staleOutgoingPage, {
    principalUserId: "player-mira",
    commandId: staleActionCommandId,
    command: {
      SubmitAction: {
        game,
        action_id: "stale-replaced-factional-kill",
        actor_slot: "slot-7",
        template_id: "factional_kill",
        targets: ["slot-2"],
        grant_id: null,
      },
    },
  });
  const staleAction = normalizeCommandResponse({
    commandId: staleActionCommandId,
    requestEnvelope: staleActionRaw.requestEnvelope,
    response: { status: staleActionRaw.httpStatus },
    serverEnvelope: staleActionRaw.serverEnvelope,
  });
  const commandStateAfterStaleAction = await staleOutgoingPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const actionControlCountAfterStaleAction = await staleOutgoingPage
    .locator('[data-action^="submit_action:"]')
    .count();
  const buttonsDisabledAfterStaleAction = await staleOutgoingPage.evaluate(() =>
    [
      ...document.querySelectorAll(
        "[data-action='submit_vote'], [data-action='withdraw_vote'], [data-action='submit_post']",
      ),
    ].every((button) => button.disabled === true),
  );
  if (
    !reject.message.includes("slot ownership changed") ||
    recoveredCommandState?.actorSlot !== "slot-7" ||
    recoveredCommandState?.actorAlive !== false ||
    recoveredCommandState?.actorStatus !== "replaced" ||
    !recoveredCommandState?.boundary?.includes("no longer owns slot-7") ||
    contextState.actorAlive !== "false" ||
    contextState.actorStatus !== "replaced" ||
    !contextState.capabilityLabel?.includes("No current SlotOccupant(slot-7)") ||
    buttonsDisabled !== true ||
    !commandReceipts.some(
      (receipt) =>
        receipt.actionId === "submit_vote" &&
        receipt.current === true &&
        receipt.message?.includes("slot ownership changed"),
    ) ||
    staleAction?.state !== "reject" ||
    staleAction?.error !== "NotYourSlot" ||
    !staleAction?.message?.includes("slot ownership changed") ||
    staleAction?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot !==
      "slot-7" ||
    commandStateAfterStaleAction?.actorStatus !== "replaced" ||
    commandStateAfterStaleAction?.actions?.length !== 0 ||
    actionControlCountAfterStaleAction !== 0 ||
    buttonsDisabledAfterStaleAction !== true
  ) {
    throw new Error(
      `stale outgoing replacement recovery drifted: ${JSON.stringify({
        staleOutgoingSetup,
        reject,
        recoveredCommandState,
        contextState,
        buttonsDisabled,
        commandReceipts,
        staleAction,
        commandStateAfterStaleAction,
        actionControlCountAfterStaleAction,
        buttonsDisabledAfterStaleAction,
      })}`,
    );
  }
  return {
    status: "passed",
    setup: staleOutgoingSetup,
    reject,
    recoveredCommandState,
    contextState,
    buttonsDisabled,
    commandReceipts,
    staleAction,
    commandStateAfterStaleAction,
    actionControlCountAfterStaleAction,
    buttonsDisabledAfterStaleAction,
  };
}

async function submitStaleHostControlRecovery({
  staleHostPage,
  staleHostControlSetup,
  apiBaseUrl,
  game,
}) {
  const staleActionRoot = staleHostPage.getByTestId("critical-host-action-unlock_thread");
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId: "unlock_thread",
    roleLabel: "stale host",
  });
  await staleHostPage.waitForFunction(
    () =>
      window.__fmarchHostCommandStatuses?.unlock_thread?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.unlock_thread?.error === "PhaseLocked",
  );
  await staleHostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const reject = await staleHostPage.evaluate(
    () => window.__fmarchHostCommandStatuses?.unlock_thread,
  );
  const commandOutcomes = await staleHostPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleHostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const visibleActionsAfterReject = await visibleHostPhaseActions(staleHostPage);
  const activityStatusText = await staleHostPage
    .getByTestId("host-command-activity-status-unlock_thread")
    .innerText();
  const activityRow = await staleHostPage
    .getByTestId("host-command-activity-unlock_thread")
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    reject?.state !== "reject" ||
    reject?.error !== "PhaseLocked" ||
    !reject?.message?.includes("stale phase state") ||
    phaseAfterReject?.id !== "D02" ||
    phaseAfterReject?.locked !== false ||
    !visibleActionsAfterReject.includes("resolve_phase") ||
    !visibleActionsAfterReject.includes("lock_thread") ||
    visibleActionsAfterReject.includes("unlock_thread") ||
    !activityStatusText.includes("Reject PhaseLocked") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== "unlock_thread" ||
    activityRow.dispatchKind !== "unlock_thread" ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false
  ) {
    throw new Error(
      `stale host control recovery drifted: ${JSON.stringify({
        staleHostControlSetup,
        reject,
        commandOutcomes,
        phaseAfterReject,
        visibleActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        apiPhase: hostStateAfterReject.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId: "unlock_thread",
    setup: staleHostControlSetup,
    reject,
    commandOutcomes,
    phaseAfterReject,
    visibleActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
}

async function verifyConcurrentHostResolveRace({ hostPage, apiBaseUrl, frontendBaseUrl }) {
  const raceGame = crypto.randomUUID();
  const seed = await seedConcurrentHostResolveRaceGame({ raceGame });
  const context = hostPage.context();
  const liveRacePage = await context.newPage();
  const concurrentRacePage = await context.newPage();
  try {
    await liveRacePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await liveRacePage
      .getByTestId("critical-host-action-resolve_phase")
      .waitFor({ state: "visible" });
    await waitForHostProjectionPhase(liveRacePage, { phaseId: "D02", locked: false });
    const setup = await freezeStaleHostResolvePage({
      staleHostResolvePage: concurrentRacePage,
      game: raceGame,
      frontendBaseUrl,
    });
    const race = await submitConcurrentHostResolveRace({
      hostPage: liveRacePage,
      concurrentHostResolvePage: concurrentRacePage,
      concurrentHostResolveSetup: setup,
      apiBaseUrl,
      game: raceGame,
    });
    return {
      ...race,
      game: raceGame,
      seed,
      proof:
        "A disposable seeded local game advanced to D02, opened two host role pages, raced D02 resolve_phase with distinct command ids, proved one ACK plus one PhaseLocked stale-state recovery, and restored D02 unlocked without consuming the main proof game's D02.",
    };
  } finally {
    await liveRacePage.close().catch(() => {});
    await concurrentRacePage.close().catch(() => {});
  }
}

async function verifyConcurrentHostLifecycleRace({
  hostPage,
  playerPage,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const raceGame = crypto.randomUUID();
  const seed = await seedConcurrentHostLifecycleRaceGame({ raceGame });
  const hostContext = hostPage.context();
  const playerContext = playerPage.context();
  const deadRacePage = await hostContext.newPage();
  const modkillRacePage = await hostContext.newPage();
  const affectedPlayerPage = await playerContext.newPage();
  try {
    await deadRacePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await modkillRacePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await Promise.all([
      deadRacePage
        .getByTestId("critical-host-action-mark_dead")
        .waitFor({ state: "visible" }),
      modkillRacePage
        .getByTestId("critical-host-action-modkill_slot")
        .waitFor({ state: "visible" }),
    ]);
    await Promise.all([
      waitForHostProjectionPhase(deadRacePage, { phaseId: "D02", locked: false }),
      waitForHostProjectionPhase(modkillRacePage, { phaseId: "D02", locked: false }),
    ]);
    await gotoPlayerBoard(affectedPlayerPage, raceGame);
    await affectedPlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive",
    );
    const setup = {
      deadPagePhase: await deadRacePage.evaluate(() => window.__fmarchHostProjection?.phase),
      modkillPagePhase: await modkillRacePage.evaluate(
        () => window.__fmarchHostProjection?.phase,
      ),
      deadPageReplacement: await deadRacePage.evaluate(
        () => window.__fmarchHostProjection?.replacement,
      ),
      modkillPageReplacement: await modkillRacePage.evaluate(
        () => window.__fmarchHostProjection?.replacement,
      ),
      deadPageLifecycleActions: await visibleHostControlActions(
        deadRacePage,
        "slot-lifecycle",
      ),
      modkillPageLifecycleActions: await visibleHostControlActions(
        modkillRacePage,
        "slot-lifecycle",
      ),
      affectedPlayerCommandState: await affectedPlayerPage.evaluate(
        () => window.__fmarchPlayerProjection?.commandState,
      ),
    };
    const race = await submitConcurrentHostLifecycleRace({
      deadRacePage,
      modkillRacePage,
      affectedPlayerPage,
      setup,
      apiBaseUrl,
      game: raceGame,
      normalizeCommandResponse,
    });
    return {
      ...race,
      game: raceGame,
      seed,
      proof:
        "A disposable seeded local game advanced to open D02, opened two host role pages plus the Slot 7 player role URL, raced Mark dead against Modkill slot with distinct command ids, proved one ACK plus one InvalidTarget lifecycle recovery, and converged both host pages, the affected player page, and the API to one terminal slot status.",
    };
  } finally {
    await deadRacePage.close().catch(() => {});
    await modkillRacePage.close().catch(() => {});
    await affectedPlayerPage.close().catch(() => {});
  }
}

async function seedConcurrentHostLifecycleRaceGame({ raceGame }) {
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918_401 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918_402 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent host lifecycle seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function seedConcurrentHostResolveRaceGame({ raceGame }) {
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918273 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918274 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent host resolve seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function seedLaterPhaseCohostDeadlineGame({ game }) {
  const initialDeadline = 1_782_014_400;
  const seed = await seedConcurrentHostResolveRaceGame({ raceGame: game });
  const command = {
    ExtendDeadline: {
      game,
      phase: "D02",
      at: initialDeadline,
    },
  };
  const result = await sendCommandResult("host_h", command);
  if (result.body?.kind === "Reject") {
    throw new Error(
      `cohost later-phase deadline seed command rejected: ${JSON.stringify({
        principalUserId: "host_h",
        command,
        result,
      })}`,
    );
  }
  return {
    game,
    initialDeadline,
    commands: [...seed.commands, commandSummary("host_h", command, result)],
  };
}

async function verifyConcurrentHostAdvanceRace({ hostPage, apiBaseUrl, frontendBaseUrl }) {
  const raceGame = crypto.randomUUID();
  const seed = await seedConcurrentHostAdvanceRaceGame({ raceGame });
  const context = hostPage.context();
  const liveRacePage = await context.newPage();
  const concurrentRacePage = await context.newPage();
  try {
    await liveRacePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await liveRacePage
      .getByTestId("critical-host-action-advance_phase")
      .waitFor({ state: "visible" });
    await waitForHostProjectionPhase(liveRacePage, { phaseId: "D02", locked: true });
    const setup = await freezeStaleHostAdvancePage({
      staleHostAdvancePage: concurrentRacePage,
      game: raceGame,
      frontendBaseUrl,
    });
    const race = await submitConcurrentHostAdvanceRace({
      hostPage: liveRacePage,
      concurrentHostAdvancePage: concurrentRacePage,
      concurrentHostAdvanceSetup: setup,
      apiBaseUrl,
      game: raceGame,
    });
    return {
      ...race,
      game: raceGame,
      seed,
      proof:
        "A disposable seeded local game advanced to locked D02, opened two host role pages, raced D02 advance_phase with distinct command ids, proved one ACK plus one InvalidTarget stale-state recovery, and converged both host projections plus API phase state to open N02.",
    };
  } finally {
    await liveRacePage.close().catch(() => {});
    await concurrentRacePage.close().catch(() => {});
  }
}

async function verifyConcurrentHostDeadlineAdvanceRace({
  hostPage,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const raceGame = crypto.randomUUID();
  const seed = await seedConcurrentHostDeadlineAdvanceRaceGame({ raceGame });
  const context = hostPage.context();
  const liveRacePage = await context.newPage();
  const concurrentRacePage = await context.newPage();
  try {
    await liveRacePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await liveRacePage
      .getByTestId("critical-host-action-advance_phase_by_deadline")
      .waitFor({ state: "visible" });
    await waitForHostProjectionPhase(liveRacePage, { phaseId: "D01", locked: true });
    const setup = await freezeStaleDeadlineAdvancePage({
      staleHostPage: concurrentRacePage,
      game: raceGame,
      frontendBaseUrl,
    });
    const race = await submitConcurrentHostDeadlineAdvanceRace({
      hostPage: liveRacePage,
      concurrentHostDeadlinePage: concurrentRacePage,
      concurrentHostDeadlineSetup: setup,
      apiBaseUrl,
      game: raceGame,
    });
    return {
      ...race,
      game: raceGame,
      seed,
      proof:
        "A disposable seeded local game resolved D01 with deadline evidence available, opened two host role pages, raced D01 advance_phase_by_deadline with distinct command ids, proved one evidence+advance ACK plus one InvalidTarget stale-deadline recovery, and converged both host projections plus API phase state to open N01.",
    };
  } finally {
    await liveRacePage.close().catch(() => {});
    await concurrentRacePage.close().catch(() => {});
  }
}

async function verifyConcurrentHostMixedAdvanceRace({
  hostPage,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const raceGame = crypto.randomUUID();
  const seed = await seedConcurrentHostDeadlineAdvanceRaceGame({ raceGame });
  const context = hostPage.context();
  const normalAdvancePage = await context.newPage();
  const deadlineAdvancePage = await context.newPage();
  try {
    await normalAdvancePage.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await normalAdvancePage
      .getByTestId("critical-host-action-advance_phase")
      .waitFor({ state: "visible" });
    await normalAdvancePage
      .getByTestId("critical-host-action-advance_phase_by_deadline")
      .waitFor({ state: "visible" });
    await waitForHostProjectionPhase(normalAdvancePage, { phaseId: "D01", locked: true });
    const setup = await freezeStaleDeadlineAdvancePage({
      staleHostPage: deadlineAdvancePage,
      game: raceGame,
      frontendBaseUrl,
    });
    const race = await submitConcurrentHostMixedAdvanceRace({
      normalAdvancePage,
      deadlineAdvancePage,
      mixedAdvanceSetup: setup,
      apiBaseUrl,
      game: raceGame,
    });
    return {
      ...race,
      game: raceGame,
      seed,
      proof:
        "A disposable seeded local game resolved D01 with both normal and deadline advance controls visible, raced advance_phase against advance_phase_by_deadline from two host role pages with distinct command ids, proved one ACK plus one InvalidTarget recovery, and converged both host projections plus API phase state to open N01 with no carried deadline.",
    };
  } finally {
    await normalAdvancePage.close().catch(() => {});
    await deadlineAdvancePage.close().catch(() => {});
  }
}

async function seedConcurrentHostAdvanceRaceGame({ raceGame }) {
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918273 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918274 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918275 } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent host advance seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function seedConcurrentHostDeadlineAdvanceRaceGame({ raceGame }) {
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ExtendDeadline: { game: raceGame, phase: "D01", at: 918_300 } }],
    ["host_h", { ResolvePhase: { game: raceGame, seed: 918_301 } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent host deadline advance seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function submitConcurrentHostLifecycleRace({
  deadRacePage,
  modkillRacePage,
  affectedPlayerPage,
  setup,
  apiBaseUrl,
  game,
  normalizeCommandResponse,
}) {
  const deadActionId = "mark_dead";
  const modkillActionId = "modkill_slot";
  const deadBefore = await deadRacePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    deadActionId,
  );
  const modkillBefore = await modkillRacePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    modkillActionId,
  );

  const deadActionRoot = deadRacePage.getByTestId(`critical-host-action-${deadActionId}`);
  const modkillActionRoot = modkillRacePage.getByTestId(
    `critical-host-action-${modkillActionId}`,
  );
  await Promise.all([
    deadActionRoot.getByTestId("critical-host-action-trigger").click(),
    modkillActionRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    deadActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    modkillActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [deadConfirmationMessage, modkillConfirmationMessage] = await Promise.all([
    deadActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    modkillActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: deadActionRoot,
      actionId: deadActionId,
      roleLabel: "mark-dead",
    },
    {
      actionRoot: modkillActionRoot,
      actionId: modkillActionId,
      roleLabel: "modkill",
    },
  ]);
  await Promise.all([
    deadRacePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.SetSlotStatus !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: deadActionId, beforeCommandId: deadBefore?.commandId ?? null },
    ),
    modkillRacePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.SetSlotStatus !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: modkillActionId,
        beforeCommandId: modkillBefore?.commandId ?? null,
      },
    ),
  ]);

  const [deadOutcome, modkillOutcome] = await Promise.all([
    deadRacePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      deadActionId,
    ),
    modkillRacePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      modkillActionId,
    ),
  ]);
  const outcomes = [
    { raceRole: "dead", actionId: deadActionId, expectedStatus: "dead", outcome: deadOutcome },
    {
      raceRole: "modkill",
      actionId: modkillActionId,
      expectedStatus: "modkilled",
      outcome: modkillOutcome,
    },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.SetSlotStatus;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.SetSlotStatus;
  const winningStatus = ackCommand?.status ?? null;
  const winningLabel = winningStatus === "dead" ? "Dead" : "Modkilled";
  if (
    setup?.deadPagePhase?.id !== "D02" ||
    setup?.deadPagePhase?.locked !== false ||
    setup?.modkillPagePhase?.id !== "D02" ||
    setup?.modkillPagePhase?.locked !== false ||
    setup?.deadPageReplacement?.lifecycleLabel !== "Alive" ||
    setup?.modkillPageReplacement?.lifecycleLabel !== "Alive" ||
    setup?.deadPageLifecycleActions?.includes(deadActionId) !== true ||
    setup?.modkillPageLifecycleActions?.includes(modkillActionId) !== true ||
    setup?.affectedPlayerCommandState?.actorSlot !== "slot-7" ||
    setup?.affectedPlayerCommandState?.actorAlive !== true ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ack.streamSeqs.length !== 1 ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("slot lifecycle changed or is already current") ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.game !== game ||
    ackCommand?.slot !== "slot-7" ||
    ackCommand?.status !== ackEntry?.expectedStatus ||
    rejectCommand?.game !== game ||
    rejectCommand?.slot !== "slot-7" ||
    rejectCommand?.status !== rejectEntry?.expectedStatus ||
    !["dead", "modkilled"].includes(winningStatus)
  ) {
    throw new Error(
      `concurrent host lifecycle race outcomes drifted: ${JSON.stringify({
        setup,
        deadOutcome,
        modkillOutcome,
        winningStatus,
      })}`,
    );
  }

  await Promise.all([
    deadRacePage.waitForFunction(
      (expectedLabel) =>
        window.__fmarchHostProjection?.replacement?.lifecycleLabel === expectedLabel,
      winningLabel,
    ),
    modkillRacePage.waitForFunction(
      (expectedLabel) =>
        window.__fmarchHostProjection?.replacement?.lifecycleLabel === expectedLabel,
      winningLabel,
    ),
    affectedPlayerPage.waitForFunction(
      (expectedStatus) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === expectedStatus &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
      winningStatus,
    ),
  ]);
  const [
    deadReplacementAfterRace,
    modkillReplacementAfterRace,
    deadLifecycleActionsAfterRace,
    modkillLifecycleActionsAfterRace,
    deadActivityStatusText,
    modkillActivityStatusText,
    deadActivityRow,
    modkillActivityRow,
    affectedPlayerCommandStateAfterRace,
  ] = await Promise.all([
    deadRacePage.evaluate(() => window.__fmarchHostProjection?.replacement),
    modkillRacePage.evaluate(() => window.__fmarchHostProjection?.replacement),
    visibleHostControlActions(deadRacePage, "slot-lifecycle"),
    visibleHostControlActions(modkillRacePage, "slot-lifecycle"),
    deadRacePage.getByTestId(`host-command-activity-status-${deadActionId}`).innerText(),
    modkillRacePage
      .getByTestId(`host-command-activity-status-${modkillActionId}`)
      .innerText(),
    deadRacePage.getByTestId(`host-command-activity-${deadActionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    modkillRacePage
      .getByTestId(`host-command-activity-${modkillActionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
    affectedPlayerPage.evaluate(() => window.__fmarchPlayerProjection?.commandState),
  ]);
  const disabledControls = {
    vote: await playerCommandControlState(affectedPlayerPage, "submit_vote"),
    withdraw: await playerCommandControlState(affectedPlayerPage, "withdraw_vote"),
    post: await playerCommandControlState(affectedPlayerPage, "submit_post"),
  };
  const actionControlCount = await affectedPlayerPage
    .locator('[data-action^="submit_action"]')
    .count();
  const directPostCommandId = crypto.randomUUID();
  const directPostRaw = await sendBrowserCommand(affectedPlayerPage, {
    principalUserId: "player-mira",
    commandId: directPostCommandId,
    command: {
      SubmitPost: {
        game,
        channel_id: "main",
        actor_slot: "slot-7",
        body: "Concurrent lifecycle affected-player recovery proof.",
        media: null,
      },
    },
  });
  const directPost = normalizeCommandResponse({
    commandId: directPostCommandId,
    requestEnvelope: directPostRaw.requestEnvelope,
    response: { status: directPostRaw.httpStatus },
    serverEnvelope: directPostRaw.serverEnvelope,
  });
  const apiSlotAfterRace = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const activityTexts = [deadActivityStatusText, modkillActivityStatusText];
  if (
    deadReplacementAfterRace?.lifecycleLabel !== winningLabel ||
    modkillReplacementAfterRace?.lifecycleLabel !== winningLabel ||
    deadLifecycleActionsAfterRace.includes(deadActionId) ||
    deadLifecycleActionsAfterRace.includes(modkillActionId) ||
    modkillLifecycleActionsAfterRace.includes(deadActionId) ||
    modkillLifecycleActionsAfterRace.includes(modkillActionId) ||
    !activityTexts.some((text) => text.includes("Ack")) ||
    !activityTexts.some((text) => text.includes("Reject InvalidTarget")) ||
    deadActivityRow.actionId !== deadActionId ||
    modkillActivityRow.actionId !== modkillActionId ||
    affectedPlayerCommandStateAfterRace?.actorAlive !== false ||
    affectedPlayerCommandStateAfterRace?.actorStatus !== winningStatus ||
    !Object.values(disabledControls).every((control) => control.disabled === true) ||
    actionControlCount !== 0 ||
    directPost.state !== "reject" ||
    directPost.error !== "SlotNotAlive" ||
    !directPost.message.includes("slot is no longer alive") ||
    apiSlotAfterRace?.alive !== false ||
    apiSlotAfterRace?.status !== winningStatus
  ) {
    throw new Error(
      `concurrent host lifecycle convergence drifted: ${JSON.stringify({
        winningStatus,
        deadReplacementAfterRace,
        modkillReplacementAfterRace,
        deadLifecycleActionsAfterRace,
        modkillLifecycleActionsAfterRace,
        deadActivityStatusText,
        modkillActivityStatusText,
        deadActivityRow,
        modkillActivityRow,
        affectedPlayerCommandStateAfterRace,
        disabledControls,
        actionControlCount,
        directPost,
        apiSlotAfterRace,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostLifecycleRaceReload({
    deadRacePage,
    modkillRacePage,
    affectedPlayerPage,
    game,
    apiBaseUrl,
    winningLabel,
    winningStatus,
  });

  return {
    status: "passed",
    actionId: "mixed_slot_lifecycle",
    setup,
    deadConfirmationMessage,
    modkillConfirmationMessage,
    ackRaceRole: ackEntry.raceRole,
    rejectRaceRole: rejectEntry.raceRole,
    ackActionId: ackEntry.actionId,
    rejectActionId: rejectEntry.actionId,
    winningStatus,
    winningLabel,
    ack,
    reject,
    deadOutcome,
    modkillOutcome,
    deadReplacementAfterRace,
    modkillReplacementAfterRace,
    deadLifecycleActionsAfterRace,
    modkillLifecycleActionsAfterRace,
    deadActivityStatusText,
    modkillActivityStatusText,
    deadActivityRow,
    modkillActivityRow,
    affectedPlayerCommandStateAfterRace,
    disabledControls,
    actionControlCount,
    directPost,
    apiSlotAfterRace,
    roleReloadAfterRace,
    proof:
      "Two seeded host role pages submitted Mark dead and Modkill slot concurrently with distinct command ids; one ACKed, one rejected with InvalidTarget lifecycle recovery, both host projections plus the API converged to one terminal Slot 7 status, the affected player role URL disabled commands with SlotNotAlive recovery, and all role URLs reloaded to the same terminal slot truth.",
  };
}

async function verifyConcurrentHostLifecycleRaceReload({
  deadRacePage,
  modkillRacePage,
  affectedPlayerPage,
  game,
  apiBaseUrl,
  winningLabel,
  winningStatus,
}) {
  const [deadReload, modkillReload, playerReload] = await Promise.all([
    gotoHostConsole(deadRacePage, game),
    gotoHostConsole(modkillRacePage, game),
    gotoPlayerBoard(affectedPlayerPage, game),
  ]);
  await Promise.all([
    waitForHostProjectionPhase(deadRacePage, { phaseId: "D02", locked: false }),
    waitForHostProjectionPhase(modkillRacePage, {
      phaseId: "D02",
      locked: false,
    }),
    deadRacePage.waitForFunction(
      (expectedLabel) =>
        window.__fmarchHostProjection?.replacement?.lifecycleLabel === expectedLabel,
      winningLabel,
    ),
    modkillRacePage.waitForFunction(
      (expectedLabel) =>
        window.__fmarchHostProjection?.replacement?.lifecycleLabel === expectedLabel,
      winningLabel,
    ),
    affectedPlayerPage.waitForFunction(
      (expectedStatus) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === expectedStatus &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
      winningStatus,
    ),
  ]);
  const [
    deadPhaseAfterReload,
    modkillPhaseAfterReload,
    deadReplacementAfterReload,
    modkillReplacementAfterReload,
    deadLifecycleActionsAfterReload,
    modkillLifecycleActionsAfterReload,
    affectedPlayerCommandStateAfterReload,
    voteControlAfterReload,
    withdrawControlAfterReload,
    postControlAfterReload,
    actionControlCountAfterReload,
  ] = await Promise.all([
    deadRacePage.evaluate(() => window.__fmarchHostProjection?.phase),
    modkillRacePage.evaluate(() => window.__fmarchHostProjection?.phase),
    deadRacePage.evaluate(() => window.__fmarchHostProjection?.replacement),
    modkillRacePage.evaluate(() => window.__fmarchHostProjection?.replacement),
    visibleHostControlActions(deadRacePage, "slot-lifecycle"),
    visibleHostControlActions(modkillRacePage, "slot-lifecycle"),
    affectedPlayerPage.evaluate(() => window.__fmarchPlayerProjection?.commandState),
    playerCommandControlState(affectedPlayerPage, "submit_vote"),
    playerCommandControlState(affectedPlayerPage, "withdraw_vote"),
    playerCommandControlState(affectedPlayerPage, "submit_post"),
    affectedPlayerPage.locator('[data-action^="submit_action"]').count(),
  ]);
  const apiSlotAfterReload = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: "slot-7",
  });
  const disabledControlsAfterReload = {
    vote: voteControlAfterReload,
    withdraw: withdrawControlAfterReload,
    post: postControlAfterReload,
  };
  if (
    deadReload.status !== 200 ||
    modkillReload.status !== 200 ||
    playerReload.status !== 200 ||
    deadPhaseAfterReload?.id !== "D02" ||
    deadPhaseAfterReload?.locked !== false ||
    modkillPhaseAfterReload?.id !== "D02" ||
    modkillPhaseAfterReload?.locked !== false ||
    deadReplacementAfterReload?.lifecycleLabel !== winningLabel ||
    modkillReplacementAfterReload?.lifecycleLabel !== winningLabel ||
    deadLifecycleActionsAfterReload.includes("mark_dead") ||
    deadLifecycleActionsAfterReload.includes("modkill_slot") ||
    modkillLifecycleActionsAfterReload.includes("mark_dead") ||
    modkillLifecycleActionsAfterReload.includes("modkill_slot") ||
    affectedPlayerCommandStateAfterReload?.actorAlive !== false ||
    affectedPlayerCommandStateAfterReload?.actorStatus !== winningStatus ||
    (affectedPlayerCommandStateAfterReload?.actions ?? []).length !== 0 ||
    !Object.values(disabledControlsAfterReload).every(
      (control) => control.disabled === true,
    ) ||
    actionControlCountAfterReload !== 0 ||
    apiSlotAfterReload?.alive !== false ||
    apiSlotAfterReload?.status !== winningStatus
  ) {
    throw new Error(
      `concurrent host lifecycle reload drifted: ${JSON.stringify({
        winningStatus,
        deadReload,
        modkillReload,
        playerReload,
        deadPhaseAfterReload,
        modkillPhaseAfterReload,
        deadReplacementAfterReload,
        modkillReplacementAfterReload,
        deadLifecycleActionsAfterReload,
        modkillLifecycleActionsAfterReload,
        affectedPlayerCommandStateAfterReload,
        disabledControlsAfterReload,
        actionControlCountAfterReload,
        apiSlotAfterReload,
      })}`,
    );
  }
  return {
    status: "passed",
    deadRouteStatus: deadReload.status,
    modkillRouteStatus: modkillReload.status,
    playerRouteStatus: playerReload.status,
    deadPhaseAfterReload,
    modkillPhaseAfterReload,
    deadReplacementAfterReload,
    modkillReplacementAfterReload,
    deadLifecycleActionsAfterReload,
    modkillLifecycleActionsAfterReload,
    affectedPlayerCommandStateAfterReload,
    disabledControlsAfterReload,
    actionControlCountAfterReload,
    apiSlotAfterReload,
  };
}

async function submitConcurrentHostResolveRace({
  hostPage,
  concurrentHostResolvePage,
  concurrentHostResolveSetup,
  apiBaseUrl,
  game,
}) {
  const actionId = "resolve_phase";
  const liveBefore = await hostPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );
  const concurrentBefore = await concurrentHostResolvePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );

  const liveActionRoot = hostPage.getByTestId(`critical-host-action-${actionId}`);
  const concurrentActionRoot = concurrentHostResolvePage.getByTestId(
    `critical-host-action-${actionId}`,
  );
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-trigger").click(),
    concurrentActionRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [liveConfirmationMessage, concurrentConfirmationMessage] = await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: liveActionRoot,
      actionId,
      roleLabel: "live resolve",
    },
    {
      actionRoot: concurrentActionRoot,
      actionId,
      roleLabel: "concurrent resolve",
    },
  ]);
  await Promise.all([
    hostPage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.ResolvePhase !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: actionId, beforeCommandId: liveBefore?.commandId ?? null },
    ),
    concurrentHostResolvePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.ResolvePhase !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: actionId,
        beforeCommandId: concurrentBefore?.commandId ?? null,
      },
    ),
  ]);

  const [liveOutcome, concurrentOutcome] = await Promise.all([
    hostPage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
    concurrentHostResolvePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
  ]);
  const outcomes = [
    { pageRole: "live", outcome: liveOutcome },
    { pageRole: "concurrent", outcome: concurrentOutcome },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.ResolvePhase;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.ResolvePhase;
  if (
    concurrentHostResolveSetup?.stalePhase?.id !== "D02" ||
    concurrentHostResolveSetup?.stalePhase?.locked !== false ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ack.streamSeqs.length === 0 ||
    reject?.error !== "PhaseLocked" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("stale phase state") ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.game !== game ||
    rejectCommand?.game !== game
  ) {
    throw new Error(
      `concurrent host resolve race outcomes drifted: ${JSON.stringify({
        concurrentHostResolveSetup,
        liveOutcome,
        concurrentOutcome,
      })}`,
    );
  }

  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: true }),
    concurrentHostResolvePage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "D02" &&
        window.__fmarchHostProjection?.phase?.locked === true,
    ),
  ]);
  const [
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostResolvePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostResolvePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostResolvePage, "deadline"),
    hostPage.getByTestId(`host-command-activity-status-${actionId}`).innerText(),
    concurrentHostResolvePage
      .getByTestId(`host-command-activity-status-${actionId}`)
      .innerText(),
    hostPage.getByTestId(`host-command-activity-${actionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    concurrentHostResolvePage
      .getByTestId(`host-command-activity-${actionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
  ]);
  const hostStateAfterRace = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    livePhaseAfterRace?.id !== "D02" ||
    livePhaseAfterRace?.locked !== true ||
    concurrentPhaseAfterRace?.id !== "D02" ||
    concurrentPhaseAfterRace?.locked !== true ||
    !livePhaseActionsAfterRace.includes("unlock_thread") ||
    !livePhaseActionsAfterRace.includes("advance_phase") ||
    livePhaseActionsAfterRace.includes("resolve_phase") ||
    livePhaseActionsAfterRace.includes("lock_thread") ||
    !concurrentPhaseActionsAfterRace.includes("unlock_thread") ||
    !concurrentPhaseActionsAfterRace.includes("advance_phase") ||
    concurrentPhaseActionsAfterRace.includes("resolve_phase") ||
    concurrentPhaseActionsAfterRace.includes("lock_thread") ||
    !liveDeadlineActionsAfterRace.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterRace.includes("extend_deadline") ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Ack"),
    ) ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Reject PhaseLocked"),
    ) ||
    liveActivityRow.actionId !== actionId ||
    concurrentActivityRow.actionId !== actionId ||
    hostStateAfterRace.phase?.phase_id !== "D02" ||
    hostStateAfterRace.phase?.locked !== true
  ) {
    throw new Error(
      `concurrent host resolve convergence drifted: ${JSON.stringify({
        livePhaseAfterRace,
        concurrentPhaseAfterRace,
        livePhaseActionsAfterRace,
        concurrentPhaseActionsAfterRace,
        liveDeadlineActionsAfterRace,
        concurrentDeadlineActionsAfterRace,
        liveActivityStatusText,
        concurrentActivityStatusText,
        liveActivityRow,
        concurrentActivityRow,
        apiPhase: hostStateAfterRace.phase,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostResolveRaceReload({
    hostPage,
    concurrentHostResolvePage,
    game,
    apiBaseUrl,
  });

  const restoreAfterRace = await confirmHostAction(hostPage, "unlock_thread");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  const hostStateAfterRestore = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    restoreAfterRace.commandStatus?.state !== "ack" ||
    restoreAfterRace.commandStatus?.requestEnvelope?.body?.body?.command?.UnlockThread
      ?.game !== game ||
    hostStateAfterRestore.phase?.phase_id !== "D02" ||
    hostStateAfterRestore.phase?.locked !== false
  ) {
    throw new Error(
      `concurrent host resolve restore drifted: ${JSON.stringify({
        restoreAfterRace,
        apiPhase: hostStateAfterRestore.phase,
      })}`,
    );
  }

  return {
    status: "passed",
    actionId,
    setup: concurrentHostResolveSetup,
    liveConfirmationMessage,
    concurrentConfirmationMessage,
    ackPageRole: ackEntry.pageRole,
    rejectPageRole: rejectEntry.pageRole,
    ack,
    reject,
    liveOutcome,
    concurrentOutcome,
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
    apiPhaseAfterRace: hostStateAfterRace.phase,
    roleReloadAfterRace,
    restoreAfterRace,
    apiPhaseAfterRestore: hostStateAfterRestore.phase,
    proof:
      "Two seeded host role pages submitted D02 resolve_phase concurrently with distinct command ids; one ACKed, one rejected with PhaseLocked stale-state recovery, both browser projections and the API converged to locked D02, both host role URLs reloaded to the same locked controls, then the live host restored D02 unlocked for the remaining hardening lanes.",
  };
}

async function verifyConcurrentHostResolveRaceReload({
  hostPage,
  concurrentHostResolvePage,
  game,
  apiBaseUrl,
}) {
  const [liveReload, concurrentReload] = await Promise.all([
    gotoHostConsole(hostPage, game),
    gotoHostConsole(concurrentHostResolvePage, game),
  ]);
  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: true }),
    waitForHostProjectionPhase(concurrentHostResolvePage, {
      phaseId: "D02",
      locked: true,
    }),
  ]);
  const [
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostResolvePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostResolvePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostResolvePage, "deadline"),
  ]);
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const requiredLockedPhaseActions = (actions) =>
    actions.includes("unlock_thread") &&
    actions.includes("advance_phase") &&
    !actions.includes("resolve_phase") &&
    !actions.includes("lock_thread");
  if (
    liveReload.status !== 200 ||
    concurrentReload.status !== 200 ||
    livePhaseAfterReload?.id !== "D02" ||
    livePhaseAfterReload?.locked !== true ||
    concurrentPhaseAfterReload?.id !== "D02" ||
    concurrentPhaseAfterReload?.locked !== true ||
    requiredLockedPhaseActions(livePhaseActionsAfterReload) !== true ||
    requiredLockedPhaseActions(concurrentPhaseActionsAfterReload) !== true ||
    !liveDeadlineActionsAfterReload.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterReload.includes("extend_deadline") ||
    hostStateAfterReload.phase?.phase_id !== "D02" ||
    hostStateAfterReload.phase?.locked !== true
  ) {
    throw new Error(
      `concurrent host resolve reload drifted: ${JSON.stringify({
        liveReload,
        concurrentReload,
        livePhaseAfterReload,
        concurrentPhaseAfterReload,
        livePhaseActionsAfterReload,
        concurrentPhaseActionsAfterReload,
        liveDeadlineActionsAfterReload,
        concurrentDeadlineActionsAfterReload,
        apiPhase: hostStateAfterReload.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    liveRouteStatus: liveReload.status,
    concurrentRouteStatus: concurrentReload.status,
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
}

async function submitConcurrentHostAdvanceRace({
  hostPage,
  concurrentHostAdvancePage,
  concurrentHostAdvanceSetup,
  apiBaseUrl,
  game,
}) {
  const actionId = "advance_phase";
  const liveBefore = await hostPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );
  const concurrentBefore = await concurrentHostAdvancePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );

  const liveActionRoot = hostPage.getByTestId(`critical-host-action-${actionId}`);
  const concurrentActionRoot = concurrentHostAdvancePage.getByTestId(
    `critical-host-action-${actionId}`,
  );
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-trigger").click(),
    concurrentActionRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [liveConfirmationMessage, concurrentConfirmationMessage] = await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: liveActionRoot,
      actionId,
      roleLabel: "live advance",
    },
    {
      actionRoot: concurrentActionRoot,
      actionId,
      roleLabel: "concurrent advance",
    },
  ]);
  await Promise.all([
    hostPage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhase !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: actionId, beforeCommandId: liveBefore?.commandId ?? null },
    ),
    concurrentHostAdvancePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhase !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: actionId,
        beforeCommandId: concurrentBefore?.commandId ?? null,
      },
    ),
  ]);

  const [liveOutcome, concurrentOutcome] = await Promise.all([
    hostPage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
    concurrentHostAdvancePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
  ]);
  const outcomes = [
    { pageRole: "live", outcome: liveOutcome },
    { pageRole: "concurrent", outcome: concurrentOutcome },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.AdvancePhase;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.AdvancePhase;
  if (
    concurrentHostAdvanceSetup?.stalePhase?.id !== "D02" ||
    concurrentHostAdvanceSetup?.stalePhase?.locked !== true ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ack.streamSeqs.length === 0 ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("stale phase state") ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.game !== game ||
    rejectCommand?.game !== game
  ) {
    throw new Error(
      `concurrent host advance race outcomes drifted: ${JSON.stringify({
        concurrentHostAdvanceSetup,
        liveOutcome,
        concurrentOutcome,
      })}`,
    );
  }

  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "N02", locked: false }),
    concurrentHostAdvancePage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "N02" &&
        window.__fmarchHostProjection?.phase?.locked === false,
    ),
  ]);
  const [
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostAdvancePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostAdvancePage, "deadline"),
    hostPage.getByTestId(`host-command-activity-status-${actionId}`).innerText(),
    concurrentHostAdvancePage
      .getByTestId(`host-command-activity-status-${actionId}`)
      .innerText(),
    hostPage.getByTestId(`host-command-activity-${actionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    concurrentHostAdvancePage
      .getByTestId(`host-command-activity-${actionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
  ]);
  const hostStateAfterRace = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    livePhaseAfterRace?.id !== "N02" ||
    livePhaseAfterRace?.locked !== false ||
    concurrentPhaseAfterRace?.id !== "N02" ||
    concurrentPhaseAfterRace?.locked !== false ||
    !livePhaseActionsAfterRace.includes("resolve_phase") ||
    !livePhaseActionsAfterRace.includes("lock_thread") ||
    livePhaseActionsAfterRace.includes("advance_phase") ||
    livePhaseActionsAfterRace.includes("unlock_thread") ||
    !concurrentPhaseActionsAfterRace.includes("resolve_phase") ||
    !concurrentPhaseActionsAfterRace.includes("lock_thread") ||
    concurrentPhaseActionsAfterRace.includes("advance_phase") ||
    concurrentPhaseActionsAfterRace.includes("unlock_thread") ||
    !liveDeadlineActionsAfterRace.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterRace.includes("extend_deadline") ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Ack"),
    ) ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Reject InvalidTarget"),
    ) ||
    liveActivityRow.actionId !== actionId ||
    concurrentActivityRow.actionId !== actionId ||
    hostStateAfterRace.phase?.phase_id !== "N02" ||
    hostStateAfterRace.phase?.locked !== false
  ) {
    throw new Error(
      `concurrent host advance convergence drifted: ${JSON.stringify({
        livePhaseAfterRace,
        concurrentPhaseAfterRace,
        livePhaseActionsAfterRace,
        concurrentPhaseActionsAfterRace,
        liveDeadlineActionsAfterRace,
        concurrentDeadlineActionsAfterRace,
        liveActivityStatusText,
        concurrentActivityStatusText,
        liveActivityRow,
        concurrentActivityRow,
        apiPhase: hostStateAfterRace.phase,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostAdvanceRaceReload({
    hostPage,
    concurrentHostAdvancePage,
    game,
    apiBaseUrl,
  });

  return {
    status: "passed",
    actionId,
    setup: concurrentHostAdvanceSetup,
    liveConfirmationMessage,
    concurrentConfirmationMessage,
    ackPageRole: ackEntry.pageRole,
    rejectPageRole: rejectEntry.pageRole,
    ack,
    reject,
    liveOutcome,
    concurrentOutcome,
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
    apiPhaseAfterRace: hostStateAfterRace.phase,
    roleReloadAfterRace,
    proof:
      "Two seeded host role pages submitted D02 advance_phase concurrently with distinct command ids; one ACKed, one rejected with InvalidTarget stale-state recovery, both browser projections plus the API converged to open N02, and both host role URLs reloaded to the same open N02 controls.",
  };
}

async function verifyConcurrentHostAdvanceRaceReload({
  hostPage,
  concurrentHostAdvancePage,
  game,
  apiBaseUrl,
}) {
  const [liveReload, concurrentReload] = await Promise.all([
    gotoHostConsole(hostPage, game),
    gotoHostConsole(concurrentHostAdvancePage, game),
  ]);
  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "N02", locked: false }),
    waitForHostProjectionPhase(concurrentHostAdvancePage, {
      phaseId: "N02",
      locked: false,
    }),
  ]);
  const [
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostAdvancePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostAdvancePage, "deadline"),
  ]);
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const requiredOpenPhaseActions = (actions) =>
    actions.includes("resolve_phase") &&
    actions.includes("lock_thread") &&
    !actions.includes("advance_phase") &&
    !actions.includes("unlock_thread");
  if (
    liveReload.status !== 200 ||
    concurrentReload.status !== 200 ||
    livePhaseAfterReload?.id !== "N02" ||
    livePhaseAfterReload?.locked !== false ||
    concurrentPhaseAfterReload?.id !== "N02" ||
    concurrentPhaseAfterReload?.locked !== false ||
    requiredOpenPhaseActions(livePhaseActionsAfterReload) !== true ||
    requiredOpenPhaseActions(concurrentPhaseActionsAfterReload) !== true ||
    !liveDeadlineActionsAfterReload.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterReload.includes("extend_deadline") ||
    hostStateAfterReload.phase?.phase_id !== "N02" ||
    hostStateAfterReload.phase?.locked !== false
  ) {
    throw new Error(
      `concurrent host advance reload drifted: ${JSON.stringify({
        liveReload,
        concurrentReload,
        livePhaseAfterReload,
        concurrentPhaseAfterReload,
        livePhaseActionsAfterReload,
        concurrentPhaseActionsAfterReload,
        liveDeadlineActionsAfterReload,
        concurrentDeadlineActionsAfterReload,
        apiPhase: hostStateAfterReload.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    liveRouteStatus: liveReload.status,
    concurrentRouteStatus: concurrentReload.status,
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
}

async function submitConcurrentHostDeadlineAdvanceRace({
  hostPage,
  concurrentHostDeadlinePage,
  concurrentHostDeadlineSetup,
  apiBaseUrl,
  game,
}) {
  const actionId = "advance_phase_by_deadline";
  const expectedDeadline = concurrentHostDeadlineSetup?.stalePhase?.deadline ?? null;
  const liveBefore = await hostPage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );
  const concurrentBefore = await concurrentHostDeadlinePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    actionId,
  );

  const liveActionRoot = hostPage.getByTestId(`critical-host-action-${actionId}`);
  const concurrentActionRoot = concurrentHostDeadlinePage.getByTestId(
    `critical-host-action-${actionId}`,
  );
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-trigger").click(),
    concurrentActionRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [liveConfirmationMessage, concurrentConfirmationMessage] = await Promise.all([
    liveActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    concurrentActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: liveActionRoot,
      actionId,
      roleLabel: "live deadline advance",
    },
    {
      actionRoot: concurrentActionRoot,
      actionId,
      roleLabel: "concurrent deadline advance",
    },
  ]);
  await Promise.all([
    hostPage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      { expectedActionId: actionId, beforeCommandId: liveBefore?.commandId ?? null },
    ),
    concurrentHostDeadlinePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: actionId,
        beforeCommandId: concurrentBefore?.commandId ?? null,
      },
    ),
  ]);

  const [liveOutcome, concurrentOutcome] = await Promise.all([
    hostPage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
    concurrentHostDeadlinePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      actionId,
    ),
  ]);
  const outcomes = [
    { pageRole: "live", outcome: liveOutcome },
    { pageRole: "concurrent", outcome: concurrentOutcome },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const ackCommand = ack?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline;
  const rejectCommand = reject?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline;
  if (
    concurrentHostDeadlineSetup?.stalePhase?.id !== "D01" ||
    concurrentHostDeadlineSetup?.stalePhase?.locked !== true ||
    typeof expectedDeadline !== "number" ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ack.streamSeqs.length !== 2 ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("deadline target is stale") ||
    ack?.commandId === reject?.commandId ||
    ackCommand?.game !== game ||
    ackCommand?.phase !== "D01" ||
    ackCommand?.observed_at !== expectedDeadline + 1 ||
    rejectCommand?.game !== game ||
    rejectCommand?.phase !== "D01" ||
    rejectCommand?.observed_at !== expectedDeadline + 1
  ) {
    throw new Error(
      `concurrent host deadline advance race outcomes drifted: ${JSON.stringify({
        concurrentHostDeadlineSetup,
        liveOutcome,
        concurrentOutcome,
        expectedDeadline,
      })}`,
    );
  }

  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false }),
    concurrentHostDeadlinePage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "N01" &&
        window.__fmarchHostProjection?.phase?.locked === false,
    ),
  ]);
  const [
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostDeadlinePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostDeadlinePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostDeadlinePage, "deadline"),
    hostPage.getByTestId(`host-command-activity-status-${actionId}`).innerText(),
    concurrentHostDeadlinePage
      .getByTestId(`host-command-activity-status-${actionId}`)
      .innerText(),
    hostPage.getByTestId(`host-command-activity-${actionId}`).evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    })),
    concurrentHostDeadlinePage
      .getByTestId(`host-command-activity-${actionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
  ]);
  const hostStateAfterRace = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    livePhaseAfterRace?.id !== "N01" ||
    livePhaseAfterRace?.locked !== false ||
    livePhaseAfterRace?.deadline !== null ||
    concurrentPhaseAfterRace?.id !== "N01" ||
    concurrentPhaseAfterRace?.locked !== false ||
    concurrentPhaseAfterRace?.deadline !== null ||
    !livePhaseActionsAfterRace.includes("resolve_phase") ||
    !livePhaseActionsAfterRace.includes("lock_thread") ||
    livePhaseActionsAfterRace.includes("advance_phase") ||
    livePhaseActionsAfterRace.includes("unlock_thread") ||
    livePhaseActionsAfterRace.includes("advance_phase_by_deadline") ||
    !concurrentPhaseActionsAfterRace.includes("resolve_phase") ||
    !concurrentPhaseActionsAfterRace.includes("lock_thread") ||
    concurrentPhaseActionsAfterRace.includes("advance_phase") ||
    concurrentPhaseActionsAfterRace.includes("unlock_thread") ||
    concurrentPhaseActionsAfterRace.includes("advance_phase_by_deadline") ||
    !liveDeadlineActionsAfterRace.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterRace.includes("extend_deadline") ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Ack"),
    ) ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("Reject InvalidTarget"),
    ) ||
    ![liveActivityStatusText, concurrentActivityStatusText].some((text) =>
      text.includes("deadline target is stale"),
    ) ||
    liveActivityRow.actionId !== actionId ||
    concurrentActivityRow.actionId !== actionId ||
    hostStateAfterRace.phase?.phase_id !== "N01" ||
    hostStateAfterRace.phase?.locked !== false ||
    hostStateAfterRace.phase?.deadline !== null
  ) {
    throw new Error(
      `concurrent host deadline advance convergence drifted: ${JSON.stringify({
        livePhaseAfterRace,
        concurrentPhaseAfterRace,
        livePhaseActionsAfterRace,
        concurrentPhaseActionsAfterRace,
        liveDeadlineActionsAfterRace,
        concurrentDeadlineActionsAfterRace,
        liveActivityStatusText,
        concurrentActivityStatusText,
        liveActivityRow,
        concurrentActivityRow,
        apiPhase: hostStateAfterRace.phase,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostDeadlineAdvanceRaceReload({
    hostPage,
    concurrentHostDeadlinePage,
    game,
    apiBaseUrl,
  });

  return {
    status: "passed",
    actionId,
    setup: concurrentHostDeadlineSetup,
    liveConfirmationMessage,
    concurrentConfirmationMessage,
    ackPageRole: ackEntry.pageRole,
    rejectPageRole: rejectEntry.pageRole,
    ack,
    reject,
    liveOutcome,
    concurrentOutcome,
    livePhaseAfterRace,
    concurrentPhaseAfterRace,
    livePhaseActionsAfterRace,
    concurrentPhaseActionsAfterRace,
    liveDeadlineActionsAfterRace,
    concurrentDeadlineActionsAfterRace,
    liveActivityStatusText,
    concurrentActivityStatusText,
    liveActivityRow,
    concurrentActivityRow,
    apiPhaseAfterRace: hostStateAfterRace.phase,
    roleReloadAfterRace,
    proof:
      "Two seeded host role pages submitted D01 advance_phase_by_deadline concurrently with distinct command ids; one ACKed with deadline evidence plus phase advance, one rejected with InvalidTarget stale-deadline recovery, both browser projections plus the API converged to open N01 with no carried deadline, and both host role URLs reloaded to the same open N01 controls.",
  };
}

async function verifyConcurrentHostDeadlineAdvanceRaceReload({
  hostPage,
  concurrentHostDeadlinePage,
  game,
  apiBaseUrl,
}) {
  const [liveReload, concurrentReload] = await Promise.all([
    gotoHostConsole(hostPage, game),
    gotoHostConsole(concurrentHostDeadlinePage, game),
  ]);
  await Promise.all([
    waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false }),
    waitForHostProjectionPhase(concurrentHostDeadlinePage, {
      phaseId: "N01",
      locked: false,
    }),
  ]);
  const [
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
  ] = await Promise.all([
    hostPage.evaluate(() => window.__fmarchHostProjection?.phase),
    concurrentHostDeadlinePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(hostPage, "phase"),
    visibleHostControlActions(concurrentHostDeadlinePage, "phase"),
    visibleHostControlActions(hostPage, "deadline"),
    visibleHostControlActions(concurrentHostDeadlinePage, "deadline"),
  ]);
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const requiredOpenPhaseActions = (actions) =>
    actions.includes("resolve_phase") &&
    actions.includes("lock_thread") &&
    !actions.includes("advance_phase") &&
    !actions.includes("unlock_thread") &&
    !actions.includes("advance_phase_by_deadline");
  if (
    liveReload.status !== 200 ||
    concurrentReload.status !== 200 ||
    livePhaseAfterReload?.id !== "N01" ||
    livePhaseAfterReload?.locked !== false ||
    livePhaseAfterReload?.deadline !== null ||
    concurrentPhaseAfterReload?.id !== "N01" ||
    concurrentPhaseAfterReload?.locked !== false ||
    concurrentPhaseAfterReload?.deadline !== null ||
    requiredOpenPhaseActions(livePhaseActionsAfterReload) !== true ||
    requiredOpenPhaseActions(concurrentPhaseActionsAfterReload) !== true ||
    !liveDeadlineActionsAfterReload.includes("extend_deadline") ||
    !concurrentDeadlineActionsAfterReload.includes("extend_deadline") ||
    hostStateAfterReload.phase?.phase_id !== "N01" ||
    hostStateAfterReload.phase?.locked !== false ||
    hostStateAfterReload.phase?.deadline !== null
  ) {
    throw new Error(
      `concurrent host deadline advance reload drifted: ${JSON.stringify({
        liveReload,
        concurrentReload,
        livePhaseAfterReload,
        concurrentPhaseAfterReload,
        livePhaseActionsAfterReload,
        concurrentPhaseActionsAfterReload,
        liveDeadlineActionsAfterReload,
        concurrentDeadlineActionsAfterReload,
        apiPhase: hostStateAfterReload.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    liveRouteStatus: liveReload.status,
    concurrentRouteStatus: concurrentReload.status,
    livePhaseAfterReload,
    concurrentPhaseAfterReload,
    livePhaseActionsAfterReload,
    concurrentPhaseActionsAfterReload,
    liveDeadlineActionsAfterReload,
    concurrentDeadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
}

async function submitConcurrentHostMixedAdvanceRace({
  normalAdvancePage,
  deadlineAdvancePage,
  mixedAdvanceSetup,
  apiBaseUrl,
  game,
}) {
  const normalActionId = "advance_phase";
  const deadlineActionId = "advance_phase_by_deadline";
  const expectedDeadline = mixedAdvanceSetup?.stalePhase?.deadline ?? null;
  const normalBefore = await normalAdvancePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    normalActionId,
  );
  const deadlineBefore = await deadlineAdvancePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId] ?? null,
    deadlineActionId,
  );

  const normalActionRoot = normalAdvancePage.getByTestId(
    `critical-host-action-${normalActionId}`,
  );
  const deadlineActionRoot = deadlineAdvancePage.getByTestId(
    `critical-host-action-${deadlineActionId}`,
  );
  await Promise.all([
    normalActionRoot.getByTestId("critical-host-action-trigger").click(),
    deadlineActionRoot.getByTestId("critical-host-action-trigger").click(),
  ]);
  await Promise.all([
    normalActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
    deadlineActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
      state: "visible",
    }),
  ]);
  const [normalConfirmationMessage, deadlineConfirmationMessage] = await Promise.all([
    normalActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
    deadlineActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
  ]);
  await clickConcurrentCriticalHostActionConfirms([
    {
      actionRoot: normalActionRoot,
      actionId: normalActionId,
      roleLabel: "normal mixed advance",
    },
    {
      actionRoot: deadlineActionRoot,
      actionId: deadlineActionId,
      roleLabel: "deadline mixed advance",
    },
  ]);
  await Promise.all([
    normalAdvancePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhase !== undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: normalActionId,
        beforeCommandId: normalBefore?.commandId ?? null,
      },
    ),
    deadlineAdvancePage.waitForFunction(
      ({ expectedActionId, beforeCommandId }) => {
        const status = window.__fmarchHostCommandStatuses?.[expectedActionId];
        return (
          status?.commandId !== beforeCommandId &&
          status?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline !==
            undefined &&
          (status?.state === "ack" || status?.state === "reject")
        );
      },
      {
        expectedActionId: deadlineActionId,
        beforeCommandId: deadlineBefore?.commandId ?? null,
      },
    ),
  ]);

  const [normalOutcome, deadlineOutcome] = await Promise.all([
    normalAdvancePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      normalActionId,
    ),
    deadlineAdvancePage.evaluate(
      (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
      deadlineActionId,
    ),
  ]);
  const outcomes = [
    { raceRole: "normal", actionId: normalActionId, outcome: normalOutcome },
    { raceRole: "deadline", actionId: deadlineActionId, outcome: deadlineOutcome },
  ];
  const ackEntries = outcomes.filter((entry) => entry.outcome?.state === "ack");
  const rejectEntries = outcomes.filter((entry) => entry.outcome?.state === "reject");
  const ackEntry = ackEntries[0] ?? null;
  const rejectEntry = rejectEntries[0] ?? null;
  const ack = ackEntry?.outcome ?? null;
  const reject = rejectEntry?.outcome ?? null;
  const normalCommand = normalOutcome?.requestEnvelope?.body?.body?.command?.AdvancePhase;
  const deadlineCommand =
    deadlineOutcome?.requestEnvelope?.body?.body?.command?.AdvancePhaseByDeadline;
  const ackStreamLength = ack?.streamSeqs?.length ?? 0;
  const expectedRejectMessage =
    rejectEntry?.actionId === deadlineActionId ? "deadline target is stale" : "stale phase state";
  if (
    mixedAdvanceSetup?.stalePhase?.id !== "D01" ||
    mixedAdvanceSetup?.stalePhase?.locked !== true ||
    typeof expectedDeadline !== "number" ||
    mixedAdvanceSetup?.visibleActions?.includes(normalActionId) !== true ||
    mixedAdvanceSetup?.visibleActions?.includes(deadlineActionId) !== true ||
    ackEntries.length !== 1 ||
    rejectEntries.length !== 1 ||
    ack?.serverEnvelope?.body?.kind !== "Ack" ||
    !Array.isArray(ack?.streamSeqs) ||
    ![1, 2].includes(ackStreamLength) ||
    (ackEntry?.actionId === normalActionId && ackStreamLength !== 1) ||
    (ackEntry?.actionId === deadlineActionId && ackStreamLength !== 2) ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes(expectedRejectMessage) ||
    ack?.commandId === reject?.commandId ||
    normalCommand?.game !== game ||
    deadlineCommand?.game !== game ||
    deadlineCommand?.phase !== "D01" ||
    deadlineCommand?.observed_at !== expectedDeadline + 1
  ) {
    throw new Error(
      `concurrent host mixed advance race outcomes drifted: ${JSON.stringify({
        mixedAdvanceSetup,
        normalOutcome,
        deadlineOutcome,
        expectedDeadline,
        expectedRejectMessage,
      })}`,
    );
  }

  await Promise.all([
    waitForHostProjectionPhase(normalAdvancePage, { phaseId: "N01", locked: false }),
    deadlineAdvancePage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "N01" &&
        window.__fmarchHostProjection?.phase?.locked === false,
    ),
  ]);
  const [
    normalPhaseAfterRace,
    deadlinePhaseAfterRace,
    normalPhaseActionsAfterRace,
    deadlinePhaseActionsAfterRace,
    normalDeadlineActionsAfterRace,
    deadlineDeadlineActionsAfterRace,
    normalActivityStatusText,
    deadlineActivityStatusText,
    normalActivityRow,
    deadlineActivityRow,
  ] = await Promise.all([
    normalAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    deadlineAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(normalAdvancePage, "phase"),
    visibleHostControlActions(deadlineAdvancePage, "phase"),
    visibleHostControlActions(normalAdvancePage, "deadline"),
    visibleHostControlActions(deadlineAdvancePage, "deadline"),
    normalAdvancePage
      .getByTestId(`host-command-activity-status-${normalActionId}`)
      .innerText(),
    deadlineAdvancePage
      .getByTestId(`host-command-activity-status-${deadlineActionId}`)
      .innerText(),
    normalAdvancePage
      .getByTestId(`host-command-activity-${normalActionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
    deadlineAdvancePage
      .getByTestId(`host-command-activity-${deadlineActionId}`)
      .evaluate((node) => ({
        source: node.getAttribute("data-source"),
        actionId: node.getAttribute("data-confirmation-action-id"),
        dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
        text: node.textContent,
      })),
  ]);
  const hostStateAfterRace = await fetchHostConsoleState({ apiBaseUrl, game });
  const activityTexts = [normalActivityStatusText, deadlineActivityStatusText];
  if (
    normalPhaseAfterRace?.id !== "N01" ||
    normalPhaseAfterRace?.locked !== false ||
    normalPhaseAfterRace?.deadline !== null ||
    deadlinePhaseAfterRace?.id !== "N01" ||
    deadlinePhaseAfterRace?.locked !== false ||
    deadlinePhaseAfterRace?.deadline !== null ||
    !normalPhaseActionsAfterRace.includes("resolve_phase") ||
    !normalPhaseActionsAfterRace.includes("lock_thread") ||
    normalPhaseActionsAfterRace.includes("advance_phase") ||
    normalPhaseActionsAfterRace.includes("unlock_thread") ||
    normalPhaseActionsAfterRace.includes("advance_phase_by_deadline") ||
    !deadlinePhaseActionsAfterRace.includes("resolve_phase") ||
    !deadlinePhaseActionsAfterRace.includes("lock_thread") ||
    deadlinePhaseActionsAfterRace.includes("advance_phase") ||
    deadlinePhaseActionsAfterRace.includes("unlock_thread") ||
    deadlinePhaseActionsAfterRace.includes("advance_phase_by_deadline") ||
    !normalDeadlineActionsAfterRace.includes("extend_deadline") ||
    !deadlineDeadlineActionsAfterRace.includes("extend_deadline") ||
    !activityTexts.some((text) => text.includes("Ack")) ||
    !activityTexts.some((text) => text.includes("Reject InvalidTarget")) ||
    normalActivityRow.actionId !== normalActionId ||
    deadlineActivityRow.actionId !== deadlineActionId ||
    hostStateAfterRace.phase?.phase_id !== "N01" ||
    hostStateAfterRace.phase?.locked !== false ||
    hostStateAfterRace.phase?.deadline !== null
  ) {
    throw new Error(
      `concurrent host mixed advance convergence drifted: ${JSON.stringify({
        normalPhaseAfterRace,
        deadlinePhaseAfterRace,
        normalPhaseActionsAfterRace,
        deadlinePhaseActionsAfterRace,
        normalDeadlineActionsAfterRace,
        deadlineDeadlineActionsAfterRace,
        normalActivityStatusText,
        deadlineActivityStatusText,
        normalActivityRow,
        deadlineActivityRow,
        apiPhase: hostStateAfterRace.phase,
      })}`,
    );
  }

  const roleReloadAfterRace = await verifyConcurrentHostMixedAdvanceRaceReload({
    normalAdvancePage,
    deadlineAdvancePage,
    game,
    apiBaseUrl,
  });

  return {
    status: "passed",
    actionId: "mixed_advance_phase",
    setup: mixedAdvanceSetup,
    normalConfirmationMessage,
    deadlineConfirmationMessage,
    ackRaceRole: ackEntry.raceRole,
    rejectRaceRole: rejectEntry.raceRole,
    ackActionId: ackEntry.actionId,
    rejectActionId: rejectEntry.actionId,
    ack,
    reject,
    normalOutcome,
    deadlineOutcome,
    normalPhaseAfterRace,
    deadlinePhaseAfterRace,
    normalPhaseActionsAfterRace,
    deadlinePhaseActionsAfterRace,
    normalDeadlineActionsAfterRace,
    deadlineDeadlineActionsAfterRace,
    normalActivityStatusText,
    deadlineActivityStatusText,
    normalActivityRow,
    deadlineActivityRow,
    apiPhaseAfterRace: hostStateAfterRace.phase,
    roleReloadAfterRace,
    proof:
      "Two seeded host role pages submitted D01 advance_phase and advance_phase_by_deadline concurrently with distinct command ids; one ACKed, one rejected with InvalidTarget stale recovery, both browser projections plus the API converged to open N01 with no carried deadline, and both host role URLs reloaded to the same open N01 controls.",
  };
}

async function verifyConcurrentHostMixedAdvanceRaceReload({
  normalAdvancePage,
  deadlineAdvancePage,
  game,
  apiBaseUrl,
}) {
  const [normalReload, deadlineReload] = await Promise.all([
    gotoHostConsole(normalAdvancePage, game),
    gotoHostConsole(deadlineAdvancePage, game),
  ]);
  await Promise.all([
    waitForHostProjectionPhase(normalAdvancePage, { phaseId: "N01", locked: false }),
    waitForHostProjectionPhase(deadlineAdvancePage, {
      phaseId: "N01",
      locked: false,
    }),
  ]);
  const [
    normalPhaseAfterReload,
    deadlinePhaseAfterReload,
    normalPhaseActionsAfterReload,
    deadlinePhaseActionsAfterReload,
    normalDeadlineActionsAfterReload,
    deadlineDeadlineActionsAfterReload,
  ] = await Promise.all([
    normalAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    deadlineAdvancePage.evaluate(() => window.__fmarchHostProjection?.phase),
    visibleHostControlActions(normalAdvancePage, "phase"),
    visibleHostControlActions(deadlineAdvancePage, "phase"),
    visibleHostControlActions(normalAdvancePage, "deadline"),
    visibleHostControlActions(deadlineAdvancePage, "deadline"),
  ]);
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const requiredOpenPhaseActions = (actions) =>
    actions.includes("resolve_phase") &&
    actions.includes("lock_thread") &&
    !actions.includes("advance_phase") &&
    !actions.includes("unlock_thread") &&
    !actions.includes("advance_phase_by_deadline");
  if (
    normalReload.status !== 200 ||
    deadlineReload.status !== 200 ||
    normalPhaseAfterReload?.id !== "N01" ||
    normalPhaseAfterReload?.locked !== false ||
    normalPhaseAfterReload?.deadline !== null ||
    deadlinePhaseAfterReload?.id !== "N01" ||
    deadlinePhaseAfterReload?.locked !== false ||
    deadlinePhaseAfterReload?.deadline !== null ||
    requiredOpenPhaseActions(normalPhaseActionsAfterReload) !== true ||
    requiredOpenPhaseActions(deadlinePhaseActionsAfterReload) !== true ||
    !normalDeadlineActionsAfterReload.includes("extend_deadline") ||
    !deadlineDeadlineActionsAfterReload.includes("extend_deadline") ||
    hostStateAfterReload.phase?.phase_id !== "N01" ||
    hostStateAfterReload.phase?.locked !== false ||
    hostStateAfterReload.phase?.deadline !== null
  ) {
    throw new Error(
      `concurrent host mixed advance reload drifted: ${JSON.stringify({
        normalReload,
        deadlineReload,
        normalPhaseAfterReload,
        deadlinePhaseAfterReload,
        normalPhaseActionsAfterReload,
        deadlinePhaseActionsAfterReload,
        normalDeadlineActionsAfterReload,
        deadlineDeadlineActionsAfterReload,
        apiPhase: hostStateAfterReload.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    normalRouteStatus: normalReload.status,
    deadlineRouteStatus: deadlineReload.status,
    normalPhaseAfterReload,
    deadlinePhaseAfterReload,
    normalPhaseActionsAfterReload,
    deadlinePhaseActionsAfterReload,
    normalDeadlineActionsAfterReload,
    deadlineDeadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
}

async function submitStaleHostResolveRecovery({
  staleHostResolvePage,
  staleHostResolveSetup,
  liveResolveForStaleHostResolve,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const actionId = "resolve_phase";
  const staleActionRoot = staleHostResolvePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId,
    roleLabel: "stale host",
  });
  await staleHostResolvePage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "PhaseLocked",
    actionId,
  );
  await staleHostResolvePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === true,
  );
  const reject = await staleHostResolvePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await staleHostResolvePage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleHostResolvePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const phaseActionsAfterReject = await visibleHostControlActions(
    staleHostResolvePage,
    "phase",
  );
  const deadlineActionsAfterReject = await visibleHostControlActions(
    staleHostResolvePage,
    "deadline",
  );
  const activityStatusText = await staleHostResolvePage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostResolvePage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostResolvePage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleClickBrowserProof = {
    roleUrl: staleHostResolveSetup.roleUrl,
    clickedActionId: actionId,
    triggerTestId: `critical-host-action-${actionId}`,
    receiptStatusText: activityStatusText,
    activityRow,
    dispatchRefreshKeys: dispatchPlan?.projectionRefreshKeys ?? null,
    phaseAfterReject,
    phaseActionsAfterReject,
    deadlineActionsAfterReject,
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
  const reloadResponse = await staleHostResolvePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale host resolve reload failed with ${reloadResponse?.status() ?? "no response"}`,
    );
  }
  await staleHostResolvePage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await staleHostResolvePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === true,
  );
  const surfaceTextAfterReload = await staleHostResolvePage
    .getByTestId("host-console-surface")
    .innerText();
  const phaseAfterReload = await staleHostResolvePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const phaseActionsAfterReload = await visibleHostControlActions(
    staleHostResolvePage,
    "phase",
  );
  const deadlineActionsAfterReload = await visibleHostControlActions(
    staleHostResolvePage,
    "deadline",
  );
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleHostResolveReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    phaseAfterReload,
    phaseActionsAfterReload,
    deadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
  const reconnectAfterReject = await verifyHostReconnectRecovery({
    page: staleHostResolvePage,
    game,
  });
  const phaseActionsAfterReconnect = await visibleHostControlActions(
    staleHostResolvePage,
    "phase",
  );
  const deadlineActionsAfterReconnect = await visibleHostControlActions(
    staleHostResolvePage,
    "deadline",
  );
  if (
    typeof staleHostResolveSetup.roleUrl !== "string" ||
    !staleHostResolveSetup.roleUrl.includes(`/g/${game}/host`) ||
    liveResolveForStaleHostResolve?.commandStatus?.state !== "ack" ||
    !Array.isArray(liveResolveForStaleHostResolve?.commandStatus?.streamSeqs) ||
    liveResolveForStaleHostResolve.commandStatus.streamSeqs.length === 0 ||
    liveResolveForStaleHostResolve?.commandStatus?.requestEnvelope?.body?.body?.command
      ?.ResolvePhase?.game !== game ||
    reject?.state !== "reject" ||
    reject?.error !== "PhaseLocked" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("stale phase state") ||
    phaseAfterReject?.id !== "D02" ||
    phaseAfterReject?.locked !== true ||
    !phaseActionsAfterReject.includes("unlock_thread") ||
    !phaseActionsAfterReject.includes("advance_phase") ||
    phaseActionsAfterReject.includes("resolve_phase") ||
    phaseActionsAfterReject.includes("lock_thread") ||
    !deadlineActionsAfterReject.includes("extend_deadline") ||
    !activityStatusText.includes("Reject PhaseLocked") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.roleUrl !== staleHostResolveSetup.roleUrl ||
    staleClickBrowserProof.clickedActionId !== actionId ||
    staleClickBrowserProof.receiptStatusText !== activityStatusText ||
    staleClickBrowserProof.dispatchRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.phaseAfterReject?.id !== "D02" ||
    staleClickBrowserProof.phaseAfterReject?.locked !== true ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("unlock_thread") ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("advance_phase") ||
    staleClickBrowserProof.phaseActionsAfterReject.includes("resolve_phase") ||
    staleClickBrowserProof.phaseActionsAfterReject.includes("lock_thread") ||
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== true ||
    staleHostResolveReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostResolveReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject PhaseLocked",
    ) ||
    staleHostResolveReloadAfterReject.phaseAfterReload?.id !== "D02" ||
    staleHostResolveReloadAfterReject.phaseAfterReload?.locked !== true ||
    !staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "unlock_thread",
    ) ||
    !staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "advance_phase",
    ) ||
    staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ) ||
    staleHostResolveReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ) ||
    !staleHostResolveReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ) ||
    staleHostResolveReloadAfterReject.apiPhaseAfterReload?.phase_id !== "D02" ||
    staleHostResolveReloadAfterReject.apiPhaseAfterReload?.locked !== true ||
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.id !== "D02" ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.locked !== true ||
    !phaseActionsAfterReconnect.includes("unlock_thread") ||
    !phaseActionsAfterReconnect.includes("advance_phase") ||
    phaseActionsAfterReconnect.includes("resolve_phase") ||
    phaseActionsAfterReconnect.includes("lock_thread") ||
    !deadlineActionsAfterReconnect.includes("extend_deadline")
  ) {
    throw new Error(
      `stale host resolve recovery drifted: ${JSON.stringify({
        staleHostResolveSetup,
        liveResolveForStaleHostResolve,
        reject,
        commandOutcomes,
        phaseAfterReject,
        phaseActionsAfterReject,
        deadlineActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        staleClickBrowserProof,
        apiPhase: hostStateAfterReject.phase,
        staleHostResolveReloadAfterReject,
        reconnectAfterReject,
        phaseActionsAfterReconnect,
        deadlineActionsAfterReconnect,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleHostResolveSetup,
    liveResolve: liveResolveForStaleHostResolve,
    reject,
    commandOutcomes,
    phaseAfterReject,
    phaseActionsAfterReject,
    deadlineActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    staleClickBrowserProof,
    apiPhaseAfterReject: hostStateAfterReject.phase,
    staleHostResolveReloadAfterReject,
    reconnectAfterReject,
    phaseActionsAfterReconnect,
    deadlineActionsAfterReconnect,
  };
}

async function submitStaleHostAdvanceRecovery({
  staleHostAdvancePage,
  staleHostAdvanceSetup,
  restoreAfterStaleHostResolve,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const actionId = "advance_phase";
  const staleActionRoot = staleHostAdvancePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, { actionId, roleLabel: "stale host" });
  await staleHostAdvancePage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "InvalidTarget",
    actionId,
  );
  await staleHostAdvancePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const reject = await staleHostAdvancePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await staleHostAdvancePage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleHostAdvancePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const phaseActionsAfterReject = await visibleHostControlActions(
    staleHostAdvancePage,
    "phase",
  );
  const deadlineActionsAfterReject = await visibleHostControlActions(
    staleHostAdvancePage,
    "deadline",
  );
  const activityStatusText = await staleHostAdvancePage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostAdvancePage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostAdvancePage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleClickBrowserProof = {
    roleUrl: staleHostAdvanceSetup.roleUrl,
    clickedActionId: actionId,
    triggerTestId: `critical-host-action-${actionId}`,
    receiptStatusText: activityStatusText,
    activityRow,
    dispatchRefreshKeys: dispatchPlan?.projectionRefreshKeys ?? null,
    phaseAfterReject,
    phaseActionsAfterReject,
    deadlineActionsAfterReject,
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
  const reloadResponse = await staleHostAdvancePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale host advance reload failed with ${reloadResponse?.status() ?? "no response"}`,
    );
  }
  await staleHostAdvancePage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await staleHostAdvancePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const surfaceTextAfterReload = await staleHostAdvancePage
    .getByTestId("host-console-surface")
    .innerText();
  const phaseAfterReload = await staleHostAdvancePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const phaseActionsAfterReload = await visibleHostControlActions(
    staleHostAdvancePage,
    "phase",
  );
  const deadlineActionsAfterReload = await visibleHostControlActions(
    staleHostAdvancePage,
    "deadline",
  );
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleHostAdvanceReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    phaseAfterReload,
    phaseActionsAfterReload,
    deadlineActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
  const reconnectAfterReject = await verifyHostReconnectRecovery({
    page: staleHostAdvancePage,
    game,
  });
  const phaseActionsAfterReconnect = await visibleHostControlActions(
    staleHostAdvancePage,
    "phase",
  );
  const deadlineActionsAfterReconnect = await visibleHostControlActions(
    staleHostAdvancePage,
    "deadline",
  );
  if (
    typeof staleHostAdvanceSetup.roleUrl !== "string" ||
    !staleHostAdvanceSetup.roleUrl.includes(`/g/${game}/host`) ||
    restoreAfterStaleHostResolve?.commandStatus?.state !== "ack" ||
    !Array.isArray(restoreAfterStaleHostResolve?.commandStatus?.streamSeqs) ||
    restoreAfterStaleHostResolve.commandStatus.streamSeqs.length === 0 ||
    restoreAfterStaleHostResolve?.commandStatus?.requestEnvelope?.body?.body?.command
      ?.UnlockThread?.game !== game ||
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("stale phase state") ||
    phaseAfterReject?.id !== "D02" ||
    phaseAfterReject?.locked !== false ||
    !phaseActionsAfterReject.includes("resolve_phase") ||
    !phaseActionsAfterReject.includes("lock_thread") ||
    phaseActionsAfterReject.includes("advance_phase") ||
    !deadlineActionsAfterReject.includes("extend_deadline") ||
    !activityStatusText.includes("Reject InvalidTarget") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.roleUrl !== staleHostAdvanceSetup.roleUrl ||
    staleClickBrowserProof.clickedActionId !== actionId ||
    staleClickBrowserProof.receiptStatusText !== activityStatusText ||
    staleClickBrowserProof.dispatchRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.phaseAfterReject?.id !== "D02" ||
    staleClickBrowserProof.phaseAfterReject?.locked !== false ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("resolve_phase") ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("lock_thread") ||
    staleClickBrowserProof.phaseActionsAfterReject.includes("advance_phase") ||
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false ||
    staleHostAdvanceReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostAdvanceReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject InvalidTarget",
    ) ||
    staleHostAdvanceReloadAfterReject.phaseAfterReload?.id !== "D02" ||
    staleHostAdvanceReloadAfterReject.phaseAfterReload?.locked !== false ||
    !staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ) ||
    !staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ) ||
    staleHostAdvanceReloadAfterReject.phaseActionsAfterReload.includes(
      "advance_phase",
    ) ||
    !staleHostAdvanceReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ) ||
    staleHostAdvanceReloadAfterReject.apiPhaseAfterReload?.phase_id !== "D02" ||
    staleHostAdvanceReloadAfterReject.apiPhaseAfterReload?.locked !== false ||
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.id !== "D02" ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.locked !== false ||
    !phaseActionsAfterReconnect.includes("resolve_phase") ||
    !phaseActionsAfterReconnect.includes("lock_thread") ||
    phaseActionsAfterReconnect.includes("advance_phase") ||
    !deadlineActionsAfterReconnect.includes("extend_deadline")
  ) {
    throw new Error(
      `stale host advance recovery drifted: ${JSON.stringify({
        staleHostAdvanceSetup,
        restoreAfterStaleHostResolve,
        reject,
        commandOutcomes,
        phaseAfterReject,
        phaseActionsAfterReject,
        deadlineActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        staleClickBrowserProof,
        apiPhase: hostStateAfterReject.phase,
        staleHostAdvanceReloadAfterReject,
        reconnectAfterReject,
        phaseActionsAfterReconnect,
        deadlineActionsAfterReconnect,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleHostAdvanceSetup,
    liveUnlock: restoreAfterStaleHostResolve,
    reject,
    commandOutcomes,
    phaseAfterReject,
    phaseActionsAfterReject,
    deadlineActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    staleClickBrowserProof,
    apiPhaseAfterReject: hostStateAfterReject.phase,
    staleHostAdvanceReloadAfterReject,
    reconnectAfterReject,
    phaseActionsAfterReconnect,
    deadlineActionsAfterReconnect,
  };
}

async function submitStaleHostDeadlineRecovery({
  staleHostDeadlinePage,
  staleHostDeadlineSetup,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const actionId = "extend_deadline";
  const staleActionRoot = staleHostDeadlinePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, { actionId, roleLabel: "stale host" });
  await staleHostDeadlinePage.waitForFunction(
    (expectedActionId) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.error === "PhaseLocked",
    actionId,
  );
  await staleHostDeadlinePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const reject = await staleHostDeadlinePage.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const commandOutcomes = await staleHostDeadlinePage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleHostDeadlinePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const deadlineActionsAfterReject = await visibleHostControlActions(
    staleHostDeadlinePage,
    "deadline",
  );
  const phaseActionsAfterReject = await visibleHostControlActions(
    staleHostDeadlinePage,
    "phase",
  );
  const activityStatusText = await staleHostDeadlinePage
    .getByTestId(`host-command-activity-status-${actionId}`)
    .innerText();
  const activityRow = await staleHostDeadlinePage
    .getByTestId(`host-command-activity-${actionId}`)
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleHostDeadlinePage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleClickBrowserProof = {
    roleUrl: staleHostDeadlineSetup.roleUrl,
    clickedActionId: actionId,
    triggerTestId: `critical-host-action-${actionId}`,
    receiptStatusText: activityStatusText,
    activityRow,
    dispatchRefreshKeys: dispatchPlan?.projectionRefreshKeys ?? null,
    phaseAfterReject,
    deadlineActionsAfterReject,
    phaseActionsAfterReject,
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
  const reloadResponse = await staleHostDeadlinePage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale host deadline reload failed with ${reloadResponse?.status() ?? "no response"}`,
    );
  }
  await staleHostDeadlinePage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await staleHostDeadlinePage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const surfaceTextAfterReload = await staleHostDeadlinePage
    .getByTestId("host-console-surface")
    .innerText();
  const phaseAfterReload = await staleHostDeadlinePage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const deadlineActionsAfterReload = await visibleHostControlActions(
    staleHostDeadlinePage,
    "deadline",
  );
  const phaseActionsAfterReload = await visibleHostControlActions(
    staleHostDeadlinePage,
    "phase",
  );
  const hostStateAfterReload = await fetchHostConsoleState({ apiBaseUrl, game });
  const staleHostDeadlineReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    phaseAfterReload,
    deadlineActionsAfterReload,
    phaseActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
  const reconnectAfterReject = await verifyHostReconnectRecovery({
    page: staleHostDeadlinePage,
    game,
  });
  const deadlineActionsAfterReconnect = await visibleHostControlActions(
    staleHostDeadlinePage,
    "deadline",
  );
  const phaseActionsAfterReconnect = await visibleHostControlActions(
    staleHostDeadlinePage,
    "phase",
  );
  const hostStateAfterReconnect = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    typeof staleHostDeadlineSetup.roleUrl !== "string" ||
    !staleHostDeadlineSetup.roleUrl.includes(`/g/${game}/host`) ||
    reject?.state !== "reject" ||
    reject?.error !== "PhaseLocked" ||
    !reject?.message?.includes("stale phase state") ||
    phaseAfterReject?.id !== "D02" ||
    phaseAfterReject?.locked !== false ||
    !deadlineActionsAfterReject.includes(actionId) ||
    !phaseActionsAfterReject.includes("resolve_phase") ||
    !phaseActionsAfterReject.includes("lock_thread") ||
    !activityStatusText.includes("Reject PhaseLocked") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== actionId ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.roleUrl !== staleHostDeadlineSetup.roleUrl ||
    staleClickBrowserProof.clickedActionId !== actionId ||
    staleClickBrowserProof.receiptStatusText !== activityStatusText ||
    staleClickBrowserProof.dispatchRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.phaseAfterReject?.id !== "D02" ||
    staleClickBrowserProof.phaseAfterReject?.locked !== false ||
    !staleClickBrowserProof.deadlineActionsAfterReject.includes(actionId) ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("resolve_phase") ||
    !staleClickBrowserProof.phaseActionsAfterReject.includes("lock_thread") ||
    staleClickBrowserProof.apiPhaseAfterReject?.deadline !== null ||
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false ||
    hostStateAfterReject.phase?.deadline !== null ||
    staleHostDeadlineReloadAfterReject.routeResponseStatus !== 200 ||
    !staleHostDeadlineReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject PhaseLocked",
    ) ||
    staleHostDeadlineReloadAfterReject.phaseAfterReload?.id !== "D02" ||
    staleHostDeadlineReloadAfterReject.phaseAfterReload?.locked !== false ||
    !staleHostDeadlineReloadAfterReject.deadlineActionsAfterReload.includes(
      actionId,
    ) ||
    !staleHostDeadlineReloadAfterReject.phaseActionsAfterReload.includes(
      "resolve_phase",
    ) ||
    !staleHostDeadlineReloadAfterReject.phaseActionsAfterReload.includes(
      "lock_thread",
    ) ||
    staleHostDeadlineReloadAfterReject.apiPhaseAfterReload?.phase_id !== "D02" ||
    staleHostDeadlineReloadAfterReject.apiPhaseAfterReload?.locked !== false ||
    staleHostDeadlineReloadAfterReject.apiPhaseAfterReload?.deadline !== null ||
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.id !== "D02" ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.locked !== false ||
    !deadlineActionsAfterReconnect.includes(actionId) ||
    !phaseActionsAfterReconnect.includes("resolve_phase") ||
    !phaseActionsAfterReconnect.includes("lock_thread") ||
    hostStateAfterReconnect.phase?.phase_id !== "D02" ||
    hostStateAfterReconnect.phase?.locked !== false ||
    hostStateAfterReconnect.phase?.deadline !== null
  ) {
    throw new Error(
      `stale host deadline recovery drifted: ${JSON.stringify({
        staleHostDeadlineSetup,
        reject,
        commandOutcomes,
        phaseAfterReject,
        deadlineActionsAfterReject,
        phaseActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        staleClickBrowserProof,
        apiPhase: hostStateAfterReject.phase,
        staleHostDeadlineReloadAfterReject,
        reconnectAfterReject,
        deadlineActionsAfterReconnect,
        phaseActionsAfterReconnect,
        apiPhaseAfterReconnect: hostStateAfterReconnect.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId,
    setup: staleHostDeadlineSetup,
    reject,
    commandOutcomes,
    phaseAfterReject,
    deadlineActionsAfterReject,
    phaseActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    staleClickBrowserProof,
    apiPhaseAfterReject: hostStateAfterReject.phase,
    staleHostDeadlineReloadAfterReject,
    reconnectAfterReject,
    deadlineActionsAfterReconnect,
    phaseActionsAfterReconnect,
    apiPhaseAfterReconnect: hostStateAfterReconnect.phase,
  };
}

async function submitStaleCohostDeadlineRecovery({
  staleCohostPage,
  staleCohostDeadlineSetup,
  apiBaseUrl,
  frontendBaseUrl,
  game,
}) {
  const staleActionRoot = staleCohostPage.getByTestId("critical-host-action-extend_deadline");
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await clickCriticalHostActionConfirm(staleActionRoot, {
    actionId: "extend_deadline",
    roleLabel: "stale cohost",
  });
  await staleCohostPage.waitForFunction(
    () =>
      window.__fmarchHostCommandStatuses?.extend_deadline?.state === "reject" &&
      window.__fmarchHostCommandStatuses?.extend_deadline?.error === "PhaseLocked",
  );
  await staleCohostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const reject = await staleCohostPage.evaluate(
    () => window.__fmarchHostCommandStatuses?.extend_deadline,
  );
  const commandOutcomes = await staleCohostPage.evaluate(
    () => window.__fmarchHostCommandOutcomes ?? [],
  );
  const phaseAfterReject = await staleCohostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const deadlineActionsAfterReject = await visibleHostControlActions(staleCohostPage, "deadline");
  const phaseActionsAfterReject = await visibleHostControlActions(staleCohostPage, "phase");
  const activityStatusText = await staleCohostPage
    .getByTestId("host-command-activity-status-extend_deadline")
    .innerText();
  const activityRow = await staleCohostPage
    .getByTestId("host-command-activity-extend_deadline")
    .evaluate((node) => ({
      source: node.getAttribute("data-source"),
      actionId: node.getAttribute("data-confirmation-action-id"),
      dispatchKind: node.getAttribute("data-confirmation-dispatch-kind"),
      text: node.textContent,
    }));
  const dispatchPlan = await staleCohostPage.evaluate(
    () => window.__fmarchHostCommandDispatchBridgePlan,
  );
  const hostStateAfterReject = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    principalUserId: "cohost_c",
  });
  const staleClickBrowserProof = {
    roleUrl: staleCohostDeadlineSetup.roleUrl,
    clickedActionId: "extend_deadline",
    triggerTestId: "critical-host-action-extend_deadline",
    receiptStatusText: activityStatusText,
    activityRow,
    dispatchRefreshKeys: dispatchPlan?.projectionRefreshKeys ?? null,
    phaseAfterReject,
    deadlineActionsAfterReject,
    phaseActionsAfterReject,
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
  const reloadResponse = await staleCohostPage.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  if (reloadResponse === null || !reloadResponse.ok()) {
    throw new Error(
      `stale cohost deadline reload failed with ${reloadResponse?.status() ?? "no response"}`,
    );
  }
  await staleCohostPage.getByTestId("host-console-surface").waitFor({
    state: "visible",
  });
  await staleCohostPage.waitForFunction(
    () =>
      window.__fmarchHostProjection?.phase?.id === "D02" &&
      window.__fmarchHostProjection?.phase?.locked === false,
  );
  const surfaceTextAfterReload = await staleCohostPage
    .getByTestId("host-console-surface")
    .innerText();
  const phaseAfterReload = await staleCohostPage.evaluate(
    () => window.__fmarchHostProjection?.phase,
  );
  const deadlineActionsAfterReload = await visibleHostControlActions(
    staleCohostPage,
    "deadline",
  );
  const phaseActionsAfterReload = await visibleHostControlActions(
    staleCohostPage,
    "phase",
  );
  const hostStateAfterReload = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    principalUserId: "cohost_c",
  });
  const staleCohostDeadlineReloadAfterReject = {
    status: "passed",
    routeResponseStatus: reloadResponse.status(),
    rejectReceiptStatusText: activityStatusText,
    surfaceText: surfaceTextAfterReload,
    phaseAfterReload,
    deadlineActionsAfterReload,
    phaseActionsAfterReload,
    apiPhaseAfterReload: hostStateAfterReload.phase,
  };
  const reconnectAfterReject = await verifyHostReconnectRecovery({
    page: staleCohostPage,
    game,
  });
  const deadlineActionsAfterReconnect = await visibleHostControlActions(
    staleCohostPage,
    "deadline",
  );
  const phaseActionsAfterReconnect = await visibleHostControlActions(
    staleCohostPage,
    "phase",
  );
  const hostStateAfterReconnect = await fetchHostConsoleState({
    apiBaseUrl,
    game,
    principalUserId: "cohost_c",
  });
  if (
    typeof staleCohostDeadlineSetup.roleUrl !== "string" ||
    !staleCohostDeadlineSetup.roleUrl.includes(`/g/${game}/host`) ||
    reject?.state !== "reject" ||
    reject?.error !== "PhaseLocked" ||
    !reject?.message?.includes("stale phase state") ||
    phaseAfterReject?.id !== "D02" ||
    phaseAfterReject?.locked !== false ||
    !deadlineActionsAfterReject.includes("extend_deadline") ||
    phaseActionsAfterReject.length !== 0 ||
    !activityStatusText.includes("Reject PhaseLocked") ||
    activityRow.source !== "outcome" ||
    activityRow.actionId !== "extend_deadline" ||
    activityRow.dispatchKind !== "extend_deadline" ||
    dispatchPlan?.projectionRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.roleUrl !== staleCohostDeadlineSetup.roleUrl ||
    staleClickBrowserProof.clickedActionId !== "extend_deadline" ||
    staleClickBrowserProof.receiptStatusText !== activityStatusText ||
    staleClickBrowserProof.dispatchRefreshKeys?.includes("host") !== true ||
    staleClickBrowserProof.phaseAfterReject?.id !== "D02" ||
    staleClickBrowserProof.phaseAfterReject?.locked !== false ||
    !staleClickBrowserProof.deadlineActionsAfterReject.includes("extend_deadline") ||
    staleClickBrowserProof.phaseActionsAfterReject.length !== 0 ||
    staleClickBrowserProof.apiPhaseAfterReject?.deadline !== null ||
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false ||
    hostStateAfterReject.phase?.deadline !== null ||
    staleCohostDeadlineReloadAfterReject.routeResponseStatus !== 200 ||
    !staleCohostDeadlineReloadAfterReject.rejectReceiptStatusText.includes(
      "Reject PhaseLocked",
    ) ||
    staleCohostDeadlineReloadAfterReject.phaseAfterReload?.id !== "D02" ||
    staleCohostDeadlineReloadAfterReject.phaseAfterReload?.locked !== false ||
    !staleCohostDeadlineReloadAfterReject.deadlineActionsAfterReload.includes(
      "extend_deadline",
    ) ||
    staleCohostDeadlineReloadAfterReject.phaseActionsAfterReload.length !== 0 ||
    staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload?.phase_id !== "D02" ||
    staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload?.locked !== false ||
    staleCohostDeadlineReloadAfterReject.apiPhaseAfterReload?.deadline !== null ||
    reconnectAfterReject?.status !== "passed" ||
    reconnectAfterReject?.reconnectingStatus?.state !== "reconnecting" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.state !== "recovered" ||
    reconnectAfterReject?.reconnectRecoveryEvent?.attempt !== 1 ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.id !== "D02" ||
    reconnectAfterReject?.recoveredHostProjection?.phase?.locked !== false ||
    !deadlineActionsAfterReconnect.includes("extend_deadline") ||
    phaseActionsAfterReconnect.length !== 0 ||
    hostStateAfterReconnect.phase?.phase_id !== "D02" ||
    hostStateAfterReconnect.phase?.locked !== false ||
    hostStateAfterReconnect.phase?.deadline !== null
  ) {
    throw new Error(
      `stale cohost deadline recovery drifted: ${JSON.stringify({
        staleCohostDeadlineSetup,
        reject,
        commandOutcomes,
        phaseAfterReject,
        deadlineActionsAfterReject,
        phaseActionsAfterReject,
        activityStatusText,
        activityRow,
        dispatchPlan,
        staleClickBrowserProof,
        apiPhase: hostStateAfterReject.phase,
        staleCohostDeadlineReloadAfterReject,
        reconnectAfterReject,
        deadlineActionsAfterReconnect,
        phaseActionsAfterReconnect,
        apiPhaseAfterReconnect: hostStateAfterReconnect.phase,
      })}`,
    );
  }
  return {
    status: "passed",
    actionId: "extend_deadline",
    setup: staleCohostDeadlineSetup,
    reject,
    commandOutcomes,
    phaseAfterReject,
    deadlineActionsAfterReject,
    phaseActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    staleClickBrowserProof,
    apiPhaseAfterReject: hostStateAfterReject.phase,
    staleCohostDeadlineReloadAfterReject,
    reconnectAfterReject,
    deadlineActionsAfterReconnect,
    phaseActionsAfterReconnect,
    apiPhaseAfterReconnect: hostStateAfterReconnect.phase,
  };
}

async function verifyPlayerReconnectRecovery({ playerPage, game }) {
  return await verifyRoleReconnectRecovery({
    page: playerPage,
    game,
    principalUserId: "player-seed",
    actorSlot: "slot-3",
    postPrefix: "Player reconnect proof",
    navigate: true,
  });
}

async function verifyHostReconnectRecovery({ page, game, navigate = false }) {
  if (navigate) {
    await gotoHostConsole(page, game);
  }
  await page.waitForFunction(
    () => typeof window.__fmarchDropHostLiveProjection === "function",
  );
  await page.evaluate(() => window.__fmarchDropHostLiveProjection());
  await page.waitForFunction(
    () => window.__fmarchHostLiveProjectionStatus?.state === "reconnecting",
  );
  const reconnectingStatus = await page.evaluate(
    () => window.__fmarchHostLiveProjectionStatus,
  );
  await page.waitForFunction(
    () =>
      (window.__fmarchHostLiveProjectionEvents ?? []).some(
        (event) =>
          event?.kind === "reconnect" &&
          event.attempt === 1 &&
          event.state === "recovered",
      ),
  );
  const recoveredStatus = await page.evaluate(
    () => window.__fmarchHostLiveProjectionStatus,
  );
  const reconnectRecoveryEvent = await page.evaluate(() =>
    (window.__fmarchHostLiveProjectionEvents ?? []).find(
      (event) =>
        event?.kind === "reconnect" &&
        event.attempt === 1 &&
        event.state === "recovered",
    ),
  );
  await page.waitForFunction(() => window.__fmarchHostProjection !== undefined);
  const recoveredHostProjection = await page.evaluate(
    () => window.__fmarchHostProjection,
  );
  return {
    status: "passed",
    game,
    reconnectingStatus,
    reconnectRecoveryEvent,
    recoveredStatus,
    recoveredHostProjection,
  };
}

async function verifyRoleReconnectRecovery({
  page,
  game,
  principalUserId,
  actorSlot,
  postPrefix,
  navigate = false,
  channelId = "main",
}) {
  if (navigate) {
    await gotoPlayerBoard(page, game);
  }
  await page.waitForFunction(
    () => typeof window.__fmarchDropPlayerLiveProjection === "function",
  );
  await page.evaluate(() => window.__fmarchDropPlayerLiveProjection());
  await page.waitForFunction(
    () => window.__fmarchLiveProjectionStatus?.state === "reconnecting",
  );
  const reconnectingStatus = await page.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const reconnectPostBody = `${postPrefix} from dev:test-game ${crypto.randomUUID()}.`;
  const reconnectCommand = await sendCommand(principalUserId, {
    SubmitPost: {
      game,
      channel_id: channelId,
      actor_slot: actorSlot,
      body: reconnectPostBody,
    },
  });
  await page.waitForFunction(
    () =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) =>
          event?.kind === "reconnect" &&
          event.attempt === 1 &&
          event.state === "recovered",
      ),
  );
  const recoveredStatus = await page.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const reconnectRecoveryEvent = await page.evaluate(() =>
    (window.__fmarchLiveProjectionEvents ?? []).find(
      (event) =>
        event?.kind === "reconnect" &&
        event.attempt === 1 &&
        event.state === "recovered",
    ),
  );
  await page.waitForFunction(
    ({ expectedBody, expectedActorSlot }) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) =>
          post.body === expectedBody && post.authorSlot === expectedActorSlot,
      ),
    { expectedBody: reconnectPostBody, expectedActorSlot: actorSlot },
  );
  await page.getByText(reconnectPostBody, { exact: true }).waitFor({
    state: "visible",
  });
  const postVisibleStatus = await page.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const recoveredProjection = await page.evaluate(
    () => window.__fmarchPlayerProjection,
  );
  return {
    status: "passed",
    principalUserId,
    actorSlot,
    reconnectingStatus,
    reconnectCommand,
    reconnectRecoveryEvent,
    recoveredStatus,
    postVisibleStatus,
    recoveredPostBody: reconnectPostBody,
    recoveredSnapshotContainsPost: recoveredProjection?.thread?.posts?.some(
      (post) => post.body === reconnectPostBody && post.authorSlot === actorSlot,
    ),
    recoveredCommandState: recoveredProjection?.commandState ?? null,
  };
}

async function verifyStalePlayerVoteRecovery({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  normalizeServerCommandEnvelope,
}) {
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
  );
  const phaseBeforeClose = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandStateBeforeClose = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const voteControlBeforeClose = await playerCommandControlState(playerPage, "submit_vote");
  const withdrawBeforeClose = await playerCommandControlState(playerPage, "withdraw_vote");
  await playerPage.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
  );
  const closedStatus = await playerPage.evaluate(
    () => window.__fmarchClosePlayerLiveProjection(),
  );
  const lockCommandId = crypto.randomUUID();
  const lockRaw = await sendBrowserCommand(hostPage, {
    principalUserId: "host_h",
    command: { LockThread: { game } },
    commandId: lockCommandId,
  });
  const lock = normalizeServerCommandEnvelope({
    actionId: "lock_thread",
    commandId: lockCommandId,
    requestEnvelope: lockRaw.requestEnvelope,
    response: { status: lockRaw.httpStatus },
    serverEnvelope: lockRaw.serverEnvelope,
  });
  if (lock.state !== "ack") {
    throw new Error(`stale vote setup lock did not ack: ${JSON.stringify(lock)}`);
  }

  await playerPage.locator('[data-action="submit_vote"]').click();
  await playerPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  await playerPage.locator('[data-action="submit_vote"]').waitFor({ state: "detached" });
  const reject = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  if (!isStaleVotePhaseLockedMessage(reject.message)) {
    throw new Error(`stale player vote message drifted: ${JSON.stringify(reject)}`);
  }
  const phaseAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandStateAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const dispatchPlan = await playerPage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const voteControlAfterReject = await playerCommandControlState(playerPage, "submit_vote");
  const withdrawAfterReject = await playerCommandControlState(playerPage, "withdraw_vote");
  const currentVoteAfterReject = await playerPage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  if (
    commandStateBeforeClose?.voteTargets?.some((target) => target.kind === "slot") !==
      true ||
    commandStateBeforeClose?.currentVote !== null ||
    voteControlBeforeClose.exists !== true ||
    voteControlBeforeClose.disabled !== false ||
    withdrawBeforeClose.exists !== true ||
    withdrawBeforeClose.disabled !== true ||
    withdrawBeforeClose.reason !== "No current vote" ||
    commandStateAfterReject?.phase?.locked !== true ||
    commandStateAfterReject?.voteTargets?.length !== 0 ||
    commandStateAfterReject?.currentVote !== null ||
    dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
    voteControlAfterReject.exists !== false ||
    voteControlAfterReject.disabled !== true ||
    withdrawAfterReject.exists !== true ||
    withdrawAfterReject.disabled !== true ||
    withdrawAfterReject.reason !== "No current vote" ||
    currentVoteAfterReject.hasVote !== "false" ||
    !currentVoteAfterReject.text.includes("No current vote")
  ) {
    throw new Error(
      `stale player vote recovery state drifted: ${JSON.stringify({
        commandStateBeforeClose,
        voteControlBeforeClose,
        withdrawBeforeClose,
        commandStateAfterReject,
        dispatchPlan,
        voteControlAfterReject,
        withdrawAfterReject,
        currentVoteAfterReject,
      })}`,
    );
  }

  const unlockCommandId = crypto.randomUUID();
  const unlockRaw = await sendBrowserCommand(hostPage, {
    principalUserId: "host_h",
    command: { UnlockThread: { game } },
    commandId: unlockCommandId,
  });
  const unlock = normalizeServerCommandEnvelope({
    actionId: "unlock_thread",
    commandId: unlockCommandId,
    requestEnvelope: unlockRaw.requestEnvelope,
    response: { status: unlockRaw.httpStatus },
    serverEnvelope: unlockRaw.serverEnvelope,
  });
  if (unlock.state !== "ack") {
    throw new Error(`stale vote cleanup unlock did not ack: ${JSON.stringify(unlock)}`);
  }
  const hostStateAfterUnlock = await fetchHostConsoleState({ apiBaseUrl, game });
  if (hostStateAfterUnlock.phase?.locked !== false) {
    throw new Error(`stale vote cleanup left phase locked: ${JSON.stringify(hostStateAfterUnlock.phase)}`);
  }

  return {
    status: "passed",
    phaseBeforeClose,
    commandStateBeforeClose,
    voteControlBeforeClose,
    withdrawBeforeClose,
    closedStatus,
    lock,
    reject,
    phaseAfterReject,
    commandStateAfterReject,
    dispatchPlan,
    voteControlAfterReject,
    withdrawAfterReject,
    currentVoteAfterReject,
    unlock,
    hostPhaseAfterUnlock: hostStateAfterUnlock.phase,
  };
}

async function verifyStalePlayerVoteAfterVotecountChange({
  playerPage,
  actionPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const stalePlayerPage = await playerPage.context().newPage();
  try {
    await gotoPlayerBoard(stalePlayerPage, game);
    await gotoPlayerBoard(actionPage, game);
    await Promise.all([
      stalePlayerPage.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
          window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          window.__fmarchPlayerProjection?.commandState?.currentVote === null,
      ),
      actionPage.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
          window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      ),
    ]);
    const commandStateBeforeClose = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const actionCommandStateBeforeChange = await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const staleVoteTarget = commandStateBeforeClose?.voteTargets?.find(
      (candidate) =>
        candidate.kind === "slot" &&
        candidate.slotId !== "slot_4" &&
        actionCommandStateBeforeChange?.voteTargets?.some(
          (actionCandidate) =>
            actionCandidate.kind === "slot" &&
            actionCandidate.slotId === candidate.slotId,
        ),
    );
    const staleVoteButton = staleVoteTarget
      ? (await playerCommandButtons(stalePlayerPage)).find(
          (button) =>
            button.action?.startsWith("submit_vote") &&
            button.text?.includes(staleVoteTarget.label) &&
            button.disabled === false,
        )
      : undefined;
    const closedStatus = await stalePlayerPage.evaluate(
      () => window.__fmarchClosePlayerLiveProjection?.(),
    );
    const actionVoteCommandId = crypto.randomUUID();
    const actionVoteRaw = await sendBrowserCommand(actionPage, {
      principalUserId: "player-goon-a",
      command: {
        SubmitVote: {
          game,
          actor_slot: "slot_4",
          target: "NoLynch",
        },
      },
      commandId: actionVoteCommandId,
    });
    const actionVote = normalizeCommandResponse({
      commandId: actionVoteCommandId,
      requestEnvelope: actionVoteRaw.requestEnvelope,
      response: { status: actionVoteRaw.httpStatus },
      serverEnvelope: actionVoteRaw.serverEnvelope,
    });
    await actionPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "no_lynch" &&
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === "no_lynch" && row.count === 1,
        ),
    );
    const apiVotecountAfterActionVote = await fetchJson(
      `${apiBaseUrl}/games/${game}/votecount`,
    );
    if (
      staleVoteTarget?.slotId === undefined ||
      staleVoteButton === undefined ||
      commandStateBeforeClose?.currentVote !== null ||
      closedStatus?.state !== "closed" ||
      actionVote.state !== "ack" ||
      !normalizedVotecountRows(apiVotecountAfterActionVote).some(
        (row) => row.phaseId === "D02" && row.target === "no_lynch" && row.count === 1,
      )
    ) {
      throw new Error(
        `stale player vote-after-change setup drifted: ${JSON.stringify({
          commandStateBeforeClose,
          actionCommandStateBeforeChange,
          staleVoteTarget,
          staleVoteButton,
          closedStatus,
          actionVote,
          apiVotecountAfterActionVote,
        })}`,
      );
    }

    await stalePlayerPage
      .locator(`[data-action="${staleVoteButton.action}"]`, {
        hasText: staleVoteTarget.label,
      })
      .first()
      .click();
    await stalePlayerPage.waitForFunction(
      (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target?.Slot === targetSlot &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          targetSlot &&
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === "no_lynch" && row.count === 1,
        ) &&
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === targetSlot && row.count === 1,
        ),
      staleVoteTarget.slotId,
    );
    const staleVote = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterAck = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const votecountAfterAck = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );
    const dispatchPlan = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentVoteAfterAck = await stalePlayerPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const apiVotecountAfterAck = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
    const apiCommandStateAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const withdrawPlayerCommandId = crypto.randomUUID();
    const withdrawPlayerRaw = await sendBrowserCommand(playerPage, {
      principalUserId: "player-mira",
      command: {
        WithdrawVote: {
          game,
          actor_slot: "slot-7",
        },
      },
      commandId: withdrawPlayerCommandId,
    });
    const withdrawPlayer = normalizeCommandResponse({
      commandId: withdrawPlayerCommandId,
      requestEnvelope: withdrawPlayerRaw.requestEnvelope,
      response: { status: withdrawPlayerRaw.httpStatus },
      serverEnvelope: withdrawPlayerRaw.serverEnvelope,
    });
    const withdrawActionCommandId = crypto.randomUUID();
    const withdrawActionRaw = await sendBrowserCommand(actionPage, {
      principalUserId: "player-goon-a",
      command: {
        WithdrawVote: {
          game,
          actor_slot: "slot_4",
        },
      },
      commandId: withdrawActionCommandId,
    });
    const withdrawAction = normalizeCommandResponse({
      commandId: withdrawActionCommandId,
      requestEnvelope: withdrawActionRaw.requestEnvelope,
      response: { status: withdrawActionRaw.httpStatus },
      serverEnvelope: withdrawActionRaw.serverEnvelope,
    });
    const apiVotecountAfterCleanup = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
    const apiCommandStateAfterCleanup = await fetchJson(
      `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    if (
      staleVote?.state !== "ack" ||
      staleVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
        staleVoteTarget.slotId ||
      commandStateAfterAck?.currentVote?.slotId !== staleVoteTarget.slotId ||
      !votecountAfterAck.some((row) => row.target === "no_lynch" && row.count === 1) ||
      !votecountAfterAck.some(
        (row) => row.target === staleVoteTarget.slotId && row.count === 1,
      ) ||
      dispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      currentVoteAfterAck.hasVote !== "true" ||
      !currentVoteAfterAck.text.includes(staleVoteTarget.label) ||
      !normalizedVotecountRows(apiVotecountAfterAck).some(
        (row) =>
          row.phaseId === "D02" && row.target === "no_lynch" && row.count === 1,
      ) ||
      !normalizedVotecountRows(apiVotecountAfterAck).some(
        (row) =>
          row.phaseId === "D02" &&
          row.target === staleVoteTarget.slotId &&
          row.count === 1,
      ) ||
      apiCommandStateAfterAck?.current_vote?.slot_id !== staleVoteTarget.slotId ||
      withdrawPlayer.state !== "ack" ||
      withdrawAction.state !== "ack" ||
      normalizedVotecountRows(apiVotecountAfterCleanup).length !== 0 ||
      apiCommandStateAfterCleanup?.current_vote !== null
    ) {
      throw new Error(
        `stale player vote-after-change recovery drifted: ${JSON.stringify({
          staleVoteTarget,
          staleVote,
          commandStateAfterAck,
          votecountAfterAck,
          dispatchPlan,
          currentVoteAfterAck,
          apiVotecountAfterAck,
          apiCommandStateAfterAck,
          withdrawPlayer,
          withdrawAction,
          apiVotecountAfterCleanup,
          apiCommandStateAfterCleanup,
        })}`,
      );
    }
    return {
      status: "passed",
      commandStateBeforeClose,
      actionCommandStateBeforeChange,
      staleVoteTarget,
      staleVoteButton,
      closedStatus,
      actionVote,
      apiVotecountAfterActionVote,
      staleVote,
      commandStateAfterAck,
      votecountAfterAck,
      dispatchPlan,
      currentVoteAfterAck,
      apiVotecountAfterAck,
      apiCommandStateAfterAck,
      withdrawPlayer,
      withdrawAction,
      apiVotecountAfterCleanup,
      apiCommandStateAfterCleanup,
      proof:
        "A seeded player role URL froze with a legal D02 vote control, the action-player role URL changed the live votecount to no_lynch, then the stale player click ACKed through /commands and refreshed commandState/current vote plus votecount to the combined server projection before both ballots were withdrawn for later lanes.",
    };
  } finally {
    await stalePlayerPage.close().catch(() => {});
  }
}

async function verifyStalePlayerWithdrawAfterVoteChange({
  playerPage,
  game,
  apiBaseUrl,
  normalizeCommandResponse,
}) {
  const stalePlayerPage = await playerPage.context().newPage();
  try {
    await gotoPlayerBoard(stalePlayerPage, game);
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null,
    );
    const commandStateBeforeVote = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const staleVoteTarget = commandStateBeforeVote?.voteTargets?.find(
      (candidate) => candidate.kind === "slot",
    );
    const staleVoteButton = staleVoteTarget
      ? (await playerCommandButtons(stalePlayerPage)).find(
          (button) =>
            button.action?.startsWith("submit_vote") &&
            button.text?.includes(staleVoteTarget.label) &&
            button.disabled === false,
        )
      : undefined;
    if (staleVoteTarget?.slotId === undefined || staleVoteButton === undefined) {
      throw new Error(
        `stale player withdraw setup found no legal vote target: ${JSON.stringify({
          commandStateBeforeVote,
          staleVoteButton,
        })}`,
      );
    }

    await stalePlayerPage
      .locator(`[data-action="${staleVoteButton.action}"]`, {
        hasText: staleVoteTarget.label,
      })
      .first()
      .click();
    await stalePlayerPage.waitForFunction(
      (targetSlot) =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind ===
          "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          targetSlot &&
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target === targetSlot && row.count === 1,
        ),
      staleVoteTarget.slotId,
    );
    const initialVote = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateBeforeClose = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const currentVoteBeforeClose = await stalePlayerPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawBeforeClose = await playerCommandControlState(
      stalePlayerPage,
      "withdraw_vote",
    );
    const closedStatus = await stalePlayerPage.evaluate(
      () => window.__fmarchClosePlayerLiveProjection?.(),
    );
    const liveChangeCommandId = crypto.randomUUID();
    const liveChangeRaw = await sendBrowserCommand(playerPage, {
      principalUserId: "player-mira",
      command: {
        SubmitVote: {
          game,
          actor_slot: "slot-7",
          target: "NoLynch",
        },
      },
      commandId: liveChangeCommandId,
    });
    const liveChangeVote = normalizeCommandResponse({
      commandId: liveChangeCommandId,
      requestEnvelope: liveChangeRaw.requestEnvelope,
      response: { status: liveChangeRaw.httpStatus },
      serverEnvelope: liveChangeRaw.serverEnvelope,
    });
    const apiCommandStateAfterLiveChange = await fetchJson(
      `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiVotecountAfterLiveChange = await fetchJson(
      `${apiBaseUrl}/games/${game}/votecount`,
    );
    if (
      initialVote?.state !== "ack" ||
      commandStateBeforeClose?.currentVote?.slotId !== staleVoteTarget.slotId ||
      currentVoteBeforeClose.hasVote !== "true" ||
      !currentVoteBeforeClose.text.includes(staleVoteTarget.label) ||
      withdrawBeforeClose.exists !== true ||
      withdrawBeforeClose.disabled !== false ||
      closedStatus?.state !== "closed" ||
      liveChangeVote.state !== "ack" ||
      apiCommandStateAfterLiveChange?.current_vote?.kind !== "no_lynch" ||
      !normalizedVotecountRows(apiVotecountAfterLiveChange).some(
        (row) => row.phaseId === "D02" && row.target === "no_lynch" && row.count === 1,
      ) ||
      normalizedVotecountRows(apiVotecountAfterLiveChange).some(
        (row) => row.phaseId === "D02" && row.target === staleVoteTarget.slotId,
      )
    ) {
      throw new Error(
        `stale player withdraw-after-change setup drifted: ${JSON.stringify({
          staleVoteTarget,
          initialVote,
          commandStateBeforeClose,
          currentVoteBeforeClose,
          withdrawBeforeClose,
          closedStatus,
          liveChangeVote,
          apiCommandStateAfterLiveChange,
          apiVotecountAfterLiveChange,
        })}`,
      );
    }

    await stalePlayerPage.locator('[data-action="withdraw_vote"]').click();
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.WithdrawVote !== undefined &&
        ["ack", "reject"].includes(window.__fmarchPlayerCommandStatus?.state),
    );
    await stalePlayerPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null,
    );
    const staleWithdraw = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterWithdraw = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const votecountAfterWithdraw = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.votecount ?? [],
    );
    const dispatchPlan = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentVoteAfterWithdraw = await stalePlayerPage
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawAfterAck = await playerCommandControlState(
      stalePlayerPage,
      "withdraw_vote",
    );
    const apiCommandStateAfterWithdraw = await fetchJson(
      `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiVotecountAfterWithdraw = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
    if (
      staleWithdraw?.state !== "ack" ||
      staleWithdraw?.requestEnvelope?.body?.body?.command?.WithdrawVote?.actor_slot !==
        "slot-7" ||
      commandStateAfterWithdraw?.currentVote !== null ||
      votecountAfterWithdraw.length !== 0 ||
      dispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      currentVoteAfterWithdraw.hasVote !== "false" ||
      !currentVoteAfterWithdraw.text.includes("No current vote") ||
      withdrawAfterAck.exists !== true ||
      withdrawAfterAck.disabled !== true ||
      withdrawAfterAck.reason !== "No current vote" ||
      apiCommandStateAfterWithdraw?.current_vote !== null ||
      normalizedVotecountRows(apiVotecountAfterWithdraw).length !== 0
    ) {
      throw new Error(
        `stale player withdraw-after-change recovery drifted: ${JSON.stringify({
          staleVoteTarget,
          staleWithdraw,
          commandStateAfterWithdraw,
          votecountAfterWithdraw,
          dispatchPlan,
          currentVoteAfterWithdraw,
          withdrawAfterAck,
          apiCommandStateAfterWithdraw,
          apiVotecountAfterWithdraw,
        })}`,
      );
    }
    return {
      status: "passed",
      commandStateBeforeVote,
      staleVoteTarget,
      staleVoteButton,
      initialVote,
      commandStateBeforeClose,
      currentVoteBeforeClose,
      withdrawBeforeClose,
      closedStatus,
      liveChangeVote,
      apiCommandStateAfterLiveChange,
      apiVotecountAfterLiveChange,
      staleWithdraw,
      commandStateAfterWithdraw,
      votecountAfterWithdraw,
      dispatchPlan,
      currentVoteAfterWithdraw,
      withdrawAfterAck,
      apiCommandStateAfterWithdraw,
      apiVotecountAfterWithdraw,
      proof:
        "A seeded player role URL froze with an enabled Withdraw vote control for a slot vote, the same slot's live ballot changed to no_lynch through /commands, then stale WithdrawVote ACKed against the current server ballot and refreshed currentVote plus votecount to empty without preserving the stale slot vote display.",
    };
  } finally {
    await stalePlayerPage.close().catch(() => {});
  }
}

async function openResolvedDayStalePlayerProof({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  tokenLabel,
  playerPathForGame,
  slotSevenRoleKey = "vanilla_townie",
  slotFourRoleKey = "vanilla_townie",
}) {
  if (browser === null || browser === undefined) {
    throw new Error("stale player phase-closure proof requires a Playwright browser");
  }
  const phaseClosureGame = crypto.randomUUID();
  const seed = await seedDayVoteResolutionGame({
    game: phaseClosureGame,
    slotSevenRoleKey,
    slotFourRoleKey,
  });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${phaseClosureGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const playerSession = await createAccountLoginCredential({
    principalUserId: "player-mira",
    returnTo: `/g/${phaseClosureGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: phaseClosureGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: playerSession,
    game: phaseClosureGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    const playerPath =
      typeof playerPathForGame === "function"
        ? playerPathForGame(phaseClosureGame)
        : null;
    if (playerPath === null) {
      await gotoPlayerBoard(playerEntry.page, phaseClosureGame);
    } else {
      const playerPathResponse = await playerEntry.page.goto(
        `${frontendBaseUrl}${playerPath}`,
        {
          waitUntil: "networkidle",
        },
      );
      if (playerPathResponse === null || !playerPathResponse.ok()) {
        throw new Error(
          `stale player role path failed with ${
            playerPathResponse?.status() ?? "no response"
          }: ${playerPath}`,
        );
      }
      await playerEntry.page.getByTestId("player-surface").waitFor({
        state: "visible",
      });
    }
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          "slot-2",
    );
    const commandStateBeforeClose = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const currentVoteBeforeClose = await playerEntry.page
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawBeforeClose = await playerCommandControlState(
      playerEntry.page,
      "withdraw_vote",
    );
    const buttonsBeforeClose = await playerCommandButtons(playerEntry.page);
    const closedStatus = await playerEntry.page.evaluate(
      () => window.__fmarchClosePlayerLiveProjection?.(),
    );

    await hostEntry.page.goto(`${frontendBaseUrl}/g/${phaseClosureGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "D01" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "slot-2" && row.count === 3,
        ),
    );
    const hostBeforeResolve = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      votecount: await hostEntry.page.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
      phaseActions: await visibleHostPhaseActions(hostEntry.page),
    };
    const resolveDay = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "D01", locked: true });
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ),
    );
    const hostAfterResolve = {
      phase: await hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      dayVoteOutcomes: await hostEntry.page.evaluate(
        () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
      ),
      outcomePanel: await hostEntry.page
        .locator('[data-testid="host-day-vote-outcome-latest"]')
        .innerText(),
    };
    const apiCommandStateAfterResolve = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiDayVoteOutcomesAfterResolve = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/day-vote-outcomes`,
    );

    if (
      commandStateBeforeClose?.currentVote?.slotId !== "slot-2" ||
      currentVoteBeforeClose.hasVote !== "true" ||
      !currentVoteBeforeClose.text.includes("Slot 2") ||
      closedStatus?.state !== "closed" ||
      resolveDay.commandStatus?.state !== "ack" ||
      hostAfterResolve.phase?.locked !== true ||
      !hostAfterResolve.dayVoteOutcomes.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      apiCommandStateAfterResolve?.phase?.locked !== true ||
      apiCommandStateAfterResolve?.current_vote !== null ||
      apiCommandStateAfterResolve?.vote_targets?.length !== 0 ||
      !normalizeDayVoteOutcomeRows(apiDayVoteOutcomesAfterResolve).some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      )
    ) {
      throw new Error(
        `stale player phase-closure setup drifted: ${JSON.stringify({
          phaseClosureGame,
          seed,
          commandStateBeforeClose,
          currentVoteBeforeClose,
          withdrawBeforeClose,
          buttonsBeforeClose,
          closedStatus,
          hostBeforeResolve,
          resolveDay,
          hostAfterResolve,
          apiCommandStateAfterResolve,
          apiDayVoteOutcomesAfterResolve,
        })}`,
      );
    }

    return {
      phaseClosureGame,
      seed,
      hostSession,
      playerSession,
      hostEntry,
      playerEntry,
      commandStateBeforeClose,
      currentVoteBeforeClose,
      withdrawBeforeClose,
      buttonsBeforeClose,
      closedStatus,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      apiCommandStateAfterResolve,
      apiDayVoteOutcomesAfterResolve,
    };
  } catch (error) {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
    throw error;
  }
}

async function verifyStalePlayerWithdrawAfterPhaseClosure({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const setup = await openResolvedDayStalePlayerProof({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
    tokenLabel: "stale-withdraw",
  });
  const {
    phaseClosureGame,
    seed,
    hostSession,
    playerSession,
    hostEntry,
    playerEntry,
    commandStateBeforeClose,
    currentVoteBeforeClose,
    withdrawBeforeClose,
    buttonsBeforeClose,
    closedStatus,
    hostBeforeResolve,
    resolveDay,
    hostAfterResolve,
    apiCommandStateAfterResolve,
    apiDayVoteOutcomesAfterResolve,
  } = setup;
  try {
    if (
      withdrawBeforeClose.exists !== true ||
      withdrawBeforeClose.disabled !== false ||
      !buttonsBeforeClose.some(
        (button) => button.action === "withdraw_vote" && button.disabled === false,
      )
    ) {
      throw new Error(
        `stale withdraw phase-closure setup drifted: ${JSON.stringify({
          phaseClosureGame,
          seed,
          commandStateBeforeClose,
          currentVoteBeforeClose,
          withdrawBeforeClose,
          buttonsBeforeClose,
          closedStatus,
          hostBeforeResolve,
          resolveDay,
          hostAfterResolve,
          apiCommandStateAfterResolve,
          apiDayVoteOutcomesAfterResolve,
        })}`,
      );
    }

    await playerEntry.page.locator('[data-action="withdraw_vote"]').click();
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.WithdrawVote !== undefined &&
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
    );
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0,
    );
    const staleWithdraw = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterReject = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const dispatchPlan = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentVoteAfterReject = await playerEntry.page
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawAfterReject = await playerCommandControlState(
      playerEntry.page,
      "withdraw_vote",
    );
    const buttonsAfterReject = await playerCommandButtons(playerEntry.page);
    const dayVoteOutcomesAfterReject = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiVotecountAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/votecount`,
    );
    if (
      staleWithdraw?.state !== "reject" ||
      staleWithdraw?.error !== "PhaseLocked" ||
      staleWithdraw?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(staleWithdraw?.streamSeqs) ||
      staleWithdraw?.requestEnvelope?.body?.body?.command?.WithdrawVote?.actor_slot !==
        "slot-7" ||
      dispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      commandStateAfterReject?.phase?.phaseId !== "D01" ||
      commandStateAfterReject?.phase?.locked !== true ||
      commandStateAfterReject?.currentVote !== null ||
      commandStateAfterReject?.voteTargets?.length !== 0 ||
      currentVoteAfterReject.hasVote !== "false" ||
      !currentVoteAfterReject.text.includes("No current vote") ||
      withdrawAfterReject.exists !== true ||
      withdrawAfterReject.disabled !== true ||
      withdrawAfterReject.reason !== "No current vote" ||
      buttonsAfterReject.some((button) => button.action?.startsWith("submit_vote")) ||
      !buttonsAfterReject.some(
        (button) => button.action === "submit_post" && button.disabled === false,
      ) ||
      !dayVoteOutcomesAfterReject.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      apiCommandStateAfterReject?.phase?.locked !== true ||
      apiCommandStateAfterReject?.vote_targets?.length !== 0 ||
      apiCommandStateAfterReject?.current_vote !== null ||
      normalizedVotecountRows(apiVotecountAfterReject).some(
        (row) => row.phaseId === "D01" && row.target === "slot-2" && row.count !== 3,
      )
    ) {
      throw new Error(
        `stale withdraw phase-closure recovery drifted: ${JSON.stringify({
          phaseClosureGame,
          staleWithdraw,
          commandStateAfterReject,
          dispatchPlan,
          currentVoteAfterReject,
          withdrawAfterReject,
          buttonsAfterReject,
          dayVoteOutcomesAfterReject,
          apiCommandStateAfterReject,
          apiVotecountAfterReject,
        })}`,
      );
    }

    return {
      status: "passed",
      game: phaseClosureGame,
      seed,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      commandStateBeforeClose,
      currentVoteBeforeClose,
      withdrawBeforeClose,
      buttonsBeforeClose,
      closedStatus,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      apiCommandStateAfterResolve,
      apiDayVoteOutcomesAfterResolve,
      staleWithdraw,
      commandStateAfterReject,
      dispatchPlan,
      currentVoteAfterReject,
      withdrawAfterReject,
      buttonsAfterReject,
      dayVoteOutcomesAfterReject,
      apiCommandStateAfterReject,
      apiVotecountAfterReject,
      proof:
        "A disposable player role URL froze with an enabled Withdraw vote control for an existing D01 ballot, a disposable host role URL resolved that day and locked the phase, then the stale player WithdrawVote rejected as PhaseLocked and refreshed commandState, day-vote outcome truth, cleared the obsolete current vote, and disabled stale vote controls.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyStalePlayerVoteAfterPhaseClosure({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const setup = await openResolvedDayStalePlayerProof({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
    tokenLabel: "stale-vote",
  });
  const {
    phaseClosureGame,
    seed,
    hostSession,
    playerSession,
    hostEntry,
    playerEntry,
    commandStateBeforeClose,
    currentVoteBeforeClose,
    buttonsBeforeClose,
    closedStatus,
    hostBeforeResolve,
    resolveDay,
    hostAfterResolve,
    apiCommandStateAfterResolve,
    apiDayVoteOutcomesAfterResolve,
  } = setup;
  try {
    const staleVoteTarget =
      commandStateBeforeClose?.voteTargets?.find(
        (candidate) =>
          candidate.kind === "slot" && candidate.slotId !== "slot-2",
      ) ??
      commandStateBeforeClose?.voteTargets?.find(
        (candidate) => candidate.kind === "no_lynch",
      );
    const staleVoteButton = staleVoteTarget
      ? buttonsBeforeClose.find(
          (button) =>
            button.action?.startsWith("submit_vote") &&
            button.text?.includes(staleVoteTarget.label) &&
            button.disabled === false,
        )
      : undefined;

    if (
      staleVoteTarget === undefined ||
      staleVoteButton === undefined ||
      !buttonsBeforeClose.some(
        (button) =>
          button.action === staleVoteButton.action &&
          button.disabled === false &&
          button.text?.includes(staleVoteTarget.label),
      )
    ) {
      throw new Error(
        `stale vote phase-closure setup drifted: ${JSON.stringify({
          phaseClosureGame,
          seed,
          commandStateBeforeClose,
          staleVoteTarget,
          staleVoteButton,
          currentVoteBeforeClose,
          buttonsBeforeClose,
          closedStatus,
          hostBeforeResolve,
          resolveDay,
          hostAfterResolve,
          apiCommandStateAfterResolve,
          apiDayVoteOutcomesAfterResolve,
        })}`,
      );
    }

    await playerEntry.page
      .locator(`[data-action="${staleVoteButton.action}"]`, {
        hasText: staleVoteTarget.label,
      })
      .first()
      .click();
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote !== undefined &&
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
    );
    await playerEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ),
    );
    const staleVote = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterReject = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const dispatchPlan = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentVoteAfterReject = await playerEntry.page
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawAfterReject = await playerCommandControlState(
      playerEntry.page,
      "withdraw_vote",
    );
    const buttonsAfterReject = await playerCommandButtons(playerEntry.page);
    const dayVoteOutcomesAfterReject = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiVotecountAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/votecount`,
    );
    if (
      staleVote?.state !== "reject" ||
      staleVote?.error !== "PhaseLocked" ||
      staleVote?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(staleVote?.streamSeqs) ||
      staleVote?.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !==
        "slot-7" ||
      dispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      commandStateAfterReject?.phase?.phaseId !== "D01" ||
      commandStateAfterReject?.phase?.locked !== true ||
      commandStateAfterReject?.currentVote !== null ||
      commandStateAfterReject?.voteTargets?.length !== 0 ||
      currentVoteAfterReject.hasVote !== "false" ||
      !currentVoteAfterReject.text.includes("No current vote") ||
      withdrawAfterReject.exists !== true ||
      withdrawAfterReject.disabled !== true ||
      withdrawAfterReject.reason !== "No current vote" ||
      buttonsAfterReject.some((button) => button.action?.startsWith("submit_vote")) ||
      !buttonsAfterReject.some(
        (button) => button.action === "submit_post" && button.disabled === false,
      ) ||
      !dayVoteOutcomesAfterReject.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      apiCommandStateAfterReject?.phase?.locked !== true ||
      apiCommandStateAfterReject?.vote_targets?.length !== 0 ||
      apiCommandStateAfterReject?.current_vote !== null ||
      normalizedVotecountRows(apiVotecountAfterReject).some(
        (row) => row.phaseId === "D01" && row.target === "slot-2" && row.count !== 3,
      )
    ) {
      throw new Error(
        `stale vote phase-closure recovery drifted: ${JSON.stringify({
          phaseClosureGame,
          staleVoteTarget,
          staleVote,
          commandStateAfterReject,
          dispatchPlan,
          currentVoteAfterReject,
          withdrawAfterReject,
          buttonsAfterReject,
          dayVoteOutcomesAfterReject,
          apiCommandStateAfterReject,
          apiVotecountAfterReject,
        })}`,
      );
    }

    return {
      status: "passed",
      game: phaseClosureGame,
      seed,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      commandStateBeforeClose,
      staleVoteTarget,
      staleVoteButton,
      currentVoteBeforeClose,
      buttonsBeforeClose,
      closedStatus,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      apiCommandStateAfterResolve,
      apiDayVoteOutcomesAfterResolve,
      staleVote,
      commandStateAfterReject,
      dispatchPlan,
      currentVoteAfterReject,
      withdrawAfterReject,
      buttonsAfterReject,
      dayVoteOutcomesAfterReject,
      apiCommandStateAfterReject,
      apiVotecountAfterReject,
      proof:
        "A disposable player role URL froze with legal D01 vote controls, a disposable host role URL resolved that day and locked the phase, then the stale player SubmitVote rejected as PhaseLocked and refreshed commandState, day-vote outcome truth, cleared current vote, and removed stale vote controls.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyStalePlayerPostAfterPhaseClosure({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const setup = await openResolvedDayStalePlayerProof({
    browser,
    apiBaseUrl,
    frontendBaseUrl,
    tokenLabel: "stale-post",
  });
  const {
    phaseClosureGame,
    seed,
    hostSession,
    playerSession,
    hostEntry,
    playerEntry,
    commandStateBeforeClose,
    currentVoteBeforeClose,
    buttonsBeforeClose,
    closedStatus,
    hostBeforeResolve,
    resolveDay,
    hostAfterResolve,
    apiCommandStateAfterResolve,
    apiDayVoteOutcomesAfterResolve,
  } = setup;
  try {
    const submitPostBeforeClose = buttonsBeforeClose.find(
      (button) => button.action === "submit_post",
    );
    const postBody = `Stale player post after D01 phase closure ${crypto.randomUUID()}.`;

    if (submitPostBeforeClose?.disabled !== false) {
      throw new Error(
        `stale post phase-closure setup drifted: ${JSON.stringify({
          phaseClosureGame,
          seed,
          commandStateBeforeClose,
          currentVoteBeforeClose,
          submitPostBeforeClose,
          buttonsBeforeClose,
          closedStatus,
          hostBeforeResolve,
          resolveDay,
          hostAfterResolve,
          apiCommandStateAfterResolve,
          apiDayVoteOutcomesAfterResolve,
        })}`,
      );
    }

    await playerEntry.page.locator("textarea").fill(postBody);
    await playerEntry.page.locator('[data-action="submit_post"]').click();
    await playerEntry.page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitPost?.body === expectedBody &&
        window.__fmarchPlayerCommandStatus?.state === "ack",
      postBody,
    );
    await playerEntry.page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === expectedBody && post.authorSlot === "slot-7",
        ) &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        window.__fmarchPlayerProjection?.commandState?.currentVote === null &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "Lynch" &&
            row.winnerSlot === "slot-2",
        ),
      postBody,
    );
    const stalePost = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const projectedPost = await playerEntry.page.evaluate((expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.find(
        (post) => post.body === expectedBody,
      ),
    postBody);
    const commandStateAfterAck = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const dispatchPlan = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentVoteAfterAck = await playerEntry.page
      .getByTestId("player-current-vote")
      .evaluate((node) => ({
        hasVote: node.getAttribute("data-has-vote"),
        text: node.textContent?.trim() ?? "",
      }));
    const withdrawAfterAck = await playerCommandControlState(
      playerEntry.page,
      "withdraw_vote",
    );
    const buttonsAfterAck = await playerCommandButtons(playerEntry.page);
    const dayVoteOutcomesAfterAck = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const apiCommandStateAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
    const apiThreadAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/channels/main/thread?principal_user_id=player-mira&limit=100`,
    );
    const apiVotecountAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${phaseClosureGame}/votecount`,
    );
    if (
      stalePost?.state !== "ack" ||
      stalePost?.serverEnvelope?.body?.kind !== "Ack" ||
      !Array.isArray(stalePost?.streamSeqs) ||
      stalePost.streamSeqs.length === 0 ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
        "slot-7" ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
        "main" ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.body !== postBody ||
      dispatchPlan?.projectionRefreshKeys?.includes("thread") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("votecount") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("dayVoteOutcomes") !== true ||
      projectedPost?.authorSlot !== "slot-7" ||
      commandStateAfterAck?.phase?.phaseId !== "D01" ||
      commandStateAfterAck?.phase?.locked !== true ||
      commandStateAfterAck?.currentVote !== null ||
      commandStateAfterAck?.voteTargets?.length !== 0 ||
      currentVoteAfterAck.hasVote !== "false" ||
      !currentVoteAfterAck.text.includes("No current vote") ||
      withdrawAfterAck.exists !== true ||
      withdrawAfterAck.disabled !== true ||
      withdrawAfterAck.reason !== "No current vote" ||
      buttonsAfterAck.some((button) => button.action?.startsWith("submit_vote")) ||
      !buttonsAfterAck.some(
        (button) => button.action === "submit_post" && button.disabled === false,
      ) ||
      !dayVoteOutcomesAfterAck.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      apiCommandStateAfterAck?.phase?.locked !== true ||
      apiCommandStateAfterAck?.vote_targets?.length !== 0 ||
      apiCommandStateAfterAck?.current_vote !== null ||
      !apiThreadAfterAck.posts?.some(
        (post) => post.body === postBody && post.author_slot === "slot-7",
      ) ||
      normalizedVotecountRows(apiVotecountAfterAck).some(
        (row) => row.phaseId === "D01" && row.target === "slot-2" && row.count !== 3,
      )
    ) {
      throw new Error(
        `stale post phase-closure recovery drifted: ${JSON.stringify({
          phaseClosureGame,
          postBody,
          stalePost,
          projectedPost,
          commandStateAfterAck,
          dispatchPlan,
          currentVoteAfterAck,
          withdrawAfterAck,
          buttonsAfterAck,
          dayVoteOutcomesAfterAck,
          apiCommandStateAfterAck,
          apiThreadAfterAck,
          apiVotecountAfterAck,
        })}`,
      );
    }

    return {
      status: "passed",
      game: phaseClosureGame,
      seed,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      commandStateBeforeClose,
      currentVoteBeforeClose,
      submitPostBeforeClose,
      buttonsBeforeClose,
      closedStatus,
      hostBeforeResolve,
      resolveDay,
      hostAfterResolve,
      apiCommandStateAfterResolve,
      apiDayVoteOutcomesAfterResolve,
      postBody,
      stalePost,
      projectedPost,
      commandStateAfterAck,
      dispatchPlan,
      currentVoteAfterAck,
      withdrawAfterAck,
      buttonsAfterAck,
      dayVoteOutcomesAfterAck,
      apiCommandStateAfterAck,
      apiThreadAfterAck,
      apiVotecountAfterAck,
      proof:
        "A disposable player role URL froze with an enabled SubmitPost control, a disposable host role URL resolved D01 and locked the phase, then the stale player SubmitPost ACKed while refreshing thread, locked commandState, day-vote outcome truth, cleared current vote, and removed stale vote controls.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyConcurrentPlayerVoteResolveRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  if (browser === null || browser === undefined) {
    throw new Error("concurrent player vote/resolve proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const seed = await seedDayVoteResolutionGame({ game: raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const playerSession = await createAccountLoginCredential({
    principalUserId: "player-goon-a",
    returnTo: `/g/${raceGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: playerSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    const [playerInitialResponse, hostInitialResponse] = await Promise.all([
      playerEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}`, {
        waitUntil: "networkidle",
      }),
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (
      playerInitialResponse === null ||
      !playerInitialResponse.ok() ||
      hostInitialResponse === null ||
      !hostInitialResponse.ok()
    ) {
      throw new Error(
        `concurrent player vote/resolve initial load failed: ${JSON.stringify({
          playerStatus: playerInitialResponse?.status() ?? null,
          hostStatus: hostInitialResponse?.status() ?? null,
        })}`,
      );
    }
    await playerEntry.page.getByTestId("player-surface").waitFor({ state: "visible" });
    await Promise.all([
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          window.__fmarchPlayerProjection?.commandState?.voteTargets?.some(
            (target) => target.kind === "slot" && target.slotId === "slot-2",
          ),
      ),
      hostEntry.page.waitForFunction(
        () =>
          window.__fmarchHostProjection?.phase?.id === "D01" &&
          window.__fmarchHostProjection?.phase?.locked === false,
      ),
    ]);
    const setupCommandState = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(playerEntry.page);
    const setupVoteButton = setupButtons.find(
      (button) =>
        button.action?.startsWith("submit_vote") &&
        button.text?.includes("Slot 2") &&
        button.disabled === false,
    );
    const setupHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupHostPhaseActions = await visibleHostPhaseActions(hostEntry.page);
    const voteCommandId = crypto.randomUUID();
    const resolveCommandId = crypto.randomUUID();
    const [voteRaw, resolveRaw] = await Promise.all([
      sendBrowserCommand(playerEntry.page, {
        principalUserId: "player-goon-a",
        command: {
          SubmitVote: {
            game: raceGame,
            actor_slot: "slot_4",
            target: { Slot: "slot-2" },
          },
        },
        commandId: voteCommandId,
      }),
      sendBrowserCommand(hostEntry.page, {
        principalUserId: "host_h",
        command: { ResolvePhase: { game: raceGame, seed: 71_004 } },
        commandId: resolveCommandId,
      }),
    ]);
    const vote = normalizeCommandResponse({
      commandId: voteCommandId,
      requestEnvelope: voteRaw.requestEnvelope,
      response: { status: voteRaw.httpStatus },
      serverEnvelope: voteRaw.serverEnvelope,
    });
    const resolve = normalizeCommandResponse({
      commandId: resolveCommandId,
      requestEnvelope: resolveRaw.requestEnvelope,
      response: { status: resolveRaw.httpStatus },
      serverEnvelope: resolveRaw.serverEnvelope,
    });
    const voteAcked = vote?.state === "ack";
    const voteRejectedPhaseLocked =
      vote?.state === "reject" && vote?.error === "PhaseLocked";
    const voteSeq = voteAcked ? vote.streamSeqs?.[0] : null;
    const resolveSeq = resolve?.streamSeqs?.[0] ?? null;
    const acceptedSerialOrder =
      voteAcked === true && Number.isInteger(voteSeq) && voteSeq < resolveSeq;
    if (
      setupCommandState?.actorSlot !== "slot_4" ||
      setupCommandState?.phase?.locked !== false ||
      setupVoteButton?.disabled !== false ||
      setupHostPhase?.locked !== false ||
      setupHostPhaseActions.includes("resolve_phase") !== true ||
      resolve?.state !== "ack" ||
      !Array.isArray(resolve?.streamSeqs) ||
      resolve.streamSeqs.length < 3 ||
      resolve?.requestEnvelope?.body?.body?.command?.ResolvePhase?.game !== raceGame ||
      vote?.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !== "slot_4" ||
      (acceptedSerialOrder !== true && voteRejectedPhaseLocked !== true)
    ) {
      throw new Error(
        `concurrent player vote/resolve race outcomes drifted: ${JSON.stringify({
          raceGame,
          setupCommandState,
          setupButtons,
          setupHostPhase,
          setupHostPhaseActions,
          vote,
          resolve,
          voteSeq,
          resolveSeq,
        })}`,
      );
    }

    const [playerReloadResponse, hostReloadResponse] = await Promise.all([
      playerEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}`, {
        waitUntil: "networkidle",
      }),
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (
      playerReloadResponse === null ||
      !playerReloadResponse.ok() ||
      hostReloadResponse === null ||
      !hostReloadResponse.ok()
    ) {
      throw new Error(
        `concurrent player vote/resolve reload failed: ${JSON.stringify({
          playerStatus: playerReloadResponse?.status() ?? null,
          hostStatus: hostReloadResponse?.status() ?? null,
        })}`,
      );
    }
    await playerEntry.page.getByTestId("player-surface").waitFor({ state: "visible" });
    await Promise.all([
      playerEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
          (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
            0 &&
          window.__fmarchPlayerProjection?.dayVoteOutcomes?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ),
      ),
      hostEntry.page.waitForFunction(
        () =>
          window.__fmarchHostProjection?.phase?.id === "D01" &&
          window.__fmarchHostProjection?.phase?.locked === true &&
          window.__fmarchHostDayVoteOutcomesProjection?.some(
            (row) =>
              row.phaseId === "D01" &&
              row.status === "Lynch" &&
              row.winnerSlot === "slot-2",
          ),
      ),
    ]);
    const commandStateAfterRace = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const buttonsAfterRace = await playerCommandButtons(playerEntry.page);
    const hostPhaseAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const hostDayVoteOutcomesAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
    );
    const playerDayVoteOutcomesAfterRace = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const apiCommandStateAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
    );
    const apiDayVoteOutcomesAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/day-vote-outcomes`,
    );
    const normalizedApiOutcomes = normalizeDayVoteOutcomeRows(
      apiDayVoteOutcomesAfterRace,
    );
    const expectedOutcome = normalizedApiOutcomes.find(
      (row) =>
        row.phaseId === "D01" &&
        row.status === "Lynch" &&
        row.winnerSlot === "slot-2",
    );
    const roleReloadAfterRace = {
      status: "passed",
      playerRouteResponseStatus: playerReloadResponse.status(),
      hostRouteResponseStatus: hostReloadResponse.status(),
      commandStateAfterReload: commandStateAfterRace,
      buttonsAfterReload: buttonsAfterRace,
      hostPhaseAfterReload: hostPhaseAfterRace,
      hostDayVoteOutcomesAfterReload: hostDayVoteOutcomesAfterRace,
      playerDayVoteOutcomesAfterReload: playerDayVoteOutcomesAfterRace,
      apiCommandStateAfterReload: apiCommandStateAfterRace,
      apiDayVoteOutcomesAfterReload: apiDayVoteOutcomesAfterRace,
    };
    if (
      commandStateAfterRace?.phase?.phaseId !== "D01" ||
      commandStateAfterRace?.phase?.locked !== true ||
      commandStateAfterRace?.voteTargets?.length !== 0 ||
      buttonsAfterRace.some((button) => button.action?.startsWith("submit_vote")) ||
      !buttonsAfterRace.some(
        (button) => button.action === "submit_post" && button.disabled === false,
      ) ||
      hostPhaseAfterRace?.locked !== true ||
      !hostDayVoteOutcomesAfterRace.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      !playerDayVoteOutcomesAfterRace.some(
        (row) =>
          row.phaseId === "D01" &&
          row.status === "Lynch" &&
          row.winnerSlot === "slot-2",
      ) ||
      apiCommandStateAfterRace?.phase?.locked !== true ||
      apiCommandStateAfterRace?.vote_targets?.length !== 0 ||
      expectedOutcome === undefined ||
      roleReloadAfterRace.playerRouteResponseStatus !== 200 ||
      roleReloadAfterRace.hostRouteResponseStatus !== 200
    ) {
      throw new Error(
        `concurrent player vote/resolve race convergence drifted: ${JSON.stringify({
          raceGame,
          vote,
          resolve,
          commandStateAfterRace,
          buttonsAfterRace,
          hostPhaseAfterRace,
          hostDayVoteOutcomesAfterRace,
          playerDayVoteOutcomesAfterRace,
          apiCommandStateAfterRace,
          apiDayVoteOutcomesAfterRace,
          roleReloadAfterRace,
        })}`,
      );
    }
    const outcomeSummary = voteAcked
      ? `vote seq ${voteSeq} before resolve seq ${resolveSeq}`
      : "vote rejected PhaseLocked after resolve";
    return {
      status: "passed",
      game: raceGame,
      seed,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      playerSession: {
        principalUserId: playerSession.principalUserId,
        credentialKind: playerSession.credentialKind,
        expectedCapabilityKind: playerSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      setupCommandState,
      setupButtons,
      setupVoteButton,
      setupHostPhase,
      setupHostPhaseActions,
      vote,
      resolve,
      voteSeq,
      resolveSeq,
      outcomeSummary,
      commandStateAfterRace,
      buttonsAfterRace,
      hostPhaseAfterRace,
      hostDayVoteOutcomesAfterRace,
      playerDayVoteOutcomesAfterRace,
      apiCommandStateAfterRace,
      apiDayVoteOutcomesAfterRace,
      roleReloadAfterRace,
      proof:
        "A disposable player role URL and host role URL raced SubmitVote against ResolvePhase through /commands, accepted only vote-before-resolve ACK ordering or PhaseLocked rejection, then reloaded browser and API projections to locked D01 day-vote outcome truth with vote controls removed.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyConcurrentPlayerActionAdvanceRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  if (browser === null || browser === undefined) {
    throw new Error("concurrent player action/advance proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const seed = await seedPlayerActionAdvanceRaceGame({ raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const actionSession = await createAccountLoginCredential({
    principalUserId: "player-goon-a",
    returnTo: `/g/${raceGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const actionEntry = await openVerifiedRoleEntry({
    browser,
    session: actionSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      gotoPlayerBoard(actionEntry.page, raceGame),
    ]);
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, { phaseId: "N01", locked: false }),
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot_4" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "N01" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          window.__fmarchPlayerProjection?.commandState?.actions?.some(
            (action) => action.templateId === "factional_kill",
          ),
      ),
    ]);
    const setupCommandState = await actionEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(actionEntry.page);
    const setupActionButton = setupButtons.find(
      (button) =>
        button.action === "submit_action:factional_kill" && button.disabled === false,
    );
    const setupHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupHostPhaseActions = await visibleHostPhaseActions(hostEntry.page);
    await actionEntry.page.waitForFunction(
      () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    );
    const closedStatus = await actionEntry.page.evaluate(
      () => window.__fmarchClosePlayerLiveProjection(),
    );
    const resolveNight = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, { phaseId: "N01", locked: true });
    const lockedHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const lockedHostPhaseActions = await visibleHostPhaseActions(hostEntry.page);
    const advanceActionRoot = hostEntry.page.getByTestId(
      "critical-host-action-advance_phase",
    );
    await advanceActionRoot
      .getByTestId("critical-host-action-trigger")
      .waitFor({ state: "visible" });
    await advanceActionRoot.getByTestId("critical-host-action-trigger").click();
    await advanceActionRoot
      .getByTestId("critical-host-action-confirmation")
      .waitFor({ state: "visible" });
    await actionEntry.page
      .locator('[data-action="submit_action:factional_kill"]')
      .click();
    await actionEntry.page
      .locator('[data-testid="player-action-confirm-factional_kill"]')
      .waitFor({ state: "visible" });
    await Promise.all([
      actionEntry.page
        .locator('[data-testid="player-action-confirm-factional_kill"]')
        .click(),
      clickCriticalHostActionConfirm(advanceActionRoot, {
        actionId: "advance_phase",
        roleLabel: "host advance",
      }),
    ]);
    await Promise.all([
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
            ?.SubmitAction?.action_id === "role_factional_kill" &&
          window.__fmarchPlayerCommandStatus?.state === "reject",
      ),
      hostEntry.page.waitForFunction(
        () => window.__fmarchHostCommandStatuses?.advance_phase?.state === "ack",
      ),
    ]);
    const reject = await actionEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const advance = await hostEntry.page.evaluate(
      () => window.__fmarchHostCommandStatuses?.advance_phase,
    );
    const submittedCommand = reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
    if (
      setupCommandState?.actorSlot !== "slot_4" ||
      setupCommandState?.phase?.phaseId !== "N01" ||
      setupCommandState?.phase?.locked !== false ||
      setupActionButton?.disabled !== false ||
      setupHostPhase?.id !== "N01" ||
      setupHostPhase?.locked !== false ||
      setupHostPhaseActions.includes("resolve_phase") !== true ||
      closedStatus?.state !== "closed" ||
      resolveNight?.commandStatus?.state !== "ack" ||
      lockedHostPhase?.id !== "N01" ||
      lockedHostPhase?.locked !== true ||
      lockedHostPhaseActions.includes("advance_phase") !== true ||
      reject?.state !== "reject" ||
      !["PhaseLocked", "InvalidTarget"].includes(reject?.error) ||
      reject?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(reject?.streamSeqs) ||
      submittedCommand?.actor_slot !== "slot_4" ||
      submittedCommand?.action_id !== "role_factional_kill" ||
      submittedCommand?.template_id !== "factional_kill" ||
      advance?.state !== "ack" ||
      advance?.serverEnvelope?.body?.kind !== "Ack" ||
      !Array.isArray(advance?.streamSeqs) ||
      advance.streamSeqs.length !== 1
    ) {
      throw new Error(
        `concurrent player action/advance race outcomes drifted: ${JSON.stringify({
          raceGame,
          setupCommandState,
          setupButtons,
          setupHostPhase,
          setupHostPhaseActions,
          closedStatus,
          resolveNight,
          lockedHostPhase,
          lockedHostPhaseActions,
          reject,
          advance,
        })}`,
      );
    }

    const [actionReloadResponse, hostReloadResponse] = await Promise.all([
      actionEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}`, {
        waitUntil: "networkidle",
      }),
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (
      actionReloadResponse === null ||
      !actionReloadResponse.ok() ||
      hostReloadResponse === null ||
      !hostReloadResponse.ok()
    ) {
      throw new Error(
        `concurrent player action/advance reload failed: ${JSON.stringify({
          actionStatus: actionReloadResponse?.status() ?? null,
          hostStatus: hostReloadResponse?.status() ?? null,
        })}`,
      );
    }
    await actionEntry.page.getByTestId("player-surface").waitFor({ state: "visible" });
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, { phaseId: "D02", locked: false }),
      actionEntry.page.waitForFunction(
        () =>
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
      ),
      actionEntry.page.waitForFunction(
        () =>
          document.querySelector('[data-action="submit_action:factional_kill"]') ===
          null,
      ),
    ]);
    const commandStateAfterRace = await actionEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const buttonsAfterRace = await playerCommandButtons(actionEntry.page);
    const hostPhaseAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const hostPhaseActionsAfterRace = await visibleHostPhaseActions(hostEntry.page);
    const apiCommandStateAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=player-goon-a&slot_id=slot_4`,
    );
    const apiHostStateAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/host-console-state?principal_user_id=host_h`,
    );
    const roleReloadAfterRace = {
      status: "passed",
      actionRouteResponseStatus: actionReloadResponse.status(),
      hostRouteResponseStatus: hostReloadResponse.status(),
      commandStateAfterReload: commandStateAfterRace,
      buttonsAfterReload: buttonsAfterRace,
      hostPhaseAfterReload: hostPhaseAfterRace,
      hostPhaseActionsAfterReload: hostPhaseActionsAfterRace,
      apiCommandStateAfterReload: apiCommandStateAfterRace,
      apiHostStateAfterReload: apiHostStateAfterRace,
    };
    if (
      commandStateAfterRace?.actorSlot !== "slot_4" ||
      commandStateAfterRace?.phase?.phaseId !== "D02" ||
      commandStateAfterRace?.phase?.locked !== false ||
      commandStateAfterRace?.actions?.length !== 0 ||
      buttonsAfterRace.some((button) => button.action === "submit_action:factional_kill") ||
      hostPhaseAfterRace?.id !== "D02" ||
      hostPhaseAfterRace?.locked !== false ||
      hostPhaseActionsAfterRace.includes("resolve_phase") !== true ||
      hostPhaseActionsAfterRace.includes("advance_phase") === true ||
      apiCommandStateAfterRace?.actor_slot !== "slot_4" ||
      apiCommandStateAfterRace?.phase?.phase_id !== "D02" ||
      apiCommandStateAfterRace?.phase?.locked !== false ||
      apiCommandStateAfterRace?.actions?.length !== 0 ||
      apiHostStateAfterRace?.phase?.phase_id !== "D02" ||
      apiHostStateAfterRace?.phase?.locked !== false ||
      roleReloadAfterRace.actionRouteResponseStatus !== 200 ||
      roleReloadAfterRace.hostRouteResponseStatus !== 200
    ) {
      throw new Error(
        `concurrent player action/advance convergence drifted: ${JSON.stringify({
          raceGame,
          reject,
          advance,
          commandStateAfterRace,
          buttonsAfterRace,
          hostPhaseAfterRace,
          hostPhaseActionsAfterRace,
          apiCommandStateAfterRace,
          apiHostStateAfterRace,
          roleReloadAfterRace,
        })}`,
      );
    }
    return {
      status: "passed",
      game: raceGame,
      seed,
      hostSession: {
        principalUserId: hostSession.principalUserId,
        credentialKind: hostSession.credentialKind,
        expectedCapabilityKind: hostSession.expectedCapabilityKind,
      },
      actionSession: {
        principalUserId: actionSession.principalUserId,
        credentialKind: actionSession.credentialKind,
        expectedCapabilityKind: actionSession.expectedCapabilityKind,
      },
      hostEntry: hostEntry.verification,
      actionEntry: actionEntry.verification,
      setupCommandState,
      setupButtons,
      setupActionButton,
      setupHostPhase,
      setupHostPhaseActions,
      closedStatus,
      resolveNight,
      lockedHostPhase,
      lockedHostPhaseActions,
      reject,
      advance,
      commandStateAfterRace,
      buttonsAfterRace,
      hostPhaseAfterRace,
      hostPhaseActionsAfterRace,
      apiCommandStateAfterRace,
      apiHostStateAfterRace,
      roleReloadAfterRace,
      proof:
        "A disposable action-player role URL froze an enabled N01 factional_kill control, the host role URL resolved N01 and raced AdvancePhase against the stale action click, then both role URLs reloaded and API projections converged to open D02 with no stale action appended.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await actionEntry.context.close().catch(() => {});
  }
}

async function seedPlayerActionAdvanceRaceGame({ raceGame }) {
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ResolvePhase: { game: raceGame, seed: 72_401 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
  ];
  const commands = [];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent player action/advance seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function verifyConcurrentCohostDeadlineResolveRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  if (browser === null || browser === undefined) {
    throw new Error("concurrent cohost deadline/resolve proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const deadlineAt = 1_781_928_000;
  const seed = await seedCohostDeadlineResolveRaceGame({ raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: "host_h",
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const cohostSession = await createAccountLoginCredential({
    principalUserId: "cohost_c",
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "CohostOf",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const cohostEntry = await openVerifiedRoleEntry({
    browser,
    session: cohostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    const [hostInitialResponse, cohostInitialResponse] = await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      cohostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (
      hostInitialResponse === null ||
      !hostInitialResponse.ok() ||
      cohostInitialResponse === null ||
      !cohostInitialResponse.ok()
    ) {
      throw new Error(
        `concurrent cohost deadline/resolve initial load failed: ${JSON.stringify({
          hostStatus: hostInitialResponse?.status() ?? null,
          cohostStatus: cohostInitialResponse?.status() ?? null,
        })}`,
      );
    }
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, { phaseId: "D01", locked: false }),
      cohostEntry.page.waitForFunction(
        () =>
          window.__fmarchHostProjection?.phase?.id === "D01" &&
          window.__fmarchHostProjection?.phase?.locked === false,
      ),
      hostEntry.page
        .getByTestId("critical-host-action-resolve_phase")
        .waitFor({ state: "visible" }),
      cohostEntry.page
        .getByTestId("critical-host-action-extend_deadline")
        .waitFor({ state: "visible" }),
    ]);
    const setupHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupCohostPhase = await cohostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupHostPhaseActions = await visibleHostControlActions(hostEntry.page, "phase");
    const setupHostDeadlineActions = await visibleHostControlActions(
      hostEntry.page,
      "deadline",
    );
    const setupCohostPhaseActions = await visibleHostControlActions(
      cohostEntry.page,
      "phase",
    );
    const setupCohostDeadlineActions = await visibleHostControlActions(
      cohostEntry.page,
      "deadline",
    );
    const hostActionRoot = hostEntry.page.getByTestId(
      "critical-host-action-resolve_phase",
    );
    const cohostActionRoot = cohostEntry.page.getByTestId(
      "critical-host-action-extend_deadline",
    );
    const hostConfirmButton = hostActionRoot.getByTestId("critical-host-action-confirm");
    const cohostConfirmButton = cohostActionRoot.getByTestId(
      "critical-host-action-confirm",
    );
    await Promise.all([
      hostActionRoot.getByTestId("critical-host-action-trigger").click(),
      cohostActionRoot.getByTestId("critical-host-action-trigger").click(),
    ]);
    await Promise.all([
      hostActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
        state: "visible",
      }),
      cohostActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
        state: "visible",
      }),
      hostConfirmButton.waitFor({ state: "visible" }),
      cohostConfirmButton.waitFor({ state: "visible" }),
    ]);
    const [hostConfirmationMessage, cohostConfirmationMessage] = await Promise.all([
      hostActionRoot.getByTestId("critical-host-action-confirmation-message").innerText(),
      cohostActionRoot
        .getByTestId("critical-host-action-confirmation-message")
        .innerText(),
    ]);
    await clickConcurrentCriticalHostActionConfirms([
      {
        actionRoot: hostActionRoot,
        actionId: "resolve_phase",
        roleLabel: "host",
      },
      {
        actionRoot: cohostActionRoot,
        actionId: "extend_deadline",
        roleLabel: "cohost",
      },
    ]);
    await Promise.all([
      hostEntry.page.waitForFunction(
        () => window.__fmarchHostCommandStatuses?.resolve_phase?.state === "ack",
      ),
      cohostEntry.page.waitForFunction(() => {
        const status = window.__fmarchHostCommandStatuses?.extend_deadline;
        return status?.state === "ack" || status?.state === "reject";
      }),
    ]);
    const [resolve, deadline] = await Promise.all([
      hostEntry.page.evaluate(() => window.__fmarchHostCommandStatuses?.resolve_phase),
      cohostEntry.page.evaluate(
        () => window.__fmarchHostCommandStatuses?.extend_deadline,
      ),
    ]);
    const deadlineCommand =
      deadline?.requestEnvelope?.body?.body?.command?.ExtendDeadline;
    const resolveCommand = resolve?.requestEnvelope?.body?.body?.command?.ResolvePhase;
    const deadlineAcked = deadline?.state === "ack";
    const deadlineRejected = deadline?.state === "reject";
    const deadlineSeq = deadlineAcked ? deadline.streamSeqs?.[0] : null;
    const resolveSeq = resolve?.streamSeqs?.[0] ?? null;
    const acceptedSerializedDeadline =
      deadlineAcked === true &&
      Number.isInteger(deadlineSeq) &&
      Number.isInteger(resolveSeq) &&
      deadlineSeq < resolveSeq;
    const acceptedPhaseLockedReject =
      deadlineRejected === true &&
      deadline?.error === "PhaseLocked" &&
      deadline?.serverEnvelope?.body?.kind === "Reject" &&
      Array.isArray(deadline?.streamSeqs) === false;
    if (
      setupHostPhase?.id !== "D01" ||
      setupHostPhase?.locked !== false ||
      setupCohostPhase?.id !== "D01" ||
      setupCohostPhase?.locked !== false ||
      setupHostPhaseActions.includes("resolve_phase") !== true ||
      setupHostDeadlineActions.includes("extend_deadline") !== true ||
      setupCohostPhaseActions.length !== 0 ||
      setupCohostDeadlineActions.includes("extend_deadline") !== true ||
      resolve?.state !== "ack" ||
      resolve?.serverEnvelope?.body?.kind !== "Ack" ||
      !Array.isArray(resolve?.streamSeqs) ||
      resolve.streamSeqs.length < 3 ||
      resolveCommand?.game !== raceGame ||
      deadlineCommand?.game !== raceGame ||
      deadlineCommand?.phase !== "D01" ||
      deadlineCommand?.at !== deadlineAt ||
      (acceptedSerializedDeadline !== true && acceptedPhaseLockedReject !== true)
    ) {
      throw new Error(
        `concurrent cohost deadline/resolve race outcomes drifted: ${JSON.stringify({
          raceGame,
          setupHostPhase,
          setupCohostPhase,
          setupHostPhaseActions,
          setupHostDeadlineActions,
          setupCohostPhaseActions,
          setupCohostDeadlineActions,
          hostConfirmationMessage,
          cohostConfirmationMessage,
          resolve,
          deadline,
          deadlineSeq,
          resolveSeq,
        })}`,
      );
    }

    const [hostReloadResponse, cohostReloadResponse] = await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      cohostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
    ]);
    if (
      hostReloadResponse === null ||
      !hostReloadResponse.ok() ||
      cohostReloadResponse === null ||
      !cohostReloadResponse.ok()
    ) {
      throw new Error(
        `concurrent cohost deadline/resolve reload failed: ${JSON.stringify({
          hostStatus: hostReloadResponse?.status() ?? null,
          cohostStatus: cohostReloadResponse?.status() ?? null,
        })}`,
      );
    }
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, { phaseId: "D01", locked: true }),
      cohostEntry.page.waitForFunction(
        () =>
          window.__fmarchHostProjection?.phase?.id === "D01" &&
          window.__fmarchHostProjection?.phase?.locked === true,
      ),
    ]);
    const [
      hostPhaseAfterRace,
      cohostPhaseAfterRace,
      hostPhaseActionsAfterRace,
      cohostPhaseActionsAfterRace,
      hostDeadlineActionsAfterRace,
      cohostDeadlineActionsAfterRace,
    ] = await Promise.all([
      hostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      cohostEntry.page.evaluate(() => window.__fmarchHostProjection?.phase),
      visibleHostControlActions(hostEntry.page, "phase"),
      visibleHostControlActions(cohostEntry.page, "phase"),
      visibleHostControlActions(hostEntry.page, "deadline"),
      visibleHostControlActions(cohostEntry.page, "deadline"),
    ]);
    const hostStateAfterRace = await fetchHostConsoleState({ apiBaseUrl, game: raceGame });
    const cohostStateAfterRace = await fetchHostConsoleState({
      apiBaseUrl,
      game: raceGame,
      principalUserId: "cohost_c",
    });
    const expectedDeadline = deadlineAcked ? deadlineAt : null;
    const roleReloadAfterRace = {
      status: "passed",
      expectedDeadline,
      hostRouteResponseStatus: hostReloadResponse.status(),
      cohostRouteResponseStatus: cohostReloadResponse.status(),
      hostPhaseAfterReload: hostPhaseAfterRace,
      cohostPhaseAfterReload: cohostPhaseAfterRace,
      hostPhaseActionsAfterReload: hostPhaseActionsAfterRace,
      cohostPhaseActionsAfterReload: cohostPhaseActionsAfterRace,
      hostDeadlineActionsAfterReload: hostDeadlineActionsAfterRace,
      cohostDeadlineActionsAfterReload: cohostDeadlineActionsAfterRace,
      hostApiPhaseAfterReload: hostStateAfterRace.phase,
      cohostApiPhaseAfterReload: cohostStateAfterRace.phase,
    };
    if (
      hostPhaseAfterRace?.id !== "D01" ||
      hostPhaseAfterRace?.locked !== true ||
      hostPhaseAfterRace?.deadline !== expectedDeadline ||
      cohostPhaseAfterRace?.id !== "D01" ||
      cohostPhaseAfterRace?.locked !== true ||
      cohostPhaseAfterRace?.deadline !== expectedDeadline ||
      hostPhaseActionsAfterRace.includes("resolve_phase") ||
      hostPhaseActionsAfterRace.includes("lock_thread") ||
      hostPhaseActionsAfterRace.includes("unlock_thread") !== true ||
      hostPhaseActionsAfterRace.includes("advance_phase") !== true ||
      cohostPhaseActionsAfterRace.length !== 0 ||
      hostDeadlineActionsAfterRace.includes("extend_deadline") !== true ||
      cohostDeadlineActionsAfterRace.includes("extend_deadline") !== true ||
      hostStateAfterRace.phase?.phase_id !== "D01" ||
      hostStateAfterRace.phase?.locked !== true ||
      hostStateAfterRace.phase?.deadline !== expectedDeadline ||
      cohostStateAfterRace.phase?.phase_id !== "D01" ||
      cohostStateAfterRace.phase?.locked !== true ||
      cohostStateAfterRace.phase?.deadline !== expectedDeadline ||
      roleReloadAfterRace.hostRouteResponseStatus !== 200 ||
      roleReloadAfterRace.cohostRouteResponseStatus !== 200 ||
      roleReloadAfterRace.hostApiPhaseAfterReload?.deadline !== expectedDeadline ||
      roleReloadAfterRace.cohostApiPhaseAfterReload?.deadline !== expectedDeadline
    ) {
      throw new Error(
        `concurrent cohost deadline/resolve convergence drifted: ${JSON.stringify({
          raceGame,
          resolve,
          deadline,
          expectedDeadline,
          hostPhaseAfterRace,
          cohostPhaseAfterRace,
          hostPhaseActionsAfterRace,
          cohostPhaseActionsAfterRace,
          hostDeadlineActionsAfterRace,
          cohostDeadlineActionsAfterRace,
          hostApiPhase: hostStateAfterRace.phase,
          cohostApiPhase: cohostStateAfterRace.phase,
          roleReloadAfterRace,
        })}`,
      );
    }
    const outcomeSummary = deadlineAcked
      ? `deadline seq ${deadlineSeq} before resolve seq ${resolveSeq}`
      : "deadline rejected PhaseLocked after resolve";
    return {
      status: "passed",
      game: raceGame,
      seed,
      deadlineAt,
      hostEntry: hostEntry.verification,
      cohostEntry: cohostEntry.verification,
      setupHostPhase,
      setupCohostPhase,
      setupHostPhaseActions,
      setupHostDeadlineActions,
      setupCohostPhaseActions,
      setupCohostDeadlineActions,
      hostConfirmationMessage,
      cohostConfirmationMessage,
      resolve,
      deadline,
      deadlineSeq,
      resolveSeq,
      outcomeSummary,
      hostPhaseAfterRace,
      cohostPhaseAfterRace,
      hostPhaseActionsAfterRace,
      cohostPhaseActionsAfterRace,
      hostDeadlineActionsAfterRace,
      cohostDeadlineActionsAfterRace,
      hostStateAfterRace,
      cohostStateAfterRace,
      roleReloadAfterRace,
      proof:
        "A disposable cohost role URL raced delegated ExtendDeadline against a host ResolvePhase command, accepted only deadline-before-resolution ACK ordering or PhaseLocked rejection, then refreshed both role URLs and API projections to locked D01 deadline truth.",
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await cohostEntry.context.close().catch(() => {});
  }
}

async function seedCohostDeadlineResolveRaceGame({ raceGame }) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(raceGame)) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent cohost deadline/resolve seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function verifyConcurrentReplacementPrivatePostRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementConcurrentPrivatePostRaceScenario();
  if (browser === null || browser === undefined) {
    throw new Error("concurrent replacement private-post proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const seed = await seedReplacementPrivatePostRaceGame({ raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const stalePlayerSession = await createAccountLoginCredential({
    principalUserId: scenario.staleOutgoingPrincipalUserId,
    returnTo: `/g/${raceGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: stalePlayerSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    const channelRoute = encodeURIComponent(scenario.channelId);
    const privateUrl = `${frontendBaseUrl}/g/${raceGame}/c/${channelRoute}`;
    await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      playerEntry.page.goto(privateUrl, { waitUntil: "networkidle" }),
    ]);
    await Promise.all([
      hostEntry.page.waitForFunction(
        ({ actorSlot, occupantLabel }) =>
          window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
          window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
        {
          actorSlot: scenario.actorSlot,
          occupantLabel: scenario.staleOutgoingPrincipalUserId,
        },
      ),
      playerEntry.page.waitForFunction(
        (actorSlot) =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
          window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive",
        scenario.actorSlot,
      ),
      playerEntry.page
        .getByTestId("player-command-channel-context")
        .waitFor({ state: "visible" }),
    ]);
    const setupHostReplacement = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );
    const setupCommandState = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupChannelContext = {
      channelId: await playerEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await playerEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await playerEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
    };
    const setupButtons = await playerCommandButtons(playerEntry.page);
    const postBody = `Replacement race private post ${crypto.randomUUID()}.`;
    const postCommandId = crypto.randomUUID();
    const replacementCommandId = crypto.randomUUID();
    const [postRaw, replacementRaw] = await Promise.all([
      sendBrowserCommand(playerEntry.page, {
        principalUserId: scenario.staleOutgoingPrincipalUserId,
        commandId: postCommandId,
        command: {
          SubmitPost: {
            game: raceGame,
            channel_id: scenario.channelId,
            actor_slot: scenario.actorSlot,
            body: postBody,
          },
        },
      }),
      sendBrowserCommand(hostEntry.page, {
        principalUserId: scenario.hostPrincipalUserId,
        commandId: replacementCommandId,
        command: {
          ProcessReplacement: {
            game: raceGame,
            slot: scenario.actorSlot,
            outgoing_user: scenario.staleOutgoingPrincipalUserId,
            incoming_user: scenario.replacementPrincipalUserId,
          },
        },
      }),
    ]);
    const post = normalizeCommandResponse({
      commandId: postCommandId,
      requestEnvelope: postRaw.requestEnvelope,
      response: { status: postRaw.httpStatus },
      serverEnvelope: postRaw.serverEnvelope,
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    const postAcked = post?.state === "ack";
    const postRejected =
      post?.state === "reject" && post?.error === scenario.rejectionError;
    const postSeq = postAcked ? post.streamSeqs?.[0] : null;
    const replacementSeq = replacement?.streamSeqs?.[0] ?? null;
    const acceptedPostBeforeReplacement =
      postAcked === true &&
      Number.isInteger(postSeq) &&
      Number.isInteger(replacementSeq) &&
      postSeq < replacementSeq;
    if (
      setupHostReplacement?.occupantLabel !==
        scenario.staleOutgoingPrincipalUserId ||
      setupCommandState?.actorSlot !== scenario.actorSlot ||
      setupCommandState?.actorStatus !== "alive" ||
      setupChannelContext?.channelId !== scenario.channelId ||
      setupChannelContext?.actorSlot !== scenario.actorSlot ||
      setupChannelContext?.actorStatus !== "alive" ||
      setupButtons.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) !== true ||
      replacement?.state !== "ack" ||
      replacement?.serverEnvelope?.body?.kind !== "Ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.game !==
        raceGame ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.outgoing_user !== scenario.staleOutgoingPrincipalUserId ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      post?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
        scenario.channelId ||
      post?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
        scenario.actorSlot ||
      (acceptedPostBeforeReplacement !== true && postRejected !== true)
    ) {
      throw new Error(
        `concurrent replacement private-post race outcomes drifted: ${JSON.stringify({
          raceGame,
          setupHostReplacement,
          setupCommandState,
          setupChannelContext,
          setupButtons,
          post,
          replacement,
          postSeq,
          replacementSeq,
        })}`,
      );
    }

    await hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.replacementOccupantLabel,
      },
    );
    const hostReplacementAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );
    const apiCommandStateAfterRace = await fetchJsonStatus(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const commandStateAfterRace = {
      status: apiCommandStateAfterRace.status,
      error: apiCommandStateAfterRace.body?.error,
      message: apiCommandStateAfterRace.body?.message,
    };
    const apiSlotAfterRace = (
      await fetchHostConsoleState({
        apiBaseUrl,
        game: raceGame,
        slot: scenario.actorSlot,
      })
    ).slots?.find?.((slot) => slot.slot_id === scenario.actorSlot);
    const staleRouteResponse = await playerEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    await playerEntry.page.getByTestId("route-error-surface").waitFor({
      state: "visible",
    });
    const staleRoute = {
      status: Number(
        await playerEntry.page
          .getByTestId("route-error-surface")
          .getAttribute("data-status"),
      ),
      responseStatus: staleRouteResponse?.status() ?? null,
      message: await playerEntry.page.getByTestId("route-error-surface").innerText(),
    };
    const buttonsAfterRace = await playerCommandButtons(playerEntry.page);
    const apiThread = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.replacementPrincipalUserId}&limit=100`,
    );
    const apiThreadPostBodies = (apiThread.posts ?? []).map((item) => item.body);
    if (
      commandStateAfterRace?.status !== 403 ||
      commandStateAfterRace?.error !== scenario.rejectionError ||
      buttonsAfterRace.some(
        (button) =>
          (button.action === scenario.commandAction ||
            button.action?.startsWith("submit_action")) &&
          button.disabled === false,
      ) ||
      hostReplacementAfterRace?.occupantLabel !==
        scenario.replacementOccupantLabel ||
      apiSlotAfterRace?.occupant_user_id !== scenario.replacementPrincipalUserId ||
      staleRoute.status !== 403 ||
      staleRoute.responseStatus !== 403 ||
      !staleRoute.message.includes("requires scoped channel capability") ||
      apiThreadPostBodies.includes(postBody) !== postAcked
    ) {
      throw new Error(
        `concurrent replacement private-post convergence drifted: ${JSON.stringify({
          raceGame,
          post,
          replacement,
          commandStateAfterRace,
          buttonsAfterRace,
          hostReplacementAfterRace,
          apiCommandStateAfterRace,
          apiSlotAfterRace,
          staleRoute,
          apiThreadPostBodies,
          postBody,
        })}`,
      );
    }
    const outcomeSummary = postAcked
      ? `private post seq ${postSeq} before replacement seq ${replacementSeq}`
      : `private post rejected ${scenario.rejectionError} after replacement`;
    return {
      status: "passed",
      game: raceGame,
      seed,
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      setupHostReplacement,
      setupCommandState,
      setupChannelContext,
      setupButtons,
      post,
      replacement,
      postSeq,
      replacementSeq,
      outcomeSummary,
      commandStateAfterRace,
      buttonsAfterRace,
      hostReplacementAfterRace,
      apiCommandStateAfterRace,
      apiSlotAfterRace,
      staleRoute,
      postBody,
      apiThreadPostBodies,
      proof:
        scenario.proof,
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function verifyStaleReplacementPrivatePostAfterResolve({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementStalePrivatePostAfterResolveScenario();
  if (browser === null || browser === undefined) {
    throw new Error(
      "stale replacement private-post proof requires a Playwright browser",
    );
  }
  const privatePostGame = crypto.randomUUID();
  const seed = await seedReplacementPrivatePostRaceGame({
    raceGame: privatePostGame,
  });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${privatePostGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const staleOutgoingSession = await createAccountLoginCredential({
    principalUserId: scenario.staleOutgoingPrincipalUserId,
    returnTo: `/g/${privatePostGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const replacementSession = await createAccountLoginCredential({
    principalUserId: scenario.replacementPrincipalUserId,
    returnTo: `/g/${privatePostGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: privatePostGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const staleOutgoingEntry = await openVerifiedRoleEntry({
    browser,
    session: staleOutgoingSession,
    game: privatePostGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  try {
    const channelRoute = encodeURIComponent(scenario.channelId);
    const privateUrl = `${frontendBaseUrl}/g/${privatePostGame}/c/${channelRoute}`;
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${privatePostGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D01",
      locked: false,
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.staleOutgoingPrincipalUserId,
      },
    );
    const replacementCommandId = crypto.randomUUID();
    const replacementRaw = await sendBrowserCommand(hostEntry.page, {
      principalUserId: scenario.hostPrincipalUserId,
      commandId: replacementCommandId,
      command: {
        ProcessReplacement: {
          game: privatePostGame,
          slot: scenario.actorSlot,
          outgoing_user: scenario.staleOutgoingPrincipalUserId,
          incoming_user: scenario.replacementPrincipalUserId,
        },
      },
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.replacementOccupantLabel,
      },
    );
    const hostReplacementAfterProcess = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );

    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: privatePostGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const rowanResponse = await replacementEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    if (rowanResponse === null || !rowanResponse.ok()) {
      throw new Error(
        `replacement stale private-post route failed with ${
          rowanResponse?.status() ?? "no response"
        }`,
      );
    }
    await replacementEntry.page.getByTestId("player-surface").waitFor({
      state: "visible",
    });
    await replacementEntry.page
      .getByTestId("player-command-channel-context")
      .waitFor({ state: "visible" });
    await replacementEntry.page.waitForFunction(
      (actorSlot) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
      scenario.actorSlot,
    );
    const commandStateBeforeClose = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const channelContextBeforeClose = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
      capabilityLabel: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-capability-label"),
    };
    const buttonsBeforeClose = await playerCommandButtons(replacementEntry.page);
    const submitPostBeforeClose = buttonsBeforeClose.find(
      (button) => button.action === scenario.commandAction,
    );
    await replacementEntry.page.waitForFunction(
      () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    );
    const closedStatus = await replacementEntry.page.evaluate(
      () => window.__fmarchClosePlayerLiveProjection(),
    );

    const resolveDay = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D01",
      locked: true,
    });
    const hostPhaseAfterResolve = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const hostPhaseActionsAfterResolve = await visibleHostPhaseActions(hostEntry.page);
    const apiCommandStateAfterResolve = await fetchJson(
      `${apiBaseUrl}/games/${privatePostGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );

    const postBody = `Stale Rowan private post after D01 resolve ${crypto.randomUUID()}.`;
    await replacementEntry.page
      .locator('[data-testid="player-composer"] textarea')
      .fill(postBody);
    await replacementEntry.page
      .locator(`[data-action="${scenario.commandAction}"]`)
      .click();
    await replacementEntry.page.waitForFunction(
      (expectedBody) =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitPost?.body === expectedBody &&
        window.__fmarchPlayerCommandStatus?.state === "ack",
      postBody,
    );
    await replacementEntry.page.waitForFunction(
      ({ expectedBody, actorSlot }) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === expectedBody && post.authorSlot === actorSlot,
        ) &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0,
      { expectedBody: postBody, actorSlot: scenario.actorSlot },
    );
    const stalePost = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterAck = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const channelContextAfterAck = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
      capabilityLabel: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-capability-label"),
    };
    const projectedPost = await replacementEntry.page.evaluate((expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.find(
        (post) => post.body === expectedBody,
      ),
    postBody);
    const buttonsAfterAck = await playerCommandButtons(replacementEntry.page);
    const dispatchPlan = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentReceipt = await replacementEntry.page.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
    );
    const receiptStatusText = await replacementEntry.page
      .getByTestId("player-command-status")
      .innerText();
    const rowanPrivateIsolationAfterAck = await replacementEntry.page.evaluate(() => {
      const notifications = window.__fmarchPlayerProjection?.notifications ?? [];
      const investigationResults =
        window.__fmarchPlayerProjection?.investigationResults ?? [];
      return {
        targetKillVisible: notifications.some(
          (notice) =>
            notice.audience_slot === "slot-2" ||
            notice.effect === "player_killed" ||
            notice.status === "factional_kill",
        ),
        actionResultVisible: investigationResults.some(
          (result) =>
            result.actor_slot === "slot_4" ||
            result.action_id === "browser_factional_kill_n01" ||
            result.status === "factional_kill",
        ),
        notificationCount: notifications.length,
        investigationResultCount: investigationResults.length,
      };
    });
    const apiCommandStateAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${privatePostGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const apiThreadAfterAck = await fetchJson(
      `${apiBaseUrl}/games/${privatePostGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.replacementPrincipalUserId}&limit=100`,
    );
    const apiThreadPostBodies = (apiThreadAfterAck.posts ?? []).map(
      (post) => post.body,
    );
    const staleRouteResponse = await staleOutgoingEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    await staleOutgoingEntry.page.getByTestId("route-error-surface").waitFor({
      state: "visible",
    });
    const staleOutgoingRouteAfterAck = {
      status: Number(
        await staleOutgoingEntry.page
          .getByTestId("route-error-surface")
          .getAttribute("data-status"),
      ),
      responseStatus: staleRouteResponse?.status() ?? null,
      message: await staleOutgoingEntry.page
        .getByTestId("route-error-surface")
        .innerText(),
    };
    const staleOutgoingThreadAfterAck = await fetchJsonStatus(
      `${apiBaseUrl}/games/${privatePostGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&limit=100`,
    );
    await replacementEntry.page.goto(privateUrl, { waitUntil: "networkidle" });
    await replacementEntry.page
      .getByTestId("player-command-channel-context")
      .waitFor({ state: "visible" });
    await replacementEntry.page.waitForFunction(
      ({ expectedChannelId, expectedPostBody, actorSlot }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) => post.body === expectedPostBody && post.authorSlot === actorSlot,
        ) &&
        document
          .querySelector("[data-testid='player-command-channel-context']")
          ?.getAttribute("data-channel-id") === expectedChannelId,
      {
        expectedChannelId: scenario.channelId,
        expectedPostBody: postBody,
        actorSlot: scenario.actorSlot,
      },
    );
    const reconnectCommandStateBeforeDrop = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const reconnectChannelContextBeforeDrop = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
    };
    const reconnectButtonsBeforeDrop = await playerCommandButtons(
      replacementEntry.page,
    );
    await replacementEntry.page.waitForFunction(
      () => typeof window.__fmarchDropPlayerLiveProjection === "function",
    );
    await replacementEntry.page.evaluate(() => window.__fmarchDropPlayerLiveProjection());
    await replacementEntry.page.waitForFunction(
      () => window.__fmarchLiveProjectionStatus?.state === "reconnecting",
    );
    const reconnectingStatus = await replacementEntry.page.evaluate(
      () => window.__fmarchLiveProjectionStatus,
    );
    const reconnectPostBody = `Replacement private reconnect post after D01 resolve ${crypto.randomUUID()}.`;
    const reconnectCommand = await sendCommand(scenario.replacementPrincipalUserId, {
      SubmitPost: {
        game: privatePostGame,
        channel_id: scenario.channelId,
        actor_slot: scenario.actorSlot,
        body: reconnectPostBody,
      },
    });
    await replacementEntry.page.waitForFunction(
      () =>
        (window.__fmarchLiveProjectionEvents ?? []).some(
          (event) =>
            event?.kind === "reconnect" &&
            event.attempt === 1 &&
            event.state === "recovered",
        ),
    );
    await replacementEntry.page.waitForFunction(
      ({ expectedBody, expectedActorSlot }) =>
        window.__fmarchPlayerProjection?.thread?.posts?.some(
          (post) =>
            post.body === expectedBody && post.authorSlot === expectedActorSlot,
        ) &&
        window.__fmarchPlayerProjection?.commandState?.actorSlot === expectedActorSlot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D01" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
      { expectedBody: reconnectPostBody, expectedActorSlot: scenario.actorSlot },
    );
    await replacementEntry.page.getByText(reconnectPostBody, { exact: true }).waitFor({
      state: "visible",
    });
    const reconnectRecoveryEvent = await replacementEntry.page.evaluate(() =>
      (window.__fmarchLiveProjectionEvents ?? []).find(
        (event) =>
          event?.kind === "reconnect" &&
          event.attempt === 1 &&
          event.state === "recovered",
      ),
    );
    const recoveredStatus = await replacementEntry.page.evaluate(
      () => window.__fmarchLiveProjectionStatus,
    );
    const reconnectedProjection = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection,
    );
    const reconnectChannelContextAfterRecovery = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
    };
    const reconnectButtonsAfterRecovery = await playerCommandButtons(
      replacementEntry.page,
    );
    const apiThreadAfterReconnect = await fetchJson(
      `${apiBaseUrl}/games/${privatePostGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.replacementPrincipalUserId}&limit=100`,
    );
    const apiThreadPostBodiesAfterReconnect = (
      apiThreadAfterReconnect.posts ?? []
    ).map((post) => post.body);
    const apiCommandStateAfterReconnect = await fetchJson(
      `${apiBaseUrl}/games/${privatePostGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const staleOutgoingThreadAfterReconnect = await fetchJsonStatus(
      `${apiBaseUrl}/games/${privatePostGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&limit=100`,
    );
    const privateReconnectAfterAck = {
      status: "passed",
      reconnectCommandStateBeforeDrop,
      reconnectChannelContextBeforeDrop,
      reconnectButtonsBeforeDrop,
      reconnectingStatus,
      reconnectPostBody,
      reconnectCommand,
      reconnectRecoveryEvent,
      recoveredStatus,
      recoveredCommandState: reconnectedProjection?.commandState ?? null,
      recoveredSnapshotContainsPost:
        reconnectedProjection?.thread?.posts?.some(
          (post) =>
            post.body === reconnectPostBody &&
            post.authorSlot === scenario.actorSlot,
        ) === true,
      reconnectChannelContextAfterRecovery,
      reconnectButtonsAfterRecovery,
      apiThreadPostBodiesAfterReconnect,
      apiCommandStateAfterReconnect,
      staleOutgoingThreadAfterReconnect,
    };

    if (
      replacement?.state !== "ack" ||
      replacement?.serverEnvelope?.body?.kind !== "Ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      hostReplacementAfterProcess?.occupantLabel !==
        scenario.replacementOccupantLabel ||
      commandStateBeforeClose?.actorSlot !== scenario.actorSlot ||
      commandStateBeforeClose?.actorStatus !== "alive" ||
      commandStateBeforeClose?.phase?.phaseId !== "D01" ||
      commandStateBeforeClose?.phase?.locked !== false ||
      channelContextBeforeClose.channelId !== scenario.channelId ||
      channelContextBeforeClose.actorSlot !== scenario.actorSlot ||
      !channelContextBeforeClose.capabilityLabel?.includes(
        `ChannelMember(${scenario.channelId})`,
      ) ||
      submitPostBeforeClose?.disabled !== false ||
      closedStatus?.state !== "closed" ||
      resolveDay?.commandStatus?.state !== "ack" ||
      hostPhaseAfterResolve?.id !== "D01" ||
      hostPhaseAfterResolve?.locked !== true ||
      hostPhaseActionsAfterResolve.includes("advance_phase") !== true ||
      apiCommandStateAfterResolve?.actor_slot !== scenario.actorSlot ||
      apiCommandStateAfterResolve?.phase?.phase_id !== "D01" ||
      apiCommandStateAfterResolve?.phase?.locked !== true ||
      stalePost?.state !== "ack" ||
      stalePost?.serverEnvelope?.body?.kind !== "Ack" ||
      !Array.isArray(stalePost?.streamSeqs) ||
      stalePost.streamSeqs.length === 0 ||
      stalePost?.requestEnvelope?.body?.body?.principal_user_id !==
        scenario.replacementPrincipalUserId ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
        scenario.channelId ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
        scenario.actorSlot ||
      stalePost?.requestEnvelope?.body?.body?.command?.SubmitPost?.body !== postBody ||
      dispatchPlan?.projectionRefreshKeys?.includes("thread") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      currentReceipt?.actionId !== scenario.commandAction ||
      currentReceipt?.state !== "ack" ||
      !receiptStatusText.includes("Ack") ||
      commandStateAfterAck?.actorSlot !== scenario.actorSlot ||
      commandStateAfterAck?.actorStatus !== "alive" ||
      commandStateAfterAck?.phase?.phaseId !== "D01" ||
      commandStateAfterAck?.phase?.locked !== true ||
      commandStateAfterAck?.voteTargets?.length !== 0 ||
      channelContextAfterAck.channelId !== scenario.channelId ||
      channelContextAfterAck.actorSlot !== scenario.actorSlot ||
      channelContextAfterAck.actorStatus !== "alive" ||
      projectedPost?.authorSlot !== scenario.actorSlot ||
      buttonsAfterAck.some((button) => button.action?.startsWith("submit_vote")) ||
      buttonsAfterAck.some(
        (button) => button.action === "withdraw_vote" && button.disabled === false,
      ) ||
      !buttonsAfterAck.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) ||
      rowanPrivateIsolationAfterAck.targetKillVisible !== false ||
      rowanPrivateIsolationAfterAck.actionResultVisible !== false ||
      apiCommandStateAfterAck?.actor_slot !== scenario.actorSlot ||
      apiCommandStateAfterAck?.phase?.phase_id !== "D01" ||
      apiCommandStateAfterAck?.phase?.locked !== true ||
      apiCommandStateAfterAck?.vote_targets?.length !== 0 ||
      !apiThreadPostBodies.includes(postBody) ||
      staleOutgoingRouteAfterAck.status !== 403 ||
      staleOutgoingRouteAfterAck.responseStatus !== 403 ||
      !staleOutgoingRouteAfterAck.message.includes(
        "requires scoped channel capability",
      ) ||
      staleOutgoingThreadAfterAck.status !== 403 ||
      privateReconnectAfterAck.reconnectCommandStateBeforeDrop?.actorSlot !==
        scenario.actorSlot ||
      privateReconnectAfterAck.reconnectCommandStateBeforeDrop?.phase?.locked !==
        true ||
      privateReconnectAfterAck.reconnectChannelContextBeforeDrop.channelId !==
        scenario.channelId ||
      privateReconnectAfterAck.reconnectButtonsBeforeDrop.some((button) =>
        button.action?.startsWith("submit_vote"),
      ) ||
      privateReconnectAfterAck.reconnectingStatus?.state !== "reconnecting" ||
      privateReconnectAfterAck.reconnectCommand?.principalUserId !==
        scenario.replacementPrincipalUserId ||
      privateReconnectAfterAck.reconnectCommand?.command?.SubmitPost?.channel_id !==
        scenario.channelId ||
      privateReconnectAfterAck.reconnectCommand?.command?.SubmitPost?.actor_slot !==
        scenario.actorSlot ||
      privateReconnectAfterAck.reconnectCommand?.command?.SubmitPost?.body !==
        reconnectPostBody ||
      privateReconnectAfterAck.reconnectRecoveryEvent?.state !== "recovered" ||
      privateReconnectAfterAck.reconnectRecoveryEvent?.attempt !== 1 ||
      privateReconnectAfterAck.recoveredSnapshotContainsPost !== true ||
      privateReconnectAfterAck.recoveredCommandState?.actorSlot !==
        scenario.actorSlot ||
      privateReconnectAfterAck.recoveredCommandState?.phase?.phaseId !== "D01" ||
      privateReconnectAfterAck.recoveredCommandState?.phase?.locked !== true ||
      privateReconnectAfterAck.recoveredCommandState?.voteTargets?.length !== 0 ||
      privateReconnectAfterAck.reconnectChannelContextAfterRecovery.channelId !==
        scenario.channelId ||
      privateReconnectAfterAck.reconnectChannelContextAfterRecovery.actorSlot !==
        scenario.actorSlot ||
      privateReconnectAfterAck.reconnectButtonsAfterRecovery.some((button) =>
        button.action?.startsWith("submit_vote"),
      ) ||
      !privateReconnectAfterAck.reconnectButtonsAfterRecovery.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) ||
      !privateReconnectAfterAck.apiThreadPostBodiesAfterReconnect.includes(
        reconnectPostBody,
      ) ||
      !privateReconnectAfterAck.apiThreadPostBodiesAfterReconnect.includes(
        postBody,
      ) ||
      privateReconnectAfterAck.apiCommandStateAfterReconnect?.phase?.phase_id !==
        "D01" ||
      privateReconnectAfterAck.apiCommandStateAfterReconnect?.phase?.locked !== true ||
      privateReconnectAfterAck.apiCommandStateAfterReconnect?.vote_targets?.length !==
        0 ||
      privateReconnectAfterAck.staleOutgoingThreadAfterReconnect?.status !== 403
    ) {
      throw new Error(
        `stale replacement private-post after resolve proof drifted: ${JSON.stringify({
          privatePostGame,
          replacement,
          hostReplacementAfterProcess,
          commandStateBeforeClose,
          channelContextBeforeClose,
          buttonsBeforeClose,
          submitPostBeforeClose,
          closedStatus,
          resolveDay,
          hostPhaseAfterResolve,
          hostPhaseActionsAfterResolve,
          apiCommandStateAfterResolve,
          stalePost,
          dispatchPlan,
          currentReceipt,
          receiptStatusText,
          commandStateAfterAck,
          channelContextAfterAck,
          projectedPost,
          buttonsAfterAck,
          rowanPrivateIsolationAfterAck,
          apiCommandStateAfterAck,
          apiThreadPostBodies,
          staleOutgoingRouteAfterAck,
          staleOutgoingThreadAfterAck,
          privateReconnectAfterAck,
          postBody,
        })}`,
      );
    }

    return {
      status: "passed",
      game: privatePostGame,
      channel: scenario.channelId,
      seed,
      hostEntry: hostEntry.verification,
      staleOutgoingEntry: staleOutgoingEntry.verification,
      replacementEntry: replacementEntry.verification,
      replacement,
      hostReplacementAfterProcess,
      commandStateBeforeClose,
      channelContextBeforeClose,
      buttonsBeforeClose,
      submitPostBeforeClose,
      closedStatus,
      resolveDay,
      hostPhaseAfterResolve,
      hostPhaseActionsAfterResolve,
      apiCommandStateAfterResolve,
      postBody,
      stalePost,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      commandStateAfterAck,
      channelContextAfterAck,
      projectedPost,
      buttonsAfterAck,
      rowanPrivateIsolationAfterAck,
      apiCommandStateAfterAck,
      apiThreadAfterAck,
      apiThreadPostBodies,
      staleOutgoingRouteAfterAck,
      staleOutgoingThreadAfterAck,
      privateReconnectAfterAck,
      outcomeSummary: scenario.outcomeSummary,
      proof:
        "After Rowan replaced into Slot 7 and opened the private mafia channel, the replacement role URL froze, the host resolved D01, and Rowan's stale private SubmitPost ACKed while refreshing to locked D01 channel and command-state truth; the private channel route then reconnected to another Rowan post with locked controls while Mira's outgoing role still could not read the private channel.",
    };
  } finally {
    await replacementEntry?.context?.close().catch(() => {});
    await staleOutgoingEntry.context.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
  }
}

async function verifyStaleReplacementPrivatePostAfterComplete({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementStalePrivatePostAfterCompleteScenario();
  if (browser === null || browser === undefined) {
    throw new Error(
      "stale replacement private-post complete proof requires a Playwright browser",
    );
  }
  const completeGame = crypto.randomUUID();
  const seed = await seedReplacementPrivatePostRaceGame({ raceGame: completeGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${completeGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const staleOutgoingSession = await createAccountLoginCredential({
    principalUserId: scenario.staleOutgoingPrincipalUserId,
    returnTo: `/g/${completeGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const replacementSession = await createAccountLoginCredential({
    principalUserId: scenario.replacementPrincipalUserId,
    returnTo: `/g/${completeGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: completeGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const staleOutgoingEntry = await openVerifiedRoleEntry({
    browser,
    session: staleOutgoingSession,
    game: completeGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  try {
    const channelRoute = encodeURIComponent(scenario.channelId);
    const privateUrl = `${frontendBaseUrl}/g/${completeGame}/c/${channelRoute}`;
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${completeGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: "D01",
      locked: false,
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.staleOutgoingPrincipalUserId,
      },
    );
    const replacementCommandId = crypto.randomUUID();
    const replacementRaw = await sendBrowserCommand(hostEntry.page, {
      principalUserId: scenario.hostPrincipalUserId,
      commandId: replacementCommandId,
      command: {
        ProcessReplacement: {
          game: completeGame,
          slot: scenario.actorSlot,
          outgoing_user: scenario.staleOutgoingPrincipalUserId,
          incoming_user: scenario.replacementPrincipalUserId,
        },
      },
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.replacementOccupantLabel,
      },
    );
    const hostReplacementAfterProcess = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );

    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: completeGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const rowanResponse = await replacementEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    if (rowanResponse === null || !rowanResponse.ok()) {
      throw new Error(
        `replacement stale private-post complete route failed with ${
          rowanResponse?.status() ?? "no response"
        }`,
      );
    }
    await replacementEntry.page.getByTestId("player-surface").waitFor({
      state: "visible",
    });
    await replacementEntry.page
      .getByTestId("player-command-channel-context")
      .waitFor({ state: "visible" });
    await replacementEntry.page.waitForFunction(
      (actorSlot) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === false,
      scenario.actorSlot,
    );
    const commandStateBeforeClose = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const channelContextBeforeClose = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
      capabilityLabel: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-capability-label"),
    };
    const buttonsBeforeClose = await playerCommandButtons(replacementEntry.page);
    const submitPostBeforeClose = buttonsBeforeClose.find(
      (button) => button.action === scenario.commandAction,
    );
    await replacementEntry.page.waitForFunction(
      () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    );
    const closedStatus = await replacementEntry.page.evaluate(
      () => window.__fmarchClosePlayerLiveProjection(),
    );

    await hostEntry.page
      .getByTestId("critical-host-action-complete_game")
      .waitFor({ state: "visible" });
    const complete = await confirmHostAction(hostEntry.page, "complete_game");
    await hostEntry.page.waitForFunction(
      () =>
        window.__fmarchHostProjection?.completed === true ||
        (window.__fmarchHostProjection?.slots ?? []).every(
          (slot) => slot.role_revealed === true && slot.alignment_revealed === true,
        ),
    );
    const hostSlotsAfterComplete = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    );
    const hostActionsAfterComplete = await visibleHostControlActions(
      hostEntry.page,
      "roles",
    );
    const apiStateAfterComplete = await fetchHostConsoleState({
      apiBaseUrl,
      game: completeGame,
    });

    const postBody = `${scenario.livePostBodyPrefix} ${crypto.randomUUID()}.`;
    await replacementEntry.page
      .locator('[data-testid="player-composer"] textarea')
      .fill(postBody);
    await replacementEntry.page
      .locator(`[data-action="${scenario.commandAction}"]`)
      .click();
    await replacementEntry.page.waitForFunction(
      ({ commandError, expectedBody }) =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitPost?.body === expectedBody &&
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === commandError,
      { commandError: scenario.commandError, expectedBody: postBody },
    );
    await replacementEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length === 0,
    );
    const reject = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterReject = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const channelContextAfterReject = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
    };
    const buttonsAfterReject = await playerCommandButtons(replacementEntry.page);
    const dispatchPlan = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentReceipt = await replacementEntry.page.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
    );
    const receiptStatusText = await replacementEntry.page
      .getByTestId("player-command-status")
      .innerText();
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const apiThreadAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.replacementPrincipalUserId}&limit=100`,
    );
    const apiThreadPostBodies = (apiThreadAfterReject.posts ?? []).map(
      (post) => post.body,
    );
    const reloadResponse = await replacementEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    if (reloadResponse === null || !reloadResponse.ok()) {
      throw new Error(
        `replacement completed private-channel reload failed with ${
          reloadResponse?.status() ?? "no response"
        }`,
      );
    }
    await replacementEntry.page.getByTestId("player-surface").waitFor({
      state: "visible",
    });
    await replacementEntry.page.getByTestId("player-thread-pager").waitFor({
      state: "visible",
    });
    await replacementEntry.page
      .getByTestId("player-command-channel-context")
      .waitFor({ state: "visible" });
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, expectedChannelId, rejectedBody }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.gameCompleted === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0 &&
        (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).length ===
          0 &&
        document
          .querySelector("[data-testid='player-command-channel-context']")
          ?.getAttribute("data-channel-id") === expectedChannelId &&
        (window.__fmarchPlayerProjection?.thread?.posts ?? []).some(
          (post) => post.body === rejectedBody,
        ) === false,
      {
        actorSlot: scenario.actorSlot,
        expectedChannelId: scenario.channelId,
        rejectedBody: postBody,
      },
    );
    const reloadProjection = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection,
    );
    const reloadChannelContext = {
      channelId: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-channel-id"),
      actorSlot: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-slot"),
      actorStatus: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-actor-status"),
      capabilityLabel: await replacementEntry.page
        .getByTestId("player-command-channel-context")
        .getAttribute("data-capability-label"),
    };
    const reloadButtons = await playerCommandButtons(replacementEntry.page);
    const reloadThreadPostBodies = (reloadProjection?.thread?.posts ?? []).map(
      (post) => post.body,
    );
    const reloadThreadPagerVisible = await replacementEntry.page
      .getByTestId("player-thread-pager")
      .isVisible();
    const reloadRejectedPostVisible =
      (await replacementEntry.page.getByText(postBody, { exact: true }).count()) > 0;
    const apiCommandStateAfterReload = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const apiThreadAfterReload = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.replacementPrincipalUserId}&limit=100`,
    );
    const apiThreadPostBodiesAfterReload = (
      apiThreadAfterReload.posts ?? []
    ).map((post) => post.body);
    const staleOutgoingRouteResponse = await staleOutgoingEntry.page.goto(privateUrl, {
      waitUntil: "networkidle",
    });
    await staleOutgoingEntry.page.getByTestId("route-error-surface").waitFor({
      state: "visible",
    });
    const staleOutgoingRouteAfterReject = {
      status: Number(
        await staleOutgoingEntry.page
          .getByTestId("route-error-surface")
          .getAttribute("data-status"),
      ),
      responseStatus: staleOutgoingRouteResponse?.status() ?? null,
      message: await staleOutgoingEntry.page
        .getByTestId("route-error-surface")
        .innerText(),
    };
    const staleOutgoingThreadAfterReject = await fetchJsonStatus(
      `${apiBaseUrl}/games/${completeGame}/channels/${channelRoute}/thread?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&limit=100`,
    );
    const privateReloadAfterReject = {
      status: "passed",
      routeResponseStatus: reloadResponse.status(),
      threadPagerVisible: reloadThreadPagerVisible,
      recoveredCommandState: reloadProjection?.commandState ?? null,
      reloadChannelContext,
      reloadButtons,
      reloadThreadPostBodies,
      reloadRejectedPostVisible,
      apiCommandStateAfterReload,
      apiThreadPostBodiesAfterReload,
      staleOutgoingRouteAfterReload: staleOutgoingRouteAfterReject,
      staleOutgoingThreadAfterReload: staleOutgoingThreadAfterReject,
    };

    if (
      replacement?.state !== "ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      hostReplacementAfterProcess?.occupantLabel !==
        scenario.replacementOccupantLabel ||
      commandStateBeforeClose?.actorSlot !== scenario.actorSlot ||
      commandStateBeforeClose?.gameCompleted !== false ||
      channelContextBeforeClose.channelId !== scenario.channelId ||
      channelContextBeforeClose.actorSlot !== scenario.actorSlot ||
      !channelContextBeforeClose.capabilityLabel?.includes(
        `ChannelMember(${scenario.channelId})`,
      ) ||
      submitPostBeforeClose?.disabled !== false ||
      closedStatus?.state !== "closed" ||
      complete?.commandStatus?.state !== "ack" ||
      complete?.commandStatus?.requestEnvelope?.body?.body?.command?.CompleteGame
        ?.game !== completeGame ||
      hostSlotsAfterComplete.some(
        (slot) => slot.role_revealed !== true || slot.alignment_revealed !== true,
      ) ||
      hostActionsAfterComplete.includes("complete_game") ||
      apiStateAfterComplete.completed !== true ||
      reject?.state !== "reject" ||
      reject?.error !== scenario.commandError ||
      reject?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(reject?.streamSeqs) ||
      reject?.requestEnvelope?.body?.body?.principal_user_id !==
        scenario.replacementPrincipalUserId ||
      reject?.requestEnvelope?.body?.body?.command?.SubmitPost?.channel_id !==
        scenario.channelId ||
      reject?.requestEnvelope?.body?.body?.command?.SubmitPost?.actor_slot !==
        scenario.actorSlot ||
      reject?.requestEnvelope?.body?.body?.command?.SubmitPost?.body !== postBody ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      currentReceipt?.actionId !== scenario.commandAction ||
      currentReceipt?.state !== "reject" ||
      !receiptStatusText.includes(scenario.commandMessage) ||
      commandStateAfterReject?.actorSlot !== scenario.actorSlot ||
      commandStateAfterReject?.gameCompleted !== true ||
      commandStateAfterReject?.actions?.length !== 0 ||
      commandStateAfterReject?.voteTargets?.length !== 0 ||
      !commandStateAfterReject?.boundary?.includes(
        scenario.commandStateBoundaryFragment,
      ) ||
      channelContextAfterReject.channelId !== scenario.channelId ||
      channelContextAfterReject.actorSlot !== scenario.actorSlot ||
      buttonsAfterReject.some((button) => button.disabled !== true) ||
      apiCommandStateAfterReject?.game_completed !== true ||
      apiCommandStateAfterReject?.actions?.length !== 0 ||
      apiCommandStateAfterReject?.vote_targets?.length !== 0 ||
      apiThreadPostBodies.includes(postBody) ||
      privateReloadAfterReject.routeResponseStatus !== 200 ||
      privateReloadAfterReject.threadPagerVisible !== true ||
      privateReloadAfterReject.recoveredCommandState?.actorSlot !==
        scenario.actorSlot ||
      privateReloadAfterReject.recoveredCommandState?.gameCompleted !== true ||
      privateReloadAfterReject.recoveredCommandState?.actions?.length !== 0 ||
      privateReloadAfterReject.recoveredCommandState?.voteTargets?.length !== 0 ||
      !privateReloadAfterReject.recoveredCommandState?.boundary?.includes(
        scenario.commandStateBoundaryFragment,
      ) ||
      privateReloadAfterReject.reloadChannelContext.channelId !==
        scenario.channelId ||
      privateReloadAfterReject.reloadChannelContext.actorSlot !== scenario.actorSlot ||
      !privateReloadAfterReject.reloadChannelContext.capabilityLabel?.includes(
        `ChannelMember(${scenario.channelId})`,
      ) ||
      privateReloadAfterReject.reloadButtons.some(
        (button) => button.disabled !== true,
      ) ||
      privateReloadAfterReject.reloadRejectedPostVisible !== false ||
      privateReloadAfterReject.reloadThreadPostBodies.includes(postBody) ||
      privateReloadAfterReject.apiCommandStateAfterReload?.game_completed !== true ||
      privateReloadAfterReject.apiCommandStateAfterReload?.actions?.length !== 0 ||
      privateReloadAfterReject.apiCommandStateAfterReload?.vote_targets?.length !==
        0 ||
      privateReloadAfterReject.apiThreadPostBodiesAfterReload.includes(postBody) ||
      staleOutgoingRouteAfterReject.status !== 403 ||
      staleOutgoingRouteAfterReject.responseStatus !== 403 ||
      !staleOutgoingRouteAfterReject.message.includes(
        "requires scoped channel capability",
      ) ||
      staleOutgoingThreadAfterReject.status !== 403 ||
      privateReloadAfterReject.staleOutgoingRouteAfterReload?.status !== 403 ||
      privateReloadAfterReject.staleOutgoingThreadAfterReload?.status !== 403
    ) {
      throw new Error(
        `stale replacement private-post after complete proof drifted: ${JSON.stringify({
          completeGame,
          replacement,
          hostReplacementAfterProcess,
          commandStateBeforeClose,
          channelContextBeforeClose,
          buttonsBeforeClose,
          submitPostBeforeClose,
          closedStatus,
          complete,
          hostSlotsAfterComplete,
          hostActionsAfterComplete,
          apiStateAfterComplete,
          reject,
          commandStateAfterReject,
          channelContextAfterReject,
          buttonsAfterReject,
          dispatchPlan,
          currentReceipt,
          receiptStatusText,
          apiCommandStateAfterReject,
          apiThreadPostBodies,
          privateReloadAfterReject,
          staleOutgoingRouteAfterReject,
          staleOutgoingThreadAfterReject,
          postBody,
        })}`,
      );
    }

    return {
      status: "passed",
      game: completeGame,
      channel: scenario.channelId,
      seed,
      hostEntry: hostEntry.verification,
      staleOutgoingEntry: staleOutgoingEntry.verification,
      replacementEntry: replacementEntry.verification,
      replacement,
      hostReplacementAfterProcess,
      commandStateBeforeClose,
      channelContextBeforeClose,
      buttonsBeforeClose,
      submitPostBeforeClose,
      closedStatus,
      complete,
      hostSlotsAfterComplete,
      hostActionsAfterComplete,
      apiStateAfterComplete,
      postBody,
      reject,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      commandStateAfterReject,
      channelContextAfterReject,
      buttonsAfterReject,
      apiCommandStateAfterReject,
      apiThreadAfterReject,
      apiThreadPostBodies,
      privateReloadAfterReject,
      staleOutgoingRouteAfterReject,
      staleOutgoingThreadAfterReject,
      outcomeSummary: scenario.outcomeSummary,
      proof:
        "After Rowan replaced into Slot 7 and froze the private mafia channel route, the host role URL completed the game, then Rowan's stale private SubmitPost rejected GameAlreadyCompleted while refreshing to completed-game command state with disabled controls; Rowan then reloaded the private channel route into completed-game disabled controls and Mira's outgoing role still could not read the private channel.",
    };
  } finally {
    await replacementEntry?.context?.close().catch(() => {});
    await staleOutgoingEntry.context.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
  }
}

async function seedReplacementPrivatePostRaceGame({ raceGame }) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(raceGame)) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent replacement private-post seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function verifyConcurrentReplacementVoteRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementConcurrentVoteRaceScenario();
  if (browser === null || browser === undefined) {
    throw new Error("concurrent replacement vote proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const seed = await seedReplacementVoteRaceGame({ raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const stalePlayerSession = await createAccountLoginCredential({
    principalUserId: scenario.staleOutgoingPrincipalUserId,
    returnTo: `/g/${raceGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: stalePlayerSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  try {
    await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      gotoPlayerBoard(playerEntry.page, raceGame),
    ]);
    await Promise.all([
      hostEntry.page.waitForFunction(
        ({ actorSlot, occupantLabel }) =>
          window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
          window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
        {
          actorSlot: scenario.actorSlot,
          occupantLabel: scenario.staleOutgoingPrincipalUserId,
        },
      ),
      playerEntry.page.waitForFunction(
        ({ actorSlot, targetSlot }) =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
          window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
          window.__fmarchPlayerProjection?.commandState?.voteTargets?.some(
            (target) => target.kind === "slot" && target.slotId === targetSlot,
          ),
        { actorSlot: scenario.actorSlot, targetSlot: scenario.targetSlot },
      ),
    ]);
    const setupHostReplacement = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );
    const setupCommandState = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(playerEntry.page);
    const targetSlot = scenario.targetSlot;
    const voteCommandId = crypto.randomUUID();
    const replacementCommandId = crypto.randomUUID();
    const [voteRaw, replacementRaw] = await Promise.all([
      sendBrowserCommand(playerEntry.page, {
        principalUserId: scenario.staleOutgoingPrincipalUserId,
        commandId: voteCommandId,
        command: {
          SubmitVote: {
            game: raceGame,
            actor_slot: scenario.actorSlot,
            target: { Slot: targetSlot },
          },
        },
      }),
      sendBrowserCommand(hostEntry.page, {
        principalUserId: scenario.hostPrincipalUserId,
        commandId: replacementCommandId,
        command: {
          ProcessReplacement: {
            game: raceGame,
            slot: scenario.actorSlot,
            outgoing_user: scenario.staleOutgoingPrincipalUserId,
            incoming_user: scenario.replacementPrincipalUserId,
          },
        },
      }),
    ]);
    const vote = normalizeCommandResponse({
      commandId: voteCommandId,
      requestEnvelope: voteRaw.requestEnvelope,
      response: { status: voteRaw.httpStatus },
      serverEnvelope: voteRaw.serverEnvelope,
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    const voteAcked = vote?.state === "ack";
    const voteRejected =
      vote?.state === "reject" && vote?.error === scenario.rejectionError;
    const voteSeq = voteAcked ? vote.streamSeqs?.[0] : null;
    const replacementSeq = replacement?.streamSeqs?.[0] ?? null;
    const acceptedVoteBeforeReplacement =
      voteAcked === true &&
      Number.isInteger(voteSeq) &&
      Number.isInteger(replacementSeq) &&
      voteSeq < replacementSeq;
    if (
      setupHostReplacement?.occupantLabel !==
        scenario.staleOutgoingPrincipalUserId ||
      setupCommandState?.actorSlot !== scenario.actorSlot ||
      setupCommandState?.actorStatus !== "alive" ||
      setupCommandState?.voteTargets?.some(
        (target) => target.kind === "slot" && target.slotId === targetSlot,
      ) !== true ||
      setupButtons.some(
        (button) =>
          button.action?.startsWith(scenario.commandActionPrefix) &&
          button.disabled === false,
      ) !== true ||
      replacement?.state !== "ack" ||
      replacement?.serverEnvelope?.body?.kind !== "Ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.game !==
        raceGame ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.outgoing_user !== scenario.staleOutgoingPrincipalUserId ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      vote?.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !==
        scenario.actorSlot ||
      vote?.requestEnvelope?.body?.body?.command?.SubmitVote?.target?.Slot !==
        targetSlot ||
      (acceptedVoteBeforeReplacement !== true && voteRejected !== true)
    ) {
      throw new Error(
        `concurrent replacement vote race outcomes drifted: ${JSON.stringify({
          raceGame,
          targetSlot,
          setupHostReplacement,
          setupCommandState,
          setupButtons,
          vote,
          replacement,
          voteSeq,
          replacementSeq,
        })}`,
      );
    }

    await hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.waitForFunction(
      ({ actorSlot, occupantLabel }) =>
        window.__fmarchHostProjection?.replacement?.slotId === actorSlot &&
        window.__fmarchHostProjection?.replacement?.occupantLabel === occupantLabel,
      {
        actorSlot: scenario.actorSlot,
        occupantLabel: scenario.replacementOccupantLabel,
      },
    );
    const hostReplacementAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.replacement,
    );
    const apiCommandStateAfterRace = await fetchJsonStatus(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const commandStateAfterRace = {
      status: apiCommandStateAfterRace.status,
      error: apiCommandStateAfterRace.body?.error,
      message: apiCommandStateAfterRace.body?.message,
    };
    const apiSlotAfterRace = (
      await fetchHostConsoleState({
        apiBaseUrl,
        game: raceGame,
        slot: scenario.actorSlot,
      })
    ).slots?.find?.((slot) => slot.slot_id === scenario.actorSlot);
    const apiVotecountAfterRace = await fetchJson(
      `${apiBaseUrl}/games/${raceGame}/votecount`,
    );
    const targetVotecount = normalizedVotecountRows(apiVotecountAfterRace).find(
      (row) => row.phaseId === "D01" && row.target === targetSlot,
    );
    if (
      commandStateAfterRace?.status !== 403 ||
      commandStateAfterRace?.error !== scenario.rejectionError ||
      hostReplacementAfterRace?.occupantLabel !==
        scenario.replacementOccupantLabel ||
      apiSlotAfterRace?.occupant_user_id !== scenario.replacementPrincipalUserId ||
      (voteAcked === true && targetVotecount?.count !== 1) ||
      (voteAcked === false && targetVotecount !== undefined)
    ) {
      throw new Error(
        `concurrent replacement vote convergence drifted: ${JSON.stringify({
          raceGame,
          targetSlot,
          vote,
          replacement,
          commandStateAfterRace,
          hostReplacementAfterRace,
          apiCommandStateAfterRace,
          apiSlotAfterRace,
          apiVotecountAfterRace,
          targetVotecount,
        })}`,
      );
    }
    const outcomeSummary = voteAcked
      ? `vote seq ${voteSeq} before replacement seq ${replacementSeq}`
      : `vote rejected ${scenario.rejectionError} after replacement`;
    return {
      status: "passed",
      game: raceGame,
      seed,
      targetSlot,
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      setupHostReplacement,
      setupCommandState,
      setupButtons,
      vote,
      replacement,
      voteSeq,
      replacementSeq,
      outcomeSummary,
      commandStateAfterRace,
      hostReplacementAfterRace,
      apiCommandStateAfterRace,
      apiSlotAfterRace,
      apiVotecountAfterRace,
      targetVotecount: targetVotecount ?? null,
      proof:
        scenario.proof,
    };
  } finally {
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function seedReplacementVoteRaceGame({ raceGame }) {
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlanForGame(raceGame)) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent replacement vote seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function verifyConcurrentReplacementActionRace({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementConcurrentActionRaceScenario();
  if (browser === null || browser === undefined) {
    throw new Error("concurrent replacement action proof requires a Playwright browser");
  }
  const raceGame = crypto.randomUUID();
  const seed = await seedReplacementActionRaceGame({ raceGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${raceGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const stalePlayerSession = await createAccountLoginCredential({
    principalUserId: scenario.staleOutgoingPrincipalUserId,
    returnTo: `/g/${raceGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const playerEntry = await openVerifiedRoleEntry({
    browser,
    session: stalePlayerSession,
    game: raceGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  try {
    await Promise.all([
      hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
        waitUntil: "networkidle",
      }),
      gotoPlayerBoard(playerEntry.page, raceGame),
    ]);
    await Promise.all([
      waitForHostProjectionPhase(hostEntry.page, {
        phaseId: scenario.phaseId,
        locked: false,
      }),
      playerEntry.page.waitForFunction(
        ({ actorSlot, phaseId, templateId }) =>
          window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
          window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
          window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
          window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
          window.__fmarchPlayerProjection?.commandState?.actions?.some(
            (action) => action.templateId === templateId,
          ),
        {
          actorSlot: scenario.actorSlot,
          phaseId: scenario.phaseId,
          templateId: scenario.templateId,
        },
      ),
    ]);
    const setupHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupCommandState = await playerEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const setupButtons = await playerCommandButtons(playerEntry.page);
    const setupSlot = (
      await fetchHostConsoleState({
        apiBaseUrl,
        game: raceGame,
        slot: scenario.actorSlot,
      })
    ).slots?.find?.((slot) => slot.slot_id === scenario.actorSlot);
    const targetSlot = scenario.targetSlot;
    const actionCommandId = crypto.randomUUID();
    const replacementCommandId = crypto.randomUUID();
    const [actionRaw, replacementRaw] = await Promise.all([
      sendBrowserCommand(playerEntry.page, {
        principalUserId: scenario.staleOutgoingPrincipalUserId,
        commandId: actionCommandId,
        command: {
          SubmitAction: {
            game: raceGame,
            action_id: scenario.actionId,
            actor_slot: scenario.actorSlot,
            template_id: scenario.templateId,
            targets: [targetSlot],
          },
        },
      }),
      sendBrowserCommand(hostEntry.page, {
        principalUserId: scenario.hostPrincipalUserId,
        commandId: replacementCommandId,
        command: {
          ProcessReplacement: {
            game: raceGame,
            slot: scenario.actorSlot,
            outgoing_user: scenario.staleOutgoingPrincipalUserId,
            incoming_user: scenario.replacementPrincipalUserId,
          },
        },
      }),
    ]);
    const action = normalizeCommandResponse({
      commandId: actionCommandId,
      requestEnvelope: actionRaw.requestEnvelope,
      response: { status: actionRaw.httpStatus },
      serverEnvelope: actionRaw.serverEnvelope,
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    const actionAcked = action?.state === "ack";
    const actionRejected =
      action?.state === "reject" && action?.error === scenario.rejectionError;
    const actionSeq = actionAcked ? action.streamSeqs?.[0] : null;
    const replacementSeq = replacement?.streamSeqs?.[0] ?? null;
    const acceptedActionBeforeReplacement =
      actionAcked === true &&
      Number.isInteger(actionSeq) &&
      Number.isInteger(replacementSeq) &&
      actionSeq < replacementSeq;
    if (
      setupHostPhase?.id !== scenario.phaseId ||
      setupHostPhase?.locked !== false ||
      setupSlot?.occupant_user_id !== scenario.staleOutgoingPrincipalUserId ||
      setupCommandState?.actorSlot !== scenario.actorSlot ||
      setupCommandState?.actorStatus !== "alive" ||
      setupCommandState?.phase?.phaseId !== scenario.phaseId ||
      setupCommandState?.actions?.some(
        (candidate) => candidate.templateId === scenario.templateId,
      ) !== true ||
      setupButtons.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) !== true ||
      replacement?.state !== "ack" ||
      replacement?.serverEnvelope?.body?.kind !== "Ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.game !==
        raceGame ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.outgoing_user !== scenario.staleOutgoingPrincipalUserId ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot !==
        scenario.actorSlot ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id !==
        scenario.templateId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] !==
        targetSlot ||
      (acceptedActionBeforeReplacement !== true && actionRejected !== true)
    ) {
      throw new Error(
        `concurrent replacement action race outcomes drifted: ${JSON.stringify({
          raceGame,
          targetSlot,
          setupHostPhase,
          setupSlot,
          setupCommandState,
          setupButtons,
          action,
          replacement,
          actionSeq,
          replacementSeq,
        })}`,
      );
    }

    await hostEntry.page.goto(`${frontendBaseUrl}/g/${raceGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostEntry.page.waitForFunction(
      (phaseId) =>
        window.__fmarchHostProjection?.phase?.id === phaseId &&
        window.__fmarchHostProjection?.phase?.locked === false,
      scenario.phaseId,
    );
    const hostPhaseAfterRace = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const apiCommandStateAfterRace = await fetchJsonStatus(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const commandStateAfterRace = {
      status: apiCommandStateAfterRace.status,
      error: apiCommandStateAfterRace.body?.error,
      message: apiCommandStateAfterRace.body?.message,
    };
    const retryCommandId = crypto.randomUUID();
    const staleRetryRaw = await sendBrowserCommand(playerEntry.page, {
      principalUserId: scenario.staleOutgoingPrincipalUserId,
      commandId: retryCommandId,
      command: {
        SubmitAction: {
          game: raceGame,
          action_id: scenario.staleRetryActionId,
          actor_slot: scenario.actorSlot,
          template_id: scenario.templateId,
          targets: [targetSlot],
        },
      },
    });
    const staleRetry = normalizeCommandResponse({
      commandId: retryCommandId,
      requestEnvelope: staleRetryRaw.requestEnvelope,
      response: { status: staleRetryRaw.httpStatus },
      serverEnvelope: staleRetryRaw.serverEnvelope,
    });
    const apiSlotAfterRace = (
      await fetchHostConsoleState({
        apiBaseUrl,
        game: raceGame,
        slot: scenario.actorSlot,
      })
    ).slots?.find?.((slot) => slot.slot_id === scenario.actorSlot);
    const apiCurrentCommandStateStatus = await fetchJsonStatus(
      `${apiBaseUrl}/games/${raceGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const currentCommandStateAfterRace = apiCurrentCommandStateStatus.body;
    const replacementSession = await createAccountLoginCredential({
      principalUserId: scenario.replacementPrincipalUserId,
      returnTo: `/g/${raceGame}`,
      expectedCapabilityKind: "SlotOccupant",
    });
    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: raceGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    await gotoPlayerBoard(replacementEntry.page, raceGame);
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId,
      { actorSlot: scenario.actorSlot, phaseId: scenario.phaseId },
    );
    const currentRoleCommandState = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const currentRoleButtons = await playerCommandButtons(replacementEntry.page);
    const currentHasAction =
      currentCommandStateAfterRace?.actions?.some(
        (candidate) => candidate.template_id === scenario.templateId,
      ) === true;
    const currentRoleHasAction =
      currentRoleCommandState?.actions?.some(
        (candidate) => candidate.templateId === scenario.templateId,
      ) === true;
    if (
      hostPhaseAfterRace?.id !== scenario.phaseId ||
      hostPhaseAfterRace?.locked !== false ||
      commandStateAfterRace?.status !== 403 ||
      commandStateAfterRace?.error !== scenario.rejectionError ||
      staleRetry?.state !== "reject" ||
      staleRetry?.error !== scenario.rejectionError ||
      staleRetry?.serverEnvelope?.body?.kind !== "Reject" ||
      apiSlotAfterRace?.occupant_user_id !== scenario.replacementPrincipalUserId ||
      apiCurrentCommandStateStatus.status !== 200 ||
      currentCommandStateAfterRace?.actor_slot !== scenario.actorSlot ||
      currentCommandStateAfterRace?.actor_status !== "alive" ||
      currentCommandStateAfterRace?.phase?.phase_id !== scenario.phaseId ||
      currentCommandStateAfterRace?.phase?.locked !== false ||
      currentRoleCommandState?.actorSlot !== scenario.actorSlot ||
      currentRoleCommandState?.actorStatus !== "alive" ||
      currentRoleCommandState?.phase?.phaseId !== scenario.phaseId ||
      currentRoleCommandState?.phase?.locked !== false ||
      currentHasAction !== !actionAcked ||
      currentRoleHasAction !== !actionAcked ||
      currentRoleButtons.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) !== !actionAcked
    ) {
      throw new Error(
        `concurrent replacement action convergence drifted: ${JSON.stringify({
          raceGame,
          targetSlot,
          action,
          replacement,
          commandStateAfterRace,
          staleRetry,
          hostPhaseAfterRace,
          apiSlotAfterRace,
          apiCurrentCommandStateStatus,
          currentCommandStateAfterRace,
          currentRoleCommandState,
          currentRoleButtons,
          actionAcked,
        })}`,
      );
    }
    const outcomeSummary = actionAcked
      ? `action seq ${actionSeq} before replacement seq ${replacementSeq}`
      : `action rejected ${scenario.rejectionError} after replacement`;
    return {
      status: "passed",
      game: raceGame,
      seed,
      targetSlot,
      hostEntry: hostEntry.verification,
      playerEntry: playerEntry.verification,
      replacementEntry: replacementEntry.verification,
      setupHostPhase,
      setupSlot,
      setupCommandState,
      setupButtons,
      action,
      replacement,
      actionSeq,
      replacementSeq,
      outcomeSummary,
      commandStateAfterRace,
      staleRetry,
      hostPhaseAfterRace,
      apiCommandStateAfterRace,
      apiSlotAfterRace,
      apiCurrentCommandStateStatus,
      currentCommandStateAfterRace,
      currentRoleCommandState,
      currentRoleButtons,
      proof:
        scenario.proof,
    };
  } finally {
    await replacementEntry?.context?.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
    await playerEntry.context.close().catch(() => {});
  }
}

async function seedReplacementActionRaceGame({ raceGame }) {
  const commands = [];
  const plan = [
    ...seedCommandPlanForGame(raceGame),
    ["host_h", { ResolvePhase: { game: raceGame, seed: 72_501 } }],
    ["host_h", { AdvancePhase: { game: raceGame } }],
  ];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `concurrent replacement action seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: raceGame,
    commands,
  };
}

async function verifyIncomingReplacementActionSubmission({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementIncomingActionScenario();
  if (browser === null || browser === undefined) {
    throw new Error("incoming replacement action proof requires a Playwright browser");
  }
  const actionGame = crypto.randomUUID();
  const seed = await seedIncomingReplacementActionGame({ actionGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${actionGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: actionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  let targetEntry;
  try {
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${actionGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: false,
    });
    const setupHostPhase = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const setupSlot = (
      await fetchHostConsoleState({
        apiBaseUrl,
        game: actionGame,
        slot: scenario.actorSlot,
      })
    ).slots?.find?.((slot) => slot.slot_id === scenario.actorSlot);
    const replacementCommandId = crypto.randomUUID();
    const replacementRaw = await sendBrowserCommand(hostEntry.page, {
      principalUserId: scenario.hostPrincipalUserId,
      commandId: replacementCommandId,
      command: {
        ProcessReplacement: {
          game: actionGame,
          slot: scenario.actorSlot,
          outgoing_user: scenario.staleOutgoingPrincipalUserId,
          incoming_user: scenario.replacementPrincipalUserId,
        },
      },
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    const outgoingCommandStateAfterReplacement = await fetchJsonStatus(
      `${apiBaseUrl}/games/${actionGame}/player-command-state?principal_user_id=${scenario.staleOutgoingPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const replacementSession = await createAccountLoginCredential({
      principalUserId: scenario.replacementPrincipalUserId,
      returnTo: `/g/${actionGame}`,
      expectedCapabilityKind: "SlotOccupant",
    });
    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: actionGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    await gotoPlayerBoard(replacementEntry.page, actionGame);
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId, templateId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        window.__fmarchPlayerProjection?.commandState?.actions?.some(
          (action) => action.templateId === templateId,
        ),
      {
        actorSlot: scenario.actorSlot,
        phaseId: scenario.phaseId,
        templateId: scenario.templateId,
      },
    );
    const currentCommandStateBeforeAction = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const currentButtonsBeforeAction = await playerCommandButtons(replacementEntry.page);
    const actionCommandId = crypto.randomUUID();
    const targetSlot = scenario.targetSlot;
    const actionRaw = await sendBrowserCommand(replacementEntry.page, {
      principalUserId: scenario.replacementPrincipalUserId,
      commandId: actionCommandId,
      command: {
        SubmitAction: {
          game: actionGame,
          action_id: scenario.actionId,
          actor_slot: scenario.actorSlot,
          template_id: scenario.templateId,
          targets: [targetSlot],
        },
      },
    });
    const action = normalizeCommandResponse({
      commandId: actionCommandId,
      requestEnvelope: actionRaw.requestEnvelope,
      response: { status: actionRaw.httpStatus },
      serverEnvelope: actionRaw.serverEnvelope,
    });
    await replacementEntry.page.evaluate(() => window.__fmarchTriggerPlayerResync?.(0));
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
      { actorSlot: scenario.actorSlot, phaseId: scenario.phaseId },
    );
    const currentCommandStateAfterAction = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const currentButtonsAfterAction = await playerCommandButtons(replacementEntry.page);
    const apiCommandStateAfterAction = await fetchJson(
      `${apiBaseUrl}/games/${actionGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );

    const resolveNight = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: true,
    });
    const targetSlotAfterResolve = await fetchResolvedSlotState({
      apiBaseUrl,
      game: actionGame,
      slot: targetSlot,
    });
    const hostPhaseAfterResolve = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const targetSession = await createAccountLoginCredential({
      principalUserId: scenario.targetPrincipalUserId,
      returnTo: `/g/${actionGame}`,
      expectedCapabilityKind: "SlotOccupant",
    });
    targetEntry = await openVerifiedRoleEntry({
      browser,
      session: targetSession,
      game: actionGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    await gotoPlayerBoard(targetEntry.page, actionGame);
    await targetEntry.page.waitForFunction(
      ({ expectedSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === expectedSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
        window.__fmarchPlayerProjection?.notifications?.some(
          (notice) =>
            notice.audience_slot === expectedSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ),
      {
        expectedSlot: targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );
    const targetCommandState = await targetEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const targetNotice = await targetEntry.page.evaluate(
      ({ expectedSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.notifications?.find(
          (notice) =>
            notice.audience_slot === expectedSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ) ?? null,
      {
        expectedSlot: targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );
    await replacementEntry.page.evaluate(() => window.__fmarchTriggerPlayerResync?.(0));
    const replacementNotificationsAfterResolve = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const replacementPrivateIsolation = {
      targetKillVisible: replacementNotificationsAfterResolve.some(
        (notice) =>
          notice.audience_slot === targetSlot ||
          notice.effect === scenario.targetNoticeEffect ||
          notice.status === scenario.templateId,
      ),
      notificationCount: replacementNotificationsAfterResolve.length,
    };
    if (
      setupHostPhase?.id !== scenario.phaseId ||
      setupHostPhase?.locked !== false ||
      setupSlot?.occupant_user_id !== scenario.staleOutgoingPrincipalUserId ||
      replacement?.state !== "ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      outgoingCommandStateAfterReplacement.status !== 403 ||
      outgoingCommandStateAfterReplacement.body?.error !== scenario.staleOutgoingError ||
      currentCommandStateBeforeAction?.actorSlot !== scenario.actorSlot ||
      currentCommandStateBeforeAction?.actorStatus !== "alive" ||
      currentCommandStateBeforeAction?.actions?.some(
        (candidate) => candidate.templateId === scenario.templateId,
      ) !== true ||
      currentButtonsBeforeAction.some(
        (button) =>
          button.action === scenario.commandAction && button.disabled === false,
      ) !== true ||
      action?.state !== "ack" ||
      action?.requestEnvelope?.body?.body?.principal_user_id !==
        scenario.replacementPrincipalUserId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot !==
        scenario.actorSlot ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id !==
        scenario.templateId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] !==
        targetSlot ||
      currentCommandStateAfterAction?.actions?.length !== 0 ||
      currentButtonsAfterAction.some(
        (button) => button.action === scenario.commandAction,
      ) ||
      apiCommandStateAfterAction?.actions?.length !== 0 ||
      resolveNight?.commandStatus?.state !== "ack" ||
      hostPhaseAfterResolve?.id !== scenario.phaseId ||
      hostPhaseAfterResolve?.locked !== true ||
      targetSlotAfterResolve?.alive !== false ||
      targetSlotAfterResolve?.status !== scenario.targetStatusAfterKill ||
      targetCommandState?.actorSlot !== targetSlot ||
      targetCommandState?.actorAlive !== false ||
      targetCommandState?.actorStatus !== "dead" ||
      targetNotice === null ||
      replacementPrivateIsolation.targetKillVisible !== false
    ) {
      throw new Error(
        `incoming replacement action proof drifted: ${JSON.stringify({
          actionGame,
          setupHostPhase,
          setupSlot,
          replacement,
          outgoingCommandStateAfterReplacement,
          currentCommandStateBeforeAction,
          currentButtonsBeforeAction,
          action,
          currentCommandStateAfterAction,
          currentButtonsAfterAction,
          apiCommandStateAfterAction,
          resolveNight,
          hostPhaseAfterResolve,
          targetSlotAfterResolve,
          targetCommandState,
          targetNotice,
          replacementPrivateIsolation,
        })}`,
      );
    }
    return {
      status: "passed",
      game: actionGame,
      seed,
      targetSlot,
      hostEntry: hostEntry.verification,
      replacementEntry: replacementEntry.verification,
      targetEntry: targetEntry.verification,
      setupHostPhase,
      setupSlot,
      replacement,
      outgoingCommandStateAfterReplacement: {
        status: outgoingCommandStateAfterReplacement.status,
        error: outgoingCommandStateAfterReplacement.body?.error,
      },
      currentCommandStateBeforeAction,
      currentButtonsBeforeAction,
      action,
      currentCommandStateAfterAction,
      currentButtonsAfterAction,
      apiCommandStateAfterAction,
      resolveNight,
      hostPhaseAfterResolve,
      targetSlotAfterResolve,
      targetCommandState,
      targetNotice,
      replacementPrivateIsolation,
      outcomeSummary: scenario.outcomeSummary,
      proof: scenario.proof,
    };
  } finally {
    await targetEntry?.context?.close().catch(() => {});
    await replacementEntry?.context?.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
  }
}

async function seedIncomingReplacementActionGame({ actionGame }) {
  const commands = [];
  const plan = [
    ...seedCommandPlanForGame(actionGame),
    ["host_h", { ResolvePhase: { game: actionGame, seed: 72_502 } }],
    ["host_h", { AdvancePhase: { game: actionGame } }],
  ];
  for (const [principalUserId, command] of plan) {
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      throw new Error(
        `incoming replacement action seed command rejected: ${JSON.stringify({
          principalUserId,
          command,
          result,
        })}`,
      );
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return {
    game: actionGame,
    commands,
  };
}

async function verifyReplacementActionReconnectRecovery({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementActionReconnectScenario();
  if (browser === null || browser === undefined) {
    throw new Error("replacement action reconnect proof requires a Playwright browser");
  }
  const actionGame = crypto.randomUUID();
  const seed = await seedIncomingReplacementActionGame({ actionGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${actionGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const replacementSession = await createAccountLoginCredential({
    principalUserId: scenario.replacementPrincipalUserId,
    returnTo: `/g/${actionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const targetSession = await createAccountLoginCredential({
    principalUserId: scenario.targetPrincipalUserId,
    returnTo: `/g/${actionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: actionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const targetEntry = await openVerifiedRoleEntry({
    browser,
    session: targetSession,
    game: actionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  try {
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${actionGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: false,
    });
    const replacementCommandId = crypto.randomUUID();
    const replacementRaw = await sendBrowserCommand(hostEntry.page, {
      principalUserId: scenario.hostPrincipalUserId,
      commandId: replacementCommandId,
      command: {
        ProcessReplacement: {
          game: actionGame,
          slot: scenario.actorSlot,
          outgoing_user: scenario.staleOutgoingPrincipalUserId,
          incoming_user: scenario.replacementPrincipalUserId,
        },
      },
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: actionGame,
      apiBaseUrl,
      frontendBaseUrl,
    });

    await gotoPlayerBoard(replacementEntry.page, actionGame);
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId, templateId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        window.__fmarchPlayerProjection?.commandState?.actions?.some(
          (action) => action.templateId === templateId,
        ),
      {
        actorSlot: scenario.actorSlot,
        phaseId: scenario.phaseId,
        templateId: scenario.templateId,
      },
    );
    const commandStateBeforeAction = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const targetSlot = scenario.targetSlot;
    const actionCommandId = crypto.randomUUID();
    const actionRaw = await sendBrowserCommand(replacementEntry.page, {
      principalUserId: scenario.replacementPrincipalUserId,
      commandId: actionCommandId,
      command: {
        SubmitAction: {
          game: actionGame,
          action_id: scenario.actionId,
          actor_slot: scenario.actorSlot,
          template_id: scenario.templateId,
          targets: [targetSlot],
        },
      },
    });
    const action = normalizeCommandResponse({
      commandId: actionCommandId,
      requestEnvelope: actionRaw.requestEnvelope,
      response: { status: actionRaw.httpStatus },
      serverEnvelope: actionRaw.serverEnvelope,
    });
    const resolveNight = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: true,
    });
    const targetSlotAfterResolve = await fetchResolvedSlotState({
      apiBaseUrl,
      game: actionGame,
      slot: targetSlot,
    });

    await gotoPlayerBoard(targetEntry.page, actionGame);
    await targetEntry.page.waitForFunction(
      ({ expectedSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === expectedSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === false &&
        window.__fmarchPlayerProjection?.notifications?.some(
          (notice) =>
            notice.audience_slot === expectedSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ),
      {
        expectedSlot: targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );
    const targetCommandState = await targetEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const targetNoticeBeforeReconnect = await targetEntry.page.evaluate(
      ({ expectedSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.notifications?.find(
          (notice) =>
            notice.audience_slot === expectedSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ) ?? null,
      {
        expectedSlot: targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );

    const reconnect = await verifyRoleReconnectRecovery({
      page: replacementEntry.page,
      game: actionGame,
      principalUserId: scenario.replacementPrincipalUserId,
      actorSlot: scenario.actorSlot,
      postPrefix: scenario.reconnectPostPrefix,
    });
    const commandStateAfterReconnect = reconnect.recoveredCommandState;
    const buttonsAfterReconnect = await playerCommandButtons(replacementEntry.page);
    const rowanNotificationsAfterReconnect = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const rowanPrivateIsolationAfterReconnect = {
      targetKillVisible: rowanNotificationsAfterReconnect.some(
        (notice) =>
          notice.audience_slot === targetSlot ||
          notice.effect === scenario.targetNoticeEffect ||
          notice.status === scenario.templateId,
      ),
      notificationCount: rowanNotificationsAfterReconnect.length,
    };
    const targetNoticeAfterReconnect = await targetEntry.page.evaluate(
      ({ expectedSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.notifications?.find(
          (notice) =>
            notice.audience_slot === expectedSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ) ?? null,
      {
        expectedSlot: targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );
    if (
      replacement?.state !== "ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      commandStateBeforeAction?.actorSlot !== scenario.actorSlot ||
      commandStateBeforeAction?.actions?.some(
        (candidate) => candidate.templateId === scenario.templateId,
      ) !== true ||
      action?.state !== "ack" ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.actor_slot !==
        scenario.actorSlot ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.action_id !==
        scenario.actionId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.template_id !==
        scenario.templateId ||
      action?.requestEnvelope?.body?.body?.command?.SubmitAction?.targets?.[0] !==
        targetSlot ||
      resolveNight?.commandStatus?.state !== "ack" ||
      targetSlotAfterResolve?.alive !== false ||
      targetSlotAfterResolve?.status !== scenario.targetStatusAfterKill ||
      targetCommandState?.actorSlot !== targetSlot ||
      targetCommandState?.actorAlive !== false ||
      targetNoticeBeforeReconnect === null ||
      reconnect?.status !== "passed" ||
      reconnect?.principalUserId !== scenario.replacementPrincipalUserId ||
      reconnect?.actorSlot !== scenario.actorSlot ||
      reconnect?.reconnectingStatus?.state !== "reconnecting" ||
      reconnect?.reconnectRecoveryEvent?.state !== "recovered" ||
      reconnect?.reconnectRecoveryEvent?.attempt !== 1 ||
      reconnect?.recoveredSnapshotContainsPost !== true ||
      reconnect?.reconnectCommand?.principalUserId !==
        scenario.replacementPrincipalUserId ||
      reconnect?.reconnectCommand?.command?.SubmitPost?.actor_slot !==
        scenario.actorSlot ||
      commandStateAfterReconnect?.actorSlot !== scenario.actorSlot ||
      commandStateAfterReconnect?.actorAlive !== true ||
      commandStateAfterReconnect?.actorStatus !== "alive" ||
      commandStateAfterReconnect?.phase?.phaseId !== scenario.phaseId ||
      commandStateAfterReconnect?.phase?.locked !== true ||
      commandStateAfterReconnect?.actions?.length !== 0 ||
      buttonsAfterReconnect.some(
        (button) => button.action === scenario.commandAction,
      ) ||
      rowanPrivateIsolationAfterReconnect.targetKillVisible !== false ||
      targetNoticeAfterReconnect === null
    ) {
      throw new Error(
        `replacement action reconnect proof drifted: ${JSON.stringify({
          actionGame,
          replacement,
          commandStateBeforeAction,
          action,
          resolveNight,
          targetSlotAfterResolve,
          targetCommandState,
          targetNoticeBeforeReconnect,
          reconnect,
          commandStateAfterReconnect,
          buttonsAfterReconnect,
          rowanPrivateIsolationAfterReconnect,
          targetNoticeAfterReconnect,
        })}`,
      );
    }
    return {
      status: "passed",
      game: actionGame,
      seed,
      targetSlot,
      hostEntry: hostEntry.verification,
      replacementEntry: replacementEntry.verification,
      targetEntry: targetEntry.verification,
      replacement,
      commandStateBeforeAction,
      action,
      resolveNight,
      targetSlotAfterResolve,
      targetCommandState,
      targetNoticeBeforeReconnect,
      reconnect,
      commandStateAfterReconnect,
      buttonsAfterReconnect,
      rowanPrivateIsolationAfterReconnect,
      targetNoticeAfterReconnect,
      outcomeSummary: scenario.outcomeSummary,
      proof: scenario.proof,
    };
  } finally {
    await targetEntry.context.close().catch(() => {});
    await replacementEntry?.context?.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
  }
}

async function verifyStaleReplacementActionAfterResolve({
  browser,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const scenario = replacementStaleActionAfterResolveScenario();
  if (browser === null || browser === undefined) {
    throw new Error("stale replacement action proof requires a Playwright browser");
  }
  const actionGame = crypto.randomUUID();
  const seed = await seedIncomingReplacementActionGame({ actionGame });
  const hostSession = await createAccountLoginCredential({
    principalUserId: scenario.hostPrincipalUserId,
    returnTo: `/g/${actionGame}/host`,
    expectedCapabilityKind: "HostOf",
  });
  const replacementSession = await createAccountLoginCredential({
    principalUserId: scenario.replacementPrincipalUserId,
    returnTo: `/g/${actionGame}`,
    expectedCapabilityKind: "SlotOccupant",
  });
  const hostEntry = await openVerifiedRoleEntry({
    browser,
    session: hostSession,
    game: actionGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  let replacementEntry;
  let targetEntry;
  try {
    await hostEntry.page.goto(`${frontendBaseUrl}/g/${actionGame}/host`, {
      waitUntil: "networkidle",
    });
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: false,
    });
    const replacementCommandId = crypto.randomUUID();
    const replacementRaw = await sendBrowserCommand(hostEntry.page, {
      principalUserId: scenario.hostPrincipalUserId,
      commandId: replacementCommandId,
      command: {
        ProcessReplacement: {
          game: actionGame,
            slot: scenario.actorSlot,
            outgoing_user: scenario.staleOutgoingPrincipalUserId,
            incoming_user: scenario.replacementPrincipalUserId,
        },
      },
    });
    const replacement = normalizeCommandResponse({
      commandId: replacementCommandId,
      requestEnvelope: replacementRaw.requestEnvelope,
      response: { status: replacementRaw.httpStatus },
      serverEnvelope: replacementRaw.serverEnvelope,
    });
    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game: actionGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    await gotoPlayerBoard(replacementEntry.page, actionGame);
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId, templateId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorStatus === "alive" &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === false &&
        window.__fmarchPlayerProjection?.commandState?.actions?.some(
          (action) => action.templateId === templateId,
        ),
      {
        actorSlot: scenario.actorSlot,
        phaseId: scenario.phaseId,
        templateId: scenario.templateId,
      },
    );
    const commandStateBeforeClose = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const buttonsBeforeClose = await playerCommandButtons(replacementEntry.page);
    const actionButtonBeforeClose = buttonsBeforeClose.find(
      (button) =>
        button.action === scenario.commandAction && button.disabled === false,
    );
    await replacementEntry.page.waitForFunction(
      () => typeof window.__fmarchClosePlayerLiveProjection === "function",
    );
    const closedStatus = await replacementEntry.page.evaluate(
      () => window.__fmarchClosePlayerLiveProjection(),
    );

    const resolveNight = await confirmHostAction(hostEntry.page, "resolve_phase");
    await waitForHostProjectionPhase(hostEntry.page, {
      phaseId: scenario.phaseId,
      locked: true,
    });
    const hostPhaseAfterResolve = await hostEntry.page.evaluate(
      () => window.__fmarchHostProjection?.phase,
    );
    const hostPhaseActionsAfterResolve = await visibleHostPhaseActions(hostEntry.page);
    const targetSlotAfterResolve = await fetchResolvedSlotState({
      apiBaseUrl,
      game: actionGame,
      slot: scenario.targetSlot,
    });

    await replacementEntry.page
      .locator(`[data-action="${scenario.commandAction}"]`)
      .click();
    const replacementActionConfirm = replacementEntry.page.locator(
      `[data-testid="player-action-confirm-${scenario.templateId}"]`,
    );
    await replacementActionConfirm.waitFor({ state: "visible" });
    await replacementActionConfirm.click();
    await replacementEntry.page.waitForFunction(
      ({ staleActionId, rejectionError }) =>
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitAction?.action_id === staleActionId &&
        window.__fmarchPlayerCommandStatus?.state === "reject" &&
        window.__fmarchPlayerCommandStatus?.error === rejectionError,
      {
        staleActionId: scenario.staleActionId,
        rejectionError: scenario.rejectionError,
      },
    );
    await replacementEntry.page.waitForFunction(
      ({ actorSlot, phaseId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === actorSlot &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true &&
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
      { actorSlot: scenario.actorSlot, phaseId: scenario.phaseId },
    );
    await replacementEntry.page.waitForFunction(
      (commandAction) =>
        document.querySelector(`[data-action="${commandAction}"]`) === null,
      scenario.commandAction,
    );
    const reject = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const commandStateAfterReject = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const buttonsAfterReject = await playerCommandButtons(replacementEntry.page);
    const dispatchPlan = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerCommandDispatchBridgePlan,
    );
    const currentReceipt = await replacementEntry.page.evaluate(() =>
      window.__fmarchPlayerCommandReceipts?.find((receipt) => receipt.current === true),
    );
    const receiptStatusText = await replacementEntry.page
      .getByTestId("player-command-status")
      .innerText();
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${actionGame}/player-command-state?principal_user_id=${scenario.replacementPrincipalUserId}&slot_id=${scenario.actorSlot}`,
    );
    const targetSlotAfterReject = await fetchResolvedSlotState({
      apiBaseUrl,
      game: actionGame,
      slot: scenario.targetSlot,
    });
    const rowanNotificationsAfterReject = await replacementEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const rowanPrivateIsolationAfterReject = {
      targetKillVisible: rowanNotificationsAfterReject.some(
        (notice) =>
          notice.audience_slot === scenario.targetSlot ||
          notice.effect === scenario.targetNoticeEffect ||
          notice.status === scenario.templateId,
      ),
      notificationCount: rowanNotificationsAfterReject.length,
    };

    const targetSession = await createAccountLoginCredential({
      principalUserId: scenario.targetPrincipalUserId,
      returnTo: `/g/${actionGame}`,
      expectedCapabilityKind: "SlotOccupant",
    });
    targetEntry = await openVerifiedRoleEntry({
      browser,
      session: targetSession,
      game: actionGame,
      apiBaseUrl,
      frontendBaseUrl,
    });
    await gotoPlayerBoard(targetEntry.page, actionGame);
    await targetEntry.page.waitForFunction(
      ({ targetSlot, phaseId }) =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === targetSlot &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
        window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === phaseId &&
        window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
      { targetSlot: scenario.targetSlot, phaseId: scenario.phaseId },
    );
    const targetCommandStateAfterReject = await targetEntry.page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const targetNoticeAfterReject = await targetEntry.page.evaluate(
      ({ targetSlot, targetNoticeEffect, templateId }) =>
        window.__fmarchPlayerProjection?.notifications?.find(
          (notice) =>
            notice.audience_slot === targetSlot &&
            notice.effect === targetNoticeEffect &&
            notice.status === templateId,
        ) ?? null,
      {
        targetSlot: scenario.targetSlot,
        targetNoticeEffect: scenario.targetNoticeEffect,
        templateId: scenario.templateId,
      },
    );
    const submittedCommand = reject?.requestEnvelope?.body?.body?.command?.SubmitAction;
    if (
      replacement?.state !== "ack" ||
      replacement?.serverEnvelope?.body?.kind !== "Ack" ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement?.slot !==
        scenario.actorSlot ||
      replacement?.requestEnvelope?.body?.body?.command?.ProcessReplacement
        ?.incoming_user !== scenario.replacementPrincipalUserId ||
      commandStateBeforeClose?.actorSlot !== scenario.actorSlot ||
      commandStateBeforeClose?.actorStatus !== "alive" ||
      commandStateBeforeClose?.phase?.phaseId !== scenario.phaseId ||
      commandStateBeforeClose?.phase?.locked !== false ||
      commandStateBeforeClose?.actions?.some(
        (candidate) => candidate.templateId === scenario.templateId,
      ) !== true ||
      actionButtonBeforeClose === undefined ||
      closedStatus?.state !== "closed" ||
      resolveNight?.commandStatus?.state !== "ack" ||
      hostPhaseAfterResolve?.id !== scenario.phaseId ||
      hostPhaseAfterResolve?.locked !== true ||
      hostPhaseActionsAfterResolve.includes("advance_phase") !== true ||
      targetSlotAfterResolve?.slot_id !== scenario.targetSlot ||
      targetSlotAfterResolve?.alive !== true ||
      reject?.state !== "reject" ||
      reject?.error !== scenario.rejectionError ||
      reject?.serverEnvelope?.body?.kind !== "Reject" ||
      Array.isArray(reject?.streamSeqs) ||
      reject?.message?.includes(scenario.staleActionStateMessageFragment) !== true ||
      reject?.message?.includes(scenario.currentActionControlsMessageFragment) !==
        true ||
      submittedCommand?.actor_slot !== scenario.actorSlot ||
      submittedCommand?.action_id !== scenario.staleActionId ||
      submittedCommand?.template_id !== scenario.templateId ||
      dispatchPlan?.projectionRefreshKeys?.includes("notifications") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("investigationResults") !== true ||
      dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
      currentReceipt?.actionId !== scenario.commandAction ||
      currentReceipt?.state !== "reject" ||
      currentReceipt?.commandTrace?.projectionRefreshKeys?.includes("commandState") !==
        true ||
      !receiptStatusText.includes(scenario.rejectionStatusText) ||
      !receiptStatusText.includes(scenario.staleActionStateMessageFragment) ||
      commandStateAfterReject?.actorSlot !== scenario.actorSlot ||
      commandStateAfterReject?.actorAlive !== true ||
      commandStateAfterReject?.actorStatus !== "alive" ||
      commandStateAfterReject?.phase?.phaseId !== scenario.phaseId ||
      commandStateAfterReject?.phase?.locked !== true ||
      commandStateAfterReject?.actions?.length !== 0 ||
      buttonsAfterReject.some(
        (button) => button.action === scenario.commandAction,
      ) ||
      apiCommandStateAfterReject?.actor_slot !== scenario.actorSlot ||
      apiCommandStateAfterReject?.actor_alive !== true ||
      apiCommandStateAfterReject?.actor_status !== "alive" ||
      apiCommandStateAfterReject?.phase?.phase_id !== scenario.phaseId ||
      apiCommandStateAfterReject?.phase?.locked !== true ||
      apiCommandStateAfterReject?.actions?.length !== 0 ||
      targetSlotAfterReject?.slot_id !== scenario.targetSlot ||
      targetSlotAfterReject?.alive !== true ||
      targetSlotAfterReject?.status !== "alive" ||
      rowanPrivateIsolationAfterReject.targetKillVisible !== false ||
      targetCommandStateAfterReject?.actorSlot !== scenario.targetSlot ||
      targetCommandStateAfterReject?.actorAlive !== true ||
      targetCommandStateAfterReject?.actorStatus !== "alive" ||
      targetCommandStateAfterReject?.phase?.phaseId !== scenario.phaseId ||
      targetCommandStateAfterReject?.phase?.locked !== true ||
      targetNoticeAfterReject !== null
    ) {
      throw new Error(
        `stale replacement action after resolve proof drifted: ${JSON.stringify({
          actionGame,
          replacement,
          commandStateBeforeClose,
          buttonsBeforeClose,
          actionButtonBeforeClose,
          closedStatus,
          resolveNight,
          hostPhaseAfterResolve,
          hostPhaseActionsAfterResolve,
          targetSlotAfterResolve,
          reject,
          commandStateAfterReject,
          buttonsAfterReject,
          dispatchPlan,
          currentReceipt,
          receiptStatusText,
          apiCommandStateAfterReject,
          targetSlotAfterReject,
          rowanPrivateIsolationAfterReject,
          targetCommandStateAfterReject,
          targetNoticeAfterReject,
        })}`,
      );
    }
    return {
      status: "passed",
      game: actionGame,
      seed,
      targetSlot: scenario.targetSlot,
      hostEntry: hostEntry.verification,
      replacementEntry: replacementEntry.verification,
      targetEntry: targetEntry.verification,
      replacement,
      commandStateBeforeClose,
      buttonsBeforeClose,
      actionButtonBeforeClose,
      closedStatus,
      resolveNight,
      hostPhaseAfterResolve,
      hostPhaseActionsAfterResolve,
      targetSlotAfterResolve,
      reject,
      commandStateAfterReject,
      buttonsAfterReject,
      dispatchPlan,
      currentReceipt,
      receiptStatusText,
      apiCommandStateAfterReject,
      targetSlotAfterReject,
      rowanPrivateIsolationAfterReject,
      targetCommandStateAfterReject,
      targetNoticeAfterReject,
      outcomeSummary: scenario.outcomeSummary,
      proof: scenario.proof,
    };
  } finally {
    await targetEntry?.context?.close().catch(() => {});
    await replacementEntry?.context?.close().catch(() => {});
    await hostEntry.context.close().catch(() => {});
  }
}

async function verifyStaleDeadTargetVoteRecovery({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
}) {
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
  );
  await playerPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
  );
  const commandStateBeforeClose = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const staleTarget = commandStateBeforeClose?.voteTargets?.find(
    (target) => target.kind === "slot",
  );
  const staleVoteButton = staleTarget
    ? (await playerCommandButtons(playerPage)).find(
        (button) =>
          button.action?.startsWith("submit_vote") &&
          button.text?.includes(staleTarget.label) &&
          button.disabled === false,
      )
    : undefined;
  const currentVoteBeforeClose = await playerPage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  if (
    staleTarget?.slotId === undefined ||
    staleVoteButton === undefined ||
    commandStateBeforeClose?.currentVote !== null ||
    currentVoteBeforeClose.hasVote !== "false"
  ) {
    throw new Error(
      `stale dead-target vote setup drifted: ${JSON.stringify({
        commandStateBeforeClose,
        staleTarget,
        staleVoteButton,
        currentVoteBeforeClose,
      })}`,
    );
  }

  await playerPage.waitForFunction(
    () => typeof window.__fmarchClosePlayerLiveProjection === "function",
  );
  const closedStatus = await playerPage.evaluate(
    () => window.__fmarchClosePlayerLiveProjection(),
  );
  const markDead = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: staleTarget.slotId,
    status: "dead",
  });
  const apiSlotAfterDead = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: staleTarget.slotId,
  });

  await playerPage.locator(`[data-action="${staleVoteButton.action}"]`).click();
  await playerPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "InvalidTarget",
  );
  const reject = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  if (
    !reject.message.includes("vote target is no longer valid") ||
    !reject.message.includes("current vote controls")
  ) {
    throw new Error(`stale dead-target vote message drifted: ${JSON.stringify(reject)}`);
  }
  await playerPage.waitForFunction(
    (targetSlot) =>
      window.__fmarchPlayerProjection?.commandState?.voteTargets?.some(
        (target) => target.kind === "slot" && target.slotId === targetSlot,
      ) === false,
    staleTarget.slotId,
  );
  const commandStateAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const dispatchPlan = await playerPage.evaluate(
    () => window.__fmarchPlayerCommandDispatchBridgePlan,
  );
  const buttonsAfterReject = await playerCommandButtons(playerPage);
  const currentVoteAfterReject = await playerPage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  const apiCommandStateAfterReject = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
  );
  if (
    closedStatus?.state !== "closed" ||
    apiSlotAfterDead?.alive !== false ||
    apiSlotAfterDead?.status !== "dead" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    dispatchPlan?.projectionRefreshKeys?.includes("commandState") !== true ||
    commandStateAfterReject?.currentVote !== null ||
    commandStateAfterReject?.voteTargets?.some(
      (target) => target.kind === "slot" && target.slotId === staleTarget.slotId,
    ) === true ||
    !commandStateAfterReject?.voteTargets?.some((target) => target.kind === "slot") ||
    buttonsAfterReject.some((button) => button.text?.includes(staleTarget.label)) ||
    currentVoteAfterReject.hasVote !== "false" ||
    !currentVoteAfterReject.text.includes("No current vote") ||
    apiCommandStateAfterReject?.vote_targets?.some(
      (target) => target.kind === "slot" && target.slot_id === staleTarget.slotId,
    ) === true
  ) {
    throw new Error(
      `stale dead-target vote recovery drifted: ${JSON.stringify({
        closedStatus,
        staleTarget,
        staleVoteButton,
        markDead,
        apiSlotAfterDead,
        reject,
        commandStateAfterReject,
        dispatchPlan,
        buttonsAfterReject,
        currentVoteAfterReject,
        apiCommandStateAfterReject,
      })}`,
    );
  }

  const restoreAlive = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: staleTarget.slotId,
    status: "alive",
  });
  const apiSlotAfterRestore = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: staleTarget.slotId,
  });
  if (apiSlotAfterRestore?.alive !== true || apiSlotAfterRestore?.status !== "alive") {
    throw new Error(
      `stale dead-target vote cleanup left target dead: ${JSON.stringify({
        staleTarget,
        restoreAlive,
        apiSlotAfterRestore,
      })}`,
    );
  }

  return {
    status: "passed",
    commandStateBeforeClose,
    staleTarget,
    staleVoteButton,
    currentVoteBeforeClose,
    closedStatus,
    markDead,
    apiSlotAfterDead,
    reject,
    commandStateAfterReject,
    apiCommandStateAfterReject,
    dispatchPlan,
    buttonsAfterReject,
    currentVoteAfterReject,
    restoreAlive,
    apiSlotAfterRestore,
    proof:
      "A seeded player role URL froze with a legal D02 vote target, the host marked that target dead, the stale vote click rejected as InvalidTarget with vote-control recovery copy, then commandState refreshed with the dead target removed and the remaining legal vote controls intact before the seed target was restored alive.",
  };
}

async function verifyDeadCurrentVoteRecovery({
  hostPage,
  playerPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () =>
      window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
      window.__fmarchPlayerProjection?.commandState?.actorAlive === true &&
      window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
  );
  const commandStateBeforeVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const target = commandStateBeforeVote?.voteTargets?.find(
    (candidate) => candidate.kind === "slot",
  );
  const voteButton = target
    ? (await playerCommandButtons(playerPage)).find(
        (button) =>
          button.action?.startsWith("submit_vote") &&
          button.text?.includes(target.label) &&
          button.disabled === false,
      )
    : undefined;
  if (target?.slotId === undefined || voteButton === undefined) {
    throw new Error(
      `dead current-vote setup found no legal vote target: ${JSON.stringify({
        commandStateBeforeVote,
        voteButton,
      })}`,
    );
  }

  await playerPage.locator(`[data-action="${voteButton.action}"]`).click();
  await playerPage.waitForFunction(
    (targetSlot) =>
      window.__fmarchPlayerCommandStatus?.state === "ack" &&
      window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
        ?.SubmitVote?.target?.Slot === targetSlot,
    target.slotId,
  );
  await playerPage.waitForFunction(
    (targetSlot) =>
      window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
      window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId === targetSlot &&
      window.__fmarchPlayerProjection?.votecount?.some(
        (row) => row.target === targetSlot && Number(row.count) >= 1,
      ),
    target.slotId,
  );
  const vote = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const commandStateAfterVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const currentVoteAfterVote = await playerPage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  const playerVotecountAfterVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.votecount ?? [],
  );
  const apiVotecountAfterVote = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  const staleHostPublishAfterClearPage = await hostPage.context().newPage();
  const staleHostPublishAfterClearSetup = await freezeStaleHostPublishAfterClearPage({
    staleHostPublishPage: staleHostPublishAfterClearPage,
    game,
    frontendBaseUrl,
    targetSlot: target.slotId,
  });

  const markDead = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: target.slotId,
    status: "dead",
  });
  await playerPage.waitForFunction(
    (targetSlot) =>
      window.__fmarchPlayerProjection?.commandState?.currentVote === null &&
      (window.__fmarchPlayerProjection?.commandState?.voteTargets ?? []).some(
        (candidate) => candidate.kind === "slot" && candidate.slotId === targetSlot,
      ) === false &&
      (window.__fmarchPlayerProjection?.votecount ?? []).some(
        (row) => row.target === targetSlot,
      ) === false,
    target.slotId,
  );
  await hostPage.waitForFunction(
    (targetSlot) =>
      (window.__fmarchHostVotecountProjection ?? []).some(
        (row) => row.target === targetSlot,
      ) === false,
    target.slotId,
  );
  const apiSlotAfterDead = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: target.slotId,
  });
  const commandStateAfterDead = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const currentVoteAfterDead = await playerPage
    .getByTestId("player-current-vote")
    .evaluate((node) => ({
      hasVote: node.getAttribute("data-has-vote"),
      text: node.textContent?.trim() ?? "",
    }));
  const playerVotecountAfterDead = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.votecount ?? [],
  );
  const hostVotecountAfterDead = await hostPage.evaluate(
    () => window.__fmarchHostVotecountProjection ?? [],
  );
  const apiCommandStateAfterDead = await fetchJson(
    `${apiBaseUrl}/games/${game}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
  );
  const apiVotecountAfterDead = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  const staleHostPublishAfterClear = await submitStaleHostPublishAfterClearRecovery({
    staleHostPublishPage: staleHostPublishAfterClearPage,
    staleHostPublishSetup: staleHostPublishAfterClearSetup,
    playerPage,
    apiBaseUrl,
    game,
  });
  await staleHostPublishAfterClearPage.close();
  if (
    vote?.state !== "ack" ||
    commandStateAfterVote?.currentVote?.slotId !== target.slotId ||
    currentVoteAfterVote.hasVote !== "true" ||
    !currentVoteAfterVote.text.includes(target.label) ||
    !normalizedVotecountRows(apiVotecountAfterVote).some(
      (row) => row.target === target.slotId && row.count >= 1,
    ) ||
    markDead?.state !== "ack" ||
    apiSlotAfterDead?.alive !== false ||
    commandStateAfterDead?.currentVote !== null ||
    commandStateAfterDead?.voteTargets?.some(
      (candidate) => candidate.kind === "slot" && candidate.slotId === target.slotId,
    ) === true ||
    currentVoteAfterDead.hasVote !== "false" ||
    !currentVoteAfterDead.text.includes("No current vote") ||
    playerVotecountAfterDead.some((row) => row.target === target.slotId) ||
    hostVotecountAfterDead.some((row) => row.target === target.slotId) ||
    apiCommandStateAfterDead?.current_vote !== null ||
    apiCommandStateAfterDead?.vote_targets?.some(
      (candidate) => candidate.kind === "slot" && candidate.slot_id === target.slotId,
    ) === true ||
    normalizedVotecountRows(apiVotecountAfterDead).some(
      (row) => row.target === target.slotId,
    )
  ) {
    throw new Error(
      `dead current-vote recovery drifted: ${JSON.stringify({
        target,
        vote,
        commandStateAfterVote,
        currentVoteAfterVote,
        playerVotecountAfterVote,
        apiVotecountAfterVote,
        markDead,
        apiSlotAfterDead,
        commandStateAfterDead,
        currentVoteAfterDead,
        hostVotecountAfterDead,
        apiCommandStateAfterDead,
        apiVotecountAfterDead,
      })}`,
    );
  }

  const restoreAlive = await setSlotLifecycleViaHost({
    hostPage,
    game,
    slot: target.slotId,
    status: "alive",
  });
  const apiSlotAfterRestore = await fetchResolvedSlotState({
    apiBaseUrl,
    game,
    slot: target.slotId,
  });
  await playerPage.waitForFunction(
    (targetSlot) =>
      window.__fmarchPlayerProjection?.commandState?.voteTargets?.some(
        (candidate) => candidate.kind === "slot" && candidate.slotId === targetSlot,
      ) === true &&
      window.__fmarchPlayerProjection?.commandState?.currentVote === null,
    target.slotId,
  );
  const commandStateAfterRestore = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  if (
    restoreAlive?.state !== "ack" ||
    apiSlotAfterRestore?.alive !== true ||
    commandStateAfterRestore?.currentVote !== null ||
    commandStateAfterRestore?.voteTargets?.some(
      (candidate) => candidate.kind === "slot" && candidate.slotId === target.slotId,
    ) !== true
  ) {
    throw new Error(
      `dead current-vote cleanup drifted: ${JSON.stringify({
        target,
        restoreAlive,
        apiSlotAfterRestore,
        commandStateAfterRestore,
      })}`,
    );
  }

  return {
    status: "passed",
    commandStateBeforeVote,
    target,
    voteButton,
    vote,
    commandStateAfterVote,
    currentVoteAfterVote,
    playerVotecountAfterVote,
    apiVotecountAfterVote,
    markDead,
    apiSlotAfterDead,
    commandStateAfterDead,
    currentVoteAfterDead,
    playerVotecountAfterDead,
    hostVotecountAfterDead,
    apiCommandStateAfterDead,
    apiVotecountAfterDead,
    staleHostPublishAfterClear,
    restoreAlive,
    apiSlotAfterRestore,
    commandStateAfterRestore,
    proof:
      "The seeded player role URL cast a legal current vote, a stale host Publish count page froze the non-empty votecount, the host marked that voted target dead, player commandState refreshed to currentVote null, player/host/API votecount projections cleared the dead-target ballot, and the stale host publish ACKed only the server-recomputed empty official count before the seed target was restored alive without resurrecting the old vote.",
  };
}

async function verifyConcurrentVoteRace({
  playerPage,
  actionPage,
  game,
  apiBaseUrl,
  normalizeCommandResponse,
}) {
  await gotoPlayerBoard(playerPage, game);
  await gotoPlayerBoard(actionPage, game);
  await Promise.all([
    playerPage.waitForFunction(
      () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
    ),
    actionPage.waitForFunction(
      () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === false,
    ),
  ]);

  const playerCommandStateBeforeVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const actionCommandStateBeforeVote = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState,
  );
  const playerVoteTargets = playerCommandStateBeforeVote?.voteTargets ?? [];
  const actionVoteTargets = actionCommandStateBeforeVote?.voteTargets ?? [];
  const target = playerVoteTargets.find(
    (candidate) =>
      candidate.kind === "slot" &&
      actionVoteTargets.some(
        (actionCandidate) =>
          actionCandidate.kind === "slot" && actionCandidate.slotId === candidate.slotId,
      ),
  );
  if (target === undefined) {
    throw new Error(
      `concurrent vote setup found no common legal target: ${JSON.stringify({
        playerCommandStateBeforeVote,
        actionCommandStateBeforeVote,
      })}`,
    );
  }
  const targetSlot = target.slotId;
  const playerCommandId = crypto.randomUUID();
  const actionCommandId = crypto.randomUUID();
  const playerVoteCommand = {
    SubmitVote: {
      game,
      actor_slot: "slot-7",
      target: { Slot: targetSlot },
    },
  };
  const actionVoteCommand = {
    SubmitVote: {
      game,
      actor_slot: "slot_4",
      target: { Slot: targetSlot },
    },
  };
  const [playerRaw, actionRaw] = await Promise.all([
    sendBrowserCommand(playerPage, {
      principalUserId: "player-mira",
      command: playerVoteCommand,
      commandId: playerCommandId,
    }),
    sendBrowserCommand(actionPage, {
      principalUserId: "player-goon-a",
      command: actionVoteCommand,
      commandId: actionCommandId,
    }),
  ]);
  const playerVote = normalizeCommandResponse({
    commandId: playerCommandId,
    requestEnvelope: playerRaw.requestEnvelope,
    response: { status: playerRaw.httpStatus },
    serverEnvelope: playerRaw.serverEnvelope,
  });
  const actionVote = normalizeCommandResponse({
    commandId: actionCommandId,
    requestEnvelope: actionRaw.requestEnvelope,
    response: { status: actionRaw.httpStatus },
    serverEnvelope: actionRaw.serverEnvelope,
  });
  if (playerVote.state !== "ack" || actionVote.state !== "ack") {
    throw new Error(
      `concurrent votes did not both ack: ${JSON.stringify({ playerVote, actionVote })}`,
    );
  }
  if (sameArray(playerVote.streamSeqs, actionVote.streamSeqs)) {
    throw new Error(
      `concurrent votes reused the same stream seqs: ${JSON.stringify({
        player: playerVote.streamSeqs,
        action: actionVote.streamSeqs,
      })}`,
    );
  }

  await waitForPlayerVotecount(playerPage, { target: targetSlot, count: 2 });
  await actionPage.waitForFunction(() => typeof window.__fmarchTriggerPlayerResync === "function");
  await actionPage.evaluate(() => window.__fmarchTriggerPlayerResync(0));
  await waitForPlayerVotecount(actionPage, { target: targetSlot, count: 2 });
  const apiVotecount = await fetchJson(`${apiBaseUrl}/games/${game}/votecount`);
  const projectedRow = normalizedVotecountRows(apiVotecount).find(
    (row) => row.phaseId === "D02" && row.target === targetSlot,
  );
  if (projectedRow?.count !== 2) {
    throw new Error(
      `concurrent vote API projection did not converge to ${targetSlot}=2: ${JSON.stringify(
        apiVotecount,
      )}`,
    );
  }
  const playerProjection = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.votecount,
  );
  const actionProjection = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.votecount,
  );

  const [playerReload, actionReload] = await Promise.all([
    gotoPlayerBoard(playerPage, game),
    gotoPlayerBoard(actionPage, game),
  ]);
  await Promise.all([
    waitForPlayerVotecount(playerPage, { target: targetSlot, count: 2 }),
    waitForPlayerVotecount(actionPage, { target: targetSlot, count: 2 }),
    playerPage.waitForFunction(
      (expectedTarget) =>
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          expectedTarget,
      targetSlot,
    ),
    actionPage.waitForFunction(
      (expectedTarget) =>
        window.__fmarchPlayerProjection?.commandState?.currentVote?.kind === "slot" &&
        window.__fmarchPlayerProjection?.commandState?.currentVote?.slotId ===
          expectedTarget,
      targetSlot,
    ),
  ]);
  const apiVotecountAfterReload = await fetchJson(
    `${apiBaseUrl}/games/${game}/votecount`,
  );
  const projectedRowAfterReload = normalizedVotecountRows(apiVotecountAfterReload).find(
    (row) => row.phaseId === "D02" && row.target === targetSlot,
  );
  const roleReloadAfterRace = {
    status: "passed",
    playerRouteStatus: playerReload.status,
    actionRouteStatus: actionReload.status,
    playerCommandState: await playerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    actionCommandState: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    ),
    playerCurrentVote: await playerCurrentVoteSnapshot(playerPage),
    actionCurrentVote: await playerCurrentVoteSnapshot(actionPage),
    playerProjection: await playerPage.evaluate(
      () => window.__fmarchPlayerProjection?.votecount,
    ),
    actionProjection: await actionPage.evaluate(
      () => window.__fmarchPlayerProjection?.votecount,
    ),
    apiProjection: projectedRowAfterReload,
  };
  if (
    roleReloadAfterRace.playerRouteStatus !== 200 ||
    roleReloadAfterRace.actionRouteStatus !== 200 ||
    roleReloadAfterRace.playerCommandState?.currentVote?.slotId !== targetSlot ||
    roleReloadAfterRace.actionCommandState?.currentVote?.slotId !== targetSlot ||
    roleReloadAfterRace.playerCurrentVote.hasVote !== "true" ||
    !roleReloadAfterRace.playerCurrentVote.text.includes(target.label) ||
    roleReloadAfterRace.actionCurrentVote.hasVote !== "true" ||
    !roleReloadAfterRace.actionCurrentVote.text.includes(target.label) ||
    !roleReloadAfterRace.playerProjection?.some(
      (row) => row.target === targetSlot && row.count === 2,
    ) ||
    !roleReloadAfterRace.actionProjection?.some(
      (row) => row.target === targetSlot && row.count === 2,
    ) ||
    roleReloadAfterRace.apiProjection?.count !== 2
  ) {
    throw new Error(
      `concurrent vote reload did not preserve ${targetSlot}=2 current-vote truth: ${JSON.stringify(
        roleReloadAfterRace,
      )}`,
    );
  }

  return {
    status: "passed",
    targetSlot,
    target,
    playerCommandStateBeforeVote,
    actionCommandStateBeforeVote,
    playerVote,
    actionVote,
    apiProjection: projectedRow,
    playerProjection,
    actionProjection,
    roleReloadAfterRace,
    proof:
      `The seeded player and action-player role URLs submitted concurrent D02 SubmitVote commands for ${targetSlot} through /commands after deriving it from their current legal vote targets, both ACKed with distinct stream seqs, both browser projections plus the API votecount converged to ${targetSlot} count 2, and both role URLs reloaded to the same current vote plus votecount truth.`,
  };
}

async function fetchResolvedSlotState({ apiBaseUrl, game, slot }) {
  const state = await fetchHostConsoleState({ apiBaseUrl, game, slot });
  return state.slots?.find((candidate) => candidate.slot_id === slot) ?? null;
}

async function gotoPlayerBoard(page, game) {
  const response = await page.goto(`${frontendBaseUrl}/g/${game}`, {
    waitUntil: "networkidle",
  });
  if (response === null || !response.ok()) {
    throw new Error(`player board route failed with ${response?.status() ?? "no response"}`);
  }
  await page.getByTestId("player-surface").waitFor({ state: "visible" });
  return {
    status: response.status(),
    url: page.url(),
  };
}

function rolePathFromUrl(roleUrl) {
  if (typeof roleUrl !== "string" || roleUrl.trim() === "") {
    throw new Error("dev-test-game role proof missing source role URL");
  }
  const parsed = new URL(roleUrl);
  return `${parsed.pathname}${parsed.search}`;
}

async function gotoHostConsole(page, game) {
  const response = await page.goto(`${frontendBaseUrl}/g/${game}/host`, {
    waitUntil: "networkidle",
  });
  if (response === null || !response.ok()) {
    throw new Error(`host console route failed with ${response?.status() ?? "no response"}`);
  }
  await page.getByTestId("host-console-surface").waitFor({ state: "visible" });
  return {
    status: response.status(),
    url: page.url(),
  };
}

async function playerCurrentVoteSnapshot(page) {
  return page.getByTestId("player-current-vote").evaluate((node) => ({
    hasVote: node.getAttribute("data-has-vote"),
    text: node.textContent?.trim() ?? "",
  }));
}

async function waitForPlayerVotecount(page, { target, count }) {
  await page.waitForFunction(
    (expected) =>
      window.__fmarchPlayerProjection?.votecount?.some(
        (row) => row.target === expected.target && row.count === expected.count,
      ),
    { target, count },
  );
}

async function waitForEnabledNoLynchVoteControl(page, actorSlot) {
  try {
    await page.waitForFunction((expectedActorSlot) => {
      const commandState = window.__fmarchPlayerProjection?.commandState;
      const button = document.querySelector('[data-action="submit_vote:no_lynch"]');
      return (
        commandState?.actorSlot === expectedActorSlot &&
        commandState?.actorAlive === true &&
        commandState?.voteTargets?.some((target) => target.kind === "no_lynch") &&
        button !== null &&
        button.disabled === false
      );
    }, actorSlot);
  } catch (error) {
    const evidence = await page.evaluate(() => ({
      href: window.location.href,
      projection: window.__fmarchPlayerProjection ?? null,
      buttons: Array.from(document.querySelectorAll("[data-action]")).map((node) => ({
        action: node.getAttribute("data-action"),
        disabled: node.hasAttribute("disabled"),
        reason: node.getAttribute("data-disabled-reason"),
        text: node.textContent?.trim() ?? "",
      })),
      body: document.body?.innerText?.slice(0, 1000) ?? "",
    }));
    throw new Error(
      `no-lynch vote control did not hydrate for ${actorSlot}: ${JSON.stringify(
        evidence,
      )}`,
      { cause: error },
    );
  }
}

function normalizedVotecountRows(apiVotecount) {
  const rows = Array.isArray(apiVotecount) ? apiVotecount : [];
  return rows
    .map((delta) =>
      delta?.kind === "VoteCountChanged"
        ? delta.body
        : delta?.VoteCountChanged ?? delta?.body?.VoteCountChanged ?? null,
    )
    .filter(Boolean)
    .map((delta) => ({
      target: delta.candidate_slot ?? delta.candidateSlot ?? "unknown",
      phaseId: delta.phase_id ?? delta.phaseId ?? "unknown",
      count: Number(delta.count ?? 0),
      needed: Number(delta.majority ?? 0),
    }));
}

function normalizeDayVoteOutcomeRows(apiDayVoteOutcomes) {
  const rows = Array.isArray(apiDayVoteOutcomes) ? apiDayVoteOutcomes : [];
  return rows
    .map((delta) =>
      delta?.kind === "DayVoteOutcomeApplied"
        ? delta.body
        : delta?.DayVoteOutcomeApplied ??
          delta?.body?.DayVoteOutcomeApplied ??
          (delta?.status !== undefined ? delta : null),
    )
    .filter(Boolean)
    .map((delta) => ({
      phaseId: delta.phase_id ?? delta.phaseId ?? "unknown",
      status: delta.status ?? "unknown",
      winnerSlot: delta.winner_slot ?? delta.winnerSlot ?? null,
      tallies: delta.tallies ?? {},
      majority: Number(delta.majority ?? 0),
    }));
}

function officialVotecountBodyFromRows(phase, rows) {
  const currentRows = Array.isArray(rows) ? rows : [];
  if (currentRows.length === 0) {
    return `Official votecount for ${phase}\n\nNo active ballots.`;
  }
  return [
    `Official votecount for ${phase}`,
    ...currentRows.map((row) => `- ${row.target}: ${row.count}`),
  ].join("\n");
}

async function fetchHostConsoleState({ apiBaseUrl, game, slot, principalUserId = "host_h" }) {
  const params = new URLSearchParams({ principal_user_id: principalUserId });
  if (slot !== undefined) {
    params.set("slot_id", slot);
  }
  return await fetchJson(
    `${apiBaseUrl}/games/${game}/host-console-state?${params.toString()}`,
  );
}

async function confirmHostAction(page, actionId, expectedState = "ack") {
  const actionRoot = page.getByTestId(`critical-host-action-${actionId}`);
  const previousCommandStatus = await page.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });
  await trigger.click();

  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  const confirmationMessage = await actionRoot
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  await clickCriticalHostActionConfirm(actionRoot, {
    actionId,
    expectedState,
    previousCommandStatus,
  });

  await page.waitForFunction(
    ({ expectedActionId, state }) =>
      window.__fmarchHostCommandStatuses?.[expectedActionId]?.state === state,
    { expectedActionId: actionId, state: expectedState },
  );
  const commandStatus = await page.evaluate(
    (expectedActionId) => window.__fmarchHostCommandStatuses?.[expectedActionId],
    actionId,
  );
  return {
    actionId,
    confirmationMessage,
    statusMessage: commandStatus?.message ?? "",
    commandStatus,
  };
}

function resetProofStabilityAudit() {
  proofStabilityAudit = {
    hostConfirmClicks: {
      total: 0,
      firstClickCount: 0,
      concurrentClickCount: 0,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 0,
      byAction: {},
      byRole: {},
      events: [],
    },
  };
}

function ensureProofStabilityAudit() {
  if (proofStabilityAudit === undefined) {
    resetProofStabilityAudit();
  }
  return proofStabilityAudit;
}

function recordCriticalHostActionConfirmClick({
  actionId,
  roleLabel,
  method,
  attempts,
}) {
  const audit = ensureProofStabilityAudit().hostConfirmClicks;
  audit.total += 1;
  audit.maxAttempts = Math.max(audit.maxAttempts, attempts);
  audit.byAction[actionId] = (audit.byAction[actionId] ?? 0) + 1;
  audit.byRole[roleLabel] = (audit.byRole[roleLabel] ?? 0) + 1;
  if (method === "playwright-first") {
    audit.firstClickCount += 1;
    return;
  }
  if (method === "browser-concurrent") {
    audit.concurrentClickCount += 1;
    return;
  } else if (method === "playwright-retry") {
    audit.retryClickCount += 1;
  } else if (method === "dom-fallback") {
    audit.domFallbackCount += 1;
  } else if (method === "force-fallback") {
    audit.forceFallbackCount += 1;
  } else if (method === "failure") {
    audit.failureCount += 1;
  }
  if (audit.events.length < 50) {
    audit.events.push({ actionId, roleLabel, method, attempts });
  }
}

function buildProofStabilityAudit() {
  const audit = ensureProofStabilityAudit().hostConfirmClicks;
  return {
    status: audit.failureCount === 0 ? "passed" : "failed",
    hostConfirmClicks: {
      total: audit.total,
      firstClickCount: audit.firstClickCount,
      concurrentClickCount: audit.concurrentClickCount,
      retryClickCount: audit.retryClickCount,
      domFallbackCount: audit.domFallbackCount,
      forceFallbackCount: audit.forceFallbackCount,
      failureCount: audit.failureCount,
      maxAttempts: audit.maxAttempts,
      byAction: { ...audit.byAction },
      byRole: { ...audit.byRole },
      events: audit.events.map((event) => ({ ...event })),
    },
  };
}

async function clickCriticalHostActionConfirm(
  actionRoot,
  {
    actionId = "unknown",
    roleLabel = "host",
    timeoutMs = 10_000,
    expectedState,
    previousCommandStatus,
  } = {},
) {
  const confirm = actionRoot.getByTestId("critical-host-action-confirm");
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureCriticalHostActionConfirmation(actionRoot, confirm, {
        timeoutMs,
      });
      await confirm.click({ timeout: 5_000 });
      recordCriticalHostActionConfirmClick({
        actionId,
        roleLabel,
        method: attempt === 0 ? "playwright-first" : "playwright-retry",
        attempts: attempt + 1,
      });
      return;
    } catch (error) {
      lastError = error;
      if (
        await recoverSettledCriticalHostActionClick(actionRoot, {
          actionId,
          roleLabel,
          expectedState,
          previousCommandStatus,
          attempts: attempt + 1,
        })
      ) {
        return;
      }
      await delay(100);
    }
  }
  try {
    await ensureCriticalHostActionConfirmation(actionRoot, confirm, {
      timeoutMs,
    });
    await confirm.evaluate((node) => node.click());
    recordCriticalHostActionConfirmClick({
      actionId,
      roleLabel,
      method: "dom-fallback",
      attempts: 4,
    });
    return;
  } catch (error) {
    lastError = error;
  }
  try {
    await ensureCriticalHostActionConfirmation(actionRoot, confirm, {
      timeoutMs,
    });
    await confirm.click({ timeout: 5_000, force: true });
    recordCriticalHostActionConfirmClick({
      actionId,
      roleLabel,
      method: "force-fallback",
      attempts: 5,
    });
    return;
  } catch {
    await throwCriticalHostActionConfirmClickError(actionRoot, {
      actionId,
      roleLabel,
      cause: lastError,
    });
  }
}

async function ensureCriticalHostActionConfirmation(
  actionRoot,
  confirm,
  { timeoutMs },
) {
  if (await confirm.isVisible().catch(() => false)) {
    return;
  }
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible", timeout: timeoutMs });
  await trigger.click({ timeout: timeoutMs });
  await confirm.waitFor({ state: "visible", timeout: timeoutMs });
}

async function recoverSettledCriticalHostActionClick(
  actionRoot,
  {
    actionId,
    roleLabel,
    expectedState,
    previousCommandStatus,
    attempts,
    timeoutMs = 5_000,
  },
) {
  if (expectedState === undefined) {
    return false;
  }
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const commandStatus = await actionRoot
      .evaluate(
        (_node, expectedActionId) =>
          window.__fmarchHostCommandStatuses?.[expectedActionId],
        actionId,
      )
      .catch(() => undefined);
    if (
      hostCommandStatusReachedExpectedState(commandStatus, {
        expectedState,
        previousCommandStatus,
      })
    ) {
      recordCriticalHostActionConfirmClick({
        actionId,
        roleLabel,
        method: "status-settled",
        attempts,
      });
      return true;
    }
    await delay(50);
  }
  return false;
}

export function hostCommandStatusReachedExpectedState(
  commandStatus,
  { expectedState, previousCommandStatus },
) {
  return (
    commandStatus?.state === expectedState &&
    JSON.stringify(commandStatus) !== JSON.stringify(previousCommandStatus)
  );
}

async function clickConcurrentCriticalHostActionConfirms(entries, { timeoutMs = 10_000 } = {}) {
  const prepared = entries.map(({ actionRoot, actionId = "unknown", roleLabel = "host" }) => ({
    actionRoot,
    actionId,
    roleLabel,
    confirm: actionRoot.getByTestId("critical-host-action-confirm"),
  }));
  const visibleResults = await Promise.allSettled(
    prepared.map((entry) => entry.confirm.waitFor({ state: "visible", timeout: timeoutMs })),
  );
  const missingIndex = visibleResults.findIndex((result) => result.status === "rejected");
  if (missingIndex !== -1) {
    const entry = prepared[missingIndex];
    await throwCriticalHostActionConfirmClickError(entry.actionRoot, {
      actionId: entry.actionId,
      roleLabel: entry.roleLabel,
      cause: visibleResults[missingIndex].reason,
    });
  }

  const clickResults = await Promise.allSettled(
    prepared.map((entry) => entry.confirm.evaluate((node) => node.click())),
  );
  const failedIndex = clickResults.findIndex((result) => result.status === "rejected");
  for (let index = 0; index < prepared.length; index += 1) {
    const entry = prepared[index];
    if (clickResults[index].status === "fulfilled") {
      recordCriticalHostActionConfirmClick({
        actionId: entry.actionId,
        roleLabel: entry.roleLabel,
        method: "browser-concurrent",
        attempts: 1,
      });
    }
  }
  if (failedIndex !== -1) {
    const entry = prepared[failedIndex];
    await throwCriticalHostActionConfirmClickError(entry.actionRoot, {
      actionId: entry.actionId,
      roleLabel: entry.roleLabel,
      cause: clickResults[failedIndex].reason,
    });
  }
}

async function throwCriticalHostActionConfirmClickError(
  actionRoot,
  { actionId, roleLabel, cause },
) {
  recordCriticalHostActionConfirmClick({
    actionId,
    roleLabel,
    method: "failure",
    attempts: 0,
  });
  const snapshot = await actionRoot
    .evaluate((node) => ({
      actionId: node.getAttribute("data-action-id"),
      text: node.textContent?.trim() ?? "",
      confirmationVisible:
        node.querySelector('[data-testid="critical-host-action-confirmation"]') !==
        null,
      confirmPresent:
        node.querySelector('[data-testid="critical-host-action-confirm"]') !== null,
      confirmDisabled:
        node
          .querySelector('[data-testid="critical-host-action-confirm"]')
          ?.hasAttribute("disabled") ?? null,
      triggerDisabled:
        node
          .querySelector('[data-testid="critical-host-action-trigger"]')
          ?.hasAttribute("disabled") ?? null,
    }))
    .catch((error) => ({ snapshotError: error.message }));
  throw new Error(
    `critical host action confirm click failed for ${roleLabel} ${actionId}: ${JSON.stringify(
      snapshot,
    )}`,
    { cause },
  );
}

async function importFrontendModule(relativePath) {
  return await import(pathToFileURL(path.join(frontendRoot, relativePath)).href);
}

async function sendBrowserCommand(page, { principalUserId, command, commandId }) {
  const envelopeId = commandEnvelopeId++;
  return await page.evaluate(
    async ({
      principalUserId: browserPrincipalUserId,
      command: browserCommand,
      commandId: browserCommandId,
      envelopeId: browserEnvelopeId,
    }) => {
      const requestEnvelope = {
        v: 1,
        id: browserEnvelopeId,
        body: {
          kind: "Command",
          body: {
            command_id: browserCommandId,
            principal_user_id: browserPrincipalUserId,
            command: browserCommand,
          },
        },
      };
      const response = await fetch("/commands", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestEnvelope),
      });
      return {
        commandId: browserCommandId,
        envelopeId: browserEnvelopeId,
        httpStatus: response.status,
        requestEnvelope,
        serverEnvelope: await response.json(),
      };
    },
    { principalUserId, command, commandId, envelopeId },
  );
}

function sameArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

async function expectHostPhaseActions(page, expectedActions) {
  await page.waitForFunction((expected) => {
    const phaseGroup = document.querySelector('[data-testid="moderator-control-phase"]');
    if (phaseGroup === null) {
      return false;
    }
    const actual = [...phaseGroup.querySelectorAll('[data-testid^="critical-host-action-"]')]
      .map((node) => node.getAttribute("data-testid")?.replace("critical-host-action-", ""))
      .filter(
        (id) =>
          id !== undefined &&
          !["trigger", "confirmation", "confirmation-message", "confirm", "cancel"].includes(id),
      )
      .sort();
    return JSON.stringify(actual) === JSON.stringify([...expected].sort());
  }, expectedActions);
}

async function visibleHostPhaseActions(page) {
  return await visibleHostControlActions(page, "phase");
}

async function visibleHostControlActions(page, controlId) {
  return await page.evaluate((controlId) => {
    const group = document.querySelector(`[data-testid="moderator-control-${controlId}"]`);
    if (group === null) {
      return [];
    }
    return [...group.querySelectorAll('[data-testid^="critical-host-action-"]')]
      .map((node) => node.getAttribute("data-testid")?.replace("critical-host-action-", ""))
      .filter(
        (id) =>
          id !== undefined &&
          !["trigger", "confirmation", "confirmation-message", "confirm", "cancel"].includes(id),
      )
      .sort();
  }, controlId);
}

function hostPromptPolicyActionId(promptId, policyId) {
  return `resolve_host_prompt-${stableHostActionId(promptId)}-${stableHostActionId(policyId)}`;
}

function stableHostActionId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}

async function waitForHostProjectionPhaseLocked(page, locked) {
  await page.waitForFunction(
    (expectedLocked) => window.__fmarchHostProjection?.phase?.locked === expectedLocked,
    locked,
  );
}

async function waitForHostProjectionPhase(page, { phaseId, locked }) {
  await page.waitForFunction(
    (expected) =>
      window.__fmarchHostProjection?.phase?.id === expected.phaseId &&
      window.__fmarchHostProjection?.phase?.locked === expected.locked,
    { phaseId, locked },
  );
}

async function confirmHostPhaseAction(
  page,
  actionId,
  { phaseId, locked, expectedState } = {},
) {
  const action = await confirmHostAction(page, actionId, expectedState);
  if (phaseId !== undefined && locked !== undefined) {
    await waitForHostProjectionPhase(page, { phaseId, locked });
  }
  return action;
}

async function hostProjectionSnapshot(
  page,
  {
    roleUrl = false,
    phaseActions = true,
    deadlineActions = false,
    hostPrompts = false,
    promptActions = false,
    dayVoteOutcomes = false,
    votecount = false,
    slots = false,
    outcomePanel = false,
    surfaceText = false,
  } = {},
) {
  const snapshot = {
    phase: await page.evaluate(() => window.__fmarchHostProjection?.phase),
    completed: await page.evaluate(
      () => window.__fmarchHostProjection?.completed ?? false,
    ),
  };
  if (roleUrl) {
    snapshot.roleUrl = page.url();
  }
  if (phaseActions) {
    snapshot.phaseActions = await visibleHostPhaseActions(page);
  }
  if (deadlineActions) {
    snapshot.deadlineActions = await visibleHostControlActions(page, "deadline");
  }
  if (hostPrompts) {
    snapshot.hostPrompts = await page.evaluate(
      () => window.__fmarchHostPromptsProjection ?? [],
    );
  }
  if (promptActions) {
    snapshot.promptActions = await visibleHostControlActions(page, "host-prompts");
  }
  if (dayVoteOutcomes) {
    snapshot.dayVoteOutcomes = await page.evaluate(
      () => window.__fmarchHostDayVoteOutcomesProjection ?? [],
    );
  }
  if (votecount) {
    snapshot.votecount = await page.evaluate(
      () => window.__fmarchHostVotecountProjection ?? [],
    );
  }
  if (slots) {
    snapshot.slots = await page.evaluate(
      () => window.__fmarchHostProjection?.slots ?? [],
    );
  }
  if (outcomePanel) {
    snapshot.outcomePanel = await page
      .locator('[data-testid="host-day-vote-outcome-latest"]')
      .innerText();
  }
  if (surfaceText) {
    snapshot.surfaceText = await page.getByTestId("host-console-surface").innerText();
  }
  return snapshot;
}

async function waitForHealth(baseUrl, options = {}) {
  const {
    beforeRetry = () => {},
    label = "server",
    progress = () => "",
    timeoutMs = 240000,
  } = typeof options === "function" ? { beforeRetry: options } : options;
  const started = Date.now();
  const deadline = started + timeoutMs;
  let nextProgress = started + 10000;
  while (Date.now() < deadline) {
    beforeRetry();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        console.log(`${label} healthy at ${baseUrl}/healthz`);
        return;
      }
    } catch {
      // Server is still compiling, migrating, or binding.
    }
    if (Date.now() >= nextProgress) {
      const elapsedSeconds = Math.round((Date.now() - started) / 1000);
      const latest = progress();
      const suffix = latest === "" ? "" : `; latest: ${latest}`;
      console.log(`${label} still waiting after ${elapsedSeconds}s${suffix}`);
      nextProgress += 10000;
    }
    await delay(250);
  }
  const latest = progress();
  const suffix = latest === "" ? "" : ` Latest output: ${latest}`;
  throw new Error(
    `${label} did not become healthy at ${baseUrl}/healthz within ${Math.round(
      timeoutMs / 1000,
    )}s.${suffix}`,
  );
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchJsonStatus(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return {
    status: response.status,
    ok: response.ok,
    body,
  };
}

async function revokeAuthSession({ apiBaseUrl, token }) {
  return await fetchJson(`${apiBaseUrl}/auth/session-revocations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.rootAdmin}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token }),
  });
}

async function runSql(url, sql) {
  return await runProcess("psql", [url, "-v", "ON_ERROR_STOP=1", "-c", sql]);
}

async function runProcess(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} exited with ${code ?? signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        ),
      );
    });
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const portServer = net.createServer();
    portServer.once("error", reject);
    portServer.listen(0, host, () => {
      const address = portServer.address();
      portServer.close(() => {
        if (address === null || typeof address !== "object") {
          reject(new Error("free port server did not expose an address"));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function assertPostgresReachable(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`DATABASE_URL is not a valid URL: ${url}`);
  }
  const port = Number.parseInt(parsed.port || "5432", 10);
  const hostname = parsed.hostname || "localhost";
  const hint =
    "Start Postgres with `docker compose up -d postgres` or a repo-local cluster, then rerun dev:test-game.";
  try {
    await assertTcpReachable({
      hostname,
      port,
      label: `Postgres from DATABASE_URL (${hostname}:${port})`,
      hint,
    });
  } catch (error) {
    if (hostname !== "localhost") {
      throw error;
    }
    await assertTcpReachable({
      hostname: "127.0.0.1",
      port,
      label: `Postgres from DATABASE_URL fallback (127.0.0.1:${port})`,
      hint,
    });
  }
}

async function assertPortAvailable(port, label) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => {
      reject(new Error(`${label} port ${port} is already in use; choose another port`));
    });
    probe.listen(port, host, () => {
      probe.close(resolve);
    });
  });
}

async function assertTcpReachable({ hostname, port, label, hint }) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: hostname, port });
    const timeout = globalThis.setTimeout(() => {
      socket.destroy();
      reject(new Error(`${label} is not reachable. ${hint}`));
    }, 2000);
    socket.once("connect", () => {
      globalThis.clearTimeout(timeout);
      socket.end();
      resolve();
    });
    socket.once("error", () => {
      globalThis.clearTimeout(timeout);
      reject(new Error(`${label} is not reachable. ${hint}`));
    });
  });
}

async function shutdown() {
  if (vite !== undefined) {
    await vite.close();
    vite = undefined;
  }
  if (apiServer !== undefined) {
    await stopChild(apiServer, "rust server");
    apiServer = undefined;
  }
}

async function stopChild(child, label) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => "timeout"),
  ]);
  if (stopped === "timeout") {
    console.warn(`${label} did not stop after SIGINT; killing`);
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function readNamedGames() {
  try {
    const body = await readFile(namedGamesPath, "utf8");
    const parsed = JSON.parse(body);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function writeNamedGame(name, card) {
  const registry = await readNamedGames();
  registry[name] = {
    game: card.game,
    updatedAt: new Date().toISOString(),
    session: card.artifacts,
  };
  await writeFile(namedGamesPath, `${JSON.stringify(registry, null, 2)}\n`);
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
      throw new Error(`no named game '${gameName}' exists to reuse; run with --reset first`);
    }
    return { game: reuseGame, seedMode: "reuse" };
  }
  if (args.reset) {
    return { game: args.game ?? randomUuid(), seedMode: "seed" };
  }
  if (registered !== undefined && args.game === undefined) {
    return { game: registered, seedMode: "reuse-if-present" };
  }
  return { game: args.game ?? randomUuid(), seedMode: "seed" };
}

export function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    switch (value) {
      case "--api-base-url":
        parsed.apiBaseUrl = requireValue(values, ++index, value).replace(/\/$/, "");
        break;
      case "--api-port":
        parsed.apiPort = parsePositiveInt(requireValue(values, ++index, value), value);
        break;
      case "--api-startup-timeout-ms":
        parsed.apiStartupTimeoutMs = parsePositiveInt(requireValue(values, ++index, value), value);
        break;
      case "--frontend-base-url":
        parsed.frontendBaseUrl = requireValue(values, ++index, value).replace(/\/$/, "");
        break;
      case "--database-url":
        parsed.databaseUrl = requireValue(values, ++index, value);
        break;
      case "--frontend-port":
        parsed.frontendPort = parsePositiveInt(requireValue(values, ++index, value), value);
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
  return parsed;
}

function parsePositiveInt(value, flag) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function recordServerOutput(chunk) {
  const text = chunk.toString();
  serverOutput += text;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(Compiling|Finished|Running|Checking|Building|Downloading)\b/.test(trimmed)) {
      console.log(`[api] ${trimmed}`);
    }
  }
}

function lastServerOutputLine() {
  const lines = serverOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "";
}

function requireValue(values, index, flag) {
  const value = values[index];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage: npm run dev:test-game -- [options]

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
  --no-keepalive           Stop started servers after seeding and writing artifacts
  --help                   Show this help
`);
}
