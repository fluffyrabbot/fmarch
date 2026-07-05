import {
  devTestGameRaceCoveragePath,
  raceCoveragePromotedReloadGroup,
} from "./dev_test_game_race_coverage_contracts.mjs";
import {
  devTestGameReleaseReadinessPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  hostStaleControlLaneIds,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import {
  staleConflictMessageLaneIds,
  staleConflictMessageSurfaceCases,
} from "./dev_test_game_hardening_recovery_scenarios.mjs";

export const recoveryTraceKeys = Object.freeze({
  replacementRaceReload: "replacementRaceReload",
  hostConcurrentRaceReload: "hostConcurrentRaceReload",
  playerConcurrentActionReload: "playerConcurrentActionReload",
  cohostDeadlineRaceReload: "cohostDeadlineRaceReload",
  staleConflictMessage: "staleConflictMessage",
  hostStaleControl: "hostStaleControl",
});

const raceReloadTraceDefinitions = Object.freeze({
  [recoveryTraceKeys.replacementRaceReload]: raceReloadTraceDefinition({
    key: recoveryTraceKeys.replacementRaceReload,
    traceKey: "replacementRaceReloadTrace",
    groupId: "replacement-race-reload",
    strategy: "replacement-race-reload-before-readiness",
  }),
  [recoveryTraceKeys.hostConcurrentRaceReload]: raceReloadTraceDefinition({
    key: recoveryTraceKeys.hostConcurrentRaceReload,
    traceKey: "hostConcurrentRaceReloadTrace",
    groupId: "host-concurrent-race-reload",
    strategy: "host-concurrent-race-reload-before-readiness",
  }),
  [recoveryTraceKeys.playerConcurrentActionReload]: raceReloadTraceDefinition({
    key: recoveryTraceKeys.playerConcurrentActionReload,
    traceKey: "playerConcurrentActionReloadTrace",
    groupId: "player-concurrent-action-reload",
    strategy: "player-concurrent-action-reload-before-readiness",
  }),
  [recoveryTraceKeys.cohostDeadlineRaceReload]: raceReloadTraceDefinition({
    key: recoveryTraceKeys.cohostDeadlineRaceReload,
    traceKey: "cohostDeadlineRaceReloadTrace",
    groupId: "cohost-deadline-race-reload",
    strategy: "cohost-deadline-race-reload-before-readiness",
  }),
});

const laneTraceDefinitions = Object.freeze({
  [recoveryTraceKeys.staleConflictMessage]: Object.freeze({
    key: recoveryTraceKeys.staleConflictMessage,
    traceKey: "staleConflictMessageTrace",
    strategy: "stale-conflict-message-before-readiness",
    milestoneCheckId: "stale-conflict-message-milestone",
    laneCheckPrefix: "stale-conflict-message",
    laneIds: staleConflictMessageLaneIds,
  }),
  [recoveryTraceKeys.hostStaleControl]: Object.freeze({
    key: recoveryTraceKeys.hostStaleControl,
    traceKey: "hostStaleControlTrace",
    strategy: "host-stale-control-before-readiness",
    milestoneCheckId: "host-stale-control-milestone",
    laneCheckPrefix: "host-stale-control",
    laneIds: hostStaleControlLaneIds,
  }),
});

export const recoveryTraceRegistry = Object.freeze({
  ...raceReloadTraceDefinitions,
  ...laneTraceDefinitions,
});

export const recoveryTraceRegistryEntries = Object.freeze(
  Object.values(recoveryTraceRegistry),
);

export function buildReplacementRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  return buildRaceReloadTrace(recoveryTraceKeys.replacementRaceReload, raceCoverage, {
    source,
  });
}

export function buildHostConcurrentRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  return buildRaceReloadTrace(
    recoveryTraceKeys.hostConcurrentRaceReload,
    raceCoverage,
    { source },
  );
}

export function buildPlayerConcurrentActionReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  return buildRaceReloadTrace(
    recoveryTraceKeys.playerConcurrentActionReload,
    raceCoverage,
    { source },
  );
}

export function buildCohostDeadlineRaceReloadTrace(
  raceCoverage,
  { source = devTestGameRaceCoveragePath } = {},
) {
  return buildRaceReloadTrace(
    recoveryTraceKeys.cohostDeadlineRaceReload,
    raceCoverage,
    { source },
  );
}

