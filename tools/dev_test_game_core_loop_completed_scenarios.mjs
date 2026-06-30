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

export function completedPlayerReloadAssertionCases({
  completedGameEndgameSurface,
  expectedGame,
}) {
  return [
    {
      proof: completedGameEndgameSurface.completedPlayerReloadProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
      expectedSlot: "slot-7",
      expectedBoundaryText: "completed action-player role URL reloaded",
      principalUserId: "player_mira",
    },
    {
      proof: completedGameEndgameSurface.completedNormalPlayerReloadProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceNormalPlayerRoleUrl,
      expectedSlot: "slot-4",
      expectedBoundaryText: "completed normal-player role URL reloaded",
      principalUserId: "player_rowan",
    },
    {
      proof: completedGameEndgameSurface.completedDeadPlayerReloadProof,
      expectedGame,
      sourceRoleUrl: completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
      expectedSlot: "slot-2",
      expectedBoundaryText: "completed dead-player role URL reloaded",
      principalUserId: "player_ilya",
    },
  ];
}

export function staleCompletedGamePlayerCommandCases() {
  return [
    {
      proofField: "staleCompletedVoteRecoveryProof",
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
