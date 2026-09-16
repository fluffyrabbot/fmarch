// Hello recovers a scoped REST snapshot. Only commands issued after the
// captured boundary can establish fresh live delivery for that connection.
export async function capturePlayerLiveBoundary(page, { game, channelId }) {
  const scope = { game, channelId };
  await page.waitForFunction(playerRecoveryObservation, scope);
  return await page.evaluate(playerRecoveryObservation, scope);
}

function playerRecoveryObservation({ game, channelId }) {
  const events = window.__fmarchLiveProjectionEvents ?? [];
  const hello = events.findLast((event) =>
    event?.kind === "hello" &&
    event.state === "recovered" &&
    event.body?.protocol_v === 3 &&
    event.body.scope?.game === game &&
    event.body.scope?.channel === channelId,
  );
  return hello ? { game, channelId, hello, eventCount: events.length } : null;
}

export async function recoverPlayerHistory(page, { game, channelId, sourceSeq, body }) {
  const boundary = await capturePlayerLiveBoundary(page, { game, channelId });
  const expected = { sourceSeq, body };
  await page.waitForFunction(recoveredPost, expected);
  const post = await page.evaluate(recoveredPost, expected);
  return { status: "passed", ...boundary, post };
}

function recoveredPost({ sourceSeq, body }) {
  return window.__fmarchPlayerProjection?.thread?.posts?.find(
    (post) => post.seq === sourceSeq && post.body === body,
  ) ?? null;
}

export function hasRecoveredPlayerHistory(recovery, channelId) {
  return recovery?.status === "passed" &&
    typeof recovery.game === "string" && recovery.game.length > 0 &&
    recovery.channelId === channelId &&
    recovery.hello?.kind === "hello" &&
    recovery.hello.state === "recovered" &&
    recovery.hello.body?.protocol_v === 3 &&
    recovery.hello.body.scope?.game === recovery.game &&
    recovery.hello.body.scope?.channel === channelId &&
    Number.isSafeInteger(recovery.eventCount) && recovery.eventCount > 0 &&
    Number.isSafeInteger(recovery.post?.seq) && recovery.post.seq > 0 &&
    typeof recovery.post?.body === "string" && recovery.post.body.length > 0;
}

export async function waitForPlayerDelivery(page, { boundary, kind, count, body }) {
  if (!["VoteCountChanged", "ThreadPostsChanged"].includes(kind)) {
    throw new Error(`unsupported player delivery kind: ${kind}`);
  }
  if (!Number.isSafeInteger(boundary?.eventCount) || boundary.eventCount < 1) {
    throw new Error("player delivery requires a captured recovered-Hello boundary");
  }
  const expected = { boundary, kind, count, body };
  await page.waitForFunction(playerDeliveryObservation, expected, { timeout: 60_000 });
  return await page.evaluate(playerDeliveryObservation, expected);
}

function playerDeliveryObservation({ boundary, kind, count, body }) {
  const events = window.__fmarchLiveProjectionEvents ?? [];
  const eventIndex = events.findIndex((event, index) =>
    index >= boundary.eventCount &&
    event?.delta?.kind === kind &&
    event.delta.body?.game === boundary.game &&
    (kind === "VoteCountChanged"
      ? event.delta.body?.candidate_slot === "slot_1" && event.delta.body?.count === count
      : event.delta.body?.posts?.some((post) =>
          post.channel_id === boundary.channelId && post.body === body,
        )),
  );
  const projection = window.__fmarchPlayerProjection;
  const projected = kind === "VoteCountChanged"
    ? projection?.votecount?.some((row) => row.target === "slot_1" && row.count === count)
    : projection?.thread?.posts?.some((post) => post.body === body);
  if (eventIndex < 0 || !projected) return null;
  return {
    ...events[eventIndex],
    boundary,
    observedAfterEventCount: boundary.eventCount,
    observedEventIndex: eventIndex,
  };
}
