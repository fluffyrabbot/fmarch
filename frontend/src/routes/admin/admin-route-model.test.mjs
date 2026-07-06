import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  ADMIN_ROUTE_CONTRACT,
  LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS,
  adminForbiddenMessage,
  buildAdminAuditDetailData,
  buildAdminRouteData,
  hostedHandoffReceiptHeadingRegistry,
  hostedHandoffReceiptHeadingsForAudit,
  normalizeLocalNextActionGeneratedSummary,
  normalizeLocalNextActionLocalReadinessDependencyCheckRows,
  normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows,
  normalizeLocalNextActionProofGraphDestinationSummaryCheckRows,
  normalizeLocalNextActionProofGraphDestinationSummaryTraceCheckRows,
  normalizeLocalNextActionRelatedLinks,
  normalizeLocalNextActionSeedProofLaneCoverageCheckRows,
  normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows,
  normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows,
  normalizeLocalNextActionSelectedProofGraphCheckRows,
  normalizeLocalNextActionSelectedSpineCheckRows,
  normalizeLocalProofGraphArtifactSummary,
  normalizeLocalProofGraphCheckRows,
  normalizeLocalProofGraphRelatedLinks,
  summarizeRecoveryGate,
} from "./admin-route-model.mjs";
import {
  hostStaleControlCoverageFamilies,
  hostStaleControlLaneIds,
} from "../../../../tools/dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  hardeningAuditLaneIds,
} from "../../../../tools/dev_test_game_hardening_scenarios.mjs";
import {
  coreLoopCompletedGameCoverageCheckId,
  coreLoopAdminCheckIds,
  coreLoopAuditLaneIds,
} from "../../../../tools/dev_test_game_core_loop_scenarios.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "../../../../tools/dev_test_game_core_loop_generated_from_families.mjs";
import {
  completedGameHardeningLaneCases,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  staleConflictMessageCoverageFamilies,
  staleConflictMessageSurfaceCases,
  staleConflictMessageLaneIds,
} from "../../../../tools/dev_test_game_stale_conflict_scenarios.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  replacementPrivateChannelRecoveryCoverageFamilies,
  replacementPrivateChannelRecoveryLaneIds,
} from "../../../../tools/dev_test_game_replacement_private_scenarios.mjs";
import {
  replacementActionLaneIds,
  replacementActionRecoveryCoverageFamilies,
} from "../../../../tools/dev_test_game_replacement_action_scenario_cases.mjs";
import {
  replacementHandoffRecoveryCoverageFamilies,
  replacementHandoffRecoveryLaneIds,
} from "../../../../tools/dev_test_game_replacement_handoff_scenario_cases.mjs";
import {
  playerInvalidActionRecoveryMessage,
} from "../../../../tools/dev_test_game_core_loop_action_scenarios.mjs";
import {
  coreLoopPrivateChannelRecoveryCoverageFamilies,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelInvalidActionRecoveryScenario,
  staleCompletedPrivatePostScenario,
} from "../../../../tools/dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  privateChannelNormalizedEvidenceObjects,
  replacementPrivatePostNormalizedEvidenceObjects,
} from "../../../../tools/dev_test_game_normalized_evidence_objects.mjs";
import {
  seedDemoScenarioFixtureRows,
  seedProofLaneCoverageCountSummary,
  seedProofLaneCoverageFixture,
  seedScenarioCoverageGroups,
} from "../../../../tools/dev_test_game_seed_scenario_cases.mjs";
import {
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceHandoffChecklistFromPreflight,
  hostedEvidenceProgressionHandoffSummary,
  hostedEvidenceRealHostedInputsFixture,
} from "../../../../tools/dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedMatrixReconnectLaneIds,
  hostedMatrixRealHostedEvidenceCommand,
  hostedMatrixExternalEvidenceProofTarget,
  hostedMatrixRealHostedHandoffChecklist,
  hostedMatrixStaleConflictLaneIds,
} from "../../../../tools/dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  buildRealHostedEvidenceInputs,
} from "../../../../tools/dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  hostedMatrixRawEvidenceContractSummary,
} from "../../../../tools/dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  hostedOpsSignalCheckStatusRows,
} from "../../../../tools/dev_test_game_hosted_ops_signal_cases.mjs";
import {
  realHostedObservabilityHandoffCase,
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityHandoffInputSectionDefinitions,
  realHostedObservabilityHandoffInputSections,
} from "../../../../tools/dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionIds,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityEvidencePacketSectionDefinitions,
  hostedIdentityEvidenceOperatorProofDrilldowns,
  hostedIdentityEvidenceOperatorGate,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceRequirementGroups,
  hostedIdentityRoleSurfaceContractDiff,
} from "../../../../tools/dev_test_game_hosted_identity_evidence.mjs";
import {
  buildDevTestGameHostedIdentityProgressionSummary,
} from "../../../../tools/dev_test_game_hosted_identity_progression_summary.mjs";
import {
  buildDevTestGameIdentityAdapterContractPacket,
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "../../../../tools/dev_test_game_identity_adapter_contract.mjs";
import {
  releaseReadinessUnprovenItem,
  releaseReadinessUnprovenStatusRows,
} from "../../../../tools/dev_test_game_release_readiness_cases.mjs";
import {
  localNextActionAdminSurfaceCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
  localProofGraphNextActionHandoffCheckId,
  localReadinessDependencyCheckFor,
} from "../../../../tools/dev_test_game_local_readiness_dependencies.mjs";
import {
  adminProofDestinationProofGraphNodes,
  adminProofDestinationRequirementRoleRows,
  devTestGameProofGraphBaseEdges,
  devTestGameProofGraphFirstClassNodes,
  proofGraphDiagnosticProofNodes,
  proofGraphProductionFeatureCase,
  proofGraphProductionFeatureEdge,
  proofGraphProductionFeatureNode,
  proofGraphRecoveryReceiptCase,
  proofGraphRecoveryReceiptEdges,
  proofGraphRecoveryReceiptNodes,
} from "../../../../tools/dev_test_game_proof_graph_handoff_cases.mjs";
import {
  buildProofGraphDestinationSummaryTrace,
  proofGraphDestinationSummaryTraceCheckIds,
} from "../../../../tools/dev_test_game_proof_graph_destination_summary_trace.mjs";
import {
  proofGraphProductionFeatureDestinationSummary,
} from "../../../../tools/dev_test_game_proof_graph_production_feature_destinations.mjs";
import {
  buildProofStabilityTrace,
  proofStabilityTraceCheckRows,
} from "../../../../tools/dev_test_game_proof_stability_trace.mjs";
import {
  buildProofGraphDiagnosticProofSummary,
  buildProofGraphDiagnosticSummaryTrace,
  proofGraphDiagnosticSummaryCheckIds,
} from "../../../../tools/dev_test_game_proof_graph_diagnostic_summary.mjs";
import {
  recoveryReceiptGraphDescriptorByReceiptKey,
} from "../../../../tools/dev_test_game_recovery_receipt_graph_surfaces.mjs";
import {
  featureSpineFixture,
  hostedEvidenceLaneUnprovenFixture as sharedHostedEvidenceLaneUnprovenFixture,
  invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture,
} from "../../../../tools/dev_test_game_next_action_spine_fixtures.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "../../../../tools/dev_test_game_admin_audit_surface_ids.mjs";
import {
  buildAdminAuditHandoffPath,
} from "../../../../tools/dev_test_game_admin_audit_handoff_path.mjs";
import {
  devTestGameNextActionSequenceHandoffPair,
} from "../../../../tools/dev_test_game_next_action_sequence_handoff_pair.mjs";
import {
  hostedIdentityTerminalReceiptArtifactCase,
  terminalProofGraphReceiptArtifacts,
} from "../../../../tools/dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence,
} from "../../../../tools/dev_test_game_hosted_target_preflight.mjs";
import {
  devTestGameAdminSpineAdminProofPath,
  devTestGameBackupAdminProofPath,
  devTestGameCoreLoopAdminProofPath,
  devTestGameHardeningAdminProofPath,
  devTestGameHostSetupAdminProofPath,
  devTestGameIdentityAdminProofPath,
  devTestGameOpsAdminProofPath,
  devTestGameSeedAdminProofPath,
  devTestGameSpineManifestAdminProofPath,
} from "../../../../tools/dev_test_game_local_admin_proof_paths.mjs";

const LOCAL_RACE_COMMAND =
  "npm run test:dev-test-game-hosted-concurrent-race-matrix";
const SEED_FIXTURE_COMMAND = "npm run test:dev-test-game-seed-fixture";
const HOST_SETUP_PROOF_COMMAND =
  "npm run dev:test-game -- --verify-host-setup-only";
const LOCAL_PROOF_GRAPH_COMMAND =
  "npm run test:dev-test-game-proof-graph-admin-proof";
const PROOF_GRAPH_REGEN_COMMAND = "npm run test:dev-test-game-proof-graph";
const LIVE_BROWSER_PROOF_COMMAND =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live";
const ACTIONABLE_SPINE_ROLE_URL =
  "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002";
const HOST_SPINE_ROLE_URL =
  "http://127.0.0.1:5173/g/00000000-0000-0000-0000-000000000002/host";
const HOSTED_MATRIX_PROOF_TARGET =
  "target/dev-test-game/hosted-concurrent-race-matrix.json";
const HOSTED_TARGET_PREFLIGHT_PROOF_TARGET =
  "target/dev-test-game/hosted-target-preflight.json";
const HOSTED_EVIDENCE_LANE_PROOF_TARGET =
  "target/dev-test-game/hosted-evidence-lane.json";
const HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET =
  "target/dev-test-game/hosted-identity-evidence.json";
const HOSTED_IDENTITY_EVIDENCE_COMMAND =
  "npm run test:dev-test-game-hosted-identity-evidence";
const HOSTED_IDENTITY_OPERATOR_COMMAND =
  "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-identity:operator";
const HOSTED_IDENTITY_OPERATOR_PROOF_TARGET =
  "target/dev-test-game/hosted-identity-evidence-operator-admin-proof.json";
const HOSTED_IDENTITY_OPERATOR_PROOF_BOUNDARY =
  "Opt-in local operator predicate proof. The command proves that a non-fixture hosted identity packet path can clear the hosted-production-identity readiness item over the existing role-surface adapter; it does not prove live hosted account/session/invite traffic, release readiness, or production readiness.";
const HOSTED_IDENTITY_FAMILY_BATCH = Object.freeze({
  id: "hosted-identity-family-proof-batch",
  status: "current",
  command: "npm run test:dev-test-game-hosted-identity-progression-admin-proof:batch",
  firstPendingProgressionId: null,
  proofTargets: Object.freeze([
    "target/dev-test-game/hosted-identity-evidence-hosted-account-lifecycle-admin-proof.json",
    "target/dev-test-game/hosted-identity-evidence-invite-delivery-admin-proof.json",
    "target/dev-test-game/hosted-identity-evidence-account-recovery-admin-proof.json",
    "target/dev-test-game/hosted-identity-evidence-abuse-and-rate-limit-admin-proof.json",
    "target/dev-test-game/hosted-identity-evidence-session-secret-policy-admin-proof.json",
    "target/dev-test-game/hosted-identity-evidence-hosted-audit-retention-export-admin-proof.json",
  ]),
  proofBoundary:
    "Hosted identity family proof batch predicate. Required means one or more family admin proofs are missing or stale; current means all family admin proofs are valid and the aggregate hosted identity operator spine may run. It does not prove live hosted identity traffic, release readiness, or production readiness.",
});
const HOSTED_IDENTITY_PROOF_GRAPH_EDGES = Object.freeze({
  id: "hosted-identity-proof-graph-dependency",
  status: "recorded",
  proofGraphRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
  familyBatchNodeId: "hosted-identity-family-proof-batch",
  operatorPredicateNodeId: "hosted-identity-operator-predicate-proof",
  adminSurfaceNodeId: "admin-proof:hosted-identity-evidence",
  familyProofTargets: HOSTED_IDENTITY_FAMILY_BATCH.proofTargets,
  operatorProofTarget: HOSTED_IDENTITY_OPERATOR_PROOF_TARGET,
  edges: Object.freeze([
    Object.freeze({
      id: "edge:hosted-identity-family-proof-batch:prerequisite-for-hosted-identity-operator:hosted-identity-operator-predicate-proof",
      from: "hosted-identity-family-proof-batch",
      to: "hosted-identity-operator-predicate-proof",
      relationship: "prerequisite-for-hosted-identity-operator",
      command:
        "npm run test:dev-test-game-hosted-identity-progression-admin-proof:batch",
      proofTarget: HOSTED_IDENTITY_OPERATOR_PROOF_TARGET,
    }),
    Object.freeze({
      id: "edge:hosted-identity-operator-predicate-proof:operator-predicate-for-admin-surface:admin-proof:hosted-identity-evidence",
      from: "hosted-identity-operator-predicate-proof",
      to: "admin-proof:hosted-identity-evidence",
      relationship: "operator-predicate-for-admin-surface",
      command: "npm run test:dev-test-game-hosted-identity-operator-admin-proof",
      proofTarget: HOSTED_IDENTITY_OPERATOR_PROOF_TARGET,
    }),
  ]),
  proofBoundary:
    "Hosted identity proof graph dependency. This next-action row links the family proof batch, operator predicate proof, and hosted identity admin surface graph edges; it records local graph topology only and does not prove live hosted identity traffic, release readiness, or production readiness.",
});
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
    ["create-game", "host-setup", "session-grants", "cohost"],
  );
  assert.equal(data.gameSetup[0].commandAction, "create_game");
  assert.equal(data.gameSetup[1].commandAction, "navigate");
  assert.equal(data.gameSetup[1].href, "/g/midsummer/setup");
  assert.equal(data.gameSetup[2].commandAction, "grant_session");
  assert.equal(data.gameSetup[3].commandAction, "add_cohost");
  assert.equal(data.gameSetup[0].boundary, "Command pipeline");
  assert.equal(data.gameSetup[0].buttonLabel, "Review");
  assert.equal(data.gameSetup[0].confirmLabel, "Create game");
  assert.equal(
    data.gameSetup[0].confirmMessage,
    "Create game midsummer from pack mafiascum",
  );
  assert.equal(data.gameSetup[2].boundary, "Authenticated session grant");
  assert.match(data.gameSetup[2].boundaryDetail, /GlobalAdmin session/);
  assert.match(data.gameSetup[3].boundaryDetail, /host-gated/);
  assert.equal(data.gameSetup[2].confirmLabel, "Grant GlobalMod");
  assert.equal(data.gameSetup[3].confirmLabel, "Delegate cohost_c");
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

  const ops = data.audit.find((item) => item.id === localAdminAuditIds.opsArtifacts);
  assert.equal(ops.label, "Local ops artifacts");
  assert.equal(ops.status, "5 local ops checks passed");
  assert.equal(ops.authority, "GlobalAdmin or GlobalMod");
  assert.equal(ops.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.opsArtifacts, { game: "midsummer" }));
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

  const ops = data.audit.find((item) => item.id === localAdminAuditIds.hostedOpsSignals);
  assert.equal(ops.label, "Local hosted ops signals");
  assert.equal(ops.status, "4 hosted-like ops signals passed");
  assert.equal(ops.authority, "GlobalAdmin or GlobalMod");
  assert.equal(ops.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.hostedOpsSignals, { game: "midsummer" }));
  assert.deepEqual(
    ops.checks.map((check) => [check.id, check.status]),
    hostedOpsSignalCheckStatusRows().map((check) => [check.id, check.status]),
  );
  assert.deepEqual(ops.artifactSummary, {
    game: "game-a",
    cellCount: 16,
    reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
    staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
    realHostedDeploymentStatus: "unproven",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin route data exposes real hosted observability handoff as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedOpsSignals: localHostedOpsSignalsFixture(),
    realHostedObservabilityHandoff:
      localRealHostedObservabilityHandoffFixture(),
  });

  const handoff = data.audit.find(
    (item) => item.id === localAdminAuditIds.realHostedObservabilityHandoff,
  );
  assert.equal(handoff.label, "Real hosted observability handoff");
  assert.equal(handoff.status, "blocked: 1 passed, 9 blocked");
  assert.equal(handoff.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    handoff.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.realHostedObservabilityHandoff, {
      game: "midsummer",
    }),
  );
  assert.deepEqual(
    handoff.relatedLinks.map((link) => link.id),
    [localAdminAuditIds.hostedOpsSignals, localAdminAuditIds.nextAction],
  );
  assert.deepEqual(handoff.handoffPath, {
    upstreamAuditId: localAdminAuditIds.nextAction,
    upstreamLabel: "Ranked next action",
    localCapabilityAuditId: localAdminAuditIds.hostedOpsSignals,
    downstreamStatus: "blocked",
    downstreamCommand: "npm run test:dev-test-game-real-hosted-observability-handoff",
    downstreamProofTarget:
      "target/dev-test-game/real-hosted-observability-handoff.json",
  });
  assert.equal(
    handoff.hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary,
    "The local hosted-like ops signal bundle is baseline evidence only; it cannot satisfy real hosted observability.",
  );
  assert.deepEqual(handoff.artifactSummary, {
    realHostedObservabilitySummary: {
      status: "blocked",
      checkCount: 10,
      passedCheckCount: 1,
      blockedCheckCount: 9,
      requiredInputCount: 11,
      providedInputCount: 1,
      missingInputCount: 10,
      baselineStatus: "baseline only",
      localHostedOpsSignalsPath: "target/dev-test-game/hosted-ops-signals.json",
      localVsHostedBoundary:
        "Local hosted-like signals cannot satisfy real hosted observability evidence.",
    },
    game: "game-a",
    rawEvidencePath: "",
    rawEvidenceStatus: "blocked",
    localHostedOpsSignalsPath: "target/dev-test-game/hosted-ops-signals.json",
    localHostedLikeSignalsOnlyBaseline: true,
    blockedCheckCount: 9,
    nextCommand: "npm run test:dev-test-game-real-hosted-observability-handoff",
    nextProofTarget:
      "target/dev-test-game/real-hosted-observability-handoff.json",
    releaseReady: false,
    productionReady: false,
  });
  assert.deepEqual(
    handoff.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "real-hosted-observability-summary",
        "Real hosted observability",
        "admin-audit-detail-real-hosted-observability-summary",
        [
          [
            "real-hosted-observability-summary-status",
            "admin-audit-real-hosted-observability-summary-status",
            [
              ["status", "blocked", true],
              ["passedChecks", "1/10 checks passed", false],
              ["blockedChecks", "9 checks blocked", false],
            ],
          ],
          [
            "real-hosted-observability-summary-inputs",
            "admin-audit-real-hosted-observability-summary-inputs",
            [
              ["providedInputs", "1/11 inputs provided", true],
              ["missingInputs", "10 inputs missing", false],
            ],
          ],
          [
            "real-hosted-observability-summary-baseline",
            "admin-audit-real-hosted-observability-summary-baseline",
            [
              ["baselineStatus", "baseline only", true],
              [
                "localHostedOpsSignalsPath",
                "target/dev-test-game/hosted-ops-signals.json",
                false,
              ],
              [
                "localVsHostedBoundary",
                "Local hosted-like signals cannot satisfy real hosted observability evidence.",
                false,
              ],
            ],
          ],
        ],
      ],
    ],
  );
});

test("admin route data exposes hosted target preflight as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedTargetPreflight: localHostedTargetPreflightFixture(),
  });

  const preflight = data.audit.find(
    (item) => item.id === localAdminAuditIds.hostedTargetPreflight,
  );
  assert.equal(preflight.label, "Hosted target preflight");
  assert.equal(preflight.status, "1 passed, 6 blocked");
  assert.equal(
    preflight.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedTargetPreflight, { game: "midsummer" }),
  );
  assert.deepEqual(
    preflight.checks.map((check) => [check.id, check.status]),
    [
      ["hosted-frontend-url-configured", "blocked"],
      ["hosted-api-url-configured", "blocked"],
      ["hosted-targets-external", "blocked"],
      ["raw-evidence-path-configured", "blocked"],
      ["raw-evidence-readable", "blocked"],
      ["raw-evidence-real-hosted-target", "blocked"],
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
      "raw-evidence-real-hosted-target",
    ],
  );
  assert.equal(preflight.artifactSummary.rawCaptureStatus, "unknown");
  assert.equal(preflight.artifactSummary.rawCapturePath, "");
  assert.deepEqual(preflight.artifactSummary.rawCaptureBlockedCheckIds, []);
  assert.equal(
    preflight.artifactSummary.nextProofTarget,
    HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
  );
  assert.deepEqual(preflight.artifactSummarySections, [
    {
      id: "hosted-target-preflight-summary",
      heading: "Hosted target preflight",
      testId: "admin-audit-detail-hosted-target-preflight-summary",
      rows: [
        {
          id: "summary",
          testId: "admin-audit-hosted-target-preflight-summary",
          values: [
            { id: "rawCaptureStatus", text: "unknown", emphasized: true },
            { id: "rawCapturePath", text: "", emphasized: false },
            { id: "rawCaptureBlockedCheckIds", text: "", emphasized: false },
            { id: "rawEvidencePath", text: "", emphasized: false },
            { id: "rawEvidenceStatus", text: "blocked", emphasized: false },
            {
              id: "nextCommand",
              text: "npm run test:dev-test-game-hosted-target-preflight",
              emphasized: false,
            },
            {
              id: "nextProofTarget",
              text: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
              emphasized: false,
            },
            { id: "releaseReady", text: "release not ready", emphasized: false },
            {
              id: "productionReady",
              text: "production not ready",
              emphasized: false,
            },
          ],
        },
      ],
    },
  ]);
});

test("admin hosted target preflight detail data carries raw-capture pass summary", async () => {
  const preflight = localHostedTargetPreflightFixture();
  const passedPreflight = {
    ...preflight,
    status: "passed",
    target: {
      ...preflight.target,
      frontendBaseUrl: "https://fmarch-demo.example.test",
      apiBaseUrl: "https://api.fmarch-demo.example.test",
      rawEvidencePath:
        "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json",
      rawEvidenceStatus: "passed",
      rawCaptureStatus: "passed",
      rawCapturePath: "target/dev-test-game/real-hosted-matrix-raw-capture.json",
      rawCaptureBlockedCheckIds: [],
    },
    checks: preflight.checks.map((check) => ({
      ...check,
      status: "passed",
      ...(check.requiredEvidence === undefined
        ? {}
        : { requiredEvidence: undefined }),
    })),
    blockedReceipt: undefined,
    nextCommand: "npm run test:dev-test-game-hosted-matrix-external-evidence",
    nextProofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
  };
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostedTargetPreflight,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedTargetPreflight: passedPreflight,
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.status, "7 passed, 0 blocked");
  assert.deepEqual(data.audit.unproven, []);
  assert.equal(data.audit.artifactSummary.rawCaptureStatus, "passed");
  assert.equal(
    data.audit.artifactSummary.rawCapturePath,
    "target/dev-test-game/real-hosted-matrix-raw-capture.json",
  );
  assert.deepEqual(data.audit.artifactSummary.rawCaptureBlockedCheckIds, []);
  assert.equal(
    data.audit.artifactSummary.rawEvidencePath,
    "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json",
  );
  assert.equal(
    data.audit.artifactSummary.nextCommand,
    "npm run test:dev-test-game-hosted-matrix-external-evidence",
  );
  assert.equal(
    data.audit.artifactSummary.nextProofTarget,
    HOSTED_EVIDENCE_LANE_PROOF_TARGET,
  );
  assert.equal(data.audit.artifactSummary.releaseReady, false);
  assert.equal(data.audit.artifactSummary.productionReady, false);
});

test("admin route data exposes hosted evidence lane as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedEvidenceLane: localHostedEvidenceLaneFixture(),
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
  });

  const lane = data.audit.find((item) => item.id === localAdminAuditIds.hostedEvidenceLane);
  assert.equal(lane.label, "Hosted evidence lane");
  assert.equal(lane.status, "blocked: 1 passed, 6 blocked");
  assert.equal(lane.authority, "GlobalAdmin or GlobalMod");
  assert.equal(lane.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane, { game: "midsummer" }));
  assert.deepEqual(
    lane.checks.map((check) => check.id),
    [
      "hosted-target-preflight",
      "hosted-frontend-url-configured",
      "hosted-api-url-configured",
      "hosted-targets-external",
      "raw-evidence-path-configured",
      "raw-evidence-readable",
      "raw-evidence-real-hosted-target",
      "release-claim-boundary-carried",
      "demo-proof:blocked-lane-recorded",
      "demo-proof:synthetic-raw-evidence-written",
      "demo-proof:synthetic-lane-rejected",
      "demo-proof:demo-external-evidence-written",
      "demo-proof:synthetic-demo-boundary-carried",
      "demo-proof:release-claim-boundary-carried",
    ],
  );
  assert.deepEqual(
    lane.relatedLinks.map((link) => link.id),
    [
      localAdminAuditIds.hostedTargetPreflight,
      localAdminAuditIds.hostedConcurrentRaceMatrix,
      localAdminAuditIds.nextAction,
    ],
  );
  assert.deepEqual(
    lane.hostedHandoffReceiptHeadings,
    hostedHandoffReceiptHeadingsForAudit(localAdminAuditIds.hostedEvidenceLane),
  );
  assert.equal(lane.artifactSummary.nextCommand, "npm run test:dev-test-game-hosted-evidence-lane");
  assert.equal(lane.artifactSummary.nextProofTarget, HOSTED_EVIDENCE_LANE_PROOF_TARGET);
  assert.equal(lane.artifactSummary.preflightStatus, "blocked");
  assert.equal(lane.artifactSummary.blockedCheckCount, 6);
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
  assert.equal(lane.artifactSummary.demoSyntheticRejectedLaneStatus, "blocked");
  assert.deepEqual(lane.artifactSummarySections, [
    {
      id: "hosted-evidence-lane-summary",
      heading: "Hosted evidence lane",
      testId: "admin-audit-detail-hosted-evidence-lane-summary",
      rows: [
        {
          id: "summary",
          testId: "admin-audit-hosted-evidence-lane-summary",
          values: [
            {
              id: "realHostedEvidenceStatus",
              text: "unproven",
              emphasized: true,
            },
            { id: "hostedEvidenceMode", text: "blocked", emphasized: false },
            {
              id: "externalEvidencePath",
              text: "",
              emphasized: false,
            },
            { id: "rawEvidencePath", text: "", emphasized: false },
            { id: "rawEvidenceStatus", text: "blocked", emphasized: false },
            {
              id: "nextCommand",
              text: "npm run test:dev-test-game-hosted-evidence-lane",
              emphasized: false,
            },
            {
              id: "nextProofTarget",
              text: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
              emphasized: false,
            },
            { id: "releaseReady", text: "release not ready", emphasized: false },
            {
              id: "productionReady",
              text: "production not ready",
              emphasized: false,
            },
          ],
        },
      ],
    },
  ]);
});

