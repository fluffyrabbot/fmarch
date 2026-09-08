import assert from "node:assert/strict";
import test from "node:test";
import { actions, load } from "./+page.server.js";

test("delivery page loads the authenticated redacted operator queue", async () => {
  let requested = null;
  const data = await load({
    cookies: { get: () => "operator-session" },
    locals: {
      principalId: "mod_m",
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    url: new URL("http://localhost/admin/deliveries"),
    fetch: async (url, init) => {
      requested = { url, init };
      return response({
        delivery_configured: true,
        delivery_bound: true,
        delivery_operable: false,
        configured_generation: "staging-mail-v4",
        active_generation: "staging-mail-v4",
        suspension_code: "provider_unavailable",
        probe_in_flight: true,
        circuit_version: 7,
        deliveries: [{ delivery_id: "delivery-1" }],
      });
    },
  });
  assert.match(requested.url, /\/admin\/auth-deliveries\?limit=200$/u);
  assert.equal(requested.init.headers.authorization, "Bearer operator-session");
  assert.equal(data.deliveries[0].delivery_id, "delivery-1");
  assert.equal(data.deliveryConfigured, true);
  assert.equal(data.deliveryBound, true);
  assert.equal(data.deliveryOperable, false);
  assert.equal(data.configuredGeneration, "staging-mail-v4");
  assert.equal(data.activeGeneration, "staging-mail-v4");
  assert.equal(data.suspensionCode, "provider_unavailable");
  assert.equal(data.probeInFlight, true);
  assert.equal(data.circuitVersion, 7);
  assert.equal(data.canRetry, false);
  assert.equal(data.canProbe, false);
});

test("delivery operations remain available when classic sign-in is disabled", async () => {
  const priorClassicAuth = process.env.FMARCH_CLASSIC_AUTH;
  process.env.FMARCH_CLASSIC_AUTH = "0";
  try {
    const data = await load({
      cookies: { get: () => "operator-session" },
      locals: {
        principalId: "admin_a",
        resolvedCapabilities: [{ kind: "GlobalAdmin" }],
      },
      url: new URL("http://localhost/admin/deliveries"),
      fetch: async () =>
        response({
          delivery_configured: true,
          delivery_bound: true,
          delivery_operable: true,
          configured_generation: "staging-mail-v4",
          active_generation: "staging-mail-v4",
          suspension_code: null,
          probe_in_flight: false,
          circuit_version: 2,
          deliveries: [],
        }),
    });
    assert.deepEqual(data.deliveries, []);
    assert.equal(data.deliveryConfigured, true);
    assert.equal(data.deliveryBound, true);
    assert.equal(data.deliveryOperable, true);
    assert.equal(data.canRetry, true);
    assert.equal(data.canProbe, true);

    let retried = false;
    const result = await actions.retry({
      cookies: { get: () => "operator-session" },
      locals: { resolvedCapabilities: [{ kind: "GlobalAdmin" }] },
      request: formRequest("11111111-1111-4111-8111-111111111111", 0),
      fetch: async () => {
        retried = true;
        return response({ status: "retryable_failed", attempt_count: 1 });
      },
    });
    assert.equal(retried, true);
    assert.equal(result.state, "pending");
  } finally {
    if (priorClassicAuth === undefined) delete process.env.FMARCH_CLASSIC_AUTH;
    else process.env.FMARCH_CLASSIC_AUTH = priorClassicAuth;
  }
});

test("provider recovery probe is a credential-free GlobalAdmin operation", async () => {
  let requested = null;
  const result = await actions.probe({
    cookies: { get: () => "admin-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalAdmin" }] },
    fetch: async (url, init) => {
      requested = { url, init };
      return response({
        status: "available",
        provider_generation: "staging-mail-v4",
        provider_operable: true,
        circuit_version: 9,
      });
    },
  });
  assert.match(requested.url, /\/admin\/auth-delivery-provider\/probe$/u);
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers.authorization, "Bearer admin-session");
  assert.equal(initHasBody(requested.init), false);
  assert.equal(result.state, "ack");
  assert.match(result.message, /circuit version 9/u);
});

test("provider recovery probe rejects GlobalMod before calling the API", async () => {
  let called = false;
  const result = await actions.probe({
    cookies: { get: () => "mod-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalMod" }] },
    fetch: async () => {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.status, 403);
});

test("delivery retry delegates only a validated id from a GlobalAdmin session", async () => {
  const deliveryId = "11111111-1111-4111-8111-111111111111";
  let requested = null;
  const result = await actions.retry({
    cookies: { get: () => "admin-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalAdmin" }] },
    request: formRequest(deliveryId, 1),
    fetch: async (url, init) => {
      requested = { url, init };
      return response({ status: "delivered", attempt_count: 2 });
    },
  });
  assert.match(requested.url, new RegExp(`/auth/delivery-intents/${deliveryId}/retry$`, "u"));
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requested.init.body), { expected_attempt_count: 1 });
  assert.equal(result.state, "ack");
  assert.match(result.message, /attempt 2/u);
});

test("delivery retry rejects GlobalMod before calling the API", async () => {
  let called = false;
  const result = await actions.retry({
    cookies: { get: () => "mod-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalMod" }] },
    request: formRequest("11111111-1111-4111-8111-111111111111", 1),
    fetch: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.status, 403);
  assert.equal(result.data.state, "reject");
});

test("delivery retry rejects a missing or malformed expected attempt count before calling the API", async () => {
  const deliveryId = "11111111-1111-4111-8111-111111111111";
  for (const expectedAttemptCount of [undefined, "", "-1", "1.5", "01", "2147483648"]) {
    let called = false;
    const result = await actions.retry({
      cookies: { get: () => "admin-session" },
      locals: { resolvedCapabilities: [{ kind: "GlobalAdmin" }] },
      request: formRequest(deliveryId, expectedAttemptCount),
      fetch: async () => { called = true; },
    });
    assert.equal(called, false, `API called for ${String(expectedAttemptCount)}`);
    assert.equal(result.status, 400);
    assert.equal(result.data.deliveryId, deliveryId);
    assert.match(result.data.message, /expected attempt count/u);
  }
});

function formRequest(deliveryId, expectedAttemptCount) {
  const body = new URLSearchParams({ deliveryId });
  if (expectedAttemptCount !== undefined) {
    body.set("expectedAttemptCount", String(expectedAttemptCount));
  }
  return new Request("http://localhost/admin/deliveries?/retry", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function initHasBody(init) {
  return Object.hasOwn(init, "body") && init.body !== undefined && init.body !== null;
}
