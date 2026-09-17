import assert from "node:assert/strict";

export async function proveExplicitHostReconnect({ page, game, expectedCount }) {
  const before = await snapshot(page);
  const requests = [];
  const responses = [];
  const tracked = new Map();
  const sockets = [];
  let triggerSnapshot;
  const onRequest = (request) => {
    const url = new URL(request.url());
    const projection = [`/api/gameplay/games/${game}/host-console-state`, `/api/gameplay/games/${game}/votecount`].includes(url.pathname);
    const ticket = url.pathname === "/live/tickets" && url.searchParams.get("game") === game;
    if (!projection && !ticket) return;
    const evidence = { id: requests.length, pathname: url.pathname, method: request.method(), kind: ticket ? "ticket" : "projection" };
    tracked.set(request, evidence);
    requests.push(evidence);
  };
  const onResponse = (response) => {
    const request = tracked.get(response.request());
    if (request) responses.push({ ...request, status: response.status() });
  };
  const onSocket = (socket) => {
    // Ticket-bearing URLs and payloads do not belong in proof diagnostics.
    const pathname = new URL(socket.url()).pathname;
    if (pathname !== "/ws") return;
    const evidence = { pathname, errors: [], closed: false };
    sockets.push(evidence);
    socket.on("socketerror", (error) => evidence.errors.push(String(error)));
    socket.on("close", () => { evidence.closed = true; });
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("websocket", onSocket);
  try {
    // The bridge resolves only after the new socket's exact scoped Hello and
    // authoritative refresh; its return value is that actual recovered snapshot.
    triggerSnapshot = await page.evaluate(() => window.__fmarchReconnectHostLiveProjectionNow());
    await page.waitForFunction((count) => window.__fmarchHostVotecountProjection?.some(
      (row) => row.target === "slot_1" && row.count === count,
    ), expectedCount);
    const evidence = { game, expectedCount, eventStart: before.eventCount, before, after: await snapshot(page), triggerSnapshot, requests, responses, sockets };
    const { wakeIndex, recoveryIndex } = assertExplicitHostReconnect(evidence);
    return { ...evidence, status: "passed", wakeIndex, recoveryIndex, reconnectEvent: evidence.after.events[recoveryIndex] };
  } catch (error) {
    const after = await snapshot(page).catch((readError) => ({ snapshotError: String(readError) }));
    throw new Error(`explicit host reconnect failed: ${JSON.stringify({ game, expectedCount, before, after, triggerSnapshot, requests, responses, sockets })}`, { cause: error });
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("websocket", onSocket);
  }
}

export function assertExplicitHostReconnect(evidence) {
  const { game, expectedCount, eventStart, before, after, triggerSnapshot, requests, responses, sockets } = evidence;
  assert.equal(typeof game, "string");
  assert.ok(game.length > 0);
  assert.ok(Number.isSafeInteger(expectedCount) && expectedCount >= 0);
  for (const state of [before, after]) {
    const endpoint = new URL(state.endpoint, "http://fixture.invalid");
    assert.equal(endpoint.pathname, "/live/tickets");
    assert.equal(endpoint.searchParams.get("game"), game);
    assert.equal(endpoint.searchParams.get("channel") ?? "main", "main");
    assert.equal(endpoint.searchParams.get("slot_id"), null);
    assert.equal(state.eventCount, state.events.length);
  }
  assert.equal(eventStart, before.eventCount);
  assert.ok(Number.isSafeInteger(eventStart) && eventStart >= 0);
  assert.deepEqual(after.events.slice(0, eventStart), before.events);
  const wakeIndex = after.events.findIndex((event, index) => index >= eventStart &&
    event?.kind === "reconnecting" && event.reason === "browser_proof" && Number.isSafeInteger(event.attempt) && event.attempt >= 1);
  assert.ok(wakeIndex >= eventStart, "explicit wake must occur after the captured boundary");
  const recoveryIndex = after.events.findIndex((event, index) => index > wakeIndex &&
    event?.kind === "reconnect" && event.state === "recovered" && Number.isSafeInteger(event.attempt) && event.attempt >= 0);
  assert.ok(recoveryIndex > wakeIndex, "new generation must recover after explicit wake");
  assert.ok(["recovered", "connected", "updated"].includes(after.health?.state));
  for (const rows of [triggerSnapshot?.votecount, after.projection]) {
    assert.ok(rows?.some((row) => row.target === "slot_1" && row.count === expectedCount));
  }
  for (const pathname of ["/live/tickets", `/api/gameplay/games/${game}/host-console-state`, `/api/gameplay/games/${game}/votecount`]) {
    assert.ok(responses.some((response) => response.pathname === pathname && response.status === 200 &&
      requests.some((request) => request.id === response.id && request.pathname === pathname && request.method === (pathname === "/live/tickets" ? "POST" : "GET"))), `missing new successful request for ${pathname}`);
  }
  assert.ok(sockets.some((socket) => socket.pathname === "/ws" && !socket.closed && socket.errors.length === 0), "recovery requires a new open socket");
  return { wakeIndex, recoveryIndex };
}

export function hasExplicitHostReconnect(evidence) {
  try { assertExplicitHostReconnect(evidence); return true; } catch { return false; }
}

async function snapshot(page) {
  return await page.evaluate(() => ({
    endpoint: window.__fmarchHostLiveProjectionEndpoint,
    eventCount: (window.__fmarchHostLiveProjectionEvents ?? []).length,
    events: window.__fmarchHostLiveProjectionEvents ?? [],
    projection: window.__fmarchHostVotecountProjection ?? [],
    health: window.__fmarchHostLiveProjectionStatus,
    metrics: window.__fmarchGetHostLiveProjectionMetrics?.() ?? null,
  }));
}
