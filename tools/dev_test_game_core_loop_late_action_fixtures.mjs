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

export function nightFourNoActionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition:
      "player:D04:no_lynch:ack:912 -> host:D04:resolve_phase:ack:913 -> host:advance_phase:ack:914 -> actionPlayer:N04:no_action",
    dayFourVoteProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote:no_lynch",
      commandKind: "SubmitVote",
      command: {
        game,
        actor_slot: "slot-7",
        target: "NoLynch",
      },
      commandStatus: {
        state: "ack",
        message: "Ack: stream seqs 912",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitVote",
        commandEndpoint: "/commands",
        finalState: "ack",
        projectionRefreshKeys: ["votecount", "commandState"],
      },
      receipts: [{ state: "ack" }],
      projectionCommandState: {
        actorSlot: "slot-7",
        phase: {
          phaseId: "D04",
          locked: false,
        },
        currentVote: {
          kind: "no_lynch",
        },
        boundary:
          "Seeded browser Day 4 no-lynch vote ACK refreshed current vote and votecount projection.",
      },
      projectionVotecount: [{ target: "No lynch", count: 1, needed: 1 }],
      projectionDayVoteOutcomes: [
        { phaseId: "D02" },
        { phaseId: "D03" },
      ],
      setupResyncFromSeq: 911,
      setupSnapshotCommandState: {
        phase: {
          phaseId: "D04",
        },
      },
      currentVote: {
        hasVote: "true",
        text: "Current vote: No lynch",
      },
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 912",
      receiptRefreshKeys: "votecount,commandState",
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostTransitionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 912,
      setupPhaseId: "D04",
      setupPhaseState: "open",
      resolveProof: {
        ...hostPhaseTransitionActionFixture({
          actionId: "resolve_phase",
          commandKind: "ResolvePhase",
          streamSeq: 913,
          phaseId: "D04",
          phaseState: "locked",
          deadlineAffordance: "unlock_thread,advance_phase",
          projectionRefreshKeys: [
            "host",
            "votecount",
            "dayVoteOutcomes",
            "hostPrompts",
          ],
          command: {
            game,
            seed: 918273,
          },
        }),
        votecountProjection: [{ target: "No lynch", count: 1, needed: 1 }],
        dayVoteOutcomesProjection: [
          { phaseId: "D02" },
          { phaseId: "D03" },
          { phaseId: "D04", status: "NoLynch" },
        ],
      },
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 914,
        phaseId: "N04",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
      }),
    }),
    nightFourNoActionProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      setupResyncFromSeq: 914,
      setupSnapshotCommandState: {
        phase: {
          phaseId: "N04",
        },
        actions: [],
      },
      checkpoint: {
        phaseId: "N04",
        phaseState: "open",
        actorSlot: "slot-7",
        actionCount: 0,
        submitActionControls: 0,
        voteTargetCount: 0,
        privateCount: 0,
      },
      projectionCommandState: {
        actorSlot: "slot-7",
        actorAlive: true,
        actorStatus: "alive",
        phase: {
          phaseId: "N04",
          locked: false,
        },
        actions: [],
        voteTargets: [],
        boundary:
          "Seeded browser opened Night 4 with no legal action available.",
      },
      releaseReady: false,
      productionReady: false,
    },
    releaseReady: false,
    productionReady: false,
  };
}

export function nightFourNoActionResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition:
      "host:N04:resolve_phase:ack:916 -> actionPlayer:N04:no_action_privacy",
    hostResolutionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 914,
      setupPhaseId: "N04",
      setupPhaseState: "open",
      resolveProof: hostPhaseTransitionActionFixture({
        actionId: "resolve_phase",
        commandKind: "ResolvePhase",
        streamSeq: 916,
        phaseId: "N04",
        phaseState: "locked",
        deadlineAffordance: "unlock_thread,advance_phase",
        projectionRefreshKeys: [
          "host",
          "votecount",
          "dayVoteOutcomes",
          "hostPrompts",
        ],
        command: {
          game,
          seed: 918273,
        },
      }),
    }),
    actionPlayerPrivacyProof: nightFourResolutionPlayerSurfaceFixture({
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:phase locked",
      statusText: "Player action unavailable: phase locked",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed locked Night 4 after no-action host resolution with no private receipt.",
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=player_mira`,
    }),
    releaseReady: false,
    productionReady: false,
  };
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

function nightFourResolutionPlayerSurfaceFixture({
  sourceRoleUrl,
  visitedRolePath,
  slotField,
  slot,
  principalUserId,
  actorAlive,
  actorStatus,
  actionState,
  statusText,
  privateCount,
  privateReceipt,
  boundary,
  commandStateEndpoint,
  notificationsEndpoint,
}) {
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    [slotField]: slot,
    principalUserId,
    checkpoint: {
      phaseId: "N04",
      phaseState: "locked",
      actorSlot: slot,
      actionState,
      receiptState: "idle",
      statusText,
    },
    privateQueueBoundary: {
      status: "principal-scoped-private-projections",
      count: privateCount,
      text:
        "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    },
    voteButtonCount: 0,
    projectionCommandState: {
      actorSlot: slot,
      actorAlive,
      actorStatus,
      phase: {
        phaseId: "N04",
        locked: true,
      },
      actions: [],
      voteTargets: [],
      boundary,
    },
    projectionNotifications: privateReceipt
      ? [
          {
            effect: "player_killed",
            status: "factional_kill",
          },
        ]
      : [],
    projectionDayVoteOutcomes: lateLoopDayVoteOutcomesFixture(),
    resyncFromSeq: 916,
    resyncSnapshotCommandState: {
      actorSlot: slot,
      phase: {
        phaseId: "N04",
      },
    },
    resyncSnapshotNotifications: privateReceipt
      ? [
          {
            status: "factional_kill",
          },
        ]
      : [],
    coldLoadEndpoints: {
      notificationsEndpoint,
      commandStateEndpoint,
    },
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (privateReceipt) {
    proof.privateNotice = {
      id: "notification-1",
      kind: "notification",
      text: "player_killed factional_kill",
      detailText: "Phase N04",
    };
  } else {
    proof.privateEmptyText = "No private results visible";
  }
  return proof;
}
