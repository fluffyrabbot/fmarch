import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  ADMIN_ROUTE_CONTRACT,
  adminForbiddenMessage,
  buildAdminAuditDetailData,
  buildAdminRouteData,
  summarizeRecoveryGate,
} from "./admin-route-model.mjs";

test("admin route data exposes setup, audit, and escalation work surfaces", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });

  assert.equal(data.access.allowed, true);
  assert.equal(data.operator.capabilityLabel, "GlobalAdmin");
  assert.deepEqual(data.surfaceHeader, {
    component: "fm-surface-header",
    surface: "admin",
    className: "fm-surface__masthead",
    eyebrowClassName: "fm-eyebrow",
    statusStackClassName: "fm-status-stack",
    eyebrow: "Admin",
    title: "Operations",
    summary:
      "Game setup, scoped session grants, audit reports, and recovery queues.",
    capability: {
      visible: true,
      label: "GlobalAdmin",
      testId: "admin-capability",
      className: "fm-capability-pill",
      minTouchTargetPx: 44,
    },
    liveStatus: { visible: false },
  });
  assert.deepEqual(ADMIN_ROUTE_CONTRACT, {
    surfaceTestId: "admin-surface",
    capabilityTestId: "admin-capability",
    requiredText: "Operations",
  });
  assert.deepEqual(data.command.createGame, {
    action: "create_game",
    game: "midsummer",
    pack: "mafiascum",
  });
  assert.deepEqual(data.command.cohost, {
    action: "add_cohost",
    game: "midsummer",
    user: "cohost_c",
  });
  assert.deepEqual(data.command.sessionGrant, {
    action: "grant_session",
    token: "session-grant-midsummer",
    principalUserId: "mod_a",
    expiresAt: 4102444800,
    globalCapabilities: ["GlobalMod"],
  });
  assert.deepEqual(
    data.gameSetup.map((item) => item.id),
    ["create-game", "session-grants", "cohost"],
  );
  assert.equal(data.gameSetup[0].commandAction, "create_game");
  assert.equal(data.gameSetup[1].commandAction, "grant_session");
  assert.equal(data.gameSetup[2].commandAction, "add_cohost");
  assert.equal(data.gameSetup[0].boundary, "Command pipeline");
  assert.equal(data.gameSetup[0].buttonLabel, "Review");
  assert.equal(data.gameSetup[0].confirmLabel, "Create game");
  assert.equal(
    data.gameSetup[0].confirmMessage,
    "Create game midsummer from pack mafiascum",
  );
  assert.equal(data.gameSetup[1].boundary, "Authenticated session grant");
  assert.match(data.gameSetup[1].boundaryDetail, /GlobalAdmin session/);
  assert.match(data.gameSetup[2].boundaryDetail, /host-gated/);
  assert.equal(data.gameSetup[1].confirmLabel, "Grant GlobalMod");
  assert.equal(data.gameSetup[2].confirmLabel, "Delegate cohost_c");
  assert.equal(
    data.audit[0].href,
    "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
  );
  assert.equal(data.audit[0].inspectHref, "/admin/audit/proof-runs?game=midsummer");
  assert.equal(
    data.audit[2].href,
    "/games/midsummer/operator/proof-runs/go-no-go/view?principal_user_id=admin_a",
  );
  assert.equal(data.audit[2].inspectHref, "/admin/audit/recovery?game=midsummer");
  assert.deepEqual(data.recoveryTasks.map((item) => item.id), ["recovery-gate"]);
  assert.equal(data.recoveryTasks[0].action, "check_recovery_gate");
  assert.equal(
    data.recoveryTasks[0].endpoint,
    "/games/midsummer/operator/proof-runs/go-no-go?principal_user_id=admin_a",
  );
  assert.match(data.recoveryTasks[0].boundaryDetail, /go-no-go/);
});

test("admin recovery gate summary fails closed", () => {
  assert.deepEqual(summarizeRecoveryGate(null), {
    state: "reject",
    message: "Recovery gate returned malformed proof data",
  });
  assert.deepEqual(
    summarizeRecoveryGate({
      ok: false,
      production: {
        trusted: 2,
        total_artifact_rows: 3,
        non_trusted: 1,
      },
    }),
    {
      state: "reject",
      message: "Recovery gate blocked: 1/3 production artifacts need review",
      trusted: 2,
      total: 3,
      nonTrusted: 1,
    },
  );
  assert.deepEqual(
    summarizeRecoveryGate({
      ok: true,
      production: {
        trusted: 3,
        total_artifact_rows: 3,
        non_trusted: 0,
      },
    }),
    {
      state: "ack",
      message: "Recovery gate trusted: 3/3 production artifacts trusted",
      trusted: 3,
      total: 3,
      nonTrusted: 0,
    },
  );
});

