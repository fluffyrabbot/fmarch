import {
  assertProofGraphDestinationSummaryTrace,
  normalizeProofGraphDestinationSummaryTrace,
  proofGraphDestinationSummaryTraceCheckIds,
  proofGraphDestinationSummaryTraceCheckRows,
  proofGraphDestinationSummaryTraceStrategy,
} from "./dev_test_game_proof_graph_destination_summary_trace.mjs";
import {
  assertProofStabilityTrace,
  proofStabilityTraceCheckIds,
  proofStabilityTraceCheckRows,
  proofStabilityTraceStrategy,
  normalizeProofStabilityTrace,
} from "./dev_test_game_proof_stability_trace.mjs";
import {
  assertSeedProofLaneCoverageTrace,
  normalizeSeedProofLaneCoverageTrace,
  seedProofLaneCoverageTraceCheckIds,
  seedProofLaneCoverageTraceCheckRows,
  seedProofLaneCoverageTraceStrategy,
} from "./dev_test_game_seed_proof_lane_coverage_trace.mjs";
export const preReadinessTraceKeys = Object.freeze({
  proofStability: "proofStability",
  seedProofLaneCoverage: "seedProofLaneCoverage",
  proofGraphDestinationSummary: "proofGraphDestinationSummary",
  localReadinessDependency: "localReadinessDependency",
});

export const localReadinessDependencyTraceStrategy =
  "local-readiness-dependency-before-hosted-work";
export const localReadinessDependencyTraceCheckId =
  "local-readiness-dependency-trace";

export const preReadinessTraceRegistry = Object.freeze({
  [preReadinessTraceKeys.proofStability]: freezeRegistryEntry({
    key: preReadinessTraceKeys.proofStability,
    traceKey: "stabilityTrace",
    strategy: proofStabilityTraceStrategy,
    normalizeTrace: normalizeProofStabilityTrace,
    assertTrace: assertProofStabilityTrace,
    checkIds: proofStabilityTraceCheckIds,
    checkRows: proofStabilityTraceCheckRows,
  }),
  [preReadinessTraceKeys.seedProofLaneCoverage]: freezeRegistryEntry({
    key: preReadinessTraceKeys.seedProofLaneCoverage,
    traceKey: "seedProofLaneCoverageTrace",
    strategy: seedProofLaneCoverageTraceStrategy,
    normalizeTrace: normalizeSeedProofLaneCoverageTrace,
    assertTrace: assertSeedProofLaneCoverageTrace,
    checkIds: seedProofLaneCoverageTraceCheckIds,
    checkRows: seedProofLaneCoverageTraceCheckRows,
  }),
  [preReadinessTraceKeys.proofGraphDestinationSummary]: freezeRegistryEntry({
    key: preReadinessTraceKeys.proofGraphDestinationSummary,
    traceKey: "proofGraphDestinationSummaryTrace",
    strategy: proofGraphDestinationSummaryTraceStrategy,
    normalizeTrace: normalizeProofGraphDestinationSummaryTrace,
    assertTrace: assertProofGraphDestinationSummaryTrace,
    checkIds: proofGraphDestinationSummaryTraceCheckIds,
    checkRows: proofGraphDestinationSummaryTraceCheckRows,
  }),
  [preReadinessTraceKeys.localReadinessDependency]: freezeRegistryEntry({
    key: preReadinessTraceKeys.localReadinessDependency,
    traceKey: "localReadinessDependencyTrace",
    strategy: localReadinessDependencyTraceStrategy,
    normalizeTrace: normalizeLocalReadinessDependencyTrace,
    assertTrace: assertLocalReadinessDependencyTrace,
    checkIds: localReadinessDependencyTraceCheckIds,
    checkRows: localReadinessDependencyTraceCheckRows,
  }),
});

export const preReadinessTraceRegistryEntries = Object.freeze(
  Object.values(preReadinessTraceRegistry),
);

export function buildLocalReadinessDependencyTrace(candidates) {
  const selectedCheckId = candidates[0]?.id ?? null;
  return Object.freeze({
    strategy: localReadinessDependencyTraceStrategy,
    candidateCount: candidates.length,
    selectedCheckId,
    candidates: Object.freeze(
      candidates.map((candidate, index) =>
        Object.freeze({
          rank: index + 1,
          id: candidate.id,
          status: candidate.status,
          priority: candidate.priority,
          selected: candidate.id === selectedCheckId,
          command: candidate.command,
          buildSlice: candidate.buildSlice,
          proofTarget: candidate.proofTarget,
          roleUrl: candidate.roleUrl,
          proofBoundary: candidate.proofBoundary,
          requiredEvidence: candidate.requiredEvidence,
        }),
      ),
    ),
  });
}