test("admin hosted evidence lane detail data carries real-capture pass summary", async () => {
  const lane = localHostedEvidenceLaneFixture();
  const passedLane = {
    ...lane,
    status: "passed",
    preflightStatus: "passed",
    blockedCheckIds: [],
    target: {
      ...lane.target,
      frontendBaseUrl: "https://fmarch-demo.example.test",
      apiBaseUrl: "https://api.fmarch-demo.example.test",
      rawEvidencePath:
        "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json",
      rawEvidenceStatus: "passed",
      rawEvidenceSyntheticExternalTarget: false,
      rawEvidenceFixture: false,
    },
    hostedEvidence: {
      status: "passed",
      mode: "real-hosted",
      syntheticExternalTarget: false,
      externalEvidencePath: "target/dev-test-game/hosted-matrix-external.json",
      externalEvidenceSourceMode: "raw-hosted-target",
      realHostedEvidenceStatus: "passed",
      realHostedEvidenceInputs: realHostedEvidenceInputsFixture({
        status: "passed",
        mode: "real-hosted",
        command: "npm run test:dev-test-game-hosted-evidence-lane",
        proofTarget: "target/dev-test-game/hosted-matrix-external.json",
      }),
      evidence: "target/dev-test-game/hosted-matrix-external.json",
    },
    checks: [
      { id: "hosted-target-preflight", status: "passed" },
      {
        id: "external-hosted-evidence-written",
        status: "passed",
        evidence: "target/dev-test-game/hosted-matrix-external.json",
      },
      { id: "local-demo-pass-path", status: "not_applicable" },
      {
        id: "real-hosted-evidence-required",
        status: "passed",
        evidence: "target/dev-test-game/hosted-matrix-external.json",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    hostedHandoffChecklist: hostedEvidenceHandoffChecklistFromPreflight({
      preflight: {
        status: "passed",
        checks: [
          { id: "hosted-target-preflight", status: "passed" },
          { id: "external-hosted-evidence-written", status: "passed" },
        ],
        target: {
          frontendBaseUrl: "https://fmarch-demo.example.test",
          apiBaseUrl: "https://api.fmarch-demo.example.test",
          groupId: "replacement-race-reload",
          rawEvidencePath:
            "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json",
          rawEvidenceStatus: "passed",
        },
      },
      command: "npm run test:dev-test-game-hosted-evidence-lane",
      proofTarget: "target/dev-test-game/hosted-matrix-external.json",
    }),
    blockedReceipt: undefined,
    nextCommand: "npm run test:dev-test-game-hosted-matrix-external-evidence",
    nextProofTarget: "target/dev-test-game/hosted-matrix-external.json",
  };
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostedEvidenceLane,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedEvidenceLane: passedLane,
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.status, "passed: 4 passed, 0 blocked");
  assert.deepEqual(data.audit.unproven, []);
  assert.equal(data.audit.artifactSummary.realHostedEvidenceStatus, "passed");
  assert.equal(data.audit.artifactSummary.hostedEvidenceMode, "real-hosted");
  assert.equal(
    data.audit.artifactSummary.externalEvidencePath,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.equal(
    data.audit.artifactSummary.rawEvidencePath,
    "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.real-capture-example.json",
  );
  assert.equal(
    data.audit.artifactSummary.nextCommand,
    "npm run test:dev-test-game-hosted-matrix-external-evidence",
  );
  assert.equal(
    data.audit.artifactSummary.nextProofTarget,
    "target/dev-test-game/hosted-matrix-external.json",
  );
  assert.equal(data.audit.artifactSummary.releaseReady, false);
  assert.equal(data.audit.artifactSummary.productionReady, false);
});

test("admin route data exposes hosted identity evidence as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedIdentityEvidence: localHostedIdentityEvidenceFixture(),
    hostedIdentityProgressionSummary:
      buildDevTestGameHostedIdentityProgressionSummary({
        generatedAt: "2026-06-26T00:00:00.000Z",
      }),
  });

  const identity = data.audit.find(
    (item) => item.id === localAdminAuditIds.hostedIdentityEvidence,
  );
  assert.equal(identity.label, "Hosted identity evidence");
  assert.equal(
    identity.status,
    `blocked: 0 passed, ${hostedIdentityEvidenceBlockedChecks.length} blocked`,
  );
  assert.equal(identity.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    identity.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence, { game: "midsummer" }),
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
    [localAdminAuditIds.identityAdapter, localAdminAuditIds.nextAction],
  );
  assert.deepEqual(
    identity.hostedHandoffReceiptHeadings,
    hostedHandoffReceiptHeadingsForAudit(
      localAdminAuditIds.hostedIdentityEvidence,
    ),
  );
  assert.deepEqual(identity.handoffPath, {
    upstreamAuditId: localAdminAuditIds.nextAction,
    upstreamLabel: "Ranked next action",
    localCapabilityAuditId: localAdminAuditIds.identityAdapter,
    downstreamStatus: "blocked",
    downstreamCommand: "npm run test:dev-test-game-hosted-identity-evidence",
    downstreamProofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  });
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
  assert.deepEqual(
    identity.hostedHandoffChecklist.inputSections.map((section) => [
      section.id,
      section.status,
      section.requiredInputIds,
      section.providedInputIds,
      section.missingInputs,
    ]),
    [
      [
        "proof-command",
        "provided",
        ["command", "proof-target"],
        ["command", "proof-target"],
        [],
      ],
      [
        "evidence-file",
        "missing",
        ["FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"],
        [],
        ["FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"],
      ],
      [
        "role-surface-contracts",
        "missing",
        [
          "redacted-role-surface-contract-packet",
          "redacted-identity-adapter-contract-packet",
        ],
        [],
        [
          "redacted-role-surface-contract-packet",
          "redacted-identity-adapter-contract-packet",
        ],
      ],
      [
        "identity-operations",
        "missing",
        [
          "redacted-account-lifecycle-packet",
          "redacted-invite-delivery-packet",
          "redacted-account-recovery-packet",
          "redacted-abuse-rate-limit-packet",
          "redacted-session-secret-packet",
          "redacted-audit-retention-packet",
        ],
        [],
        [
          "redacted-account-lifecycle-packet",
          "redacted-invite-delivery-packet",
          "redacted-account-recovery-packet",
          "redacted-abuse-rate-limit-packet",
          "redacted-session-secret-packet",
          "redacted-audit-retention-packet",
        ],
      ],
    ],
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.inputSections.map((section) => section.id),
    hostedIdentityEvidenceInputSectionIds,
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.operatorEvidenceGate,
    normalizedHostedIdentityOperatorGateFixture(),
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.operatorProofDrilldowns,
    hostedIdentityEvidenceOperatorProofDrilldowns,
  );
  assert.deepEqual(
    identity.hostedHandoffChecklist.progressionSummary.progressions.map(
      (progression) => [
        progression.id,
        progression.proofCommand,
        progression.evidencePath,
        progression.adminProofTarget,
        progression.adminProofMode,
        progression.adminProofFixturePath,
        progression.roleUrl,
        progression.firstMissingInputId,
        progression.firstMissingCheckId,
      ],
    ),
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => [
      progression.id,
      `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run test:dev-test-game-hosted-identity-progression-admin-proof`,
      `target/dev-test-game/hosted-identity-evidence-${progression.id}.json`,
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
      progression.adminProofMode,
      progression.adminProofFixturePath,
      "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      progression.missingInputId,
      progression.checkId,
    ]),
  );
  assert.equal(
    identity.artifactSummary.progressionSummary.progressionCount,
    hostedIdentityEvidenceFamilyProgressionCases.length,
  );
  assert.deepEqual(
    identity.artifactSummary.progressionSummary.progressions.map(
      (progression) => [
        progression.id,
        progression.field,
        progression.missingInputId,
        progression.missingFixturePath,
        progression.recoveredFixturePath,
        progression.adminProofTarget,
      ],
    ),
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => [
      progression.id,
      progression.field,
      progression.missingInputId,
      progression.missingFixturePath,
      progression.recoveredFixturePath,
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
    ]),
  );
  assert.equal(identity.artifactSummary.progressionSummary.releaseReady, false);
  assert.equal(identity.artifactSummary.progressionSummary.productionReady, false);
  const hostedIdentityBlockedReceipt =
    hostedIdentityEvidenceHandoffCase().blockedReceipt;
  assert.deepEqual(identity.hostedHandoffChecklist.blockedReceipt, {
    status: hostedIdentityBlockedReceipt.status,
    command: hostedIdentityBlockedReceipt.command,
    proofTarget: hostedIdentityBlockedReceipt.proofTarget,
    nextProofTarget: hostedIdentityBlockedReceipt.nextProofTarget,
    operatorAction: hostedIdentityBlockedReceipt.operatorAction,
    localVsHostedBoundary: hostedIdentityBlockedReceipt.localVsHostedBoundary,
    missingRequiredInputs: hostedIdentityBlockedReceipt.missingRequiredInputs,
    firstMissingOperatorArtifact:
      hostedIdentityBlockedReceipt.firstMissingOperatorArtifact,
    requiredInputs: hostedIdentityBlockedReceipt.requiredInputs.map((input) => ({
      name: input.name,
      value: input.value === null ? "" : String(input.value ?? ""),
      required: input.required === true,
      purpose: input.purpose,
    })),
  });
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
  assert.deepEqual(identity.artifactSummary.roleSurfaceContractDiff, {
    status: "passed",
    architectureId: "seeded-role-url-plus-session-adapter-v1",
    mismatchCount: 0,
    mismatches: [],
  });
  assert.deepEqual(identity.artifactSummary.identityAdapterContractComparison, {
    status: "passed",
    localAdapterId: "local-production-identity-adapter-v1",
    hostedAdapterId: "local-production-identity-adapter-v1",
    localStatus: "passed",
    hostedStatus: "passed",
    roleSurfaceContractStatus: "passed",
    mismatchCount: 0,
    mismatches: [],
  });
  assert.deepEqual(identity.artifactSummary.redactedIntakePacket, {
    ...localHostedIdentityRedactedIntakePacketFixture(),
  });
  assert.deepEqual(
    identity.artifactSummary.redactedIntakePacket.sections.map((section) => [
      section.id,
      section.status,
      section.redactedEvidenceRefCount,
      section.missingInputs,
    ]),
    hostedIdentityEvidencePacketSectionDefinitions.map((section) => [
      section.field,
      "missing",
      0,
      ["status-provided", ...section.requiredInputIds, "redactedEvidenceRefs"],
    ]),
  );
  assert.deepEqual(
    identity.artifactSummarySections.map((section) => section.id),
    [
      "hosted-identity-packet",
      "hosted-identity-progression-summary",
      "hosted-identity-role-surface-contract",
      "hosted-identity-adapter-contract-comparison",
    ],
  );
  const packetSection = identity.artifactSummarySections.find(
    (section) => section.id === "hosted-identity-packet",
  );
  assert.equal(packetSection.heading, "Hosted identity packet");
  assert.deepEqual(
    packetSection.rows.slice(0, 3).map((row) => [row.id, row.testId]),
    [
      [
        "hosted-identity-packet-summary-status",
        "admin-audit-hosted-identity-packet-summary-status",
      ],
      [
        "hosted-identity-packet-summary-inputs",
        "admin-audit-hosted-identity-packet-summary-inputs",
      ],
      [
        "hosted-identity-packet-summary-redacted-refs",
        "admin-audit-hosted-identity-packet-summary-redacted-refs",
      ],
    ],
  );
  assert.deepEqual(
    packetSection.rows[3].subentries.map((subentry) => [
      subentry.id,
      subentry.testId,
      subentry.values.map((value) => value.text),
    ]),
    [
      [
        "hosted-identity-packet-input-accountLifecycle-createAccount",
        "admin-audit-hosted-identity-packet-input-accountLifecycle-createAccount",
        ["createAccount", "missing"],
      ],
      [
        "hosted-identity-packet-input-accountLifecycle-login",
        "admin-audit-hosted-identity-packet-input-accountLifecycle-login",
        ["login", "missing"],
      ],
      [
        "hosted-identity-packet-input-accountLifecycle-disableAccount",
        "admin-audit-hosted-identity-packet-input-accountLifecycle-disableAccount",
        ["disableAccount", "missing"],
      ],
      [
        "hosted-identity-packet-input-accountLifecycle-enableAccount",
        "admin-audit-hosted-identity-packet-input-accountLifecycle-enableAccount",
        ["enableAccount", "missing"],
      ],
    ],
  );
  const progressionSection = identity.artifactSummarySections.find(
    (section) => section.id === "hosted-identity-progression-summary",
  );
  assert.equal(progressionSection.heading, "Hosted identity recovery ladder");
  assert.deepEqual(
    progressionSection.rows.map((row) => row.testId).slice(0, 3),
    [
      "admin-audit-hosted-identity-progression-summary",
      `admin-audit-hosted-identity-progression-${hostedIdentityEvidenceFamilyProgressionCases[0].id}`,
      `admin-audit-hosted-identity-progression-${hostedIdentityEvidenceFamilyProgressionCases[1].id}`,
    ],
  );
  const roleSurfaceSection = identity.artifactSummarySections.find(
    (section) => section.id === "hosted-identity-role-surface-contract",
  );
  assert.deepEqual(roleSurfaceSection.rows.map((row) => row.testId), [
    "admin-audit-hosted-identity-role-surface-contract-diff-summary",
  ]);
  const adapterContractSection = identity.artifactSummarySections.find(
    (section) => section.id === "hosted-identity-adapter-contract-comparison",
  );
  assert.deepEqual(adapterContractSection.rows.map((row) => row.testId), [
    "admin-audit-hosted-identity-adapter-contract-comparison-summary",
  ]);
});

test("admin audit detail page renders descriptor artifact sections from route data", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.doesNotMatch(source, /artifactSummary\.redactedIntakePacket/);
  assert.doesNotMatch(source, /artifactSummary\.roleSurfaceContractDiff/);
  assert.doesNotMatch(source, /artifactSummary\.identityAdapterContractComparison/);
  assert.doesNotMatch(source, /artifactSummary\.adapterContract/);
  assert.doesNotMatch(source, /artifactSummary\.progressionSummary\.nextCommand/);
  assert.doesNotMatch(source, /artifactSummary\.diagnosticProofSummary/);
  assert.match(source, /row\.subentries\?\.length/);
  assert.match(source, /data-testid=\{subentry\.testId\}/);
});

test("admin audit detail page renders hosted handoff operator rows from route data", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.match(source, /hostedHandoffOperatorRows/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.operatorEvidenceGate/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.operatorProofDrilldowns/);
  assert.doesNotMatch(source, /providerBoundary/);
  assert.match(source, /data-testid=\{row\.testId\}/);
  assert.match(source, /data-testid=\{subentry\.testId\}/);
});

test("admin audit detail page renders hosted identity blocked receipt as a named group", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.match(source, /admin-audit-hosted-handoff-blocked-receipt/);
  assert.match(source, /hostedHandoffReceiptHeadings\?\.blockedReceipt/);
  assert.match(source, /firstMissingOperatorArtifact\.roleSurfaceDrilldown/);
});

test("hosted handoff receipt headings come from the route-model registry", () => {
  assert.equal(
    hostedHandoffReceiptHeadingRegistry[localAdminAuditIds.hostedEvidenceLane]
      .blockedReceipt,
    "Hosted evidence blocked receipt",
  );
  assert.equal(
    hostedHandoffReceiptHeadingRegistry[
      localAdminAuditIds.hostedIdentityEvidence
    ].blockedReceipt,
    "Hosted identity blocked receipt",
  );
  assert.equal(
    hostedHandoffReceiptHeadingRegistry[
      localAdminAuditIds.realHostedObservabilityHandoff
    ].blockedReceipt,
    "Real hosted observability blocked receipt",
  );
  assert.equal(
    hostedHandoffReceiptHeadingRegistry[
      localAdminAuditIds.hostedConcurrentRaceMatrix
    ].blockedReceipt,
    "Hosted matrix blocked receipt",
  );
  assert.equal(
    hostedHandoffReceiptHeadingsForAudit("unknown").blockedReceipt,
    "Hosted handoff blocked receipt",
  );
});

test("admin audit detail page renders hosted evidence raw-capture intake as a named blocked-receipt group", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.doesNotMatch(source, /hostedHandoffBlockedReceiptHeading/);
  assert.match(source, /hostedHandoffReceiptHeadings\?\.blockedReceipt/);
  assert.match(
    source,
    /hostedHandoffReceiptHeadings\?\.realHostedMatrixRawCaptureIntake/,
  );
  assert.match(
    source,
    /hostedHandoffReceiptHeadings\?\.firstMissingOperatorArtifact/,
  );
  assert.match(source, /realHostedMatrixRawCaptureIntake\.proofTarget/);
  assert.match(source, /firstMissingOperatorArtifact\.roleSurfaceDrilldown/);
});

test("admin audit detail page renders hosted artifact summary sections from route data", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.doesNotMatch(source, /data\.audit\.id === "local-hosted-target-preflight"/);
  assert.doesNotMatch(source, /data\.audit\.id === "local-hosted-evidence-lane"/);
  assert.doesNotMatch(source, /artifactSummary\.hostedMatrixSummary/);
  assert.doesNotMatch(source, /artifactSummary\.realHostedObservabilitySummary/);
  assert.doesNotMatch(source, /artifactSummary\.nextActionHandoffPair/);
  assert.doesNotMatch(source, /artifactSummary\.frontendSetupWorkbenchReadiness/);
  assert.match(source, /data\.audit\.artifactSummarySections\?\.length/);
  assert.match(source, /data-testid=\{section\.testId\}/);
  assert.match(source, /data-testid=\{row\.testId\}/);
  assert.match(source, /value\.emphasized/);
});

test("admin audit detail page renders hosted handoff checklist rows from route data", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.match(source, /hostedHandoffChecklistRows/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.inputs/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.inputSections/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.groups/);
  assert.doesNotMatch(source, /hostedHandoffChecklist\.blockedChecks/);
  assert.match(source, /data-testid=\{row\.testId\}/);
  assert.match(source, /data-testid=\{subentry\.testId\}/);
});

test("admin hosted-facing audit inventory carries shared handoff paths where required", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedConcurrentRaceMatrix: hostedConcurrentRaceMatrixFixture(),
    hostedOpsSignals: localHostedOpsSignalsFixture(),
    realHostedObservabilityHandoff:
      localRealHostedObservabilityHandoffFixture(),
    hostedTargetPreflight: localHostedTargetPreflightFixture(),
    hostedEvidenceLane: localHostedEvidenceLaneFixture(),
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
    hostedIdentityEvidence: localHostedIdentityEvidenceFixture(),
  });
  const hostedFacingAuditIds = Object.values(localAdminAuditIds)
    .filter((id) => id.includes("hosted"))
    .sort();
  assert.deepEqual(hostedFacingAuditIds, [
    localAdminAuditIds.hostedConcurrentRaceMatrix,
    localAdminAuditIds.hostedEvidenceLane,
    localAdminAuditIds.hostedIdentityEvidence,
    localAdminAuditIds.hostedOpsSignals,
    localAdminAuditIds.hostedTargetPreflight,
    localAdminAuditIds.realHostedObservabilityHandoff,
  ].sort());

  const auditsById = new Map(data.audit.map((item) => [item.id, item]));
  assert.deepEqual(
    hostedFacingAuditIds.filter((id) => auditsById.has(id)).sort(),
    hostedFacingAuditIds,
  );

  const requiredHandoffPaths = new Map([
    [
      localAdminAuditIds.hostedConcurrentRaceMatrix,
      buildAdminAuditHandoffPath({
        upstreamAuditId: localAdminAuditIds.nextAction,
        localCapabilityAuditId: localAdminAuditIds.raceCoverage,
        downstreamStatus: "unproven",
        downstreamCommand: hostedMatrixRealHostedEvidenceCommand,
        downstreamProofTarget: hostedMatrixExternalEvidenceProofTarget,
      }),
    ],
    [
      localAdminAuditIds.hostedIdentityEvidence,
      buildAdminAuditHandoffPath({
        upstreamAuditId: localAdminAuditIds.nextAction,
        localCapabilityAuditId: localAdminAuditIds.identityAdapter,
        downstreamStatus: "blocked",
        downstreamCommand: "npm run test:dev-test-game-hosted-identity-evidence",
        downstreamProofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
      }),
    ],
    [
      localAdminAuditIds.realHostedObservabilityHandoff,
      buildAdminAuditHandoffPath({
        upstreamAuditId: localAdminAuditIds.nextAction,
        localCapabilityAuditId: localAdminAuditIds.hostedOpsSignals,
        downstreamStatus: "blocked",
        downstreamCommand:
          "npm run test:dev-test-game-real-hosted-observability-handoff",
        downstreamProofTarget:
          "target/dev-test-game/real-hosted-observability-handoff.json",
      }),
    ],
  ]);
  const hostedAuditsWithHandoffPath = hostedFacingAuditIds
    .filter((id) => auditsById.get(id)?.handoffPath !== undefined)
    .sort();
  assert.deepEqual(
    hostedAuditsWithHandoffPath,
    [...requiredHandoffPaths.keys()].sort(),
  );
  for (const [auditId, expectedHandoffPath] of requiredHandoffPaths) {
    const handoffPath = auditsById.get(auditId)?.handoffPath;
    assert(Object.isFrozen(handoffPath));
    assert.deepEqual(Object.keys(handoffPath), [
      "upstreamAuditId",
      "upstreamLabel",
      "localCapabilityAuditId",
      "downstreamStatus",
      "downstreamCommand",
      "downstreamProofTarget",
    ]);
    assert.deepEqual(handoffPath, expectedHandoffPath);
  }
});

test("admin route data exposes local spine manifest as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    spineManifest: spineManifestFixture(),
  });

  const manifest = data.audit.find((item) => item.id === localAdminAuditIds.spineManifest);
  assert.equal(manifest.label, "Local spine manifest");
  assert.equal(manifest.status, "11 manifest checks passed");
  assert.equal(manifest.authority, "GlobalAdmin or GlobalMod");
  assert.equal(manifest.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.spineManifest, { game: "midsummer" }));
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
      localAdminAuditHandoffCheckIds.proofFreshness,
      localAdminAuditHandoffCheckIds.nextAction,
    ],
  );
  assert.deepEqual(manifest.relatedLinks, [
    {
      id: localAdminAuditIds.proofFreshness,
      label: "Proof freshness",
      href: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness, { game: "midsummer" }),
      status: "blocked",
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
    },
    {
      id: localAdminAuditIds.nextAction,
      label: "Ranked next action",
      href: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }),
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
    nextActionInspectHref: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }),
    proofFreshnessInspectHref: localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness, { game: "midsummer" }),
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local spine manifest detail data carries manifest check rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.spineManifest,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    spineManifest: spineManifestFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local spine manifest");
  assert.equal(data.audit.id, localAdminAuditIds.spineManifest);
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
      [localAdminAuditHandoffCheckIds.proofFreshness, "blocked"],
      [localAdminAuditHandoffCheckIds.nextAction, "test:dev-test-game-next-action"],
    ],
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => [link.id, link.href]),
    [
      [localAdminAuditIds.proofFreshness, localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness, { game: "midsummer" })],
      [localAdminAuditIds.nextAction, localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" })],
    ],
  );
});

test("admin route data exposes local admin spine proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    adminSpineProof: adminSpineProofFixture(),
    adminSpineTerminalBatches: adminSpineTerminalBatchesFixture(),
  });

  const adminSpine = data.audit.find((item) => item.id === localAdminAuditIds.adminSpine);
  assert.equal(adminSpine.label, "Local admin spine");
  assert.equal(adminSpine.status, "11 admin proof surfaces passed");
  assert.equal(adminSpine.authority, "GlobalAdmin or GlobalMod");
  assert.equal(adminSpine.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.adminSpine, { game: "midsummer" }));
  assert.deepEqual(
    adminSpine.checks.map((check) => check.id),
    [
      "core-loop",
      "hardening",
      "identity",
      "backup",
      "ops",
      "seed",
      "host-setup",
      "release",
      "race-coverage",
      "hosted-concurrent-race-matrix",
      "spine-manifest",
      "recovery",
      localAdminAuditHandoffCheckIds.spineManifest,
      "next-action-sequence-handoff",
    ],
  );
  assert.deepEqual(adminSpine.relatedLinks, [
    {
      id: localAdminAuditIds.spineManifest,
      label: "Spine manifest",
      href: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest, { game: "midsummer" }),
      status: "passed",
      command: "npm run test:dev-test-game-spine-manifest-admin-proof",
    },
  ]);
  assert.deepEqual(adminSpine.artifactSummary, {
    game: "game-a",
    proofCount: 11,
    batchCount: 5,
    recoveryStatus: "passed",
    refreshedCount: 11,
    nextCommand: "npm run test:dev-test-game-admin-spine",
    spineManifestInspectHref: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest, { game: "midsummer" }),
    nextActionHandoffPair: nextActionHandoffPairFixture(),
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local admin spine detail data carries aggregate proof rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.adminSpine,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    adminSpineProof: adminSpineProofFixture(),
    adminSpineTerminalBatches: adminSpineTerminalBatchesFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local admin spine");
  assert.equal(data.audit.id, localAdminAuditIds.adminSpine);
  assert.equal(data.audit.checks.length, 14);
  assert.equal(data.audit.batches.length, 5);
  assert.deepEqual(
    data.audit.batches.map((batch) => [
      batch.id,
      batch.status,
      batch.caseCount,
      batch.sharedFrontendSession,
      batch.sharedChromiumSession,
    ]),
    [
      [
        "aggregate-pre-release-admin-proof-batch",
        "passed",
        7,
        true,
        true,
      ],
      [
        "aggregate-release-and-hosted-admin-proof-batch",
        "passed",
        4,
        true,
        true,
      ],
      [
        "terminal-admin-proof-batch",
        "passed",
        3,
        true,
        true,
      ],
      [
        "terminal-hosted-identity-next-action-admin-proof-batch",
        "passed",
        1,
        true,
        true,
      ],
      [
        "terminal-refresh-admin-proof-batch",
        "passed",
        2,
        true,
        true,
      ],
    ],
  );
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["core-loop", "passed"],
      ["hardening", "passed"],
      ["identity", "passed"],
      ["backup", "passed"],
      ["ops", "passed"],
      ["seed", "passed"],
      ["host-setup", "passed"],
      ["release", "passed"],
      ["race-coverage", "passed"],
      ["hosted-concurrent-race-matrix", "passed"],
      ["spine-manifest", "passed"],
      ["recovery", "passed"],
      [localAdminAuditHandoffCheckIds.spineManifest, "passed"],
      ["next-action-sequence-handoff", "passed:passed"],
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
      id: localAdminAuditIds.spineManifest,
      label: "Spine manifest",
      href: localAdminAuditRoleUrl(localAdminAuditIds.spineManifest, { game: "midsummer" }),
      status: "passed",
      command: "npm run test:dev-test-game-spine-manifest-admin-proof",
    },
  ]);
});

