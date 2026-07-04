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
const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
});
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
  return freezeScenarioCases(staleCompletedGamePlayerCommandCaseDefinitions);
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

export const completedGameHardeningSpineCycleId =
  "hardening-completed-game";

export function completedGameRecoveryFeatureSpineRow({ cycleId }) {
  return {
    targetKey: "completedGameRecovery",
    featureSlotId: "completed-game-recovery",
    cycleId,
    role: "host",
    checkpointId: `${cycleId}-d02-resolved-target-killed`,
    adminCheckId: "completed-game-hardening-coverage",
  };
}

export const completedGameHardeningLaneCaseDefinitions = Object.freeze([
  ...completedHostStaleCommandHardeningLaneCaseDefinitions(),
  Object.freeze({
    id: "concurrent-host-complete-race",
    label: "Concurrent complete-game commands converge",
    family: "completed-host-race",
    seedGroup: "required",
    proofGroup: "host-complete-race",
    proofStep: "race",
  }),
  Object.freeze({
    id: "concurrent-host-complete-race-reload",
    label: "Concurrent complete-game race reloads revealed host consoles",
    family: "completed-host-race",
    seedGroup: "required",
    proofGroup: "host-complete-race",
    proofStep: "reload",
  }),
  Object.freeze({
    id: "concurrent-player-complete-race",
    label: "Concurrent player command and completion converge",
    family: "completed-player-stale-command",
    seedGroup: "required",
    proofGroup: "player-complete-race",
    proofStep: "race",
  }),
  ...completedPlayerReloadHardeningLaneCaseDefinitions().filter(
    (scenario) => scenario.proofGroup === "player-complete-race",
  ),
  ...staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions(),
  ...completedPlayerReloadHardeningLaneCaseDefinitions().filter(
    (scenario) => scenario.proofGroup === "stale-player-complete",
  ),
]);

export function completedGameHardeningLaneCases() {
  return completedGameHardeningLaneCaseDefinitions.map(cloneScenarioCase);
}

export function completedGameHardeningLaneCase(id) {
  const scenario = completedGameHardeningLaneCaseDefinitions.find(
    (candidate) => candidate.id === id,
  );
  if (scenario === undefined) {
    throw new Error(`unknown completed-game hardening lane: ${id}`);
  }
  return cloneScenarioCase(scenario);
}

export function completedGameHardeningLaneIds() {
  return completedGameHardeningLaneCases().map((scenario) => scenario.id);
}

export function completedGameHardeningLaneIdsFor({
  families,
  seedGroups,
  proofGroups,
  proofSteps,
} = {}) {
  return completedGameHardeningLaneCasesFor({
    families,
    seedGroups,
    proofGroups,
    proofSteps,
  }).map((scenario) => scenario.id);
}

export function completedGameHardeningLaneCasesFor({
  families,
  seedGroups,
  proofGroups,
  proofSteps,
} = {}) {
  const familySet =
    families === undefined ? null : new Set([families].flat());
  const seedGroupSet =
    seedGroups === undefined ? null : new Set([seedGroups].flat());
  const proofGroupSet =
    proofGroups === undefined ? null : new Set([proofGroups].flat());
  const proofStepSet =
    proofSteps === undefined ? null : new Set([proofSteps].flat());
  return completedGameHardeningLaneCases()
    .filter(
      (scenario) =>
        (familySet === null || familySet.has(scenario.family)) &&
        (seedGroupSet === null || seedGroupSet.has(scenario.seedGroup)) &&
        (proofGroupSet === null || proofGroupSet.has(scenario.proofGroup)) &&
        (proofStepSet === null || proofStepSet.has(scenario.proofStep)),
    );
}

export function completedHostStaleCommandHardeningLaneIds() {
  return completedHostStaleCommandHardeningLaneCases().map(
    (scenario) => scenario.id,
  );
}

export function completedHostRaceHardeningLaneIds() {
  return completedHostCompleteRaceHardeningLaneCases().map(
    (scenario) => scenario.id,
  );
}

export function completedHostCompleteRaceHardeningLaneCases() {
  return completedGameHardeningLaneCasesFor({
    proofGroups: "host-complete-race",
  });
}

export function completedHostStaleCommandSeedRecoveryLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-host-stale-command",
    seedGroups: "required",
  });
}

export function completedGameHardeningSpineLaneCases() {
  return [
    ...completedGameHardeningLaneCasesFor({
      proofGroups: "stale-host-complete",
      proofSteps: ["reload", "reconnect"],
    }).map((scenario) => ({ ...scenario, role: "host" })),
    ...completedGameHardeningLaneCasesFor({
      proofGroups: "stale-player-complete",
      proofSteps: "reload",
    }).map((scenario) => ({ ...scenario, role: "player" })),
  ];
}

export function completedGameStaleRecoverySpineLaneCase() {
  const cases = completedHostStaleCommandHardeningLaneCases().filter(
    (scenario) =>
      scenario.proofGroup === "stale-host-complete" &&
      scenario.proofStep === "reload",
  );
  if (cases.length !== 1) {
    throw new Error("completed-game stale recovery shared lane drifted");
  }
  return { ...cases[0], role: "host" };
}

export function completedHostSeedDemoOnlyScenarioIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-host-stale-command",
    seedGroups: "demo-only",
  });
}

