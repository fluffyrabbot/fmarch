import { spawn } from "node:child_process";
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
const artifactDir = path.join(repoRoot, "target", "discussion-role-proof");
const evidencePath = path.join(artifactDir, "discussion-proof.json");
const databaseUrl = process.env.DATABASE_URL;
const host = "127.0.0.1";
const pageSize = 12;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the local discussion role proof");
}

await preflightLocalhostBindOrExit({
  host,
  repoRoot,
  artifactDir,
  evidencePath,
  smokeName: "discussion-role-proof",
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

  const sessions = await createSessions(apiBaseUrl);
  const area = await createArea(apiBaseUrl, sessions.moderatorToken);
  const member = await browser.newContext();
  const moderator = await browser.newContext();
  await setSessionCookie(member, frontendBaseUrl, sessions.memberToken);
  await setSessionCookie(moderator, frontendBaseUrl, sessions.moderatorToken);
  try {
    const empty = await proveEmptyArea(member, frontendBaseUrl);
    const browserTopic = await createTopicAndReply(member, frontendBaseUrl);
    const seeded = await seedTopics(apiBaseUrl, sessions.memberToken, area.slug);
    const pagination = await provePagination(
      member,
      frontendBaseUrl,
      apiBaseUrl,
      sessions.memberUserId,
      browserTopic.topic,
    );
    const moderation = await proveModeration({
      member,
      moderator,
      frontendBaseUrl,
      topic: browserTopic.topic,
    });
    const evidence = {
      version: 1,
      proof: "discussion-role-proof",
      status: "passed",
      scope: "local-discussion-role-proof",
      releaseReady: false,
      productionReady: false,
      proofBoundary:
        "Local scratch-Postgres, local Rust API, opaque local sessions, SvelteKit discussion route, and Chromium proof. It proves an empty area, session-backed topic and post forms, public keyset pagination and reload, GlobalMod moderation, denied member moderation, and locked-topic recovery. It does not prove hosted availability, moderation staffing, retention, legal policy, direct messages, profiles, search, ranking, recommendations, or release readiness.",
      roleUrl: `${frontendBaseUrl}/discussions/${area.slug}`,
      api: {
        areaEndpoint: `${apiBaseUrl}/discussions/areas/${area.slug}`,
        pageSize,
        publicTopicFieldNames: ["topic", "title", "status", "post_count", "updated_seq"],
        publicPostFieldNames: ["source_seq", "body"],
      },
      empty,
      browserTopic,
      seeded,
      pagination,
      moderation,
    };
    assertProof(evidence);
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`wrote ${path.relative(repoRoot, evidencePath)}`);
  } finally {
    await member.close();
    await moderator.close();
  }
} catch (error) {
  const handled = await handleLocalhostBindFailure({
    error,
    repoRoot,
    artifactDir,
    evidencePath,
    smokeName: "discussion-role-proof",
    stage: "discussion-proof-listen",
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

async function createSessions(apiBaseUrl) {
  const memberToken = "discussion-proof-member-session";
  const moderatorToken = "discussion-proof-moderator-session";
  const memberUserId = "discussion_member";
  await createDevSession(apiBaseUrl, memberToken, memberUserId, []);
  await createDevSession(apiBaseUrl, moderatorToken, "discussion_moderator", ["GlobalMod"]);
  return { memberToken, moderatorToken, memberUserId };
}

async function createDevSession(apiBaseUrl, token, principalUserId, globalCapabilities) {
  const response = await fetchJson(`${apiBaseUrl}/auth/dev-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token,
      principal_user_id: principalUserId,
      expires_at: 4_102_444_800,
      global_capabilities: globalCapabilities,
    }),
  });
  if (response.principal_user_id !== principalUserId) {
    throw new Error(`local discussion session did not resolve ${principalUserId}`);
  }
}

async function createArea(apiBaseUrl, moderatorToken) {
  const response = await fetchJson(`${apiBaseUrl}/discussions/areas`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${moderatorToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      slug: "general",
      title: "General discussion",
      description: "Public member discussion.",
    }),
  });
  if (response.slug !== "general") throw new Error("discussion area creation drifted");
  return response;
}

async function setSessionCookie(context, frontendBaseUrl, value) {
  await context.addCookies([{ name: "fmarch_session", value, url: frontendBaseUrl, httpOnly: true }]);
}

async function proveEmptyArea(context, frontendBaseUrl) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/discussions/general`, { waitUntil: "networkidle" });
    await page.getByTestId("discussion-topic-empty").waitFor({ state: "visible" });
    return { status: "passed", emptyTestId: "discussion-topic-empty" };
  } finally {
    await page.close();
  }
}

async function createTopicAndReply(context, frontendBaseUrl) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/discussions/general`, { waitUntil: "networkidle" });
    await page.getByTestId("discussion-topic-title").fill("Browser-created topic");
    await page.getByTestId("discussion-topic-body").fill("Opening post from the role URL.");
    await Promise.all([
      page.waitForURL(/\?topic=/, { timeout: 15000 }),
      page.getByTestId("discussion-create-topic-submit").click(),
    ]);
    await page.getByTestId("discussion-thread").waitFor({ state: "visible" });
    const topic = new URL(page.url()).searchParams.get("topic");
    if (topic === null) throw new Error("discussion topic form did not enter a topic role URL");
    await page.getByTestId("discussion-post-body").fill("Browser reply from the authenticated member.");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId("discussion-create-post-submit").click(),
    ]);
    const postCount = await page.locator('article[data-testid^="discussion-post-"]').count();
    if (postCount !== 2) throw new Error(`expected browser topic opening and reply, got ${postCount}`);
    return { status: "passed", topic, postCount, topicTestId: "discussion-thread" };
  } finally {
    await page.close();
  }
}

async function seedTopics(apiBaseUrl, token, slug) {
  for (let index = 0; index < pageSize; index += 1) {
    const response = await fetchJson(`${apiBaseUrl}/discussions/areas/${slug}/topics`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: `Seed topic ${index + 1}`, body: `Seed opening ${index + 1}` }),
    });
    if (typeof response.topic !== "string") throw new Error("seeded discussion topic did not project");
  }
  return { status: "passed", count: pageSize };
}

async function provePagination(context, frontendBaseUrl, apiBaseUrl, memberUserId, browserTopic) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/discussions/general`, { waitUntil: "networkidle" });
    const firstCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (firstCardCount !== pageSize) throw new Error(`expected ${pageSize} discussion topics, got ${firstCardCount}`);
    const apiPage = await fetchJson(`${apiBaseUrl}/discussions/areas/general?limit=${pageSize}`);
    assertPublicDiscussionPage(apiPage, memberUserId);
    const thread = await fetchJson(`${apiBaseUrl}/discussions/topics/${browserTopic}?limit=50`);
    assertPublicDiscussionThread(thread, memberUserId);
    const older = page.getByTestId("discussion-topic-older");
    await Promise.all([page.waitForURL(/\?cursor=/, { timeout: 15000 }), older.click()]);
    await page.waitForLoadState("networkidle");
    const olderCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (olderCardCount !== 1) throw new Error(`expected one older discussion topic, got ${olderCardCount}`);
    await page.reload({ waitUntil: "networkidle" });
    const reloadCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (reloadCardCount !== 1) throw new Error(`older discussion page did not survive reload: ${reloadCardCount}`);
    const body = await page.locator("body").innerText();
    if (body.includes(memberUserId) || body.includes("author_user_id")) {
      throw new Error("public discussion route leaked an account identifier");
    }
    return {
      status: "passed",
      firstCardCount,
      olderCardCount,
      reloadCardCount,
      publicThreadPostCount: thread.posts.length,
      rawAccountDataVisible: false,
    };
  } finally {
    await page.close();
  }
}

