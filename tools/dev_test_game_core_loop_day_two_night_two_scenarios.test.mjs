import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertDayTwoNightTwoCheckpointEvidence,
  dayTwoNightTwoAdminCheckId,
  dayTwoNightTwoCheckpointCases,
  dayTwoNightTwoCycleId,
  dayTwoNightTwoFeatureSpineRows,
} from "./dev_test_game_core_loop_day_two_night_two_scenarios.mjs";
import {
  playerActionLoopLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  hostNightActionTransitionLaneId,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  postDayThreeTransitionLaneId,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";

test("Day 2 Night 2 cases share feature rows and checkpoint expectations", () => {
  assert.equal(dayTwoNightTwoCycleId, "d02-n02");
  assert.equal(dayTwoNightTwoAdminCheckId, "core-loop");
  assert.deepEqual(dayTwoNightTwoFeatureSpineRows(), [
    {
      targetKey: "postDayThreeTransition",
      featureSlotId: postDayThreeTransitionLaneId,
      cycleId: "d02-n02",
      role: "host",
      checkpointId: "d02-n02-d02-resolved-target-killed",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "playerActionSubmission",
      featureSlotId: "player-action-submission",
      cycleId: "d02-n02",
      role: "actionPlayer",
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: playerActionLoopLaneId,
    },
    {
      targetKey: "hostNightActionTransition",
      featureSlotId: hostNightActionTransitionLaneId,
      cycleId: "d02-n02",
      role: "host",
      checkpointId: "d02-n02-n02-action-open",
      adminCheckId: "core-loop",
    },
  ]);
  assert.deepEqual(
    dayTwoNightTwoCheckpointCases().map((scenario) => [
      scenario.id,
      scenario.checkpointId,
      scenario.expectedCheckpointFields,
    ]),
    [
      [
        postDayThreeTransitionLaneId,
        "d02-resolved-target-killed",
        {
          resolveState: "ack",
          phase: "D02",
          locked: true,
          outcomeStatus: "Lynch",
          winnerSlot: "slot-2",
          targetAlive: false,
          receiptStatus: "day_vote",
        },
      ],
      [
        "player-action-submission",
        "n02-action-open",
        {
          advanceState: "ack",
          phase: "N02",
          locked: false,
          actionTemplate: "factional_kill",
          actionButtonVisible: true,
          normalPlayerFactionalKillVisible: false,
        },
      ],
      [
        hostNightActionTransitionLaneId,
        "n02-action-open",
        {
          advanceState: "ack",
          phase: "N02",
          locked: false,
          actionTemplate: "factional_kill",
          actionButtonVisible: true,
          normalPlayerFactionalKillVisible: false,
        },
      ],
    ],
  );
});

test("Day 2 Night 2 assertions cover the saved core-loop spine proof", async () => {
  const proofRun = JSON.parse(
    await readFile("target/dev-test-game/proof-run.json", "utf8"),
  );
  const cycle = proofRun.coreLoopSpine.cycles.find(
    (candidate) => candidate.id === dayTwoNightTwoCycleId,
  );
  assert.doesNotThrow(() =>
    assertDayTwoNightTwoCheckpointEvidence({ cycle }),
  );
  assert.throws(
    () =>
      assertDayTwoNightTwoCheckpointEvidence({
        cycle: {
          ...cycle,
          checkpoints: cycle.checkpoints.map((checkpoint) =>
            checkpoint.id === "d02-resolved-target-killed"
              ? { ...checkpoint, winnerSlot: null }
              : checkpoint,
          ),
        },
      }),
    /expected winnerSlot/,
  );
});
