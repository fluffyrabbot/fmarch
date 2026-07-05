import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { resolveSurfaceAccess } from "../../lib/app/capabilities.mjs";
import {
  loadAdminColdData,
  operatorProofRunUrl,
} from "../../lib/app/cold-load.mjs";
import {
  coreLoopLaneStatus,
  coreLoopSpineStatus,
  hardeningLaneStatus,
} from "../../lib/app/local-proof-lane-status.mjs";
import {
  selectedNextActionProofGraphNodeStatus,
  selectedNextActionProofGraphNodeSummary,
} from "../../lib/app/local-proof-handoff-status.mjs";
import {
  hardeningAuditLaneIds,
} from "../../../../tools/dev_test_game_hardening_scenarios.mjs";
import {
  playerRecoveryAuditLaneIds,
} from "../../../../tools/dev_test_game_player_recovery_scenarios.mjs";
import {
  completedGameHardeningLaneCases,
} from "../../../../tools/dev_test_game_core_loop_completed_scenarios.mjs";
import {
  coreLoopCompletedGameCoverageCheckId,
  coreLoopAuditLaneIds,
} from "../../../../tools/dev_test_game_core_loop_scenarios.mjs";
import {
  coreLoopScenarioFamilyRows,
} from "../../../../tools/dev_test_game_core_loop_generated_from_families.mjs";
import {
  playerActionBoundaryLaneId,
  playerActionLoopLaneId,
  playerInvalidActionRecoveryLaneId,
} from "../../../../tools/dev_test_game_core_loop_action_scenarios.mjs";
import {
  hostedEvidenceHandoffInputRows,
} from "../../../../tools/dev_test_game_hosted_handoff_cases.mjs";
import {
  devTestGameRealHostedObservabilityHandoffCommand,
  devTestGameRealHostedObservabilityHandoffPath,
  realHostedObservabilityBaselineEnv,
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityHandoffInputIds,
} from "../../../../tools/dev_test_game_real_hosted_observability_handoff_cases.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "../../../../tools/dev_test_game_admin_audit_surface_ids.mjs";
import {
  buildAdminAuditHandoffPath,
} from "../../../../tools/dev_test_game_admin_audit_handoff_path.mjs";
import {
  normalizeProofGraphReceiptArtifactRows,
} from "../../../../tools/dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  devTestGameIdentityAdapterContractDiff,
  devTestGameIdentityAdapterProofVersion,
} from "../../../../tools/dev_test_game_identity_adapter_contract.mjs";
import {
  adminSpineProofPath,
  devTestGameProofGraphPath,
  devTestGameProofRunPath,
  devTestGameReleaseReadinessPath,
  nextActionPath,
  spineManifestPath,
} from "../../../../tools/dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameBackupRestoreDumpPath,
  devTestGameBackupRestoreProofPath,
  devTestGameHostedConcurrentRaceMatrixPath,
  devTestGameHostedEvidenceLaneDemoProofPath,
  devTestGameHostedEvidenceLanePath,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedOpsSignalsPath,
  devTestGameHostedTargetPreflightPath,
  devTestGameIdentityAdapterProofPath,
  devTestGameOpsArtifactsPath,
  devTestGameRaceCoveragePath,
  devTestGameSeedFixturePath,
} from "../../../../tools/dev_test_game_adjacent_artifact_paths.mjs";
import {
  devTestGameReleaseRunbookPath,
} from "../../../../tools/dev_test_game_release_artifact_paths.mjs";
import {
  normalizeSpineRowKind,
  selectedSpineDeclarationStatus,
  selectedSpineDrilldownStatus,
  selectedSpineTargetStatus,
} from "./selected-spine-status.mjs";

export const ADMIN_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "admin-surface",
  capabilityTestId: "admin-capability",
  requiredText: "Operations",
});

export const LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS = playerRecoveryAuditLaneIds;

const COMPLETED_GAME_HARDENING_LANE_CASES = Object.freeze(
  completedGameHardeningLaneCases(),
);
const COMPLETED_GAME_HARDENING_FAMILY_IDS = Object.freeze([
  ...new Set(
    COMPLETED_GAME_HARDENING_LANE_CASES.map((scenario) => scenario.family),
  ),
]);

export async function buildAdminRouteData({
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  proofRun = null,
  opsArtifacts = null,
  seedFixtureSummary = null,
  releaseReadinessChecklist = null,
  releaseRunbook = null,
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  adminSpineTerminalBatches = null,
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  realHostedObservabilityHandoff = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
  hostedIdentityProgressionSummary = null,
  nextAction = null,
  proofFreshness = null,
}) {
  const access = resolveSurfaceAccess({
    surface: "admin",
    game: null,
    capabilities,
  });
  const coldData = await loadAdminColdData({
    game,
    principalUserId,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    fallback: adminFixtureColdLoad({ game, principalUserId }),
  });

  return Object.freeze({
    shell: buildAppShell({
      game,
      activeSurface: "admin",
      principalUserId,
      capabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin",
      title: "Operations",
      summary:
        "Game setup, scoped session grants, audit reports, and recovery queues.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: ADMIN_ROUTE_CONTRACT.capabilityTestId,
    }),
    access,
    operator: Object.freeze({
      principalUserId,
      capabilityLabel: access.capabilityLabel,
    }),
    command: Object.freeze({
      endpoint: "/commands",
      createGame: Object.freeze({
        action: "create_game",
        game,
        pack: "mafiascum",
      }),
      cohost: Object.freeze({
        action: "add_cohost",
        game,
        user: "cohost_c",
      }),
      sessionGrant: Object.freeze({
        action: "grant_session",
        token: `session-grant-${game}`,
        principalUserId: "mod_a",
        expiresAt: 4_102_444_800,
        globalCapabilities: Object.freeze(["GlobalMod"]),
      }),
    }),
    gameSetup: Object.freeze([
      Object.freeze({
        id: "create-game",
        label: "Create game",
        value: "Pack mafiascum",
        authority: "GlobalAdmin",
        boundary: "Command pipeline",
        boundaryDetail: "/commands CreateGame Ack/Reject",
        commandAction: "create_game",
        confirmLabel: "Create game",
        confirmMessage: "Create game midsummer from pack mafiascum",
        buttonLabel: "Review",
      }),
      Object.freeze({
        id: "host-setup",
        label: "Host setup workflow",
        value: `/g/${game}/setup`,
        authority: "HostOf(game)",
        boundary: "Game-specific setup",
        boundaryDetail: "Roster, roles, policy, invites, and StartGame readiness",
        commandAction: "navigate",
        href: `/g/${game}/setup`,
        buttonLabel: "Open setup",
      }),
      Object.freeze({
        id: "session-grants",
        label: "Session grants",
        value: "GlobalMod for mod_a",
        authority: "GlobalAdmin",
        boundary: "Authenticated session grant",
        boundaryDetail: "/auth/session-grants requires active GlobalAdmin session",
        commandAction: "grant_session",
        confirmLabel: "Grant GlobalMod",
        confirmMessage: "Grant GlobalMod to mod_a",
        buttonLabel: "Review",
      }),
      Object.freeze({
        id: "cohost",
        label: "Cohost delegation",
        value: "cohost_c",
        authority: "HostOf(game)",
        boundary: "Command pipeline",
        boundaryDetail: "/commands AddCohost host-gated by committed game grants",
        commandAction: "add_cohost",
        confirmLabel: "Delegate cohost_c",
        confirmMessage: "Delegate cohost_c as cohost for this game",
        buttonLabel: "Review",
      }),
    ]),
    ...coldData,
    audit: withAdminAuditInspectLinks(
      appendLocalNextActionAudit(
        appendLocalRealHostedObservabilityHandoffAudit(
          appendLocalHostedOpsSignalsAudit(
            appendLocalHostedEvidenceLaneAudit(
              appendLocalHostedTargetPreflightAudit(
                appendLocalHostedConcurrentRaceMatrixAudit(
                  appendLocalRaceCoverageAudit(
                    appendLocalProofGraphAudit(
                      appendLocalProofFreshnessAudit(
                        appendLocalAdminSpineAudit(
                          appendLocalSpineManifestAudit(
                            appendLocalHostedIdentityEvidenceAudit(
                              appendLocalIdentityAdapterAudit(
                                appendLocalBackupRestoreAudit(
                                  appendLocalReleaseRunbookAudit(
                                    appendLocalReleaseReadinessAudit(
                                      appendLocalSeedFixtureAudit(
                                        appendLocalOpsArtifactsAudit(
                                          appendLocalPlayerRecoveryAudit(
                                            appendLocalHardeningAudit(
                                              appendLocalCoreLoopAudit(coldData.audit, proofRun, { game }),
                                              proofRun,
                                              { game },
                                            ),
                                            proofRun,
                                            { game },
                                          ),
                                          opsArtifacts,
                                          { game },
                                        ),
                                        seedFixtureSummary,
                                        { game },
                                      ),
                                      releaseReadinessChecklist,
                                      { game },
                                    ),
                                    releaseRunbook,
                                    { game },
                                  ),
                                  backupRestoreProof,
                                  { game },
                                ),
                                identityAdapterProof,
                                { game },
                              ),
                              hostedIdentityEvidence,
                              { game, hostedIdentityProgressionSummary },
                            ),
                            spineManifest,
                            { game },
                          ),
                          adminSpineProof,
                          { game, terminalBatchProof: adminSpineTerminalBatches },
                        ),
                        proofFreshness,
                        { game, nextAction },
                      ),
                      proofGraph,
                      { game },
                    ),
                    raceCoverage,
                    { game },
                  ),
                  hostedConcurrentRaceMatrix,
                  { game },
                ),
                hostedTargetPreflight,
                { game },
              ),
              hostedEvidenceLane,
              { game, hostedEvidenceLaneDemoProof },
            ),
            hostedOpsSignals,
            { game },
          ),
          realHostedObservabilityHandoff,
          { game },
        ),
        nextAction,
        { game, proofGraph },
      ),
      { game },
    ),
    recoveryTasks: Object.freeze([
      Object.freeze({
        id: "recovery-gate",
        label: "Recovery go/no-go",
        value: "Check saved production proof artifacts before recovery",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs/go-no-go machine-readable report",
        action: "check_recovery_gate",
        buttonLabel: "Check gate",
        confirmLabel: "Run check",
        confirmMessage: "Read saved go/no-go proof artifacts for this game",
        endpoint: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator/proof-runs/go-no-go",
        }),
      }),
    ]),
    escalations: Object.freeze([
      Object.freeze({
        id: "visibility",
        label: "Visibility review",
        value: "Private-channel bytes stay server-filtered",
      }),
      Object.freeze({
        id: "moderation",
        label: "Cross-game moderation",
        value: "GlobalMod only",
      }),
    ]),
  });
}

export async function buildAdminAuditDetailData({
  audit,
  principalUserId,
  capabilities = [],
  game = "midsummer",
  fetchImpl = null,
  apiBaseUrl = "",
  sessionToken = null,
  identityPrincipalUserId = "host_h",
  proofRun = null,
  opsArtifacts = null,
  seedFixtureSummary = null,
  releaseReadinessChecklist = null,
  releaseRunbook = null,
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  adminSpineTerminalBatches = null,
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  realHostedObservabilityHandoff = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
  hostedIdentityProgressionSummary = null,
  nextAction = null,
  proofFreshness = null,
}) {
  const data = await buildAdminRouteData({
    principalUserId,
    capabilities,
    game,
    fetchImpl,
    apiBaseUrl,
    sessionToken,
    identityPrincipalUserId,
    proofRun,
    opsArtifacts,
    seedFixtureSummary,
    releaseReadinessChecklist,
    releaseRunbook,
    backupRestoreProof,
    identityAdapterProof,
    spineManifest,
    adminSpineProof,
    adminSpineTerminalBatches,
    proofGraph,
    raceCoverage,
    hostedConcurrentRaceMatrix,
    hostedOpsSignals,
    realHostedObservabilityHandoff,
    hostedTargetPreflight,
    hostedEvidenceLane,
    hostedEvidenceLaneDemoProof,
    hostedIdentityEvidence,
    hostedIdentityProgressionSummary,
    nextAction,
    proofFreshness,
  });
  const auditId = requiredAuditId(audit);
  const item = data.audit.find((candidate) => candidate.id === auditId);

  return Object.freeze({
    shell: data.shell,
    access: data.access,
    operator: data.operator,
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "admin",
      eyebrow: "Admin audit",
      title: item?.label ?? auditId,
      summary: item?.boundaryDetail ?? "Audit row unavailable.",
      capabilityLabel: data.operator.capabilityLabel,
      capabilityTestId: "admin-audit-detail-capability",
    }),
    game: Object.freeze({
      id: game,
      label: game,
    }),
    overviewHref: adminOverviewHref({ game }),
    audit: item ?? null,
    auditId,
    status: item === undefined ? "missing" : "available",
  });
}

export function adminForbiddenMessage() {
  return "Admin operations require GlobalAdmin or GlobalMod capability.";
}

export function summarizeRecoveryGate(body) {
  if (body === null || typeof body !== "object") {
    return Object.freeze({
      state: "reject",
      message: "Recovery gate returned malformed proof data",
    });
  }

  const production = body.production ?? {};
  const trusted = Number(production.trusted ?? 0);
  const total = Number(production.total_artifact_rows ?? 0);
  const nonTrusted = Number(production.non_trusted ?? 0);
  if (body.ok === true && nonTrusted === 0) {
    return Object.freeze({
      state: "ack",
      message: `Recovery gate trusted: ${trusted}/${total} production artifacts trusted`,
      trusted,
      total,
      nonTrusted,
    });
  }

  return Object.freeze({
    state: "reject",
    message: `Recovery gate blocked: ${nonTrusted}/${total} production artifacts need review`,
    trusted,
    total,
    nonTrusted,
  });
}

function adminFixtureColdLoad({ game, principalUserId }) {
  return Object.freeze({
    audit: Object.freeze([
      Object.freeze({
        id: "proof-runs",
        label: "Proof runs",
        status: "Current local report available",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only operator proof",
        boundaryDetail: "/operator/proof-runs machine-readable report",
        href: operatorProofRunUrl({ game, principalUserId }),
      }),
      Object.freeze({
        id: "command-receipts",
        label: "Command receipts",
        status: "Durable ack path live",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Committed command audit",
        boundaryDetail: "/operator command receipt inspection",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator",
        }),
      }),
      Object.freeze({
        id: "recovery",
        label: "Recovery queue",
        status: "No destructive action armed",
        authority: "GlobalAdmin or GlobalMod",
        boundary: "Read-only recovery proof",
        boundaryDetail: "/operator/proof-runs/go-no-go/view saved report",
        href: operatorProofRunUrl({
          game,
          principalUserId,
          path: "operator/proof-runs/go-no-go/view",
        }),
      }),
    ]),
  });
}

function withAdminAuditInspectLinks(audit, { game }) {
  return Object.freeze(
    audit.map((item) =>
      Object.freeze({
        ...item,
        inspectHref:
          typeof item.inspectHref === "string" && item.inspectHref.trim() !== ""
            ? item.inspectHref
            : adminAuditInspectHref({
                game,
                audit: item.id,
              }),
      }),
    ),
  );
}