test("admin audit detail data stays inside the admin SPA shell", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "proof-runs",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });

  assert.equal(data.access.allowed, true);
  assert.equal(data.shell.activeSurface, "admin");
  assert.deepEqual(data.surfaceHeader, {
    component: "fm-surface-header",
    surface: "admin",
    className: "fm-surface__masthead",
    eyebrowClassName: "fm-eyebrow",
    statusStackClassName: "fm-status-stack",
    eyebrow: "Admin audit",
    title: "Proof runs",
    summary: "/operator/proof-runs machine-readable report",
    capability: {
      visible: true,
      label: "GlobalAdmin",
      testId: "admin-audit-detail-capability",
      className: "fm-capability-pill",
      minTouchTargetPx: 44,
    },
    liveStatus: { visible: false },
  });
  assert.equal(data.status, "available");
  assert.equal(data.overviewHref, "/admin?game=midsummer");
  assert.equal(data.audit.id, "proof-runs");
  assert.equal(data.audit.inspectHref, "/admin/audit/proof-runs?game=midsummer");
  assert.equal(
    data.audit.href,
    "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
  );
});

test("admin audit detail overview href preserves the inspected game", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "proof-runs",
    game: "solstice",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });

  assert.equal(data.overviewHref, "/admin?game=solstice");
  assert.equal(data.audit.inspectHref, "/admin/audit/proof-runs?game=solstice");
  assert.equal(
    data.audit.href,
    "/games/solstice/operator/proof-runs?principal_user_id=admin_a",
  );
});

test("admin audit detail data fails closed for unknown audit rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "missing-proof",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
  });

  assert.equal(data.access.allowed, true);
  assert.equal(data.status, "missing");
  assert.equal(data.audit, null);
  assert.equal(data.auditId, "missing-proof");
});

