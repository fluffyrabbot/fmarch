import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { runFmarchMigrations, serverRuntimeEnvironment } from "./run_fmarch_migrations.mjs";
import { createLocalProofAuth } from "./local_proof_auth.mjs";
import { fixturePrincipalAuthorityId } from "./principal_fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontendRoot = path.join(root, "frontend");
const frontendRequire = createRequire(path.join(frontendRoot, "package.json"));
const artifactDir = path.resolve(process.env.FMARCH_PROOF_ARTIFACT_DIR ?? path.join(root, "target", "community-subscription-role-proof"));
const evidencePath = path.join(artifactDir, "community-subscription-proof.json");
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
  const watcher = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const author = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  try {
    await cookie(watcher, frontendBase, seeded.watcherToken);
    await cookie(author, frontendBase, seeded.authorToken);
    const watch = await watchTopic(watcher, frontendBase, seeded);
    await publishReply(author, frontendBase, seeded, "First subscribed reply");
    const fanout = await inspectInbox(watcher, frontendBase, seeded, 1, 1, true);
    const mute = await proveMuteBoundary(watcher, author, frontendBase, seeded);
    const read = await markRead(watcher, frontendBase);
    await unwatch(watcher, frontendBase);
    await publishReply(author, frontendBase, seeded, "Reply during inactive watch");
    const inactive = await inspectInbox(watcher, frontendBase, seeded, 1, 0, false);
    await watchTopic(watcher, frontendBase, seeded);
    await publishReply(author, frontendBase, seeded, "Reply after resubscribe");
    const restoredWatch = await inspectInbox(watcher, frontendBase, seeded, 2, 1, true);
    const newest = (await json(`${apiBase}/discussions/areas/subscriptions/topics/${seeded.topic}?limit=50`)).posts.at(-1).source_seq;
    const report = await json(`${apiBase}/moderation/reports`, post({
      surface_id: seeded.topic,
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
    const editedMentions = await proveEditedMentionDelivery({
      watcher, author, apiBase, frontendBase, seeded,
    });
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
      proofBoundary: "Local scratch Postgres, typed member-target subscription and mute streams, personalized read overlays, local API, SvelteKit, and two member Chromium contexts. Proves public topic watches, durable privacy-safe inbox updates, private reversible profile mutes across profile controls, discussion, search, and inbox, monotonic read advancement, inactive-period exclusion, moderation hide/restore suppression, and late edited mentions ordered by their committed delivery event while preserving the original post destination. Watched and unwatched recipients clear those deliveries through the rendered per-topic and global read forms; unchanged and removed/re-added mentions do not reopen them. Does not prove direct-message blocking, private-channel blocking, recommendation ranking, hosted delivery, or release readiness.",
      watcherRoleUrl: `${frontendBase}/inbox`,
      authorRoleUrl: `${frontendBase}/discussions/subscriptions/t/${seeded.topic}`,
      watch,
      fanout,
      mute,
      read,
      inactive,
      restoredWatch,
      editedMentions,
      moderation: {
        reportId: report.report_id,
        hidden,
        restored: moderationRestored,
      },
      denied: { status: "passed", httpStatus: deniedResponse?.status() },
    };
    if (!watch.subscribed || !fanout.privacySafe || !mute.private || !mute.reversible
      || read.unread !== 0
      || inactive.items !== 1 || restoredWatch.items !== 2
      || hidden.items !== 1 || moderationRestored.items !== 2
      || editedMentions.watched.status !== "passed" || editedMentions.unwatched.status !== "passed"
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

async function proveMuteBoundary(watcher, author, base, seeded) {
  const profile = await watcher.newPage();
  await profile.goto(`${base}/u/subscription_author`, { waitUntil: "networkidle" });
  const control = profile.getByTestId("profile-member-mute-control");
  if (!(await control.innerText()).includes("Mute member")) {
    throw new Error("profile did not expose the private mute control");
  }
  await control.click();
  await profile.waitForLoadState("networkidle");
  const active = (await profile.getByTestId("profile-member-mute-control").innerText()).includes("Unmute member");
  await profile.close();

  const watcherThread = await watcher.newPage();
  await watcherThread.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
  const watcherPostsWhileMuted = await watcherThread.locator('article[data-testid^="discussion-post-"]').count();
  await watcherThread.close();
  const authorThread = await author.newPage();
  await authorThread.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
  const authorPostsWhileMuted = await authorThread.locator('article[data-testid^="discussion-post-"]').count();
  await authorThread.close();

  const watcherSearch = await watcher.newPage();
  await watcherSearch.goto(`${base}/search?q=subscribed&filter=discussions`, { waitUntil: "networkidle" });
  const watcherSearchResults = await watcherSearch.locator('[data-testid^="public-search-result-"]').count();
  await watcherSearch.close();
  const authorSearch = await author.newPage();
  await authorSearch.goto(`${base}/search?q=subscribed&filter=discussions`, { waitUntil: "networkidle" });
  const authorSearchResults = await authorSearch.locator('[data-testid^="public-search-result-"]').count();
  await authorSearch.close();

  const inbox = await watcher.newPage();
  await inbox.goto(`${base}/inbox`, { waitUntil: "networkidle" });
  const hiddenInboxItems = await inbox.locator('[data-testid^="community-inbox-item-"]').count();
  const muteListText = await inbox.getByTestId("community-muted-members").innerText();
  await inbox.getByTestId("community-muted-member-unmute-subscription_author").click();
  await inbox.waitForLoadState("networkidle");
  const muteListAfter = await inbox.getByTestId("community-muted-members").innerText();
  const restoredInboxItems = await inbox.locator('[data-testid^="community-inbox-item-"]').count();
  await inbox.close();

  const restoredThread = await watcher.newPage();
  await restoredThread.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
  const restoredPosts = await restoredThread.locator('article[data-testid^="discussion-post-"]').count();
  await restoredThread.close();
  const privateBoundary = active
    && watcherPostsWhileMuted === 0
    && authorPostsWhileMuted > 0
    && watcherSearchResults === 0
    && authorSearchResults > 0
    && hiddenInboxItems === 0
    && muteListText.includes("Subscription Author");
  const reversible = !muteListAfter.includes("Subscription Author")
    && restoredInboxItems === 1
    && restoredPosts > 0;
  if (!privateBoundary || !reversible) {
    throw new Error(`mute boundary drifted: ${JSON.stringify({ active, watcherPostsWhileMuted, authorPostsWhileMuted, watcherSearchResults, authorSearchResults, hiddenInboxItems, restoredInboxItems, restoredPosts })}`);
  }
  return {
    status: "passed",
    private: privateBoundary,
    reversible,
    watcherPostsWhileMuted,
    authorPostsWhileMuted,
    watcherSearchResults,
    authorSearchResults,
    hiddenInboxItems,
    restoredInboxItems,
  };
}

async function seed(api) {
  const author = "subscription_author";
  const watcher = "subscription_watcher";
  const operator = "subscription_operator";
  const issuedTokens = new Map();
  for (const [principal, globals] of [
    [author, []],
    [watcher, []],
    [operator, ["GlobalAdmin", "GlobalMod"]],
  ]) {
    const session = await json(`${api}/auth/local-proof/sessions`, localProofPost({
      principal_id: fixturePrincipalAuthorityId(principal),
      expires_at: 4_102_444_800,
      global_capabilities: globals,
    }));
    issuedTokens.set(principal, requiredSessionToken(session));
  }
  const authorToken = issuedTokens.get(author);
  const watcherToken = issuedTokens.get(watcher);
  const operatorToken = issuedTokens.get(operator);
  for (const [account, principal, globals] of [
    ["subscription-author@example.test", author, []],
    ["subscription-watcher@example.test", watcher, []],
    ["subscription-operator@example.test", operator, ["GlobalAdmin", "GlobalMod"]],
  ]) {
    await json(`${api}/auth/accounts`, post({
      account_id: account,
      password: "correct horse battery staple",
      principal_id: fixturePrincipalAuthorityId(principal),
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

function requiredSessionToken(session) {
  if (typeof session?.session_token !== "string" || session.session_token === "") {
    throw new Error("dev session response omitted its backend-issued token");
  }
  return session.session_token;
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

async function publishReply(context, base, seeded, body, mentionHandle = null) {
  const page = await context.newPage();
  try {
    await page.goto(`${base}/discussions/subscriptions/t/${seeded.topic}`, { waitUntil: "networkidle" });
    const textarea = page.getByTestId("discussion-post-body");
    if (mentionHandle !== null) {
      await textarea.fill(`@${mentionHandle}`);
      await page.getByTestId(`discussion-mention-suggestion-${mentionHandle}`).click();
    }
    await textarea.fill(body);
    const mentions = JSON.parse(await page.getByTestId("discussion-mentions-field").inputValue());
    const expectedMentions = mentionHandle === null ? [] : [{ handle: mentionHandle, offset: 0, len: mentionHandle.length + 1 }];
    if (JSON.stringify(mentions) !== JSON.stringify(expectedMentions)) throw new Error("reply composer did not retain the selected mention");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      page.getByTestId("discussion-create-post-submit").click(),
    ]);
    const sourceSeq = Number(new URL(page.url()).hash.match(/^#post-([1-9][0-9]*)$/u)?.[1]);
    if (!Number.isSafeInteger(sourceSeq)) throw new Error("reply did not navigate to its original post anchor");
    await page.getByTestId(`discussion-post-${sourceSeq}`).waitFor({ state: "visible" });
    return sourceSeq;
  } finally {
    await page.close();
  }
}

async function proveEditedMentionDelivery({ watcher, author, apiBase, frontendBase, seeded }) {
  const inbox = await watcher.newPage();
  try {
    // Keep the established watch/mute/moderation journey's exact counts above.
    // These two fresh topics add independent ordering counterexamples afterward.
    await inbox.goto(`${frontendBase}/inbox`, { waitUntil: "networkidle" });
    if (await inbox.getByTestId("community-inbox-mark-all-read").count() > 0) {
      await submitInboxForm(inbox, inbox.getByTestId("community-inbox-mark-all-read"));
    }
    const result = {};
    for (const subscribed of [true, false]) {
      const mode = subscribed ? "watched" : "unwatched";
      const created = await json(`${apiBase}/discussions/areas/subscriptions/topics`, post({
        title: `Edited mention ordering (${mode})`,
        body: "Opening before any watch or mention",
      }, seeded.authorToken));
      const fixture = { ...seeded, topic: created.topic };
      if (subscribed) {
        const watch = await watchTopic(watcher, frontendBase, fixture);
        if (!watch.subscribed) throw new Error("edited mention fixture was not watched");
      }
      const sourceSeq = await publishReply(author, frontendBase, fixture, `Older post A (${mode}), no mention yet.`);
      const laterPostSeq = await publishReply(
        author, frontendBase, fixture,
        subscribed ? `Newer post B (${mode}).` : `@${seeded.watcher} Newer post B (${mode}).`,
        subscribed ? null : seeded.watcher,
      );
      const href = `/discussions/subscriptions/t/${fixture.topic}#post-${sourceSeq}`;
      if (sourceSeq >= laterPostSeq) throw new Error("edited mention fixture did not publish A before B");
      await inbox.goto(`${frontendBase}/inbox`, { waitUntil: "networkidle" });
      const initial = await json(`${apiBase}/inbox`, get(seeded.watcherToken));
      const initialRows = initial.items.filter((item) => item.surface_id === fixture.topic);
      if (initialRows.length !== (subscribed ? 2 : 1)
        || initialRows[0]?.source_seq !== laterPostSeq
        || initialRows[0]?.delivery_seq !== laterPostSeq
        || initialRows.some((item) => !item.unread || item.subscribed !== subscribed)) {
        throw new Error(`invalid initial edited mention inbox: ${JSON.stringify(initialRows)}`);
      }
      const baselineRead = await clearEditedMention(inbox, {
        apiBase, seeded: fixture, sourceSeq: laterPostSeq,
        expectedDeliverySeq: laterPostSeq, subscribed,
      });
      const baseline = await json(`${apiBase}/inbox`, get(seeded.watcherToken));
      if (baseline.unread_count !== 0 || baseline.items.some((item) => item.surface_id === fixture.topic && item.unread)) {
        throw new Error("read through post B did not clear the original deliveries");
      }

      const body = `@${seeded.watcher} First mention added to older post A (${mode}).`;
      const mentions = [{ handle: seeded.watcher, offset: 0, len: seeded.watcher.length + 1 }];
      const editSeq = await editMentionPost(apiBase, fixture, sourceSeq, 0, body, mentions);
      if (editSeq <= laterPostSeq) throw new Error("first mention edit did not follow post B");
      const expected = {
        apiBase, frontendBase, seeded: fixture, sourceSeq, href, subscribed,
        deliverySeq: editSeq,
        expectedItems: baseline.items.length + (subscribed ? 0 : 1),
      };
      const delivered = await inspectEditedMention(inbox, { ...expected, unread: true });
      const read = await clearEditedMention(inbox, {
        apiBase, seeded: fixture, sourceSeq, expectedDeliverySeq: editSeq, subscribed,
      });
      const cleared = await inspectEditedMention(inbox, { ...expected, unread: false });

      // An exact repeat is a no-op refusal; a changed body with the same
      // mention does append an edit, but neither may create another delivery.
      const repeat = await fetch(`${apiBase}/discussions/topics/${fixture.topic}/posts/${sourceSeq}`, {
        ...post({ body, mentions, expected_revision: 1 }, fixture.authorToken), method: "PUT",
      });
      if (repeat.status !== 409) throw new Error(`unchanged edit was not refused: ${repeat.status}`);
      const unchangedRetry = await inspectEditedMention(inbox, { ...expected, unread: false });
      const repeatEditSeq = await latestEditSequence(fixture.topic);
      if (repeatEditSeq !== editSeq) throw new Error("unchanged edit appended a new event");
      const revisions = [];
      for (const [revision, nextBody, nextMentions, operation] of [
        [1, `${body} Same mention, revised prose.`, mentions, "unchangedMentions"],
        [2, `Mention removed from older post A (${mode}).`, [], "removedMention"],
        [3, `@${seeded.watcher} Mention restored on older post A (${mode}).`, mentions, "readdedMention"],
      ]) {
        const nextEditSeq = await editMentionPost(apiBase, fixture, sourceSeq, revision, nextBody, nextMentions);
        if (nextEditSeq <= editSeq) throw new Error("followup edit did not append after first delivery");
        revisions.push({ operation, revision: revision + 1, editSeq: nextEditSeq,
          inbox: await inspectEditedMention(inbox, { ...expected, unread: false }) });
      }
      result[mode] = {
        status: "passed", topic: fixture.topic, sourceSeq, laterPostSeq, editSeq, href,
        baselineRead, delivered, read, cleared,
        unchangedRetry: { httpStatus: repeat.status, editSeq: repeatEditSeq, inbox: unchangedRetry },
        revisions,
      };
    }
    return result;
  } finally {
    await inbox.close();
  }
}

async function inspectEditedMention(page, {
  apiBase, frontendBase, seeded, sourceSeq, href, subscribed, deliverySeq, expectedItems, unread,
}) {
  await page.goto(`${frontendBase}/inbox`, { waitUntil: "networkidle" });
  const api = await json(`${apiBase}/inbox`, get(seeded.watcherToken));
  const matching = api.items.filter((item) => item.surface_id === seeded.topic && item.source_seq === sourceSeq);
  const item = matching[0];
  const rows = page.locator('[data-testid^="community-inbox-item-"]');
  const row = page.getByTestId(`community-inbox-item-${sourceSeq}`);
  const reasonLabel = row.getByTestId(`community-inbox-reason-${sourceSeq}`);
  await reasonLabel.waitFor({ state: "visible" });
  // Eyebrow CSS uppercases innerText; compare this visible row's semantic
  // reason and unread marker without changing their exact expected copy.
  const reason = (await reasonLabel.textContent())?.trim();
  const firstRow = await rows.first().getAttribute("data-testid");
  const displayedHref = await row.locator("h2 a").getAttribute("href");
  const summary = await page.getByTestId("community-inbox-summary").innerText();
  const displayedUnread = Number(summary.match(/(\d+) unread/)?.[1] ?? -1);
  if (matching.length !== 1 || api.items.length !== expectedItems || await rows.count() !== expectedItems
    || api.items[0] !== item || firstRow !== `community-inbox-item-${sourceSeq}`
    || await row.count() !== 1 || displayedHref !== href || item.href !== href
    || item.delivery_seq !== deliverySeq || item.reason !== "mention"
    || item.unread !== unread || item.subscribed !== subscribed
    || reason !== `Mention${unread ? " · Unread" : ""}`
    || api.unread_count !== Number(unread) || displayedUnread !== Number(unread)) {
    throw new Error(`edited mention order, grouping, destination, or read state drifted: ${JSON.stringify({ api, matching, firstRow, displayedHref, reason, displayedUnread, deliverySeq })}`);
  }
  const markRead = page.getByTestId(`community-inbox-read-${sourceSeq}`);
  if (await markRead.count() !== Number(subscribed && unread)) throw new Error("per-topic read control does not match watch/unread state");
  const perItemDeliverySeq = subscribed && unread
    ? Number(await row.locator('input[name="delivery_seq"]').inputValue()) : null;
  if (subscribed && unread && perItemDeliverySeq !== deliverySeq) throw new Error("per-item read form submitted the post identity instead of its delivery");
  return { item, items: api.items.length, unread: api.unread_count, firstRow, destinationCount: matching.length, displayedHref, reason, perItemDeliverySeq };
}

async function clearEditedMention(page, { apiBase, seeded, sourceSeq, expectedDeliverySeq, subscribed }) {
  const button = page.getByTestId(subscribed ? `community-inbox-read-${sourceSeq}` : "community-inbox-mark-all-read");
  const field = subscribed
    ? page.getByTestId(`community-inbox-item-${sourceSeq}`).locator('input[name="delivery_seq"]')
    : page.locator('input[name="read_through_seq"]');
  const submittedDeliverySeq = Number(await field.inputValue());
  if (submittedDeliverySeq !== expectedDeliverySeq) throw new Error(`read form expected delivery ${expectedDeliverySeq}, got ${submittedDeliverySeq}`);
  await submitInboxForm(page, button);
  const api = await json(`${apiBase}/inbox`, get(seeded.watcherToken));
  const target = await json(`${apiBase}/subscriptions/${seeded.topic}`, get(seeded.watcherToken));
  if (api.unread_count !== 0 || target.subscribed !== subscribed || target.latest_delivery_seq !== expectedDeliverySeq
    || (subscribed && (target.read_through_seq !== expectedDeliverySeq || target.unread_count !== 0))) {
    throw new Error(`read cursor did not clear edited mention: ${JSON.stringify({ api, target })}`);
  }
  return { mode: subscribed ? "per-topic" : "global", submittedDeliverySeq, unread: api.unread_count,
    subscribed: target.subscribed, targetReadThroughSeq: target.read_through_seq, latestDeliverySeq: target.latest_delivery_seq };
}

async function submitInboxForm(page, button) {
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle" }), button.click()]);
  if (await page.getByTestId("community-inbox-reject").count() > 0) throw new Error("inbox read form was rejected");
}

async function editMentionPost(apiBase, seeded, sourceSeq, revision, body, mentions) {
  await json(`${apiBase}/discussions/topics/${seeded.topic}/posts/${sourceSeq}`, {
    ...post({ body, mentions, expected_revision: revision }, seeded.authorToken), method: "PUT",
  });
  const thread = await json(`${apiBase}/discussions/areas/subscriptions/topics/${seeded.topic}?limit=50`);
  const current = thread.posts.find((item) => item.source_seq === sourceSeq);
  if (current?.revision !== revision + 1 || current.body !== body) throw new Error("mention edit did not update its post revision");
  return await latestEditSequence(seeded.topic);
}

async function latestEditSequence(topic) {
  if (!/^[0-9a-f-]{36}$/u.test(topic)) throw new Error("invalid fixture topic identity");
  // The public topic updated_seq remains its posting/curation cursor. Read
  // the committed event independently, rather than deriving expected delivery
  // from the very inbox projection under test. No sealed payload is read.
  const { stdout } = await promisify(execFile)("psql", [
    database.migrationUrl, "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-c",
    `SELECT seq FROM events WHERE stream_id = '${topic}' AND kind = 'DiscussionPostEdited' ORDER BY stream_seq DESC LIMIT 1`,
  ], { timeout: 15_000, maxBuffer: 64 * 1024 });
  const seq = Number(stdout.trim());
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error("committed mention edit event was not found");
  return seq;
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
function localProofPost(body) {
  const options = post(body);
  options.headers = localProofAuth.requestHeaders(options.headers);
  return options;
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
