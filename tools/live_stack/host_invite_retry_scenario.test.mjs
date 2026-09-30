import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { assertHostInviteRetryRecovery, hasHostInviteRetryRecovery, proveHostInviteRetryAfterRefresh } from "./host_invite_retry_scenario.mjs";

test("invite retry proves a held real read, stable draft, restored admission and native POST", async () => {
  const fixture = browserFixture();
  const evidence = await proveHostInviteRetryAfterRefresh(fixture.options);
  assert.equal(assertHostInviteRetryRecovery(evidence), true);
  assert.equal(fixture.continued(), 1);
  assert.equal(fixture.listenerCount(), 0);
  assert.equal(fixture.routed(), false);
  assert.equal(JSON.stringify(evidence).includes(fixture.options.invitedAccountId), false);
});

test("a destroyed input fails at the held boundary and releases the read with useful private diagnostics", async () => {
  const fixture = browserFixture({ remount: true });
  await assert.rejects(proveHostInviteRetryAfterRefresh(fixture.options), (error) => {
    assert.match(error.cause.message, /DOM node must remain mounted/);
    assert.match(error.message, /"sameInput":false/);
    assert.match(error.message, /"accountLength":0/);
    assert.equal(error.message.includes(fixture.options.invitedAccountId), false);
    assert.equal(error.message.includes("secret-ticket"), false);
    return true;
  });
  assert.equal(fixture.continued(), 1);
  assert.equal(fixture.listenerCount(), 0);
  assert.equal(fixture.routed(), false);
});

test("a rejected retry reports its actual native response instead of waiting only for ACK", async () => {
  const fixture = browserFixture({ postStatus: 409 });
  await assert.rejects(proveHostInviteRetryAfterRefresh(fixture.options), (error) => {
    assert.match(error.cause.message, /native POST must succeed/);
    assert.match(error.message, /"status":409/);
    assert.match(error.message, /"statusMessage":"retry rejected"/);
    return true;
  });
  assert.equal(fixture.listenerCount(), 0);
});

test("a click without submission records missing native POST and current validation state", async () => {
  const fixture = browserFixture({ noPost: true });
  await assert.rejects(proveHostInviteRetryAfterRefresh(fixture.options), (error) => {
    assert.equal(error.cause.message, "retry emitted no completed native POST");
    assert.match(error.message, /"valueMissing":true/);
    assert.match(error.message, /"accountLength":0/);
    return true;
  });
  assert.equal(fixture.listenerCount(), 0);
});

test("readiness rejects fabricated partial evidence for identity, admission, target and delivery", async () => {
  const fixture = browserFixture();
  const valid = await proveHostInviteRetryAfterRefresh(fixture.options);
  assert.equal(hasHostInviteRetryRecovery(undefined), false);
  for (const mutate of [
    (e) => { e.before.sameInput = false; },
    (e) => { e.blocked.accountMatches = false; },
    (e) => { e.blocked.submitDisabled = false; },
    (e) => { e.blocked.accountDisabled = false; },
    (e) => { e.after.accountDisabled = true; },
    (e) => { e.after.target.principalId = "another-player"; },
    (e) => { e.after.accountLength++; },
    (e) => { e.refresh.pathname = "/different-game"; },
    (e) => { e.refresh.status = 503; },
    (e) => { e.reconnect.recovered = false; },
    (e) => { e.reconnect.socketObserved = false; },
    (e) => { e.submission.bodyMatches = false; },
    (e) => { e.submission.method = "GET"; },
    (e) => { e.submission.status = 409; },
    (e) => { e.outcome.state = "reject"; },
    (e) => { e.outcome.urlRendered = false; },
  ]) {
    const evidence = structuredClone(valid);
    mutate(evidence);
    assert.equal(hasHostInviteRetryRecovery(evidence), false);
  }
});

