import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNightThreeProgressionBrowserProof,
  assertNightThreeProgressionCheckpointEvidence,
  dayFourControlsReturnLaneId,
  nightThreeActionTargetFromCommandState,
  nightThreeActionResolutionLaneId,
  nightThreeDayFourCycleId,
  nightThreeProgressionBrowserScenario,
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

test("night three progression browser assertion owns action and D04 proof shape", () => {
  const scenario = nightThreeProgressionBrowserScenario();
  assert.deepEqual(
    scenario,
    {
      actionId: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      templateId: "factional_kill",
      expectedPrincipalUserId: "player-goon-a",
      expectedActorSlot: "slot_4",
      expectedActionPhaseId: "N03",
      expectedDayPhaseId: "D04",
      expectedTargetSlot: "slot-7",
    },
  );
  assert.equal(
    nightThreeActionTargetFromCommandState({
      commandState: {
        actions: [
          { templateId: "heal", targets: ["slot-4"] },
          { templateId: "factional_kill", targets: ["slot-7"] },
        ],
      },
      scenario,
    }),
    "slot-7",
  );
  assert.doesNotThrow(() =>
    assertNightThreeProgressionBrowserProof({
      proof: nightThreeBrowserProofFixture(),
      scenario,
    }),
  );
  assert.throws(
    () =>
      assertNightThreeProgressionBrowserProof({
        proof: {
          ...nightThreeBrowserProofFixture(),
          d04ActionSurface: {
            ...nightThreeBrowserProofFixture().d04ActionSurface,
            buttons: [],
          },
        },
        scenario,
      }),
    /day four action player vote controls missing/,
  );
});

function nightThreeBrowserProofFixture() {
  return {
    n03ActionTarget: "slot-7",
    n03ActionSubmission: {
      state: "ack",
      requestEnvelope: {
        body: {
          body: {
            principal_user_id: "player-goon-a",
            command: {
              SubmitAction: {
                actor_slot: "slot_4",
                template_id: "factional_kill",
                targets: ["slot-7"],
              },
            },
          },
        },
      },
    },
    n03ActionAfterSubmit: {
      commandState: { phase: { phaseId: "N03" } },
      buttons: [],
      receiptStatusText: "Ack",
    },
    hostBeforeResolveN03: {
      phase: { id: "N03", locked: false },
      phaseActions: ["resolve_phase"],
    },
    resolveN03: { commandStatus: { state: "ack" } },
    hostAfterResolveN03: {
      phase: { id: "N03", locked: true },
      phaseActions: ["advance_phase"],
    },
    n03ResolvedTargetSlot: {
      slot_id: "slot-7",
      alive: false,
      status: "dead",
    },
    advanceD04: { commandStatus: { state: "ack" } },
    d04HostSurface: {
      phase: { id: "D04", locked: false },
      phaseActions: ["resolve_phase"],
    },
    d04ActionSurface: {
      commandState: {
        phase: { phaseId: "D04", locked: false },
        actions: [],
      },
      buttons: [{ action: "submit_vote:no_lynch" }],
    },
    d04TargetSurface: {
      commandState: {
        phase: { phaseId: "D04", locked: false },
        actorSlot: "slot-7",
        actorAlive: false,
        actorStatus: "dead",
      },
      buttons: [],
    },
  };
}