test("admin recovery gate action reads the machine operator report", async () => {
  let observedUrl = null;
  const result = await actions.checkRecoveryGate({
    fetch: async (url, init) => {
      observedUrl = { url, accept: init.headers.accept };
      return jsonResponse({
        ok: true,
        production: {
          trusted: 4,
          total_artifact_rows: 4,
          non_trusted: 0,
        },
      });
    },
    locals: {
      principalUserId: "admin_a",
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    request: formRequest({
      game: "midsummer",
      principalUserId: "ignored_form_user",
    }),
  });

  assert.deepEqual(observedUrl, {
    url: "/games/midsummer/operator/proof-runs/go-no-go?principal_user_id=admin_a",
    accept: "application/json",
  });
  assert.equal(result.id, "recovery-gate");
  assert.equal(result.state, "ack");
  assert.equal(result.message, "Recovery gate trusted: 4/4 production artifacts trusted");
});

test("admin recovery gate action surfaces backend rejection", async () => {
  const result = await actions.checkRecoveryGate({
    fetch: async () =>
      jsonResponse(
        { message: "principal cannot read operator proof artifact go/no-go for this game" },
        { ok: false, status: 403 },
      ),
    locals: {
      principalUserId: "admin_a",
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      game: "midsummer",
      principalUserId: "admin_a",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.id, "recovery-gate");
  assert.equal(result.data.state, "reject");
  assert.equal(
    result.data.message,
    "principal cannot read operator proof artifact go/no-go for this game",
  );
});

test("admin recovery gate action requires admin surface authority", async () => {
  const result = await actions.checkRecoveryGate({
    fetch: async () => {
      throw new Error("unauthorized recovery check must not call backend");
    },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    request: formRequest({
      game: "midsummer",
      principalUserId: "host_h",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.id, "recovery-gate");
  assert.equal(result.data.message, "Recovery gate checks require GlobalAdmin or GlobalMod");
});

test("admin session grant action requires GlobalAdmin", async () => {
  const result = await actions.grantSession({
    cookies: { get: () => "admin-session" },
    fetch: async () => {
      throw new Error("GlobalMod must not call the session grant API");
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    request: formRequest({
      token: "session-grant-midsummer",
      principalUserId: "mod_a",
      expiresAt: "4102444800",
      globalCapability: "GlobalMod",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.id, "session-grants");
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "Session grants require GlobalAdmin");
});

test("admin session grant action posts the authenticated API request", async () => {
  let observedRequest = null;
  const result = await actions.grantSession({
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
        principal_user_id: "mod_a",
        capabilities: [{ kind: "GlobalMod" }],
      });
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      token: "session-grant-midsummer",
      principalUserId: "mod_a",
      expiresAt: "4102444800",
      globalCapability: "GlobalMod",
    }),
  });

  assert.deepEqual(observedRequest, {
    url: "/auth/session-grants",
    method: "POST",
    authorization: "Bearer admin-session",
    contentType: "application/json",
    body: {
      token: "session-grant-midsummer",
      principal_user_id: "mod_a",
      expires_at: 4102444800,
      global_capabilities: ["GlobalMod"],
    },
  });
  assert.equal(result.id, "session-grants");
  assert.equal(result.state, "ack");
  assert.equal(result.message, "Granted GlobalMod to mod_a");
});

test("admin session grant action rejects malformed grant payloads before the API", async () => {
  const invalidExpiry = await actions.grantSession({
    cookies: { get: () => "admin-session" },
    fetch: async () => {
      throw new Error("invalid session grant expiry must not call the API");
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      token: "session-grant-midsummer",
      principalUserId: "mod_a",
      expiresAt: "later",
      globalCapability: "GlobalMod",
    }),
  });

  assert.equal(invalidExpiry.status, 400);
  assert.equal(invalidExpiry.data.id, "session-grants");
  assert.equal(invalidExpiry.data.state, "reject");
  assert.equal(
    invalidExpiry.data.message,
    "Session grant expiry must be a positive Unix timestamp",
  );

  const unsupportedCapability = await actions.grantSession({
    cookies: { get: () => "admin-session" },
    fetch: async () => {
      throw new Error("unsupported session grant capability must not call the API");
    },
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      token: "session-grant-midsummer",
      principalUserId: "mod_a",
      expiresAt: "4102444800",
      globalCapability: ["GlobalMod", "GlobalAdmin"],
    }),
  });

  assert.equal(unsupportedCapability.status, 400);
  assert.equal(unsupportedCapability.data.id, "session-grants");
  assert.equal(unsupportedCapability.data.state, "reject");
  assert.equal(
    unsupportedCapability.data.message,
    "Session grant form can only request the explicit GlobalMod capability",
  );
});

test("admin session grant action surfaces API rejection", async () => {
  const result = await actions.grantSession({
    cookies: { get: () => "admin-session" },
    fetch: async () =>
      jsonResponse(
        { message: "session grants require GlobalAdmin" },
        { ok: false, status: 403 },
      ),
    locals: {
      resolvedCapabilities: [{ kind: "GlobalAdmin" }],
    },
    request: formRequest({
      token: "session-grant-midsummer",
      principalUserId: "mod_a",
      expiresAt: "4102444800",
      globalCapability: "GlobalMod",
    }),
  });

  assert.equal(result.status, 403);
  assert.equal(result.data.id, "session-grants");
  assert.equal(result.data.state, "reject");
  assert.equal(result.data.message, "session grants require GlobalAdmin");
});

test("admin route data uses operator proof status when available", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    fetchImpl: async () =>
      jsonResponse({
        rows: [{ id: "proof-a", label: "Proof A", status: "green" }],
      }),
  });

  assert.deepEqual(data.audit, [
    {
      id: "proof-a",
      label: "Proof A",
      status: "green",
      authority: "GlobalAdmin or GlobalMod",
      boundary: "Read-only operator proof",
      boundaryDetail: "/operator/proof-runs machine-readable report",
      href: "/games/midsummer/operator/proof-runs?principal_user_id=admin_a",
      inspectHref: "/admin/audit/proof-a?game=midsummer",
    },
  ]);
});

