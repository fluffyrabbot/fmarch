import assert from "node:assert/strict";

export function hasPrivateCitationContinuity(value) {
  return value?.status === "passed" && value.channel?.startsWith("private:")
    && Number.isSafeInteger(value.target) && value.quoters?.length === 2
    && value.quoters.every(seq => Number.isSafeInteger(seq) && seq > value.target)
    && value.offPage === true && value.navigation === true && value.reload === true
    && value.originalNavigation === true && value.originalBack === true && value.originalReconnect === true
    && value.liveCount === 2 && value.reconnectCount === 2
    && value.reconnectObserved === true;
}

export async function provePrivateCitationContinuity(options) {
  const evidence = await proveCitationContinuity(options);
  assert.ok(hasPrivateCitationContinuity(evidence));
  const response = await options.page.request.get(new URL(`/api/gameplay/games/${options.game}/citations?source_seqs=${options.target}`, options.pageUrl).href);
  assert.equal(response.status(), 200);
  assert.deepEqual(await response.json(), { pages: [] }, "private target cannot enter public citations");
  return evidence;
}

export function hasMainCitationContinuity(value) {
  return value?.status === "passed" && value.channel === "main"
    && Number.isSafeInteger(value.target) && value.quoters?.length === 2
    && value.quoters.every(seq => Number.isSafeInteger(seq) && seq > value.target)
    && value.offPage === true && value.navigation === true && value.reload === true
    && value.originalNavigation === true && value.originalBack === true && value.originalReconnect === true
    && value.liveCount === 2 && value.reconnectCount === 2 && value.reconnectObserved === true
    && value.hiddenQuotersCleared === true && value.hiddenTargetOmitted === true
    && value.hiddenOriginalRejected === true;
}

export async function proveMainCitationContinuity({ page, pageUrl, game, sendCommand, setVisible }) {
  const excerpt = "Main citation continuity target";
  await sendCommand("player-mira", { SubmitPost: { game, channel_id: "main", actor_slot: "slot-7", body: excerpt } });
  const threadResponse = await page.request.get(new URL(`/api/gameplay/games/${game}?limit=50`, pageUrl).href);
  assert.equal(threadResponse.status(), 200);
  const target = (await threadResponse.json()).posts.find(post => post.body === excerpt)?.source_seq;
  assert.ok(Number.isSafeInteger(target));
  const evidence = await proveCitationContinuity({ page, pageUrl, game, channel: "main", target, excerpt, sendCommand });
  const read = async () => {
    const response = await page.request.get(new URL(`/api/gameplay/games/${game}/citations?source_seqs=${target}&limit=5`, pageUrl).href);
    assert.equal(response.status(), 200);
    return response.json();
  };
  try {
    // Fixture-only visibility changes keep the thread moderation and citation
    // publication projections consistent, as the moderation projector does.
    for (const seq of evidence.quoters) await setVisible(seq, false);
    assert.deepEqual((await read()).pages[0].citations, []);
    await page.evaluate(() => window.__fmarchReconnectPlayerLiveProjectionNow());
    await page.waitForFunction(({ target }) => window.__fmarchLiveProjectionStatus?.state === "connected"
      && window.__fmarchPlayerProjection?.thread?.posts?.find(post => post.seq === target)?.citationPage?.citation_count === 0, { target });
    assert.equal(await page.getByTestId(`player-citations-${target}`).count(), 0);
    for (const seq of evidence.quoters) await setVisible(seq, true);
    await setVisible(target, false);
    assert.deepEqual(await read(), { pages: [] });
    const hiddenOriginal = await page.request.get(new URL(`/api/gameplay/games/${game}?limit=50&around_seq=${target}`, pageUrl).href);
    assert.equal(hiddenOriginal.status(), 404, "the fixture must hide the addressed original, not only its citation publication");
    await page.goto(`${pageUrl}?post=${evidence.quoters[0]}#thread-post-${evidence.quoters[0]}`, { waitUntil: "networkidle" });
    const quotation = page.getByTestId(`player-quote-block-${evidence.quoters[0]}-${target}`);
    await quotation.waitFor();
    assert.match(await quotation.innerText(), /Original post/);
    await quotation.locator("a").click();
    await page.getByTestId("route-error-panel").waitFor();
    assert.match(await page.getByTestId("route-error-panel").innerText(), /Game state was not found/);
    assert.equal(await page.getByTestId(`thread-post-${target}`).count(), 0);
  } finally {
    for (const seq of [target, ...evidence.quoters]) await setVisible(seq, true);
  }
  const result = { ...evidence, hiddenQuotersCleared: true, hiddenTargetOmitted: true, hiddenOriginalRejected: true };
  assert.ok(hasMainCitationContinuity(result));
  return result;
}

async function proveCitationContinuity({ page, pageUrl, game, channel, target, excerpt, sendCommand }) {
  const submit = async (body, quoted = false) => {
    const result = await sendCommand("player-mira", { SubmitPost: {
      game, channel_id: channel, actor_slot: "slot-7", body,
      ...(quoted ? { quotations: [{ target: { kind: "game_post", scope_id: game, source_seq: target }, excerpt }] } : {}),
    } });
    assert.ok(result.streamSeqs.length > 0, "post must have a durable command acknowledgement");
  };
  // The target and its quoter cannot share a 50-post addressed window.
  for (let index = 0; index < 51; index += 1) await submit(`Reader citation page separation ${index}`);
  await submit("Reader citation first reply", true);
  const endpoint = `/api/gameplay/games/${game}/${channel === "main" ? "" : `channels/${encodeURIComponent(channel)}/`}citations?source_seqs=${target}&limit=5`;
  const read = async () => {
    const response = await page.request.get(new URL(endpoint, pageUrl).href);
    assert.equal(response.status(), 200);
    const value = await response.json();
    if (channel !== "main") {
      assert.equal(value.channel, channel); assert.equal(value.game, game);
      return value.pages[0];
    }
    const row = value.pages[0];
    assert.equal(row.quoted_surface_id, game);
    return { citation_count: row.citation_count, citations: row.citations.map(citation => ({
      quoting: { source_seq: citation.quoting_source_seq },
    })) };
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
  const quotation = page.getByTestId(`player-quote-block-${firstSeq}-${target}`);
  assert.equal(await page.getByTestId(`thread-post-${target}`).count(), 0);
  assert.match(await quotation.innerText(), /Original post/);
  assert.doesNotMatch(await quotation.innerText(), /Original unavailable/);
  await quotation.locator("a").click();
  await page.getByTestId(`thread-post-${target}`).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("post"), String(target));
  await page.goBack({ waitUntil: "networkidle" });
  await quotation.waitFor();
  assert.doesNotMatch(await quotation.innerText(), /Original unavailable/);
  await page.waitForFunction(() => window.__fmarchLiveProjectionStatus?.state === "connected");
  const originalEventStart = await page.evaluate(() => window.__fmarchLiveProjectionEvents.length);
  await page.evaluate(() => window.__fmarchReconnectPlayerLiveProjectionNow());
  await page.waitForFunction(start => window.__fmarchLiveProjectionEvents.slice(start).some(event => event.kind === "reconnect")
    && window.__fmarchLiveProjectionStatus?.state === "connected", originalEventStart);
  assert.doesNotMatch(await quotation.innerText(), /Original unavailable/);
  await page.goto(addressed, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__fmarchLiveProjectionStatus?.state === "connected");
  await submit("Reader citation live reply", true);
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
    offPage: true, navigation: true, reload: true, originalNavigation: true, originalBack: true, originalReconnect: true, liveCount: 2, reconnectCount: 2, reconnectObserved: true };
  return evidence;
}
