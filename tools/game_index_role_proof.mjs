import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "game-index-role-proof");
const evidencePath = path.join(artifactDir, "game-index-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const pageSize = 12;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required, e.g. postgres://fmarch:fmarch@localhost:5544/fmarch",
  );
}

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "game-index-role-proof",
});

let proofDatabase;
let server;
let vite;
let browser;
let serverOutput = "";
const previousApiBaseUrl = process.env.FMARCH_API_BASE_URL;

try {
  await mkdir(artifactDir, { recursive: true });
  proofDatabase = await createScratchDatabase(databaseUrl);
  const apiBaseUrl = await startApi(proofDatabase.url);
  const frontendBaseUrl = await startFrontend(apiBaseUrl);
  browser = await chromium.launch();

  const empty = await proveEmptyBoard(frontendBaseUrl);
  const seeded = await seedPublicGames(apiBaseUrl);
  const pagination = await proveSeededBoard({ frontendBaseUrl, apiBaseUrl, seeded });
  const recovery = await proveInvalidCursorRecovery(frontendBaseUrl);
  const evidence = {
    version: 1,
    proof: "game-index-role-proof",
    status: "passed",
    scope: "local-game-index-role-proof",
    releaseReady: false,
    productionReady: false,
    proofBoundary:
      "Local scratch-Postgres, local Rust API, SvelteKit root board, and Chromium proof. It proves an empty public board, command-pipeline seeded active/completed game discovery, keyset pagination, reload, invalid-cursor recovery, and the absence of host, seat, role, or private-channel data from the public page. It does not prove hosted availability, public per-game play access, search, ranking, recommendations, SEO, or release readiness.",
    roleUrl: `${frontendBaseUrl}/`,
    api: {
      endpoint: `${apiBaseUrl}/games`,
      pageSize,
      publicFieldNames: [
        "game",
        "pack",
        "status",
        "phase_id",
        "updated_seq",
        "completed_seq",
      ],
    },
    empty,
    seeded,
    pagination,
    recovery,
  };
  assertGameIndexProof(evidence);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "game-index-role-proof",
    stage: "game-index-proof-listen",
  });
  if (!handled) {
    error.serverOutput = serverOutput.slice(-4000);
    throw error;
  }
} finally {
  if (browser !== undefined) await browser.close();
  if (vite !== undefined) await vite.close();
  if (server !== undefined) await stopChild(server);
  if (proofDatabase !== undefined) await dropScratchDatabase(proofDatabase);
  if (previousApiBaseUrl === undefined) delete process.env.FMARCH_API_BASE_URL;
  else process.env.FMARCH_API_BASE_URL = previousApiBaseUrl;
}

