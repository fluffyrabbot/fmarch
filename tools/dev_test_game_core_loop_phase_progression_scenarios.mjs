import {
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  emptyNightThreeHostTransitionProofCase,
} from "./dev_test_game_core_loop_host_phase_scenarios.mjs";
import {
  coreLoopVoteResolutionScenarioFamily,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";
import {
  coreLoopFeatureDemoOnlySeedScenarioIds,
  coreLoopFeaturePhaseProgressionLaneIds,
  coreLoopFeaturePhaseProgressionSpineSourceLaneIds,
  coreLoopFeatureRequiredSeedScenarioIds,
  coreLoopFeatureSeedAliasOnlyProofLaneIds,
  coreLoopFeatureSeedProofLaneAliasEntries,
  nightThreeActionResolutionLaneId as catalogNightThreeActionResolutionLaneId,
} from "./dev_test_game_feature_lane_catalog.mjs";

export const coreLoopPhaseProgressionFamilyId =
  "core-loop-phase-progression";
export const nightThreeActionResolutionLaneId =
  catalogNightThreeActionResolutionLaneId;

export const coreLoopPhaseProgressionLaneIds =
  coreLoopFeaturePhaseProgressionLaneIds;

export const coreLoopPhaseProgressionSpineSourceLaneIds =
  coreLoopFeaturePhaseProgressionSpineSourceLaneIds;

export const coreLoopPhaseProgressionRequiredSeedScenarioIds =
  coreLoopFeatureRequiredSeedScenarioIds;

export const coreLoopPhaseProgressionDemoOnlySeedScenarioIds =
  coreLoopFeatureDemoOnlySeedScenarioIds;

export const coreLoopPhaseProgressionAliasOnlyProofLaneIds =
  coreLoopFeatureSeedAliasOnlyProofLaneIds;

export const coreLoopPhaseProgressionSeedAliasEntries =
  coreLoopFeatureSeedProofLaneAliasEntries;

const coreLoopPhaseProgressionScenarioCaseDefinitions = Object.freeze([
  Object.freeze({
    key: "dayThreeVoteResolution",
    group: "surfaces",
    buildScenario: () =>
      coreLoopVoteResolutionScenarioFamily().surfaces.dayThreeVoteResolution,
  }),
  Object.freeze({
    key: "postDayThreeResolution",
    group: "surfaces",
    buildScenario: postDayThreeResolutionSurfaceCase,
  }),
  Object.freeze({
    key: "nightThreeEmptyResolution",
    group: "surfaces",
    buildScenario: nightThreeEmptyResolutionSurfaceCase,
  }),
  Object.freeze({
    key: "dayFourSurvivorRole",
    group: "surfaces",
    buildScenario: dayFourSurvivorRoleSurfaceCase,
  }),
  Object.freeze({
    key: "staleDayTwoVote",
    group: "staleRejects",
    buildScenario: staleDayTwoVoteAfterTransitionRecoveryScenario,
  }),
  Object.freeze({
    key: "staleNightOneAction",
    group: "staleRejects",
    buildScenario: staleNightOneActionAfterTransitionRecoveryScenario,
  }),
]);

const clonePhaseProgressionScenarioCase = (scenarioCase) => ({
  key: scenarioCase.key,
  group: scenarioCase.group,
  scenario: scenarioCase.buildScenario(),
});

export function coreLoopPhaseProgressionScenarioCases() {
  return coreLoopPhaseProgressionScenarioCaseDefinitions.map(
    clonePhaseProgressionScenarioCase,
  );
}

const clonePlayerObservationCase = (scenario) => ({ ...scenario });

const nightThreeEmptyResolutionSurfaceCaseDefinition = Object.freeze({
  transitionFragments: Object.freeze([
    "actionPlayer:N03:no_action",
    "resolve_phase:ack:910",
    "advance_phase:ack:911",
    "actionPlayer:D04:no_lynch_vote",
  ]),
  actionPlayerNoActionCase: Object.freeze({
    proofField: "actionPlayerNoActionProof",
    sourceRoleUrlField: "sourceActionPlayerRoleUrl",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "N03",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "opened N03 with no legal night action",
    expectedResyncFromSeq: 909,
  }),
  hostTransitionCase: Object.freeze(emptyNightThreeHostTransitionProofCase()),
  actionPlayerDayFourCase: Object.freeze({
    proofField: "actionPlayerDayFourProof",
    sourceRoleUrlField: "sourceActionPlayerRoleUrl",
    expectedSlot: "slot-7",
    slotField: "actionPlayerSlot",
    expectedPrincipalUserId: "player_mira",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "open D04 no-lynch voting",
    expectedResyncFromSeq: 911,
    expectedVoteButtonCount: 1,
    expectedVoteTargetCount: 1,
  }),
});

const dayFourSurvivorRoleSurfaceCaseDefinition = Object.freeze({
  survivorCase: Object.freeze({
    proofField: "survivorProof",
    sourceRoleUrlField: "sourceRoleUrl",
    expectedSlot: "slot-5",
    slotField: "survivorSlot",
    expectedPrincipalUserId: "player_sage",
    expectedPhaseId: "D04",
    expectedPhaseState: "open",
    expectedActorAlive: true,
    expectedActorStatus: "alive",
    expectedActionState: "disabled:no legal action available",
    expectedStatusText: "no legal action available",
    expectedPrivateCount: 0,
    expectedPrivateReceipt: false,
    expectedBoundaryText: "survivor role opened D04",
    expectedResyncFromSeq: 911,
    expectedVoteButtonCount: 2,
    expectedVoteTargetCount: 2,
  }),
});

export function nightThreeEmptyResolutionSurfaceCase() {
  const surfaceCase = nightThreeEmptyResolutionSurfaceCaseDefinition;
  return {
    transitionFragments: [...surfaceCase.transitionFragments],
    actionPlayerNoActionCase: clonePlayerObservationCase(
      surfaceCase.actionPlayerNoActionCase,
    ),
    hostTransitionCase: { ...surfaceCase.hostTransitionCase },
    actionPlayerDayFourCase: clonePlayerObservationCase(
      surfaceCase.actionPlayerDayFourCase,
    ),
  };
}

export function dayFourSurvivorRoleSurfaceCase() {
  return {
    survivorCase: clonePlayerObservationCase(
      dayFourSurvivorRoleSurfaceCaseDefinition.survivorCase,
    ),
  };
}

export function coreLoopPhaseProgressionScenarioFamily() {
  const scenarioCases = coreLoopPhaseProgressionScenarioCases();
  return {
    id: coreLoopPhaseProgressionFamilyId,
    laneIds: [...coreLoopPhaseProgressionLaneIds],
    spineSourceLaneIds: [...coreLoopPhaseProgressionSpineSourceLaneIds],
    seedScenarioIds: [
      ...coreLoopPhaseProgressionRequiredSeedScenarioIds,
      ...coreLoopPhaseProgressionDemoOnlySeedScenarioIds,
    ],
    surfaces: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.group === "surfaces")
        .map((scenarioCase) => [scenarioCase.key, scenarioCase.scenario]),
    ),
    staleRejects: Object.fromEntries(
      scenarioCases
        .filter((scenarioCase) => scenarioCase.group === "staleRejects")
        .map((scenarioCase) => [scenarioCase.key, scenarioCase.scenario]),
    ),
  };
}

