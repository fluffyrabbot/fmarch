import {
  hostVisibleRecoverySummaryCases,
} from "./dev_test_game_core_loop_action_scenarios.mjs";

export const proofGraphDestinationSummaryTraceStrategy =
  "proof-graph-destination-summary-before-readiness";
export const proofGraphDestinationSummaryTraceCheckId =
  "proof-graph-destination-summary-trace";
export const proofGraphDestinationSummaryTraceDriftCountCheckId =
  "proof-graph-destination-summary-trace-drift-count";
export const proofGraphDestinationSummaryTraceRecoveryCoverageCheckId =
  "proof-graph-destination-summary-trace-core-loop-recovery-coverage";

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
    coreLoopRecoveryDestinationCoverageDriftFromProofGraph(proofGraph);
  const status =
    proofGraph === null
      ? "unavailable"
      : summaryStatus === "passed" &&
          driftCount === 0 &&
          totalDestinationCount === productionFeatureTargetCount &&
          recoveryCoverage.missingCount === 0
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
    !Array.isArray(normalized.coreLoopRecoveryDestinationMissingIds)
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
  });
}

function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function coreLoopRecoveryDestinationCoverageDriftFromProofGraph(proofGraph) {
  if (proofGraph === null) {
    return Object.freeze({
      requiredCount: 0,
      coveredCount: 0,
      missingCount: 0,
      missingIds: Object.freeze([]),
    });
  }
  const missingIds = [];
  for (const recoveryCase of hostVisibleRecoverySummaryCases()) {
    const nodeId = `core-loop-host-visible-recovery:${recoveryCase.id}`;
    const adminRowId = `host-visible-recovery-${recoveryCase.id}`;
    const node = proofGraph.nodes?.find((candidate) => candidate?.id === nodeId);
    const edge = proofGraph.edges?.find(
      (candidate) =>
        candidate?.from === nodeId &&
        candidate?.to === "next-action" &&
        candidate?.relationship === "summarizes-into",
    );
    if (
      node?.status !== "passed" ||
      edge?.recoveryCaseId !== recoveryCase.id ||
      edge?.visibleAdminRowId !== adminRowId
    ) {
      missingIds.push(recoveryCase.id);
    }
  }
  const requiredCount = hostVisibleRecoverySummaryCases().length;
  return Object.freeze({
    requiredCount,
    coveredCount: requiredCount - missingIds.length,
    missingCount: missingIds.length,
    missingIds: Object.freeze(missingIds),
  });
}