test("admin route data exposes local proof graph as a native audit row", async () => {
  const proofGraph = proofGraphFixture();
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofGraph,
  });

  const graph = data.audit.find((item) => item.id === localAdminAuditIds.proofGraph);
  assert.equal(graph.label, "Local proof graph");
  assert.equal(
    graph.status,
    `${proofGraph.summary.nodeCount} proof nodes, ${proofGraph.summary.edgeCount} edges`,
  );
  assert.equal(graph.authority, "GlobalAdmin or GlobalMod");
  assert.equal(graph.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, { game: "midsummer" }));
  assert.deepEqual(
    graph.checks.map((check) => [check.id, check.status]),
    expectedProofGraphCheckRows(proofGraph),
  );
  assert.deepEqual(
    graph.relatedLinks.map((link) => [link.id, link.href]),
    expectedProofGraphRelatedLinkRows(proofGraph, { game: "midsummer" }),
  );
  assert.deepEqual(
    graph.relatedLinks.find((link) => link.id === "next-action-sequence-handoff"),
    {
      id: "next-action-sequence-handoff",
      label: "Next action handoff",
      href: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, {
        game: "midsummer",
      }),
      status: "passed",
      command: "npm run test:dev-test-game-next-action-admin-proof",
    },
  );
  assert.deepEqual(
    graph.relatedLinks
      .filter((link) => link.id.startsWith("admin-proof:"))
      .map((link) => [link.id, link.href]),
    adminProofDestinationRequirementRoleRows({ game: "midsummer" }).map(
      ({ linkId, roleUrl }) => [linkId, roleUrl],
    ),
  );
  assert.deepEqual(
    graph.artifactSummary,
    normalizeLocalProofGraphArtifactSummary(proofGraph),
  );
  assert.deepEqual(graph.artifactSummary.diagnosticProofSummary, {
    ...proofGraph.summary.diagnosticProofSummary,
  });
  assert.deepEqual(
    graph.artifactSummary.productionFeatureDestinationSummary,
    proofGraph.summary.productionFeatureDestinationSummary,
  );
  assert.deepEqual(
    graph.artifactSummary.productionFeatureDestinationSummary
      .hostedEvidenceProgressionSummary,
    hostedEvidenceProgressionHandoffSummary(),
  );
  assert.deepEqual(
    graph.artifactSummary.productionFeatureDestinationSummary.rows
      .filter((row) => row.id.startsWith("hosted-evidence-progression:"))
      .map((row) => row.progressionId),
    hostedEvidenceProgressionHandoffSummary().progressionIds,
  );
  assert.deepEqual(
    graph.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "diagnostic-proof-summary",
        "Diagnostic non-terminal proofs",
        "admin-audit-detail-diagnostic-proof-summary",
        proofGraph.summary.diagnosticProofSummary.rows.map((row) => [
          row.id,
          `admin-audit-diagnostic-proof-summary-${row.id}`,
          [
            ["label", row.label, true],
            ["status", row.status, false],
            ["diagnosticReason", row.diagnosticReason, false],
            ["artifact", row.artifact, false],
            [
              "promotesFreshness",
              row.promotesFreshness
                ? "freshness-promoting"
                : "non-freshness-promoting",
              false,
            ],
            [
              "terminalArtifact",
              row.terminalArtifact
                ? "terminal artifact"
                : "non-terminal artifact",
              false,
            ],
          ],
        ]),
      ],
    ],
  );
});

test("admin local proof graph detail data carries graph node rows", async () => {
  const proofGraph = proofGraphFixture();
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.proofGraph,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofGraph,
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local proof graph");
  assert.equal(data.audit.id, localAdminAuditIds.proofGraph);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    expectedProofGraphCheckRows(proofGraph),
  );
  const hostedIdentityReceiptRow = data.audit.checks.find(
    (check) =>
      check.id ===
      hostedIdentityTerminalReceiptArtifactCase.rowId,
  );
  assert.equal(
    hostedIdentityReceiptRow?.status,
    hostedIdentityTerminalReceiptArtifactCase.status,
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => [link.id, link.href]),
    expectedProofGraphRelatedLinkRows(proofGraph, { game: "midsummer" }),
  );
  assert.equal(
    data.audit.relatedLinks.find(
      (link) => link.id === "next-action-sequence-handoff",
    )?.href,
    localAdminAuditRoleUrl(localAdminAuditIds.nextAction, {
      game: "midsummer",
    }),
  );
});

test("admin audit detail page renders hosted evidence progression destinations as a named group", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.match(source, /hostedEvidenceProgressionDestinationRows/);
  assert.match(
    source,
    /admin-audit-detail-hosted-evidence-progression-destination-summary/,
  );
  assert.match(source, /Hosted evidence recovery ladder/);
  assert.match(
    source,
    /admin-audit-production-feature-destination-summary-\$\{row\.id\}/,
  );
});

test("admin local proof graph detail keeps duplicate terminal receipt proof ids inspectable", async () => {
  const proofGraph = proofGraphWithDuplicateTerminalReceiptProofIds();
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.proofGraph,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofGraph,
  });

  const receiptRows = data.audit.checks.filter((check) =>
    check.id.startsWith("receipt-artifact:admin-spine-terminal-batches:"),
  );
  assert.equal(
    new Set(receiptRows.map((row) => row.id)).size,
    receiptRows.length,
  );
  assert.deepEqual(
    receiptRows.map((row) => [row.id, row.status]),
    [
      [
        "receipt-artifact:admin-spine-terminal-batches:proof-graph:terminal-admin-proof-batch",
        "proof-graph:Terminal admin proof batch:target/dev-test-game/proof-graph-admin-proof.json",
      ],
      [
        "receipt-artifact:admin-spine-terminal-batches:proof-freshness:terminal-admin-proof-batch",
        "proof-freshness:Terminal admin proof batch:target/dev-test-game/proof-freshness-admin-proof.json",
      ],
      [
        "receipt-artifact:admin-spine-terminal-batches:next-action:terminal-admin-proof-batch",
        "next-action:Terminal admin proof batch:target/dev-test-game/next-action-admin-proof.json",
      ],
      [
        hostedIdentityTerminalReceiptArtifactCase.rowId,
        hostedIdentityTerminalReceiptArtifactCase.status,
      ],
      [
        "receipt-artifact:admin-spine-terminal-batches:proof-freshness:terminal-refresh-admin-proof-batch",
        "proof-freshness:Terminal refresh admin proof batch:target/dev-test-game/proof-freshness-admin-proof.json",
      ],
      [
        "receipt-artifact:admin-spine-terminal-batches:next-action:terminal-refresh-admin-proof-batch",
        "next-action:Terminal refresh admin proof batch:target/dev-test-game/next-action-admin-proof.json",
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

  const raceCoverage = data.audit.find((item) => item.id === localAdminAuditIds.raceCoverage);
  assert.equal(raceCoverage.label, "Local race coverage");
  assert.equal(raceCoverage.status, "3 race cells passed");
  assert.equal(raceCoverage.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    raceCoverage.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.raceCoverage, { game: "midsummer" }),
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
    audit: localAdminAuditIds.raceCoverage,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    raceCoverage: raceCoverageFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local race coverage");
  assert.equal(data.audit.id, localAdminAuditIds.raceCoverage);
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
    (item) => item.id === localAdminAuditIds.hostedConcurrentRaceMatrix,
  );
  assert.equal(matrix.label, "Local hosted matrix");
  assert.equal(matrix.status, "3 hosted-like race cells passed");
  assert.equal(matrix.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    matrix.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix, { game: "midsummer" }),
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
      [localAdminAuditIds.raceCoverage, localAdminAuditRoleUrl(localAdminAuditIds.raceCoverage, { game: "midsummer" })],
      [localAdminAuditIds.nextAction, localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" })],
    ],
  );
  assert.deepEqual(matrix.handoffPath, {
    upstreamAuditId: localAdminAuditIds.nextAction,
    upstreamLabel: "Ranked next action",
    localCapabilityAuditId: localAdminAuditIds.raceCoverage,
    downstreamStatus: "unproven",
    downstreamCommand: hostedMatrixRealHostedEvidenceCommand,
    downstreamProofTarget: hostedMatrixExternalEvidenceProofTarget,
  });
  assert.deepEqual(
    matrix.reconnectLanes.map((lane) => [lane.id, lane.status]),
    hostedMatrixReconnectLaneIds.map((laneId) => [laneId, "passed"]),
  );
  assert.deepEqual(
    matrix.staleConflictLanes.map((lane) => [lane.id, lane.status]),
    hostedMatrixStaleConflictLaneIds.map((laneId) => [laneId, "passed"]),
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
    hostedMatrixSummary: {
      status: "passed",
      cellCount: 3,
      passedCellCount: 3,
      reloadCoveredCellCount: 3,
      reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
      staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
      hostedEvidenceStatus: "unproven",
      hostedDeploymentStatus: "unproven",
      hostedEvidenceMode: "not_configured",
      missingHostedInputCount: 3,
      missingHostedInputIds: [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "FMARCH_HOSTED_MATRIX_API_URL",
        "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
      ],
      localVsHostedBoundary:
        "Local hosted-like matrix evidence cannot satisfy real hosted race evidence.",
    },
    game: "00000000-0000-0000-0000-000000000001",
    cellCount: 3,
    passedCellCount: 3,
    reloadCoveredCellCount: 3,
    reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
    staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
    roleSurfaceCount: 2,
    hostedEvidenceStatus: "not_configured",
    hostedEvidenceMode: "not_configured",
    localDemoHostedEvidenceStatus: "not_applicable",
    realHostedEvidenceStatus: "unproven",
    realHostedDeploymentStatus: "unproven",
    externalHostedEvidenceStatus: "not_configured",
    realHostedEvidenceCommand: hostedMatrixRealHostedEvidenceCommand,
    realHostedEvidenceProofTarget:
      "target/dev-test-game/hosted-matrix-external.json",
    nextCommand: "test:dev-test-game-hosted-concurrent-race-matrix",
    releaseReady: false,
    productionReady: false,
  });
  assert.deepEqual(
    matrix.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "hosted-matrix-summary",
        "Hosted race matrix",
        "admin-audit-detail-hosted-matrix-summary",
        [
          [
            "hosted-matrix-summary-coverage",
            "admin-audit-hosted-matrix-summary-coverage",
            [
              ["status", "passed", true],
              ["passedCells", "3/3 cells passed", false],
              ["reloadCoverage", "3/3 reloads covered", false],
              [
                "reconnectLanes",
                `${hostedMatrixReconnectLaneIds.length} reconnect lanes`,
                false,
              ],
              [
                "staleConflictLanes",
                `${hostedMatrixStaleConflictLaneIds.length} stale conflict lanes`,
                false,
              ],
            ],
          ],
          [
            "hosted-matrix-summary-hosted-evidence",
            "admin-audit-hosted-matrix-summary-hosted-evidence",
            [
              ["hostedEvidenceStatus", "unproven", true],
              ["hostedDeploymentStatus", "unproven", false],
              ["hostedEvidenceMode", "not_configured", false],
            ],
          ],
          [
            "hosted-matrix-summary-missing-inputs",
            "admin-audit-hosted-matrix-summary-missing-inputs",
            [
              ["missingHostedInputCount", "3 missing hosted inputs", true],
              [
                "missingHostedInputIds",
                "FMARCH_HOSTED_MATRIX_FRONTEND_URL, FMARCH_HOSTED_MATRIX_API_URL, FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
                false,
              ],
              [
                "localVsHostedBoundary",
                "Local hosted-like matrix evidence cannot satisfy real hosted race evidence.",
                false,
              ],
            ],
          ],
        ],
      ],
    ],
  );
});

test("admin local hosted matrix detail data carries progress and gap rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedConcurrentRaceMatrix: hostedConcurrentRaceMatrixFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local hosted matrix");
  assert.equal(data.audit.id, localAdminAuditIds.hostedConcurrentRaceMatrix);
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
      ["command", hostedMatrixRealHostedEvidenceCommand, true],
      ["proof-target", hostedMatrixExternalEvidenceProofTarget, true],
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
        hostedMatrixRawEvidenceContractSummary(),
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
  assert.equal(
    data.audit.hostedHandoffChecklist.preflightStatus,
    "not_configured",
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.command,
    hostedMatrixRealHostedEvidenceCommand,
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedChecks.map((item) => [
      item.id,
      item.status,
    ]),
    hostedMatrixRealHostedHandoffChecklist().blockedCheckIds.map((id) => [
      id,
      "blocked",
    ]),
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
    [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
  );
  assert.match(
    data.audit.hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary,
    /cannot satisfy real hosted race evidence/,
  );
  assert.deepEqual(data.audit.artifactSummary.hostedMatrixSummary, {
    status: "passed",
    cellCount: 3,
    passedCellCount: 3,
    reloadCoveredCellCount: 3,
    reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
    staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
    hostedEvidenceStatus: "unproven",
    hostedDeploymentStatus: "unproven",
    hostedEvidenceMode: "not_configured",
    missingHostedInputCount: 3,
    missingHostedInputIds: [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
    localVsHostedBoundary:
      "Local hosted-like matrix evidence cannot satisfy real hosted race evidence.",
  });
  assert.deepEqual(
    data.audit.reconnectLanes.map((lane) => [lane.id, lane.status]),
    hostedMatrixReconnectLaneIds.map((laneId) => [laneId, "passed"]),
  );
  assert.deepEqual(
    data.audit.staleConflictLanes.map((lane) => [lane.id, lane.status]),
    hostedMatrixStaleConflictLaneIds.map((laneId) => [laneId, "passed"]),
  );
});

test("admin route data exposes local proof freshness as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofFreshness: proofFreshnessFixture(),
    nextAction: nextActionFixture(),
  });

  const freshness = data.audit.find((item) => item.id === localAdminAuditIds.proofFreshness);
  assert.equal(freshness.label, "Local proof freshness");
  assert.equal(freshness.status, "25 fresh, 0 stale, 0 missing");
  assert.equal(freshness.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    freshness.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness, { game: "midsummer" }),
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
      "host-setup-role",
      "host-setup-admin",
      "release",
      "spine-manifest-admin",
      "admin-spine",
      "admin-spine-admin",
      "proof-graph",
      "proof-graph-admin",
      "hosted-evidence-lane",
      "hosted-evidence-lane-admin",
      "hosted-evidence-lane-demo",
      localAdminAuditHandoffCheckIds.nextAction,
    ],
  );
  assert.deepEqual(freshness.relatedLinks, [
    {
      id: localAdminAuditIds.nextAction,
      label: "Ranked next action",
      href: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }),
      status: `ready: ${LOCAL_RACE_COMMAND}`,
      command: LOCAL_RACE_COMMAND,
    },
  ]);
  assert.deepEqual(freshness.artifactSummary, {
    artifactCount: 25,
    freshCount: 25,
    staleCount: 0,
    missingCount: 0,
    maxAgeHours: 24,
    nextActionCommand: LOCAL_RACE_COMMAND,
    nextActionInspectHref: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }),
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local proof freshness detail data carries stale and missing rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.proofFreshness,
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
  assert.equal(data.audit.id, localAdminAuditIds.proofFreshness);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["session", "fresh"],
      ["proof-run", "stale"],
      ["backup-restore", "missing"],
      [
        localAdminAuditHandoffCheckIds.nextAction,
        "blocked: DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      ],
    ],
  );
  assert.deepEqual(data.audit.relatedLinks, [
    {
      id: localAdminAuditIds.nextAction,
      label: "Ranked next action",
      href: localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }),
      status:
        "blocked: DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
      command:
        "DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch npm run test:dev-test-game-live",
    },
  ]);
});

test("admin route data exposes local next action as a native audit row", async () => {
  const nextActionHandoffPair = nextActionHandoffPairFixture();
  const nextActionInput = nextActionFixture({
    terminalBatchGraph: terminalBatchGraphFixture(),
    nextActionHandoffPair,
    privateChannelRecoveryGraph: privateChannelRecoveryGraphFixture(),
    replacementActionRecoveryGraph:
      replacementActionRecoveryGraphFixture(),
    replacementHandoffRecoveryGraph:
      replacementHandoffRecoveryGraphFixture(),
    replacementPrivateRecoveryGraph:
      replacementPrivateRecoveryGraphFixture(),
  });
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionInput,
    proofGraph: proofGraphFixture(),
  });

  const nextAction = data.audit.find(
    (item) => item.id === localAdminAuditIds.nextAction,
  );
  assert.equal(nextAction.label, "Local next action");
  assert.equal(nextAction.status, `ready: ${LOCAL_RACE_COMMAND}`);
  assert.equal(nextAction.authority, "GlobalAdmin or GlobalMod");
  assert.equal(nextAction.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.nextAction, { game: "midsummer" }));
  assert.deepEqual(
    nextAction.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["release-readiness-unproven", "ready"],
      ["hosted-concurrent-race-matrix", "unproven"],
      ...normalizeLocalNextActionSelectedProofGraphCheckRows({
        selectedProofGraphNode: {
          id: "admin-proof:hosted-concurrent-race-matrix",
          status: "passed",
          proofCommand: LOCAL_RACE_COMMAND,
          proofTarget: HOSTED_MATRIX_PROOF_TARGET,
          auditId: localAdminAuditIds.hostedConcurrentRaceMatrix,
        },
        selectedProofGraphNodeStatus:
          "passed: npm run test:dev-test-game-hosted-concurrent-race-matrix -> target/dev-test-game/hosted-concurrent-race-matrix.json",
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionSelectedSpineCheckRows({
        selectedProductionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
        selectedSpineTarget: featureSpineTargetFixture(),
        selectedSpineDrilldown: featureSpineDrilldownFixture(),
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows({
        selectedProductionFeatureGraph:
          selectedProductionFeatureGraphFixture(),
      }).map((check) => [check.id, check.status]),
      ["terminal-proof-batch-graph", "passed:3 edges"],
      ["next-action-sequence-handoff", "passed:passed"],
      ["private-channel-recovery-graph", "passed:4 lanes"],
      ["replacement-action-recovery-graph", "passed:3 lanes"],
      [
        "replacement-handoff-recovery-graph",
        `passed:${replacementHandoffRecoveryLaneIds.length} lanes`,
      ],
      ["replacement-private-recovery-graph", "passed:6 lanes"],
      ["selection-trace", "0 candidates"],
      ["release-readiness-selection-trace", "1 buildable candidates"],
      ["release-readiness-hosted-concurrent-race-matrix", "selected:unproven"],
      ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
        seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture(),
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
        proofGraphDiagnosticSummaryTrace: proofGraphDiagnosticSummaryTraceFixture(),
      }).map((check) => [check.id, check.status]),
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
  assert.deepEqual(
    nextAction.relatedLinks,
    normalizeLocalNextActionRelatedLinks({
      game: "midsummer",
      command: LOCAL_RACE_COMMAND,
      actionStatus: "ready",
      selectedProofGraphNode: {
        id: "admin-proof:hosted-concurrent-race-matrix",
        status: "passed",
        proofCommand: LOCAL_RACE_COMMAND,
      },
      selectedProductionFeatureGraph:
        selectedProductionFeatureGraphFixture(),
      unproven: {
        id: "hosted-concurrent-race-matrix",
        status: "unproven",
      },
      unprovenRoleUrl:
        localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix),
      unprovenProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
    }),
  );
  assert.deepEqual(
    nextAction.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "next-action-handoff-pair",
        "Next action handoff",
        "admin-audit-detail-next-action-handoff-pair",
        [
          [
            "summary",
            "admin-audit-next-action-handoff-pair-summary",
            [
              ["status", nextActionHandoffPair.status, true],
              ["id", nextActionHandoffPair.id, false],
              ["proofBoundary", nextActionHandoffPair.proofBoundary, false],
            ],
          ],
          ...[
            nextActionHandoffPair.defaultSequenceBlocker,
            nextActionHandoffPair.hostedIdentityPredicate,
          ].map((handoff) => [
            handoff.id,
            `admin-audit-next-action-handoff-pair-${handoff.id}`,
            [
              ["label", handoff.label, true],
              ["status", handoff.status, false],
              ["proofId", handoff.proofId, false],
              ["expectedReason", handoff.expectedReason, false],
              ["expectedActionStatus", handoff.expectedActionStatus, false],
              ["batchLabel", handoff.batchLabel, false],
              ["nextActionPath", handoff.nextActionPath, false],
              ["adminProofPath", handoff.adminProofPath, false],
            ],
          ]),
        ],
      ],
    ],
  );
  assert.deepEqual(nextAction.artifactSummary, {
    command: LOCAL_RACE_COMMAND,
    reason: "release-readiness-unproven",
    actionStatus: "ready",
    selectedArtifactId: "",
    selectedArtifactStatus: "",
    selectedArtifactProofTarget: "",
    selectedArtifactRoleUrl: "",
    selectedArtifactRoleHref: "",
    selectedArtifactBuildSlice: "",
    selectedArtifactRequiredEvidence: "",
    ...normalizeLocalNextActionGeneratedSummary(nextActionInput),
    selectionTrace: {
      strategy: "development-spine-priority",
      candidateCount: 0,
      selectedArtifactId: null,
      candidates: [],
    },
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
    selectedProofBoundary: "",
    selectedHostedEvidenceMode: "",
    selectedRealHostedEvidenceStatus: "",
    selectedRealHostedEvidenceCommand: "",
    selectedRealHostedEvidenceProofTarget: "",
    selectedProductionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
    selectedSpineDrilldown: featureSpineDrilldownFixture(),
    selectedSpineTarget: featureSpineTargetFixture(),
    selectedRoleUrl:
      localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix),
    selectedRoleHref:
      localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix, { game: "midsummer" }),
    selectedProofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
    selectedProofGraphNodeStatus: "passed",
    selectedProofGraphNodeProofCommand: LOCAL_RACE_COMMAND,
    selectedProofGraphNodeRoleUrl:
      localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix),
    selectedProofGraphNodeAuditId: localAdminAuditIds.hostedConcurrentRaceMatrix,
    selectedProofGraphNodeHref: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, { game: "midsummer" }),
    terminalProofBatchGraph: {
      nodeId: "admin-spine-terminal-batches",
      status: "passed",
      proofTarget: "target/dev-test-game/admin-spine-terminal-batches.json",
      roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
      batchCount: 3,
      edgeCount: 3,
      edgeTargets: ["proof-graph", "proof-freshness", "next-action"],
      receiptArtifacts: terminalBatchReceiptArtifactsFixture(),
    },
    nextActionHandoffPair: nextActionHandoffPairFixture(),
    privateChannelRecoveryGraph: privateChannelRecoveryGraphFixture(),
    replacementActionRecoveryGraph: replacementActionRecoveryGraphFixture(),
    replacementHandoffRecoveryGraph: replacementHandoffRecoveryGraphFixture(),
    replacementPrivateRecoveryGraph: replacementPrivateRecoveryGraphFixture(),
    stabilitySource: "",
    stabilityBuildSlice: "",
    stabilityProofTarget: "",
    stabilityTrace: buildProofStabilityTrace({
      status: "clean",
      hostConfirmClicks: 55,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 1,
      events: [],
    }),
    seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture(),
    proofGraphDiagnosticSummaryStatus: "recorded",
    proofGraphDiagnosticCount: 1,
    proofGraphDiagnosticPromotesFreshnessCount: 0,
    proofGraphDiagnosticTerminalArtifactCount: 0,
    proofGraphDiagnosticSummaryTrace: proofGraphDiagnosticSummaryTraceFixture(),
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
          proofBoundary: "",
          roleUrl:
            localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix),
          proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
          productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
          spineDrilldown: featureSpineDrilldownFixture(),
          spineTarget: featureSpineTargetFixture(),
          selectedProductionFeatureGraph: {
            nodeId: "production-feature:player-action-submission",
            status: "passed",
            sourceNodeId: "admin-proof:core-loop",
            edgeFrom: "admin-proof:core-loop",
            edgeTo: "production-feature:player-action-submission",
            edgeRelationship: "proves-production-feature",
            roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
            targetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
            edgeTargetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
            selectedSpineTargetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
            targetRoleUrlMatchesSelectedSpineTarget: true,
            browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
            proofTarget: "target/dev-test-game/release-readiness-checklist.json",
            coverageDecision: featureSpineTargetFixture().coverageDecision,
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

test("admin route data exposes recovery-hook spine drilldowns", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      unproven: invalidActionRecoveryHostedConcurrentRaceMatrixUnprovenFixture({
        proofTarget: HOSTED_MATRIX_PROOF_TARGET,
        spineRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
        browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
      }),
    }),
    proofGraph: proofGraphFixture(),
  });

  const nextAction = data.audit.find(
    (item) => item.id === localAdminAuditIds.nextAction,
  );
  const checks = new Map(
    nextAction.checks.map((check) => [check.id, check.status]),
  );
  assert.equal(
    checks.get("selected-feature-spine-declaration"),
    "invalid-action-recovery:d02-n02/recovery-hook:invalidActionReject/d02-n02-actionPlayer/invalid-action-recovery",
  );
  assert.equal(
    checks.get("selected-spine-target"),
    "d02-n02/recovery-hook:invalidActionReject/d02-n02-actionPlayer/invalid-action-recovery",
  );
  assert.equal(
    checks.get("selected-spine-drilldown"),
    "invalid-action-recovery:d02-n02/recovery-hook:invalidActionReject/d02-n02-actionPlayer/invalid-action-recovery",
  );
  assert.equal(
    checks.get("selected-spine-admin-check"),
    "invalid-action-recovery",
  );
  assert.equal(
    checks.get("selected-spine-source-artifact"),
    featureSpineTargetFixture().sourceProofArtifact,
  );
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

  const nextAction = data.audit.find(
    (item) => item.id === localAdminAuditIds.nextAction,
  );
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
      ...normalizeLocalNextActionLocalReadinessDependencyCheckRows({
        localReadinessDependencyTrace: localReadinessDependencyTraceFixture({
          localCheck,
          command: LOCAL_PROOF_GRAPH_COMMAND,
        }),
      }).map((check) => [check.id, check.status]),
    ],
  );
  assert.deepEqual(
    nextAction.relatedLinks,
    normalizeLocalNextActionRelatedLinks({
      game: "midsummer",
      command: LOCAL_PROOF_GRAPH_COMMAND,
      actionStatus: "blocked",
      localCheck,
      localCheckRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
    }),
  );
  assert.equal(
    nextAction.artifactSummary.selectedLocalCheckRoleHref,
    localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, { game: "midsummer" }),
  );
});

