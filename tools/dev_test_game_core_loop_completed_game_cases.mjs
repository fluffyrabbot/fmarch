const cloneScenarioCase = (scenario) => ({ ...scenario });

export const completedHostStaleCommandCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "completedHostStaleResolveRecoveryProof",
    commandKind: "ResolvePhase",
    commandId: "completed-host-stale-resolve",
    transitionToken: "host:stale_resolve_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale ResolvePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleAdvanceRecoveryProof",
    commandKind: "AdvancePhase",
    commandId: "completed-host-stale-advance",
    transitionToken: "host:stale_advance_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale AdvancePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleCompleteRecoveryProof",
    commandKind: "CompleteGame",
    commandId: "completed-host-stale-complete",
    transitionToken: "host:stale_complete_game:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale CompleteGame rejected into completed host controls.",
  }),
]);

export function completedHostStaleCommandCases() {
  return completedHostStaleCommandCaseDefinitions.map(cloneScenarioCase);
}

export const completedPlayerReloadCaseDefinitions = Object.freeze([
  Object.freeze({
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
  }),
  Object.freeze({
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
  }),
  Object.freeze({
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
  }),
]);

export function completedPlayerReloadCases() {
  return completedPlayerReloadCaseDefinitions.map(cloneScenarioCase);
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

export const staleCompletedGamePlayerCommandCaseDefinitions = Object.freeze([
  Object.freeze({
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
  }),
  Object.freeze({
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
  }),
]);

export function staleCompletedGamePlayerCommandCases() {
  return staleCompletedGamePlayerCommandCaseDefinitions.map(cloneScenarioCase);
}

export const completedDeadPlayerStaleVoteCaseDefinition = Object.freeze({
  proofField: "completedDeadPlayerStaleVoteRecoveryProof",
  transitionToken: "deadPlayer:stale_submit_vote:reject:GameAlreadyCompleted",
  commandKind: "SubmitVote",
  expectedSlot: "slot-2",
  principalUserId: "player_ilya",
  expectedBoundaryText: "completed dead-player stale vote rejected",
});

export function completedDeadPlayerStaleVoteCase() {
  return cloneScenarioCase(completedDeadPlayerStaleVoteCaseDefinition);
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
    ...completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
    }),
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
    }),
    ...staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceActionPlayerRoleUrl,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
    }),
  ];
}

export function completedHostStaleCommandAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceHostRoleUrl,
  assertCompletedHostStaleCommandRecoveryProof,
  cases = completedHostStaleCommandCases(),
}) {
  return cases.map((scenario) => ({
    assertProof: assertCompletedHostStaleCommandRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...completedHostStaleCommandProofArgs({
      expectedGame,
      sourceHostRoleUrl,
      scenario,
    }),
  }));
}

export function completedHostStaleCommandProofArgs({
  expectedGame,
  sourceHostRoleUrl,
  scenario,
}) {
  return {
    expectedGame,
    sourceRoleUrl: sourceHostRoleUrl,
    expectedCommandKind: scenario.commandKind,
  };
}

export function completedDeadPlayerStaleVoteAssertionCase({
  completedGameEndgameSurface,
  expectedGame,
  sourceRoleUrl,
  assertCompletedDeadPlayerStaleVoteRecoveryProof,
  scenario = completedDeadPlayerStaleVoteCase(),
}) {
  return {
    assertProof: assertCompletedDeadPlayerStaleVoteRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...completedDeadPlayerStaleVoteProofArgs({
      expectedGame,
      sourceRoleUrl,
      scenario,
    }),
  };
}

export function completedDeadPlayerStaleVoteProofArgs({
  expectedGame,
  sourceRoleUrl,
  scenario = completedDeadPlayerStaleVoteCase(),
}) {
  return {
    expectedGame,
    sourceRoleUrl,
    scenario,
  };
}

export function staleCompletedGamePlayerCommandAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
  sourceActionPlayerRoleUrl,
  assertStaleCompletedGamePlayerCommandRecoveryProof,
  cases = staleCompletedGamePlayerCommandCases(),
}) {
  return cases.map((scenario) => ({
    assertProof: assertStaleCompletedGamePlayerCommandRecoveryProof,
    proof: completedGameEndgameSurface[scenario.proofField],
    ...staleCompletedGamePlayerCommandProofArgs({
      expectedGame,
      sourceActionPlayerRoleUrl,
      scenario,
    }),
  }));
}

export function staleCompletedGamePlayerCommandProofArgs({
  expectedGame,
  sourceActionPlayerRoleUrl,
  scenario,
}) {
  return {
    expectedGame,
    sourceRoleUrl: sourceActionPlayerRoleUrl,
    scenario,
  };
}

export function completedActionPlayerSurfaceProofArgs({
  expectedGame,
  sourceRoleUrl,
}) {
  return {
    expectedGame,
    sourceRoleUrl,
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
  };
}

export function completedActionPlayerSurfaceAssertionCase({
  completedGameEndgameSurface,
  expectedGame,
  assertActionPlayerCompletedProof,
}) {
  return {
    assertProof: assertActionPlayerCompletedProof,
    proof: completedGameEndgameSurface.actionPlayerCompletedProof,
    ...completedActionPlayerSurfaceProofArgs({
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
    }),
  };
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
    completedActionPlayerSurfaceAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      assertActionPlayerCompletedProof,
    }),
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