function browserFixture({ remount = false, postStatus = 200, noPost = false } = {}) {
  const game = "game-1";
  const expectedTarget = { principalId: "rowan", slotId: "slot-7", expectedOccupantPrincipalId: "rowan" };
  const invitedAccountId = "private-account@example.test";
  const listeners = new Map();
  let handler;
  let continuations = 0;
  let paused = false;
  let state = "reject";
  let text = "Invite target is stale";
  const input = () => ({ value: "", disabled: false, isConnected: true, get validity() { return { valueMissing: this.value === "" }; } });
  let account = input();
  const button = { disabled: false };
  const form = { elements: { namedItem(key) { return { value: expectedTarget[key] }; } } };
  const status = { getAttribute() { return state; }, get textContent() { return text; } };
  const document = { querySelector(selector) {
    if (selector.includes("retry-account")) return account;
    if (selector.includes("retry-submit")) return button;
    if (selector.includes('"host-player-invite-retry"')) return form;
    if (selector.includes("command-health")) return paused ? {} : null;
    if (selector.includes("invite-status")) return status;
    return null;
  } };
  const window = {
    __fmarchHostLiveProjectionEvents: [{ kind: "hello", state: "recovered" }],
    __fmarchHostLiveProjectionStatus: { state: "recovered" },
    async __fmarchReconnectHostLiveProjectionNow() {
      paused = true;
      if (remount) { account.isConnected = false; account = input(); }
      account.disabled = button.disabled = true;
      window.__fmarchHostLiveProjectionStatus.state = "reconnecting";
      listeners.get("websocket")?.({ url: () => "wss://fixture.invalid/ws?ticket=secret-ticket" });
      const request = requestFor(`/api/gameplay/games/${game}/host-console-state?ticket=secret-ticket`, "GET");
      listeners.get("request")?.(request);
      let release;
      const released = new Promise((resolve) => { release = resolve; });
      await handler({ request: () => request, async continue() {
        continuations++;
        listeners.get("response")?.({ request: () => request, status: () => 200 });
        paused = false;
        account.disabled = button.disabled = false;
        window.__fmarchHostLiveProjectionStatus.state = "recovered";
        release();
      } });
      await released;
      return { host: {} };
    },
  };
  const invoke = (fn, argument) => runInNewContext(`(${fn.toString()})(argument)`, {
    window, document, location: { pathname: `/g/${game}/host` },
    argument: argument?.originalInput ? { ...argument, originalInput: argument.originalInput.element } : argument,
  });
  const page = {
    on(kind, listener) { listeners.set(kind, listener); },
    off(kind) { listeners.delete(kind); },
    async route(_matches, listener) { handler = listener; },
    async unroute() { handler = undefined; },
    async evaluate(fn, argument) { return structuredClone(await invoke(fn, argument)); },
    async waitForFunction(fn, argument) { assert.ok(await invoke(fn, argument), "browser condition not satisfied"); },
    locator(selector) { return {
      async fill(value) { account.value = value; },
      async elementHandle() { return { element: account, async dispose() {} }; },
      async click() {
        assert.ok(selector.includes("retry-submit"));
        assert.equal(button.disabled, false);
        if (noPost) { account.value = ""; return; }
        const request = requestFor(`/g/${game}/host?/issuePlayerInvite`, "POST", new URLSearchParams({ accountId: account.value, ...expectedTarget }).toString());
        listeners.get("request")?.(request);
        state = postStatus === 200 ? "ack" : "reject";
        text = postStatus === 200 ? "Player invite issued" : "retry rejected";
        listeners.get("response")?.({ request: () => request, status: () => postStatus });
      },
    }; },
    getByTestId() { return { async count() { return state === "ack" ? 1 : 0; } }; },
  };
  return {
    options: { page, game, invitedAccountId, expectedTarget, timeoutMs: 50 },
    continued: () => continuations, listenerCount: () => listeners.size, routed: () => handler !== undefined,
  };
}

function requestFor(path, method, body = null) {
  return { url: () => `https://fixture.invalid${path}`, method: () => method, postData: () => body };
}