export function appendLocalOpsArtifactsAudit(audit, opsArtifacts, { game }) {
  const row = normalizeLocalOpsArtifactsAudit(opsArtifacts, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedOpsSignalsAudit(audit, hostedOpsSignals, { game }) {
  const row = normalizeLocalHostedOpsSignalsAudit(hostedOpsSignals, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalRealHostedObservabilityHandoffAudit(
  audit,
  realHostedObservabilityHandoff,
  { game },
) {
  const row = normalizeLocalRealHostedObservabilityHandoffAudit(
    realHostedObservabilityHandoff,
    { game },
  );
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedTargetPreflightAudit(
  audit,
  hostedTargetPreflight,
  { game },
) {
  const row = normalizeLocalHostedTargetPreflightAudit(hostedTargetPreflight, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedTargetPreflightAudit(
  hostedTargetPreflight,
  { game },
) {
  if (
    hostedTargetPreflight === null ||
    typeof hostedTargetPreflight !== "object" ||
    hostedTargetPreflight.version !== 1 ||
    hostedTargetPreflight.proof !== "dev-test-game-hosted-target-preflight" ||
    !["passed", "blocked"].includes(hostedTargetPreflight.status) ||
    hostedTargetPreflight.scope !== "hosted-target-preflight" ||
    hostedTargetPreflight.releaseReady !== false ||
    hostedTargetPreflight.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedTargetPreflight.checks)
    ? hostedTargetPreflight.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedChecks = checks.filter((check) => check?.status === "blocked");
  const hostedHandoffChecklist = normalizeNextActionHostedHandoffChecklist({
    unproven: {
      hostedHandoffChecklist: hostedTargetPreflight.hostedHandoffChecklist,
    },
    realHostedEvidenceInputs: [],
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedTargetPreflight,
    label: "Hosted target preflight",
    status: `${passedChecks.length} passed, ${blockedChecks.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted target preflight",
    boundaryDetail:
      hostedTargetPreflight.proofBoundary ??
      "Hosted target preflight without hosted deployment or release claims.",
    href: devTestGameHostedTargetPreflightPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedTargetPreflight,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedTargetPreflight.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedTargetPreflight.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    ...(hostedHandoffChecklist === null ? {} : { hostedHandoffChecklist }),
    artifactSummary: Object.freeze({
      frontendBaseUrl: String(hostedTargetPreflight.target?.frontendBaseUrl ?? ""),
      apiBaseUrl: String(hostedTargetPreflight.target?.apiBaseUrl ?? ""),
      groupId: String(hostedTargetPreflight.target?.groupId ?? ""),
      rawEvidencePath: String(hostedTargetPreflight.target?.rawEvidencePath ?? ""),
      rawEvidenceStatus: String(
        hostedTargetPreflight.target?.rawEvidenceStatus ?? "unknown",
      ),
      nextCommand: String(hostedTargetPreflight.nextCommand ?? ""),
      nextProofTarget: String(hostedTargetPreflight.nextProofTarget ?? ""),
      releaseReady: hostedTargetPreflight.releaseReady === true,
      productionReady: hostedTargetPreflight.productionReady === true,
    }),
  });
}

export function appendLocalHostedIdentityEvidenceAudit(
  audit,
  hostedIdentityEvidence,
  { game, hostedIdentityProgressionSummary = null },
) {
  const row = normalizeLocalHostedIdentityEvidenceAudit(hostedIdentityEvidence, {
    game,
    hostedIdentityProgressionSummary,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedIdentityEvidenceAudit(
  hostedIdentityEvidence,
  { game, hostedIdentityProgressionSummary = null },
) {
  if (
    hostedIdentityEvidence === null ||
    typeof hostedIdentityEvidence !== "object" ||
    hostedIdentityEvidence.version !== 1 ||
    hostedIdentityEvidence.proof !== "dev-test-game-hosted-identity-evidence" ||
    !["passed", "blocked"].includes(hostedIdentityEvidence.status) ||
    hostedIdentityEvidence.scope !== "hosted-identity-evidence-handoff" ||
    hostedIdentityEvidence.releaseReady !== false ||
    hostedIdentityEvidence.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedIdentityEvidence.checks)
    ? hostedIdentityEvidence.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedCheckIds = Array.isArray(
    hostedIdentityEvidence.hostedHandoffChecklist?.blockedCheckIds,
  )
    ? hostedIdentityEvidence.hostedHandoffChecklist.blockedCheckIds.map((id) =>
        String(id),
      )
    : checks
        .filter((check) => check?.status === "blocked")
        .map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const hostedHandoffChecklist = normalizeHostedIdentityEvidenceHandoffChecklist({
    hostedIdentityEvidence,
    blockedChecks: checks.filter((check) =>
      blockedCheckIdSet.has(String(check.id)),
    ),
  });
  const progressionSummary =
    normalizeHostedIdentityProgressionSummary(
      hostedIdentityProgressionSummary,
    );
  return Object.freeze({
    id: localAdminAuditIds.hostedIdentityEvidence,
    label: "Hosted identity evidence",
    status: `${hostedIdentityEvidence.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted identity evidence handoff",
    boundaryDetail:
      hostedIdentityEvidence.proofBoundary ??
      "Hosted identity evidence handoff without hosted identity or release claims.",
    href: devTestGameHostedIdentityEvidencePath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedIdentityEvidence,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.identityAdapter,
        label: "Local identity adapter",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.identityAdapter,
        }),
        status: "prerequisite",
        command: "test:dev-test-game-identity-admin-proof",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedIdentityEvidence.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    handoffPath: buildAdminAuditHandoffPath({
      upstreamAuditId: localAdminAuditIds.nextAction,
      localCapabilityAuditId: localAdminAuditIds.identityAdapter,
      downstreamStatus: String(hostedIdentityEvidence.status ?? "unknown"),
      downstreamCommand: String(hostedIdentityEvidence.nextCommand ?? ""),
      downstreamProofTarget: String(hostedIdentityEvidence.nextProofTarget ?? ""),
    }),
    hostedHandoffChecklist,
    artifactSummary: Object.freeze({
      rawEvidencePath: String(
        hostedIdentityEvidence.target?.rawEvidencePath ?? "",
      ),
      placeholderFixturePath: String(
        hostedIdentityEvidence.target?.placeholderFixturePath ??
          hostedIdentityEvidence.hostedHandoffChecklist?.placeholderFixturePath ??
          "",
      ),
      rawEvidenceStatus: String(
        hostedIdentityEvidence.target?.rawEvidenceStatus ?? "unknown",
      ),
      blockedCheckCount: blockedCheckIds.length,
      nextCommand: String(hostedIdentityEvidence.nextCommand ?? ""),
      nextProofTarget: String(hostedIdentityEvidence.nextProofTarget ?? ""),
      releaseReady: hostedIdentityEvidence.releaseReady === true,
      productionReady: hostedIdentityEvidence.productionReady === true,
      roleSurfaceContractDiff: normalizeHostedIdentityRoleSurfaceContractDiff(
        hostedIdentityEvidence.target?.roleSurfaceContractDiff,
      ),
      identityAdapterContractComparison:
        normalizeHostedIdentityAdapterContractComparison(
          hostedIdentityEvidence.target?.identityAdapterContractComparison,
        ),
      identityProviderBoundary: normalizeHostedIdentityProviderBoundary(
        hostedIdentityEvidence.target?.identityProviderBoundary,
      ),
      redactedIntakePacket: normalizeHostedIdentityRedactedIntakePacket(
        hostedIdentityEvidence.target?.redactedIntakePacket,
      ),
      ...(progressionSummary === null ? {} : { progressionSummary }),
    }),
  });
}

function normalizeHostedIdentityProgressionSummary(summary) {
  if (
    summary === null ||
    typeof summary !== "object" ||
    summary.version !== 1 ||
    summary.proof !== "dev-test-game-hosted-identity-progression-summary" ||
    summary.status !== "passed" ||
    summary.scope !== "hosted-identity-evidence-family-progression-summary" ||
    summary.releaseReady !== false ||
    summary.productionReady !== false ||
    !Array.isArray(summary.progressions)
  ) {
    return null;
  }
  return Object.freeze({
    status: String(summary.status ?? "unknown"),
    progressionCount: Number(summary.progressionCount ?? summary.progressions.length),
    sourceCaseCount: Number(summary.sourceCaseCount ?? summary.progressions.length),
    nextCommand: String(summary.nextCommand ?? ""),
    nextProofTarget: String(summary.nextProofTarget ?? ""),
    proofBoundary: String(summary.proofBoundary ?? ""),
    releaseReady: summary.releaseReady === true,
    productionReady: summary.productionReady === true,
    progressions: Object.freeze(
      summary.progressions.map((progression) =>
        Object.freeze({
          id: String(progression?.id ?? ""),
          field: String(progression?.field ?? ""),
          checkId: String(progression?.checkId ?? ""),
          missingInputId: String(progression?.missingInputId ?? ""),
          adminProofMode: String(progression?.adminProofMode ?? ""),
          missingFixturePath: String(progression?.missingFixturePath ?? ""),
          recoveredFixturePath: String(
            progression?.recoveredFixturePath ?? "",
          ),
          adminProofFixturePath: String(
            progression?.adminProofFixturePath ?? "",
          ),
          proofCommand: String(progression?.proofCommand ?? ""),
          evidencePath: String(progression?.evidencePath ?? ""),
          adminProofTarget: String(progression?.adminProofTarget ?? ""),
          roleUrl: String(progression?.roleUrl ?? ""),
          firstMissingInputId: String(progression?.firstMissingInputId ?? ""),
          firstMissingCheckId: String(progression?.firstMissingCheckId ?? ""),
          proofBoundary: String(progression?.proofBoundary ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityEvidenceHandoffChecklist({
  hostedIdentityEvidence,
  blockedChecks,
}) {
  const inputIds = Array.isArray(
    hostedIdentityEvidence.hostedHandoffChecklist?.inputIds,
  )
    ? hostedIdentityEvidence.hostedHandoffChecklist.inputIds
    : [];
  return Object.freeze({
    status: String(hostedIdentityEvidence.status ?? "unknown"),
    preflightStatus: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.preflightStatus ??
        hostedIdentityEvidence.status ??
        "unknown",
    ),
    command: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.command ??
        hostedIdentityEvidence.nextCommand ??
        "",
    ),
    proofTarget: String(
      hostedIdentityEvidence.hostedHandoffChecklist?.proofTarget ??
        hostedIdentityEvidence.nextProofTarget ??
        "",
    ),
    inputCount: inputIds.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      inputIds.map((id) =>
        Object.freeze({
          id: String(id),
          label: String(id),
          value: hostedIdentityHandoffInputValue({
            id,
            hostedIdentityEvidence,
          }),
          required: true,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    groups: normalizeHostedHandoffGroups(
      hostedIdentityEvidence.hostedHandoffChecklist?.requirementGroups,
    ),
    inputSections: normalizeHostedHandoffInputSections(
      hostedIdentityEvidence.hostedHandoffChecklist?.inputSections,
    ),
    operatorEvidenceGate: normalizeHostedIdentityOperatorEvidenceGate(
      hostedIdentityEvidence.hostedHandoffChecklist?.operatorEvidenceGate,
    ),
    operatorProofDrilldowns: normalizeHostedHandoffOperatorProofDrilldowns(
      hostedIdentityEvidence.hostedHandoffChecklist?.operatorProofDrilldowns,
    ),
    progressionSummary: normalizeHostedHandoffProgressionSummary(
      hostedIdentityEvidence.hostedHandoffChecklist?.progressionSummary,
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      hostedIdentityEvidence.hostedHandoffChecklist?.blockedReceipt,
    ),
  });
}

export function appendLocalHostedEvidenceLaneAudit(
  audit,
  hostedEvidenceLane,
  { game, hostedEvidenceLaneDemoProof = null },
) {
  const row = normalizeLocalHostedEvidenceLaneAudit(hostedEvidenceLane, {
    game,
    hostedEvidenceLaneDemoProof,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedEvidenceLaneAudit(
  hostedEvidenceLane,
  { game, hostedEvidenceLaneDemoProof = null },
) {
  if (
    hostedEvidenceLane === null ||
    typeof hostedEvidenceLane !== "object" ||
    hostedEvidenceLane.version !== 1 ||
    hostedEvidenceLane.proof !== "dev-test-game-hosted-evidence-lane" ||
    !["passed", "blocked"].includes(hostedEvidenceLane.status) ||
    hostedEvidenceLane.scope !== "hosted-evidence-lane" ||
    hostedEvidenceLane.releaseReady !== false ||
    hostedEvidenceLane.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedEvidenceLane.checks)
    ? hostedEvidenceLane.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedChecks = checks.filter((check) => check?.status === "blocked");
  const blockedCheckIds = Array.isArray(hostedEvidenceLane.blockedCheckIds)
    ? hostedEvidenceLane.blockedCheckIds.map((id) => String(id))
    : blockedChecks.map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const demoProofSummary =
    normalizeLocalHostedEvidenceLaneDemoProofSummary(hostedEvidenceLaneDemoProof);
  const demoProofChecks =
    normalizeLocalHostedEvidenceLaneDemoProofChecks(hostedEvidenceLaneDemoProof);
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeHostedEvidenceLaneHandoffChecklist({
    hostedEvidenceLane,
    blockedChecks: checks.filter((check) => blockedCheckIdSet.has(String(check.id))),
    realHostedEvidenceInputs,
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedEvidenceLane,
    label: "Hosted evidence lane",
    status: `${hostedEvidenceLane.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted evidence lane",
    boundaryDetail:
      hostedEvidenceLane.proofBoundary ??
      "Hosted evidence lane without hosted deployment or release claims.",
    href: devTestGameHostedEvidenceLanePath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedEvidenceLane,
    }),
    checks: Object.freeze(
      [
        ...checks.map((check) =>
          Object.freeze({
            id: String(check.id),
            status: String(check.status),
          }),
        ),
        ...demoProofChecks,
      ],
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedTargetPreflight,
        label: "Hosted target preflight",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedTargetPreflight,
        }),
        status: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-target-preflight",
      }),
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedEvidenceLane.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(hostedEvidenceLane.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    realHostedEvidenceInputs,
    hostedHandoffChecklist,
    artifactSummary: Object.freeze({
      preflightStatus: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
      blockedCheckCount: blockedCheckIds.length,
      realHostedEvidenceStatus: String(
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceStatus ?? "unknown",
      ),
      realHostedEvidenceCommand: String(
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.command ??
          "",
      ),
      realHostedEvidenceProofTarget: String(
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs
          ?.proofTarget ?? "",
      ),
      ...(demoProofSummary === null ? {} : demoProofSummary),
      frontendBaseUrl: String(hostedEvidenceLane.target?.frontendBaseUrl ?? ""),
      apiBaseUrl: String(hostedEvidenceLane.target?.apiBaseUrl ?? ""),
      groupId: String(hostedEvidenceLane.target?.groupId ?? ""),
      rawEvidencePath: String(hostedEvidenceLane.target?.rawEvidencePath ?? ""),
      rawEvidenceStatus: String(
        hostedEvidenceLane.target?.rawEvidenceStatus ?? "unknown",
      ),
      nextCommand: String(hostedEvidenceLane.nextCommand ?? ""),
      nextProofTarget: String(hostedEvidenceLane.nextProofTarget ?? ""),
      releaseReady: hostedEvidenceLane.releaseReady === true,
      productionReady: hostedEvidenceLane.productionReady === true,
    }),
  });
}

function normalizeHostedEvidenceLaneHandoffChecklist({
  hostedEvidenceLane,
  blockedChecks,
  realHostedEvidenceInputs,
}) {
  const checklist =
    hostedEvidenceLane.hostedHandoffChecklist !== null &&
    typeof hostedEvidenceLane.hostedHandoffChecklist === "object"
      ? hostedEvidenceLane.hostedHandoffChecklist
      : null;
  return Object.freeze({
    status: String(checklist?.status ?? hostedEvidenceLane.status ?? "unknown"),
    preflightStatus: String(
      checklist?.preflightStatus ?? hostedEvidenceLane.preflightStatus ?? "unknown",
    ),
    command: String(
      checklist?.command ??
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.command ??
        hostedEvidenceLane.nextCommand ??
        "",
    ),
    proofTarget: String(
      checklist?.proofTarget ??
        hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.proofTarget ??
        hostedEvidenceLane.nextProofTarget ??
        "",
    ),
    inputCount: realHostedEvidenceInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      realHostedEvidenceInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value: input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      checklist?.blockedReceipt ?? hostedEvidenceLane.blockedReceipt,
    ),
    inputSections: normalizeHostedHandoffInputSections(checklist?.inputSections),
  });
}

function normalizeLocalHostedEvidenceLaneDemoProofSummary(proof) {
  if (!isLocalHostedEvidenceLaneDemoProof(proof)) {
    return null;
  }
  return Object.freeze({
    demoProofStatus: String(proof.status),
    demoProofTarget: devTestGameHostedEvidenceLaneDemoProofPath,
    demoOnly: true,
    syntheticExternalTarget: true,
    demoBlockedLaneStatus: String(proof.blockedLane.status),
    demoPassedLaneStatus: String(proof.passedLane.status),
    demoExternalEvidencePath: String(proof.generatedFrom?.externalEvidence ?? ""),
    demoPassedRoleUrl: String(proof.handoff?.passedRoleUrl ?? ""),
  });
}

function normalizeLocalHostedEvidenceLaneDemoProofChecks(proof) {
  if (!isLocalHostedEvidenceLaneDemoProof(proof) || !Array.isArray(proof.checks)) {
    return [];
  }
  return proof.checks.map((check) =>
    Object.freeze({
      id: `demo-proof:${String(check.id ?? "")}`,
      status: String(check.status ?? "unknown"),
    }),
  );
}

function isLocalHostedEvidenceLaneDemoProof(proof) {
  return (
    proof !== null &&
    typeof proof === "object" &&
    proof.version === 1 &&
    proof.proof === "dev-test-game-hosted-evidence-lane-demo-proof" &&
    proof.status === "passed" &&
    proof.scope === "local-dev-test-game-hosted-evidence-lane-demo-proof" &&
    proof.releaseReady === false &&
    proof.productionReady === false &&
    proof.target?.syntheticExternalTarget === true &&
    proof.blockedLane?.status === "blocked" &&
    proof.passedLane?.status === "passed"
  );
}

export function normalizeLocalHostedOpsSignalsAudit(hostedOpsSignals, { game }) {
  if (
    hostedOpsSignals === null ||
    typeof hostedOpsSignals !== "object" ||
    hostedOpsSignals.version !== 1 ||
    hostedOpsSignals.proof !== "dev-test-game-hosted-ops-signals" ||
    hostedOpsSignals.status !== "passed" ||
    hostedOpsSignals.scope !== "local-hosted-like-ops-signals" ||
    hostedOpsSignals.releaseReady !== false ||
    hostedOpsSignals.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(hostedOpsSignals.checks)
    ? hostedOpsSignals.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.hostedOpsSignals,
    label: "Local hosted ops signals",
    status: `${passedChecks.length} hosted-like ops signals passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like ops signal bundle",
    boundaryDetail:
      hostedOpsSignals.proofBoundary ??
      "Local hosted-like ops signal bundle without hosted telemetry or release claims.",
    href: devTestGameHostedOpsSignalsPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.hostedOpsSignals }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedConcurrentRaceMatrix,
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
        }),
        status: String(hostedOpsSignals.matrix?.hostedEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: localAdminAuditIds.opsArtifacts,
        label: "Ops artifacts",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.opsArtifacts }),
        status: "passed",
        command: "test:dev-test-game-ops-artifacts",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(hostedOpsSignals.target?.game ?? ""),
      cellCount: Number(hostedOpsSignals.matrix?.cellCount ?? 0),
      reconnectLaneCount: Number(hostedOpsSignals.matrix?.reconnectLaneCount ?? 0),
      staleConflictLaneCount: Number(
        hostedOpsSignals.matrix?.staleConflictLaneCount ?? 0,
      ),
      realHostedDeploymentStatus: String(
        hostedOpsSignals.target?.realHostedDeploymentStatus ?? "unknown",
      ),
      releaseReady: hostedOpsSignals.releaseReady === true,
      productionReady: hostedOpsSignals.productionReady === true,
    }),
  });
}

export function normalizeLocalRealHostedObservabilityHandoffAudit(
  realHostedObservabilityHandoff,
  { game },
) {
  if (
    realHostedObservabilityHandoff === null ||
    typeof realHostedObservabilityHandoff !== "object" ||
    realHostedObservabilityHandoff.version !== 1 ||
    realHostedObservabilityHandoff.proof !==
      "dev-test-game-real-hosted-observability-handoff" ||
    !["passed", "blocked"].includes(realHostedObservabilityHandoff.status) ||
    realHostedObservabilityHandoff.scope !== "real-hosted-observability-handoff" ||
    realHostedObservabilityHandoff.releaseReady !== false ||
    realHostedObservabilityHandoff.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(realHostedObservabilityHandoff.checks)
    ? realHostedObservabilityHandoff.checks
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  const blockedCheckIds = Array.isArray(
    realHostedObservabilityHandoff.hostedHandoffChecklist?.blockedCheckIds,
  )
    ? realHostedObservabilityHandoff.hostedHandoffChecklist.blockedCheckIds.map(
        (id) => String(id),
      )
    : checks
        .filter((check) => check?.status === "blocked")
        .map((check) => String(check.id));
  const blockedCheckIdSet = new Set(blockedCheckIds);
  const hostedHandoffChecklist =
    normalizeRealHostedObservabilityHandoffChecklist({
      realHostedObservabilityHandoff,
      blockedChecks: checks.filter((check) =>
        blockedCheckIdSet.has(String(check.id)),
      ),
    });
  const realHostedObservabilitySummary =
    normalizeRealHostedObservabilitySummary({
      realHostedObservabilityHandoff,
      checks,
      passedChecks,
      blockedCheckIds,
      hostedHandoffChecklist,
    });
  return Object.freeze({
    id: localAdminAuditIds.realHostedObservabilityHandoff,
    label: "Real hosted observability handoff",
    status: `${realHostedObservabilityHandoff.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Real hosted observability handoff",
    boundaryDetail:
      realHostedObservabilityHandoff.proofBoundary ??
      "Real hosted observability handoff without hosted telemetry or release claims.",
    href: devTestGameRealHostedObservabilityHandoffPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.realHostedObservabilityHandoff,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      checks
        .filter((check) => blockedCheckIdSet.has(String(check.id)))
        .map((check) =>
          Object.freeze({
            id: String(check.id),
            status: "blocked",
            requiredEvidence: String(check.requiredEvidence ?? ""),
          }),
        ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.hostedOpsSignals,
        label: "Local hosted ops signals",
        href: adminAuditInspectHref({
          game,
          audit: localAdminAuditIds.hostedOpsSignals,
        }),
        status: "baseline",
        command: "test:dev-test-game-hosted-ops-signals",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(realHostedObservabilityHandoff.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
    handoffPath: buildAdminAuditHandoffPath({
      upstreamAuditId: localAdminAuditIds.nextAction,
      localCapabilityAuditId: localAdminAuditIds.hostedOpsSignals,
      downstreamStatus: String(realHostedObservabilityHandoff.status ?? "unknown"),
      downstreamCommand: String(realHostedObservabilityHandoff.nextCommand ?? ""),
      downstreamProofTarget: String(
        realHostedObservabilityHandoff.nextProofTarget ?? "",
      ),
    }),
    hostedHandoffChecklist,
    artifactSummary: Object.freeze({
      realHostedObservabilitySummary,
      game: String(realHostedObservabilityHandoff.generatedFrom?.game ?? ""),
      rawEvidencePath: String(
        realHostedObservabilityHandoff.target?.rawEvidencePath ?? "",
      ),
      rawEvidenceStatus: String(
        realHostedObservabilityHandoff.target?.rawEvidenceStatus ?? "unknown",
      ),
      localHostedOpsSignalsPath: String(
        realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ?? "",
      ),
      localHostedLikeSignalsOnlyBaseline:
        realHostedObservabilityHandoff.target
          ?.localHostedLikeSignalsOnlyBaseline === true,
      blockedCheckCount: blockedCheckIds.length,
      nextCommand: String(realHostedObservabilityHandoff.nextCommand ?? ""),
      nextProofTarget: String(realHostedObservabilityHandoff.nextProofTarget ?? ""),
      releaseReady: realHostedObservabilityHandoff.releaseReady === true,
      productionReady: realHostedObservabilityHandoff.productionReady === true,
    }),
  });
}

function normalizeRealHostedObservabilitySummary({
  realHostedObservabilityHandoff,
  checks,
  passedChecks,
  blockedCheckIds,
  hostedHandoffChecklist,
}) {
  const inputSections = Array.isArray(hostedHandoffChecklist?.inputSections)
    ? hostedHandoffChecklist.inputSections
    : [];
  const requiredInputCount = inputSections.reduce(
    (total, section) => total + section.requiredInputIds.length,
    0,
  );
  const providedInputCount = inputSections.reduce(
    (total, section) => total + section.providedInputIds.length,
    0,
  );
  return Object.freeze({
    status: String(realHostedObservabilityHandoff.status ?? "unknown"),
    checkCount: checks.length,
    passedCheckCount: passedChecks.length,
    blockedCheckCount: blockedCheckIds.length,
    requiredInputCount,
    providedInputCount,
    missingInputCount: requiredInputCount - providedInputCount,
    baselineStatus:
      realHostedObservabilityHandoff.target?.localHostedLikeSignalsOnlyBaseline ===
      true
        ? "baseline only"
        : "baseline missing",
    localHostedOpsSignalsPath: String(
      realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ?? "",
    ),
    localVsHostedBoundary:
      "Local hosted-like signals cannot satisfy real hosted observability evidence.",
  });
}

function normalizeRealHostedObservabilityHandoffChecklist({
  realHostedObservabilityHandoff,
  blockedChecks,
}) {
  const checklist = realHostedObservabilityHandoff.hostedHandoffChecklist;
  const inputIds = Array.isArray(checklist?.inputIds)
    ? checklist.inputIds
    : realHostedObservabilityHandoffInputIds;
  return Object.freeze({
    status: String(realHostedObservabilityHandoff.status ?? "unknown"),
    preflightStatus: String(
      checklist?.preflightStatus ??
        realHostedObservabilityHandoff.status ??
        "unknown",
    ),
    command: String(
      checklist?.command ??
        realHostedObservabilityHandoff.nextCommand ??
        `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    ),
    proofTarget: String(
      checklist?.proofTarget ??
        realHostedObservabilityHandoff.nextProofTarget ??
        devTestGameRealHostedObservabilityHandoffPath,
    ),
    inputCount: inputIds.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      inputIds.map((id) =>
        Object.freeze({
          id: String(id),
          label: String(id),
          value: realHostedObservabilityHandoffInputValue({
            id,
            realHostedObservabilityHandoff,
          }),
          required: true,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    groups: normalizeHostedHandoffGroups(checklist?.requirementGroups),
    inputSections: normalizeHostedHandoffInputSections(checklist?.inputSections),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(checklist?.blockedReceipt),
  });
}

export function appendLocalProofFreshnessAudit(
  audit,
  proofFreshness,
  { game, nextAction = null },
) {
  const row = normalizeLocalProofFreshnessAudit(proofFreshness, { game, nextAction });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalNextActionAudit(audit, nextAction, { game, proofGraph = null }) {
  const row = normalizeLocalNextActionAudit(nextAction, { game, proofGraph });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalProofGraphAudit(audit, proofGraph, { game }) {
  const row = normalizeLocalProofGraphAudit(proofGraph, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalRaceCoverageAudit(audit, raceCoverage, { game }) {
  const row = normalizeLocalRaceCoverageAudit(raceCoverage, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalHostedConcurrentRaceMatrixAudit(
  audit,
  hostedConcurrentRaceMatrix,
  { game },
) {
  const row = normalizeLocalHostedConcurrentRaceMatrixAudit(
    hostedConcurrentRaceMatrix,
    { game },
  );
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedConcurrentRaceMatrixAudit(
  hostedConcurrentRaceMatrix,
  { game },
) {
  if (
    hostedConcurrentRaceMatrix === null ||
    typeof hostedConcurrentRaceMatrix !== "object" ||
    hostedConcurrentRaceMatrix.version !== 1 ||
    hostedConcurrentRaceMatrix.proof !==
      "dev-test-game-hosted-concurrent-race-matrix" ||
    hostedConcurrentRaceMatrix.status !== "passed" ||
    hostedConcurrentRaceMatrix.scope !== "local-hosted-like-concurrent-race-matrix" ||
    hostedConcurrentRaceMatrix.releaseReady !== false ||
    hostedConcurrentRaceMatrix.productionReady !== false
  ) {
    return null;
  }
  const cells = Array.isArray(hostedConcurrentRaceMatrix.cells)
    ? hostedConcurrentRaceMatrix.cells
    : [];
  const progress = Array.isArray(hostedConcurrentRaceMatrix.evidenceProgress)
    ? hostedConcurrentRaceMatrix.evidenceProgress
    : [];
  const roleSurfaces = Array.isArray(
    hostedConcurrentRaceMatrix.hostedLikeTarget?.roleSurfaces,
  )
    ? hostedConcurrentRaceMatrix.hostedLikeTarget.roleSurfaces
    : [];
  const reconnectLanes = Array.isArray(hostedConcurrentRaceMatrix.reconnectLanes)
    ? hostedConcurrentRaceMatrix.reconnectLanes
    : [];
  const staleConflictLanes = Array.isArray(
    hostedConcurrentRaceMatrix.staleConflictLanes,
  )
    ? hostedConcurrentRaceMatrix.staleConflictLanes
    : [];
  const remainingGaps = Array.isArray(hostedConcurrentRaceMatrix.remainingGaps)
    ? hostedConcurrentRaceMatrix.remainingGaps
    : [];
  const requestedEvidence =
    hostedConcurrentRaceMatrix.requestedEvidence !== null &&
    typeof hostedConcurrentRaceMatrix.requestedEvidence === "object"
      ? hostedConcurrentRaceMatrix.requestedEvidence
      : null;
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    hostedConcurrentRaceMatrix.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeHostedMatrixHandoffChecklist({
    hostedConcurrentRaceMatrix,
    realHostedEvidenceInputs,
  });
  const hostedMatrixSummary = normalizeHostedMatrixSummary({
    hostedConcurrentRaceMatrix,
    cells,
    hostedHandoffChecklist,
  });
  return Object.freeze({
    id: localAdminAuditIds.hostedConcurrentRaceMatrix,
    label: "Local hosted matrix",
    status: `${Number(
      hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
    )} hosted-like race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like concurrency matrix",
    boundaryDetail:
      hostedConcurrentRaceMatrix.proofBoundary ??
      "Local hosted-like concurrency matrix without hosted deployment or release claims.",
    href: devTestGameHostedConcurrentRaceMatrixPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hostedConcurrentRaceMatrix,
    }),
    checks: Object.freeze(
      [
        ...progress.map((item) =>
          Object.freeze({
            id: String(item.id),
            status: String(item.status),
          }),
        ),
        ...cells.map((cell) =>
          Object.freeze({
            id: String(cell.id),
            status: String(cell.status),
          }),
        ),
      ],
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.raceCoverage,
        label: "Race coverage",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.raceCoverage }),
        status: String(
          hostedConcurrentRaceMatrix.generatedFrom?.raceCoveragePromotedMilestones
            ?.status ?? "unknown",
        ),
        command: "test:dev-test-game-race-coverage",
      }),
      Object.freeze({
        id: localAdminAuditIds.nextAction,
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
        status: String(requestedEvidence?.status ?? "unknown"),
        command: String(hostedConcurrentRaceMatrix.nextBuildSlice?.command ?? ""),
      }),
    ]),
    handoffPath: buildAdminAuditHandoffPath({
      upstreamAuditId: localAdminAuditIds.nextAction,
      localCapabilityAuditId: localAdminAuditIds.raceCoverage,
      downstreamStatus: String(
        hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
      ),
      downstreamCommand: String(
        hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.command ?? "",
      ),
      downstreamProofTarget: String(
        hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.proofTarget ?? "",
      ),
    }),
    reconnectLanes: Object.freeze(
      reconnectLanes.map((lane) =>
        Object.freeze({
          id: String(lane.id),
          label: String(lane.label ?? lane.id ?? ""),
          status: String(lane.status ?? "unknown"),
        }),
      ),
    ),
    staleConflictLanes: Object.freeze(
      staleConflictLanes.map((lane) =>
        Object.freeze({
          id: String(lane.id),
          label: String(lane.label ?? lane.id ?? ""),
          status: String(lane.status ?? "unknown"),
        }),
      ),
    ),
    unproven: Object.freeze(
      [
        ...(requestedEvidence === null
          ? []
          : [
              Object.freeze({
                id: String(requestedEvidence.id),
                status: String(requestedEvidence.status ?? "unknown"),
                requiredEvidence: String(requestedEvidence.requiredEvidence ?? ""),
              }),
            ]),
        ...remainingGaps.map((gap, index) =>
          Object.freeze({
            id: `remaining-gap-${index + 1}`,
            status: "unproven",
            requiredEvidence: String(gap),
          }),
        ),
      ],
    ),
    realHostedEvidenceInputs,
    hostedHandoffChecklist,
    artifactSummary: Object.freeze({
      hostedMatrixSummary,
      game: String(hostedConcurrentRaceMatrix.hostedLikeTarget?.game ?? ""),
      cellCount: Number(hostedConcurrentRaceMatrix.summary?.cellCount ?? cells.length),
      passedCellCount: Number(
        hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
      ),
      reloadCoveredCellCount: Number(
        hostedConcurrentRaceMatrix.summary?.reloadCoveredCellCount ?? 0,
      ),
      reconnectLaneCount: Number(
        hostedConcurrentRaceMatrix.summary?.reconnectLaneCount ?? 0,
      ),
      staleConflictLaneCount: Number(
        hostedConcurrentRaceMatrix.summary?.staleConflictLaneCount ?? 0,
      ),
      roleSurfaceCount: Number(
        hostedConcurrentRaceMatrix.summary?.roleSurfaceCount ??
          roleSurfaces.length,
      ),
      hostedEvidenceStatus: String(
        hostedConcurrentRaceMatrix.summary?.hostedEvidenceStatus ?? "unknown",
      ),
      hostedEvidenceMode: String(
        hostedConcurrentRaceMatrix.summary?.hostedEvidenceMode ?? "unknown",
      ),
      localDemoHostedEvidenceStatus: String(
        hostedConcurrentRaceMatrix.summary?.localDemoHostedEvidenceStatus ??
          "unknown",
      ),
      realHostedEvidenceStatus: String(
        hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
      ),
      realHostedDeploymentStatus: String(
        hostedConcurrentRaceMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
      ),
      externalHostedEvidenceStatus: String(
        hostedConcurrentRaceMatrix.externalHostedEvidence?.status ?? "unknown",
      ),
      realHostedEvidenceCommand: String(
        hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.command ?? "",
      ),
      realHostedEvidenceProofTarget: String(
        hostedConcurrentRaceMatrix.realHostedEvidenceInputs?.proofTarget ?? "",
      ),
      nextCommand: String(hostedConcurrentRaceMatrix.nextBuildSlice?.command ?? ""),
      releaseReady: hostedConcurrentRaceMatrix.releaseReady === true,
      productionReady: hostedConcurrentRaceMatrix.productionReady === true,
    }),
  });
}

function normalizeHostedMatrixSummary({
  hostedConcurrentRaceMatrix,
  cells,
  hostedHandoffChecklist,
}) {
  const cellCount = Number(hostedConcurrentRaceMatrix.summary?.cellCount ?? cells.length);
  const passedCellCount = Number(
    hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
  );
  const reloadCoveredCellCount = Number(
    hostedConcurrentRaceMatrix.summary?.reloadCoveredCellCount ?? 0,
  );
  const missingHostedInputIds = Object.freeze([
    ...(hostedHandoffChecklist?.blockedReceipt?.missingRequiredInputs ?? []),
  ]);
  return Object.freeze({
    status: String(hostedConcurrentRaceMatrix.status ?? "unknown"),
    cellCount,
    passedCellCount,
    reloadCoveredCellCount,
    reconnectLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.reconnectLaneCount ?? 0,
    ),
    staleConflictLaneCount: Number(
      hostedConcurrentRaceMatrix.summary?.staleConflictLaneCount ?? 0,
    ),
    hostedEvidenceStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedEvidenceStatus ?? "unknown",
    ),
    hostedDeploymentStatus: String(
      hostedConcurrentRaceMatrix.summary?.realHostedDeploymentStatus ?? "unknown",
    ),
    hostedEvidenceMode: String(
      hostedConcurrentRaceMatrix.summary?.hostedEvidenceMode ?? "unknown",
    ),
    missingHostedInputCount: missingHostedInputIds.length,
    missingHostedInputIds,
    localVsHostedBoundary:
      "Local hosted-like matrix evidence cannot satisfy real hosted race evidence.",
  });
}

function normalizeHostedMatrixHandoffChecklist({
  hostedConcurrentRaceMatrix,
  realHostedEvidenceInputs,
}) {
  const checklist = hostedConcurrentRaceMatrix.hostedHandoffChecklist;
  if (checklist === null || typeof checklist !== "object") {
    return null;
  }
  const blockedChecks = Array.isArray(checklist.blockedChecks)
    ? checklist.blockedChecks
    : [];
  const checklistInputs =
    realHostedEvidenceInputs.length > 0
      ? realHostedEvidenceInputs
      : Array.isArray(checklist.inputIds)
        ? checklist.inputIds.map((id) =>
            Object.freeze({
              id: String(id ?? ""),
              label: String(id ?? ""),
              value: "required",
              required: true,
            }),
          )
        : [];
  return Object.freeze({
    status: String(checklist.status ?? "unknown"),
    preflightStatus: String(checklist.preflightStatus ?? "unknown"),
    command: String(checklist.command ?? ""),
    proofTarget: String(checklist.proofTarget ?? ""),
    inputCount: checklistInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      checklistInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value: input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id ?? ""),
          status: String(check.status ?? "unknown"),
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(
      checklist.blockedReceipt,
    ),
  });
}

export function normalizeLocalRaceCoverageAudit(raceCoverage, { game }) {
  if (
    raceCoverage === null ||
    typeof raceCoverage !== "object" ||
    raceCoverage.version !== 1 ||
    raceCoverage.proof !== "dev-test-game-race-coverage" ||
    raceCoverage.status !== "passed" ||
    raceCoverage.scope !== "local-dev-test-game-race-coverage" ||
    raceCoverage.releaseReady !== false ||
    raceCoverage.productionReady !== false
  ) {
    return null;
  }
  const cells = Array.isArray(raceCoverage.cells) ? raceCoverage.cells : [];
  const passedCells = cells.filter((cell) => cell?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.raceCoverage,
    label: "Local race coverage",
    status: `${passedCells.length} race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local race-coverage inventory",
    boundaryDetail:
      raceCoverage.proofBoundary ??
      "Generated local race-coverage inventory without hosted concurrency claims.",
    href: devTestGameRaceCoveragePath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.raceCoverage }),
    checks: Object.freeze(
      cells.map((cell) =>
        Object.freeze({
          id: String(cell.id),
          status: String(cell.status),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      game: String(raceCoverage.generatedFrom?.game ?? ""),
      cellCount: Number(raceCoverage.summary?.cellCount ?? cells.length),
      provenCellCount: Number(raceCoverage.summary?.provenCellCount ?? passedCells.length),
      unprovenCellCount: Number(raceCoverage.summary?.unprovenCellCount ?? 0),
      reloadRequiredCellCount: Number(
        raceCoverage.summary?.reloadRequiredCellCount ?? 0,
      ),
      reloadCoveredCellCount: Number(
        raceCoverage.summary?.reloadCoveredCellCount ?? 0,
      ),
      reloadGapCount: Number(raceCoverage.summary?.reloadGapCount ?? 0),
      releaseReady: raceCoverage.releaseReady === true,
      productionReady: raceCoverage.productionReady === true,
    }),
  });
}

export function normalizeLocalProofGraphAudit(proofGraph, { game }) {
  if (
    proofGraph === null ||
    typeof proofGraph !== "object" ||
    proofGraph.version !== 1 ||
    proofGraph.proof !== "dev-test-game-proof-graph" ||
    proofGraph.status !== "passed" ||
    proofGraph.scope !== "local-dev-test-game-proof-graph" ||
    proofGraph.releaseReady !== false ||
    proofGraph.productionReady !== false
  ) {
    return null;
  }
  const nodes = Array.isArray(proofGraph.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph.edges) ? proofGraph.edges : [];
  const roleNodes = nodes.filter(
    (node) => typeof node?.roleUrl === "string" && node.roleUrl.trim() !== "",
  );
  return Object.freeze({
    id: localAdminAuditIds.proofGraph,
    label: "Local proof graph",
    status: `${nodes.length} proof nodes, ${edges.length} edges`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine proof graph",
    boundaryDetail:
      proofGraph.proofBoundary ??
      "Generated local proof graph without hosted or release-readiness claims.",
    href: devTestGameProofGraphPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofGraph }),
    checks: normalizeLocalProofGraphCheckRows(proofGraph),
    relatedLinks: normalizeLocalProofGraphRelatedLinks(proofGraph, { game, nodes }),
    artifactSummary: normalizeLocalProofGraphArtifactSummary(proofGraph, {
      nodes,
      edges,
      roleNodes,
    }),
  });
}

export function normalizeLocalProofGraphCheckRows(proofGraph) {
  const nodes = Array.isArray(proofGraph?.nodes) ? proofGraph.nodes : [];
  const edges = Array.isArray(proofGraph?.edges) ? proofGraph.edges : [];
  return Object.freeze([
    ...nodes.flatMap((node) => normalizeLocalProofGraphNodeCheckRows(node)),
    ...edges.flatMap((edge) => normalizeLocalProofGraphEdgeCheckRows(edge)),
  ]);
}

export function normalizeLocalProofGraphNodeCheckRows(node) {
  const parentId = String(node?.id ?? "");
  return Object.freeze([
    Object.freeze({
      id: parentId,
      status: String(node?.status ?? "recorded"),
    }),
    ...coverageDecisionCheckRows({
      parentId,
      coverageDecision: node?.coverageDecision,
    }),
    ...normalizedEvidenceObjectCheckRows({
      parentId,
      objects: node?.normalizedEvidenceObjects,
    }),
    ...proofGraphReceiptArtifactCheckRows({
      parentId,
      artifacts: node?.receiptArtifacts,
    }),
  ]);
}

export function normalizeLocalProofGraphEdgeCheckRows(edge) {
  return Object.freeze([
    Object.freeze({
      id: proofGraphEdgeCheckId(edge),
      status: String(edge?.relationship ?? "recorded"),
    }),
  ]);
}

export function normalizeLocalProofGraphRelatedLinks(
  proofGraph,
  { game, nodes } = {},
) {
  const graphNodes = Array.isArray(nodes)
    ? nodes
    : Array.isArray(proofGraph?.nodes)
      ? proofGraph.nodes
      : [];
  const roleNodes = graphNodes.filter(
    (node) => typeof node?.roleUrl === "string" && node.roleUrl.trim() !== "",
  );
  return Object.freeze(
    roleNodes.map((node) =>
      Object.freeze({
        id: String(node.id),
        label: String(node.label ?? node.id),
        href: seededRoleUrlToAdminHref(node.roleUrl, { game }),
        status: String(node.status ?? "recorded"),
        command: String(node.recoveryCommand ?? node.proofCommand ?? ""),
      }),
    ),
  );
}

export function normalizeLocalProofGraphArtifactSummary(
  proofGraph,
  { nodes, edges, roleNodes } = {},
) {
  const graphNodes = Array.isArray(nodes)
    ? nodes
    : Array.isArray(proofGraph?.nodes)
      ? proofGraph.nodes
      : [];
  const graphEdges = Array.isArray(edges)
    ? edges
    : Array.isArray(proofGraph?.edges)
      ? proofGraph.edges
      : [];
  const graphRoleNodes = Array.isArray(roleNodes)
    ? roleNodes
    : graphNodes.filter((node) => typeof node?.roleUrl === "string");
  return Object.freeze({
    nodeCount: Number(proofGraph?.summary?.nodeCount ?? graphNodes.length),
    edgeCount: Number(proofGraph?.summary?.edgeCount ?? graphEdges.length),
    roleUrlCount: Number(
      proofGraph?.summary?.roleUrlCount ?? graphRoleNodes.length,
    ),
    recoveryTargetCount: Number(proofGraph?.summary?.recoveryTargetCount ?? 0),
    releaseReady: proofGraph?.releaseReady === true,
    productionReady: proofGraph?.productionReady === true,
  });
}

function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
}

function normalizedEvidenceObjectCheckRows({ parentId, objects }) {
  return normalizeNormalizedEvidenceObjects(objects).map((object) =>
    Object.freeze({
      id: `evidence-object:${parentId}:${object.name}`,
      status: `${object.status}:${object.laneId}:${object.evidencePath}`,
      name: object.name,
      laneId: object.laneId,
      evidencePath: object.evidencePath,
    }),
  );
}

function proofGraphReceiptArtifactCheckRows({ parentId, artifacts }) {
  return normalizeProofGraphReceiptArtifactRows({ parentId, artifacts });
}

function coverageDecisionCheckRows({
  parentId,
  coverageDecision,
  rowId = `coverage-decision:${parentId}`,
}) {
  const status = coverageDecisionStatus(coverageDecision);
  return status === ""
    ? []
    : [
        Object.freeze({
          id: rowId,
          status,
        }),
      ];
}

function coverageDecisionStatus(coverageDecision) {
  if (coverageDecision === null || typeof coverageDecision !== "object") {
    return "";
  }
  const kind = String(coverageDecision.kind ?? "");
  if (kind === "") {
    return "";
  }
  const detail =
    String(coverageDecision.proofCommand ?? "").trim() ||
    String(coverageDecision.recoveryCommand ?? "").trim() ||
    String(coverageDecision.reason ?? "").trim() ||
    String(coverageDecision.prerequisiteCheckId ?? "").trim() ||
    String(coverageDecision.nextDecisionTrigger ?? "").trim();
  return detail === "" ? kind : `${kind}:${detail}`;
}

function normalizeNormalizedEvidenceObjects(objects) {
  return Object.freeze(
    (Array.isArray(objects) ? objects : [])
      .map((object) =>
        Object.freeze({
          name: String(object?.name ?? ""),
          laneId: String(object?.laneId ?? ""),
          status: String(object?.status ?? "unknown"),
          evidencePath: String(object?.evidencePath ?? ""),
        }),
      )
      .filter((object) => object.name !== ""),
  );
}

export function normalizeLocalNextActionAudit(nextAction, { game, proofGraph = null }) {
  if (
    nextAction === null ||
    typeof nextAction !== "object" ||
    nextAction.version !== 1 ||
    nextAction.proof !== "dev-test-game-next-action" ||
    nextAction.status !== "passed" ||
    nextAction.scope !== "local-dev-test-game-next-action" ||
    nextAction.releaseReady !== false ||
    nextAction.productionReady !== false
  ) {
    return null;
  }
  const action = nextAction.nextAction ?? {};
  const command = String(action.command ?? "");
  const reason = String(action.reason ?? "unknown");
  const actionStatus = String(action.status ?? "unknown");
  const artifact =
    action.artifact !== null && typeof action.artifact === "object"
      ? action.artifact
      : null;
  const localCheck =
    action.localCheck !== null && typeof action.localCheck === "object"
      ? action.localCheck
      : null;
  const unproven =
    action.unproven !== null && typeof action.unproven === "object"
      ? action.unproven
      : null;
  const seedProofLaneCoverage =
    action.seedProofLaneCoverage !== null &&
    typeof action.seedProofLaneCoverage === "object"
      ? action.seedProofLaneCoverage
      : null;
  const sequenceDeferral =
    action.sequenceDeferral !== null &&
    typeof action.sequenceDeferral === "object"
      ? action.sequenceDeferral
      : null;
  const localCapabilityConfidence =
    sequenceDeferral?.localCapabilityConfidence !== null &&
    typeof sequenceDeferral?.localCapabilityConfidence === "object"
      ? sequenceDeferral.localCapabilityConfidence
      : null;
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    unproven?.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeNextActionHostedHandoffChecklist({
    unproven,
    realHostedEvidenceInputs,
  });
  const localCheckRoleUrl =
    typeof localCheck?.roleUrl === "string" && localCheck.roleUrl.trim() !== ""
      ? localCheck.roleUrl
      : "";
  const unprovenRoleUrl =
    typeof unproven?.roleUrl === "string" && unproven.roleUrl.trim() !== ""
      ? unproven.roleUrl
      : "";
  const seedProofLaneCoverageRoleUrl =
    typeof seedProofLaneCoverage?.roleUrl === "string" &&
    seedProofLaneCoverage.roleUrl.trim() !== ""
      ? seedProofLaneCoverage.roleUrl
      : "";
  const sequenceDeferralRoleUrl =
    typeof sequenceDeferral?.deferredRoleUrl === "string" &&
    sequenceDeferral.deferredRoleUrl.trim() !== ""
      ? sequenceDeferral.deferredRoleUrl
      : "";
  const unprovenProofGraphNodeId =
    typeof unproven?.proofGraphNodeId === "string" &&
    unproven.proofGraphNodeId.trim() !== ""
      ? unproven.proofGraphNodeId
      : "";
  const selectedProofGraphNode = selectedNextActionProofGraphNodeSummary({
    nextAction,
    proofGraph,
  });
  const selectedProofGraphNodeStatus = selectedNextActionProofGraphNodeStatus({
    nextAction,
    proofGraph,
  });
  const selectedSpineTarget = normalizeNextActionSpineTarget(unproven?.spineTarget);
  const selectedSpineDrilldown = normalizeNextActionSpineDrilldown(
    unproven?.spineDrilldown,
  );
  const selectedProductionFeatureSpineTarget =
    normalizeNextActionFeatureSpineDeclaration(
      unproven?.productionFeatureSpineTarget,
    );
  const selectedProductionFeatureGraph =
    normalizeNextActionProductionFeatureGraph(
      unproven?.selectedProductionFeatureGraph,
    );
  const selectionTrace = normalizeNextActionSelectionTrace(nextAction.selectionTrace);
  const releaseReadinessTrace = normalizeNextActionReleaseReadinessTrace(
    nextAction.releaseReadinessTrace,
  );
  const selectedReleaseReadinessCandidate =
    releaseReadinessTrace.candidates.find((candidate) => candidate.selected) ??
    null;
  const localReadinessDependencyTrace =
    normalizeNextActionLocalReadinessDependencyTrace(
      nextAction.localReadinessDependencyTrace,
    );
  const replacementRaceReloadTrace = normalizeNextActionReplacementRaceReloadTrace(
    nextAction.replacementRaceReloadTrace,
  );
  const hostConcurrentRaceReloadTrace =
    normalizeNextActionHostConcurrentRaceReloadTrace(
      nextAction.hostConcurrentRaceReloadTrace,
    );
  const playerConcurrentActionReloadTrace =
    normalizeNextActionPlayerConcurrentActionReloadTrace(
      nextAction.playerConcurrentActionReloadTrace,
    );
  const cohostDeadlineRaceReloadTrace =
    normalizeNextActionCohostDeadlineRaceReloadTrace(
      nextAction.cohostDeadlineRaceReloadTrace,
    );
  const raceCoveragePromotedMilestones =
    normalizeNextActionRaceCoveragePromotedMilestones(
      nextAction.raceCoveragePromotedMilestones,
    );
  const staleConflictMessageTrace = normalizeNextActionStaleConflictMessageTrace(
    nextAction.staleConflictMessageTrace,
  );
  const hostStaleControlTrace = normalizeNextActionHostStaleControlTrace(
    nextAction.hostStaleControlTrace,
  );
  const stabilityTrace = normalizeNextActionStabilityTrace(nextAction.stabilityTrace);
  const seedProofLaneCoverageTrace =
    normalizeNextActionSeedProofLaneCoverageTrace(
      nextAction.seedProofLaneCoverageTrace,
    );
  const terminalBatchGraph = normalizeNextActionTerminalBatchGraph(
    nextAction.generatedFrom?.terminalBatchGraph,
  );
  const privateChannelRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.privateChannelRecoveryGraph,
    );
  const replacementActionRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementActionRecoveryGraph,
    );
  const replacementHandoffRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementHandoffRecoveryGraph,
    );
  const replacementPrivateRecoveryGraph =
    normalizeNextActionRecoveryReceiptGraph(
      nextAction.generatedFrom?.replacementPrivateRecoveryGraph,
    );
  const stability =
    action.stability !== null && typeof action.stability === "object"
      ? action.stability
      : null;
  const checks = [
    Object.freeze({
      id: "next-command",
      status: command === "" ? "missing" : "available",
    }),
    Object.freeze({
      id: reason,
      status: actionStatus,
    }),
    ...(artifact === null
      ? []
      : [
          Object.freeze({
            id: String(artifact.id),
            status: String(artifact.status ?? "unknown"),
          }),
        ]),
    ...(localCheck === null
      ? []
      : [
          Object.freeze({
            id: String(localCheck.id),
            status: String(localCheck.status ?? "unknown"),
          }),
        ]),
    ...(unproven === null
      ? []
      : [
          Object.freeze({
            id: String(unproven.id),
            status: String(unproven.status ?? "unknown"),
          }),
        ]),
    ...(selectedReleaseReadinessCandidate?.id === "hosted-production-identity"
      ? [
          Object.freeze({
            id: "selected-next-command",
            status: command,
          }),
          Object.freeze({
            id: "selected-proof-target",
            status: selectedReleaseReadinessCandidate.proofTarget,
          }),
          Object.freeze({
            id: "selected-proof-boundary",
            status: selectedReleaseReadinessCandidate.proofBoundary,
          }),
        ]
      : []),
    ...normalizeLocalNextActionSelectedProofGraphCheckRows({
      selectedProofGraphNode,
      selectedProofGraphNodeStatus,
    }),
    ...normalizeLocalNextActionSelectedSpineCheckRows({
      selectedProductionFeatureSpineTarget,
      selectedSpineTarget,
      selectedSpineDrilldown,
    }),
    ...normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows({
      selectedProductionFeatureGraph,
    }),
    ...(terminalBatchGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "terminal-proof-batch-graph",
            status: `${terminalBatchGraph.status}:${terminalBatchGraph.edgeCount} edges`,
          }),
        ]),
    ...(privateChannelRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "private-channel-recovery-graph",
            status: `${privateChannelRecoveryGraph.status}:${privateChannelRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementActionRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-action-recovery-graph",
            status: `${replacementActionRecoveryGraph.status}:${replacementActionRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementHandoffRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-handoff-recovery-graph",
            status: `${replacementHandoffRecoveryGraph.status}:${replacementHandoffRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(replacementPrivateRecoveryGraph.nodeId === ""
      ? []
      : [
          Object.freeze({
            id: "replacement-private-recovery-graph",
            status: `${replacementPrivateRecoveryGraph.status}:${replacementPrivateRecoveryGraph.laneCount} lanes`,
          }),
        ]),
    ...(stability === null
      ? []
      : [
          Object.freeze({
            id: "proof-stability-drift",
            status: `${Number(stability.retryClickCount ?? 0)} retries, ${Number(
              stability.domFallbackCount ?? 0,
            )} DOM fallbacks, ${Number(
              stability.forceFallbackCount ?? 0,
            )} force fallbacks`,
          }),
        ]),
    ...normalizeLocalNextActionSeedProofLaneCoverageCheckRows({
      seedProofLaneCoverage,
    }),
    ...(sequenceDeferral === null
      ? []
      : [
          Object.freeze({
            id: "hosted-identity-sequence-deferral",
            status: `${String(sequenceDeferral.currentSequenceStage ?? "unknown")}:${
              String(sequenceDeferral.deferredUnprovenId ?? "unknown")
            }`,
          }),
        ]),
    ...(localCapabilityConfidence === null
      ? []
      : [
          Object.freeze({
            id: "hosted-identity-local-capability-confidence",
            status: `${String(localCapabilityConfidence.status ?? "unknown")}:${
              Number(localCapabilityConfidence.passedCheckCount ?? 0)
            }/${Number(localCapabilityConfidence.checkCount ?? 0)}`,
          }),
          ...(
            Array.isArray(localCapabilityConfidence.checks)
              ? localCapabilityConfidence.checks
              : []
          ).map((check) =>
            Object.freeze({
              id: `hosted-identity-local-capability-${String(check.id ?? "")}`,
              status: String(check.status ?? "unknown"),
            }),
          ),
        ]),
    Object.freeze({
      id: "selection-trace",
      status: `${selectionTrace.candidateCount} candidates`,
    }),
    ...selectionTrace.candidates.map((candidate) =>
      Object.freeze({
        id: `selection-trace-${candidate.id}`,
        status: candidate.selected
          ? `selected:${candidate.status}`
          : `rank-${candidate.rank}:${candidate.status}`,
      }),
    ),
    ...(releaseReadinessTrace.candidateCount === 0
      ? []
      : [
          Object.freeze({
            id: "release-readiness-selection-trace",
            status: `${releaseReadinessTrace.candidateCount} buildable candidates`,
          }),
          ...releaseReadinessTrace.candidates.map((candidate) =>
            Object.freeze({
              id: `release-readiness-${candidate.id}`,
              status: candidate.selected
                ? `selected:${candidate.status}`
                : `rank-${candidate.rank}:${candidate.status}`,
            }),
          ),
        ]),
    ...normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
      seedProofLaneCoverageTrace,
    }),
    ...normalizeLocalNextActionLocalReadinessDependencyCheckRows({
      localReadinessDependencyTrace,
    }),
    Object.freeze({
      id: "race-coverage-promoted-milestones",
      status: `${raceCoveragePromotedMilestones.passedGroupCount}/${raceCoveragePromotedMilestones.groupCount} groups, ${raceCoveragePromotedMilestones.coveredCellCount}/${raceCoveragePromotedMilestones.requiredCellCount} cells, ${raceCoveragePromotedMilestones.reloadCoveredCellCount}/${raceCoveragePromotedMilestones.cellCount} reloads`,
    }),
    Object.freeze({
      id: "replacement-race-reload-milestone",
      status: `${replacementRaceReloadTrace.coveredCellCount}/${replacementRaceReloadTrace.requiredCellCount} ${replacementRaceReloadTrace.status}`,
    }),
    ...replacementRaceReloadTrace.cells.map((cell) =>
      Object.freeze({
        id: `replacement-race-reload-${cell.id}`,
        status: cell.covered ? `covered:${cell.reloadStatus}` : `gap:${cell.reloadStatus}`,
      }),
    ),
    Object.freeze({
      id: "host-concurrent-race-reload-milestone",
      status: `${hostConcurrentRaceReloadTrace.coveredCellCount}/${hostConcurrentRaceReloadTrace.requiredCellCount} ${hostConcurrentRaceReloadTrace.status}`,
    }),
    ...hostConcurrentRaceReloadTrace.cells.map((cell) =>
      Object.freeze({
        id: `host-concurrent-race-reload-${cell.id}`,
        status: cell.covered ? `covered:${cell.reloadStatus}` : `gap:${cell.reloadStatus}`,
      }),
    ),
    Object.freeze({
      id: "player-concurrent-action-reload-milestone",
      status: `${playerConcurrentActionReloadTrace.coveredCellCount}/${playerConcurrentActionReloadTrace.requiredCellCount} ${playerConcurrentActionReloadTrace.status}`,
    }),
    ...playerConcurrentActionReloadTrace.cells.map((cell) =>
      Object.freeze({
        id: `player-concurrent-action-reload-${cell.id}`,
        status: cell.covered ? `covered:${cell.reloadStatus}` : `gap:${cell.reloadStatus}`,
      }),
    ),
    Object.freeze({
      id: "cohost-deadline-race-reload-milestone",
      status: `${cohostDeadlineRaceReloadTrace.coveredCellCount}/${cohostDeadlineRaceReloadTrace.requiredCellCount} ${cohostDeadlineRaceReloadTrace.status}`,
    }),
    ...cohostDeadlineRaceReloadTrace.cells.map((cell) =>
      Object.freeze({
        id: `cohost-deadline-race-reload-${cell.id}`,
        status: cell.covered ? `covered:${cell.reloadStatus}` : `gap:${cell.reloadStatus}`,
      }),
    ),
    Object.freeze({
      id: "stale-conflict-message-milestone",
      status: `${staleConflictMessageTrace.coveredLaneCount}/${staleConflictMessageTrace.requiredLaneCount} ${staleConflictMessageTrace.status}`,
    }),
    Object.freeze({
      id: "stale-conflict-message-surface-coverage",
      status: `${staleConflictMessageTrace.surfaceCoverage.coveredSurfaceCount}/${staleConflictMessageTrace.surfaceCoverage.requiredSurfaceCount} ${staleConflictMessageTrace.surfaceCoverage.status}`,
    }),
    ...staleConflictMessageTrace.laneIds.map((laneId) =>
      Object.freeze({
        id: `stale-conflict-message-${laneId}`,
        status: staleConflictMessageTrace.status,
      }),
    ),
    ...staleConflictMessageTrace.surfaces.map((surface) =>
      Object.freeze({
        id: surface.checkId,
        status: `${surface.status}:${surface.rejectError}`,
      }),
    ),
    Object.freeze({
      id: "host-stale-control-milestone",
      status: `${hostStaleControlTrace.coveredLaneCount}/${hostStaleControlTrace.requiredLaneCount} ${hostStaleControlTrace.status}`,
    }),
    ...hostStaleControlTrace.laneIds.map((laneId) =>
      Object.freeze({
        id: `host-stale-control-${laneId}`,
        status: hostStaleControlTrace.status,
      }),
    ),
  ];
  const generatedSummary = normalizeLocalNextActionGeneratedSummary(nextAction);
  return Object.freeze({
    id: localAdminAuditIds.nextAction,
    label: "Local next action",
    status:
      command === ""
        ? `${actionStatus}: command missing`
        : `${actionStatus}: ${command}`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local next-action receipt",
    boundaryDetail:
      nextAction.proofBoundary ??
      "Local dev-test-game next-action receipt without hosted, release, or production claims.",
    href: nextActionPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
    checks: Object.freeze(checks),
    relatedLinks: normalizeLocalNextActionRelatedLinks({
      game,
      command,
      actionStatus,
      selectedProofGraphNode,
      selectedProductionFeatureGraph,
      unproven,
      unprovenRoleUrl,
      unprovenProofGraphNodeId,
      localCheck,
      localCheckRoleUrl,
      seedProofLaneCoverage,
      seedProofLaneCoverageRoleUrl,
      sequenceDeferral,
      sequenceDeferralRoleUrl,
    }),
    realHostedEvidenceInputs,
    ...(hostedHandoffChecklist === null ? {} : { hostedHandoffChecklist }),
    artifactSummary: Object.freeze({
      command,
      reason,
      actionStatus,
      sourceManifest: generatedSummary.sourceManifest,
      artifactFreshnessStatus: generatedSummary.artifactFreshnessStatus,
      artifactCount: generatedSummary.artifactCount,
      freshCount: generatedSummary.freshCount,
      staleCount: generatedSummary.staleCount,
      missingCount: generatedSummary.missingCount,
      selectionTrace,
      releaseReadinessChecklist: generatedSummary.releaseReadinessChecklist,
      releaseReadinessStatus: generatedSummary.releaseReadinessStatus,
      unprovenCount: generatedSummary.unprovenCount,
      buildableUnprovenCount: generatedSummary.buildableUnprovenCount,
      localCheckCount: generatedSummary.localCheckCount,
      buildableLocalDependencyCount:
        generatedSummary.buildableLocalDependencyCount,
      selectedLocalCheckId: String(localCheck?.id ?? ""),
      selectedLocalCheckBuildSlice: String(localCheck?.buildSlice ?? ""),
      selectedLocalCheckProofTarget: String(localCheck?.proofTarget ?? ""),
      selectedLocalCheckRoleUrl: localCheckRoleUrl,
      selectedLocalCheckRoleHref:
        localCheckRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(localCheckRoleUrl, { game }),
      selectedSeedProofLaneCoverageSource: String(
        seedProofLaneCoverage?.source ?? "",
      ),
      selectedSeedProofLaneCoverageUnclassifiedCount: Number(
        seedProofLaneCoverage?.unclassifiedLaneCount ?? 0,
      ),
      selectedSeedProofLaneCoverageUnclassifiedLaneIds: Object.freeze(
        Array.isArray(seedProofLaneCoverage?.unclassifiedLaneIds)
          ? seedProofLaneCoverage.unclassifiedLaneIds.map((laneId) =>
              String(laneId),
            )
          : [],
      ),
      selectedSeedProofLaneCoverageBuildSlice: String(
        seedProofLaneCoverage?.buildSlice ?? "",
      ),
      selectedSeedProofLaneCoverageProofTarget: String(
        seedProofLaneCoverage?.proofTarget ?? "",
      ),
      selectedSeedProofLaneCoverageRoleUrl: seedProofLaneCoverageRoleUrl,
      selectedSeedProofLaneCoverageRoleHref:
        seedProofLaneCoverageRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(seedProofLaneCoverageRoleUrl, { game }),
      ...(sequenceDeferral === null
        ? {}
        : {
            sequenceDeferralStatus: String(sequenceDeferral.status ?? ""),
            sequenceDeferralStage: String(
              sequenceDeferral.currentSequenceStage ?? "",
            ),
            sequenceRequiredStage: String(
              sequenceDeferral.requiredSequenceStage ?? "",
            ),
            sequenceDeferredUnprovenId: String(
              sequenceDeferral.deferredUnprovenId ?? "",
            ),
            sequenceDeferredCommand: String(
              sequenceDeferral.deferredCommand ?? "",
            ),
            sequenceDeferredProofTarget: String(
              sequenceDeferral.deferredProofTarget ?? "",
            ),
            sequenceDeferredRoleUrl: sequenceDeferralRoleUrl,
            sequenceDeferredRoleHref:
              sequenceDeferralRoleUrl === ""
                ? ""
                : seededRoleUrlToAdminHref(sequenceDeferralRoleUrl, { game }),
            sequenceNextLocalCommand: String(
              sequenceDeferral.nextLocalCommand ?? "",
            ),
            sequenceNextLocalProofTarget: String(
              sequenceDeferral.nextLocalProofTarget ?? "",
            ),
            sequenceBuildSlice: String(sequenceDeferral.buildSlice ?? ""),
            sequenceRequiredBeforeHostedIdentity: String(
              sequenceDeferral.requiredBeforeHostedIdentity ?? "",
            ),
            sequenceProofBoundary: String(sequenceDeferral.proofBoundary ?? ""),
            sequenceLocalCapabilityConfidenceStatus: String(
              localCapabilityConfidence?.status ?? "",
            ),
            sequenceLocalCapabilityConfidenceSource: String(
              localCapabilityConfidence?.source ?? "",
            ),
            sequenceLocalCapabilityConfidencePassedCheckCount: Number(
              localCapabilityConfidence?.passedCheckCount ?? 0,
            ),
            sequenceLocalCapabilityConfidenceCheckCount: Number(
              localCapabilityConfidence?.checkCount ?? 0,
            ),
            sequenceLocalCapabilityConfidenceRequiredCheckIds: Object.freeze(
              Array.isArray(localCapabilityConfidence?.requiredCheckIds)
                ? localCapabilityConfidence.requiredCheckIds.map((id) =>
                    String(id),
                  )
                : [],
            ),
            sequenceLocalCapabilityConfidenceChecks: Object.freeze(
              Array.isArray(localCapabilityConfidence?.checks)
                ? localCapabilityConfidence.checks.map((check) =>
                    Object.freeze({
                      id: String(check.id ?? ""),
                      label: String(check.label ?? ""),
                      status: String(check.status ?? ""),
                      evidence: String(check.evidence ?? ""),
                      roleUrl: String(check.roleUrl ?? ""),
                      proofBoundary: String(check.proofBoundary ?? ""),
                    }),
                  )
                : [],
            ),
            sequenceLocalCapabilityConfidenceProofBoundary: String(
              localCapabilityConfidence?.proofBoundary ?? "",
            ),
          }),
      selectedUnprovenId: String(unproven?.id ?? ""),
      selectedBuildSlice: String(unproven?.buildSlice ?? ""),
      selectedProofTarget: String(unproven?.proofTarget ?? ""),
      selectedProofBoundary: String(
        selectedReleaseReadinessCandidate?.proofBoundary ?? "",
      ),
      selectedHostedEvidenceMode: String(unproven?.hostedEvidenceMode ?? ""),
      selectedRealHostedEvidenceStatus: String(
        unproven?.realHostedEvidenceStatus ?? "",
      ),
      selectedRealHostedEvidenceCommand: String(
        unproven?.realHostedEvidenceInputs?.command ?? "",
      ),
      selectedRealHostedEvidenceProofTarget: String(
        unproven?.realHostedEvidenceInputs?.proofTarget ?? "",
      ),
      selectedProductionFeatureSpineTarget,
      selectedSpineDrilldown,
      selectedSpineTarget,
      selectedRoleUrl: unprovenRoleUrl,
      selectedRoleHref:
        unprovenRoleUrl === ""
          ? ""
          : seededRoleUrlToAdminHref(unprovenRoleUrl, { game }),
      selectedProofGraphNodeId: unprovenProofGraphNodeId,
      selectedProofGraphNodeStatus: String(
        selectedProofGraphNode?.status ?? "",
      ),
      selectedProofGraphNodeProofCommand: String(
        selectedProofGraphNode?.proofCommand ?? "",
      ),
      selectedProofGraphNodeRoleUrl: String(selectedProofGraphNode?.roleUrl ?? ""),
      selectedProofGraphNodeAuditId: String(selectedProofGraphNode?.auditId ?? ""),
      selectedProofGraphNodeHref:
        selectedProofGraphNode === null
          ? ""
          : adminAuditInspectHref({ game, audit: localAdminAuditIds.proofGraph }),
      ...(terminalBatchGraph.nodeId === ""
        ? {}
        : { terminalProofBatchGraph: terminalBatchGraph }),
      ...(privateChannelRecoveryGraph.nodeId === ""
        ? {}
        : { privateChannelRecoveryGraph }),
      ...(replacementActionRecoveryGraph.nodeId === ""
        ? {}
        : { replacementActionRecoveryGraph }),
      ...(replacementHandoffRecoveryGraph.nodeId === ""
        ? {}
        : { replacementHandoffRecoveryGraph }),
      ...(replacementPrivateRecoveryGraph.nodeId === ""
        ? {}
        : { replacementPrivateRecoveryGraph }),
      stabilitySource: String(stability?.source ?? ""),
      stabilityBuildSlice: String(stability?.buildSlice ?? ""),
      stabilityProofTarget: String(stability?.proofTarget ?? ""),
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
      releaseReady: nextAction.releaseReady === true,
      productionReady: nextAction.productionReady === true,
    }),
  });
}

export function normalizeLocalNextActionRelatedLinks({
  game,
  command = "",
  actionStatus = "unknown",
  selectedProofGraphNode = null,
  selectedProductionFeatureGraph = null,
  unproven = null,
  unprovenRoleUrl = "",
  unprovenProofGraphNodeId = "",
  localCheck = null,
  localCheckRoleUrl = "",
  seedProofLaneCoverage = null,
  seedProofLaneCoverageRoleUrl = "",
  sequenceDeferral = null,
  sequenceDeferralRoleUrl = "",
} = {}) {
  if (
    unprovenRoleUrl === "" &&
    localCheckRoleUrl === "" &&
    seedProofLaneCoverageRoleUrl === "" &&
    sequenceDeferralRoleUrl === "" &&
    selectedProofGraphNode === null &&
    String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
  ) {
    return Object.freeze([]);
  }
  return Object.freeze([
    ...(selectedProofGraphNode === null
      ? []
      : [
          Object.freeze({
            id: "selected-proof-graph-node",
            label: selectedProofGraphNode.id,
            href: adminAuditInspectHref({
              game,
              audit: localAdminAuditIds.proofGraph,
            }),
            status: selectedProofGraphNode.status,
            command: selectedProofGraphNode.proofCommand,
          }),
        ]),
    ...(String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
      ? []
      : [
          Object.freeze({
            id: selectedProductionFeatureGraph.nodeId,
            label: selectedProductionFeatureGraph.nodeId,
            href: adminAuditInspectHref({
              game,
              audit: localAdminAuditIds.proofGraph,
            }),
            status: selectedProductionFeatureGraph.status,
            command: selectedProductionFeatureGraph.browserProofCommand,
          }),
        ]),
    ...(unprovenRoleUrl === ""
      ? []
      : [
          Object.freeze({
            id: unprovenProofGraphNodeId || String(unproven?.id),
            label: String(unproven?.id ?? "Selected role surface"),
            href: seededRoleUrlToAdminHref(unprovenRoleUrl, { game }),
            status: String(unproven?.status ?? actionStatus),
            command,
          }),
        ]),
    ...(localCheckRoleUrl === ""
      ? []
      : [
          Object.freeze({
            id: String(localCheck?.id ?? "local-readiness-dependency"),
            label: String(localCheck?.id ?? "Local readiness dependency"),
            href: seededRoleUrlToAdminHref(localCheckRoleUrl, { game }),
            status: String(localCheck?.status ?? actionStatus),
            command,
          }),
        ]),
    ...(seedProofLaneCoverageRoleUrl === ""
      ? []
      : [
          Object.freeze({
            id: "seed-proof-lane-coverage",
            label: "Seed proof-lane coverage",
            href: seededRoleUrlToAdminHref(seedProofLaneCoverageRoleUrl, { game }),
            status: String(seedProofLaneCoverage?.status ?? actionStatus),
            command,
          }),
        ]),
    ...(sequenceDeferralRoleUrl === ""
      ? []
      : [
          Object.freeze({
            id: String(
              sequenceDeferral?.deferredUnprovenId ??
                "hosted-identity-sequence-deferral",
            ),
            label: "Deferred hosted identity",
            href: seededRoleUrlToAdminHref(sequenceDeferralRoleUrl, { game }),
            status: String(sequenceDeferral?.status ?? actionStatus),
            command: String(sequenceDeferral?.deferredCommand ?? command),
          }),
        ]),
  ]);
}

export function normalizeLocalNextActionSelectedProofGraphCheckRows({
  selectedProofGraphNode = null,
  selectedProofGraphNodeStatus = "",
} = {}) {
  return selectedProofGraphNode === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-proof-graph-node",
          status: selectedProofGraphNodeStatus,
        }),
        Object.freeze({
          id: "selected-proof-graph-destination",
          status: `${selectedProofGraphNode.id}:${
            selectedProofGraphNode.auditId || "unknown"
          }`,
        }),
      ]);
}

export function normalizeLocalNextActionSelectedSpineCheckRows({
  selectedProductionFeatureSpineTarget = null,
  selectedSpineTarget = null,
  selectedSpineDrilldown = null,
} = {}) {
  return String(selectedSpineTarget?.checkpointId ?? "") === ""
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-feature-spine-declaration",
          status: selectedSpineDeclarationStatus(
            selectedProductionFeatureSpineTarget,
          ),
        }),
        Object.freeze({
          id: "selected-spine-target",
          status: selectedSpineTargetStatus(selectedSpineTarget),
        }),
        Object.freeze({
          id: "selected-spine-drilldown",
          status: selectedSpineDrilldownStatus(selectedSpineDrilldown),
        }),
        Object.freeze({
          id: "selected-spine-admin-check",
          status: String(selectedSpineDrilldown?.adminCheckId ?? ""),
        }),
        Object.freeze({
          id: "selected-spine-rerun-command",
          status: String(selectedSpineDrilldown?.rerunCommand ?? ""),
        }),
        Object.freeze({
          id: "selected-spine-browser-proof",
          status: String(selectedSpineTarget?.browserProofCommand ?? ""),
        }),
        ...coverageDecisionCheckRows({
          parentId: "selected-spine",
          rowId: "selected-spine-coverage-decision",
          coverageDecision: selectedSpineTarget?.coverageDecision,
        }),
      ]);
}

export function normalizeLocalNextActionSelectedProductionFeatureGraphCheckRows({
  selectedProductionFeatureGraph = null,
} = {}) {
  const edgeFrom = String(
    selectedProductionFeatureGraph?.edgeFrom ??
      selectedProductionFeatureGraph?.edge?.from ??
      "",
  );
  const edgeTo = String(
    selectedProductionFeatureGraph?.edgeTo ??
      selectedProductionFeatureGraph?.edge?.to ??
      "",
  );
  return String(selectedProductionFeatureGraph?.nodeId ?? "") === ""
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "selected-production-feature-graph-node",
          status: `${selectedProductionFeatureGraph.nodeId}:${selectedProductionFeatureGraph.status}`,
        }),
        Object.freeze({
          id: "selected-production-feature-graph-edge",
          status: `${edgeFrom}->${edgeTo}`,
        }),
        ...coverageDecisionCheckRows({
          parentId: "selected-production-feature-graph",
          rowId: "selected-production-feature-graph-coverage-decision",
          coverageDecision: selectedProductionFeatureGraph.coverageDecision,
        }),
      ]);
}

export function normalizeLocalNextActionSeedProofLaneCoverageCheckRows({
  seedProofLaneCoverage = null,
} = {}) {
  return seedProofLaneCoverage === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "seed-proof-lane-coverage",
          status: `${Number(
            seedProofLaneCoverage.unclassifiedLaneCount ?? 0,
          )} unclassified lanes`,
        }),
      ]);
}

export function normalizeLocalNextActionSeedProofLaneCoverageTraceCheckRows({
  seedProofLaneCoverageTrace = null,
} = {}) {
  return seedProofLaneCoverageTrace?.status === "unavailable" ||
    seedProofLaneCoverageTrace === null
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "seed-proof-lane-coverage-trace",
          status: `${Number(
            seedProofLaneCoverageTrace.unclassifiedLaneCount ?? 0,
          )} unclassified lanes`,
        }),
        ...(Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
          ? seedProofLaneCoverageTrace.unclassifiedLaneIds
          : []
        ).map((laneId) =>
          Object.freeze({
            id: `seed-proof-lane-coverage-${String(laneId)}`,
            status: "unclassified",
          }),
        ),
      ]);
}

export function normalizeLocalNextActionLocalReadinessDependencyCheckRows({
  localReadinessDependencyTrace = null,
} = {}) {
  return Number(localReadinessDependencyTrace?.candidateCount ?? 0) === 0
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: "local-readiness-dependency-trace",
          status: `${Number(
            localReadinessDependencyTrace.candidateCount ?? 0,
          )} missing local dependencies`,
        }),
        ...(Array.isArray(localReadinessDependencyTrace.candidates)
          ? localReadinessDependencyTrace.candidates
          : []
        ).map((candidate) =>
          Object.freeze({
            id: `local-readiness-dependency-${candidate.id}`,
            status: candidate.selected
              ? `selected:${candidate.status}`
              : `rank-${candidate.rank}:${candidate.status}`,
          }),
        ),
      ]);
}

export function normalizeLocalNextActionGeneratedSummary(nextAction) {
  const freshnessSummary =
    nextAction?.generatedFrom?.artifactFreshnessSummary ?? {};
  const releaseReadinessSummary =
    nextAction?.generatedFrom?.releaseReadinessSummary ?? {};
  return Object.freeze({
    sourceManifest: String(nextAction?.generatedFrom?.spineManifest ?? ""),
    artifactFreshnessStatus: String(
      nextAction?.generatedFrom?.artifactFreshnessStatus ?? "unknown",
    ),
    artifactCount: Number(freshnessSummary.artifactCount ?? 0),
    freshCount: Number(freshnessSummary.freshCount ?? 0),
    staleCount: Number(freshnessSummary.staleCount ?? 0),
    missingCount: Number(freshnessSummary.missingCount ?? 0),
    releaseReadinessChecklist: String(
      nextAction?.generatedFrom?.releaseReadinessChecklist ?? "",
    ),
    releaseReadinessStatus: String(releaseReadinessSummary.status ?? "unknown"),
    unprovenCount: Number(releaseReadinessSummary.unprovenCount ?? 0),
    buildableUnprovenCount: Number(
      releaseReadinessSummary.buildableUnprovenCount ?? 0,
    ),
    localCheckCount: Number(releaseReadinessSummary.localCheckCount ?? 0),
    buildableLocalDependencyCount: Number(
      releaseReadinessSummary.buildableLocalDependencyCount ?? 0,
    ),
  });
}

function normalizeNextActionTerminalBatchGraph(terminalBatchGraph) {
  if (terminalBatchGraph === null || typeof terminalBatchGraph !== "object") {
    return Object.freeze({
      nodeId: "",
      status: "",
      proofTarget: "",
      roleUrl: "",
      batchCount: 0,
      edgeCount: 0,
      edgeTargets: Object.freeze([]),
      receiptArtifacts: Object.freeze([]),
    });
  }
  return Object.freeze({
    nodeId: String(terminalBatchGraph.nodeId ?? ""),
    status: String(terminalBatchGraph.status ?? ""),
    proofTarget: String(terminalBatchGraph.proofTarget ?? ""),
    roleUrl: String(terminalBatchGraph.roleUrl ?? ""),
    batchCount: Number(terminalBatchGraph.batchCount ?? 0),
    edgeCount: Number(terminalBatchGraph.edgeCount ?? 0),
    edgeTargets: Object.freeze(
      Array.isArray(terminalBatchGraph.edgeTargets)
        ? terminalBatchGraph.edgeTargets.map((target) => String(target))
        : [],
    ),
    receiptArtifacts: Object.freeze(
      Array.isArray(terminalBatchGraph.receiptArtifacts)
        ? terminalBatchGraph.receiptArtifacts.map((artifact) =>
            Object.freeze({
              proofId: String(artifact?.proofId ?? ""),
              artifactPath: String(artifact?.artifactPath ?? ""),
              batchLabel: String(artifact?.batchLabel ?? ""),
            }),
          )
        : [],
    ),
  });
}

function normalizeNextActionRecoveryReceiptGraph(recoveryReceiptGraph) {
  if (
    recoveryReceiptGraph === null ||
    typeof recoveryReceiptGraph !== "object"
  ) {
    return Object.freeze({
      nodeId: "",
      status: "",
      proofTarget: "",
      roleUrl: "",
      familyId: "",
      laneCount: 0,
      laneIds: Object.freeze([]),
      edgeCount: 0,
      edgeTargets: Object.freeze([]),
    });
  }
  const normalizedEvidenceObjects = normalizeNormalizedEvidenceObjects(
    recoveryReceiptGraph.normalizedEvidenceObjects,
  );
  return Object.freeze({
    nodeId: String(recoveryReceiptGraph.nodeId ?? ""),
    status: String(recoveryReceiptGraph.status ?? ""),
    proofTarget: String(recoveryReceiptGraph.proofTarget ?? ""),
    roleUrl: String(recoveryReceiptGraph.roleUrl ?? ""),
    familyId: String(recoveryReceiptGraph.familyId ?? ""),
    laneCount: Number(recoveryReceiptGraph.laneCount ?? 0),
    laneIds: Object.freeze(
      Array.isArray(recoveryReceiptGraph.laneIds)
        ? recoveryReceiptGraph.laneIds.map((laneId) => String(laneId))
        : [],
    ),
    edgeCount: Number(recoveryReceiptGraph.edgeCount ?? 0),
    edgeTargets: Object.freeze(
      Array.isArray(recoveryReceiptGraph.edgeTargets)
        ? recoveryReceiptGraph.edgeTargets.map((target) =>
            String(target),
          )
        : [],
    ),
    ...(normalizedEvidenceObjects.length === 0
      ? {}
      : { normalizedEvidenceObjects }),
  });
}

function normalizeNextActionHostedHandoffChecklist({
  unproven,
  realHostedEvidenceInputs,
}) {
  const checklist = unproven?.hostedHandoffChecklist;
  if (checklist === null || typeof checklist !== "object") {
    return null;
  }
  const blockedChecks = Array.isArray(checklist.blockedChecks)
    ? checklist.blockedChecks
    : [];
  const checklistInputs =
    realHostedEvidenceInputs.length > 0
      ? realHostedEvidenceInputs
      : Array.isArray(checklist.inputIds)
        ? checklist.inputIds.map((id) =>
            Object.freeze({
              id: String(id ?? ""),
              label: String(id ?? ""),
              value: "required",
              required: true,
            }),
          )
        : [];
  return Object.freeze({
    status: String(checklist.status ?? "unknown"),
    preflightStatus: String(checklist.preflightStatus ?? "unknown"),
    command: String(checklist.command ?? ""),
    proofTarget: String(checklist.proofTarget ?? ""),
    inputCount: checklistInputs.length,
    blockedCheckCount: blockedChecks.length,
    inputs: Object.freeze(
      checklistInputs.map((input) =>
        Object.freeze({
          id: input.id,
          label: input.label,
          value:
            input.id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"
              ? String(checklist.placeholderFixturePath ?? input.value)
              : input.value,
          required: input.required,
        }),
      ),
    ),
    blockedChecks: Object.freeze(
      blockedChecks.map((check) =>
        Object.freeze({
          id: String(check.id ?? ""),
          status: String(check.status ?? "unknown"),
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
    blockedReceipt: normalizeHostedHandoffBlockedReceipt(checklist.blockedReceipt),
    groups: normalizeHostedHandoffGroups(checklist.requirementGroups),
    inputSections: normalizeHostedHandoffInputSections(checklist.inputSections),
    operatorEvidenceGate: normalizeHostedIdentityOperatorEvidenceGate(
      checklist.operatorEvidenceGate,
    ),
    operatorProofDrilldowns: normalizeHostedHandoffOperatorProofDrilldowns(
      checklist.operatorProofDrilldowns,
    ),
    progressionSummary: normalizeHostedHandoffProgressionSummary(
      checklist.progressionSummary,
    ),
  });
}

function normalizeHostedIdentityOperatorEvidenceGate(gate) {
  if (gate === null || typeof gate !== "object") {
    return null;
  }
  const families = Array.isArray(gate.requiredEvidenceFamilies)
    ? gate.requiredEvidenceFamilies
    : [];
  return Object.freeze({
    id: String(gate.id ?? ""),
    status: String(gate.status ?? "unknown"),
    evidencePathEnv: String(gate.evidencePathEnv ?? ""),
    requiredRawEvidencePathKind: String(gate.requiredRawEvidencePathKind ?? ""),
    rejectedRawEvidencePathKinds: Object.freeze(
      (Array.isArray(gate.rejectedRawEvidencePathKinds)
        ? gate.rejectedRawEvidencePathKinds
        : []
      ).map((kind) => String(kind)),
    ),
    command: String(gate.command ?? ""),
    proofTarget: String(gate.proofTarget ?? ""),
    roleUrl: String(gate.roleUrl ?? ""),
    localCapabilityAuditId: String(gate.localCapabilityAuditId ?? ""),
    localCapabilityRoleUrl: String(gate.localCapabilityRoleUrl ?? ""),
    requiredEvidenceFamilies: Object.freeze(
      families.map((family) =>
        Object.freeze({
          id: String(family?.id ?? ""),
          field: String(family?.field ?? ""),
          checkId: String(family?.checkId ?? ""),
          requiredInputIds: Object.freeze(
            (Array.isArray(family?.requiredInputIds)
              ? family.requiredInputIds
              : []
            ).map((inputId) => String(inputId)),
          ),
        }),
      ),
    ),
    providerBoundary: normalizeHostedIdentityProviderBoundary(
      gate.providerBoundary,
    ),
    proofBoundary: String(gate.proofBoundary ?? ""),
  });
}

function normalizeHostedIdentityProviderBoundary(boundary) {
  if (
    boundary === null ||
    typeof boundary !== "object" ||
    boundary.version !== 1 ||
    !Array.isArray(boundary.providers)
  ) {
    return null;
  }
  return Object.freeze({
    id: String(boundary.id ?? ""),
    status: String(boundary.status ?? "unknown"),
    architectureId: String(boundary.architectureId ?? ""),
    roleSurfaceArchitectureChanged:
      boundary.roleSurfaceArchitectureChanged === true,
    providerCount: boundary.providers.length,
    proofBoundary: String(boundary.proofBoundary ?? ""),
    providers: Object.freeze(
      boundary.providers.map((provider) =>
        Object.freeze({
          id: String(provider?.id ?? ""),
          label: String(provider?.label ?? ""),
          mode: String(provider?.mode ?? ""),
          status: String(provider?.status ?? "unknown"),
          accountCredential: String(provider?.accountCredential ?? ""),
          inviteCredential: String(provider?.inviteCredential ?? ""),
          sessionCredential: String(provider?.sessionCredential ?? ""),
          loginBoundary: String(provider?.loginBoundary ?? ""),
          sessionBoundary: String(provider?.sessionBoundary ?? ""),
          sessionGrantBoundary: String(provider?.sessionGrantBoundary ?? ""),
          browserCookieName: String(provider?.browserCookieName ?? ""),
          rawCredentialPolicy: String(provider?.rawCredentialPolicy ?? ""),
          roleSurfaceArchitectureChanged:
            provider?.roleSurfaceArchitectureChanged === true,
          requiredEvidence: String(provider?.requiredEvidence ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedHandoffProgressionSummary(summary) {
  if (summary === null || typeof summary !== "object") {
    return null;
  }
  const progressions = Array.isArray(summary.progressions)
    ? summary.progressions
    : [];
  return Object.freeze({
    status: String(summary.status ?? "unknown"),
    command: String(summary.command ?? ""),
    proofTarget: String(summary.proofTarget ?? ""),
    roleUrl: String(summary.roleUrl ?? ""),
    progressionCount: Number(summary.progressionCount ?? progressions.length),
    progressionIds: Object.freeze(
      (Array.isArray(summary.progressionIds)
        ? summary.progressionIds
        : progressions.map((progression) => progression.id)
      ).map((id) => String(id ?? "")),
    ),
    progressionProofTargets: Object.freeze(
      (Array.isArray(summary.progressionProofTargets)
        ? summary.progressionProofTargets
        : progressions.map((progression) => progression.adminProofTarget)
      ).map((target) => String(target ?? "")),
    ),
    progressions: Object.freeze(
      progressions.map((progression) =>
        Object.freeze({
          id: String(progression?.id ?? ""),
          checkId: String(progression?.checkId ?? ""),
          missingInputId: String(progression?.missingInputId ?? ""),
          adminProofMode: String(progression?.adminProofMode ?? ""),
          adminProofFixturePath: String(
            progression?.adminProofFixturePath ?? "",
          ),
          proofCommand: String(progression?.proofCommand ?? ""),
          evidencePath: String(progression?.evidencePath ?? ""),
          adminProofTarget: String(progression?.adminProofTarget ?? ""),
          roleUrl: String(progression?.roleUrl ?? ""),
          firstMissingInputId: String(progression?.firstMissingInputId ?? ""),
          firstMissingCheckId: String(progression?.firstMissingCheckId ?? ""),
          proofBoundary: String(progression?.proofBoundary ?? ""),
        }),
      ),
    ),
    proofBoundary: String(summary.proofBoundary ?? ""),
  });
}

function normalizeHostedHandoffOperatorProofDrilldowns(drilldowns) {
  return Object.freeze(
    (Array.isArray(drilldowns) ? drilldowns : []).map((drilldown) =>
      Object.freeze({
        id: String(drilldown?.id ?? ""),
        label: String(drilldown?.label ?? ""),
        command: String(drilldown?.command ?? ""),
        progressionId: String(drilldown?.progressionId ?? ""),
        sourcePath: String(drilldown?.sourcePath ?? ""),
        proofTarget: String(drilldown?.proofTarget ?? ""),
        roleUrl: String(drilldown?.roleUrl ?? ""),
        firstMissingInputId: String(drilldown?.firstMissingInputId ?? ""),
        firstMissingCheckId: String(drilldown?.firstMissingCheckId ?? ""),
        proofBoundary: String(drilldown?.proofBoundary ?? ""),
      }),
    ),
  );
}

function normalizeHostedHandoffBlockedReceipt(receipt) {
  if (receipt === null || typeof receipt !== "object") {
    return null;
  }
  const requiredInputs = Array.isArray(receipt.requiredInputs)
    ? receipt.requiredInputs
    : [];
  return Object.freeze({
    status: String(receipt.status ?? "unknown"),
    command: String(receipt.command ?? ""),
    proofTarget: String(receipt.proofTarget ?? ""),
    nextProofTarget: String(receipt.nextProofTarget ?? ""),
    operatorAction: String(receipt.operatorAction ?? ""),
    localVsHostedBoundary: String(receipt.localVsHostedBoundary ?? ""),
    missingRequiredInputs: Object.freeze(
      (Array.isArray(receipt.missingRequiredInputs)
        ? receipt.missingRequiredInputs
        : []
      ).map((input) => String(input)),
    ),
    ...(receipt.firstMissingOperatorArtifact === null ||
    typeof receipt.firstMissingOperatorArtifact !== "object"
      ? {}
      : {
          firstMissingOperatorArtifact:
            normalizeHostedHandoffFirstMissingOperatorArtifact(
              receipt.firstMissingOperatorArtifact,
            ),
        }),
    requiredInputs: Object.freeze(
      requiredInputs.map((input) =>
        Object.freeze({
          name: String(input?.name ?? ""),
          value: input?.value === null ? "" : String(input?.value ?? ""),
          required: input?.required === true,
          purpose: String(input?.purpose ?? ""),
        }),
      ),
    ),
  });
}

function normalizeHostedHandoffFirstMissingOperatorArtifact(artifact) {
  const drilldown =
    artifact.roleSurfaceDrilldown !== null &&
    typeof artifact.roleSurfaceDrilldown === "object"
      ? artifact.roleSurfaceDrilldown
      : {};
  return Object.freeze({
    inputId: String(artifact.inputId ?? ""),
    checkId: String(artifact.checkId ?? ""),
    sectionId: String(artifact.sectionId ?? ""),
    sectionLabel: String(artifact.sectionLabel ?? ""),
    requiredEvidence: String(artifact.requiredEvidence ?? ""),
    purpose: String(artifact.purpose ?? ""),
    proofTarget: String(artifact.proofTarget ?? ""),
    roleSurfaceDrilldown: Object.freeze({
      localCapabilityAuditId: String(drilldown.localCapabilityAuditId ?? ""),
      localCapabilityRoleUrl: String(drilldown.localCapabilityRoleUrl ?? ""),
      handoffAuditId: String(drilldown.handoffAuditId ?? ""),
      handoffRoleUrl: String(drilldown.handoffRoleUrl ?? ""),
      proofGraphNodeId: String(drilldown.proofGraphNodeId ?? ""),
      productionFeatureGraphNodeId: String(
        drilldown.productionFeatureGraphNodeId ?? "",
      ),
      proofGraphEvidencePath: String(drilldown.proofGraphEvidencePath ?? ""),
    }),
  });
}

function hostedIdentityHandoffInputValue({ id, hostedIdentityEvidence }) {
  return id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"
    ? String(
        hostedIdentityEvidence.target?.rawEvidencePath ??
          hostedIdentityEvidence.hostedHandoffChecklist?.placeholderFixturePath ??
          hostedIdentityEvidence.target?.placeholderFixturePath ??
          "required",
      )
    : "required";
}

function realHostedObservabilityHandoffInputValue({
  id,
  realHostedObservabilityHandoff,
}) {
  if (id === "command") {
    return String(
      realHostedObservabilityHandoff.hostedHandoffChecklist?.command ??
        realHostedObservabilityHandoff.nextCommand ??
        `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    );
  }
  if (id === "proof-target") {
    return String(
      realHostedObservabilityHandoff.hostedHandoffChecklist?.proofTarget ??
        realHostedObservabilityHandoff.nextProofTarget ??
        devTestGameRealHostedObservabilityHandoffPath,
    );
  }
  if (id === realHostedObservabilityEvidenceEnv) {
    return String(
      realHostedObservabilityHandoff.target?.rawEvidencePath ??
        "externally reachable hosted logs/metrics/traces/paging/SLO/incident-response evidence JSON",
    );
  }
  if (id === realHostedObservabilityBaselineEnv) {
    return String(
      realHostedObservabilityHandoff.target?.localHostedOpsSignalsPath ??
        devTestGameHostedOpsSignalsPath,
    );
  }
  return "required";
}

function normalizeHostedIdentityRedactedIntakePacket(packet) {
  if (packet === null || typeof packet !== "object") {
    return null;
  }
  return Object.freeze({
    kind: String(packet.kind ?? ""),
    status: String(packet.status ?? "unknown"),
    sectionCount: Number.isInteger(packet.sectionCount)
      ? packet.sectionCount
      : 0,
    providedSectionCount: Number.isInteger(packet.providedSectionCount)
      ? packet.providedSectionCount
      : 0,
    missingSectionCount: Number.isInteger(packet.missingSectionCount)
      ? packet.missingSectionCount
      : 0,
    requiredInputCount: Number.isInteger(packet.requiredInputCount)
      ? packet.requiredInputCount
      : 0,
    providedInputCount: Number.isInteger(packet.providedInputCount)
      ? packet.providedInputCount
      : 0,
    missingInputCount: Number.isInteger(packet.missingInputCount)
      ? packet.missingInputCount
      : 0,
    redactedEvidenceRefCount: Number.isInteger(packet.redactedEvidenceRefCount)
      ? packet.redactedEvidenceRefCount
      : 0,
    rawInviteTokensIncluded: packet.rawInviteTokensIncluded === true,
    rawSessionSecretsIncluded: packet.rawSessionSecretsIncluded === true,
    rawPasswordHashesIncluded: packet.rawPasswordHashesIncluded === true,
    rawPersonalContactIncluded: packet.rawPersonalContactIncluded === true,
    roleSurfaceArchitectureChanged:
      packet.roleSurfaceArchitectureChanged === true,
    sections: Object.freeze(
      (Array.isArray(packet.sections) ? packet.sections : []).map((section) =>
        Object.freeze({
          id: String(section.id ?? ""),
          checkId: String(section.checkId ?? ""),
          label: String(section.label ?? section.id ?? ""),
          status: String(section.status ?? "unknown"),
          requiredInputIds: Object.freeze(
            (Array.isArray(section.requiredInputIds)
              ? section.requiredInputIds
              : []
            ).map((id) => String(id)),
          ),
          providedInputIds: Object.freeze(
            (Array.isArray(section.providedInputIds)
              ? section.providedInputIds
              : []
            ).map((id) => String(id)),
          ),
          redactedEvidenceRefCount: Number.isInteger(
            section.redactedEvidenceRefCount,
          )
            ? section.redactedEvidenceRefCount
            : 0,
          redactedEvidenceRefs: Object.freeze(
            (Array.isArray(section.redactedEvidenceRefs)
              ? section.redactedEvidenceRefs
              : []
            ).map((ref) =>
              Object.freeze({
                id: String(ref.id ?? ""),
                kind: String(ref.kind ?? ""),
                evidenceFamily: String(ref.evidenceFamily ?? ""),
                capturedAt: String(ref.capturedAt ?? ""),
                retentionWindow: String(ref.retentionWindow ?? ""),
                locator: String(ref.locator ?? ""),
                exportLocator: String(ref.exportLocator ?? ""),
                redacted: ref.redacted === true,
              }),
            ),
          ),
          missingInputs: Object.freeze(
            (Array.isArray(section.missingInputs) ? section.missingInputs : []).map(
              (id) => String(id),
            ),
          ),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityRoleSurfaceContractDiff(diff) {
  if (diff === null || typeof diff !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(diff.status ?? "unknown"),
    architectureId: String(diff.architectureId ?? ""),
    mismatchCount: Array.isArray(diff.mismatches) ? diff.mismatches.length : 0,
    mismatches: Object.freeze(
      (Array.isArray(diff.mismatches) ? diff.mismatches : []).map((mismatch) =>
        Object.freeze({
          id: String(mismatch.id ?? ""),
          path: String(mismatch.path ?? ""),
          expected: stringifyAuditValue(mismatch.expected),
          actual: stringifyAuditValue(mismatch.actual),
        }),
      ),
    ),
  });
}

function normalizeHostedIdentityAdapterContractComparison(comparison) {
  if (comparison === null || typeof comparison !== "object") {
    return null;
  }
  return Object.freeze({
    status: String(comparison.status ?? "unknown"),
    localAdapterId: String(comparison.localAdapterId ?? ""),
    hostedAdapterId: String(comparison.hostedAdapterId ?? ""),
    localStatus: String(comparison.localStatus ?? "unknown"),
    hostedStatus: String(comparison.hostedStatus ?? "unknown"),
    roleSurfaceContractStatus: String(
      comparison.roleSurfaceContractStatus ?? "unknown",
    ),
    mismatchCount: Array.isArray(comparison.mismatches)
      ? comparison.mismatches.length
      : 0,
    mismatches: Object.freeze(
      (Array.isArray(comparison.mismatches) ? comparison.mismatches : []).map(
        (mismatch) =>
          Object.freeze({
            id: String(mismatch.id ?? ""),
            path: String(mismatch.path ?? ""),
            expected: stringifyAuditValue(mismatch.expected),
            actual: stringifyAuditValue(mismatch.actual),
          }),
      ),
    ),
  });
}

function stringifyAuditValue(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  return JSON.stringify(value);
}

function normalizeHostedHandoffGroups(groups) {
  return Object.freeze(
    (Array.isArray(groups) ? groups : []).map((group) =>
      Object.freeze({
        id: String(group.id ?? ""),
        label: String(group.label ?? group.id ?? ""),
        status: String(group.status ?? "unknown"),
        requiredEvidence: String(group.requiredEvidence ?? ""),
        checkIds: Object.freeze(
          (Array.isArray(group.checkIds) ? group.checkIds : []).map((id) =>
            String(id),
          ),
        ),
        blockedCheckIds: Object.freeze(
          (Array.isArray(group.blockedCheckIds)
            ? group.blockedCheckIds
            : []
          ).map((id) => String(id)),
        ),
      }),
    ),
  );
}

function normalizeHostedHandoffInputSections(sections) {
  return Object.freeze(
    (Array.isArray(sections) ? sections : []).map((section) =>
      Object.freeze({
        id: String(section.id ?? ""),
        label: String(section.label ?? section.id ?? ""),
        status: String(section.status ?? "unknown"),
        requiredInputIds: Object.freeze(
          (Array.isArray(section.requiredInputIds)
            ? section.requiredInputIds
            : []
          ).map((id) => String(id)),
        ),
        providedInputIds: Object.freeze(
          (Array.isArray(section.providedInputIds)
            ? section.providedInputIds
            : []
          ).map((id) => String(id)),
        ),
        missingInputs: Object.freeze(
          (Array.isArray(section.missingInputs) ? section.missingInputs : []).map(
            (id) => String(id),
          ),
        ),
      }),
    ),
  );
}

function normalizeNextActionStabilityTrace(stabilityTrace) {
  if (
    stabilityTrace === null ||
    typeof stabilityTrace !== "object" ||
    stabilityTrace.strategy !== "proof-stability-before-readiness"
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      selected: false,
      hostConfirmClicks: 0,
      retryClickCount: 0,
      domFallbackCount: 0,
      forceFallbackCount: 0,
      failureCount: 0,
      maxAttempts: 0,
      eventCount: 0,
    });
  }
  return Object.freeze({
    strategy: stabilityTrace.strategy,
    status: String(stabilityTrace.status ?? "unknown"),
    selected: stabilityTrace.selected === true,
    hostConfirmClicks: Number(stabilityTrace.hostConfirmClicks ?? 0),
    retryClickCount: Number(stabilityTrace.retryClickCount ?? 0),
    domFallbackCount: Number(stabilityTrace.domFallbackCount ?? 0),
    forceFallbackCount: Number(stabilityTrace.forceFallbackCount ?? 0),
    failureCount: Number(stabilityTrace.failureCount ?? 0),
    maxAttempts: Number(stabilityTrace.maxAttempts ?? 0),
    eventCount: Number(stabilityTrace.eventCount ?? 0),
  });
}

function normalizeNextActionSeedProofLaneCoverageTrace(seedProofLaneCoverageTrace) {
  if (
    seedProofLaneCoverageTrace === null ||
    typeof seedProofLaneCoverageTrace !== "object" ||
    seedProofLaneCoverageTrace.strategy !==
      "seed-proof-lane-coverage-before-readiness" ||
    !Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unavailable",
      source: "",
      checkId: null,
      selected: false,
      passedLaneCount: 0,
      directSeededLaneCount: 0,
      aliasOnlyLaneCount: 0,
      aggregateOnlyLaneCount: 0,
      unclassifiedLaneCount: 0,
      unclassifiedLaneIds: Object.freeze([]),
    });
  }
  return Object.freeze({
    strategy: seedProofLaneCoverageTrace.strategy,
    status: String(seedProofLaneCoverageTrace.status ?? "unknown"),
    source: String(seedProofLaneCoverageTrace.source ?? ""),
    checkId:
      typeof seedProofLaneCoverageTrace.checkId === "string"
        ? seedProofLaneCoverageTrace.checkId
        : null,
    selected: seedProofLaneCoverageTrace.selected === true,
    passedLaneCount: Number(seedProofLaneCoverageTrace.passedLaneCount ?? 0),
    directSeededLaneCount: Number(
      seedProofLaneCoverageTrace.directSeededLaneCount ?? 0,
    ),
    aliasOnlyLaneCount: Number(
      seedProofLaneCoverageTrace.aliasOnlyLaneCount ?? 0,
    ),
    aggregateOnlyLaneCount: Number(
      seedProofLaneCoverageTrace.aggregateOnlyLaneCount ?? 0,
    ),
    unclassifiedLaneCount: Number(
      seedProofLaneCoverageTrace.unclassifiedLaneCount ?? 0,
    ),
    unclassifiedLaneIds: Object.freeze(
      seedProofLaneCoverageTrace.unclassifiedLaneIds.map((laneId) =>
        String(laneId),
      ),
    ),
  });
}

function seededRoleUrlToAdminHref(roleUrl, { game }) {
  return String(roleUrl).replace("<seeded-game>", encodeURIComponent(game));
}

function normalizeNextActionSelectionTrace(selectionTrace) {
  if (
    selectionTrace === null ||
    typeof selectionTrace !== "object" ||
    selectionTrace.strategy !== "development-spine-priority" ||
    !Array.isArray(selectionTrace.candidates)
  ) {
    return Object.freeze({
      strategy: "unknown",
      candidateCount: 0,
      selectedArtifactId: null,
      candidates: Object.freeze([]),
    });
  }
  const candidates = selectionTrace.candidates
    .filter((candidate) => candidate !== null && typeof candidate === "object")
    .map((candidate) =>
      Object.freeze({
        rank: Number(candidate.rank ?? 0),
        id: String(candidate.id ?? "unknown"),
        label: String(candidate.label ?? ""),
        path: String(candidate.path ?? ""),
        status: String(candidate.status ?? "unknown"),
        priority: Number(candidate.priority ?? 0),
        selected: candidate.selected === true,
        refreshCommand: String(candidate.refreshCommand ?? ""),
        refreshSource: String(candidate.refreshSource ?? "unknown"),
      }),
    );
  return Object.freeze({
    strategy: selectionTrace.strategy,
    candidateCount: Number(selectionTrace.candidateCount ?? candidates.length),
    selectedArtifactId:
      typeof selectionTrace.selectedArtifactId === "string"
        ? selectionTrace.selectedArtifactId
        : null,
    candidates: Object.freeze(candidates),
  });
}

function normalizeNextActionReleaseReadinessTrace(releaseReadinessTrace) {
  if (
    releaseReadinessTrace === null ||
    typeof releaseReadinessTrace !== "object" ||
    releaseReadinessTrace.strategy !== "local-dev-release-readiness-priority" ||
    !Array.isArray(releaseReadinessTrace.candidates)
  ) {
    return Object.freeze({
      strategy: "unknown",
      candidateCount: 0,
      selectedUnprovenId: null,
      candidates: Object.freeze([]),
    });
  }
  const candidates = releaseReadinessTrace.candidates
    .filter((candidate) => candidate !== null && typeof candidate === "object")
    .map((candidate) =>
      Object.freeze({
        rank: Number(candidate.rank ?? 0),
        id: String(candidate.id ?? "unknown"),
        status: String(candidate.status ?? "unknown"),
        priority: Number(candidate.priority ?? 0),
        selected: candidate.selected === true,
        command: String(candidate.command ?? ""),
        buildSlice: String(candidate.buildSlice ?? ""),
        proofTarget: String(candidate.proofTarget ?? ""),
        proofBoundary: String(candidate.proofBoundary ?? ""),
        roleUrl: String(candidate.roleUrl ?? ""),
        proofGraphNodeId: String(candidate.proofGraphNodeId ?? ""),
        productionFeatureSpineTarget: normalizeNextActionFeatureSpineDeclaration(
          candidate.productionFeatureSpineTarget,
        ),
        spineDrilldown: normalizeNextActionSpineDrilldown(
          candidate.spineDrilldown,
        ),
        spineTarget: normalizeNextActionSpineTarget(candidate.spineTarget),
        selectedProductionFeatureGraph:
          normalizeNextActionProductionFeatureGraph(
            candidate.selectedProductionFeatureGraph,
          ),
        ...(candidate.hostedEvidenceMode === undefined
          ? {}
          : { hostedEvidenceMode: String(candidate.hostedEvidenceMode) }),
        ...(candidate.realHostedEvidenceStatus === undefined
          ? {}
          : {
              realHostedEvidenceStatus: String(
                candidate.realHostedEvidenceStatus,
              ),
            }),
        ...(candidate.realHostedEvidenceInputs === undefined
          ? {}
          : {
              realHostedEvidenceInputs: normalizeRealHostedEvidenceInputs(
                candidate.realHostedEvidenceInputs,
              ),
            }),
      }),
    );
  return Object.freeze({
    strategy: releaseReadinessTrace.strategy,
    candidateCount: Number(releaseReadinessTrace.candidateCount ?? candidates.length),
    selectedUnprovenId:
      typeof releaseReadinessTrace.selectedUnprovenId === "string"
        ? releaseReadinessTrace.selectedUnprovenId
        : null,
    candidates: Object.freeze(candidates),
  });
}

function normalizeNextActionSpineTarget(spineTarget) {
  if (spineTarget === null || typeof spineTarget !== "object") {
    return Object.freeze({
      sourceCheckId: "",
      featureSlotId: "",
      detailRoleUrl: "",
      cycleId: "",
      roleUrlId: "",
      roleUrl: "",
      rowKind: "",
      checkpointId: "",
      recoveryHookId: "",
      adminCheckId: "",
      browserProofCommand: "",
      coverageDecision: null,
    });
  }
  return Object.freeze({
    sourceCheckId: String(spineTarget.sourceCheckId ?? ""),
    featureSlotId: String(spineTarget.featureSlotId ?? ""),
    detailRoleUrl: String(spineTarget.detailRoleUrl ?? ""),
    cycleId: String(spineTarget.cycleId ?? ""),
    roleUrlId: String(spineTarget.roleUrlId ?? ""),
    roleUrl: String(spineTarget.roleUrl ?? ""),
    rowKind: normalizeSpineRowKind(spineTarget),
    checkpointId: String(spineTarget.checkpointId ?? ""),
    recoveryHookId: String(spineTarget.recoveryHookId ?? ""),
    adminCheckId: String(spineTarget.adminCheckId ?? ""),
    browserProofCommand: String(spineTarget.browserProofCommand ?? ""),
    coverageDecision: normalizeCoverageDecision(spineTarget.coverageDecision),
  });
}

function normalizeNextActionFeatureSpineDeclaration(declaration) {
  if (declaration === null || typeof declaration !== "object") {
    return Object.freeze({
      sourceCheckId: "",
      featureSlotId: "",
      cycleId: "",
      roleUrlId: "",
      rowKind: "",
      checkpointId: "",
      recoveryHookId: "",
      adminCheckId: "",
    });
  }
  return Object.freeze({
    sourceCheckId: String(declaration.sourceCheckId ?? ""),
    featureSlotId: String(declaration.featureSlotId ?? ""),
    cycleId: String(declaration.cycleId ?? ""),
    roleUrlId: String(declaration.roleUrlId ?? ""),
    rowKind: normalizeSpineRowKind(declaration),
    checkpointId: String(declaration.checkpointId ?? ""),
    recoveryHookId: String(declaration.recoveryHookId ?? ""),
    adminCheckId: String(declaration.adminCheckId ?? ""),
  });
}

function normalizeNextActionProductionFeatureGraph(graphSelection) {
  if (graphSelection === null || typeof graphSelection !== "object") {
    return Object.freeze({
      nodeId: "",
      status: "",
      sourceNodeId: "",
      edgeFrom: "",
      edgeTo: "",
      edgeRelationship: "",
      roleUrl: "",
      targetRoleUrl: "",
      edgeTargetRoleUrl: "",
      selectedSpineTargetRoleUrl: "",
      targetRoleUrlMatchesSelectedSpineTarget: false,
      browserProofCommand: "",
      proofTarget: "",
      coverageDecision: null,
    });
  }
  const edge =
    graphSelection.edge !== null && typeof graphSelection.edge === "object"
      ? graphSelection.edge
      : {};
  return Object.freeze({
    nodeId: String(graphSelection.nodeId ?? ""),
    status: String(graphSelection.status ?? "unknown"),
    sourceNodeId: String(graphSelection.sourceNodeId ?? ""),
    edgeFrom: String(edge.from ?? ""),
    edgeTo: String(edge.to ?? ""),
    edgeRelationship: String(edge.relationship ?? ""),
    roleUrl: String(graphSelection.roleUrl ?? ""),
    targetRoleUrl: String(graphSelection.targetRoleUrl ?? ""),
    edgeTargetRoleUrl: String(graphSelection.edgeTargetRoleUrl ?? ""),
    selectedSpineTargetRoleUrl: String(
      graphSelection.selectedSpineTargetRoleUrl ?? "",
    ),
    targetRoleUrlMatchesSelectedSpineTarget:
      graphSelection.targetRoleUrlMatchesSelectedSpineTarget === true,
    browserProofCommand: String(graphSelection.browserProofCommand ?? ""),
    proofTarget: String(graphSelection.proofTarget ?? ""),
    coverageDecision: normalizeCoverageDecision(graphSelection.coverageDecision),
  });
}

function normalizeNextActionSpineDrilldown(drilldown) {
  if (drilldown === null || typeof drilldown !== "object") {
    return Object.freeze({
      featureSlotId: "",
      sourceCheckId: "",
      detailRoleUrl: "",
      cycleRowId: "",
      roleUrlRowId: "",
      rowKind: "",
      checkpointRowId: "",
      recoveryHookRowId: "",
      adminCheckId: "",
      roleUrl: "",
      rerunCommand: "",
      browserProofCommand: "",
      coverageDecision: null,
    });
  }
  return Object.freeze({
    featureSlotId: String(drilldown.featureSlotId ?? ""),
    sourceCheckId: String(drilldown.sourceCheckId ?? ""),
    detailRoleUrl: String(drilldown.detailRoleUrl ?? ""),
    cycleRowId: String(drilldown.cycleRowId ?? ""),
    roleUrlRowId: String(drilldown.roleUrlRowId ?? ""),
    rowKind: normalizeSpineRowKind(drilldown),
    checkpointRowId: String(drilldown.checkpointRowId ?? ""),
    recoveryHookRowId: String(drilldown.recoveryHookRowId ?? ""),
    adminCheckId: String(drilldown.adminCheckId ?? ""),
    roleUrl: String(drilldown.roleUrl ?? ""),
    rerunCommand: String(drilldown.rerunCommand ?? ""),
    browserProofCommand: String(drilldown.browserProofCommand ?? ""),
    coverageDecision: normalizeCoverageDecision(drilldown.coverageDecision),
  });
}

function normalizeCoverageDecision(coverageDecision) {
  if (coverageDecision === null || typeof coverageDecision !== "object") {
    return null;
  }
  return Object.freeze(
    Object.fromEntries(
      [
        "kind",
        "proofCommand",
        "reason",
        "nextDecisionTrigger",
        "prerequisiteCheckId",
        "recoveryCommand",
      ]
        .map((key) => [key, String(coverageDecision[key] ?? "")])
        .filter(([, value]) => value !== ""),
    ),
  );
}

function normalizeRealHostedEvidenceInputs(inputs) {
  return Object.freeze(
    hostedEvidenceHandoffInputRows(inputs).map((input) =>
      Object.freeze(input),
    ),
  );
}

function normalizeNextActionLocalReadinessDependencyTrace(
  localReadinessDependencyTrace,
) {
  if (
    localReadinessDependencyTrace === null ||
    typeof localReadinessDependencyTrace !== "object" ||
    localReadinessDependencyTrace.strategy !==
      "local-readiness-dependency-before-hosted-work" ||
    !Array.isArray(localReadinessDependencyTrace.candidates)
  ) {
    return Object.freeze({
      strategy: "unknown",
      candidateCount: 0,
      selectedCheckId: null,
      candidates: Object.freeze([]),
    });
  }
  const candidates = localReadinessDependencyTrace.candidates
    .filter((candidate) => candidate !== null && typeof candidate === "object")
    .map((candidate) =>
      Object.freeze({
        rank: Number(candidate.rank ?? 0),
        id: String(candidate.id ?? "unknown"),
        status: String(candidate.status ?? "unknown"),
        priority: Number(candidate.priority ?? 0),
        selected: candidate.selected === true,
        command: String(candidate.command ?? ""),
        buildSlice: String(candidate.buildSlice ?? ""),
        proofTarget: String(candidate.proofTarget ?? ""),
        roleUrl: String(candidate.roleUrl ?? ""),
        proofBoundary: String(candidate.proofBoundary ?? ""),
        requiredEvidence: String(candidate.requiredEvidence ?? ""),
      }),
    );
  return Object.freeze({
    strategy: localReadinessDependencyTrace.strategy,
    candidateCount: Number(
      localReadinessDependencyTrace.candidateCount ?? candidates.length,
    ),
    selectedCheckId:
      typeof localReadinessDependencyTrace.selectedCheckId === "string"
        ? localReadinessDependencyTrace.selectedCheckId
        : null,
    candidates: Object.freeze(candidates),
  });
}

function normalizeNextActionReplacementRaceReloadTrace(replacementRaceReloadTrace) {
  if (
    replacementRaceReloadTrace === null ||
    typeof replacementRaceReloadTrace !== "object" ||
    replacementRaceReloadTrace.strategy !== "replacement-race-reload-before-readiness" ||
    !Array.isArray(replacementRaceReloadTrace.cells)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      cells: Object.freeze([]),
    });
  }
  const cells = replacementRaceReloadTrace.cells
    .filter((cell) => cell !== null && typeof cell === "object")
    .map((cell) =>
      Object.freeze({
        id: String(cell.id ?? "unknown"),
        raceLaneId: String(cell.raceLaneId ?? ""),
        reloadLaneId:
          typeof cell.reloadLaneId === "string" ? cell.reloadLaneId : null,
        reloadStatus: String(cell.reloadStatus ?? "unknown"),
        covered: cell.covered === true,
      }),
    );
  return Object.freeze({
    strategy: replacementRaceReloadTrace.strategy,
    status: String(replacementRaceReloadTrace.status ?? "unknown"),
    source: String(replacementRaceReloadTrace.source ?? ""),
    requiredCellCount: Number(
      replacementRaceReloadTrace.requiredCellCount ?? cells.length,
    ),
    coveredCellCount: Number(replacementRaceReloadTrace.coveredCellCount ?? 0),
    gapCount: Number(replacementRaceReloadTrace.gapCount ?? 0),
    cells: Object.freeze(cells),
  });
}

function normalizeNextActionHostConcurrentRaceReloadTrace(hostConcurrentRaceReloadTrace) {
  if (
    hostConcurrentRaceReloadTrace === null ||
    typeof hostConcurrentRaceReloadTrace !== "object" ||
    hostConcurrentRaceReloadTrace.strategy !==
      "host-concurrent-race-reload-before-readiness" ||
    !Array.isArray(hostConcurrentRaceReloadTrace.cells)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      cells: Object.freeze([]),
    });
  }
  const cells = hostConcurrentRaceReloadTrace.cells
    .filter((cell) => cell !== null && typeof cell === "object")
    .map((cell) =>
      Object.freeze({
        id: String(cell.id ?? "unknown"),
        raceLaneId: String(cell.raceLaneId ?? ""),
        reloadLaneId:
          typeof cell.reloadLaneId === "string" ? cell.reloadLaneId : null,
        reloadStatus: String(cell.reloadStatus ?? "unknown"),
        covered: cell.covered === true,
      }),
    );
  return Object.freeze({
    strategy: hostConcurrentRaceReloadTrace.strategy,
    status: String(hostConcurrentRaceReloadTrace.status ?? "unknown"),
    source: String(hostConcurrentRaceReloadTrace.source ?? ""),
    requiredCellCount: Number(
      hostConcurrentRaceReloadTrace.requiredCellCount ?? cells.length,
    ),
    coveredCellCount: Number(hostConcurrentRaceReloadTrace.coveredCellCount ?? 0),
    gapCount: Number(hostConcurrentRaceReloadTrace.gapCount ?? 0),
    cells: Object.freeze(cells),
  });
}

function normalizeNextActionPlayerConcurrentActionReloadTrace(
  playerConcurrentActionReloadTrace,
) {
  if (
    playerConcurrentActionReloadTrace === null ||
    typeof playerConcurrentActionReloadTrace !== "object" ||
    playerConcurrentActionReloadTrace.strategy !==
      "player-concurrent-action-reload-before-readiness" ||
    !Array.isArray(playerConcurrentActionReloadTrace.cells)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      cells: Object.freeze([]),
    });
  }
  const cells = playerConcurrentActionReloadTrace.cells
    .filter((cell) => cell !== null && typeof cell === "object")
    .map((cell) =>
      Object.freeze({
        id: String(cell.id ?? "unknown"),
        raceLaneId: String(cell.raceLaneId ?? ""),
        reloadLaneId:
          typeof cell.reloadLaneId === "string" ? cell.reloadLaneId : null,
        reloadStatus: String(cell.reloadStatus ?? "unknown"),
        covered: cell.covered === true,
      }),
    );
  return Object.freeze({
    strategy: playerConcurrentActionReloadTrace.strategy,
    status: String(playerConcurrentActionReloadTrace.status ?? "unknown"),
    source: String(playerConcurrentActionReloadTrace.source ?? ""),
    requiredCellCount: Number(
      playerConcurrentActionReloadTrace.requiredCellCount ?? cells.length,
    ),
    coveredCellCount: Number(
      playerConcurrentActionReloadTrace.coveredCellCount ?? 0,
    ),
    gapCount: Number(playerConcurrentActionReloadTrace.gapCount ?? 0),
    cells: Object.freeze(cells),
  });
}

function normalizeNextActionCohostDeadlineRaceReloadTrace(
  cohostDeadlineRaceReloadTrace,
) {
  if (
    cohostDeadlineRaceReloadTrace === null ||
    typeof cohostDeadlineRaceReloadTrace !== "object" ||
    cohostDeadlineRaceReloadTrace.strategy !==
      "cohost-deadline-race-reload-before-readiness" ||
    !Array.isArray(cohostDeadlineRaceReloadTrace.cells)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      cells: Object.freeze([]),
    });
  }
  const cells = cohostDeadlineRaceReloadTrace.cells
    .filter((cell) => cell !== null && typeof cell === "object")
    .map((cell) =>
      Object.freeze({
        id: String(cell.id ?? "unknown"),
        raceLaneId: String(cell.raceLaneId ?? ""),
        reloadLaneId:
          typeof cell.reloadLaneId === "string" ? cell.reloadLaneId : null,
        reloadStatus: String(cell.reloadStatus ?? "unknown"),
        covered: cell.covered === true,
      }),
    );
  return Object.freeze({
    strategy: cohostDeadlineRaceReloadTrace.strategy,
    status: String(cohostDeadlineRaceReloadTrace.status ?? "unknown"),
    source: String(cohostDeadlineRaceReloadTrace.source ?? ""),
    requiredCellCount: Number(
      cohostDeadlineRaceReloadTrace.requiredCellCount ?? cells.length,
    ),
    coveredCellCount: Number(cohostDeadlineRaceReloadTrace.coveredCellCount ?? 0),
    gapCount: Number(cohostDeadlineRaceReloadTrace.gapCount ?? 0),
    cells: Object.freeze(cells),
  });
}

function normalizeNextActionRaceCoveragePromotedMilestones(promotedMilestones) {
  if (
    promotedMilestones === null ||
    typeof promotedMilestones !== "object" ||
    !Array.isArray(promotedMilestones.groups)
  ) {
    return Object.freeze({
      status: "unknown",
      cellCount: 0,
      provenCellCount: 0,
      reloadCoveredCellCount: 0,
      groupCount: 0,
      passedGroupCount: 0,
      requiredCellCount: 0,
      coveredCellCount: 0,
      gapCount: 0,
      groups: Object.freeze([]),
    });
  }
  const groups = promotedMilestones.groups
    .filter((group) => group !== null && typeof group === "object")
    .map((group) =>
      Object.freeze({
        id: String(group.id ?? "unknown"),
        label: String(group.label ?? "Unknown"),
        status: String(group.status ?? "unknown"),
        cellIds: Object.freeze(
          Array.isArray(group.cellIds)
            ? group.cellIds.map((cellId) => String(cellId))
            : [],
        ),
        requiredCellCount: Number(group.requiredCellCount ?? 0),
        coveredCellCount: Number(group.coveredCellCount ?? 0),
        gapCount: Number(group.gapCount ?? 0),
      }),
    );
  return Object.freeze({
    status: String(promotedMilestones.status ?? "unknown"),
    cellCount: Number(promotedMilestones.cellCount ?? 0),
    provenCellCount: Number(promotedMilestones.provenCellCount ?? 0),
    reloadCoveredCellCount: Number(promotedMilestones.reloadCoveredCellCount ?? 0),
    groupCount: Number(promotedMilestones.groupCount ?? groups.length),
    passedGroupCount: Number(promotedMilestones.passedGroupCount ?? 0),
    requiredCellCount: Number(promotedMilestones.requiredCellCount ?? 0),
    coveredCellCount: Number(promotedMilestones.coveredCellCount ?? 0),
    gapCount: Number(promotedMilestones.gapCount ?? 0),
    groups: Object.freeze(groups),
  });
}

function normalizeNextActionStaleConflictMessageTrace(staleConflictMessageTrace) {
  if (
    staleConflictMessageTrace === null ||
    typeof staleConflictMessageTrace !== "object" ||
    staleConflictMessageTrace.strategy !== "stale-conflict-message-before-readiness" ||
    !Array.isArray(staleConflictMessageTrace.laneIds)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredLaneCount: 0,
      coveredLaneCount: 0,
      gapCount: 0,
      laneIds: Object.freeze([]),
      surfaceCoverage: Object.freeze({
        status: "unknown",
        requiredSurfaceCount: 0,
        coveredSurfaceCount: 0,
        gapCount: 0,
      }),
      surfaces: Object.freeze([]),
    });
  }
  return Object.freeze({
    strategy: staleConflictMessageTrace.strategy,
    status: String(staleConflictMessageTrace.status ?? "unknown"),
    source: String(staleConflictMessageTrace.source ?? ""),
    requiredLaneCount: Number(staleConflictMessageTrace.requiredLaneCount ?? 0),
    coveredLaneCount: Number(staleConflictMessageTrace.coveredLaneCount ?? 0),
    gapCount: Number(staleConflictMessageTrace.gapCount ?? 0),
    laneIds: Object.freeze(
      staleConflictMessageTrace.laneIds.map((laneId) => String(laneId)),
    ),
    surfaceCoverage: Object.freeze({
      status: String(
        staleConflictMessageTrace.surfaceCoverage?.status ?? "unknown",
      ),
      requiredSurfaceCount: Number(
        staleConflictMessageTrace.surfaceCoverage?.requiredSurfaceCount ?? 0,
      ),
      coveredSurfaceCount: Number(
        staleConflictMessageTrace.surfaceCoverage?.coveredSurfaceCount ?? 0,
      ),
      gapCount: Number(staleConflictMessageTrace.surfaceCoverage?.gapCount ?? 0),
    }),
    surfaces: Object.freeze(
      (Array.isArray(staleConflictMessageTrace.surfaces)
        ? staleConflictMessageTrace.surfaces
        : []
      ).map((surface) =>
        Object.freeze({
          id: String(surface.id ?? ""),
          checkId: String(surface.checkId ?? ""),
          label: String(surface.label ?? surface.id ?? ""),
          status: String(surface.status ?? "unknown"),
          laneId: String(surface.laneId ?? ""),
          roleUrl: String(surface.roleUrl ?? ""),
          rejectError: String(surface.rejectError ?? ""),
          rejectMessage: String(surface.rejectMessage ?? ""),
          receiptStatusText: String(surface.receiptStatusText ?? ""),
          proofBoundary: String(surface.proofBoundary ?? ""),
        }),
      ),
    ),
  });
}

function normalizeNextActionHostStaleControlTrace(hostStaleControlTrace) {
  if (
    hostStaleControlTrace === null ||
    typeof hostStaleControlTrace !== "object" ||
    hostStaleControlTrace.strategy !== "host-stale-control-before-readiness" ||
    !Array.isArray(hostStaleControlTrace.laneIds)
  ) {
    return Object.freeze({
      strategy: "unknown",
      status: "unknown",
      source: "",
      requiredLaneCount: 0,
      coveredLaneCount: 0,
      gapCount: 0,
      laneIds: Object.freeze([]),
    });
  }
  return Object.freeze({
    strategy: hostStaleControlTrace.strategy,
    status: String(hostStaleControlTrace.status ?? "unknown"),
    source: String(hostStaleControlTrace.source ?? ""),
    requiredLaneCount: Number(hostStaleControlTrace.requiredLaneCount ?? 0),
    coveredLaneCount: Number(hostStaleControlTrace.coveredLaneCount ?? 0),
    gapCount: Number(hostStaleControlTrace.gapCount ?? 0),
    laneIds: Object.freeze(
      hostStaleControlTrace.laneIds.map((laneId) => String(laneId)),
    ),
  });
}

export function normalizeLocalProofFreshnessAudit(
  proofFreshness,
  { game, nextAction = null },
) {
  if (
    proofFreshness === null ||
    typeof proofFreshness !== "object" ||
    proofFreshness.version !== 1 ||
    proofFreshness.proof !== "dev-test-game-proof-freshness" ||
    proofFreshness.scope !== "local-dev-test-game-proof-freshness" ||
    proofFreshness.releaseReady !== false ||
    proofFreshness.productionReady !== false
  ) {
    return null;
  }
  const artifacts = Array.isArray(proofFreshness.artifacts)
    ? proofFreshness.artifacts
    : [];
  const summary = proofFreshness.summary ?? {};
  const nextActionRow = normalizeLocalNextActionAudit(nextAction, { game });
  const nextActionHandoff =
    nextActionRow === null
      ? null
      : Object.freeze({
          id: localAdminAuditIds.nextAction,
          label: "Ranked next action",
          href: nextActionRow.inspectHref,
          status: nextActionRow.status,
          command: nextActionRow.artifactSummary.command,
        });
  return Object.freeze({
    id: localAdminAuditIds.proofFreshness,
    label: "Local proof freshness",
    status: `${Number(summary.freshCount ?? 0)} fresh, ${Number(
      summary.staleCount ?? 0,
    )} stale, ${Number(summary.missingCount ?? 0)} missing`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local proof freshness dashboard",
    boundaryDetail:
      proofFreshness.proofBoundary ??
      "Local dev-test-game artifact age dashboard without content validation or release claims.",
    href: devTestGameReleaseReadinessPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofFreshness }),
    checks: Object.freeze(
      [
        ...artifacts.map((artifact) =>
          Object.freeze({
            id: String(artifact.id),
            status: String(artifact.status),
          }),
        ),
        ...(nextActionHandoff === null
          ? []
          : [
              Object.freeze({
                id: localAdminAuditHandoffCheckIds.nextAction,
                status: nextActionHandoff.status,
              }),
            ]),
      ],
    ),
    relatedLinks:
      nextActionHandoff === null ? Object.freeze([]) : Object.freeze([nextActionHandoff]),
    artifactSummary: Object.freeze({
      artifactCount: Number(summary.artifactCount ?? artifacts.length),
      freshCount: Number(summary.freshCount ?? 0),
      staleCount: Number(summary.staleCount ?? 0),
      missingCount: Number(summary.missingCount ?? 0),
      maxAgeHours: Number(proofFreshness.maxAgeHours ?? 0),
      nextActionCommand: nextActionHandoff?.command ?? "",
      nextActionInspectHref: nextActionHandoff?.href ?? "",
      releaseReady: proofFreshness.releaseReady === true,
      productionReady: proofFreshness.productionReady === true,
    }),
  });
}

export function normalizeLocalOpsArtifactsAudit(opsArtifacts, { game }) {
  if (
    opsArtifacts === null ||
    typeof opsArtifacts !== "object" ||
    opsArtifacts.version !== 1 ||
    opsArtifacts.proof !== "dev-test-game-ops-artifacts" ||
    opsArtifacts.status !== "passed"
  ) {
    return null;
  }
  const checks = Array.isArray(opsArtifacts.checks) ? opsArtifacts.checks : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.opsArtifacts,
    label: "Local ops artifacts",
    status: `${passedChecks.length} local ops checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local ops artifact bundle",
    boundaryDetail:
      opsArtifacts.proofBoundary ??
      "Local dev-test-game ops artifact bundle without hosted observability claims.",
    href: devTestGameOpsArtifactsPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.opsArtifacts }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      game: String(opsArtifacts.run?.game ?? ""),
      laneCount: Number(opsArtifacts.proofRun?.laneCount ?? 0),
      roleCount: Number(opsArtifacts.run?.roleCount ?? 0),
      releaseReady: opsArtifacts.releaseReady === true,
      productionReady: opsArtifacts.productionReady === true,
    }),
  });
}

export function appendLocalSpineManifestAudit(audit, spineManifest, { game }) {
  const row = normalizeLocalSpineManifestAudit(spineManifest, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalSpineManifestAudit(spineManifest, { game }) {
  if (
    spineManifest === null ||
    typeof spineManifest !== "object" ||
    spineManifest.version !== 1 ||
    spineManifest.proof !== "dev-test-game-spine-manifest" ||
    spineManifest.status !== "passed" ||
    spineManifest.scope !== "local-dev-test-game-spine-manifest" ||
    spineManifest.releaseReady !== false ||
    spineManifest.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(spineManifest.checks) ? spineManifest.checks : [];
  const commands =
    spineManifest.commands !== null && typeof spineManifest.commands === "object"
      ? Object.entries(spineManifest.commands)
      : [];
  const artifacts = Array.isArray(spineManifest.artifacts)
    ? spineManifest.artifacts
    : [];
  const terminalArtifacts = Array.isArray(spineManifest.terminalArtifacts)
    ? spineManifest.terminalArtifacts
    : [];
  const artifactFreshness =
    spineManifest.artifactFreshness !== null &&
    typeof spineManifest.artifactFreshness === "object"
      ? spineManifest.artifactFreshness
      : {};
  const freshnessSummary =
    artifactFreshness.summary !== null && typeof artifactFreshness.summary === "object"
      ? artifactFreshness.summary
      : {};
  const spineManifestRelatedLinks = Object.freeze([
    Object.freeze({
      id: localAdminAuditIds.proofFreshness,
      label: "Proof freshness",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.proofFreshness }),
      status: String(artifactFreshness.status ?? "unknown"),
      command: String(artifactFreshness.nextCommand ?? ""),
    }),
    Object.freeze({
      id: localAdminAuditIds.nextAction,
      label: "Ranked next action",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
      status: String(spineManifest.commands?.nextAction?.script ?? "unknown"),
      command: String(spineManifest.commands?.nextAction?.script ?? ""),
    }),
  ]);
  return Object.freeze({
    id: localAdminAuditIds.spineManifest,
    label: "Local spine manifest",
    status: `${checks.filter((check) => check?.status === "passed").length} manifest checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine manifest",
    boundaryDetail:
      spineManifest.proofBoundary ??
      "Generated local dev-test-game proof order and evidence wiring without release claims.",
    href: spineManifestPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.spineManifest }),
    checks: Object.freeze(
      [
        ...checks.map((check) =>
          Object.freeze({
            id: String(check.id),
            status: String(check.status),
          }),
        ),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.proofFreshness,
          status: String(artifactFreshness.status ?? "unknown"),
        }),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.nextAction,
          status: String(spineManifest.commands?.nextAction?.script ?? "unknown"),
        }),
      ],
    ),
    relatedLinks: spineManifestRelatedLinks,
    artifactSummary: Object.freeze({
      commandCount: commands.length,
      artifactCount: artifacts.length,
      terminalArtifactCount: terminalArtifacts.length,
      adminSpineStepCount: Number(
        spineManifest.commands?.adminSpine?.plan?.length ?? 0,
      ),
      artifactFreshnessStatus: String(artifactFreshness.status ?? "unknown"),
      freshCount: Number(freshnessSummary.freshCount ?? 0),
      staleCount: Number(freshnessSummary.staleCount ?? 0),
      missingCount: Number(freshnessSummary.missingCount ?? 0),
      nextCommand: String(artifactFreshness.nextCommand ?? ""),
      nextActionInspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.nextAction }),
      proofFreshnessInspectHref: adminAuditInspectHref({
        game,
        audit: localAdminAuditIds.proofFreshness,
      }),
      releaseReady: spineManifest.releaseReady === true,
      productionReady: spineManifest.productionReady === true,
    }),
  });
}

