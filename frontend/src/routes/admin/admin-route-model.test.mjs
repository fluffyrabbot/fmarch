import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  ADMIN_ROUTE_CONTRACT,
  LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS,
  adminForbiddenMessage,
  buildAdminAuditDetailData,
  buildAdminRouteData,
  summarizeRecoveryGate,
} from "./admin-route-model.mjs";
import {
  hostStaleControlLaneIds,
} from "../../../../tools/dev_test_game_host_stale_control_scenarios.mjs";
import {
  hardeningAuditLaneIds,
} from "../../../../tools/dev_test_game_hardening_scenarios.mjs";
import {
  coreLoopAdminCheckIds,
  coreLoopAuditLaneIds,
} from "../../../../tools/dev_test_game_core_loop_scenarios.mjs";
import {
  staleConflictMessageLaneIds,
} from "../../../../tools/dev_test_game_stale_conflict_scenarios.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  seedAggregateOnlyProofLaneIds,
  seedAliasOnlyProofLaneIds,
  seedDemoScenarioFixtureRows,
  seedScenarioCoverageGroups,
} from "../../../../tools/dev_test_game_seed_scenario_cases.mjs";
import {
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceRealHostedInputsFixture,
} from "../../../../tools/dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedOpsSignalCheckStatusRows,
} from "../../../../tools/dev_test_game_hosted_ops_signal_cases.mjs";
import {
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidenceRequirementGroups,
} from "../../../../tools/dev_test_game_hosted_identity_evidence.mjs";
import {
  releaseReadinessUnprovenItem,
  releaseReadinessUnprovenStatusRows,
} from "../../../../tools/dev_test_game_release_readiness_cases.mjs";

const LOCAL_RACE_COMMAND =
  "npm run test:dev-test-game-hosted-concurrent-race-matrix";
const SEED_FIXTURE_COMMAND = "npm run test:dev-test-game-seed-fixture";
const LOCAL_PROOF_GRAPH_COMMAND =
  "npm run test:dev-test-game-proof-graph-admin-proof";
const LIVE_BROWSER_PROOF_COMMAND =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";
const ACTIONABLE_SPINE_ROLE_URL =
  "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002";
const HOSTED_MATRIX_PROOF_TARGET =
  "target/dev-test-game/hosted-concurrent-race-matrix.json";
const HOSTED_TARGET_PREFLIGHT_PROOF_TARGET =
  "target/dev-test-game/hosted-target-preflight.json";
const HOSTED_EVIDENCE_LANE_PROOF_TARGET =
  "target/dev-test-game/hosted-evidence-lane.json";
const HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET =
  "target/dev-test-game/hosted-identity-evidence.json";
const HOSTED_EVIDENCE_LANE_DEMO_PROOF_TARGET =
  "target/dev-test-game/hosted-evidence-lane-demo-proof.json";

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
  assert.equal(identity.status, "7 lifecycle audit events available");
  assert.equal(identity.authority, "GlobalAdmin");
  assert.equal(identity.rawTokensStored, false);
  assert.deepEqual(identity.eventKinds, [
    "account_created",
    "account_disabled",
    "account_enabled",
    "account_session_created",
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
    [
      "account_created",
      "account_disabled",
      "account_enabled",
      "account_session_created",
      "session_rotated",
      "session_revoked",
      "invite_revoked",
    ],
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
  assert.equal(data.audit.entries.length, 7);
  assert.deepEqual(
    data.audit.entries.map((entry) => [
      entry.eventKind,
      entry.principalUserId,
      entry.actorUserId,
    ]),
    [
      ["account_created", "host_h", "admin_a"],
      ["account_disabled", "host_h", "admin_a"],
      ["account_enabled", "host_h", "admin_a"],
      ["account_session_created", "host_h", "host_h"],
      ["session_rotated", "host_h", "host_h"],
      ["session_revoked", "host_h", "admin_a"],
      ["invite_revoked", "host_h", "admin_a"],
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

test("admin route data exposes local ops artifacts as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    opsArtifacts: localOpsArtifactsFixture(),
  });

  const ops = data.audit.find((item) => item.id === "local-ops-artifacts");
  assert.equal(ops.label, "Local ops artifacts");
  assert.equal(ops.status, "5 local ops checks passed");
  assert.equal(ops.authority, "GlobalAdmin or GlobalMod");
  assert.equal(ops.inspectHref, "/admin/audit/local-ops-artifacts?game=midsummer");
  assert.deepEqual(
    ops.checks.map((check) => check.id),
    [
      "source-artifacts-checksummed",
      "role-entrypoints-redacted",
      "proof-lanes-summarized",
      "proof-stability-summarized",
      "release-boundary-carried",
    ],
  );
  assert.deepEqual(ops.artifactSummary, {
    game: "game-a",
    laneCount: 99,
    roleCount: 7,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes local hosted ops signals as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedOpsSignals: localHostedOpsSignalsFixture(),
  });

  const ops = data.audit.find((item) => item.id === "local-hosted-ops-signals");
  assert.equal(ops.label, "Local hosted ops signals");
  assert.equal(ops.status, "4 hosted-like ops signals passed");
  assert.equal(ops.authority, "GlobalAdmin or GlobalMod");
  assert.equal(ops.inspectHref, "/admin/audit/local-hosted-ops-signals?game=midsummer");
  assert.deepEqual(
    ops.checks.map((check) => [check.id, check.status]),
    hostedOpsSignalCheckStatusRows().map((check) => [check.id, check.status]),
  );
  assert.deepEqual(ops.artifactSummary, {
    game: "game-a",
    cellCount: 16,
    reconnectLaneCount: 10,
    staleConflictLaneCount: 4,
    realHostedDeploymentStatus: "unproven",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes hosted target preflight as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedTargetPreflight: localHostedTargetPreflightFixture(),
  });

  const preflight = data.audit.find(
    (item) => item.id === "local-hosted-target-preflight",
  );
  assert.equal(preflight.label, "Hosted target preflight");
  assert.equal(preflight.status, "1 passed, 5 blocked");
  assert.equal(
    preflight.inspectHref,
    "/admin/audit/local-hosted-target-preflight?game=midsummer",
  );
  assert.deepEqual(
    preflight.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-frontend-url-configured", "blocked"],
      ["hosted-api-url-configured", "blocked"],
      ["hosted-targets-external", "blocked"],
      ["raw-evidence-path-configured", "blocked"],
      ["raw-evidence-readable", "blocked"],
      ["release-claim-boundary-carried", "passed"],
    ],
  );
  assert.deepEqual(
    preflight.unproven.map((item) => item.id),
    [
      "hosted-frontend-url-configured",
      "hosted-api-url-configured",
      "hosted-targets-external",
      "raw-evidence-path-configured",
      "raw-evidence-readable",
    ],
  );
  assert.equal(preflight.artifactSummary.nextProofTarget, HOSTED_TARGET_PREFLIGHT_PROOF_TARGET);
});

test("admin route data exposes hosted evidence lane as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedEvidenceLane: localHostedEvidenceLaneFixture(),
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
  });

  const lane = data.audit.find((item) => item.id === "local-hosted-evidence-lane");
  assert.equal(lane.label, "Hosted evidence lane");
  assert.equal(lane.status, "blocked: 1 passed, 5 blocked");
  assert.equal(lane.authority, "GlobalAdmin or GlobalMod");
  assert.equal(lane.inspectHref, "/admin/audit/local-hosted-evidence-lane?game=midsummer");
  assert.deepEqual(
    lane.checks.map((check) => check.id),
    [
      "hosted-target-preflight",
      "hosted-frontend-url-configured",
      "hosted-api-url-configured",
      "hosted-targets-external",
      "raw-evidence-path-configured",
      "raw-evidence-readable",
      "release-claim-boundary-carried",
    ],
  );
  assert.deepEqual(
    lane.relatedLinks.map((link) => link.id),
    [
      "local-hosted-target-preflight",
      "local-hosted-concurrent-race-matrix",
      "local-next-action",
    ],
  );
  assert.equal(lane.artifactSummary.nextCommand, "npm run test:dev-test-game-hosted-evidence-lane");
  assert.equal(lane.artifactSummary.nextProofTarget, HOSTED_EVIDENCE_LANE_PROOF_TARGET);
  assert.equal(lane.artifactSummary.preflightStatus, "blocked");
  assert.equal(lane.artifactSummary.blockedCheckCount, 5);
  assert.equal(lane.artifactSummary.realHostedEvidenceStatus, "unproven");
  assert.equal(
    lane.artifactSummary.realHostedEvidenceCommand,
    "npm run test:dev-test-game-hosted-evidence-lane",
  );
  assert.equal(
    lane.artifactSummary.realHostedEvidenceProofTarget,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.equal(lane.artifactSummary.demoProofStatus, "passed");
  assert.equal(
    lane.artifactSummary.demoProofTarget,
    HOSTED_EVIDENCE_LANE_DEMO_PROOF_TARGET,
  );
  assert.equal(lane.artifactSummary.demoOnly, true);
  assert.equal(lane.artifactSummary.syntheticExternalTarget, true);
  assert.equal(lane.artifactSummary.demoBlockedLaneStatus, "blocked");
  assert.equal(lane.artifactSummary.demoPassedLaneStatus, "passed");
});

test("admin route data exposes hosted identity evidence as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedIdentityEvidence: localHostedIdentityEvidenceFixture(),
  });

  const identity = data.audit.find(
    (item) => item.id === "local-hosted-identity-evidence",
  );
  assert.equal(identity.label, "Hosted identity evidence");
  assert.equal(identity.status, "blocked: 0 passed, 10 blocked");
  assert.equal(identity.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    identity.inspectHref,
    "/admin/audit/local-hosted-identity-evidence?game=midsummer",
  );
  assert.deepEqual(
    identity.checks.map((check) => check.id),
    hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
  );
  assert.deepEqual(
    identity.unproven.map((item) => item.id),
    hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
  );
  assert.deepEqual(
    identity.relatedLinks.map((link) => link.id),
    ["local-identity-adapter", "local-next-action"],
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.inputs.map((input) => input.id),
    hostedIdentityEvidenceInputIds,
  );
  assert.equal(
    identity.hostedHandoffChecklist.inputs.find(
      (input) => input.id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
    )?.value,
    hostedIdentityEvidencePlaceholderFixturePath,
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.blockedChecks.map((check) => check.id),
    hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.groups.map((group) => [
      group.id,
      group.status,
      group.blockedCheckIds,
    ]),
    hostedIdentityEvidenceRequirementGroups(
      hostedIdentityEvidenceBlockedChecks.map((check) => ({
        ...check,
        status: "blocked",
      })),
    ).map((group) => [group.id, "blocked", group.checkIds]),
  );
  assert.equal(
    identity.artifactSummary.nextProofTarget,
    HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  );
  assert.equal(
    identity.artifactSummary.nextCommand,
    "npm run test:dev-test-game-hosted-identity-evidence",
  );
  assert.equal(
    identity.artifactSummary.placeholderFixturePath,
    hostedIdentityEvidencePlaceholderFixturePath,
  );
});

test("admin route data exposes local spine manifest as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    spineManifest: spineManifestFixture(),
  });

  const manifest = data.audit.find((item) => item.id === "local-spine-manifest");
  assert.equal(manifest.label, "Local spine manifest");
  assert.equal(manifest.status, "11 manifest checks passed");
  assert.equal(manifest.authority, "GlobalAdmin or GlobalMod");
  assert.equal(manifest.inspectHref, "/admin/audit/local-spine-manifest?game=midsummer");
  assert.deepEqual(
    manifest.checks.map((check) => check.id),
    [
      "live-spine-order-recorded",
      "sub-spine-orders-recorded",
      "evidence-env-wiring-recorded",
      "freshness-proof-recorded",
      "artifact-refresh-status-recorded",
      "hosted-concurrent-race-matrix-recorded",
      "hosted-target-preflight-recorded",
      "hosted-evidence-lane-recorded",
      "hosted-evidence-lane-demo-proof-recorded",
      "terminal-artifacts-recorded",
      "release-boundary-carried",
      "proof-freshness-handoff",
      "next-action-handoff",
    ],
  );
  assert.deepEqual(manifest.relatedLinks, [
    {
      id: "local-proof-freshness",
      label: "Proof freshness",
      href: "/admin/audit/local-proof-freshness?game=midsummer",
      status: "blocked",
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
    },
    {
      id: "local-next-action",
      label: "Ranked next action",
      href: "/admin/audit/local-next-action?game=midsummer",
      status: "test:dev-test-game-next-action",
      command: "test:dev-test-game-next-action",
    },
  ]);
  assert.deepEqual(manifest.artifactSummary, {
    commandCount: 13,
    artifactCount: 16,
    terminalArtifactCount: 4,
    adminSpineStepCount: 8,
    artifactFreshnessStatus: "blocked",
    freshCount: 1,
    staleCount: 1,
    missingCount: 0,
    nextCommand:
      "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
    nextActionInspectHref: "/admin/audit/local-next-action?game=midsummer",
    proofFreshnessInspectHref: "/admin/audit/local-proof-freshness?game=midsummer",
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
  assert.equal(data.audit.checks.length, 13);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["live-spine-order-recorded", "passed"],
      ["sub-spine-orders-recorded", "passed"],
      ["evidence-env-wiring-recorded", "passed"],
      ["freshness-proof-recorded", "passed"],
      ["artifact-refresh-status-recorded", "passed"],
      ["hosted-concurrent-race-matrix-recorded", "passed"],
      ["hosted-target-preflight-recorded", "passed"],
      ["hosted-evidence-lane-recorded", "passed"],
      ["hosted-evidence-lane-demo-proof-recorded", "passed"],
      ["terminal-artifacts-recorded", "passed"],
      ["release-boundary-carried", "passed"],
      ["proof-freshness-handoff", "blocked"],
      ["next-action-handoff", "test:dev-test-game-next-action"],
    ],
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => [link.id, link.href]),
    [
      ["local-proof-freshness", "/admin/audit/local-proof-freshness?game=midsummer"],
      ["local-next-action", "/admin/audit/local-next-action?game=midsummer"],
    ],
  );
});

test("admin route data exposes local admin spine proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    adminSpineProof: adminSpineProofFixture(),
  });

  const adminSpine = data.audit.find((item) => item.id === "local-admin-spine");
  assert.equal(adminSpine.label, "Local admin spine");
  assert.equal(adminSpine.status, "10 admin proof surfaces passed");
  assert.equal(adminSpine.authority, "GlobalAdmin or GlobalMod");
  assert.equal(adminSpine.inspectHref, "/admin/audit/local-admin-spine?game=midsummer");
  assert.deepEqual(
    adminSpine.checks.map((check) => check.id),
    [
      "core-loop",
      "hardening",
      "identity",
      "backup",
      "ops",
      "seed",
      "release",
      "race-coverage",
      "hosted-concurrent-race-matrix",
      "spine-manifest",
      "recovery",
      "spine-manifest-handoff",
    ],
  );
  assert.deepEqual(adminSpine.relatedLinks, [
    {
      id: "local-spine-manifest",
      label: "Spine manifest",
      href: "/admin/audit/local-spine-manifest?game=midsummer",
      status: "passed",
      command: "npm run test:dev-test-game-spine-manifest-admin-proof",
    },
  ]);
  assert.deepEqual(adminSpine.artifactSummary, {
    game: "game-a",
    proofCount: 10,
    recoveryStatus: "passed",
    refreshedCount: 10,
    nextCommand: "npm run test:dev-test-game-admin-spine",
    spineManifestInspectHref: "/admin/audit/local-spine-manifest?game=midsummer",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local admin spine detail data carries aggregate proof rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-admin-spine",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    adminSpineProof: adminSpineProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local admin spine");
  assert.equal(data.audit.id, "local-admin-spine");
  assert.equal(data.audit.checks.length, 12);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["core-loop", "passed"],
      ["hardening", "passed"],
      ["identity", "passed"],
      ["backup", "passed"],
      ["ops", "passed"],
      ["seed", "passed"],
      ["release", "passed"],
      ["race-coverage", "passed"],
      ["hosted-concurrent-race-matrix", "passed"],
      ["spine-manifest", "passed"],
      ["recovery", "passed"],
      ["spine-manifest-handoff", "passed"],
    ],
  );
  assert.equal(
    data.audit.checks.find((check) => check.id === "core-loop").rerunCommand,
    "npm run test:dev-test-game-core-loop-admin-proof",
  );
  assert.equal(
    data.audit.checks.find((check) => check.id === "recovery").nextCommand,
    "npm run test:dev-test-game-admin-spine",
  );
  assert.deepEqual(data.audit.relatedLinks, [
    {
      id: "local-spine-manifest",
      label: "Spine manifest",
      href: "/admin/audit/local-spine-manifest?game=midsummer",
      status: "passed",
      command: "npm run test:dev-test-game-spine-manifest-admin-proof",
    },
  ]);
});

