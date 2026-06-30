import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertDevTestGameProofRun } from "./dev_test_game_proof_contract.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const DEV_TEST_GAME_RACE_COVERAGE_VERSION = 1;
export const devTestGameRaceCoveragePath =
  "target/dev-test-game/race-coverage.json";
export const devTestGameRaceCoverageCommand = "test:dev-test-game-race-coverage";

const raceCoverageJsonPath = path.join(repoRoot, devTestGameRaceCoveragePath);

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
  raceCell({
    id: "player-vote-vs-host-resolve",
    actorPair: "player vs host",
    commandFamily: "vote resolution",
    raceLaneId: "concurrent-player-vote-resolve-race",
    reloadLaneId: "concurrent-player-vote-resolve-race-reload",
    roleSurfaces: ["player", "host"],
  }),
  raceCell({
    id: "player-action-vs-host-advance",
    actorPair: "player vs host",
    commandFamily: "action submission and phase advance",
    raceLaneId: "concurrent-player-action-advance-race",
    reloadLaneId: "concurrent-player-action-advance-race-reload",
    roleSurfaces: ["player", "host"],
  }),
  raceCell({
    id: "cohost-deadline-vs-host-resolve",
    actorPair: "cohost vs host",
    commandFamily: "deadline and resolution",
    raceLaneId: "concurrent-cohost-deadline-resolve-race",
    reloadLaneId: "concurrent-cohost-deadline-resolve-race-reload",
    roleSurfaces: ["cohost", "host"],
  }),
  raceCell({
    id: "replacement-private-post",
    actorPair: "replacement vs outgoing player",
    commandFamily: "private channel post",
    raceLaneId: "concurrent-replacement-private-post-race",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  raceCell({
    id: "replacement-vote",
    actorPair: "replacement vs outgoing player",
    commandFamily: "day vote",
    raceLaneId: "concurrent-replacement-vote-race",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  raceCell({
    id: "replacement-action",
    actorPair: "replacement vs outgoing player",
    commandFamily: "night action",
    raceLaneId: "concurrent-replacement-action-race",
    roleSurfaces: ["player", "replacementPlayer", "host"],
  }),
  raceCell({
    id: "host-resolve",
    actorPair: "host vs host",
    commandFamily: "phase resolution",
    raceLaneId: "concurrent-host-resolve-race",
    reloadLaneId: "concurrent-host-resolve-race-reload",
    roleSurfaces: ["host"],
  }),
  raceCell({
    id: "host-advance",
    actorPair: "host vs host",
    commandFamily: "phase advance",
    raceLaneId: "concurrent-host-advance-race",
    reloadLaneId: "concurrent-host-advance-race-reload",
    roleSurfaces: ["host"],
  }),
  raceCell({
    id: "host-deadline-advance",
    actorPair: "host vs host",
    commandFamily: "deadline and phase advance",
    raceLaneId: "concurrent-host-deadline-advance-race",
    reloadLaneId: "concurrent-host-deadline-advance-race-reload",
    roleSurfaces: ["host"],
  }),
  raceCell({
    id: "host-lifecycle",
    actorPair: "host vs host",
    commandFamily: "host lifecycle controls",
    raceLaneId: "concurrent-host-lifecycle-race",
    reloadLaneId: "concurrent-host-lifecycle-race-reload",
    roleSurfaces: ["host"],
  }),
  raceCell({
    id: "host-mixed-advance",
    actorPair: "host vs host",
    commandFamily: "mixed phase advance controls",
    raceLaneId: "concurrent-host-mixed-advance-race",
    reloadLaneId: "concurrent-host-mixed-advance-race-reload",
    roleSurfaces: ["host"],
  }),
  raceCell({
    id: "host-votecount-publication",
    actorPair: "host vs host",
    commandFamily: "official votecount publication",
    raceLaneId: "concurrent-host-publish-race",
    reloadLaneId: "concurrent-host-publish-race-reload",
    roleSurfaces: ["host", "player"],
  }),
  raceCell({
    id: "host-complete-game",
    actorPair: "host vs host",
    commandFamily: "complete game",
    raceLaneId: "concurrent-host-complete-race",
    reloadLaneId: "concurrent-host-complete-race-reload",
    roleSurfaces: ["host", "player"],
  }),
  raceCell({
    id: "player-vs-completed-game",
    actorPair: "player vs host",
    commandFamily: "post-completion recovery",
    raceLaneId: "concurrent-player-complete-race",
    reloadLaneId: "public-player-complete-reload",
    roleSurfaces: ["player", "host"],
  }),
]);

export function buildDevTestGameRaceCoverage(
  proofRun,
  {
    generatedAt = new Date().toISOString(),
    sourcePath = "target/dev-test-game/proof-run.json",
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
    "target/dev-test-game/proof-run.json",
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
}) {
  return Object.freeze({
    id,
    actorPair,
    commandFamily,
    raceLaneId,
    reloadLaneId,
    roleSurfaces: Object.freeze(roleSurfaces),
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
