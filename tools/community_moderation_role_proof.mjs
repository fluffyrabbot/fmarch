import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.join(root, "target", "community-moderation-role-proof");
const evidencePath = path.join(artifactDir, "community-moderation-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
if (!databaseUrl) throw new Error("DATABASE_URL is required");

let database;
let apiProcess;
let vite;
let browser;
let apiOutput = "";
try {
  await mkdir(artifactDir, { recursive: true });
  database = await scratchDatabase(databaseUrl);
  const apiBase = await startApi(database.url);
  const frontendBase = await startFrontend(apiBase);
  const seeded = await seed(apiBase);
  browser = await chromium.launch();
  const member = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const moderator = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    await cookie(member, frontendBase, seeded.memberToken);
    await cookie(moderator, frontendBase, seeded.moderatorToken);
    const report = await memberReport(member, frontendBase, seeded);
    const review = await moderatorHide(moderator, frontendBase, seeded);
    const removal = await publicCounts(member, frontendBase, seeded);
    const restoration = await moderatorRestore(moderator, member, frontendBase, seeded);
    const deniedPage = await member.newPage();
    const deniedResponse = await deniedPage.goto(`${frontendBase}/moderation`, { waitUntil: "networkidle" });
    await deniedPage.close();
    const evidence = {
      version: 1,
      proof: "community-moderation-role-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      proofBoundary: "Local scratch Postgres, typed case streams, synchronous projections, local API, SvelteKit, and Chromium. Proves member reporting, private receipts, GlobalMod review, reasoned hide/restore audit history, and synchronous public-thread/search visibility. Does not prove automated guilt scoring, private-channel evidence handling, hosted staffing, legal response, or release readiness.",
      memberRoleUrl: `${frontendBase}/games/${seeded.game}`,
      moderatorRoleUrl: `${frontendBase}/moderation`,
      report,
      review,
      removal,
      restoration,
      denied: { status: "passed", httpStatus: deniedResponse?.status() },
    };
    if (report.privateReceipt !== true || review.auditVisible !== true
      || removal.thread !== 0 || removal.search !== 0
      || restoration.thread !== 1 || restoration.search !== 1
      || evidence.denied.httpStatus !== 403) {
      throw new Error(`moderation proof drifted: ${JSON.stringify(evidence)}`);
    }
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(root, evidencePath)}`);
  } finally {
    await member.close();
    await moderator.close();
  }
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (apiProcess) await stop(apiProcess);
  if (database) await dropDatabase(database);
}

async function seed(api) {
  const memberToken = "moderation-proof-member-session";
  const moderatorToken = "moderation-proof-moderator-session";
  const member = "moderation_member";
  const moderator = "moderation_operator";
  await json(`${api}/auth/dev-session`, post({ token: memberToken, principal_user_id: member, expires_at: 4_102_444_800, global_capabilities: [] }));
  await json(`${api}/auth/dev-session`, post({ token: moderatorToken, principal_user_id: moderator, expires_at: 4_102_444_800, global_capabilities: ["GlobalAdmin", "GlobalMod"] }));
  await json(`${api}/auth/accounts`, post({ account_id: "moderation-member@example.test", password: "correct horse battery staple", principal_user_id: member, global_capabilities: [] }, moderatorToken));
  await json(`${api}/auth/accounts`, post({ account_id: "moderation-operator@example.test", password: "correct horse battery staple", principal_user_id: moderator, global_capabilities: ["GlobalAdmin", "GlobalMod"] }, moderatorToken));
  const game = randomUUID();
  let id = 1;
  await command(api, id++, member, { CreateGame: { game, pack: "mafiascum" } });
  await command(api, id++, member, { AddSlot: { game, slot: "slot_1" } });
  await command(api, id++, member, { AssignSlot: { game, slot: "slot_1", user: member } });
  await command(api, id++, member, { StartGame: { game, phase: "D01" } });
  await command(api, id++, member, { SubmitPost: { game, channel_id: "main", actor_slot: "slot_1", body: "Cobalt moderation proof message", media: [] } });
  const page = await json(`${api}/games/${game}`);
  return { game, member, memberToken, moderatorToken, sourceSeq: page.posts[0].source_seq };
}

async function memberReport(context, base, seeded) {
  const page = await context.newPage();
  await page.goto(`${base}/games/${seeded.game}`, { waitUntil: "networkidle" });
  const control = page.getByTestId(`public-game-report-${seeded.sourceSeq}`);
  await control.locator("summary").click();
  await control.locator("select").selectOption("harassment");
  await control.locator("textarea").fill("Member-provided context for review");
  await control.getByRole("button", { name: "Submit report" }).click();
  const receipt = page.getByTestId("public-game-report-result");
  await receipt.waitFor({ state: "visible" });
  const text = await receipt.innerText();
  await page.close();
  return { status: "passed", privateReceipt: text.includes("Report received") && !text.includes(seeded.member), sourceSeq: seeded.sourceSeq };
}

async function moderatorHide(context, base, seeded) {
  const page = await context.newPage();
  await page.goto(`${base}/moderation`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Review case" }).click();
  const detail = page.getByTestId("moderation-case-detail");
  await detail.waitFor({ state: "visible" });
  const before = await detail.innerText();
  if (!before.includes(seeded.member) || !before.includes("Member-provided context")) throw new Error("moderator evidence missing");
  await page.getByTestId("moderation-case-action").selectOption("hide");
  await page.getByTestId("moderation-case-reason").fill("Confirmed harassment in public content");
  await page.getByTestId("moderation-case-submit").click();
  await page.waitForLoadState("networkidle");
  const after = await detail.innerText();
  const result = { status: "passed", auditVisible: after.includes("hidden: game_post") && after.includes("ModerationContentHidden"), caseUrl: page.url() };
  await page.close();
  return result;
}

async function publicCounts(context, base, seeded) {
  const page = await context.newPage();
  await page.goto(`${base}/games/${seeded.game}`, { waitUntil: "networkidle" });
  const thread = await page.locator('[data-testid^="public-game-post-"]').count();
  await page.goto(`${base}/search?q=cobalt&filter=games`, { waitUntil: "networkidle" });
  const search = await page.locator('article[data-testid^="public-search-result-"]').count();
  await page.close();
  return { status: "passed", thread, search };
}

async function moderatorRestore(modContext, memberContext, base, seeded) {
  const moderator = await modContext.newPage();
  await moderator.goto(`${base}/moderation?status=hidden`, { waitUntil: "networkidle" });
  await moderator.getByRole("link", { name: "Review case" }).click();
  await moderator.getByTestId("moderation-case-action").selectOption("restore");
  await moderator.getByTestId("moderation-case-reason").fill("Appeal accepted after review");
  await moderator.getByTestId("moderation-case-submit").click();
  await moderator.waitForLoadState("networkidle");
  const audit = (await moderator.getByTestId("moderation-case-detail").innerText()).includes("ModerationContentRestored");
  await moderator.close();
  const counts = await publicCounts(memberContext, base, seeded);
  return { ...counts, auditVisible: audit };
}

function post(body, token) {
  return { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: JSON.stringify(body) };
}
async function command(api, id, principal, commandBody) {
  const result = await json(`${api}/commands`, post({ v: 1, id, body: { kind: "Command", body: { command_id: randomUUID(), principal_user_id: principal, command: commandBody } } }));
  if (result.body?.kind !== "Ack") throw new Error(`seed command rejected: ${JSON.stringify(result)}`);
}
async function cookie(context, base, value) {
  await context.addCookies([{ name: "fmarch_session", value, url: base, httpOnly: true, sameSite: "Lax" }]);
}
async function json(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function scratchDatabase(url) {
  const source = new URL(url);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const name = `${source.pathname.replace(/[^a-zA-Z0-9_]/g, "_")}_moderation_${process.pid}_${Date.now()}`;
  const scratch = new URL(url);
  scratch.pathname = `/${name}`;
  await processRun("psql", [admin.toString(), "-v", "ON_ERROR_STOP=1", "-c", `CREATE DATABASE "${name}"`]);
  return { name, admin: admin.toString(), url: scratch.toString() };
}
async function dropDatabase(database) {
  await processRun("psql", [database.admin, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database.name}'`]);
  await processRun("psql", [database.admin, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${database.name}"`]);
}
async function startApi(url) {
  const port = await freePort();
  const base = `http://${host}:${port}`;
  const mediaRoot = path.join(artifactDir, "media");
  await mkdir(mediaRoot, { recursive: true });
  apiProcess = spawn("cargo", ["run", "-p", "server"], { cwd: root, env: { ...process.env, DATABASE_URL: url, FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, FMARCH_DEV_AUTH: "1", RUST_LOG: "warn" }, stdio: ["ignore", "pipe", "pipe"] });
  apiProcess.stdout.on("data", (chunk) => { apiOutput += chunk; });
  apiProcess.stderr.on("data", (chunk) => { apiOutput += chunk; });
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`API exited: ${apiOutput.slice(-4000)}`);
    try { if ((await fetch(`${base}/healthz`)).ok) return base; } catch {}
    await delay(250);
  }
  throw new Error(`API health timeout: ${apiOutput.slice(-4000)}`);
}
async function startFrontend(api) {
  process.env.FMARCH_API_BASE_URL = api;
  const cwd = process.cwd();
  process.chdir(frontendRoot);
  try {
    const { createServer } = await import(frontendRequire.resolve("vite"));
    vite = await createServer({ root: frontendRoot, server: { host, port: 0 }, logLevel: "error" });
  } finally { process.chdir(cwd); }
  await vite.listen();
  const address = vite.httpServer.address();
  return `http://${host}:${address.port}`;
}
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, host, () => { const address = server.address(); server.close((error) => error ? reject(error) : resolve(address.port)); });
  });
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
}
async function processRun(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
