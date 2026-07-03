export const devTestGameRealHostedObservabilityHandoffPath =
  "target/dev-test-game/real-hosted-observability-handoff.json";
export const devTestGameRealHostedObservabilityHandoffCommand =
  "test:dev-test-game-real-hosted-observability-handoff";
export const realHostedObservabilityEvidenceEnv =
  "FMARCH_REAL_HOSTED_OBSERVABILITY_EVIDENCE_PATH";
export const realHostedObservabilityBaselineEnv =
  "FMARCH_DEV_TEST_GAME_HOSTED_OPS_SIGNALS";

export const realHostedObservabilityHandoffInputIds = Object.freeze([
  "command",
  "proof-target",
  realHostedObservabilityEvidenceEnv,
  realHostedObservabilityBaselineEnv,
]);

export const realHostedObservabilityHandoffCheckIds = Object.freeze([
  "local-hosted-ops-signals-baseline-carried",
  "real-hosted-observability-evidence-path-configured",
  "real-hosted-observability-evidence-readable",
  "externally-reachable-logs-evidence",
  "externally-reachable-metrics-evidence",
  "externally-reachable-traces-evidence",
  "paging-slo-evidence",
  "incident-response-evidence",
  "local-hosted-like-baseline-only",
  "release-claim-boundary-carried",
]);

export const realHostedObservabilityHandoffBlockedChecks = Object.freeze([
  Object.freeze({
    id: "real-hosted-observability-evidence-path-configured",
    requiredEvidence: `Set ${realHostedObservabilityEvidenceEnv}.`,
  }),
  Object.freeze({
    id: "real-hosted-observability-evidence-readable",
    requiredEvidence: "Readable real hosted observability evidence JSON.",
  }),
  Object.freeze({
    id: "externally-reachable-logs-evidence",
    requiredEvidence:
      "Externally reachable centralized logs for the hosted API/frontend target, with request/error correlation tied to the seeded game flow.",
  }),
  Object.freeze({
    id: "externally-reachable-metrics-evidence",
    requiredEvidence:
      "Externally reachable metrics dashboard or export for hosted request, command, latency, error, and runtime health counters.",
  }),
  Object.freeze({
    id: "externally-reachable-traces-evidence",
    requiredEvidence:
      "Externally reachable traces for hosted role-surface and command paths, correlated to logs and metrics.",
  }),
  Object.freeze({
    id: "paging-slo-evidence",
    requiredEvidence:
      "Paging route plus SLO/alert evidence for hosted availability, latency, and error-budget breach handling.",
  }),
  Object.freeze({
    id: "incident-response-evidence",
    requiredEvidence:
      "Incident-response evidence naming owner, severity path, rollback/mitigation steps, and post-incident evidence capture.",
  }),
  Object.freeze({
    id: "local-hosted-like-baseline-only",
    requiredEvidence:
      "The local hosted-like ops signals artifact must be named as baseline only, not as hosted logs, metrics, traces, paging/SLO, or incident-response proof.",
  }),
  Object.freeze({
    id: "release-claim-boundary-carried",
    requiredEvidence:
      "The real hosted observability handoff must keep releaseReady and productionReady false.",
  }),
]);

