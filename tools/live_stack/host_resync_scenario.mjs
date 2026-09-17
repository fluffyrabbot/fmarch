import assert from "node:assert/strict";

export async function captureHostResyncBoundary(page, networkSnapshot) {
  await page.waitForFunction(() => ["recovered", "connected", "updated"].includes(window.__fmarchHostLiveProjectionStatus?.state));
  const state = await page.evaluate(() => ({
      endpoint: window.__fmarchHostLiveProjectionEndpoint,
      eventCount: (window.__fmarchHostLiveProjectionEvents ?? []).length,
      phase: window.__fmarchHostProjection?.phase,
      health: window.__fmarchHostLiveProjectionStatus,
      metrics: window.__fmarchGetHostLiveProjectionMetrics?.() ?? null,
    }));
  const endpoint = new URL(state.endpoint, "http://fixture.invalid");
  assert.equal(endpoint.pathname, "/live/tickets");
  assert.equal(endpoint.searchParams.get("channel") ?? "main", "main");
  assert.equal(endpoint.searchParams.get("slot_id"), null);
  assert.ok(endpoint.searchParams.get("game"));
  assert.ok(Number.isSafeInteger(state.eventCount) && state.eventCount > 0);
  assert.ok(["recovered", "connected", "updated"].includes(state.health?.state));
  const network = networkSnapshot();
  return {
    ...state, game: endpoint.searchParams.get("game"),
    networkCounts: Object.fromEntries(Object.entries(network).map(([key, rows]) => [key, rows.length])),
  };
}

export async function waitForHostCommandResync({ page, game, expected, before, commandReceipt, readApiState, diagnostics }) {
  const boundary = { game, eventCount: before.eventCount };
  let apiState;
  try {
    assert.equal(before.game, game);
    // Browser outcomes and the seed sender both retain the actual committed
    // stream sequences. The seed sender returns only after validating an ACK.
    if (commandReceipt.state !== undefined) assert.equal(commandReceipt.state, "ack");
    assert.ok(commandReceipt.streamSeqs?.length > 0 && commandReceipt.streamSeqs.every((seq) => Number.isSafeInteger(seq) && seq > 0));
    const command = commandReceipt.requestEnvelope?.body?.body?.command ?? commandReceipt.command;
    assert.equal(Object.keys(command)[0], expected.commandKind);
    assert.equal(command[expected.commandKind].game, game);
    const payload = command[expected.commandKind];
    if (expected.kind === "replacement") {
      assert.equal(payload.slot, expected.slotId);
      assert.equal(payload.incoming_principal_id, expected.principalId);
    }
    if (expected.kind === "slot") {
      assert.equal(payload.slot, expected.slotId);
      assert.equal(payload.status, expected.status);
    }
    if (expected.commandKind === "ResolveHostPrompt") assert.equal(payload.prompt_id, expected.promptId);
    await page.waitForFunction(selectHostCommandResync, { boundary, expected });
    const recovery = await page.evaluate(selectHostCommandResync, { boundary, expected });
    assert.ok(recovery);
    apiState = await readApiState(expected);
    assertHostApiState(apiState, expected);
    const network = networkSince(diagnostics(), before.networkCounts);
    const hasStartedRequest = (row) => network.requests.some((request) => request.id === row.requestId && request.pathname === row.pathname && request.method === row.method);
    assert.ok(network.tickets.some((row) => row.game === game && row.method === "POST" && row.status === 200 && hasStartedRequest(row)));
    assert.ok(network.sockets.some((row) => row.pathname === "/ws" && row.closed === false && row.errorCount === 0));
    const path = `/api/gameplay/games/${game}/${expected.kind === "prompt" ? "host-prompts" : "host-console-state"}`;
    assert.ok(network.projections.some((row) => row.pathname === path && row.method === "GET" && row.status === 200 && hasStartedRequest(row)));
    return { status: "passed", boundary, expected, before, commandReceipt, recovery, apiState, network };
  } catch (error) {
    const after = await page.evaluate((eventStart) => ({
      endpoint: window.__fmarchHostLiveProjectionEndpoint,
      projection: window.__fmarchHostProjection,
      prompts: window.__fmarchHostPromptsProjection,
      health: window.__fmarchHostLiveProjectionStatus,
      metrics: window.__fmarchGetHostLiveProjectionMetrics?.() ?? null,
      eventsSinceBoundary: (window.__fmarchHostLiveProjectionEvents ?? []).slice(eventStart),
    }), before.eventCount).catch((readError) => ({ snapshotError: String(readError) }));
    apiState ??= await readApiState(expected).catch((readError) => ({ readError: String(readError) }));
    throw new Error(`host command resync failed: ${JSON.stringify({ boundary, expected, before, commandReceipt, after, apiState, network: networkSince(diagnostics(), before.networkCounts) })}`, { cause: error });
  }
}

