import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertTerminalRecoveryBrowserProof,
  assertTerminalRecoveryCheckpointEvidence,
  terminalAdvanceRejectRecoveryHookId,
  terminalRecoveryBrowserScenario,
  terminalRecoveryAdminCheckId,
  terminalRecoveryCheckpointCases,
  terminalRecoveryCompactStatus,
  terminalRecoveryCycleId,
  terminalRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_terminal_recovery_scenarios.mjs";

test("terminal recovery cases share feature rows and checkpoint expectations", () => {
  assert.equal(terminalRecoveryCycleId, "d03-n03");
  assert.equal(terminalRecoveryAdminCheckId, "core-loop");
  assert.equal(terminalAdvanceRejectRecoveryHookId, "d03TerminalAdvanceReject");
  assert.deepEqual(terminalRecoveryFeatureSpineRows(), [
    {
      targetKey: "dayThreeTerminalBoundary",
      featureSlotId: "day-three-terminal-boundary",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03-terminal-advance-reject",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeTerminalRecovery",
      featureSlotId: "day-three-terminal-recovery",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03-terminal-reload-recovery",
      recoveryHookId: "d03TerminalAdvanceReject",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "dayThreeStaleContinuePolicyRecovery",
      featureSlotId: "day-three-stale-continue-policy-recovery",
      cycleId: "d03-n03",
      role: "host",
      checkpointId: "d03-n03-d03r2-stale-continue-policy-recovery",
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

test("terminal recovery browser assertion owns D03 reject and reload proof shape", () => {
  const scenario = terminalRecoveryBrowserScenario();
  assert.deepEqual(scenario, {
    expectedVotePrincipalUserId: "player-mira",
    expectedVoteActorSlot: "slot-7",
    expectedPhaseId: "D03",
    expectedOutcomeStatus: "NoMajority",
    expectedRejectError: "InvalidTarget",
    expectedPromptId: "D03:revote:NoMajority",
    expectedPromptLabel: "revote",
    expectedPromptValue: "no_majority",
  });
  assert.doesNotThrow(() =>
    assertTerminalRecoveryBrowserProof({
      proof: terminalRecoveryBrowserProofFixture(),
      scenario,
    }),
  );
  assert.throws(
    () =>
      assertTerminalRecoveryBrowserProof({
        proof: {
          ...terminalRecoveryBrowserProofFixture(),
          d03TerminalHostReloadAfterReject: {
            ...terminalRecoveryBrowserProofFixture()
              .d03TerminalHostReloadAfterReject,
            phaseActions: ["advance_phase", "unlock_thread", "resolve_phase"],
          },
        },
        scenario,
      }),
    /terminal reload controls mismatch/,
  );
});

function terminalRecoveryBrowserProofFixture() {
  const prompt = {
    id: "D03:revote:NoMajority",
    label: "revote",
    status: "pending",
    value: "no_majority",
  };
  const outcome = {
    phaseId: "D03",
    status: "NoMajority",
    winnerSlot: null,
    tallies: { "slot-4": 1 },
  };
  return {
    d03TerminalVoteTarget: { slotId: "slot-4" },
    d03TerminalVoteSubmission: {
      state: "ack",
      requestEnvelope: {
        body: {
          body: {
            principal_user_id: "player-mira",
            command: {
              SubmitVote: {
                actor_slot: "slot-7",
                target: { Slot: "slot-4" },
              },
            },
          },
        },
      },
    },
    d03TerminalPlayerAfterVote: {
      commandState: { currentVote: { slotId: "slot-4" } },
      currentVote: { hasVote: "true" },
    },
    d03TerminalApiVoteRow: { count: 1 },
    resolveD03: { commandStatus: { state: "ack" } },
    hostAfterResolveD03: {
      phase: { id: "D03", locked: true },
      promptActions: ["host_prompt:D03:continue"],
    },
    d03RevotePrompt: prompt,
    d03RevotePromptActionId: "host_prompt:D03:continue",
    d03TerminalDayVoteOutcome: outcome,
    d03TerminalResolvedSlot: {
      slot_id: "slot-4",
      alive: true,
      status: "alive",
    },
    d03TerminalAdvanceReject: {
      commandStatus: { state: "reject", error: "InvalidTarget" },
    },
    hostAfterTerminalAdvanceReject: {
      phase: { id: "D03", locked: true },
      phaseActions: ["advance_phase"],
    },
    d03TerminalActivityStatusText:
      "Reject InvalidTarget: stale phase state",
    d03TerminalActivityRow: {
      source: "outcome",
      actionId: "advance_phase",
      dispatchKind: "advance_phase",
    },
    d03TerminalDispatchPlan: { projectionRefreshKeys: ["host"] },
    d03TerminalApiHostStateAfterReject: {
      phase: { id: "D03", locked: true },
    },
    d03TerminalHostReloadAfterReject: {
      routeResponseStatus: 200,
      phase: { id: "D03", locked: true },
      phaseActions: ["advance_phase", "unlock_thread"],
      hostPrompts: [prompt],
      promptActions: ["host_prompt:D03:continue"],
      dayVoteOutcomes: [outcome],
      outcomePanel: "D03 NoMajority",
      apiPhase: { id: "D03", locked: true },
    },
  };
}

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
