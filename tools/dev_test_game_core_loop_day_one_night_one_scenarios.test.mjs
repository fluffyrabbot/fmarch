import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertDayOneNightOneCheckpointEvidence,
  dayOneNightOneCheckpointCases,
  dayOneNightOneDayTwoCycleId,
  dayOneNightOneDayTwoRoleIds,
  dayOneNightOneDayTwoRoleUrlKey,
  dayOneNightOneDayTwoRoleUrlsFrom,
  dayOneNightOneFeatureSpineRows,
  staleActionConflictRecoveryHookId,
  staleLockedVoteRecoveryHookId,
} from "./dev_test_game_core_loop_day_one_night_one_scenarios.mjs";
import {
  playerActionBoundaryLaneId,
  playerActionBoundaryRecoveryHookId,
  playerActionLoopLaneId,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopPrivateChannelPostLaneId,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";
import {
  staleActionConflictMessageLaneId,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  staleActionConflictLaneId,
} from "./dev_test_game_player_recovery_scenarios.mjs";

test("Day 1 Night 1 cases share feature rows and checkpoint expectations", () => {
  assert.equal(dayOneNightOneDayTwoCycleId, "d01-n01-d02");
  assert.equal(staleLockedVoteRecoveryHookId, "staleLockedVoteReject");
  assert.equal(staleActionConflictRecoveryHookId, "staleActionConflictReject");
  assert.deepEqual(dayOneNightOneFeatureSpineRows(), [
    {
      targetKey: "nightActionLoop",
      featureSlotId: "night-action-loop",
      cycleId: "d01-n01-d02",
      role: "actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      adminCheckId: playerActionLoopLaneId,
      proofLaneAliases: [playerActionLoopLaneId, staleActionConflictLaneId],
    },
    {
      targetKey: "playerActionBoundary",
      featureSlotId: playerActionBoundaryLaneId,
      cycleId: "d01-n01-d02",
      role: "normalPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: playerActionBoundaryRecoveryHookId,
      adminCheckId: playerActionBoundaryLaneId,
    },
    {
      targetKey: "privateChannel",
      featureSlotId: coreLoopPrivateChannelPostLaneId,
      cycleId: "d01-n01-d02",
      role: "privateChannel",
      checkpointId: "d01-n01-d02-n01-action-open",
      adminCheckId: coreLoopPrivateChannelPostLaneId,
    },
    {
      targetKey: "resolutionReceipts",
      featureSlotId: "resolution-receipts",
      cycleId: "d01-n01-d02",
      role: "target",
      checkpointId: "d01-n01-d02-n01-resolved-target-killed",
      adminCheckId: "resolution-receipts",
    },
    {
      targetKey: "staleRecovery",
      featureSlotId: "stale-recovery",
      cycleId: "d01-n01-d02",
      role: "host",
      checkpointId: "d01-n01-d02-d01-resolved-locked",
      recoveryHookId: staleLockedVoteRecoveryHookId,
      adminCheckId: "stale-deadline-advance",
    },
    {
      targetKey: "staleActionConflictMessage",
      featureSlotId: staleActionConflictMessageLaneId,
      cycleId: "d01-n01-d02",
      role: "actionPlayer",
      checkpointId: "d01-n01-d02-n01-action-open",
      recoveryHookId: staleActionConflictRecoveryHookId,
      adminCheckId: playerActionLoopLaneId,
    },
    {
      targetKey: "dayTwoControlsReturn",
      featureSlotId: "day-two-controls-return",
      cycleId: "d01-n01-d02",
      role: "actionPlayer",
      checkpointId: "d01-n01-d02-d02-day-controls-return",
      adminCheckId: "core-loop",
    },
  ]);
  assert.deepEqual(
    dayOneNightOneCheckpointCases().map((scenario) => [
      scenario.id,
      scenario.checkpointId,
      scenario.recoveryHookId,
      scenario.expectedRecoveryHookValue,
      scenario.expectedCheckpointFields,
    ]),
    [
      [
        "night-action-loop",
        "n01-action-open",
        undefined,
        undefined,
        {
          phase: "N01",
          locked: false,
          advanceState: "ack",
          actionTemplate: "factional_kill",
          actionButtonVisible: true,
        },
      ],
      [
        playerActionBoundaryLaneId,
        "n01-action-open",
        playerActionBoundaryRecoveryHookId,
        "InvalidTarget",
        {
          phase: "N01",
          locked: false,
          normalPlayerActionCount: 0,
          normalPlayerDirectReject: "InvalidTarget",
        },
      ],
      [
        coreLoopPrivateChannelPostLaneId,
        "n01-action-open",
        undefined,
        undefined,
        {
          phase: "N01",
          locked: false,
          actionTemplate: "factional_kill",
          actionButtonVisible: true,
        },
      ],
      [
        "resolution-receipts",
        "n01-resolved-target-killed",
        undefined,
        undefined,
        {
          resolveState: "ack",
          targetSlot: "slot-2",
          targetAlive: false,
          targetStatus: "dead",
          receiptStatus: "factional_kill",
          receiptEffect: "player_killed",
        },
      ],
      [
        "stale-recovery",
        "d01-resolved-locked",
        staleLockedVoteRecoveryHookId,
        "PhaseLocked",
        {
          phase: "D01",
          locked: true,
          resolveState: "ack",
          submitActionControls: 0,
          submitVoteControls: 0,
        },
      ],
      [
        staleActionConflictMessageLaneId,
        "n01-action-open",
        staleActionConflictRecoveryHookId,
        "PhaseLocked",
        {
          phase: "N01",
          locked: false,
          actionTemplate: "factional_kill",
          actionButtonVisible: true,
        },
      ],
      [
        "day-two-controls-return",
        "d02-day-controls-return",
        undefined,
        undefined,
        {
          phase: "D02",
          locked: false,
          advanceState: "ack",
          actionSubmitControls: 0,
          actionVoteControls: 3,
          normalVoteControls: 3,
        },
      ],
    ],
  );
});

test("Day 1 Night 1 Day 2 role URL keys are scenario-owned", () => {
  assert.deepEqual(dayOneNightOneDayTwoRoleIds, [
    "host",
    "actionPlayer",
    "target",
    "normalPlayer",
    "privateChannel",
  ]);
  assert.deepEqual(
    Object.fromEntries(
      dayOneNightOneDayTwoRoleIds.map((roleId) => [
        roleId,
        dayOneNightOneDayTwoRoleUrlKey(roleId),
      ]),
    ),
    {
      host: "d01-n01-d02-host",
      actionPlayer: "d01-n01-d02-actionPlayer",
      target: "d01-n01-d02-target",
      normalPlayer: "d01-n01-d02-normalPlayer",
      privateChannel: "d01-n01-d02-privateChannel",
    },
  );
  assert.throws(
    () => dayOneNightOneDayTwoRoleUrlKey("observer"),
    /unknown day one night one role id/,
  );
  assert.deepEqual(
    dayOneNightOneDayTwoRoleUrlsFrom({
      "d01-n01-d02-host": "host-url",
      "d01-n01-d02-actionPlayer": "action-url",
      "d01-n01-d02-target": "target-url",
      "d01-n01-d02-normalPlayer": "normal-url",
      "d01-n01-d02-privateChannel": "private-channel-url",
    }),
    {
      host: "host-url",
      actionPlayer: "action-url",
      target: "target-url",
      normalPlayer: "normal-url",
      privateChannel: "private-channel-url",
    },
  );
  assert.deepEqual(dayOneNightOneDayTwoRoleUrlsFrom({}), {
    host: undefined,
    actionPlayer: undefined,
    target: undefined,
    normalPlayer: undefined,
    privateChannel: undefined,
  });
});

test("Day 1 Night 1 assertions cover the saved core-loop spine proof", async () => {
  const proofRun = JSON.parse(
    await readFile("target/dev-test-game/proof-run.json", "utf8"),
  );
  const cycle = proofRun.coreLoopSpine.cycles.find(
    (candidate) => candidate.id === dayOneNightOneDayTwoCycleId,
  );
  assert.doesNotThrow(() =>
    assertDayOneNightOneCheckpointEvidence({
      cycle,
      recoveryHooks: proofRun.coreLoopSpine.recoveryHooks,
    }),
  );
  assert.throws(
    () =>
      assertDayOneNightOneCheckpointEvidence({
        cycle,
        recoveryHooks: {
          ...proofRun.coreLoopSpine.recoveryHooks,
          staleActionConflictReject: "InvalidTarget",
        },
      }),
    /recovery hook mismatch staleActionConflictReject/,
  );
  assert.throws(
    () =>
      assertDayOneNightOneCheckpointEvidence({
        recoveryHooks: proofRun.coreLoopSpine.recoveryHooks,
        cycle: {
          ...cycle,
          checkpoints: cycle.checkpoints.map((checkpoint) =>
            checkpoint.id === "n01-resolved-target-killed"
              ? { ...checkpoint, receiptEffect: "blocked" }
              : checkpoint,
          ),
        },
      }),
    /expected receiptEffect/,
  );
});
