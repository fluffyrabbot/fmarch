import {
  hostAdvancePhaseCommandFacts,
  hostCompleteGameCommandFacts,
  hostResolvePhaseCommandFacts,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const freezeScenarioCase = (scenario) =>
  Object.freeze(cloneScenarioCase(scenario));
const freezeScenarioCases = (scenarios) =>
  Object.freeze(scenarios.map(freezeScenarioCase));
const freezeLaneCase = (scenario) => Object.freeze(cloneScenarioCase(scenario));
const freezeLaneCases = (scenarios) =>
  Object.freeze(scenarios.map(freezeLaneCase));

export const completedHostStaleCommandCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "completedHostStaleResolveRecoveryProof",
    commandId: "completed-host-stale-resolve",
    ...hostResolvePhaseCommandFacts(),
    transitionToken: "host:stale_resolve_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale ResolvePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleAdvanceRecoveryProof",
    commandId: "completed-host-stale-advance",
    ...hostAdvancePhaseCommandFacts(),
    transitionToken: "host:stale_advance_phase:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale AdvancePhase rejected into completed host controls.",
  }),
  Object.freeze({
    proofField: "completedHostStaleCompleteRecoveryProof",
    commandId: "completed-host-stale-complete",
    ...hostCompleteGameCommandFacts(),
    transitionToken: "host:stale_complete_game:reject:GameAlreadyCompleted",
    boundary:
      "Seeded browser completed host stale CompleteGame rejected into completed host controls.",
  }),
]);

export function completedHostStaleCommandCases() {
  return freezeScenarioCases(completedHostStaleCommandCaseDefinitions);
}

function completedHostStaleCompleteCommandCaseDefinition() {
  const scenario = completedHostStaleCommandCaseDefinitions.find(
    (candidate) => candidate.commandKind === "CompleteGame",
  );
  if (scenario === undefined) {
    throw new Error("completed host stale CompleteGame scenario is missing");
  }
  return scenario;
}

export function completedHostStaleCommandHardeningLaneCaseDefinitions() {
  completedHostStaleCompleteCommandCaseDefinition();
  return freezeLaneCases([
    {
      id: "stale-host-complete",
      label: "Stale complete-game reveal rejects after live completion",
      family: "completed-host-stale-command",
      seedGroup: "demo-only",
      proofGroup: "stale-host-complete",
      proofStep: "reject",
    },
    {
      id: "stale-host-complete-reload",
      label: "Stale host complete recovery reloads revealed console",
      family: "completed-host-stale-command",
      seedGroup: "required",
      proofGroup: "stale-host-complete",
      proofStep: "reload",
    },
    {
      id: "stale-host-complete-reconnect-recovery",
      label: "Stale host complete recovery reconnects revealed console",
      family: "completed-host-stale-command",
      seedGroup: "required",
      proofGroup: "stale-host-complete",
      proofStep: "reconnect",
    },
  ]);
}

export function completedHostStaleCommandHardeningLaneCases() {
  return completedHostStaleCommandHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
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
  return freezeScenarioCases(completedPlayerReloadCaseDefinitions);
}

export function completedPlayerReloadHardeningLaneCaseDefinitions() {
  if (completedPlayerReloadCaseDefinitions.length === 0) {
    throw new Error("completed player reload scenarios are missing");
  }
  return freezeLaneCases([
    {
      id: "public-player-complete-reload",
      label: "Public player board reloads completed game truth",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "player-complete-race",
      proofStep: "reload",
    },
    {
      id: "stale-player-complete-reload",
      label: "Stale public player complete recovery reloads completed board",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "stale-player-complete",
      proofStep: "reload",
    },
    {
      id: "stale-player-complete-endgame-resync",
      label: "Completed player endgame summary survives live resync",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "stale-player-complete",
      proofStep: "resync",
    },
    {
      id: "stale-player-complete-vote-history",
      label: "Completed player endgame reveals durable vote history",
      family: "completed-player-reload",
      seedGroup: "required",
      proofGroup: "stale-player-complete",
      proofStep: "vote-history",
    },
  ]);
}