test("admin route data exposes identity lifecycle audit when admin session is present", async () => {
  const observed = [];
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    sessionToken: "admin-session",
    fetchImpl: async (url, init) => {
      observed.push({
        url,
        authorization: init.headers.authorization ?? null,
      });
      if (String(url).startsWith("/auth/identity-lifecycle-audit")) {
        return jsonResponse(identityLifecycleAuditFixture());
      }
      return jsonResponse({
        rows: [{ id: "proof-a", label: "Proof A", status: "green" }],
      });
    },
  });

  const identity = data.audit.find((item) => item.id === "identity-lifecycle");
  assert.equal(
    observed.find((item) => item.url.startsWith("/auth/identity-lifecycle-audit"))
      .authorization,
    "Bearer admin-session",
  );
  assert.equal(identity.label, "Identity lifecycle");
  assert.equal(identity.status, "3 lifecycle audit events available");
  assert.equal(identity.authority, "GlobalAdmin");
  assert.equal(identity.rawTokensStored, false);
  assert.deepEqual(identity.eventKinds, [
    "invite_revoked",
    "session_revoked",
    "session_rotated",
  ]);
  assert.equal(
    identity.href,
    "/admin/audit/identity-lifecycle?game=midsummer&principal_user_id=host_h",
  );
  assert.equal(
    identity.inspectHref,
    "/admin/audit/identity-lifecycle?game=midsummer&principal_user_id=host_h",
  );
  assert.deepEqual(
    identity.entries.map((entry) => entry.eventKind),
    ["session_rotated", "session_revoked", "invite_revoked"],
  );
});

test("admin identity lifecycle detail data carries audit event rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "identity-lifecycle",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    sessionToken: "admin-session",
    fetchImpl: async (url) =>
      String(url).startsWith("/auth/identity-lifecycle-audit")
        ? jsonResponse(identityLifecycleAuditFixture())
        : jsonResponse({
            rows: [{ id: "proof-a", label: "Proof A", status: "green" }],
          }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Identity lifecycle");
  assert.match(data.surfaceHeader.summary, /identity-lifecycle-audit/);
  assert.equal(data.audit.id, "identity-lifecycle");
  assert.equal(data.audit.entries.length, 3);
  assert.deepEqual(
    data.audit.entries.map((entry) => [
      entry.eventKind,
      entry.principalUserId,
      entry.actorUserId,
    ]),
    [
      ["session_rotated", "host_h", "host_h"],
      ["session_revoked", "host_h", "admin_a"],
      ["invite_revoked", "host_h", "admin_a"],
    ],
  );
});

test("admin route data exposes local ops artifacts as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    opsArtifacts: localOpsArtifactsFixture(),
  });

  const ops = data.audit.find((item) => item.id === "local-ops-artifacts");
  assert.equal(ops.label, "Local ops artifacts");
  assert.equal(ops.status, "4 local ops checks passed");
  assert.equal(ops.authority, "GlobalAdmin or GlobalMod");
  assert.equal(ops.inspectHref, "/admin/audit/local-ops-artifacts?game=midsummer");
  assert.deepEqual(
    ops.checks.map((check) => check.id),
    [
      "source-artifacts-checksummed",
      "role-entrypoints-redacted",
      "proof-lanes-summarized",
      "release-boundary-carried",
    ],
  );
  assert.deepEqual(ops.artifactSummary, {
    game: "game-a",
    laneCount: 10,
    roleCount: 6,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes local spine manifest as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    spineManifest: spineManifestFixture(),
  });

  const manifest = data.audit.find((item) => item.id === "local-spine-manifest");
  assert.equal(manifest.label, "Local spine manifest");
  assert.equal(manifest.status, "4 manifest checks passed");
  assert.equal(manifest.authority, "GlobalAdmin or GlobalMod");
  assert.equal(manifest.inspectHref, "/admin/audit/local-spine-manifest?game=midsummer");
  assert.deepEqual(
    manifest.checks.map((check) => check.id),
    [
      "live-spine-order-recorded",
      "sub-spine-orders-recorded",
      "evidence-env-wiring-recorded",
      "release-boundary-carried",
    ],
  );
  assert.deepEqual(manifest.artifactSummary, {
    commandCount: 4,
    artifactCount: 3,
    adminSpineStepCount: 8,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local spine manifest detail data carries manifest check rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-spine-manifest",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    spineManifest: spineManifestFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local spine manifest");
  assert.equal(data.audit.id, "local-spine-manifest");
  assert.equal(data.audit.checks.length, 4);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["live-spine-order-recorded", "passed"],
      ["sub-spine-orders-recorded", "passed"],
      ["evidence-env-wiring-recorded", "passed"],
      ["release-boundary-carried", "passed"],
    ],
  );
});

