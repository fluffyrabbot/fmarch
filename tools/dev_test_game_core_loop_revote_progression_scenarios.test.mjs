import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertRevoteProgressionCheckpointEvidence,
  dayVoteNoLynchFeatureSpineRow,
  dayVoteNoLynchLaneId,
  revoteProgressionAdminCheckId,
  revoteProgressionCheckpointCases,
  revoteProgressionCompactStatus,
  revoteProgressionCycleId,
  revoteProgressionFeatureSpineRows,
} from "./dev_test_game_core_loop_revote_progression_scenarios.mjs";

test("revote progression cases share feature rows and checkpoint expectations", () => {
  assert.equal(revoteProgressionCycleId, "d03-n03");
  assert.equal(revoteProgressionAdminCheckId, "core-loop");
  assert.equal(dayVoteNoLynchLaneId, "day-vote-no-lynch");
  assert.deepEqual(dayVoteNoLynchFeatureSpineRow(), {
    targetKey: "dayVoteNoLynch",
    featureSlotId: "day-vote-no-lynch",
    cycleId: "d03-n03",
    role: "actionPlayer",
    checkpointId: "d03-n03-d03r1-revote-ballot-submitted",
    adminCheckId: "core-loop",
    seedMembership: "demoOnly",
    seedOrder: 20,
  });
  assert.deepEqual(revoteProgressionFeatureSpineRows(), [
    {
      targetKey: "dayThreeNoMajorityRevote",
      featureSlotId: "day-three-no-majority-revote",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03-revote-prompt-resolved",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeRevoteBallot",
      featureSlotId: "day-three-revote-ballot",
      cycleId: "d03-n03",
      role: "actionPlayer",
      checkpointId: "d03-n03-d03r1-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeRevoteResolution",
      featureSlotId: "day-three-revote-resolution",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03r1-revote-resolved-no-majority",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeSecondRevote",
      featureSlotId: "day-three-second-revote",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03r2-revote-prompt-resolved",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeSecondRevoteBallot",
      featureSlotId: "day-three-second-revote-ballot",
      cycleId: "d03-n03",
      role: "actionPlayer",
      checkpointId: "d03-n03-d03r2-revote-ballot-submitted",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeSecondRevoteResolution",
      featureSlotId: "day-three-second-revote-resolution",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03r2-revote-resolved-no-majority",
      adminCheckId: "core-loop",
    },
  ]);
  assert.deepEqual(
    revoteProgressionCheckpointCases().map((scenario) => [
      scenario.id,
      scenario.checkpointId,
      scenario.expectedCheckpointFields,
    ]),
    [
      [
        "day-three-no-majority-revote",
        "d03-revote-prompt-resolved",
        {
          phase: "D03R1",
          decisionPolicy: "no_majority_continue_revote",
          resolveState: "ack",
          promptStatusAfter: "resolved",
        },
      ],
      [
        "day-three-revote-ballot",
        "d03r1-revote-ballot-submitted",
        {
          phase: "D03R1",
          voteState: "ack",
          voteTarget: "NoLynch",
          currentVoteKind: "no_lynch",
        },
      ],
      [
        "day-three-revote-resolution",
        "d03r1-revote-resolved-no-majority",
        {
          phase: "D03R1",
          resolveState: "ack",
          outcomeStatus: "NoMajority",
          promptStatusAfter: "pending",
        },
      ],
      [
        "day-three-second-revote",
        "d03r2-revote-prompt-resolved",
        {
          phase: "D03R2",
          decisionPolicy: "no_majority_continue_revote",
          resolveState: "ack",
          promptStatusAfter: "resolved",
        },
      ],
      [
        "day-three-second-revote-ballot",
        "d03r2-revote-ballot-submitted",
        {
          phase: "D03R2",
          voteState: "ack",
          voteTarget: "NoLynch",
          currentVoteKind: "no_lynch",
        },
      ],
      [
        "day-three-second-revote-resolution",
        "d03r2-revote-resolved-no-majority",
        {
          phase: "D03R2",
          resolveState: "ack",
          outcomeStatus: "NoMajority",
          decisionPolicy: "no_majority_no_lynch",
          nextPhase: "N03",
        },
      ],
    ],
  );
});

test("revote progression assertions cover the saved core-loop spine proof", async () => {
  const proofRun = JSON.parse(
    await readFile("target/dev-test-game/proof-run.json", "utf8"),
  );
  const cycle = proofRun.coreLoopSpine.cycles.find(
    (candidate) => candidate.id === revoteProgressionCycleId,
  );
  assert.doesNotThrow(() =>
    assertRevoteProgressionCheckpointEvidence({ cycle }),
  );
  assert.equal(
    revoteProgressionCompactStatus(cycle),
    "revote D03R1 via no_majority_continue_revote, revote vote ack, revote resolve ack, second revote D03R2 via no_majority_continue_revote, second vote ack, second resolve ack, policy no_majority_no_lynch -> N03",
  );
  assert.throws(
    () =>
      assertRevoteProgressionCheckpointEvidence({
        cycle: {
          ...cycle,
          checkpoints: cycle.checkpoints.map((checkpoint) =>
            checkpoint.id === "d03r2-revote-resolved-no-majority"
              ? { ...checkpoint, nextPhase: "D04" }
              : checkpoint,
          ),
        },
      }),
    /expected nextPhase/,
  );
});