function assertPublicDiscussionThread(thread, memberUserId) {
  const allowedTopic = new Set(["topic", "title", "status", "post_count", "updated_seq"]);
  const allowedPost = new Set(["source_seq", "body"]);
  if (
    thread?.topic === null ||
    typeof thread?.topic !== "object" ||
    !Array.isArray(thread?.posts) ||
    Object.keys(thread.topic).some((key) => !allowedTopic.has(key)) ||
    thread.posts.some(
      (post) =>
        Object.keys(post).some((key) => !allowedPost.has(key)) ||
        JSON.stringify(post).includes(memberUserId),
    )
  ) {
    throw new Error(`public discussion thread leaked or drifted: ${JSON.stringify(thread)}`);
  }
}

function assertPublicDiscussionPage(page, memberUserId) {
  const allowedArea = new Set(["slug", "title", "description"]);
  const allowedTopic = new Set(["topic", "title", "status", "post_count", "updated_seq"]);
  if (
    page?.area === null ||
    typeof page?.area !== "object" ||
    !Array.isArray(page?.topics) ||
    Object.keys(page.area).some((key) => !allowedArea.has(key)) ||
    page.topics.some(
      (topic) =>
        Object.keys(topic).some((key) => !allowedTopic.has(key)) ||
        JSON.stringify(topic).includes(memberUserId),
    )
  ) {
    throw new Error(`public discussion API leaked or drifted: ${JSON.stringify(page)}`);
  }
}

