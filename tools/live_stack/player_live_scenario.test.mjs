import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import {
  capturePlayerLiveBoundary,
  hasRecoveredPlayerHistory,
  recoverPlayerHistory,
  waitForPlayerDelivery,
} from "./player_live_scenario.mjs";

const game = "player-game";
const channelId = "private:mason";
const hello = {
  kind: "hello", state: "recovered",
  body: { protocol_v: 3, scope: { game, channel: channelId } },
};
const historicalPost = { seq: 17, body: "Original history" };

test("exact Hello and hydrated historical source/body prove recovery without a historical delta", async () => {
  const fixture = pageFixture();
  const recovery = await recoverPlayerHistory(fixture.page, {
    game, channelId, sourceSeq: historicalPost.seq, body: historicalPost.body,
  });
  assert.equal(hasRecoveredPlayerHistory(recovery, channelId), true);
  assert.deepEqual(recovery.post, historicalPost);
  assert.equal(recovery.eventCount, 1);
  assert.equal(hasRecoveredPlayerHistory(recovery, "dead"), false);
});

for (const invalidHello of [
  { ...hello, state: undefined },
  { ...hello, body: { ...hello.body, protocol_v: 2 } },
  { ...hello, body: { ...hello.body, scope: { game: "other", channel: channelId } } },
  { ...hello, body: { ...hello.body, scope: { game, channel: "dead" } } },
]) {
  test(`recovery rejects mismatched Hello ${JSON.stringify(invalidHello)}`, async () => {
    const fixture = pageFixture([invalidHello]);
    await assert.rejects(capturePlayerLiveBoundary(fixture.page, { game, channelId }));
  });
}

test("history recovery requires both exact original source sequence and body", async () => {
  for (const post of [
    { ...historicalPost, seq: 18 },
    { ...historicalPost, body: "different text" },
  ]) {
    const fixture = pageFixture();
    fixture.window.__fmarchPlayerProjection.thread.posts = [post];
    await assert.rejects(recoverPlayerHistory(fixture.page, {
      game, channelId, sourceSeq: historicalPost.seq, body: historicalPost.body,
    }));
  }
});

test("fresh scoped post delivery follows its command boundary and updates projection", async () => {
  const fixture = pageFixture();
  const boundary = await capturePlayerLiveBoundary(fixture.page, { game, channelId });
  fixture.window.__fmarchLiveProjectionEvents.push(threadDelta());
  fixture.window.__fmarchPlayerProjection.thread.posts.push({ seq: 18, body: "New post" });
  const delivery = await waitForPlayerDelivery(fixture.page, {
    boundary, kind: "ThreadPostsChanged", body: "New post",
  });
  assert.equal(delivery.observedAfterEventCount, 1);
  assert.equal(delivery.observedEventIndex, 1);
  assert.equal(delivery.delta.body.posts[0].channel_id, channelId);
});

test("historical deltas, repeated Hello, wrong scopes and REST-only updates cannot prove a new post", async () => {
  for (const incoming of [null, hello, threadDelta("other"), threadDelta(game, "dead")]) {
    const fixture = pageFixture([hello, threadDelta()]);
    const boundary = await capturePlayerLiveBoundary(fixture.page, { game, channelId });
    if (incoming) fixture.window.__fmarchLiveProjectionEvents.push(incoming);
    fixture.window.__fmarchPlayerProjection.thread.posts.push({ seq: 18, body: "New post" });
    await assert.rejects(waitForPlayerDelivery(fixture.page, {
      boundary, kind: "ThreadPostsChanged", body: "New post",
    }));
  }
});

test("an older matching count cannot satisfy a later withdraw, even if REST has converged", async () => {
  const fixture = pageFixture([hello, voteDelta(2), voteDelta(3)]);
  const boundary = await capturePlayerLiveBoundary(fixture.page, { game, channelId });
  fixture.window.__fmarchPlayerProjection.votecount = [{ target: "slot_1", count: 2 }];
  await assert.rejects(waitForPlayerDelivery(fixture.page, {
    boundary, kind: "VoteCountChanged", count: 2,
  }));
  fixture.window.__fmarchLiveProjectionEvents.push(voteDelta(2));
  const delivery = await waitForPlayerDelivery(fixture.page, {
    boundary, kind: "VoteCountChanged", count: 2,
  });
  assert.equal(delivery.observedEventIndex, 3);
});

test("fresh vote and post deltas still require the rendered projection to converge", async () => {
  for (const expected of [
    { kind: "VoteCountChanged", count: 3 },
    { kind: "ThreadPostsChanged", body: "New post" },
  ]) {
    const fixture = pageFixture();
    const boundary = await capturePlayerLiveBoundary(fixture.page, { game, channelId });
    fixture.window.__fmarchLiveProjectionEvents.push(
      expected.kind === "VoteCountChanged" ? voteDelta(3) : threadDelta(),
    );
    await assert.rejects(waitForPlayerDelivery(fixture.page, { boundary, ...expected }));
  }
});

function voteDelta(count) {
  return { delta: { kind: "VoteCountChanged", body: { game, candidate_slot: "slot_1", count } } };
}

function threadDelta(deltaGame = game, channel = channelId) {
  return { delta: { kind: "ThreadPostsChanged", body: {
    game: deltaGame, posts: [{ source_seq: 18, channel_id: channel, body: "New post" }],
  } } };
}

function pageFixture(events = [hello]) {
  const window = {
    __fmarchLiveProjectionEvents: structuredClone(events),
    __fmarchPlayerProjection: { thread: { posts: [historicalPost] }, votecount: [] },
  };
  const evaluate = (fn, argument) => structuredClone(
    runInNewContext(`(${fn.toString()})(argument)`, { window, argument }),
  );
  return {
    window,
    page: {
      evaluate,
      async waitForFunction(fn, argument) {
        if (!evaluate(fn, argument)) throw new Error("browser wait did not converge");
      },
    },
  };
}
