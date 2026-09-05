import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchUpstreamJson } from "./upstream-client.mjs";

test("validated JSON returns an immutable success without exposing response internals", async () => {
  const result = await fetchUpstreamJson({
    url: "https://api.example.test/state",
    fetchImpl: async () => jsonResponse({ version: 3 }, {
      headers: {
        "x-request-id": "req_01HZX-7",
      },
    }),
    validate: (value) => Number.isInteger(value?.version),
  });

  assert.deepEqual(result, {
    kind: "ok",
    value: { version: 3 },
    status: 200,
    requestId: "req_01HZX-7",
    retryAfterSeconds: null,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("the boundary rejects missing media type, malformed JSON, and invalid schema distinctly", async () => {
  const missingType = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      async json() { return {}; },
    }),
  });
  assert.equal(missingType.kind, "invalid_response");
  assert.equal(missingType.reason, "invalid_content_type");

  const malformed = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/problem+json" }),
      async json() { throw new SyntaxError("bad json"); },
    }),
  });
  assert.equal(malformed.kind, "invalid_response");
  assert.equal(malformed.reason, "invalid_json");

  const invalid = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => jsonResponse({ version: "three" }),
    validate: (value) => Number.isInteger(value?.version),
  });
  assert.equal(invalid.kind, "invalid_response");
  assert.equal(invalid.reason, "invalid_schema");
});

test("HTTP failures have actionable kinds and bounded safe metadata", async () => {
  const limited = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => jsonResponse({}, {
      status: 429,
      headers: {
        "retry-after": "9999999999",
        "x-request-id": "request:rate-limit/1",
      },
    }),
  });
  assert.deepEqual(limited, {
    kind: "rate_limited",
    reason: "http_status",
    status: 429,
    requestId: "request:rate-limit/1",
    retryAfterSeconds: 86_400,
  });

  const forbidden = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => jsonResponse({}, {
      status: 403,
      headers: { "x-request-id": "unsafe id with spaces" },
    }),
  });
  assert.equal(forbidden.kind, "forbidden");
  assert.equal(forbidden.requestId, null);

  const down = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => jsonResponse({}, { status: 503 }),
  });
  assert.equal(down.kind, "unavailable");
  assert.equal(down.reason, "http_status");
});

test("Retry-After HTTP dates are normalized relative to the injected clock", async () => {
  const now = Date.parse("2026-08-30T12:00:00Z");
  const result = await fetchUpstreamJson({
    url: "/state",
    now: () => now,
    fetchImpl: async () => jsonResponse({}, {
      status: 503,
      headers: { "retry-after": "Sun, 30 Aug 2026 12:00:09 GMT" },
    }),
  });
  assert.equal(result.retryAfterSeconds, 9);
});

test("network, caller abort, and deadline expiry remain distinguishable", async () => {
  const network = await fetchUpstreamJson({
    url: "/state",
    fetchImpl: async () => { throw new Error("ECONNRESET secret details"); },
  });
  assert.deepEqual(network, {
    kind: "unavailable",
    reason: "network",
    status: null,
    requestId: null,
    retryAfterSeconds: null,
  });

  const caller = new AbortController();
  caller.abort();
  const aborted = await fetchUpstreamJson({
    url: "/state",
    signal: caller.signal,
    fetchImpl: abortingFetch,
  });
  assert.equal(aborted.reason, "aborted");

  const timedOut = await fetchUpstreamJson({
    url: "/state",
    timeoutMs: 5,
    fetchImpl: abortingFetch,
  });
  assert.equal(timedOut.kind, "unavailable");
  assert.equal(timedOut.reason, "timeout");
});

test("a caller abort signal and the deadline signal are composed", async () => {
  const caller = new AbortController();
  let observed;
  const resultPromise = fetchUpstreamJson({
    url: "/state",
    signal: caller.signal,
    timeoutMs: 1_000,
    fetchImpl: async (_url, init) => {
      observed = init.signal;
      return await abortingFetch(_url, init);
    },
  });
  caller.abort();
  const result = await resultPromise;

  assert.ok(observed instanceof AbortSignal);
  assert.notEqual(observed, caller.signal);
  assert.equal(result.reason, "aborted");
});

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  const responseHeaders = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: responseHeaders,
    async json() {
      return body;
    },
  };
}

async function abortingFetch(_url, { signal } = {}) {
  return await new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