test("admin route data exposes local hardening proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  const hardening = data.audit.find((item) => item.id === "local-hardening");
  assert.equal(hardening.label, "Local multiplayer hardening");
  assert.equal(hardening.status, "6 hardening lanes passed");
  assert.equal(hardening.authority, "GlobalAdmin or GlobalMod");
  assert.equal(hardening.inspectHref, "/admin/audit/local-hardening?game=midsummer");
  assert.deepEqual(
    hardening.checks.map((check) => check.id),
    [
      "idempotent-retry",
      "reconnect-recovery",
      "stale-player-vote",
      "concurrent-vote-race",
      "stale-action-conflict",
      "stale-host-control",
    ],
  );
  assert.deepEqual(hardening.artifactSummary, {
    game: "game-a",
    roleCount: 4,
    laneCount: 10,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes local core loop proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  const coreLoop = data.audit.find((item) => item.id === "local-core-loop");
  assert.equal(coreLoop.label, "Local core loop");
  assert.equal(coreLoop.status, "3 core loop lanes passed");
  assert.equal(coreLoop.authority, "GlobalAdmin or GlobalMod");
  assert.equal(coreLoop.inspectHref, "/admin/audit/local-core-loop?game=midsummer");
  assert.deepEqual(
    coreLoop.checks.map((check) => check.id),
    ["core-loop", "action-loop", "private-channel"],
  );
  assert.deepEqual(coreLoop.artifactSummary, {
    game: "game-a",
    roleCount: 4,
    laneCount: 10,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local core loop detail data carries lane rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-core-loop",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local core loop");
  assert.equal(data.audit.id, "local-core-loop");
  assert.equal(data.audit.checks.length, 3);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["core-loop", "passed"],
      ["action-loop", "passed"],
      ["private-channel", "passed"],
    ],
  );
});

test("admin local hardening detail data carries lane rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-hardening",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local multiplayer hardening");
  assert.equal(data.audit.id, "local-hardening");
  assert.equal(data.audit.checks.length, 6);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["idempotent-retry", "passed"],
      ["reconnect-recovery", "passed"],
      ["stale-player-vote", "passed"],
      ["concurrent-vote-race", "passed"],
      ["stale-action-conflict", "passed"],
      ["stale-host-control", "passed"],
    ],
  );
});

test("admin local ops artifact detail data carries check rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-ops-artifacts",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    opsArtifacts: localOpsArtifactsFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local ops artifacts");
  assert.equal(data.audit.id, "local-ops-artifacts");
  assert.equal(data.audit.checks.length, 4);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["source-artifacts-checksummed", "passed"],
      ["role-entrypoints-redacted", "passed"],
      ["proof-lanes-summarized", "passed"],
      ["release-boundary-carried", "passed"],
    ],
  );
});

test("admin route data exposes local seed fixture summary as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    seedFixtureSummary: seedFixtureSummaryFixture(),
  });

  const seed = data.audit.find((item) => item.id === "local-seed-fixtures");
  assert.equal(seed.label, "Local seed fixtures");
  assert.equal(seed.status, "7 demo scenarios available locally");
  assert.equal(seed.authority, "GlobalAdmin or GlobalMod");
  assert.equal(seed.inspectHref, "/admin/audit/local-seed-fixtures?game=midsummer");
  assert.deepEqual(
    seed.scenarios.map((scenario) => scenario.id),
    [
      "host-phase-controls",
      "player-vote-recovery",
      "night-action-loop",
      "private-channel-member",
      "private-channel-denied",
      "multiplayer-hardening",
      "local-ops-readiness",
    ],
  );
  assert.deepEqual(seed.artifactSummary, {
    game: "game-a",
    scenarioCount: 7,
    roleCount: 6,
    slotCount: 5,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local seed fixture detail data carries scenario rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-seed-fixtures",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    seedFixtureSummary: seedFixtureSummaryFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local seed fixtures");
  assert.equal(data.audit.id, "local-seed-fixtures");
  assert.equal(data.audit.scenarios.length, 7);
  assert.deepEqual(
    data.audit.scenarios.map((scenario) => [scenario.id, scenario.status]),
    [
      ["host-phase-controls", "available_locally"],
      ["player-vote-recovery", "available_locally"],
      ["night-action-loop", "available_locally"],
      ["private-channel-member", "available_locally"],
      ["private-channel-denied", "available_locally"],
      ["multiplayer-hardening", "available_locally"],
      ["local-ops-readiness", "available_locally"],
    ],
  );
});

