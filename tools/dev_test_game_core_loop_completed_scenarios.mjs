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

export function completedGameEndgameTransitionTokens() {
  return [
    "host:N05:complete_game:ack:921",
    "host:reload:complete",
    ...completedHostStaleCommandCases().map(
      (scenario) => scenario.transitionToken,
    ),
    "actionPlayer:endgame:complete",
    ...completedPlayerReloadCases().map((scenario) => scenario.transitionToken),
    "deadPlayer:stale_submit_vote:reject:GameAlreadyCompleted",
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
      proof:
        completedGameEndgameSurface.completedDeadPlayerStaleVoteRecoveryProof,
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
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

export function assertCompletedStaleRejectCases(cases) {
  for (const { assertProof, ...scenario } of cases) {
    assertProof(scenario);
  }
}
