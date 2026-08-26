import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runPublicSearchStagingCanary } from "./public_search_staging_canary.mjs";

async function stagingSlo() {
  return JSON.parse(
    await readFile(
      new URL("../docs/ops/public-search-staging-slo.json", import.meta.url),
      "utf8",
    ),
  );
}

test("canary executes every bounded case without retaining queries or bodies", async () => {
  const slo = await stagingSlo();
  const requests = [];
  const receipt = await runPublicSearchStagingCanary({
    slo,
    now: new Date("2026-08-26T04:00:00.000Z"),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(
        JSON.stringify({
          query: url.searchParams.get("q"),
          filter: url.searchParams.get("filter"),
          results: [
            {
              kind: "game",
              href: slo.canary.source_corpus.expected_result_href,
            },
          ],
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(receipt.status, "passed");
  assert.equal(requests.length, 20);
  assert.equal(receipt.traffic.requestCount, 20);
  assert.equal(receipt.aggregate.successfulCount, 20);
  assert.equal(receipt.aggregate.sourceCorpus.matchCount, 5);
  assert.deepEqual(receipt.aggregate.byFilter, {
    all: 5,
    discussions: 5,
    profiles: 5,
    games: 5,
  });
  assert.equal(receipt.aggregate.byCase.length, 4);
  for (const request of requests) {
    assert.equal(request.url.origin, "https://fmarch-staging.up.railway.app");
    assert.equal(request.url.pathname, "/search");
    assert.equal(
      request.options.headers["x-fmarch-search-observation"],
      "staging-canary-v1",
    );
  }
  const serialized = JSON.stringify(receipt);
  for (const canaryCase of slo.canary.cases) {
    assert.equal(
      serialized.includes(JSON.stringify(canaryCase.synthetic_query)),
      false,
    );
  }
  assert.equal(serialized.includes("next_cursor"), false);
  assert.equal(serialized.includes('"kind":"game"'), false);
  assert.equal(
    serialized.includes(slo.canary.source_corpus.expected_result_href),
    false,
  );
});

test("canary fails closed on non-200 or malformed responses", async () => {
  const slo = await stagingSlo();
  let requestIndex = 0;
  const receipt = await runPublicSearchStagingCanary({
    slo,
    fetchImpl: async (url) => {
      requestIndex += 1;
      if (requestIndex === 1) {
        return new Response('{"error":"unavailable"}', {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          query: url.searchParams.get("q"),
          filter: url.searchParams.get("filter"),
          results: [],
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  assert.equal(receipt.status, "failed");
  assert.equal(receipt.aggregate.failedCount, 1);
  assert.equal(receipt.aggregate.statusCounts[503], 1);
});

test("empty-only canary traffic is insufficient rather than representative", async () => {
  const slo = await stagingSlo();
  const receipt = await runPublicSearchStagingCanary({
    slo,
    fetchImpl: async (url) =>
      new Response(
        JSON.stringify({
          query: url.searchParams.get("q"),
          filter: url.searchParams.get("filter"),
          results: [],
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assert.equal(receipt.status, "insufficient");
  assert.equal(receipt.aggregate.successfulCount, 20);
  assert.equal(receipt.aggregate.nonEmptyResponseCount, 0);
});

test("unrelated non-empty results cannot stand in for the declared corpus", async () => {
  const slo = await stagingSlo();
  const receipt = await runPublicSearchStagingCanary({
    slo,
    fetchImpl: async (url) =>
      new Response(
        JSON.stringify({
          query: url.searchParams.get("q"),
          filter: url.searchParams.get("filter"),
          results: [{ kind: "game", href: "/games/unrelated" }],
          next_cursor: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });

  assert.equal(receipt.status, "insufficient");
  assert.equal(receipt.aggregate.nonEmptyResponseCount, 20);
  assert.equal(receipt.aggregate.sourceCorpus.matchCount, 0);
});