test("admin route data exposes proof graph next-action handoff dependency", async () => {
  const localCheck = proofGraphNextActionHandoffLocalCheckFixture();
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

  const nextAction = data.audit.find(
    (item) => item.id === localAdminAuditIds.nextAction,
  );
  assert.deepEqual(
    nextAction.checks
      .filter((check) =>
        [
          "release-readiness-local-check-missing",
          "local-proof-graph-next-action-handoff",
          "local-readiness-dependency-trace",
          "local-readiness-dependency-local-proof-graph-next-action-handoff",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["release-readiness-local-check-missing", "blocked"],
      ["local-proof-graph-next-action-handoff", "missing"],
      ...normalizeLocalNextActionLocalReadinessDependencyCheckRows({
        localReadinessDependencyTrace: localReadinessDependencyTraceFixture({
          localCheck,
          command: LOCAL_PROOF_GRAPH_COMMAND,
        }),
      }).map((check) => [check.id, check.status]),
    ],
  );
  assert.deepEqual(
    nextAction.relatedLinks.find((link) => link.id === localCheck.id),
    {
      id: "local-proof-graph-next-action-handoff",
      label: "local-proof-graph-next-action-handoff",
      href: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph, {
        game: "midsummer",
      }),
      status: "missing",
      command: LOCAL_PROOF_GRAPH_COMMAND,
    },
  );
  assert.equal(
    nextAction.artifactSummary.selectedLocalCheckId,
    "local-proof-graph-next-action-handoff",
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

  const nextAction = data.audit.find((item) => item.id === localAdminAuditIds.nextAction);
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
      ...normalizeLocalNextActionSeedProofLaneCoverageCheckRows({
        seedProofLaneCoverage,
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
        seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture({
          seedProofLaneCoverage,
        }),
      }).map((check) => [check.id, check.status]),
    ],
  );
  assert.deepEqual(
    nextAction.relatedLinks,
    normalizeLocalNextActionRelatedLinks({
      game: "midsummer",
      command: SEED_FIXTURE_COMMAND,
      actionStatus: "blocked",
      seedProofLaneCoverage,
      seedProofLaneCoverageRoleUrl:
        localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures),
    }),
  );
  assert.equal(
    nextAction.artifactSummary.selectedSeedProofLaneCoverageRoleHref,
    localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures, { game: "midsummer" }),
  );
  assert.deepEqual(
    nextAction.artifactSummary.selectedSeedProofLaneCoverageUnclassifiedLaneIds,
    ["new-production-proof-lane"],
  );
});

test("admin route data exposes proof graph destination-summary drift next action", async () => {
  const proofGraphDestinationSummary =
    proofGraphDestinationSummaryActionFixture();
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofFreshness: proofFreshnessFixture(),
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "proof-graph-destination-summary-drift",
      command: PROOF_GRAPH_REGEN_COMMAND,
      proofGraphDestinationSummary,
      unproven: undefined,
      releaseReadinessTrace: releaseReadinessTraceFixture({ unproven: undefined }),
    }),
  });

  const nextAction = data.audit.find((item) => item.id === localAdminAuditIds.nextAction);
  assert.equal(nextAction.status, `blocked: ${PROOF_GRAPH_REGEN_COMMAND}`);
  assert.deepEqual(
    nextAction.checks
      .filter((check) =>
        [
          "proof-graph-destination-summary-drift",
          "proof-graph-destination-summary",
          "proof-graph-destination-summary-drift-count",
          ...proofGraphDestinationSummaryTraceCheckIds(
            proofGraphDestinationSummaryTraceFixture({
              proofGraphDestinationSummary,
            }),
          ),
          ...proofGraphDiagnosticSummaryCheckIds(
            proofGraphDiagnosticSummaryTraceFixture(),
          ),
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["proof-graph-destination-summary-drift", "blocked"],
      ...normalizeLocalNextActionProofGraphDestinationSummaryCheckRows({
        proofGraphDestinationSummary,
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionProofGraphDestinationSummaryTraceCheckRows({
        proofGraphDestinationSummaryTrace:
          proofGraphDestinationSummaryTraceFixture({
            proofGraphDestinationSummary,
          }),
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
        proofGraphDiagnosticSummaryTrace: proofGraphDiagnosticSummaryTraceFixture(),
      }).map((check) => [check.id, check.status]),
    ],
  );
  assert.deepEqual(
    nextAction.relatedLinks,
    normalizeLocalNextActionRelatedLinks({
      game: "midsummer",
      command: PROOF_GRAPH_REGEN_COMMAND,
      actionStatus: "blocked",
      proofGraphDestinationSummary,
    }),
  );
  assert.equal(
    nextAction.artifactSummary.selectedProofGraphDestinationSummaryStatus,
    "drift",
  );
  assert.equal(
    nextAction.artifactSummary.selectedProofGraphDestinationSummaryDriftCount,
    1,
  );
  assert.equal(
    nextAction.artifactSummary.proofGraphDiagnosticSummaryStatus,
    "recorded",
  );
  assert.equal(nextAction.artifactSummary.proofGraphDiagnosticCount, 1);
  assert.equal(
    nextAction.artifactSummary.proofGraphDiagnosticPromotesFreshnessCount,
    0,
  );
  assert.equal(
    nextAction.artifactSummary.proofGraphDiagnosticTerminalArtifactCount,
    0,
  );
  const freshness = data.audit.find(
    (item) => item.id === localAdminAuditIds.proofFreshness,
  );
  assert.deepEqual(
    freshness.checks
      .filter((check) =>
        [
          "next-action-proof-graph-destination-summary-drift",
          "next-action-proof-graph-destination-summary",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["next-action-proof-graph-destination-summary-drift", "blocked"],
      ["next-action-proof-graph-destination-summary", "drift:1 drift"],
    ],
  );
  assert.equal(
    freshness.artifactSummary.nextActionProofGraphDestinationSummaryDriftCount,
    1,
  );
});

test("admin local next action detail data carries hosted evidence handoff checklist", async () => {
  const unproven = hostedEvidenceLaneUnprovenFixture();
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      command: "npm run test:dev-test-game-hosted-evidence-lane",
      unproven,
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, localAdminAuditIds.nextAction);
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
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
    [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
  );
  assert.deepEqual(
    hostedHandoffChecklistRowsForAssertion(data.audit.hostedHandoffChecklistRows),
    expectedHostedHandoffChecklistRows(data.audit.hostedHandoffChecklist),
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.blockedReceipt.localVsHostedBoundary,
    "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
  );
  assert.equal(
    data.audit.artifactSummary.selectedRoleHref,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane, { game: "midsummer" }),
  );
});

test("admin local next action detail data carries hosted identity progression ladder", async () => {
  const unproven = {
    id: "hosted-production-identity",
    status: "unproven",
    requiredEvidence: "Hosted account lifecycle",
    buildSlice: "Run the hosted identity evidence intake.",
    proofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
    proofGraphNodeId: "admin-proof:hosted-identity-evidence",
    actionStatus: "ready",
    productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
    spineDrilldown: featureSpineDrilldownFixture(),
    spineTarget: featureSpineTargetFixture(),
    hostedHandoffChecklist: hostedIdentityEvidenceHandoffCase(),
    hostedIdentityFamilyBatch: HOSTED_IDENTITY_FAMILY_BATCH,
    hostedIdentityProofGraphEdges: HOSTED_IDENTITY_PROOF_GRAPH_EDGES,
  };
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      command: HOSTED_IDENTITY_EVIDENCE_COMMAND,
      unproven,
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, localAdminAuditIds.nextAction);
  assert.equal(data.audit.status, `ready: ${HOSTED_IDENTITY_EVIDENCE_COMMAND}`);
  assert.deepEqual(
    data.audit.checks
      .filter((check) =>
        [
          "hosted-production-identity",
          "selected-next-command",
          "selected-proof-target",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["hosted-production-identity", "unproven"],
      ["selected-next-command", HOSTED_IDENTITY_EVIDENCE_COMMAND],
      ["selected-proof-target", HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET],
    ],
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.progressionSummary.progressions.map(
      (progression) => [
        progression.id,
        progression.proofCommand,
        progression.adminProofTarget,
        progression.adminProofMode,
        progression.adminProofFixturePath,
        progression.roleUrl,
        progression.firstMissingInputId,
      ],
    ),
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => [
      progression.id,
      `FMARCH_HOSTED_IDENTITY_PROGRESSION_ID=${progression.id} npm run test:dev-test-game-hosted-identity-progression-admin-proof`,
      hostedIdentityEvidenceProgressionAdminProofPath(progression.id),
      progression.adminProofMode,
      progression.adminProofFixturePath,
      localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
      progression.missingInputId,
    ]),
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.operatorEvidenceGate,
    normalizedHostedIdentityOperatorGateFixture(),
  );
  assert.deepEqual(
    hostedHandoffChecklistRowsForAssertion(data.audit.hostedHandoffOperatorRows),
    expectedHostedHandoffOperatorRows(data.audit.hostedHandoffChecklist),
  );
  assert.equal(data.audit.artifactSummary.command, HOSTED_IDENTITY_EVIDENCE_COMMAND);
  assert.equal(
    data.audit.artifactSummary.selectedProofTarget,
    HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  );
});

test("admin local next action detail data carries hosted identity operator recommendation", async () => {
  const unproven = {
    id: "hosted-production-identity",
    status: "unproven",
    requiredEvidence: "Hosted account lifecycle",
    buildSlice:
      "Run the opt-in hosted identity operator spine; it attaches the target-local redacted operator packet to the admin proof and refreshes readiness through the operator predicate without claiming live hosted traffic, release readiness, or production readiness.",
    proofTarget: HOSTED_IDENTITY_OPERATOR_PROOF_TARGET,
    proofBoundary: HOSTED_IDENTITY_OPERATOR_PROOF_BOUNDARY,
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
    proofGraphNodeId: "admin-proof:hosted-identity-evidence",
    actionStatus: "ready",
    productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
    spineDrilldown: featureSpineDrilldownFixture(),
    spineTarget: featureSpineTargetFixture(),
    hostedHandoffChecklist: hostedIdentityEvidenceHandoffCase(),
    hostedIdentityFamilyBatch: HOSTED_IDENTITY_FAMILY_BATCH,
    hostedIdentityProofGraphEdges: HOSTED_IDENTITY_PROOF_GRAPH_EDGES,
  };
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      command: HOSTED_IDENTITY_OPERATOR_COMMAND,
      unproven,
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, localAdminAuditIds.nextAction);
  assert.equal(
    data.audit.status,
    `ready: ${HOSTED_IDENTITY_OPERATOR_COMMAND}`,
  );
  assert.deepEqual(
    data.audit.checks
      .filter((check) =>
        [
          "selected-next-command",
          "selected-proof-target",
          "selected-proof-boundary",
          "hosted-identity-family-proof-batch",
          "hosted-identity-proof-graph-dependency",
          ...HOSTED_IDENTITY_PROOF_GRAPH_EDGES.edges.map((edge) => edge.id),
          "hosted-production-identity",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["hosted-production-identity", "unproven"],
      [
        "hosted-identity-family-proof-batch",
        [
          HOSTED_IDENTITY_FAMILY_BATCH.status,
          HOSTED_IDENTITY_FAMILY_BATCH.command,
          ...HOSTED_IDENTITY_FAMILY_BATCH.proofTargets,
          HOSTED_IDENTITY_FAMILY_BATCH.proofBoundary,
        ].join("\n"),
      ],
      [
        "hosted-identity-proof-graph-dependency",
        [
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.status,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.proofGraphRoleUrl,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.familyBatchNodeId,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.operatorPredicateNodeId,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.adminSurfaceNodeId,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.operatorProofTarget,
          HOSTED_IDENTITY_PROOF_GRAPH_EDGES.proofBoundary,
        ].join("\n"),
      ],
      ...HOSTED_IDENTITY_PROOF_GRAPH_EDGES.edges.map((edge) => [
        edge.id,
        [
          edge.from,
          edge.relationship,
          edge.to,
          edge.command,
          edge.proofTarget,
        ].join("\n"),
      ]),
      ["selected-next-command", HOSTED_IDENTITY_OPERATOR_COMMAND],
      ["selected-proof-target", HOSTED_IDENTITY_OPERATOR_PROOF_TARGET],
      ["selected-proof-boundary", HOSTED_IDENTITY_OPERATOR_PROOF_BOUNDARY],
    ],
  );
  assert.deepEqual(
    data.audit.hostedIdentityFamilyBatch,
    HOSTED_IDENTITY_FAMILY_BATCH,
  );
  assert.deepEqual(
    data.audit.hostedIdentityProofGraphEdges,
    HOSTED_IDENTITY_PROOF_GRAPH_EDGES,
  );
  assert.equal(
    data.audit.artifactSummary.command,
    HOSTED_IDENTITY_OPERATOR_COMMAND,
  );
  assert.equal(
    data.audit.artifactSummary.selectedProofTarget,
    HOSTED_IDENTITY_OPERATOR_PROOF_TARGET,
  );
  assert.equal(
    data.audit.artifactSummary.selectedProofBoundary,
    HOSTED_IDENTITY_OPERATOR_PROOF_BOUNDARY,
  );
  assert.equal(
    data.audit.artifactSummary.selectedUnprovenId,
    "hosted-production-identity",
  );
});

test("admin local next action detail data carries recovery check rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command: "npm run test:dev-test-game-core-loop-admin-proof",
      artifact: {
        id: "core-loop",
        label: "Core loop admin proof",
        path: devTestGameCoreLoopAdminProofPath,
        status: "stale",
        refreshSource: "admin-spine-recovery",
      },
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local next action");
  assert.equal(data.audit.id, localAdminAuditIds.nextAction);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["artifact-not-fresh", "blocked"],
      ["core-loop", "stale"],
      ["selection-trace", "1 candidates"],
      ["selection-trace-core-loop", "selected:stale"],
      ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
        seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture(),
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
        proofGraphDiagnosticSummaryTrace: proofGraphDiagnosticSummaryTraceFixture(),
      }).map((check) => [check.id, check.status]),
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

test("admin local next action detail data carries host setup artifact recovery row", async () => {
  const roleData = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command: HOST_SETUP_PROOF_COMMAND,
      artifact: {
        id: "host-setup-role",
        label: "Host setup role proof",
        path: "target/dev-test-game/host-setup-proof.json",
        status: "stale",
        refreshSource: "manifest-default",
        proofTarget: "target/dev-test-game/host-setup-proof.json",
        roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
        requiredEvidence:
          "Fresh host setup seeded role proof artifact with setup route command recovery.",
        buildSlice:
          "Refresh only the host setup role URL proof before trusting host setup freshness.",
        proofBoundary:
          "Local host setup role proof freshness recovery only; does not prove the admin audit surface or release readiness.",
      },
    }),
  });

  assert.deepEqual(
    roleData.audit.localPrerequisites.map((item) => [
      item.id,
      item.command,
      item.proofTarget,
      item.roleUrl,
      item.requiredEvidence,
    ]),
    [
      [
        "host-setup-role",
        HOST_SETUP_PROOF_COMMAND,
        "target/dev-test-game/host-setup-proof.json",
        "http://127.0.0.1:5173/g/<seeded-game>/setup",
        "Fresh host setup seeded role proof artifact with setup route command recovery.",
      ],
    ],
  );
  assert.equal(
    roleData.audit.artifactSummary.selectedArtifactRoleHref,
    "http://127.0.0.1:5173/g/midsummer/setup",
  );
  assert.equal(
    roleData.audit.artifactSummary.selectedArtifactBuildSlice,
    "Refresh only the host setup role URL proof before trusting host setup freshness.",
  );
  const adminData = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command: "npm run test:dev-test-game-host-setup-admin-proof",
      artifact: {
        id: "host-setup-admin",
        label: "Host setup admin proof",
        path: devTestGameHostSetupAdminProofPath,
        status: "stale",
        refreshSource: "manifest-default",
        proofTarget: devTestGameHostSetupAdminProofPath,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof),
        requiredEvidence:
          "Fresh host setup admin proof artifact with visible setup checks.",
        buildSlice:
          "Refresh only the host setup admin proof before trusting host setup admin freshness.",
        proofBoundary:
          "Local host setup admin proof freshness recovery only; does not rerun the role proof or claim release readiness.",
      },
    }),
  });
  assert.deepEqual(
    adminData.audit.localPrerequisites.map((item) => [
      item.id,
      item.command,
      item.proofTarget,
      item.roleUrl,
    ]),
    [
      [
        "host-setup-admin",
        "npm run test:dev-test-game-host-setup-admin-proof",
        devTestGameHostSetupAdminProofPath,
        localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof),
      ],
    ],
  );
});

test("admin local next action detail distinguishes frontend setup workbench readiness", async () => {
  const frontendSetupWorkbenchReadiness =
    frontendSetupWorkbenchReadinessFixture();
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "artifact-not-fresh",
      command: HOST_SETUP_PROOF_COMMAND,
      frontendSetupWorkbenchReadiness,
      artifact: {
        id: "host-setup-role",
        label: "Host setup role proof",
        path: "target/dev-test-game/host-setup-proof.json",
        status: "stale",
        refreshSource: "manifest-default",
        proofTarget: "target/dev-test-game/host-setup-proof.json",
        roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
        requiredEvidence:
          "Fresh host setup seeded role proof artifact with setup route command recovery.",
        buildSlice:
          "Refresh only the host setup role URL proof before trusting host setup freshness.",
        proofBoundary:
          "Local host setup role proof freshness recovery only; does not prove the admin audit surface or release readiness.",
      },
    }),
  });

  assert.deepEqual(
    data.audit.checks
      .filter((check) => check.id === "frontend-host-setup-workbench")
      .map((check) => check.status),
    ["browser_proven:browser_proven:imported_browser_proven"],
  );
  assert.equal(
    data.audit.artifactSummary.frontendReadinessSummary,
    "target/frontend-readiness-summary/readiness-summary.json",
  );
  assert.deepEqual(
    data.audit.artifactSummary.frontendSetupWorkbenchReadiness,
    frontendSetupWorkbenchReadiness,
  );
  assert.deepEqual(
    data.audit.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "frontend-setup-workbench",
        "Frontend setup workbench",
        "admin-audit-detail-frontend-setup-workbench",
        [
          [
            "summary",
            "admin-audit-frontend-setup-workbench-summary",
            [
              ["state", frontendSetupWorkbenchReadiness.state, true],
              ["route", frontendSetupWorkbenchReadiness.route, false],
              ["localStatus", frontendSetupWorkbenchReadiness.localStatus, false],
              [
                "importedStatus",
                frontendSetupWorkbenchReadiness.importedStatus,
                false,
              ],
              ["proofBoundary", frontendSetupWorkbenchReadiness.proofBoundary, false],
            ],
          ],
          ...frontendSetupWorkbenchReadiness.localViewportLayouts.map((layout) => [
            layout.viewport,
            `admin-audit-frontend-setup-workbench-${layout.viewport}`,
            [
              ["viewport", layout.viewport, true],
              ["layout", layout.layout, false],
              ["slotCount", `${layout.slotCount} slots`, false],
              [
                "noHorizontalOverflow",
                layout.noHorizontalOverflow
                  ? "no horizontal overflow"
                  : "horizontal overflow",
                false,
              ],
              ["screenshot", layout.screenshot, false],
            ],
          ]),
        ],
      ],
    ],
  );
  assert.equal(data.audit.localPrerequisites[0].id, "host-setup-role");
  assert.equal(data.audit.localPrerequisites[0].status, "stale");
});

test("admin audit detail page leaves frontend setup workbench to route data", async () => {
  const source = await readFile(
    "frontend/src/routes/admin/audit/[audit]/+page.svelte",
    "utf8",
  );
  assert.doesNotMatch(source, /frontendSetupWorkbenchReadiness/);
  assert.doesNotMatch(source, /nextActionHandoffPair/);
  assert.match(source, /data\.audit\.artifactSummarySections\?\.length/);
});

test("admin local next action detail data exposes hosted identity sequence deferral", async () => {
  const hostedIdentityCandidate = {
    id: "hosted-production-identity",
    status: "unproven",
    requiredEvidence: "Hosted account lifecycle",
    buildSlice: "Run hosted identity evidence intake.",
    proofTarget: "target/dev-test-game/hosted-identity-evidence.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
    proofGraphNodeId: "admin-proof:hosted-identity-evidence",
    actionStatus: "ready",
  };
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "sequence-deferred-hosted-identity",
      command: LIVE_BROWSER_PROOF_COMMAND,
      sequenceDeferral: hostedIdentitySequenceDeferralFixture(),
      nextActionHandoffPair: nextActionHandoffPairFixture(),
      unproven: undefined,
      releaseReadinessTrace: releaseReadinessTraceFixture({
        unproven: hostedIdentityCandidate,
        command: "npm run test:dev-test-game-hosted-identity-evidence",
      }),
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.status, `blocked: ${LIVE_BROWSER_PROOF_COMMAND}`);
  assert.deepEqual(
    data.audit.checks
      .filter((check) =>
        [
          "sequence-deferred-hosted-identity",
          "hosted-identity-sequence-deferral",
          "hosted-identity-sequence-promotion",
          "hosted-identity-local-capability-confidence",
          "hosted-identity-local-capability-local-core-loop-proof",
          "next-action-sequence-handoff",
          "release-readiness-hosted-production-identity",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      ["sequence-deferred-hosted-identity", "blocked"],
      ["next-action-sequence-handoff", "passed:passed"],
      [
        "hosted-identity-sequence-deferral",
        "local-capability-model:hosted-production-identity",
      ],
      [
        "hosted-identity-sequence-promotion",
        "ready:npm run test:dev-test-game-next-action:hosted-identity",
      ],
      ["hosted-identity-local-capability-confidence", "passed:5/5"],
      ["hosted-identity-local-capability-local-core-loop-proof", "passed"],
      ["release-readiness-hosted-production-identity", "selected:unproven"],
    ],
  );
  assert.equal(
    data.audit.relatedLinks.find(
      (link) => link.id === "hosted-production-identity",
    ).href,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence, {
      game: "midsummer",
    }),
  );
  assert.equal(
    data.audit.artifactSummary.sequenceDeferredUnprovenId,
    "hosted-production-identity",
  );
  assert.equal(
    data.audit.artifactSummary.sequenceNextLocalCommand,
    "npm run test:dev-test-game-next-action:hosted-identity",
  );
  assert.equal(data.audit.artifactSummary.sequenceTransitionStatus, "ready");
  assert.equal(
    data.audit.artifactSummary.sequenceDeferredCommand,
    "npm run test:dev-test-game-hosted-identity-evidence",
  );
  assert.equal(
    data.audit.artifactSummary.sequenceRequiredStage,
    "hosted-identity",
  );
  assert.equal(
    data.audit.artifactSummary.sequenceLocalCapabilityConfidenceStatus,
    "passed",
  );
  assert.deepEqual(
    data.audit.artifactSummary.sequenceLocalCapabilityConfidenceRequiredCheckIds,
    [
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-ops-artifact-bundle",
      "local-seed-demo-fixture",
      "local-identity-adapter-proof",
    ],
  );
  assert.deepEqual(
    data.audit.artifactSummary.nextActionHandoffPair,
    nextActionHandoffPairFixture(),
  );
});

test("admin local next action detail data carries harness stability drift rows", async () => {
  const stability = {
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
  };
  const stabilityTrace = stabilityTraceFixture({ stability });
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.nextAction,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    nextAction: nextActionFixture({
      actionStatus: "blocked",
      reason: "harness-stability-drift",
      command: LOCAL_RACE_COMMAND,
      unproven: undefined,
      releaseReadinessTrace: releaseReadinessTraceFixture({ unproven: undefined }),
      stability,
      stabilityTrace,
    }),
  });

  assert.equal(data.status, "available");
  assert.equal(data.audit.id, localAdminAuditIds.nextAction);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["next-command", "available"],
      ["harness-stability-drift", "blocked"],
      ...proofStabilityTraceCheckRows(stabilityTrace).map((check) => [
        check.id,
        check.status,
      ]),
      ["selection-trace", "0 candidates"],
      ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
        seedProofLaneCoverageTrace: seedProofLaneCoverageTraceFixture(),
      }).map((check) => [check.id, check.status]),
      ...normalizeLocalNextActionProofGraphDiagnosticSummaryCheckRows({
        proofGraphDiagnosticSummaryTrace: proofGraphDiagnosticSummaryTraceFixture(),
      }).map((check) => [check.id, check.status]),
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
  assert.deepEqual(data.audit.artifactSummary.stabilityTrace, stabilityTrace);
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

  const hardening = data.audit.find((item) => item.id === localAdminAuditIds.hardening);
  assert.equal(hardening.label, "Local multiplayer hardening");
  assert.equal(hardening.status, `${hardeningAuditLaneIds.length} hardening lanes passed`);
  assert.equal(hardening.authority, "GlobalAdmin or GlobalMod");
  assert.equal(hardening.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.hardening, { game: "midsummer" }));
  assert.deepEqual(
    hardening.checks.map((check) => check.id),
    hardeningAuditLaneIds,
  );
  assert.deepEqual(hardening.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: proofRunFixture().lanes.length,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin proof-run fixture lane inventory follows shared audit lists", () => {
  const laneIds = proofRunFixture().lanes.map((lane) => lane.id);
  const sharedLaneIds = [
    ...coreLoopAuditLaneIds,
    ...hardeningAuditLaneIds,
    ...playerRecoveryAuditLaneIds,
  ];
  const fixtureOnlyLaneIds = laneIds.filter((id) => !sharedLaneIds.includes(id));

  assert.equal(laneIds.length, new Set(laneIds).size);
  assert.deepEqual(fixtureOnlyLaneIds, ["browser-entry", "cohost-console"]);
  for (const id of sharedLaneIds) {
    assert.equal(laneIds.includes(id), true, `fixture missing shared lane ${id}`);
  }
});

