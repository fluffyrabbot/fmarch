import { randomUUID } from "node:crypto";
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
import { runFmarchMigrations, serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import { isPrincipalId, principalFixtureId } from "./principal_fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(repoRoot, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(repoRoot, "target", "discussion-role-proof");
const evidencePath = path.join(artifactDir, "discussion-proof.json");
const migrationUrl = process.env.DATABASE_MIGRATION_URL;
const host = "127.0.0.1";
const pageSize = 12;
const localProofAuth = createLocalProofAuth();

function authorityPrincipalId(aliasOrId) {
  return isPrincipalId(aliasOrId)
    ? String(aliasOrId)
    : principalFixtureId(aliasOrId);
}

if (!migrationUrl) {
  throw new Error("DATABASE_MIGRATION_URL is required for the local discussion role proof");
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
  proofDatabase = await createScratchDatabase(migrationUrl);
  const authority = await runFmarchMigrations({
    cwd: repoRoot,
    migrationUrl: proofDatabase.migrationUrl,
  });
  const apiBaseUrl = await startApi(authority.applicationUrl);
  const frontendBaseUrl = await startFrontend(apiBaseUrl);
  browser = await chromium.launch();

  const sessions = await createSessions(apiBaseUrl);
  const area = await createArea(apiBaseUrl, sessions.moderatorToken);
  const member = await browser.newContext();
  const moderator = await browser.newContext();
  await setSessionCookie(member, frontendBaseUrl, sessions.memberToken);
  await setSessionCookie(moderator, frontendBaseUrl, sessions.moderatorToken);
  try {
    const directory = await proveCommunityDirectory(member, frontendBaseUrl, area.slug);
    const empty = await proveEmptyArea(member, frontendBaseUrl);
    const browserTopic = await createTopicAndReply(member, frontendBaseUrl);
    const seeded = await seedTopics(apiBaseUrl, sessions.memberToken, area.slug);
    const pagination = await provePagination(
      member,
      frontendBaseUrl,
      apiBaseUrl,
      sessions.memberPrincipalAlias,
      browserTopic.topic,
    );
    const quotations = await proveQuotations(member, frontendBaseUrl, browserTopic.topic);
    const editing = await proveEditing({
      member,
      moderator,
      frontendBaseUrl,
      apiBaseUrl,
      memberToken: sessions.memberToken,
      moderatorToken: sessions.moderatorToken,
      topic: browserTopic.topic,
    });
    const draftIdentity = await proveDraftIdentity({
      member,
      frontendBaseUrl,
      apiBaseUrl,
      memberToken: sessions.memberToken,
    });
    const curation = await proveCuration({
      moderator,
      frontendBaseUrl,
      apiBaseUrl,
      memberToken: sessions.memberToken,
      moderatorToken: sessions.moderatorToken,
      topic: browserTopic.topic,
    });
    const moderation = await proveModeration({
      member,
      moderator,
      frontendBaseUrl,
      topic: browserTopic.topic,
    });
    const signup = await proveSignupOrigin({ member, moderator, frontendBaseUrl, apiBaseUrl, sessions });
    const evidence = {
      version: 1,
      proof: "discussion-role-proof",
      status: "passed",
      scope: "local-discussion-role-proof",
      releaseReady: false,
      productionReady: false,
      proofBoundary:
        "Local scratch-Postgres, local Rust API, enabled accounts with public contribution profiles, canonical SvelteKit community routes, and Chromium proof. It proves the public area directory, profile-backed topic and post bylines, keyset pagination and reload, canonical post anchors, author post editing inside the window with an edited marker and stale-revision refusal, author retraction as a placeholder that keeps cited excerpts, non-author edit denial, draft identity across same-route pagination and post refresh with explicit conflict reset, GlobalMod rename, pin (pinned-first area ordering), and move with the old area URL redirecting to the canonical one and member curation denied, GlobalMod posting-state moderation, denied member moderation, locked-topic recovery, and a host-selected signup origin through private setup, public start, game/topic links and watched-topic inbox delivery. It does not prove hosted availability, moderation staffing, retention, legal policy, direct messages, search, ranking, recommendations, or release readiness.",
      roleUrl: `${frontendBaseUrl}/discussions/${area.slug}`,
      api: {
        areaEndpoint: `${apiBaseUrl}/discussions/areas/${area.slug}`,
        pageSize,
        publicTopicFieldNames: ["topic", "title", "author", "posting_state", "visibility", "post_count", "updated_seq", "created_at", "updated_at", "last_post_seq", "last_post_at", "pinned", "spawned_games"],
        publicPostFieldNames: ["source_seq", "author", "body", "quotations", "mentions", "citation_count", "created_at", "revision", "edited_at", "retracted"],
      },
      directory,
      empty,
      browserTopic,
      seeded,
      pagination,
      quotations,
      editing,
      draftIdentity,
      curation,
      moderation,
      signup,
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

async function proveSignupOrigin({ member, moderator, frontendBaseUrl, apiBaseUrl, sessions }) {
  const headers = (token) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
  const topic = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics`, {
    method: "POST", headers: headers(sessions.moderatorToken),
    body: JSON.stringify({ title: "Signup for our game", body: "An ordinary host-authored discussion." }),
  });
  await fetchJson(`${apiBaseUrl}/subscriptions/${topic.topic}`, { method: "PUT", headers: headers(sessions.memberToken) });
  const hostPage = await moderator.newPage();
  const readerPage = await member.newPage();
  try {
    await hostPage.goto(`${frontendBaseUrl}/admin`, { waitUntil: "networkidle" });
    const picker = hostPage.getByTestId("admin-game-origin-topic");
    await picker.selectOption(topic.topic);
    const optionLabels = await picker.locator("option").allTextContents();
    if (optionLabels.some((label) => label.startsWith("Seed topic"))) throw new Error("origin picker exposed another author's topic");
    await Promise.all([
      hostPage.waitForURL(/\/g\/[0-9a-f-]+\/setup$/u),
      hostPage.getByTestId("admin-game-bootstrap-submit").click(),
    ]);
    const game = new URL(hostPage.url()).pathname.split("/")[2];
    await hostPage.getByTestId("host-setup-origin-topic").waitFor({ state: "visible" });
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${topic.topic}`;
    await readerPage.goto(topicUrl, { waitUntil: "networkidle" });
    if (await readerPage.getByTestId("discussion-spawned-games").count() !== 0) throw new Error("setup game leaked through topic banner");
    const setup = await fetch(`${apiBaseUrl}/games/${game}`);
    if (setup.status !== 404) throw new Error(`setup game unexpectedly public: ${setup.status}`);
    const before = await fetchJson(`${apiBaseUrl}/inbox`, { headers: headers(sessions.memberToken) });
    if (before.items.some((item) => item.href === `/games/${game}`)) throw new Error("setup game leaked through inbox");
    const command = await fetchJson(`${apiBaseUrl}/commands`, {
      method: "POST", headers: headers(sessions.moderatorToken),
      body: JSON.stringify({ v: 3, id: 90001, body: { kind: "Command", body: { command_id: randomUUID(), command: { StartGame: { game, phase: "D01" } } } } }),
    });
    if (command.body?.kind !== "Ack") throw new Error(`signup game start rejected: ${JSON.stringify(command)}`);
    await readerPage.reload({ waitUntil: "networkidle" });
    const banner = readerPage.getByTestId("discussion-spawned-games");
    await banner.waitFor({ state: "visible" });
    await banner.locator(`a[href="/games/${game}"]`).click();
    await readerPage.getByTestId("public-game-origin-topic").waitFor({ state: "visible" });
    if (await readerPage.getByTestId("public-game-origin-topic").locator("a").getAttribute("href") !== `/discussions/general/t/${topic.topic}`) throw new Error("public game lost origin link");
    await readerPage.goto(`${frontendBaseUrl}/inbox`, { waitUntil: "networkidle" });
    const gameLink = readerPage.locator(`a[href="/games/${game}"]`);
    if (await gameLink.count() !== 1) throw new Error("signup game delivery missing or duplicated");
    if (!(await readerPage.locator("body").innerText()).includes("Game started from a watched topic")) throw new Error("signup reason label missing");
    await readerPage.getByTestId("community-inbox-mark-all-read").click();
    await readerPage.waitForLoadState("networkidle");
    const after = await fetchJson(`${apiBaseUrl}/inbox`, { headers: headers(sessions.memberToken) });
    const delivery = after.items.find((item) => item.href === `/games/${game}`);
    if (!delivery || delivery.unread) throw new Error("signup delivery did not accept its delivery cursor");
    const thread = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${topic.topic}`);
    if (thread.topic.posting_state !== "open") throw new Error("starting game auto-locked signup topic");
    const watch = await fetchJson(`${apiBaseUrl}/subscriptions/${game}`, { headers: headers(sessions.memberToken) });
    if (watch.subscribed) throw new Error("starting game auto-subscribed topic watcher");
    return { status: "passed", topic: topic.topic, game, setupPrivate: true, inboxRead: true, noAutoWatchOrLock: true };
  } finally {
    await hostPage.close();
    await readerPage.close();
  }
}

async function createSessions(apiBaseUrl) {
  const memberPrincipalAlias = "discussion_member";
  const memberToken = await createDevSession(apiBaseUrl, memberPrincipalAlias, []);
  const moderatorToken = await createDevSession(apiBaseUrl, "discussion_moderator", ["GlobalAdmin", "GlobalMod"]);
  await createAccount(apiBaseUrl, moderatorToken, "member@example.test", memberPrincipalAlias, []);
  await createAccount(apiBaseUrl, moderatorToken, "moderator@example.test", "discussion_moderator", ["GlobalAdmin", "GlobalMod"]);
  await createProfile(apiBaseUrl, memberToken, "member_profile", "Discussion Member");
  await createProfile(apiBaseUrl, moderatorToken, "moderator_profile", "Discussion Moderator");
  return { memberToken, moderatorToken, memberPrincipalAlias };
}

async function createAccount(apiBaseUrl, adminToken, accountId, principalId, globalCapabilities) {
  await fetchJson(`${apiBaseUrl}/auth/accounts`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      account_id: accountId,
      password: "correct horse battery staple",
      principal_id: authorityPrincipalId(principalId),
      global_capabilities: globalCapabilities,
    }),
  });
}

async function createProfile(apiBaseUrl, token, handle, displayName) {
  await fetchJson(`${apiBaseUrl}/profiles`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      handle,
      display_name: displayName,
      bio: "Local community proof profile.",
      visibility: "public",
    }),
  });
}

async function createDevSession(apiBaseUrl, principalId, globalCapabilities) {
  const response = await fetchJson(`${apiBaseUrl}/auth/local-proof/sessions`, {
    method: "POST",
    headers: localProofAuth.requestHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({
      principal_id: authorityPrincipalId(principalId),
      expires_at: 4_102_444_800,
      global_capabilities: globalCapabilities,
    }),
  });
  if (response.principal_id !== authorityPrincipalId(principalId)) {
    throw new Error(`local discussion session did not resolve ${principalId}`);
  }
  if (typeof response.session_token !== "string" || response.session_token === "") {
    throw new Error(`local discussion session omitted token for ${principalId}`);
  }
  return response.session_token;
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

async function proveCommunityDirectory(context, frontendBaseUrl, slug) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/community`, { waitUntil: "networkidle" });
    await page.getByTestId(`community-area-${slug}`).waitFor({ state: "visible" });
    await page.getByTestId("role-nav-community").waitFor({ state: "visible" });
    return {
      status: "passed",
      directoryTestId: "community-area-general",
      navigationTestId: "role-nav-community",
    };
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
      page.waitForURL(/\/discussions\/general\/t\//, { timeout: 15000 }),
      page.getByTestId("discussion-create-topic-submit").click(),
    ]);
    await page.getByTestId("discussion-thread").waitFor({ state: "visible" });
    const topic = new URL(page.url()).pathname.split("/").at(-1);
    if (typeof topic !== "string" || topic.length !== 36) throw new Error("discussion topic form did not enter a canonical topic URL");
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

async function provePagination(context, frontendBaseUrl, apiBaseUrl, memberPrincipalAlias, browserTopic) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await page.goto(`${frontendBaseUrl}/discussions/general`, { waitUntil: "networkidle" });
    const firstCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (firstCardCount !== pageSize) throw new Error(`expected ${pageSize} discussion topics, got ${firstCardCount}`);
    const apiPage = await fetchJson(`${apiBaseUrl}/discussions/areas/general?limit=${pageSize}`);
    assertPublicDiscussionPage(apiPage, memberPrincipalAlias);
    const thread = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${browserTopic}?limit=50`);
    assertPublicDiscussionThread(thread, memberPrincipalAlias);
    const older = page.getByTestId("discussion-topic-older");
    await Promise.all([page.waitForURL(/\?cursor=/, { timeout: 15000 }), older.click()]);
    await page.waitForLoadState("networkidle");
    const olderCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (olderCardCount !== 1) throw new Error(`expected one older discussion topic, got ${olderCardCount}`);
    await page.reload({ waitUntil: "networkidle" });
    const reloadCardCount = await page.locator('article[data-testid^="discussion-topic-"]').count();
    if (reloadCardCount !== 1) throw new Error(`older discussion page did not survive reload: ${reloadCardCount}`);
    const body = await page.getByTestId("discussion-topic-index").innerText();
    if (body.includes(memberPrincipalAlias) || body.includes("author_user_id")) {
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

function assertPublicDiscussionThread(thread, memberPrincipalAlias) {
  const allowedArea = new Set(["slug", "title", "description"]);
  const allowedAuthor = new Set(["handle", "display_name"]);
  const allowedTopic = new Set(["topic", "title", "author", "posting_state", "visibility", "post_count", "updated_seq", "created_at", "updated_at", "last_post_seq", "last_post_at", "pinned", "spawned_games"]);
  const allowedPost = new Set(["source_seq", "author", "body", "quotations", "mentions", "citation_count", "created_at", "revision", "edited_at", "retracted"]);
  if (
    thread?.area === null ||
    Object.keys(thread.area).some((key) => !allowedArea.has(key)) ||
    thread?.topic === null ||
    typeof thread?.topic !== "object" ||
    !Array.isArray(thread?.posts) ||
    Object.keys(thread.topic).some((key) => !allowedTopic.has(key)) ||
    Object.keys(thread.topic.author ?? {}).some((key) => !allowedAuthor.has(key)) ||
    thread.posts.some(
      (post) =>
        Object.keys(post).some((key) => !allowedPost.has(key)) ||
        Object.keys(post.author ?? {}).some((key) => !allowedAuthor.has(key)) ||
        JSON.stringify(post).includes(memberPrincipalAlias),
    )
  ) {
    throw new Error(`public discussion thread leaked or drifted: ${JSON.stringify(thread)}`);
  }
}

function assertPublicDiscussionPage(page, memberPrincipalAlias) {
  const allowedArea = new Set(["slug", "title", "description"]);
  const allowedAuthor = new Set(["handle", "display_name"]);
  const allowedTopic = new Set(["topic", "title", "author", "posting_state", "visibility", "post_count", "updated_seq", "created_at", "updated_at", "last_post_seq", "last_post_at", "pinned", "spawned_games"]);
  if (
    page?.area === null ||
    typeof page?.area !== "object" ||
    !Array.isArray(page?.topics) ||
    Object.keys(page.area).some((key) => !allowedArea.has(key)) ||
    page.topics.some(
      (topic) =>
        Object.keys(topic).some((key) => !allowedTopic.has(key)) ||
        Object.keys(topic.author ?? {}).some((key) => !allowedAuthor.has(key)) ||
        JSON.stringify(topic).includes(memberPrincipalAlias),
    )
  ) {
    throw new Error(`public discussion API leaked or drifted: ${JSON.stringify(page)}`);
  }
}

async function proveQuotations(context, frontendBaseUrl, topic) {
  const page = await context.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${encodeURIComponent(topic)}`;
    await page.goto(topicUrl, { waitUntil: "networkidle" });
    const firstSeq = discussionPostSeq(await page.locator('article[data-testid^="discussion-post-"]').first().getAttribute("data-testid"));
    await Promise.all([
      page.waitForURL(new RegExp(`[?&]quote=${firstSeq}`), { timeout: 15000 }),
      page.getByTestId(`discussion-quote-${firstSeq}`).click(),
    ]);
    await page.getByTestId(`discussion-quote-chip-${firstSeq}`).waitFor({ state: "visible" });
    await page.getByTestId("discussion-post-body").fill("Quoting the opening.");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId("discussion-create-post-submit").click(),
    ]);
    const quoteBlocks = page.locator('[data-testid^="discussion-quote-block-"]');
    if (await quoteBlocks.count() < 1) {
      throw new Error("quoted reply did not render a structured quote block");
    }
    await page.getByTestId(`discussion-citations-${firstSeq}`).waitFor({ state: "visible" });
    const secondSeq = discussionPostSeq(await page.locator('article[data-testid^="discussion-post-"]').nth(1).getAttribute("data-testid"));
    await Promise.all([
      page.waitForURL(new RegExp(`[?&]quote=${firstSeq}`), { timeout: 15000 }),
      page.getByTestId(`discussion-quote-${firstSeq}`).click(),
    ]);
    await Promise.all([
      page.waitForURL(new RegExp(`[?&]quote=${secondSeq}`), { timeout: 15000 }),
      page.getByTestId(`discussion-quote-${secondSeq}`).click(),
    ]);
    await page.getByTestId(`discussion-quote-chip-${firstSeq}`).waitFor({ state: "visible" });
    await page.getByTestId(`discussion-quote-chip-${secondSeq}`).waitFor({ state: "visible" });
    await page.getByTestId("discussion-post-body").fill("Quoting two posts.");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId("discussion-create-post-submit").click(),
    ]);
    const newest = page.locator('article[data-testid^="discussion-post-"]').last();
    const multiQuoteCount = await newest.locator('[data-testid^="discussion-quote-block-"]').count();
    if (multiQuoteCount !== 2) {
      throw new Error(`expected two structured quotes on the multi-quote reply, got ${multiQuoteCount}`);
    }
    return {
      status: "passed",
      quotedCount: 1,
      multiQuoteCount,
      quoteControlTestId: `discussion-quote-${firstSeq}`,
      citationsTestId: `discussion-citations-${firstSeq}`,
    };
  } finally {
    await page.close();
  }
}

