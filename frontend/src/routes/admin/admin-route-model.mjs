import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { resolveSurfaceAccess } from "../../lib/app/capabilities.mjs";
import {
  loadAdminColdData,
  operatorProofRunUrl,
} from "../../lib/app/cold-load.mjs";

export const ADMIN_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "admin-surface",
  capabilityTestId: "admin-capability",
  requiredText: "Operations",
});

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
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  proofGraph = null,
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
        appendLocalProofGraphAudit(
          appendLocalProofFreshnessAudit(
            appendLocalAdminSpineAudit(
              appendLocalSpineManifestAudit(
                appendLocalIdentityAdapterAudit(
                  appendLocalBackupRestoreAudit(
                    appendLocalReleaseReadinessAudit(
                      appendLocalSeedFixtureAudit(
                        appendLocalOpsArtifactsAudit(
                          appendLocalHardeningAudit(
                            appendLocalCoreLoopAudit(coldData.audit, proofRun, { game }),
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
                    backupRestoreProof,
                    { game },
                  ),
                  identityAdapterProof,
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
        nextAction,
        { game },
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
  backupRestoreProof = null,
  identityAdapterProof = null,
  spineManifest = null,
  adminSpineProof = null,
  proofGraph = null,
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
    backupRestoreProof,
    identityAdapterProof,
    spineManifest,
    adminSpineProof,
    proofGraph,
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

export function appendLocalNextActionAudit(audit, nextAction, { game }) {
  const row = normalizeLocalNextActionAudit(nextAction, { game });
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
      nodes.map((node) =>
        Object.freeze({
          id: String(node.id),
          status: String(node.status ?? "recorded"),
        }),
      ),
    ),
    relatedLinks: Object.freeze(
      roleNodes.slice(0, 8).map((node) =>
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

export function normalizeLocalNextActionAudit(nextAction, { game }) {
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
  const unproven =
    action.unproven !== null && typeof action.unproven === "object"
      ? action.unproven
      : null;
  const selectionTrace = normalizeNextActionSelectionTrace(nextAction.selectionTrace);
  const releaseReadinessTrace = normalizeNextActionReleaseReadinessTrace(
    nextAction.releaseReadinessTrace,
  );
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
    ...(unproven === null
      ? []
      : [
          Object.freeze({
            id: String(unproven.id),
            status: String(unproven.status ?? "unknown"),
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
      selectedUnprovenId: String(unproven?.id ?? ""),
      selectedBuildSlice: String(unproven?.buildSlice ?? ""),
      selectedProofTarget: String(unproven?.proofTarget ?? ""),
      releaseReadinessTrace,
      releaseReady: nextAction.releaseReady === true,
      productionReady: nextAction.productionReady === true,
    }),
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
    artifactSummary: Object.freeze({
      game: String(seedFixtureSummary.fixture?.game ?? ""),
      scenarioCount: scenarios.length,
      roleCount: Number(seedFixtureSummary.fixture?.roleCount ?? 0),
      slotCount: Number(seedFixtureSummary.fixture?.slots?.length ?? 0),
      releaseReady: seedFixtureSummary.releaseReady === true,
      productionReady: seedFixtureSummary.productionReady === true,
    }),
  });
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
      unprovenCount: unproven.length,
      releaseReady: releaseReadinessChecklist.releaseReady === true,
      productionReady: releaseReadinessChecklist.productionReady === true,
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
  const requiredLaneIds = [
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
    "host-votecount-publication",
    "host-lifecycle-control",
    "host-modkill-control",
    "replacement-host-issued-invite",
    "replacement-pending-player",
    "replacement-invalid-target-recovery",
    "replacement-console",
    "stale-host-invite-recovery",
    "replacement-stale-success-recovery",
    "replacement-stale-player",
    "replacement-stale-action",
    "replacement-stale-private-channel",
    "replacement-stale-private-receipts",
    "replacement-incoming-player",
  ];
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
      requiredLaneIds.map((id) => {
        const lane = laneById.get(id);
        return Object.freeze({
          id,
          status: String(lane.status),
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

export function appendLocalHardeningAudit(audit, proofRun, { game }) {
  const row = normalizeLocalHardeningAudit(proofRun, { game });
  if (row === null) {
    return audit;
  }
  return Object.freeze([...audit.filter((item) => item.id !== row.id), row]);
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
  const requiredLaneIds = [
    "replacement-redeemed-invite-recovery",
    "replacement-session-revocation-recovery",
    "replacement-session-refresh-recovery",
    "replacement-stale-session-after-refresh",
    "replacement-reconnect-recovery",
    "replacement-stale-conflict-message",
    "replacement-idempotent-retry",
    "idempotent-retry",
    "action-idempotent-retry",
    "concurrent-action-race",
    "reconnect-recovery",
    "stale-player-vote",
    "concurrent-vote-race",
    "concurrent-player-vote-resolve-race",
    "concurrent-player-action-advance-race",
    "concurrent-cohost-deadline-resolve-race",
    "concurrent-replacement-private-post-race",
    "concurrent-replacement-vote-race",
    "concurrent-replacement-action-race",
    "replacement-incoming-action",
    "replacement-action-reconnect",
    "replacement-stale-action-after-resolve",
    "replacement-stale-private-post-after-resolve",
    "replacement-stale-private-post-reconnect",
    "replacement-stale-private-post-after-complete",
    "stale-host-publish",
    "stale-host-lifecycle",
    "stale-host-modkill",
    "stale-host-prompt",
    "stale-host-complete",
    "concurrent-host-complete-race",
    "concurrent-player-complete-race",
    "stale-player-complete",
    "stale-same-action-recovery",
    "stale-dead-action-conflict",
    "stale-action-conflict",
    "stale-action-conflict-message",
    "stale-host-control",
    "concurrent-host-resolve-race",
    "concurrent-host-advance-race",
    "concurrent-host-deadline-advance-race",
    "concurrent-host-lifecycle-race",
    "concurrent-host-mixed-advance-race",
    "stale-host-resolve",
    "stale-host-advance",
    "stale-host-deadline",
    "stale-cohost-deadline",
  ];
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
          status: String(lane.status),
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
    identityAdapterProof.version !== 7 ||
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