test("admin route data exposes local player recovery proof as a focused audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  const playerRecovery = data.audit.find(
    (item) => item.id === localAdminAuditIds.playerRecovery,
  );
  assert.deepEqual(LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS, playerRecoveryAuditLaneIds);
  assert.equal(playerRecovery.label, "Local player recovery");
  assert.equal(
    playerRecovery.status,
    `${playerRecoveryAuditLaneIds.length} player recovery lanes passed`,
  );
  assert.equal(playerRecovery.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    playerRecovery.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.playerRecovery, {
      game: "midsummer",
    }),
  );
  assert.deepEqual(
    playerRecovery.checks.map((check) => check.id),
    playerRecoveryAuditLaneIds,
  );
  assert.deepEqual(
    playerRecovery.relatedLinks.map((link) => [link.id, link.href]),
    [
      [localAdminAuditIds.coreLoop, localAdminAuditRoleUrl(localAdminAuditIds.coreLoop, { game: "midsummer" })],
      [localAdminAuditIds.hardening, localAdminAuditRoleUrl(localAdminAuditIds.hardening, { game: "midsummer" })],
    ],
  );
  assert.deepEqual(playerRecovery.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: proofRunFixture().lanes.length,
    playerRecoveryLaneCount: playerRecoveryAuditLaneIds.length,
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

  const coreLoop = data.audit.find((item) => item.id === localAdminAuditIds.coreLoop);
  assert.equal(coreLoop.label, "Local core loop");
  assert.equal(coreLoop.status, `${coreLoopAuditLaneIds.length} core loop lanes passed`);
  assert.equal(coreLoop.authority, "GlobalAdmin or GlobalMod");
  assert.equal(coreLoop.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.coreLoop, { game: "midsummer" }));
  assert.deepEqual(
    coreLoop.checks.map((check) => check.id),
    coreLoopAdminCheckIds,
  );
  assert.equal(
    coreLoop.checks.find(
      (check) => check.id === coreLoopCompletedGameCoverageCheckId,
    )?.status,
    `passed: ${completedGameHardeningLaneCount()}/${completedGameHardeningLaneCount()} completed-game lanes across ${completedGameHardeningFamilyCount()} families`,
  );
  assert.deepEqual(coreLoop.artifactSummary, {
    game: "game-a",
    roleCount: 6,
    laneCount: proofRunFixture().lanes.length,
    completedGameCoverageStatus: "passed",
    completedGameCoverageLaneCount: 9,
    completedGameCoverageFamilyCount: 4,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin core loop completed-game coverage flags stale shared-case totals", async () => {
  const proofRun = proofRunFixture();
  const staleLaneCount = completedGameHardeningLaneCount() - 1;
  const staleFamilyCount = completedGameHardeningFamilyCount() - 1;
  proofRun.completedGameHardeningCoverage = {
    ...proofRun.completedGameHardeningCoverage,
    laneCount: staleLaneCount,
    passedLaneCount: staleLaneCount,
    familyCount: staleFamilyCount,
  };

  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun,
  });

  const coreLoop = data.audit.find((item) => item.id === localAdminAuditIds.coreLoop);
  assert.equal(
    coreLoop.checks.find(
      (check) => check.id === coreLoopCompletedGameCoverageCheckId,
    )?.status,
    `drift: passed artifact reports ${staleLaneCount}/${staleLaneCount} completed-game lanes across ${staleFamilyCount} families; expected ${completedGameHardeningLaneCount()} lanes across ${completedGameHardeningFamilyCount()} shared families`,
  );
});

