export function cloneLaneCoverageFamilies(familyDefinitions) {
  return familyDefinitions.map((family) => ({
    ...family,
    laneIds: [...family.laneIds],
  }));
}

export function buildLaneCoverageSummary({ lanes, laneIds, families }) {
  const laneById = new Map((lanes ?? []).map((lane) => [lane.id, lane]));
  const coverageFamilies = cloneLaneCoverageFamilies(families).map((family) => {
    const passedLaneIds = family.laneIds.filter(
      (laneId) => laneById.get(laneId)?.status === "passed",
    );
    return {
      ...family,
      status:
        passedLaneIds.length === family.laneIds.length ? "passed" : "failed",
      passedLaneIds,
    };
  });
  const laneStatuses = coverageFamilies.flatMap((family) =>
    family.laneIds.map((laneId) => ({
      id: laneId,
      family: family.id,
      status: String(laneById.get(laneId)?.status ?? "missing"),
    })),
  );
  const passedLaneCount = laneStatuses.filter(
    (laneStatus) => laneStatus.status === "passed",
  ).length;
  return {
    status: passedLaneCount === laneIds.length ? "passed" : "failed",
    laneCount: laneIds.length,
    passedLaneCount,
    familyCount: coverageFamilies.length,
    expectedLaneCount: laneIds.length,
    expectedFamilyCount: families.length,
    sourceLaneIds: [...laneIds],
    laneStatuses,
    families: coverageFamilies,
  };
}

export function assertLaneCoverageSummary({
  summary,
  lanes,
  laneIds,
  familyDefinitions,
  label,
}) {
  const laneById = new Map((lanes ?? []).map((lane) => [lane.id, lane]));
  if (
    summary?.status !== "passed" ||
    summary.laneCount !== laneIds.length ||
    summary.passedLaneCount !== laneIds.length ||
    summary.familyCount !== familyDefinitions.length ||
    summary.expectedLaneCount !== laneIds.length ||
    summary.expectedFamilyCount !== familyDefinitions.length ||
    !sameArray(summary.sourceLaneIds, laneIds)
  ) {
    throw new Error(`${label} coverage summary drifted`);
  }
  for (const family of familyDefinitions) {
    const summaryFamily = summary.families?.find(
      (candidate) => candidate.id === family.id,
    );
    if (
      summaryFamily?.status !== "passed" ||
      !sameArray(summaryFamily.laneIds, family.laneIds) ||
      !sameArray(summaryFamily.passedLaneIds, family.laneIds)
    ) {
      throw new Error(`${label} coverage family drifted: ${family.id}`);
    }
    for (const laneId of family.laneIds) {
      const laneStatus = summary.laneStatuses?.find(
        (candidate) => candidate.id === laneId,
      );
      if (
        laneById.get(laneId)?.status !== "passed" ||
        laneStatus?.status !== "passed" ||
        laneStatus.family !== family.id
      ) {
        throw new Error(`${label} coverage missing passed lane: ${laneId}`);
      }
    }
  }
  return summary;
}

function sameArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}
