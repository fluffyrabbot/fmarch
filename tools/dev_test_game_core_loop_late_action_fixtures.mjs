import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";

export function lateLoopDayVoteOutcomesFixture() {
  return [
    { phaseId: "D02", status: "Lynch" },
    { phaseId: "D03", status: "Lynch" },
    { phaseId: "D04", status: "NoLynch" },
  ];
}

export function postNightFourTransitionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
  dayVoteOutcomes = lateLoopDayVoteOutcomesFixture(),
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceSurvivorRoleUrl: `${baseRoleUrl}?private=notification-1`,
    clickedThroughFromRoleUrl: true,
    transition:
      "host:N04:advance_phase:ack:917 -> survivor:D05:dead_no_controls -> actionPlayer:D05:no_lynch_controls -> stale:N04:submit_action:reject:PhaseLocked",
    hostAdvanceProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 916,
      setupPhaseId: "N04",
      setupPhaseState: "locked",
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 917,
        phaseId: "D05",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
        dayVoteOutcomesProjection: dayVoteOutcomes,
      }),
    }),
    survivorDayFiveProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      roleUrlSuffix: "?private=notification-1",
      slotField: "survivorSlot",
      slot: "slot-5",
      principalUserId: "player_sage",
      phaseId: "D05",
      phaseState: "open",
      actorAlive: false,
      actorStatus: "dead",
      actionState: "disabled:actor is not alive",
      statusText: "Player action unavailable: actor is not alive",
      privateCount: 1,
      privateReceipt: true,
      privateReceiptStatus: "factional_kill",
      privateReceiptPhaseId: "N04",
      boundary:
        "Seeded browser survivor stayed dead with no controls after N04 advanced to Day 5.",
      resyncFromSeq: 917,
      dayVoteOutcomes,
    }),
    actionPlayerDayFiveProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "D05",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed open Day 5 no-lynch controls after Night 4 advanced.",
      resyncFromSeq: 917,
      voteButtonCount: 1,
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
      dayVoteOutcomes,
    }),
    staleNightFourActionRecoveryProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_action:factional_kill",
      commandKind: "SubmitAction",
      setupResyncFromSeq: 916,
      setupSnapshotCommandState: {
        phase: { phaseId: "N04" },
        actions: [{ targets: ["slot-5"] }],
      },
      command: {
        game,
        actor_slot: "slot-7",
        action_id: "factional_kill",
        template_id: "factional_kill",
        targets: ["slot-5"],
        grant_id: "grant-factional-kill-n04",
      },
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
        message:
          "Reject PhaseLocked: phase locked; stale action state, refresh and use current action controls",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitAction",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: [
          "notifications",
          "investigationResults",
          "commandState",
          "dayVoteOutcomes",
        ],
      },
      receipts: [{ state: "reject" }],
      projectionCommandState: {
        actorSlot: "slot-7",
        phase: {
          phaseId: "D05",
          locked: false,
        },
        actions: [],
        voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
        boundary:
          "Seeded browser PhaseLocked stale N04 action refreshed into current Day 5 controls.",
      },
      checkpointReceiptState: "reject:PhaseLocked",
      checkpointPhaseIdAfterReject: "D05",
      checkpointActionStateAfterReject: "disabled:no legal action available",
      checkpointTargetSlotsAfterReject: "",
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh and use current action controls.",
      receiptCount: 1,
      receiptStatusText: "Reject PhaseLocked",
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}