test("admin route data exposes local release readiness as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  const readiness = data.audit.find((item) => item.id === "local-release-readiness");
  assert.equal(readiness.label, "Local release readiness");
  assert.equal(readiness.status, "3 local checks passed, 2 release items unproven");
  assert.equal(readiness.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    readiness.inspectHref,
    "/admin/audit/local-release-readiness?game=midsummer",
  );
  assert.deepEqual(
    readiness.checks.map((check) => check.id),
    [
      "local-role-url-browser-proof",
      "local-core-loop-proof",
      "local-hardening-proof",
    ],
  );
  assert.deepEqual(
    readiness.unproven.map((item) => item.id),
    ["hosted-deployment", "human-release-runbook"],
  );
  assert.deepEqual(readiness.artifactSummary, {
    game: "game-a",
    localCheckCount: 3,
    unprovenCount: 2,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local release readiness detail data carries checks and unproven rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-release-readiness",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local release readiness");
  assert.equal(data.audit.id, "local-release-readiness");
  assert.equal(data.audit.checks.length, 3);
  assert.equal(data.audit.unproven.length, 2);
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.status]),
    [
      ["hosted-deployment", "unproven"],
      ["human-release-runbook", "unproven"],
    ],
  );
});

test("admin route data exposes local backup restore proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    backupRestoreProof: backupRestoreProofFixture(),
  });

  const backup = data.audit.find((item) => item.id === "local-backup-restore");
  assert.equal(backup.label, "Local backup restore");
  assert.equal(backup.status, "5 backup restore checks passed");
  assert.equal(backup.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    backup.inspectHref,
    "/admin/audit/local-backup-restore?game=midsummer",
  );
  assert.deepEqual(
    backup.checks.map((check) => check.id),
    [
      "dump-created",
      "event-log-restored",
      "projection-fingerprints-restored",
      "auth-sessions-restored",
      "restored-api-capabilities",
    ],
  );
  assert.deepEqual(
    backup.sessions.map((session) => [session.role, session.capabilities]),
    [
      ["host", ["HostOf"]],
      ["player", ["SlotOccupant", "ChannelMember"]],
      ["admin", ["GlobalAdmin"]],
    ],
  );
  assert.deepEqual(backup.artifactSummary, {
    game: "game-a",
    dump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
    eventRows: 3,
    restoredEventRows: 3,
    sessionCount: 3,
    productionReady: false,
  });
});

test("admin local backup restore detail data carries checks and restored sessions", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-backup-restore",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    backupRestoreProof: backupRestoreProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local backup restore");
  assert.equal(data.audit.id, "local-backup-restore");
  assert.equal(data.audit.checks.length, 5);
  assert.equal(data.audit.sessions.length, 3);
  assert.deepEqual(
    data.audit.sessions.map((session) => [session.role, session.capabilities]),
    [
      ["host", ["HostOf"]],
      ["player", ["SlotOccupant", "ChannelMember"]],
      ["admin", ["GlobalAdmin"]],
    ],
  );
});

test("admin route data exposes local identity adapter proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    identityAdapterProof: identityAdapterProofFixture(),
  });

  const identity = data.audit.find((item) => item.id === "local-identity-adapter");
  assert.equal(identity.label, "Local identity adapter");
  assert.equal(identity.status, "3 role surfaces, 3 lifecycle controls");
  assert.equal(identity.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    identity.inspectHref,
    "/admin/audit/local-identity-adapter?game=midsummer",
  );
  assert.deepEqual(
    identity.checks.map((check) => check.id),
    [
      "session-rotation",
      "session-revocation",
      "invite-revocation",
      "audit-trail",
      "admin-audit-surface",
    ],
  );
  assert.deepEqual(
    identity.sessions.map((session) => [session.role, session.capabilities]),
    [
      ["admin", ["GlobalAdmin"]],
      ["host", ["HostOf"]],
      ["player", ["SlotOccupant", "ChannelMember"]],
    ],
  );
  assert.deepEqual(identity.artifactSummary, {
    game: "game-a",
    browserCookieName: "fmarch_session",
    inviteCredentialKind: "single-use-invite",
    sessionCredentialKind: "opaque-session",
    lifecycleControls: ["session-rotation", "session-revocation", "invite-revocation"],
    rawTokensStored: false,
    rawTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local identity adapter detail data carries lifecycle checks and role rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-identity-adapter",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    identityAdapterProof: identityAdapterProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local identity adapter");
  assert.equal(data.audit.id, "local-identity-adapter");
  assert.equal(data.audit.checks.length, 5);
  assert.equal(data.audit.sessions.length, 3);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["session-rotation", "passed"],
      ["session-revocation", "passed"],
      ["invite-revocation", "passed"],
      ["audit-trail", "passed"],
      ["admin-audit-surface", "passed"],
    ],
  );
});

