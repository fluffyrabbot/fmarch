const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_RETRY_AFTER_SECONDS = 86_400;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:/-]+$/;

/**
 * Fetch and validate one JSON document across the frontend/API trust boundary.
 *
 * Every branch is an immutable, explicit result. Callers must decide what an
 * unavailable or invalid upstream means for their own surface; this boundary
 * never substitutes fixtures, empty data, or stale authority.
 */
export async function fetchUpstreamJson({
  fetchImpl = fetch,
  url,
  init = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal = init.signal,
  validate = () => true,
  now = Date.now,
} = {}) {
  if (typeof fetchImpl !== "function" || !validUrl(url)) {
    return failure("unavailable", "invalid_request");
  }

  const requestSignal = composeRequestSignal({ signal, timeoutMs });
  try {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        ...(requestSignal.signal === undefined ? {} : { signal: requestSignal.signal }),
      });
    } catch {
      const reason = requestSignal.timedOut()
        ? "timeout"
        : signal?.aborted === true
          ? "aborted"
          : "network";
      return failure("unavailable", reason);
    }

    const status = validStatus(response?.status)
      ? response.status
      : response?.ok === true
        ? 200
        : 500;
    const responseMetadata = metadata(response, status, now);
    if (response?.ok !== true) {
      return statusFailure(status, responseMetadata);
    }

    if (!isJsonMediaType(response?.headers?.get?.("content-type"))) {
      return failure("invalid_response", "invalid_content_type", responseMetadata);
    }

    let value;
    try {
      value = await response.json();
    } catch {
      return requestSignal.timedOut()
        ? failure("unavailable", "timeout", responseMetadata)
        : signal?.aborted === true
          ? failure("unavailable", "aborted", responseMetadata)
        : failure("invalid_response", "invalid_json", responseMetadata);
    }

    let valid;
    try {
      valid = validate(value) === true;
    } catch {
      valid = false;
    }
    if (!valid) {
      return failure("invalid_response", "invalid_schema", responseMetadata);
    }

    return Object.freeze({
      kind: "ok",
      value,
      ...responseMetadata,
    });
  } finally {
    requestSignal.cleanup();
  }
}

function statusFailure(status, responseMetadata) {
  switch (status) {
    case 401:
      return failure("unauthorized", "http_status", responseMetadata);
    case 403:
      return failure("forbidden", "http_status", responseMetadata);
    case 404:
      return failure("not_found", "http_status", responseMetadata);
    case 429:
      return failure("rate_limited", "http_status", responseMetadata);
    case 408:
    case 425:
    case 500:
    case 502:
    case 503:
    case 504:
      return failure("unavailable", "http_status", responseMetadata);
    default:
      return status >= 500
        ? failure("unavailable", "http_status", responseMetadata)
        : failure("rejected", "http_status", responseMetadata);
  }
}

function failure(
  kind,
  reason,
  {
    status = null,
    requestId = null,
    retryAfterSeconds = null,
  } = {},
) {
  return Object.freeze({
    kind,
    reason,
    status,
    requestId,
    retryAfterSeconds,
  });
}

function metadata(response, status, now) {
  return Object.freeze({
    status,
    requestId: safeRequestId(response?.headers?.get?.("x-request-id")),
    retryAfterSeconds: retryAfter(
      response?.headers?.get?.("retry-after"),
      typeof now === "function" ? now() : Date.now(),
    ),
  });
}

function safeRequestId(value) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  return candidate.length > 0 && candidate.length <= 128 && SAFE_REQUEST_ID.test(candidate)
    ? candidate
    : null;
}

function retryAfter(value, timestamp) {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (/^\d+$/.test(candidate)) {
    return Math.min(Number(candidate), MAX_RETRY_AFTER_SECONDS);
  }
  const retryAt = Date.parse(candidate);
  if (!Number.isFinite(retryAt) || !Number.isFinite(timestamp)) return null;
  return Math.min(
    Math.max(0, Math.ceil((retryAt - timestamp) / 1_000)),
    MAX_RETRY_AFTER_SECONDS,
  );
}

function isJsonMediaType(contentType) {
  if (typeof contentType !== "string") return false;
  const mediaType = contentType.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

function validStatus(status) {
  return Number.isInteger(status) && status >= 100 && status <= 599;
}

function validUrl(url) {
  return typeof url === "string" || url instanceof URL;
}

function composeRequestSignal({ signal, timeoutMs }) {
  const timeoutController = new AbortController();
  const timeoutEnabled = Number.isFinite(timeoutMs) && timeoutMs > 0;
  const timeout = timeoutEnabled
    ? setTimeout(() => timeoutController.abort(), timeoutMs)
    : null;
  const signals = [signal, timeoutEnabled ? timeoutController.signal : undefined]
    .filter((candidate) => candidate instanceof AbortSignal);

  let composed;
  let detach = () => {};
  if (signals.length === 0) {
    composed = undefined;
  } else if (signals.length === 1) {
    composed = signals[0];
  } else if (typeof AbortSignal.any === "function") {
    composed = AbortSignal.any(signals);
  } else {
    const controller = new AbortController();
    const abort = () => controller.abort();
    for (const candidate of signals) {
      if (candidate.aborted) abort();
      candidate.addEventListener("abort", abort, { once: true });
    }
    detach = () => {
      for (const candidate of signals) {
        candidate.removeEventListener("abort", abort);
      }
    };
    composed = controller.signal;
  }

  return Object.freeze({
    signal: composed,
    timedOut: () => timeoutController.signal.aborted,
    cleanup() {
      if (timeout !== null) clearTimeout(timeout);
      detach();
    },
  });
}
