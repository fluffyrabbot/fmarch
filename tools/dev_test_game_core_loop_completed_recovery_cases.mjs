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

export const completedGameHardeningLaneCaseDefinitions = Object.freeze([
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
  return completedGameHardeningLaneCaseDefinitions.map(cloneScenarioCase);
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