// Author editing and retraction from the canonical topic page, plus the API
// boundary refusals the page relies on: a stale revision is a 409 and a
// non-author is a 403, both without touching the post.
async function proveEditing({ member, moderator, frontendBaseUrl, apiBaseUrl, memberToken, moderatorToken, topic }) {
  const page = await member.newPage({ viewport: { width: 1024, height: 768 } });
  const otherPage = await moderator.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${encodeURIComponent(topic)}`;
    await page.goto(topicUrl, { waitUntil: "networkidle" });
    const articles = page.locator('article[data-testid^="discussion-post-"]');
    // The opening post is cited by the quotation proof; retracting it later
    // must keep that excerpt. The reply (second post) is edited.
    const openingSeq = discussionPostSeq(await articles.nth(0).getAttribute("data-testid"));
    const replySeq = discussionPostSeq(await articles.nth(1).getAttribute("data-testid"));

    // Edit the member's own reply from the page.
    await page.getByTestId(`discussion-edit-${replySeq}`).locator("summary").click();
    const editBody = page.getByTestId(`discussion-edit-body-${replySeq}`);
    await editBody.waitFor({ state: "visible" });
    if ((await editBody.inputValue()) !== "Browser reply from the authenticated member.") {
      throw new Error("edit form did not seed the current post body");
    }
    await editBody.fill("Browser reply, corrected by its author.");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId(`discussion-edit-submit-${replySeq}`).click(),
    ]);
    await page.getByTestId(`discussion-post-edited-${replySeq}`).waitFor({ state: "visible" });
    const editedBody = await page.getByTestId(`discussion-post-body-${replySeq}`).innerText();
    if (!editedBody.includes("corrected by its author")) throw new Error("edited body did not render");

    // The public read reports the revision and the API refuses a stale one.
    const thread = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${topic}?limit=50`);
    const edited = thread.posts.find((post) => String(post.source_seq) === replySeq);
    if (edited?.revision !== 1 || typeof edited?.edited_at !== "number" || edited?.retracted !== false) {
      throw new Error(`edited post did not report revision 1: ${JSON.stringify(edited)}`);
    }
    const stale = await fetch(`${apiBaseUrl}/discussions/topics/${topic}/posts/${replySeq}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "Second edit on a stale read", mentions: [], expected_revision: 0 }),
    });
    const foreign = await fetch(`${apiBaseUrl}/discussions/topics/${topic}/posts/${replySeq}`, {
      method: "PUT",
      headers: { authorization: `Bearer ${moderatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ body: "Moderator rewrite", mentions: [], expected_revision: 1 }),
    });
    const afterRefusals = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${topic}?limit=50`);
    const untouched = afterRefusals.posts.find((post) => String(post.source_seq) === replySeq);
    if (untouched?.revision !== 1 || untouched?.body !== "Browser reply, corrected by its author.") {
      throw new Error("a refused edit changed the post");
    }

    // Another member sees no edit or retract control on someone else's post.
    await otherPage.goto(topicUrl, { waitUntil: "networkidle" });
    if (await otherPage.getByTestId(`discussion-edit-${replySeq}`).count() !== 0) {
      throw new Error("another member was offered an edit control on a foreign post");
    }
    if (await otherPage.getByTestId(`discussion-retract-${replySeq}`).count() !== 0) {
      throw new Error("another member was offered a retract control on a foreign post");
    }

    // Retract the cited opening post; the placeholder replaces it and the
    // quoting post keeps the excerpt it cited.
    const quoteBlock = page.locator(`[data-testid^="discussion-quote-block-"][data-testid$="-${openingSeq}"]`).first();
    const citedExcerpt = (await quoteBlock.locator("p").innerText()).trim();
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId(`discussion-retract-${openingSeq}`).click(),
    ]);
    await page.getByTestId(`discussion-post-retracted-${openingSeq}`).waitFor({ state: "visible" });
    if (await page.getByTestId(`discussion-post-body-${openingSeq}`).count() !== 0) {
      throw new Error("retracted post still rendered its body");
    }
    if (await page.getByTestId(`discussion-quote-${openingSeq}`).count() !== 0) {
      throw new Error("retracted post still offered a quote control");
    }
    if (await page.getByTestId(`discussion-edit-${openingSeq}`).count() !== 0) {
      throw new Error("retracted post still offered an edit control");
    }
    const preservedExcerpt = (await page.locator(`[data-testid^="discussion-quote-block-"][data-testid$="-${openingSeq}"]`).first().locator("p").innerText()).trim();
    const retractedRead = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${topic}?limit=50`);
    const retracted = retractedRead.posts.find((post) => String(post.source_seq) === openingSeq);
    if (retracted?.retracted !== true || retracted?.body !== "" || retracted?.quotations?.length !== 0) {
      throw new Error(`retracted post leaked content: ${JSON.stringify(retracted)}`);
    }
    return {
      status: "passed",
      editedSeq: replySeq,
      editedRevision: edited.revision,
      editedMarkerTestId: `discussion-post-edited-${replySeq}`,
      staleEditStatus: stale.status,
      foreignEditStatus: foreign.status,
      retractedSeq: openingSeq,
      retractedPlaceholder: true,
      retractedPlaceholderTestId: `discussion-post-retracted-${openingSeq}`,
      citedExcerptPreserved: citedExcerpt !== "" && preservedExcerpt === citedExcerpt,
    };
  } finally {
    await page.close();
    await otherPage.close();
  }
}

