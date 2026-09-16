import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { runFmarchMigrations, serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import { assertModerationRevisionStage, assertModerationEvidenceAccess } from "./community_moderation_evidence_contract.mjs";
import {
  fixturePrincipalAuthorityId,
  fixturePrincipalTransport,
} from "./principal_fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, "target", "community-moderation-role-proof"));
const evidencePath = path.join(artifactDir, "community-moderation-proof.json");
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const host = "127.0.0.1";
const localProofAuth = createLocalProofAuth();
if (!migrationUrl) throw new Error("DATABASE_MIGRATION_URL is required");

let database;
let apiProcess;
let vite;
let browser;
let apiOutput = "";
try {
  await mkdir(artifactDir, { recursive: true });
  database = await scratchDatabase(migrationUrl);
  const authority = await runFmarchMigrations({ cwd: root, migrationUrl: database.migrationUrl });
  const apiBase = await startApi(authority.applicationUrl);
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
    const revisionEvidence = await proveRevisionEvidence({ member, moderator, api: apiBase, base: frontendBase, seeded });
    const deniedPage = await member.newPage();
    const deniedResponse = await deniedPage.goto(`${frontendBase}/moderation`, { waitUntil: "networkidle" });
    await deniedPage.close();
    const evidence = {
      version: 1,
      proof: "community-moderation-role-proof",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      proofBoundary: "Local scratch Postgres, typed case streams, synchronous projections, local API, SvelteKit, and Chromium. Proves member reporting, private receipts, GlobalMod review, reasoned hide/restore audit history, immutable reported content after forum edits and retraction, distinct current content and revision history after explicit reload, member denial of retained evidence, and synchronous public-thread/search visibility. Does not prove legacy report generation, automated guilt scoring, private-channel evidence handling, hosted staffing, legal response, or release readiness.",
      memberRoleUrl: `${frontendBase}/games/${seeded.game}`,
      moderatorRoleUrl: `${frontendBase}/moderation`,
      report,
      review,
      removal,
      restoration,
      revisionEvidence,
      denied: { status: "passed", httpStatus: deniedResponse?.status() },
    };
    if (report.privateReceipt !== true || review.auditVisible !== true
      || removal.thread !== 0 || removal.search !== 0
      || restoration.thread !== 1 || restoration.search !== 1 || !restoration.auditVisible
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
  const member = "moderation_member";
  const moderator = "moderation_operator";
  const memberToken = requiredSessionToken(await json(`${api}/auth/local-proof/sessions`, localProofPost({ principal_id: fixturePrincipalAuthorityId(member), expires_at: 4_102_444_800, global_capabilities: [] })));
  const memberBootstrapToken = requiredSessionToken(await json(`${api}/auth/local-proof/sessions`, localProofPost({ principal_id: fixturePrincipalAuthorityId(member), expires_at: 4_102_444_800, global_capabilities: ["GlobalAdmin"] })));
  const moderatorToken = requiredSessionToken(await json(`${api}/auth/local-proof/sessions`, localProofPost({ principal_id: fixturePrincipalAuthorityId(moderator), expires_at: 4_102_444_800, global_capabilities: ["GlobalAdmin", "GlobalMod"] })));
  await json(`${api}/auth/accounts`, post({ account_id: "moderation-member@example.test", password: "correct horse battery staple", principal_id: fixturePrincipalAuthorityId(member), global_capabilities: [] }, moderatorToken));
  await json(`${api}/auth/accounts`, post({ account_id: "moderation-operator@example.test", password: "correct horse battery staple", principal_id: fixturePrincipalAuthorityId(moderator), global_capabilities: ["GlobalAdmin", "GlobalMod"] }, moderatorToken));
  const game = randomUUID();
  let id = 1;
  await command(api, id++, memberBootstrapToken, { CreateGame: { game, pack: "mafiascum" } });
  await command(api, id++, memberToken, { AddSlot: { game, slot: "slot_1" } });
  await command(api, id++, memberToken, { SeatPersona: { game, slot: "slot_1", principal_id: member, public_name: member } });
  await command(api, id++, memberToken, { StartGame: { game, phase: "D01" } });
  await command(api, id++, memberToken, { SubmitPost: { game, channel_id: "main", actor_slot: "slot_1", body: "Cobalt moderation proof message", media: [] } });
  const page = await json(`${api}/games/${game}`);
  return { game, member, memberToken, moderatorToken, sourceSeq: page.posts[0].source_seq };
}

function requiredSessionToken(session) {
  if (typeof session?.session_token !== "string" || session.session_token === "") {
    throw new Error("dev session response omitted its backend-issued token");
  }
  return session.session_token;
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
  if (!before.includes(fixturePrincipalAuthorityId(seeded.member)) || !before.includes("Member-provided context")) throw new Error("moderator evidence missing");
  await page.getByTestId("moderation-case-action").selectOption("hide");
  await page.getByTestId("moderation-case-reason").fill("Confirmed harassment in public content");
  await page.getByTestId("moderation-case-submit").click();
  await page.waitForLoadState("networkidle");
  const after = await detail.innerText();
  const result = { status: "passed", auditVisible: after.includes("hidden: public content") && after.includes("ModerationContentHidden"), caseUrl: page.url() };
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

async function proveRevisionEvidence({ member, moderator, api, base, seeded }) {
  const authorHandle = "moderation_operator";
  const reporterHandle = seeded.member;
  for (const [handle, token] of [[authorHandle, seeded.moderatorToken], [reporterHandle, seeded.memberToken]]) {
    await json(`${api}/profiles`, post({ handle, display_name: handle.replaceAll("_", " "), bio: "Moderation evidence proof member", visibility: "public" }, token));
  }
  await json(`${api}/discussions/areas`, post({ slug: "evidence", title: "Evidence", description: "Reported revision proof" }, seeded.moderatorToken));
  const quote = "Quoted context survives later changes.";
  const topic = (await json(`${api}/discussions/areas/evidence/topics`, post({ title: "Reported content revisions", body: quote }, seeded.moderatorToken))).topic;
  const threadUrl = `${api}/discussions/areas/evidence/topics/${topic}`;
  const opening = (await json(threadUrl)).posts[0].source_seq;
  const quotation = { target: { kind: "discussion_post", scope_id: topic, source_seq: opening }, excerpt: quote };
  const bodies = [`@${reporterHandle} Reported original content.`, "First author replacement.", "Second author replacement before retraction."];
  await json(`${api}/discussions/topics/${topic}/posts`, post({ body: bodies[0], quotations: [quotation], mentions: [{ handle: reporterHandle, offset: 0, len: reporterHandle.length + 1 }] }, seeded.moderatorToken));
  const target = (await json(threadUrl)).posts.find(item => item.body === bodies[0]);
  assert.ok(target, "reported forum post must exist");
  const sourceSeq = target.source_seq;
  const topicUrl = `${base}/discussions/evidence/t/${topic}`;
  const reporter = await member.newPage();
  const reviewer = await moderator.newPage();
  try {
    await reporter.goto(topicUrl, { waitUntil: "networkidle" });
    const reportForm = reporter.getByTestId(`discussion-report-${sourceSeq}`);
    await reportForm.locator("summary").click();
    await reportForm.locator("select").selectOption("harassment");
    await reportForm.locator("textarea").fill("Preserve the content I saw, including its quotation.");
    await reportForm.getByRole("button", { name: "Submit report" }).click();
    const receiptNotice = reporter.getByTestId("discussion-report-result");
    await receiptNotice.waitFor({ state: "visible" });
    const receiptText = await receiptNotice.innerText();
    assert.match(receiptText, /Report received/);
    const reportId = receiptText.match(/Receipt ([a-f0-9-]{36})/i)?.[1];
    assert.ok(reportId, "browser report must return its private receipt identity");
    const queue = await json(`${api}/moderation/cases?status=open`, get(seeded.moderatorToken));
    const caseId = queue.cases.find(item => item.surface_id === topic && item.source_seq === sourceSeq)?.case_id;
    assert.ok(caseId, "reported forum post must have its own case");
    const caseUrl = `${api}/moderation/cases/${caseId}`;
    const initial = await json(caseUrl, get(seeded.moderatorToken));
    const captured = initial.reports.find(item => item.report_id === reportId)?.evidence;
    assert.equal(captured?.status, "captured");
    assert.equal(captured.content.body, bodies[0]);
    assert.equal(captured.content.revision, 0);
    assert.equal(captured.content.retracted, false);
    assert.deepEqual(captured.content.quotations, [quotation]);
    assert.equal(captured.content.profile_mentions.length, 1);
    assert.match(captured.content.profile_mentions[0].profile_id, /^[a-f0-9-]{36}$/i);
    assert.equal(captured.content.profile_mentions[0].offset, 0);
    assert.equal(captured.content.profile_mentions[0].len, reporterHandle.length + 1);
    const expected = { topic, sourceSeq, caseId, reportId, reporterPrincipalId: fixturePrincipalAuthorityId(seeded.member), captured: captured.content, bodies };
    const stages = [];
    const inspect = async (revision, retracted) => {
      // This surface has explicit reload semantics; do not claim live refresh.
      await reviewer.goto(`${base}/moderation?status=open&case=${caseId}`, { waitUntil: "networkidle" });
      const detail = reviewer.getByTestId("moderation-case-detail");
      await detail.waitFor({ state: "visible" });
      const current = reviewer.getByTestId("moderation-current-content");
      const queueItem = reviewer.getByTestId(`moderation-case-${caseId}`);
      const report = reviewer.getByTestId(`moderation-report-${reportId}`);
      const evidence = report.getByTestId("moderation-report-evidence");
      const history = reviewer.getByTestId("moderation-content-history").locator("li");
      const renderedHistory = [];
      for (let index = 0; index < await history.count(); index += 1) {
        const row = history.nth(index);
        renderedHistory.push({ heading: await row.locator("h4").innerText(), body: await row.locator("p").last().innerText(), quotations: await row.locator("blockquote").allInnerTexts(), retracted: (await row.innerText()).includes("Retracted by author.") });
      }
      const stage = {
        revision, retracted,
        api: await json(caseUrl, get(seeded.moderatorToken)),
        rendered: {
          // The queue eyebrow is uppercased by CSS. Check its exact semantic
          // heading separately from the body, scoped to this visible case.
          queueHeading: await visibleTextContent(queueItem.locator(":scope > p.fm-eyebrow").nth(1)),
          queueBody: await visibleTextContent(queueItem.locator(":scope > p:not(.fm-eyebrow)")),
          currentHeading: await current.evaluate(element => element.previousElementSibling.textContent),
          currentBody: await current.innerText(),
          reporter: await report.innerText(),
          capturedHeading: await evidence.locator("h4").innerText(),
          capturedBody: await evidence.locator("p").last().innerText(),
          capturedQuotations: await evidence.locator("blockquote").allInnerTexts(),
          history: renderedHistory,
        },
      };
      assertModerationRevisionStage(stage, expected);
      stages.push(stage);
    };
    await inspect(0, false);
    for (const revision of [1, 2]) {
      await json(`${api}/discussions/topics/${topic}/posts/${sourceSeq}`, { ...post({ body: bodies[revision], mentions: [], expected_revision: revision - 1 }, seeded.moderatorToken), method: "PUT" });
      await inspect(revision, false);
    }
    await json(`${api}/discussions/topics/${topic}/posts/${sourceSeq}`, { ...get(seeded.moderatorToken), method: "DELETE" });
    await inspect(2, true);
    const moderatorScreenshot = path.join(artifactDir, "moderation-revision-evidence.png");
    await reviewer.screenshot({ path: moderatorScreenshot, fullPage: true });

    const memberCase = await fetch(caseUrl, get(seeded.memberToken));
    const memberQueue = await fetch(`${api}/moderation/cases?status=all`, get(seeded.memberToken));
    const denied = await reporter.goto(`${base}/moderation?status=open&case=${caseId}`, { waitUntil: "networkidle" });
    const deniedPageText = await reporter.locator("body").innerText();
    const ownReceipt = await json(`${api}/moderation/reports/${reportId}`, get(seeded.memberToken));
    await reporter.goto(topicUrl, { waitUntil: "networkidle" });
    const publicText = await reporter.getByTestId(`discussion-post-${sourceSeq}`).innerText();
    const publicPost = (await json(threadUrl)).posts.find(item => item.source_seq === sourceSeq);
    const publicScreenshot = path.join(artifactDir, "moderation-retracted-public-post.png");
    await reporter.screenshot({ path: publicScreenshot, fullPage: true });
    const access = {
      memberCaseStatus: memberCase.status,
      memberQueueStatus: memberQueue.status,
      memberSelectedPageStatus: denied?.status(),
      deniedPageText, ownReceipt, publicPost, publicText,
    };
    assertModerationEvidenceAccess(access, expected);
    return { status: "passed", topic, sourceSeq, caseId, reportId, reloadSemantics: "explicit", stages, access, moderatorScreenshot: path.relative(root, moderatorScreenshot), publicScreenshot: path.relative(root, publicScreenshot) };
  } finally {
    await reporter.close();
    await reviewer.close();
  }
}

async function visibleTextContent(locator) {
  await locator.waitFor({ state: "visible" });
  const text = await locator.textContent();
  assert.notEqual(text, null, "visible moderation content must have text");
  return text.trim();
}

function get(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

function post(body, token) {
  return { method: "POST", headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" }, body: JSON.stringify(body) };
}
function localProofPost(body) {
  const options = post(body);
  options.headers = localProofAuth.requestHeaders(options.headers);
  return options;
}
async function command(api, id, sessionToken, commandBody) {
  const result = await json(`${api}/commands`, post({ v: 3, id, body: { kind: "Command", body: { command_id: randomUUID(), command: fixturePrincipalTransport(commandBody, "community moderation command transport") } } }, sessionToken));
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
  return { name, admin: admin.toString(), migrationUrl: scratch.toString() };
}
async function dropDatabase(database) {
  await processRun("psql", [database.admin, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${database.name}'`]);
  await processRun("psql", [database.admin, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${database.name}"`]);
}
async function startApi(applicationUrl) {
  const port = await freePort();
  const base = `http://${host}:${port}`;
  const mediaRoot = path.join(artifactDir, "media");
  await mkdir(mediaRoot, { recursive: true });
  apiProcess = spawn("cargo", ["run", "-p", "server"], { cwd: root, env: localProofAuth.serverEnvironment({ ...serverRuntimeEnvironment({ applicationUrl }), FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, RUST_LOG: "warn" }), stdio: ["ignore", "pipe", "pipe"] });
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
