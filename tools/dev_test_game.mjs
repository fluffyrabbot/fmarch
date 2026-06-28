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
  let multiplayerHardening;
  let staleActionPage;
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
    cohostConsole = await verifySeededCohostConsole({
      cohostPage: roleEntries.cohost.page,
      game: card.game,
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
      actionPage: roleEntries.actionPlayer.page,
      staleActionPage,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
    });
    multiplayerHardening = await verifySeededMultiplayerHardening({
      hostPage: roleEntries.host.page,
      playerPage: roleEntries.player.page,
      actionPage: roleEntries.actionPlayer.page,
      staleActionConflict: actionLoop.staleActionConflict,
      game: card.game,
      apiBaseUrl: card.apiBaseUrl,
    });
  } finally {
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
    multiplayerHardening,
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

async function verifySeededCohostConsole({ cohostPage, game }) {
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
  return {
    status: "passed",
    capabilityLabel: capability,
    extendDeadline,
    proof:
      "The seeded cohost role URL opened the host console with CohostOf authority and extended the D01 deadline through the hydrated host-console command path.",
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
  actionPage,
  staleActionPage,
  game,
  apiBaseUrl,
}) {
  await expectHostPhaseActions(hostPage, ["resolve_phase", "lock_thread"]);
  const resolveDay = await confirmHostAction(hostPage, "resolve_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "D01", locked: true });
  await expectHostPhaseActions(hostPage, ["unlock_thread", "advance_phase"]);
  const advanceNight = await confirmHostAction(hostPage, "advance_phase");
  await waitForHostProjectionPhase(hostPage, { phaseId: "N01", locked: false });

  await actionPage.locator('[data-action="submit_invalid_action:factional_kill"]').waitFor({
    state: "visible",
  });
  const n01Phase = await actionPage.evaluate(
    () => window.__fmarchPlayerProjection?.commandState?.phase,
  );
  const staleActionSetup = await freezeStaleActionPage({ staleActionPage, game });
  await actionPage.locator('[data-action="submit_invalid_action:factional_kill"]').click();
  await actionPage.waitForFunction(
    () =>
      window.__fmarchPlayerCommandStatus?.state === "reject" &&
      window.__fmarchPlayerCommandStatus?.error === "InvalidTarget",
  );
  const invalidAction = await actionPage.evaluate(() => window.__fmarchPlayerCommandStatus);

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
    legalAction,
    resolveNight,
    resolvedTargetSlot: targetState,
    advanceDay,
    d02Phase,
    d02PhaseText,
    staleActionConflict,
    proof:
      "The seeded host role URL resolved D01 and advanced to N01, the action-player role URL rendered factional_kill, recovered from an invalid self-action, submitted the legal action, then the host role URL resolved N01 and advanced the same game to D02 while a stale action-player page recovered a frozen N01 action through a PhaseLocked refresh.",
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
  const staleCommandId = crypto.randomUUID();
  const staleUnlockRaw = await sendBrowserCommand(hostPage, {
    principalUserId: "host_h",
    command: { UnlockThread: { game } },
    commandId: staleCommandId,
  });
  const staleUnlock = normalizeServerCommandEnvelope({
    actionId: "unlock_thread",
    commandId: staleCommandId,
    requestEnvelope: staleUnlockRaw.requestEnvelope,
    response: { status: staleUnlockRaw.httpStatus },
    serverEnvelope: staleUnlockRaw.serverEnvelope,
  });
  if (
    staleUnlock.state !== "reject" ||
    staleUnlock.error !== "PhaseLocked" ||
    !staleUnlock.message.includes("stale phase state")
  ) {
    throw new Error(`stale host control did not surface recovery: ${JSON.stringify(staleUnlock)}`);
  }
  const hostStateAfterReject = await fetchHostConsoleState({ apiBaseUrl, game });
  if (
    hostStateAfterReject.phase?.phase_id !== "D02" ||
    hostStateAfterReject.phase?.locked !== false
  ) {
    throw new Error(
      `stale host control changed phase projection: ${JSON.stringify(
        hostStateAfterReject.phase,
      )}`,
    );
  }

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
    staleHostControl: {
      commandId: staleCommandId,
      actionId: "unlock_thread",
      reject: staleUnlock,
      phaseAfterReject: hostStateAfterReject.phase,
    },
    proof:
      "The seeded player role URL replayed the same SubmitPost command_id through /commands and got the original ACK with one projected post, recovered a dropped live projection through reconnect, refreshed command state after a stale locked-phase vote reject, proved two concurrent player vote commands converge to the same projected votecount, preserved a frozen N01 action page until it rejected with stale PhaseLocked recovery on D02, then the seeded host role URL sent a stale UnlockThread and received a PhaseLocked recovery message while D02 stayed open.",
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

async function fetchHostConsoleState({ apiBaseUrl, game, slot }) {
  const params = new URLSearchParams({ principal_user_id: "host_h" });
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
