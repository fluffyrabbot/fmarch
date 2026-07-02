import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedGameRaceCoverageCellCases,
  completedGameRaceCoverageCellDefinitions,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  raceCoverageLocalReadinessMilestoneCases,
  raceCoverageLocalReadinessMilestoneDefinitions,
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

test("race coverage exposes local readiness milestones from promoted groups", () => {
  assert(Object.isFrozen(raceCoverageLocalReadinessMilestoneDefinitions));
  assert.deepEqual(
    raceCoverageLocalReadinessMilestoneCases().map((milestone) => ({
      id: milestone.id,
      groupId: milestone.groupId,
      label: milestone.label,
      proofBoundary: milestone.proofBoundary,
      cellIds: milestone.cellIds,
    })),
    [
      {
        id: "local-host-concurrent-race-reload-milestone",
        groupId: "host-concurrent-race-reload",
        label: "Host concurrent race reload coverage",
        proofBoundary:
          "Local race-coverage proof that host resolve, advance, deadline, lifecycle, mixed advance, votecount publication, and complete-game races all have reload recovery coverage.",
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
        id: "local-player-concurrent-action-reload-milestone",
        groupId: "player-concurrent-action-reload",
        label: "Player concurrent action reload coverage",
        proofBoundary:
          "Local race-coverage proof that player vote changes, night actions, player-vs-host phase races, and completed-game reload recovery all have reload coverage.",
        cellIds: [
          "player-vote-change",
          "player-night-action",
          "player-vote-vs-host-resolve",
          "player-action-vs-host-advance",
          "player-vs-completed-game",
        ],
      },
      {
        id: "local-cohost-deadline-race-reload-milestone",
        groupId: "cohost-deadline-race-reload",
        label: "Cohost deadline race reload coverage",
        proofBoundary:
          "Local race-coverage proof that the cohost deadline extension versus host resolve race has reload recovery coverage.",
        cellIds: ["cohost-deadline-vs-host-resolve"],
      },
    ],
  );
  assert.notEqual(
    raceCoverageLocalReadinessMilestoneCases()[0].cellIds,
    raceCoverageLocalReadinessMilestoneDefinitions[0].cellIds,
  );
});
