import {
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedHostStaleCommandCases,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";

export {
  assertCompletedGameEndgameTransition,
  assertCompletedPlayerReloadCases,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameTransition,
  completedGameEndgameTransitionTokens,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandProofArgs,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadCommandState,
  completedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadHardeningLaneCases,
  completedPlayerReloadProofCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandHardeningLaneCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";

const cloneScenarioCase = (scenario) => ({ ...scenario });
const cloneRaceCoverageCell = (cell) => ({
  ...cell,
  roleSurfaces: [...cell.roleSurfaces],
});

export const completedGameHardeningSpineCycleId =
  "hardening-completed-game";

const completedGameEndgameFeatureRowDefinitions = Object.freeze([
  Object.freeze({
    targetKey: "completedGameHostComplete",
    featureSlotId: "completed-game-host-complete",
    role: "host",
    checkpointId: "n05-complete-game",
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "completedGameHostReload",
    featureSlotId: "completed-game-host-reload",
    role: "host",
    checkpointId: "n05-completed-host-reload",
    adminCheckId: "core-loop",
  }),
  Object.freeze({
    targetKey: "completedGamePlayerSurface",
    featureSlotId: "completed-game-player-surface",
    role: "actionPlayer",
    checkpointId: "n05-completed-player-surface",
    adminCheckId: "core-loop",
  }),
]);

const cloneFeatureRow = (row) => ({ ...row });

export function completedGameEndgameFeatureSpineRows({ cycleId }) {
  return completedGameEndgameFeatureRowDefinitions.map((scenario) =>
    cloneFeatureRow(featureRowFromCompletedGameEndgameCase(scenario, { cycleId })),
  );
}

export function completedGameStaleCommandFeatureSpineRows({ cycleId }) {
  return [
    ...completedHostStaleCommandCases().map((scenario) =>
      completedGameStaleCommandFeatureSpineRow({
        cycleId,
        proofField: scenario.proofField,
        role: "host",
        rowId: `completed-game-host-stale-${completedGameHostCommandSlug(
          scenario.commandId,
        )}-reject`,
      }),
    ),
    ...staleCompletedGamePlayerCommandCases().map((scenario) =>
      completedGameStaleCommandFeatureSpineRow({
        cycleId,
        proofField: scenario.proofField,
        role: "actionPlayer",
        rowId: `completed-game-stale-player-${completedGameCommandKindSlug(
          scenario.commandKind,
        )}-reject`,
      }),
    ),
  ];
}

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

function completedGameStaleCommandFeatureSpineRow({
  cycleId,
  proofField,
  role,
  rowId,
}) {
  return {
    targetKey: completedGameStaleCommandTargetKey(proofField),
    featureSlotId: rowId,
    cycleId,
    role,
    roleUrlId: rowId,
    checkpointId: rowId,
    adminCheckId: "completed-game-hardening-coverage",
    proofField,
  };
}

function completedGameStaleCommandTargetKey(proofField) {
  const stem = String(proofField ?? "").replace(/RecoveryProof$/, "");
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}

function completedGameHostCommandSlug(commandId) {
  return String(commandId ?? "")
    .replace(/^completed-host-stale-/, "")
    .replaceAll("_", "-");
}

function completedGameCommandKindSlug(commandKind) {
  return String(commandKind ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase();
}

function featureRowFromCompletedGameEndgameCase(scenario, { cycleId }) {
  return {
    targetKey: scenario.targetKey,
    featureSlotId: scenario.featureSlotId,
    cycleId,
    role: scenario.role,
    checkpointId: `${cycleId}-${scenario.checkpointId}`,
    adminCheckId: scenario.adminCheckId,
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
      proofSteps: "reject",
    }).map((scenario) => ({ ...scenario, role: "host" })),
    ...completedGameHardeningLaneCasesFor({
      proofGroups: "stale-host-complete",
      proofSteps: ["reload", "reconnect"],
    }).map((scenario) => ({ ...scenario, role: "host" })),
    ...completedGameHardeningLaneCasesFor({
      proofGroups: "stale-player-complete",
      proofSteps: "reject",
    }).map((scenario) => ({ ...scenario, role: "player" })),
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

export function completedGameHardeningSpineTargetCases() {
  const laneCasesById = new Map(
    completedGameHardeningSpineLaneCases().map((scenario) => [
      scenario.id,
      scenario,
    ]),
  );
  return [
    completedGameHardeningSpineTargetCase({
      laneCasesById,
      laneId: "stale-host-complete",
      targetKey: "completedGameStaleHostReject",
      featureSlotId: "completed-game-stale-host-reject",
    }),
    completedGameHardeningSpineTargetCase({
      laneCasesById,
      laneId: "stale-host-complete-reload",
      targetKey: "completedGameStaleRecovery",
      featureSlotId: "completed-game-stale-recovery",
    }),
    completedGameHardeningSpineTargetCase({
      laneCasesById,
      laneId: "stale-host-complete-reconnect-recovery",
      targetKey: "completedGameStaleReconnectRecovery",
      featureSlotId: "completed-game-stale-reconnect-recovery",
    }),
    completedGameHardeningSpineTargetCase({
      laneCasesById,
      laneId: "stale-player-complete",
      targetKey: "completedGameStalePlayerReject",
      featureSlotId: "completed-game-stale-player-reject",
    }),
    completedGameHardeningSpineTargetCase({
      laneCasesById,
      laneId: "stale-player-complete-reload",
      targetKey: "completedGameStalePlayerReloadRecovery",
      featureSlotId: "completed-game-stale-player-reload-recovery",
    }),
  ];
}

function completedGameHardeningSpineTargetCase({
  laneCasesById,
  laneId,
  targetKey,
  featureSlotId,
}) {
  const lane = laneCasesById.get(laneId);
  if (lane === undefined) {
    throw new Error(`completed-game hardening spine target drifted: ${laneId}`);
  }
  return {
    targetKey,
    featureSlotId,
    roleUrlId: lane.id,
    checkpointId: lane.id,
    adminCheckId: lane.id,
    cycleId: completedGameHardeningSpineCycleId,
    role: lane.role,
  };
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
