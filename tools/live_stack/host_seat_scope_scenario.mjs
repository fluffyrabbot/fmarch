import assert from "node:assert/strict";

// Observe the real browser refresh path; the SSR request itself is server-side.
export function observeHostSeatReads(page, game) {
  const reads = [];
  const onResponse = (response) => {
    const url = new URL(response.url());
    if (url.pathname !== `/api/gameplay/games/${game}/host-console-state`) return;
    reads.push({
      pathname: url.pathname,
      slotIds: url.searchParams.getAll("slot_id"),
      method: response.request().method(),
      status: response.status(),
    });
  };
  page.on("response", onResponse);
  return {
    reads,
    stop: () => page.off("response", onResponse),
  };
}

export function assertHostSeatScope(evidence) {
  const { game, slotId, principalId, pageUrl, reads, replacement, inviteTarget } = evidence;
  const route = new URL(pageUrl);
  assert.equal(route.pathname, `/g/${game}/host`);
  assert.deepEqual(route.searchParams.getAll("slot_id"), [slotId]);
  const scopedReads = reads.filter((read) =>
    read.pathname === `/api/gameplay/games/${game}/host-console-state` &&
    read.method === "GET" && read.status === 200);
  assert.ok(scopedReads.length > 0, "no successful browser host state refresh");
  for (const read of scopedReads) assert.deepEqual(read.slotIds, [slotId]);
  assert.equal(replacement?.slotId, slotId);
  assert.equal(replacement?.assignedPrincipalId, principalId);
  assert.equal(inviteTarget?.slotId, slotId);
  assert.equal(inviteTarget?.principalId, principalId);
  assert.equal(inviteTarget?.expectedOccupantPrincipalId, principalId);
  return evidence;
}