test("admin route data exposes local proof graph as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofGraph: proofGraphFixture(),
  });

  const graph = data.audit.find((item) => item.id === "local-proof-graph");
  assert.equal(graph.label, "Local proof graph");
  assert.equal(graph.status, "6 proof nodes, 6 edges");
  assert.equal(graph.authority, "GlobalAdmin or GlobalMod");
  assert.equal(graph.inspectHref, "/admin/audit/local-proof-graph?game=midsummer");
  assert.deepEqual(
    graph.checks.map((check) => [check.id, check.status]),
    [
      ["admin-spine", "passed"],
      ["spine-manifest", "passed"],
      ["proof-freshness", "passed"],
      ["next-action", "recorded"],
      ["admin-proof:seed", "passed"],
      ["admin-proof:hosted-concurrent-race-matrix", "passed"],
      ["edge:admin-spine:aggregates:spine-manifest", "aggregates"],
      ["edge:spine-manifest:records:proof-freshness", "records"],
      ["edge:spine-manifest:records:next-action", "records"],
      ["edge:proof-freshness:recovers-through:next-action", "recovers-through"],
      ["edge:next-action:recovery-target:admin-proof:seed", "recovery-target"],
      [
        "edge:admin-spine:aggregates:admin-proof:hosted-concurrent-race-matrix",
        "aggregates",
      ],
    ],
  );
  assert.deepEqual(
    graph.relatedLinks.map((link) => [link.id, link.href]),
    [
      ["admin-spine", "/admin/audit/local-admin-spine?game=midsummer"],
      ["spine-manifest", "/admin/audit/local-spine-manifest?game=midsummer"],
      ["proof-freshness", "/admin/audit/local-proof-freshness?game=midsummer"],
      ["next-action", "/admin/audit/local-next-action?game=midsummer"],
      ["admin-proof:seed", "/admin/audit/local-seed-fixtures?game=midsummer"],
      [
        "admin-proof:hosted-concurrent-race-matrix",
        "/admin/audit/local-hosted-concurrent-race-matrix?game=midsummer",
      ],
    ],
  );
  assert.deepEqual(graph.artifactSummary, {
    nodeCount: 6,
    edgeCount: 6,
    roleUrlCount: 6,
    recoveryTargetCount: 6,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local proof graph detail data carries graph node rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-proof-graph",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofGraph: proofGraphFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local proof graph");
  assert.equal(data.audit.id, "local-proof-graph");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["admin-spine", "passed"],
      ["spine-manifest", "passed"],
      ["proof-freshness", "passed"],
      ["next-action", "recorded"],
      ["admin-proof:seed", "passed"],
      ["admin-proof:hosted-concurrent-race-matrix", "passed"],
      ["edge:admin-spine:aggregates:spine-manifest", "aggregates"],
      ["edge:spine-manifest:records:proof-freshness", "records"],
      ["edge:spine-manifest:records:next-action", "records"],
      ["edge:proof-freshness:recovers-through:next-action", "recovers-through"],
      ["edge:next-action:recovery-target:admin-proof:seed", "recovery-target"],
      [
        "edge:admin-spine:aggregates:admin-proof:hosted-concurrent-race-matrix",
        "aggregates",
      ],
    ],
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => [link.id, link.href]),
    [
      ["admin-spine", "/admin/audit/local-admin-spine?game=midsummer"],
      ["spine-manifest", "/admin/audit/local-spine-manifest?game=midsummer"],
      ["proof-freshness", "/admin/audit/local-proof-freshness?game=midsummer"],
      ["next-action", "/admin/audit/local-next-action?game=midsummer"],
      ["admin-proof:seed", "/admin/audit/local-seed-fixtures?game=midsummer"],
      [
        "admin-proof:hosted-concurrent-race-matrix",
        "/admin/audit/local-hosted-concurrent-race-matrix?game=midsummer",
      ],
    ],
  );
});

test("admin route data exposes local race coverage as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    raceCoverage: raceCoverageFixture(),
  });

  const raceCoverage = data.audit.find((item) => item.id === "local-race-coverage");
  assert.equal(raceCoverage.label, "Local race coverage");
  assert.equal(raceCoverage.status, "3 race cells passed");
  assert.equal(raceCoverage.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    raceCoverage.inspectHref,
    "/admin/audit/local-race-coverage?game=midsummer",
  );
  assert.deepEqual(
    raceCoverage.checks.map((check) => [check.id, check.status]),
    [
      ["player-vote-change", "passed"],
      ["host-resolve", "passed"],
      ["host-complete-game", "passed"],
    ],
  );
  assert.deepEqual(raceCoverage.artifactSummary, {
    game: "00000000-0000-0000-0000-000000000001",
    cellCount: 3,
    provenCellCount: 3,
    unprovenCellCount: 0,
    reloadRequiredCellCount: 3,
    reloadCoveredCellCount: 3,
    reloadGapCount: 0,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local race coverage detail data carries race cell rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-race-coverage",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    raceCoverage: raceCoverageFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local race coverage");
  assert.equal(data.audit.id, "local-race-coverage");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["player-vote-change", "passed"],
      ["host-resolve", "passed"],
      ["host-complete-game", "passed"],
    ],
  );
});

test("admin route data exposes local hosted matrix as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedConcurrentRaceMatrix: hostedConcurrentRaceMatrixFixture(),
  });

  const matrix = data.audit.find(
    (item) => item.id === "local-hosted-concurrent-race-matrix",
  );
  assert.equal(matrix.label, "Local hosted matrix");
  assert.equal(matrix.status, "3 hosted-like race cells passed");
  assert.equal(matrix.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    matrix.inspectHref,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=midsummer",
  );
  assert.deepEqual(
    matrix.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-like-api-frontend-target", "passed"],
      ["multi-session-concurrent-command-matrix", "passed"],
      ["reload-recovery-after-races", "passed"],
      ["reconnect-recovery", "passed"],
      ["stale-client-conflict-messages", "passed"],
      ["raw-role-credential-redaction", "passed"],
      ["local-demo-hosted-evidence", "not_applicable"],
      ["real-hosted-evidence-required", "unproven"],
      ["real-hosted-deployment", "unproven"],
      ["player-vote-change", "passed"],
      ["host-resolve", "passed"],
      ["host-complete-game", "passed"],
    ],
  );
  assert.deepEqual(
    matrix.relatedLinks.map((link) => [link.id, link.href]),
    [
      ["local-race-coverage", "/admin/audit/local-race-coverage?game=midsummer"],
      ["local-next-action", "/admin/audit/local-next-action?game=midsummer"],
    ],
  );
  assert.deepEqual(
    matrix.reconnectLanes.map((lane) => [lane.id, lane.status]),
    [
      ["reconnect-recovery", "passed"],
      ["replacement-reconnect-recovery", "passed"],
      ["replacement-action-reconnect", "passed"],
      ["replacement-stale-private-post-reconnect", "passed"],
      ["stale-action-reconnect-recovery", "passed"],
      ["stale-host-complete-reconnect-recovery", "passed"],
      ["stale-host-resolve-reconnect-recovery", "passed"],
      ["stale-host-advance-reconnect-recovery", "passed"],
      ["stale-host-deadline-reconnect-recovery", "passed"],
      ["stale-cohost-deadline-reconnect-recovery", "passed"],
    ],
  );
  assert.deepEqual(
    matrix.staleConflictLanes.map((lane) => [lane.id, lane.status]),
    [
      ["replacement-stale-conflict-message", "passed"],
      ["stale-action-conflict-message", "passed"],
      ["stale-dead-action-conflict", "passed"],
      ["stale-host-control", "passed"],
    ],
  );
  assert.deepEqual(
    matrix.unproven.map((item) => [item.id, item.status]),
    [
      ["hosted-concurrent-race-matrix", "unproven"],
      ["remaining-gap-1", "unproven"],
      ["remaining-gap-2", "unproven"],
    ],
  );
  assert.deepEqual(matrix.artifactSummary, {
    game: "00000000-0000-0000-0000-000000000001",
    cellCount: 3,
    passedCellCount: 3,
    reloadCoveredCellCount: 3,
    reconnectLaneCount: 10,
    staleConflictLaneCount: 4,
    roleSurfaceCount: 2,
    hostedEvidenceStatus: "not_configured",
    hostedEvidenceMode: "not_configured",
    localDemoHostedEvidenceStatus: "not_applicable",
    realHostedEvidenceStatus: "unproven",
    realHostedDeploymentStatus: "unproven",
    externalHostedEvidenceStatus: "not_configured",
    realHostedEvidenceCommand: "npm run test:dev-test-game-hosted-evidence-lane",
    realHostedEvidenceProofTarget:
      "target/dev-test-game/hosted-matrix-external.json",
    nextCommand: "test:dev-test-game-hosted-concurrent-race-matrix",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local hosted matrix detail data carries progress and gap rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-hosted-concurrent-race-matrix",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedConcurrentRaceMatrix: hostedConcurrentRaceMatrixFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local hosted matrix");
  assert.equal(data.audit.id, "local-hosted-concurrent-race-matrix");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-like-api-frontend-target", "passed"],
      ["multi-session-concurrent-command-matrix", "passed"],
      ["reload-recovery-after-races", "passed"],
      ["reconnect-recovery", "passed"],
      ["stale-client-conflict-messages", "passed"],
      ["raw-role-credential-redaction", "passed"],
      ["local-demo-hosted-evidence", "not_applicable"],
      ["real-hosted-evidence-required", "unproven"],
      ["real-hosted-deployment", "unproven"],
      ["player-vote-change", "passed"],
      ["host-resolve", "passed"],
      ["host-complete-game", "passed"],
    ],
  );
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.requiredEvidence]),
    [
      [
        "hosted-concurrent-race-matrix",
        "Hosted or hosted-like concurrent command race matrix beyond promoted local milestones.",
      ],
      [
        "remaining-gap-1",
        "hosted API/frontend deployment proof with external health checks",
      ],
      [
        "remaining-gap-2",
        "beta/release/operator readiness and human rollback path",
      ],
    ],
  );
  assert.deepEqual(
    data.audit.realHostedEvidenceInputs.map((item) => [
      item.id,
      item.value,
      item.required,
    ]),
    [
      ["command", "npm run test:dev-test-game-hosted-evidence-lane", true],
      ["proof-target", "target/dev-test-game/hosted-matrix-external.json", true],
      [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "Externally reachable frontend base URL.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_API_URL",
        "Externally reachable API base URL.",
        true,
      ],
      ["FMARCH_HOSTED_MATRIX_GROUP_ID", "Hosted matrix group to prove.", true],
      [
        "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        "Raw hosted matrix evidence captured from the real target.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
        "Optional normalized hosted matrix evidence output path.",
        false,
      ],
    ],
  );
  assert.deepEqual(
    data.audit.reconnectLanes.map((lane) => [lane.id, lane.status]),
    [
      ["reconnect-recovery", "passed"],
      ["replacement-reconnect-recovery", "passed"],
      ["replacement-action-reconnect", "passed"],
      ["replacement-stale-private-post-reconnect", "passed"],
      ["stale-action-reconnect-recovery", "passed"],
      ["stale-host-complete-reconnect-recovery", "passed"],
      ["stale-host-resolve-reconnect-recovery", "passed"],
      ["stale-host-advance-reconnect-recovery", "passed"],
      ["stale-host-deadline-reconnect-recovery", "passed"],
      ["stale-cohost-deadline-reconnect-recovery", "passed"],
    ],
  );
  assert.deepEqual(
    data.audit.staleConflictLanes.map((lane) => [lane.id, lane.status]),
    [
      ["replacement-stale-conflict-message", "passed"],
      ["stale-action-conflict-message", "passed"],
      ["stale-dead-action-conflict", "passed"],
      ["stale-host-control", "passed"],
    ],
  );
});

test("admin route data exposes local proof freshness as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofFreshness: proofFreshnessFixture(),
    nextAction: nextActionFixture(),
  });

  const freshness = data.audit.find((item) => item.id === "local-proof-freshness");
  assert.equal(freshness.label, "Local proof freshness");
  assert.equal(freshness.status, "23 fresh, 0 stale, 0 missing");
  assert.equal(freshness.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    freshness.inspectHref,
    "/admin/audit/local-proof-freshness?game=midsummer",
  );
  assert.deepEqual(
    freshness.checks.map((check) => check.id),
    [
      "session",
      "proof-run",
      "backup-restore",
      "ops-artifacts",
      "seed-fixture",
      "release-readiness",
      "identity-adapter",
      "spine-manifest",
      "core-loop",
      "hardening",
      "identity",
      "backup",
      "ops",
      "seed",
      "release",
      "spine-manifest-admin",
      "admin-spine",
      "admin-spine-admin",
      "proof-graph",
      "proof-graph-admin",
      "hosted-evidence-lane",
      "hosted-evidence-lane-admin",
      "hosted-evidence-lane-demo",
      "next-action-handoff",
    ],
  );
  assert.deepEqual(freshness.relatedLinks, [
    {
      id: "local-next-action",
      label: "Ranked next action",
      href: "/admin/audit/local-next-action?game=midsummer",
      status: `ready: ${LOCAL_RACE_COMMAND}`,
      command: LOCAL_RACE_COMMAND,
    },
  ]);
  assert.deepEqual(freshness.artifactSummary, {
    artifactCount: 23,
    freshCount: 23,
    staleCount: 0,
    missingCount: 0,
    maxAgeHours: 24,
    nextActionCommand: LOCAL_RACE_COMMAND,
    nextActionInspectHref: "/admin/audit/local-next-action?game=midsummer",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local proof freshness detail data carries stale and missing rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-proof-freshness",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofFreshness: proofFreshnessFixture({
      status: "blocked",
      artifacts: [
        freshnessArtifact("session", "fresh"),
        freshnessArtifact("proof-run", "stale"),
        freshnessArtifact("backup-restore", "missing"),
      ],
    }),
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      artifact: {
        id: "proof-run",
        label: "Live proof run",
        path: "target/dev-test-game/proof-run.json",
        status: "stale",
        refreshSource: "manifest-default",
      },
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local proof freshness");
  assert.equal(data.audit.id, "local-proof-freshness");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["session", "fresh"],
      ["proof-run", "stale"],
      ["backup-restore", "missing"],
      [
        "next-action-handoff",
        "blocked: DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      ],
    ],
  );
  assert.deepEqual(data.audit.relatedLinks, [
    {
      id: "local-next-action",
      label: "Ranked next action",
      href: "/admin/audit/local-next-action?game=midsummer",
      status:
        "blocked: DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
    },
  ]);
});

