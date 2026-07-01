const completedGameHardeningLaneCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "stale-host-complete",
    label: "Stale complete-game reveal rejects after live completion",
    family: "completed-host-stale-command",
  }),
  Object.freeze({
    id: "stale-host-complete-reload",
    label: "Stale host complete recovery reloads revealed console",
    family: "completed-host-stale-command",
  }),
  Object.freeze({
    id: "stale-host-complete-reconnect-recovery",
    label: "Stale host complete recovery reconnects revealed console",
    family: "completed-host-stale-command",
  }),
  Object.freeze({
    id: "concurrent-host-complete-race",
    label: "Concurrent complete-game commands converge",
    family: "completed-host-race",
  }),
  Object.freeze({
    id: "concurrent-host-complete-race-reload",
    label: "Concurrent complete-game race reloads revealed host consoles",
    family: "completed-host-race",
  }),
  Object.freeze({
    id: "concurrent-player-complete-race",
    label: "Concurrent player command and completion converge",
    family: "completed-player-stale-command",
  }),
  Object.freeze({
    id: "public-player-complete-reload",
    label: "Public player board reloads completed game truth",
    family: "completed-player-reload",
  }),
  Object.freeze({
    id: "stale-player-complete",
    label: "Stale player command rejects after live completion",
    family: "completed-player-stale-command",
  }),
  Object.freeze({
    id: "stale-player-complete-reload",
    label: "Stale public player complete recovery reloads completed board",
    family: "completed-player-reload",
  }),
]);

export function completedGameHardeningLaneCases() {
  return completedGameHardeningLaneCaseDefinitions.map((scenario) => ({
    ...scenario,
  }));
}

export function completedGameHardeningLaneIds() {
  return completedGameHardeningLaneCases().map((scenario) => scenario.id);
}

export function completedHostStaleCommandHardeningLaneIds() {
  return completedGameHardeningLaneCases()
    .filter((scenario) => scenario.family === "completed-host-stale-command")
    .map((scenario) => scenario.id);
}

export function completedPlayerHardeningReloadLaneIds() {
  return completedGameHardeningLaneCases()
    .filter((scenario) => scenario.family === "completed-player-reload")
    .map((scenario) => scenario.id);
}

export function completedHostStaleCommandCases() {
  return [
    {
      proofField: "completedHostStaleResolveRecoveryProof",
      commandKind: "ResolvePhase",
      commandId: "completed-host-stale-resolve",
      transitionToken: "host:stale_resolve_phase:reject:GameAlreadyCompleted",
      boundary:
        "Seeded browser completed host stale ResolvePhase rejected into completed host controls.",
    },
    {
      proofField: "completedHostStaleAdvanceRecoveryProof",
      commandKind: "AdvancePhase",
      commandId: "completed-host-stale-advance",
      transitionToken: "host:stale_advance_phase:reject:GameAlreadyCompleted",
      boundary:
        "Seeded browser completed host stale AdvancePhase rejected into completed host controls.",
    },
    {
      proofField: "completedHostStaleCompleteRecoveryProof",
      commandKind: "CompleteGame",
      commandId: "completed-host-stale-complete",
      transitionToken: "host:stale_complete_game:reject:GameAlreadyCompleted",
      boundary:
        "Seeded browser completed host stale CompleteGame rejected into completed host controls.",
    },
  ];
}

