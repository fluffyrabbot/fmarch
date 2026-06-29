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

async function createSessionGrantCredential({
  token,
  principalUserId,
  returnTo,
  globalCapabilities = [],
  expectedCapabilityKind,
  issuedBy,
}) {
  const session = await grantAuthSession({
    apiBaseUrl,
    token,
    principalUserId,
    globalCapabilities,
  });
  const capabilityKinds = (session.capabilities ?? []).map((capability) => capability.kind);
  if (
    expectedCapabilityKind !== undefined &&
    !capabilityKinds.includes(expectedCapabilityKind) &&
    expectedCapabilityKind !== "SlotOccupant"
  ) {
    throw new Error(
      `${principalUserId} session grant missing ${expectedCapabilityKind}: ${JSON.stringify(
        session,
      )}`,
    );
  }
  const credential = {
    principalUserId: session.principal_user_id,
    credentialKind: "session",
    token,
    returnTo,
    expectedCapabilityKind,
    globalCapabilities,
    capabilityKinds,
    issuedBy,
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
    console.log(`  token:  ${session.inviteToken ?? session.token}`);
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
    "Open a role login URL and submit. Invite tokens are prefilled in the URL; session tokens are repeated below for recovery/debug use.",
    "",
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    lines.push(
      `## ${role}`,
      "",
      `Role login URL: ${session.loginUrl}`,
      "",
      `Credential token: ${session.inviteToken ?? session.token}`,
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
        `Concurrent vote race: ${card.verification.multiplayerHardening.concurrentVoteRace.targetSlot} count ${card.verification.multiplayerHardening.concurrentVoteRace.apiProjection.count}`,
        "",
        `Host lifecycle: ${card.verification.multiplayerHardening.hostLifecycleControl.markDead.statusMessage}`,
        "",
        `Stale host lifecycle: ${card.verification.multiplayerHardening.staleHostLifecycle.reject.message}`,
        "",
        `Host modkill: ${card.verification.multiplayerHardening.hostModkillControl.modkill.statusMessage}`,
        "",
        `Stale host modkill: ${card.verification.multiplayerHardening.staleHostModkill.reject.message}`,
        "",
        `Stale action conflict: ${card.verification.multiplayerHardening.staleActionConflict.reject.message}`,
        "",
        `Stale control: ${card.verification.multiplayerHardening.staleHostControl.reject.message}`,
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
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const roles = [];
  const sessions = {};
  const roleEntries = {};
  let cohostConsole;
  let coreLoop;
  let dayVoteResolution;
  let dayVoteNoLynch;
  let privateChannel;
  let actionLoop;
  let invalidActionRecovery;
  let resolutionReceipts;
  let deadPlayerRecovery;
  let playerActionBoundary;
  let multiplayerHardening;
  let replacementConsole;
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
    const staleHostDeadlineSetup = await freezeStaleHostDeadlinePage({
      staleHostDeadlinePage,
      game: card.game,
      frontendBaseUrl: card.frontendBaseUrl,
    });
    coreLoop = await verifySeededCoreLoop({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
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
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      survivorPage: roleEntries.deniedPlayer.page,
      apiBaseUrl: card.apiBaseUrl,
      frontendBaseUrl: card.frontendBaseUrl,
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
      staleActionConflict: actionLoop.staleActionConflict,
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
  } finally {
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
    cohostConsole,
    coreLoop,
    dayVoteResolution,
    dayVoteNoLynch,
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

async function verifySeededCoreLoop({ hostPage, playerPage }) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
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
  const staleVoteCommandId = crypto.randomUUID();
  const staleVoteRaw = await sendBrowserCommand(playerPage, {
    principalUserId: "player-mira",
    commandId: staleVoteCommandId,
    command: {
      SubmitVote: {
        game: playerCommandStateLockedBeforeVote?.game,
        actor_slot: "slot-7",
        target: { Slot: "slot-2" },
      },
    },
  });
  const rejectBody = staleVoteRaw.serverEnvelope?.body;
  const rejectedVote = {
    state: rejectBody?.kind === "Reject" ? "reject" : "unknown",
    error: rejectBody?.body?.error ?? null,
    message:
      rejectBody?.kind === "Reject"
        ? `Reject ${rejectBody.body.error}: ${rejectBody.body.message}`
        : "",
    requestEnvelope: staleVoteRaw.requestEnvelope,
    serverEnvelope: staleVoteRaw.serverEnvelope,
  };
  if (
    lockedVoteControl.exists !== false ||
    rejectedVote.error !== "PhaseLocked" ||
    staleVoteRaw.requestEnvelope?.body?.body?.command?.SubmitVote?.game !==
      playerCommandStateLockedBeforeVote?.game
  ) {
    throw new Error(
      `locked player vote boundary drifted: ${JSON.stringify({
        playerCommandStateLockedBeforeVote,
        lockedVoteControl,
        rejectedVote,
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
    unlock,
    playerPhases: {
      lockedBeforeVote: playerLockedBeforeVote,
      afterReject: playerProjectionAfterReject,
      unlockedAfterRecovery: playerUnlockedAfterRecovery,
    },
    proof:
      "The seeded host role URL locked D01 through the hydrated host phase control, the seeded player role URL removed current vote controls while locked, a direct role-browser SubmitVote rejected as PhaseLocked, then the host role URL unlocked D01 so the human-run game remains usable.",
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

async function seedDayVoteResolutionGame({ game }) {
  const plan = [
    ["host_h", { CreateGame: { game, pack: "mafiascum" } }],
    ["host_h", { AddSlot: { game, slot: "slot-7" } }],
    ["host_h", { AddSlot: { game, slot: "slot-2" } }],
    ["host_h", { AddSlot: { game, slot: "slot-3" } }],
    ["host_h", { AddSlot: { game, slot: "slot_4" } }],
    ["host_h", { AddSlot: { game, slot: "slot_5" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-7", user: "player-mira" } }],
    ["host_h", { AssignRole: { game, slot: "slot-7", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-2", user: "player-target" } }],
    ["host_h", { AssignRole: { game, slot: "slot-2", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot-3", user: "player-seed" } }],
    ["host_h", { AssignRole: { game, slot: "slot-3", role_key: "vanilla_townie" } }],
    ["host_h", { AssignSlot: { game, slot: "slot_4", user: "player-goon-a" } }],
    ["host_h", { AssignRole: { game, slot: "slot_4", role_key: "vanilla_townie" } }],
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
  };
}

async function verifySeededDayVoteNoLynch({
  browser,
  hostPage,
  playerPage,
  survivorPage,
  apiBaseUrl,
  frontendBaseUrl,
}) {
  const noLynchGame = crypto.randomUUID();
  const seed = await seedDayVoteNoLynchGame({ game: noLynchGame });
  const seedVoterSession = await createSessionGrantCredential({
    token: `${tokenPrefix}-no-lynch-seed-voter-${crypto.randomUUID()}`,
    principalUserId: "player-seed",
    returnTo: `/g/${noLynchGame}`,
    expectedCapabilityKind: "SlotOccupant",
    issuedBy: {
      principalUserId: "root_admin",
      capabilityKind: "GlobalAdmin",
      surface: "/auth/session-grants",
    },
  });
  const seedVoterEntry = await openVerifiedRoleEntry({
    browser,
    session: seedVoterSession,
    game: noLynchGame,
    apiBaseUrl,
    frontendBaseUrl,
  });
  const hostProofPage = await hostPage.context().newPage();
  const miraVoterPage = await playerPage.context().newPage();
  const survivorProofPage = await survivorPage.context().newPage();
  try {
    await gotoPlayerBoard(miraVoterPage, noLynchGame);
    await miraVoterPage.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-7" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    await seedVoterEntry.page.waitForFunction(
      () =>
        window.__fmarchPlayerProjection?.commandState?.actorSlot === "slot-2" &&
        window.__fmarchPlayerProjection?.commandState?.actorAlive === true,
    );
    await miraVoterPage.locator('[data-action="submit_vote:no_lynch"]').click();
    await miraVoterPage.waitForFunction(
      () =>
        window.__fmarchPlayerCommandStatus?.state === "ack" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body
          ?.principal_user_id === "player-mira" &&
        window.__fmarchPlayerCommandStatus?.requestEnvelope?.body?.body?.command
          ?.SubmitVote?.target === "NoLynch",
    );
    await waitForPlayerVotecount(miraVoterPage, { target: "no_lynch", count: 1 });
    const miraNoLynchVote = await miraVoterPage.evaluate(
      () => window.__fmarchPlayerCommandStatus,
    );
    const miraVotecountAfterVote = await miraVoterPage.evaluate(
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

    await hostProofPage.goto(`${frontendBaseUrl}/g/${noLynchGame}/host`, {
      waitUntil: "networkidle",
    });
    await hostProofPage.waitForFunction(
      () =>
        window.__fmarchHostProjection?.phase?.id === "D01" &&
        window.__fmarchHostProjection?.phase?.locked === false &&
        window.__fmarchHostVotecountProjection?.some(
          (row) => row.target === "no_lynch" && row.count === 2,
        ),
    );
    const hostBeforeResolve = {
      phase: await hostProofPage.evaluate(() => window.__fmarchHostProjection?.phase),
      votecount: await hostProofPage.evaluate(
        () => window.__fmarchHostVotecountProjection ?? [],
      ),
      phaseActions: await visibleHostPhaseActions(hostProofPage),
    };

    const resolveDay = await confirmHostAction(hostProofPage, "resolve_phase");
    await waitForHostProjectionPhase(hostProofPage, { phaseId: "D01", locked: true });
    await hostProofPage.waitForFunction(
      () =>
        window.__fmarchHostDayVoteOutcomesProjection?.some(
          (row) =>
            row.phaseId === "D01" &&
            row.status === "NoLynch" &&
            row.winnerSlot === null,
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
        .locator('[data-testid="host-day-vote-outcome-tally-no_lynch"]')
        .innerText(),
    };

    await gotoPlayerBoard(survivorProofPage, noLynchGame);
    await survivorProofPage.waitForFunction(
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
    const survivorCommandState = await survivorProofPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState,
    );
    const survivorNotifications = await survivorProofPage.evaluate(
      () => window.__fmarchPlayerProjection?.notifications ?? [],
    );
    const survivorDayVoteOutcomes = await survivorProofPage.evaluate(
      () => window.__fmarchPlayerProjection?.dayVoteOutcomes ?? [],
    );
    const survivorOutcomePanel = await survivorProofPage
      .locator('[data-testid="player-day-vote-outcome-latest"]')
      .innerText();
    const survivorOutcomeTally = await survivorProofPage
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
    await hostProofPage.close().catch(() => {});
    await miraVoterPage.close().catch(() => {});
    await survivorProofPage.close().catch(() => {});
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

async function verifySeededActionLoop({
  hostPage,
  playerPage,
  actionPage,
  targetPage,
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
    deadlineAdvance,
    staleDeadlineAdvance,
    resolutionReceipts,
    deadPlayerRecovery,
    resolveNight,
    resolvedTargetSlot: targetState,
    advanceDay,
    d02Phase,
    d02PhaseText,
    staleDeadActionConflict,
    staleActionConflict,
    staleHostControlSetup,
    proof:
      "The seeded host role URL resolved D01 and advanced to N01 through deadline-expiry evidence while a stale host deadline control rejected with current-phase recovery, the action-player role URL rendered factional_kill, a frozen stale action page recovered after Slot 4 was temporarily marked dead, the live action-player recovered from an invalid self-action, submitted the legal action, then the host role URL resolved N01 and advanced the same game to D02 while a stale action-player page recovered a frozen N01 action through a PhaseLocked refresh.",
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
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
    !reject.message.includes("stale action state") ||
    !reject.message.includes("current action controls")
  ) {
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
  await staleDeadActionPage.locator('[data-action="submit_action:factional_kill"]').click();
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
  const staleDeadTargetVote = await verifyStaleDeadTargetVoteRecovery({
    hostPage,
    playerPage,
    game,
    apiBaseUrl,
  });
  const concurrentVoteRace = await verifyConcurrentVoteRace({
    playerPage,
    actionPage,
    game,
    apiBaseUrl,
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

  await waitForHostProjectionPhase(hostPage, { phaseId: "D02", locked: false });
  const staleHostControl = await submitStaleHostControlRecovery({
    staleHostPage,
    staleHostControlSetup,
    apiBaseUrl,
    game,
  });
  const staleHostDeadline = await submitStaleHostDeadlineRecovery({
    staleHostDeadlinePage,
    staleHostDeadlineSetup,
    apiBaseUrl,
    game,
  });
  const staleCohostDeadline = await submitStaleCohostDeadlineRecovery({
    staleCohostPage,
    staleCohostDeadlineSetup,
    apiBaseUrl,
    game,
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
    staleDeadTargetVote,
    concurrentVoteRace,
    hostVotecountPublication,
    staleHostPublish,
    staleHostLifecycle,
    hostLifecycleControl,
    hostModkillControl,
    staleHostModkill,
    staleDeadActionConflict,
    staleActionConflict,
    staleHostControl,
    staleHostResolve,
    staleHostAdvance,
    staleHostPrompt,
    staleHostComplete,
    stalePlayerComplete,
    staleHostDeadline,
    staleCohostDeadline,
    proof:
      "The seeded player role URL replayed the same SubmitPost command_id through /commands and got the original ACK with one projected post, recovered a dropped live projection through reconnect, refreshed command state after a stale locked-phase vote reject, refreshed to the current legal vote target set after a stale dead-target vote rejected as InvalidTarget, proved two concurrent player vote commands converge to the same projected votecount, proved the seeded host role URL can publish that official votecount from the browser control into the public thread, proved a stale host PublishVotecount rejects without appending a duplicate official count, proved the seeded host role URL can mark Slot 7 dead and modkilled through browser controls while the affected player role URL loses controls with SlotNotAlive recovery before the seed is restored each time, proved stale host Mark dead and Modkill slot controls reject without duplicating a current lifecycle status, proved a frozen N01 action control rejects and refreshes after its actor is temporarily marked dead, preserved another frozen N01 action page until it rejected with stale PhaseLocked recovery on D02, then stale seeded host phase/deadline/resolve/advance/prompt/complete-game, stale player completed-game, and cohost deadline role URLs clicked old controls, rendered command receipts, refreshed to current projections, and exposed their current valid control sets.",
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
  const stalePromptPage = await context.newPage();
  const livePromptPage = await context.newPage();
  try {
    const setup = await freezeStaleHostPromptPage({
      stalePromptPage,
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
    const staleRecovery = await submitStaleHostPromptRecovery({
      stalePromptPage,
      setup,
      liveResolve,
      apiBaseUrl,
      promptGame,
      actionId,
      promptId,
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
        "A disposable local host-prompt game created a Beloved Princess skip-next-day prompt, froze one host role URL with the pending Resolve prompt control, resolved it from a live host role URL, then clicked the stale prompt control and recovered through PromptAlreadyResolved without ACK stream seqs while refreshing hostPrompts to the resolved state.",
    };
  } finally {
    await stalePromptPage.close().catch(() => {});
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
  promptGame,
  actionId,
  promptId,
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
    activityRow.source !== "outcome" ||
    activityRow.actionId !== actionId ||
    activityRow.dispatchKind !== "resolve_host_prompt" ||
    dispatchPlan?.projectionRefreshKeys?.includes("hostPrompts") !== true ||
    apiPromptsAfterReject.find((prompt) => (prompt.id ?? prompt.prompt_id) === promptId)
      ?.status !== "resolved"
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
    )
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
      })}`,
    );
  }
  return {
    setup,
    reject,
    commandOutcomes,
    slotsAfterReject,
    revealTextAfterReject,
    roleActionsAfterReject,
    activityStatusText,
    activityRow,
    dispatchPlan,
    apiStateAfterReject,
  };
}

async function verifyStalePlayerCompleteRecovery({
  playerPage,
  apiBaseUrl,
  frontendBaseUrl,
  normalizeCommandResponse,
}) {
  const completeGame = crypto.randomUUID();
  const seed = await seedHostCompleteRecoveryGame({ completeGame });
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
      (button) => button.action?.startsWith("submit_vote") && button.disabled === false,
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
        (window.__fmarchPlayerProjection?.commandState?.actions ?? []).length === 0,
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
    const buttonsAfterReject = await playerCommandButtons(stalePlayerPage);
    const phaseAfterReject = await stalePlayerPage.evaluate(
      () => window.__fmarchPlayerProjection?.commandState?.phase,
    );
    const apiCommandStateAfterReject = await fetchJson(
      `${apiBaseUrl}/games/${completeGame}/player-command-state?principal_user_id=player-mira&slot_id=slot-7`,
    );
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
      apiCommandStateAfterReject?.game_completed !== true ||
      apiCommandStateAfterReject?.actions?.length !== 0 ||
      apiCommandStateAfterReject?.vote_targets?.length !== 0
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
          apiCommandStateAfterReject,
        })}`,
      );
    }
    return {
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
      buttonsAfterReject,
      phaseAfterReject,
      apiCommandStateAfterReject,
      proof:
        "A disposable player role URL froze before completion with a projection-derived vote control, the game completed from another browser command, then that stale player vote control rejected with GameAlreadyCompleted, refreshed commandState, disabled vote/post controls, and exposed no role actions or vote targets.",
    };
  } finally {
    await stalePlayerPage.close().catch(() => {});
  }
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
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
    staleHostLifecycleSetup?.replacement?.lifecycleLabel !== "Alive" ||
    !staleHostLifecycleSetup?.lifecycleActions?.includes(actionId) ||
    reject?.state !== "reject" ||
    reject?.error !== "InvalidTarget" ||
    reject?.serverEnvelope?.body?.kind !== "Reject" ||
    Array.isArray(reject?.streamSeqs) ||
    !reject?.message?.includes("slot lifecycle is already current") ||
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
    playerCommandStateAfterReject?.actorStatus !== lifecycleStatus
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
      replacementSessionRefresh?.session?.credentialKind !== "session" ||
      replacementSessionRefresh?.session?.principalUserId !== "player-rowan" ||
      replacementSessionRefresh?.login?.usedInviteToken !== false ||
      replacementSessionRefresh?.browserEntry?.principalUserId !== "player-rowan" ||
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
      replacementStaleSessionAfterRefresh?.freshCredentialKind !== "session" ||
      replacementStaleSessionAfterRefresh?.freshRoleUrlHasInvite !== false ||
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
    !rowanQueue.boundary.includes("principal-scoped endpoints") ||
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
    replacementSessionRefresh?.session?.credentialKind !== "session" ||
    freshRoleUrlHasInvite !== false
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
    proof:
      "A separate browser context kept the revoked replacement cookie while a fresh replacement session was granted elsewhere; reloading the stale role path still rendered the shared 403 recovery boundary without controls, and the old cookie remained unauthorized.",
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
  const sessionToken = `${tokenPrefix}-replacement-session-refresh-${crypto.randomUUID()}`;
  const session = await createSessionGrantCredential({
    token: sessionToken,
    principalUserId: "player-rowan",
    returnTo: `/g/${game}`,
    expectedCapabilityKind: "SlotOccupant",
    issuedBy: {
      principalUserId: "root_admin",
      capabilityKind: "GlobalAdmin",
      surface: "/auth/session-grants",
    },
  });
  await page.goto(session.loginUrl, { waitUntil: "networkidle" });
  await page.getByTestId("auth-login-surface").waitFor({ state: "visible" });
  const prefilled = await page.getByTestId("auth-login-token").inputValue();
  await page.getByTestId("auth-login-token").fill(session.token);
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
        `${tokenPrefix}-replacement-session-refresh-`.length,
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
    session.credentialKind !== "session" ||
    session.principalUserId !== "player-rowan" ||
    prefilled !== "" ||
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
          token: "<redacted>",
        },
        prefilled,
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
    session,
    login: {
      prefilledSessionToken: false,
      submittedSessionToken: true,
      usedInviteToken: false,
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
      "After the replacement session was revoked, a fresh local session grant for player-rowan was submitted through the normal login page without replaying the invite token; the role path restored Slot 7 controls, ACKed a new Slot 7 post, and still withheld target-only private receipts.",
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

async function submitStaleHostResolveRecovery({
  staleHostResolvePage,
  staleHostResolveSetup,
  liveResolveForStaleHostResolve,
  apiBaseUrl,
  game,
}) {
  const actionId = "resolve_phase";
  const staleActionRoot = staleHostResolvePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
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
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== true
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
        apiPhase: hostStateAfterReject.phase,
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
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
}

async function submitStaleHostAdvanceRecovery({
  staleHostAdvancePage,
  staleHostAdvanceSetup,
  restoreAfterStaleHostResolve,
  apiBaseUrl,
  game,
}) {
  const actionId = "advance_phase";
  const staleActionRoot = staleHostAdvancePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
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
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false
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
        apiPhase: hostStateAfterReject.phase,
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
    apiPhaseAfterReject: hostStateAfterReject.phase,
  };
}

async function submitStaleHostDeadlineRecovery({
  staleHostDeadlinePage,
  staleHostDeadlineSetup,
  apiBaseUrl,
  game,
}) {
  const actionId = "extend_deadline";
  const staleActionRoot = staleHostDeadlinePage.getByTestId(`critical-host-action-${actionId}`);
  await staleActionRoot.getByTestId("critical-host-action-trigger").click();
  await staleActionRoot.getByTestId("critical-host-action-confirmation").waitFor({
    state: "visible",
  });
  await staleActionRoot.getByTestId("critical-host-action-confirm").click();
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
  if (
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
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false ||
    hostStateAfterReject.phase?.deadline !== null
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
        apiPhase: hostStateAfterReject.phase,
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
  return await verifyRoleReconnectRecovery({
    page: playerPage,
    game,
    principalUserId: "player-seed",
    actorSlot: "slot-3",
    postPrefix: "Player reconnect proof",
    navigate: true,
  });
}

async function verifyRoleReconnectRecovery({
  page,
  game,
  principalUserId,
  actorSlot,
  postPrefix,
  navigate = false,
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
      channel_id: "main",
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
  if (!reject.message.includes("stale projection")) {
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

  return {
    status: "passed",
    targetSlot,
    target,
    playerCommandStateBeforeVote,
    actionCommandStateBeforeVote,
    playerVote,
    actionVote,
    apiProjection: projectedRow,
    playerProjection: await playerPage.evaluate(() => window.__fmarchPlayerProjection?.votecount),
    actionProjection: await actionPage.evaluate(() => window.__fmarchPlayerProjection?.votecount),
    proof:
      `The seeded player and action-player role URLs submitted concurrent D02 SubmitVote commands for ${targetSlot} through /commands after deriving it from their current legal vote targets, both ACKed with distinct stream seqs, and both browser projections plus the API votecount converged to ${targetSlot} count 2.`,
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

async function grantAuthSession({
  apiBaseUrl,
  token,
  principalUserId,
  globalCapabilities = [],
}) {
  return await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tokens.rootAdmin}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      token,
      principal_user_id: principalUserId,
      expires_at: expiresAt,
      global_capabilities: globalCapabilities,
    }),
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
