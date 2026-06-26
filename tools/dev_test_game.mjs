import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const sessionJsonPath = path.join(artifactDir, "session.json");
const sessionMdPath = path.join(artifactDir, "session.md");
const namedGamesPath = path.join(artifactDir, "named-games.json");
export const defaultDatabaseUrl = "postgres://fmarch:fmarch@localhost:5544/fmarch";
export const defaultGameName = "local";
export const defaultApiStartupTimeoutMs = 15 * 60 * 1000;
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
    await writeFile(sessionJsonPath, `${JSON.stringify(card, null, 2)}\n`);
    await writeFile(sessionMdPath, markdownSessionCard(card));
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
      { SubmitVote: { game, actor_slot: "slot-3", target: { Slot: "slot-2" } } },
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
  }
  return `${lines.join("\n")}\n`;
}

async function verifySessionCard(card) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const roles = [];
  const sessions = {};
  try {
    for (const role of ["host", "player"]) {
      sessions[role] = await verifyRoleEntry({
        browser,
        session: card.sessions[role],
        game: card.game,
        apiBaseUrl: card.apiBaseUrl,
        frontendBaseUrl: card.frontendBaseUrl,
      });
      roles.push(role);
    }
  } finally {
    await browser.close();
  }
  return {
    status: "passed",
    roles,
    sessions,
  };
}

async function verifyRoleEntry({ browser, session, game, apiBaseUrl, frontendBaseUrl }) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
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
      principalUserId: resolved.principal_user_id,
      capabilityKinds,
      cookie: {
        httpOnly: sessionCookie.httpOnly,
        sameSite: sessionCookie.sameSite,
        secure: sessionCookie.secure,
        valuePrefix: sessionCookie.value.slice(0, "invite-session-".length),
      },
    };
  } finally {
    await page.close();
  }
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