test("admin route data exposes local next action as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture(),
    proofGraph: proofGraphFixture(),
  });

  const nextAction = data.audit.find((item) => item.id === "local-next-action");
  assert.equal(nextAction.label, "Local next action");
  assert.equal(nextAction.status, `ready: ${LOCAL_RACE_COMMAND}`);
  assert.equal(nextAction.authority, "GlobalAdmin or GlobalMod");
  assert.equal(nextAction.inspectHref, "/admin/audit/local-next-action?game=midsummer");
  assert.deepEqual(
    nextAction.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["release-readiness-unproven", "ready"],
      ["hosted-concurrent-race-matrix", "unproven"],
      [
        "selected-proof-graph-node",
        "passed: npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
      ],
      [
        "selected-proof-graph-destination",
        "admin-proof:hosted-concurrent-race-matrix:local-hosted-concurrent-race-matrix",
      ],
      [
        "selected-feature-spine-declaration",
        "player-action-submission:d02-n02/d02-n02-n02-action-open/d02-n02-actionPlayer/action-loop",
      ],
      [
        "selected-spine-target",
        "d02-n02/d02-n02-n02-action-open/d02-n02-actionPlayer/action-loop",
      ],
      [
        "selected-spine-drilldown",
        "player-action-submission:d02-n02/d02-n02-n02-action-open/d02-n02-actionPlayer/action-loop",
      ],
      ["selected-spine-admin-check", "action-loop"],
      [
        "selected-spine-rerun-command",
        "npm run test:dev-test-game-core-loop-admin-proof",
      ],
      ["selected-spine-browser-proof", LIVE_BROWSER_PROOF_COMMAND],
      ["selection-trace", "0 candidates"],
      ["release-readiness-selection-trace", "1 buildable candidates"],
      ["release-readiness-hosted-concurrent-race-matrix", "selected:unproven"],
      ["seed-proof-lane-coverage-trace", "0 unclassified lanes"],
      ["race-coverage-promoted-milestones", "4/4 groups, 16/16 cells, 16/16 reloads"],
      ["replacement-race-reload-milestone", "3/3 covered"],
      ["replacement-race-reload-replacement-private-post", "covered:passed"],
      ["replacement-race-reload-replacement-vote", "covered:passed"],
      ["replacement-race-reload-replacement-action", "covered:passed"],
      ...hostConcurrentRaceReloadCheckRows(),
      ...playerConcurrentActionReloadCheckRows(),
      ...cohostDeadlineRaceReloadCheckRows(),
      ...staleConflictMessageCheckRows(),
      ...hostStaleControlCheckRows(),
    ],
  );
  assert.deepEqual(nextAction.relatedLinks, [
    {
      id: "selected-proof-graph-node",
      label: "admin-proof:hosted-concurrent-race-matrix",
      href: "/admin/audit/local-proof-graph?game=midsummer",
      status: "passed",
      command:
        "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    },
    {
      id: "admin-proof:hosted-concurrent-race-matrix",
      label: "hosted-concurrent-race-matrix",
      href: "/admin/audit/local-hosted-concurrent-race-matrix?game=midsummer",
      status: "unproven",
      command: LOCAL_RACE_COMMAND,
    },
  ]);
  assert.deepEqual(nextAction.artifactSummary, {
    command: LOCAL_RACE_COMMAND,
    reason: "release-readiness-unproven",
    actionStatus: "ready",
    sourceManifest: "target/dev-test-game/spine-manifest.json",
    artifactFreshnessStatus: "passed",
    artifactCount: 23,
    freshCount: 23,
    staleCount: 0,
    missingCount: 0,
    selectionTrace: {
      strategy: "development-spine-priority",
      candidateCount: 0,
      selectedArtifactId: null,
      candidates: [],
    },
    releaseReadinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
    releaseReadinessStatus: "not_ready",
    unprovenCount: 7,
    buildableUnprovenCount: 1,
    localCheckCount: 18,
    buildableLocalDependencyCount: 0,
    selectedLocalCheckId: "",
    selectedLocalCheckBuildSlice: "",
    selectedLocalCheckProofTarget: "",
    selectedLocalCheckRoleUrl: "",
    selectedLocalCheckRoleHref: "",
    selectedSeedProofLaneCoverageSource: "",
    selectedSeedProofLaneCoverageUnclassifiedCount: 0,
    selectedSeedProofLaneCoverageUnclassifiedLaneIds: [],
    selectedSeedProofLaneCoverageBuildSlice: "",
    selectedSeedProofLaneCoverageProofTarget: "",
    selectedSeedProofLaneCoverageRoleUrl: "",
    selectedSeedProofLaneCoverageRoleHref: "",
    selectedUnprovenId: "hosted-concurrent-race-matrix",
    selectedBuildSlice:
      "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
    selectedProofTarget: HOSTED_MATRIX_PROOF_TARGET,
    selectedHostedEvidenceMode: "",
    selectedRealHostedEvidenceStatus: "",
    selectedRealHostedEvidenceCommand: "",
    selectedRealHostedEvidenceProofTarget: "",
    selectedProductionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
    selectedSpineDrilldown: featureSpineDrilldownFixture(),
    selectedSpineTarget: {
      sourceCheckId: "local-core-loop-proof",
      featureSlotId: "player-action-submission",
      detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      cycleId: "d02-n02",
      roleUrlId: "d02-n02-actionPlayer",
      roleUrl: ACTIONABLE_SPINE_ROLE_URL,
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: "action-loop",
      browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
    },
    selectedRoleUrl:
      "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
    selectedRoleHref:
      "/admin/audit/local-hosted-concurrent-race-matrix?game=midsummer",
    selectedProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
    selectedProofGraphNodeStatus: "passed",
    selectedProofGraphNodeProofCommand:
      "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
    selectedProofGraphNodeRoleUrl:
      "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
    selectedProofGraphNodeAuditId: "local-hosted-concurrent-race-matrix",
    selectedProofGraphNodeHref: "/admin/audit/local-proof-graph?game=midsummer",
    stabilitySource: "",
    stabilityBuildSlice: "",
    stabilityProofTarget: "",
    stabilityTrace: {
      strategy: "proof-stability-before-readiness",
      status: "clean",
      selected: false,
      hostConfirmClicks: 55,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 1,
      eventCount: 0,
    },
    seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture(),
    localReadinessDependencyTrace: {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 0,
      selectedCheckId: null,
      candidates: [],
    },
    releaseReadinessTrace: {
      strategy: "local-dev-release-readiness-priority",
      candidateCount: 1,
      selectedUnprovenId: "hosted-concurrent-race-matrix",
      candidates: [
        {
          rank: 1,
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          priority: 0,
          selected: true,
          command: LOCAL_RACE_COMMAND,
          buildSlice:
            "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
          proofTarget: HOSTED_MATRIX_PROOF_TARGET,
          roleUrl:
            "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
          proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
          productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
          spineDrilldown: featureSpineDrilldownFixture(),
          spineTarget: {
            sourceCheckId: "local-core-loop-proof",
            featureSlotId: "player-action-submission",
            detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
            cycleId: "d02-n02",
            roleUrlId: "d02-n02-actionPlayer",
            roleUrl: ACTIONABLE_SPINE_ROLE_URL,
            checkpointId: "d02-n02-n02-action-open",
            adminCheckId: "action-loop",
            browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
          },
        },
      ],
    },
    replacementRaceReloadTrace: replacementRaceReloadTraceFixture(),
    hostConcurrentRaceReloadTrace: hostConcurrentRaceReloadTraceFixture(),
    playerConcurrentActionReloadTrace: playerConcurrentActionReloadTraceFixture(),
    cohostDeadlineRaceReloadTrace: cohostDeadlineRaceReloadTraceFixture(),
    raceCoveragePromotedMilestones: raceCoveragePromotedMilestonesFixture(),
    staleConflictMessageTrace: staleConflictMessageTraceFixture(),
    hostStaleControlTrace: hostStaleControlTraceFixture(),
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes local readiness dependency next action", async () => {
  const localCheck = proofGraphHandoffLocalCheckFixture();
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "release-readiness-local-check-missing",
      command: LOCAL_PROOF_GRAPH_COMMAND,
      localCheck,
      unproven: undefined,
      localReadinessDependencyTrace: localReadinessDependencyTraceFixture({
        localCheck,
        command: LOCAL_PROOF_GRAPH_COMMAND,
      }),
      releaseReadinessTrace: releaseReadinessTraceFixture({
        unproven: undefined,
      }),
    }),
  });

  const nextAction = data.audit.find((item) => item.id === "local-next-action");
  assert.equal(nextAction.status, `blocked: ${LOCAL_PROOF_GRAPH_COMMAND}`);
  assert.deepEqual(
    nextAction.checks
      .filter((check) =>
        [
          "release-readiness-local-check-missing",
          "local-proof-graph-admin-role-handoffs",
          "local-readiness-dependency-trace",
          "local-readiness-dependency-local-proof-graph-admin-role-handoffs",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["release-readiness-local-check-missing", "blocked"],
      ["local-proof-graph-admin-role-handoffs", "missing"],
      ["local-readiness-dependency-trace", "1 missing local dependencies"],
      [
        "local-readiness-dependency-local-proof-graph-admin-role-handoffs",
        "selected:missing",
      ],
    ],
  );
  assert.deepEqual(nextAction.relatedLinks, [
    {
      id: "local-proof-graph-admin-role-handoffs",
      label: "local-proof-graph-admin-role-handoffs",
      href: "/admin/audit/local-proof-graph?game=midsummer",
      status: "missing",
      command: LOCAL_PROOF_GRAPH_COMMAND,
    },
  ]);
  assert.equal(
    nextAction.artifactSummary.selectedLocalCheckRoleHref,
    "/admin/audit/local-proof-graph?game=midsummer",
  );
});

test("admin route data exposes seed proof-lane coverage drift next action", async () => {
  const seedProofLaneCoverage = seedProofLaneCoverageActionFixture({
    unclassifiedLaneIds: ["new-production-proof-lane"],
  });
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "seed-proof-lane-coverage-drift",
      command: SEED_FIXTURE_COMMAND,
      seedProofLaneCoverage,
      releaseReadinessTrace: releaseReadinessTraceFixture({ unproven: undefined }),
    }),
  });

  const nextAction = data.audit.find((item) => item.id === "local-next-action");
  assert.equal(nextAction.status, `blocked: ${SEED_FIXTURE_COMMAND}`);
  assert.deepEqual(
    nextAction.checks
      .filter((check) =>
        [
          "seed-proof-lane-coverage-drift",
          "seed-proof-lane-coverage",
          "seed-proof-lane-coverage-trace",
          "seed-proof-lane-coverage-new-production-proof-lane",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["seed-proof-lane-coverage-drift", "blocked"],
      ["seed-proof-lane-coverage", "1 unclassified lanes"],
      ["seed-proof-lane-coverage-trace", "1 unclassified lanes"],
      ["seed-proof-lane-coverage-new-production-proof-lane", "unclassified"],
    ],
  );
  assert.deepEqual(nextAction.relatedLinks, [
    {
      id: "seed-proof-lane-coverage",
      label: "Seed proof-lane coverage",
      href: "/admin/audit/local-seed-fixtures?game=midsummer",
      status: "drifted",
      command: SEED_FIXTURE_COMMAND,
    },
  ]);
  assert.equal(
    nextAction.artifactSummary.selectedSeedProofLaneCoverageRoleHref,
    "/admin/audit/local-seed-fixtures?game=midsummer",
  );
  assert.deepEqual(
    nextAction.artifactSummary.selectedSeedProofLaneCoverageUnclassifiedLaneIds,
    ["new-production-proof-lane"],
  );
});

test("admin local next action detail data carries hosted evidence handoff checklist", async () => {
  const unproven = hostedEvidenceLaneUnprovenFixture();
  const data = await buildAdminAuditDetailData({
    audit: "local-next-action",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      command: "npm run test:dev-test-game-hosted-evidence-lane",
      unproven,
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, "local-next-action");
  assert.equal(data.audit.hostedHandoffChecklist.status, "blocked");
  assert.equal(data.audit.hostedHandoffChecklist.preflightStatus, "blocked");
  assert.equal(
    data.audit.hostedHandoffChecklist.command,
    "npm run test:dev-test-game-hosted-evidence-lane",
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.proofTarget,
    HOSTED_EVIDENCE_LANE_PROOF_TARGET,
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.inputs.map((item) => item.id),
    unproven.hostedHandoffChecklist.inputIds,
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedChecks.map((item) => item.id),
    unproven.hostedHandoffChecklist.blockedCheckIds,
  );
  assert.equal(
    data.audit.artifactSummary.selectedRoleHref,
    "/admin/audit/local-hosted-evidence-lane?game=midsummer",
  );
});

test("admin local next action detail data carries recovery check rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-next-action",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command: "npm run test:dev-test-game-core-loop-admin-proof",
      artifact: {
        id: "core-loop",
        label: "Core loop admin proof",
        path: "target/dev-test-game/core-loop-admin-proof.json",
        status: "stale",
        refreshSource: "admin-spine-recovery",
      },
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local next action");
  assert.equal(data.audit.id, "local-next-action");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["artifact-not-fresh", "blocked"],
      ["core-loop", "stale"],
      ["selection-trace", "1 candidates"],
      ["selection-trace-core-loop", "selected:stale"],
      ["seed-proof-lane-coverage-trace", "0 unclassified lanes"],
      ["race-coverage-promoted-milestones", "4/4 groups, 16/16 cells, 16/16 reloads"],
      ["replacement-race-reload-milestone", "3/3 covered"],
      ["replacement-race-reload-replacement-private-post", "covered:passed"],
      ["replacement-race-reload-replacement-vote", "covered:passed"],
      ["replacement-race-reload-replacement-action", "covered:passed"],
      ...hostConcurrentRaceReloadCheckRows(),
      ...playerConcurrentActionReloadCheckRows(),
      ...cohostDeadlineRaceReloadCheckRows(),
      ...staleConflictMessageCheckRows(),
      ...hostStaleControlCheckRows(),
    ],
  );
});

test("admin local next action detail data carries harness stability drift rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-next-action",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "harness-stability-drift",
      command: LOCAL_RACE_COMMAND,
      unproven: undefined,
      releaseReadinessTrace: releaseReadinessTraceFixture({ unproven: undefined }),
      stability: {
        source: "target/dev-test-game/ops-artifacts.json",
        hostConfirmClicks: 55,
        retryClickCount: 1,
        domFallbackCount: 1,
        forceFallbackCount: 0,
        failureCount: 0,
        maxAttempts: 3,
        eventCount: 2,
        buildSlice:
          "Stabilize the critical host-confirm browser interaction before expanding the production-facing seeded proof spine.",
        proofTarget: "target/dev-test-game/session.json",
      },
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, "local-next-action");
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["harness-stability-drift", "blocked"],
      ["proof-stability-drift", "1 retries, 1 DOM fallbacks, 0 force fallbacks"],
      ["selection-trace", "0 candidates"],
      ["seed-proof-lane-coverage-trace", "0 unclassified lanes"],
      ["race-coverage-promoted-milestones", "4/4 groups, 16/16 cells, 16/16 reloads"],
      ["replacement-race-reload-milestone", "3/3 covered"],
      ["replacement-race-reload-replacement-private-post", "covered:passed"],
      ["replacement-race-reload-replacement-vote", "covered:passed"],
      ["replacement-race-reload-replacement-action", "covered:passed"],
      ...hostConcurrentRaceReloadCheckRows(),
      ...playerConcurrentActionReloadCheckRows(),
      ...cohostDeadlineRaceReloadCheckRows(),
      ...staleConflictMessageCheckRows(),
      ...hostStaleControlCheckRows(),
    ],
  );
  assert.deepEqual(data.audit.artifactSummary.stabilityTrace, {
    strategy: "proof-stability-before-readiness",
    status: "drifted",
    selected: true,
    hostConfirmClicks: 55,
    retryClickCount: 1,
    domFallbackCount: 1,
    forceFallbackCount: 0,
    failureCount: 0,
    maxAttempts: 3,
    eventCount: 2,
  });
  assert.equal(
    data.audit.artifactSummary.stabilityBuildSlice,
    "Stabilize the critical host-confirm browser interaction before expanding the production-facing seeded proof spine.",
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
  assert.equal(hardening.status, `${hardeningAuditLaneIds.length} hardening lanes passed`);
  assert.equal(hardening.authority, "GlobalAdmin or GlobalMod");
  assert.equal(hardening.inspectHref, "/admin/audit/local-hardening?game=midsummer");
  assert.deepEqual(
    hardening.checks.map((check) => check.id),
    hardeningAuditLaneIds,
  );
  assert.deepEqual(hardening.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: 107,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes local player recovery proof as a focused audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  const playerRecovery = data.audit.find(
    (item) => item.id === "local-player-recovery",
  );
  assert.deepEqual(LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS, playerRecoveryAuditLaneIds);
  assert.equal(playerRecovery.label, "Local player recovery");
  assert.equal(playerRecovery.status, "25 player recovery lanes passed");
  assert.equal(playerRecovery.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    playerRecovery.inspectHref,
    "/admin/audit/local-player-recovery?game=midsummer",
  );
  assert.deepEqual(
    playerRecovery.checks.map((check) => check.id),
    playerRecoveryAuditLaneIds,
  );
  assert.deepEqual(
    playerRecovery.relatedLinks.map((link) => [link.id, link.href]),
    [
      ["local-core-loop", "/admin/audit/local-core-loop?game=midsummer"],
      ["local-hardening", "/admin/audit/local-hardening?game=midsummer"],
    ],
  );
  assert.deepEqual(playerRecovery.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: 107,
    playerRecoveryLaneCount: 25,
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
  assert.equal(coreLoop.status, `${coreLoopAuditLaneIds.length} core loop lanes passed`);
  assert.equal(coreLoop.authority, "GlobalAdmin or GlobalMod");
  assert.equal(coreLoop.inspectHref, "/admin/audit/local-core-loop?game=midsummer");
  assert.deepEqual(
    coreLoop.checks.map((check) => check.id),
    coreLoopAdminCheckIds,
  );
  assert.deepEqual(coreLoop.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: 107,
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
  assert.deepEqual(
    data.audit.spineCycles.map((cycle) => [
      cycle.id,
      cycle.game,
      cycle.roleUrls.map((roleUrl) => [roleUrl.id, roleUrl.href]),
      cycle.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.status]),
    ]),
    [
      [
        "d01-n01-d02",
        "game-a",
        [
          ["host", "http://127.0.0.1:5173/g/game-a/host"],
          ["actionPlayer", "http://127.0.0.1:5173/g/game-a"],
          ["normalPlayer", "http://127.0.0.1:5173/g/game-a"],
          ["target", "http://127.0.0.1:5173/g/game-a"],
        ],
        [
          ["d01-resolved-locked", "phase D01, locked"],
          ["n01-action-open", "phase N01, action factional_kill"],
          ["n01-resolved-target-killed", "receipt factional_kill"],
          ["d02-day-controls-return", "phase D02"],
        ],
      ],
      [
        "d02-n02",
        "game-b",
        [
          ["host", "http://127.0.0.1:5173/g/game-b/host"],
          ["actionPlayer", "http://127.0.0.1:5173/g/game-b"],
          ["normalPlayer", "http://127.0.0.1:5173/g/game-b"],
          ["target", "http://127.0.0.1:5173/g/game-b"],
        ],
        [
          ["d02-vote-open", "phase D02, vote target slot-2"],
          ["d02-deciding-vote-submitted", "vote ack, count 3"],
          ["d02-resolved-target-killed", "outcome Lynch"],
          ["n02-action-open", "phase N02, action factional_kill"],
        ],
      ],
    ],
  );
  assert.deepEqual(
    data.audit.spineRecoveryHooks.map((hook) => [hook.id, hook.status]),
    [
      ["staleLockedVoteReject", "PhaseLocked"],
      ["invalidActionReject", "InvalidTarget"],
      ["normalPlayerDirectActionReject", "InvalidTarget"],
      ["staleActionConflictReject", "PhaseLocked"],
    ],
  );
  assert.equal(data.audit.checks.length, coreLoopAdminCheckIds.length);
  assert.deepEqual(
    data.audit.checks.map((check) => check.id),
    coreLoopAdminCheckIds,
  );
  const checkStatusById = Object.fromEntries(
    data.audit.checks.map((check) => [check.id, check.status]),
  );
  assert.deepEqual(
    [
      ["core-loop-spine", "passed: D01 -> N01 -> D02, vote ack, next N02"],
      ["core-loop", "passed: PhaseLocked vote receipt, unchanged unknown, lock ack/unlock ack"],
      ["action-loop", "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown"],
      ["host-deadline-advance", "passed: D01 deadline -> N01"],
      ["invalid-action-recovery", "passed: Reject InvalidTarget, legal action visible true"],
      ["resolution-receipts", "passed: factional_kill receipt, target slot-2"],
      ["player-action-boundary", "passed: 0 unowned actions, direct reject InvalidTarget"],
      ["private-channel", "passed: private:mafia_day_chat, denied 403"],
      [
        "stale-host-complete-reload",
        "passed: Reject GameAlreadyCompleted: game already completed, revealed 1, complete visible false",
      ],
      [
        "stale-host-complete-reconnect-recovery",
        "passed: reconnecting -> recovered, completed true, revealed 1",
      ],
      [
        "concurrent-host-complete-race",
        "passed: reject GameAlreadyCompleted, completed true, revealed 1",
      ],
      [
        "concurrent-host-complete-race-reload",
        "passed: completed true, revealed 1/1",
      ],
      [
        "concurrent-player-complete-race",
        "passed: post GameAlreadyCompleted, completed true, thread post false",
      ],
      ["public-player-complete-reload", "passed: completed true, posts 0"],
      ["stale-player-complete-reload", "passed: completed true, vote false, posts 0"],
      ["stale-host-resolve", "passed: Reject PhaseLocked, role URL true, locked true"],
      [
        "stale-host-resolve-reload",
        "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
      ],
      ["stale-host-advance", "passed: Reject InvalidTarget, role URL true, locked false"],
      [
        "stale-host-advance-reload",
        "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
      ],
      ["replacement-incoming-player", "passed"],
    ].map(([id, status]) => [id, status, checkStatusById[id]]),
    [
      [
        "core-loop-spine",
        "passed: D01 -> N01 -> D02, vote ack, next N02",
        "passed: D01 -> N01 -> D02, vote ack, next N02",
      ],
      [
        "core-loop",
        "passed: PhaseLocked vote receipt, unchanged unknown, lock ack/unlock ack",
        "passed: PhaseLocked vote receipt, unchanged unknown, lock ack/unlock ack",
      ],
      [
        "action-loop",
        "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown",
        "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown",
      ],
      [
        "host-deadline-advance",
        "passed: D01 deadline -> N01",
        "passed: D01 deadline -> N01",
      ],
      [
        "invalid-action-recovery",
        "passed: Reject InvalidTarget, legal action visible true",
        "passed: Reject InvalidTarget, legal action visible true",
      ],
      [
        "resolution-receipts",
        "passed: factional_kill receipt, target slot-2",
        "passed: factional_kill receipt, target slot-2",
      ],
      [
        "player-action-boundary",
        "passed: 0 unowned actions, direct reject InvalidTarget",
        "passed: 0 unowned actions, direct reject InvalidTarget",
      ],
      [
        "private-channel",
        "passed: private:mafia_day_chat, denied 403",
        "passed: private:mafia_day_chat, denied 403",
      ],
      [
        "stale-host-complete-reload",
        "passed: Reject GameAlreadyCompleted: game already completed, revealed 1, complete visible false",
        "passed: Reject GameAlreadyCompleted: game already completed, revealed 1, complete visible false",
      ],
      [
        "stale-host-complete-reconnect-recovery",
        "passed: reconnecting -> recovered, completed true, revealed 1",
        "passed: reconnecting -> recovered, completed true, revealed 1",
      ],
      [
        "concurrent-host-complete-race",
        "passed: reject GameAlreadyCompleted, completed true, revealed 1",
        "passed: reject GameAlreadyCompleted, completed true, revealed 1",
      ],
      [
        "concurrent-host-complete-race-reload",
        "passed: completed true, revealed 1/1",
        "passed: completed true, revealed 1/1",
      ],
      [
        "concurrent-player-complete-race",
        "passed: post GameAlreadyCompleted, completed true, thread post false",
        "passed: post GameAlreadyCompleted, completed true, thread post false",
      ],
      [
        "public-player-complete-reload",
        "passed: completed true, posts 0",
        "passed: completed true, posts 0",
      ],
      [
        "stale-player-complete-reload",
        "passed: completed true, vote false, posts 0",
        "passed: completed true, vote false, posts 0",
      ],
      [
        "stale-host-resolve",
        "passed: Reject PhaseLocked, role URL true, locked true",
        "passed: Reject PhaseLocked, role URL true, locked true",
      ],
      [
        "stale-host-resolve-reload",
        "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
        "passed: Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls, locked true",
      ],
      [
        "stale-host-advance",
        "passed: Reject InvalidTarget, role URL true, locked false",
        "passed: Reject InvalidTarget, role URL true, locked false",
      ],
      [
        "stale-host-advance-reload",
        "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
        "passed: Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, locked false",
      ],
      ["replacement-incoming-player", "passed", "passed"],
    ],
  );
});

