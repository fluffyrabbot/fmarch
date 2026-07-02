import {
  completedGameEndgameTransition,
  completedHostStaleCommandCases,
  completedPlayerReloadCases,
  staleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_recovery_scenario_cases.mjs";
import {
  hostPhaseTransitionActionFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";

export function completedGameDayVoteOutcomesFixture() {
  return [
    { phaseId: "D02", status: "Lynch" },
    { phaseId: "D03", status: "Lynch" },
    { phaseId: "D04", status: "NoLynch" },
    { phaseId: "D05", status: "NoLynch" },
  ];
}

export function completedGameEndgameSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
  dayFiveOutcomes = completedGameDayVoteOutcomesFixture(),
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  const completedRoleUrls = {
    sourceActionPlayerRoleUrl: baseRoleUrl,
    sourceNormalPlayerRoleUrl: `${baseRoleUrl}/player-rowan`,
    sourceDeadPlayerRoleUrl: `${baseRoleUrl}?private=notification-1`,
  };
  const completedHostReloadSnapshot = completedHostReloadSnapshotFixture({
    dayVoteOutcomes: dayFiveOutcomes,
  });
  const completedReloadSnapshots = completedPlayerReloadSnapshotsFixture({
    game,
    dayVoteOutcomes: dayFiveOutcomes,
  });
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    ...completedRoleUrls,
    clickedThroughFromRoleUrl: true,
    transition: completedGameEndgameTransition(),
    hostCompleteProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 920,
      setupPhaseId: "N05",
      setupPhaseState: "open",
      setupSnapshotHost: {
        completed: false,
        phase: {
          id: "N05",
          state: "open",
        },
      },
      completeProof: {
        ...hostPhaseTransitionActionFixture({
          actionId: "complete_game",
          commandKind: "CompleteGame",
          streamSeq: 921,
          phaseId: "N05",
          phaseState: "open",
          deadlineAffordance: "none",
          projectionRefreshKeys: [],
          command: {
            game,
          },
        }),
        projection: {
          completed: true,
          phase: {
            id: "N05",
            state: "open",
            locked: false,
          },
          slots: [
            {
              role_revealed: true,
              alignment_revealed: true,
            },
          ],
        },
      },
    }),
    completedHostReloadProof: completedHostReloadProofFixture({
      sourceRoleUrl: `${baseRoleUrl}/host`,
      visitedRolePath: `/g/${game}/host`,
      snapshot: completedHostReloadSnapshot,
    }),
    ...completedHostStaleCommandProofFixtures({
      sourceRoleUrl: `${baseRoleUrl}/host`,
      visitedRolePath: `/g/${game}/host`,
      game,
      snapshot: completedHostReloadSnapshot,
    }),
    actionPlayerCompletedProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N05",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      gameCompleted: true,
      actionState: "disabled:game complete",
      statusText: "Player action unavailable: game complete",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed completed game endgame state with no vote, post, or action controls.",
      resyncFromSeq: 921,
      dayVoteOutcomes: dayFiveOutcomes,
    }),
    ...completedPlayerReloadProofFixtures({
      roleUrls: completedRoleUrls,
      snapshots: completedReloadSnapshots,
    }),
    completedDeadPlayerStaleVoteRecoveryProof:
      completedDeadPlayerStaleVoteRecoveryProofFixture({
        sourceRoleUrl: `${baseRoleUrl}?private=notification-1`,
        visitedRolePath: `/g/${game}?private=notification-1`,
        game,
        reloadSnapshot: completedReloadSnapshots.completedDeadPlayerReloadProof,
      }),
    ...staleCompletedPlayerCommandProofFixtures({
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      game,
    }),
    releaseReady: false,
    productionReady: false,
  };
}