// Runs unchanged in Chromium and bounded tests. A manual wake or REST-only
// convergence cannot stand in for the command's scoped generation-ending resync.
export function selectHostCommandResync({ boundary, expected }) {
  const events = window.__fmarchHostLiveProjectionEvents ?? [];
  const resyncIndex = events.findIndex((event, index) => index >= boundary.eventCount &&
    event?.kind === "resync-required" && event.state === "reconnecting" &&
    event.scope?.game === boundary.game && event.scope.channel === "main" && event.scope.slotId === null &&
    event.audiences?.some((audience) => audience.kind === "Host" && audience.game === boundary.game) &&
    Number.isSafeInteger(event.fromEventSeq) && event.fromEventSeq >= 0);
  if (resyncIndex < 0) return null;
  const closeIndex = events.findIndex((event, index) => index > resyncIndex && event?.kind === "close" && event.code === 4001 && event.reason === "resync-required");
  const reconnectingIndex = events.findIndex((event, index) => index > closeIndex && event?.kind === "reconnecting" && event.reason === "close" && Number.isSafeInteger(event.attempt) && event.attempt >= 1);
  const recoveryIndex = events.findIndex((event, index) => index > reconnectingIndex && event?.kind === "reconnect" && event.state === "recovered" && Number.isSafeInteger(event.attempt) && event.attempt >= 1);
  if (closeIndex <= resyncIndex || reconnectingIndex <= closeIndex || recoveryIndex <= reconnectingIndex) return null;
  if (events.slice(boundary.eventCount, recoveryIndex).some((event) => event.kind === "reconnecting" && event.reason !== "close")) return null;
  if (!["recovered", "connected", "updated"].includes(window.__fmarchHostLiveProjectionStatus?.state)) return null;
  const projection = window.__fmarchHostProjection;
  const prompts = window.__fmarchHostPromptsProjection;
  const matches = expected.kind === "phase"
    ? projection?.phase?.id === expected.phaseId && projection.phase.locked === expected.locked
    : expected.kind === "replacement"
      ? projection?.replacement?.slotId === expected.slotId && projection.replacement.assignedPrincipalId === expected.principalId
      : expected.kind === "slot"
        ? projection?.slots?.some((slot) => slot.slot_id === expected.slotId && slot.status === expected.status && slot.alive === expected.alive)
        : expected.kind === "prompt" && prompts?.some((prompt) => prompt.id === expected.promptId && prompt.status === expected.status);
  if (!matches) return null;
  return { resyncIndex, closeIndex, reconnectingIndex, recoveryIndex, events: events.slice(boundary.eventCount, recoveryIndex + 1), projection, prompts,
    health: window.__fmarchHostLiveProjectionStatus, endpoint: window.__fmarchHostLiveProjectionEndpoint };
}

export function assertHostApiState(state, expected) {
  if (expected.kind === "phase") {
    assert.equal(state.phase.phase_id, expected.phaseId);
    assert.equal(state.phase.locked, expected.locked);
  } else if (expected.kind === "replacement") {
    assert.equal(state.slots.find((slot) => slot.slot_id === expected.slotId)?.assigned_principal_id, expected.principalId);
  } else if (expected.kind === "slot") {
    const slot = state.slots.find((row) => row.slot_id === expected.slotId);
    assert.equal(slot?.status, expected.status);
    assert.equal(slot?.alive, expected.alive);
  } else {
    assert.equal(expected.kind, "prompt");
    assert.equal(state.find((prompt) => prompt.prompt_id === expected.promptId)?.status, expected.status);
  }
}

export function hostNetworkDiagnostics({ tickets, sockets, projections, requests }) {
  return {
    tickets: tickets.map((ticket) => ({ requestId: ticket.requestId, pathname: new URL(ticket.url).pathname, game: new URL(ticket.url).searchParams.get("game"), method: ticket.method, status: ticket.status })),
    sockets: sockets.map((socket) => ({ pathname: new URL(socket.url).pathname, closed: socket.closed === true, errorCount: socket.errors.length, frameCount: socket.frames.length })),
    projections: projections.map((row) => ({ ...row })),
    requests: requests.map((row) => ({ ...row })),
  };
}

function networkSince(network, counts) {
  return Object.fromEntries(Object.entries(network).map(([key, rows]) => [key, rows.slice(counts[key])]));
}