export function buildStaleConflictMessageTrace(readiness) {
  const milestone =
    readiness?.generatedFrom?.staleConflictMessageMilestone ??
    readiness?.localDevelopmentSpine?.evidence?.staleConflictMessageMilestone ??
    null;
  const check = readiness?.localDevelopmentSpine?.checks?.find?.(
    (candidate) => candidate.id === "local-stale-conflict-message-milestone",
  );
  const laneIds = Array.isArray(milestone?.laneIds)
    ? milestone.laneIds.map((laneId) => String(laneId))
    : staleConflictMessageLaneIds.map((laneId) => String(laneId));
  const surfaces = Array.isArray(milestone?.surfaces)
    ? milestone.surfaces.map((surface) => ({
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
      }))
    : [];
  const surfaceCoverage = normalizeStaleConflictMessageSurfaceCoverage({
    coverage: milestone?.surfaceCoverage,
    readiness,
    laneIds,
    surfaces,
  });
  const requiredLaneCount = Number(
    milestone?.requiredLaneCount ?? check?.requiredLaneCount ?? laneIds.length,
  );
  const coveredLaneCount = Number(
    milestone?.coveredLaneCount ?? check?.coveredLaneCount ?? 0,
  );
  const gapCount = Number(
    milestone?.gapCount ?? Math.max(requiredLaneCount - coveredLaneCount, 0),
  );
  return {
    strategy: laneTraceDefinitions.staleConflictMessage.strategy,
    status:
      readiness === null
        ? "unavailable"
        : check?.status === "passed" && gapCount === 0
          ? "covered"
          : "gapped",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    requiredLaneCount,
    coveredLaneCount,
    gapCount,
    laneIds,
    surfaceCoverage,
    surfaces,
  };
}

export function buildHostStaleControlTrace(readiness) {
  const milestone =
    readiness?.generatedFrom?.hostStaleControlMilestone ??
    readiness?.localDevelopmentSpine?.evidence?.hostStaleControlMilestone ??
    null;
  const check = readiness?.localDevelopmentSpine?.checks?.find?.(
    (candidate) => candidate.id === "local-host-stale-control-milestone",
  );
  const laneIds = Array.isArray(milestone?.laneIds)
    ? milestone.laneIds.map((laneId) => String(laneId))
    : hostStaleControlLaneIds.map((laneId) => String(laneId));
  const requiredLaneCount = Number(
    milestone?.requiredLaneCount ?? check?.requiredLaneCount ?? laneIds.length,
  );
  const coveredLaneCount = Number(
    milestone?.coveredLaneCount ?? check?.coveredLaneCount ?? 0,
  );
  const gapCount = Number(
    milestone?.gapCount ?? Math.max(requiredLaneCount - coveredLaneCount, 0),
  );
  return {
    strategy: laneTraceDefinitions.hostStaleControl.strategy,
    status:
      readiness === null
        ? "unavailable"
        : check?.status === "passed" && gapCount === 0
          ? "covered"
          : "gapped",
    source: readiness === null ? "" : devTestGameReleaseReadinessPath,
    requiredLaneCount,
    coveredLaneCount,
    gapCount,
    laneIds,
  };
}

export function normalizeRecoveryTrace(key, trace) {
  return raceReloadTraceDefinitions[key] === undefined
    ? normalizeLaneTrace(key, trace)
    : normalizeRaceReloadTrace(key, trace);
}

export function assertRecoveryTrace(
  key,
  trace,
  { label = `${key} recovery trace`, requireFullTrace = true } = {},
) {
  const definition = recoveryTraceDefinitionFor(key);
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== definition.strategy
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  return raceReloadTraceDefinitions[key] === undefined
    ? assertLaneTrace(key, trace, { label })
    : assertRaceReloadTrace(key, trace, { label, requireFullTrace });
}

export function recoveryTraceCheckIds(key, trace) {
  return raceReloadTraceDefinitions[key] === undefined
    ? laneTraceCheckIds(key, trace)
    : raceReloadTraceCheckIds(key, trace);
}

export function recoveryTraceCheckRows(key, trace) {
  return raceReloadTraceDefinitions[key] === undefined
    ? laneTraceCheckRows(key, trace)
    : raceReloadTraceCheckRows(key, trace);
}

export function recoveryTraceCheckIdsForTraces(tracesByKey) {
  return recoveryTraceRegistryEntries.flatMap((entry) =>
    recoveryTraceCheckIds(entry.key, tracesByKey?.[entry.key]),
  );
}