export function completedHardeningProofFixture(
  game = "completed-hardening-game",
) {
  const hiddenSlot = { role_revealed: false, alignment_revealed: false };
  const revealedSlot = { role_revealed: true, alignment_revealed: true };
  const completeGameCommand = (targetGame) => ({
    body: { body: { command: { CompleteGame: { game: targetGame } } } },
  });
  return {
    staleHostComplete: {
      status: "passed",
      game: `${game}-stale-host-complete`,
      setup: { roleActions: ["complete_game"], slots: [hiddenSlot] },
      liveComplete: {
        commandStatus: { state: "ack", streamSeqs: [55] },
      },
      reject: {
        state: "reject",
        error: "GameAlreadyCompleted",
        serverEnvelope: { body: { kind: "Reject" } },
      },
      slotsAfterReject: [revealedSlot],
      revealTextAfterReject: "All 1 slots revealed",
      roleActionsAfterReject: [],
      activityRow: {
        source: "outcome",
        actionId: "complete_game",
        dispatchKind: "complete_game",
      },
      dispatchPlan: { projectionRefreshKeys: ["host"] },
      apiStateAfterReject: { completed: true, slots: [revealedSlot] },
      staleHostReloadAfterReject: {
        status: "passed",
        routeResponseStatus: 200,
        rejectReceiptStatusText:
          "Reject GameAlreadyCompleted: game already completed",
        surfaceText: "All 1 slots revealed",
        slotsAfterReload: [revealedSlot],
        revealTextAfterReload: "All 1 slots revealed",
        roleActionsAfterReload: [],
        apiStateAfterReload: { completed: true, slots: [revealedSlot] },
      },
      reconnectAfterReject: {
        status: "passed",
        reconnectingStatus: { state: "reconnecting" },
        reconnectRecoveryEvent: { attempt: 1, state: "recovered" },
        recoveredHostProjection: { completed: true, slots: [revealedSlot] },
      },
      roleActionsAfterReconnect: [],
    },
    concurrentHostCompleteRace: {
      status: "passed",
      game: `${game}-host-race`,
      setup: {
        firstRoleActions: ["complete_game"],
        secondRoleActions: ["complete_game"],
        firstRevealText: "0/1 slots revealed",
        secondRevealText: "0/1 slots revealed",
        firstSlots: [hiddenSlot],
        secondSlots: [hiddenSlot],
      },
      ackRaceRole: "first",
      rejectRaceRole: "second",
      ack: {
        state: "ack",
        commandId: "host-race-ack",
        streamSeqs: [56],
        serverEnvelope: { body: { kind: "Ack" } },
        requestEnvelope: completeGameCommand(`${game}-host-race`),
      },
      reject: {
        state: "reject",
        commandId: "host-race-reject",
        error: "GameAlreadyCompleted",
        serverEnvelope: { body: { kind: "Reject" } },
        requestEnvelope: completeGameCommand(`${game}-host-race`),
      },
      firstSlotsAfterRace: [revealedSlot],
      secondSlotsAfterRace: [revealedSlot],
      firstRevealTextAfterRace: "All 1 slots revealed",
      secondRevealTextAfterRace: "All 1 slots revealed",
      firstRoleActionsAfterRace: [],
      secondRoleActionsAfterRace: [],
      firstActivityStatusText: "Ack",
      secondActivityStatusText:
        "Reject GameAlreadyCompleted: game already completed",
      firstDispatchPlan: { projectionRefreshKeys: ["host"] },
      secondDispatchPlan: { projectionRefreshKeys: ["host"] },
      apiStateAfterRace: { completed: true, slots: [revealedSlot] },
      roleReloadAfterRace: {
        status: "passed",
        firstRouteStatus: 200,
        secondRouteStatus: 200,
        firstSlotsAfterReload: [revealedSlot],
        secondSlotsAfterReload: [revealedSlot],
        firstRevealTextAfterReload: "All 1 slots revealed",
        secondRevealTextAfterReload: "All 1 slots revealed",
        firstRoleActionsAfterReload: [],
        secondRoleActionsAfterReload: [],
        apiStateAfterReload: { completed: true, slots: [revealedSlot] },
      },
    },
    concurrentPlayerCompleteRace: {
      status: "passed",
      game: `${game}-player-race`,
      postBody: "concurrent player complete fixture post",
      setupCommandState: {
        actorSlot: "slot-7",
        gameCompleted: false,
      },
      setupPostButton: { action: "submit_post", disabled: false },
      setupHostActions: ["complete_game"],
      setupHostSlots: [hiddenSlot],
      post: {
        state: "reject",
        error: "GameAlreadyCompleted",
        serverEnvelope: { body: { kind: "Reject" } },
        requestEnvelope: {
          body: {
            body: {
              command: {
                SubmitPost: {
                  body: "concurrent player complete fixture post",
                },
              },
            },
          },
        },
      },
      complete: {
        state: "ack",
        streamSeqs: [57],
        serverEnvelope: { body: { kind: "Ack" } },
        requestEnvelope: completeGameCommand(`${game}-player-race`),
      },
      postSeq: null,
      completeSeq: 57,
      commandStateAfterRace: {
        gameCompleted: true,
        actions: [],
        voteTargets: [],
      },
      buttonsAfterRace: [{ action: "submit_post", disabled: true }],
      hostSlotsAfterRace: [revealedSlot],
      apiCommandStateAfterRace: {
        game_completed: true,
        actions: [],
        vote_targets: [],
      },
      apiThreadHasPost: false,
      apiStateAfterRace: { completed: true, slots: [revealedSlot] },
      publicReloadAfterRace: {
        status: "passed",
        routeResponseStatus: 200,
        threadPagerVisible: true,
        surfaceText: "Endgame\nThe game is complete.",
        recoveredCommandState: {
          actorSlot: "slot-7",
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: "game is complete",
        },
        reloadButtons: [{ action: "submit_post", disabled: true }],
        reloadPostCount: 0,
        reloadPostVisible: false,
        reloadThreadPostBodies: [],
        apiCommandStateAfterReload: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadPostCount: 0,
        apiThreadPostBodiesAfterReload: [],
        apiStateAfterReload: { completed: true, slots: [revealedSlot] },
      },
    },
    stalePlayerComplete: {
      status: "passed",
      game: `${game}-stale-player`,
      setupCommandState: {
        gameCompleted: false,
        voteTargets: [{ kind: "no_lynch" }],
      },
      staleVoteButton: { action: "submit_vote:no_lynch", disabled: false },
      liveComplete: { state: "ack" },
      reject: {
        state: "reject",
        error: "GameAlreadyCompleted",
        serverEnvelope: { body: { kind: "Reject" } },
      },
      dispatchPlan: { projectionRefreshKeys: ["commandState"] },
      commandStateAfterReject: {
        gameCompleted: true,
        actions: [],
        voteTargets: [],
      },
      buttonsAfterReject: [{ action: "submit_post", disabled: true }],
      currentVoteAfterReject: { hasVote: "false", text: "No current vote" },
      apiCommandStateAfterReject: {
        game_completed: true,
        actions: [],
        vote_targets: [],
      },
      stalePublicReloadAfterReject: {
        status: "passed",
        routeResponseStatus: 200,
        threadPagerVisible: true,
        surfaceText: "Endgame\nThe game is complete.",
        recoveredCommandState: {
          actorSlot: "slot-7",
          gameCompleted: true,
          actions: [],
          voteTargets: [],
          boundary: "game is complete",
        },
        reloadButtons: [{ action: "submit_post", disabled: true }],
        reloadCurrentVote: { hasVote: "false", text: "No current vote" },
        reloadThreadPostBodies: [],
        apiCommandStateAfterReload: {
          game_completed: true,
          actions: [],
          vote_targets: [],
        },
        apiThreadPostBodiesAfterReload: [],
        apiStateAfterReload: { completed: true, slots: [revealedSlot] },
      },
    },
  };
}

