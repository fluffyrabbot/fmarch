import assert from "node:assert/strict";
import { test } from "node:test";
import {
  playerActionSubmissionScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopRoleSurfaceProofCases,
  coreLoopRoleSurfaceProofEvidenceKeys,
  coreLoopRoleSurfaceProofCaseKeys,
  coreLoopRoleSurfaceProofInventory,
} from "./dev_test_game_core_loop_role_surface_proof_cases.mjs";
import {
  coreLoopRoleSurfaceSpineCheckpointRows,
} from "./dev_test_game_core_loop_role_surface_checkpoint_rows.mjs";
import {
  assertCoreLoopRoleSurfaceProofFunctionsImplemented,
  coreLoopRoleSurfaceProofFunctionKeys,
} from "./dev_test_game_core_loop_admin_proof.mjs";

test("core loop admin proof role surfaces have one declarative serial order", () => {
  const caseKeys = coreLoopRoleSurfaceProofCaseKeys();
  assert.equal(new Set(caseKeys).size, caseKeys.length);
  assert.equal(
    new Set(coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey)).size,
    coreLoopRoleSurfaceProofCases.length,
  );
  assert.deepEqual(caseKeys, [
    "hostRoleSurface",
    "playerRoleSurface",
    "targetResolutionReceiptSurface",
    "normalResolutionPrivacySurface",
    "targetDayVoteReceiptSurface",
    "normalDayVotePrivacySurface",
    "hostPhaseTransitionSurface",
    "targetPostDayVoteAdvanceSurface",
    "normalPostDayVoteAdvanceSurface",
    "nightActionResolutionReceiptSurface",
    "normalNightActionResolutionPrivacySurface",
    "hostNightActionTransitionSurface",
    "dayThreeVoteResolutionSurface",
    "postDayThreeResolutionSurface",
    "nightThreeEmptyResolutionSurface",
    "dayFourSurvivorRoleSurface",
    "nightFourNoActionSurface",
    "nightFourNoActionResolutionSurface",
    "postNightFourTransitionSurface",
    "dayFiveNoLynchResolutionSurface",
    "completedGameEndgameSurface",
    "privateChannelRoleSurface",
  ]);
  assert.deepEqual(
    coreLoopRoleSurfaceProofEvidenceKeys({ omit: ["hostRoleSurface"] }),
    caseKeys.slice(1),
  );
  assert.deepEqual(coreLoopRoleSurfaceProofInventory(), {
    rows: coreLoopRoleSurfaceProofCases.map(({ surfaceKey, proofKey }) => ({
      surfaceKey,
      proofKey,
    })),
  });
});

test("core loop admin proof browser registry covers extracted proof keys", () => {
  const proofKeys = coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey);
  const fakeRegistry = Object.fromEntries(
    proofKeys.map((proofKey) => [proofKey, () => ({ status: "passed" })]),
  );

  assert.deepEqual(coreLoopRoleSurfaceProofFunctionKeys(), proofKeys);
  assert.doesNotThrow(() =>
    assertCoreLoopRoleSurfaceProofFunctionsImplemented(),
  );
  assert.throws(
    () =>
      assertCoreLoopRoleSurfaceProofFunctionsImplemented({
        ...fakeRegistry,
        privateChannelRoleSurface: undefined,
      }),
    /missing=privateChannelRoleSurface extra=<none>/,
  );
  assert.throws(
    () =>
      assertCoreLoopRoleSurfaceProofFunctionsImplemented({
        ...fakeRegistry,
        unexpectedProofSurface: () => ({ status: "passed" }),
      }),
    /missing=<none> extra=unexpectedProofSurface/,
  );
});

test("core loop role surface spine checkpoint rows are scenario-owned", () => {
  const actionScenario = playerActionSubmissionScenario();

  assert.deepEqual(
    coreLoopRoleSurfaceSpineCheckpointRows({
      hostRoleSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        checkpointTestId: "host-lifecycle-control-checkpoint",
        hostLifecycleControlCheckpoint: {
          proofCheckId: "host-lifecycle-control",
        },
      },
      hostPhaseTransitionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        transition: "advance_phase:ack:802",
        advanceProof: {
          status: "passed",
          commandKind: "AdvancePhase",
          commandStatus: { state: "ack" },
          commandOutcome: { state: "ack" },
          bridgePlan: { finalState: "ack" },
          checkpointPhaseId: "N02",
          checkpointPhaseState: "open",
          checkpointDeadlineAffordance: "resolve_phase,lock_thread",
        },
      },
      playerRoleSurface: {
        playerActionSubmissionClickProof: {
          status: "passed",
          commandKind: actionScenario.commandKind,
          commandStatus: { state: actionScenario.finalState },
          bridgePlan: { finalState: actionScenario.finalState },
          checkpointReceiptState: `ack:${actionScenario.streamSeq}`,
          checkpointActionStateAfterAck:
            actionScenario.checkpointActionState,
          receiptCount: 1,
          receiptStatusText: `Ack: stream seqs ${actionScenario.streamSeq}`,
        },
      },
      nightActionResolutionReceiptSurface: {
        status: "passed",
        targetSlot: "slot-3",
        privateQueueBoundary: { count: 1 },
        privateNotice: {
          kind: "notification",
          text: "factional_kill resolved",
        },
        projectionNotifications: [{ status: "factional_kill" }],
        checkpoint: { phaseId: "N02", phaseState: "locked" },
        rawInviteTokensVisible: false,
      },
      normalNightActionResolutionPrivacySurface: {
        status: "passed",
        normalSlot: "slot-4",
        privateQueueBoundary: { count: 0 },
        targetReceiptVisible: false,
        projectionNotifications: [],
        checkpoint: { phaseId: "N02", phaseState: "locked" },
        rawInviteTokensVisible: false,
      },
    }),
    [
      "d02-n02-host-lifecycle-control-checkpoint",
      "d02-n02-host-phase-advance-transition-checkpoint",
      "d02-n02-player-action-submission-ack-checkpoint",
      "d02-n02-night-action-resolution-receipt-checkpoint",
      "d02-n02-night-action-resolution-privacy-checkpoint",
    ],
  );
  assert.deepEqual(coreLoopRoleSurfaceSpineCheckpointRows(), []);
});