function buildRaceReloadTrace(key, raceCoverage, { source }) {
  const definition = raceReloadTraceDefinitionFor(key);
  const cells = definition.cellIds.map((id) => {
    const cell = raceCoverage?.cells?.find?.((candidate) => candidate.id === id);
    const reloadLaneId =
      typeof cell?.reloadLaneId === "string" ? cell.reloadLaneId : null;
    const reloadStatus = String(cell?.reloadStatus ?? "missing");
    const covered =
      cell?.status === "passed" && reloadLaneId !== null && reloadStatus === "passed";
    return {
      id,
      raceLaneId: String(cell?.raceLaneId ?? ""),
      reloadLaneId,
      reloadStatus,
      covered,
    };
  });
  const coveredCellCount = cells.filter((cell) => cell.covered).length;
  const gapCount = cells.length - coveredCellCount;
  return {
    strategy: definition.strategy,
    status: raceCoverage === null ? "unavailable" : gapCount === 0 ? "covered" : "gapped",
    source: raceCoverage === null ? "" : source,
    requiredCellCount: cells.length,
    coveredCellCount,
    gapCount,
    cells,
  };
}

function normalizeRaceReloadTrace(key, trace) {
  const definition = raceReloadTraceDefinitionFor(key);
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== definition.strategy
  ) {
    return unavailableRaceReloadTrace();
  }
  const cells = Array.isArray(trace.cells)
    ? trace.cells
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
        )
    : [];
  const cellIds = Array.isArray(trace.cellIds)
    ? trace.cellIds.map((id) => String(id))
    : cells.map((cell) => cell.id);
  return Object.freeze({
    strategy: definition.strategy,
    status: String(trace.status ?? "unknown"),
    source: String(trace.source ?? ""),
    requiredCellCount: Number(trace.requiredCellCount ?? cellIds.length),
    coveredCellCount: Number(trace.coveredCellCount ?? 0),
    gapCount: Number(trace.gapCount ?? 0),
    cellIds: Object.freeze(cellIds),
    cells: Object.freeze(cells),
  });
}

function assertRaceReloadTrace(
  key,
  trace,
  { label, requireFullTrace = true },
) {
  const definition = raceReloadTraceDefinitionFor(key);
  const normalized = normalizeRaceReloadTrace(key, trace);
  if (
    !["covered", "gapped", "unavailable"].includes(normalized.status) ||
    !Number.isInteger(normalized.requiredCellCount) ||
    !Number.isInteger(normalized.coveredCellCount) ||
    !Number.isInteger(normalized.gapCount)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    normalized.requiredCellCount !== definition.cellIds.length ||
    normalized.cellIds.length !== definition.cellIds.length ||
    normalized.coveredCellCount + normalized.gapCount !==
      normalized.requiredCellCount
  ) {
    throw new Error(`${label} count drifted`);
  }
  if (requireFullTrace && normalized.cells.length !== definition.cellIds.length) {
    throw new Error(`${label} cell details drifted`);
  }
  for (const id of definition.cellIds) {
    if (!normalized.cellIds.includes(id)) {
      throw new Error(`${label} missing cell: ${id}`);
    }
    const cell = normalized.cells.find((candidate) => candidate.id === id);
    if (requireFullTrace && cell === undefined) {
      throw new Error(`${label} missing cell: ${id}`);
    }
    if (cell?.covered === true && cell.reloadStatus !== "passed") {
      throw new Error(`${label} covered without reload: ${id}`);
    }
    if (requireFullTrace && cell !== undefined && typeof cell.covered !== "boolean") {
      throw new Error(`${label} malformed cell: ${id}`);
    }
  }
  assertCoverageStatusCounts(normalized, label);
  return normalized;
}

function raceReloadTraceCheckIds(key, trace) {
  const definition = raceReloadTraceDefinitionFor(key);
  const normalized = normalizeRaceReloadTrace(key, trace);
  return Object.freeze([
    definition.milestoneCheckId,
    ...normalized.cellIds.map((id) => `${definition.groupId}-${id}`),
  ]);
}

function raceReloadTraceCheckRows(key, trace) {
  const definition = raceReloadTraceDefinitionFor(key);
  const normalized = normalizeRaceReloadTrace(key, trace);
  return Object.freeze([
    Object.freeze({
      id: definition.milestoneCheckId,
      status: `${normalized.coveredCellCount}/${normalized.requiredCellCount} ${normalized.status}`,
    }),
    ...normalized.cells.map((cell) =>
      Object.freeze({
        id: `${definition.groupId}-${cell.id}`,
        status: cell.covered ? `covered:${cell.reloadStatus}` : `gap:${cell.reloadStatus}`,
      }),
    ),
  ]);
}

