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
  coreLoopAuditLaneIds,
} from "../../../../tools/dev_test_game_core_loop_scenarios.mjs";

export const ADMIN_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "admin-surface",
  capabilityTestId: "admin-capability",
  requiredText: "Operations",
});

export const LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS = Object.freeze([
  "action-loop",
  "invalid-action-recovery",
  "dead-player-recovery",
  "player-action-boundary",
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
  "concurrent-player-complete-race",
  "public-player-complete-reload",
  "stale-player-complete",
  "stale-player-complete-reload",
  "stale-dead-action-conflict",
  "stale-same-action-recovery",
  "stale-action-conflict",
  "stale-action-reconnect-recovery",
  "stale-action-conflict-message",
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
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
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
                            { game },
                          ),
                          spineManifest,
                          { game },
                        ),
                        adminSpineProof,
                        { game },
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
  proofGraph = null,
  raceCoverage = null,
  hostedConcurrentRaceMatrix = null,
  hostedOpsSignals = null,
  hostedTargetPreflight = null,
  hostedEvidenceLane = null,
  hostedEvidenceLaneDemoProof = null,
  hostedIdentityEvidence = null,
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
    proofGraph,
    raceCoverage,
    hostedConcurrentRaceMatrix,
    hostedOpsSignals,
    hostedTargetPreflight,
    hostedEvidenceLane,
    hostedEvidenceLaneDemoProof,
    hostedIdentityEvidence,
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
  return Object.freeze({
    id: "local-hosted-target-preflight",
    label: "Hosted target preflight",
    status: `${passedChecks.length} passed, ${blockedChecks.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted target preflight",
    boundaryDetail:
      hostedTargetPreflight.proofBoundary ??
      "Hosted target preflight without hosted deployment or release claims.",
    href: "target/dev-test-game/hosted-target-preflight.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-hosted-target-preflight",
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
        id: "local-hosted-concurrent-race-matrix",
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: "local-hosted-concurrent-race-matrix",
        }),
        status: String(hostedTargetPreflight.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: "local-next-action",
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: "local-next-action" }),
        status: String(hostedTargetPreflight.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
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
  { game },
) {
  const row = normalizeLocalHostedIdentityEvidenceAudit(hostedIdentityEvidence, {
    game,
  });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalHostedIdentityEvidenceAudit(
  hostedIdentityEvidence,
  { game },
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
  return Object.freeze({
    id: "local-hosted-identity-evidence",
    label: "Hosted identity evidence",
    status: `${hostedIdentityEvidence.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted identity evidence handoff",
    boundaryDetail:
      hostedIdentityEvidence.proofBoundary ??
      "Hosted identity evidence handoff without hosted identity or release claims.",
    href: "target/dev-test-game/hosted-identity-evidence.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-hosted-identity-evidence",
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
        id: "local-identity-adapter",
        label: "Local identity adapter",
        href: adminAuditInspectHref({
          game,
          audit: "local-identity-adapter",
        }),
        status: "prerequisite",
        command: "test:dev-test-game-identity-admin-proof",
      }),
      Object.freeze({
        id: "local-next-action",
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: "local-next-action" }),
        status: String(hostedIdentityEvidence.status ?? "unknown"),
        command: "test:dev-test-game-next-action",
      }),
    ]),
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
    }),
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
  const realHostedEvidenceInputs = normalizeRealHostedEvidenceInputs(
    hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs,
  );
  const hostedHandoffChecklist = normalizeHostedEvidenceLaneHandoffChecklist({
    hostedEvidenceLane,
    blockedChecks: checks.filter((check) => blockedCheckIdSet.has(String(check.id))),
    realHostedEvidenceInputs,
  });
  return Object.freeze({
    id: "local-hosted-evidence-lane",
    label: "Hosted evidence lane",
    status: `${hostedEvidenceLane.status}: ${passedChecks.length} passed, ${blockedCheckIds.length} blocked`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Hosted evidence lane",
    boundaryDetail:
      hostedEvidenceLane.proofBoundary ??
      "Hosted evidence lane without hosted deployment or release claims.",
    href: "target/dev-test-game/hosted-evidence-lane.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-hosted-evidence-lane",
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
        id: "local-hosted-target-preflight",
        label: "Hosted target preflight",
        href: adminAuditInspectHref({
          game,
          audit: "local-hosted-target-preflight",
        }),
        status: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-target-preflight",
      }),
      Object.freeze({
        id: "local-hosted-concurrent-race-matrix",
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: "local-hosted-concurrent-race-matrix",
        }),
        status: String(hostedEvidenceLane.target?.rawEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: "local-next-action",
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: "local-next-action" }),
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
  return Object.freeze({
    status: String(hostedEvidenceLane.status ?? "unknown"),
    preflightStatus: String(hostedEvidenceLane.preflightStatus ?? "unknown"),
    command: String(
      hostedEvidenceLane.hostedEvidence?.realHostedEvidenceInputs?.command ??
        hostedEvidenceLane.nextCommand ??
        "",
    ),
    proofTarget: String(
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
          id: String(check.id),
          status: "blocked",
          requiredEvidence: String(check.requiredEvidence ?? ""),
        }),
      ),
    ),
  });
}