// A single mounted route must not transfer drafts between paginated posts,
// or silently pair an old body/mention selection with a refreshed revision.
async function proveDraftIdentity({ member, frontendBaseUrl, apiBaseUrl, memberToken }) {
  const headers = { authorization: `Bearer ${memberToken}`, "content-type": "application/json" };
  const created = await fetchJson(`${apiBaseUrl}/discussions/areas/general/topics`, {
    method: "POST", headers,
    body: JSON.stringify({ title: "Draft identity counterexamples", body: "Oldest post with no mention." }),
  });
  const topic = created.topic;
  const handle = "moderator_profile";
  const mention = { handle, offset: 0, len: handle.length + 1 };
  for (let index = 1; index <= 51; index += 1) {
    await fetchJson(`${apiBaseUrl}/discussions/topics/${topic}/posts`, {
      method: "POST", headers,
      body: JSON.stringify({ body: `@${handle} Distinct post ${index}.`, mentions: [mention] }),
    });
  }
  const readThread = (query = "") => fetchJson(`${apiBaseUrl}/discussions/areas/general/topics/${topic}?limit=50${query}`);
  const newest = await readThread();
  const newerPost = newest.posts[0];
  const older = await readThread(`&before_seq=${newest.next_before_seq}`);
  const olderPost = older.posts[0];
  if (newest.posts.length !== 50 || older.posts.length !== 2) {
    throw new Error("draft identity proof must cross the real post pagination boundary");
  }
  const page = await member.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${topic}`;
    await page.goto(topicUrl, { waitUntil: "networkidle" });
    const documentIdentity = await page.evaluate(() => {
      window.__discussionDraftDocument = crypto.randomUUID();
      return window.__discussionDraftDocument;
    });
    const assertSameDocument = async () => {
      if (await page.evaluate(() => window.__discussionDraftDocument) !== documentIdentity) {
        throw new Error("draft identity counterexample accidentally used a full document reload");
      }
    };
    const openEditor = async (seq) => {
      const details = page.getByTestId(`discussion-edit-${seq}`);
      if (await details.getAttribute("open") === null) await details.locator("summary").click();
      await page.getByTestId(`discussion-edit-body-${seq}`).waitFor({ state: "visible" });
    };
    const assertDraft = async (seq, body, revision, expectedMentions) => {
      const form = page.getByTestId(`discussion-edit-form-${seq}`);
      if (await page.getByTestId(`discussion-edit-body-${seq}`).inputValue() !== body
        || await form.locator('[name="source_seq"]').inputValue() !== String(seq)
        || await form.locator('[name="expected_revision"]').inputValue() !== String(revision)
        || JSON.stringify(JSON.parse(await page.getByTestId(`discussion-edit-mentions-${seq}`).inputValue())) !== JSON.stringify(expectedMentions)) {
        throw new Error(`draft body, mentions, target, and base revision separated for post ${seq}`);
      }
    };
    const newerSeq = newerPost.source_seq;
    const olderSeq = olderPost.source_seq;
    await openEditor(newerSeq);
    const unsaved = `@${handle} Unsaved newer-page draft.`;
    await page.getByTestId(`discussion-edit-body-${newerSeq}`).fill(unsaved);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.has("before_seq")),
      page.getByTestId("discussion-posts-older").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await assertSameDocument();
    await openEditor(olderSeq);
    await assertDraft(olderSeq, olderPost.body, olderPost.revision, []);
    await Promise.all([
      page.waitForURL((url) => !url.searchParams.has("before_seq")),
      page.getByRole("link", { name: "Newest posts", exact: true }).click(),
    ]);
    await page.waitForLoadState("networkidle");
    await assertSameDocument();
    await openEditor(newerSeq);
    await assertDraft(newerSeq, newerPost.body, newerPost.revision, [mention]);

    // A quote query reruns this same route's load without destroying the page.
    // With an unchanged post revision it must retain the local edit exactly.
    await page.getByTestId(`discussion-edit-body-${newerSeq}`).fill(unsaved);
    await Promise.all([
      page.waitForURL((url) => url.searchParams.has("quote")),
      page.getByTestId(`discussion-quote-${newerSeq}`).click(),
    ]);
    await page.waitForLoadState("networkidle");
    await assertSameDocument();
    await assertDraft(newerSeq, unsaved, newerPost.revision, [mention]);

    // A second tab's edit is modeled by its real authenticated API command.
    // Another same-route query refresh must mark conflict and keep the old CAS.
    const latestBody = "Latest saved elsewhere, with no mention.";
    await fetchJson(`${apiBaseUrl}/discussions/topics/${topic}/posts/${newerSeq}`, {
      method: "PUT", headers,
      body: JSON.stringify({ body: latestBody, mentions: [], expected_revision: newerPost.revision }),
    });
    await Promise.all([
      page.waitForURL((url) => !url.searchParams.has("quote")),
      page.getByRole("link", { name: "Newest posts", exact: true }).click(),
    ]);
    await page.waitForLoadState("networkidle");
    await assertSameDocument();
    await page.getByTestId(`discussion-edit-conflict-${newerSeq}`).waitFor({ state: "visible" });
    await assertDraft(newerSeq, unsaved, newerPost.revision, [mention]);
    if (!await page.getByTestId(`discussion-edit-submit-${newerSeq}`).isDisabled()) {
      throw new Error("refreshed post revision left the stale edit submit enabled");
    }
    await page.getByTestId(`discussion-edit-reset-${newerSeq}`).click();
    await assertDraft(newerSeq, latestBody, newerPost.revision + 1, []);
    if (await page.getByTestId(`discussion-edit-submit-${newerSeq}`).isDisabled()
      || await page.getByTestId(`discussion-edit-conflict-${newerSeq}`).count() !== 0) {
      throw new Error("explicit latest-post reset did not resolve the draft conflict");
    }
    const finalBody = "Latest post revised after explicit draft reset.";
    await page.getByTestId(`discussion-edit-body-${newerSeq}`).fill(finalBody);
    await Promise.all([
      page.waitForURL((url) => url.hash === `#post-${newerSeq}`),
      page.getByTestId(`discussion-edit-submit-${newerSeq}`).click(),
    ]);
    const after = await readThread();
    const saved = after.posts.find((post) => post.source_seq === newerSeq);
    if (saved?.body !== finalBody || saved?.revision !== newerPost.revision + 2 || saved?.mentions?.length !== 0) {
      throw new Error("reset draft did not save its own body and mentions against its own base revision");
    }
    const afterOlder = await readThread(`&before_seq=${newest.next_before_seq}`);
    if (afterOlder.posts.find((post) => post.source_seq === olderSeq)?.body !== olderPost.body) {
      throw new Error("paginated draft changed an unrelated post");
    }
    return {
      status: "passed", topic,
      sameDocumentNavigation: true,
      paginationDraftIsolated: true,
      unchangedRefreshPreserved: true,
      changedRevisionBlocked: true,
      resetBodyMentionsAndRevision: true,
    };
  } finally {
    await page.close();
  }
}