export function normalizeLocalReadinessDependencyTrace(trace) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== localReadinessDependencyTraceStrategy
  ) {
    return unavailableLocalReadinessDependencyTrace();
  }
  const candidates = Array.isArray(trace.candidates)
    ? trace.candidates
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
        )
    : [];
  const candidateIds = Array.isArray(trace.candidateIds)
    ? trace.candidateIds.map((id) => String(id))
    : candidates.map((candidate) => candidate.id);
  return Object.freeze({
    strategy: localReadinessDependencyTraceStrategy,
    candidateCount: Number(trace.candidateCount ?? candidateIds.length),
    selectedCheckId:
      typeof trace.selectedCheckId === "string" ? trace.selectedCheckId : null,
    candidateIds: Object.freeze(candidateIds),
    candidates: Object.freeze(candidates),
  });
}

export function assertLocalReadinessDependencyTrace(
  trace,
  {
    label = "local readiness dependency trace",
    nextActionReason = null,
    nextActionLocalCheck = null,
    nextActionCommand = null,
  } = {},
) {
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== localReadinessDependencyTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeLocalReadinessDependencyTrace(trace);
  if (
    !Number.isInteger(normalized.candidateCount) ||
    normalized.candidateCount !== normalized.candidateIds.length
  ) {
    throw new Error(`${label} count drifted`);
  }
  if (normalized.candidates.length > 0) {
    const [selected, ...rest] = normalized.candidates;
    if (
      selected.selected !== true ||
      selected.id !== normalized.selectedCheckId
    ) {
      throw new Error(`${label} does not match selection`);
    }
    if (
      nextActionReason === "release-readiness-local-check-missing" &&
      (nextActionLocalCheck?.id !== selected.id ||
        nextActionCommand !== selected.command ||
        nextActionLocalCheck?.roleUrl !== selected.roleUrl)
    ) {
      throw new Error(`${label} selection does not match action`);
    }
    for (const candidate of rest) {
      if (candidate.selected === true) {
        throw new Error(`${label} has duplicate selection: ${candidate.id}`);
      }
    }
  }
  if (
    normalized.candidateCount === 0 &&
    (normalized.selectedCheckId !== null ||
      nextActionReason === "release-readiness-local-check-missing")
  ) {
    throw new Error(`${label} has no selected item`);
  }
  return normalized;
}

export function localReadinessDependencyTraceCheckIds(trace) {
  const normalized = normalizeLocalReadinessDependencyTrace(trace);
  return normalized.candidateCount === 0
    ? Object.freeze([])
    : Object.freeze([
        localReadinessDependencyTraceCheckId,
        ...normalized.candidateIds.map((id) => `local-readiness-dependency-${id}`),
      ]);
}

export function localReadinessDependencyTraceCheckRows(trace) {
  const normalized = normalizeLocalReadinessDependencyTrace(trace);
  const checkIds = localReadinessDependencyTraceCheckIds(normalized);
  return normalized.candidateCount === 0
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: checkIds[0],
          status: `${normalized.candidateCount} missing local dependencies`,
        }),
        ...normalized.candidates.map((candidate, index) =>
          Object.freeze({
            id: checkIds[index + 1],
            status: candidate.selected
              ? `selected:${candidate.status}`
              : `rank-${candidate.rank}:${candidate.status}`,
          }),
        ),
      ]);
}

export function normalizePreReadinessTrace(key, trace) {
  return registryEntryFor(key).normalizeTrace(trace);
}

export function assertPreReadinessTrace(key, trace, options = {}) {
  return registryEntryFor(key).assertTrace(trace, options);
}

export function preReadinessTraceCheckIds(key, trace) {
  return registryEntryFor(key).checkIds(trace);
}

export function preReadinessTraceCheckRows(key, trace) {
  return registryEntryFor(key).checkRows(trace);
}

export function assertPreReadinessTraceVisibleChecks(
  key,
  trace,
  visibleChecks,
  options = {},
) {
  const normalized = assertPreReadinessTrace(key, trace, options);
  const checks = Array.isArray(visibleChecks) ? visibleChecks : [];
  for (const checkId of preReadinessTraceCheckIds(key, normalized)) {
    if (!checks.includes(checkId)) {
      const label = options.label ?? registryEntryFor(key).traceKey;
      throw new Error(`${label} missing visible check: ${checkId}`);
    }
  }
  return normalized;
}

function registryEntryFor(key) {
  const entry = preReadinessTraceRegistry[key];
  if (entry === undefined) {
    throw new Error(`unknown pre-readiness trace: ${key}`);
  }
  return entry;
}

function freezeRegistryEntry(entry) {
  return Object.freeze(entry);
}

function unavailableLocalReadinessDependencyTrace() {
  return Object.freeze({
    strategy: "unknown",
    candidateCount: 0,
    selectedCheckId: null,
    candidateIds: Object.freeze([]),
    candidates: Object.freeze([]),
  });
}