function normalizeLaneTrace(key, trace) {
  const definition = laneTraceDefinitionFor(key);
  if (
    trace === null ||
    typeof trace !== "object" ||
    trace.strategy !== definition.strategy
  ) {
    return unavailableLaneTrace();
  }
  return Object.freeze({
    strategy: definition.strategy,
    status: String(trace.status ?? "unknown"),
    source: String(trace.source ?? ""),
    requiredLaneCount: Number(trace.requiredLaneCount ?? 0),
    coveredLaneCount: Number(trace.coveredLaneCount ?? 0),
    gapCount: Number(trace.gapCount ?? 0),
    laneIds: Object.freeze(
      Array.isArray(trace.laneIds)
        ? trace.laneIds.map((laneId) => String(laneId))
        : [],
    ),
    surfaceCoverage: Object.freeze({
      status: String(trace.surfaceCoverage?.status ?? "unknown"),
      requiredSurfaceCount: Number(
        trace.surfaceCoverage?.requiredSurfaceCount ?? 0,
      ),
      coveredSurfaceCount: Number(
        trace.surfaceCoverage?.coveredSurfaceCount ?? 0,
      ),
      gapCount: Number(trace.surfaceCoverage?.gapCount ?? 0),
    }),
    surfaces: Object.freeze(
      (Array.isArray(trace.surfaces) ? trace.surfaces : []).map((surface) =>
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

function assertLaneTrace(key, trace, { label }) {
  const definition = laneTraceDefinitionFor(key);
  const normalized = normalizeLaneTrace(key, trace);
  if (
    !["covered", "gapped", "unavailable"].includes(normalized.status) ||
    !Number.isInteger(normalized.requiredLaneCount) ||
    !Number.isInteger(normalized.coveredLaneCount) ||
    !Number.isInteger(normalized.gapCount)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    normalized.requiredLaneCount !== definition.laneIds.length ||
    normalized.laneIds.length !== definition.laneIds.length ||
    normalized.coveredLaneCount + normalized.gapCount !==
      normalized.requiredLaneCount
  ) {
    throw new Error(`${label} count drifted`);
  }
  for (const laneId of definition.laneIds) {
    if (!normalized.laneIds.includes(laneId)) {
      throw new Error(`${label} missing lane: ${laneId}`);
    }
  }
  if (key === recoveryTraceKeys.staleConflictMessage) {
    assertStaleConflictMessageSurfaceTrace(normalized, label);
  }
  assertCoverageStatusCounts(normalized, label);
  return normalized;
}

function laneTraceCheckIds(key, trace) {
  const definition = laneTraceDefinitionFor(key);
  const normalized = normalizeLaneTrace(key, trace);
  return Object.freeze([
    definition.milestoneCheckId,
    ...(key === recoveryTraceKeys.staleConflictMessage
      ? ["stale-conflict-message-surface-coverage"]
      : []),
    ...normalized.laneIds.map((id) => `${definition.laneCheckPrefix}-${id}`),
    ...(key === recoveryTraceKeys.staleConflictMessage
      ? normalized.surfaces.map((surface) => surface.checkId)
      : []),
  ]);
}

function laneTraceCheckRows(key, trace) {
  const definition = laneTraceDefinitionFor(key);
  const normalized = normalizeLaneTrace(key, trace);
  return Object.freeze([
    Object.freeze({
      id: definition.milestoneCheckId,
      status: `${normalized.coveredLaneCount}/${normalized.requiredLaneCount} ${normalized.status}`,
    }),
    ...(key === recoveryTraceKeys.staleConflictMessage
      ? [
          Object.freeze({
            id: "stale-conflict-message-surface-coverage",
            status: `${normalized.surfaceCoverage.coveredSurfaceCount}/${normalized.surfaceCoverage.requiredSurfaceCount} ${normalized.surfaceCoverage.status}`,
          }),
        ]
      : []),
    ...normalized.laneIds.map((laneId) =>
      Object.freeze({
        id: `${definition.laneCheckPrefix}-${laneId}`,
        status: normalized.status,
      }),
    ),
    ...(key === recoveryTraceKeys.staleConflictMessage
      ? normalized.surfaces.map((surface) =>
          Object.freeze({
            id: surface.checkId,
            status: `${surface.status}:${surface.rejectError}`,
          }),
        )
      : []),
  ]);
}

function assertStaleConflictMessageSurfaceTrace(trace, label) {
  if (
    trace.surfaceCoverage === null ||
    typeof trace.surfaceCoverage !== "object" ||
    !["complete", "gapped", "unavailable"].includes(trace.surfaceCoverage.status) ||
    !Number.isInteger(trace.surfaceCoverage.requiredSurfaceCount) ||
    !Number.isInteger(trace.surfaceCoverage.coveredSurfaceCount) ||
    !Number.isInteger(trace.surfaceCoverage.gapCount) ||
    !Array.isArray(trace.surfaces)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  for (const scenario of staleConflictMessageSurfaceCases()) {
    const surface = trace.surfaces.find(
      (candidate) => candidate.id === scenario.id,
    );
    if (
      trace.status === "covered" &&
      (surface?.checkId !== scenario.checkId ||
        surface.laneId !== scenario.laneId ||
        surface.status !== "passed" ||
        !String(surface.roleUrl ?? "").includes("/g/") ||
        (scenario.expectedReceiptFragment !== undefined &&
          !String(surface.receiptStatusText ?? "").includes(
            scenario.expectedReceiptFragment,
          )) ||
        (scenario.expectedRejectMessageFragment !== undefined &&
          !String(surface.rejectMessage ?? "").includes(
            scenario.expectedRejectMessageFragment,
          )))
    ) {
      throw new Error(`${label} missing surface: ${scenario.id}`);
    }
  }
  if (
    trace.status === "covered" &&
    (trace.surfaceCoverage.status !== "complete" ||
      trace.surfaceCoverage.requiredSurfaceCount !==
        staleConflictMessageLaneIds.length ||
      trace.surfaceCoverage.coveredSurfaceCount !==
        staleConflictMessageSurfaceCases().length ||
      trace.surfaceCoverage.gapCount !== 0)
  ) {
    throw new Error(`${label} covered without complete surfaces`);
  }
}

function normalizeStaleConflictMessageSurfaceCoverage({
  coverage,
  readiness,
  laneIds,
  surfaces,
}) {
  if (readiness === null) {
    return {
      status: "unavailable",
      requiredSurfaceCount: laneIds.length,
      coveredSurfaceCount: 0,
      gapCount: laneIds.length,
    };
  }
  const requiredSurfaceCount = Number(
    coverage?.requiredSurfaceCount ?? laneIds.length,
  );
  const coveredSurfaceCount = Number(
    coverage?.coveredSurfaceCount ??
      surfaces.filter((surface) => surface.status === "passed").length,
  );
  const gapCount = Number(
    coverage?.gapCount ?? Math.max(requiredSurfaceCount - coveredSurfaceCount, 0),
  );
  return {
    status:
      coverage?.status === "complete" && gapCount === 0
        ? "complete"
        : gapCount === 0
          ? "complete"
          : "gapped",
    requiredSurfaceCount,
    coveredSurfaceCount,
    gapCount,
  };
}

function assertCoverageStatusCounts(trace, label) {
  if (trace.status === "covered" && trace.gapCount !== 0) {
    throw new Error(`${label} covered with gaps`);
  }
  if (trace.status === "gapped" && trace.gapCount === 0) {
    throw new Error(`${label} gapped without gaps`);
  }
}

function raceReloadTraceDefinitionFor(key) {
  const definition = raceReloadTraceDefinitions[key];
  if (definition === undefined) {
    throw new Error(`unknown race reload recovery trace: ${key}`);
  }
  return definition;
}

function laneTraceDefinitionFor(key) {
  const definition = laneTraceDefinitions[key];
  if (definition === undefined) {
    throw new Error(`unknown lane recovery trace: ${key}`);
  }
  return definition;
}

function recoveryTraceDefinitionFor(key) {
  const definition = raceReloadTraceDefinitions[key] ?? laneTraceDefinitions[key];
  if (definition === undefined) {
    throw new Error(`unknown recovery trace: ${key}`);
  }
  return definition;
}

function raceReloadTraceDefinition({ key, traceKey, groupId, strategy }) {
  return Object.freeze({
    key,
    traceKey,
    groupId,
    strategy,
    milestoneCheckId: `${groupId}-milestone`,
    cellIds: Object.freeze([...raceCoveragePromotedReloadGroup(groupId).cellIds]),
  });
}

function unavailableRaceReloadTrace() {
  return Object.freeze({
    strategy: "unknown",
    status: "unknown",
    source: "",
    requiredCellCount: 0,
    coveredCellCount: 0,
    gapCount: 0,
    cellIds: Object.freeze([]),
    cells: Object.freeze([]),
  });
}

function unavailableLaneTrace() {
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
