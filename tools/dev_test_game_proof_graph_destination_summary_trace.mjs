import {
  proofGraphCoreLoopRecoveryDestinationSummary,
} from "./dev_test_game_proof_graph_core_loop_recovery_destinations.mjs";

export const proofGraphDestinationSummaryTraceStrategy =
  "proof-graph-destination-summary-before-readiness";
export const proofGraphDestinationSummaryTraceCheckId =
  "proof-graph-destination-summary-trace";
export const proofGraphDestinationSummaryTraceDriftCountCheckId =
  "proof-graph-destination-summary-trace-drift-count";
export const proofGraphDestinationSummaryTraceRecoveryCoverageCheckId =
  "proof-graph-destination-summary-trace-core-loop-recovery-coverage";
export const proofGraphDestinationSummaryTraceRoleUrlEvidenceCheckId =
  "proof-graph-destination-summary-trace-role-url-evidence";

export function proofGraphDestinationSummaryDriftFromProofGraph(
  proofGraph,
  { source = "" } = {},
) {
  const summary = proofGraph?.summary?.productionFeatureDestinationSummary;
  const productionFeatureTargetCount = numberOrZero(
    proofGraph?.summary?.productionFeatureTargetCount,
  );
  const totalDestinationCount = numberOrZero(summary?.totalDestinationCount);
  const adminAuditDestinationCount = numberOrZero(
    summary?.adminAuditDestinationCount,
  );
  const roleUrlDestinationCount = numberOrZero(summary?.roleUrlDestinationCount);
  const driftCount = numberOrZero(
    summary?.driftCount ?? totalDestinationCount - productionFeatureTargetCount,
  );
  const summaryStatus = String(summary?.status ?? "missing");
  const recoveryCoverage =
    coreLoopRecoveryDestinationCoverageFromProofGraph(proofGraph);
  const roleUrlEvidenceCoverage =
    featureKindRoleUrlEvidenceCoverageFromSummary(summary);
  const status =
    proofGraph === null
      ? "unavailable"
      : summaryStatus === "passed" &&
          driftCount === 0 &&
          totalDestinationCount === productionFeatureTargetCount &&
          recoveryCoverage.missingCount === 0 &&
          roleUrlEvidenceCoverage.missingCount === 0
        ? "clean"
        : "drifted";
  return Object.freeze({
    strategy: proofGraphDestinationSummaryTraceStrategy,
    status,
    source: proofGraph === null ? "" : source,
    summaryStatus,
    totalDestinationCount,
    productionFeatureTargetCount,
    adminAuditDestinationCount,
    roleUrlDestinationCount,
    driftCount,
    coreLoopRecoveryDestinationRequiredCount: recoveryCoverage.requiredCount,
    coreLoopRecoveryDestinationCoveredCount: recoveryCoverage.coveredCount,
    coreLoopRecoveryDestinationMissingCount: recoveryCoverage.missingCount,
    coreLoopRecoveryDestinationMissingIds: recoveryCoverage.missingIds,
    featureKindRoleUrlEvidenceRequiredCount:
      roleUrlEvidenceCoverage.requiredCount,
    featureKindRoleUrlEvidenceCoveredCount:
      roleUrlEvidenceCoverage.coveredCount,
    featureKindRoleUrlEvidenceMissingCount:
      roleUrlEvidenceCoverage.missingCount,
    featureKindRoleUrlEvidenceMissingIds:
      roleUrlEvidenceCoverage.missingIds,
  });
}

export function buildProofGraphDestinationSummaryTrace(
  proofGraphDestinationSummaryDrift,
) {
  return normalizeProofGraphDestinationSummaryTrace({
    ...proofGraphDestinationSummaryDrift,
    selected: proofGraphDestinationSummaryDrift?.status === "drifted",
  });
}