export function completedPlayerRecoveryLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: [
      "completed-player-stale-command",
      "completed-player-reload",
    ],
  });
}

export function completedPlayerHardeningReloadLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-player-reload",
  });
}

export function completedPlayerCompleteRaceHardeningLaneCases() {
  return completedGameHardeningLaneCasesFor({
    proofGroups: "player-complete-race",
  });
}

export function completedStalePlayerCompleteHardeningLaneCases() {
  return completedGameHardeningLaneCasesFor({
    proofGroups: "stale-player-complete",
  });
}

export function completedPlayerSeedRequiredScenarioIds() {
  return completedGameHardeningLaneIdsFor({
    families: [
      "completed-player-stale-command",
      "completed-player-reload",
    ],
    seedGroups: "required",
  });
}

export function completedPlayerSeedDemoOnlyScenarioIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-player-stale-command",
    seedGroups: "demo-only",
  });
}

export function completedGameSeedRequiredScenarioIds() {
  return completedGameHardeningLaneIdsFor({ seedGroups: "required" });
}

export function completedGameSeedDemoOnlyScenarioIds() {
  return completedGameHardeningLaneIdsFor({ seedGroups: "demo-only" });
}

function completedGameHardeningLaneIdFor({ proofGroup, proofStep }) {
  const cases = completedGameHardeningLaneCasesFor({
    proofGroups: proofGroup,
    proofSteps: proofStep,
  });
  if (cases.length !== 1) {
    throw new Error(
      `expected one completed-game hardening lane for ${proofGroup}:${proofStep}`,
    );
  }
  return cases[0].id;
}

export const completedGameRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "host-complete-game",
    actorPair: "host vs host",
    commandFamily: "complete game",
    proofGroup: "host-complete-race",
    raceLaneId: completedGameHardeningLaneIdFor({
      proofGroup: "host-complete-race",
      proofStep: "race",
    }),
    reloadLaneId: completedGameHardeningLaneIdFor({
      proofGroup: "host-complete-race",
      proofStep: "reload",
    }),
    roleSurfaces: Object.freeze(["host", "player"]),
    promotedReloadGroupId: "host-concurrent-race-reload",
  }),
  Object.freeze({
    id: "player-vs-completed-game",
    actorPair: "player vs host",
    commandFamily: "post-completion recovery",
    proofGroup: "player-complete-race",
    raceLaneId: completedGameHardeningLaneIdFor({
      proofGroup: "player-complete-race",
      proofStep: "race",
    }),
    reloadLaneId: completedGameHardeningLaneIdFor({
      proofGroup: "player-complete-race",
      proofStep: "reload",
    }),
    roleSurfaces: Object.freeze(["player", "host"]),
    promotedReloadGroupId: "player-concurrent-action-reload",
  }),
]);

export function completedGameRaceCoverageCellCases() {
  return completedGameRaceCoverageCellDefinitions.map(cloneRaceCoverageCell);
}

export function completedGameRaceCoverageCellIds() {
  return completedGameRaceCoverageCellCases().map((cell) => cell.id);
}

export function completedGameRaceCoverageCellIdsForPromotedGroup(groupId) {
  return completedGameRaceCoverageCellCases()
    .filter((cell) => cell.promotedReloadGroupId === groupId)
    .map((cell) => cell.id);
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
  scenarioFamilies = completedGameEndgameScenarioCaseFamilies(),
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
      cases: scenarioFamilies.completedPlayerReloadCases,
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
      scenarioFamilies,
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

export const completedGameProofReadinessCaseGroupDefinitions =
  completedGameEndgameScenarioCaseFamilyDefinitions;

export const completedGameProofReadinessCaseGroupIds =
  completedGameEndgameScenarioCaseFamilyIds;

export function completedGameProofReadinessScenarioFamilies() {
  return completedGameEndgameScenarioCaseFamilies();
}

export function completedGameProofReadinessCaseGroups({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return Object.freeze(
    Object.fromEntries(
      completedGameEndgameScenarioCaseFamilyEntries({ scenarioFamilies }),
    ),
  );
}

export function completedGameProofReadinessProofScenarioCases({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
  ...proofArgs
}) {
  return completedGameEndgameProofScenarioCases({
    ...proofArgs,
    scenarioFamilies,
  });
}

export function completedGameProofReadinessTransition({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return completedGameEndgameTransition({ scenarioFamilies });
}

export function completedGameProofReadinessScenarioFamily({
  scenarioFamilies = completedGameProofReadinessScenarioFamilies(),
} = {}) {
  return {
    id: "core-loop-completed-endgame-progression",
    transitionTokens: completedGameEndgameTransitionTokens({
      scenarioFamilies,
    }),
    staleRejects: {
      completedHostStaleCommands: [
        ...scenarioFamilies.completedHostStaleCommandCases,
      ],
      completedDeadPlayerStaleVote:
        scenarioFamilies.completedDeadPlayerStaleVoteCase,
      staleCompletedGamePlayerCommands: [
        ...scenarioFamilies.staleCompletedGamePlayerCommandCases,
      ],
    },
    reloads: {
      completedPlayers: [...scenarioFamilies.completedPlayerReloadCases],
    },
  };
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
