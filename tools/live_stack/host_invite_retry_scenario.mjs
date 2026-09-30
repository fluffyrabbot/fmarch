import assert from "node:assert/strict";

const ACCOUNT = '[data-testid="host-player-invite-retry-account"]';
const SUBMIT = '[data-testid="host-player-invite-retry-submit"]';
const FORM = '[data-testid="host-player-invite-retry"]';

// Hold an actual authoritative read during an actual reconnect. Neither the
// route's health nor its projection is replaced with a test value.
export async function proveHostInviteRetryAfterRefresh({
  page, game, invitedAccountId, expectedTarget, timeoutMs = 15_000,
}) {
  const pathname = `/api/gameplay/games/${game}/host-console-state`;
  const hostPath = `/g/${game}/host`;
  const matches = (url) => url.pathname === pathname;
  const network = [];
  const tracked = new Map();
  let heldRoute;
  let released = false;
  let routed = false;
  let socketObserved = false;
  let reconnect;
  let originalInput;
  let before;
  let blocked;
  let after;
  let capture;
  let submitted;
  const captured = new Promise((resolve) => { capture = resolve; });
  const submission = new Promise((resolve) => { submitted = resolve; });
  const observeRequest = (request) => {
    const url = new URL(request.url());
    const invite = url.pathname === hostPath && url.searchParams.has("/issuePlayerInvite") && request.method() === "POST";
    if (!invite && url.pathname !== pathname) return;
    const record = { method: request.method(), pathname: url.pathname };
    if (invite) {
      const fields = new URLSearchParams(request.postData() ?? "");
      record.action = "issuePlayerInvite";
      record.bodyMatches = fields.get("accountId") === invitedAccountId &&
        Object.entries(expectedTarget).every(([key, value]) => fields.get(key) === value);
    }
    tracked.set(request, record);
    network.push(record);
    if (network.length > 30) network.shift();
  };
  const observeResponse = (response) => {
    const record = tracked.get(response.request());
    if (!record) return;
    record.status = response.status();
    if (record.action === "issuePlayerInvite") submitted({ ...record });
  };
  const observeFailure = (request) => {
    const record = tracked.get(request);
    if (record) record.failed = request.failure()?.errorText ?? "request failed";
  };
  const observeSocket = (socket) => {
    if (new URL(socket.url()).pathname === "/ws") socketObserved = true;
  };
  const handler = async (route) => {
    if (route.request().method() !== "GET" || heldRoute || !socketObserved) {
      await route.fallback();
      return;
    }
    heldRoute = route;
    capture();
  };
  page.on("request", observeRequest);
  page.on("response", observeResponse);
  page.on("requestfailed", observeFailure);
  try {
    // Native form rejection navigates to a new document. Wait for that
    // document's handshake before choosing the controlled refresh boundary.
    await page.waitForFunction(() => window.__fmarchHostLiveProjectionEvents?.some(
      (event) => event.kind === "hello" && event.state === "recovered",
    ), null, { timeout: timeoutMs });
    await page.waitForFunction((selector) => document.querySelector(selector)?.disabled === false, SUBMIT, { timeout: timeoutMs });
    await page.locator(ACCOUNT).fill(invitedAccountId);
    originalInput = await page.locator(ACCOUNT).elementHandle();
    assert.ok(originalInput, "retry account must exist before refresh");
    before = await snapshot(page, originalInput, invitedAccountId);
    assertInput(before, false, expectedTarget);

    await page.route(matches, handler);
    routed = true;
    // Only intercept the new socket generation's reads; an already-running
    // old-generation refresh may still be finishing before this wake.
    page.on("websocket", observeSocket);
    reconnect = page.evaluate(() => window.__fmarchReconnectHostLiveProjectionNow());
    // A failing browser reconnect is observed immediately, even while waiting
    // for interception; cleanup still releases any held request.
    reconnect.catch(() => {});
    await bounded(Promise.race([captured, reconnect.then(() => {
      throw new Error("reconnect completed without its held authoritative read");
    })]), timeoutMs, "no authoritative host read captured");
    await page.waitForFunction(() => document.querySelector('[data-testid="host-projection-command-health"]') !== null, null, { timeout: timeoutMs });
    blocked = await snapshot(page, originalInput, invitedAccountId);
    assertInput(blocked, true, expectedTarget);
    assert.equal(network.some((entry) => entry.action === "issuePlayerInvite"), false, "refresh must not submit an invite");

    await heldRoute.continue();
    released = true;
    await bounded(reconnect, timeoutMs, "host reconnect did not recover");
    await page.waitForFunction((selector) => document.querySelector(selector)?.disabled === false, SUBMIT, { timeout: timeoutMs });
    after = await snapshot(page, originalInput, invitedAccountId);
    assertInput(after, false, expectedTarget);
    const refresh = tracked.get(heldRoute.request());
    assert.equal(refresh?.status, 200, "held authoritative read must succeed");
    await page.locator(SUBMIT).click({ timeout: timeoutMs });
    const post = await bounded(submission, timeoutMs, "retry emitted no completed native POST");
    assert.equal(post.status, 200, "retry native POST must succeed");
    assert.equal(post.bodyMatches, true, "retry native POST must retain account and authority targets");
    await page.waitForFunction(() => document.querySelector('[data-testid="host-player-invite-status"]')?.getAttribute("data-state") === "ack", null, { timeout: timeoutMs });
    const evidence = {
      status: "passed", game, before, blocked, after,
      refresh: { ...refresh }, reconnect: { recovered: true, socketObserved }, submission: post,
      outcome: { state: "ack", urlRendered: await page.getByTestId("host-player-invite-url").count() === 1 },
    };
    assertHostInviteRetryRecovery(evidence);
    return evidence;
  } catch (error) {
    const current = await snapshot(page, originalInput, invitedAccountId)
      .catch(() => snapshot(page, null, invitedAccountId))
      .catch(() => ({ unavailable: true }));
    throw new Error(`host invite retry recovery failed: ${JSON.stringify({ game, before, blocked, after, current, network })}`, { cause: error });
  } finally {
    if (heldRoute && !released) await heldRoute.continue().catch(() => {});
    if (routed) await page.unroute(matches, handler);
    page.off("request", observeRequest);
    page.off("response", observeResponse);
    page.off("requestfailed", observeFailure);
    page.off("websocket", observeSocket);
    await originalInput?.dispose();
  }
}