async function proveEmptyBoard(frontendBaseUrl) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/`, { waitUntil: "networkidle" });
    await page.getByTestId("board-game-index-empty").waitFor({ state: "visible" });
    return { status: "passed", emptyTestId: "board-game-index-empty" };
  } finally {
    await page.close();
  }
}

async function seedPublicGames(apiBaseUrl) {
  const hostPrincipalUserId = "board_index_host";
  const games = [];
  for (let index = 0; index < pageSize + 1; index += 1) {
    const game = randomUUID();
    const pack = index % 2 === 0 ? "mafiascum" : "mafia_universe";
    await sendCommand(apiBaseUrl, index * 3 + 1, hostPrincipalUserId, {
      CreateGame: { game, pack },
    });
    await sendCommand(apiBaseUrl, index * 3 + 2, hostPrincipalUserId, {
      StartGame: { game, phase: "D01" },
    });
    games.push({ game, pack });
  }
  const firstPage = await fetchJson(`${apiBaseUrl}/games?limit=${pageSize}`);
  const completed = games.find((entry) => entry.game === firstPage.games?.[0]?.game);
  if (completed === undefined) {
    throw new Error("seeded game index did not return a public game to complete");
  }
  await sendCommand(apiBaseUrl, pageSize * 3 + 3, hostPrincipalUserId, {
    CompleteGame: { game: completed.game },
  });
  return {
    status: "passed",
    count: games.length,
    completedGame: completed.game,
    activeGameCount: games.length - 1,
    hostPrincipalUserId,
  };
}

async function proveSeededBoard({ frontendBaseUrl, apiBaseUrl, seeded }) {
  const firstApiPage = await fetchJson(`${apiBaseUrl}/games?limit=${pageSize}`);
  assertPublicApiPage(firstApiPage, pageSize, seeded.hostPrincipalUserId);
  if (firstApiPage.next_cursor === null) {
    throw new Error("public game index did not expose a cursor for the older seeded game");
  }
  const olderApiPage = await fetchJson(
    `${apiBaseUrl}/games?limit=${pageSize}&cursor=${encodeURIComponent(firstApiPage.next_cursor)}`,
  );
  assertPublicApiPage(olderApiPage, 1, seeded.hostPrincipalUserId);
  if (olderApiPage.next_cursor !== null) {
    throw new Error("final public game index page unexpectedly exposed another cursor");
  }

  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/`, { waitUntil: "networkidle" });
    await page.getByTestId("board-game-index").waitFor({ state: "visible" });
    const firstCardCount = await page.locator('[data-testid^="game-card-"]').count();
    if (firstCardCount !== pageSize) {
      throw new Error(`expected ${pageSize} public game cards, got ${firstCardCount}`);
    }
    const firstBody = await page.locator("body").innerText();
    const lifecycleText = firstBody.toUpperCase();
    if (!lifecycleText.includes("ACTIVE") || !lifecycleText.includes("COMPLETED")) {
      throw new Error("public game index did not render active and completed lifecycle labels");
    }
    assertNoPrivateBoardText(firstBody, seeded.hostPrincipalUserId);
    const older = page.getByTestId("board-game-index-older");
    await Promise.all([
      page.waitForURL(/\?cursor=/, { timeout: 15000 }),
      older.click(),
    ]);
    await page.waitForLoadState("networkidle");
    const olderCardCount = await page.locator('[data-testid^="game-card-"]').count();
    if (olderCardCount !== 1) {
      throw new Error(`expected one older public game card, got ${olderCardCount}`);
    }
    await page.reload({ waitUntil: "networkidle" });
    const reloadCardCount = await page.locator('[data-testid^="game-card-"]').count();
    if (reloadCardCount !== 1) {
      throw new Error(`older public game page did not survive reload: ${reloadCardCount}`);
    }
    return {
      status: "passed",
      firstCardCount,
      olderCardCount,
      reloadCardCount,
      completedVisible: lifecycleText.includes("COMPLETED"),
      activeVisible: lifecycleText.includes("ACTIVE"),
      rawPrivateDataVisible: false,
    };
  } finally {
    await page.close();
  }
}

async function proveInvalidCursorRecovery(frontendBaseUrl) {
  const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/?cursor=invalid`, { waitUntil: "networkidle" });
    await page.getByTestId("board-game-index-unavailable").waitFor({ state: "visible" });
    await page.goto(`${frontendBaseUrl}/`, { waitUntil: "networkidle" });
    const recoveredCardCount = await page.locator('[data-testid^="game-card-"]').count();
    if (recoveredCardCount !== pageSize) {
      throw new Error(`board did not recover from an invalid cursor: ${recoveredCardCount}`);
    }
    return {
      status: "passed",
      unavailableTestId: "board-game-index-unavailable",
      recoveredCardCount,
    };
  } finally {
    await page.close();
  }
}

function assertPublicApiPage(page, expectedCount, hostPrincipalUserId) {
  if (!Array.isArray(page?.games) || page.games.length !== expectedCount) {
    throw new Error(`public game index page shape drifted: ${JSON.stringify(page)}`);
  }
  const allowedKeys = new Set([
    "game",
    "pack",
    "status",
    "phase_id",
    "updated_seq",
    "completed_seq",
  ]);
  for (const game of page.games) {
    if (
      !["active", "completed"].includes(game.status) ||
      Object.keys(game).some((key) => !allowedKeys.has(key)) ||
      JSON.stringify(game).includes(hostPrincipalUserId)
    ) {
      throw new Error(`public game index leaked or drifted: ${JSON.stringify(game)}`);
    }
  }
}

function assertNoPrivateBoardText(text, hostPrincipalUserId) {
  for (const privateValue of [hostPrincipalUserId, "slot_", "private:", "role_key"]) {
    if (text.includes(privateValue)) {
      throw new Error(`public board leaked private game data: ${privateValue}`);
    }
  }
}

function assertGameIndexProof(evidence) {
  if (
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.empty?.status !== "passed" ||
    evidence.seeded?.count !== pageSize + 1 ||
    evidence.seeded?.activeGameCount !== pageSize ||
    evidence.pagination?.status !== "passed" ||
    evidence.pagination?.firstCardCount !== pageSize ||
    evidence.pagination?.olderCardCount !== 1 ||
    evidence.pagination?.reloadCardCount !== 1 ||
    evidence.pagination?.activeVisible !== true ||
    evidence.pagination?.completedVisible !== true ||
    evidence.pagination?.rawPrivateDataVisible !== false ||
    evidence.recovery?.status !== "passed" ||
    evidence.recovery?.recoveredCardCount !== pageSize
  ) {
    throw new Error("game index proof must stay local, paginated, and capability-safe");
  }
}

async function createScratchDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sanitizeDatabaseName(sourceName)}_board_${process.pid}_${Date.now()}`;
  scratch.pathname = `/${name}`;
  await runProcess("psql", [
    admin.toString(),
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `CREATE DATABASE "${name}"`,
  ]);
  return { name, adminUrl: admin.toString(), url: scratch.toString() };
}

