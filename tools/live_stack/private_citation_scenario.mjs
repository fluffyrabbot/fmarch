import assert from "node:assert/strict";

export function hasPrivateCitationContinuity(value) {
  return value?.status === "passed" && value.channel?.startsWith("private:")
    && Number.isSafeInteger(value.target) && value.quoters?.length === 2
    && value.quoters.every(seq => Number.isSafeInteger(seq) && seq > value.target)
    && value.offPage === true && value.navigation === true && value.reload === true
    && value.liveCount === 2 && value.reconnectCount === 2
    && value.reconnectObserved === true;
}

export async function provePrivateCitationContinuity({ page, pageUrl, game, channel, target, excerpt, sendCommand }) {
  const submit = async (body, quoted = false) => {
    const result = await sendCommand("player-mira", { SubmitPost: {
      game, channel_id: channel, actor_slot: "slot-7", body,
      ...(quoted ? { quotations: [{ target: { kind: "game_post", scope_id: game, source_seq: target }, excerpt }] } : {}),
    } });
    assert.ok(result.streamSeqs.length > 0, "post must have a durable command acknowledgement");
  };
  // The target and its quoter cannot share a 50-post addressed window.
  for (let index = 0; index < 51; index += 1) await submit(`Private citation page separation ${index}`);
  await submit("Private citation first reply", true);
  const endpoint = `/api/gameplay/games/${game}/channels/${encodeURIComponent(channel)}/citations?source_seqs=${target}&limit=5`;
  const read = async () => {
    const response = await page.request.get(new URL(endpoint, pageUrl).href);
    assert.equal(response.status(), 200);
    const value = await response.json();
    assert.equal(value.channel, channel);
    assert.equal(value.game, game);
    return value.pages[0];
  };
  const first = await read();
  assert.equal(first.citation_count, 1);
  const firstSeq = first.citations[0].quoting.source_seq;
  const addressed = `${pageUrl}?post=${target}#thread-post-${target}`;
  await page.goto(addressed, { waitUntil: "networkidle" });
  await page.getByTestId(`thread-post-${target}`).waitFor();
  await page.waitForFunction(({ target }) => window.__fmarchPlayerProjection?.thread?.posts?.find(post => post.seq === target)?.citationPage?.citation_count === 1, { target });
  assert.equal(await page.getByTestId(`thread-post-${firstSeq}`).count(), 0, "quoter must be off page");
  await page.getByTestId(`player-citations-${target}`).locator("summary").click();
  const link = page.getByTestId(`player-citation-${target}-${firstSeq}`);
  const href = await link.getAttribute("href");
  assert.equal(new URL(href, pageUrl).pathname, new URL(pageUrl).pathname);
  await link.click();
  await page.getByTestId(`thread-post-${firstSeq}`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("post"), String(firstSeq));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId(`thread-post-${firstSeq}`).waitFor();
  await page.goto(addressed, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__fmarchLiveProjectionStatus?.state === "connected");
  await submit("Private citation live reply", true);
  await page.waitForFunction(({ target }) => window.__fmarchPlayerProjection?.thread?.posts?.find(post => post.seq === target)?.citationPage?.citation_count === 2, { target });
  const second = await read();
  const secondSeq = second.citations[0].quoting.source_seq;
  await page.getByTestId(`player-citations-${target}`).locator("summary").click();
  await page.getByTestId(`player-citation-${target}-${secondSeq}`).waitFor();
  const eventStart = await page.evaluate(() => window.__fmarchLiveProjectionEvents.length);
  await page.evaluate(() => window.__fmarchReconnectPlayerLiveProjectionNow());
  await page.waitForFunction(start => window.__fmarchLiveProjectionEvents.slice(start).some(event => event.kind === "reconnect"), eventStart);
  await page.waitForFunction(({ target }) => window.__fmarchLiveProjectionStatus?.state === "connected"
    && window.__fmarchPlayerProjection?.thread?.posts?.find(post => post.seq === target)?.citationPage?.citation_count === 2, { target });
  const evidence = { status: "passed", channel, target, quoters: [firstSeq, secondSeq],
    offPage: true, navigation: true, reload: true, liveCount: 2, reconnectCount: 2, reconnectObserved: true };
  assert.ok(hasPrivateCitationContinuity(evidence));
  return evidence;
}
