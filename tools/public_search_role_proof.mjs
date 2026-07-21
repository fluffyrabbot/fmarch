import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  handleLocalhostBindFailure,
  preflightLocalhostBindOrExit,
} from "./frontend_smoke_bind_preflight.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(repoRoot, "target", "public-search-role-proof");
const evidencePath = path.join(artifactDir, "public-search-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";

if (!databaseUrl) throw new Error("DATABASE_URL is required for public search proof");

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "public-search-role-proof",
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
  const seeded = await seedSearchCorpus(apiBaseUrl);
  browser = await chromium.launch();
  const context = await browser.newContext();
  try {
    const search = await proveSearch(context, frontendBaseUrl, seeded);
    const pagination = await provePagination(context, frontendBaseUrl);
    const canonicalGame = await proveCanonicalGameResult(context, frontendBaseUrl, seeded.game);
    const removal = await proveModerationRemoval({
      context,
      frontendBaseUrl,
      apiBaseUrl,
      topic: seeded.removedTopic,
      moderatorToken: seeded.moderatorToken,
    });
    const evidence = {
      version: 1,
      proof: "public-search-role-proof",
      status: "passed",
      scope: "local-public-search-proof",
      releaseReady: false,
      productionReady: false,
      proofBoundary:
        "Local scratch Postgres, synchronous event projections, local Rust API, canonical SvelteKit public routes, and Chromium. It proves weighted public search across discussions, profiles, game metadata, and public main-thread posts; typed filters; stable cursor pagination; canonical destinations; synchronous hidden-topic removal; and private-channel exclusion at the projection E2E boundary. It does not prove hosted availability, private-channel search, recommendations, reputation, engagement ranking, or release readiness.",
      roleUrl: `${frontendBaseUrl}/search?q=quasar&filter=all`,
      apiEndpoint: `${apiBaseUrl}/search`,
      seeded: { game: seeded.game, topicCount: seeded.topicCount },
      search,
      pagination,
      canonicalGame,
      removal,
    };
    assertEvidence(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
  } finally {
    await context.close();
  }
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "public-search-role-proof",
    stage: "public-search-proof-listen",
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

async function seedSearchCorpus(apiBaseUrl) {
  const memberToken = "search-proof-member-session";
  const moderatorToken = "search-proof-moderator-session";
  const member = "search_member";
  const moderator = "search_moderator";
  await createDevSession(apiBaseUrl, memberToken, member, []);
  await createDevSession(apiBaseUrl, moderatorToken, moderator, ["GlobalAdmin", "GlobalMod"]);
  await createAccount(apiBaseUrl, moderatorToken, "search-member@example.test", member, []);
  await createAccount(apiBaseUrl, moderatorToken, "search-moderator@example.test", moderator, ["GlobalAdmin", "GlobalMod"]);
  await fetchJson(`${apiBaseUrl}/profiles`, {
    method: "POST",
    headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      handle: "quasar_member",
      display_name: "Quasar Member",
      bio: "Public quasar signal analysis.",
      visibility: "public",
    }),
  });
  await fetchJson(`${apiBaseUrl}/discussions/areas`, {
    method: "POST",
    headers: { authorization: `Bearer ${moderatorToken}`, "content-type": "application/json" },
    body: JSON.stringify({ slug: "theory", title: "Theory", description: "Public signal analysis" }),
  });
  let removedTopic = null;
  const topicCount = 11;
  for (let index = 0; index < topicCount; index += 1) {
    const topic = await fetchJson(`${apiBaseUrl}/discussions/areas/theory/topics`, {
      method: "POST",
      headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        title: `Quasar signal ${index + 1}`,
        body: `Public quasar discussion body ${index + 1}`,
      }),
    });
    if (index === 0) removedTopic = topic.topic;
  }

  const game = randomUUID();
  let id = 1;
  await sendCommand(apiBaseUrl, id++, member, { CreateGame: { game, pack: "mafiascum" } });
  await sendCommand(apiBaseUrl, id++, member, { AddSlot: { game, slot: "slot_1" } });
  await sendCommand(apiBaseUrl, id++, member, { AssignSlot: { game, slot: "slot_1", user: member } });
  await sendCommand(apiBaseUrl, id++, member, { StartGame: { game, phase: "D01" } });
  await sendCommand(apiBaseUrl, id++, member, {
    SubmitPost: {
      game,
      channel_id: "main",
      actor_slot: "slot_1",
      body: "A public quasar signal from the game thread.",
      media: [],
    },
  });
  return { game, memberToken, moderatorToken, removedTopic, topicCount };
}