test("admin local player recovery detail data carries focused lane rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-player-recovery",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local player recovery");
  assert.equal(data.audit.id, "local-player-recovery");
  assert.equal(data.audit.checks.length, 25);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      [
        "action-loop",
        "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown",
      ],
      [
        "invalid-action-recovery",
        "passed: Reject InvalidTarget, legal action visible true",
      ],
      ["dead-player-recovery", "passed"],
      ["player-action-boundary", "passed: 0 unowned actions, direct reject InvalidTarget"],
      ["idempotent-retry", "passed"],
      ["action-idempotent-retry", "passed"],
      ["concurrent-action-race", "passed: ack action, reject ActionAlreadySubmitted"],
      ["concurrent-action-race-reload", "passed: target slot-2, alive false"],
      ["reconnect-recovery", "passed: reconnecting -> recovered"],
      ["stale-player-vote", "passed"],
      ["concurrent-vote-race", "passed"],
      ["concurrent-vote-race-reload", "passed"],
      ["concurrent-player-vote-resolve-race", "passed"],
      ["concurrent-player-vote-resolve-race-reload", "passed"],
      ["concurrent-player-action-advance-race", "passed"],
      ["concurrent-player-action-advance-race-reload", "passed"],
      ["concurrent-player-complete-race", "passed"],
      ["public-player-complete-reload", "passed"],
      ["stale-player-complete", "passed"],
      ["stale-player-complete-reload", "passed"],
      [
        "stale-dead-action-conflict",
        "passed: Reject SlotNotAlive, role URL true, actor dead",
      ],
      [
        "stale-same-action-recovery",
        "passed: Reject ActionAlreadySubmitted, role URL true, visible false",
      ],
      [
        "stale-action-conflict",
        "passed: Reject PhaseLocked, role URL true, refreshed D02",
      ],
      [
        "stale-action-reconnect-recovery",
        "passed: role URL true, reconnecting -> recovered, phase D02",
      ],
      [
        "stale-action-conflict-message",
        "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      ],
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
  assert.equal(data.audit.checks.length, hardeningAuditLaneIds.length);
  assert.deepEqual(
    data.audit.checks.map((check) => check.id),
    hardeningAuditLaneIds,
  );
  const checkStatusById = Object.fromEntries(
    data.audit.checks.map((check) => [check.id, check.status]),
  );
  assert.deepEqual(
    [
      "concurrent-action-race",
      "stale-dead-action-conflict",
      "stale-action-conflict-message",
      "stale-host-complete-reconnect-recovery",
      "stale-host-control",
      "concurrent-host-resolve-race",
      "stale-host-resolve",
      "stale-cohost-deadline-reconnect-recovery",
    ].map((id) => [id, checkStatusById[id]]),
    [
      ["concurrent-action-race", "passed: ack action, reject ActionAlreadySubmitted"],
      [
        "stale-dead-action-conflict",
        "passed: Reject SlotNotAlive, role URL true, actor dead",
      ],
      [
        "stale-action-conflict-message",
        "passed: role URL true, Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      ],
      [
        "stale-host-complete-reconnect-recovery",
        "passed: reconnecting -> recovered, completed true",
      ],
      ["stale-host-control", "passed: Reject PhaseLocked, current D02"],
      ["concurrent-host-resolve-race", "passed: ack resolve, reject PhaseLocked"],
      ["stale-host-resolve", "passed: Reject PhaseLocked, role URL true, locked true"],
      [
        "stale-cohost-deadline-reconnect-recovery",
        "passed: reconnecting -> recovered, deadline null, phase controls 0",
      ],
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
  assert.equal(data.audit.checks.length, 5);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["source-artifacts-checksummed", "passed"],
      ["role-entrypoints-redacted", "passed"],
      ["proof-lanes-summarized", "passed"],
      ["proof-stability-summarized", "passed"],
      ["release-boundary-carried", "passed"],
    ],
  );
});

test("admin local hosted ops signals detail data carries signal rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-hosted-ops-signals",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedOpsSignals: localHostedOpsSignalsFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local hosted ops signals");
  assert.equal(data.audit.id, "local-hosted-ops-signals");
  assert.equal(data.audit.checks.length, 5);
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    ["local-hosted-concurrent-race-matrix", "local-ops-artifacts"],
  );
});

test("admin hosted target preflight detail data carries blocked setup rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-hosted-target-preflight",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedTargetPreflight: localHostedTargetPreflightFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Hosted target preflight");
  assert.equal(data.audit.id, "local-hosted-target-preflight");
  assert.equal(data.audit.checks.length, 6);
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    ["local-hosted-concurrent-race-matrix", "local-next-action"],
  );
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.status]),
    [
      ["hosted-frontend-url-configured", "blocked"],
      ["hosted-api-url-configured", "blocked"],
      ["hosted-targets-external", "blocked"],
      ["raw-evidence-path-configured", "blocked"],
      ["raw-evidence-readable", "blocked"],
    ],
  );
});