export function completedPlayerReloadCases() {
  return [
    {
      proofField: "completedPlayerReloadProof",
      sourceRoleUrlField: "sourceActionPlayerRoleUrl",
      transitionToken: "actionPlayer:reload:complete",
      cookieValue: "fixture-player",
      commandStateKind: "action-player",
      expectedSlot: "slot-7",
      expectedBoundaryText: "completed action-player role URL reloaded",
      principalUserId: "player_mira",
      boundary:
        "Seeded browser completed action-player role URL reloaded into durable endgame controls.",
    },
    {
      proofField: "completedNormalPlayerReloadProof",
      sourceRoleUrlField: "sourceNormalPlayerRoleUrl",
      transitionToken: "normalPlayer:reload:complete",
      cookieValue: "fixture-normal",
      commandStateKind: "normal-player",
      expectedSlot: "slot-4",
      expectedBoundaryText: "completed normal-player role URL reloaded",
      principalUserId: "player_rowan",
      boundary:
        "Seeded browser completed normal-player role URL reloaded into durable endgame controls.",
    },
    {
      proofField: "completedDeadPlayerReloadProof",
      sourceRoleUrlField: "sourceDeadPlayerRoleUrl",
      transitionToken: "deadPlayer:reload:complete",
      cookieValue: "fixture-target",
      commandStateKind: "dead-player",
      expectedSlot: "slot-2",
      expectedActorAlive: false,
      expectedActorStatus: "dead",
      expectedBoundaryText: "completed dead-player role URL reloaded",
      principalUserId: "player_ilya",
      boundary:
        "Seeded browser completed dead-player role URL reloaded into durable endgame controls.",
    },
  ];
}

export function completedPlayerReloadAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  cases = completedPlayerReloadCases(),
}) {
  return cases.map((scenario) => ({
    proof: completedGameEndgameSurface[scenario.proofField],
    expectedGame,
    sourceRoleUrl: completedGameEndgameSurface[scenario.sourceRoleUrlField],
    expectedSlot: scenario.expectedSlot,
    expectedBoundaryText: scenario.expectedBoundaryText,
    principalUserId: scenario.principalUserId,
  }));
}

export function completedPlayerReloadProofCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
  cases = completedPlayerReloadCases(),
}) {
  const roleUrlsByField = {
    sourceActionPlayerRoleUrl: actionPlayerRoleUrl,
    sourceNormalPlayerRoleUrl: normalPlayerRoleUrl,
    sourceDeadPlayerRoleUrl: deadPlayerRoleUrl,
  };
  return cases.map((scenario) => ({
    ...scenario,
    roleUrl: roleUrlsByField[scenario.sourceRoleUrlField],
    commandState: completedPlayerReloadCommandState({
      scenario,
      commandStateBuilders,
    }),
  }));
}

export function completedPlayerReloadCommandState({
  scenario,
  commandStateBuilders,
}) {
  const builder = commandStateBuilders?.[scenario.commandStateKind];
  if (typeof builder !== "function") {
    throw new Error(
      `unknown completed player reload command state: ${scenario.commandStateKind}`,
    );
  }
  return builder({ boundary: scenario.boundary });
}

