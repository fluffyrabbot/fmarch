import assert from "node:assert/strict";
import { test } from "node:test";
import {
  raceCoveragePromotedReloadGroup,
  raceCoveragePromotedReloadGroups,
} from "./dev_test_game_race_coverage.mjs";

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
