import assert from "node:assert/strict";
import test from "node:test";

import {
  discussionMutationFailure,
  draftMentionHandles,
  postingRateLimitMessage,
} from "./discussion-mutation-failure.mjs";

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

test("a posting-budget rejection names its wait and keeps the draft", async () => {
  const draft = { target: "reply", body: "unsent reply", mentionHandles: ["rowan"] };
  const failure = await discussionMutationFailure(
    response(429, { error: "RateLimited", retryable: true, message: "posting budget post_minute is exhausted" }, { "retry-after": "42" }),
    "Unable to post discussion reply",
    { draft },
  );
  assert.equal(failure.status, 429);
  assert.deepEqual(failure.data, {
    id: "discussion-mutation",
    state: "reject",
    message: "You are posting faster than the community limit allows. Try again in 42 seconds; your text is kept below.",
    rateLimited: true,
    retryAfterSeconds: 42,
    draft,
  });
});

test("other rejections keep the server message and the draft without a wait", async () => {
  const failure = await discussionMutationFailure(
    response(409, { message: "discussion changed concurrently; refresh and try again" }),
    "Unable to edit this post",
    { draft: { target: "edit", sourceSeq: "7", body: "b", mentionHandles: [] } },
  );
  assert.equal(failure.status, 409);
  assert.equal(failure.data.message, "discussion changed concurrently; refresh and try again");
  assert.equal(failure.data.rateLimited, undefined);
  assert.equal(failure.data.draft.body, "b");
  const upstream = await discussionMutationFailure(response(500, {}), "Unable to post");
  assert.equal(upstream.status, 502);
  assert.equal(upstream.data.message, "Unable to post");
  assert.equal(upstream.data.draft, undefined);
});

test("a rejection without a draft does not promise to keep text", async () => {
  const report = await discussionMutationFailure(
    response(429, { error: "RateLimited", retryable: true, message: "report budget" }, { "retry-after": "900" }),
    "Unable to submit report",
    { id: "discussion-report" },
  );
  assert.equal(report.data.id, "discussion-report");
  assert.equal(report.data.message, "You are posting faster than the community limit allows. Try again in 15 minutes.");
  assert.equal(report.data.draft, undefined);
});

test("wait labels round up to whole minutes and tolerate a missing header", () => {
  assert.match(postingRateLimitMessage(1), /in 1 second;/u);
  assert.match(postingRateLimitMessage(61), /in 2 minutes;/u);
  assert.match(postingRateLimitMessage(3600), /in 60 minutes;/u);
  assert.match(postingRateLimitMessage(null), /in a moment;/u);
});

test("draft mentions keep each handle once", () => {
  assert.deepEqual(
    draftMentionHandles([
      { handle: "rowan", offset: 0, len: 6 },
      { handle: "ash", offset: 8, len: 4 },
      { handle: "rowan", offset: 14, len: 6 },
    ]),
    ["rowan", "ash"],
  );
});