// GlobalMod curation from the topic page: rename, pin (the topic then leads
// the area's first page), and move to a second area, after which the old
// area URL redirects to the canonical one. A member is refused at the API.
async function proveCuration({ moderator, frontendBaseUrl, apiBaseUrl, memberToken, moderatorToken, topic }) {
  const page = await moderator.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    await fetchJson(`${apiBaseUrl}/discussions/areas`, {
      method: "POST",
      headers: { authorization: `Bearer ${moderatorToken}`, "content-type": "application/json" },
      body: JSON.stringify({ slug: "archive", title: "Archive", description: "Filed topics." }),
    });
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${encodeURIComponent(topic)}`;
    await page.goto(topicUrl, { waitUntil: "networkidle" });
    await page.getByTestId("discussion-rename-title").fill("Browser-created topic (filed)");
    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId("discussion-rename-submit").click(),
    ]);
    const heading = (await page.getByTestId("discussion-topic-heading").innerText()).trim();
    if (heading !== "Browser-created topic (filed)") throw new Error(`rename did not render: ${heading}`);

    await Promise.all([
      page.waitForLoadState("networkidle"),
      page.getByTestId("discussion-pin-submit").click(),
    ]);
    await page.getByTestId("discussion-topic-pinned").waitFor({ state: "visible" });
    await page.goto(`${frontendBaseUrl}/discussions/general`, { waitUntil: "networkidle" });
    const firstCard = page.locator('article[data-testid^="discussion-topic-"]').first();
    const firstId = String(await firstCard.getAttribute("data-testid")).replace(/^discussion-topic-/, "");
    const pinnedFirst = firstId === topic
      && (await page.getByTestId(`discussion-topic-pinned-${topic}`).count()) === 1;
    if (!pinnedFirst) throw new Error(`pinned topic did not lead the area page: ${firstId}`);

    const memberCuration = await fetch(`${apiBaseUrl}/discussions/topics/${topic}/curation`, {
      method: "POST",
      headers: { authorization: `Bearer ${memberToken}`, "content-type": "application/json" },
      body: JSON.stringify({ pinned: false }),
    });

    await page.goto(topicUrl, { waitUntil: "networkidle" });
    await page.getByTestId("discussion-move-area").selectOption("archive");
    await Promise.all([
      page.waitForURL(/\/discussions\/archive\/t\//, { timeout: 15000 }),
      page.getByTestId("discussion-move-submit").click(),
    ]);
    await page.waitForLoadState("networkidle");
    await page.goto(topicUrl, { waitUntil: "networkidle" });
    const redirectedToCanonical = new URL(page.url()).pathname === `/discussions/archive/t/${topic}`;
    if (!redirectedToCanonical) throw new Error(`old area URL did not redirect: ${page.url()}`);
    await page.getByTestId("discussion-thread").waitFor({ state: "visible" });
    const moved = await fetchJson(`${apiBaseUrl}/discussions/areas/archive?limit=${pageSize}`);
    if (!moved.topics.some((entry) => entry.topic === topic && entry.pinned === true && entry.title === "Browser-created topic (filed)")) {
      throw new Error("moved topic is not filed under the new area with its curation intact");
    }
    const general = await fetchJson(`${apiBaseUrl}/discussions/areas/general?limit=${pageSize}`);
    if (general.topics.some((entry) => entry.topic === topic)) {
      throw new Error("moved topic still listed in its old area");
    }
    return {
      status: "passed",
      renamedTitle: heading,
      pinnedFirst,
      memberCurationStatus: memberCuration.status,
      redirectedToCanonical,
      canonicalPath: `/discussions/archive/t/${topic}`,
    };
  } finally {
    await page.close();
  }
}

function discussionPostSeq(testId) {
  const seq = String(testId ?? "").replace(/^discussion-post-/, "");
  if (!/^[1-9][0-9]*$/u.test(seq)) {
    throw new Error(`discussion post test id was not canonical: ${testId}`);
  }
  return seq;
}

async function proveModeration({ member, moderator, frontendBaseUrl, topic }) {
  const memberPage = await member.newPage({ viewport: { width: 1024, height: 768 } });
  const moderatorPage = await moderator.newPage({ viewport: { width: 1024, height: 768 } });
  try {
    const topicUrl = `${frontendBaseUrl}/discussions/general/t/${encodeURIComponent(topic)}`;
    await memberPage.goto(topicUrl, { waitUntil: "networkidle" });
    await memberPage.getByTestId("discussion-moderation-denied").waitFor({ state: "visible" });
    await moderatorPage.goto(topicUrl, { waitUntil: "networkidle" });
    await moderatorPage.getByTestId("discussion-moderation-controls").waitFor({ state: "visible" });
    await moderatorPage.getByTestId("discussion-posting-state").selectOption("locked");
    await Promise.all([
      moderatorPage.waitForLoadState("networkidle"),
      moderatorPage.getByTestId("discussion-posting-state-submit").click(),
    ]);
    await moderatorPage.getByTestId("discussion-topic-locked").waitFor({ state: "visible" });
    await memberPage.reload({ waitUntil: "networkidle" });
    await memberPage.getByTestId("discussion-topic-locked").waitFor({ state: "visible" });
    if (await memberPage.getByTestId("discussion-create-post-submit").count() !== 0) {
      throw new Error("locked discussion topic retained a member posting control");
    }
    if (await memberPage.locator('a[data-testid^="discussion-quote-"]').count() !== 0) {
      throw new Error("locked discussion topic retained quote controls");
    }
    return {
      status: "passed",
      deniedTestId: "discussion-moderation-denied",
      moderatorFormTestId: "discussion-moderation-controls",
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
    evidence.directory?.status !== "passed" ||
    evidence.empty?.status !== "passed" ||
    evidence.browserTopic?.postCount !== 2 ||
    evidence.seeded?.count !== pageSize ||
    evidence.pagination?.firstCardCount !== pageSize ||
    evidence.pagination?.olderCardCount !== 1 ||
    evidence.pagination?.reloadCardCount !== 1 ||
    evidence.pagination?.publicThreadPostCount !== 2 ||
    evidence.pagination?.rawAccountDataVisible !== false ||
    evidence.quotations?.status !== "passed" ||
    evidence.quotations?.quotedCount !== 1 ||
    evidence.quotations?.multiQuoteCount !== 2 ||
    evidence.editing?.status !== "passed" ||
    evidence.editing?.editedRevision !== 1 ||
    evidence.editing?.staleEditStatus !== 409 ||
    evidence.editing?.foreignEditStatus !== 403 ||
    evidence.editing?.retractedPlaceholder !== true ||
    evidence.editing?.citedExcerptPreserved !== true ||
    evidence.draftIdentity?.status !== "passed" ||
    evidence.draftIdentity?.sameDocumentNavigation !== true ||
    evidence.draftIdentity?.paginationDraftIsolated !== true ||
    evidence.draftIdentity?.unchangedRefreshPreserved !== true ||
    evidence.draftIdentity?.changedRevisionBlocked !== true ||
    evidence.draftIdentity?.resetBodyMentionsAndRevision !== true ||
    evidence.curation?.status !== "passed" ||
    evidence.curation?.pinnedFirst !== true ||
    evidence.curation?.memberCurationStatus !== 403 ||
    evidence.curation?.redirectedToCanonical !== true ||
    evidence.moderation?.status !== "passed" ||
    evidence.signup?.status !== "passed"
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
  return { name, adminUrl: admin.toString(), migrationUrl: scratch.toString() };
}

async function dropScratchDatabase({ adminUrl, name }) {
  await runProcess("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${sqlLiteral(name)}`]);
  await runProcess("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-c", `DROP DATABASE IF EXISTS "${name}"`]);
}

async function startApi(applicationUrl) {
  const port = await freePort();
  const baseUrl = `http://${host}:${port}`;
  const mediaRoot = path.join(artifactDir, "media-store");
  await mkdir(mediaRoot, { recursive: true, mode: 0o700 });
  server = spawn("cargo", ["run", "-p", "server"], {
    cwd: repoRoot,
    env: localProofAuth.serverEnvironment({ ...serverRuntimeEnvironment({ applicationUrl }), FMARCH_BIND: `${host}:${port}`, FMARCH_MEDIA_ROOT: mediaRoot, RUST_LOG: process.env.RUST_LOG ?? "warn" }),
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