export function normalizeProofGraphDestinationSummaryTrace(trace) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== proofGraphDestinationSummaryTraceStrategy
  ) {
    return unavailableProofGraphDestinationSummaryTrace();
  }
  return Object.freeze({
    strategy: proofGraphDestinationSummaryTraceStrategy,
    status: String(trace.status ?? "unknown"),
    source: String(trace.source ?? ""),
    summaryStatus: String(trace.summaryStatus ?? ""),
    selected: trace.selected === true,
    totalDestinationCount: Number(trace.totalDestinationCount ?? 0),
    productionFeatureTargetCount: Number(
      trace.productionFeatureTargetCount ?? 0,
    ),
    adminAuditDestinationCount: Number(trace.adminAuditDestinationCount ?? 0),
    roleUrlDestinationCount: Number(trace.roleUrlDestinationCount ?? 0),
    driftCount: Number(trace.driftCount ?? 0),
    coreLoopRecoveryDestinationRequiredCount: Number(
      trace.coreLoopRecoveryDestinationRequiredCount ?? 0,
    ),
    coreLoopRecoveryDestinationCoveredCount: Number(
      trace.coreLoopRecoveryDestinationCoveredCount ?? 0,
    ),
    coreLoopRecoveryDestinationMissingCount: Number(
      trace.coreLoopRecoveryDestinationMissingCount ?? 0,
    ),
    coreLoopRecoveryDestinationMissingIds: Object.freeze(
      Array.isArray(trace.coreLoopRecoveryDestinationMissingIds)
        ? trace.coreLoopRecoveryDestinationMissingIds.map((id) => String(id))
        : [],
    ),
    featureKindRoleUrlEvidenceRequiredCount: Number(
      trace.featureKindRoleUrlEvidenceRequiredCount ?? 0,
    ),
    featureKindRoleUrlEvidenceCoveredCount: Number(
      trace.featureKindRoleUrlEvidenceCoveredCount ?? 0,
    ),
    featureKindRoleUrlEvidenceMissingCount: Number(
      trace.featureKindRoleUrlEvidenceMissingCount ?? 0,
    ),
    featureKindRoleUrlEvidenceMissingIds: Object.freeze(
      Array.isArray(trace.featureKindRoleUrlEvidenceMissingIds)
        ? trace.featureKindRoleUrlEvidenceMissingIds.map((id) => String(id))
        : [],
    ),
  });
}

export function assertProofGraphDestinationSummaryTrace(
  trace,
  {
    label = "proof graph destination-summary trace",
    nextActionReason = null,
    nextActionProofGraphDestinationSummary = null,
  } = {},
) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== proofGraphDestinationSummaryTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeProofGraphDestinationSummaryTrace(trace);
  if (
    !["clean", "drifted", "unavailable"].includes(normalized.status) ||
    normalized.selected !== trace.selected ||
    normalized.summaryStatus === "" ||
    !Number.isInteger(normalized.totalDestinationCount) ||
    !Number.isInteger(normalized.productionFeatureTargetCount) ||
    !Number.isInteger(normalized.adminAuditDestinationCount) ||
    !Number.isInteger(normalized.roleUrlDestinationCount) ||
    !Number.isInteger(normalized.driftCount) ||
    !Number.isInteger(normalized.coreLoopRecoveryDestinationRequiredCount) ||
    !Number.isInteger(normalized.coreLoopRecoveryDestinationCoveredCount) ||
    !Number.isInteger(normalized.coreLoopRecoveryDestinationMissingCount) ||
    !Array.isArray(normalized.coreLoopRecoveryDestinationMissingIds) ||
    !Number.isInteger(normalized.featureKindRoleUrlEvidenceRequiredCount) ||
    !Number.isInteger(normalized.featureKindRoleUrlEvidenceCoveredCount) ||
    !Number.isInteger(normalized.featureKindRoleUrlEvidenceMissingCount) ||
    !Array.isArray(normalized.featureKindRoleUrlEvidenceMissingIds)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    nextActionReason === "proof-graph-destination-summary-drift" &&
    (normalized.status !== "drifted" ||
      normalized.selected !== true ||
      nextActionProofGraphDestinationSummary?.driftCount !==
        normalized.driftCount ||
      nextActionProofGraphDestinationSummary
        ?.coreLoopRecoveryDestinationMissingCount !==
        normalized.coreLoopRecoveryDestinationMissingCount ||
      nextActionProofGraphDestinationSummary
        ?.featureKindRoleUrlEvidenceMissingCount !==
        normalized.featureKindRoleUrlEvidenceMissingCount ||
      nextActionProofGraphDestinationSummary?.summaryStatus !==
        normalized.summaryStatus)
  ) {
    throw new Error(`${label} does not match selected drift`);
  }
  if (
    nextActionReason !== null &&
    nextActionReason !== "proof-graph-destination-summary-drift" &&
    normalized.selected === true
  ) {
    throw new Error(`${label} selected without drift action`);
  }
  return normalized;
}

export function proofGraphDestinationSummaryTraceCheckIds(trace) {
  const normalized = normalizeProofGraphDestinationSummaryTrace(trace);
  return normalized.status === "drifted"
    ? Object.freeze([
        proofGraphDestinationSummaryTraceCheckId,
        proofGraphDestinationSummaryTraceDriftCountCheckId,
        proofGraphDestinationSummaryTraceRecoveryCoverageCheckId,
        proofGraphDestinationSummaryTraceRoleUrlEvidenceCheckId,
      ])
    : Object.freeze([]);
}

