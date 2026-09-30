import { setTimeout as delay } from "node:timers/promises";

export const capacityHttpRetryPolicy = Object.freeze({ maxAttempts: 6, timeoutMs: 6_000 });

// The capacity proof measures complete caller latency, including the server's
// admission wait. A retry must not improve the reported latency by hiding it.
export async function timedFetchWithRetryableAdmission(url, options = {}, {
  fetchResponse = fetch,
  pause = delay,
  now = () => performance.now(),
  timeoutMs = capacityHttpRetryPolicy.timeoutMs,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > capacityHttpRetryPolicy.timeoutMs) {
    throw new Error("capacity HTTP retry timeout must be a positive integer no greater than 6000ms");
  }
  const started = now();
  const deadline = started + timeoutMs;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const attempts = [];
  let retryable503s = 0;
  const elapsedMs = () => Math.max(0, now() - started);
  const failure = (reason) => {
    const error = new Error(`capacity HTTP request failed: ${reason} after ${attempts.length} attempt(s)`);
    // Do not retain the URL, headers, response body, or transport error text.
    error.diagnostics = { reason, elapsedMs: elapsedMs(), retryable503s, attempts };
    return error;
  };
  const assertActive = () => {
    if (options.signal?.aborted) throw failure("caller-aborted");
    if (controller.signal.aborted || now() >= deadline) throw failure("deadline-exceeded");
  };
  try {
    for (let attempt = 1; attempt <= capacityHttpRetryPolicy.maxAttempts; attempt += 1) {
      assertActive();
      const observation = { attempt, status: null, retryable: false, retryAfterMs: null };
      attempts.push(observation);
      let record;
      try {
        record = await abortable((async () => {
          const response = await fetchResponse(url, { ...options, signal });
          let body = null;
          try {
            body = await response.json();
          } catch {
            if (signal.aborted) throw new Error("response aborted");
          }
          return { status: response.status, headers: Object.fromEntries(response.headers), body };
        })(), signal);
      } catch {
        assertActive();
        throw failure("transport-failed");
      }
      observation.status = record.status;
      observation.elapsedMs = elapsedMs();
      assertActive();
      if (record.status !== 503) {
        return { ...record, elapsedMs: elapsedMs(), retryable503s, admissionAttempts: attempts };
      }
      if (record.body?.retryable !== true) throw failure("nonretryable-503");
      observation.retryable = true;
      retryable503s += 1;
      // Fmarch's overload contract emits positive whole seconds, not an HTTP date.
      const retryAfter = record.headers["retry-after"];
      const retryAfterMs = typeof retryAfter === "string" && /^[1-9][0-9]*$/.test(retryAfter)
        ? Number(retryAfter) * 1_000
        : NaN;
      if (!Number.isSafeInteger(retryAfterMs)) throw failure("invalid-retry-after");
      observation.retryAfterMs = retryAfterMs;
      if (attempt === capacityHttpRetryPolicy.maxAttempts) throw failure("attempt-limit-exceeded");
      const notBefore = now() + retryAfterMs;
      if (notBefore >= deadline) throw failure("retry-after-exceeds-deadline");
      try {
        // Account for timer rounding without ever sending before Retry-After.
        while (now() < notBefore) {
          assertActive();
          await abortable(pause(Math.ceil(notBefore - now()), undefined, { signal }), signal);
        }
      } catch (error) {
        assertActive();
        if (error?.diagnostics) throw error;
        throw failure("retry-wait-failed");
      }
    }
    throw failure("attempt-limit-exceeded");
  } finally {
    clearTimeout(timer);
  }
}

function abortable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("capacity HTTP request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

export async function mapConcurrent(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index], index);
      }
    }),
  );
  // A failed retry must not leave sibling requests running during server and
  // database teardown. Preserve the first failure after every worker settles.
  const failed = workers.find((worker) => worker.status === "rejected");
  if (failed) throw failed.reason;
  return results;
}