test("admin load accepts GlobalMod escalation authority", async () => {
  const data = await load({
    locals: {
      principalUserId: "mod_a",
      resolvedCapabilities: [{ kind: "GlobalMod" }],
    },
    url: new URL("http://localhost/admin?game=midsummer"),
    fetch: async () => ({ ok: false }),
  });

  assert.equal(data.access.capabilityLabel, "GlobalMod");
  assert.equal(data.shell.activeSurface, "admin");
  assert.equal(data.shellOwner, "layout");
});

test("admin load rejects game-scoped host authority", async () => {
  await assert.rejects(
    async () =>
      await load({
        locals: {
          principalUserId: "host_h",
          resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
        },
        url: new URL("http://localhost/admin?game=midsummer"),
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

function identityLifecycleAuditFixture() {
  return {
    entries: [
      {
        id: 1,
        event_at: 100,
        event_kind: "session_rotated",
        actor_user_id: "host_h",
        principal_user_id: "host_h",
        metadata: { global_capability_count: 0 },
      },
      {
        id: 2,
        event_at: 101,
        event_kind: "session_revoked",
        actor_user_id: "admin_a",
        principal_user_id: "host_h",
        metadata: {},
      },
      {
        id: 3,
        event_at: 102,
        event_kind: "invite_revoked",
        actor_user_id: "admin_a",
        principal_user_id: "host_h",
        metadata: {},
      },
    ],
  };
}

function proofRunFixture() {
  const lanes = [
    "browser-entry",
    "core-loop",
    "action-loop",
    "private-channel",
    "idempotent-retry",
    "reconnect-recovery",
    "stale-player-vote",
    "concurrent-vote-race",
    "stale-action-conflict",
    "stale-host-control",
  ].map((id) => ({ id, label: id, status: "passed", evidence: {} }));
  return {
    version: 1,
    proof: "dev-test-game-proof-run",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-harness",
    proofBoundary: "Local dev-test-game proof-run.",
    artifacts: {
      proofRun: "target/dev-test-game/proof-run.json",
    },
    session: {
      game: "game-a",
      verificationStatus: "passed",
      roles: ["host", "player", "actionPlayer", "deniedPlayer"],
    },
    lanes,
  };
}

function localOpsArtifactsFixture() {
  return {
    version: 1,
    proof: "dev-test-game-ops-artifacts",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-ops-artifacts",
    proofBoundary: "Local artifact bundle for one dev-test-game run.",
    run: {
      game: "game-a",
      roleCount: 6,
    },
    proofRun: {
      laneCount: 10,
    },
    checks: [
      { id: "source-artifacts-checksummed", status: "passed" },
      { id: "role-entrypoints-redacted", status: "passed" },
      { id: "proof-lanes-summarized", status: "passed" },
      { id: "release-boundary-carried", status: "passed" },
    ],
  };
}

function seedFixtureSummaryFixture() {
  return {
    version: 1,
    proof: "dev-test-game-seed-fixture-summary",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-seed-fixture",
    proofBoundary: "Local seed/demo fixture inventory for one dev-test-game run.",
    fixture: {
      game: "game-a",
      roleCount: 6,
      slots: [
        { slotId: "slot-1" },
        { slotId: "slot-2" },
        { slotId: "slot-3" },
        { slotId: "slot-4" },
        { slotId: "slot-5" },
      ],
    },
    demoScenarios: [
      seedScenario("host-phase-controls", "Host phase controls", "host"),
      seedScenario("player-vote-recovery", "Player vote recovery", "player"),
      seedScenario("night-action-loop", "Night action loop", "actionPlayer"),
      seedScenario("private-channel-member", "Private channel member", "player"),
      seedScenario("private-channel-denied", "Private channel denial", "deniedPlayer"),
      seedScenario("multiplayer-hardening", "Multiplayer hardening", "player"),
      seedScenario("local-ops-readiness", "Local ops readiness", "admin"),
    ],
  };
}

function seedScenario(id, title, role) {
  return {
    id,
    title,
    role,
    status: "available_locally",
  };
}

function spineManifestFixture() {
  return {
    version: 1,
    proof: "dev-test-game-spine-manifest",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-spine-manifest",
    proofBoundary: "Generated local dev-test-game orchestration manifest.",
    commands: {
      live: { plan: [{ script: "dev:test-game:prebuild" }] },
      backupRestore: { plan: [{ script: "tools/live_stack_backup_restore_drill.mjs" }] },
      identity: { plan: [{ script: "tools/auth_invite_role_proof.mjs" }] },
      adminSpine: {
        plan: [
          { script: "tools/dev_test_game_core_loop_admin_proof.mjs" },
          { script: "tools/dev_test_game_hardening_admin_proof.mjs" },
          { script: "tools/dev_test_game_identity_admin_proof.mjs" },
          { script: "tools/dev_test_game_backup_admin_proof.mjs" },
          { script: "tools/dev_test_game_ops_admin_proof.mjs" },
          { script: "tools/dev_test_game_seed_admin_proof.mjs" },
          { script: "tools/dev_test_game_release_admin_proof.mjs" },
          { script: "tools/dev_test_game_spine_manifest_admin_proof.mjs" },
        ],
      },
    },
    artifacts: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/spine-manifest.md",
      "target/dev-test-game/spine-manifest-admin-proof.json",
    ],
    checks: [
      { id: "live-spine-order-recorded", status: "passed" },
      { id: "sub-spine-orders-recorded", status: "passed" },
      { id: "evidence-env-wiring-recorded", status: "passed" },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function releaseReadinessChecklistFixture() {
  return {
    version: 1,
    proof: "dev-test-game-release-readiness",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-release-readiness-checklist",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      proofGeneratedAt: "2026-06-26T00:00:00.000Z",
      game: "game-a",
    },
    localDevelopmentSpine: {
      status: "passed",
      checks: [
        {
          id: "local-role-url-browser-proof",
          label: "Seeded role URLs and browser proof",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
        },
        {
          id: "local-core-loop-proof",
          label: "Host controls and player actions",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
        },
        {
          id: "local-hardening-proof",
          label: "Idempotency and stale-client handling",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
        },
      ],
    },
    releaseReadiness: {
      status: "not_ready",
      reason: "Local proof passed, but hosted evidence remains unproven.",
      unproven: [
        {
          id: "hosted-deployment",
          status: "unproven",
          requiredEvidence: "Hosted API/frontend deployment proof",
        },
        {
          id: "human-release-runbook",
          status: "unproven",
          requiredEvidence: "Human-executed beta/release checklist",
        },
      ],
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact without release claims.",
  };
}

function backupRestoreProofFixture() {
  return {
    version: 1,
    status: "passed",
    scope: "local-live-stack-backup-restore-drill",
    productionReady: false,
    proofBoundary: "Local disposable Postgres backup/restore proof.",
    game: "game-a",
    artifact: {
      proof: "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
      dump: "target/live-stack-backup-restore-drill/local-live-stack.dump",
    },
    checks: [
      { id: "dump-created", status: "passed" },
      { id: "event-log-restored", status: "passed" },
      { id: "projection-fingerprints-restored", status: "passed" },
      { id: "auth-sessions-restored", status: "passed" },
      { id: "restored-api-capabilities", status: "passed" },
    ],
    restoredApiEvidence: {
      restoredSessions: {
        host: ["HostOf"],
        player: ["SlotOccupant", "ChannelMember"],
        admin: ["GlobalAdmin"],
      },
    },
    fingerprints: {
      source: {
        events: { total: 3 },
      },
      restored: {
        events: { total: 3 },
      },
    },
  };
}

function identityAdapterProofFixture() {
  return {
    version: 5,
    proof: "auth-invite-role-proof",
    status: "passed",
    scope: "local-auth-invite-role-proof",
    releaseReady: false,
    productionReady: false,
    proofBoundary: "Local invite proof only.",
    game: "game-a",
    identityAdapter: {
      status: "passed",
      replacesDevTokensWithoutRoleSurfaceChange: true,
      browserCookieName: "fmarch_session",
      inviteCredentialKind: "single-use-invite",
      sessionCredentialKind: "opaque-session",
      lifecycleControls: ["session-rotation", "session-revocation", "invite-revocation"],
    },
    identityLifecycle: {
      status: "passed",
      sessionRotation: {
        status: "passed",
      },
      sessionRevocation: {
        status: "passed",
      },
      inviteRevocation: {
        status: "passed",
      },
      auditTrail: {
        status: "passed",
        rawTokensStored: false,
      },
      adminAuditSurface: {
        status: "passed",
        rawTokensVisible: false,
      },
    },
    roles: {
      admin: {
        capabilityKinds: ["GlobalAdmin"],
      },
      host: {
        capabilityKinds: ["HostOf"],
      },
      player: {
        capabilityKinds: ["SlotOccupant", "ChannelMember"],
      },
    },
  };
}

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        formData.append(key, item);
      }
    } else {
      formData.append(key, value);
    }
  }
  return new Request("http://localhost/admin?/grantSession", {
    method: "POST",
    body: formData,
  });
}
