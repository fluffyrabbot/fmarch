export const selectionTraceStrategy = "development-spine-priority";
export const selectionTraceCheckId = "selection-trace";
export const releaseReadinessTraceStrategy =
  "local-dev-release-readiness-priority";
export const releaseReadinessTraceCheckId =
  "release-readiness-selection-trace";

export function buildSelectionTrace(candidates) {
  const selectedArtifactId = candidates[0]?.artifact.id ?? null;
  return Object.freeze({
    strategy: selectionTraceStrategy,
    candidateCount: candidates.length,
    selectedArtifactId,
    candidates: Object.freeze(
      candidates.map(({ artifact, priority }, index) =>
        Object.freeze({
          rank: index + 1,
          id: artifact.id,
          label: artifact.label,
          path: artifact.path,
          status: artifact.status,
          priority,
          selected: artifact.id === selectedArtifactId,
          refreshCommand: artifact.nextCommand ?? artifact.refreshCommand,
          refreshSource: artifact.refreshSource,
          ...(artifact.ageSeconds === undefined
            ? {}
            : { ageSeconds: artifact.ageSeconds }),
          ...(artifact.maxAgeSeconds === undefined
            ? {}
            : { maxAgeSeconds: artifact.maxAgeSeconds }),
        }),
      ),
    ),
  });
}

export function buildReleaseReadinessTrace(candidates) {
  const selectedUnprovenId = candidates[0]?.item.id ?? null;
  return Object.freeze({
    strategy: releaseReadinessTraceStrategy,
    candidateCount: candidates.length,
    selectedUnprovenId,
    candidates: Object.freeze(
      candidates.map((candidate, index) =>
        Object.freeze({
          rank: index + 1,
          id: candidate.item.id,
          status: candidate.item.status,
          priority: candidate.priority,
          featureTargetKindPriority: candidate.featureTargetKindPriority,
          selected: candidate.item.id === selectedUnprovenId,
          command: candidate.command,
          buildSlice: candidate.buildSlice,
          proofTarget: candidate.proofTarget,
          roleUrl: candidate.roleUrl,
          proofGraphNodeId: candidate.proofGraphNodeId,
          proofBoundary: candidate.proofBoundary,
          actionStatus: candidate.actionStatus,
          requiredEvidence: candidate.item.requiredEvidence,
          ...(candidate.featureTargetKind === undefined
            ? {}
            : { featureTargetKind: candidate.featureTargetKind }),
          productionFeatureSpineTarget: candidate.productionFeatureSpineTarget,
          spineDrilldown: candidate.spineDrilldown,
          ...(candidate.spineTarget == null
            ? {}
            : { spineTarget: candidate.spineTarget }),
          ...(candidate.selectedProductionFeatureGraph == null
            ? {}
            : {
                selectedProductionFeatureGraph:
                  candidate.selectedProductionFeatureGraph,
              }),
          ...(candidate.hostedEvidenceMode === undefined
            ? {}
            : { hostedEvidenceMode: candidate.hostedEvidenceMode }),
          ...(candidate.realHostedEvidenceStatus === undefined
            ? {}
            : { realHostedEvidenceStatus: candidate.realHostedEvidenceStatus }),
          ...(candidate.realHostedEvidenceInputs === undefined
            ? {}
            : { realHostedEvidenceInputs: candidate.realHostedEvidenceInputs }),
          ...(candidate.hostedHandoffChecklist === undefined
            ? {}
            : { hostedHandoffChecklist: candidate.hostedHandoffChecklist }),
          ...(candidate.hostedIdentityProgression === undefined
            ? {}
            : {
                hostedIdentityProgression:
                  candidate.hostedIdentityProgression,
              }),
        }),
      ),
    ),
  });
}

export function normalizeSelectionTrace(selectionTrace) {
  if (
    selectionTrace === null ||
    typeof selectionTrace !== "object" ||
    selectionTrace.strategy !== selectionTraceStrategy
  ) {
    return unavailableSelectionTrace();
  }
  const candidates = Array.isArray(selectionTrace.candidates)
    ? selectionTrace.candidates
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
        )
    : [];
  const candidateIds = Array.isArray(selectionTrace.candidateIds)
    ? selectionTrace.candidateIds.map((id) => String(id))
    : candidates.map((candidate) => candidate.id);
  return Object.freeze({
    strategy: selectionTraceStrategy,
    candidateCount: Number(selectionTrace.candidateCount ?? candidateIds.length),
    selectedArtifactId:
      typeof selectionTrace.selectedArtifactId === "string"
        ? selectionTrace.selectedArtifactId
        : null,
    candidateIds: Object.freeze(candidateIds),
    candidates: Object.freeze(candidates),
  });
}