test("admin hosted evidence lane detail data carries blocked setup rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: "local-hosted-evidence-lane",
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedEvidenceLane: localHostedEvidenceLaneFixture(),
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Hosted evidence lane");
  assert.equal(data.audit.id, "local-hosted-evidence-lane");
  assert.equal(data.audit.checks.length, 7);
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    [
      "local-hosted-target-preflight",
      "local-hosted-concurrent-race-matrix",
      "local-next-action",
    ],
  );
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.status]),
    [
      ["hosted-frontend-url-configured", "blocked"],
      ["hosted-api-url-configured", "blocked"],
      ["hosted-targets-external", "blocked"],
      ["raw-evidence-path-configured", "blocked"],
      ["raw-evidence-readable", "blocked"],
    ],
  );
  assert.deepEqual(
    data.audit.realHostedEvidenceInputs.map((item) => [
      item.id,
      item.value,
      item.required,
    ]),
    [
      ["command", "npm run test:dev-test-game-hosted-evidence-lane", true],
      ["proof-target", "target/dev-test-game/hosted-matrix-external.json", true],
      [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "Externally reachable frontend base URL.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_API_URL",
        "Externally reachable API base URL.",
        true,
      ],
      ["FMARCH_HOSTED_MATRIX_GROUP_ID", "Hosted matrix group to prove.", true],
      [
        "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        "Raw hosted matrix evidence captured from the real target.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
        "Optional normalized hosted matrix evidence output path.",
        false,
      ],
    ],
  );
  assert.equal(data.audit.hostedHandoffChecklist.status, "blocked");
  assert.equal(data.audit.hostedHandoffChecklist.preflightStatus, "blocked");
  assert.equal(
    data.audit.hostedHandoffChecklist.command,
    "npm run test:dev-test-game-hosted-evidence-lane",
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.proofTarget,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.inputs.map((item) => [
      item.id,
      item.required,
    ]),
    [
      ["command", true],
      ["proof-target", true],
      ["FMARCH_HOSTED_MATRIX_FRONTEND_URL", true],
      ["FMARCH_HOSTED_MATRIX_API_URL", true],
      ["FMARCH_HOSTED_MATRIX_GROUP_ID", true],
      ["FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH", true],
      ["FMARCH_HOSTED_MATRIX_EVIDENCE_PATH", false],
    ],
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedChecks.map((item) => [
      item.id,
      item.status,
    ]),
    [
      ["hosted-frontend-url-configured", "blocked"],
      ["hosted-api-url-configured", "blocked"],
      ["hosted-targets-external", "blocked"],
      ["raw-evidence-path-configured", "blocked"],
      ["raw-evidence-readable", "blocked"],
    ],
  );
  assert.equal(data.audit.artifactSummary.demoProofStatus, "passed");
  assert.equal(data.audit.artifactSummary.demoOnly, true);
  assert.equal(
    data.audit.artifactSummary.demoPassedRoleUrl,
    "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
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
  assert.equal(seed.status, "118 demo scenarios available locally");
  assert.equal(seed.authority, "GlobalAdmin or GlobalMod");
  assert.equal(seed.inspectHref, "/admin/audit/local-seed-fixtures?game=midsummer");
  assert.deepEqual(
    seed.scenarios.map((scenario) => scenario.id),
    seedScenarioCoverageGroups.allDemo,
  );
  assert.deepEqual(seed.artifactSummary, {
    game: "game-a",
    scenarioCount: seedScenarioCoverageGroups.allDemo.length,
    roleCount: 7,
    slotCount: 5,
    proofLaneCount: 115,
    directSeededProofLaneCount: 107,
    aliasOnlyProofLaneCount: seedAliasOnlyProofLaneIds.length,
    aggregateOnlyProofLaneCount: seedAggregateOnlyProofLaneIds.length,
    unclassifiedProofLaneCount: 0,
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
  assert.equal(data.audit.scenarios.length, seedScenarioCoverageGroups.allDemo.length);
  assert.deepEqual(
    data.audit.scenarios.map((scenario) => [scenario.id, scenario.status]),
    seedDemoScenarioFixtureRows().map((scenario) => [
      scenario.id,
      scenario.status,
    ]),
  );
  assert.deepEqual(
    data.audit.proofLaneCoverage.map((coverage) => [
      coverage.id,
      coverage.count,
    ]),
    [
      ["direct-seeded", 107],
      ["alias-only", seedAliasOnlyProofLaneIds.length],
      ["aggregate-only", seedAggregateOnlyProofLaneIds.length],
      ["unclassified", 0],
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
  assert.equal(readiness.status, "8 local checks passed, 2 release items unproven");
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
      "local-stale-conflict-message-milestone",
      "local-host-stale-control-milestone",
      "local-proof-graph-admin-role-handoffs",
      "local-proof-freshness-admin-surface",
      "local-next-action-admin-surface",
    ],
  );
  assert.deepEqual(
    readiness.localPrerequisites.map((check) => [
      check.id,
      check.command,
      check.roleUrl,
    ]),
    [
      [
        "local-proof-graph-admin-role-handoffs",
        "npm run test:dev-test-game-proof-graph-admin-proof",
        "/admin/audit/local-proof-graph?game=<seeded-game>",
      ],
      [
        "local-proof-freshness-admin-surface",
        "npm run test:dev-test-game-proof-freshness-admin-proof",
        "/admin/audit/local-proof-freshness?game=<seeded-game>",
      ],
      [
        "local-next-action-admin-surface",
        "npm run test:dev-test-game-next-action-admin-proof",
        "/admin/audit/local-next-action?game=<seeded-game>",
      ],
    ],
  );
  assert.deepEqual(
    readiness.unproven.map((item) => item.id),
    releaseReadinessUnprovenStatusRows([
      "hosted-deployment",
      "human-release-runbook",
    ]).map((item) => item.id),
  );
  assert.deepEqual(readiness.artifactSummary, {
    game: "game-a",
    localCheckCount: 8,
    localPrerequisiteCount: 3,
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
  assert.equal(data.audit.checks.length, 8);
  assert.deepEqual(
    data.audit.localPrerequisites.map((item) => [item.id, item.proofTarget]),
    [
      [
        "local-proof-graph-admin-role-handoffs",
        "target/dev-test-game/proof-graph-admin-proof.json",
      ],
      [
        "local-proof-freshness-admin-surface",
        "target/dev-test-game/proof-freshness-admin-proof.json",
      ],
      [
        "local-next-action-admin-surface",
        "target/dev-test-game/next-action-admin-proof.json",
      ],
    ],
  );
  assert.equal(data.audit.unproven.length, 2);
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.status]),
    releaseReadinessUnprovenStatusRows([
      "hosted-deployment",
      "human-release-runbook",
    ]).map((item) => [item.id, item.status]),
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
  assert.equal(identity.status, "3 role surfaces, 5 lifecycle controls");
  assert.equal(identity.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    identity.inspectHref,
    "/admin/audit/local-identity-adapter?game=midsummer",
  );
  assert.deepEqual(
    identity.checks.map((check) => check.id),
    [
      "account-login",
      "account-lifecycle",
      "session-rotation",
      "session-revocation",
      "invite-revocation",
      "host-scoped-invite-issuance",
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
    accountCredentialKind: "local-password-account",
    lifecycleControls: [
      "account-disable",
      "account-enable",
      "session-rotation",
      "session-revocation",
      "invite-revocation",
    ],
    delegatedIssuanceControls: ["host-scoped-invite-issuance"],
    hostScopedInvite: {
      issuedByPrincipalUserId: "host_h",
      issuedForGame: "game-a",
      storedGameScope: "game-a",
      globalCapabilitiesGranted: 0,
      hostRoleSurface: "/g/game-a/host",
      hostAction: "?/issuePlayerInvite",
      clickedThroughFromHostRoleUrl: true,
    },
    accountLogin: {
      principalUserId: "host_h",
      accountId: "host@example.test",
      sameRoleSurface: true,
      cookieValuePrefix: "account-session-",
      rawPasswordStored: false,
    },
    accountLifecycle: {
      disabledStatus: "disabled",
      enabledStatus: "enabled",
      disabledAccountRejected: true,
      staleAccountSessionRejected: true,
      staleAdminControlRejected: true,
      staleAdminControlReloadRecovered: true,
      sameRoleSurface: true,
      revokedSessionCount: 1,
      adminControlSurface: {
        detailRoleUrl:
          "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
        controlsTestId: "admin-identity-account-controls",
        visitedDetailRoleUrl: true,
        staleConflictStatusText:
          "stale account lifecycle state for host@example.test; refresh and use current account controls before enable",
        reloadRecoveryStatus: "disabled",
        reloadRecoveryDetailRoleUrl:
          "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
        reloadRecoveryTargetText: "host@example.test host_h disabled",
      },
      rawPasswordStored: false,
    },
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
  assert.equal(data.audit.checks.length, 8);
  assert.equal(data.audit.sessions.length, 3);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["account-login", "passed"],
      ["account-lifecycle", "passed"],
      ["session-rotation", "passed"],
      ["session-revocation", "passed"],
      ["invite-revocation", "passed"],
      ["host-scoped-invite-issuance", "passed"],
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
        metadata: { account_id: "host@example.test" },
      },
      {
        id: 3,
        event_at: 100,
        event_kind: "account_enabled",
        actor_user_id: "admin_a",
        principal_user_id: "host_h",
        metadata: { account_id: "host@example.test" },
      },
      {
        id: 4,
        event_at: 99,
        event_kind: "account_session_created",
        actor_user_id: "host_h",
        principal_user_id: "host_h",
        metadata: { account_id: "host@example.test" },
      },
      {
        id: 5,
        event_at: 100,
        event_kind: "session_rotated",
        actor_user_id: "host_h",
        principal_user_id: "host_h",
        metadata: { global_capability_count: 0 },
      },
      {
        id: 6,
        event_at: 101,
        event_kind: "session_revoked",
        actor_user_id: "admin_a",
        principal_user_id: "host_h",
        metadata: {},
      },
      {
        id: 7,
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
  const laneEvidence = {
    "core-loop": {
      rejectedVoteError: "PhaseLocked",
      lockState: "ack",
      unlockState: "ack",
    },
    "action-loop": {
      invalidActionError: "InvalidTarget",
      legalActionState: "ack",
      resolvedTargetAlive: false,
      advancedPhase: "D02",
    },
    "host-deadline-advance": {
      advanceState: "ack",
      commandPhase: "D01",
      observedAt: 1781928001,
      deadline: 1781928000,
      browserPhaseAfter: "N01",
      apiPhaseAfter: "N01",
    },
    "invalid-action-recovery": {
      rejectError: "InvalidTarget",
      receiptActionId: "submit_invalid_action:factional_kill",
      receiptState: "reject",
      phase: "N01",
      actionCount: 1,
      legalActionVisible: true,
      refreshKeys: ["notifications", "investigationResults", "commandState"],
    },
    "resolution-receipts": {
      targetSlot: "slot-2",
      hostSlotAlive: false,
      targetNoticeStatus: "factional_kill",
    },
    "player-action-boundary": {
      commandActionCount: 0,
      factionalKillVisible: false,
      directRejectError: "InvalidTarget",
      phaseAfterReject: "N01",
    },
    "private-channel": {
      channel: "private:mafia_day_chat",
      allowedState: "ack",
      deniedStatus: 403,
    },
    "concurrent-action-race": {
      ackState: "ack",
      rejectError: "ActionAlreadySubmitted",
      targetSlot: "slot-2",
      refreshedActionCount: 0,
      resolvedTargetAlive: false,
    },
    "concurrent-action-race-reload": {
      targetSlot: "slot-2",
      actionRouteStatus: 200,
      hostRouteStatus: 200,
      apiTargetAlive: false,
    },
    "reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredSnapshotContainsPost: true,
    },
    "stale-same-action-recovery": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer",
      visitedRolePath: "/g/midsummer",
      rejectError: "ActionAlreadySubmitted",
      rejectMessage:
        "Reject ActionAlreadySubmitted: action already submitted; refresh and use current controls",
      stalePhase: "N01",
      refreshedPhase: "N01",
      actionVisibleAfterRefresh: false,
    },
    "stale-dead-action-conflict": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer",
      visitedRolePath: "/g/midsummer",
      rejectError: "SlotNotAlive",
      rejectMessage:
        "Reject SlotNotAlive: slot not alive; actor is no longer alive, refresh and use current action controls",
      actorStatusAfterReject: "dead",
      actionVisibleAfterRefresh: false,
    },
    "stale-action-conflict": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer",
      visitedRolePath: "/g/midsummer",
      rejectError: "PhaseLocked",
      rejectMessage:
        "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      stalePhase: "N01",
      refreshedPhase: "D02",
      actionVisibleAfterRefresh: false,
    },
    "stale-action-conflict-message": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer",
      visitedRolePath: "/g/midsummer",
      rejectError: "PhaseLocked",
      receiptStatusText:
        "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
    },
    "stale-action-reconnect-recovery": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer",
      visitedRolePath: "/g/midsummer",
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredPhase: "D02",
      recoveredActions: 0,
      recoveredSnapshotContainsPost: true,
    },
    "stale-host-complete-reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredCompleted: true,
      revealedSlots: 1,
      completeActionVisible: false,
    },
    "stale-host-complete-reload": {
      rejectReceipt: "Reject GameAlreadyCompleted: game already completed",
      revealedSlots: 1,
      completeActionVisible: false,
    },
    "concurrent-host-complete-race": {
      rejectError: "GameAlreadyCompleted",
      apiCompleted: true,
      apiRevealedSlots: 1,
    },
    "concurrent-host-complete-race-reload": {
      apiCompleted: true,
      firstRevealedSlots: 1,
      secondRevealedSlots: 1,
    },
    "concurrent-player-complete-race": {
      postError: "GameAlreadyCompleted",
      apiCompleted: true,
      apiThreadHasPost: false,
    },
    "public-player-complete-reload": {
      gameCompleted: true,
      reloadPostCount: 0,
    },
    "stale-player-complete-reload": {
      gameCompleted: true,
      currentVote: "false",
      threadPostCount: 0,
    },
    "stale-host-control": {
      rejectError: "PhaseLocked",
      stalePhase: "N01",
      phaseId: "D02",
      locked: false,
      currentActions: ["lock_thread", "resolve_phase"],
    },
    "concurrent-host-resolve-race": {
      ackState: "ack",
      rejectError: "PhaseLocked",
      lockedAfterRace: true,
      lockedAfterRestore: false,
    },
    "concurrent-host-resolve-race-reload": {
      liveRouteStatus: 200,
      concurrentRouteStatus: 200,
      apiLocked: true,
    },
    "stale-host-resolve": {
      rejectError: "PhaseLocked",
      roleUrl: "http://127.0.0.1:5173/g/midsummer/host",
      stalePhase: "D02",
      phaseId: "D02",
      locked: true,
      restoreLocked: false,
    },
    "stale-host-resolve-reload": {
      routeStatus: 200,
      rejectReceipt:
        "Reject PhaseLocked: phase locked; stale phase state, refresh and use current controls",
      phaseId: "D02",
      locked: true,
      apiLocked: true,
    },
    "stale-host-resolve-reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredPhase: "D02",
      recoveredLocked: true,
      phaseActions: ["unlock_thread", "advance_phase"],
    },
    "stale-host-advance": {
      rejectError: "InvalidTarget",
      roleUrl: "http://127.0.0.1:5173/g/midsummer/host",
      stalePhase: "D02",
      phaseId: "D02",
      locked: false,
      phaseActions: ["resolve_phase", "lock_thread"],
    },
    "stale-host-advance-reload": {
      routeStatus: 200,
      rejectReceipt:
        "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
      phaseId: "D02",
      locked: false,
      phaseActions: ["resolve_phase", "lock_thread"],
      apiLocked: false,
    },
    "stale-host-advance-reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredPhase: "D02",
      recoveredLocked: false,
      phaseActions: ["resolve_phase", "lock_thread"],
    },
    "stale-host-deadline-reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredPhase: "D02",
      recoveredLocked: false,
      deadlineActions: ["extend_deadline"],
      phaseActions: ["resolve_phase", "lock_thread"],
      apiDeadline: null,
    },
    "stale-cohost-deadline-reconnect-recovery": {
      reconnectingState: "reconnecting",
      recoveryState: "recovered",
      recoveredPhase: "D02",
      recoveredLocked: false,
      deadlineActions: ["extend_deadline"],
      phaseActions: [],
      apiDeadline: null,
    },
  };
  const lanes = [
    "browser-entry",
    "cohost-console",
    "core-loop",
    "day-vote-resolution",
    "day-vote-no-lynch",
    "action-loop",
    "host-deadline-advance",
    "stale-deadline-advance",
    "invalid-action-recovery",
    "resolution-receipts",
    "dead-player-recovery",
    "player-action-boundary",
    "private-channel",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-invalid-target-recovery",
    "replacement-console",
    "replacement-idempotent-retry",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
    "idempotent-retry",
    "action-idempotent-retry",
    "concurrent-action-race",
    "concurrent-action-race-reload",
    "reconnect-recovery",
    "stale-player-vote",
    "concurrent-vote-race",
    "concurrent-vote-race-reload",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-vote-resolve-race-reload",
    "concurrent-player-action-advance-race",
    "concurrent-player-action-advance-race-reload",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-cohost-deadline-resolve-race-reload",
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-private-post-race-reload",
    "concurrent-replacement-vote-race",
    "concurrent-replacement-vote-race-reload",
    "concurrent-replacement-action-race",
    "concurrent-replacement-action-race-reload",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "replacement-stale-private-post-after-complete-reload",
    "host-votecount-publication",
    "concurrent-host-publish-race",
    "concurrent-host-publish-race-reload",
    "stale-host-publish",
    "host-lifecycle-control",
    "stale-host-lifecycle",
    "stale-host-lifecycle-reload",
    "host-modkill-control",
    "stale-host-modkill",
    "stale-host-modkill-reload",
    "stale-host-prompt",
    "stale-host-prompt-reload",
    "stale-host-complete",
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete",
    "stale-player-complete-reload",
    "stale-same-action-recovery",
    "stale-dead-action-conflict",
    "stale-action-conflict",
    "stale-action-conflict-message",
    "stale-action-reconnect-recovery",
    "stale-host-control",
    "concurrent-host-resolve-race",
    "concurrent-host-resolve-race-reload",
    "concurrent-host-advance-race",
    "concurrent-host-advance-race-reload",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-deadline-advance-race-reload",
    "concurrent-host-lifecycle-race",
    "concurrent-host-lifecycle-race-reload",
    "concurrent-host-mixed-advance-race",
    "concurrent-host-mixed-advance-race-reload",
    "stale-host-resolve",
    "stale-host-resolve-reload",
    "stale-host-resolve-reconnect-recovery",
    "stale-host-advance",
    "stale-host-advance-reload",
    "stale-host-advance-reconnect-recovery",
    "stale-host-deadline",
    "stale-host-deadline-reload",
    "stale-host-deadline-reconnect-recovery",
    "stale-cohost-deadline",
    "stale-cohost-deadline-reload",
    "stale-cohost-deadline-reconnect-recovery",
  ].map((id) => ({
    id,
    label: id,
    status: "passed",
    evidence: laneEvidence[id] ?? {},
  }));
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
      roles: ["host", "player", "actionPlayer", "deniedPlayer", "cohost", "replacementPlayer"],
    },
    coreLoopSpine: {
      status: "passed",
      sourceLaneIds: [
        "core-loop",
        "action-loop",
        "invalid-action-recovery",
        "resolution-receipts",
      ],
      cycles: [
        {
          id: "d01-n01-d02",
          game: "game-a",
          roleUrls: {
            host: "http://127.0.0.1:5173/g/game-a/host",
            actionPlayer: "http://127.0.0.1:5173/g/game-a",
            normalPlayer: "http://127.0.0.1:5173/g/game-a",
            target: "http://127.0.0.1:5173/g/game-a",
          },
          checkpoints: [
            { id: "d01-resolved-locked", phase: "D01", locked: true },
            { id: "n01-action-open", phase: "N01", actionTemplate: "factional_kill" },
            { id: "n01-resolved-target-killed", receiptStatus: "factional_kill" },
            { id: "d02-day-controls-return", phase: "D02", actionVoteControls: 2 },
          ],
        },
        {
          id: "d02-n02",
          game: "game-b",
          roleUrls: {
            host: "http://127.0.0.1:5173/g/game-b/host",
            actionPlayer: "http://127.0.0.1:5173/g/game-b",
            normalPlayer: "http://127.0.0.1:5173/g/game-b",
            target: "http://127.0.0.1:5173/g/game-b",
          },
          checkpoints: [
            { id: "d02-vote-open", phase: "D02", voteTarget: "slot-2" },
            { id: "d02-deciding-vote-submitted", voteState: "ack", projectedCount: 3 },
            { id: "d02-resolved-target-killed", outcomeStatus: "Lynch" },
            { id: "n02-action-open", phase: "N02", actionTemplate: "factional_kill" },
          ],
        },
      ],
      recoveryHooks: {
        staleLockedVoteReject: "PhaseLocked",
        invalidActionReject: "InvalidTarget",
        normalPlayerDirectActionReject: "InvalidTarget",
        staleActionConflictReject: "PhaseLocked",
      },
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
      roleCount: 7,
    },
    proofRun: {
      laneCount: 99,
    },
    checks: [
      { id: "source-artifacts-checksummed", status: "passed" },
      { id: "role-entrypoints-redacted", status: "passed" },
      { id: "proof-lanes-summarized", status: "passed" },
      { id: "proof-stability-summarized", status: "passed" },
      { id: "release-boundary-carried", status: "passed" },
    ],
  };
}

function localHostedOpsSignalsFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-ops-signals",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-hosted-like-ops-signals",
    proofBoundary: "Local hosted-like ops signal bundle.",
    target: {
      game: "game-a",
      roleSurfaceCount: 7,
      realHostedDeploymentStatus: "unproven",
    },
    matrix: {
      cellCount: 16,
      passedCellCount: 16,
      reloadCoveredCellCount: 16,
      reconnectLaneCount: 10,
      staleConflictLaneCount: 4,
      hostedEvidenceStatus: "not_configured",
    },
    checks: hostedOpsSignalCheckStatusRows(),
  };
}

function localHostedTargetPreflightFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-target-preflight",
    status: "blocked",
    releaseReady: false,
    productionReady: false,
    scope: "hosted-target-preflight",
    proofBoundary: "Hosted target preflight without hosted deployment claims.",
    target: {
      frontendBaseUrl: null,
      apiBaseUrl: null,
      groupId: "replacement-race-reload",
      rawEvidencePath: null,
      rawEvidenceStatus: "blocked",
    },
    checks: [
      { id: "hosted-frontend-url-configured", status: "blocked" },
      { id: "hosted-api-url-configured", status: "blocked" },
      {
        id: "hosted-targets-external",
        status: "blocked",
        requiredEvidence: "Externally reachable hosted URLs.",
      },
      { id: "raw-evidence-path-configured", status: "blocked" },
      { id: "raw-evidence-readable", status: "blocked" },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    nextCommand: "npm run test:dev-test-game-hosted-target-preflight",
    nextProofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
  };
}

function localHostedIdentityEvidenceFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-identity-evidence",
    status: "blocked",
    releaseReady: false,
    productionReady: false,
    scope: "hosted-identity-evidence-handoff",
    proofBoundary: "Hosted identity evidence without hosted identity claims.",
    requiredEvidence:
      "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH to a hosted identity evidence JSON file.",
    target: {
      rawEvidencePath: null,
      rawEvidenceStatus: "blocked",
      placeholderFixturePath: hostedIdentityEvidencePlaceholderFixturePath,
    },
    checks: hostedIdentityEvidenceBlockedChecks.map((check) => ({
      id: check.id,
      status: "blocked",
      requiredEvidence: check.requiredEvidence,
    })),
    hostedHandoffChecklist: {
      status: "blocked",
      preflightStatus: "blocked",
      command: "npm run test:dev-test-game-hosted-identity-evidence",
      proofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
      placeholderFixturePath: hostedIdentityEvidencePlaceholderFixturePath,
      inputIds: [...hostedIdentityEvidenceInputIds],
      blockedCheckIds: hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
      blockedChecks: hostedIdentityEvidenceBlockedChecks.map((check) => ({
        ...check,
        status: "blocked",
      })),
      requirementGroups: hostedIdentityEvidenceRequirementGroups(
        hostedIdentityEvidenceBlockedChecks.map((check) => ({
          ...check,
          status: "blocked",
        })),
      ),
    },
    nextCommand: "npm run test:dev-test-game-hosted-identity-evidence",
    nextProofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  };
}

function localHostedEvidenceLaneFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-evidence-lane",
    status: "blocked",
    releaseReady: false,
    productionReady: false,
    scope: "hosted-evidence-lane",
    proofBoundary: "Hosted evidence lane without hosted deployment claims.",
    preflightStatus: "blocked",
    blockedCheckIds: [
      "hosted-frontend-url-configured",
      "hosted-api-url-configured",
      "hosted-targets-external",
      "raw-evidence-path-configured",
      "raw-evidence-readable",
    ],
    target: {
      frontendBaseUrl: null,
      apiBaseUrl: null,
      groupId: "replacement-race-reload",
      rawEvidencePath: null,
      rawEvidenceStatus: "blocked",
    },
    hostedEvidence: {
      status: "blocked",
      mode: "blocked",
      syntheticExternalTarget: false,
      realHostedEvidenceStatus: "unproven",
      realHostedEvidenceInputs: realHostedEvidenceInputsFixture(),
      requiredEvidence:
        "Passed hosted target preflight and normalized hosted matrix evidence.",
    },
    checks: [
      { id: "hosted-target-preflight", status: "blocked" },
      { id: "hosted-frontend-url-configured", status: "blocked" },
      { id: "hosted-api-url-configured", status: "blocked" },
      {
        id: "hosted-targets-external",
        status: "blocked",
        requiredEvidence: "Externally reachable hosted URLs.",
      },
      { id: "raw-evidence-path-configured", status: "blocked" },
      { id: "raw-evidence-readable", status: "blocked" },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    generatedFrom: {
      hostedTargetPreflight: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
    },
    nextCommand: "npm run test:dev-test-game-hosted-evidence-lane",
    nextProofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
  };
}

function localHostedEvidenceLaneDemoProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-hosted-evidence-lane-demo-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-hosted-evidence-lane-demo-proof",
    target: {
      frontendBaseUrl: "https://fmarch-demo.example.test",
      apiBaseUrl: "https://api.fmarch-demo.example.test",
      groupId: "replacement-race-reload",
      syntheticExternalTarget: true,
    },
    generatedFrom: {
      externalEvidence: "target/dev-test-game/hosted-matrix-demo-external.json",
    },
    handoff: {
      blockedRoleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      passedRoleUrl:
        "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
    },
    blockedLane: {
      status: "blocked",
      preflightStatus: "blocked",
      blockedCheckIds: ["hosted-frontend-url-configured"],
    },
    passedLane: {
      status: "passed",
      preflightStatus: "passed",
      blockedCheckIds: [],
    },
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
      roleCount: 7,
      slots: [
        { slotId: "slot-1" },
        { slotId: "slot-2" },
        { slotId: "slot-3" },
        { slotId: "slot-4" },
        { slotId: "slot-5" },
      ],
    },
    demoScenarios: seedDemoScenarioFixtureRows(),
    proofLaneCoverage: {
      status: "passed",
      passedLaneCount: 115,
      directSeeded: {
        count: 107,
        laneIds: seedScenarioCoverageGroups.allDemo.slice(0, 107),
      },
      aliasOnly: {
        count: seedAliasOnlyProofLaneIds.length,
        laneIds: seedAliasOnlyProofLaneIds,
      },
      aggregateOnly: {
        count: seedAggregateOnlyProofLaneIds.length,
        laneIds: seedAggregateOnlyProofLaneIds,
      },
      unclassified: {
        count: 0,
        laneIds: [],
      },
    },
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
      proofFreshness: {
        script: "test:dev-test-game-proof-freshness-admin-proof",
        proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      },
      hostedConcurrentRaceMatrix: {
        script: "test:dev-test-game-hosted-concurrent-race-matrix",
        proofArtifact: "target/dev-test-game/hosted-concurrent-race-matrix.json",
      },
      hostedTargetPreflight: {
        script: "test:dev-test-game-hosted-target-preflight",
        proofArtifact: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
        roleUrl: "/admin/audit/local-hosted-target-preflight?game=<seeded-game>",
      },
      hostedEvidenceLane: {
        script: "test:dev-test-game-hosted-evidence-lane",
        proofArtifact: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      hostedEvidenceLaneDemoProof: {
        script: "test:dev-test-game-hosted-evidence-lane-demo-proof",
        proofArtifact:
          "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
        demoOnly: true,
        roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
      },
      nextAction: {
        script: "test:dev-test-game-next-action",
        proofArtifact: "target/dev-test-game/next-action.json",
      },
      nextActionAdminProof: {
        script: "test:dev-test-game-next-action-admin-proof",
        proofArtifact: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      },
      proofGraph: {
        script: "test:dev-test-game-proof-graph",
        proofArtifact: "target/dev-test-game/proof-graph.json",
      },
      proofGraphAdminProof: {
        script: "test:dev-test-game-proof-graph-admin-proof",
        proofArtifact: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      },
    },
    terminalArtifacts: [
      {
        id: "next-action",
        command: "test:dev-test-game-next-action",
        path: "target/dev-test-game/next-action.json",
      },
      {
        id: "next-action-admin-proof",
        command: "test:dev-test-game-next-action-admin-proof",
        path: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
      },
      {
        id: "proof-graph",
        command: "test:dev-test-game-proof-graph",
        path: "target/dev-test-game/proof-graph.json",
      },
      {
        id: "proof-graph-admin-proof",
        command: "test:dev-test-game-proof-graph-admin-proof",
        path: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
      },
    ],
    artifactFreshness: {
      status: "blocked",
      proof: "dev-test-game-proof-freshness",
      generatedAt: "2026-06-26T00:00:00.000Z",
      maxAgeHours: 24,
      summary: {
        artifactCount: 2,
        freshCount: 1,
        staleCount: 1,
        missingCount: 0,
      },
      proofCommand: "test:dev-test-game-proof-freshness-admin-proof",
      proofArtifact: "target/dev-test-game/proof-freshness-admin-proof.json",
      nextCommand:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      proofBoundary: "Local proof freshness dashboard.",
      artifacts: [
        {
          id: "proof-run",
          label: "Dev test-game proof run",
          path: "target/dev-test-game/proof-run.json",
          status: "stale",
          refreshCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
          nextCommand:
            "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
        },
        {
          id: "spine-manifest",
          label: "Spine manifest",
          path: "target/dev-test-game/spine-manifest.json",
          status: "fresh",
          refreshCommand: "npm run test:dev-test-game-spine-manifest",
        },
      ],
    },
    artifacts: [
      "target/dev-test-game/spine-manifest.json",
      "target/dev-test-game/spine-manifest.md",
      "target/dev-test-game/spine-manifest-admin-proof.json",
      "target/dev-test-game/proof-freshness-admin-proof.json",
      "target/dev-test-game/hosted-concurrent-race-matrix.json",
      HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      HOSTED_EVIDENCE_LANE_PROOF_TARGET,
      "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      "target/dev-test-game/hosted-matrix-demo-raw.json",
      "target/dev-test-game/hosted-matrix-demo-external.json",
      "target/dev-test-game/hosted-evidence-lane-demo-blocked.json",
      "target/dev-test-game/hosted-evidence-lane-demo-passed.json",
      "target/dev-test-game/next-action.json",
      "target/dev-test-game/next-action-admin-proof.json",
      "target/dev-test-game/proof-graph.json",
      "target/dev-test-game/proof-graph-admin-proof.json",
    ],
    checks: [
      { id: "live-spine-order-recorded", status: "passed" },
      { id: "sub-spine-orders-recorded", status: "passed" },
      { id: "evidence-env-wiring-recorded", status: "passed" },
      { id: "freshness-proof-recorded", status: "passed" },
      { id: "artifact-refresh-status-recorded", status: "passed" },
      { id: "hosted-concurrent-race-matrix-recorded", status: "passed" },
      { id: "hosted-target-preflight-recorded", status: "passed" },
      { id: "hosted-evidence-lane-recorded", status: "passed" },
      { id: "hosted-evidence-lane-demo-proof-recorded", status: "passed" },
      { id: "terminal-artifacts-recorded", status: "passed" },
      {
        id: "release-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function proofFreshnessFixture({
  status = "passed",
  artifacts = [
    freshnessArtifact("session", "fresh"),
    freshnessArtifact("proof-run", "fresh"),
    freshnessArtifact("backup-restore", "fresh"),
    freshnessArtifact("ops-artifacts", "fresh"),
    freshnessArtifact("seed-fixture", "fresh"),
    freshnessArtifact("release-readiness", "fresh"),
    freshnessArtifact("identity-adapter", "fresh"),
    freshnessArtifact("spine-manifest", "fresh"),
    freshnessArtifact("core-loop", "fresh"),
    freshnessArtifact("hardening", "fresh"),
    freshnessArtifact("identity", "fresh"),
    freshnessArtifact("backup", "fresh"),
    freshnessArtifact("ops", "fresh"),
    freshnessArtifact("seed", "fresh"),
    freshnessArtifact("release", "fresh"),
    freshnessArtifact("spine-manifest-admin", "fresh"),
    freshnessArtifact("admin-spine", "fresh"),
    freshnessArtifact("admin-spine-admin", "fresh"),
    freshnessArtifact("proof-graph", "fresh"),
    freshnessArtifact("proof-graph-admin", "fresh"),
    freshnessArtifact("hosted-evidence-lane", "fresh"),
    freshnessArtifact("hosted-evidence-lane-admin", "fresh"),
    freshnessArtifact("hosted-evidence-lane-demo", "fresh"),
  ],
} = {}) {
  const summary = {
    artifactCount: artifacts.length,
    freshCount: artifacts.filter((artifact) => artifact.status === "fresh").length,
    staleCount: artifacts.filter((artifact) => artifact.status === "stale").length,
    missingCount: artifacts.filter((artifact) => artifact.status === "missing").length,
  };
  return {
    version: 1,
    proof: "dev-test-game-proof-freshness",
    status,
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-proof-freshness",
    proofBoundary: "Local proof freshness dashboard.",
    maxAgeHours: 24,
    maxAgeSeconds: 86400,
    summary,
    artifacts,
  };
}

function freshnessArtifact(id, status) {
  return {
    id,
    label: id,
    path: `target/dev-test-game/${id}.json`,
    status,
    maxAgeSeconds: 86400,
    ...(status === "missing"
      ? {}
      : {
          mtime: "2026-06-26T00:00:00.000Z",
          ageSeconds: status === "fresh" ? 120 : 172800,
          sizeBytes: 42,
        }),
  };
}

function nextActionFixture({
  actionStatus = "ready",
  reason = "release-readiness-unproven",
  command = LOCAL_RACE_COMMAND,
  artifact,
  localCheck,
  unproven =
    artifact === undefined &&
    localCheck === undefined &&
    reason === "release-readiness-unproven"
      ? {
          id: "hosted-concurrent-race-matrix",
          status: "unproven",
          requiredEvidence:
            "Hosted or hosted-like concurrent command race matrix beyond the promoted local replacement, host, player, cohost deadline, lifecycle, and complete-game reload milestones, including multi-session reload/reconnect recovery and stale-client conflict evidence",
          buildSlice:
            "Create the first hosted-like concurrent race matrix proof request from the promoted local race baseline.",
          proofTarget: HOSTED_MATRIX_PROOF_TARGET,
          roleUrl:
            "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
          proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
          productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
          spineDrilldown: featureSpineDrilldownFixture(),
          spineTarget: {
            sourceCheckId: "local-core-loop-proof",
            featureSlotId: "player-action-submission",
            detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
            cycleId: "d02-n02",
            roleUrlId: "d02-n02-actionPlayer",
            roleUrl: ACTIONABLE_SPINE_ROLE_URL,
            checkpointId: "d02-n02-n02-action-open",
            adminCheckId: "action-loop",
            browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
          },
        }
      : undefined,
  selectionTrace = selectionTraceFixture({ artifact, command }),
  releaseReadinessTrace = releaseReadinessTraceFixture({ unproven, command }),
  localReadinessDependencyTrace = localReadinessDependencyTraceFixture(),
  stability,
  stabilityTrace = stabilityTraceFixture({ stability }),
  seedProofLaneCoverage,
  seedProofLaneCoverageTrace = seedProofLaneCoverageTraceFixture({
    seedProofLaneCoverage,
  }),
  replacementRaceReloadTrace = replacementRaceReloadTraceFixture(),
  hostConcurrentRaceReloadTrace = hostConcurrentRaceReloadTraceFixture(),
  playerConcurrentActionReloadTrace = playerConcurrentActionReloadTraceFixture(),
  cohostDeadlineRaceReloadTrace = cohostDeadlineRaceReloadTraceFixture(),
  raceCoveragePromotedMilestones = raceCoveragePromotedMilestonesFixture(),
  staleConflictMessageTrace = staleConflictMessageTraceFixture(),
  hostStaleControlTrace = hostStaleControlTraceFixture(),
} = {}) {
  return {
    version: 1,
    proof: "dev-test-game-next-action",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-next-action",
    proofBoundary: "Local next-action receipt.",
    generatedFrom: {
      spineManifest: "target/dev-test-game/spine-manifest.json",
      manifestGeneratedAt: "2026-06-26T00:00:00.000Z",
      artifactFreshnessStatus: "passed",
      artifactFreshnessSummary: {
        artifactCount: 23,
        freshCount: 23,
        staleCount: 0,
        missingCount: 0,
      },
      releaseReadinessChecklist: "target/dev-test-game/release-readiness-checklist.json",
      releaseReadinessGeneratedAt: "2026-06-26T00:00:00.000Z",
      releaseReadinessSummary: {
        status: "not_ready",
        localCheckCount: 18,
        buildableLocalDependencyCount:
          localReadinessDependencyTrace.candidateCount ?? 0,
        unprovenCount: 7,
        buildableUnprovenCount: unproven === undefined ? 0 : 1,
      },
      raceCoverage: "target/dev-test-game/race-coverage.json",
      replacementRaceReloadSummary: {
        status: replacementRaceReloadTrace.status,
        requiredCellCount: replacementRaceReloadTrace.requiredCellCount,
        coveredCellCount: replacementRaceReloadTrace.coveredCellCount,
        gapCount: replacementRaceReloadTrace.gapCount,
      },
      hostConcurrentRaceReloadSummary: {
        status: hostConcurrentRaceReloadTrace.status,
        requiredCellCount: hostConcurrentRaceReloadTrace.requiredCellCount,
        coveredCellCount: hostConcurrentRaceReloadTrace.coveredCellCount,
        gapCount: hostConcurrentRaceReloadTrace.gapCount,
      },
      playerConcurrentActionReloadSummary: {
        status: playerConcurrentActionReloadTrace.status,
        requiredCellCount: playerConcurrentActionReloadTrace.requiredCellCount,
        coveredCellCount: playerConcurrentActionReloadTrace.coveredCellCount,
        gapCount: playerConcurrentActionReloadTrace.gapCount,
      },
      cohostDeadlineRaceReloadSummary: {
        status: cohostDeadlineRaceReloadTrace.status,
        requiredCellCount: cohostDeadlineRaceReloadTrace.requiredCellCount,
        coveredCellCount: cohostDeadlineRaceReloadTrace.coveredCellCount,
        gapCount: cohostDeadlineRaceReloadTrace.gapCount,
      },
      raceCoveragePromotedMilestones,
      opsArtifacts: "target/dev-test-game/ops-artifacts.json",
      proofStabilityStatus: stability === undefined ? "clean" : "drifted",
      proofStabilitySummary: {
        hostConfirmClicks: Number(stability?.hostConfirmClicks ?? 55),
        retryClickCount: Number(stability?.retryClickCount ?? 0),
        domFallbackCount: Number(stability?.domFallbackCount ?? 0),
        forceFallbackCount: Number(stability?.forceFallbackCount ?? 0),
        failureCount: Number(stability?.failureCount ?? 0),
      },
      seedProofLaneCoverageStatus: seedProofLaneCoverageTrace.status,
      seedProofLaneCoverageUnclassifiedCount:
        seedProofLaneCoverageTrace.unclassifiedLaneCount,
    },
    nextAction: {
      command,
      reason,
      status: actionStatus,
      ...(artifact === undefined ? {} : { artifact }),
      ...(localCheck === undefined ? {} : { localCheck }),
      ...(unproven === undefined ? {} : { unproven }),
      ...(stability === undefined ? {} : { stability }),
      ...(seedProofLaneCoverage === undefined
        ? {}
        : { seedProofLaneCoverage }),
    },
    selectionTrace,
    stabilityTrace,
    seedProofLaneCoverageTrace,
    localReadinessDependencyTrace,
    releaseReadinessTrace,
    replacementRaceReloadTrace,
    hostConcurrentRaceReloadTrace,
    playerConcurrentActionReloadTrace,
    cohostDeadlineRaceReloadTrace,
    raceCoveragePromotedMilestones,
    staleConflictMessageTrace,
    hostStaleControlTrace,
  };
}

function proofGraphHandoffLocalCheckFixture() {
  return {
    id: "local-proof-graph-admin-role-handoffs",
    status: "missing",
    requiredEvidence:
      "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
    buildSlice:
      "Refresh the proof graph admin role-handoff browser proof before choosing hosted readiness work.",
    proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
    roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
    proofBoundary:
      "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL.",
  };
}

function seedProofLaneCoverageActionFixture({ unclassifiedLaneIds }) {
  return {
    source: "target/dev-test-game/release-readiness-checklist.json",
    status: "drifted",
    passedLaneCount: 115 + unclassifiedLaneIds.length,
    unclassifiedLaneCount: unclassifiedLaneIds.length,
    unclassifiedLaneIds,
    buildSlice:
      "Classify every passed proof lane as direct seeded, alias-covered, or aggregate-only before expanding the production-facing seeded proof spine.",
    proofTarget: "target/dev-test-game/seed-fixture-summary.json",
    roleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
  };
}

