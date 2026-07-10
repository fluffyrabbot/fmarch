import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./audit/[audit]/+page.server.js";
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
              metadata: { account_id: "host@example.test" },
            },
            {
              id: 2,
              event_at: 99,
              event_kind: "account_disabled",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 3,
              event_at: 100,
              event_kind: "account_enabled",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 4,
              event_at: 101,
              event_kind: "account_password_rotated",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: { password_algorithm: "argon2id" },
            },
            {
              id: 5,
              event_at: 102,
              event_kind: "account_recovery_credential_issued",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 6,
              event_at: 103,
              event_kind: "account_recovery_credential_revoked",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 7,
              event_at: 104,
              event_kind: "account_recovery_rejected",
              actor_user_id: null,
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 8,
              event_at: 105,
              event_kind: "account_recovered",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 13,
              event_at: 106,
              event_kind: "auth_attempt_rate_limited",
              actor_user_id: null,
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 9,
              event_at: 101,
              event_kind: "account_session_created",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 10,
              event_at: 102,
              event_kind: "session_rotated",
              actor_user_id: "host_h",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 11,
              event_at: 103,
              event_kind: "session_revoked",
              actor_user_id: "admin_a",
              principal_user_id: "host_h",
              metadata: {},
            },
            {
              id: 12,
              event_at: 104,
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
      "account_disabled",
      "account_enabled",
      "account_password_rotated",
      "account_recovery_credential_issued",
      "account_recovery_credential_revoked",
      "account_recovery_rejected",
      "account_recovered",
      "auth_attempt_rate_limited",
      "account_session_created",
      "session_rotated",
      "session_revoked",
      "invite_revoked",
    ],
  );
  assert.deepEqual(data.audit.accountControls, {
    accountId: "host@example.test",
    principalUserId: "host_h",
    currentDisabled: false,
    disableAction: "?/disableAccount",
    enableAction: "?/enableAccount",
    revokeSessions: true,
  });
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

test("admin audit account lifecycle action disables an account through admin session", async () => {
  let observedRequest = null;
  const result = await actions.disableAccount({
    cookies: { get: () => "admin-session" },
    fetch: async (url, init) => {
      observedRequest = {
        url,
        method: init.method,
        authorization: init.headers.authorization,
        contentType: init.headers["content-type"],
        body: JSON.parse(init.body),
      };
      return jsonResponse({
        status: "disabled",
        account_id: "host@example.test",
        principal_user_id: "host_h",
        disabled_at: 123,
        revoked_session_count: 2,
      });
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      accountId: "host@example.test",
      expectedDisabled: "false",
    }),
  });

  assert.deepEqual(observedRequest, {
    url: "/auth/accounts/disable",
    method: "POST",
    authorization: "Bearer admin-session",
    contentType: "application/json",
    body: {
      account_id: "host@example.test",
      expected_disabled: false,
      revoke_sessions: true,
    },
  });
  assert.equal(result.id, "account-disable");
  assert.equal(result.state, "ack");
  assert.equal(result.message, "host@example.test disabled; revoked 2 sessions");
  assert.equal(result.revokedSessionCount, 2);
});

test("admin audit account lifecycle action enables an account through admin session", async () => {
  let observedRequest = null;
  const result = await actions.enableAccount({
    cookies: { get: () => "admin-session" },
    fetch: async (url, init) => {
      observedRequest = {
        url,
        method: init.method,
        authorization: init.headers.authorization,
        contentType: init.headers["content-type"],
        body: JSON.parse(init.body),
      };
      return jsonResponse({
        status: "enabled",
        account_id: "host@example.test",
        principal_user_id: "host_h",
        disabled_at: null,
        revoked_session_count: 0,
      });
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      accountId: "host@example.test",
      expectedDisabled: "true",
    }),
  });

  assert.deepEqual(observedRequest, {
    url: "/auth/accounts/enable",
    method: "POST",
    authorization: "Bearer admin-session",
    contentType: "application/json",
    body: {
      account_id: "host@example.test",
      expected_disabled: true,
    },
  });
  assert.equal(result.id, "account-enable");
  assert.equal(result.state, "ack");
  assert.equal(result.message, "host@example.test enabled");
});

test("admin audit account lifecycle action surfaces stale state conflicts", async () => {
  const result = await actions.enableAccount({
    cookies: { get: () => "admin-session" },
    fetch: async () =>
      jsonResponse(
        {
          error: "StreamConflict",
          message:
            "stale account lifecycle state for host@example.test; refresh and use current account controls before enable",
        },
        { ok: false, status: 409 },
      ),
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      accountId: "host@example.test",
      expectedDisabled: "false",
    }),
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.id, "account-enable");
  assert.equal(result.data.state, "reject");
  assert.match(result.data.message, /stale account lifecycle state/);
  assert.match(result.data.message, /refresh and use current account controls/);
});

test("admin audit account lifecycle action requires GlobalAdmin", async () => {
  const result = await actions.disableAccount({
    cookies: { get: () => "mod-session" },
    fetch: async () => {
      throw new Error("GlobalMod must not call account lifecycle controls");
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    request: formRequest({
      accountId: "host@example.test",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.id, "account-disable");
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "Account lifecycle controls require GlobalAdmin");
});

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request("http://localhost/admin/audit/identity-lifecycle", {
    method: "POST",
    body: formData,
  });
}