export function assertHostInviteRetryRecovery(evidence) {
  assert.equal(evidence?.status, "passed");
  assert.equal(typeof evidence.game, "string");
  assert.ok(evidence.game.length > 0);
  assertInput(evidence.before, false);
  assertInput(evidence.blocked, true, evidence.before.target);
  assertInput(evidence.after, false, evidence.before.target);
  assert.equal(evidence.blocked.accountLength, evidence.before.accountLength);
  assert.equal(evidence.after.accountLength, evidence.before.accountLength);
  assert.equal(evidence.refresh?.method, "GET");
  assert.equal(evidence.refresh?.pathname, `/api/gameplay/games/${evidence.game}/host-console-state`);
  assert.equal(evidence.refresh?.status, 200);
  assert.equal(evidence.reconnect?.recovered, true);
  assert.equal(evidence.reconnect?.socketObserved, true);
  assert.equal(evidence.submission?.method, "POST");
  assert.equal(evidence.submission?.pathname, `/g/${evidence.game}/host`);
  assert.equal(evidence.submission?.action, "issuePlayerInvite");
  assert.equal(evidence.submission?.bodyMatches, true);
  assert.equal(evidence.submission?.status, 200);
  assert.equal(evidence.outcome?.state, "ack");
  assert.equal(evidence.outcome?.urlRendered, true);
  return true;
}

export function hasHostInviteRetryRecovery(evidence) {
  try { return assertHostInviteRetryRecovery(evidence); } catch { return false; }
}

function assertInput(state, disabled, expectedTarget = state?.target) {
  assert.equal(state?.sameInput, true, "retry account DOM node must remain mounted");
  assert.equal(state.accountMatches, true, "retry account must survive refresh");
  assert.ok(Number.isSafeInteger(state.accountLength) && state.accountLength > 0);
  assert.equal(state.accountDisabled, disabled);
  assert.equal(state.submitDisabled, disabled);
  assert.equal(state.valueMissing, false);
  for (const key of ["principalId", "slotId", "expectedOccupantPrincipalId"]) {
    assert.equal(typeof state.target?.[key], "string");
    assert.ok(state.target[key].length > 0);
  }
  assert.deepEqual(state.target, expectedTarget);
}

async function snapshot(page, originalInput, invitedAccountId) {
  return await page.evaluate(({ originalInput, invitedAccountId, accountSelector, submitSelector, formSelector }) => {
    const account = document.querySelector(accountSelector);
    const button = document.querySelector(submitSelector);
    const form = document.querySelector(formSelector);
    return {
      sameInput: account !== null && account === originalInput && account.isConnected,
      accountMatches: account?.value === invitedAccountId,
      accountLength: account?.value?.length ?? null,
      accountDisabled: account?.disabled ?? null,
      submitDisabled: button?.disabled ?? null,
      valueMissing: account?.validity?.valueMissing ?? null,
      target: Object.fromEntries(["principalId", "slotId", "expectedOccupantPrincipalId"].map((key) => [key, form?.elements.namedItem(key)?.value ?? null])),
      pathname: location.pathname,
      status: document.querySelector('[data-testid="host-player-invite-status"]')?.getAttribute("data-state") ?? null,
      statusMessage: document.querySelector('[data-testid="host-player-invite-status"]')?.textContent?.trim().slice(0, 300) ?? null,
      liveState: window.__fmarchHostLiveProjectionStatus?.state ?? null,
    };
  }, { originalInput: originalInput ?? null, invitedAccountId, accountSelector: ACCOUNT, submitSelector: SUBMIT, formSelector: FORM });
}

async function bounded(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}