export const realHostedObservabilityRequirementGroupDefinitions = Object.freeze([
  Object.freeze({
    id: "real-hosted-observability-intake",
    label: "Evidence intake",
    checkIds: Object.freeze([
      "real-hosted-observability-evidence-path-configured",
      "real-hosted-observability-evidence-readable",
    ]),
    requiredEvidence: "Attach a readable real hosted observability evidence JSON file.",
  }),
  Object.freeze({
    id: "externally-reachable-telemetry",
    label: "Logs, metrics, and traces",
    checkIds: Object.freeze([
      "externally-reachable-logs-evidence",
      "externally-reachable-metrics-evidence",
      "externally-reachable-traces-evidence",
    ]),
    requiredEvidence:
      "Hosted logs, metrics, and traces must be externally reachable and correlated to the seeded game flow.",
  }),
  Object.freeze({
    id: "paging-slo",
    label: "Paging and SLO",
    checkIds: Object.freeze(["paging-slo-evidence"]),
    requiredEvidence:
      "Hosted paging, SLO, and alert evidence for availability, latency, and error-budget breach handling.",
  }),
  Object.freeze({
    id: "incident-response",
    label: "Incident response",
    checkIds: Object.freeze(["incident-response-evidence"]),
    requiredEvidence:
      "Hosted incident-response owner, severity path, rollback/mitigation, and post-incident evidence capture.",
  }),
  Object.freeze({
    id: "baseline-boundary",
    label: "Baseline boundary",
    checkIds: Object.freeze([
      "local-hosted-ops-signals-baseline-carried",
      "local-hosted-like-baseline-only",
      "release-claim-boundary-carried",
    ]),
    requiredEvidence:
      "Local hosted-like ops signals are only the baseline and do not satisfy real hosted observability evidence.",
  }),
]);

export function realHostedObservabilityBlockedCheckRows() {
  return realHostedObservabilityHandoffBlockedChecks.map((check) => ({
    ...check,
    status: "blocked",
  }));
}

export function realHostedObservabilityHandoffCase({
  status = "blocked",
  preflightStatus = status,
  blockedChecks = realHostedObservabilityBlockedCheckRows(),
  requirementGroups = realHostedObservabilityRequirementGroups(blockedChecks),
  blockedReceipt = realHostedObservabilityBlockedReceipt({
    missingRequiredInputs: blockedChecks.map((check) => check.id),
  }),
} = {}) {
  return {
    status,
    preflightStatus,
    command: `npm run ${devTestGameRealHostedObservabilityHandoffCommand}`,
    proofTarget: devTestGameRealHostedObservabilityHandoffPath,
    inputIds: [...realHostedObservabilityHandoffInputIds],
    blockedCheckIds: blockedChecks.map((check) => check.id),
    blockedChecks: blockedChecks.map((check) => ({
      id: check.id,
      status: "blocked",
      requiredEvidence: String(check.requiredEvidence ?? ""),
    })),
    requirementGroups,
    ...(blockedReceipt === null ? {} : { blockedReceipt }),
  };
}

export function realHostedObservabilityRequirementGroups(checks) {
  const checksById = new Map((checks ?? []).map((check) => [check.id, check]));
  return realHostedObservabilityRequirementGroupDefinitions.map((group) => {
    const checkIds = [...group.checkIds];
    const blockedCheckIds = checkIds.filter(
      (id) => checksById.get(id)?.status !== "passed",
    );
    return {
      id: group.id,
      label: group.label,
      status: blockedCheckIds.length === 0 ? "passed" : "blocked",
      requiredEvidence: group.requiredEvidence,
      checkIds,
      blockedCheckIds,
    };
  });
}

export function requiredRealHostedObservabilityEvidenceForCheck(id) {
  return (
    realHostedObservabilityHandoffBlockedChecks.find((check) => check.id === id)
      ?.requiredEvidence ?? "Real hosted observability evidence."
  );
}

export function realHostedObservabilityBlockedReceipt({
  missingRequiredInputs = realHostedObservabilityHandoffCheckIds.filter(
    (id) => id !== "local-hosted-ops-signals-baseline-carried",
  ),
} = {}) {
  return {
    status: "blocked",
    operatorAction:
      "Attach externally reachable hosted logs, metrics, traces, paging/SLO, and incident-response evidence, then rerun the real hosted observability handoff.",
    localVsHostedBoundary:
      "The local hosted-like ops signal bundle is baseline evidence only; it cannot satisfy real hosted observability.",
    missingRequiredInputs: [...missingRequiredInputs],
    nextProofTarget: devTestGameRealHostedObservabilityHandoffPath,
  };
}