export function normalizeReleaseReadinessTrace(releaseReadinessTrace) {
  if (
    releaseReadinessTrace === null ||
    typeof releaseReadinessTrace !== "object" ||
    releaseReadinessTrace.strategy !== releaseReadinessTraceStrategy
  ) {
    return unavailableReleaseReadinessTrace();
  }
  const candidates = Array.isArray(releaseReadinessTrace.candidates)
    ? releaseReadinessTrace.candidates
        .filter((candidate) => candidate !== null && typeof candidate === "object")
        .map((candidate) =>
          Object.freeze({
            ...candidate,
            rank: Number(candidate.rank ?? 0),
            id: String(candidate.id ?? "unknown"),
            status: String(candidate.status ?? "unknown"),
            priority: Number(candidate.priority ?? 0),
            featureTargetKindPriority: Number(
              candidate.featureTargetKindPriority ?? 0,
            ),
            selected: candidate.selected === true,
            command: String(candidate.command ?? ""),
            buildSlice: String(candidate.buildSlice ?? ""),
            proofTarget: String(candidate.proofTarget ?? ""),
            proofBoundary: String(candidate.proofBoundary ?? ""),
            roleUrl: String(candidate.roleUrl ?? ""),
            proofGraphNodeId: String(candidate.proofGraphNodeId ?? ""),
          }),
        )
    : [];
  const candidateIds = Array.isArray(releaseReadinessTrace.candidateIds)
    ? releaseReadinessTrace.candidateIds.map((id) => String(id))
    : candidates.map((candidate) => candidate.id);
  return Object.freeze({
    strategy: releaseReadinessTraceStrategy,
    candidateCount: Number(
      releaseReadinessTrace.candidateCount ?? candidateIds.length,
    ),
    selectedUnprovenId:
      typeof releaseReadinessTrace.selectedUnprovenId === "string"
        ? releaseReadinessTrace.selectedUnprovenId
        : null,
    candidateIds: Object.freeze(candidateIds),
    candidates: Object.freeze(candidates),
    selectedCandidate:
      releaseReadinessTrace.selectedCandidate === null ||
      releaseReadinessTrace.selectedCandidate === undefined
        ? null
        : releaseReadinessTrace.selectedCandidate,
  });
}

export function assertSelectionTrace(
  selectionTrace,
  { label = "next-action selection trace", nextAction = null } = {},
) {
  if (
    selectionTrace === null ||
    typeof selectionTrace !== "object" ||
    selectionTrace.strategy !== selectionTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeSelectionTrace(selectionTrace);
  if (
    !Number.isInteger(normalized.candidateCount) ||
    normalized.candidateCount !== normalized.candidateIds.length
  ) {
    throw new Error(`${label} candidate count drifted`);
  }
  if (normalized.candidateCount === 0) {
    if (
      normalized.selectedArtifactId !== null ||
      nextAction?.reason === "artifact-not-fresh"
    ) {
      throw new Error(`${label} has a selected artifact`);
    }
    return normalized;
  }
  if (normalized.candidates.length > 0) {
    const [selected, ...rest] = normalized.candidates;
    if (
      nextAction?.reason !== "artifact-not-fresh" ||
      selected.selected !== true ||
      selected.id !== normalized.selectedArtifactId ||
      nextAction?.artifact?.id !== selected.id
    ) {
      throw new Error(`${label} does not match selected artifact`);
    }
    for (const candidate of rest) {
      if (candidate.selected === true) {
        throw new Error(`${label} has duplicate selection: ${candidate.id}`);
      }
    }
  }
  return normalized;
}

export function assertReleaseReadinessTrace(
  releaseReadinessTrace,
  { label = "next-action release-readiness trace", nextAction = null } = {},
) {
  if (
    releaseReadinessTrace === null ||
    typeof releaseReadinessTrace !== "object" ||
    releaseReadinessTrace.strategy !== releaseReadinessTraceStrategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeReleaseReadinessTrace(releaseReadinessTrace);
  if (
    !Number.isInteger(normalized.candidateCount) ||
    normalized.candidateCount !== normalized.candidateIds.length
  ) {
    throw new Error(`${label} candidate count drifted`);
  }
  if (normalized.candidateCount === 0) {
    if (
      normalized.selectedUnprovenId !== null ||
      nextAction?.reason === "release-readiness-unproven"
    ) {
      throw new Error(`${label} has no selected item`);
    }
    return normalized;
  }
  if (normalized.candidates.length > 0) {
    const [selected, ...rest] = normalized.candidates;
    if (
      selected.selected !== true ||
      selected.id !== normalized.selectedUnprovenId
    ) {
      throw new Error(`${label} does not match selection`);
    }
    if (nextAction?.reason === "release-readiness-unproven") {
      assertReleaseReadinessSelectionMatchesAction(selected, nextAction, label);
    }
    for (const candidate of rest) {
      if (candidate.selected === true) {
        throw new Error(`${label} has duplicate selection: ${candidate.id}`);
      }
    }
  }
  return normalized;
}

export function selectionTraceCheckIds(selectionTrace) {
  const normalized = normalizeSelectionTrace(selectionTrace);
  return Object.freeze([
    selectionTraceCheckId,
    ...normalized.candidateIds.map((id) => `selection-trace-${id}`),
  ]);
}

export function releaseReadinessTraceCheckIds(releaseReadinessTrace) {
  const normalized = normalizeReleaseReadinessTrace(releaseReadinessTrace);
  return normalized.candidateCount === 0
    ? Object.freeze([])
    : Object.freeze([
        releaseReadinessTraceCheckId,
        ...normalized.candidateIds.map((id) => `release-readiness-${id}`),
      ]);
}

export function selectionTraceCheckRows(selectionTrace) {
  const normalized = normalizeSelectionTrace(selectionTrace);
  return Object.freeze([
    Object.freeze({
      id: selectionTraceCheckId,
      status: `${normalized.candidateCount} candidates`,
    }),
    ...normalized.candidates.map((candidate) =>
      Object.freeze({
        id: `selection-trace-${candidate.id}`,
        status: candidate.selected
          ? `selected:${candidate.status}`
          : `rank-${candidate.rank}:${candidate.status}`,
      }),
    ),
  ]);
}

export function releaseReadinessTraceCheckRows(releaseReadinessTrace) {
  const normalized = normalizeReleaseReadinessTrace(releaseReadinessTrace);
  return normalized.candidateCount === 0
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: releaseReadinessTraceCheckId,
          status: `${normalized.candidateCount} buildable candidates`,
        }),
        ...normalized.candidates.map((candidate) =>
          Object.freeze({
            id: `release-readiness-${candidate.id}`,
            status: candidate.selected
              ? `selected:${candidate.status}`
              : `rank-${candidate.rank}:${candidate.status}`,
          }),
        ),
      ]);
}

