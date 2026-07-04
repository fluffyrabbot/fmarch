import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNightThreeProgressionCheckpointEvidence,
  dayFourControlsReturnLaneId,
  nightThreeActionResolutionLaneId,
  nightThreeDayFourCycleId,
  nightThreeProgressionCheckpointCaseForId,
  nightThreeProgressionCheckpointCases,
  nightThreeProgressionCompactStatus,
  nightThreeProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_night_three_progression_scenarios.mjs";

test("night three progression cases map live N03 action into D04 checkpoints", () => {
  assert.equal(nightThreeDayFourCycleId, "n03-d04");
  assert.deepEqual(
    nightThreeProgressionCheckpointCases().map((scenario) => scenario.id),
    [nightThreeActionResolutionLaneId, dayFourControlsReturnLaneId],
  );
  assert.deepEqual(
    nightThreeProgressionFeatureSpineRows({ cycleId: "n03-d04" }),
    [
      {
        targetKey: "nightThreeActionResolution",
        featureSlotId: "night-three-action-resolution",
        seedMembership: "required",
        seedOrder: 30,
        cycleId: "n03-d04",
        role: "host",
        checkpointId: "n03-d04-n03-resolved-target-killed",
        adminCheckId: "core-loop",
      },
      {
        targetKey: "dayFourControlsReturn",
        featureSlotId: "day-four-controls-return",
        cycleId: "n03-d04",
        role: "actionPlayer",
        checkpointId: "n03-d04-d04-day-controls-return",
        adminCheckId: "core-loop",
      },
    ],
  );
  assert.equal(
    nightThreeProgressionCheckpointCaseForId(dayFourControlsReturnLaneId)
      .checkpointId,
    "d04-day-controls-return",
  );
});

test("night three progression assertion covers live action and D04 return facts", () => {
  const cycle = {
    id: "n03-d04",
    checkpoints: [
      {
        id: "n03-resolved-target-killed",
        resolveState: "ack",
        phase: "N03",
        locked: true,
        targetSlot: "slot-7",
        targetAlive: false,
        targetStatus: "dead",
      },
      {
        id: "d04-day-controls-return",
        advanceState: "ack",
        phase: "D04",
        locked: false,
        actionSubmitControls: 0,
        targetAlive: false,
        targetVoteControls: 0,
      },
    ],
  };
  assert.doesNotThrow(() =>
    assertNightThreeProgressionCheckpointEvidence({ cycle }),
  );
  assert.equal(
    nightThreeProgressionCompactStatus({
      id: "n03-d04",
      checkpoints: [
        { id: "n03-action-open", phase: "N03" },
        { id: "n03-action-submitted", actionState: "ack" },
        { id: "d04-day-controls-return", phase: "D04" },
      ],
    }),
    "N03 action ack, next D04",
  );
  assert.throws(
    () =>
      assertNightThreeProgressionCheckpointEvidence({
        cycle: {
          ...cycle,
          checkpoints: [
            { ...cycle.checkpoints[0], targetAlive: true },
            cycle.checkpoints[1],
          ],
        },
      }),
    /night three progression checkpoint n03-resolved-target-killed expected targetAlive/,
  );
});
