export const proofStabilityTraceStrategy = "proof-stability-before-readiness";
export const proofStabilityDriftCheckId = "proof-stability-drift";

export function proofStabilityDriftFromOpsArtifacts(ops) {
  const hostConfirmClicks = ops?.proofStability?.hostConfirmClicks ?? {};
  const retryClickCount = numberOrZero(hostConfirmClicks.retryClickCount);
  const domFallbackCount = numberOrZero(hostConfirmClicks.domFallbackCount);
  const forceFallbackCount = numberOrZero(hostConfirmClicks.forceFallbackCount);
  const failureCount = numberOrZero(hostConfirmClicks.failureCount);
  const events = Array.isArray(hostConfirmClicks.events)
    ? hostConfirmClicks.events
    : [];
  return Object.freeze({
    status:
      retryClickCount + domFallbackCount + forceFallbackCount + failureCount > 0
        ? "drifted"
        : "clean",
    hostConfirmClicks: numberOrZero(hostConfirmClicks.total),
    retryClickCount,
    domFallbackCount,
    forceFallbackCount,
    failureCount,
    maxAttempts: numberOrZero(hostConfirmClicks.maxAttempts),
    events: Object.freeze(
      events.map((event) =>
        Object.freeze({
          actionId: String(event.actionId ?? "unknown"),
          roleLabel: String(event.roleLabel ?? "unknown"),
          method: String(event.method ?? "unknown"),
          attempts: numberOrZero(event.attempts),
        }),
      ),
    ),
  });
}

export function buildProofStabilityTrace(stabilityDrift) {
  return normalizeProofStabilityTrace({
    strategy: proofStabilityTraceStrategy,
    status: stabilityDrift?.status,
    hostConfirmClicks: stabilityDrift?.hostConfirmClicks,
    retryClickCount: stabilityDrift?.retryClickCount,
    domFallbackCount: stabilityDrift?.domFallbackCount,
    forceFallbackCount: stabilityDrift?.forceFallbackCount,
    failureCount: stabilityDrift?.failureCount,
    maxAttempts: stabilityDrift?.maxAttempts,
    eventCount: Array.isArray(stabilityDrift?.events)
      ? stabilityDrift.events.length
      : 0,
    selected: stabilityDrift?.status === "drifted",
  });
}

export function cleanProofStabilityTrace(stabilityTrace) {
  const normalized = normalizeProofStabilityTrace(stabilityTrace);
  return Object.freeze({
    ...normalized,
    status: "clean",
    retryClickCount: 0,
    domFallbackCount: 0,
    forceFallbackCount: 0,
    failureCount: 0,
    eventCount: 0,
    selected: false,
  });
}

export function normalizeProofStabilityTrace(stabilityTrace) {
  if (
    stabilityTrace === null ||
    typeof stabilityTrace !== "object" ||
    stabilityTrace.strategy !== proofStabilityTraceStrategy
  ) {
    return unavailableProofStabilityTrace();
  }
  return Object.freeze({
    strategy: proofStabilityTraceStrategy,
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

export function assertProofStabilityTrace(
  stabilityTrace,
  { label = "proof stability trace", nextActionReason = null } = {},
) {
  if (
    stabilityTrace === null ||
    typeof stabilityTrace !== "object" ||
    stabilityTrace.strategy !== proofStabilityTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeProofStabilityTrace(stabilityTrace);
  if (
    !["clean", "drifted"].includes(normalized.status) ||
    normalized.selected !== stabilityTrace.selected
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    nextActionReason === "harness-stability-drift" &&
    (normalized.status !== "drifted" || normalized.selected !== true)
  ) {
    throw new Error(`${label} does not match selected drift`);
  }
  if (
    nextActionReason !== null &&
    nextActionReason !== "harness-stability-drift" &&
    normalized.selected === true
  ) {
    throw new Error(`${label} selected without drift action`);
  }
  return normalized;
}

export function proofStabilityTraceCheckIds(stabilityTrace) {
  const normalized = normalizeProofStabilityTrace(stabilityTrace);
  return normalized.status === "drifted"
    ? Object.freeze([proofStabilityDriftCheckId])
    : Object.freeze([]);
}

export function proofStabilityTraceCheckRows(stabilityTrace) {
  const normalized = normalizeProofStabilityTrace(stabilityTrace);
  const checkIds = proofStabilityTraceCheckIds(normalized);
  return normalized.status === "drifted"
    ? Object.freeze([
        Object.freeze({
          id: checkIds[0],
          status: `${normalized.retryClickCount} retries, ${normalized.domFallbackCount} DOM fallbacks, ${normalized.forceFallbackCount} force fallbacks`,
        }),
      ])
    : Object.freeze([]);
}

function unavailableProofStabilityTrace() {
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

function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