export function assertPriorityTraceVisibleChecks(
  traceName,
  trace,
  visibleChecks,
  { includeCandidateChecks = true, label = `${traceName} trace` } = {},
) {
  const checks = Array.isArray(visibleChecks) ? visibleChecks : [];
  const allCheckIds =
    traceName === "selection"
      ? selectionTraceCheckIds(trace)
      : releaseReadinessTraceCheckIds(trace);
  const checkIds = includeCandidateChecks ? allCheckIds : allCheckIds.slice(0, 1);
  for (const checkId of checkIds) {
    if (!checks.includes(checkId)) {
      throw new Error(`${label} missing visible check: ${checkId}`);
    }
  }
}

function assertReleaseReadinessSelectionMatchesAction(selected, nextAction, label) {
  if (
    nextAction.unproven?.id !== selected.id ||
    nextAction.command !== selected.command ||
    nextAction.unproven?.roleUrl !== selected.roleUrl ||
    nextAction.unproven?.proofGraphNodeId !== selected.proofGraphNodeId ||
    nextAction.status !== selected.actionStatus ||
    JSON.stringify(nextAction.unproven?.productionFeatureSpineTarget ?? null) !==
      JSON.stringify(selected.productionFeatureSpineTarget ?? null) ||
    JSON.stringify(nextAction.unproven?.spineDrilldown ?? null) !==
      JSON.stringify(selected.spineDrilldown ?? null) ||
    JSON.stringify(nextAction.unproven?.spineTarget ?? null) !==
      JSON.stringify(selected.spineTarget ?? null) ||
    JSON.stringify(nextAction.unproven?.selectedProductionFeatureGraph ?? null) !==
      JSON.stringify(selected.selectedProductionFeatureGraph ?? null) ||
    JSON.stringify(nextAction.unproven?.hostedHandoffChecklist ?? null) !==
      JSON.stringify(selected.hostedHandoffChecklist ?? null)
  ) {
    throw new Error(`${label} selection does not match action`);
  }
}

function unavailableSelectionTrace() {
  return Object.freeze({
    strategy: "unknown",
    candidateCount: 0,
    selectedArtifactId: null,
    candidateIds: Object.freeze([]),
    candidates: Object.freeze([]),
  });
}

function unavailableReleaseReadinessTrace() {
  return Object.freeze({
    strategy: "unknown",
    candidateCount: 0,
    selectedUnprovenId: null,
    candidateIds: Object.freeze([]),
    candidates: Object.freeze([]),
    selectedCandidate: null,
  });
}
