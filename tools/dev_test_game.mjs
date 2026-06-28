import { spawn } from "node:child_process";
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

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const sessionJsonPath = path.join(artifactDir, "session.json");
const sessionMdPath = path.join(artifactDir, "session.md");
const proofRunJsonPath = path.join(artifactDir, "proof-run.json");
const namedGamesPath = path.join(artifactDir, "named-games.json");
export const defaultDatabaseUrl = "postgres://fmarch:fmarch@localhost:5544/fmarch";
export const defaultGameName = "local";
export const defaultApiStartupTimeoutMs = 15 * 60 * 1000;
const factionDayChatChannel = "private:mafia_day_chat";
const factionDayChatPostBody = "Faction day chat post from dev:test-game.";
const hardeningRetryChannel = "main";
const host = "127.0.0.1";
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

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

export async function main(rawArgs = process.argv.slice(2), env = process.env) {
  args = parseArgs(rawArgs);
  if (args.help) {
    printHelp();
    return;
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

  await mkdir(artifactDir, { recursive: true });
  if (apiBaseUrl === undefined) {
    await assertPostgresReachable(databaseUrl);
    apiBaseUrl = await startApi();
  } else {
    await waitForHealth(apiBaseUrl);
  }

  const seedResult = await seedGame();
  const sessions = await createSessions();

  if (frontendBaseUrl === undefined) {
    frontendBaseUrl = await startFrontend(apiBaseUrl);
  }

  const card = buildSessionCard({
    game,
    gameName,
    seedMode: seedResult.mode,
    databaseUrl,
    apiBaseUrl,
    frontendBaseUrl,
    seedCommands: seedResult.commands,
    sessions,
  });
  await writeFile(sessionJsonPath, `${JSON.stringify(card, null, 2)}\n`);
  await writeFile(sessionMdPath, markdownSessionCard(card));
  await writeNamedGame(gameName, card);
  printSessionCard(card);

  if (args.verify) {
    const verification = await verifySessionCard(card);
    card.verification = verification;
    const proofRun = buildDevTestGameProofRun(card);
    assertDevTestGameProofRun(proofRun);
    await writeFile(sessionJsonPath, `${JSON.stringify(card, null, 2)}\n`);
    await writeFile(sessionMdPath, markdownSessionCard(card));
    await writeFile(proofRunJsonPath, `${JSON.stringify(proofRun, null, 2)}\n`);
    console.log(`\nverified browser entry: ${verification.roles.join(", ")}`);
  }

  if (args.noKeepalive) {
    await shutdown();
  } else {
    console.log("\nKeeping the API and frontend alive. Press Ctrl-C to stop.");
    await new Promise(() => {});
  }
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
      FMARCH_DEV_AUTH: "1",
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
    return { mode: "reused", commands: [] };
  }
  const commands = [];
  const plan = seedCommandPlanForGame(game);
  for (let index = 0; index < plan.length; index += 1) {
    const [principalUserId, command] = plan[index];
    const result = await sendCommandResult(principalUserId, command);
    if (result.body?.kind === "Reject") {
      if (index === 0 && result.body.body?.error === "UnknownGame") {
        if (seedMode === "reuse-if-present") {
          return { mode: "reused", commands: [] };
        }
        throw new Error(
          `game ${game} already exists; rerun with --reuse to use it or --reset to create a fresh named game`,
        );
      }
      throw new Error(`seed command rejected: ${JSON.stringify(result)}`);
    }
    commands.push(commandSummary(principalUserId, command, result));
  }
  return { mode: "seeded", commands };
}

