const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
});

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
  Object.freeze({
    id: "stale-host-complete",
    label: "Stale complete-game reveal rejects after live completion",
    family: "completed-host-stale-command",
    seedGroup: "demo-only",
  }),
  Object.freeze({
    id: "stale-host-complete-reload",
    label: "Stale host complete recovery reloads revealed console",
    family: "completed-host-stale-command",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "stale-host-complete-reconnect-recovery",
    label: "Stale host complete recovery reconnects revealed console",
    family: "completed-host-stale-command",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "concurrent-host-complete-race",
    label: "Concurrent complete-game commands converge",
    family: "completed-host-race",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "concurrent-host-complete-race-reload",
    label: "Concurrent complete-game race reloads revealed host consoles",
    family: "completed-host-race",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "concurrent-player-complete-race",
    label: "Concurrent player command and completion converge",
    family: "completed-player-stale-command",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "public-player-complete-reload",
    label: "Public player board reloads completed game truth",
    family: "completed-player-reload",
    seedGroup: "required",
  }),
  Object.freeze({
    id: "stale-player-complete",
    label: "Stale player command rejects after live completion",
    family: "completed-player-stale-command",
    seedGroup: "demo-only",
  }),
  Object.freeze({
    id: "stale-player-complete-reload",
    label: "Stale public player complete recovery reloads completed board",
    family: "completed-player-reload",
    seedGroup: "required",
  }),
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
} = {}) {
  const familySet =
    families === undefined ? null : new Set([families].flat());
  const seedGroupSet =
    seedGroups === undefined ? null : new Set([seedGroups].flat());
  return completedGameHardeningLaneCases()
    .filter(
      (scenario) =>
        (familySet === null || familySet.has(scenario.family)) &&
        (seedGroupSet === null || seedGroupSet.has(scenario.seedGroup)),
    )
    .map((scenario) => scenario.id);
}

export function completedHostStaleCommandHardeningLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-host-stale-command",
  });
}

export function completedHostRaceHardeningLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-host-race",
  });
}

export function completedHostStaleCommandSeedRecoveryLaneIds() {
  return completedGameHardeningLaneIdsFor({
    families: "completed-host-stale-command",
    seedGroups: "required",
  });
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

export const completedGameRaceCoverageCellDefinitions = Object.freeze([
  Object.freeze({
    id: "host-complete-game",
    actorPair: "host vs host",
    commandFamily: "complete game",
    raceLaneId: "concurrent-host-complete-race",
    reloadLaneId: "concurrent-host-complete-race-reload",
    roleSurfaces: Object.freeze(["host", "player"]),
    promotedReloadGroupId: "host-concurrent-race-reload",
  }),
  Object.freeze({
    id: "player-vs-completed-game",
    actorPair: "player vs host",
    commandFamily: "post-completion recovery",
    raceLaneId: "concurrent-player-complete-race",
    reloadLaneId: "public-player-complete-reload",
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
