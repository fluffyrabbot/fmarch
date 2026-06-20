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