test("admin local core loop detail data carries lane rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.coreLoop,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local core loop");
  assert.equal(data.audit.id, localAdminAuditIds.coreLoop);
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
          [
            "privateChannel",
            "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
          ],
        ],
        [
          ["d01-resolved-locked", "phase D01, locked"],
          ["n01-action-open", "phase N01, action factional_kill"],
          ["n01-resolved-target-killed", "receipt factional_kill"],
          ["d02-day-controls-return", "phase D02, action vote controls 2"],
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
      [
        "n02-d03",
        "game-b",
        [
          ["host", "http://127.0.0.1:5173/g/game-b/host"],
          ["actionPlayer", "http://127.0.0.1:5173/g/game-b"],
          ["normalPlayer", "http://127.0.0.1:5173/g/game-b"],
        ],
        [
          ["n02-action-open", "phase N02, action factional_kill"],
          ["n02-action-submitted", "action ack, target slot-3"],
          [
            "n02-resolved-target-killed",
            "phase N02, locked, target dead, target status dead",
          ],
          ["d03-day-controls-return", "phase D03, action vote controls 2"],
          [
            "d03-terminal-advance-reject",
            "phase D03, locked, resolve ack, advance reject, reject InvalidTarget, target alive, target status alive, vote target slot_4, vote ack, outcome NoMajority, count 1, advance control visible",
          ],
          [
            "d03-terminal-reload-recovery",
            "phase D03, locked, outcome NoMajority, count 1, route 200, reject receipt Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls, advance control visible, unlock control visible",
          ],
          [
            "d03-revote-prompt-resolved",
            "phase D03R1, open, resolve ack, prompt D03:revote:NoMajority, prompt status resolved, stream seqs 2, action vote controls 2, normal vote controls 2",
          ],
          [
            "d03r1-revote-ballot-submitted",
            "phase D03R1, open, actor slot_4, vote target NoLynch, vote ack, current vote no_lynch, count 1, api phase D03R1, api target no_lynch, api count 1, stale D03 target slot_4, stale D03 count 1",
          ],
          [
            "d03r1-revote-resolved-no-majority",
            "phase D03R1, locked, resolve ack, prompt D03R1:revote:NoMajority, prompt status pending, original prompt status resolved, outcome NoMajority, count 1, prompt action visible",
          ],
          [
            "d03r2-revote-prompt-resolved",
            "phase D03R2, open, resolve ack, prompt D03R1:revote:NoMajority, prompt status resolved, original prompt status resolved, stream seqs 2, action vote controls 1, normal vote controls 1",
          ],
          [
            "d03r2-revote-ballot-submitted",
            "phase D03R2, open, actor slot_4, vote target NoLynch, vote ack, current vote no_lynch, count 1, api phase D03R2, api target no_lynch, api count 1, stale D03 target slot_4, stale D03 count 1, stale D03R1 no-lynch count 1",
          ],
          [
            "d03r2-revote-resolved-no-majority",
            "phase D03R2, locked, resolve ack, prompt D03R2:revote:NoMajority, prompt status pending, original prompt status resolved, outcome NoMajority, count 1, prompt action visible",
          ],
          [
            "d03r2-stale-continue-policy-recovery",
            "reject PromptAlreadyResolved, prompt D03R2:revote:NoMajority, stale action resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote, setup pending, reject state reject, reload N03, setup action visible, post-reject prompt action hidden, reload open, reload resolve control visible, reload stale action hidden",
          ],
        ],
      ],
    ],
  );
  assert.deepEqual(
    data.audit.scenarioFamilies.map((family) => [
      family.id,
      family.status,
      family.laneIds,
      family.surfaces,
    ]),
    coreLoopScenarioFamilyRows().map((family) => [
      family.id,
      family.status,
      family.laneIds,
      family.surfaces,
    ]),
  );
  assert.deepEqual(
    data.audit.spineRecoveryHooks.map((hook) => [hook.id, hook.status]),
    [
      ["staleLockedVoteReject", "PhaseLocked"],
      ["invalidActionReject", "InvalidTarget"],
      ["normalPlayerDirectActionReject", "InvalidTarget"],
      ["staleActionConflictReject", "PhaseLocked"],
      ["staleVoteTransitionReject", "PhaseLocked"],
      ["staleActionTransitionReject", "PhaseLocked"],
      ["d03TerminalAdvanceReject", "InvalidTarget"],
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
      [
        "core-loop-spine",
        "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03",
      ],
      ["core-loop", "passed: PhaseLocked vote receipt, unchanged unknown, lock ack/unlock ack"],
      ["action-loop", "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown"],
      ["host-deadline-advance", "passed: D01 deadline -> N01"],
      [
        "invalid-action-recovery",
        `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
      ],
      ["resolution-receipts", "passed: factional_kill receipt, target slot-2"],
      ["player-action-boundary", "passed: 0 unowned actions, direct reject InvalidTarget"],
      ["private-channel", "passed: private:mafia_day_chat, denied 403"],
      [
        coreLoopPrivateChannelStalePostLaneId,
        "passed: channel private:mafia_day_chat, Ack: stream seqs 43, locked true",
      ],
      [
        coreLoopPrivateChannelCompletedPostLaneId,
        `passed: channel private:mafia_day_chat, ${staleCompletedPrivatePostScenario().commandMessage}, completed true, thread post false, reload closed true`,
      ],
      [
        coreLoopPrivateChannelInvalidActionLaneId,
        `passed: channel ${privateChannelInvalidActionRecoveryScenario().channelId}, ${privateChannelInvalidActionRecoveryScenario().commandMessage}, scope true, refresh commandState true, legal action visible true`,
      ],
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
        "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03",
        "passed: D01 -> N01 -> D02, vote ack, N02 action ack, next D03, terminal advance InvalidTarget, reload D03, revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03",
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
        `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
        `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
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
        coreLoopPrivateChannelStalePostLaneId,
        "passed: channel private:mafia_day_chat, Ack: stream seqs 43, locked true",
        "passed: channel private:mafia_day_chat, Ack: stream seqs 43, locked true",
      ],
      [
        coreLoopPrivateChannelCompletedPostLaneId,
        `passed: channel private:mafia_day_chat, ${staleCompletedPrivatePostScenario().commandMessage}, completed true, thread post false, reload closed true`,
        `passed: channel private:mafia_day_chat, ${staleCompletedPrivatePostScenario().commandMessage}, completed true, thread post false, reload closed true`,
      ],
      [
        coreLoopPrivateChannelInvalidActionLaneId,
        `passed: channel ${privateChannelInvalidActionRecoveryScenario().channelId}, ${privateChannelInvalidActionRecoveryScenario().commandMessage}, scope true, refresh commandState true, legal action visible true`,
        `passed: channel ${privateChannelInvalidActionRecoveryScenario().channelId}, ${privateChannelInvalidActionRecoveryScenario().commandMessage}, scope true, refresh commandState true, legal action visible true`,
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
    audit: localAdminAuditIds.playerRecovery,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local player recovery");
  assert.equal(data.audit.id, localAdminAuditIds.playerRecovery);
  assert.equal(data.audit.checks.length, playerRecoveryAuditLaneIds.length);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      [
        "action-loop",
        "passed: role URL false, night unknown, receipt unknown, D02 unknown, next unknown",
      ],
      [
        "invalid-action-recovery",
        `passed: ${playerInvalidActionRecoveryMessage}, legal action visible true`,
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
        "private-channel-stale-action-reconnect-recovery",
        "passed: role URL true, channel private:mafia_day_chat, reject PhaseLocked, recovered private:mafia_day_chat D02",
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
    audit: localAdminAuditIds.hardening,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    proofRun: proofRunFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local multiplayer hardening");
  assert.equal(data.audit.id, localAdminAuditIds.hardening);
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
    audit: localAdminAuditIds.opsArtifacts,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    opsArtifacts: localOpsArtifactsFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local ops artifacts");
  assert.equal(data.audit.id, localAdminAuditIds.opsArtifacts);
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
    audit: localAdminAuditIds.hostedOpsSignals,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedOpsSignals: localHostedOpsSignalsFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local hosted ops signals");
  assert.equal(data.audit.id, localAdminAuditIds.hostedOpsSignals);
  assert.equal(data.audit.checks.length, 5);
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    [localAdminAuditIds.hostedConcurrentRaceMatrix, localAdminAuditIds.opsArtifacts],
  );
});

test("admin real hosted observability handoff detail data carries blocked evidence rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.realHostedObservabilityHandoff,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    realHostedObservabilityHandoff:
      localRealHostedObservabilityHandoffFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Real hosted observability handoff");
  assert.equal(data.audit.id, localAdminAuditIds.realHostedObservabilityHandoff);
  assert.equal(data.audit.checks.length, 10);
  assert.deepEqual(
    data.audit.unproven.map((item) => item.id),
    realHostedObservabilityHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.inputs.map((input) => [
      input.id,
      input.value,
    ]),
    [
      [
        "command",
        "npm run test:dev-test-game-real-hosted-observability-handoff",
      ],
      [
        "proof-target",
        "target/dev-test-game/real-hosted-observability-handoff.json",
      ],
      [
        "FMARCH_REAL_HOSTED_OBSERVABILITY_EVIDENCE_PATH",
        "externally reachable hosted logs/metrics/traces/paging/SLO/incident-response evidence JSON",
      ],
      [
        "FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS",
        "target/dev-test-game/hosted-ops-signals.json",
      ],
    ],
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.groups.map((group) => group.id),
    realHostedObservabilityHandoffCase().requirementGroups.map((group) => group.id),
  );
  assert.deepEqual(data.audit.artifactSummary.realHostedObservabilitySummary, {
    status: "blocked",
    checkCount: 10,
    passedCheckCount: 1,
    blockedCheckCount: 9,
    requiredInputCount: 11,
    providedInputCount: 1,
    missingInputCount: 10,
    baselineStatus: "baseline only",
    localHostedOpsSignalsPath: "target/dev-test-game/hosted-ops-signals.json",
    localVsHostedBoundary:
      "Local hosted-like signals cannot satisfy real hosted observability evidence.",
  });
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.inputSections.map((section) => [
      section.id,
      section.status,
      section.requiredInputIds,
      section.providedInputIds,
      section.missingInputs,
    ]),
    realHostedObservabilityHandoffInputSectionDefinitions.map((section) => [
      section.id,
      "missing",
      [...section.requiredInputIds],
      section.id === "baseline-boundary" ? [realHostedObservabilityBaselineEnv] : [],
      section.requiredInputIds.filter(
        (inputId) => inputId !== realHostedObservabilityBaselineEnv,
      ),
    ]),
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    [localAdminAuditIds.hostedOpsSignals, localAdminAuditIds.nextAction],
  );
});

test("admin hosted target preflight detail data carries blocked setup rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostedTargetPreflight,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedTargetPreflight: localHostedTargetPreflightFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Hosted target preflight");
  assert.equal(data.audit.id, localAdminAuditIds.hostedTargetPreflight);
  assert.equal(data.audit.checks.length, 7);
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    [localAdminAuditIds.hostedConcurrentRaceMatrix, localAdminAuditIds.nextAction],
  );
  assert.deepEqual(
    data.audit.unproven.map((item) => [
      item.id,
      item.status,
      item.requiredEvidence,
    ]),
    [
      [
        "hosted-frontend-url-configured",
        "blocked",
        hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      ],
      [
        "hosted-api-url-configured",
        "blocked",
        hostedTargetPreflightMissingApiUrlRequiredEvidence,
      ],
      [
        "hosted-targets-external",
        "blocked",
        hostedTargetPreflightExternalTargetsRequiredEvidence(),
      ],
      [
        "raw-evidence-path-configured",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
      [
        "raw-evidence-readable",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
      [
        "raw-evidence-real-hosted-target",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
    ],
  );
});

test("admin hosted evidence lane detail data carries blocked setup rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostedEvidenceLane,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    hostedEvidenceLane: localHostedEvidenceLaneFixture(),
    hostedEvidenceLaneDemoProof: localHostedEvidenceLaneDemoProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Hosted evidence lane");
  assert.equal(data.audit.id, localAdminAuditIds.hostedEvidenceLane);
  assert.equal(data.audit.checks.length, 14);
  assert.deepEqual(
    data.audit.checks.slice(-6).map((check) => [check.id, check.status]),
    [
      ["demo-proof:blocked-lane-recorded", "blocked"],
      ["demo-proof:synthetic-raw-evidence-written", "passed"],
      ["demo-proof:synthetic-lane-rejected", "blocked"],
      ["demo-proof:demo-external-evidence-written", "passed"],
      ["demo-proof:synthetic-demo-boundary-carried", "passed"],
      ["demo-proof:release-claim-boundary-carried", "passed"],
    ],
  );
  assert.deepEqual(
    data.audit.relatedLinks.map((link) => link.id),
    [
      localAdminAuditIds.hostedTargetPreflight,
      localAdminAuditIds.hostedConcurrentRaceMatrix,
      localAdminAuditIds.nextAction,
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
      ["raw-evidence-real-hosted-target", "blocked"],
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
        hostedMatrixRawEvidenceContractSummary(),
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
      item.requiredEvidence,
    ]),
    [
      [
        "hosted-frontend-url-configured",
        "blocked",
        hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      ],
      [
        "hosted-api-url-configured",
        "blocked",
        hostedTargetPreflightMissingApiUrlRequiredEvidence,
      ],
      [
        "hosted-targets-external",
        "blocked",
        hostedTargetPreflightExternalTargetsRequiredEvidence(),
      ],
      [
        "raw-evidence-path-configured",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
      [
        "raw-evidence-readable",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
      [
        "raw-evidence-real-hosted-target",
        "blocked",
        hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      ],
    ],
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedReceipt.missingRequiredInputs,
    [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
  );
  assert.deepEqual(
    data.audit.hostedHandoffChecklist.blockedReceipt.firstMissingOperatorArtifact,
    {
      inputId: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      checkId: "hosted-frontend-url-configured",
      sectionId: "hosted-target",
      sectionLabel: "Hosted target",
      requiredEvidence: hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      purpose: "Externally reachable frontend base URL.",
      proofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      roleSurfaceDrilldown: {
        localCapabilityAuditId: localAdminAuditIds.coreLoop,
        localCapabilityRoleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.coreLoop,
        ),
        handoffAuditId: localAdminAuditIds.hostedEvidenceLane,
        handoffRoleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.hostedEvidenceLane,
        ),
        proofGraphNodeId: "admin-proof:hosted-evidence-lane",
        productionFeatureGraphNodeId: "production-feature:host-phase-control",
        proofGraphEvidencePath: "target/dev-test-game/proof-graph.json",
      },
    },
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.blockedReceipt.operatorAction,
    "Configure the hosted frontend/API URLs plus a readable raw hosted matrix evidence packet from that same deployment, then rerun npm run test:dev-test-game-hosted-evidence-lane.",
  );
  assert.equal(
    data.audit.hostedHandoffChecklist.blockedReceipt.rawEvidenceContractSummary,
    hostedMatrixRawEvidenceContractSummary(),
  );
  assert.equal(data.audit.artifactSummary.demoProofStatus, "passed");
  assert.equal(data.audit.artifactSummary.demoOnly, true);
  assert.equal(
    data.audit.artifactSummary.demoSyntheticRejectedRoleUrl,
    localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
  );
});

test("admin route data exposes local seed fixture summary as a native audit row", async () => {
  const seedCoverage = seedProofLaneCoverageFixture();
  const seedCoverageCounts = seedProofLaneCoverageCountSummary(seedCoverage);
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    seedFixtureSummary: seedFixtureSummaryFixture(),
  });

  const seed = data.audit.find((item) => item.id === localAdminAuditIds.seedFixtures);
  assert.equal(seed.label, "Local seed fixtures");
  assert.equal(
    seed.status,
    `${seedScenarioCoverageGroups.allDemo.length} demo scenarios available locally`,
  );
  assert.equal(seed.authority, "GlobalAdmin or GlobalMod");
  assert.equal(seed.inspectHref, localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures, { game: "midsummer" }));
  assert.deepEqual(
    seed.scenarios.map((scenario) => scenario.id),
    seedScenarioCoverageGroups.allDemo,
  );
  assert.deepEqual(seed.artifactSummary, {
    game: "game-a",
    scenarioCount: seedScenarioCoverageGroups.allDemo.length,
    roleCount: 7,
    slotCount: 5,
    proofLaneCount: seedCoverageCounts.passedLaneCount,
    directSeededProofLaneCount: seedCoverageCounts.directSeededLaneCount,
    aliasOnlyProofLaneCount: seedCoverageCounts.aliasOnlyLaneCount,
    aggregateOnlyProofLaneCount: seedCoverageCounts.aggregateOnlyLaneCount,
    unclassifiedProofLaneCount: seedCoverageCounts.unclassifiedLaneCount,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local seed fixture detail data carries scenario rows", async () => {
  const seedCoverage = seedProofLaneCoverageFixture();
  const seedCoverageCounts = seedProofLaneCoverageCountSummary(seedCoverage);
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.seedFixtures,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    seedFixtureSummary: seedFixtureSummaryFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local seed fixtures");
  assert.equal(data.audit.id, localAdminAuditIds.seedFixtures);
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
      ["direct-seeded", seedCoverageCounts.directSeededLaneCount],
      ["alias-only", seedCoverageCounts.aliasOnlyLaneCount],
      ["aggregate-only", seedCoverageCounts.aggregateOnlyLaneCount],
      ["unclassified", seedCoverageCounts.unclassifiedLaneCount],
    ],
  );
});

test("admin route data exposes local release readiness as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  const readiness = data.audit.find((item) => item.id === localAdminAuditIds.releaseReadiness);
  assert.equal(readiness.label, "Local release readiness");
  assert.equal(readiness.status, "13 local checks passed, 2 release items unproven");
  assert.equal(readiness.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    readiness.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.releaseReadiness, { game: "midsummer" }),
  );
  assert.deepEqual(
    readiness.checks.map((check) => check.id),
    [
      "local-role-url-browser-proof",
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-host-setup-proof",
      "local-stale-conflict-message-milestone",
      "local-host-stale-control-milestone",
      "local-private-channel-recovery-milestone",
      ...expectedNormalizedEvidenceObjectCheckRows({
        parentId: "local-private-channel-recovery-milestone",
        objects: privateChannelNormalizedEvidenceObjects,
      }).map(([id]) => id),
      "local-replacement-private-recovery-milestone",
      ...expectedNormalizedEvidenceObjectCheckRows({
        parentId: "local-replacement-private-recovery-milestone",
        objects: replacementPrivatePostNormalizedEvidenceObjects,
      }).map(([id]) => id),
      "local-replacement-action-recovery-milestone",
      "local-replacement-handoff-recovery-milestone",
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
        localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
      ],
      [
        "local-proof-freshness-admin-surface",
        "npm run test:dev-test-game-proof-freshness-admin-proof",
        localAdminAuditRoleUrl(localAdminAuditIds.proofFreshness),
      ],
      [
        "local-next-action-admin-surface",
        "npm run test:dev-test-game-next-action-admin-proof",
        localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
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
    localCheckCount: 13,
    coverageCheckCount: 6,
    coverageDriftCount: 0,
    coverageStatus: "coherent",
    localPrerequisiteCount: 3,
    unprovenCount: 2,
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local release readiness detail data carries checks and unproven rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.releaseReadiness,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local release readiness");
  assert.equal(data.audit.id, localAdminAuditIds.releaseReadiness);
  assert.equal(data.audit.checks.length, 19);
  assert.deepEqual(
    data.audit.checks
      .filter((check) =>
        [
          "local-stale-conflict-message-milestone",
          "local-host-stale-control-milestone",
          "local-private-channel-recovery-milestone",
          "local-replacement-private-recovery-milestone",
          "local-replacement-action-recovery-milestone",
          "local-replacement-handoff-recovery-milestone",
        ].includes(check.id),
      )
      .map((check) => [check.id, check.status]),
    [
      [
        "local-stale-conflict-message-milestone",
        releaseReadinessCoverageStatus(staleConflictMessageMilestoneFixture()),
      ],
      [
        "local-host-stale-control-milestone",
        releaseReadinessCoverageStatus(hostStaleControlMilestoneFixture()),
      ],
      [
        "local-private-channel-recovery-milestone",
        releaseReadinessCoverageStatus(privateChannelRecoveryMilestoneFixture()),
      ],
      [
        "local-replacement-private-recovery-milestone",
        releaseReadinessCoverageStatus(replacementPrivateRecoveryMilestoneFixture()),
      ],
      [
        "local-replacement-action-recovery-milestone",
        releaseReadinessCoverageStatus(replacementActionRecoveryMilestoneFixture()),
      ],
      [
        "local-replacement-handoff-recovery-milestone",
        releaseReadinessCoverageStatus(replacementHandoffRecoveryMilestoneFixture()),
      ],
    ],
  );
  assert.deepEqual(
    data.audit.checks
      .filter((check) => check.id.startsWith("evidence-object:"))
      .map((check) => [check.id, check.status]),
    [
      ...expectedNormalizedEvidenceObjectCheckRows({
        parentId: "local-private-channel-recovery-milestone",
        objects: privateChannelNormalizedEvidenceObjects,
      }),
      ...expectedNormalizedEvidenceObjectCheckRows({
        parentId: "local-replacement-private-recovery-milestone",
        objects: replacementPrivatePostNormalizedEvidenceObjects,
      }),
    ],
  );
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
    data.audit.setupCommandEvidence.map((item) => [
      item.id,
      item.status,
      item.commandKind,
      item.readinessSummary,
    ]),
    [
      ["addSlot", "ack", "AddSlot", "Setup still needs attention"],
      ["assignSlot", "ack", "AssignSlot", "Setup still needs attention"],
      ["assignRole", "ack", "AssignRole", "Ready to start"],
      ["setPostPolicy", "ack", "SetPostPolicy", "Ready to start"],
      ["startGame", "ack", "StartGame", "Started at D01"],
    ],
  );
  assert.deepEqual(
    data.audit.unproven.map((item) => [item.id, item.status]),
    releaseReadinessUnprovenStatusRows([
      "hosted-deployment",
      "human-release-runbook",
    ]).map((item) => [item.id, item.status]),
  );
});

test("admin route data exposes local host setup proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  const hostSetup = data.audit.find(
    (item) => item.id === localAdminAuditIds.hostSetupProof,
  );
  assert.equal(hostSetup.label, "Local host setup proof");
  assert.equal(hostSetup.status, "5 setup commands proven, 1 ready checks covered");
  assert.equal(hostSetup.authority, "GlobalAdmin or GlobalMod");
  assert.equal(hostSetup.href, "target/dev-test-game/host-setup-proof.json");
  assert.equal(
    hostSetup.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.hostSetupProof, {
      game: "midsummer",
    }),
  );
  assert.deepEqual(
    hostSetup.checks.map((check) => [check.id, check.status]),
    [
      ["local-host-setup-proof", "passed"],
      ["ready-check:start-phase", "covered by host setup proof"],
    ],
  );
  assert.deepEqual(hostSetup.artifactSummary, {
    game: "game-a",
    hostSetupProof: "target/dev-test-game/host-setup-proof.json",
    roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
    capabilityLabel: "HostOf(<seeded-game>)",
    readyCheckCount: 1,
    setupCommandEvidenceCount: 5,
    policyCommandStatus: "passed",
    setupMutationStatus: "passed",
    releaseReady: false,
    productionReady: false,
  });
});

test("admin local host setup proof detail data carries setup command evidence rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.hostSetupProof,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: releaseReadinessChecklistFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local host setup proof");
  assert.equal(data.audit.id, localAdminAuditIds.hostSetupProof);
  assert.deepEqual(
    data.audit.checks.map((check) => [check.id, check.status]),
    [
      ["local-host-setup-proof", "passed"],
      ["ready-check:start-phase", "covered by host setup proof"],
    ],
  );
  assert.deepEqual(
    data.audit.setupCommandEvidence.map((item) => [
      item.id,
      item.status,
      item.commandKind,
      item.readinessSummary,
    ]),
    [
      ["addSlot", "ack", "AddSlot", "Setup still needs attention"],
      ["assignSlot", "ack", "AssignSlot", "Setup still needs attention"],
      ["assignRole", "ack", "AssignRole", "Ready to start"],
      ["setPostPolicy", "ack", "SetPostPolicy", "Ready to start"],
      ["startGame", "ack", "StartGame", "Started at D01"],
    ],
  );
});

test("admin local release runbook detail data routes hosted identity handoff to evidence intake", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.releaseRunbook,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseRunbook: {
      version: 1,
      proof: "dev-test-game-release-runbook",
      status: "passed",
      releaseReady: false,
      productionReady: false,
      generatedAt: "2026-07-05T00:00:00.000Z",
      scope: "local-dev-test-game-release-runbook-rehearsal",
      proofBoundary: "Local release runbook handoff.",
      generatedFrom: {
        releaseReadinessChecklist:
          "target/dev-test-game/release-readiness-checklist.json",
        releaseReadinessGeneratedAt: "2026-07-05T00:00:00.000Z",
        game: "midsummer",
        unprovenIds: ["hosted-production-identity"],
      },
      checks: [
        { id: "remaining-readiness-gaps-mapped", status: "passed" },
        { id: "rollback-path-carried", status: "passed" },
        { id: "support-path-carried", status: "passed" },
        {
          id: "release-claim-boundary-carried",
          status: "passed",
          releaseReady: false,
          productionReady: false,
        },
        { id: "human-approval-boundary-carried", status: "unproven" },
      ],
      runbookItems: [
        {
          id: "hosted-production-identity",
          rank: 1,
          status: "rehearsal_ready",
          owner: "identity-owner",
          command: HOSTED_IDENTITY_EVIDENCE_COMMAND,
          proofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
          roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
          game: "midsummer",
          requiredEvidence: "Hosted account lifecycle",
          evidenceBoundary:
            "Local adapter proof remains the prerequisite role-surface boundary.",
        },
      ],
      rollbackPath: { status: "rehearsed_locally" },
      supportPath: { status: "local_admin_surface_available" },
      nextBuildSlice: {
        command: HOSTED_IDENTITY_EVIDENCE_COMMAND,
        proofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
        owner: "identity-owner",
        unprovenId: "hosted-production-identity",
      },
    },
  });

  assert.equal(data.status, "available");
  assert.deepEqual(
    data.audit.unproven.map((item) => [
      item.id,
      item.command,
      item.proofTarget,
      item.roleUrl,
    ]),
    [
      [
        "hosted-production-identity",
        HOSTED_IDENTITY_EVIDENCE_COMMAND,
        HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
        localAdminAuditRoleUrl(localAdminAuditIds.hostedIdentityEvidence),
      ],
    ],
  );
  assert.equal(
    data.audit.artifactSummary.nextBuildCommand,
    HOSTED_IDENTITY_EVIDENCE_COMMAND,
  );
  assert.equal(
    data.audit.artifactSummary.nextBuildProofTarget,
    HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  );
  assert.equal(
    data.audit.artifactSummary.nextBuildUnprovenId,
    "hosted-production-identity",
  );
});

test("admin local release readiness flags replacement coverage drift", async () => {
  const checklist = releaseReadinessChecklistFixture();
  const replacementHandoff = checklist.localDevelopmentSpine.checks.find(
    (check) => check.id === "local-replacement-handoff-recovery-milestone",
  );
  replacementHandoff.expectedLaneCount =
    replacementHandoff.expectedLaneCount + 1;

  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.releaseReadiness,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    releaseReadinessChecklist: checklist,
  });

  assert.equal(
    data.audit.checks.find(
      (check) => check.id === "local-replacement-handoff-recovery-milestone",
    ).status,
    releaseReadinessCoverageStatus(
      replacementHandoffRecoveryMilestoneFixture(),
      {
        status: "drift",
        expectedLaneCount: replacementHandoffRecoveryLaneIds.length + 1,
      },
    ),
  );
  assert.equal(
    data.audit.status,
    "coverage drift detected in 1/6 groups, 2 release items unproven",
  );
  assert.deepEqual(
    {
      coverageCheckCount: data.audit.artifactSummary.coverageCheckCount,
      coverageDriftCount: data.audit.artifactSummary.coverageDriftCount,
      coverageStatus: data.audit.artifactSummary.coverageStatus,
    },
    {
      coverageCheckCount: 6,
      coverageDriftCount: 1,
      coverageStatus: "drift",
    },
  );
});

test("admin route data exposes local backup restore proof as a native audit row", async () => {
  const data = await buildAdminRouteData({
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    backupRestoreProof: backupRestoreProofFixture(),
  });

  const backup = data.audit.find((item) => item.id === localAdminAuditIds.backupRestore);
  assert.equal(backup.label, "Local backup restore");
  assert.equal(backup.status, "5 backup restore checks passed");
  assert.equal(backup.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    backup.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.backupRestore, { game: "midsummer" }),
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
    audit: localAdminAuditIds.backupRestore,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    backupRestoreProof: backupRestoreProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local backup restore");
  assert.equal(data.audit.id, localAdminAuditIds.backupRestore);
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

  const identity = data.audit.find((item) => item.id === localAdminAuditIds.identityAdapter);
  assert.equal(identity.label, "Local identity adapter");
  assert.equal(identity.status, "3 role surfaces, 5 lifecycle controls");
  assert.equal(identity.authority, "GlobalAdmin or GlobalMod");
  assert.equal(
    identity.inspectHref,
    localAdminAuditRoleUrl(localAdminAuditIds.identityAdapter, { game: "midsummer" }),
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
    adapterContract: {
      status: "passed",
      adapterId: "local-production-identity-adapter-v1",
      roleSurfaceArchitectureChanged: false,
      roleSurfaceContractStatus: "passed",
      mismatchCount: 0,
      mismatches: [],
    },
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
  assert.deepEqual(
    identity.artifactSummarySections.map((section) => [
      section.id,
      section.heading,
      section.testId,
      section.rows.map((row) => [
        row.id,
        row.testId,
        row.values.map((value) => [value.id, value.text, value.emphasized]),
      ]),
    ]),
    [
      [
        "identity-adapter-contract",
        "Identity adapter contract",
        "admin-audit-detail-identity-adapter-contract",
        [
          [
            "identity-adapter-contract-summary",
            "admin-audit-identity-adapter-contract-summary",
            [
              ["status", "passed", true],
              ["adapterId", "local-production-identity-adapter-v1", false],
              ["roleSurfaceContractStatus", "passed", false],
              ["mismatchCount", "0 mismatches", false],
            ],
          ],
        ],
      ],
    ],
  );
});

test("admin local identity adapter detail data carries lifecycle checks and role rows", async () => {
  const data = await buildAdminAuditDetailData({
    audit: localAdminAuditIds.identityAdapter,
    principalUserId: "admin_a",
    capabilities: [{ kind: "GlobalAdmin" }],
    identityAdapterProof: identityAdapterProofFixture(),
  });

  assert.equal(data.status, "available");
  assert.equal(data.surfaceHeader.title, "Local identity adapter");
  assert.equal(data.audit.id, localAdminAuditIds.identityAdapter);
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
      receiptStatusText: playerInvalidActionRecoveryMessage,
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
    [coreLoopPrivateChannelStalePostLaneId]: {
      channel: "private:mafia_day_chat",
      state: "ack",
      receiptStatusText: "Ack: stream seqs 43",
      refreshedPhase: "D01",
      refreshedLocked: true,
      projectedPostBody: "Stale private-channel post after D01 phase closure fixture.",
    },
    [coreLoopPrivateChannelCompletedPostLaneId]: {
      channel: "private:mafia_day_chat",
      state: "reject",
      error: staleCompletedPrivatePostScenario().commandError,
      receiptStatusText: staleCompletedPrivatePostScenario().commandMessage,
      gameCompleted: true,
      reloadStatus: 200,
      reloadGameCompleted: true,
      threadPostPresent: false,
      reloadControlsDisabled: true,
      reloadRejectedPostVisible: false,
    },
    [coreLoopPrivateChannelInvalidActionLaneId]: {
      channel: privateChannelInvalidActionRecoveryScenario().channelId,
      state: "reject",
      error: privateChannelInvalidActionRecoveryScenario().commandError,
      receiptStatusText:
        privateChannelInvalidActionRecoveryScenario().commandMessage,
      routeStatus: 200,
      actorSlot: privateChannelInvalidActionRecoveryScenario().actorSlot,
      actionTemplateId:
        privateChannelInvalidActionRecoveryScenario().expectedActionTemplateId,
      refreshCommandState: true,
      channelContextPreserved: true,
      phase: privateChannelInvalidActionRecoveryScenario().expectedPhaseId,
      legalActionVisible: true,
      apiLegalActionAvailable: true,
      privateThreadPagerVisible: true,
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
    "private-channel-stale-action-reconnect-recovery": {
      roleUrl: "http://127.0.0.1:5173/g/midsummer/c/private%3Amafia_day_chat",
      visitedRolePath: "/g/midsummer/c/private%3Amafia_day_chat",
      channelAfterReject: "private:mafia_day_chat",
      reconnectChannel: "private:mafia_day_chat",
      rejectError: "PhaseLocked",
      recoveredPhase: "D02",
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
  const lanes = proofRunFixtureLaneIds().map((id) => ({
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
            privateChannel:
              "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
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
        {
          id: "n02-d03",
          game: "game-b",
          roleUrls: {
            host: "http://127.0.0.1:5173/g/game-b/host",
            actionPlayer: "http://127.0.0.1:5173/g/game-b",
            normalPlayer: "http://127.0.0.1:5173/g/game-b",
          },
          checkpoints: [
            {
              id: "n02-action-open",
              phase: "N02",
              actionTemplate: "factional_kill",
              actionTarget: "slot-3",
            },
            {
              id: "n02-action-submitted",
              actionState: "ack",
              targetSlot: "slot-3",
            },
            {
              id: "n02-resolved-target-killed",
              phase: "N02",
              locked: true,
              targetAlive: false,
              targetStatus: "dead",
            },
            {
              id: "d03-day-controls-return",
              phase: "D03",
              actionVoteControls: 2,
            },
            {
              id: "d03-terminal-advance-reject",
              phase: "D03",
              locked: true,
              voteState: "ack",
              voteTarget: "slot_4",
              projectedCount: 1,
              resolveState: "ack",
              outcomeStatus: "NoMajority",
              winnerSlot: null,
              targetAlive: true,
              targetStatus: "alive",
              advanceState: "reject",
              rejectError: "InvalidTarget",
              advanceControlVisible: true,
            },
            {
              id: "d03-terminal-reload-recovery",
              routeResponseStatus: 200,
              rejectReceiptStatus:
                "Reject InvalidTarget: invalid target; stale phase state, refresh and use current controls",
              phase: "D03",
              locked: true,
              outcomeStatus: "NoMajority",
              projectedCount: 1,
              advanceControlVisible: true,
              unlockControlVisible: true,
            },
            {
              id: "d03-revote-prompt-resolved",
              promptId: "D03:revote:NoMajority",
              promptActionId:
                "resolve_host_prompt-D03-revote-NoMajority-no_majority_continue_revote",
              decisionPolicy: "no_majority_continue_revote",
              promptStatusBefore: "pending",
              resolveState: "ack",
              streamSeqCount: 2,
              promptStatusAfter: "resolved",
              phase: "D03R1",
              locked: false,
              actionVoteControls: 2,
              normalVoteControls: 2,
            },
            {
              id: "d03r1-revote-ballot-submitted",
              phase: "D03R1",
              locked: false,
              voteState: "ack",
              actorSlot: "slot_4",
              voteTarget: "NoLynch",
              currentVoteKind: "no_lynch",
              projectedCount: 1,
              apiPhase: "D03R1",
              apiTarget: "no_lynch",
              apiCount: 1,
              staleD03Target: "slot_4",
              staleD03Count: 1,
              staleD03NoLynchCount: null,
            },
            {
              id: "d03r1-revote-resolved-no-majority",
              phase: "D03R1",
              locked: true,
              resolveState: "ack",
              outcomeStatus: "NoMajority",
              winnerSlot: null,
              projectedCount: 1,
              promptId: "D03R1:revote:NoMajority",
              promptActionId:
                "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
              promptStatusAfter: "pending",
              originalPromptStatus: "resolved",
              promptActionVisible: true,
            },
            {
              id: "d03r2-revote-prompt-resolved",
              phase: "D03R2",
              locked: false,
              resolveState: "ack",
              promptId: "D03R1:revote:NoMajority",
              promptActionId:
                "resolve_host_prompt-D03R1-revote-NoMajority-no_majority_continue_revote",
              decisionPolicy: "no_majority_continue_revote",
              promptStatusBefore: "pending",
              promptStatusAfter: "resolved",
              originalPromptStatus: "resolved",
              streamSeqCount: 2,
              actionVoteControls: 1,
              normalVoteControls: 1,
            },
            {
              id: "d03r2-revote-ballot-submitted",
              phase: "D03R2",
              locked: false,
              voteState: "ack",
              actorSlot: "slot_4",
              voteTarget: "NoLynch",
              currentVoteKind: "no_lynch",
              projectedCount: 1,
              apiPhase: "D03R2",
              apiTarget: "no_lynch",
              apiCount: 1,
              staleD03Target: "slot_4",
              staleD03Count: 1,
              staleD03R1NoLynchCount: 1,
              staleD03NoLynchCount: null,
            },
            {
              id: "d03r2-revote-resolved-no-majority",
              phase: "D03R2",
              locked: true,
              resolveState: "ack",
              outcomeStatus: "NoMajority",
              winnerSlot: null,
              projectedCount: 1,
              promptId: "D03R2:revote:NoMajority",
              promptActionId:
                "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_no_lynch",
              promptStatusAfter: "pending",
              originalPromptStatus: "resolved",
              promptActionVisible: true,
              policyResolveState: "ack",
              policyStreamSeqCount: 2,
              decisionPolicy: "no_majority_no_lynch",
              promptStatusAfterPolicy: "resolved",
              nextPhase: "N03",
              nextLocked: false,
              actionNightActionControls: 1,
              normalNightActionControls: 0,
            },
            {
              id: "d03r2-stale-continue-policy-recovery",
              promptId: "D03R2:revote:NoMajority",
              staleActionId:
                "resolve_host_prompt-D03R2-revote-NoMajority-no_majority_continue_revote",
              setupPromptStatus: "pending",
              setupActionVisible: true,
              rejectState: "reject",
              rejectError: "PromptAlreadyResolved",
              activityStatusText:
                "Reject PromptAlreadyResolved: prompt already resolved; host prompt selection is stale, refresh the host console and use current prompt controls",
              promptStatusAfterReject: "resolved",
              promptActionVisibleAfterReject: false,
              reloadStatus: "passed",
              reloadPhase: "N03",
              reloadLocked: false,
              reloadResolveControlVisible: true,
              reloadStaleActionVisible: false,
              apiPromptStatusAfterReload: "resolved",
            },
          ],
        },
      ],
      recoveryHooks: {
        staleLockedVoteReject: "PhaseLocked",
        invalidActionReject: "InvalidTarget",
        normalPlayerDirectActionReject: "InvalidTarget",
        staleActionConflictReject: "PhaseLocked",
        staleVoteTransitionReject: "PhaseLocked",
        staleActionTransitionReject: "PhaseLocked",
        d03TerminalAdvanceReject: "InvalidTarget",
      },
    },
    completedGameHardeningCoverage: completedGameHardeningCoverageFixture(),
    hostStaleControlCoverage: hostStaleControlCoverageFixture(),
    staleConflictMessageCoverage: staleConflictMessageCoverageFixture(),
    replacementPrivateChannelRecoveryCoverage:
      replacementPrivateChannelRecoveryCoverageFixture(),
    replacementActionRecoveryCoverage:
      replacementActionRecoveryCoverageFixture(),
    replacementHandoffRecoveryCoverage:
      replacementHandoffRecoveryCoverageFixture(),
    lanes,
  };
}

function proofRunFixtureLaneIds() {
  return [
    ...new Set([
      "browser-entry",
      "cohost-console",
      ...coreLoopAuditLaneIds,
      ...hardeningAuditLaneIds,
      ...playerRecoveryAuditLaneIds,
    ]),
  ];
}

function completedGameHardeningCoverageFixture() {
  const cases = completedGameHardeningLaneCases();
  const families = [...new Set(cases.map((scenario) => scenario.family))].map(
    (familyId) => {
      const familyCases = cases.filter((scenario) => scenario.family === familyId);
      return {
        id: familyId,
        status: "passed",
        laneIds: familyCases.map((scenario) => scenario.id),
        passedLaneIds: familyCases.map((scenario) => scenario.id),
        requiredLaneIds: familyCases
          .filter((scenario) => scenario.seedGroup === "required")
          .map((scenario) => scenario.id),
        demoOnlyLaneIds: familyCases
          .filter((scenario) => scenario.seedGroup === "demo-only")
          .map((scenario) => scenario.id),
      };
    },
  );
  return {
    status: "passed",
    laneCount: cases.length,
    passedLaneCount: cases.length,
    familyCount: families.length,
    expectedLaneCount: cases.length,
    expectedFamilyCount: families.length,
    sourceLaneIds: cases.map((scenario) => scenario.id),
    laneStatuses: cases.map((scenario) => ({
      id: scenario.id,
      family: scenario.family,
      seedGroup: scenario.seedGroup,
      status: "passed",
    })),
    families,
  };
}

function completedGameHardeningLaneCount() {
  return completedGameHardeningLaneCases().length;
}

function completedGameHardeningFamilyCount() {
  return new Set(
    completedGameHardeningLaneCases().map((scenario) => scenario.family),
  ).size;
}

function hostStaleControlCoverageFixture() {
  const families = hostStaleControlCoverageFamilies().map((family) => ({
    ...family,
    status: "passed",
    passedLaneIds: [...family.laneIds],
  }));
  return {
    status: "passed",
    laneCount: hostStaleControlLaneIds.length,
    passedLaneCount: hostStaleControlLaneIds.length,
    familyCount: families.length,
    expectedLaneCount: hostStaleControlLaneIds.length,
    expectedFamilyCount: families.length,
    sourceLaneIds: [...hostStaleControlLaneIds],
    laneStatuses: families.flatMap((family) =>
      family.laneIds.map((laneId) => ({
        id: laneId,
        family: family.id,
        status: "passed",
      })),
    ),
    families,
  };
}

function staleConflictMessageCoverageFixture() {
  return passedCoverageFixture({
    laneIds: staleConflictMessageLaneIds,
    families: staleConflictMessageCoverageFamilies(),
  });
}

function replacementPrivateChannelRecoveryCoverageFixture() {
  return passedCoverageFixture({
    laneIds: replacementPrivateChannelRecoveryLaneIds,
    families: replacementPrivateChannelRecoveryCoverageFamilies(),
  });
}

function replacementActionRecoveryCoverageFixture() {
  return passedCoverageFixture({
    laneIds: replacementActionLaneIds,
    families: replacementActionRecoveryCoverageFamilies(),
  });
}

function replacementHandoffRecoveryCoverageFixture() {
  return passedCoverageFixture({
    laneIds: replacementHandoffRecoveryLaneIds,
    families: replacementHandoffRecoveryCoverageFamilies(),
  });
}

function passedCoverageFixture({ laneIds, families }) {
  const passedFamilies = families.map((family) => ({
    ...family,
    status: "passed",
    passedLaneIds: [...family.laneIds],
  }));
  return {
    status: "passed",
    laneCount: laneIds.length,
    passedLaneCount: laneIds.length,
    familyCount: passedFamilies.length,
    expectedLaneCount: laneIds.length,
    expectedFamilyCount: passedFamilies.length,
    sourceLaneIds: [...laneIds],
    laneStatuses: passedFamilies.flatMap((family) =>
      family.laneIds.map((laneId) => ({
        id: laneId,
        family: family.id,
        status: "passed",
      })),
    ),
    families: passedFamilies,
  };
}

function releaseReadinessCoverageStatus(
  milestone,
  { status = milestone.status, expectedLaneCount = milestone.expectedLaneCount } = {},
) {
  const summary =
    `passed: ${milestone.coveredLaneCount}/${milestone.requiredLaneCount} ` +
    `lanes across ${milestone.familyCount}/${milestone.expectedFamilyCount} ` +
    "shared families";
  if (status === "drift") {
    return `drift: ${summary}; expected ${expectedLaneCount} shared lanes`;
  }
  return summary;
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
      reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
      staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
      hostedEvidenceStatus: "not_configured",
    },
    checks: hostedOpsSignalCheckStatusRows(),
  };
}

function localRealHostedObservabilityHandoffFixture() {
  const defaultChecklist = realHostedObservabilityHandoffCase();
  const baselineCheck = {
    id: "local-hosted-ops-signals-baseline-carried",
    status: "passed",
  };
  const checklist = realHostedObservabilityHandoffCase({
    inputSections: realHostedObservabilityHandoffInputSections({
      checks: [baselineCheck, ...defaultChecklist.blockedChecks],
    }),
  });
  return {
    version: 1,
    proof: "dev-test-game-real-hosted-observability-handoff",
    status: "blocked",
    releaseReady: false,
    productionReady: false,
    scope: "real-hosted-observability-handoff",
    proofBoundary:
      "Real hosted observability evidence intake with local hosted-like ops signals as baseline only.",
    generatedFrom: {
      game: "game-a",
      hostedOpsSignals: "target/dev-test-game/hosted-ops-signals.json",
      baselineScope: "local-hosted-like-ops-signals",
      realHostedDeploymentStatus: "unproven",
    },
    target: {
      rawEvidencePath: null,
      rawEvidenceStatus: "blocked",
      localHostedOpsSignalsPath: "target/dev-test-game/hosted-ops-signals.json",
      localHostedLikeSignalsOnlyBaseline: true,
    },
    checks: [
      {
        id: "local-hosted-ops-signals-baseline-carried",
        status: "passed",
        evidence: "target/dev-test-game/hosted-ops-signals.json",
        baselineOnly: true,
      },
      ...checklist.blockedChecks,
    ],
    hostedHandoffChecklist: checklist,
    nextCommand: "npm run test:dev-test-game-real-hosted-observability-handoff",
    nextProofTarget:
      "target/dev-test-game/real-hosted-observability-handoff.json",
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
      {
        id: "hosted-frontend-url-configured",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      },
      {
        id: "hosted-api-url-configured",
        status: "blocked",
        requiredEvidence: hostedTargetPreflightMissingApiUrlRequiredEvidence,
      },
      {
        id: "hosted-targets-external",
        status: "blocked",
        requiredEvidence: hostedTargetPreflightExternalTargetsRequiredEvidence(),
      },
      {
        id: "raw-evidence-path-configured",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "raw-evidence-readable",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "raw-evidence-real-hosted-target",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    blockedReceipt: hostedBlockedReceiptFixture({
      proofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      nextProofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
    }),
    nextCommand: "npm run test:dev-test-game-hosted-target-preflight",
    nextProofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
  };
}

function localHostedIdentityEvidenceFixture() {
  const identityAdapterContract = buildDevTestGameIdentityAdapterContractPacket();
  const hostedHandoffChecklist = hostedIdentityEvidenceHandoffCase();
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
      roleSurfaceContractDiff: hostedIdentityRoleSurfaceContractDiff({
        roleSurfaceArchitectureChanged: false,
        roleSurfaceContract: hostedIdentityExpectedRoleSurfaceContract,
      }),
      identityAdapterContractComparison: {
        status: "passed",
        localAdapterId: identityAdapterContract.adapterId,
        hostedAdapterId: identityAdapterContract.adapterId,
        localStatus: identityAdapterContract.status,
        hostedStatus: identityAdapterContract.status,
        roleSurfaceContractStatus: "passed",
        local: identityAdapterContract,
        hosted: identityAdapterContract,
        mismatches: devTestGameIdentityAdapterContractDiff(
          identityAdapterContract,
        ).mismatches,
      },
      identityProviderBoundary: hostedIdentityEvidenceOperatorGate.providerBoundary,
      redactedIntakePacket: localHostedIdentityRedactedIntakePacketFixture(),
    },
    checks: hostedIdentityEvidenceBlockedChecks.map((check) => ({
      id: check.id,
      status: "blocked",
      requiredEvidence: check.requiredEvidence,
    })),
    hostedHandoffChecklist,
    nextCommand: "npm run test:dev-test-game-hosted-identity-evidence",
    nextProofTarget: HOSTED_IDENTITY_EVIDENCE_PROOF_TARGET,
  };
}

function normalizedHostedIdentityOperatorGateFixture() {
  return {
    ...hostedIdentityEvidenceOperatorGate,
    providerBoundary: normalizeHostedIdentityProviderBoundaryFixture(
      hostedIdentityEvidenceOperatorGate.providerBoundary,
    ),
  };
}

function normalizeHostedIdentityProviderBoundaryFixture(boundary) {
  return {
    id: boundary.id,
    status: boundary.status,
    architectureId: boundary.architectureId,
    roleSurfaceArchitectureChanged:
      boundary.roleSurfaceArchitectureChanged === true,
    providerCount: boundary.providers.length,
    proofBoundary: boundary.proofBoundary,
    providers: boundary.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      mode: provider.mode,
      status: provider.status,
      accountCredential: provider.accountCredential,
      inviteCredential: provider.inviteCredential,
      sessionCredential: provider.sessionCredential,
      loginBoundary: provider.loginBoundary,
      sessionBoundary: provider.sessionBoundary,
      sessionGrantBoundary: provider.sessionGrantBoundary,
      browserCookieName: provider.browserCookieName,
      rawCredentialPolicy: provider.rawCredentialPolicy,
      roleSurfaceArchitectureChanged:
        provider.roleSurfaceArchitectureChanged === true,
      requiredEvidence: String(provider.requiredEvidence ?? ""),
    })),
  };
}

function localHostedIdentityRedactedIntakePacketFixture() {
  return {
    kind: "redacted-hosted-identity-intake",
    status: "missing",
    sectionCount: 6,
    providedSectionCount: 0,
    missingSectionCount: 6,
    requiredInputCount: 16,
    providedInputCount: 0,
    missingInputCount: 16,
    redactedEvidenceRefCount: 0,
    rawInviteTokensIncluded: false,
    rawSessionSecretsIncluded: false,
    rawPasswordHashesIncluded: false,
    rawPersonalContactIncluded: false,
    roleSurfaceArchitectureChanged: false,
    sections: hostedIdentityEvidencePacketSectionDefinitions.map((section) => ({
      id: section.field,
      checkId: section.checkId,
      label: section.label,
      status: "missing",
      requiredInputIds: [...section.requiredInputIds],
      providedInputIds: [],
      redactedEvidenceRefCount: 0,
      redactedEvidenceRefs: [],
      missingInputs: [
        "status-provided",
        ...section.requiredInputIds,
        "redactedEvidenceRefs",
      ],
    })),
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
      "raw-evidence-real-hosted-target",
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
      {
        id: "hosted-target-preflight",
        status: "blocked",
        requiredEvidence:
          "Pass hosted target preflight before external hosted evidence normalization.",
      },
      {
        id: "hosted-frontend-url-configured",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      },
      {
        id: "hosted-api-url-configured",
        status: "blocked",
        requiredEvidence: hostedTargetPreflightMissingApiUrlRequiredEvidence,
      },
      {
        id: "hosted-targets-external",
        status: "blocked",
        requiredEvidence: hostedTargetPreflightExternalTargetsRequiredEvidence(),
      },
      {
        id: "raw-evidence-path-configured",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "raw-evidence-readable",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "raw-evidence-real-hosted-target",
        status: "blocked",
        requiredEvidence:
          hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
    blockedReceipt: hostedBlockedReceiptFixture({
      proofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      nextProofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
    }),
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
      blockedRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      syntheticRejectedRoleUrl:
        localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
    },
    checks: [
      {
        id: "blocked-lane-recorded",
        status: "blocked",
      },
      {
        id: "synthetic-raw-evidence-written",
        status: "passed",
      },
      {
        id: "synthetic-lane-rejected",
        status: "blocked",
      },
      {
        id: "demo-external-evidence-written",
        status: "passed",
      },
      {
        id: "synthetic-demo-boundary-carried",
        status: "passed",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
      },
    ],
    blockedLane: {
      status: "blocked",
      preflightStatus: "blocked",
      blockedCheckIds: ["hosted-frontend-url-configured"],
    },
    syntheticRejectedLane: {
      status: "blocked",
      preflightStatus: "blocked",
      blockedCheckIds: ["raw-evidence-real-hosted-target"],
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
    proofLaneCoverage: seedProofLaneCoverageFixture(),
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
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedTargetPreflight),
      },
      hostedEvidenceLane: {
        script: "test:dev-test-game-hosted-evidence-lane",
        proofArtifact: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      },
      hostedEvidenceLaneDemoProof: {
        script: "test:dev-test-game-hosted-evidence-lane-demo-proof",
        proofArtifact:
          "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
        demoOnly: true,
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      },
      nextAction: {
        script: "test:dev-test-game-next-action",
        proofArtifact: "target/dev-test-game/next-action.json",
      },
      nextActionAdminProof: {
        script: "test:dev-test-game-next-action-admin-proof",
        proofArtifact: "target/dev-test-game/next-action-admin-proof.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
      },
      proofGraph: {
        script: "test:dev-test-game-proof-graph",
        proofArtifact: "target/dev-test-game/proof-graph.json",
      },
      proofGraphAdminProof: {
        script: "test:dev-test-game-proof-graph-admin-proof",
        proofArtifact: "target/dev-test-game/proof-graph-admin-proof.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
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
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.nextAction),
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
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.proofGraph),
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
      devTestGameSpineManifestAdminProofPath,
      "target/dev-test-game/proof-freshness-admin-proof.json",
      "target/dev-test-game/hosted-concurrent-race-matrix.json",
      HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      HOSTED_EVIDENCE_LANE_PROOF_TARGET,
      "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
      "target/dev-test-game/hosted-matrix-demo-raw.json",
      "target/dev-test-game/hosted-matrix-demo-external.json",
      "target/dev-test-game/hosted-evidence-lane-demo-blocked.json",
      "target/dev-test-game/hosted-evidence-lane-demo-synthetic-rejected.json",
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
    freshnessArtifact("host-setup-role", "fresh"),
    freshnessArtifact("host-setup-admin", "fresh"),
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
  sequenceDeferral,
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
            localAdminAuditRoleUrl(localAdminAuditIds.hostedConcurrentRaceMatrix),
          proofGraphNodeId: "admin-proof:hosted-concurrent-race-matrix",
          productionFeatureSpineTarget: productionFeatureSpineTargetFixture(),
          spineDrilldown: featureSpineDrilldownFixture(),
          spineTarget: featureSpineTargetFixture(),
          selectedProductionFeatureGraph:
            selectedProductionFeatureGraphFixture(),
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
  proofGraphDestinationSummary,
  proofGraphDestinationSummaryTrace =
    proofGraphDestinationSummaryTraceFixture({
      proofGraphDestinationSummary,
    }),
  proofGraphDiagnosticSummaryTrace = proofGraphDiagnosticSummaryTraceFixture(),
  replacementRaceReloadTrace = replacementRaceReloadTraceFixture(),
  hostConcurrentRaceReloadTrace = hostConcurrentRaceReloadTraceFixture(),
  playerConcurrentActionReloadTrace = playerConcurrentActionReloadTraceFixture(),
  cohostDeadlineRaceReloadTrace = cohostDeadlineRaceReloadTraceFixture(),
  raceCoveragePromotedMilestones = raceCoveragePromotedMilestonesFixture(),
  staleConflictMessageTrace = staleConflictMessageTraceFixture(),
  hostStaleControlTrace = hostStaleControlTraceFixture(),
  terminalBatchGraph,
  nextActionHandoffPair,
  privateChannelRecoveryGraph,
  replacementActionRecoveryGraph,
  replacementHandoffRecoveryGraph,
  replacementPrivateRecoveryGraph,
  frontendSetupWorkbenchReadiness,
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
        artifactCount: 25,
        freshCount: 25,
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
      proofGraph: "target/dev-test-game/proof-graph.json",
      proofGraphGeneratedAt: "2026-06-26T00:00:00.000Z",
      proofGraphDestinationSummaryStatus:
        proofGraphDestinationSummaryTrace.status,
      proofGraphDestinationSummaryDriftCount:
        proofGraphDestinationSummaryTrace.driftCount,
      proofGraphDiagnosticSummaryStatus:
        proofGraphDiagnosticSummaryTrace.status,
      proofGraphDiagnosticCount:
        proofGraphDiagnosticSummaryTrace.diagnosticCount,
      ...(terminalBatchGraph === undefined ? {} : { terminalBatchGraph }),
      ...(nextActionHandoffPair === undefined
        ? {}
        : { nextActionHandoffPair }),
      ...(privateChannelRecoveryGraph === undefined
        ? {}
        : { privateChannelRecoveryGraph }),
      ...(replacementActionRecoveryGraph === undefined
        ? {}
        : { replacementActionRecoveryGraph }),
      ...(replacementHandoffRecoveryGraph === undefined
        ? {}
        : { replacementHandoffRecoveryGraph }),
      ...(replacementPrivateRecoveryGraph === undefined
        ? {}
        : { replacementPrivateRecoveryGraph }),
      seedProofLaneCoverageStatus: seedProofLaneCoverageTrace.status,
      seedProofLaneCoverageUnclassifiedCount:
        seedProofLaneCoverageTrace.unclassifiedLaneCount,
      ...(frontendSetupWorkbenchReadiness === undefined
        ? {}
        : {
            frontendReadinessSummary:
              "target/frontend-readiness-summary/readiness-summary.json",
            frontendSetupWorkbenchReadiness,
          }),
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
      ...(proofGraphDestinationSummary === undefined
        ? {}
        : { proofGraphDestinationSummary }),
      ...(sequenceDeferral === undefined ? {} : { sequenceDeferral }),
    },
    selectionTrace,
    stabilityTrace,
    proofGraphDestinationSummaryTrace,
    proofGraphDiagnosticSummaryTrace,
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

function frontendSetupWorkbenchReadinessFixture() {
  return {
    id: "host-setup-workbench",
    label: "Host setup workbench geometry",
    state: "browser_proven",
    route: "/g/midsummer/setup",
    localStatus: "browser_proven",
    importedStatus: "imported_browser_proven",
    localViewportLayouts: [
      {
        viewport: "mobile",
        layout: "stacked",
        slotCount: 2,
        noHorizontalOverflow: true,
        screenshot: "target/frontend-role-smoke/mobile-host-setup.png",
      },
      {
        viewport: "tablet",
        layout: "co-located-columns",
        slotCount: 2,
        noHorizontalOverflow: true,
        screenshot: "target/frontend-role-smoke/tablet-host-setup.png",
      },
      {
        viewport: "desktop",
        layout: "co-located-columns",
        slotCount: 2,
        noHorizontalOverflow: true,
        screenshot: "target/frontend-role-smoke/desktop-host-setup.png",
      },
    ],
    localScreenshotCount: 3,
    importedSetupCount: 3,
    importedScreenshotCheckCount: 3,
    proofBoundary:
      "Frontend readiness summary host-setup-workbench lane only; separates browser geometry proof from dev-test-game host setup role recovery and does not claim hosted, release, or production readiness.",
  };
}

function proofGraphHandoffLocalCheckFixture() {
  const check = localReadinessDependencyCheckFor(
    localProofGraphAdminRoleHandoffsCheckId,
  );
  return {
    id: check.id,
    status: check.status,
    ...check.recovery,
  };
}

function proofGraphNextActionHandoffLocalCheckFixture() {
  const check = localReadinessDependencyCheckFor(
    localProofGraphNextActionHandoffCheckId,
  );
  return {
    id: check.id,
    status: check.status,
    ...check.recovery,
  };
}

function seedProofLaneCoverageActionFixture({ unclassifiedLaneIds }) {
  const coverage = seedProofLaneCoverageFixture({ unclassifiedLaneIds });
  return {
    source: "target/dev-test-game/release-readiness-checklist.json",
    status: "drifted",
    passedLaneCount: coverage.passedLaneCount,
    unclassifiedLaneCount: unclassifiedLaneIds.length,
    unclassifiedLaneIds,
    buildSlice:
      "Classify every passed proof lane as direct seeded, alias-covered, or aggregate-only before expanding the production-facing seeded proof spine.",
    proofTarget: "target/dev-test-game/seed-fixture-summary.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures),
  };
}

function proofGraphDestinationSummaryActionFixture({
  driftCount = 1,
  summaryStatus = "drift",
} = {}) {
  return {
    source: "target/dev-test-game/proof-graph.json",
    summaryStatus,
    totalDestinationCount: 12,
    productionFeatureTargetCount: 11,
    adminAuditDestinationCount: 8,
    roleUrlDestinationCount: 4,
    driftCount,
    buildSlice:
      "Refresh the proof graph so its production-feature destination summary matches the production-feature target inventory before next-action or readiness guidance is trusted.",
    proofTarget: "target/dev-test-game/proof-graph.json",
  };
}

function proofGraphDestinationSummaryTraceFixture({
  proofGraphDestinationSummary,
} = {}) {
  return buildProofGraphDestinationSummaryTrace({
    strategy: "proof-graph-destination-summary-before-readiness",
    status:
      proofGraphDestinationSummary === undefined ? "clean" : "drifted",
    source:
      proofGraphDestinationSummary?.source ??
      "target/dev-test-game/proof-graph.json",
    summaryStatus: proofGraphDestinationSummary?.summaryStatus ?? "passed",
    totalDestinationCount:
      proofGraphDestinationSummary?.totalDestinationCount ?? 11,
    productionFeatureTargetCount:
      proofGraphDestinationSummary?.productionFeatureTargetCount ?? 11,
    adminAuditDestinationCount:
      proofGraphDestinationSummary?.adminAuditDestinationCount ?? 7,
    roleUrlDestinationCount:
      proofGraphDestinationSummary?.roleUrlDestinationCount ?? 4,
    driftCount: proofGraphDestinationSummary?.driftCount ?? 0,
  });
}

function proofGraphDiagnosticSummaryTraceFixture({
  nodes = proofGraphDiagnosticProofNodes,
} = {}) {
  return buildProofGraphDiagnosticSummaryTrace(
    {
      nodes,
      summary: {},
    },
    { source: "target/dev-test-game/proof-graph.json" },
  );
}

function hostedIdentitySequenceDeferralFixture() {
  return {
    status: "blocked",
    currentSequenceStage: "local-capability-model",
    requiredSequenceStage: "hosted-identity",
    deferredUnprovenId: "hosted-production-identity",
    deferredCommand: "npm run test:dev-test-game-hosted-identity-evidence",
    deferredProofTarget: "target/dev-test-game/hosted-identity-evidence.json",
    deferredRoleUrl: localAdminAuditRoleUrl(
      localAdminAuditIds.hostedIdentityEvidence,
    ),
    nextLocalCommand: "npm run test:dev-test-game-next-action:hosted-identity",
    nextLocalProofTarget: "target/dev-test-game/next-action.json",
    sequenceTransition: {
      status: "ready",
      promotionCommand: "npm run test:dev-test-game-next-action:hosted-identity",
      promotedSequenceStage: "hosted-identity",
    },
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.identityAdapter),
    buildSlice:
      "Keep hosted production identity deferred while the local seeded capability model remains the active architecture sequence; refresh the core-live role proof before replacing dev tokens with hosted accounts, sessions, and invites.",
    requiredBeforeHostedIdentity:
      "The local core gameplay, hardening, and local ops proof spine should remain the trusted development surface before production identity replaces dev tokens.",
    localCapabilityConfidence: hostedIdentityLocalCapabilityConfidenceFixture(),
    proofBoundary:
      "Sequencing hold only. This records that hosted production identity is a real release-readiness blocker, but not the next local-development command; it does not prove hosted account lifecycle, invite delivery, release readiness, or production readiness.",
  };
}

function hostedIdentityLocalCapabilityConfidenceFixture() {
  return {
    status: "passed",
    source: "target/dev-test-game/release-readiness-checklist.json",
    requiredCheckIds: [
      "local-core-loop-proof",
      "local-hardening-proof",
      "local-ops-artifact-bundle",
      "local-seed-demo-fixture",
      "local-identity-adapter-proof",
    ],
    checkCount: 5,
    passedCheckCount: 5,
    checks: [
      {
        id: "local-core-loop-proof",
        label:
          "Host controls, replacement, player actions, private channels, and day/night loop",
        status: "passed",
        evidence: "target/dev-test-game/proof-run.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
        proofBoundary: "",
      },
      {
        id: "local-hardening-proof",
        label:
          "Idempotency, reconnect, stale-client, and local concurrent race matrix",
        status: "passed",
        evidence: "target/dev-test-game/proof-run.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
        proofBoundary: "",
      },
      {
        id: "local-ops-artifact-bundle",
        label: "Local ops artifact bundle",
        status: "passed",
        evidence: "target/dev-test-game/ops-artifacts.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.opsArtifacts),
        proofBoundary: "Local ops artifact bundle.",
      },
      {
        id: "local-seed-demo-fixture",
        label: "Local seed/demo fixture summary",
        status: "passed",
        evidence: "target/dev-test-game/seed-fixture-summary.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.seedFixtures),
        proofBoundary:
          "Local seed/demo fixture inventory for one dev-test-game run.",
      },
      {
        id: "local-identity-adapter-proof",
        label: "Local production-identity adapter proof",
        status: "passed",
        evidence: "target/auth-invite-role-proof/invite-role-proof.json",
        roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.identityAdapter),
        proofBoundary:
          "Local identity adapter proof keeps role surfaces stable.",
      },
    ],
    proofBoundary:
      "Local capability-model confidence is derived from the current release-readiness checklist. It requires passed core-loop, hardening, local ops, seed/demo fixture, and local identity-adapter rows before hosted identity can move out of sequencing deferral; it does not prove hosted accounts, sessions, invites, release readiness, or production readiness.",
  };
}

function proofGraphFixture() {
  const productionFeatureCase = proofGraphProductionFeatureCase({
    spineTarget: featureSpineTargetFixture(),
  });
  const recoveryReceiptCases = proofGraphRecoveryReceiptCases();
  const nodes = [
    ...devTestGameProofGraphFirstClassNodes(),
    proofGraphProductionFeatureNode(productionFeatureCase),
    ...proofGraphRecoveryReceiptNodes(recoveryReceiptCases),
    ...adminProofDestinationProofGraphNodes(),
  ];
  const edges = [
    ...devTestGameProofGraphBaseEdges(),
    proofGraphProductionFeatureEdge(productionFeatureCase),
    ...proofGraphRecoveryReceiptEdges(recoveryReceiptCases),
  ];
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
      adminSpineTerminalBatches:
        "target/dev-test-game/admin-spine-terminal-batches.json",
    },
    summary: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      roleUrlCount: nodes.filter((node) => node.roleUrl).length,
      recoveryTargetCount: nodes.filter((node) => node.recoveryCommand).length,
      diagnosticProofSummary: buildProofGraphDiagnosticProofSummary({ nodes }),
      productionFeatureTargetCount: 1,
      productionFeatureDestinationSummary:
        proofGraphProductionFeatureDestinationSummary({
          nodes,
          summary: {
            productionFeatureTargetCount: 1,
          },
        }),
      terminalBatchCount: 3,
    },
    nodes,
    edges,
  };
}

function proofGraphWithDuplicateTerminalReceiptProofIds() {
  const proofGraph = proofGraphFixture();
  return {
    ...proofGraph,
    nodes: proofGraph.nodes.map((node) =>
      node.id === "admin-spine-terminal-batches"
        ? {
            ...node,
            receiptArtifacts: terminalBatchReceiptArtifactsFixture(),
          }
        : node,
    ),
  };
}

function proofGraphRecoveryReceiptCases() {
  return [
    proofGraphRecoveryReceiptCase({
      descriptor: recoveryReceiptGraphDescriptorByReceiptKey(
        "privateChannelRecoveryReceipt",
      ),
      graph: privateChannelRecoveryGraphFixture(),
    }),
    proofGraphRecoveryReceiptCase({
      descriptor: recoveryReceiptGraphDescriptorByReceiptKey(
        "replacementPrivateRecoveryReceipt",
      ),
      graph: replacementPrivateRecoveryGraphFixture(),
    }),
  ];
}

function terminalBatchGraphFixture() {
  return {
    nodeId: "admin-spine-terminal-batches",
    status: "passed",
    proofTarget: "target/dev-test-game/admin-spine-terminal-batches.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.adminSpine),
    batchCount: 3,
    proofIds: [
      "proof-graph",
      "proof-freshness",
      "next-action",
      "hosted-identity-next-action",
    ],
    edgeCount: 3,
    edgeTargets: ["proof-graph", "proof-freshness", "next-action"],
    receiptArtifacts: terminalBatchReceiptArtifactsFixture(),
  };
}

function terminalBatchReceiptArtifactsFixture() {
  return terminalProofGraphReceiptArtifacts.map((artifact) => ({ ...artifact }));
}

function privateChannelRecoveryGraphFixture() {
  return {
    nodeId: "private-channel-recovery-receipt",
    status: "passed",
    proofTarget: "target/dev-test-game/private-channel-recovery-receipt.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    familyId: "core-loop-private-channel-recovery",
    laneCount: 4,
    laneIds: [
      "private-channel",
      "private-channel-stale-post-after-transition",
      "private-channel-completed-game-recovery",
      "private-channel-invalid-action-recovery",
    ],
    normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
      privateChannelNormalizedEvidenceObjects,
    ),
    edgeCount: 3,
    edgeTargets: ["admin-proof:core-loop", "proof-graph", "next-action"],
  };
}

function replacementActionRecoveryGraphFixture() {
  return {
    nodeId: "replacement-action-recovery-receipt",
    status: "passed",
    proofTarget: "target/dev-test-game/replacement-action-recovery-receipt.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    familyId: "replacement-action-recovery",
    laneCount: 3,
    laneIds: [
      "replacement-incoming-action",
      "replacement-action-reconnect",
      "replacement-stale-action-after-resolve",
    ],
    edgeCount: 3,
    edgeTargets: ["admin-proof:hardening", "proof-graph", "next-action"],
  };
}

function replacementHandoffRecoveryGraphFixture() {
  return {
    nodeId: "replacement-handoff-recovery-receipt",
    status: "passed",
    proofTarget: "target/dev-test-game/replacement-handoff-recovery-receipt.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    familyId: "replacement-handoff-recovery",
    laneCount: replacementHandoffRecoveryLaneIds.length,
    laneIds: [...replacementHandoffRecoveryLaneIds],
    edgeCount: 3,
    edgeTargets: ["admin-proof:hardening", "proof-graph", "next-action"],
  };
}

function replacementPrivateRecoveryGraphFixture() {
  return {
    nodeId: "replacement-private-recovery-receipt",
    status: "passed",
    proofTarget:
      "target/dev-test-game/replacement-private-channel-recovery-receipt.json",
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hardening),
    familyId: "replacement-private-channel-recovery",
    laneCount: 6,
    laneIds: [
      "replacement-stale-private-channel",
      "replacement-stale-private-receipts",
      "replacement-stale-private-post-after-resolve",
      "replacement-stale-private-post-reconnect",
      "replacement-stale-private-post-after-complete",
      "replacement-stale-private-post-after-complete-reload",
    ],
    normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
      replacementPrivatePostNormalizedEvidenceObjects,
    ),
    edgeCount: 3,
    edgeTargets: ["admin-proof:hardening", "proof-graph", "next-action"],
  };
}

function expectedPassedNormalizedEvidenceObjects(objects) {
  return objects.map((object) => ({
    ...object,
    status: "passed",
    evidencePath: `lanes.${object.laneId}.evidence.${object.name}`,
  }));
}

function expectedNormalizedEvidenceObjectCheckRows({ parentId, objects }) {
  return expectedPassedNormalizedEvidenceObjects(objects).map((object) => [
    `evidence-object:${parentId}:${object.name}`,
    `${object.status}:${object.laneId}:${object.evidencePath}`,
  ]);
}

function expectedProofGraphCheckRows(proofGraph) {
  return normalizeLocalProofGraphCheckRows(proofGraph).map((check) => [
    check.id,
    check.status,
  ]);
}

function expectedProofGraphRelatedLinkRows(proofGraph, { game } = {}) {
  return normalizeLocalProofGraphRelatedLinks(proofGraph, { game }).map((link) => [
    link.id,
    link.href,
  ]);
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

function hostedMatrixLaneFixture(id) {
  return laneFixture(
    id,
    String(id)
      .split("-")
      .filter((part) => part !== "")
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
      .join(" "),
  );
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
      reconnectLaneCount: hostedMatrixReconnectLaneIds.length,
      staleConflictLaneCount: hostedMatrixStaleConflictLaneIds.length,
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
    realHostedEvidenceInputs: realHostedEvidenceInputsFixture({
      command: hostedMatrixRealHostedEvidenceCommand,
      proofTarget: hostedMatrixExternalEvidenceProofTarget,
    }),
    hostedHandoffChecklist: hostedMatrixRealHostedHandoffChecklist({
      preflightStatus: "not_configured",
    }),
    externalHostedEvidence: {
      status: "not_configured",
      frontendBaseUrl: null,
      apiBaseUrl: null,
      evidencePath: null,
    },
    cells,
    reconnectLanes: hostedMatrixReconnectLaneIds.map(hostedMatrixLaneFixture),
    staleConflictLanes: hostedMatrixStaleConflictLaneIds.map(
      hostedMatrixLaneFixture,
    ),
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

function realHostedEvidenceInputsFixture(options = {}) {
  if (
    options.command !== undefined ||
    options.proofTarget !== undefined
  ) {
    return buildRealHostedEvidenceInputs({
      status: "unproven",
      mode: "not_configured",
      ...options,
    });
  }
  return hostedEvidenceRealHostedInputsFixture();
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
        proofBoundary: unproven.proofBoundary ?? "",
        roleUrl: unproven.roleUrl,
        proofGraphNodeId: unproven.proofGraphNodeId,
        actionStatus: unproven.actionStatus ?? "ready",
        productionFeatureSpineTarget: unproven.productionFeatureSpineTarget,
        spineDrilldown: unproven.spineDrilldown,
        spineTarget: unproven.spineTarget,
        ...(unproven.selectedProductionFeatureGraph === undefined
          ? {}
          : {
              selectedProductionFeatureGraph:
                unproven.selectedProductionFeatureGraph,
            }),
        ...(unproven.hostedHandoffChecklist === undefined
          ? {}
          : { hostedHandoffChecklist: unproven.hostedHandoffChecklist }),
      },
    ],
  };
}

function hostedEvidenceLaneUnprovenFixture() {
  return sharedHostedEvidenceLaneUnprovenFixture({
    requiredEvidence:
      "Externally reachable hosted API/frontend deployment and raw hosted evidence.",
    proofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
    roleUrlsById: { "d02-n02-host": HOST_SPINE_ROLE_URL },
    browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
    realHostedEvidenceInputs: realHostedEvidenceInputsFixture(),
    hostedHandoffChecklist: hostedHandoffChecklistFixture(),
  });
}

function hostedHandoffChecklistFixture() {
  return hostedEvidenceBlockedHandoffChecklistFixture({
    proofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
    blockedReceipt: hostedBlockedReceiptFixture({
      proofTarget: HOSTED_TARGET_PREFLIGHT_PROOF_TARGET,
      nextProofTarget: HOSTED_EVIDENCE_LANE_PROOF_TARGET,
    }),
  });
}

function hostedBlockedReceiptFixture({ proofTarget, nextProofTarget }) {
  return {
    status: "blocked",
    blockedCheckIds: [
      "hosted-frontend-url-configured",
      "hosted-api-url-configured",
      "hosted-targets-external",
      "raw-evidence-path-configured",
      "raw-evidence-readable",
      "raw-evidence-real-hosted-target",
    ],
    command: "npm run test:dev-test-game-hosted-evidence-lane",
    proofTarget,
    nextProofTarget,
    requiredInputs: [
      {
        name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        value: null,
        required: true,
        purpose: "Externally reachable frontend base URL.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_API_URL",
        value: null,
        required: true,
        purpose: "Externally reachable API base URL for the same hosted deployment.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
        value: "replacement-race-reload",
        required: true,
        purpose: "Hosted matrix group to prove.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        value: null,
        required: true,
        purpose: hostedMatrixRawEvidenceContractSummary(),
      },
    ],
    missingRequiredInputs: [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
    firstMissingOperatorArtifact: {
      inputId: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      checkId: "hosted-frontend-url-configured",
      sectionId: "hosted-target",
      sectionLabel: "Hosted target",
      requiredEvidence: hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
      purpose: "Externally reachable frontend base URL.",
      proofTarget,
      roleSurfaceDrilldown: {
        localCapabilityAuditId: localAdminAuditIds.coreLoop,
        localCapabilityRoleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.coreLoop,
        ),
        handoffAuditId: localAdminAuditIds.hostedEvidenceLane,
        handoffRoleUrl: localAdminAuditRoleUrl(
          localAdminAuditIds.hostedEvidenceLane,
        ),
        proofGraphNodeId: "admin-proof:hosted-evidence-lane",
        productionFeatureGraphNodeId: "production-feature:host-phase-control",
        proofGraphEvidencePath: "target/dev-test-game/proof-graph.json",
      },
    },
    operatorAction:
      "Configure the hosted frontend/API URLs plus a readable raw hosted matrix evidence packet from that same deployment, then rerun npm run test:dev-test-game-hosted-evidence-lane.",
    rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
    localVsHostedBoundary:
      "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
  };
}

function playerActionSubmissionSpineFixture() {
  return featureSpineFixture({
    slotId: "player-action-submission",
    roleUrl: ACTIONABLE_SPINE_ROLE_URL,
    browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
    includeEmptyRecoveryHook: true,
  });
}

function productionFeatureSpineTargetFixture() {
  return playerActionSubmissionSpineFixture().productionFeatureSpineTarget;
}

function featureSpineTargetFixture() {
  return playerActionSubmissionSpineFixture().spineTarget;
}

function featureSpineDrilldownFixture() {
  return playerActionSubmissionSpineFixture().spineDrilldown;
}

function selectedProductionFeatureGraphFixture() {
  return {
    nodeId: "production-feature:player-action-submission",
    status: "passed",
    sourceNodeId: "admin-proof:core-loop",
    edge: {
      from: "admin-proof:core-loop",
      to: "production-feature:player-action-submission",
      relationship: "proves-production-feature",
    },
    roleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
    targetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
    edgeTargetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
    selectedSpineTargetRoleUrl: ACTIONABLE_SPINE_ROLE_URL,
    targetRoleUrlMatchesSelectedSpineTarget: true,
    browserProofCommand: LIVE_BROWSER_PROOF_COMMAND,
    proofTarget: "target/dev-test-game/release-readiness-checklist.json",
    coverageDecision: featureSpineTargetFixture().coverageDecision,
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
  return buildProofStabilityTrace({
    status: stability === undefined ? "clean" : "drifted",
    hostConfirmClicks: Number(stability?.hostConfirmClicks ?? 55),
    retryClickCount: Number(stability?.retryClickCount ?? 0),
    domFallbackCount: Number(stability?.domFallbackCount ?? 0),
    forceFallbackCount: Number(stability?.forceFallbackCount ?? 0),
    failureCount: Number(stability?.failureCount ?? 0),
    maxAttempts: Number(stability?.maxAttempts ?? 1),
    events: Array.from({
      length: Number(stability?.eventCount ?? 0),
    }),
  });
}

function seedProofLaneCoverageTraceFixture({ seedProofLaneCoverage } = {}) {
  const cleanCoverage = seedProofLaneCoverageFixture();
  const cleanCoverageCounts = seedProofLaneCoverageCountSummary(cleanCoverage);
  const unclassifiedLaneIds =
    seedProofLaneCoverage?.unclassifiedLaneIds?.map((laneId) => String(laneId)) ??
    [];
  return {
    strategy: "seed-proof-lane-coverage-before-readiness",
    status: seedProofLaneCoverage === undefined ? "clean" : "drifted",
    source: "target/dev-test-game/release-readiness-checklist.json",
    checkId: "local-seed-demo-fixture",
    selected: seedProofLaneCoverage !== undefined,
    passedLaneCount: Number(
      seedProofLaneCoverage?.passedLaneCount ?? cleanCoverage.passedLaneCount,
    ),
    directSeededLaneCount: cleanCoverageCounts.directSeededLaneCount,
    aliasOnlyLaneCount: cleanCoverageCounts.aliasOnlyLaneCount,
    aggregateOnlyLaneCount: cleanCoverageCounts.aggregateOnlyLaneCount,
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
    surfaceCoverage: staleConflictMessageSurfaceCoverageFixture(),
    surfaces: staleConflictMessageSurfaceFixtureRows(),
  };
}

function staleConflictMessageSurfaceCoverageFixture() {
  return {
    status: "complete",
    requiredSurfaceCount: staleConflictMessageLaneIds.length,
    coveredSurfaceCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
  };
}

function staleConflictMessageSurfaceFixtureRows() {
  return staleConflictMessageSurfaceCases().map((scenario) => ({
    id: scenario.id,
    checkId: scenario.checkId,
    label: scenario.label,
    status: "passed",
    laneId: scenario.laneId,
    roleUrl: "http://127.0.0.1:5173/g/game-a",
    rejectError: scenario.expectedRejectError,
    rejectMessage:
      scenario.expectedRejectMessageFragment === undefined
        ? ""
        : `Reject ${scenario.expectedRejectError}: ${scenario.expectedRejectMessageFragment}`,
    receiptStatusText:
      scenario.expectedReceiptFragment === undefined
        ? ""
        : `Reject ${scenario.expectedRejectError}: ${scenario.expectedReceiptFragment}`,
    proofBoundary: scenario.proofBoundary,
  }));
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
    [
      "stale-conflict-message-surface-coverage",
      `${staleConflictMessageLaneIds.length}/${staleConflictMessageLaneIds.length} complete`,
    ],
    ...staleConflictMessageLaneIds.map((laneId) => [
      `stale-conflict-message-${laneId}`,
      "covered",
    ]),
    ...staleConflictMessageSurfaceFixtureRows().map((surface) => [
      surface.checkId,
      `${surface.status}:${surface.rejectError}`,
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
        "core-loop": devTestGameCoreLoopAdminProofPath,
        hardening: devTestGameHardeningAdminProofPath,
        identity: devTestGameIdentityAdminProofPath,
        backup: devTestGameBackupAdminProofPath,
        ops: devTestGameOpsAdminProofPath,
        seed: devTestGameSeedAdminProofPath,
        release: "target/dev-test-game/release-admin-proof.json",
        "race-coverage": "target/dev-test-game/race-coverage-admin-proof.json",
        "hosted-concurrent-race-matrix":
          "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
        "spine-manifest": devTestGameSpineManifestAdminProofPath,
      },
    },
    adminProofs: [
      adminSpineProofRow("core-loop"),
      adminSpineProofRow("hardening"),
      adminSpineProofRow("identity"),
      adminSpineProofRow("backup"),
      adminSpineProofRow("ops"),
      adminSpineProofRow("seed"),
      adminSpineProofRow("host-setup"),
      adminSpineProofRow("release"),
      adminSpineProofRow("race-coverage"),
      adminSpineProofRow("hosted-concurrent-race-matrix"),
      adminSpineProofRow("spine-manifest"),
    ],
    batches: [
      {
        label: "Aggregate pre-release admin proof batch",
        reason: "pre-readiness local proof inputs",
        status: "passed",
        caseCount: 7,
        caseSmokeNames: [
          "dev-test-game-core-loop-admin-proof",
          "dev-test-game-hardening-admin-proof",
          "dev-test-game-identity-admin-proof",
          "dev-test-game-backup-admin-proof",
          "dev-test-game-ops-admin-proof",
          "dev-test-game-seed-admin-proof",
          "dev-test-game-host-setup-admin-proof",
        ],
        proofIds: [
          "core-loop",
          "hardening",
          "identity",
          "backup",
          "ops",
          "seed",
          "host-setup",
        ],
        artifactPaths: [
          devTestGameCoreLoopAdminProofPath,
          devTestGameHardeningAdminProofPath,
          devTestGameIdentityAdminProofPath,
          devTestGameBackupAdminProofPath,
          devTestGameOpsAdminProofPath,
          devTestGameSeedAdminProofPath,
          devTestGameHostSetupAdminProofPath,
        ],
        elapsedMs: 1200,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
      {
        label: "Aggregate release and hosted admin proof batch",
        reason: "post-readiness rollup inputs",
        status: "passed",
        caseCount: 4,
        caseSmokeNames: [
          "dev-test-game-release-admin-proof",
          "dev-test-game-race-coverage-admin-proof",
          "dev-test-game-hosted-concurrent-race-matrix-admin-proof",
          "dev-test-game-spine-manifest-admin-proof",
        ],
        proofIds: [
          "release",
          "race-coverage",
          "hosted-concurrent-race-matrix",
          "spine-manifest",
        ],
        artifactPaths: [
          "target/dev-test-game/release-admin-proof.json",
          "target/dev-test-game/race-coverage-admin-proof.json",
          "target/dev-test-game/hosted-concurrent-race-matrix-admin-proof.json",
          devTestGameSpineManifestAdminProofPath,
        ],
        elapsedMs: 1800,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
    ],
    recovery: {
      status: "passed",
      surfaceCount: 11,
      refreshedCount: 11,
      nextCommand: "npm run test:dev-test-game-admin-spine",
      proofBoundary: "Local aggregate recovery commands only.",
      surfaces: [
        adminSpineRecoveryRow("core-loop"),
        adminSpineRecoveryRow("hardening"),
        adminSpineRecoveryRow("identity"),
        adminSpineRecoveryRow("backup"),
        adminSpineRecoveryRow("ops"),
        adminSpineRecoveryRow("seed"),
        adminSpineRecoveryRow("host-setup"),
        adminSpineRecoveryRow("release"),
        adminSpineRecoveryRow("race-coverage"),
        adminSpineRecoveryRow("hosted-concurrent-race-matrix"),
        adminSpineRecoveryRow("spine-manifest"),
      ],
    },
    proofBoundary: "Local aggregate admin spine proof only.",
  };
}

function adminSpineTerminalBatchesFixture() {
  return {
    version: 1,
    proof: "dev-test-game-admin-spine-terminal-batches",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt: "2026-06-26T00:00:00.000Z",
    scope: "local-dev-test-game-admin-spine-terminal-batches",
    proofBoundary: "Local admin spine terminal proof-batch receipt.",
    generatedFrom: {
      adminSpineProof: "target/dev-test-game/admin-spine-proof.json",
      proofGraph: "target/dev-test-game/proof-graph.json",
      nextAction: "target/dev-test-game/next-action.json",
      hostedIdentityNextAction:
        "target/dev-test-game/next-action-hosted-identity.json",
      proofFreshnessAdminProof:
        "target/dev-test-game/proof-freshness-admin-proof.json",
      nextActionAdminProof: "target/dev-test-game/next-action-admin-proof.json",
      hostedIdentityNextActionAdminProof:
        "target/dev-test-game/hosted-identity-next-action-admin-proof.json",
      batchCount: 3,
    },
    nextActionHandoffPair: nextActionHandoffPairFixture(),
    batches: [
      {
        label: "Terminal admin proof batch",
        reason:
          "terminal graph, freshness, and next-action admin surfaces share the generated proof graph inputs",
        status: "passed",
        caseCount: 3,
        caseSmokeNames: [
          "dev-test-game-proof-graph-admin-proof",
          "dev-test-game-proof-freshness-admin-proof",
          "dev-test-game-next-action-admin-proof",
        ],
        proofIds: ["proof-graph", "proof-freshness", "next-action"],
        artifactPaths: [
          "target/dev-test-game/proof-graph-admin-proof.json",
          "target/dev-test-game/proof-freshness-admin-proof.json",
          "target/dev-test-game/next-action-admin-proof.json",
        ],
        elapsedMs: 2400,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
      {
        label: "Terminal hosted identity next-action admin proof batch",
        reason:
          "hosted identity next-action input proves the promoted operator-aware admin rows before the default next-action receipt is restored",
        status: "passed",
        caseCount: 1,
        caseSmokeNames: [
          "dev-test-game-hosted-identity-next-action-admin-proof",
        ],
        proofIds: ["hosted-identity-next-action"],
        artifactPaths: [
          "target/dev-test-game/hosted-identity-next-action-admin-proof.json",
        ],
        elapsedMs: 1200,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
      {
        label: "Terminal refresh admin proof batch",
        reason:
          "freshness and next-action admin surfaces share the refreshed next-action input",
        status: "passed",
        caseCount: 2,
        caseSmokeNames: [
          "dev-test-game-proof-freshness-admin-proof",
          "dev-test-game-next-action-admin-proof",
        ],
        proofIds: ["proof-freshness", "next-action"],
        artifactPaths: [
          "target/dev-test-game/proof-freshness-admin-proof.json",
          "target/dev-test-game/next-action-admin-proof.json",
        ],
        elapsedMs: 1600,
        sharedFrontendSession: true,
        sharedChromiumSession: true,
        releaseReady: false,
        productionReady: false,
      },
    ],
  };
}

function nextActionHandoffPairFixture() {
  return devTestGameNextActionSequenceHandoffPair();
}

function hostedHandoffChecklistRowsForAssertion(rows) {
  return rows.map((row) => [
    row.id,
    row.testId,
    row.values.map((value) => [value.id, value.text, value.emphasized]),
    (row.subentries ?? []).map((subentry) => [
      subentry.id,
      subentry.testId,
      subentry.values.map((value) => [value.id, value.text, value.emphasized]),
    ]),
  ]);
}

function expectedHostedHandoffChecklistRows(checklist) {
  return [
    [
      "summary",
      "admin-audit-hosted-handoff-summary",
      [
        ["status", checklist.status, true],
        ["preflightStatus", checklist.preflightStatus, false],
        ["command", checklist.command, false],
        ["proofTarget", checklist.proofTarget, false],
      ],
      [],
    ],
    ...checklist.inputs.map((input) => [
      `input-${input.id}`,
      `admin-audit-hosted-handoff-input-${input.id}`,
      [
        ["label", input.label, true],
        ["value", input.value, false],
        ["required", input.required ? "required" : "optional", false],
      ],
      [],
    ]),
    ...checklist.inputSections.map((section) => [
      `input-section-${section.id}`,
      `admin-audit-hosted-handoff-input-section-${section.id}`,
      [
        ["label", section.label, true],
        ["status", section.status, false],
        ["missingInputs", section.missingInputs.join(", "), false],
      ],
      section.requiredInputIds.map((inputId) => [
        `input-section-${section.id}-${inputId}`,
        `admin-audit-hosted-handoff-section-input-${section.id}-${inputId}`,
        [
          ["inputId", inputId, true],
          [
            "status",
            section.providedInputIds.includes(inputId) ? "provided" : "missing",
            false,
          ],
        ],
      ]),
    ]),
    ...checklist.groups.map((group) => [
      `group-${group.id}`,
      `admin-audit-hosted-handoff-group-${group.id}`,
      [
        ["label", group.label, true],
        ["status", group.status, false],
        ["blockedCheckCount", `${group.blockedCheckIds.length} blocked`, false],
        ["requiredEvidence", group.requiredEvidence, false],
      ],
      [],
    ]),
    ...checklist.blockedChecks.map((check) => [
      `blocked-check-${check.id}`,
      `admin-audit-hosted-handoff-blocked-check-${check.id}`,
      [
        ["id", check.id, true],
        ["status", check.status, false],
        ["requiredEvidence", check.requiredEvidence, false],
      ],
      [],
    ]),
  ];
}

function expectedHostedHandoffOperatorRows(checklist) {
  const gate = checklist.operatorEvidenceGate;
  if (gate === null || gate === undefined) {
    return [];
  }
  return [
    [
      `operator-gate-${gate.id}`,
      `admin-audit-hosted-identity-operator-gate-${gate.id}`,
      [
        ["status", gate.status, true],
        ["evidencePathEnv", gate.evidencePathEnv, false],
        [
          "requiredRawEvidencePathKind",
          gate.requiredRawEvidencePathKind,
          false,
        ],
        [
          "rejectedRawEvidencePathKinds",
          gate.rejectedRawEvidencePathKinds.join(", "),
          false,
        ],
        ["command", gate.command, false],
        ["proofTarget", gate.proofTarget, false],
        ["roleUrl", gate.roleUrl, false],
        ["localCapabilityRoleUrl", gate.localCapabilityRoleUrl, false],
        ["proofBoundary", gate.proofBoundary, false],
      ],
      [],
    ],
    ...gate.requiredEvidenceFamilies.map((family) => [
      `operator-gate-family-${family.id}`,
      `admin-audit-hosted-identity-operator-gate-family-${family.id}`,
      [
        ["id", family.id, true],
        ["field", family.field, false],
        ["checkId", family.checkId, false],
        ["requiredInputIds", family.requiredInputIds.join(", "), false],
      ],
      [],
    ]),
    ...expectedHostedIdentityProviderBoundaryRows(gate.providerBoundary),
    ...gate.rejectedRawEvidencePathKinds.map((kind) => [
      `operator-gate-rejected-path-kind-${kind}`,
      `admin-audit-hosted-identity-operator-gate-rejected-path-kind-${kind}`,
      [
        ["kind", kind, true],
        ["status", "rejected", false],
      ],
      [],
    ]),
    ...(checklist.operatorProofDrilldowns.length === 0
      ? []
      : [
          [
            "operator-drilldowns",
            "admin-audit-hosted-identity-operator-drilldowns",
            [["heading", "Hosted identity operator drilldowns", true]],
            checklist.operatorProofDrilldowns.map((drilldown) => [
              `operator-proof-${drilldown.id}`,
              `admin-audit-hosted-handoff-operator-proof-${drilldown.id}`,
              [
                ["label", drilldown.label, true],
                ["command", drilldown.command, false],
                ["progressionId", drilldown.progressionId, false],
                ["sourcePath", drilldown.sourcePath, false],
                ["proofTarget", drilldown.proofTarget, false],
                ["roleUrl", drilldown.roleUrl, false],
                ["firstMissingInputId", drilldown.firstMissingInputId, false],
                ["firstMissingCheckId", drilldown.firstMissingCheckId, false],
                ["proofBoundary", drilldown.proofBoundary, false],
              ],
            ]),
          ],
        ]),
  ];
}

function expectedHostedIdentityProviderBoundaryRows(boundary) {
  if (boundary === null || boundary === undefined) {
    return [];
  }
  return [
    [
      `provider-boundary-${boundary.id}`,
      `admin-audit-hosted-identity-provider-boundary-${boundary.id}`,
      [
        ["status", boundary.status, true],
        ["architectureId", boundary.architectureId, false],
        ["providerCount", `${boundary.providerCount} providers`, false],
        [
          "roleSurfaceArchitectureChanged",
          hostedIdentityRoleSurfaceArchitectureText(boundary),
          false,
        ],
        ["proofBoundary", boundary.proofBoundary, false],
      ],
      [],
    ],
    ...boundary.providers.map((provider) => [
      `provider-boundary-provider-${provider.id}`,
      `admin-audit-hosted-identity-provider-boundary-provider-${provider.id}`,
      [
        ["status", provider.status, true],
        ["label", provider.label, false],
        ["mode", provider.mode, false],
        ["accountCredential", provider.accountCredential, false],
        ["inviteCredential", provider.inviteCredential, false],
        ["sessionCredential", provider.sessionCredential, false],
        ["loginBoundary", provider.loginBoundary, false],
        ["sessionBoundary", provider.sessionBoundary, false],
        ["sessionGrantBoundary", provider.sessionGrantBoundary, false],
        ["browserCookieName", provider.browserCookieName, false],
        ["rawCredentialPolicy", provider.rawCredentialPolicy, false],
        [
          "roleSurfaceArchitectureChanged",
          hostedIdentityRoleSurfaceArchitectureText(provider),
          false,
        ],
        ...(provider.requiredEvidence === ""
          ? []
          : [["requiredEvidence", provider.requiredEvidence, false]]),
      ],
      [],
    ]),
  ];
}

function hostedIdentityRoleSurfaceArchitectureText(item) {
  return item.roleSurfaceArchitectureChanged
    ? "role surface changed"
    : "role surface preserved";
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
      privateChannelRecoveryMilestone: privateChannelRecoveryMilestoneFixture(),
      replacementPrivateRecoveryMilestone:
        replacementPrivateRecoveryMilestoneFixture(),
      replacementActionRecoveryMilestone:
        replacementActionRecoveryMilestoneFixture(),
      replacementHandoffRecoveryMilestone:
        replacementHandoffRecoveryMilestoneFixture(),
    },
    localDevelopmentSpine: {
      status: "passed",
      evidence: {
        hostSetupProof: {
          path: "target/dev-test-game/host-setup-proof.json",
          game: "game-a",
          roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
          capabilityLabel: "HostOf(<seeded-game>)",
          readyCheckIds: ["start-phase"],
          policyCommandStatus: "passed",
          setupMutationStatus: "passed",
          proofBoundary:
            "Local dev-test-game host setup role URL browser proof over the seeded setup route.",
          setupCommandEvidence: setupCommandEvidenceFixture(),
        },
      },
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
          id: "local-host-setup-proof",
          label: "Host setup role URL, policy, roster, and recovery proof",
          status: "passed",
          evidence: "target/dev-test-game/host-setup-proof.json",
          roleUrl: "http://127.0.0.1:5173/g/<seeded-game>/setup",
          recoveryCommand: "npm run dev:test-game -- --verify-host-setup-only",
          readyCheckIds: ["start-phase"],
          proofBoundary:
            "Local dev-test-game host setup role URL browser proof over the seeded setup route.",
        },
        {
          id: "local-stale-conflict-message-milestone",
          label: "Stale-client conflict messages",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: staleConflictMessageMilestoneFixture().laneIds,
          requiredLaneCount: staleConflictMessageLaneIds.length,
          coveredLaneCount: staleConflictMessageLaneIds.length,
          familyCount: staleConflictMessageCoverageFamilies().length,
          expectedLaneCount: staleConflictMessageLaneIds.length,
          expectedFamilyCount: staleConflictMessageCoverageFamilies().length,
          surfaceCoverage: staleConflictMessageSurfaceCoverageFixture(),
        },
        {
          id: "local-host-stale-control-milestone",
          label: "Host stale-control recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: hostStaleControlMilestoneFixture().laneIds,
          requiredLaneCount: hostStaleControlLaneIds.length,
          coveredLaneCount: hostStaleControlLaneIds.length,
          familyCount: hostStaleControlCoverageFamilies().length,
          expectedLaneCount: hostStaleControlLaneIds.length,
          expectedFamilyCount: hostStaleControlCoverageFamilies().length,
        },
        {
          id: "local-private-channel-recovery-milestone",
          label: "Private-channel recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: privateChannelRecoveryMilestoneFixture().laneIds,
          requiredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
          coveredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
          familyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
          expectedLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
          expectedFamilyCount:
            coreLoopPrivateChannelRecoveryCoverageFamilies().length,
          normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
            privateChannelNormalizedEvidenceObjects,
          ),
        },
        {
          id: "local-replacement-private-recovery-milestone",
          label: "Replacement private-channel recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: replacementPrivateRecoveryMilestoneFixture().laneIds,
          requiredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
          coveredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
          familyCount: replacementPrivateChannelRecoveryCoverageFamilies().length,
          expectedLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
          expectedFamilyCount:
            replacementPrivateChannelRecoveryCoverageFamilies().length,
          normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
            replacementPrivatePostNormalizedEvidenceObjects,
          ),
        },
        {
          id: "local-replacement-action-recovery-milestone",
          label: "Replacement action recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: replacementActionRecoveryMilestoneFixture().laneIds,
          requiredLaneCount: replacementActionLaneIds.length,
          coveredLaneCount: replacementActionLaneIds.length,
          familyCount: replacementActionRecoveryCoverageFamilies().length,
          expectedLaneCount: replacementActionLaneIds.length,
          expectedFamilyCount: replacementActionRecoveryCoverageFamilies().length,
        },
        {
          id: "local-replacement-handoff-recovery-milestone",
          label: "Replacement handoff recovery",
          status: "passed",
          evidence: "target/dev-test-game/proof-run.json",
          laneIds: replacementHandoffRecoveryMilestoneFixture().laneIds,
          requiredLaneCount: replacementHandoffRecoveryLaneIds.length,
          coveredLaneCount: replacementHandoffRecoveryLaneIds.length,
          familyCount: replacementHandoffRecoveryCoverageFamilies().length,
          expectedLaneCount: replacementHandoffRecoveryLaneIds.length,
          expectedFamilyCount: replacementHandoffRecoveryCoverageFamilies().length,
        },
        localDependencyReadinessCheckFixture(
          localProofGraphAdminRoleHandoffsCheckId,
          "target/dev-test-game/proof-graph-admin-proof.json",
        ),
        localDependencyReadinessCheckFixture(
          localProofFreshnessAdminSurfaceCheckId,
          "target/dev-test-game/proof-freshness-admin-proof.json",
        ),
        localDependencyReadinessCheckFixture(
          localNextActionAdminSurfaceCheckId,
          "target/dev-test-game/next-action-admin-proof.json",
        ),
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

function localDependencyReadinessCheckFixture(id, evidence) {
  return localReadinessDependencyCheckFor(id, {
    status: "passed",
    evidence,
  });
}

function setupCommandEvidenceFixture(game = "game-a") {
  return {
    addSlot: {
      status: "ack",
      commandKind: "AddSlot",
      readinessSummary: "Setup still needs attention",
      command: { game, slot: "slot-7" },
    },
    assignSlot: {
      status: "ack",
      commandKind: "AssignSlot",
      readinessSummary: "Setup still needs attention",
      command: { game, slot: "slot-7", user: "player-mira" },
    },
    assignRole: {
      status: "ack",
      commandKind: "AssignRole",
      readinessSummary: "Ready to start",
      command: { game, slot: "slot-7", role_key: "encryptor" },
    },
    setPostPolicy: {
      status: "ack",
      commandKind: "SetPostPolicy",
      readinessSummary: "Ready to start",
      command: { game, channel_id: "main", allow_media_only: false },
    },
    startGame: {
      status: "ack",
      commandKind: "StartGame",
      readinessSummary: "Started at D01",
      command: { game, phase: "D01" },
    },
  };
}

function staleConflictMessageMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...staleConflictMessageLaneIds],
    requiredLaneCount: staleConflictMessageLaneIds.length,
    coveredLaneCount: staleConflictMessageLaneIds.length,
    gapCount: 0,
    familyCount: staleConflictMessageCoverageFamilies().length,
    expectedLaneCount: staleConflictMessageLaneIds.length,
    expectedFamilyCount: staleConflictMessageCoverageFamilies().length,
    families: staleConflictMessageCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
    surfaceCoverage: staleConflictMessageSurfaceCoverageFixture(),
    surfaces: staleConflictMessageSurfaceFixtureRows(),
  };
}

function hostStaleControlMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...hostStaleControlLaneIds],
    requiredLaneCount: hostStaleControlLaneIds.length,
    coveredLaneCount: hostStaleControlLaneIds.length,
    gapCount: 0,
    familyCount: hostStaleControlCoverageFamilies().length,
    expectedLaneCount: hostStaleControlLaneIds.length,
    expectedFamilyCount: hostStaleControlCoverageFamilies().length,
    families: hostStaleControlCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
  };
}

function privateChannelRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...coreLoopPrivateChannelRecoveryLaneIds],
    requiredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    coveredLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
    expectedLaneCount: coreLoopPrivateChannelRecoveryLaneIds.length,
    expectedFamilyCount: coreLoopPrivateChannelRecoveryCoverageFamilies().length,
    families: coreLoopPrivateChannelRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
    normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
      privateChannelNormalizedEvidenceObjects,
    ),
  };
}

function replacementPrivateRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementPrivateChannelRecoveryLaneIds],
    requiredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    coveredLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: replacementPrivateChannelRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementPrivateChannelRecoveryLaneIds.length,
    expectedFamilyCount: replacementPrivateChannelRecoveryCoverageFamilies().length,
    families: replacementPrivateChannelRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
    normalizedEvidenceObjects: expectedPassedNormalizedEvidenceObjects(
      replacementPrivatePostNormalizedEvidenceObjects,
    ),
  };
}

function replacementActionRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementActionLaneIds],
    requiredLaneCount: replacementActionLaneIds.length,
    coveredLaneCount: replacementActionLaneIds.length,
    gapCount: 0,
    familyCount: replacementActionRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementActionLaneIds.length,
    expectedFamilyCount: replacementActionRecoveryCoverageFamilies().length,
    families: replacementActionRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
  };
}

function replacementHandoffRecoveryMilestoneFixture() {
  return {
    status: "passed",
    laneIds: [...replacementHandoffRecoveryLaneIds],
    requiredLaneCount: replacementHandoffRecoveryLaneIds.length,
    coveredLaneCount: replacementHandoffRecoveryLaneIds.length,
    gapCount: 0,
    familyCount: replacementHandoffRecoveryCoverageFamilies().length,
    expectedLaneCount: replacementHandoffRecoveryLaneIds.length,
    expectedFamilyCount: replacementHandoffRecoveryCoverageFamilies().length,
    families: replacementHandoffRecoveryCoverageFamilies().map((family) => ({
      ...family,
      status: "passed",
      passedLaneIds: [...family.laneIds],
    })),
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
  const identityAdapterContract = buildDevTestGameIdentityAdapterContractPacket();
  return {
    version: devTestGameIdentityAdapterProofVersion,
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
    identityAdapterContract,
    identityAdapterContractDiff:
      devTestGameIdentityAdapterContractDiff(identityAdapterContract),
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
