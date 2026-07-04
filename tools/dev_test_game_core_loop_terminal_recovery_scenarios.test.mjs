import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertTerminalRecoveryCheckpointEvidence,
  terminalAdvanceRejectRecoveryHookId,
  terminalRecoveryAdminCheckId,
  terminalRecoveryCheckpointCases,
  terminalRecoveryCompactStatus,
  terminalRecoveryCycleId,
  terminalRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_terminal_recovery_scenarios.mjs";

test("terminal recovery cases share feature rows and checkpoint expectations", () => {
  assert.equal(terminalRecoveryCycleId, "n02-d03");
  assert.equal(terminalRecoveryAdminCheckId, "core-loop");
  assert.equal(terminalAdvanceRejectRecoveryHookId, "d03TerminalAdvanceReject");
  assert.deepEqual(terminalRecoveryFeatureSpineRows(), [
    {
      targetKey: "dayThreeTerminalBoundary",
      featureSlotId: "day-three-terminal-boundary",
      cycleId: "n02-d03",
      role: "host",
      checkpointId: "n02-d03-d03-terminal-advance-reject",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeTerminalRecovery",
      featureSlotId: "day-three-terminal-recovery",
      cycleId: "n02-d03",
      role: "host",
      checkpointId: "n02-d03-d03-terminal-reload-recovery",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeStaleContinuePolicyRecovery",
      featureSlotId: "day-three-stale-continue-policy-recovery",
      cycleId: "n02-d03",
      role: "host",
      checkpointId: "n02-d03-d03r2-stale-continue-policy-recovery",
      adminCheckId: "core-loop",
    },
  ]);
  assert.deepEqual(
    terminalRecoveryCheckpointCases().map((scenario) => [
      scenario.id,
      scenario.checkpointId,
      scenario.recoveryHookId,
      scenario.expectedCheckpointFields,
    ]),
    [
      [
        "day-three-terminal-boundary",
        "d03-terminal-advance-reject",
        "d03TerminalAdvanceReject",
        {
          voteState: "ack",
          resolveState: "ack",
          outcomeStatus: "NoMajority",
          winnerSlot: null,
          targetAlive: true,
          targetStatus: "alive",
          advanceState: "reject",
          rejectError: "InvalidTarget",
          phase: "D03",
          locked: true,
          advanceControlVisible: true,
        },
      ],
      [
        "day-three-terminal-recovery",
        "d03-terminal-reload-recovery",
        "d03TerminalAdvanceReject",
        {
          routeResponseStatus: 200,
          phase: "D03",
          locked: true,
          outcomeStatus: "NoMajority",
          projectedCount: 1,
          advanceControlVisible: true,
          unlockControlVisible: true,
        },
      ],
      [
        "day-three-stale-continue-policy-recovery",
        "d03r2-stale-continue-policy-recovery",
        undefined,
        {
          promptId: "D03R2:revote:NoMajority",
          setupPromptStatus: "pending",
          setupActionVisible: true,
          rejectState: "reject",
          rejectError: "PromptAlreadyResolved",
          promptStatusAfterReject: "resolved",
          promptActionVisibleAfterReject: false,
          reloadStatus: "passed",
          reloadPhase: "N03",
          reloadLocked: false,
          reloadResolveControlVisible: true,
          reloadStaleActionVisible: false,
          apiPromptStatusAfterReload: "resolved",
        },
      ],
    ],
  );
});

test("terminal recovery assertions cover the saved core-loop spine proof", async () => {
  const proofRun = JSON.parse(
    await readFile("target/dev-test-game/proof-run.json", "utf8"),
  );
  const cycle = proofRun.coreLoopSpine.cycles.find(
    (candidate) => candidate.id === terminalRecoveryCycleId,
  );
  assert.doesNotThrow(() =>
    assertTerminalRecoveryCheckpointEvidence({
      cycle,
      recoveryHooks: proofRun.coreLoopSpine.recoveryHooks,
    }),
  );
  assert.equal(
    terminalRecoveryCompactStatus(cycle),
    "terminal advance InvalidTarget, reload D03",
  );
  assert.throws(
    () =>
      assertTerminalRecoveryCheckpointEvidence({
        cycle,
        recoveryHooks: {
          ...proofRun.coreLoopSpine.recoveryHooks,
          d03TerminalAdvanceReject: "PhaseLocked",
        },
      }),
    /terminal recovery hook mismatch/,
  );
  assert.throws(
    () =>
      assertTerminalRecoveryCheckpointEvidence({
        recoveryHooks: proofRun.coreLoopSpine.recoveryHooks,
        cycle: {
          ...cycle,
          checkpoints: cycle.checkpoints.map((checkpoint) =>
            checkpoint.id === "d03r2-stale-continue-policy-recovery"
              ? { ...checkpoint, reloadPhase: "D03R3" }
              : checkpoint,
          ),
        },
      }),
    /expected reloadPhase/,
  );
});