export function appendLocalAdminSpineAudit(
  audit,
  adminSpineProof,
  { game, terminalBatchProof = null },
) {
  const row = normalizeLocalAdminSpineAudit(adminSpineProof, {
    game,
    terminalBatchProof,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalAdminSpineAudit(
  adminSpineProof,
  { game, terminalBatchProof = null },
) {
  if (
    adminSpineProof === null ||
    typeof adminSpineProof !== "object" ||
    adminSpineProof.version !== 1 ||
    adminSpineProof.proof !== "dev-test-game-admin-spine-proof" ||
    adminSpineProof.status !== "passed" ||
    adminSpineProof.scope !== "local-dev-test-game-admin-spine" ||
    adminSpineProof.releaseReady !== false ||
    adminSpineProof.productionReady !== false
  ) {
    return null;
  }
  const proofs = Array.isArray(adminSpineProof.adminProofs)
    ? adminSpineProof.adminProofs
    : [];
  const recovery =
    adminSpineProof.recovery !== null && typeof adminSpineProof.recovery === "object"
      ? adminSpineProof.recovery
      : {};
  const aggregateBatches = Array.isArray(adminSpineProof.batches)
    ? adminSpineProof.batches
    : [];
  const terminalBatches = validAdminSpineTerminalBatchProof(terminalBatchProof)
    ? terminalBatchProof.batches
    : [];
  const batches = [...aggregateBatches, ...terminalBatches].map((batch, index) =>
    normalizeAdminSpineBatch(batch, index),
  );
  const adminSpineRelatedLinks = Object.freeze([
    Object.freeze({
      id: localAdminAuditIds.spineManifest,
      label: "Spine manifest",
      href: adminAuditInspectHref({ game, audit: localAdminAuditIds.spineManifest }),
      status: String(
        proofs.find((proof) => proof?.id === "spine-manifest")?.status ?? "unknown",
      ),
      command:
        String(
          recovery.surfaces?.find((surface) => surface?.id === "spine-manifest")
            ?.rerunCommand ?? "",
        ),
    }),
  ]);
  return Object.freeze({
    id: localAdminAuditIds.adminSpine,
    label: "Local admin spine",
    status: `${proofs.filter((proof) => proof?.status === "passed").length} admin proof surfaces passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local aggregate admin proof",
    boundaryDetail:
      adminSpineProof.proofBoundary ??
      "Local aggregate admin proof without hosted or release-readiness claims.",
    href: adminSpineProofPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.adminSpine }),
    checks: Object.freeze(
      [
        ...proofs.map((proof) =>
          Object.freeze({
            id: String(proof.id),
            status: String(proof.status),
            ...(proof.rerunCommand === undefined
              ? {}
              : { rerunCommand: String(proof.rerunCommand) }),
            ...(proof.refreshedInCurrentRun === undefined
              ? {}
              : { refreshedInCurrentRun: proof.refreshedInCurrentRun === true }),
          }),
        ),
        Object.freeze({
          id: "recovery",
          status: String(recovery.status ?? "unknown"),
          nextCommand: String(recovery.nextCommand ?? ""),
        }),
        Object.freeze({
          id: localAdminAuditHandoffCheckIds.spineManifest,
          status: String(
            proofs.find((proof) => proof?.id === "spine-manifest")?.status ?? "unknown",
          ),
        }),
      ],
    ),
    batches: Object.freeze(batches),
    relatedLinks: adminSpineRelatedLinks,
    artifactSummary: Object.freeze({
      game: String(adminSpineProof.generatedFrom?.game ?? ""),
      proofCount: proofs.length,
      batchCount: batches.length,
      recoveryStatus: String(recovery.status ?? "unknown"),
      refreshedCount: Number(recovery.refreshedCount ?? 0),
      nextCommand: String(recovery.nextCommand ?? ""),
      spineManifestInspectHref: adminAuditInspectHref({
        game,
        audit: localAdminAuditIds.spineManifest,
      }),
      releaseReady: adminSpineProof.releaseReady === true,
      productionReady: adminSpineProof.productionReady === true,
    }),
  });
}

function validAdminSpineTerminalBatchProof(proof) {
  return (
    proof !== null &&
    typeof proof === "object" &&
    proof.version === 1 &&
    proof.proof === "dev-test-game-admin-spine-terminal-batches" &&
    proof.status === "passed" &&
    proof.scope === "local-dev-test-game-admin-spine-terminal-batches" &&
    proof.releaseReady === false &&
    proof.productionReady === false &&
    Array.isArray(proof.batches)
  );
}

function normalizeAdminSpineBatch(batch, index) {
  const label = String(batch?.label ?? `Admin spine batch ${index + 1}`);
  return Object.freeze({
    id: adminSpineBatchId(label, index),
    label,
    reason: String(batch?.reason ?? ""),
    status: String(batch?.status ?? "unknown"),
    caseCount: Number(batch?.caseCount ?? 0),
    elapsedMs: Number(batch?.elapsedMs ?? 0),
    sharedFrontendSession: batch?.sharedFrontendSession === true,
    sharedChromiumSession: batch?.sharedChromiumSession === true,
    caseSmokeNames: Object.freeze(
      Array.isArray(batch?.caseSmokeNames)
        ? batch.caseSmokeNames.map((name) => String(name))
        : [],
    ),
    proofIds: Object.freeze(
      Array.isArray(batch?.proofIds) ? batch.proofIds.map((id) => String(id)) : [],
    ),
    artifactPaths: Object.freeze(
      Array.isArray(batch?.artifactPaths)
        ? batch.artifactPaths.map((artifactPath) => String(artifactPath))
        : [],
    ),
  });
}

function adminSpineBatchId(label, index) {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized === "" ? `admin-spine-batch-${index + 1}` : normalized;
}

export function appendLocalSeedFixtureAudit(audit, seedFixtureSummary, { game }) {
  const row = normalizeLocalSeedFixtureAudit(seedFixtureSummary, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalSeedFixtureAudit(seedFixtureSummary, { game }) {
  if (
    seedFixtureSummary === null ||
    typeof seedFixtureSummary !== "object" ||
    seedFixtureSummary.version !== 1 ||
    seedFixtureSummary.proof !== "dev-test-game-seed-fixture-summary" ||
    seedFixtureSummary.status !== "passed"
  ) {
    return null;
  }
  const scenarios = Array.isArray(seedFixtureSummary.demoScenarios)
    ? seedFixtureSummary.demoScenarios
    : [];
  const localScenarios = scenarios.filter(
    (scenario) => scenario?.status === "available_locally",
  );
  const proofLaneCoverage = normalizeProofLaneCoverage(
    seedFixtureSummary.proofLaneCoverage,
  );
  return Object.freeze({
    id: localAdminAuditIds.seedFixtures,
    label: "Local seed fixtures",
    status: `${localScenarios.length} demo scenarios available locally`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local seed/demo fixture inventory",
    boundaryDetail:
      seedFixtureSummary.proofBoundary ??
      "Local seed/demo fixture summary without hosted demo-data claims.",
    href: devTestGameSeedFixturePath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.seedFixtures }),
    scenarios: Object.freeze(
      scenarios.map((scenario) =>
        Object.freeze({
          id: String(scenario.id),
          title: String(scenario.title ?? scenario.id),
          status: String(scenario.status),
          role: String(scenario.role ?? ""),
        }),
      ),
    ),
    proofLaneCoverage,
    artifactSummary: Object.freeze({
      game: String(seedFixtureSummary.fixture?.game ?? ""),
      scenarioCount: scenarios.length,
      roleCount: Number(seedFixtureSummary.fixture?.roleCount ?? 0),
      slotCount: Number(seedFixtureSummary.fixture?.slots?.length ?? 0),
      proofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.passedLaneCount ?? 0,
      ),
      directSeededProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.directSeeded?.count ?? 0,
      ),
      aliasOnlyProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.aliasOnly?.count ?? 0,
      ),
      aggregateOnlyProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.aggregateOnly?.count ?? 0,
      ),
      unclassifiedProofLaneCount: Number(
        seedFixtureSummary.proofLaneCoverage?.unclassified?.count ?? 0,
      ),
      releaseReady: seedFixtureSummary.releaseReady === true,
      productionReady: seedFixtureSummary.productionReady === true,
    }),
  });
}

function normalizeProofLaneCoverage(coverage) {
  if (coverage === null || typeof coverage !== "object") {
    return Object.freeze([]);
  }
  return Object.freeze(
    [
      ["direct-seeded", "Direct seeded proof lanes", coverage.directSeeded],
      ["alias-only", "Alias-only proof lanes", coverage.aliasOnly],
      ["aggregate-only", "Aggregate-only proof lanes", coverage.aggregateOnly],
      ["unclassified", "Unclassified proof lanes", coverage.unclassified],
    ].map(([id, label, entry]) =>
      Object.freeze({
        id,
        label,
        status: `${Number(entry?.count ?? 0)} lanes`,
        count: Number(entry?.count ?? 0),
        laneIds: Object.freeze(
          Array.isArray(entry?.laneIds)
            ? entry.laneIds.map((laneId) => String(laneId))
            : [],
        ),
      }),
    ),
  );
}

export function appendLocalReleaseReadinessAudit(
  audit,
  releaseReadinessChecklist,
  { game },
) {
  const row = normalizeLocalReleaseReadinessAudit(releaseReadinessChecklist, {
    game,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalReleaseReadinessAudit(
  releaseReadinessChecklist,
  { game },
) {
  if (
    releaseReadinessChecklist === null ||
    typeof releaseReadinessChecklist !== "object" ||
    releaseReadinessChecklist.version !== 1 ||
    releaseReadinessChecklist.proof !== "dev-test-game-release-readiness" ||
    releaseReadinessChecklist.status !== "passed" ||
    releaseReadinessChecklist.releaseReady !== false ||
    releaseReadinessChecklist.productionReady !== false ||
    releaseReadinessChecklist.releaseReadiness?.status !== "not_ready"
  ) {
    return null;
  }
  const checks = Array.isArray(releaseReadinessChecklist.localDevelopmentSpine?.checks)
    ? releaseReadinessChecklist.localDevelopmentSpine.checks
    : [];
  const localPrerequisites = checks.filter(
    (check) => check?.dependencyGated === true,
  );
  const coverageSummary = localReleaseReadinessCoverageSummary(checks);
  const unproven = Array.isArray(releaseReadinessChecklist.releaseReadiness?.unproven)
    ? releaseReadinessChecklist.releaseReadiness.unproven
    : [];
  const statusPrefix =
    coverageSummary.driftCount === 0
      ? `${checks.length} local checks passed`
      : `coverage drift detected in ${coverageSummary.driftCount}/${coverageSummary.coverageCheckCount} groups`;
  return Object.freeze({
    id: localAdminAuditIds.releaseReadiness,
    label: "Local release readiness",
    status: `${statusPrefix}, ${unproven.length} release items unproven`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-readiness checklist",
    boundaryDetail:
      releaseReadinessChecklist.proofBoundary ??
      "Local dev-test-game release-readiness checklist without beta or production claims.",
    href: devTestGameReleaseReadinessPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.releaseReadiness,
    }),
    checks: Object.freeze(
      checks.flatMap((check) => [
        Object.freeze({
          id: String(check.id),
          status: localReleaseReadinessCheckStatus(check),
          dependencyGated: check.dependencyGated === true,
          laneIds: Object.freeze(
            Array.isArray(check.laneIds)
              ? check.laneIds.map((laneId) => String(laneId))
              : [],
          ),
          requiredLaneCount: Number(check.requiredLaneCount ?? 0),
          coveredLaneCount: Number(check.coveredLaneCount ?? 0),
          familyCount: Number(check.familyCount ?? 0),
          expectedLaneCount: Number(check.expectedLaneCount ?? 0),
          expectedFamilyCount: Number(check.expectedFamilyCount ?? 0),
        }),
        ...normalizedEvidenceObjectCheckRows({
          parentId: String(check.id),
          objects: check.normalizedEvidenceObjects,
        }),
      ]),
    ),
    localPrerequisites: Object.freeze(
      localPrerequisites.map((check) =>
        Object.freeze({
          id: String(check.id),
          label: String(check.label ?? check.id ?? ""),
          status: String(check.status),
          evidence: String(check.evidence ?? ""),
          command: String(check.recovery?.command ?? ""),
          proofTarget: String(check.recovery?.proofTarget ?? ""),
          roleUrl: String(check.recovery?.roleUrl ?? ""),
          requiredEvidence: String(check.recovery?.requiredEvidence ?? ""),
          proofBoundary: String(check.recovery?.proofBoundary ?? ""),
        }),
      ),
    ),
    unproven: Object.freeze(
      unproven.map((item) =>
        Object.freeze({
          id: String(item.id),
          status: String(item.status),
          requiredEvidence: String(item.requiredEvidence ?? ""),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      game: String(releaseReadinessChecklist.generatedFrom?.game ?? ""),
      localCheckCount: checks.length,
      coverageCheckCount: coverageSummary.coverageCheckCount,
      coverageDriftCount: coverageSummary.driftCount,
      coverageStatus: coverageSummary.status,
      localPrerequisiteCount: localPrerequisites.length,
      unprovenCount: unproven.length,
      releaseReady: releaseReadinessChecklist.releaseReady === true,
      productionReady: releaseReadinessChecklist.productionReady === true,
    }),
  });
}

function localReleaseReadinessCoverageSummary(checks) {
  const coverageChecks = checks.filter((check) => {
    const laneIds = Array.isArray(check?.laneIds) ? check.laneIds : [];
    return laneIds.length > 0;
  });
  const driftCount = coverageChecks.filter((check) =>
    localReleaseReadinessCheckStatus(check).startsWith("drift:"),
  ).length;
  return Object.freeze({
    status: driftCount === 0 ? "coherent" : "drift",
    coverageCheckCount: coverageChecks.length,
    driftCount,
  });
}

function localReleaseReadinessCheckStatus(check) {
  const status = String(check?.status ?? "unknown");
  const laneIds = Array.isArray(check?.laneIds) ? check.laneIds : [];
  const coveredLaneCount = Number(check?.coveredLaneCount ?? 0);
  const requiredLaneCount = Number(check?.requiredLaneCount ?? laneIds.length);
  const familyCount = Number(check?.familyCount ?? 0);
  const expectedLaneCount = Number(check?.expectedLaneCount);
  const expectedFamilyCount = Number(check?.expectedFamilyCount);
  const hasCoverageCounts =
    laneIds.length > 0 &&
    Number.isFinite(coveredLaneCount) &&
    Number.isFinite(requiredLaneCount) &&
    Number.isFinite(familyCount) &&
    Number.isFinite(expectedLaneCount) &&
    Number.isFinite(expectedFamilyCount);
  if (!hasCoverageCounts) {
    return status;
  }
  const summary = `${status}: ${coveredLaneCount}/${requiredLaneCount} lanes across ${familyCount}/${expectedFamilyCount} shared families`;
  if (
    requiredLaneCount !== expectedLaneCount ||
    laneIds.length !== expectedLaneCount ||
    familyCount !== expectedFamilyCount
  ) {
    return `drift: ${summary}; expected ${expectedLaneCount} shared lanes`;
  }
  return summary;
}

export function appendLocalReleaseRunbookAudit(audit, releaseRunbook, { game }) {
  const row = normalizeLocalReleaseRunbookAudit(releaseRunbook, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalReleaseRunbookAudit(releaseRunbook, { game }) {
  if (
    releaseRunbook === null ||
    typeof releaseRunbook !== "object" ||
    releaseRunbook.version !== 1 ||
    releaseRunbook.proof !== "dev-test-game-release-runbook" ||
    releaseRunbook.status !== "passed" ||
    releaseRunbook.scope !== "local-dev-test-game-release-runbook-rehearsal" ||
    releaseRunbook.releaseReady !== false ||
    releaseRunbook.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(releaseRunbook.checks) ? releaseRunbook.checks : [];
  const runbookItems = Array.isArray(releaseRunbook.runbookItems)
    ? releaseRunbook.runbookItems
    : [];
  const passedChecks = checks.filter((check) => check?.status === "passed");
  return Object.freeze({
    id: localAdminAuditIds.releaseRunbook,
    label: "Local release runbook",
    status: `${passedChecks.length} runbook checks passed, ${runbookItems.length} gaps rehearsed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-runbook rehearsal",
    boundaryDetail:
      releaseRunbook.proofBoundary ??
      "Local release-runbook rehearsal without human approval or release claims.",
    href: devTestGameReleaseRunbookPath,
    inspectHref: adminAuditInspectHref({ game, audit: localAdminAuditIds.releaseRunbook }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    unproven: Object.freeze(
      runbookItems.map((item) =>
        Object.freeze({
          id: String(item.id),
          status: String(item.status),
          requiredEvidence: String(item.requiredEvidence ?? ""),
          command: String(item.command ?? ""),
          proofTarget: String(item.proofTarget ?? ""),
          roleUrl: String(item.roleUrl ?? ""),
        }),
      ),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.releaseReadiness,
        label: "Release readiness",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.releaseReadiness }),
        status: "not_ready",
        command: "test:dev-test-game-readiness",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(releaseRunbook.generatedFrom?.game ?? ""),
      runbookItemCount: runbookItems.length,
      rollbackStatus: String(releaseRunbook.rollbackPath?.status ?? "unknown"),
      supportStatus: String(releaseRunbook.supportPath?.status ?? "unknown"),
      releaseReady: releaseRunbook.releaseReady === true,
      productionReady: releaseRunbook.productionReady === true,
    }),
  });
}

export function appendLocalCoreLoopAudit(audit, proofRun, { game }) {
  const row = normalizeLocalCoreLoopAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalCoreLoopAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const requiredLaneIds = coreLoopAuditLaneIds;
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    requiredLaneIds.some((id) => laneById.get(id)?.status !== "passed") ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.coreLoop,
    label: "Local core loop",
    status: `${requiredLaneIds.length} core loop lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local core-loop proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run core loop lanes without hosted release claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.coreLoop,
    }),
    checks: Object.freeze(
      [
        Object.freeze({
          id: "core-loop-spine",
          status: coreLoopSpineStatus(proofRun),
        }),
        Object.freeze({
          id: coreLoopCompletedGameCoverageCheckId,
          status: completedGameHardeningCoverageStatus(proofRun),
        }),
        ...requiredLaneIds.map((id) => {
          const lane = laneById.get(id);
          return Object.freeze({
            id,
            status: coreLoopLaneStatus(lane),
          });
        }),
      ],
    ),
    spineCycles: normalizeCoreLoopSpineCycles(proofRun),
    spineRecoveryHooks: normalizeCoreLoopSpineRecoveryHooks(proofRun),
    scenarioFamilies: coreLoopScenarioFamilyRows(),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      completedGameCoverageStatus: String(
        proofRun.completedGameHardeningCoverage?.status ?? "unknown",
      ),
      completedGameCoverageLaneCount: Number(
        proofRun.completedGameHardeningCoverage?.laneCount ?? 0,
      ),
      completedGameCoverageFamilyCount: Number(
        proofRun.completedGameHardeningCoverage?.familyCount ?? 0,
      ),
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

function completedGameHardeningCoverageStatus(proofRun) {
  const coverage = proofRun?.completedGameHardeningCoverage;
  const status = String(coverage?.status ?? "unknown");
  const passedLaneCount = Number(coverage?.passedLaneCount ?? 0);
  const laneCount = Number(coverage?.laneCount ?? 0);
  const familyCount = Number(coverage?.familyCount ?? 0);
  const artifactExpectedLaneCount = Number(coverage?.expectedLaneCount);
  const artifactExpectedFamilyCount = Number(coverage?.expectedFamilyCount);
  const sharedExpectedLaneCount = COMPLETED_GAME_HARDENING_LANE_CASES.length;
  const sharedExpectedFamilyCount = COMPLETED_GAME_HARDENING_FAMILY_IDS.length;
  if (
    laneCount !== artifactExpectedLaneCount ||
    familyCount !== artifactExpectedFamilyCount ||
    artifactExpectedLaneCount !== sharedExpectedLaneCount ||
    artifactExpectedFamilyCount !== sharedExpectedFamilyCount
  ) {
    return `drift: ${status} artifact reports ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families; expected ${sharedExpectedLaneCount} lanes across ${sharedExpectedFamilyCount} shared families`;
  }
  return `${status}: ${passedLaneCount}/${laneCount} completed-game lanes across ${familyCount} families`;
}

function normalizeCoreLoopSpineCycles(proofRun) {
  const cycles = Array.isArray(proofRun?.coreLoopSpine?.cycles)
    ? proofRun.coreLoopSpine.cycles
    : [];
  return Object.freeze(
    cycles.map((cycle) => {
      const roleUrls =
        cycle?.roleUrls !== null && typeof cycle?.roleUrls === "object"
          ? cycle.roleUrls
          : {};
      const checkpoints = Array.isArray(cycle?.checkpoints)
        ? cycle.checkpoints
        : [];
      return Object.freeze({
        id: String(cycle?.id ?? ""),
        label: formatSpineLabel(cycle?.id),
        game: String(cycle?.game ?? ""),
        status: `${checkpoints.length} checkpoints`,
        roleUrls: Object.freeze(
          Object.entries(roleUrls).map(([id, href]) =>
            Object.freeze({
              id: String(id),
              label: formatSpineLabel(id),
              href: String(href ?? ""),
            }),
          ),
        ),
        checkpoints: Object.freeze(
          checkpoints.map((checkpoint) =>
            Object.freeze({
              id: String(checkpoint?.id ?? ""),
              label: formatSpineLabel(checkpoint?.id),
              status: formatCoreLoopSpineCheckpointStatus(checkpoint),
            }),
          ),
        ),
      });
    }),
  );
}

function normalizeCoreLoopSpineRecoveryHooks(proofRun) {
  const recoveryHooks =
    proofRun?.coreLoopSpine?.recoveryHooks !== null &&
    typeof proofRun?.coreLoopSpine?.recoveryHooks === "object"
      ? proofRun.coreLoopSpine.recoveryHooks
      : {};
  return Object.freeze(
    Object.entries(recoveryHooks).map(([id, status]) =>
      Object.freeze({
        id: String(id),
        label: formatSpineLabel(id),
        status: String(status ?? "unknown"),
      }),
    ),
  );
}

function formatCoreLoopSpineCheckpointStatus(checkpoint) {
  const parts = [];
  pushField(parts, "phase", checkpoint?.phase);
  if (typeof checkpoint?.locked === "boolean") {
    parts.push(checkpoint.locked ? "locked" : "open");
  }
  pushField(parts, "resolve", checkpoint?.resolveState);
  pushField(parts, "advance", checkpoint?.advanceState);
  pushField(parts, "reject", checkpoint?.rejectError);
  pushField(parts, "prompt", checkpoint?.promptId);
  pushField(parts, "stale action", checkpoint?.staleActionId);
  pushField(parts, "setup", checkpoint?.setupPromptStatus);
  pushField(parts, "prompt status", checkpoint?.promptStatusAfter);
  pushField(parts, "original prompt status", checkpoint?.originalPromptStatus);
  pushField(parts, "stream seqs", checkpoint?.streamSeqCount);
  pushField(parts, "action", checkpoint?.actionTemplate);
  pushField(parts, "action", checkpoint?.actionState);
  pushField(parts, "reject state", checkpoint?.rejectState);
  pushField(parts, "reload", checkpoint?.reloadPhase);
  pushField(parts, "template", checkpoint?.templateId);
  if (typeof checkpoint?.actionButtonVisible === "boolean") {
    parts.push(`action button ${checkpoint.actionButtonVisible ? "visible" : "hidden"}`);
  }
  pushField(parts, "normal reject", checkpoint?.normalPlayerDirectReject);
  pushField(parts, "target", checkpoint?.targetSlot);
  if (typeof checkpoint?.targetAlive === "boolean") {
    parts.push(`target ${checkpoint.targetAlive ? "alive" : "dead"}`);
  }
  pushField(parts, "target status", checkpoint?.targetStatus);
  pushField(parts, "receipt", checkpoint?.receiptStatus);
  pushField(parts, "actor", checkpoint?.actorSlot);
  pushField(parts, "vote target", checkpoint?.voteTarget);
  pushField(parts, "vote", checkpoint?.voteState);
  pushField(parts, "current vote", checkpoint?.currentVoteKind);
  pushField(parts, "outcome", checkpoint?.outcomeStatus);
  pushField(parts, "winner", checkpoint?.winnerSlot);
  pushField(parts, "count", checkpoint?.projectedCount);
  pushField(parts, "api phase", checkpoint?.apiPhase);
  pushField(parts, "api target", checkpoint?.apiTarget);
  pushField(parts, "api count", checkpoint?.apiCount);
  pushField(parts, "stale D03 target", checkpoint?.staleD03Target);
  pushField(parts, "stale D03 count", checkpoint?.staleD03Count);
  pushField(parts, "stale D03R1 no-lynch count", checkpoint?.staleD03R1NoLynchCount);
  pushField(parts, "action vote controls", checkpoint?.actionVoteControls);
  pushField(parts, "normal vote controls", checkpoint?.normalVoteControls);
  if (typeof checkpoint?.promptActionVisible === "boolean") {
    parts.push(`prompt action ${checkpoint.promptActionVisible ? "visible" : "hidden"}`);
  }
  if (typeof checkpoint?.setupActionVisible === "boolean") {
    parts.push(`setup action ${checkpoint.setupActionVisible ? "visible" : "hidden"}`);
  }
  if (typeof checkpoint?.promptActionVisibleAfterReject === "boolean") {
    parts.push(
      `post-reject prompt action ${
        checkpoint.promptActionVisibleAfterReject ? "visible" : "hidden"
      }`,
    );
  }
  if (typeof checkpoint?.reloadLocked === "boolean") {
    parts.push(checkpoint.reloadLocked ? "reload locked" : "reload open");
  }
  if (typeof checkpoint?.reloadResolveControlVisible === "boolean") {
    parts.push(
      `reload resolve control ${
        checkpoint.reloadResolveControlVisible ? "visible" : "hidden"
      }`,
    );
  }
  if (typeof checkpoint?.reloadStaleActionVisible === "boolean") {
    parts.push(
      `reload stale action ${
        checkpoint.reloadStaleActionVisible ? "visible" : "hidden"
      }`,
    );
  }
  pushField(parts, "route", checkpoint?.routeResponseStatus);
  pushField(parts, "reject receipt", checkpoint?.rejectReceiptStatus);
  if (typeof checkpoint?.normalPlayerFactionalKillVisible === "boolean") {
    parts.push(
      `normal factional kill ${checkpoint.normalPlayerFactionalKillVisible ? "visible" : "hidden"}`,
    );
  }
  if (typeof checkpoint?.advanceControlVisible === "boolean") {
    parts.push(
      `advance control ${checkpoint.advanceControlVisible ? "visible" : "hidden"}`,
    );
  }
  if (typeof checkpoint?.unlockControlVisible === "boolean") {
    parts.push(
      `unlock control ${checkpoint.unlockControlVisible ? "visible" : "hidden"}`,
    );
  }
  return parts.length === 0 ? "recorded" : parts.join(", ");
}

function pushField(parts, label, value) {
  if (value !== undefined && value !== null && value !== "") {
    parts.push(`${label} ${String(value)}`);
  }
}

function formatSpineLabel(value) {
  return String(value ?? "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
}

export function appendLocalHardeningAudit(audit, proofRun, { game }) {
  const row = normalizeLocalHardeningAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function appendLocalPlayerRecoveryAudit(audit, proofRun, { game }) {
  const row = normalizeLocalPlayerRecoveryAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalPlayerRecoveryAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.some(
      (id) => laneById.get(id)?.status !== "passed",
    ) ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.playerRecovery,
    label: "Local player recovery",
    status: `${LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.length} player recovery lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local player-action recovery proof",
    boundaryDetail:
      "Focused local dev-test-game player action recovery, stale command, reload, and conflict lanes without hosted multiplayer claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.playerRecovery,
    }),
    checks: Object.freeze(
      LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.map((id) => {
        const lane = laneById.get(id);
        return Object.freeze({
          id,
          status: localPlayerRecoveryLaneStatus(lane),
        });
      }),
    ),
    relatedLinks: Object.freeze([
      Object.freeze({
        id: localAdminAuditIds.coreLoop,
        label: "Core loop",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.coreLoop }),
        status: "source proof",
        command: "test:dev-test-game-core-loop-admin-proof",
      }),
      Object.freeze({
        id: localAdminAuditIds.hardening,
        label: "Multiplayer hardening",
        href: adminAuditInspectHref({ game, audit: localAdminAuditIds.hardening }),
        status: "parent proof",
        command: "test:dev-test-game-hardening-admin-proof",
      }),
    ]),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      playerRecoveryLaneCount: LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.length,
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

