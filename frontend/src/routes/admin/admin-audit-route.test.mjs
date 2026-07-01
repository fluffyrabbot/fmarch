import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./audit/[audit]/+page.server.js";
import { adminForbiddenMessage } from "./admin-route-model.mjs";

test("admin audit detail load returns the native SPA audit surface", async () => {
  const data = await load({
    locals: {
      principalUserId: "admin_a",
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    params: { audit: "proof-runs" },
    url: new URL("http://localhost/admin/audit/proof-runs?game=midsummer"),
    fetch: async () => ({ ok: false }),
  });

  assert.equal(data.shell.activeSurface, "admin");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.surfaceHeader.component, "fm-surface-header");
  assert.equal(data.surfaceHeader.title, "Proof runs");
  assert.equal(data.surfaceHeader.capability.testId, "admin-audit-detail-capability");
  assert.equal(data.surfaceHeader.capability.minTouchTargetPx, 44);
  assert.equal(data.overviewHref, "/admin?game=midsummer");
  assert.equal(data.audit.id, "proof-runs");
  assert.equal(data.audit.inspectHref, "/admin/audit/proof-runs?game=midsummer");
  assert.equal(
    data.audit.href,
    "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
  );
});

test("admin audit detail load returns identity lifecycle rows through admin session", async () => {
  const data = await load({
    cookies: { get: () => "admin-session" },
    locals: {
      principalUserId: "admin_a",
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    params: { audit: "identity-lifecycle" },
    url: new URL("http://localhost/admin/audit/identity-lifecycle?game=midsummer"),
    fetch: async (url, init) => {
      if (String(url).startsWith("/auth/identity-lifecycle-audit")) {
        assert.equal(init.headers.authorization, "Bearer admin-session");
        return jsonResponse({
          entries: [
            {
              id: 1,
              event_at: 98,
              event_kind: "account_created",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 2,
              event_at: 99,
              event_kind: "account_session_created",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 3,
              event_at: 100,
              event_kind: "session_rotated",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 4,
              event_at: 101,
              event_kind: "session_revoked",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 5,
              event_at: 102,
              event_kind: "invite_revoked",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
          ],
        });
      }
      return jsonResponse({ rows: [] });
    },
  });

  assert.equal(data.audit.id, "identity-lifecycle");
  assert.equal(data.surfaceHeader.title, "Identity lifecycle");
  assert.deepEqual(
    data.audit.entries.map((entry) => entry.eventKind),
    [
      "account_created",
      "account_session_created",
      "session_rotated",
      "session_revoked",
      "invite_revoked",
    ],
  );
});

test("admin audit detail load rejects non-admin authority", async () => {
  await assert.rejects(
    async () =>
      await load({
        locals: {
          principalUserId: "host_h",
          resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
        },
        params: { audit: "proof-runs" },
        url: new URL("http://localhost/admin/audit/proof-runs?game=midsummer"),
        fetch: async () => ({ ok: false }),
      }),
    (err) => err.status === 403 && err.body.message === adminForbiddenMessage(),
  );
});

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

test("admin audit detail load rejects unknown audit rows", async () => {
  await assert.rejects(
    async () =>
      await load({
        locals: {
          principalUserId: "admin_a",
          resolvedCapabilities: [{ kind: "GlobalAdmin" }],
        },
        params: { audit: "missing-proof" },
        url: new URL("http://localhost/admin/audit/missing-proof?game=midsummer"),
        fetch: async () => ({ ok: false }),
      }),
    (err) =>
      err.status === 404 &&
      err.body.message === "Admin audit item missing-proof is not available.",
  );
});
