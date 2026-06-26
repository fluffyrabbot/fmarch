import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const artifactDir = path.join(repoRoot, "target", "dev-test-game");
const sessionJsonPath = path.join(artifactDir, "session.json");
const sessionMdPath = path.join(artifactDir, "session.md");
const defaultDatabaseUrl = "postgres://fmarch:fmarch@localhost:5544/fmarch";
const host = "127.0.0.1";
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL ?? defaultDatabaseUrl;
const game = args.game ?? crypto.randomUUID();
const tokenPrefix = args.tokenPrefix ?? `dev-test-${game}`;
const tokens = Object.freeze({
  rootAdmin: `${tokenPrefix}-root-admin`,
  admin: `${tokenPrefix}-admin`,
  host: `${tokenPrefix}-host`,
  player: `${tokenPrefix}-player`,
  cohost: `${tokenPrefix}-cohost`,
});
const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;

let apiServer;
let vite;
let apiBaseUrl = args.apiBaseUrl;
let frontendBaseUrl = args.frontendBaseUrl;
let commandEnvelopeId = 1;
let serverOutput = "";
let apiServerExit;

process.on("SIGINT", () => {
  shutdown().then(() => process.exit(130));
});
process.on("SIGTERM", () => {
  shutdown().then(() => process.exit(143));
});

try {
  await mkdir(artifactDir, { recursive: true });
  if (apiBaseUrl === undefined) {
    apiBaseUrl = await startApi();
  } else {
    await waitForHealth(apiBaseUrl);
  }

  const seedCommands = await seedGame();
  const sessions = await createSessions();

  if (frontendBaseUrl === undefined) {
    frontendBaseUrl = await startFrontend(apiBaseUrl);
  }

  const card = buildSessionCard({
    game,
    databaseUrl,
    apiBaseUrl,
    frontendBaseUrl,
    seedCommands,
    sessions,
  });
  await writeFile(sessionJsonPath, `${JSON.stringify(card, null, 2)}\n`);
  await writeFile(sessionMdPath, markdownSessionCard(card));
  printSessionCard(card);

  if (args.noKeepalive) {
    await shutdown();
  } else {
    console.log("\nKeeping the API and frontend alive. Press Ctrl-C to stop.");
    await new Promise(() => {});
  }
} catch (error) {
  await shutdown();
  if (serverOutput !== "") {
    error.serverOutput = serverOutput.slice(-4000);
  }
  throw error;
}

async function startApi() {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
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
  apiServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  apiServer.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  apiServer.once("error", (error) => {
    apiServerExit = { error };
  });
  apiServer.once("exit", (code, signal) => {
    apiServerExit = { code, signal };
  });
  await waitForHealth(baseUrl, () => {
    if (apiServerExit !== undefined) {
      throw new Error(
        `rust server exited before healthcheck: ${JSON.stringify(apiServerExit)}\n${serverOutput}`,
      );
    }
  });
  return baseUrl;
}

async function startFrontend(currentApiBaseUrl) {
  process.env.FMARCH_API_BASE_URL = currentApiBaseUrl;
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
  const commands = [];
  for (const [principalUserId, command] of seedCommandPlan()) {
    commands.push(await sendCommand(principalUserId, command));
  }
  return commands;
}

function seedCommandPlan() {
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
    admin: await createGrantedSession({
      token: tokens.admin,
      principalUserId: "admin_a",
      globalCapabilities: ["GlobalAdmin"],
      returnTo: "/admin",
    }),
    host: await createGrantedSession({
      token: tokens.host,
      principalUserId: "host_h",
      returnTo: `/g/${game}/host`,
    }),
    player: await createGrantedSession({
      token: tokens.player,
      principalUserId: "player-mira",
      returnTo: `/g/${game}`,
    }),
    cohost: await createGrantedSession({
      token: tokens.cohost,
      principalUserId: "cohost_c",
      returnTo: `/g/${game}/host`,
    }),
  };
}

