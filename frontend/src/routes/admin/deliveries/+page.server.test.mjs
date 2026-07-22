import assert from "node:assert/strict";
import test from "node:test";
import { actions, load } from "./+page.server.js";

test("delivery page loads the authenticated redacted operator queue", async () => {
  let requested = null;
  const data = await load({
    cookies: { get: () => "operator-session" },
    locals: {
      principalUserId: "mod_m",
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    url: new URL("http://localhost/admin/deliveries"),
    fetch: async (url, init) => {
      requested = { url, init };
      return response({ deliveries: [{ delivery_id: "delivery-1" }] });
    },
  });
  assert.match(requested.url, /\/admin\/auth-deliveries\?limit=200$/u);
  assert.equal(requested.init.headers.authorization, "Bearer operator-session");
  assert.equal(data.deliveries[0].delivery_id, "delivery-1");
  assert.equal(data.canRetry, false);
});

test("delivery retry delegates only a validated id from a GlobalAdmin session", async () => {
  const deliveryId = "11111111-1111-4111-8111-111111111111";
  let requested = null;
  const result = await actions.retry({
    cookies: { get: () => "admin-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalAdmin" }] },
    request: formRequest(deliveryId),
    fetch: async (url, init) => {
      requested = { url, init };
      return response({ status: "delivered", attempt_count: 2 });
    },
  });
  assert.match(requested.url, new RegExp(`/auth/delivery-intents/${deliveryId}/retry$`, "u"));
  assert.equal(requested.init.method, "POST");
  assert.equal(result.state, "ack");
  assert.match(result.message, /attempt 2/u);
});

test("delivery retry rejects GlobalMod before calling the API", async () => {
  let called = false;
  const result = await actions.retry({
    cookies: { get: () => "mod-session" },
    locals: { resolvedCapabilities: [{ kind: "GlobalMod" }] },
    request: formRequest("11111111-1111-4111-8111-111111111111"),
    fetch: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.status, 403);
  assert.equal(result.data.state, "reject");
});

function formRequest(deliveryId) {
  return new Request("http://localhost/admin/deliveries?/retry", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ deliveryId }),
  });
}

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