function proofGraphFixture() {
  return {
    version: 1,
    proof: "dev-test-game-proof-graph",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-proof-graph",
    proofBoundary: "Generated local proof graph.",
    generatedFrom: {
      spineManifest: "target/dev-test-game/spine-manifest.json",
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
    },
    summary: {
      nodeCount: 6,
      edgeCount: 6,
      roleUrlCount: 6,
      recoveryTargetCount: 6,
    },
    nodes: [
      proofGraphNode({
        id: "admin-spine",
        label: "Local admin spine",
        status: "passed",
        artifact: "target/dev-test-game/admin-spine-proof.json",
        roleUrl: "/admin/audit/local-admin-spine?game=<seeded-game>",
        recoveryCommand: "npm run test:dev-test-game-admin-spine",
      }),
      proofGraphNode({
        id: "spine-manifest",
        label: "Local spine manifest",
        status: "passed",
        artifact: "target/dev-test-game/spine-manifest.json",
        roleUrl: "/admin/audit/local-spine-manifest?game=<seeded-game>",
        recoveryCommand: "npm run test:dev-test-game-spine-manifest-admin-proof",
      }),
      proofGraphNode({
        id: "proof-freshness",
        label: "Local proof freshness",
        status: "passed",
        artifact: "target/dev-test-game/proof-freshness-admin-proof.json",
        roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
        recoveryCommand: "test:dev-test-game-proof-freshness-admin-proof",
      }),
      proofGraphNode({
        id: "next-action",
        label: "Local next action",
        status: "recorded",
        artifact: "target/dev-test-game/next-action.json",
        roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
        recoveryCommand: "test:dev-test-game-next-action",
      }),
      proofGraphNode({
        id: "admin-proof:seed",
        label: "Seed fixture admin proof",
        status: "passed",
        artifact: "target/dev-test-game/seed-admin-proof.json",
        roleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
        recoveryCommand: "npm run test:dev-test-game-seed-fixture",
      }),
      proofGraphNode({
        id: "admin-proof:hosted-concurrent-race-matrix",
        label: "Hosted concurrent race matrix admin proof",
        status: "passed",
        artifact:
          "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
        roleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
        recoveryCommand:
          "npm run test:dev-test-game-hosted-concurrent-race-matrix-admin-proof",
      }),
    ],
    edges: [
      { from: "admin-spine", to: "spine-manifest", relationship: "aggregates" },
      { from: "spine-manifest", to: "proof-freshness", relationship: "records" },
      { from: "spine-manifest", to: "next-action", relationship: "records" },
      { from: "proof-freshness", to: "next-action", relationship: "recovers-through" },
      {
        from: "next-action",
        to: "admin-proof:seed",
        relationship: "recovery-target",
        reason: "seed-proof-lane-coverage-drift",
        command: "npm run test:dev-test-game-seed-fixture",
        roleUrl: "/admin/audit/local-seed-fixtures?game=<seeded-game>",
        proofTarget: "target/dev-test-game/seed-fixture-summary.json",
      },
      {
        from: "admin-spine",
        to: "admin-proof:hosted-concurrent-race-matrix",
        relationship: "aggregates",
      },
    ],
  };
}

function raceCoverageFixture() {
  return {
    version: 1,
    proof: "dev-test-game-race-coverage",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-race-coverage",
    proofBoundary: "Generated local race coverage.",
    generatedFrom: {
      proofRun: "target/dev-test-game/proof-run.json",
      game: "00000000-0000-0000-0000-000000000001",
      laneCount: 107,
    },
    summary: {
      cellCount: 3,
      provenCellCount: 3,
      unprovenCellCount: 0,
      reloadRequiredCellCount: 3,
      reloadCoveredCellCount: 3,
      reloadGapCount: 0,
      actorPairs: ["host vs host", "player vs player"],
      commandFamilies: ["day vote", "phase resolution", "complete game"],
    },
    cells: [
      raceCoverageCell({
        id: "player-vote-change",
        actorPair: "player vs player",
        commandFamily: "day vote",
        raceLaneId: "concurrent-vote-race",
        reloadLaneId: "concurrent-vote-race-reload",
      }),
      raceCoverageCell({
        id: "host-resolve",
        actorPair: "host vs host",
        commandFamily: "phase resolution",
        raceLaneId: "concurrent-host-resolve-race",
        reloadLaneId: "concurrent-host-resolve-race-reload",
      }),
      raceCoverageCell({
        id: "host-complete-game",
        actorPair: "host vs host",
        commandFamily: "complete game",
        raceLaneId: "concurrent-host-complete-race",
        reloadLaneId: "concurrent-host-complete-race-reload",
      }),
    ],
    unprovenCells: [],
    reloadGaps: [],
  };
}

function raceCoverageCell({
  id,
  actorPair,
  commandFamily,
  raceLaneId,
  reloadLaneId,
}) {
  return {
    id,
    actorPair,
    commandFamily,
    raceLaneId,
    reloadLaneId,
    roleSurfaces: ["host"],
    status: "passed",
    raceStatus: "passed",
    reloadStatus: "passed",
    reloadCoverage: "passed",
    missingLaneIds: [],
    provenBy: [raceLaneId, reloadLaneId],
  };
}

function laneFixture(id, label) {
  return {
    id,
    label,
    status: "passed",
    evidence: {},
  };
}

function hostedConcurrentRaceMatrixFixture() {
  const cells = raceCoverageFixture().cells.map((cell) => ({
    id: cell.id,
    actorPair: cell.actorPair,
    commandFamily: cell.commandFamily,
    roleSurfaces: cell.roleSurfaces,
    status: "passed",
    raceLane: {
      id: cell.raceLaneId,
      label: `${cell.id} race`,
      status: "passed",
      evidence: {},
    },
    reloadLane: {
      id: cell.reloadLaneId,
      label: `${cell.id} reload`,
      status: "passed",
      evidence: {},
    },
  }));
  return {
    version: 1,
    proof: "dev-test-game-hosted-concurrent-race-matrix",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-hosted-like-concurrent-race-matrix",
    proofBoundary: "Local hosted-like concurrency matrix.",
    generatedFrom: {
      releaseReadinessChecklist:
        "target/dev-test-game/release-readiness-checklist.json",
      proofRun: "target/dev-test-game/proof-run.json",
      session: "target/dev-test-game/session.json",
      raceCoverage: "target/dev-test-game/race-coverage.json",
      raceCoveragePromotedMilestones: {
        status: "passed",
        cellCount: 3,
        provenCellCount: 3,
        reloadCoveredCellCount: 3,
        groupCount: 2,
        passedGroupCount: 2,
        requiredCellCount: 3,
        coveredCellCount: 3,
        gapCount: 0,
        groupIds: ["player-vote", "host-control"],
      },
    },
    hostedLikeTarget: {
      kind: "local-rust-api-plus-sveltekit-browser",
      status: "passed",
      game: "00000000-0000-0000-0000-000000000001",
      seedMode: "dev-test-game",
      frontendBaseUrl: "http://127.0.0.1:4173",
      apiBaseUrl: "http://127.0.0.1:3000",
      roleSurfaces: [
        {
          role: "host",
          principalUserId: "host_h",
          expectedCapabilityKind: "HostOf",
          directUrl: "/g/midsummer/host",
          returnTo: "/g/midsummer/host",
        },
        {
          role: "player",
          principalUserId: "player_p",
          expectedCapabilityKind: "PlayerSlot",
          directUrl: "/g/midsummer/player",
          returnTo: "/g/midsummer/player",
        },
      ],
      proofBoundary: "Local role surfaces.",
    },
    summary: {
      cellCount: 3,
      passedCellCount: 3,
      raceLaneCount: 3,
      reloadLaneCount: 3,
      reloadCoveredCellCount: 3,
      reconnectLaneCount: 10,
      staleConflictLaneCount: 4,
      roleSurfaceCount: 2,
      hostedEvidenceStatus: "not_configured",
      hostedEvidenceMode: "not_configured",
      localDemoHostedEvidenceStatus: "not_applicable",
      realHostedEvidenceStatus: "unproven",
      realHostedDeploymentStatus: "unproven",
    },
    evidenceProgress: [
      { id: "hosted-like-api-frontend-target", status: "passed" },
      { id: "multi-session-concurrent-command-matrix", status: "passed" },
      { id: "reload-recovery-after-races", status: "passed" },
      { id: "reconnect-recovery", status: "passed" },
      { id: "stale-client-conflict-messages", status: "passed" },
      { id: "raw-role-credential-redaction", status: "passed" },
      { id: "local-demo-hosted-evidence", status: "not_applicable" },
      { id: "real-hosted-evidence-required", status: "unproven" },
      { id: "real-hosted-deployment", status: "unproven" },
    ],
    realHostedEvidenceInputs: realHostedEvidenceInputsFixture(),
    externalHostedEvidence: {
      status: "not_configured",
      frontendBaseUrl: null,
      apiBaseUrl: null,
      evidencePath: null,
    },
    cells,
    reconnectLanes: [
      laneFixture("reconnect-recovery", "Reconnect recovery"),
      laneFixture("replacement-reconnect-recovery", "Replacement reconnect recovery"),
      laneFixture("replacement-action-reconnect", "Replacement action reconnect"),
      laneFixture(
        "replacement-stale-private-post-reconnect",
        "Replacement stale private post reconnect",
      ),
      laneFixture("stale-action-reconnect-recovery", "Stale action reconnect recovery"),
      laneFixture(
        "stale-host-complete-reconnect-recovery",
        "Stale host complete reconnect recovery",
      ),
      laneFixture(
        "stale-host-resolve-reconnect-recovery",
        "Stale host resolve reconnect recovery",
      ),
      laneFixture(
        "stale-host-advance-reconnect-recovery",
        "Stale host advance reconnect recovery",
      ),
      laneFixture(
        "stale-host-deadline-reconnect-recovery",
        "Stale host deadline reconnect recovery",
      ),
      laneFixture(
        "stale-cohost-deadline-reconnect-recovery",
        "Stale cohost deadline reconnect recovery",
      ),
    ],
    staleConflictLanes: [
      laneFixture(
        "replacement-stale-conflict-message",
        "Replacement stale conflict message",
      ),
      laneFixture("stale-action-conflict-message", "Stale action conflict message"),
      laneFixture("stale-dead-action-conflict", "Stale dead action conflict"),
      laneFixture("stale-host-control", "Stale host control"),
    ],
    requestedEvidence: {
      id: "hosted-concurrent-race-matrix",
      status: "unproven",
      requiredEvidence:
        "Hosted or hosted-like concurrent command race matrix beyond promoted local milestones.",
      firstProofTarget: HOSTED_MATRIX_PROOF_TARGET,
      localBaseline: {
        cellCount: 3,
        reloadCoveredCellCount: 3,
        groupCount: 2,
        passedGroupCount: 2,
      },
    },
    remainingGaps: [
      "hosted API/frontend deployment proof with external health checks",
      "beta/release/operator readiness and human rollback path",
    ],
    nextBuildSlice: {
      command: "test:dev-test-game-hosted-concurrent-race-matrix",
      buildSlice:
        "Promote the local hosted-like matrix to a real hosted or multi-node matrix run.",
      proofTarget: HOSTED_MATRIX_PROOF_TARGET,
    },
  };
}

function realHostedEvidenceInputsFixture() {
  return hostedEvidenceRealHostedInputsFixture();
}

function proofGraphNode({
  id,
  label,
  status,
  artifact,
  roleUrl,
  recoveryCommand,
}) {
  return {
    id,
    label,
    kind: "proof-surface",
    status,
    artifact,
    roleUrl,
    recoveryCommand,
  };
}

function selectionTraceFixture({ artifact, command }) {
  if (artifact === undefined) {
    return {
      strategy: "development-spine-priority",
      candidateCount: 0,
      selectedArtifactId: null,
      candidates: [],
    };
  }
  return {
    strategy: "development-spine-priority",
    candidateCount: 1,
    selectedArtifactId: artifact.id,
    candidates: [
      {
        rank: 1,
        id: artifact.id,
        label: artifact.label,
        path: artifact.path,
        status: artifact.status,
        priority: 2,
        selected: true,
        refreshCommand: command,
        refreshSource: artifact.refreshSource,
      },
    ],
  };
}

function releaseReadinessTraceFixture({ unproven, command }) {
  if (unproven === undefined) {
    return {
      strategy: "local-dev-release-readiness-priority",
      candidateCount: 0,
      selectedUnprovenId: null,
      candidates: [],
    };
  }
  return {
    strategy: "local-dev-release-readiness-priority",
    candidateCount: 1,
    selectedUnprovenId: unproven.id,
    candidates: [
      {
        rank: 1,
        id: unproven.id,
        status: unproven.status,
        priority: 0,
        selected: true,
        command,
        buildSlice: unproven.buildSlice,
        proofTarget: unproven.proofTarget,
        roleUrl: unproven.roleUrl,
        proofGraphNodeId: unproven.proofGraphNodeId,
        actionStatus: unproven.actionStatus ?? "ready",
        productionFeatureSpineTarget: unproven.productionFeatureSpineTarget,
        spineDrilldown: unproven.spineDrilldown,
        spineTarget: unproven.spineTarget,
        ...(unproven.hostedHandoffChecklist === undefined
          ? {}
          : { hostedHandoffChecklist: unproven.hostedHandoffChecklist }),
      },
    ],
  };
}

function hostedEvidenceLaneUnprovenFixture() {
  return {
    id: "hosted-deployment",
    status: "unproven",
    requiredEvidence:
      "Externally reachable hosted API/frontend deployment and raw hosted evidence.",
    buildSlice:
      "Run the one-command hosted evidence lane; it records a blocked preflight report until externally reachable hosted URLs and raw evidence are configured.",
    proofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
    roleUrl: "/admin/audit/local-hosted-evidence-lane?game=<seeded-game>",
    proofGraphNodeId: "admin-proof:hosted-evidence-lane",
    productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
    spineDrilldown: featureSpineDrilldownFixture(),
    spineTarget: {
      sourceCheckId: "local-core-loop-proof",
      featureSlotId: "player-action-submission",
      detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
      cycleId: "d02-n02",
      roleUrlId: "d02-n02-actionPlayer",
      roleUrl: ACTIONABLE_SPINE_ROLE_URL,
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: "action-loop",
      browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
    },
    realHostedEvidenceInputs: realHostedEvidenceInputsFixture(),
    hostedHandoffChecklist: hostedHandoffChecklistFixture(),
  };
}

function hostedHandoffChecklistFixture() {
  return hostedEvidenceBlockedHandoffChecklistFixture({
    proofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
  });
}

function productionFeatureSpineTargetFixture() {
  return {
    featureSlotId: "player-action-submission",
    sourceCheckId: "local-core-loop-proof",
    cycleId: "d02-n02",
    roleUrlId: "d02-n02-actionPlayer",
    checkpointId: "d02-n02-n02-action-open",
    adminCheckId: "action-loop",
  };
}

function featureSpineDrilldownFixture() {
  return {
    featureSlotId: "player-action-submission",
    sourceCheckId: "local-core-loop-proof",
    detailRoleUrl: "/admin/audit/local-core-loop?game=<seeded-game>",
    cycleRowId: "d02-n02",
    roleUrlRowId: "d02-n02-actionPlayer",
    checkpointRowId: "d02-n02-n02-action-open",
    adminCheckId: "action-loop",
    roleUrl: ACTIONABLE_SPINE_ROLE_URL,
    rerunCommand: "npm run test:dev-test-game-core-loop-admin-proof",
    browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
  };
}

function localReadinessDependencyTraceFixture({ localCheck, command } = {}) {
  if (localCheck === undefined) {
    return {
      strategy: "local-readiness-dependency-before-hosted-work",
      candidateCount: 0,
      selectedCheckId: null,
      candidates: [],
    };
  }
  return {
    strategy: "local-readiness-dependency-before-hosted-work",
    candidateCount: 1,
    selectedCheckId: localCheck.id,
    candidates: [
      {
        rank: 1,
        id: localCheck.id,
        status: localCheck.status,
        priority: 0,
        selected: true,
        command,
        buildSlice: localCheck.buildSlice,
        proofTarget: localCheck.proofTarget,
        roleUrl: localCheck.roleUrl,
        proofBoundary: localCheck.proofBoundary ?? "",
        requiredEvidence: localCheck.requiredEvidence,
      },
    ],
  };
}

function stabilityTraceFixture({ stability }) {
  return {
    strategy: "proof-stability-before-readiness",
    status: stability === undefined ? "clean" : "drifted",
    hostConfirmClicks: Number(stability?.hostConfirmClicks ?? 55),
    retryClickCount: Number(stability?.retryClickCount ?? 0),
    domFallbackCount: Number(stability?.domFallbackCount ?? 0),
    forceFallbackCount: Number(stability?.forceFallbackCount ?? 0),
    failureCount: Number(stability?.failureCount ?? 0),
    maxAttempts: Number(stability?.maxAttempts ?? 1),
    eventCount: Number(stability?.eventCount ?? 0),
    selected: stability !== undefined,
  };
}

