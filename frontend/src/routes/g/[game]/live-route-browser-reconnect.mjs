const DEFAULT_RECONNECT_PROOF_TIMEOUT_MS = 30_000;

export function createLiveRouteBrowserReconnect({
  connection,
  role,
  timeoutMs = DEFAULT_RECONNECT_PROOF_TIMEOUT_MS,
  setTimeoutImpl = globalThis.setTimeout,
  clearTimeoutImpl = globalThis.clearTimeout,
}) {
  if (typeof connection?.reconnectNow !== "function") {
    throw new TypeError(`${role} live connection does not support reconnectNow`);
  }

  let pending = null;

  function reconnectNow() {
    if (pending !== null) {
      return pending.promise;
    }
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timeoutHandle = setTimeoutImpl(() => {
      const request = pending;
      pending = null;
      request?.reject(
        new Error(`${role} live projection reconnect did not recover in time`),
      );
    }, timeoutMs);
    timeoutHandle?.unref?.();
    pending = Object.freeze({
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      timeoutHandle,
    });
    if (connection.reconnectNow({ reason: "browser_proof" }) !== true) {
      rejectPending(new Error(`${role} live projection reconnect was refused`));
    }
    return promise;
  }

  function observe(message, snapshot) {
    if (
      pending === null ||
      message?.kind !== "reconnect" ||
      message.state !== "recovered"
    ) {
      return false;
    }
    const request = pending;
    pending = null;
    clearTimeoutImpl(request.timeoutHandle);
    request.resolve(snapshot);
    return true;
  }

  function rejectPending(error = new Error(`${role} live projection disposed`)) {
    if (pending === null) {
      return false;
    }
    const request = pending;
    pending = null;
    clearTimeoutImpl(request.timeoutHandle);
    request.reject(error);
    return true;
  }

  return Object.freeze({ reconnectNow, observe, rejectPending });
}