export function dayFiveNoLynchResolutionSurfaceFixture({
  game = "00000000-0000-0000-0000-000000000002",
  dayFiveOutcomes = completedGameDayVoteOutcomesFixture(),
} = {}) {
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;
  return {
    status: "passed",
    sourceHostRoleUrl: `${baseRoleUrl}/host`,
    sourceActionPlayerRoleUrl: baseRoleUrl,
    clickedThroughFromRoleUrl: true,
    transition:
      "player:D05:no_lynch:ack:918 -> host:D05:resolve_phase:ack:919 -> host:advance_phase:ack:920 -> actionPlayer:N05:no_action -> stale:D05:submit_vote:reject:PhaseLocked",
    dayFiveVoteProof: {
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
        message: "Ack: stream seqs 918",
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
          phaseId: "D05",
          locked: false,
        },
        currentVote: { kind: "no_lynch", slotId: null, label: "No lynch" },
        boundary:
          "Seeded browser Day 5 no-lynch vote ACK refreshed current vote and votecount projection.",
      },
      projectionVotecount: [{ target: "No lynch", count: 1, needed: 1 }],
      projectionDayVoteOutcomes: dayFiveOutcomes.slice(0, 3),
      setupResyncFromSeq: 917,
      setupSnapshotCommandState: {
        phase: { phaseId: "D05" },
      },
      currentVote: {
        hasVote: "true",
        text: "Current vote: No lynch",
      },
      receiptCount: 1,
      receiptStatusText: "Ack: stream seqs 918",
      receiptRefreshKeys: "votecount,commandState",
      rawInviteTokensVisible: false,
      targetOnlyReceiptVisible: false,
      releaseReady: false,
      productionReady: false,
    },
    hostTransitionProof: seededCoreLoopHostSurfaceFixture({
      game,
      setupResyncFromSeq: 918,
      setupPhaseId: "D05",
      setupPhaseState: "open",
      resolveProof: {
        ...hostPhaseTransitionActionFixture({
          actionId: "resolve_phase",
          commandKind: "ResolvePhase",
          streamSeq: 919,
          phaseId: "D05",
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
        dayVoteOutcomesProjection: dayFiveOutcomes,
      },
      advanceProof: hostPhaseTransitionActionFixture({
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 920,
        phaseId: "N05",
        phaseState: "open",
        deadlineAffordance: "resolve_phase,lock_thread",
        projectionRefreshKeys: [],
        command: {
          game,
        },
      }),
    }),
    actionPlayerNightFiveProof: seededCoreLoopPlayerSurfaceFixture({
      game,
      slotField: "actionPlayerSlot",
      slot: "slot-7",
      principalUserId: "player_mira",
      phaseId: "N05",
      phaseState: "open",
      actorAlive: true,
      actorStatus: "alive",
      actionState: "disabled:no legal action available",
      statusText: "Player action unavailable: no legal action available",
      privateCount: 0,
      privateReceipt: false,
      boundary:
        "Seeded browser action player observed host AdvancePhase from Day 5 no-lynch into open Night 5 with no legal action.",
      resyncFromSeq: 920,
      dayVoteOutcomes: dayFiveOutcomes,
    }),
    staleDayFiveVoteRecoveryProof: {
      status: "passed",
      sourceRoleUrl: baseRoleUrl,
      visitedRolePath: `/g/${game}`,
      surfaceTestId: "player-surface",
      clickedThroughFromRoleUrl: true,
      clickedAction: "submit_vote:no_lynch",
      commandKind: "SubmitVote",
      setupResyncFromSeq: 918,
      setupSnapshotCommandState: {
        phase: { phaseId: "D05" },
        voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
      },
      command: {
        game,
        actor_slot: "slot-7",
        target: "NoLynch",
      },
      commandStatus: {
        state: "reject",
        error: "PhaseLocked",
        message:
          "Reject PhaseLocked: phase locked; stale vote state, refresh and use current vote controls",
      },
      bridgePlan: {
        role: "player",
        commandKind: "SubmitVote",
        commandEndpoint: "/commands",
        finalState: "reject",
        projectionRefreshKeys: [
          "votecount",
          "commandState",
          "dayVoteOutcomes",
        ],
      },
      receipts: [{ state: "reject" }],
      projectionCommandState: {
        actorSlot: "slot-7",
        phase: {
          phaseId: "N05",
          locked: false,
        },
        actions: [],
        voteTargets: [],
        boundary:
          "Seeded browser PhaseLocked stale D05 vote refreshed into current Night 5 controls.",
      },
      checkpointReceiptState: "reject:PhaseLocked",
      checkpointPhaseIdAfterReject: "N05",
      checkpointActionStateAfterReject: "disabled:no legal action available",
      checkpointTargetSlotsAfterReject: "",
      recoveryText:
        "Stale recovery\nReject PhaseLocked: refresh and use current vote controls.",
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

export function completedHostReloadSnapshotFixture({
  dayVoteOutcomes = completedGameDayVoteOutcomesFixture(),
} = {}) {
  return {
    checkpoint: {
      phaseId: "N05",
      phaseState: "open",
      slotId: "slot-7",
      actionState: "disabled:no lifecycle command available",
      deadlineAffordance: "none",
    },
    projection: {
      completed: true,
      phase: {
        id: "N05",
        state: "open",
        locked: false,
      },
      slots: [
        {
          role_revealed: true,
          alignment_revealed: true,
        },
        {
          role_revealed: true,
          alignment_revealed: true,
        },
      ],
    },
    votecount: [],
    dayVoteOutcomes,
    hostPrompts: [],
    actionTiles: [],
    triggerButtons: [],
  };
}

export function completedHostReloadProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    resyncFromSeq: 921,
    initialResyncSnapshotHost: snapshot.projection,
    reloadedResyncSnapshotHost: snapshot.projection,
    initialSnapshot: snapshot,
    reloadedSnapshot: snapshot,
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedHostStaleCommandProofFixtures({
  sourceRoleUrl,
  visitedRolePath,
  game,
  snapshot,
}) {
  return Object.fromEntries(
    completedHostStaleCommandCases().map((scenario) => [
      scenario.proofField,
      completedHostStaleCommandProofFixture({
        sourceRoleUrl,
        visitedRolePath,
        commandId: scenario.commandId,
        commandKind: scenario.commandKind,
        game,
        snapshot,
      }),
    ]),
  );
}

export function completedHostStaleCommandProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  commandId,
  commandKind,
  game,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "host-console-surface",
    clickedThroughFromRoleUrl: true,
    commandEndpoint: "/commands",
    commandKind,
    command: {
      game,
    },
    commandResponse: {
      ok: false,
      status: 409,
      body: {
        v: 1,
        id: commandId,
        body: {
          kind: "Reject",
          body: {
            error: "GameAlreadyCompleted",
            retryable: false,
            message: "Reject GameAlreadyCompleted: game already completed",
          },
        },
      },
    },
    setupResyncFromSeq: 921,
    setupResyncSnapshotHost: snapshot.projection,
    recoveryResyncFromSeq: 921,
    recoveryResyncSnapshotHost: snapshot.projection,
    recoverySnapshot: snapshot,
    rawInviteTokensVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedPlayerReloadSnapshotsFixture({
  game,
  dayVoteOutcomes = completedGameDayVoteOutcomesFixture(),
}) {
  return Object.fromEntries(
    completedPlayerReloadCases().map((scenario) => [
      scenario.proofField,
      completedPlayerReloadSnapshotFixture({
        game,
        dayVoteOutcomes,
        slot: scenario.expectedSlot,
        principalUserId: scenario.principalUserId,
        actorAlive: scenario.expectedActorAlive,
        actorStatus: scenario.expectedActorStatus,
        boundary: scenario.boundary,
      }),
    ]),
  );
}

export function completedPlayerReloadSnapshotFixture({
  game,
  dayVoteOutcomes,
  slot,
  principalUserId,
  boundary,
  actorAlive,
  actorStatus,
}) {
  const commandState = {
    actorSlot: slot,
    phase: {
      phaseId: "N05",
      locked: false,
    },
    gameCompleted: true,
    actions: [],
    voteTargets: [],
    boundary,
  };
  if (actorAlive !== undefined) {
    commandState.actorAlive = actorAlive;
  }
  if (actorStatus !== undefined) {
    commandState.actorStatus = actorStatus;
  }
  return {
    checkpoint: {
      phaseId: "N05",
      phaseState: "open",
      actorSlot: slot,
      actionState: "disabled:game complete",
      receiptState: "idle",
      targetSlots: "",
    },
    commandState,
    notifications: [],
    dayVoteOutcomes,
    coldLoadEndpoints: {
      commandStateEndpoint:
        `/games/${game}/player-command-state?principal_user_id=${principalUserId}&slot_id=${slot}`,
      notificationsEndpoint:
        `/games/${game}/notifications?principal_user_id=${principalUserId}`,
    },
    buttons: [{ action: "submit_post", disabled: true, text: "Post" }],
    enabledMutatingButtons: [],
    disabledMutatingButtons: [
      { action: "submit_post", disabled: true, text: "Post" },
    ],
  };
}

export function completedPlayerReloadProofFixtures({ roleUrls, snapshots }) {
  return Object.fromEntries(
    completedPlayerReloadCases().map((scenario) => {
      const sourceRoleUrl = roleUrls[scenario.sourceRoleUrlField];
      return [
        scenario.proofField,
        completedPlayerReloadProofFixture({
          sourceRoleUrl,
          visitedRolePath: pathAndSearchFromUrl(sourceRoleUrl),
          snapshot: snapshots[scenario.proofField],
        }),
      ];
    }),
  );
}

export function completedPlayerReloadProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  snapshot,
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    resyncFromSeq: 921,
    initialResyncSnapshotCommandState: snapshot.commandState,
    reloadedResyncSnapshotCommandState: snapshot.commandState,
    initialSnapshot: snapshot,
    reloadedSnapshot: snapshot,
    rawInviteTokensVisible: false,
    targetOnlyActionVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function completedDeadPlayerStaleVoteRecoveryProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  game,
  reloadSnapshot,
  recoveryBoundary =
    "Seeded browser completed dead-player stale vote rejected into durable endgame controls.",
}) {
  return {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    commandEndpoint: "/commands",
    commandKind: "SubmitVote",
    command: {
      game,
      actor_slot: "slot-2",
      target: "NoLynch",
    },
    commandResponse: {
      ok: false,
      status: 409,
      body: {
        v: 1,
        id: "completed-dead-player-stale-vote",
        body: {
          kind: "Reject",
          body: {
            error: "GameAlreadyCompleted",
            retryable: false,
            message: "Reject GameAlreadyCompleted: game already completed",
          },
        },
      },
    },
    setupResyncFromSeq: 921,
    setupResyncSnapshotCommandState: reloadSnapshot.commandState,
    recoveryResyncFromSeq: 921,
    recoveryResyncSnapshotCommandState: reloadSnapshot.commandState,
    recoverySnapshot: {
      ...reloadSnapshot,
      commandState: {
        ...reloadSnapshot.commandState,
        boundary: recoveryBoundary,
      },
    },
    rawInviteTokensVisible: false,
    targetOnlyActionVisible: false,
    releaseReady: false,
    productionReady: false,
  };
}

export function staleCompletedPlayerCommandProofFixtures({
  sourceRoleUrl,
  visitedRolePath,
  game,
}) {
  return Object.fromEntries(
    staleCompletedGamePlayerCommandCases().map((scenario) => [
      scenario.proofField,
      staleCompletedPlayerCommandProofFixture({
        sourceRoleUrl,
        visitedRolePath,
        clickedAction: scenario.clickedAction,
        commandKind: scenario.commandKind,
        projectionRefreshKeys: scenario.expectedRefreshKeys,
        command: staleCompletedPlayerCommandFixture({ game, scenario }),
        boundary: scenario.rejectedBoundary,
        stalePostBody: scenario.postBody,
      }),
    ]),
  );
}

export function staleCompletedPlayerCommandFixture({ game, scenario }) {
  if (scenario.commandKind === "SubmitVote") {
    return {
      game,
      actor_slot: "slot-7",
      target: "NoLynch",
    };
  }
  if (scenario.commandKind === "SubmitPost") {
    return {
      game,
      actor_slot: "slot-7",
      channel_id: "main",
      body: scenario.postBody,
    };
  }
  throw new Error(`unknown stale completed player command: ${scenario.commandKind}`);
}

export function staleCompletedPlayerCommandProofFixture({
  sourceRoleUrl,
  visitedRolePath,
  clickedAction,
  commandKind,
  projectionRefreshKeys,
  command,
  boundary,
  stalePostBody,
}) {
  const proof = {
    status: "passed",
    sourceRoleUrl,
    visitedRolePath,
    surfaceTestId: "player-surface",
    clickedThroughFromRoleUrl: true,
    clickedAction,
    commandKind,
    setupResyncFromSeq: 918,
    setupSnapshotCommandState: {
      phase: { phaseId: "D05" },
      voteTargets: [{ kind: "no_lynch", slotId: null, label: "No lynch" }],
    },
    command,
    commandStatus: {
      state: "reject",
      error: "GameAlreadyCompleted",
      message: "Reject GameAlreadyCompleted: game already completed",
    },
    bridgePlan: {
      role: "player",
      commandKind,
      commandEndpoint: "/commands",
      finalState: "reject",
      projectionRefreshKeys,
    },
    receipts: [{ state: "reject" }],
    projectionCommandState: {
      actorSlot: "slot-7",
      phase: {
        phaseId: "N05",
        locked: false,
      },
      gameCompleted: true,
      actions: [],
      voteTargets: [],
      boundary,
    },
    checkpointReceiptState: "reject:GameAlreadyCompleted",
    checkpointPhaseIdAfterReject: "N05",
    checkpointActionStateAfterReject: "disabled:game complete",
    checkpointTargetSlotsAfterReject: "",
    receiptCount: 1,
    receiptStatusText: "Reject GameAlreadyCompleted",
    rawInviteTokensVisible: false,
    targetOnlyReceiptVisible: false,
    releaseReady: false,
    productionReady: false,
  };
  if (stalePostBody !== undefined) {
    proof.stalePostBody = stalePostBody;
  }
  return proof;
}

function pathAndSearchFromUrl(roleUrl) {
  const parsed = new URL(roleUrl);
  return `${parsed.pathname}${parsed.search}`;
}
