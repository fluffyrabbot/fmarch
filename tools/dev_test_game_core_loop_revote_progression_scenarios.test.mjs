import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertRevoteProgressionBrowserProof,
  assertRevoteProgressionCheckpointEvidence,
  dayVoteNoLynchFeatureSpineRow,
  dayVoteNoLynchLaneId,
  revoteNoLynchTargetFromCommandState,
  revoteProgressionAdminCheckId,
  revoteProgressionBrowserScenario,
  revoteProgressionCheckpointCases,
  revoteProgressionCompactStatus,
  revoteProgressionCycleId,
  revoteProgressionFeatureSpineRows,
  revoteProgressionVoteActionId,
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

test("revote browser assertion owns repeated prompt and ballot proof shape", () => {
  const scenario = revoteProgressionBrowserScenario();
  assert.equal(revoteProgressionVoteActionId, "submit_vote:no_lynch");
  assert.deepEqual(
    revoteNoLynchTargetFromCommandState({
      commandState: {
        voteTargets: [
          { kind: "slot", slotId: "slot-4" },
          { kind: "no_lynch" },
        ],
      },
    }),
    { kind: "no_lynch" },
  );
  assert.doesNotThrow(() =>
    assertRevoteProgressionBrowserProof({
      proof: revoteBrowserProofFixture(),
      scenario,
    }),
  );
  assert.throws(
    () =>
      assertRevoteProgressionBrowserProof({
        proof: {
          ...revoteBrowserProofFixture(),
          actionAfterD03R1RevotePrompt: {
            ...revoteBrowserProofFixture().actionAfterD03R1RevotePrompt,
            buttons: [],
          },
        },
        scenario,
      }),
    /second revote action player vote controls missing/,
  );
});