export function completedPlayerReloadHardeningLaneCases() {
  return completedPlayerReloadHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
}

export const staleCompletedGamePlayerCommandCaseDefinitions = Object.freeze([
  Object.freeze({
    proofField: "staleCompletedVoteRecoveryProof",
    transitionToken: "stale:D05:submit_vote:reject:GameAlreadyCompleted",
    clickedAction: "submit_vote:no_lynch",
    commandKind: "SubmitVote",
    commandSelector: "SubmitVote",
    commandButtonSelector:
      '[data-testid="player-quick-vote-actions"] button[data-action="submit_vote:no_lynch"]',
    setupReadySelector:
      '[data-testid="player-quick-vote-actions"] button[data-action="submit_vote:no_lynch"]',
    rejectedBoundary:
      "Seeded browser GameAlreadyCompleted stale D05 vote refreshed into completed endgame controls.",
    staleBoundary:
      "Seeded browser stale completed-game vote proof opened with old Day 5 no-lynch controls.",
    expectedRefreshKeys: ["votecount", "commandState", "endgameSummary"],
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
      "endgameSummary",
    ],
  }),
]);

export function staleCompletedGamePlayerCommandCases() {
  return freezeScenarioCases(staleCompletedGamePlayerCommandCaseDefinitions);
}

export function completedPlayerEndgameRefreshScenario() {
  const staleVote = staleCompletedGamePlayerCommandCaseDefinitions.find(
    (scenario) => scenario.commandKind === "SubmitVote",
  );
  if (staleVote === undefined) {
    throw new Error("completed player endgame refresh scenario is missing");
  }
  return freezeScenarioCase({
    ...staleVote,
    expectedResyncKey: "endgameSummary",
    expectedSummaryState: "revealed",
    expectedRevealSlot: "slot-7",
    expectedRoleKey: "godfather",
    expectedAlignment: "mafia",
    expectedVoteHistoryPhaseId: "D01",
    expectedVoteHistoryStatus: "NoLynch",
    expectedVoteHistoryTarget: "no_lynch",
    expectedVoteHistoryCount: 2,
    expectedVoteHistoryActors: ["slot-2", "slot-3"],
  });
}