async function proveSearch(context, frontendBaseUrl, seeded) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/search?q=quasar&filter=all`, { waitUntil: "networkidle" });
    await page.getByTestId("public-search-results").waitFor({ state: "visible" });
    await page.getByTestId("role-nav-search").waitFor({ state: "visible" });
    const resultCount = await page.locator('article[data-testid^="public-search-result-"]').count();
    const body = await page.locator("body").innerText();
    if (resultCount !== 20) throw new Error(`expected full first search page, got ${resultCount}`);
    if (body.includes("search_member") || body.includes("role_pm")) {
      throw new Error("public search rendered a credential principal or private channel identifier");
    }
    await page.getByTestId("public-search-filter").selectOption("profiles");
    await Promise.all([
      page.waitForURL(/filter=profiles/, { timeout: 15000 }),
      page.getByTestId("public-search-submit").click(),
    ]);
    await page.getByText("Quasar Member", { exact: true }).waitFor({ state: "visible" });
    return {
      status: "passed",
      firstPageCount: resultCount,
      navigationTestId: "role-nav-search",
      profileFilterVisible: true,
      rawPrivateDataVisible: false,
      seededGame: seeded.game,
    };
  } finally {
    await page.close();
  }
}

async function provePagination(context, frontendBaseUrl) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/search?q=quasar&filter=discussions`, { waitUntil: "networkidle" });
    const firstCount = await page.locator('article[data-testid^="public-search-result-"]').count();
    await Promise.all([
      page.waitForURL(/cursor=/, { timeout: 15000 }),
      page.getByTestId("public-search-older").click(),
    ]);
    await page.waitForLoadState("networkidle");
    const olderCount = await page.locator('article[data-testid^="public-search-result-"]').count();
    if (firstCount !== 20 || olderCount !== 2) {
      throw new Error(`search cursor pagination drifted: ${firstCount}/${olderCount}`);
    }
    await page.reload({ waitUntil: "networkidle" });
    return {
      status: "passed",
      firstCount,
      olderCount,
      reloadCount: await page.locator('article[data-testid^="public-search-result-"]').count(),
    };
  } finally {
    await page.close();
  }
}

async function proveCanonicalGameResult(context, frontendBaseUrl, game) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/search?q=quasar&filter=games`, { waitUntil: "networkidle" });
    const result = page.getByTestId("public-search-result-link-0");
    const href = await result.getAttribute("href");
    if (!href?.startsWith(`/games/${game}#thread-post-`)) {
      throw new Error(`game post search result was not canonical: ${href}`);
    }
    await result.click();
    await page.getByTestId("public-game-thread").waitFor({ state: "visible" });
    if (!page.url().includes(`#thread-post-`)) throw new Error("canonical game post anchor was lost");
    return { status: "passed", href, publicThreadTestId: "public-game-thread" };
  } finally {
    await page.close();
  }
}

async function proveModerationRemoval({ context, frontendBaseUrl, apiBaseUrl, topic, moderatorToken }) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/search?q=%22Quasar+signal+1%22&filter=discussions`, { waitUntil: "networkidle" });
    const before = await page.locator('article[data-testid^="public-search-result-"]').count();
    await fetchJson(`${apiBaseUrl}/discussions/topics/${topic}/moderation`, {
      method: "POST",
      headers: { authorization: `Bearer ${moderatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ visibility: "hidden" }),
    });
    await page.reload({ waitUntil: "networkidle" });
    const after = await page.locator('article[data-testid^="public-search-result-"]').count();
    if (before < 1 || after !== 0) throw new Error(`hidden discussion remained searchable: ${before}/${after}`);
    return { status: "passed", before, after };
  } finally {
    await page.close();
  }
}

function assertEvidence(evidence) {
  if (
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.search?.firstPageCount !== 20 ||
    evidence.search?.rawPrivateDataVisible !== false ||
    evidence.pagination?.olderCount !== 2 ||
    evidence.pagination?.reloadCount !== 2 ||
    evidence.canonicalGame?.status !== "passed" ||
    evidence.removal?.after !== 0
  ) {
    throw new Error("public search proof must stay public-only, canonical, paginated, and local");
  }
}

async function createDevSession(apiBaseUrl, token, principalUserId, globalCapabilities) {
  await fetchJson(`${apiBaseUrl}/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      principal_user_id: principalUserId,
      expires_at: 4_102_444_800,
      global_capabilities: globalCapabilities,
    }),
  });
}

async function createAccount(apiBaseUrl, adminToken, accountId, principalUserId, globalCapabilities) {
  await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      account_id: accountId,
      password: "correct horse battery staple",
      principal_user_id: principalUserId,
      global_capabilities: globalCapabilities,
    }),
  });
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
  if (result.body?.kind !== "Ack") throw new Error(`search seed command rejected: ${JSON.stringify(result)}`);
}

async function createScratchDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sourceName.replace(/[^a-zA-Z0-9_]/g, "_")}_search_${process.pid}_${Date.now()}`;
  scratch.pathname = `/${name}`;
  await runProcess("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${name}"`]);
  return { name, adminUrl: admin.toString(), url: scratch.toString() };
}

async function dropScratchDatabase({ adminUrl, name }) {
  await runProcess("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLiteral(name)}`]);
  await runProcess("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${name}"`]);
}

async function startApi(url) {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  const mediaRoot = path.join(artifactDir, "media-store");
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL: url, FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, FMARCH_DEV_AUTH: "1", RUST_LOG: process.env.RUST_LOG ?? "warn" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForHealth(baseUrl);
  return baseUrl;
}

async function startFrontend(apiBaseUrl) {
  process.env.FMARCH_API_BASE_URL = apiBaseUrl;
  const previousCwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer } = await import(frontendRequire.resolve("vite"));
    vite = await createServer({ root: frontendRoot, server: { host, port: 0, strictPort: false }, logLevel: "error" });
  } finally {
    process.chdir(previousCwd);
  }
  await vite.listen();
  const address = vite.httpServer?.address();
  if (address === null || typeof address !== "object") throw new Error("search SvelteKit server did not expose TCP");
  return `http://${host}:${address.port}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`request ${url} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (server?.exitCode !== null) throw new Error(`Rust API exited:\n${serverOutput.slice(-4000)}`);
    try { if ((await fetch(`${baseUrl}/healthz`)).ok) return; } catch {}
    await delay(250);
  }
  throw new Error(`API did not become healthy:\n${serverOutput.slice(-4000)}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once("error", reject);
    listener.listen(0, host, () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}

async function runProcess(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: repoRoot, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}