function revoteBrowserProofFixture() {
  const prompt = (id, status = "resolved") => {
    const phase = id.split(":", 1)[0];
    const terminal = phase === "D03R2";
    return {
      id,
      prompt_id: id,
      label: "revote",
      status,
      value: "no_majority",
      ...(status === "resolved"
        ? {
            public_resolution: {
              kind: "phase_advance",
              source_phase_id: phase,
              target_phase_id: terminal
                ? "N03"
                : phase === "D03"
                  ? "D03R1"
                  : "D03R2",
              reason: terminal ? "no_majority_no_lynch" : "revote",
            },
          }
        : {}),
    };
  };
  const promptResolution = ({ promptId, policy }) => ({
    commandStatus: {
      state: "ack",
      streamSeqs: [1, 2],
      requestEnvelope: {
        body: {
          body: {
            command: {
              ResolveHostPrompt: {
                prompt_id: promptId,
                decision: { SelectPolicy: { policy } },
              },
            },
          },
        },
      },
    },
  });
  const openHost = ({ phaseId, prompts, promptActions = [] }) => ({
    phase: { id: phaseId, locked: false },
    phaseActions: ["resolve_phase"],
    promptActions,
    hostPrompts: prompts,
  });
  const playerOpen = (phaseId) => ({
    commandState: { phase: { phaseId, locked: false } },
    buttons: [{ action: "submit_vote:no_lynch", disabled: false }],
  });
  const voteSubmission = (phaseId) => ({
    state: "ack",
    requestEnvelope: {
      body: {
        body: {
          principal_user_id: "player-goon-a",
          command: {
            SubmitVote: {
              actor_slot: "slot_4",
              target: "NoLynch",
            },
          },
        },
      },
    },
    phaseId,
  });
  const afterVote = (phaseId) => ({
    commandState: {
      phase: { phaseId, locked: false },
      currentVote: { kind: "no_lynch" },
    },
    currentVote: { hasVote: "true" },
    votecount: [{ target: "no_lynch", count: 1 }],
  });
  const beforeResolve = (phaseId) => ({
    phase: { id: phaseId, locked: false },
    phaseActions: ["resolve_phase"],
  });
  const afterResolve = ({ phaseId, prompts, promptActions }) => ({
    phase: { id: phaseId, locked: true },
    promptActions,
    dayVoteOutcomes: [
      {
        phaseId,
        status: "NoMajority",
        tallies: { no_lynch: 1 },
      },
    ],
    outcomePanel: `${phaseId} NoMajority`,
  });
  const outcome = { status: "NoMajority", winnerSlot: null, tallies: { no_lynch: 1 } };
  return {
    d03RevotePrompt: prompt("D03:revote:NoMajority", "resolved"),
    d03RevotePromptActionId: "host_prompt:D03:continue",
    d03RevotePromptResolution: promptResolution({
      promptId: "D03:revote:NoMajority",
      policy: "no_majority_continue_revote",
    }),
    hostAfterD03RevotePrompt: openHost({
      phaseId: "D03R1",
      prompts: [prompt("D03:revote:NoMajority")],
    }),
    actionAfterD03RevotePrompt: playerOpen("D03R1"),
    normalAfterD03RevotePrompt: playerOpen("D03R1"),
    apiPromptsAfterD03Revote: [prompt("D03:revote:NoMajority")],
    d03RevoteVoteSubmission: voteSubmission("D03R1"),
    d03RevoteActionAfterVote: afterVote("D03R1"),
    d03RevoteApiNoLynchRow: { count: 1, needed: 4 },
    d03RevoteApiOriginalD03Row: { count: 1 },
    d03RevoteApiStaleD03NoLynchRow: undefined,
    hostBeforeResolveD03R1: beforeResolve("D03R1"),
    resolveD03R1: { commandStatus: { state: "ack" } },
    hostAfterResolveD03R1: afterResolve({
      phaseId: "D03R1",
      prompts: [prompt("D03R1:revote:NoMajority", "pending")],
      promptActions: ["host_prompt:D03R1:continue"],
    }),
    d03R1DayVoteOutcome: outcome,
    d03R1RevotePrompt: prompt("D03R1:revote:NoMajority", "pending"),
    d03R1RevotePromptActionId: "host_prompt:D03R1:continue",
    apiPromptsAfterResolveD03R1: [
      prompt("D03:revote:NoMajority"),
      prompt("D03R1:revote:NoMajority", "pending"),
    ],
    d03R1RevotePromptResolution: promptResolution({
      promptId: "D03R1:revote:NoMajority",
      policy: "no_majority_continue_revote",
    }),
    hostAfterD03R1RevotePrompt: openHost({
      phaseId: "D03R2",
      prompts: [
        prompt("D03:revote:NoMajority"),
        prompt("D03R1:revote:NoMajority"),
      ],
    }),
    actionAfterD03R1RevotePrompt: playerOpen("D03R2"),
    normalAfterD03R1RevotePrompt: playerOpen("D03R2"),
    apiPromptsAfterD03R1Revote: [
      prompt("D03:revote:NoMajority"),
      prompt("D03R1:revote:NoMajority"),
    ],
    d03R2RevoteVoteSubmission: voteSubmission("D03R2"),
    d03R2RevoteActionAfterVote: afterVote("D03R2"),
    d03R2RevoteApiNoLynchRow: { count: 1, needed: 4 },
    d03R2RevoteApiOriginalD03Row: { count: 1 },
    d03R2RevoteApiD03R1NoLynchRow: { count: 1 },
    d03R2RevoteApiStaleD03NoLynchRow: undefined,
    hostBeforeResolveD03R2: beforeResolve("D03R2"),
    resolveD03R2: { commandStatus: { state: "ack" } },
    hostAfterResolveD03R2: afterResolve({
      phaseId: "D03R2",
      prompts: [prompt("D03R2:revote:NoMajority", "pending")],
      promptActions: ["host_prompt:D03R2:no_lynch", "host_prompt:D03R2:continue"],
    }),
    d03R2DayVoteOutcome: outcome,
    d03R2RevotePrompt: prompt("D03R2:revote:NoMajority", "pending"),
    d03R2RevotePromptActionId: "host_prompt:D03R2:no_lynch",
    d03R2StaleContinuePolicyActionId: "host_prompt:D03R2:continue",
    apiPromptsAfterResolveD03R2: [
      prompt("D03:revote:NoMajority"),
      prompt("D03R1:revote:NoMajority"),
      prompt("D03R2:revote:NoMajority", "pending"),
    ],
    d03R2NoLynchPolicyResolution: promptResolution({
      promptId: "D03R2:revote:NoMajority",
      policy: "no_majority_no_lynch",
    }),
    hostAfterD03R2NoLynchPolicy: openHost({
      phaseId: "N03",
      prompts: [prompt("D03R2:revote:NoMajority")],
    }),
    actionAfterD03R2NoLynchPolicy: {
      commandState: { phase: { phaseId: "N03", locked: false } },
      buttons: [{ action: "submit_action:factional_kill" }],
    },
    normalAfterD03R2NoLynchPolicy: {
      commandState: { phase: { phaseId: "N03", locked: false } },
      buttons: [],
    },
    apiPromptsAfterD03R2NoLynchPolicy: [
      prompt("D03R2:revote:NoMajority"),
    ],
    d03R2StaleContinuePolicySetup: {
      promptActions: ["host_prompt:D03R2:continue"],
    },
    d03R2StaleContinuePolicyRecovery: {
      reject: { state: "reject", error: "PromptAlreadyResolved" },
      activityStatusText:
        "Reject PromptAlreadyResolved: host prompt selection is stale",
      staleHostPromptReloadAfterReject: {
        phase: { id: "N03", locked: false },
        promptActionsAfterReload: [],
      },
    },
  };
}
