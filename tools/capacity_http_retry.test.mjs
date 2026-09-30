import assert from "node:assert/strict";
import test from "node:test";

import { capacityHttpRetryPolicy, mapConcurrent, timedFetchWithRetryableAdmission } from "./capacity_http_retry.mjs";

const ok = () => new Response(JSON.stringify({ results: [] }), { status: 200 });
const overloaded = (retryAfter = "1", retryable = true) => new Response(
  JSON.stringify({ retryable, message: "private response must not enter diagnostics" }),
  { status: 503, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } },
);

function harness(responses) {
  let clock = 0;
  const requests = [];
  const waits = [];
  return {
    requests, waits,
    controls: {
      now: () => clock,
      pause: async (ms) => { waits.push(ms); clock += ms; },
      fetchResponse: async (_url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        requests.push(clock);
        clock += 20;
        return responses[Math.min(requests.length - 1, responses.length - 1)]();
      },
    },
  };
}

test("capacity HTTP retries honor Retry-After and retain total caller latency", async () => {
  const fixture = harness([overloaded, ok]);
  const record = await timedFetchWithRetryableAdmission("http://fixture/secret", {}, fixture.controls);
  assert.equal(record.status, 200);
  assert.deepEqual(fixture.requests, [0, 1_020]);
  assert.deepEqual(fixture.waits, [1_000]);
  assert.equal(record.elapsedMs, 1_040);
  assert.equal(record.retryable503s, 1);
  assert.equal(record.admissionAttempts.length, 2);
  assert.ok(record.elapsedMs > 750, "the existing crawler latency limit must still observe server backoff");
});

test("successful capacity HTTP requests do not wait or retry", async () => {
  const fixture = harness([ok]);
  const record = await timedFetchWithRetryableAdmission("http://fixture", {}, fixture.controls);
  assert.equal(record.elapsedMs, 20);
  assert.equal(record.retryable503s, 0);
  assert.deepEqual(fixture.waits, []);
  assert.deepEqual(record.body, { results: [] });
});

test("capacity HTTP retry limits remain six attempts with bounded private diagnostics", async () => {
  const fixture = harness([overloaded]);
  await assert.rejects(
    timedFetchWithRetryableAdmission("http://fixture/private-token", { headers: { authorization: "secret" } }, fixture.controls),
    (error) => {
      assert.equal(error.diagnostics.reason, "attempt-limit-exceeded");
      assert.equal(error.diagnostics.attempts.length, 6);
      assert.equal(error.diagnostics.retryable503s, 6);
      assert.equal(error.diagnostics.elapsedMs, 5_120);
      assert.doesNotMatch(JSON.stringify(error), /private|secret|authorization|fixture/);
      return true;
    },
  );
  assert.equal(capacityHttpRetryPolicy.maxAttempts, 6);
  assert.equal(fixture.requests.length, 6);
  assert.deepEqual(fixture.waits, [1_000, 1_000, 1_000, 1_000, 1_000]);
});

test("nonretryable and malformed capacity responses cannot trigger retries", async () => {
  for (const [response, reason] of [
    [() => overloaded("1", false), "nonretryable-503"],
    [() => new Response("not-json", { status: 503, headers: { "retry-after": "1" } }), "nonretryable-503"],
    ...["", "0", "-1", "1.5", "tomorrow", "99999999999999999999"].map((value) => [
      () => overloaded(value), "invalid-retry-after",
    ]),
    [() => new Response('{"retryable":true}', { status: 503 }), "invalid-retry-after"],
  ]) {
    const fixture = harness([response]);
    await assert.rejects(timedFetchWithRetryableAdmission("http://fixture", {}, fixture.controls),
      (error) => error.diagnostics.reason === reason);
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.waits, []);
  }
});

test("Retry-After beyond the remaining deadline fails without an early retry", async () => {
  for (const seconds of ["6", "7"]) {
    const fixture = harness([() => overloaded(seconds)]);
    await assert.rejects(timedFetchWithRetryableAdmission("http://fixture", {}, fixture.controls),
      (error) => error.diagnostics.reason === "retry-after-exceeds-deadline");
    assert.equal(fixture.requests.length, 1);
    assert.deepEqual(fixture.waits, []);
  }
});

test("an early timer wake cannot send a retry before the server delay", async () => {
  let clock = 0;
  const requests = [];
  const waits = [];
  const record = await timedFetchWithRetryableAdmission("http://fixture", {}, {
    now: () => clock,
    fetchResponse: async () => {
      requests.push(clock);
      return requests.length === 1 ? overloaded() : ok();
    },
    pause: async (ms) => { waits.push(ms); clock += waits.length === 1 ? ms - 1 : ms; },
  });
  assert.equal(record.status, 200);
  assert.deepEqual(waits, [1_000, 1]);
  assert.deepEqual(requests, [0, 1_000]);
});

test("overall deadline aborts a stalled transport and a stalled response body", async () => {
  for (const stallBody of [false, true]) {
    let requestSignal;
    await assert.rejects(timedFetchWithRetryableAdmission("http://fixture", {}, {
      timeoutMs: 20,
      fetchResponse: async (_url, { signal }) => {
        requestSignal = signal;
        if (!stallBody) return new Promise(() => {});
        return { status: 200, headers: new Headers(), json: () => new Promise(() => {}) };
      },
    }), (error) => error.diagnostics.reason === "deadline-exceeded");
    assert.equal(requestSignal.aborted, true);
  }
});

test("caller cancellation stops a pending retry wait", async () => {
  const caller = new AbortController();
  let requests = 0;
  await assert.rejects(timedFetchWithRetryableAdmission("http://fixture", { signal: caller.signal }, {
    fetchResponse: async () => { requests += 1; return overloaded(); },
    pause: async () => { caller.abort(); return new Promise(() => {}); },
  }), (error) => error.diagnostics.reason === "caller-aborted");
  assert.equal(requests, 1);
});

test("capacity HTTP callers cannot expand or overflow the bounded timeout", async () => {
  for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 6_001, 2 ** 32]) {
    await assert.rejects(timedFetchWithRetryableAdmission("http://fixture", {}, {
      timeoutMs,
      fetchResponse: async () => { assert.fail("invalid budget must not send a request"); },
    }), /timeout must be a positive integer no greater than 6000ms/);
  }
});

test("a failed capacity worker drains in-flight siblings before teardown can begin", async () => {
  const failure = new Error("admission retry exhausted");
  let releaseSibling;
  const sibling = new Promise((resolve) => { releaseSibling = resolve; });
  let settled = false;
  let siblingFinished = false;
  const operation = mapConcurrent([0, 1], 2, async (item) => {
    if (item === 0) throw failure;
    await sibling;
    siblingFinished = true;
  });
  const outcome = operation.then(() => { settled = true; }, (error) => {
    settled = true;
    assert.equal(error, failure);
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseSibling();
  await outcome;
  assert.equal(siblingFinished, true);
  assert.equal(settled, true);
});