export function assertCompletedPlayerReloadCases(
  cases,
  assertCompletedPlayerReloadProof,
) {
  for (const scenario of cases) {
    assertCompletedPlayerReloadProof({
      ...scenario,
      expectedCommandStateEndpoint:
        `/games/${scenario.expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
      expectedNotificationsEndpoint:
        `/games/${scenario.expectedGame}/notifications?principal_user_id=${scenario.principalUserId}`,
    });
  }
}

export function staleCompletedGamePlayerCommandCases() {
  return [
    {
      proofField: "staleCompletedVoteRecoveryProof",
      transitionToken: "stale:D05:submit_vote:reject:GameAlreadyCompleted",
      clickedAction: "submit_vote:no_lynch",
      commandKind: "SubmitVote",
      commandSelector: "SubmitVote",
      commandButtonSelector:
        '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
      setupReadySelector:
        '[data-testid="player-composer"] button[data-action="submit_vote:no_lynch"]',
      rejectedBoundary:
        "Seeded browser GameAlreadyCompleted stale D05 vote refreshed into completed endgame controls.",
      staleBoundary:
        "Seeded browser stale completed-game vote proof opened with old Day 5 no-lynch controls.",
      expectedRefreshKeys: ["votecount", "commandState"],
    },
    {
      proofField: "staleCompletedPostRecoveryProof",
      transitionToken: "stale:D05:submit_post:reject:GameAlreadyCompleted",
      clickedAction: "submit_post",
      commandKind: "SubmitPost",
      commandSelector: "SubmitPost",
      commandButtonSelector:
        '[data-testid="player-composer"] button[data-action="submit_post"]',
      setupReadySelector:
        '[data-testid="player-composer"] button[data-action="submit_post"]',
      postBody: "Stale completed game proof post",
      rejectedBoundary:
        "Seeded browser GameAlreadyCompleted stale D05 post refreshed into completed endgame controls.",
      staleBoundary:
        "Seeded browser stale completed-game post proof opened with old Day 5 post controls.",
      expectedRefreshKeys: [
        "thread",
        "votecount",
        "commandState",
        "dayVoteOutcomes",
      ],
    },
  ];
}

export function completedDeadPlayerStaleVoteCase() {
  return {
    proofField: "completedDeadPlayerStaleVoteRecoveryProof",
    transitionToken: "deadPlayer:stale_submit_vote:reject:GameAlreadyCompleted",
    commandKind: "SubmitVote",
    expectedSlot: "slot-2",
    principalUserId: "player_ilya",
    expectedBoundaryText: "completed dead-player stale vote rejected",
  };
}

export function completedGameEndgameTransitionTokens() {
  return [
    "host:N05:complete_game:ack:921",
    "host:reload:complete",
    ...completedHostStaleCommandCases().map(
      (scenario) => scenario.transitionToken,
    ),
    "actionPlayer:endgame:complete",
    ...completedPlayerReloadCases().map((scenario) => scenario.transitionToken),
    completedDeadPlayerStaleVoteCase().transitionToken,
    ...staleCompletedGamePlayerCommandCases().map(
      (scenario) => scenario.transitionToken,
    ),
  ];
}

export function completedGameEndgameTransition() {
  return completedGameEndgameTransitionTokens().join(" -> ");
}

export function assertCompletedGameEndgameTransition({
  transition,
  failureMessage = "completed-game endgame transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = completedGameEndgameTransitionTokens().filter(
    (token) => !transitionText.includes(token),
  );
  if (missingTokens.length > 0) {
    throw new Error(`${failureMessage}: ${missingTokens.join(", ")}`);
  }
}

export function completedGameEndgameStaleRejectAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceHostRoleUrl,
  sourceDeadPlayerRoleUrl,
  sourceActionPlayerRoleUrl,
  assertCompletedHostStaleCommandRecoveryProof,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
}) {
  return [
    ...completedHostStaleCommandCases().map((scenario) => ({
      assertProof: assertCompletedHostStaleCommandRecoveryProof,
      proof: completedGameEndgameSurface[scenario.proofField],
      expectedGame,
      sourceRoleUrl: sourceHostRoleUrl,
      expectedCommandKind: scenario.commandKind,
    })),
    {
      assertProof: assertCompletedDeadPlayerStaleVoteRecoveryProof,
      proof: completedGameEndgameSurface[
        completedDeadPlayerStaleVoteCase().proofField
      ],
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
      scenario: completedDeadPlayerStaleVoteCase(),
    },
    ...staleCompletedGamePlayerCommandCases().map((scenario) => ({
      assertProof: assertStaleCompletedGamePlayerCommandRecoveryProof,
      proof: completedGameEndgameSurface[scenario.proofField],
      expectedGame,
      sourceRoleUrl: sourceActionPlayerRoleUrl,
      scenario,
    })),
  ];
}

export function completedGameEndgameSurfaceAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  assertHostCompleteGameProof,
  assertCompletedHostReloadProof,
  assertActionPlayerCompletedProof,
  assertCompletedHostStaleCommandRecoveryProof,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  assertCompletedPlayerReloadProof,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
}) {
  return [
    {
      assertProof: assertHostCompleteGameProof,
      proof: completedGameEndgameSurface.hostCompleteProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
    },
    {
      assertProof: assertCompletedHostReloadProof,
      proof: completedGameEndgameSurface.completedHostReloadProof,
      sourceRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
    },
    {
      assertProof: assertActionPlayerCompletedProof,
      proof: completedGameEndgameSurface.actionPlayerCompletedProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
      expectedSlot: "slot-7",
      slotField: "actionPlayerSlot",
      expectedPrincipalUserId: "player_mira",
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedActorAlive: true,
      expectedActorStatus: "alive",
      expectedActionState: "disabled:game complete",
      expectedStatusText: "game complete",
      expectedPrivateCount: 0,
      expectedPrivateReceipt: false,
      expectedBoundaryText: "completed game endgame state",
      expectedResyncFromSeq: 921,
      expectedCommandStateEndpoint:
        `/games/${expectedGame}/player-command-state?principal_user_id=player_mira&slot_id=slot-7`,
      expectedNotificationsEndpoint:
        `/games/${expectedGame}/notifications?principal_user_id=player_mira`,
      expectedLastVoteOutcomePhaseId: "D05",
    },
    ...completedPlayerReloadAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      cases: completedPlayerReloadCases(),
    }).map((scenario) => ({
      assertProof: assertCompletedPlayerReloadProof,
      ...scenario,
      expectedCommandStateEndpoint:
        `/games/${scenario.expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}`,
      expectedNotificationsEndpoint:
        `/games/${scenario.expectedGame}/notifications?principal_user_id=${scenario.principalUserId}`,
    })),
    ...completedGameEndgameStaleRejectAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
      sourceDeadPlayerRoleUrl: completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
      sourceActionPlayerRoleUrl:
        completedGameEndgameSurface.sourceActionPlayerRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
    }),
  ];
}

export function assertCompletedStaleRejectCases(cases) {
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
}

export function assertCompletedGameEndgameSurfaceAssertionCases({
  cases,
  completedGameEndgameSurface,
  includeEvidenceInError = false,
}) {
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
  if (
    completedGameEndgameSurface.actionPlayerCompletedProof
      ?.projectionCommandState?.gameCompleted !== true ||
    completedGameEndgameSurface.actionPlayerCompletedProof
      ?.resyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed player command state",
      evidence: completedGameEndgameSurface.actionPlayerCompletedProof,
      includeEvidenceInError,
    });
  }
}

export function assertCompletedHostStaleCommandRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  expectedCommandKind,
  includeEvidenceInError = false,
}) {
  const snapshot = proof?.recoverySnapshot;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.endsWith("/host") ||
    proof.surfaceTestId !== "host-console-surface" ||
    proof.commandEndpoint !== "/commands" ||
    proof.commandKind !== expectedCommandKind ||
    proof.command?.game !== expectedGame ||
    proof.commandResponse?.ok !== false ||
    proof.commandResponse?.status !== 409 ||
    proof.commandResponse?.body?.body?.kind !== "Reject" ||
    proof.commandResponse?.body?.body?.body?.error !==
      "GameAlreadyCompleted" ||
    !String(proof.commandResponse?.body?.body?.body?.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.setupResyncFromSeq !== 921 ||
    proof.setupResyncSnapshotHost?.completed !== true ||
    proof.setupResyncSnapshotHost?.phase?.id !== "N05" ||
    proof.recoveryResyncFromSeq !== 921 ||
    proof.recoveryResyncSnapshotHost?.completed !== true ||
    proof.recoveryResyncSnapshotHost?.phase?.id !== "N05" ||
    snapshot?.checkpoint?.phaseId !== "N05" ||
    snapshot.checkpoint.phaseState !== "open" ||
    snapshot.checkpoint.deadlineAffordance !== "none" ||
    !String(snapshot.checkpoint.actionState ?? "").startsWith("disabled:") ||
    snapshot.projection?.completed !== true ||
    snapshot.projection?.phase?.id !== "N05" ||
    snapshot.projection?.phase?.state !== "open" ||
    snapshot.projection?.slots?.[0]?.role_revealed !== true ||
    snapshot.projection?.slots?.[0]?.alignment_revealed !== true ||
    snapshot.projection?.slots?.[1]?.role_revealed !== true ||
    snapshot.projection?.slots?.[1]?.alignment_revealed !== true ||
    snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
    snapshot.hostPrompts?.length !== 0 ||
    snapshot.actionTiles?.length !== 0 ||
    snapshot.triggerButtons?.length !== 0
  ) {
    throwCompletedScenarioAssertionError({
      message: `core-loop admin proof missing completed host stale ${expectedCommandKind} recovery`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertCompletedPlayerReloadProofCase({
  proof,
  sourceRoleUrl,
  expectedSlot,
  expectedBoundaryText,
  expectedCommandStateEndpoint,
  expectedNotificationsEndpoint,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyActionVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.resyncFromSeq !== 921 ||
    proof.initialResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.reloadedResyncSnapshotCommandState?.gameCompleted !== true
  ) {
    throwCompletedScenarioAssertionError({
      message: "core-loop admin proof missing completed player reload shell",
      evidence: proof,
      includeEvidenceInError,
    });
  }
  for (const [label, snapshot] of [
    ["initial", proof.initialSnapshot],
    ["reloaded", proof.reloadedSnapshot],
  ]) {
    if (
      snapshot?.checkpoint?.phaseId !== "N05" ||
      snapshot.checkpoint.phaseState !== "open" ||
      snapshot.checkpoint.actorSlot !== expectedSlot ||
      snapshot.checkpoint.actionState !== "disabled:game complete" ||
      snapshot.checkpoint.receiptState !== "idle" ||
      snapshot.commandState?.actorSlot !== expectedSlot ||
      snapshot.commandState?.phase?.phaseId !== "N05" ||
      snapshot.commandState?.gameCompleted !== true ||
      snapshot.commandState?.actions?.length !== 0 ||
      snapshot.commandState?.voteTargets?.length !== 0 ||
      !String(snapshot.commandState?.boundary ?? "").includes(
        expectedBoundaryText,
      ) ||
      snapshot.dayVoteOutcomes?.at?.(-1)?.phaseId !== "D05" ||
      snapshot.coldLoadEndpoints?.commandStateEndpoint !==
        expectedCommandStateEndpoint ||
      snapshot.coldLoadEndpoints?.notificationsEndpoint !==
        expectedNotificationsEndpoint ||
      snapshot.enabledMutatingButtons?.length !== 0 ||
      !snapshot.disabledMutatingButtons?.some(
        (button) => button.action === "submit_post" && button.disabled === true,
      )
    ) {
      throwCompletedScenarioAssertionError({
        message: `core-loop admin proof missing ${label} completed player reload closure`,
        evidence: snapshot,
        includeEvidenceInError,
      });
    }
  }
}

export function assertCompletedDeadPlayerStaleVoteRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario = completedDeadPlayerStaleVoteCase(),
  includeEvidenceInError = false,
}) {
  const snapshot = proof?.recoverySnapshot;
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyActionVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.commandEndpoint !== "/commands" ||
    proof.commandKind !== scenario.commandKind ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== scenario.expectedSlot ||
    proof.command.target !== "NoLynch" ||
    proof.commandResponse?.ok !== false ||
    proof.commandResponse?.status !== 409 ||
    proof.commandResponse?.body?.body?.kind !== "Reject" ||
    proof.commandResponse?.body?.body?.body?.error !==
      "GameAlreadyCompleted" ||
    !String(proof.commandResponse?.body?.body?.body?.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.setupResyncFromSeq !== 921 ||
    proof.setupResyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    proof.setupResyncSnapshotCommandState?.gameCompleted !== true ||
    proof.recoveryResyncFromSeq !== 921 ||
    proof.recoveryResyncSnapshotCommandState?.actorSlot !==
      scenario.expectedSlot ||
    proof.recoveryResyncSnapshotCommandState?.gameCompleted !== true ||
    snapshot?.checkpoint?.phaseId !== "N05" ||
    snapshot.checkpoint.phaseState !== "open" ||
    snapshot.checkpoint.actorSlot !== scenario.expectedSlot ||
    snapshot.checkpoint.actionState !== "disabled:game complete" ||
    snapshot.checkpoint.receiptState !== "idle" ||
    snapshot.commandState?.actorSlot !== scenario.expectedSlot ||
    snapshot.commandState?.actorAlive !== false ||
    snapshot.commandState?.actorStatus !== "dead" ||
    snapshot.commandState?.phase?.phaseId !== "N05" ||
    snapshot.commandState?.gameCompleted !== true ||
    snapshot.commandState?.actions?.length !== 0 ||
    snapshot.commandState?.voteTargets?.length !== 0 ||
    !String(snapshot.commandState?.boundary ?? "").includes(
      scenario.expectedBoundaryText,
    ) ||
    snapshot.coldLoadEndpoints?.commandStateEndpoint !==
      `/games/${expectedGame}/player-command-state?principal_user_id=${scenario.principalUserId}&slot_id=${scenario.expectedSlot}` ||
    snapshot.coldLoadEndpoints?.notificationsEndpoint !==
      `/games/${expectedGame}/notifications?principal_user_id=${scenario.principalUserId}` ||
    snapshot.enabledMutatingButtons?.length !== 0
  ) {
    throwCompletedScenarioAssertionError({
      message:
        "core-loop admin proof missing completed dead-player stale vote recovery",
      evidence: proof,
      includeEvidenceInError,
    });
  }
}

export function assertStaleCompletedGamePlayerCommandRecoveryProofCase({
  proof,
  expectedGame,
  sourceRoleUrl,
  scenario,
  includeEvidenceInError = false,
}) {
  if (
    proof?.status !== "passed" ||
    proof.clickedThroughFromRoleUrl !== true ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.rawInviteTokensVisible !== false ||
    proof.targetOnlyReceiptVisible !== false ||
    proof.sourceRoleUrl !== sourceRoleUrl ||
    typeof proof.visitedRolePath !== "string" ||
    !proof.visitedRolePath.includes("/g/") ||
    proof.surfaceTestId !== "player-surface" ||
    proof.clickedAction !== scenario.clickedAction ||
    proof.commandKind !== scenario.commandKind ||
    proof.setupResyncFromSeq !== 918 ||
    proof.setupSnapshotCommandState?.phase?.phaseId !== "D05" ||
    proof.command?.game !== expectedGame ||
    proof.command.actor_slot !== "slot-7" ||
    proof.commandStatus?.state !== "reject" ||
    proof.commandStatus.error !== "GameAlreadyCompleted" ||
    !String(proof.commandStatus.message ?? "").includes(
      "Reject GameAlreadyCompleted: game already completed",
    ) ||
    proof.bridgePlan?.role !== "player" ||
    proof.bridgePlan.commandKind !== scenario.commandKind ||
    proof.bridgePlan.commandEndpoint !== "/commands" ||
    proof.bridgePlan.finalState !== "reject" ||
    !sameStringArray(
      proof.bridgePlan.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof.receipts?.at?.(-1)?.state !== "reject" ||
    proof.projectionCommandState?.actorSlot !== "slot-7" ||
    proof.projectionCommandState?.phase?.phaseId !== "N05" ||
    proof.projectionCommandState?.gameCompleted !== true ||
    proof.projectionCommandState?.actions?.length !== 0 ||
    proof.projectionCommandState?.voteTargets?.length !== 0 ||
    !String(proof.projectionCommandState?.boundary ?? "").includes(
      scenario.rejectedBoundary,
    ) ||
    proof.checkpointReceiptState !== "reject:GameAlreadyCompleted" ||
    proof.checkpointPhaseIdAfterReject !== "N05" ||
    proof.checkpointActionStateAfterReject !== "disabled:game complete" ||
    proof.checkpointTargetSlotsAfterReject !== "" ||
    proof.receiptCount !== 1 ||
    !String(proof.receiptStatusText ?? "")
      .toLowerCase()
      .includes("reject gamealreadycompleted")
  ) {
    throwCompletedScenarioAssertionError({
      message: `core-loop admin proof missing stale completed-game ${scenario.commandKind} recovery`,
      evidence: proof,
      includeEvidenceInError,
    });
  }
  if (scenario.commandKind === "SubmitVote") {
    if (
      proof.setupSnapshotCommandState?.voteTargets?.[0]?.kind !== "no_lynch" ||
      proof.command.target !== "NoLynch"
    ) {
      throwCompletedScenarioAssertionError({
        message: "core-loop admin proof missing stale completed-game vote command",
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
  if (scenario.commandKind === "SubmitPost") {
    if (
      proof.command.channel_id !== "main" ||
      proof.command.body !== scenario.postBody ||
      proof.stalePostBody !== scenario.postBody
    ) {
      throwCompletedScenarioAssertionError({
        message: "core-loop admin proof missing stale completed-game post command",
        evidence: proof,
        includeEvidenceInError,
      });
    }
  }
}

function throwCompletedScenarioAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function sameStringArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