function localPlayerRecoveryLaneStatus(lane) {
  if (
    [
      playerActionLoopLaneId,
      playerInvalidActionRecoveryLaneId,
      "dead-player-recovery",
      playerActionBoundaryLaneId,
    ].includes(lane?.id)
  ) {
    return coreLoopLaneStatus(lane);
  }
  return hardeningLaneStatus(lane);
}

export function normalizeLocalHardeningAudit(proofRun, { game }) {
  if (
    proofRun === null ||
    typeof proofRun !== "object" ||
    proofRun.version !== 1 ||
    proofRun.proof !== "dev-test-game-proof-run" ||
    proofRun.status !== "passed" ||
    proofRun.scope !== "local-dev-test-game-harness" ||
    proofRun.releaseReady !== false ||
    proofRun.productionReady !== false
  ) {
    return null;
  }
  const requiredLaneIds = hardeningAuditLaneIds;
  const lanes = Array.isArray(proofRun.lanes) ? proofRun.lanes : [];
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  if (
    requiredLaneIds.some((id) => laneById.get(id)?.status !== "passed") ||
    proofRun.session?.verificationStatus !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    id: localAdminAuditIds.hardening,
    label: "Local multiplayer hardening",
    status: `${requiredLaneIds.length} hardening lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local multiplayer-hardening proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run hardening lanes without exhaustive race claims.",
    href: proofRun.artifacts?.proofRun ?? devTestGameProofRunPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.hardening,
    }),
    checks: Object.freeze(
      requiredLaneIds.map((id) => {
        const lane = laneById.get(id);
        return Object.freeze({
          id,
          status: hardeningLaneStatus(lane),
        });
      }),
    ),
    artifactSummary: Object.freeze({
      game: String(proofRun.session?.game ?? ""),
      roleCount: Array.isArray(proofRun.session?.roles)
        ? proofRun.session.roles.length
        : 0,
      laneCount: lanes.length,
      releaseReady: proofRun.releaseReady === true,
      productionReady: proofRun.productionReady === true,
    }),
  });
}

export function appendLocalBackupRestoreAudit(audit, backupRestoreProof, { game }) {
  const row = normalizeLocalBackupRestoreAudit(backupRestoreProof, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalBackupRestoreAudit(backupRestoreProof, { game }) {
  if (
    backupRestoreProof === null ||
    typeof backupRestoreProof !== "object" ||
    backupRestoreProof.version !== 1 ||
    backupRestoreProof.status !== "passed" ||
    backupRestoreProof.scope !== "local-live-stack-backup-restore-drill" ||
    backupRestoreProof.productionReady !== false
  ) {
    return null;
  }
  const checks = Array.isArray(backupRestoreProof.checks)
    ? backupRestoreProof.checks
    : [];
  const requiredChecks = [
    "dump-created",
    "event-log-restored",
    "projection-fingerprints-restored",
    "auth-sessions-restored",
    "restored-api-capabilities",
  ];
  const checkStatus = new Map(checks.map((check) => [check.id, check.status]));
  if (requiredChecks.some((id) => checkStatus.get(id) !== "passed")) {
    return null;
  }
  const sessions = Object.entries(
    backupRestoreProof.restoredApiEvidence?.restoredSessions ?? {},
  ).map(([role, capabilities]) =>
    Object.freeze({
      role,
      capabilities: Array.isArray(capabilities)
        ? Object.freeze(capabilities.map((capability) => String(capability)))
        : Object.freeze([]),
    }),
  );
  return Object.freeze({
    id: localAdminAuditIds.backupRestore,
    label: "Local backup restore",
    status: `${requiredChecks.length} backup restore checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local backup/restore drill",
    boundaryDetail:
      backupRestoreProof.proofBoundary ??
      "Local disposable Postgres backup/restore proof without production backup claims.",
    href:
      backupRestoreProof.artifact?.proof ??
      devTestGameBackupRestoreProofPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.backupRestore,
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
        }),
      ),
    ),
    sessions: Object.freeze(sessions),
    artifactSummary: Object.freeze({
      game: String(backupRestoreProof.game ?? ""),
      dump:
        backupRestoreProof.artifact?.dump ??
        devTestGameBackupRestoreDumpPath,
      eventRows: Number(backupRestoreProof.fingerprints?.source?.events?.total ?? 0),
      restoredEventRows: Number(
        backupRestoreProof.fingerprints?.restored?.events?.total ?? 0,
      ),
      sessionCount: sessions.length,
      productionReady: backupRestoreProof.productionReady === true,
    }),
  });
}