export function seedCommandPlanForGame(game) {
  return [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game, slot: "slot-7" } }],
    ["host_h", { AddSlot: { game, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game, slot: "slot-3" } }],
    ["host_h", { AddSlot: { game, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game, slot: "slot_5" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-7", user: "player-mira" } }],
    ["host_h", { AssignRole: { game, slot: "slot-7", role_key: "encryptor" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-2", user: "player-target" } }],
    ["host_h", { AssignRole: { game, slot: "slot-2", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-3", user: "player-seed" } }],
    ["host_h", { AssignRole: { game, slot: "slot-3", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot_4", user: "player-goon-a" } }],
    ["host_h", { AssignRole: { game, slot: "slot_4", role_key: "mafia_goon" } }],
    ["host_h", { AssignSlot: { game, slot: "slot_5", user: "player-goon-b" } }],
    ["host_h", { AssignRole: { game, slot: "slot_5", role_key: "vanilla_townie" } }],
    ["host_h", { AddCohost: { game, user: "cohost_c" } }],
    ["host_h", { StartGame: { game, phase: "D01" } }],
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

async function createSessions() {
  await fetchJson(`${apiBaseUrl}/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: tokens.rootAdmin,
      principal_user_id: "root_admin",
      expires_at: expiresAt,
      global_capabilities: ["GlobalAdmin"],
    }),
  });

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

export function createTokenSet(prefix) {
  return Object.freeze({
    rootAdmin: `${prefix}-root-admin`,
    admin: `${prefix}-admin`,
    host: `${prefix}-host`,
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
  const invite = await fetchJson(`${apiBaseUrl}/auth/invites`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.rootAdmin}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      invite_token: inviteToken,
      principal_user_id: principalUserId,
      expires_at: expiresAt,
      global_capabilities: globalCapabilities,
    }),
  });
  return {
    principalUserId: invite.principal_user_id,
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

function roleLoginUrl({ frontendBaseUrl, session }) {
  const params = new URLSearchParams({ returnTo: session.returnTo });
  if (session.credentialKind === "invite" || session.inviteToken !== undefined) {
    params.set("invite", session.inviteToken);
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
  sessions,
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
    seedCommandCount: seedCommands.length,
    sessions: withFrontendUrls,
    artifacts: {
      json: path.relative(repoRoot, sessionJsonPath),
      markdown: path.relative(repoRoot, sessionMdPath),
      proofRun: path.relative(repoRoot, proofRunJsonPath),
    },
  };
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
    console.log(`  invite: ${session.inviteToken ?? session.token}`);
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
    "",
    "Open a role invite URL and submit. The invite token is prefilled in the URL and repeated below for recovery/debug use.",
    "",
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    lines.push(
      `## ${role}`,
      "",
      `Invite URL: ${session.loginUrl}`,
      "",
      `Invite token: ${session.inviteToken ?? session.token}`,
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
        `Process replacement: ${card.verification.replacementConsole.processReplacement.statusMessage}`,
        "",
        `Projected occupant: ${card.verification.replacementConsole.projectedReplacement.occupantLabel}`,
        "",
        `Stale outgoing recovery: ${card.verification.replacementConsole.staleOutgoingPlayer.reject.message}`,
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
        `Concurrent vote race: ${card.verification.multiplayerHardening.concurrentVoteRace.targetSlot} count ${card.verification.multiplayerHardening.concurrentVoteRace.apiProjection.count}`,
        "",
        `Stale action conflict: ${card.verification.multiplayerHardening.staleActionConflict.reject.message}`,
        "",
        `Stale control: ${card.verification.multiplayerHardening.staleHostControl.reject.message}`,
        "",
        `Stale cohost deadline: ${card.verification.multiplayerHardening.staleCohostDeadline.reject.message}`,
        "",
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function verifySessionCard(card) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const roles = [];
  const sessions = {};
  const roleEntries = {};
  let cohostConsole;
  let coreLoop;
  let privateChannel;
  let actionLoop;
  let invalidActionRecovery;
  let resolutionReceipts;
  let deadPlayerRecovery;
  let playerActionBoundary;
  let multiplayerHardening;
  let replacementConsole;
  let staleActionPage;
  let staleHostPage;
  let staleCohostPage;
  let staleReplacementPage;
  try {
    for (const role of ["host", "player", "actionPlayer", "deniedPlayer", "cohost"]) {
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
    staleActionPage = await roleEntries.actionPlayer.context.newPage();
    staleHostPage = await roleEntries.host.context.newPage();
    staleCohostPage = await roleEntries.cohost.context.newPage();
    staleReplacementPage = await roleEntries.player.context.newPage();
    cohostConsole = await verifySeededCohostConsole({
      cohostPage: roleEntries.cohost.page,
      staleCohostPage,
      game: card.game,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    coreLoop = await verifySeededCoreLoop({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
    });
    privateChannel = await verifySeededPrivateChannel({
      playerPage: roleEntries.player.page,
      deniedPage: roleEntries.deniedPlayer.page,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    actionLoop = await verifySeededActionLoop({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      actionPage: roleEntries.actionPlayer.page,
      targetPage: roleEntries.deniedPlayer.page,
      staleActionPage,
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
      staleActionConflict: actionLoop.staleActionConflict,
      staleHostPage,
      staleHostControlSetup: actionLoop.staleHostControlSetup,
      staleCohostPage,
      staleCohostDeadlineSetup: cohostConsole.staleDeadlineSetup,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
    });
    replacementConsole = await verifySeededReplacementConsole({
      browser,
      hostPage: roleEntries.host.page,
      staleOutgoingPage: staleReplacementPage,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    card.sessions.replacementPlayer = replacementConsole.hostIssuedInvite.session;
    sessions.replacementPlayer = replacementConsole.incomingPlayer.browserEntry;
    roles.push("replacementPlayer");
  } finally {
    await staleActionPage?.close().catch(() => {});
    await staleHostPage?.close().catch(() => {});
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
    cohostConsole,
    coreLoop,
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
    if (prefilled !== credential) {
      await page.getByTestId("auth-login-token").fill(credential);
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
          valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
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
    stalePhase,
    deadlineActions,
    phaseActions,
    closedStatus,
  };
}

async function verifySeededCoreLoop({ hostPage, playerPage }) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
  const lock = await confirmHostAction(hostPage, "lock_thread");
  await waitForHostProjectionPhaseLocked(hostPage, true);
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.locked === true,
  );
  const playerLockedBeforeVote = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  await playerPage.getByText("Vote slot-2", { exact: true }).click();
  await playerPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  const rejectedVote = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const playerProjectionAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  await expectHostPhaseActions(hostPage, ["unlock_thread", "advance_phase"]);
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
      locked: ["unlock_thread", "advance_phase"],
      restored: ["resolve_phase", "lock_thread"],
    },
    lock,
    rejectedVote,
    unlock,
    playerPhases: {
      lockedBeforeVote: playerLockedBeforeVote,
      afterReject: playerProjectionAfterReject,
      unlockedAfterRecovery: playerUnlockedAfterRecovery,
    },
    proof:
      "The seeded host role URL locked D01 through the hydrated host phase control, the seeded player role URL submitted a vote while the phase was locked and rendered Reject PhaseLocked recovery, then the host role URL unlocked D01 so the human-run game remains usable.",
  };
}

async function verifySeededActionLoop({
  hostPage,
  playerPage,
  actionPage,
  targetPage,
  staleActionPage,
  staleHostPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
  const resolveDay = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D01", locked: true });
  await expectHostPhaseActions(hostPage, ["unlock_thread", "advance_phase"]);
  const advanceNight = await confirmHostAction(hostPage, "advance_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false });
  const playerActionBoundary = await verifySeededPlayerActionBoundary({
    playerPage,
    game,
  });

  await actionPage.locator('[data-action="submit_invalid_action:factional_kill"]').waitFor({
    state: "visible",
  });
  const n01Phase = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const staleActionSetup = await freezeStaleActionPage({ staleActionPage, game });
  const invalidActionRecovery = await verifySeededInvalidActionRecovery({
    actionPage,
  });
  const invalidAction = invalidActionRecovery.reject;

  await actionPage.locator('[data-action="submit_action:factional_kill"]').click();
  await actionPage.waitForFunction(
    () => window.__fmarchPlayerCommandStatus?.state === "ack",
  );
  const legalAction = await actionPage.evaluate(() => window.__fmarchPlayerCommandStatus);
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

  const resolveNight = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: true });
  const targetState = await fetchResolvedSlotState({ apiBaseUrl, game, slot: targetSlot });
  if (targetState?.alive !== false || targetState?.status !== "dead") {
    throw new Error(`resolved action did not kill ${targetSlot}: ${JSON.stringify(targetState)}`);
  }
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
  const deadPlayerRecovery = await verifySeededDeadPlayerRecovery({
    targetPage,
    game,
    targetSlot,
  });
  const staleActionConflict = await submitStaleActionConflict({
    staleActionPage,
    staleActionSetup,
  });

  return {
    status: "passed",
    resolveDay,
    advanceNight,
    n01Phase,
    invalidAction,
    invalidActionRecovery,
    legalAction,
    playerActionBoundary,
    resolutionReceipts,
    deadPlayerRecovery,
    resolveNight,
    resolvedTargetSlot: targetState,
    advanceDay,
    d02Phase,
    d02PhaseText,
    staleActionConflict,
    staleHostControlSetup,
    proof:
      "The seeded host role URL resolved D01 and advanced to N01, the action-player role URL rendered factional_kill, recovered from an invalid self-action, submitted the legal action, then the host role URL resolved N01 and advanced the same game to D02 while a stale action-player page recovered a frozen N01 action through a PhaseLocked refresh.",
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
    !receiptStatusText.includes("Reject InvalidTarget")
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
    vote: await targetPage.locator('[data-action="submit_vote"]').isDisabled(),
    withdraw: await targetPage.locator('[data-action="withdraw_vote"]').isDisabled(),
    post: await targetPage.locator('[data-action="submit_post"]').isDisabled(),
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
    !Object.values(disabledControls).every(Boolean) ||
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
  const phase = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const commandActions = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.actions ?? [],
  );
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
    phase,
    commandActions,
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
    staleN01Phase,
    actionConfig,
    closedStatus,
  };
}

async function submitStaleActionConflict({ staleActionPage, staleActionSetup }) {
  await staleActionPage.locator('[data-action="submit_action:factional_kill"]').click();
  await staleActionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "PhaseLocked",
  );
  const reject = await staleActionPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  if (!reject.message.includes("stale projection")) {
    throw new Error(`stale action message drifted: ${JSON.stringify(reject)}`);
  }
  await staleActionPage.waitForFunction(
    () => window.__fmarchPlayerProjection?.commandState?.phase?.phaseId === "D02",
  );
  await staleActionPage.waitForFunction(
    () => document.querySelector('[data-action="submit_action:factional_kill"]') === null,
  );
  const phaseAfterReject = await staleActionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  return {
    status: "passed",
    staleN01Phase: staleActionSetup.staleN01Phase,
    actionConfig: staleActionSetup.actionConfig,
    closedStatus: staleActionSetup.closedStatus,
    reject,
    phaseAfterReject,
    actionVisibleAfterRefresh: false,
  };
}

async function verifySeededPrivateChannel({
  playerPage,
  deniedPage,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const channelRoute = encodeURIComponent(factionDayChatChannel);
  const privateUrl = `${frontendBaseUrl}/g/${game}/c/${channelRoute}`;
  const allowedResponse = await playerPage.goto(privateUrl, { waitUntil: "networkidle" });
  if (allowedResponse === null || !allowedResponse.ok()) {
    throw new Error(
      `private channel member route failed with ${allowedResponse?.status() ?? "no response"}`,
    );
  }
  await playerPage.getByTestId("player-surface").waitFor({ state: "visible" });
  const channelContext = playerPage.getByTestId("player-command-channel-context");
  await channelContext.waitFor({ state: "visible" });
  const channelContextId = await channelContext.getAttribute("data-channel-id");
  if (channelContextId !== factionDayChatChannel) {
    throw new Error(`private channel context drifted: ${channelContextId}`);
  }
  await playerPage.locator('[data-testid="player-composer"] textarea').fill(factionDayChatPostBody);
  await playerPage.locator('[data-action="submit_post"]').click();
  await playerPage.waitForFunction(
    () => window.__fmarchPlayerCommandStatus?.state === "ack",
  );
  await playerPage.waitForFunction((expectedBody) =>
    window.__fmarchPlayerProjection?.thread?.posts?.some(
      (post) => post.body === expectedBody,
    ),
    factionDayChatPostBody,
  );
  const submitPost = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  const submitPostCommand = submitPost.requestEnvelope?.body?.body?.command?.SubmitPost;
  if (
    submitPostCommand?.channel_id !== factionDayChatChannel ||
    submitPostCommand?.actor_slot !== "slot-7" ||
    submitPostCommand?.body !== factionDayChatPostBody
  ) {
    throw new Error(`private channel SubmitPost drifted: ${JSON.stringify(submitPostCommand)}`);
  }
  const apiThread = await fetchJson(
    `${apiBaseUrl}/games/${game}/channels/${channelRoute}/thread?principal_user_id=player-mira&limit=50`,
  );
  if (!apiThread.posts?.some((post) => post.body === factionDayChatPostBody)) {
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

  return {
    status: "passed",
    channel: factionDayChatChannel,
    allowed: {
      url: privateUrl,
      channelContextId,
      submitPost,
      apiThreadPostBodies: apiThread.posts.map((post) => post.body),
    },
    denied: {
      url: privateUrl,
      status,
      actionLabel,
      actionHref,
      recoveredUrl: deniedPage.url(),
    },
    proof:
      "The seeded player role URL opened the pack-declared faction day chat, submitted a private-channel post through /commands, and the denied player role URL rendered the 403 Back to board recovery for the same channel.",
  };
}

async function verifySeededMultiplayerHardening({
  hostPage,
  playerPage,
  actionPage,
  staleActionConflict,
  staleHostPage,
  staleHostControlSetup,
  staleCohostPage,
  staleCohostDeadlineSetup,
  game,
  apiBaseUrl,
}) {
  const { normalizeCommandResponse } = await importFrontendModule(
    "src/lib/app/command-boundary.mjs",
  );
  const { normalizeServerCommandEnvelope } = await importFrontendModule(
    "src/lib/components/host-action/host-command-boundary.mjs",
  );

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
  const concurrentVoteRace = await verifyConcurrentVoteRace({
    playerPage,
    actionPage,
    game,
    apiBaseUrl,
    normalizeCommandResponse,
  });

  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  const staleHostControl = await submitStaleHostControlRecovery({
    staleHostPage,
    staleHostControlSetup,
    apiBaseUrl,
    game,
  });
  const staleCohostDeadline = await submitStaleCohostDeadlineRecovery({
    staleCohostPage,
    staleCohostDeadlineSetup,
    apiBaseUrl,
    game,
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
    concurrentVoteRace,
    staleActionConflict,
    staleHostControl,
    staleCohostDeadline,
    proof:
      "The seeded player role URL replayed the same SubmitPost command_id through /commands and got the original ACK with one projected post, recovered a dropped live projection through reconnect, refreshed command state after a stale locked-phase vote reject, proved two concurrent player vote commands converge to the same projected votecount, preserved a frozen N01 action page until it rejected with stale PhaseLocked recovery on D02, then stale seeded host and cohost role URLs clicked old controls, rendered PhaseLocked command-activity receipts, refreshed to D02, and exposed their current valid control sets.",
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
  const staleOutgoingPlayer = await submitStaleOutgoingReplacementRecovery({
    staleOutgoingPage,
    staleOutgoingSetup,
  });
  const incomingPlayer = await verifyIncomingReplacementPlayer({
    browser,
    replacementSession: hostIssuedInvite.session,
    game,
    apiBaseUrl,
    frontendBaseUrl,
  });
  if (
    hostIssuedInvite?.status !== "passed" ||
    hostIssuedInvite?.session?.principalUserId !== "player-rowan" ||
    hostIssuedInvite?.session?.issuedBy?.principalUserId !== "host_h" ||
    hostIssuedInvite?.session?.issuedBy?.capabilityKind !== "HostOf" ||
    hostIssuedInvite?.session?.returnTo !== `/g/${game}` ||
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
    staleOutgoingPlayer?.reject?.error !== "NotYourSlot" ||
    staleOutgoingPlayer?.recoveredCommandState?.actorStatus !== "replaced" ||
    staleOutgoingPlayer?.buttonsDisabled !== true ||
    incomingPlayer?.browserEntry?.principalUserId !== "player-rowan" ||
    incomingPlayer?.commandState?.actorSlot !== "slot-7" ||
    incomingPlayer?.postStatus?.state !== "ack" ||
    incomingPlayer?.vote?.serverEnvelope?.body?.kind !== "Ack" ||
    incomingPlayer?.privateReceiptIsolation?.targetKillVisible !== false
  ) {
    throw new Error(
      `replacement console proof drifted: ${JSON.stringify({
        hostIssuedInvite,
        processReplacement,
        projectedReplacement,
        apiSlot,
        staleOutgoingPlayer,
        incomingPlayer,
      })}`,
    );
  }
  return {
    status: "passed",
    hostIssuedInvite,
    processReplacement,
    projectedReplacement,
    apiSlot,
    staleOutgoingPlayer,
    incomingPlayer,
    proof:
      "The seeded host role URL issued the player-rowan replacement invite, processed the Slot 7 replacement through the hydrated ProcessReplacement control, updated the host projection to player-rowan, preserved the stable slot history boundary, recovered the stale outgoing player page with a NotYourSlot receipt plus disabled old Slot 7 controls, and proved the incoming player-rowan role URL can act as Slot 7 without receiving target-only private receipts.",
  };
}

async function issueReplacementInviteFromHost({ hostPage, game, frontendBaseUrl }) {
  await hostPage.getByTestId("host-replacement-invite-panel").waitFor({
    state: "visible",
  });
  const targetLabel = await hostPage
    .getByTestId("host-replacement-invite-target")
    .innerText();
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
  const session = {
    principalUserId: "player-rowan",
    credentialKind: "invite",
    token: inviteToken,
    inviteToken,
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

async function verifyIncomingReplacementPlayer({
  browser,
  replacementSession,
  game,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  let replacementEntry;
  try {
    replacementEntry = await openVerifiedRoleEntry({
      browser,
      session: replacementSession,
      game,
      apiBaseUrl,
      frontendBaseUrl,
    });
    const page = replacementEntry.page;
    await gotoPlayerBoard(page, game);
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    const browserEntry = replacementEntry.verification;
    const commandState = await page.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
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
          target: { Slot: "slot_5" },
        },
      },
    });
    if (vote.serverEnvelope?.body?.kind !== "Ack") {
      throw new Error(`incoming replacement vote did not ack: ${JSON.stringify(vote)}`);
    }
    await page.evaluate(() => window.__fmarchTriggerPlayerResync?.(0));
    await page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.votecount?.some(
          (row) => row.target?.includes("slot_5") && Number(row.count) >= 2,
        ),
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
      vote.requestEnvelope?.body?.body?.principal_user_id !== "player-rowan" ||
      vote.requestEnvelope?.body?.body?.command?.SubmitVote?.actor_slot !== "slot-7" ||
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
      vote,
      votecountAfterVote,
      privateReceiptIsolation,
      proof:
        "The incoming player-rowan role URL opened after replacement with SlotOccupant authority for slot-7, preserved Slot 7 thread history, submitted a new Slot 7 post and vote, and did not receive target-only kill or action private receipts.",
    };
  } finally {
    await replacementEntry?.context.close().catch(() => {});
  }
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
    )
  ) {
    throw new Error(
      `stale outgoing replacement recovery drifted: ${JSON.stringify({
        staleOutgoingSetup,
        reject,
        recoveredCommandState,
        contextState,
        buttonsDisabled,
        commandReceipts,
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
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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

async function submitStaleCohostDeadlineRecovery({
  staleCohostPage,
  staleCohostDeadlineSetup,
  apiBaseUrl,
  game,
}) {
  const staleActionRoot = staleCohostPage.getByTestId("critical-host-action-extend_deadline");
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
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
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false ||
    hostStateAfterReject.phase?.deadline !== null
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
        apiPhase: hostStateAfterReject.phase,
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
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
}

async function verifyPlayerReconnectRecovery({ playerPage, game }) {
  await gotoPlayerBoard(playerPage, game);
  await playerPage.waitForFunction(
    () => typeof window.__fmarchDropPlayerLiveProjection === "function",
  );
  await playerPage.evaluate(() => window.__fmarchDropPlayerLiveProjection());
  await playerPage.waitForFunction(
    () => window.__fmarchLiveProjectionStatus?.state === "reconnecting",
  );
  const reconnectingStatus = await playerPage.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const reconnectPostBody = `Player reconnect proof from dev:test-game ${crypto.randomUUID()}.`;
  const reconnectCommand = await sendCommand("player-seed", {
    SubmitPost: {
      game,
      channel_id: "main",
      actor_slot: "slot-3",
      body: reconnectPostBody,
    },
  });
  await playerPage.waitForFunction(
    () =>
      (window.__fmarchLiveProjectionEvents ?? []).some(
        (event) =>
          event?.kind === "reconnect" &&
          event.attempt === 1 &&
          event.state === "recovered",
      ),
  );
  const recoveredStatus = await playerPage.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const reconnectRecoveryEvent = await playerPage.evaluate(() =>
    (window.__fmarchLiveProjectionEvents ?? []).find(
      (event) =>
        event?.kind === "reconnect" &&
        event.attempt === 1 &&
        event.state === "recovered",
    ),
  );
  await playerPage.waitForFunction(
    (expectedBody) =>
      window.__fmarchPlayerProjection?.thread?.posts?.some(
        (post) => post.body === expectedBody,
      ),
    reconnectPostBody,
  );
  await playerPage.getByText(reconnectPostBody, { exact: true }).waitFor({
    state: "visible",
  });
  const postVisibleStatus = await playerPage.evaluate(
    () => window.__fmarchLiveProjectionStatus,
  );
  const recoveredProjection = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection,
  );
  return {
    status: "passed",
    reconnectingStatus,
    reconnectCommand,
    reconnectRecoveryEvent,
    recoveredStatus,
    postVisibleStatus,
    recoveredPostBody: reconnectPostBody,
    recoveredSnapshotContainsPost: recoveredProjection?.thread?.posts?.some(
      (post) => post.body === reconnectPostBody,
    ),
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
  const reject = await playerPage.evaluate(() => window.__fmarchPlayerCommandStatus);
  if (!reject.message.includes("stale projection")) {
    throw new Error(`stale player vote message drifted: ${JSON.stringify(reject)}`);
  }
  const phaseAfterReject = await playerPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );

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
    closedStatus,
    lock,
    reject,
    phaseAfterReject,
    unlock,
    hostPhaseAfterUnlock: hostStateAfterUnlock.phase,
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

  const targetSlot = "slot_5";
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

  return {
    status: "passed",
    targetSlot,
    playerVote,
    actionVote,
    apiProjection: projectedRow,
    playerProjection: await playerPage.evaluate(() => window.__fmarchPlayerProjection?.votecount),
    actionProjection: await actionPage.evaluate(() => window.__fmarchPlayerProjection?.votecount),
    proof:
      "The seeded player and action-player role URLs submitted concurrent D02 SubmitVote commands for slot_5 through /commands, both ACKed with distinct stream seqs, and both browser projections plus the API votecount converged to slot_5 count 2.",
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
  const trigger = actionRoot.getByTestId("critical-host-action-trigger");
  await trigger.waitFor({ state: "visible" });
  await trigger.click();

  await actionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  const confirmationMessage = await actionRoot
    .getByTestId("critical-host-action-confirmation-message")
    .innerText();
  await actionRoot.getByTestId("critical-host-action-confirm").click();

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
  --no-keepalive           Stop started servers after seeding and writing artifacts
  --help                   Show this help
`);
}