function normalizeLocalHostedEvidenceLaneDemoProofSummary(proof) {
  if (
    proof === null ||
    typeof proof !== "object" ||
    proof.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-evidence-lane-demo-proof" ||
    proof.status !== "passed" ||
    proof.scope !== "local-dev-test-game-hosted-evidence-lane-demo-proof" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.target?.syntheticExternalTarget !== true ||
    proof.blockedLane?.status !== "blocked" ||
    proof.passedLane?.status !== "passed"
  ) {
    return null;
  }
  return Object.freeze({
    demoProofStatus: String(proof.status),
    demoProofTarget: "target/dev-test-game/hosted-evidence-lane-demo-proof.json",
    demoOnly: true,
    syntheticExternalTarget: true,
    demoBlockedLaneStatus: String(proof.blockedLane.status),
    demoPassedLaneStatus: String(proof.passedLane.status),
    demoExternalEvidencePath: String(proof.generatedFrom?.externalEvidence ?? ""),
    demoPassedRoleUrl: String(proof.handoff?.passedRoleUrl ?? ""),
  });
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
    id: "local-hosted-ops-signals",
    label: "Local hosted ops signals",
    status: `${passedChecks.length} hosted-like ops signals passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like ops signal bundle",
    boundaryDetail:
      hostedOpsSignals.proofBoundary ??
      "Local hosted-like ops signal bundle without hosted telemetry or release claims.",
    href: "target/dev-test-game/hosted-ops-signals.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-hosted-ops-signals" }),
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
        id: "local-hosted-concurrent-race-matrix",
        label: "Hosted matrix",
        href: adminAuditInspectHref({
          game,
          audit: "local-hosted-concurrent-race-matrix",
        }),
        status: String(hostedOpsSignals.matrix?.hostedEvidenceStatus ?? "unknown"),
        command: "test:dev-test-game-hosted-concurrent-race-matrix",
      }),
      Object.freeze({
        id: "local-ops-artifacts",
        label: "Ops artifacts",
        href: adminAuditInspectHref({ game, audit: "local-ops-artifacts" }),
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
  return Object.freeze({
    id: "local-hosted-concurrent-race-matrix",
    label: "Local hosted matrix",
    status: `${Number(
      hostedConcurrentRaceMatrix.summary?.passedCellCount ?? 0,
    )} hosted-like race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local hosted-like concurrency matrix",
    boundaryDetail:
      hostedConcurrentRaceMatrix.proofBoundary ??
      "Local hosted-like concurrency matrix without hosted deployment or release claims.",
    href: "target/dev-test-game/hosted-concurrent-race-matrix.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-hosted-concurrent-race-matrix",
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
        id: "local-race-coverage",
        label: "Race coverage",
        href: adminAuditInspectHref({ game, audit: "local-race-coverage" }),
        status: String(
          hostedConcurrentRaceMatrix.generatedFrom?.raceCoveragePromotedMilestones
            ?.status ?? "unknown",
        ),
        command: "test:dev-test-game-race-coverage",
      }),
      Object.freeze({
        id: "local-next-action",
        label: "Ranked next action",
        href: adminAuditInspectHref({ game, audit: "local-next-action" }),
        status: String(requestedEvidence?.status ?? "unknown"),
        command: String(hostedConcurrentRaceMatrix.nextBuildSlice?.command ?? ""),
      }),
    ]),
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
    artifactSummary: Object.freeze({
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
    id: "local-race-coverage",
    label: "Local race coverage",
    status: `${passedCells.length} race cells passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local race-coverage inventory",
    boundaryDetail:
      raceCoverage.proofBoundary ??
      "Generated local race-coverage inventory without hosted concurrency claims.",
    href: "target/dev-test-game/race-coverage.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-race-coverage" }),
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
    id: "local-proof-graph",
    label: "Local proof graph",
    status: `${nodes.length} proof nodes, ${edges.length} edges`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine proof graph",
    boundaryDetail:
      proofGraph.proofBoundary ??
      "Generated local proof graph without hosted or release-readiness claims.",
    href: "target/dev-test-game/proof-graph.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-proof-graph" }),
    checks: Object.freeze(
      [
        ...nodes.map((node) => ({
          id: String(node.id),
          status: String(node.status ?? "recorded"),
        })),
        ...edges.map((edge) => ({
          id: proofGraphEdgeCheckId(edge),
          status: String(edge.relationship ?? "recorded"),
        })),
      ].map((check) => Object.freeze(check)),
    ),
    relatedLinks: Object.freeze(
      roleNodes.map((node) =>
        Object.freeze({
          id: String(node.id),
          label: String(node.label ?? node.id),
          href: seededRoleUrlToAdminHref(node.roleUrl, { game }),
          status: String(node.status ?? "recorded"),
          command: String(node.recoveryCommand ?? node.proofCommand ?? ""),
        }),
      ),
    ),
    artifactSummary: Object.freeze({
      nodeCount: Number(proofGraph.summary?.nodeCount ?? nodes.length),
      edgeCount: Number(proofGraph.summary?.edgeCount ?? edges.length),
      roleUrlCount: Number(proofGraph.summary?.roleUrlCount ?? roleNodes.length),
      recoveryTargetCount: Number(proofGraph.summary?.recoveryTargetCount ?? 0),
      releaseReady: proofGraph.releaseReady === true,
      productionReady: proofGraph.productionReady === true,
    }),
  });
}

function proofGraphEdgeCheckId(edge) {
  return `edge:${String(edge?.from ?? "")}:${String(
    edge?.relationship ?? "related",
  )}:${String(edge?.to ?? "")}`;
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
  const selectionTrace = normalizeNextActionSelectionTrace(nextAction.selectionTrace);
  const releaseReadinessTrace = normalizeNextActionReleaseReadinessTrace(
    nextAction.releaseReadinessTrace,
  );
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
    ...(selectedProofGraphNode === null
      ? []
      : [
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
        ]),
    ...(selectedSpineTarget.checkpointId === ""
      ? []
      : [
          Object.freeze({
            id: "selected-feature-spine-declaration",
            status: `${selectedProductionFeatureSpineTarget.featureSlotId}:${selectedProductionFeatureSpineTarget.cycleId}/${selectedProductionFeatureSpineTarget.checkpointId}/${selectedProductionFeatureSpineTarget.roleUrlId}/${selectedProductionFeatureSpineTarget.adminCheckId}`,
          }),
          Object.freeze({
            id: "selected-spine-target",
            status: `${selectedSpineTarget.cycleId}/${selectedSpineTarget.checkpointId}/${selectedSpineTarget.roleUrlId}/${selectedSpineTarget.adminCheckId}`,
          }),
          Object.freeze({
            id: "selected-spine-drilldown",
            status: `${selectedSpineDrilldown.featureSlotId}:${selectedSpineDrilldown.cycleRowId}/${selectedSpineDrilldown.checkpointRowId}/${selectedSpineDrilldown.roleUrlRowId}/${selectedSpineDrilldown.adminCheckId}`,
          }),
          Object.freeze({
            id: "selected-spine-admin-check",
            status: selectedSpineDrilldown.adminCheckId,
          }),
          Object.freeze({
            id: "selected-spine-rerun-command",
            status: selectedSpineDrilldown.rerunCommand,
          }),
          Object.freeze({
            id: "selected-spine-browser-proof",
            status: selectedSpineTarget.browserProofCommand,
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
    ...(seedProofLaneCoverage === null
      ? []
      : [
          Object.freeze({
            id: "seed-proof-lane-coverage",
            status: `${Number(
              seedProofLaneCoverage.unclassifiedLaneCount ?? 0,
            )} unclassified lanes`,
          }),
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
    ...(seedProofLaneCoverageTrace.status === "unavailable"
      ? []
      : [
          Object.freeze({
            id: "seed-proof-lane-coverage-trace",
            status: `${seedProofLaneCoverageTrace.unclassifiedLaneCount} unclassified lanes`,
          }),
          ...seedProofLaneCoverageTrace.unclassifiedLaneIds.map((laneId) =>
            Object.freeze({
              id: `seed-proof-lane-coverage-${laneId}`,
              status: "unclassified",
            }),
          ),
        ]),
    ...(localReadinessDependencyTrace.candidateCount === 0
      ? []
      : [
          Object.freeze({
            id: "local-readiness-dependency-trace",
            status: `${localReadinessDependencyTrace.candidateCount} missing local dependencies`,
          }),
          ...localReadinessDependencyTrace.candidates.map((candidate) =>
            Object.freeze({
              id: `local-readiness-dependency-${candidate.id}`,
              status: candidate.selected
                ? `selected:${candidate.status}`
                : `rank-${candidate.rank}:${candidate.status}`,
            }),
          ),
        ]),
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
    ...staleConflictMessageTrace.laneIds.map((laneId) =>
      Object.freeze({
        id: `stale-conflict-message-${laneId}`,
        status: staleConflictMessageTrace.status,
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
  const freshnessSummary = nextAction.generatedFrom?.artifactFreshnessSummary ?? {};
  const releaseReadinessSummary =
    nextAction.generatedFrom?.releaseReadinessSummary ?? {};
  return Object.freeze({
    id: "local-next-action",
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
    href: "target/dev-test-game/next-action.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-next-action" }),
    checks: Object.freeze(checks),
    relatedLinks:
      unprovenRoleUrl === "" &&
      localCheckRoleUrl === "" &&
      seedProofLaneCoverageRoleUrl === "" &&
      selectedProofGraphNode === null
        ? Object.freeze([])
        : Object.freeze([
            ...(selectedProofGraphNode === null
              ? []
              : [
                  Object.freeze({
                    id: "selected-proof-graph-node",
                    label: selectedProofGraphNode.id,
                    href: adminAuditInspectHref({ game, audit: "local-proof-graph" }),
                    status: selectedProofGraphNode.status,
                    command: selectedProofGraphNode.proofCommand,
                  }),
                ]),
            ...(unprovenRoleUrl === ""
              ? []
              : [
                  Object.freeze({
                    id: unprovenProofGraphNodeId || String(unproven.id),
                    label: String(unproven.id ?? "Selected role surface"),
                    href: seededRoleUrlToAdminHref(unprovenRoleUrl, { game }),
                    status: String(unproven.status ?? actionStatus),
                    command,
                  }),
                ]),
            ...(localCheckRoleUrl === ""
              ? []
              : [
                  Object.freeze({
                    id: String(localCheck.id ?? "local-readiness-dependency"),
                    label: String(localCheck.id ?? "Local readiness dependency"),
                    href: seededRoleUrlToAdminHref(localCheckRoleUrl, { game }),
                    status: String(localCheck.status ?? actionStatus),
                    command,
                  }),
                ]),
            ...(seedProofLaneCoverageRoleUrl === ""
              ? []
              : [
                  Object.freeze({
                    id: "seed-proof-lane-coverage",
                    label: "Seed proof-lane coverage",
                    href: seededRoleUrlToAdminHref(seedProofLaneCoverageRoleUrl, {
                      game,
                    }),
                    status: String(seedProofLaneCoverage.status ?? actionStatus),
                    command,
                  }),
                ]),
          ]),
    realHostedEvidenceInputs,
    ...(hostedHandoffChecklist === null ? {} : { hostedHandoffChecklist }),
    artifactSummary: Object.freeze({
      command,
      reason,
      actionStatus,
      sourceManifest: String(nextAction.generatedFrom?.spineManifest ?? ""),
      artifactFreshnessStatus: String(
        nextAction.generatedFrom?.artifactFreshnessStatus ?? "unknown",
      ),
      artifactCount: Number(freshnessSummary.artifactCount ?? 0),
      freshCount: Number(freshnessSummary.freshCount ?? 0),
      staleCount: Number(freshnessSummary.staleCount ?? 0),
      missingCount: Number(freshnessSummary.missingCount ?? 0),
      selectionTrace,
      releaseReadinessChecklist: String(
        nextAction.generatedFrom?.releaseReadinessChecklist ?? "",
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
      selectedUnprovenId: String(unproven?.id ?? ""),
      selectedBuildSlice: String(unproven?.buildSlice ?? ""),
      selectedProofTarget: String(unproven?.proofTarget ?? ""),
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
          : adminAuditInspectHref({ game, audit: "local-proof-graph" }),
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
    groups: normalizeHostedHandoffGroups(checklist.requirementGroups),
  });
}

function hostedIdentityHandoffInputValue({ id, hostedIdentityEvidence }) {
  return id === "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH"
    ? String(
        hostedIdentityEvidence.hostedHandoffChecklist?.placeholderFixturePath ??
          hostedIdentityEvidence.target?.placeholderFixturePath ??
          "required",
      )
    : "required";
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
        roleUrl: String(candidate.roleUrl ?? ""),
        proofGraphNodeId: String(candidate.proofGraphNodeId ?? ""),
        productionFeatureSpineTarget: normalizeNextActionFeatureSpineDeclaration(
          candidate.productionFeatureSpineTarget,
        ),
        spineDrilldown: normalizeNextActionSpineDrilldown(
          candidate.spineDrilldown,
        ),
        spineTarget: normalizeNextActionSpineTarget(candidate.spineTarget),
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
      checkpointId: "",
      adminCheckId: "",
      browserProofCommand: "",
    });
  }
  return Object.freeze({
    sourceCheckId: String(spineTarget.sourceCheckId ?? ""),
    featureSlotId: String(spineTarget.featureSlotId ?? ""),
    detailRoleUrl: String(spineTarget.detailRoleUrl ?? ""),
    cycleId: String(spineTarget.cycleId ?? ""),
    roleUrlId: String(spineTarget.roleUrlId ?? ""),
    roleUrl: String(spineTarget.roleUrl ?? ""),
    checkpointId: String(spineTarget.checkpointId ?? ""),
    adminCheckId: String(spineTarget.adminCheckId ?? ""),
    browserProofCommand: String(spineTarget.browserProofCommand ?? ""),
  });
}

function normalizeNextActionFeatureSpineDeclaration(declaration) {
  if (declaration === null || typeof declaration !== "object") {
    return Object.freeze({
      sourceCheckId: "",
      featureSlotId: "",
      cycleId: "",
      roleUrlId: "",
      checkpointId: "",
      adminCheckId: "",
    });
  }
  return Object.freeze({
    sourceCheckId: String(declaration.sourceCheckId ?? ""),
    featureSlotId: String(declaration.featureSlotId ?? ""),
    cycleId: String(declaration.cycleId ?? ""),
    roleUrlId: String(declaration.roleUrlId ?? ""),
    checkpointId: String(declaration.checkpointId ?? ""),
    adminCheckId: String(declaration.adminCheckId ?? ""),
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
      checkpointRowId: "",
      adminCheckId: "",
      roleUrl: "",
      rerunCommand: "",
      browserProofCommand: "",
    });
  }
  return Object.freeze({
    featureSlotId: String(drilldown.featureSlotId ?? ""),
    sourceCheckId: String(drilldown.sourceCheckId ?? ""),
    detailRoleUrl: String(drilldown.detailRoleUrl ?? ""),
    cycleRowId: String(drilldown.cycleRowId ?? ""),
    roleUrlRowId: String(drilldown.roleUrlRowId ?? ""),
    checkpointRowId: String(drilldown.checkpointRowId ?? ""),
    adminCheckId: String(drilldown.adminCheckId ?? ""),
    roleUrl: String(drilldown.roleUrl ?? ""),
    rerunCommand: String(drilldown.rerunCommand ?? ""),
    browserProofCommand: String(drilldown.browserProofCommand ?? ""),
  });
}

function normalizeRealHostedEvidenceInputs(inputs) {
  if (inputs === null || typeof inputs !== "object") {
    return Object.freeze([]);
  }
  const env = Array.isArray(inputs.env) ? inputs.env : [];
  const rows = [
    Object.freeze({
      id: "command",
      label: "Command",
      value: String(inputs.command ?? ""),
      required: true,
    }),
    Object.freeze({
      id: "proof-target",
      label: "Proof target",
      value: String(inputs.proofTarget ?? ""),
      required: true,
    }),
    ...env.map((item) =>
      Object.freeze({
        id: String(item?.name ?? ""),
        label: String(item?.name ?? ""),
        value: String(item?.description ?? ""),
        required: item?.required === true,
      }),
    ),
  ].filter((item) => item.id !== "" && item.value !== "");
  return Object.freeze(rows);
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
          id: "local-next-action",
          label: "Ranked next action",
          href: nextActionRow.inspectHref,
          status: nextActionRow.status,
          command: nextActionRow.artifactSummary.command,
        });
  return Object.freeze({
    id: "local-proof-freshness",
    label: "Local proof freshness",
    status: `${Number(summary.freshCount ?? 0)} fresh, ${Number(
      summary.staleCount ?? 0,
    )} stale, ${Number(summary.missingCount ?? 0)} missing`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local proof freshness dashboard",
    boundaryDetail:
      proofFreshness.proofBoundary ??
      "Local dev-test-game artifact age dashboard without content validation or release claims.",
    href: "target/dev-test-game/release-readiness-checklist.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-proof-freshness" }),
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
                id: "next-action-handoff",
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
    id: "local-ops-artifacts",
    label: "Local ops artifacts",
    status: `${passedChecks.length} local ops checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local ops artifact bundle",
    boundaryDetail:
      opsArtifacts.proofBoundary ??
      "Local dev-test-game ops artifact bundle without hosted observability claims.",
    href: "target/dev-test-game/ops-artifacts.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-ops-artifacts" }),
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
      id: "local-proof-freshness",
      label: "Proof freshness",
      href: adminAuditInspectHref({ game, audit: "local-proof-freshness" }),
      status: String(artifactFreshness.status ?? "unknown"),
      command: String(artifactFreshness.nextCommand ?? ""),
    }),
    Object.freeze({
      id: "local-next-action",
      label: "Ranked next action",
      href: adminAuditInspectHref({ game, audit: "local-next-action" }),
      status: String(spineManifest.commands?.nextAction?.script ?? "unknown"),
      command: String(spineManifest.commands?.nextAction?.script ?? ""),
    }),
  ]);
  return Object.freeze({
    id: "local-spine-manifest",
    label: "Local spine manifest",
    status: `${checks.filter((check) => check?.status === "passed").length} manifest checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local development-spine manifest",
    boundaryDetail:
      spineManifest.proofBoundary ??
      "Generated local dev-test-game proof order and evidence wiring without release claims.",
    href: "target/dev-test-game/spine-manifest.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-spine-manifest" }),
    checks: Object.freeze(
      [
        ...checks.map((check) =>
          Object.freeze({
            id: String(check.id),
            status: String(check.status),
          }),
        ),
        Object.freeze({
          id: "proof-freshness-handoff",
          status: String(artifactFreshness.status ?? "unknown"),
        }),
        Object.freeze({
          id: "next-action-handoff",
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
      nextActionInspectHref: adminAuditInspectHref({ game, audit: "local-next-action" }),
      proofFreshnessInspectHref: adminAuditInspectHref({
        game,
        audit: "local-proof-freshness",
      }),
      releaseReady: spineManifest.releaseReady === true,
      productionReady: spineManifest.productionReady === true,
    }),
  });
}

export function appendLocalAdminSpineAudit(audit, adminSpineProof, { game }) {
  const row = normalizeLocalAdminSpineAudit(adminSpineProof, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
}

export function normalizeLocalAdminSpineAudit(adminSpineProof, { game }) {
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
  const adminSpineRelatedLinks = Object.freeze([
    Object.freeze({
      id: "local-spine-manifest",
      label: "Spine manifest",
      href: adminAuditInspectHref({ game, audit: "local-spine-manifest" }),
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
    id: "local-admin-spine",
    label: "Local admin spine",
    status: `${proofs.filter((proof) => proof?.status === "passed").length} admin proof surfaces passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local aggregate admin proof",
    boundaryDetail:
      adminSpineProof.proofBoundary ??
      "Local aggregate admin proof without hosted or release-readiness claims.",
    href: "target/dev-test-game/admin-spine-proof.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-admin-spine" }),
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
          id: "spine-manifest-handoff",
          status: String(
            proofs.find((proof) => proof?.id === "spine-manifest")?.status ?? "unknown",
          ),
        }),
      ],
    ),
    relatedLinks: adminSpineRelatedLinks,
    artifactSummary: Object.freeze({
      game: String(adminSpineProof.generatedFrom?.game ?? ""),
      proofCount: proofs.length,
      recoveryStatus: String(recovery.status ?? "unknown"),
      refreshedCount: Number(recovery.refreshedCount ?? 0),
      nextCommand: String(recovery.nextCommand ?? ""),
      spineManifestInspectHref: adminAuditInspectHref({
        game,
        audit: "local-spine-manifest",
      }),
      releaseReady: adminSpineProof.releaseReady === true,
      productionReady: adminSpineProof.productionReady === true,
    }),
  });
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
    id: "local-seed-fixtures",
    label: "Local seed fixtures",
    status: `${localScenarios.length} demo scenarios available locally`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local seed/demo fixture inventory",
    boundaryDetail:
      seedFixtureSummary.proofBoundary ??
      "Local seed/demo fixture summary without hosted demo-data claims.",
    href: "target/dev-test-game/seed-fixture-summary.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-seed-fixtures" }),
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
  const unproven = Array.isArray(releaseReadinessChecklist.releaseReadiness?.unproven)
    ? releaseReadinessChecklist.releaseReadiness.unproven
    : [];
  return Object.freeze({
    id: "local-release-readiness",
    label: "Local release readiness",
    status: `${checks.length} local checks passed, ${unproven.length} release items unproven`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-readiness checklist",
    boundaryDetail:
      releaseReadinessChecklist.proofBoundary ??
      "Local dev-test-game release-readiness checklist without beta or production claims.",
    href: "target/dev-test-game/release-readiness-checklist.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-release-readiness",
    }),
    checks: Object.freeze(
      checks.map((check) =>
        Object.freeze({
          id: String(check.id),
          status: String(check.status),
          dependencyGated: check.dependencyGated === true,
        }),
      ),
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
      localPrerequisiteCount: localPrerequisites.length,
      unprovenCount: unproven.length,
      releaseReady: releaseReadinessChecklist.releaseReady === true,
      productionReady: releaseReadinessChecklist.productionReady === true,
    }),
  });
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
    id: "local-release-runbook",
    label: "Local release runbook",
    status: `${passedChecks.length} runbook checks passed, ${runbookItems.length} gaps rehearsed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local release-runbook rehearsal",
    boundaryDetail:
      releaseRunbook.proofBoundary ??
      "Local release-runbook rehearsal without human approval or release claims.",
    href: "target/dev-test-game/release-runbook.json",
    inspectHref: adminAuditInspectHref({ game, audit: "local-release-runbook" }),
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
        id: "local-release-readiness",
        label: "Release readiness",
        href: adminAuditInspectHref({ game, audit: "local-release-readiness" }),
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
    id: "local-core-loop",
    label: "Local core loop",
    status: `${requiredLaneIds.length} core loop lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local core-loop proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run core loop lanes without hosted release claims.",
    href: proofRun.artifacts?.proofRun ?? "target/dev-test-game/proof-run.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-core-loop",
    }),
    checks: Object.freeze(
      [
        Object.freeze({
          id: "core-loop-spine",
          status: coreLoopSpineStatus(proofRun),
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
  pushField(parts, "action", checkpoint?.actionTemplate);
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
  pushField(parts, "vote target", checkpoint?.voteTarget);
  pushField(parts, "vote", checkpoint?.voteState);
  pushField(parts, "outcome", checkpoint?.outcomeStatus);
  pushField(parts, "winner", checkpoint?.winnerSlot);
  pushField(parts, "count", checkpoint?.projectedCount);
  if (typeof checkpoint?.normalPlayerFactionalKillVisible === "boolean") {
    parts.push(
      `normal factional kill ${checkpoint.normalPlayerFactionalKillVisible ? "visible" : "hidden"}`,
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
    id: "local-player-recovery",
    label: "Local player recovery",
    status: `${LOCAL_PLAYER_RECOVERY_AUDIT_LANE_IDS.length} player recovery lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local player-action recovery proof",
    boundaryDetail:
      "Focused local dev-test-game player action recovery, stale command, reload, and conflict lanes without hosted multiplayer claims.",
    href: proofRun.artifacts?.proofRun ?? "target/dev-test-game/proof-run.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-player-recovery",
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
        id: "local-core-loop",
        label: "Core loop",
        href: adminAuditInspectHref({ game, audit: "local-core-loop" }),
        status: "source proof",
        command: "test:dev-test-game-core-loop-admin-proof",
      }),
      Object.freeze({
        id: "local-hardening",
        label: "Multiplayer hardening",
        href: adminAuditInspectHref({ game, audit: "local-hardening" }),
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
      "action-loop",
      "invalid-action-recovery",
      "dead-player-recovery",
      "player-action-boundary",
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
    id: "local-hardening",
    label: "Local multiplayer hardening",
    status: `${requiredLaneIds.length} hardening lanes passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local multiplayer-hardening proof",
    boundaryDetail:
      proofRun.proofBoundary ??
      "Local dev-test-game proof-run hardening lanes without exhaustive race claims.",
    href: proofRun.artifacts?.proofRun ?? "target/dev-test-game/proof-run.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-hardening",
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
    id: "local-backup-restore",
    label: "Local backup restore",
    status: `${requiredChecks.length} backup restore checks passed`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local backup/restore drill",
    boundaryDetail:
      backupRestoreProof.proofBoundary ??
      "Local disposable Postgres backup/restore proof without production backup claims.",
    href:
      backupRestoreProof.artifact?.proof ??
      "target/live-stack-backup-restore-drill/local-backup-restore-proof.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-backup-restore",
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
        "target/live-stack-backup-restore-drill/local-live-stack.dump",
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
    identityAdapterProof.version !== 10 ||
    identityAdapterProof.proof !== "auth-invite-role-proof" ||
    identityAdapterProof.status !== "passed" ||
    identityAdapterProof.scope !== "local-auth-invite-role-proof" ||
    identityAdapterProof.releaseReady !== false ||
    identityAdapterProof.productionReady !== false ||
    identityAdapterProof.identityAdapter?.replacesDevTokensWithoutRoleSurfaceChange !== true
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
    id: "local-identity-adapter",
    label: "Local identity adapter",
    status: `${roles.length} role surfaces, ${controls.length} lifecycle controls`,
    authority: "GlobalAdmin or GlobalMod",
    boundary: "Local production-identity adapter proof",
    boundaryDetail:
      identityAdapterProof.proofBoundary ??
      "Local invite/session identity adapter proof without hosted account claims.",
    href: "target/auth-invite-role-proof/invite-role-proof.json",
    inspectHref: adminAuditInspectHref({
      game,
      audit: "local-identity-adapter",
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