async function dropScratchDatabase({ adminUrl, name }) {
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLiteral(name)}`,
  ]);
  await runProcess("psql", [
    adminUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    `DROP DATABASE IF EXISTS "${name}"`,
  ]);
}

async function startApi(url) {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  const mediaRoot = path.join(artifactDir, "media-store");
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      DATABASE_URL: url,
      FMARCH_BIND: `${host}:${port}`,
      FMARCH_MEDIA_ROOT: mediaRoot,
      RUST_LOG: process.env.RUST_LOG ?? "warn",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  await waitForHealth(baseUrl);
  return baseUrl;
}

async function startFrontend(apiBaseUrl) {
  process.env.FMARCH_API_BASE_URL = apiBaseUrl;
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer } = await import(frontendRequire.resolve("vite"));
    vite = await createServer({
      root: frontendRoot,
      server: {
        host,
        port: 0,
        strictPort: false,
        proxy: { "/games": apiBaseUrl },
      },
      logLevel: "error",
    });
  } finally {
    process.chdir(previousCwd);
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") {
    throw new Error("SvelteKit game index proof server did not expose a TCP address");
  }
  return `http://${host}:${address.port}`;
}

async function sendCommand(apiBaseUrl, id, principalUserId, command) {
  const result = await fetchJson(`${apiBaseUrl}/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      v: 1,
      id,
      body: {
        kind: "Command",
        body: { command_id: randomUUID(), principal_user_id: principalUserId, command },
      },
    }),
  });
  if (result.body?.kind !== "Ack") {
    throw new Error(`seed command rejected: ${JSON.stringify(result)}`);
  }
}

async function fetchJson(url, options = {}, timeoutMs = 15000) {
  const response = await fetchWithTimeout(url, options, timeoutMs);
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  return body;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null || server?.signalCode !== null) {
      throw new Error(`Rust API exited before healthcheck:\n${serverOutput.slice(-4000)}`);
    }
    try {
      if ((await fetchWithTimeout(`${baseUrl}/healthz`, {}, 1000)).ok) return;
    } catch {
      // The server may still be compiling, migrating, or binding.
    }
    await delay(250);
  }
  throw new Error(`Rust API did not become healthy at ${baseUrl}/healthz`);
}

async function runProcess(command, args) {
  const child = spawn(command, args, { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", resolve);
  });
  if (code !== 0) throw new Error(`${command} failed with exit ${code}:\n${output}`);
  return output;
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGINT");
  const stopped = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(5000).then(() => "timeout"),
  ]);
  if (stopped === "timeout") {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const candidate = net.createServer();
    candidate.once("error", reject);
    candidate.listen(0, host, () => {
      const address = candidate.address();
      candidate.close(() => {
        if (address === null || typeof address !== "object") reject(new Error("free port unavailable"));
        else resolve(address.port);
      });
    });
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitizeDatabaseName(name) {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  return (sanitized === "" ? "fmarch" : sanitized).slice(0, 20);
}
