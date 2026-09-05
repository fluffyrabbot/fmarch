import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyUpstreamSessionInvalidation,
  upstreamRouteFailure,
} from "./upstream-route.mjs";

test("upstream route failures preserve authority unless the session is stale", () => {
  assert.deepEqual(upstreamRouteFailure({ kind: "unauthorized" }, { resource: "Game" }), {
    status: 401,
    message: "Game requires a current authenticated session.",
    clearSession: true,
  });
  for (const [kind, status] of [
    ["forbidden", 403],
    ["not_found", 404],
    ["rate_limited", 503],
    ["unavailable", 503],
    ["invalid_response", 502],
  ]) {
    const failure = upstreamRouteFailure({ kind }, { resource: "Game" });
    assert.equal(failure.status, status);
    assert.equal(failure.clearSession, false);
  }
});

test("only stale upstream identity deletes the browser session cookie", () => {
  const deleted = [];
  const cookies = {
    delete(name, options) {
      deleted.push([name, options]);
    },
  };
  applyUpstreamSessionInvalidation(cookies, { clearSession: false });
  applyUpstreamSessionInvalidation(cookies, { clearSession: true });
  assert.deepEqual(deleted, [["fmarch_session", { path: "/" }]]);
});