export function appendLocalIdentityAdapterAudit(audit, identityAdapterProof, { game }) {
  const row = normalizeLocalIdentityAdapterAudit(identityAdapterProof, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalIdentityAdapterAudit(identityAdapterProof, { game }) {
  if (
    identityAdapterProof === null ||
    typeof identityAdapterProof !== "object" ||
    identityAdapterProof.version !== devTestGameIdentityAdapterProofVersion ||
    identityAdapterProof.proof !== "auth-invite-role-proof" ||
    identityAdapterProof.status !== "passed" ||
    identityAdapterProof.scope !== "local-auth-invite-role-proof" ||
    identityAdapterProof.releaseReady !== false ||
    identityAdapterProof.productionReady !== false ||
    identityAdapterProof.identityAdapter?.replacesDevTokensWithoutRoleSurfaceChange !== true ||
    devTestGameIdentityAdapterContractDiff(
      identityAdapterProof.identityAdapterContract,
    ).status !== "passed"
  ) {
    return null;
  }
  const requiredRoleCapabilities = new Map([
    ["admin", "GlobalAdmin"],
    ["host", "HostOf"],
    ["player", "SlotOccupant"],
  ]);
  for (const [role, capability] of requiredRoleCapabilities) {
    if (!identityAdapterProof.roles?.[role]?.capabilityKinds?.includes(capability)) {
      return null;
    }
  }
  const roles = Object.entries(identityAdapterProof.roles ?? {}).map(([role, entry]) =>
    Object.freeze({
      role,
      capabilities: Array.isArray(entry?.capabilityKinds)
        ? Object.freeze(entry.capabilityKinds.map((capability) => String(capability)))
        : Object.freeze([]),
    }),
  );
  const lifecycleChecks = [
    ["account-login", identityAdapterProof.identityLifecycle?.accountLogin?.status],
    [
      "account-lifecycle",
      identityAdapterProof.identityLifecycle?.accountLifecycle?.status,
    ],
    ["session-rotation", identityAdapterProof.identityLifecycle?.sessionRotation?.status],
    ["session-revocation", identityAdapterProof.identityLifecycle?.sessionRevocation?.status],
    ["invite-revocation", identityAdapterProof.identityLifecycle?.inviteRevocation?.status],
    [
      "host-scoped-invite-issuance",
      identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.status,
    ],
    ["audit-trail", identityAdapterProof.identityLifecycle?.auditTrail?.status],
    [
      "admin-audit-surface",
      identityAdapterProof.identityLifecycle?.adminAuditSurface?.status,
    ],
  ];
  if (
    roles.length === 0 ||
    lifecycleChecks.some(([, status]) => status !== "passed") ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.hostRoleSurface !==
      `/g/${identityAdapterProof.game}/host` ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.hostAction !==
      "?/issuePlayerInvite" ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.clickedThroughFromHostRoleUrl !== true ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.issuedByPrincipalUserId !== "host_h" ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.issuedForGame !==
      identityAdapterProof.game ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.storedGameScope !==
      identityAdapterProof.game ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance
      ?.globalCapabilitiesGranted !== 0 ||
    identityAdapterProof.identityLifecycle?.hostScopedInviteIssuance?.rawInviteTokenStored !==
      false ||
    identityAdapterProof.identityLifecycle?.accountLogin?.principalUserId !== "host_h" ||
    !identityAdapterProof.identityLifecycle?.accountLogin?.capabilityKinds?.includes(
      "HostOf",
    ) ||
    identityAdapterProof.identityLifecycle?.accountLogin?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountLogin?.rawPasswordStored !== false ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface?.status !==
      "passed" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.controlsTestId !== "admin-identity-account-controls" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.visitedDetailRoleUrl !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.disabledStatus !==
      "disabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.enabledStatus !==
      "enabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.disabledAccountRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.staleAccountSessionRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.staleAdminControlRejected !==
      true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle
      ?.staleAdminControlReloadRecovered !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryStatus !== "disabled" ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
      ?.reloadRecoveryDetailRoleUrl !==
      "/admin/audit/identity-lifecycle?game=<seeded-game>&principal_user_id=host_h" ||
    !String(
      identityAdapterProof.identityLifecycle?.accountLifecycle?.adminControlSurface
        ?.reloadRecoveryTargetText ?? "",
    ).includes("disabled") ||
    !identityAdapterProof.identityLifecycle?.accountLifecycle?.recoveryCapabilityKinds?.includes(
      "HostOf",
    ) ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.sameRoleSurface !== true ||
    identityAdapterProof.identityLifecycle?.accountLifecycle?.rawPasswordStored !== false ||
    identityAdapterProof.identityLifecycle?.auditTrail?.rawTokensStored !== false ||
    identityAdapterProof.identityLifecycle?.adminAuditSurface?.rawTokensVisible !== false
  ) {
    return null;
  }
  const controls = Array.isArray(identityAdapterProof.identityAdapter?.lifecycleControls)
    ? identityAdapterProof.identityAdapter.lifecycleControls
    : [];
  return Object.freeze({
    id: localAdminAuditIds.identityAdapter,
    label: "Local identity adapter",
    status: `${roles.length} role surfaces, ${controls.length} lifecycle controls`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local production-identity adapter proof",
    boundaryDetail:
      identityAdapterProof.proofBoundary ??
      "Local invite/session identity adapter proof without hosted account claims.",
    href: devTestGameIdentityAdapterProofPath,
    inspectHref: adminAuditInspectHref({
      game,
      audit: localAdminAuditIds.identityAdapter,
    }),
    checks: Object.freeze(
      lifecycleChecks.map(([id, status]) =>
        Object.freeze({
          id,
          status: String(status),
        }),
      ),
    ),
    sessions: Object.freeze(roles),
    artifactSummary: Object.freeze({
      game: String(identityAdapterProof.game ?? ""),
      adapterContract: normalizeIdentityAdapterContractSummary(
        identityAdapterProof.identityAdapterContract,
        identityAdapterProof.identityAdapterContractDiff,
      ),
      browserCookieName: String(identityAdapterProof.identityAdapter?.browserCookieName ?? ""),
      inviteCredentialKind: String(
        identityAdapterProof.identityAdapter?.inviteCredentialKind ?? "",
      ),
      sessionCredentialKind: String(
        identityAdapterProof.identityAdapter?.sessionCredentialKind ?? "",
      ),
      accountCredentialKind: String(
        identityAdapterProof.identityAdapter?.accountCredentialKind ?? "",
      ),
      lifecycleControls: Object.freeze(controls.map((control) => String(control))),
      delegatedIssuanceControls: Object.freeze(
        (Array.isArray(identityAdapterProof.identityAdapter?.delegatedIssuanceControls)
          ? identityAdapterProof.identityAdapter.delegatedIssuanceControls
          : []
        ).map((control) => String(control)),
      ),
      hostScopedInvite: Object.freeze({
        issuedByPrincipalUserId: String(
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
            ?.issuedByPrincipalUserId ?? "",
        ),
        issuedForGame: String(
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance?.issuedForGame ??
            "",
        ),
        storedGameScope: String(
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
            ?.storedGameScope ?? "",
        ),
        globalCapabilitiesGranted:
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
            ?.globalCapabilitiesGranted ?? null,
        hostRoleSurface: String(
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
            ?.hostRoleSurface ?? "",
        ),
        hostAction: String(
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance?.hostAction ?? "",
        ),
        clickedThroughFromHostRoleUrl:
          identityAdapterProof.identityLifecycle.hostScopedInviteIssuance
            ?.clickedThroughFromHostRoleUrl === true,
      }),
      accountLogin: Object.freeze({
        principalUserId: String(
          identityAdapterProof.identityLifecycle.accountLogin?.principalUserId ?? "",
        ),
        accountId: String(
          identityAdapterProof.identityLifecycle.accountLogin?.accountId ?? "",
        ),
        sameRoleSurface:
          identityAdapterProof.identityLifecycle.accountLogin?.sameRoleSurface === true,
        cookieValuePrefix: String(
          identityAdapterProof.identityLifecycle.accountLogin?.cookieValuePrefix ?? "",
        ),
        rawPasswordStored:
          identityAdapterProof.identityLifecycle.accountLogin?.rawPasswordStored === true,
      }),
      accountLifecycle: Object.freeze({
        disabledStatus: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.disabledStatus ?? "",
        ),
        enabledStatus: String(
          identityAdapterProof.identityLifecycle.accountLifecycle?.enabledStatus ?? "",
        ),
        disabledAccountRejected:
          identityAdapterProof.identityLifecycle.accountLifecycle
            ?.disabledAccountRejected === true,
        staleAccountSessionRejected:
          identityAdapterProof.identityLifecycle.accountLifecycle
            ?.staleAccountSessionRejected === true,
        staleAdminControlRejected:
          identityAdapterProof.identityLifecycle.accountLifecycle
            ?.staleAdminControlRejected === true,
        staleAdminControlReloadRecovered:
          identityAdapterProof.identityLifecycle.accountLifecycle
            ?.staleAdminControlReloadRecovered === true,
        sameRoleSurface:
          identityAdapterProof.identityLifecycle.accountLifecycle?.sameRoleSurface === true,
        revokedSessionCount:
          identityAdapterProof.identityLifecycle.accountLifecycle?.revokedSessionCount ??
          null,
        adminControlSurface: Object.freeze({
          detailRoleUrl: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.detailRoleUrl ?? "",
          ),
          controlsTestId: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.controlsTestId ?? "",
          ),
          visitedDetailRoleUrl:
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.visitedDetailRoleUrl === true,
          staleConflictStatusText: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.staleConflictStatusText ?? "",
          ),
          reloadRecoveryStatus: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.reloadRecoveryStatus ?? "",
          ),
          reloadRecoveryDetailRoleUrl: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.reloadRecoveryDetailRoleUrl ?? "",
          ),
          reloadRecoveryTargetText: String(
            identityAdapterProof.identityLifecycle.accountLifecycle?.adminControlSurface
              ?.reloadRecoveryTargetText ?? "",
          ),
        }),
        rawPasswordStored:
          identityAdapterProof.identityLifecycle.accountLifecycle?.rawPasswordStored === true,
      }),
      rawTokensStored: identityAdapterProof.identityLifecycle.auditTrail.rawTokensStored,
      rawTokensVisible:
        identityAdapterProof.identityLifecycle.adminAuditSurface.rawTokensVisible,
      releaseReady: identityAdapterProof.releaseReady === true,
      productionReady: identityAdapterProof.productionReady === true,
    }),
  });
}

