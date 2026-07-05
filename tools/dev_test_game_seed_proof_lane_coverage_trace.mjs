export const seedProofLaneCoverageTraceStrategy =
  "seed-proof-lane-coverage-before-readiness";
export const seedProofLaneCoverageTraceCheckId =
  "seed-proof-lane-coverage-trace";

export function seedProofLaneCoverageDriftFromReadiness(
  readiness,
  { source = "", checkId = "local-seed-demo-fixture" } = {},
) {
  const seedCheck = readiness?.localDevelopmentSpine?.checks?.find?.(
    (check) => check?.id === checkId,
  );
  const coverage = seedCheck?.proofLaneCoverage;
  const unclassifiedLaneIds = Array.isArray(coverage?.unclassified?.laneIds)
    ? coverage.unclassified.laneIds.map((laneId) => String(laneId))
    : [];
  const unclassifiedLaneCount = numberOrZero(
    coverage?.unclassified?.count ?? unclassifiedLaneIds.length,
  );
  return Object.freeze({
    strategy: seedProofLaneCoverageTraceStrategy,
    status:
      readiness === null || coverage === null || typeof coverage !== "object"
        ? "unavailable"
        : unclassifiedLaneCount > 0
          ? "drifted"
          : "clean",
    source: readiness === null ? "" : source,
    checkId: seedCheck?.id ?? null,
    passedLaneCount: numberOrZero(coverage?.passedLaneCount),
    directSeededLaneCount: numberOrZero(coverage?.directSeeded?.count),
    aliasOnlyLaneCount: numberOrZero(coverage?.aliasOnly?.count),
    aggregateOnlyLaneCount: numberOrZero(coverage?.aggregateOnly?.count),
    unclassifiedLaneCount,
    unclassifiedLaneIds: Object.freeze(unclassifiedLaneIds),
  });
}

export function buildSeedProofLaneCoverageTrace(seedProofLaneCoverageDrift) {
  return normalizeSeedProofLaneCoverageTrace({
    ...seedProofLaneCoverageDrift,
    selected: seedProofLaneCoverageDrift?.status === "drifted",
  });
}

export function cleanSeedProofLaneCoverageTrace(seedProofLaneCoverageTrace) {
  const normalized = normalizeSeedProofLaneCoverageTrace(
    seedProofLaneCoverageTrace,
  );
  return Object.freeze({
    ...normalized,
    status: "clean",
    selected: false,
    unclassifiedLaneCount: 0,
    unclassifiedLaneIds: Object.freeze([]),
  });
}

export function normalizeSeedProofLaneCoverageTrace(seedProofLaneCoverageTrace) {
  if (
    seedProofLaneCoverageTrace === null ||
    typeof seedProofLaneCoverageTrace !== "object" ||
    seedProofLaneCoverageTrace.strategy !== seedProofLaneCoverageTraceStrategy ||
    !Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
  ) {
    return unavailableSeedProofLaneCoverageTrace();
  }
  return Object.freeze({
    strategy: seedProofLaneCoverageTraceStrategy,
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

export function assertSeedProofLaneCoverageTrace(
  seedProofLaneCoverageTrace,
  {
    label = "seed proof-lane coverage trace",
    nextActionReason = null,
  } = {},
) {
  if (
    seedProofLaneCoverageTrace === null ||
    typeof seedProofLaneCoverageTrace !== "object" ||
    seedProofLaneCoverageTrace.strategy !== seedProofLaneCoverageTraceStrategy ||
    !Array.isArray(seedProofLaneCoverageTrace.unclassifiedLaneIds)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  const normalized = normalizeSeedProofLaneCoverageTrace(
    seedProofLaneCoverageTrace,
  );
  if (
    !["clean", "drifted", "unavailable"].includes(normalized.status) ||
    normalized.selected !== seedProofLaneCoverageTrace.selected ||
    !Number.isInteger(normalized.unclassifiedLaneCount)
  ) {
    throw new Error(`${label} is missing or malformed`);
  }
  if (
    nextActionReason === "seed-proof-lane-coverage-drift" &&
    (normalized.status !== "drifted" ||
      normalized.selected !== true ||
      normalized.unclassifiedLaneIds.length === 0)
  ) {
    throw new Error(`${label} does not match selected drift`);
  }
  if (
    nextActionReason !== null &&
    nextActionReason !== "seed-proof-lane-coverage-drift" &&
    normalized.selected === true
  ) {
    throw new Error(`${label} selected without drift action`);
  }
  if (
    normalized.unclassifiedLaneCount !== normalized.unclassifiedLaneIds.length
  ) {
    throw new Error(`${label} count drifted`);
  }
  return normalized;
}

export function seedProofLaneCoverageTraceCheckIds(seedProofLaneCoverageTrace) {
  const normalized = normalizeSeedProofLaneCoverageTrace(
    seedProofLaneCoverageTrace,
  );
  return normalized.status === "unavailable"
    ? Object.freeze([])
    : Object.freeze([
        seedProofLaneCoverageTraceCheckId,
        ...normalized.unclassifiedLaneIds.map(
          (laneId) => `seed-proof-lane-coverage-${laneId}`,
        ),
      ]);
}

export function seedProofLaneCoverageTraceCheckRows(seedProofLaneCoverageTrace) {
  const normalized = normalizeSeedProofLaneCoverageTrace(
    seedProofLaneCoverageTrace,
  );
  const checkIds = seedProofLaneCoverageTraceCheckIds(normalized);
  return normalized.status === "unavailable"
    ? Object.freeze([])
    : Object.freeze([
        Object.freeze({
          id: checkIds[0],
          status: `${normalized.unclassifiedLaneCount} unclassified lanes`,
        }),
        ...normalized.unclassifiedLaneIds.map((_, index) =>
          Object.freeze({
            id: checkIds[index + 1],
            status: "unclassified",
          }),
        ),
      ]);
}

export function assertSeedProofLaneCoverageTraceVisibleChecks(
  seedProofLaneCoverageTrace,
  visibleChecks,
  { label = "seed proof-lane coverage trace" } = {},
) {
  const normalized = assertSeedProofLaneCoverageTrace(
    seedProofLaneCoverageTrace,
    { label },
  );
  const checks = Array.isArray(visibleChecks) ? visibleChecks : [];
  for (const checkId of seedProofLaneCoverageTraceCheckIds(normalized)) {
    if (!checks.includes(checkId)) {
      throw new Error(`${label} missing visible check: ${checkId}`);
    }
  }
  return normalized;
}

function unavailableSeedProofLaneCoverageTrace() {
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

function numberOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
