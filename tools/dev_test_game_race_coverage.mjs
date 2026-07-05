import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellIdsForPromotedGroup,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  cohostHostRaceCoverageCellCases,
  cohostHostRaceCoverageCellIds,
  playerHostRaceCoverageCellCases,
  playerHostRaceCoverageCellIds,
} from "./dev_test_game_cross_role_race_scenarios.mjs";
import {
  hostPhaseRaceCoverageCellCases,
  hostPhaseRaceCoverageCellIds,
  hostStandaloneRaceCoverageCellCases,
  hostStandaloneRaceCoverageCellIds,
} from "./dev_test_game_host_stale_recovery_scenarios.mjs";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";
import {
  devTestGameProofRunPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export const DEV_TEST_GAME_RACE_COVERAGE_VERSION = 1;
export const devTestGameRaceCoveragePath =
  "target/dev-test-game/race-coverage.json";
export const devTestGameRaceCoverageAdminProofPath =
  "target/dev-test-game/race-coverage-admin-proof.json";
export const devTestGameRaceCoverageCommand = "test:dev-test-game-race-coverage";

const raceCoverageJsonPath = path.join(repoRoot, devTestGameRaceCoveragePath);
const hostPhaseRaceCoverageCells = hostPhaseRaceCoverageCellCases().map(raceCell);
const hostStandaloneRaceCoverageCells =
  hostStandaloneRaceCoverageCellCases().map(raceCell);
const playerHostRaceCoverageCells =
  playerHostRaceCoverageCellCases().map(raceCell);
const cohostHostRaceCoverageCells =
  cohostHostRaceCoverageCellCases().map(raceCell);
const hostMixedAdvanceRaceCoverageCellId = "host-mixed-advance";
const hostLifecycleRaceCoverageCellId = "host-lifecycle";
const hostVotecountPublicationRaceCoverageCellId =
  "host-votecount-publication";

const raceCells = Object.freeze([
  raceCell({
    id: "player-vote-change",
    actorPair: "player vs player",
    commandFamily: "day vote",
    raceLaneId: "concurrent-vote-race",
    reloadLaneId: "concurrent-vote-race-reload",
    roleSurfaces: ["player", "host"],
  }),
  raceCell({
    id: "player-night-action",
    actorPair: "player vs player",
    commandFamily: "night action",
    raceLaneId: "concurrent-action-race",
    reloadLaneId: "concurrent-action-race-reload",
    roleSurfaces: ["player", "host"],
  }),
  ...playerHostRaceCoverageCells,
  ...cohostHostRaceCoverageCells,
  raceCell({
    id: "replacement-private-post",
    actorPair: "replacement vs outgoing player",
    commandFamily: "private channel post",
    raceLaneId: "concurrent-replacement-private-post-race",
    reloadLaneId: "concurrent-replacement-private-post-race-reload",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  raceCell({
    id: "replacement-vote",
    actorPair: "replacement vs outgoing player",
    commandFamily: "day vote",
    raceLaneId: "concurrent-replacement-vote-race",
    reloadLaneId: "concurrent-replacement-vote-race-reload",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  raceCell({
    id: "replacement-action",
    actorPair: "replacement vs outgoing player",
    commandFamily: "night action",
    raceLaneId: "concurrent-replacement-action-race",
    reloadLaneId: "concurrent-replacement-action-race-reload",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  ...hostPhaseRaceCoverageCells.filter(
    (cell) => cell.id !== hostMixedAdvanceRaceCoverageCellId,
  ),
  ...hostStandaloneRaceCoverageCells.filter(
    (cell) => cell.id === hostLifecycleRaceCoverageCellId,
  ),
  ...hostPhaseRaceCoverageCells.filter(
    (cell) => cell.id === hostMixedAdvanceRaceCoverageCellId,
  ),
  ...hostStandaloneRaceCoverageCells.filter(
    (cell) => cell.id === hostVotecountPublicationRaceCoverageCellId,
  ),
  ...completedGameRaceCoverageCellCases().map(raceCell),
]);

export const raceCoveragePromotedReloadGroups = Object.freeze(
  [
    {
      id: "replacement-race-reload",
      label: "Replacement race reload",
      cellIds: [
        "replacement-private-post",
        "replacement-vote",
        "replacement-action",
      ],
    },
    {
      id: "host-concurrent-race-reload",
      label: "Host concurrent race reload",
      cellIds: [
        ...hostPhaseRaceCoverageCellIds().filter(
          (id) => id !== "host-mixed-advance",
        ),
        hostLifecycleRaceCoverageCellId,
        "host-mixed-advance",
        ...hostStandaloneRaceCoverageCellIds().filter(
          (id) => id === hostVotecountPublicationRaceCoverageCellId,
        ),
        ...completedGameRaceCoverageCellIdsForPromotedGroup(
          "host-concurrent-race-reload",
        ),
      ],
    },
    {
      id: "player-concurrent-action-reload",
      label: "Player concurrent action reload",
      cellIds: [
        "player-vote-change",
        "player-night-action",
        ...playerHostRaceCoverageCellIds(),
        ...completedGameRaceCoverageCellIdsForPromotedGroup(
          "player-concurrent-action-reload",
        ),
      ],
    },
    {
      id: "cohost-deadline-race-reload",
      label: "Cohost deadline race reload",
      cellIds: cohostHostRaceCoverageCellIds(),
    },
  ].map((group) =>
    Object.freeze({
      ...group,
      cellIds: Object.freeze(group.cellIds),
    }),
  ),
);

export function raceCoveragePromotedReloadGroup(groupId) {
  const group = raceCoveragePromotedReloadGroups.find(
    (candidate) => candidate.id === groupId,
  );
  if (group === undefined) {
    throw new Error(`unknown race coverage promoted reload group: ${groupId}`);
  }
  return group;
}

export function replacementRaceCoveragePromotedReloadGroup() {
  return raceCoveragePromotedReloadGroup("replacement-race-reload");
}

export function cohostDeadlineRaceCoveragePromotedReloadGroup() {
  return raceCoveragePromotedReloadGroup("cohost-deadline-race-reload");
}

function completedGameRaceCoveragePromotedReloadGroupForProofGroup(proofGroup) {
  const cell = completedGameRaceCoverageCellCases().find(
    (candidate) => candidate.proofGroup === proofGroup,
  );
  if (cell === undefined) {
    throw new Error(
      `unknown completed-game race coverage proof group: ${proofGroup}`,
    );
  }
  return raceCoveragePromotedReloadGroup(cell.promotedReloadGroupId);
}

export function completedHostRaceCoveragePromotedReloadGroup() {
  return completedGameRaceCoveragePromotedReloadGroupForProofGroup(
    "host-complete-race",
  );
}

export function completedPlayerRaceCoveragePromotedReloadGroup() {
  return completedGameRaceCoveragePromotedReloadGroupForProofGroup(
    "player-complete-race",
  );
}

const localReadinessMilestoneDefinitions = Object.freeze([
  Object.freeze({
    groupId: "host-concurrent-race-reload",
    checkId: "local-host-concurrent-race-reload-milestone",
    generatedFromKey: "hostConcurrentRaceReloadMilestone",
    proofBoundary:
      "Local race-coverage proof that host resolve, advance, deadline, lifecycle, mixed advance, votecount publication, and complete-game races all have reload recovery coverage.",
  }),
  Object.freeze({
    groupId: "player-concurrent-action-reload",
    checkId: "local-player-concurrent-action-reload-milestone",
    generatedFromKey: "playerConcurrentActionReloadMilestone",
    proofBoundary:
      "Local race-coverage proof that player vote changes, night actions, player-vs-host phase races, and completed-game reload recovery all have reload coverage.",
  }),
  Object.freeze({
    groupId: "cohost-deadline-race-reload",
    checkId: "local-cohost-deadline-race-reload-milestone",
    generatedFromKey: "cohostDeadlineRaceReloadMilestone",
    proofBoundary:
      "Local race-coverage proof that the cohost deadline extension versus host resolve race has reload recovery coverage.",
  }),
]);

export const raceCoverageLocalReadinessMilestoneDefinitions = Object.freeze(
  localReadinessMilestoneDefinitions.map((definition) => {
    const group = raceCoveragePromotedReloadGroup(definition.groupId);
    return Object.freeze({
      id: definition.checkId,
      groupId: group.id,
      generatedFromKey: definition.generatedFromKey,
      label: `${group.label} coverage`,
      proofBoundary: definition.proofBoundary,
      cellIds: group.cellIds,
    });
  }),
);

export function raceCoverageLocalReadinessMilestoneCases() {
  return raceCoverageLocalReadinessMilestoneDefinitions.map((definition) => ({
    ...definition,
    cellIds: [...definition.cellIds],
  }));
}

export function buildDevTestGameRaceCoverage(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    sourcePath = devTestGameProofRunPath,
  } = {},
) {
  const proof = assertDevTestGameProofRun(proofRun);
  const laneById = new Map(proof.lanes.map((lane) => [lane.id, lane]));
  const cells = raceCells.map((cell) => buildRaceCoverageCell(cell, laneById));
  const unprovenCells = cells.filter((cell) => cell.status !== "passed");
  const reloadRequiredCells = cells.filter((cell) => cell.reloadLaneId !== null);
  const reloadGaps = cells.filter(
    (cell) => cell.reloadLaneId !== null && cell.reloadCoverage !== "passed",
  );
  const evidence = {
    version: DEV_TEST_GAME_RACE_COVERAGE_VERSION,
    proof: "dev-test-game-race-coverage",
    status: unprovenCells.length === 0 ? "passed" : "blocked",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-race-coverage",
    proofBoundary:
      "Generated local race-coverage inventory over the saved dev-test-game proof-run lanes. Passing means the listed local seeded-game race cells and reload/recovery companions are proven; it does not claim exhaustive command-space coverage, hosted concurrency hardening, beta readiness, release readiness, or production readiness.",
    generatedFrom: {
      proofRun: sourcePath,
      proofGeneratedAt: proof.generatedAt,
      game: proof.session.game,
      laneCount: proof.lanes.length,
    },
    summary: {
      cellCount: cells.length,
      provenCellCount: cells.length - unprovenCells.length,
      unprovenCellCount: unprovenCells.length,
      reloadRequiredCellCount: reloadRequiredCells.length,
      reloadCoveredCellCount: reloadRequiredCells.length - reloadGaps.length,
      reloadGapCount: reloadGaps.length,
      actorPairs: Array.from(new Set(cells.map((cell) => cell.actorPair))).sort(),
      commandFamilies: Array.from(new Set(cells.map((cell) => cell.commandFamily))).sort(),
    },
    cells,
    unprovenCells: unprovenCells.map(({ id, actorPair, commandFamily, missingLaneIds }) => ({
      id,
      actorPair,
      commandFamily,
      missingLaneIds,
    })),
    reloadGaps: reloadGaps.map(({ id, actorPair, commandFamily, reloadLaneId }) => ({
      id,
      actorPair,
      commandFamily,
      reloadLaneId,
    })),
  };
  assertDevTestGameRaceCoverage(evidence);
  return evidence;
}

export function assertDevTestGameRaceCoverage(evidence) {
  if (evidence?.version !== DEV_TEST_GAME_RACE_COVERAGE_VERSION) {
    throw new Error(`race coverage version drifted: ${evidence?.version}`);
  }
  if (evidence.proof !== "dev-test-game-race-coverage") {
    throw new Error(`unexpected race coverage proof id: ${evidence.proof}`);
  }
  if (evidence.scope !== "local-dev-test-game-race-coverage") {
    throw new Error(`race coverage scope drifted: ${evidence.scope}`);
  }
  if (!["passed", "blocked"].includes(evidence.status)) {
    throw new Error(`race coverage status drifted: ${evidence.status}`);
  }
  if (evidence.releaseReady !== false || evidence.productionReady !== false) {
    throw new Error("race coverage must not claim production or release readiness");
  }
  if (!Array.isArray(evidence.cells) || evidence.cells.length !== raceCells.length) {
    throw new Error("race coverage cell inventory drifted");
  }
  const cellIds = new Set();
  for (const cell of evidence.cells) {
    if (typeof cell.id !== "string" || cell.id.trim() === "") {
      throw new Error("race coverage cell missing id");
    }
    if (cellIds.has(cell.id)) {
      throw new Error(`race coverage duplicate cell id: ${cell.id}`);
    }
    cellIds.add(cell.id);
    if (cell.raceStatus !== "passed") {
      throw new Error(`race coverage cell missing passed race lane: ${cell.id}`);
    }
    if (cell.reloadLaneId !== null && cell.reloadStatus !== "passed") {
      throw new Error(`race coverage cell missing passed reload lane: ${cell.id}`);
    }
    if (!Array.isArray(cell.provenBy) || cell.provenBy.length === 0) {
      throw new Error(`race coverage cell missing proof lanes: ${cell.id}`);
    }
  }
  if (
    evidence.summary?.cellCount !== evidence.cells.length ||
    evidence.summary.provenCellCount + evidence.summary.unprovenCellCount !==
      evidence.cells.length
  ) {
    throw new Error("race coverage summary drifted");
  }
  if (evidence.status === "passed" && evidence.summary.unprovenCellCount !== 0) {
    throw new Error("passed race coverage cannot have unproven cells");
  }
  return evidence;
}

export async function writeDevTestGameRaceCoverage({
  generatedAt = new Date().toISOString(),
  proofRunPath = process.env.FMARCH_DEV_TEST_GAME_PROOF_RUN ??
    devTestGameProofRunPath,
} = {}) {
  const absoluteProofRunPath = path.resolve(repoRoot, proofRunPath);
  const proofRun = JSON.parse(await readFile(absoluteProofRunPath, "utf8"));
  const evidence = buildDevTestGameRaceCoverage(proofRun, {
    generatedAt,
    sourcePath: path.relative(repoRoot, absoluteProofRunPath),
  });
  await mkdir(path.dirname(raceCoverageJsonPath), { recursive: true });
  await writeFile(raceCoverageJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  return evidence;
}

function raceCell({
  id,
  actorPair,
  commandFamily,
  raceLaneId,
  reloadLaneId = null,
  roleSurfaces,
  commandFacts = [],
}) {
  return Object.freeze({
    id,
    actorPair,
    commandFamily,
    raceLaneId,
    reloadLaneId,
    roleSurfaces: Object.freeze(roleSurfaces),
    commandFacts: Object.freeze(
      commandFacts.map((facts) => Object.freeze({ ...facts })),
    ),
  });
}

function buildRaceCoverageCell(cell, laneById) {
  const raceLane = laneById.get(cell.raceLaneId);
  const reloadLane =
    cell.reloadLaneId === null ? null : laneById.get(cell.reloadLaneId);
  const missingLaneIds = [
    ...(raceLane?.status === "passed" ? [] : [cell.raceLaneId]),
    ...(cell.reloadLaneId === null || reloadLane?.status === "passed"
      ? []
      : [cell.reloadLaneId]),
  ];
  return {
    ...cell,
    status: missingLaneIds.length === 0 ? "passed" : "blocked",
    raceStatus: raceLane?.status ?? "missing",
    reloadStatus: cell.reloadLaneId === null ? "not_applicable" : reloadLane?.status ?? "missing",
    reloadCoverage: cell.reloadLaneId === null ? "not_applicable" : reloadLane?.status ?? "missing",
    missingLaneIds,
    provenBy: [
      ...(raceLane?.status === "passed" ? [cell.raceLaneId] : []),
      ...(cell.reloadLaneId !== null && reloadLane?.status === "passed"
        ? [cell.reloadLaneId]
        : []),
    ],
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const evidence = await writeDevTestGameRaceCoverage();
  console.log(`wrote ${devTestGameRaceCoveragePath} (${evidence.status})`);
}