async function proveModeration({ member, moderator, frontendBaseUrl, topic }) {
  const memberPage = await member.newPage({ viewport: { width: 1024, height: 768 } });
  const moderatorPage = await moderator.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    const topicUrl = `${frontendBaseUrl}/discussions/general?topic=${encodeURIComponent(topic)}`;
    await memberPage.goto(topicUrl, { waitUntil: "networkidle" });
    await memberPage.getByTestId("discussion-moderation-denied").waitFor({ state: "visible" });
    await moderatorPage.goto(topicUrl, { waitUntil: "networkidle" });
    await moderatorPage.getByTestId("discussion-moderation-form").waitFor({ state: "visible" });
    await moderatorPage.getByTestId("discussion-moderation-status").selectOption("locked");
    await Promise.all([
      moderatorPage.waitForLoadState("networkidle"),
      moderatorPage.getByTestId("discussion-moderation-submit").click(),
    ]);
    await moderatorPage.getByTestId("discussion-topic-locked").waitFor({ state: "visible" });
    await memberPage.reload({ waitUntil: "networkidle" });
    await memberPage.getByTestId("discussion-topic-locked").waitFor({ state: "visible" });
    if (await memberPage.getByTestId("discussion-create-post-submit").count() !== 0) {
      throw new Error("locked discussion topic retained a member posting control");
    }
    return {
      status: "passed",
      deniedTestId: "discussion-moderation-denied",
      moderatorFormTestId: "discussion-moderation-form",
      lockedTestId: "discussion-topic-locked",
    };
  } finally {
    await memberPage.close();
    await moderatorPage.close();
  }
}

function assertProof(evidence) {
  if (
    evidence.status !== "passed" ||
    evidence.releaseReady !== false ||
    evidence.productionReady !== false ||
    evidence.empty?.status !== "passed" ||
    evidence.browserTopic?.postCount !== 2 ||
    evidence.seeded?.count !== pageSize ||
    evidence.pagination?.firstCardCount !== pageSize ||
    evidence.pagination?.olderCardCount !== 1 ||
    evidence.pagination?.reloadCardCount !== 1 ||
    evidence.pagination?.publicThreadPostCount !== 2 ||
    evidence.pagination?.rawAccountDataVisible !== false ||
    evidence.moderation?.status !== "passed"
  ) {
    throw new Error("discussion role proof must remain local, paginated, session-backed, and capability-safe");
  }
}

async function createScratchDatabase(sourceDatabaseUrl) {
  const source = new URL(sourceDatabaseUrl);
  const admin = new URL(sourceDatabaseUrl);
  admin.pathname = "/postgres";
  const scratch = new URL(sourceDatabaseUrl);
  const sourceName = source.pathname.replace(/^\/+/, "") || "fmarch";
  const name = `${sourceName.replace(/[^a-zA-Z0-9_]/g, "_")}_discussion_${process.pid}_${Date.now()}`;
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
  if (address === null || typeof address !== "object") throw new Error("discussion SvelteKit server did not expose a TCP address");
  return `http://${host}:${address.port}`;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`request ${url} failed ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/healthz`)).ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`API did not become healthy: ${serverOutput.slice(-2000)}`);
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
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}