export function proofGraphDestinationSummaryTraceCheckRows(trace) {
  const normalized = normalizeProofGraphDestinationSummaryTrace(trace);
  const checkIds = proofGraphDestinationSummaryTraceCheckIds(normalized);
  return normalized.status === "drifted"
    ? Object.freeze([
        Object.freeze({
          id: checkIds[0],
          status: `${normalized.totalDestinationCount}/${normalized.productionFeatureTargetCount} ${normalized.status}`,
        }),
        Object.freeze({
          id: checkIds[1],
          status: `${normalized.driftCount} drift`,
        }),
        Object.freeze({
          id: checkIds[2],
          status: `${normalized.coreLoopRecoveryDestinationCoveredCount}/${normalized.coreLoopRecoveryDestinationRequiredCount} recoveries`,
        }),
        Object.freeze({
          id: checkIds[3],
          status: `${normalized.featureKindRoleUrlEvidenceCoveredCount}/${normalized.featureKindRoleUrlEvidenceRequiredCount} role URLs`,
        }),
      ])
    : Object.freeze([]);
}

export function assertProofGraphDestinationSummaryTraceVisibleChecks(
  trace,
  visibleChecks,
  { label = "proof graph destination-summary trace" } = {},
) {
  const normalized = assertProofGraphDestinationSummaryTrace(trace, { label });
  const checks = Array.isArray(visibleChecks) ? visibleChecks : [];
  for (const checkId of proofGraphDestinationSummaryTraceCheckIds(normalized)) {
    if (!checks.includes(checkId)) {
      throw new Error(`${label} missing visible check: ${checkId}`);
    }
  }
  return normalized;
}

function unavailableProofGraphDestinationSummaryTrace() {
  return Object.freeze({
    strategy: "unknown",
    status: "unavailable",
    source: "",
    summaryStatus: "",
    selected: false,
    totalDestinationCount: 0,
    productionFeatureTargetCount: 0,
    adminAuditDestinationCount: 0,
    roleUrlDestinationCount: 0,
    driftCount: 0,
    coreLoopRecoveryDestinationRequiredCount: 0,
    coreLoopRecoveryDestinationCoveredCount: 0,
    coreLoopRecoveryDestinationMissingCount: 0,
    coreLoopRecoveryDestinationMissingIds: Object.freeze([]),
    featureKindRoleUrlEvidenceRequiredCount: 0,
    featureKindRoleUrlEvidenceCoveredCount: 0,
    featureKindRoleUrlEvidenceMissingCount: 0,
    featureKindRoleUrlEvidenceMissingIds: Object.freeze([]),
  });
}

function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function featureKindRoleUrlEvidenceCoverageFromSummary(summary) {
  const featureKindRows = (Array.isArray(summary?.rows) ? summary.rows : [])
    .filter((row) => String(row?.id ?? "").startsWith("feature-target-kind:"));
  const missingIds = [];
  let requiredCount = 0;
  let coveredCount = 0;
  for (const row of featureKindRows) {
    const featureSlotIds = Array.isArray(row?.featureSlotIds)
      ? row.featureSlotIds.map((id) => String(id))
      : [];
    const evidenceBySlot = new Map(
      (Array.isArray(row?.roleUrlEvidence) ? row.roleUrlEvidence : []).map(
        (evidence) => [String(evidence?.featureSlotId ?? ""), evidence],
      ),
    );
    for (const featureSlotId of featureSlotIds) {
      requiredCount += 1;
      const evidence = evidenceBySlot.get(featureSlotId);
      if (validFeatureKindRoleUrlEvidence(evidence, featureSlotId)) {
        coveredCount += 1;
      } else {
        missingIds.push(`${String(row.id)}:${featureSlotId}`);
      }
    }
  }
  return Object.freeze({
    requiredCount,
    coveredCount,
    missingCount: missingIds.length,
    missingIds: Object.freeze(missingIds.sort()),
  });
}

function validFeatureKindRoleUrlEvidence(evidence, featureSlotId) {
  if (evidence === null || typeof evidence !== "object") {
    return false;
  }
  const targetRoleUrl = String(evidence.targetRoleUrl ?? "");
  return (
    targetRoleUrl.startsWith("http://127.0.0.1:5173/g/") &&
    String(evidence.browserWorkbenchRoleUrl ?? "") === targetRoleUrl &&
    String(evidence.browserWorkbenchFeatureSlotId ?? "") === featureSlotId &&
    String(evidence.browserWorkbenchRoleSurface ?? "") !== ""
  );
}

function coreLoopRecoveryDestinationCoverageFromProofGraph(proofGraph) {
  if (proofGraph === null) {
    return Object.freeze({
      requiredCount: 0,
      coveredCount: 0,
      missingCount: 0,
      missingIds: Object.freeze([]),
    });
  }
  const summary = proofGraphCoreLoopRecoveryDestinationSummary(proofGraph, {
    requiredRelationships: ["summarizes-into"],
  });
  const missingIds = summary.rows
    .filter((row) => row.status !== "passed")
    .map((row) => row.recoveryCaseId);
  return Object.freeze({
    requiredCount: summary.requiredCount,
    coveredCount: summary.coveredCount,
    missingCount: summary.missingCount,
    missingIds: Object.freeze(missingIds),
  });
}