export function assertCompletedPlayerEndgameRefreshBrowserProof({
  proof,
  scenario = completedPlayerEndgameRefreshScenario(),
  includeEvidenceInError = false,
}) {
  const summaries = [
    proof?.endgameSummaryAfterReject,
    proof?.manualEndgameResync?.snapshotEndgameSummary,
    proof?.stalePublicReloadAfterReject?.recoveredEndgameSummary,
  ];
  const surfaces = [
    proof?.endgameSurfaceAfterReject,
    proof?.manualEndgameResync?.surface,
    proof?.stalePublicReloadAfterReject?.endgameSurface,
  ];
  const summariesMatch = summaries.every((summary) => {
    const slot = summary?.slots?.find(
      (candidate) => candidate.slotId === scenario.expectedRevealSlot,
    );
    const voteHistory = summary?.voteHistory?.find(
      (outcome) => outcome.phaseId === scenario.expectedVoteHistoryPhaseId,
    );
    return (
      summary?.completed === true &&
      slot?.roleKey === scenario.expectedRoleKey &&
      slot?.alignment === scenario.expectedAlignment &&
      slot?.roleRevealed === true &&
      slot?.alignmentRevealed === true &&
      voteHistory?.status === scenario.expectedVoteHistoryStatus &&
      voteHistory?.tallies?.[scenario.expectedVoteHistoryTarget] ===
        scenario.expectedVoteHistoryCount &&
      scenario.expectedVoteHistoryActors.every(
        (actor) =>
          voteHistory?.votes?.[actor] === scenario.expectedVoteHistoryTarget,
      )
    );
  });
  const surfacesMatch = surfaces.every(
    (surface) =>
      surface?.state === scenario.expectedSummaryState &&
      surface.revealRows?.some(
        (row) =>
          row.testId === `player-endgame-reveal-${scenario.expectedRevealSlot}` &&
          row.text.includes("Godfather") &&
          row.text.includes("Mafia"),
      ) &&
      surface.voteRows?.some(
        (row) =>
          row.testId?.startsWith(
            `player-endgame-vote-${scenario.expectedVoteHistoryPhaseId}-`,
          ) &&
          row.text.includes("No lynch") &&
          row.text.includes("Slot 2 to No lynch") &&
          row.text.includes("Slot 3 to No lynch"),
      ),
  );
  const apiSlot = proof?.apiEndgameSummaryAfterReject?.slots?.find(
    (slot) => slot.slot_id === scenario.expectedRevealSlot,
  );
  const apiVoteHistory = proof?.apiEndgameSummaryAfterReject?.vote_history?.find(
    (outcome) => outcome.phase_id === scenario.expectedVoteHistoryPhaseId,
  );
  if (
    !sameOrderedValues(
      proof?.dispatchPlan?.projectionRefreshKeys,
      scenario.expectedRefreshKeys,
    ) ||
    proof?.coldLoadEndpointsAfterReject?.endgameSummaryEndpoint !==
      `/games/${proof?.game}/endgame-summary` ||
    !proof?.resyncKeysAfterReject?.includes(scenario.expectedResyncKey) ||
    proof?.manualEndgameResync?.fromSeq !== 0 ||
    !summariesMatch ||
    !surfacesMatch ||
    proof?.apiEndgameSummaryAfterReject?.completed !== true ||
    apiSlot?.role_key !== scenario.expectedRoleKey ||
    apiSlot?.alignment !== scenario.expectedAlignment ||
    apiSlot?.role_revealed !== true ||
    apiSlot?.alignment_revealed !== true ||
    apiVoteHistory?.status !== scenario.expectedVoteHistoryStatus ||
    apiVoteHistory?.tallies?.[scenario.expectedVoteHistoryTarget] !==
      scenario.expectedVoteHistoryCount ||
    !scenario.expectedVoteHistoryActors.every(
      (actor) => apiVoteHistory?.votes?.[actor] === scenario.expectedVoteHistoryTarget,
    )
  ) {
    const suffix = includeEvidenceInError ? `: ${JSON.stringify(proof)}` : "";
    throw new Error(`completed player endgame refresh proof drifted${suffix}`);
  }
}

export function staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions() {
  if (staleCompletedGamePlayerCommandCaseDefinitions.length === 0) {
    throw new Error("stale completed-game player command scenarios are missing");
  }
  return freezeLaneCases([
    {
      id: "stale-player-complete",
      label: "Stale player command rejects after live completion",
      family: "completed-player-stale-command",
      seedGroup: "demo-only",
      proofGroup: "stale-player-complete",
      proofStep: "reject",
    },
  ]);
}

export function staleCompletedGamePlayerCommandHardeningLaneCases() {
  return staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions().map(
    cloneScenarioCase,
  );
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
  return freezeScenarioCase(completedDeadPlayerStaleVoteCaseDefinition);
}

export function completedGameEndgameScenarioCaseFamilies({
  hostStaleCommandCases = completedHostStaleCommandCases(),
  playerReloadCases = completedPlayerReloadCases(),
  deadPlayerStaleVoteCase = completedDeadPlayerStaleVoteCase(),
  playerStaleCommandCases = staleCompletedGamePlayerCommandCases(),
} = {}) {
  return Object.freeze({
    completedHostStaleCommandCases: freezeScenarioCases(hostStaleCommandCases),
    completedPlayerReloadCases: freezeScenarioCases(playerReloadCases),
    completedDeadPlayerStaleVoteCase: freezeScenarioCase(
      deadPlayerStaleVoteCase,
    ),
    staleCompletedGamePlayerCommandCases: freezeScenarioCases(
      playerStaleCommandCases,
    ),
  });
}

