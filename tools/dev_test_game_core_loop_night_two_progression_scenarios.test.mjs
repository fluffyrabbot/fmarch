import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertNightTwoProgressionCheckpointEvidence,
  nightTwoProgressionAdminCheckId,
  nightTwoProgressionCheckpointCases,
  nightTwoProgressionCompactStatus,
  nightTwoProgressionCycleId,
  nightTwoProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_night_two_progression_scenarios.mjs";

test("Night 2 progression cases share feature rows and checkpoint expectations", () => {
  assert.equal(nightTwoProgressionCycleId, "n02-d03");
  assert.equal(nightTwoProgressionAdminCheckId, "core-loop");
  assert.deepEqual(nightTwoProgressionFeatureSpineRows(), [
    {
      targetKey: "nightTwoActionResolution",
      featureSlotId: "night-two-action-resolution",
      cycleId: "n02-d03",
      role: "host",
      checkpointId: "n02-d03-n02-resolved-target-killed",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeControlsReturn",
      featureSlotId: "day-three-controls-return",
      cycleId: "n02-d03",
      role: "actionPlayer",
      checkpointId: "n02-d03-d03-day-controls-return",
      adminCheckId: "core-loop",
    },
  ]);
  assert.deepEqual(
    nightTwoProgressionCheckpointCases().map((scenario) => [
      scenario.id,
      scenario.checkpointId,
      scenario.expectedCheckpointFields,
    ]),
    [
      [
        "night-two-action-resolution",
        "n02-resolved-target-killed",
        {
          resolveState: "ack",
          phase: "N02",
          locked: true,
          targetSlot: "slot-3",
          targetAlive: false,
          targetStatus: "dead",
        },
      ],
      [
        "day-three-controls-return",
        "d03-day-controls-return",
        {
          advanceState: "ack",
          phase: "D03",
          locked: false,
          actionSubmitControls: 0,
          actionVoteControls: 2,
          normalVoteControls: 2,
        },
      ],
    ],
  );
});

test("Night 2 progression assertions cover the saved core-loop spine proof", async () => {
  const proofRun = JSON.parse(
    await readFile("target/dev-test-game/proof-run.json", "utf8"),
  );
  const cycle = proofRun.coreLoopSpine.cycles.find(
    (candidate) => candidate.id === nightTwoProgressionCycleId,
  );
  assert.doesNotThrow(() =>
    assertNightTwoProgressionCheckpointEvidence({ cycle }),
  );
  assert.equal(
    nightTwoProgressionCompactStatus(cycle),
    "N02 action ack, next D03",
  );
  assert.throws(
    () =>
      assertNightTwoProgressionCheckpointEvidence({
        cycle: {
          ...cycle,
          checkpoints: cycle.checkpoints.map((checkpoint) =>
            checkpoint.id === "d03-day-controls-return"
              ? { ...checkpoint, actionVoteControls: 1 }
              : checkpoint,
          ),
        },
      }),
    /expected actionVoteControls/,
  );
});