function normalizeIdentityAdapterContractSummary(packet, diff) {
  const computedDiff = devTestGameIdentityAdapterContractDiff(packet);
  const sourceDiff =
    diff !== null && typeof diff === "object" ? diff : computedDiff;
  return Object.freeze({
    status: String(packet?.status ?? "unknown"),
    adapterId: String(packet?.adapterId ?? sourceDiff.adapterId ?? ""),
    roleSurfaceArchitectureChanged:
      packet?.roleSurfaceArchitectureChanged === true,
    roleSurfaceContractStatus: String(
      sourceDiff.roleSurfaceContractDiff?.status ?? "unknown",
    ),
    mismatchCount: Array.isArray(sourceDiff.mismatches)
      ? sourceDiff.mismatches.length
      : 0,
    mismatches: Object.freeze(
      (Array.isArray(sourceDiff.mismatches) ? sourceDiff.mismatches : []).map(
        (mismatch) =>
          Object.freeze({
            id: String(mismatch.id ?? ""),
            path: String(mismatch.path ?? ""),
          }),
      ),
    ),
  });
}

export function adminAuditInspectHref({ game, audit }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin/audit/${encodeURIComponent(
    normalizeRoutePart(audit, "audit"),
  )}?${params.toString()}`;
}

export function adminOverviewHref({ game }) {
  const params = new URLSearchParams({
    game: normalizeRoutePart(game, "game"),
  });
  return `/admin?${params.toString()}`;
}

function requiredAuditId(audit) {
  return normalizeRoutePart(audit, "audit");
}

function normalizeRoutePart(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`admin ${field} must be a non-empty string`);
  }
  return value;
}