async function createGrantedSession({
  token,
  principalUserId,
  returnTo,
  globalCapabilities = [],
}) {
  const session = await fetchJson(`${apiBaseUrl}/auth/session-grants`, {
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
  const capabilityKinds = (session.capabilities ?? []).map((capability) => capability.kind);
  return {
    principalUserId: session.principal_user_id,
    token,
    loginUrl: `${frontendBaseUrl ?? "(frontend pending)"}/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
    directUrl: frontendBaseUrl === undefined ? null : `${frontendBaseUrl}${returnTo}`,
    returnTo,
    capabilityKinds,
  };
}

async function sendCommand(principalUserId, command) {
  const response = await fetchJson(`${apiBaseUrl}/commands`, {
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
  if (response.body?.kind !== "Ack") {
    throw new Error(`seed command rejected: ${JSON.stringify(response)}`);
  }
  return {
    principalUserId,
    command,
    streamSeqs: response.body.body.stream_seqs,
  };
}

function buildSessionCard({
  game,
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
        loginUrl: `${frontendBaseUrl}/auth/login?returnTo=${encodeURIComponent(
          session.returnTo,
        )}`,
        directUrl: `${frontendBaseUrl}${session.returnTo}`,
      },
    ]),
  );
  return {
    status: "ready",
    game,
    pack: "mafiascum",
    phase: "D01",
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
  console.log(`game: ${card.game}`);
  console.log(`frontend: ${card.frontendBaseUrl}`);
  console.log(`api: ${card.apiBaseUrl}`);
  console.log(`artifact: ${card.artifacts.markdown}`);
  for (const [role, session] of Object.entries(card.sessions)) {
    console.log(`\n${role}`);
    console.log(`  url:   ${session.loginUrl}`);
    console.log(`  token: ${session.token}`);
  }
}

function markdownSessionCard(card) {
  const lines = [
    "# fmarch Dev Test Game",
    "",
    `- status: ${card.status}`,
    `- game: ${card.game}`,
    `- pack: ${card.pack}`,
    `- phase: ${card.phase}`,
    `- frontend: ${card.frontendBaseUrl}`,
    `- api: ${card.apiBaseUrl}`,
    "",
    "Open a role login URL, paste that role's token, and submit.",
    "",
  ];
  for (const [role, session] of Object.entries(card.sessions)) {
    lines.push(`## ${role}`, "", `URL: ${session.loginUrl}`, "", `Token: ${session.token}`, "");
  }
  return `${lines.join("\n")}\n`;
}

async function waitForHealth(baseUrl, beforeRetry = () => {}) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    beforeRetry();
    try {
      const response = await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still compiling, migrating, or binding.
    }
    await delay(250);
  }
  throw new Error(`server did not become healthy at ${baseUrl}/healthz`);
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function fetchWithTimeout(url, options, timeoutMs) {
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

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    switch (value) {
      case "--api-base-url":
        parsed.apiBaseUrl = requireValue(values, ++index, value).replace(/\/$/, "");
        break;
      case "--frontend-base-url":
        parsed.frontendBaseUrl = requireValue(values, ++index, value).replace(/\/$/, "");
        break;
      case "--database-url":
        parsed.databaseUrl = requireValue(values, ++index, value);
        break;
      case "--frontend-port":
        parsed.frontendPort = Number.parseInt(requireValue(values, ++index, value), 10);
        if (!Number.isInteger(parsed.frontendPort) || parsed.frontendPort <= 0) {
          throw new Error("--frontend-port must be a positive integer");
        }
        break;
      case "--game":
        parsed.game = requireValue(values, ++index, value);
        break;
      case "--token-prefix":
        parsed.tokenPrefix = requireValue(values, ++index, value);
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
  --frontend-base-url URL  Use an existing frontend instead of starting Vite
  --database-url URL       DATABASE_URL for a started API (default: ${defaultDatabaseUrl})
  --frontend-port PORT     Port for a started frontend
  --game UUID              Use a specific game id
  --token-prefix TEXT      Prefix for generated opaque login tokens
  --no-keepalive           Stop started servers after seeding and writing artifacts
  --help                   Show this help
`);
}
