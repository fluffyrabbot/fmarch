import {
  completedGameStaleRecoverySpineLaneCase as sharedCompletedGameStaleRecoverySpineLaneCase,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
} from "./dev_test_game_core_loop_completed_game_shared_recovery_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
});

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

export {
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_recovery_scenario_cases.mjs";

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

export function completedHostStaleCommandHardeningLaneCases() {
  return completedGameHardeningLaneCasesFor({
    proofGroups: "stale-host-complete",
  });
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
  return sharedCompletedGameStaleRecoverySpineLaneCase();
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
