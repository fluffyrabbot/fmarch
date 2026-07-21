import { spawn } from "node:child_process";
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
const artifactDir = path.join(root, "target", "community-subscription-role-proof");
const evidencePath = path.join(artifactDir, "community-subscription-proof.json");
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
  const watcher = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const author = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    await cookie(watcher, frontendBase, seeded.watcherToken);
    await cookie(author, frontendBase, seeded.authorToken);
    const watch = await watchTopic(watcher, frontendBase, seeded);
    await publishReply(author, frontendBase, seeded, "First subscribed reply");
    const fanout = await inspectInbox(watcher, frontendBase, seeded, 1, 1, true);
    const read = await markRead(watcher, frontendBase);
    await unwatch(watcher, frontendBase);
    await publishReply(author, frontendBase, seeded, "Reply during inactive watch");
    const inactive = await inspectInbox(watcher, frontendBase, seeded, 1, 0, false);
    await watchTopic(watcher, frontendBase, seeded);
    await publishReply(author, frontendBase, seeded, "Reply after resubscribe");
    const restoredWatch = await inspectInbox(watcher, frontendBase, seeded, 2, 1, true);
    const newest = (await json(`${apiBase}/discussions/areas/subscriptions/topics/${seeded.topic}?limit=50`)).posts.at(-1).source_seq;
    const report = await json(`${apiBase}/moderation/reports`, post({
      target_kind: "discussion_post",
      scope_id: seeded.topic,
      source_seq: newest,
      reason_family: "spam",
      details: "subscription moderation proof",
    }, seeded.watcherToken));
    const queue = await json(`${apiBase}/moderation/cases?status=open`, get(seeded.operatorToken));
    const moderationCase = queue.cases.find((item) => item.source_seq === newest);
    if (!moderationCase) throw new Error("moderation case missing from proof queue");
    await json(`${apiBase}/moderation/cases/${moderationCase.case_id}/actions`, post({
      action: "hide",
      reason: "hide inbox proof target",
    }, seeded.operatorToken));
    const hidden = await inspectInbox(watcher, frontendBase, seeded, 1, 0, true);
    await json(`${apiBase}/moderation/cases/${moderationCase.case_id}/actions`, post({
      action: "restore",
      reason: "restore inbox proof target",
    }, seeded.operatorToken));
    const moderationRestored = await inspectInbox(watcher, frontendBase, seeded, 2, 1, true);
    const anonymous = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    const deniedPage = await anonymous.newPage();
    const deniedResponse = await deniedPage.goto(`${frontendBase}/inbox`, { waitUntil: "networkidle" });
    await anonymous.close();
    const evidence = {
      version: 1,
      proof: "community-subscription-role-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      proofBoundary: "Local scratch Postgres, typed member-target subscription streams, active-period fanout, local API, SvelteKit, and two member Chromium contexts. Proves public topic watches, durable privacy-safe inbox updates, monotonic read advancement, inactive-period exclusion, and moderation hide/restore suppression. Does not prove email, SMS, mobile push, private-channel watches, recommendation ranking, hosted delivery, or release readiness.",
      watcherRoleUrl: `${frontendBase}/inbox`,
      authorRoleUrl: `${frontendBase}/discussions/subscriptions/t/${seeded.topic}`,
      watch,
      fanout,
      read,
      inactive,
      restoredWatch,
      moderation: {
        reportId: report.report_id,
        hidden,
        restored: moderationRestored,
      },
      denied: { status: "passed", httpStatus: deniedResponse?.status() },
    };
    if (!watch.subscribed || !fanout.privacySafe || read.unread !== 0
      || inactive.items !== 1 || restoredWatch.items !== 2
      || hidden.items !== 1 || moderationRestored.items !== 2
      || evidence.denied.httpStatus !== 401) {
      throw new Error(`subscription proof drifted: ${JSON.stringify(evidence)}`);
    }
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(root, evidencePath)}`);
  } finally {
    await watcher.close();
    await author.close();
  }
} finally {
  if (browser) await browser.close();
  if (vite) await vite.close();
  if (apiProcess) await stop(apiProcess);
  if (database) await dropDatabase(database);
}

async function seed(api) {
  const authorToken = "subscription-proof-author-session";
  const watcherToken = "subscription-proof-watcher-session";
  const operatorToken = "subscription-proof-operator-session";
  const author = "subscription_author";
  const watcher = "subscription_watcher";
  const operator = "subscription_operator";
  for (const [token, principal, globals] of [
    [authorToken, author, []],
    [watcherToken, watcher, []],
    [operatorToken, operator, ["GlobalAdmin", "GlobalMod"]],
  ]) {
    await json(`${api}/auth/dev-session`, post({
      token,
      principal_user_id: principal,
      expires_at: 4_102_444_800,
      global_capabilities: globals,
    }));
  }
  for (const [account, principal, globals] of [
    ["subscription-author@example.test", author, []],
    ["subscription-watcher@example.test", watcher, []],
    ["subscription-operator@example.test", operator, ["GlobalAdmin", "GlobalMod"]],
  ]) {
    await json(`${api}/auth/accounts`, post({
      account_id: account,
      password: "correct horse battery staple",
      principal_user_id: principal,
      global_capabilities: globals,
    }, operatorToken));
  }
  await json(`${api}/profiles`, post({
    handle: "subscription_author",
    display_name: "Subscription Author",
    bio: "Publishes watched updates",
    visibility: "public",
  }, authorToken));
  await json(`${api}/profiles`, post({
    handle: "subscription_watcher",
    display_name: "Subscription Watcher",
    bio: "Watches public updates",
    visibility: "public",
  }, watcherToken));
  await json(`${api}/discussions/areas`, post({
    slug: "subscriptions",
    title: "Subscriptions",
    description: "Two-member subscription proof",
  }, operatorToken));
  const topic = await json(`${api}/discussions/areas/subscriptions/topics`, post({
    title: "Durable watches",
    body: "Opening post before the watch",
  }, authorToken));
  return {
    topic: topic.topic,
    author,
    watcher,
    authorToken,
    watcherToken,
    operatorToken,
  };
}

async function watchTopic(context, base, seeded) {
  const page = await context.newPage();
  await page.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
  const button = page.getByTestId("discussion-watch-submit");
  const label = await button.innerText();
  if (label.includes("Watch this topic")) {
    await button.click();
    await page.getByTestId("discussion-watch-result").waitFor({ state: "visible" });
  }
  const subscribed = (await page.getByTestId("discussion-watch-submit").innerText()).includes("Stop watching");
  await page.close();
  return { status: "passed", subscribed };
}

async function publishReply(context, base, seeded, body) {
  const page = await context.newPage();
  await page.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
  await page.getByTestId("discussion-post-body").fill(body);
  await page.getByTestId("discussion-create-post-submit").click();
  await page.waitForLoadState("networkidle");
  await page.close();
}

async function inspectInbox(context, base, seeded, expectedItems, expectedUnread, expectedSubscribed) {
  const page = await context.newPage();
  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  const items = await page.locator('[data-testid^="community-inbox-item-"]').count();
  const summary = await page.getByTestId("community-inbox-summary").innerText();
  const itemTexts = await page.locator('[data-testid^="community-inbox-item-"]').allInnerTexts();
  const unwatchControls = await page.locator('[data-testid^="community-inbox-unwatch-"]').count();
  const unread = Number(summary.match(/(\d+) unread/)?.[1] ?? -1);
  const privacySafe = itemTexts.every((text) => !text.includes(seeded.author) && !text.includes(seeded.watcher));
  await page.close();
  const subscribed = unwatchControls === items && items > 0;
  if (items !== expectedItems || unread !== expectedUnread || subscribed !== expectedSubscribed) {
    throw new Error(`inbox expected ${expectedItems}/${expectedUnread}/${expectedSubscribed}, got ${items}/${unread}/${subscribed}`);
  }
  return { status: "passed", items, unread, privacySafe, subscribed };
}

async function markRead(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  await page.locator('[data-testid^="community-inbox-read-"]').first().click();
  await page.waitForLoadState("networkidle");
  const summary = await page.getByTestId("community-inbox-summary").innerText();
  const unread = Number(summary.match(/(\d+) unread/)?.[1] ?? -1);
  await page.close();
  return { status: "passed", unread };
}

async function unwatch(context, base) {
  const page = await context.newPage();
  await page.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  await page.locator('[data-testid^="community-inbox-unwatch-"]').first().click();
  await page.waitForLoadState("networkidle");
  await page.close();
}

function get(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}
function post(body, token) {
  return { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: JSON.stringify(body) };
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
  const name = `${source.pathname.replace(/[^a-zA-Z0-9_]/g, "_")}_subscriptions_${process.pid}_${Date.now()}`;
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