function seedProofLaneCoverageTraceFixture({ seedProofLaneCoverage } = {}) {
  const unclassifiedLaneIds =
    seedProofLaneCoverage?.unclassifiedLaneIds?.map((laneId) => String(laneId)) ??
    [];
  return {
    strategy: "seed-proof-lane-coverage-before-readiness",
    status: seedProofLaneCoverage === undefined ? "clean" : "drifted",
    source: "target/dev-test-game/release-readiness-checklist.json",
    checkId: "local-seed-demo-fixture",
    selected: seedProofLaneCoverage !== undefined,
    passedLaneCount: Number(seedProofLaneCoverage?.passedLaneCount ?? 115),
    directSeededLaneCount: 107,
    aliasOnlyLaneCount: seedAliasOnlyProofLaneIds.length,
    aggregateOnlyLaneCount: seedAggregateOnlyProofLaneIds.length,
    unclassifiedLaneCount: unclassifiedLaneIds.length,
    unclassifiedLaneIds,
  };
}

function replacementRaceReloadTraceFixture() {
  return {
    strategy: "replacement-race-reload-before-readiness",
    status: "covered",
    source: "target/dev-test-game/race-coverage.json",
    requiredCellCount: 3,
    coveredCellCount: 3,
    gapCount: 0,
    cells: [
      {
        id: "replacement-private-post",
        raceLaneId: "concurrent-replacement-private-post-race",
        reloadLaneId: "concurrent-replacement-private-post-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-vote",
        raceLaneId: "concurrent-replacement-vote-race",
        reloadLaneId: "concurrent-replacement-vote-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
      {
        id: "replacement-action",
        raceLaneId: "concurrent-replacement-action-race",
        reloadLaneId: "concurrent-replacement-action-race-reload",
        reloadStatus: "passed",
        covered: true,
      },
    ],
  };
}

function hostConcurrentRaceReloadTraceFixture() {
  return {
    strategy: "host-concurrent-race-reload-before-readiness",
    status: "covered",
    source: "target/dev-test-game/race-coverage.json",
    requiredCellCount: 7,
    coveredCellCount: 7,
    gapCount: 0,
    cells: hostConcurrentRaceReloadCellsFixture(),
  };
}

function hostConcurrentRaceReloadCheckRows() {
  return [
    ["host-concurrent-race-reload-milestone", "7/7 covered"],
    ...hostConcurrentRaceReloadCellsFixture().map((cell) => [
      `host-concurrent-race-reload-${cell.id}`,
      `covered:${cell.reloadStatus}`,
    ]),
  ];
}

function hostConcurrentRaceReloadCellsFixture() {
  return [
    {
      id: "host-resolve",
      raceLaneId: "concurrent-host-resolve-race",
      reloadLaneId: "concurrent-host-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-advance",
      raceLaneId: "concurrent-host-advance-race",
      reloadLaneId: "concurrent-host-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-deadline-advance",
      raceLaneId: "concurrent-host-deadline-advance-race",
      reloadLaneId: "concurrent-host-deadline-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-lifecycle",
      raceLaneId: "concurrent-host-lifecycle-race",
      reloadLaneId: "concurrent-host-lifecycle-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-mixed-advance",
      raceLaneId: "concurrent-host-mixed-advance-race",
      reloadLaneId: "concurrent-host-mixed-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-votecount-publication",
      raceLaneId: "concurrent-host-publish-race",
      reloadLaneId: "concurrent-host-publish-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "host-complete-game",
      raceLaneId: "concurrent-host-complete-race",
      reloadLaneId: "concurrent-host-complete-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function playerConcurrentActionReloadTraceFixture() {
  return {
    strategy: "player-concurrent-action-reload-before-readiness",
    status: "covered",
    source: "target/dev-test-game/race-coverage.json",
    requiredCellCount: 5,
    coveredCellCount: 5,
    gapCount: 0,
    cells: playerConcurrentActionReloadCellsFixture(),
  };
}

function playerConcurrentActionReloadCheckRows() {
  return [
    ["player-concurrent-action-reload-milestone", "5/5 covered"],
    ...playerConcurrentActionReloadCellsFixture().map((cell) => [
      `player-concurrent-action-reload-${cell.id}`,
      `covered:${cell.reloadStatus}`,
    ]),
  ];
}

function playerConcurrentActionReloadCellsFixture() {
  return [
    {
      id: "player-vote-change",
      raceLaneId: "concurrent-vote-race",
      reloadLaneId: "concurrent-vote-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-night-action",
      raceLaneId: "concurrent-action-race",
      reloadLaneId: "concurrent-action-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-vote-vs-host-resolve",
      raceLaneId: "concurrent-player-vote-resolve-race",
      reloadLaneId: "concurrent-player-vote-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-action-vs-host-advance",
      raceLaneId: "concurrent-player-action-advance-race",
      reloadLaneId: "concurrent-player-action-advance-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
    {
      id: "player-vs-completed-game",
      raceLaneId: "concurrent-player-complete-race",
      reloadLaneId: "public-player-complete-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function cohostDeadlineRaceReloadTraceFixture() {
  return {
    strategy: "cohost-deadline-race-reload-before-readiness",
    status: "covered",
    source: "target/dev-test-game/race-coverage.json",
    requiredCellCount: 1,
    coveredCellCount: 1,
    gapCount: 0,
    cells: cohostDeadlineRaceReloadCellsFixture(),
  };
}

function cohostDeadlineRaceReloadCheckRows() {
  return [
    ["cohost-deadline-race-reload-milestone", "1/1 covered"],
    ...cohostDeadlineRaceReloadCellsFixture().map((cell) => [
      `cohost-deadline-race-reload-${cell.id}`,
      `covered:${cell.reloadStatus}`,
    ]),
  ];
}

function cohostDeadlineRaceReloadCellsFixture() {
  return [
    {
      id: "cohost-deadline-vs-host-resolve",
      raceLaneId: "concurrent-cohost-deadline-resolve-race",
      reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
      reloadStatus: "passed",
      covered: true,
    },
  ];
}

function raceCoveragePromotedMilestonesFixture() {
  return {
    status: "passed",
    cellCount: 16,
    provenCellCount: 16,
    reloadCoveredCellCount: 16,
    groupCount: 4,
    passedGroupCount: 4,
    requiredCellCount: 16,
    coveredCellCount: 16,
    gapCount: 0,
    groups: [
      {
        id: "replacement-race-reload",
        label: "Replacement race reload",
        status: "covered",
        cellIds: [
          "replacement-private-post",
          "replacement-vote",
          "replacement-action",
        ],
        requiredCellCount: 3,
        coveredCellCount: 3,
        gapCount: 0,
      },
      {
        id: "host-concurrent-race-reload",
        label: "Host concurrent race reload",
        status: "covered",
        cellIds: hostConcurrentRaceReloadCellsFixture().map((cell) => cell.id),
        requiredCellCount: 7,
        coveredCellCount: 7,
        gapCount: 0,
      },
      {
        id: "player-concurrent-action-reload",
        label: "Player concurrent action reload",
        status: "covered",
        cellIds: playerConcurrentActionReloadCellsFixture().map((cell) => cell.id),
        requiredCellCount: 5,
        coveredCellCount: 5,
        gapCount: 0,
      },
      {
        id: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload",
        status: "covered",
        cellIds: cohostDeadlineRaceReloadCellsFixture().map((cell) => cell.id),
        requiredCellCount: 1,
        coveredCellCount: 1,
        gapCount: 0,
      },
    ],
  };
}

function staleConflictMessageTraceFixture() {
  return {
    strategy: "stale-conflict-message-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: staleConflictMessageLaneIds.length,
    coveredLaneCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
    laneIds: [...staleConflictMessageLaneIds],
  };
}

function hostStaleControlTraceFixture() {
  return {
    strategy: "host-stale-control-before-readiness",
    status: "covered",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredLaneCount: hostStaleControlLaneIds.length,
    coveredLaneCount: hostStaleControlLaneIds.length,
    gapCount: 0,
    laneIds: [...hostStaleControlLaneIds],
  };
}

function hostStaleControlCheckRows() {
  return [
    [
      "host-stale-control-milestone",
      `${hostStaleControlLaneIds.length}/${hostStaleControlLaneIds.length} covered`,
    ],
    ...hostStaleControlLaneIds.map((laneId) => [
      `host-stale-control-${laneId}`,
      "covered",
    ]),
  ];
}

function staleConflictMessageCheckRows() {
  return [
    [
      "stale-conflict-message-milestone",
      `${staleConflictMessageLaneIds.length}/${staleConflictMessageLaneIds.length} covered`,
    ],
    ...staleConflictMessageLaneIds.map((laneId) => [
      `stale-conflict-message-${laneId}`,
      "covered",
    ]),
  ];
}

function adminSpineProofFixture() {
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    scope: "local-dev-test-game-admin-spine",
    generatedAt: "2026-06-26T00:00:00.000Z",
    generatedFrom: {
      game: "game-a",
      proofs: {
        "core-loop": "target/dev-test-game/core-loop-admin-proof.json",
        hardening: "target/dev-test-game/hardening-admin-proof.json",
        identity: "target/dev-test-game/identity-admin-proof.json",
        backup: "target/dev-test-game/backup-admin-proof.json",
        ops: "target/dev-test-game/ops-admin-proof.json",
        seed: "target/dev-test-game/seed-admin-proof.json",
        release: "target/dev-test-game/release-admin-proof.json",
        "race-coverage": "target/dev-test-game/race-coverage-admin-proof.json",
        "hosted-concurrent-race-matrix":
          "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
        "spine-manifest": "target/dev-test-game/spine-manifest-admin-proof.json",
      },
    },
    adminProofs: [
      adminSpineProofRow("core-loop"),
      adminSpineProofRow("hardening"),
      adminSpineProofRow("identity"),
      adminSpineProofRow("backup"),
      adminSpineProofRow("ops"),
      adminSpineProofRow("seed"),
      adminSpineProofRow("release"),
      adminSpineProofRow("race-coverage"),
      adminSpineProofRow("hosted-concurrent-race-matrix"),
      adminSpineProofRow("spine-manifest"),
    ],
    recovery: {
      status: "passed",
      surfaceCount: 10,
      refreshedCount: 10,
      nextCommand: "npm run test:dev-test-game-admin-spine",
      proofBoundary: "Local aggregate recovery commands only.",
      surfaces: [
        adminSpineRecoveryRow("core-loop"),
        adminSpineRecoveryRow("hardening"),
        adminSpineRecoveryRow("identity"),
        adminSpineRecoveryRow("backup"),
        adminSpineRecoveryRow("ops"),
        adminSpineRecoveryRow("seed"),
        adminSpineRecoveryRow("release"),
        adminSpineRecoveryRow("race-coverage"),
        adminSpineRecoveryRow("hosted-concurrent-race-matrix"),
        adminSpineRecoveryRow("spine-manifest"),
      ],
    },
    proofBoundary: "Local aggregate admin spine proof only.",
  };
}

function adminSpineProofRow(id) {
  return {
    id,
    label: `${id} admin proof`,
    proof: `dev-test-game-${id}-admin-proof`,
    status: "passed",
    path: `target/dev-test-game/${id}-admin-proof.json`,
    rerunCommand: `npm run test:dev-test-game-${id}-admin-proof`,
    refreshedInCurrentRun: true,
    game: "game-a",
    releaseReady: false,
    productionReady: false,
  };
}

function adminSpineRecoveryRow(id) {
  return {
    id,
    label: `${id} admin proof`,
    status: "passed",
    path: `target/dev-test-game/${id}-admin-proof.json`,
    rerunCommand: `npm run test:dev-test-game-${id}-admin-proof`,
    refreshedInCurrentRun: true,
    mtime: "2026-06-26T00:00:00.000Z",
    sizeBytes: 42,
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
      staleConflictMessageMilestone: staleConflictMessageMilestoneFixture(),
      hostStaleControlMilestone: hostStaleControlMilestoneFixture(),
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
        {
          id: "local-stale-conflict-message-milestone",
          label: "Stale-client conflict messages",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: staleConflictMessageMilestoneFixture().laneIds,
          requiredLaneCount: staleConflictMessageLaneIds.length,
          coveredLaneCount: staleConflictMessageLaneIds.length,
        },
        {
          id: "local-host-stale-control-milestone",
          label: "Host stale-control recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: hostStaleControlMilestoneFixture().laneIds,
          requiredLaneCount: hostStaleControlLaneIds.length,
          coveredLaneCount: hostStaleControlLaneIds.length,
        },
        {
          id: "local-proof-graph-admin-role-handoffs",
          label: "Proof graph admin role handoffs",
          status: "passed",
          dependencyGated: true,
          evidence: "target/dev-test-game/proof-graph-admin-proof.json",
          recovery: {
            command: "npm run test:dev-test-game-proof-graph-admin-proof",
            proofTarget: "target/dev-test-game/proof-graph-admin-proof.json",
            roleUrl: "/admin/audit/local-proof-graph?game=<seeded-game>",
            proofBoundary:
              "Local browser proof that the proof graph admin surface follows every mapped admin-proof role URL.",
            requiredEvidence:
              "Passed proof graph admin role-handoff check in the generated release-readiness checklist",
          },
        },
        {
          id: "local-proof-freshness-admin-surface",
          label: "Proof freshness admin surface",
          status: "passed",
          dependencyGated: true,
          evidence: "target/dev-test-game/proof-freshness-admin-proof.json",
          recovery: {
            command: "npm run test:dev-test-game-proof-freshness-admin-proof",
            proofTarget: "target/dev-test-game/proof-freshness-admin-proof.json",
            roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
            proofBoundary:
              "Local browser proof that the proof-freshness admin surface exposes fresh generated artifacts and the next-action handoff.",
            requiredEvidence:
              "Passed proof-freshness admin surface check in the generated release-readiness checklist",
          },
        },
        {
          id: "local-next-action-admin-surface",
          label: "Next-action admin surface",
          status: "passed",
          dependencyGated: true,
          evidence: "target/dev-test-game/next-action-admin-proof.json",
          recovery: {
            command: "npm run test:dev-test-game-next-action-admin-proof",
            proofTarget: "target/dev-test-game/next-action-admin-proof.json",
            roleUrl: "/admin/audit/local-next-action?game=<seeded-game>",
            proofBoundary:
              "Local browser proof that the next-action admin surface exposes the selected command and readiness traces.",
            requiredEvidence:
              "Passed next-action admin surface check in the generated release-readiness checklist",
          },
        },
      ],
    },
    releaseReadiness: {
      status: "not_ready",
      reason: "Local proof passed, but hosted evidence remains unproven.",
      unproven: [
        releaseReadinessUnprovenItem("hosted-deployment"),
        releaseReadinessUnprovenItem("human-release-runbook"),
      ],
    },
    proofBoundary:
      "Derived from the local dev-test-game proof-run artifact without release claims.",
  };
}

function staleConflictMessageMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...staleConflictMessageLaneIds],
    requiredLaneCount: staleConflictMessageLaneIds.length,
    coveredLaneCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
  };
}

function hostStaleControlMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...hostStaleControlLaneIds],
    requiredLaneCount: hostStaleControlLaneIds.length,
    coveredLaneCount: hostStaleControlLaneIds.length,
    gapCount: 0,
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
    version: 10,
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
      accountCredentialKind: "local-password-account",
      sessionCredentialKind: "opaque-session",
      lifecycleControls: [
        "account-disable",
        "account-enable",
        "session-rotation",
        "session-revocation",
        "invite-revocation",
      ],
      delegatedIssuanceControls: ["host-scoped-invite-issuance"],
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
      accountLogin: {
        status: "passed",
        principalUserId: "host_h",
        accountId: "host@example.test",
        capabilityKinds: ["HostOf"],
        sameRoleSurface: true,
        cookieValuePrefix: "account-session-",
        rawPasswordStored: false,
      },
      accountLifecycle: {
        status: "passed",
        adminControlSurface: {
          status: "passed",
          detailRoleUrl:
            "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
          controlsTestId: "admin-identity-account-controls",
          visitedDetailRoleUrl: true,
          staleConflictStatusText:
            "stale account lifecycle state for host@example.test; refresh and use current account controls before enable",
          reloadRecoveryStatus: "disabled",
          reloadRecoveryDetailRoleUrl:
            "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h",
          reloadRecoveryTargetText: "host@example.test host_h disabled",
        },
        disabledStatus: "disabled",
        enabledStatus: "enabled",
        disabledAccountRejected: true,
        staleAccountSessionRejected: true,
        staleAdminControlRejected: true,
        staleAdminControlReloadRecovered: true,
        recoveryCapabilityKinds: ["HostOf"],
        sameRoleSurface: true,
        revokedSessionCount: 1,
        disabledAtPresent: true,
        enabledDisabledAtCleared: true,
        rawPasswordStored: false,
      },
      hostScopedInviteIssuance: {
        status: "passed",
        hostRoleSurface: "/g/game-a/host",
        hostAction: "?/issuePlayerInvite",
        clickedThroughFromHostRoleUrl: true,
        issuedByPrincipalUserId: "host_h",
        issuedForGame: "game-a",
        storedGameScope: "game-a",
        globalCapabilitiesGranted: 0,
        rawInviteTokenStored: false,
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
    accounts: {
      host: {
        accountId: "host@example.test",
        principalUserId: "host_h",
        globalCapabilities: [],
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