export const completedGameEndgameScenarioCaseFamilyDefinitions = Object.freeze([
  Object.freeze({
    id: "completedHostStaleCommandCases",
    label: "Completed host stale commands",
    role: "host",
    recoveryKind: "stale-command",
  }),
  Object.freeze({
    id: "completedPlayerReloadCases",
    label: "Completed player reloads",
    role: "player",
    recoveryKind: "reload",
  }),
  Object.freeze({
    id: "staleCompletedGamePlayerCommandCases",
    label: "Stale completed-game player commands",
    role: "player",
    recoveryKind: "stale-command",
  }),
]);

export const completedGameEndgameScenarioCaseFamilyIds = Object.freeze(
  completedGameEndgameScenarioCaseFamilyDefinitions.map(({ id }) => id),
);

export function completedGameEndgameScenarioCaseFamilyEntries({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return completedGameEndgameScenarioCaseFamilyDefinitions.map(({ id }) => [
    id,
    Object.freeze([...scenarioFamilies[id]]),
  ]);
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

export function completedGameEndgameProofScenarioCases({
  actionPlayerRoleUrl,
  normalPlayerRoleUrl,
  deadPlayerRoleUrl,
  commandStateBuilders,
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
}) {
  return {
    completedHostStaleCommandCases:
      scenarioFamilies.completedHostStaleCommandCases,
    completedPlayerReloadCases: completedPlayerReloadProofCases({
      actionPlayerRoleUrl,
      normalPlayerRoleUrl,
      deadPlayerRoleUrl,
      commandStateBuilders,
      cases: scenarioFamilies.completedPlayerReloadCases,
    }),
    completedDeadPlayerStaleVoteCase:
      scenarioFamilies.completedDeadPlayerStaleVoteCase,
    staleCompletedGamePlayerCommandCases:
      scenarioFamilies.staleCompletedGamePlayerCommandCases,
  };
}

export function completedGameEndgameTransitionTokens({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return [
    "host:N05:complete_game:ack:921",
    "host:reload:complete",
    ...scenarioFamilies.completedHostStaleCommandCases.map(
      (scenario) => scenario.transitionToken,
    ),
    "actionPlayer:endgame:complete",
    ...scenarioFamilies.completedPlayerReloadCases.map(
      (scenario) => scenario.transitionToken,
    ),
    scenarioFamilies.completedDeadPlayerStaleVoteCase.transitionToken,
    ...scenarioFamilies.staleCompletedGamePlayerCommandCases.map(
      (scenario) => scenario.transitionToken,
    ),
  ];
}

export function completedGameEndgameTransition({
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
} = {}) {
  return completedGameEndgameTransitionTokens({ scenarioFamilies }).join(" -> ");
}

export function assertCompletedGameEndgameTransition({
  transition,
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
  failureMessage = "completed-game endgame transition missing shared scenario tokens",
}) {
  const transitionText = String(transition ?? "");
  const missingTokens = completedGameEndgameTransitionTokens({
    scenarioFamilies,
  }).filter((token) => !transitionText.includes(token));
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
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
}) {
  return [
    ...completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceHostRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof,
      cases: scenarioFamilies.completedHostStaleCommandCases,
    }),
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame,
      sourceRoleUrl: sourceDeadPlayerRoleUrl,
      assertCompletedDeadPlayerStaleVoteRecoveryProof,
      scenario: scenarioFamilies.completedDeadPlayerStaleVoteCase,
    }),
    ...staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame,
      sourceActionPlayerRoleUrl,
      assertStaleCompletedGamePlayerCommandRecoveryProof,
      cases: scenarioFamilies.staleCompletedGamePlayerCommandCases,
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

function sameOrderedValues(actual, expected) {
  return (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}