export function assertNightThreeEmptyResolutionSurfaceCase({
  nightThreeEmptyResolutionSurface,
  assertPostDayThreePlayerSurfaceProof,
  assertNightThreeEmptyHostTransitionProof,
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromRoleUrl(
    nightThreeEmptyResolutionSurface?.sourceHostRoleUrl,
  );
  const surfaceCase = nightThreeEmptyResolutionSurfaceCaseDefinition;
  if (
    nightThreeEmptyResolutionSurface?.status !== "passed" ||
    nightThreeEmptyResolutionSurface.clickedThroughFromRoleUrl !== true ||
    nightThreeEmptyResolutionSurface.releaseReady !== false ||
    nightThreeEmptyResolutionSurface.productionReady !== false ||
    typeof nightThreeEmptyResolutionSurface.sourceHostRoleUrl !== "string" ||
    !nightThreeEmptyResolutionSurface.sourceHostRoleUrl.endsWith("/host") ||
    typeof nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl !==
      "string" ||
    !nightThreeEmptyResolutionSurface.sourceActionPlayerRoleUrl.includes("/g/") ||
    !surfaceCase.transitionFragments.every((fragment) =>
      String(nightThreeEmptyResolutionSurface.transition ?? "").includes(
        fragment,
      ),
    )
  ) {
    throwPhaseProgressionAssertionError({
      message: "core-loop admin proof missing empty Night 3 resolution surface",
      evidence: nightThreeEmptyResolutionSurface,
      includeEvidenceInError,
    });
  }
  assertPhaseProgressionPlayerObservation({
    surface: nightThreeEmptyResolutionSurface,
    playerCase: surfaceCase.actionPlayerNoActionCase,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError,
  });
  assertNightThreeEmptyHostTransitionProof({
    proof: nightThreeEmptyResolutionSurface.hostTransitionProof,
    expectedGame,
    sourceRoleUrl: nightThreeEmptyResolutionSurface.sourceHostRoleUrl,
    includeEvidenceInError,
  });
  assertPhaseProgressionPlayerObservation({
    surface: nightThreeEmptyResolutionSurface,
    playerCase: surfaceCase.actionPlayerDayFourCase,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError,
  });
}

export function assertDayFourSurvivorRoleSurfaceCase({
  dayFourSurvivorRoleSurface,
  assertPostDayThreePlayerSurfaceProof,
  includeEvidenceInError = false,
}) {
  const expectedGame = gameFromRoleUrl(dayFourSurvivorRoleSurface?.sourceRoleUrl);
  if (
    dayFourSurvivorRoleSurface?.status !== "passed" ||
    dayFourSurvivorRoleSurface.clickedThroughFromRoleUrl !== true ||
    dayFourSurvivorRoleSurface.releaseReady !== false ||
    dayFourSurvivorRoleSurface.productionReady !== false ||
    typeof dayFourSurvivorRoleSurface.sourceRoleUrl !== "string" ||
    !dayFourSurvivorRoleSurface.sourceRoleUrl.includes("/g/")
  ) {
    throwPhaseProgressionAssertionError({
      message: "core-loop admin proof missing Day 4 survivor role surface",
      evidence: dayFourSurvivorRoleSurface,
      includeEvidenceInError,
    });
  }
  assertPhaseProgressionPlayerObservation({
    surface: dayFourSurvivorRoleSurface,
    playerCase: dayFourSurvivorRoleSurfaceCaseDefinition.survivorCase,
    expectedGame,
    assertPostDayThreePlayerSurfaceProof,
    includeEvidenceInError,
  });
}

function assertPhaseProgressionPlayerObservation({
  surface,
  playerCase,
  expectedGame,
  assertPostDayThreePlayerSurfaceProof,
  includeEvidenceInError,
}) {
  assertPostDayThreePlayerSurfaceProof({
    proof: surface[playerCase.proofField],
    sourceRoleUrl: surface[playerCase.sourceRoleUrlField],
    expectedSlot: playerCase.expectedSlot,
    slotField: playerCase.slotField,
    expectedPrincipalUserId: playerCase.expectedPrincipalUserId,
    expectedPhaseId: playerCase.expectedPhaseId,
    expectedPhaseState: playerCase.expectedPhaseState,
    expectedActorAlive: playerCase.expectedActorAlive,
    expectedActorStatus: playerCase.expectedActorStatus,
    expectedActionState: playerCase.expectedActionState,
    expectedStatusText: playerCase.expectedStatusText,
    expectedPrivateCount: playerCase.expectedPrivateCount,
    expectedPrivateReceipt: playerCase.expectedPrivateReceipt,
    expectedBoundaryText: playerCase.expectedBoundaryText,
    expectedResyncFromSeq: playerCase.expectedResyncFromSeq,
    expectedCommandStateEndpoint:
      `/games/${expectedGame}/player-command-state?principal_user_id=${playerCase.expectedPrincipalUserId}&slot_id=${playerCase.expectedSlot}`,
    expectedNotificationsEndpoint:
      `/games/${expectedGame}/notifications?principal_user_id=${playerCase.expectedPrincipalUserId}`,
    expectedVoteButtonCount: playerCase.expectedVoteButtonCount,
    expectedVoteTargetCount: playerCase.expectedVoteTargetCount,
    includeEvidenceInError,
  });
}

function throwPhaseProgressionAssertionError({
  message,
  evidence,
  includeEvidenceInError,
}) {
  if (includeEvidenceInError) {
    throw new Error(`${message}: ${JSON.stringify(evidence)}`);
  }
  throw new Error(message);
}

function gameFromRoleUrl(roleUrl) {
  try {
    return new URL(roleUrl).pathname.split("/")[2] ?? "";
  } catch {
    return "";
  }
}
