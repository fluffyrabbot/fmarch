import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellDefinitions,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";

test("race coverage imports completed-game cells from shared scenarios", () => {
  assert(Object.isFrozen(completedGameRaceCoverageCellDefinitions));
  assert.deepEqual(
    completedGameRaceCoverageCellCases().map((cell) => ({
      id: cell.id,
      raceLaneId: cell.raceLaneId,
      reloadLaneId: cell.reloadLaneId,
      promotedReloadGroupId: cell.promotedReloadGroupId,
      roleSurfaces: cell.roleSurfaces,
    })),
    [
      {
        id: "host-complete-game",
        raceLaneId: "concurrent-host-complete-race",
        reloadLaneId: "concurrent-host-complete-race-reload",
        promotedReloadGroupId: "host-concurrent-race-reload",
        roleSurfaces: ["host", "player"],
      },
      {
        id: "player-vs-completed-game",
        raceLaneId: "concurrent-player-complete-race",
        reloadLaneId: "public-player-complete-reload",
        promotedReloadGroupId: "player-concurrent-action-reload",
        roleSurfaces: ["player", "host"],
      },
    ],
  );
  assert.notEqual(
    completedGameRaceCoverageCellCases()[0],
    completedGameRaceCoverageCellDefinitions[0],
  );
  assert.notEqual(
    completedGameRaceCoverageCellCases()[0].roleSurfaces,
    completedGameRaceCoverageCellDefinitions[0].roleSurfaces,
  );
});

test("race coverage exposes promoted reload groups from one contract", () => {
  assert.deepEqual(
    raceCoveragePromotedReloadGroups.map((group) => ({
      id: group.id,
      label: group.label,
      cellIds: [...group.cellIds],
    })),
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
          "host-resolve",
          "host-advance",
          "host-deadline-advance",
          "host-lifecycle",
          "host-mixed-advance",
          "host-votecount-publication",
          "host-complete-game",
        ],
      },
      {
        id: "player-concurrent-action-reload",
        label: "Player concurrent action reload",
        cellIds: [
          "player-vote-change",
          "player-night-action",
          "player-vote-vs-host-resolve",
          "player-action-vs-host-advance",
          "player-vs-completed-game",
        ],
      },
      {
        id: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload",
        cellIds: ["cohost-deadline-vs-host-resolve"],
      },
    ],
  );
});

test("race coverage promoted reload groups fail closed for unknown ids", () => {
  assert.throws(
    () => raceCoveragePromotedReloadGroup("missing-group"),
    /unknown race coverage promoted reload group: missing-group/,
  );
});
