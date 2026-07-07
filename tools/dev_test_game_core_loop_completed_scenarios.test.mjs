import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertCompletedActionPlayerSurfaceProofCase,
  assertCompletedHostReloadProofCase,
  assertHostCompleteGameProofCase,
  assertCompletedGameEndgameSurfaceProof,
} from "./dev_test_game_core_loop_completed_scenarios.mjs";
import {
  hostPhaseTransitionActionFixture,
  postDayThreePlayerSurfaceFixture,
  seededCoreLoopHostSurfaceFixture,
  seededCoreLoopPlayerSurfaceFixture,
} from "./dev_test_game_core_loop_proof_fixtures.mjs";
import {
  postDayThreeResolutionSurfaceFixture,
} from "./dev_test_game_core_loop_surface_fixtures.mjs";
import {
  completedGameEndgameSurfaceFixture,
  completedGameEndgameSurfaceProofFieldsFixture,
  completedHardeningProofFixture,
} from "./dev_test_game_core_loop_completed_game_fixtures.mjs";
import {
  assertCompletedGameEndgameSurfaceAssertionCases,
  assertCompletedGameEndgameTransition,
  completedActionPlayerSurfaceAssertionCase,
  completedActionPlayerSurfaceProofArgs,
  completedDeadPlayerStaleVoteCase,
  completedDeadPlayerStaleVoteAssertionCase,
  completedDeadPlayerStaleVoteCaseDefinition,
  completedDeadPlayerStaleVoteProofArgs,
  completedGameEndgameScenarioCaseFamilies,
  completedGameEndgameStaleRejectAssertionCases,
  completedGameEndgameProofScenarioCases,
  completedGameEndgameScenarioCaseFamilyDefinitions,
  completedGameEndgameScenarioCaseFamilyEntries,
  completedGameEndgameScenarioCaseFamilyIds,
  completedGameEndgameFeatureSpineRows,
  completedGameDeadPlayerStaleVoteFeatureSpineRows,
  completedGameEndgameRecoveryFeatureSpineRows,
  completedGamePlayerReloadFeatureSpineRows,
  completedGameStaleCommandFeatureSpineRows,
  completedGameEndgameSurfaceAssertionCases,
  completedGameEndgameTransition,
  completedGameHardeningLaneCase,
  completedGameHardeningLaneCasesFor,
  completedGameHardeningLaneIds,
  completedGameHardeningLaneIdsFor,
  completedGameHardeningSpineTargetCases,
  completedGameSeedDemoOnlyScenarioIds,
  completedGameSeedRequiredScenarioIds,
  completedHostCompleteRaceHardeningLaneCases,
  completedHostRaceHardeningLaneIds,
  completedHostSeedDemoOnlyScenarioIds,
  completedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases,
  completedHostStaleCommandAssertionCases,
  completedHostStaleCommandHardeningLaneCases,
  completedHostStaleCommandSeedRecoveryLaneIds,
  completedHostStaleCommandProofArgs,
  completedPlayerRecoveryLaneIds,
  completedPlayerCompleteRaceHardeningLaneCases,
  completedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases,
  completedPlayerReloadAssertionCases,
  completedPlayerReloadProofCases,
  completedPlayerSeedDemoOnlyScenarioIds,
  completedPlayerSeedRequiredScenarioIds,
  completedStalePlayerCompleteHardeningLaneCases,
  staleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases,
  staleCompletedGamePlayerCommandAssertionCases,
  staleCompletedGamePlayerCommandProofArgs,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  completedHostReloadProofFixture,
  completedHostReloadSnapshotFixture,
  completedHostStaleCommandProofFixtures,
  completedPlayerReloadProofFixtures,
  completedPlayerReloadSnapshotsFixture,
  staleCompletedPlayerCommandProofFixtures,
} from "./dev_test_game_core_loop_completed_game_fixtures.mjs";
import {
  assertCoreLoopCompletedEndgameProgressionSurfaceProof,
  completedHostCompleteRaceProofLaneDescriptors,
  completedHostStaleCompleteProofLaneDescriptors,
  completedPlayerCompleteRaceProofLaneDescriptors,
  completedStalePlayerCompleteProofLaneDescriptors,
  coreLoopCompletedGameHardeningLaneDescriptors,
  coreLoopCompletedEndgameProgressionProofScenarioCases,
  coreLoopCompletedEndgameProgressionScenarioFamilies,
  coreLoopCompletedEndgameProgressionScenarioFamily,
  coreLoopCompletedEndgameProgressionTransition,
} from "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs";
import {
  assertCompletedGameProofReadinessSurfaceProof,
  completedGameProofReadinessCaseGroupDefinitions,
  completedGameProofReadinessCaseGroupIds,
  completedGameProofReadinessCaseGroups,
  completedGameProofReadinessProofScenarioCases,
  completedGameProofReadinessScenarioFamilies,
  completedGameProofReadinessScenarioFamily,
  completedGameProofReadinessTransition,
} from "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs";
import {
  completedHostStaleCommandHardeningLaneCaseDefinitions as extractedCompletedHostStaleCommandHardeningLaneCaseDefinitions,
  completedHostStaleCommandCaseDefinitions as extractedCompletedHostStaleCommandCaseDefinitions,
  completedHostStaleCommandCases as extractedCompletedHostStaleCommandCases,
  completedPlayerReloadHardeningLaneCaseDefinitions as extractedCompletedPlayerReloadHardeningLaneCaseDefinitions,
  completedPlayerReloadCaseDefinitions as extractedCompletedPlayerReloadCaseDefinitions,
  completedPlayerReloadCases as extractedCompletedPlayerReloadCases,
  staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions as extractedStaleCompletedGamePlayerCommandHardeningLaneCaseDefinitions,
  staleCompletedGamePlayerCommandCaseDefinitions as extractedStaleCompletedGamePlayerCommandCaseDefinitions,
  staleCompletedGamePlayerCommandCases as extractedStaleCompletedGamePlayerCommandCases,
} from "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs";

test("completed-game scenario module exposes shared frozen definitions", () => {
  assert.equal(
    completedHostStaleCommandCaseDefinitions,
    extractedCompletedHostStaleCommandCaseDefinitions,
  );
  assert.equal(
    completedPlayerReloadCaseDefinitions,
    extractedCompletedPlayerReloadCaseDefinitions,
  );
  assert.equal(
    staleCompletedGamePlayerCommandCaseDefinitions,
    extractedStaleCompletedGamePlayerCommandCaseDefinitions,
  );
  assert.equal(
    completedHostStaleCommandCases,
    extractedCompletedHostStaleCommandCases,
  );
  assert.equal(
    completedPlayerReloadCases,
    extractedCompletedPlayerReloadCases,
  );
  assert.equal(
    staleCompletedGamePlayerCommandCases,
    extractedStaleCompletedGamePlayerCommandCases,
  );
  assert(Object.isFrozen(completedHostStaleCommandCaseDefinitions));
  assert(Object.isFrozen(completedPlayerReloadCaseDefinitions));
  assert(Object.isFrozen(staleCompletedGamePlayerCommandCaseDefinitions));
  assert(Object.isFrozen(completedDeadPlayerStaleVoteCaseDefinition));
  assert.deepEqual(
    completedHostStaleCommandCases(),
    completedHostStaleCommandCaseDefinitions,
  );
  assert.deepEqual(
    completedPlayerReloadCases(),
    completedPlayerReloadCaseDefinitions,
  );
  assert.deepEqual(
    staleCompletedGamePlayerCommandCases(),
    staleCompletedGamePlayerCommandCaseDefinitions,
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteCase(),
    completedDeadPlayerStaleVoteCaseDefinition,
  );
  assert(Object.isFrozen(completedHostStaleCommandCases()));
  assert(Object.isFrozen(completedHostStaleCommandCases()[0]));
  assert(Object.isFrozen(completedPlayerReloadCases()));
  assert(Object.isFrozen(completedPlayerReloadCases()[0]));
  assert(Object.isFrozen(staleCompletedGamePlayerCommandCases()));
  assert(Object.isFrozen(staleCompletedGamePlayerCommandCases()[0]));
  assert(Object.isFrozen(completedDeadPlayerStaleVoteCase()));
  assert.notEqual(
    completedHostStaleCommandCases()[0],
    completedHostStaleCommandCaseDefinitions[0],
  );
  assert.notEqual(
    completedPlayerReloadCases()[0],
    completedPlayerReloadCaseDefinitions[0],
  );
  assert.notEqual(
    staleCompletedGamePlayerCommandCases()[0],
    staleCompletedGamePlayerCommandCaseDefinitions[0],
  );
  assert.notEqual(
    completedDeadPlayerStaleVoteCase(),
    completedDeadPlayerStaleVoteCaseDefinition,
  );
});

test("completed-game scenario module groups shared recovery case families", () => {
  const scenarioFamilies = completedGameEndgameScenarioCaseFamilies();

  assert(Object.isFrozen(completedGameEndgameScenarioCaseFamilyDefinitions));
  assert.deepEqual(completedGameEndgameScenarioCaseFamilyIds, [
    "completedHostStaleCommandCases",
    "completedPlayerReloadCases",
    "staleCompletedGamePlayerCommandCases",
  ]);
  assert.deepEqual(
    completedGameEndgameScenarioCaseFamilyDefinitions.map(
      ({ id, role, recoveryKind }) => ({ id, role, recoveryKind }),
    ),
    [
      {
        id: "completedHostStaleCommandCases",
        role: "host",
        recoveryKind: "stale-command",
      },
      {
        id: "completedPlayerReloadCases",
        role: "player",
        recoveryKind: "reload",
      },
      {
        id: "staleCompletedGamePlayerCommandCases",
        role: "player",
        recoveryKind: "stale-command",
      },
    ],
  );
  assert(Object.isFrozen(scenarioFamilies));
  assert(Object.isFrozen(scenarioFamilies.completedHostStaleCommandCases));
  assert(Object.isFrozen(scenarioFamilies.completedHostStaleCommandCases[0]));
  assert(Object.isFrozen(scenarioFamilies.completedPlayerReloadCases));
  assert(Object.isFrozen(scenarioFamilies.completedPlayerReloadCases[0]));
  assert(Object.isFrozen(scenarioFamilies.completedDeadPlayerStaleVoteCase));
  assert(Object.isFrozen(scenarioFamilies.staleCompletedGamePlayerCommandCases));
  assert(
    Object.isFrozen(scenarioFamilies.staleCompletedGamePlayerCommandCases[0]),
  );
  assert.deepEqual(
    scenarioFamilies.completedHostStaleCommandCases,
    completedHostStaleCommandCaseDefinitions,
  );
  assert.deepEqual(
    scenarioFamilies.completedPlayerReloadCases,
    completedPlayerReloadCaseDefinitions,
  );
  assert.deepEqual(
    scenarioFamilies.completedDeadPlayerStaleVoteCase,
    completedDeadPlayerStaleVoteCaseDefinition,
  );
  assert.deepEqual(
    scenarioFamilies.staleCompletedGamePlayerCommandCases,
    staleCompletedGamePlayerCommandCaseDefinitions,
  );
  assert.notEqual(
    scenarioFamilies.completedHostStaleCommandCases[0],
    completedHostStaleCommandCaseDefinitions[0],
  );
  assert.notEqual(
    scenarioFamilies.completedPlayerReloadCases[0],
    completedPlayerReloadCaseDefinitions[0],
  );
  assert.notEqual(
    scenarioFamilies.staleCompletedGamePlayerCommandCases[0],
    staleCompletedGamePlayerCommandCaseDefinitions[0],
  );
  assert.notEqual(
    scenarioFamilies.completedDeadPlayerStaleVoteCase,
    completedDeadPlayerStaleVoteCaseDefinition,
  );
  assert.deepEqual(
    Object.fromEntries(
      completedGameEndgameScenarioCaseFamilyEntries({ scenarioFamilies }),
    ),
    {
      completedHostStaleCommandCases:
        scenarioFamilies.completedHostStaleCommandCases,
      completedPlayerReloadCases: scenarioFamilies.completedPlayerReloadCases,
      staleCompletedGamePlayerCommandCases:
        scenarioFamilies.staleCompletedGamePlayerCommandCases,
    },
  );
});

test("completed-game scenario module derives shared hardening lane groups", () => {
  assert.deepEqual(
    completedGameHardeningLaneCasesFor({
      families: "completed-host-stale-command",
    }),
    extractedCompletedHostStaleCommandHardeningLaneCaseDefinitions(),
  );
  assert.deepEqual(
    completedGameHardeningLaneCasesFor({
      families: "completed-player-reload",
    }),
    extractedCompletedPlayerReloadHardeningLaneCaseDefinitions(),
  );
  assert.deepEqual(
    completedGameHardeningLaneCasesFor({
      families: "completed-player-stale-command",
      proofGroups: "stale-player-complete",
    }),
    extractedStaleCompletedGamePlayerCommandHardeningLaneCaseDefinitions(),
  );
  assert.deepEqual(completedGameHardeningLaneCase("stale-host-complete"), {
    id: "stale-host-complete",
    label: "Stale complete-game reveal rejects after live completion",
    family: "completed-host-stale-command",
    seedGroup: "demo-only",
    proofGroup: "stale-host-complete",
    proofStep: "reject",
  });
  assert.throws(
    () => completedGameHardeningLaneCase("missing-completed-lane"),
    /unknown completed-game hardening lane: missing-completed-lane/,
  );
  assert.deepEqual(completedGameHardeningLaneIds(), [
    "stale-host-complete",
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete",
    "stale-player-complete-reload",
  ]);
  assert.deepEqual(
    completedGameHardeningSpineTargetCases().map((target) => ({
      targetKey: target.targetKey,
      featureSlotId: target.featureSlotId,
      roleUrlId: target.roleUrlId,
      checkpointId: target.checkpointId,
      adminCheckId: target.adminCheckId,
      cycleId: target.cycleId,
      role: target.role,
    })),
    [
      {
        targetKey: "completedGameStaleHostReject",
        featureSlotId: "completed-game-stale-host-reject",
        roleUrlId: "stale-host-complete",
        checkpointId: "stale-host-complete",
        adminCheckId: "stale-host-complete",
        cycleId: "hardening-completed-game",
        role: "host",
      },
      {
        targetKey: "completedGameStaleRecovery",
        featureSlotId: "completed-game-stale-recovery",
        roleUrlId: "stale-host-complete-reload",
        checkpointId: "stale-host-complete-reload",
        adminCheckId: "stale-host-complete-reload",
        cycleId: "hardening-completed-game",
        role: "host",
      },
      {
        targetKey: "completedGameStaleReconnectRecovery",
        featureSlotId: "completed-game-stale-reconnect-recovery",
        roleUrlId: "stale-host-complete-reconnect-recovery",
        checkpointId: "stale-host-complete-reconnect-recovery",
        adminCheckId: "stale-host-complete-reconnect-recovery",
        cycleId: "hardening-completed-game",
        role: "host",
      },
      {
        targetKey: "completedGameStalePlayerReject",
        featureSlotId: "completed-game-stale-player-reject",
        roleUrlId: "stale-player-complete",
        checkpointId: "stale-player-complete",
        adminCheckId: "stale-player-complete",
        cycleId: "hardening-completed-game",
        role: "player",
      },
      {
        targetKey: "completedGameStalePlayerReloadRecovery",
        featureSlotId: "completed-game-stale-player-reload-recovery",
        roleUrlId: "stale-player-complete-reload",
        checkpointId: "stale-player-complete-reload",
        adminCheckId: "stale-player-complete-reload",
        cycleId: "hardening-completed-game",
        role: "player",
      },
    ],
  );
  assert.deepEqual(completedHostRaceHardeningLaneIds(), [
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
  ]);
  assert.deepEqual(
    completedHostCompleteRaceHardeningLaneCases().map((scenario) => [
      scenario.id,
      scenario.proofStep,
    ]),
    [
      ["concurrent-host-complete-race", "race"],
      ["concurrent-host-complete-race-reload", "reload"],
    ],
  );
  assert.deepEqual(completedHostStaleCommandSeedRecoveryLaneIds(), [
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
  ]);
  assert.deepEqual(completedHostSeedDemoOnlyScenarioIds(), [
    "stale-host-complete",
  ]);
  assert.deepEqual(completedPlayerRecoveryLaneIds(), [
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete",
    "stale-player-complete-reload",
  ]);
  assert.deepEqual(
    completedPlayerCompleteRaceHardeningLaneCases().map((scenario) => [
      scenario.id,
      scenario.proofStep,
    ]),
    [
      ["concurrent-player-complete-race", "race"],
      ["public-player-complete-reload", "reload"],
    ],
  );
  assert.deepEqual(completedPlayerSeedRequiredScenarioIds(), [
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete-reload",
  ]);
  assert.deepEqual(completedPlayerSeedDemoOnlyScenarioIds(), [
    "stale-player-complete",
  ]);
  assert.deepEqual(completedGameSeedRequiredScenarioIds(), [
    "stale-host-complete-reload",
    "stale-host-complete-reconnect-recovery",
    "concurrent-host-complete-race",
    "concurrent-host-complete-race-reload",
    "concurrent-player-complete-race",
    "public-player-complete-reload",
    "stale-player-complete-reload",
  ]);
  assert.deepEqual(completedGameSeedDemoOnlyScenarioIds(), [
    "stale-host-complete",
    "stale-player-complete",
  ]);
  assert.deepEqual(
    completedGameHardeningLaneIdsFor({
      families: "completed-player-reload",
      seedGroups: "required",
    }),
    ["public-player-complete-reload", "stale-player-complete-reload"],
  );
  assert.deepEqual(
    completedGameHardeningLaneCasesFor({
      proofGroups: "stale-host-complete",
    }).map((scenario) => [scenario.id, scenario.proofStep]),
    [
      ["stale-host-complete", "reject"],
      ["stale-host-complete-reload", "reload"],
      ["stale-host-complete-reconnect-recovery", "reconnect"],
    ],
  );
  assert.deepEqual(
    completedHostStaleCommandHardeningLaneCases().map((scenario) => [
      scenario.id,
      scenario.proofStep,
    ]),
    [
      ["stale-host-complete", "reject"],
      ["stale-host-complete-reload", "reload"],
      ["stale-host-complete-reconnect-recovery", "reconnect"],
    ],
  );
  assert.deepEqual(
    completedStalePlayerCompleteHardeningLaneCases().map((scenario) => [
      scenario.id,
      scenario.proofStep,
    ]),
    [
      ["stale-player-complete", "reject"],
      ["stale-player-complete-reload", "reload"],
    ],
  );
});

test("completed-game production harness callers source recovery cases canonically", async () => {
  const canonicalCallerImports = [
    [
      "tools/dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
      [
        "completedGameEndgameScenarioCaseFamilies",
        "completedHostStaleCommandHardeningLaneCaseDefinitions",
        "completedPlayerReloadHardeningLaneCaseDefinitions",
        "staleCompletedGamePlayerCommandHardeningLaneCaseDefinitions",
      ],
      "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs",
    ],
    [
      "tools/dev_test_game_core_loop_completed_scenarios.mjs",
      [
        "completedGameEndgameScenarioCaseFamilies",
        "completedGameEndgameSurfaceAssertionCases",
      ],
      "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    ],
    [
      "tools/dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
      [
        "completedGameHardeningLaneIds",
        "completedGameProofReadinessScenarioFamilies",
        "completedGameStaleRecoverySpineLaneCase",
      ],
      "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    ],
    [
      "tools/dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
      ["assertCompletedGameEndgameSurfaceProof"],
      "./dev_test_game_core_loop_completed_scenarios.mjs",
    ],
    [
      "tools/dev_test_game_core_loop_admin_proof.mjs",
      [
        "completedGameProofReadinessProofScenarioCases",
        "completedGameProofReadinessScenarioFamilies",
        "completedGameProofReadinessTransition",
      ],
      "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    ],
    [
      "tools/dev_test_game_release_readiness.mjs",
      ["completedGameProofReadinessScenarioFamilies"],
      "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    ],
    [
      "tools/dev_test_game_feature_lane_catalog.mjs",
      ["completedGameRecoveryFeatureSpineRow"],
      "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    ],
  ];

  for (const [callerPath, importedNames, moduleSpecifier] of canonicalCallerImports) {
    const callerSource = await readFile(callerPath, "utf8");
    for (const importedName of importedNames) {
      assert(
        importsFromModule({
          source: callerSource,
          importedName,
          moduleSpecifier,
        }),
        `${callerPath} should import ${importedName} from ${moduleSpecifier}`,
      );
    }
  }

  const allowedCompletedScenarioSpecifiers = new Set([
    "./dev_test_game_core_loop_completed_scenarios.mjs",
    "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    "./dev_test_game_core_loop_completed_game_recovery_scenarios.mjs",
    "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    "./dev_test_game_core_loop_completed_game_fixtures.mjs",
    "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs",
  ]);
  for (const callerPath of [
    "tools/dev_test_game.test.mjs",
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "tools/dev_test_game_core_loop_completed_scenarios.mjs",
    "tools/dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    "tools/dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs",
    "tools/dev_test_game_feature_lane_catalog.mjs",
    "tools/dev_test_game_proof_contract.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game_release_readiness_cases.mjs",
  ]) {
    const callerSource = await readFile(callerPath, "utf8");
    for (const moduleSpecifier of importSpecifiers(callerSource).filter(
      (specifier) =>
        specifier.includes("dev_test_game_core_loop_completed_") &&
        !specifier.endsWith("_fixtures.mjs"),
    )) {
      assert(
        allowedCompletedScenarioSpecifiers.has(moduleSpecifier),
        `${callerPath} should import completed-game recovery through a canonical module, found ${moduleSpecifier}`,
      );
    }
  }

  const proofReadinessContractSource = await readFile(
    "tools/dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    "utf8",
  );
  for (const localScenarioLiteral of [
    "completedHostStaleResolveRecoveryProof",
    "completed-host-stale-resolve",
    "host:stale_resolve_phase:reject:GameAlreadyCompleted",
    "completedPlayerReloadProof",
    "actionPlayer:reload:complete",
    "staleCompletedVoteRecoveryProof",
    "stale:D05:submit_vote:reject:GameAlreadyCompleted",
  ]) {
    assert(
      !proofReadinessContractSource.includes(localScenarioLiteral),
      `proof/readiness contract should not define local completed-game scenario literal ${localScenarioLiteral}`,
    );
  }

  const recoveryScenarioSource = await readFile(
    "tools/dev_test_game_core_loop_completed_game_recovery_scenarios.mjs",
    "utf8",
  );
  const terminalAssertionSource = await readFile(
    "tools/dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    "utf8",
  );
  for (const recoveryScenarioLiteral of [
    "completedHostStaleResolveRecoveryProof",
    "completed-host-stale-resolve",
    "host:stale_resolve_phase:reject:GameAlreadyCompleted",
    "completedPlayerReloadProof",
    "actionPlayer:reload:complete",
    "staleCompletedVoteRecoveryProof",
    "stale:D05:submit_vote:reject:GameAlreadyCompleted",
  ]) {
    const quotedScenarioLiteral = `"${recoveryScenarioLiteral}"`;
    assert(
      recoveryScenarioSource.includes(quotedScenarioLiteral),
      `recovery scenario source should own completed-game scenario literal ${recoveryScenarioLiteral}`,
    );
    assert(
      !terminalAssertionSource.includes(quotedScenarioLiteral),
      `terminal assertion source should not define local completed-game scenario literal ${recoveryScenarioLiteral}`,
    );
  }
});
test("completed-game proof/readiness facade exposes one completed recovery table", () => {
  assert(Object.isFrozen(completedGameProofReadinessCaseGroupDefinitions));
  assert.equal(
    completedGameProofReadinessCaseGroupDefinitions,
    completedGameEndgameScenarioCaseFamilyDefinitions,
  );
  assert.equal(
    completedGameProofReadinessCaseGroupIds,
    completedGameEndgameScenarioCaseFamilyIds,
  );
  assert.deepEqual(
    completedGameProofReadinessCaseGroupDefinitions.map(({ id }) => id),
    completedGameProofReadinessCaseGroupIds,
  );
  assert.deepEqual(completedGameProofReadinessCaseGroupIds, [
    "completedHostStaleCommandCases",
    "completedPlayerReloadCases",
    "staleCompletedGamePlayerCommandCases",
  ]);
  assert.deepEqual(
    completedGameProofReadinessScenarioFamilies(),
    completedGameEndgameScenarioCaseFamilies(),
  );
  assert.deepEqual(completedGameProofReadinessCaseGroups(), {
    completedHostStaleCommandCases: completedHostStaleCommandCases(),
    completedPlayerReloadCases: completedPlayerReloadCases(),
    staleCompletedGamePlayerCommandCases:
      staleCompletedGamePlayerCommandCases(),
  });
});

test("completed-game progression facade shares proof and readiness cases", async () => {
  const progressionSource = await readFile(
    "tools/dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs",
    "utf8",
  );
  for (const importedName of [
    "assertCompletedGameProofReadinessSurfaceProof",
    "completedGameProofReadinessProofScenarioCases",
    "completedGameProofReadinessScenarioFamilies",
    "completedGameProofReadinessScenarioFamily",
    "completedGameProofReadinessTransition",
  ]) {
    assert(
      importsFromModule({
        source: progressionSource,
        importedName,
        moduleSpecifier:
          "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
      }),
      `completed-game progression should import ${importedName} from the shared proof/readiness contract`,
    );
  }
  assert.deepEqual(
    coreLoopCompletedEndgameProgressionScenarioFamilies(),
    completedGameProofReadinessScenarioFamilies(),
  );
  const scenarioFamilies = completedGameEndgameScenarioCaseFamilies({
    hostStaleCommandCases: [completedHostStaleCommandCases()[2]],
    playerReloadCases: [completedPlayerReloadCases()[0]],
    deadPlayerStaleVoteCase: completedDeadPlayerStaleVoteCase(),
    playerStaleCommandCases: [staleCompletedGamePlayerCommandCases()[1]],
  });
  const proofCases = completedGameProofReadinessProofScenarioCases({
    actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
    commandStateBuilders: commandStateBuildersFixture(),
    scenarioFamilies,
  });
  const progressionProofCases =
    coreLoopCompletedEndgameProgressionProofScenarioCases({
      actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
      deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
      commandStateBuilders: commandStateBuildersFixture(),
      scenarioFamilies,
    });
  const transition = completedGameProofReadinessTransition({
    scenarioFamilies,
  });
  const progressionTransition = coreLoopCompletedEndgameProgressionTransition({
    scenarioFamilies,
  });
  const progressionFamily = coreLoopCompletedEndgameProgressionScenarioFamily({
    scenarioFamilies,
  });

  assert.deepEqual(progressionProofCases, proofCases);
  assert.equal(progressionTransition, transition);
  assert.deepEqual(
    progressionFamily.transitionTokens,
    completedGameProofReadinessScenarioFamily({ scenarioFamilies }).transitionTokens,
  );

  assert.deepEqual(
    proofCases.completedHostStaleCommandCases.map(
      (scenario) => scenario.proofField,
    ),
    ["completedHostStaleCompleteRecoveryProof"],
  );
  assert.deepEqual(
    proofCases.completedPlayerReloadCases.map((scenario) => scenario.proofField),
    ["completedPlayerReloadProof"],
  );
  assert.deepEqual(
    proofCases.staleCompletedGamePlayerCommandCases.map(
      (scenario) => scenario.proofField,
    ),
    ["staleCompletedPostRecoveryProof"],
  );
  assert.match(
    transition,
    /host:stale_complete_game:reject:GameAlreadyCompleted/,
  );
  assert.match(transition, /actionPlayer:reload:complete/);
  assert.match(transition, /stale:D05:submit_post:reject:GameAlreadyCompleted/);
  assert.doesNotMatch(transition, /host:stale_resolve_phase/);
  assert.doesNotMatch(transition, /normalPlayer:reload:complete/);
  assert.doesNotMatch(transition, /stale:D05:submit_vote/);
});

test("completed-game test fixtures live outside the assertion facade", async () => {
  const sharedFixtureNames = [
    "completedHardeningProofFixture",
    "completedHostReloadProofFixture",
    "completedHostStaleCommandProofFixtures",
    "completedGameEndgameSurfaceProofFieldsFixture",
    "completedPlayerReloadProofFixtures",
    "completedPlayerReloadSnapshotsFixture",
    "staleCompletedPlayerCommandProofFixtures",
  ];
  const fixtureCallerPaths = new Map([
    [
      "tools/dev_test_game.test.mjs",
      ["completedGameEndgameSurfaceFixture"],
    ],
    [
      "tools/dev_test_game_core_loop_completed_scenarios.test.mjs",
      sharedFixtureNames,
    ],
  ]);

  for (const [callerPath, fixtureNames] of fixtureCallerPaths) {
    const source = await readFile(callerPath, "utf8");
    for (const importedName of fixtureNames) {
      assert(
        importsFromModule({
          source,
          importedName,
          moduleSpecifier:
            "./dev_test_game_core_loop_completed_game_fixtures.mjs",
        }),
        `${callerPath} should import ${importedName} from the fixture-only module`,
      );
    }
  }

  const terminalScenarioAssertionSource = await readFile(
    "tools/dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs",
    "utf8",
  );
  const fixtureModuleSource = await readFile(
    "tools/dev_test_game_core_loop_completed_game_fixtures.mjs",
    "utf8",
  );
  for (const importedName of [
    "completedGameEndgameScenarioCaseFamilyEntries",
    "completedGameProofReadinessScenarioFamilies",
    "completedGameProofReadinessTransition",
  ]) {
    assert(
      importsFromModule({
        source: fixtureModuleSource,
        importedName,
        moduleSpecifier:
          "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
      }),
      `completed-game fixtures should import ${importedName} from the proof/readiness contract`,
    );
  }
  assert(
    !importsFromModule({
      source: fixtureModuleSource,
      importedName: "completedGameProofReadinessCaseGroups",
      moduleSpecifier:
        "./dev_test_game_core_loop_completed_game_proof_readiness_contract.mjs",
    }),
    "completed-game fixtures should derive cases from shared family entries, not readiness case groups",
  );
  for (const fixtureName of [
    "completedDeadPlayerStaleVoteRecoveryProofFixture",
    "completedGameDayVoteOutcomesFixture",
    "completedGameEndgameSurfaceFixture",
    "completedGameEndgameSurfaceProofFieldsFixture",
    ...sharedFixtureNames,
  ]) {
    assert(
      !new RegExp(`export\\s+function\\s+${fixtureName}\\b`).test(
        terminalScenarioAssertionSource,
      ),
      `terminal scenario/assertion module should not export fixture builder ${fixtureName}`,
    );
  }
});

function importsFromModule({ source, importedName, moduleSpecifier }) {
  const importPattern = new RegExp(
    `(?:import|export)\\s*\\{([^}]*)\\}\\s*from\\s*"${escapeRegExp(moduleSpecifier)}";`,
    "g",
  );
  return Array.from(source.matchAll(importPattern)).some((match) =>
    match[1]
      .split(",")
      .map((entry) => entry.trim())
      .some((entry) =>
        new RegExp(`\\b${escapeRegExp(importedName)}\\b`).test(entry),
      ),
  );
}

function importSpecifiers(source) {
  const importPattern =
    /(?:import|export)\s*(?:\{[^}]*\}\s*)?from\s*"([^"]+)";/g;
  return Array.from(source.matchAll(importPattern), (match) => match[1]);
}

test("completed-game proof contract uses shared hardening lane metadata", async () => {
  const source = await readFile("tools/dev_test_game_proof_contract.mjs", "utf8");
  assert(
    importsFromModule({
      source,
      importedName: "coreLoopCompletedGameHardeningLaneDescriptors",
      moduleSpecifier:
        "./dev_test_game_core_loop_completed_endgame_progression_scenarios.mjs",
    }),
    "proof contract should import completed-game hardening descriptors from the progression facade",
  );
  assert(
    source.includes("...completedGameHardeningProofLanes({ hardening })"),
    "proof contract should build completed-game lanes through the shared helper",
  );
  assert(
    source.includes("buildCompletedGameHardeningCoverage(lanes)"),
    "proof contract should derive completed-game coverage from generated lanes",
  );
  assert(
    source.includes("assertCompletedGameHardeningCoverageSummary"),
    "proof contract should validate completed-game coverage summary",
  );
  assert(
    source.includes("expectedLaneCount") &&
      source.includes("expectedFamilyCount"),
    "proof contract should emit explicit shared-case expected coverage totals",
  );
  assert(
    !source.includes("completedGameHardeningLaneIds().map"),
    "proof contract should leave completed-game lane ordering to the progression facade",
  );
  for (const helperName of [
    "completedHostStaleCompleteProofLanes",
    "completedHostCompleteRaceProofLanes",
    "completedPlayerCompleteRaceProofLanes",
    "completedStalePlayerCompleteProofLanes",
  ]) {
    assert(
      !source.includes(helperName),
      `proof contract should not keep local completed-game lane helper ${helperName}`,
    );
  }
  for (const scenario of completedGameHardeningLaneIds().map((id) =>
    completedGameHardeningLaneCase(id),
  )) {
    assert(
      !source.includes(`lane("${scenario.id}", "${scenario.label}"`),
      `proof contract should not duplicate ${scenario.id} label text`,
    );
  }
});

test("completed-game progression facade owns hardening lane descriptors", () => {
  const hardening = completedHardeningProofFixture();
  assert.deepEqual(
    coreLoopCompletedGameHardeningLaneDescriptors({ hardening }).map(
      (descriptor) => [descriptor.id, descriptor.label, descriptor.evidence.passed],
    ),
    completedGameHardeningLaneIds().map((id) => {
      const scenario = completedGameHardeningLaneCase(id);
      return [scenario.id, scenario.label, true];
    }),
  );
  for (const { helper, cases } of [
    {
      helper: completedHostStaleCompleteProofLaneDescriptors,
      cases: completedHostStaleCommandHardeningLaneCases(),
    },
    {
      helper: completedHostCompleteRaceProofLaneDescriptors,
      cases: completedHostCompleteRaceHardeningLaneCases(),
    },
    {
      helper: completedPlayerCompleteRaceProofLaneDescriptors,
      cases: completedPlayerCompleteRaceHardeningLaneCases(),
    },
    {
      helper: completedStalePlayerCompleteProofLaneDescriptors,
      cases: completedStalePlayerCompleteHardeningLaneCases(),
    },
  ]) {
    assert.deepEqual(
      helper({ hardening }).map((descriptor) => descriptor.id),
      cases.map((scenario) => scenario.id),
    );
  }
});

test("completed-game scenario module builds player reload proof cases", () => {
  const proofCases = completedPlayerReloadProofCases({
    actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
    commandStateBuilders: commandStateBuildersFixture(),
  });

  assert.deepEqual(
    proofCases.map((scenario) => ({
      proofField: scenario.proofField,
      roleUrl: scenario.roleUrl,
      cookieValue: scenario.cookieValue,
      commandStateKind: scenario.commandStateKind,
      commandStateBoundary: scenario.commandState.boundary,
    })),
    [
      {
        proofField: "completedPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/action",
        cookieValue: "fixture-player",
        commandStateKind: "action-player",
        commandStateBoundary:
          "Seeded browser completed action-player role URL reloaded into durable endgame controls.",
      },
      {
        proofField: "completedNormalPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/normal",
        cookieValue: "fixture-normal",
        commandStateKind: "normal-player",
        commandStateBoundary:
          "Seeded browser completed normal-player role URL reloaded into durable endgame controls.",
      },
      {
        proofField: "completedDeadPlayerReloadProof",
        roleUrl: "http://127.0.0.1/g/game-a/dead",
        cookieValue: "fixture-target",
        commandStateKind: "dead-player",
        commandStateBoundary:
          "Seeded browser completed dead-player role URL reloaded into durable endgame controls.",
      },
    ],
  );
});

test("completed-game scenario module bundles proof runner case families", () => {
  const proofCases = completedGameEndgameProofScenarioCases({
    actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
    normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
    deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
    commandStateBuilders: commandStateBuildersFixture(),
  });

  assert.deepEqual(
    proofCases.completedHostStaleCommandCases.map(
      (scenario) => scenario.proofField,
    ),
    [
      "completedHostStaleResolveRecoveryProof",
      "completedHostStaleAdvanceRecoveryProof",
      "completedHostStaleCompleteRecoveryProof",
    ],
  );
  assert.deepEqual(
    proofCases.completedPlayerReloadCases.map((scenario) => scenario.proofField),
    [
      "completedPlayerReloadProof",
      "completedNormalPlayerReloadProof",
      "completedDeadPlayerReloadProof",
    ],
  );
  assert.equal(
    proofCases.completedDeadPlayerStaleVoteCase.proofField,
    "completedDeadPlayerStaleVoteRecoveryProof",
  );
  assert.deepEqual(
    proofCases.staleCompletedGamePlayerCommandCases.map(
      (scenario) => scenario.proofField,
    ),
    ["staleCompletedVoteRecoveryProof", "staleCompletedPostRecoveryProof"],
  );
});

test("completed-game scenario module builds reusable proof fixtures", () => {
  const game = "game-a";
  const dayVoteOutcomes = [{ phaseId: "D05", status: "NoLynch" }];
  const hostSnapshot = completedHostReloadSnapshotFixture({ dayVoteOutcomes });
  const playerSnapshots = completedPlayerReloadSnapshotsFixture({
    game,
    dayVoteOutcomes,
  });
  const hostStaleProofs = completedHostStaleCommandProofFixtures({
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    game,
    snapshot: hostSnapshot,
  });
  const playerReloadProofs = completedPlayerReloadProofFixtures({
    roleUrls: {
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a",
      sourceNormalPlayerRoleUrl: "http://127.0.0.1/g/game-a/player-rowan",
      sourceDeadPlayerRoleUrl:
        "http://127.0.0.1/g/game-a?private=notification-1",
    },
    snapshots: playerSnapshots,
  });
  const stalePlayerProofs = staleCompletedPlayerCommandProofFixtures({
    sourceRoleUrl: "http://127.0.0.1/g/game-a",
    visitedRolePath: "/g/game-a",
    game,
  });
  const proofFieldsByFamily = Object.fromEntries(
    completedGameEndgameScenarioCaseFamilyEntries().map(([id, cases]) => [
      id,
      cases.map((scenario) => scenario.proofField),
    ]),
  );

  assert.deepEqual(
    Object.keys(hostStaleProofs),
    proofFieldsByFamily.completedHostStaleCommandCases,
  );
  assert.deepEqual(
    Object.keys(playerSnapshots),
    proofFieldsByFamily.completedPlayerReloadCases,
  );
  assert.deepEqual(
    Object.keys(playerReloadProofs),
    proofFieldsByFamily.completedPlayerReloadCases,
  );
  assert.deepEqual(
    Object.keys(stalePlayerProofs),
    proofFieldsByFamily.staleCompletedGamePlayerCommandCases,
  );
  assert.equal(
    hostStaleProofs.completedHostStaleResolveRecoveryProof.commandKind,
    "ResolvePhase",
  );
  assert.equal(
    playerReloadProofs.completedDeadPlayerReloadProof.initialSnapshot.commandState
      .actorStatus,
    "dead",
  );
  assert.equal(
    stalePlayerProofs.staleCompletedPostRecoveryProof.command.body,
    "Stale completed game proof post",
  );
});

test("core-loop proof fixture module builds shared host and player proof shapes", () => {
  const hostProof = hostPhaseTransitionActionFixture({
    actionId: "resolve_phase",
    commandKind: "ResolvePhase",
    streamSeq: 701,
    phaseId: "D02",
    phaseState: "locked",
    deadlineAffordance: "advance_phase",
    projectionRefreshKeys: ["host", "votecount"],
    command: { game: "game-a" },
  });
  const playerProof = postDayThreePlayerSurfaceFixture({
    sourceRoleUrl: "http://127.0.0.1/g/game-a",
    visitedRolePath: "/g/game-a",
    slotField: "actionPlayerSlot",
    slot: "slot-7",
    principalUserId: "player_mira",
    phaseId: "N05",
    phaseState: "open",
    actorAlive: true,
    actorStatus: "alive",
    gameCompleted: true,
    actionState: "disabled:game complete",
    statusText: "Player action unavailable: game complete",
    privateCount: 0,
    privateReceipt: false,
    boundary: "completed game endgame state",
    resyncFromSeq: 921,
    commandStateEndpoint:
      "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
    notificationsEndpoint:
      "/games/game-a/notifications?principal_user_id=player_mira",
  });

  assert.equal(hostProof.commandStatus.message, "Ack: stream seqs 701");
  assert.deepEqual(hostProof.bridgePlan.projectionRefreshKeys, [
    "host",
    "votecount",
  ]);
  assert.equal(playerProof.projectionCommandState.gameCompleted, true);
  assert.equal(playerProof.privateEmptyText, "No private results visible");
});

test("core-loop proof fixture module derives seeded role URLs and endpoints", () => {
  const proof = seededCoreLoopPlayerSurfaceFixture({
    game: "game-a",
    roleUrlSuffix: "?private=notification-1",
    slotField: "survivorSlot",
    slot: "slot-5",
    principalUserId: "player_sage",
    phaseId: "D05",
    phaseState: "open",
    actorAlive: false,
    actorStatus: "dead",
    actionState: "disabled:actor is not alive",
    statusText: "Player action unavailable: actor is not alive",
    privateCount: 1,
    privateReceipt: true,
    privateReceiptStatus: "factional_kill",
    privateReceiptPhaseId: "N04",
    boundary: "survivor stayed dead",
    resyncFromSeq: 917,
  });

  assert.equal(
    proof.sourceRoleUrl,
    "http://127.0.0.1:5173/g/game-a?private=notification-1",
  );
  assert.equal(proof.visitedRolePath, "/g/game-a?private=notification-1");
  assert.equal(
    proof.coldLoadEndpoints.commandStateEndpoint,
    "/games/game-a/player-command-state?principal_user_id=player_sage&slot_id=slot-5",
  );
  assert.equal(
    proof.coldLoadEndpoints.notificationsEndpoint,
    "/games/game-a/notifications?principal_user_id=player_sage",
  );
  assert.equal(proof.privateNotice.detailText, "Phase N04");
});

test("core-loop proof fixture module derives seeded host proof shells", () => {
  const proof = seededCoreLoopHostSurfaceFixture({
    game: "game-a",
    setupResyncFromSeq: 920,
    setupSnapshotHost: {
      completed: false,
      phase: { id: "N05", state: "open" },
    },
    completeProof: { id: "complete-game-proof" },
  });

  assert.equal(proof.sourceRoleUrl, "http://127.0.0.1:5173/g/game-a/host");
  assert.equal(proof.visitedRolePath, "/g/game-a/host");
  assert.equal(proof.surfaceTestId, "host-console-surface");
  assert.equal(proof.setupResyncFromSeq, 920);
  assert.deepEqual(proof.setupSnapshotHost, {
    completed: false,
    phase: { id: "N05", state: "open" },
  });
  assert.deepEqual(proof.completeProof, { id: "complete-game-proof" });
  assert.equal(proof.rawInviteTokensVisible, false);
});

test("core-loop surface fixture module builds post-Day-3 resolution surface", () => {
  const surface = postDayThreeResolutionSurfaceFixture({ game: "game-a" });

  assert.equal(surface.sourceHostRoleUrl, "http://127.0.0.1:5173/g/game-a/host");
  assert.equal(surface.sourceActionPlayerRoleUrl, "http://127.0.0.1:5173/g/game-a");
  assert.equal(
    surface.sourceTargetRoleUrl,
    "http://127.0.0.1:5173/g/game-a?private=notification-1",
  );
  assert.equal(surface.targetReceiptProof.targetSlot, "slot-4");
  assert.equal(surface.hostAdvanceProof.advanceProof.commandKind, "AdvancePhase");
  assert.equal(surface.hostAdvanceProof.setupSnapshotHost.phase.id, "D03");
  assert.equal(
    surface.actionPlayerNightThreeProof.projectionCommandState.phase.phaseId,
    "N03",
  );
});

test("completed-game scenario module derives shared assertion cases", () => {
  const completedGameEndgameSurface =
    completedGameEndgameSurfaceProofFieldsFixture();
  const roleUrlsByField = {
    sourceActionPlayerRoleUrl:
      completedGameEndgameSurface.sourceActionPlayerRoleUrl,
    sourceNormalPlayerRoleUrl:
      completedGameEndgameSurface.sourceNormalPlayerRoleUrl,
    sourceDeadPlayerRoleUrl:
      completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
  };

  assert.deepEqual(
    completedPlayerReloadAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      cases: completedPlayerReloadCases(),
    }).map((scenario) => ({
      proof: scenario.proof,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedSlot: scenario.expectedSlot,
      principalUserId: scenario.principalUserId,
    })),
    completedPlayerReloadCases().map((scenario) => ({
      proof: { id: `reload:${scenario.proofField}` },
      sourceRoleUrl: roleUrlsByField[scenario.sourceRoleUrlField],
      expectedSlot: scenario.expectedSlot,
      principalUserId: scenario.principalUserId,
    })),
  );

  assert.deepEqual(
    completedGameEndgameStaleRejectAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceHostRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
      sourceDeadPlayerRoleUrl:
        completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
      sourceActionPlayerRoleUrl:
        completedGameEndgameSurface.sourceActionPlayerRoleUrl,
      assertCompletedHostStaleCommandRecoveryProof: assertProofFixture,
      assertCompletedDeadPlayerStaleVoteRecoveryProof: assertProofFixture,
      assertStaleCompletedGamePlayerCommandRecoveryProof: assertProofFixture,
    }).map((scenario) => ({
      proof: scenario.proof,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedCommandKind: scenario.expectedCommandKind ?? null,
      commandKind: scenario.scenario?.commandKind ?? null,
    })),
    [
      ...completedHostStaleCommandCases().map((scenario) => ({
        proof: { id: `host-stale:${scenario.proofField}` },
        sourceRoleUrl: completedGameEndgameSurface.sourceHostRoleUrl,
        expectedCommandKind: scenario.commandKind,
        commandKind: null,
      })),
      {
        proof: { id: "dead-player-stale-vote" },
        sourceRoleUrl: completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      ...staleCompletedGamePlayerCommandCases().map((scenario) => ({
        proof: { id: `player-stale:${scenario.proofField}` },
        sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
        expectedCommandKind: null,
        commandKind: scenario.commandKind,
      })),
    ],
  );
});

test("completed-game scenario module derives terminal feature-spine rows", () => {
  assert.deepEqual(completedGameEndgameFeatureSpineRows({ cycleId: "d05-n05" }), [
    {
      targetKey: "completedGameHostComplete",
      featureSlotId: "completed-game-host-complete",
      cycleId: "d05-n05",
      role: "host",
      checkpointId: "d05-n05-n05-complete-game",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "completedGameHostReload",
      featureSlotId: "completed-game-host-reload",
      cycleId: "d05-n05",
      role: "host",
      checkpointId: "d05-n05-n05-completed-host-reload",
      adminCheckId: "core-loop",
    },
    {
      targetKey: "completedGamePlayerSurface",
      featureSlotId: "completed-game-player-surface",
      cycleId: "d05-n05",
      role: "actionPlayer",
      checkpointId: "d05-n05-n05-completed-player-surface",
      adminCheckId: "core-loop",
    },
  ]);
});

test("completed-game scenario module derives command-specific stale feature rows", () => {
  assert.deepEqual(
    completedGameStaleCommandFeatureSpineRows({ cycleId: "d05-n05" }),
    [
      {
        targetKey: "completedHostStaleResolve",
        featureSlotId: "completed-game-host-stale-resolve-reject",
        cycleId: "d05-n05",
        role: "host",
        roleUrlId: "completed-game-host-stale-resolve-reject",
        checkpointId: "completed-game-host-stale-resolve-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedHostStaleResolveRecoveryProof",
      },
      {
        targetKey: "completedHostStaleAdvance",
        featureSlotId: "completed-game-host-stale-advance-reject",
        cycleId: "d05-n05",
        role: "host",
        roleUrlId: "completed-game-host-stale-advance-reject",
        checkpointId: "completed-game-host-stale-advance-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedHostStaleAdvanceRecoveryProof",
      },
      {
        targetKey: "completedHostStaleComplete",
        featureSlotId: "completed-game-host-stale-complete-reject",
        cycleId: "d05-n05",
        role: "host",
        roleUrlId: "completed-game-host-stale-complete-reject",
        checkpointId: "completed-game-host-stale-complete-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedHostStaleCompleteRecoveryProof",
      },
      {
        targetKey: "staleCompletedVote",
        featureSlotId: "completed-game-stale-player-submit-vote-reject",
        cycleId: "d05-n05",
        role: "actionPlayer",
        roleUrlId: "completed-game-stale-player-submit-vote-reject",
        checkpointId: "completed-game-stale-player-submit-vote-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "staleCompletedVoteRecoveryProof",
      },
      {
        targetKey: "staleCompletedPost",
        featureSlotId: "completed-game-stale-player-submit-post-reject",
        cycleId: "d05-n05",
        role: "actionPlayer",
        roleUrlId: "completed-game-stale-player-submit-post-reject",
        checkpointId: "completed-game-stale-player-submit-post-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "staleCompletedPostRecoveryProof",
      },
    ],
  );
});

test("completed-game scenario module derives player reload feature rows", () => {
  assert.deepEqual(
    completedGamePlayerReloadFeatureSpineRows({ cycleId: "d05-n05" }),
    [
      {
        targetKey: "completedPlayerReload",
        featureSlotId: "completed-game-action-player-reload",
        cycleId: "d05-n05",
        role: "actionPlayer",
        roleUrlId: "completed-game-action-player-reload",
        checkpointId: "completed-game-action-player-reload",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedPlayerReloadProof",
      },
      {
        targetKey: "completedNormalPlayerReload",
        featureSlotId: "completed-game-normal-player-reload",
        cycleId: "d05-n05",
        role: "normalPlayer",
        roleUrlId: "completed-game-normal-player-reload",
        checkpointId: "completed-game-normal-player-reload",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedNormalPlayerReloadProof",
      },
      {
        targetKey: "completedDeadPlayerReload",
        featureSlotId: "completed-game-dead-player-reload",
        cycleId: "d05-n05",
        role: "deadPlayer",
        roleUrlId: "completed-game-dead-player-reload",
        checkpointId: "completed-game-dead-player-reload",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedDeadPlayerReloadProof",
      },
    ],
  );
});

test("completed-game scenario module derives dead-player stale vote feature row", () => {
  assert.deepEqual(
    completedGameDeadPlayerStaleVoteFeatureSpineRows({ cycleId: "d05-n05" }),
    [
      {
        targetKey: "completedDeadPlayerStaleVote",
        featureSlotId: "completed-game-dead-player-stale-submit-vote-reject",
        cycleId: "d05-n05",
        role: "deadPlayer",
        roleUrlId: "completed-game-dead-player-stale-submit-vote-reject",
        checkpointId: "completed-game-dead-player-stale-submit-vote-reject",
        adminCheckId: "completed-game-hardening-coverage",
        proofField: "completedDeadPlayerStaleVoteRecoveryProof",
      },
    ],
  );
});

test("completed-game scenario module maps every endgame recovery proof field once", () => {
  const rows = completedGameEndgameRecoveryFeatureSpineRows({
    cycleId: "d05-n05",
  });
  assert.deepEqual(
    rows.map((row) => row.proofField),
    [
      "completedHostStaleResolveRecoveryProof",
      "completedHostStaleAdvanceRecoveryProof",
      "completedHostStaleCompleteRecoveryProof",
      "staleCompletedVoteRecoveryProof",
      "staleCompletedPostRecoveryProof",
      "completedPlayerReloadProof",
      "completedNormalPlayerReloadProof",
      "completedDeadPlayerReloadProof",
      "completedDeadPlayerStaleVoteRecoveryProof",
    ],
  );
  assert.equal(new Set(rows.map((row) => row.proofField)).size, rows.length);
  assert.equal(new Set(rows.map((row) => row.featureSlotId)).size, rows.length);
});

test("completed-game scenario module derives stale host and dead-player assertion cases", () => {
  const completedGameEndgameSurface = {
    completedHostStaleResolveRecoveryProof: { id: "host-resolve-stale" },
    completedHostStaleAdvanceRecoveryProof: { id: "host-advance-stale" },
    completedHostStaleCompleteRecoveryProof: { id: "host-complete-stale" },
    completedDeadPlayerStaleVoteRecoveryProof: { id: "dead-stale-vote" },
  };
  const [resolveScenario, advanceScenario, completeScenario] =
    completedHostStaleCommandCases();
  const deadPlayerScenario = completedDeadPlayerStaleVoteCase();

  assert.deepEqual(
    completedHostStaleCommandProofArgs({
      expectedGame: "game-a",
      sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
      scenario: resolveScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
      expectedCommandKind: "ResolvePhase",
    },
  );
  assert.deepEqual(
    completedHostStaleCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceHostRoleUrl: "http://127.0.0.1/g/game-a/host",
      assertCompletedHostStaleCommandRecoveryProof: assertProofFixture,
    }),
    [
      {
        assertProof: assertProofFixture,
        proof: { id: "host-resolve-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "ResolvePhase",
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "host-advance-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "AdvancePhase",
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "host-complete-stale" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: "CompleteGame",
      },
    ],
  );
  assert.deepEqual(
    [resolveScenario, advanceScenario, completeScenario].map(
      (scenario) => [scenario.actionId, scenario.commandKind],
    ),
    [
      ["resolve_phase", "ResolvePhase"],
      ["advance_phase", "AdvancePhase"],
      ["complete_game", "CompleteGame"],
    ],
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteProofArgs({
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    },
  );
  assert.deepEqual(
    completedDeadPlayerStaleVoteAssertionCase({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      assertCompletedDeadPlayerStaleVoteRecoveryProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: { id: "dead-stale-vote" },
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/dead",
      scenario: deadPlayerScenario,
    },
  );
});

test("completed-game scenario module derives action-player completed surface case", () => {
  const completedGameEndgameSurface = {
    actionPlayerCompletedProof: { id: "action-player-complete" },
    sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
  };

  assert.deepEqual(
    completedActionPlayerSurfaceProofArgs({
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
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
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  );
  assert.deepEqual(
    completedActionPlayerSurfaceAssertionCase({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      assertActionPlayerCompletedProof: assertProofFixture,
    }),
    {
      assertProof: assertProofFixture,
      proof: { id: "action-player-complete" },
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
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
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  );
});

test("completed-game scenario module derives stale completed-player command assertion cases", () => {
  const completedGameEndgameSurface = {
    staleCompletedVoteRecoveryProof: { id: "stale-completed-vote" },
    staleCompletedPostRecoveryProof: { id: "stale-completed-post" },
  };
  const [voteScenario, postScenario] = staleCompletedGamePlayerCommandCases();

  assert.deepEqual(
    staleCompletedGamePlayerCommandProofArgs({
      expectedGame: "game-a",
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      scenario: voteScenario,
    }),
    {
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
      scenario: voteScenario,
    },
  );
  assert.deepEqual(
    staleCompletedGamePlayerCommandAssertionCases({
      completedGameEndgameSurface,
      expectedGame: "game-a",
      sourceActionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
      assertStaleCompletedGamePlayerCommandRecoveryProof: assertProofFixture,
    }),
    [
      {
        assertProof: assertProofFixture,
        proof: { id: "stale-completed-vote" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        scenario: voteScenario,
      },
      {
        assertProof: assertProofFixture,
        proof: { id: "stale-completed-post" },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        scenario: postScenario,
      },
    ],
  );
});

test("completed-game scenario module derives shared surface assertion sequence", () => {
  const completedGameEndgameSurface =
    completedGameEndgameSurfaceProofFieldsFixture();
  const asserted = [];
  const scenarioFamilies = completedGameEndgameScenarioCaseFamilies();
  const cases = completedGameEndgameSurfaceAssertionCases({
    completedGameEndgameSurface,
    expectedGame: "game-a",
    assertHostCompleteGameProof: recordAssertion("host-complete", asserted),
    assertCompletedHostReloadProof: recordAssertion("host-reload", asserted),
    assertActionPlayerCompletedProof: recordAssertion(
      "action-player-complete",
      asserted,
    ),
    assertCompletedHostStaleCommandRecoveryProof: recordAssertion(
      "host-stale",
      asserted,
    ),
    assertCompletedDeadPlayerStaleVoteRecoveryProof: recordAssertion(
      "dead-stale-vote",
      asserted,
    ),
    assertCompletedPlayerReloadProof: recordAssertion(
      "player-reload",
      asserted,
    ),
    assertStaleCompletedGamePlayerCommandRecoveryProof: recordAssertion(
      "player-stale",
      asserted,
    ),
    scenarioFamilies,
  });

  assert.deepEqual(
    cases.map((scenario) => ({
      assertProofName: scenario.assertProof.assertionName,
      proof: scenario.proof.id,
      sourceRoleUrl: scenario.sourceRoleUrl,
      expectedCommandKind: scenario.expectedCommandKind ?? null,
      commandKind: scenario.scenario?.commandKind ?? null,
    })),
    [
      {
        assertProofName: "host-complete",
        proof: "host-complete",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "host-reload",
        proof: "host-reload",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: null,
        commandKind: null,
      },
      {
        assertProofName: "action-player-complete",
        proof: "action-player-complete",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
        expectedCommandKind: null,
        commandKind: null,
      },
      ...completedPlayerReloadCases().map((scenario) => ({
        assertProofName: "player-reload",
        proof: `reload:${scenario.proofField}`,
        sourceRoleUrl:
          completedGameEndgameSurface[scenario.sourceRoleUrlField],
        expectedCommandKind: null,
        commandKind: null,
      })),
      ...completedHostStaleCommandCases().map((scenario) => ({
        assertProofName: "host-stale",
        proof: `host-stale:${scenario.proofField}`,
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        expectedCommandKind: scenario.commandKind,
        commandKind: null,
      })),
      {
        assertProofName: "dead-stale-vote",
        proof: "dead-player-stale-vote",
        sourceRoleUrl: completedGameEndgameSurface.sourceDeadPlayerRoleUrl,
        expectedCommandKind: null,
        commandKind: "SubmitVote",
      },
      ...staleCompletedGamePlayerCommandCases().map((scenario) => ({
        assertProofName: "player-stale",
        proof: `player-stale:${scenario.proofField}`,
        sourceRoleUrl: completedGameEndgameSurface.sourceActionPlayerRoleUrl,
        expectedCommandKind: null,
        commandKind: scenario.commandKind,
      })),
    ],
  );

  assertCompletedGameEndgameSurfaceAssertionCases({
    cases,
    completedGameEndgameSurface,
  });
  assert.deepEqual(asserted, [
    "host-complete",
    "host-reload",
    "action-player-complete",
    "player-reload",
    "player-reload",
    "player-reload",
    "host-stale",
    "host-stale",
    "host-stale",
    "dead-stale-vote",
    "player-stale",
    "player-stale",
  ]);
});

test("completed-game scenario module asserts host complete-game proof shell", () => {
  const hostPhaseAssertions = [];
  const proof = hostCompleteGameProofFixture();

  assertHostCompleteGameProofCase({
    proof,
    expectedGame: "game-a",
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    assertHostPhaseTransitionActionProof: (scenario) => {
      hostPhaseAssertions.push(scenario);
    },
  });

  assert.deepEqual(hostPhaseAssertions, [
    {
      proof: proof.completeProof,
      expectedGame: "game-a",
      actionId: "complete_game",
      commandKind: "CompleteGame",
      streamSeq: 921,
      expectedPhaseId: "N05",
      expectedPhaseState: "open",
      expectedDeadlineAffordance: "none",
      expectedRefreshKeys: [],
      sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    },
  ]);
});

test("completed-game scenario module asserts completed host reload shell", () => {
  assertCompletedHostReloadProofCase({
    proof: completedHostReloadProofFixture({
      sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
      snapshot: completedHostReloadSnapshotFixture(),
    }),
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
  });
});

test("completed-game scenario module delegates action-player completed assertion", () => {
  const asserted = [];
  const proof = { id: "action-player-complete" };
  assertCompletedActionPlayerSurfaceProofCase({
    proof,
    expectedGame: "game-a",
    sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
    assertPostDayThreePlayerSurfaceProof: (scenario) => {
      asserted.push(scenario);
    },
  });

  assert.deepEqual(asserted, [
    {
      proof,
      expectedGame: "game-a",
      sourceRoleUrl: "http://127.0.0.1/g/game-a/action",
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
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      expectedNotificationsEndpoint:
        "/games/game-a/notifications?principal_user_id=player_mira",
      expectedLastVoteOutcomePhaseId: "D05",
    },
  ]);
});

test("completed-game shared host assertions fail closed", () => {
  assert.throws(
    () =>
      assertHostCompleteGameProofCase({
        proof: {
          ...hostCompleteGameProofFixture(),
          setupSnapshotHost: { phase: { id: "D05", state: "open" } },
        },
        expectedGame: "game-a",
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
        assertHostPhaseTransitionActionProof: assertProofFixture,
      }),
    /host complete-game setup/,
  );
  assert.throws(
    () =>
      assertCompletedHostReloadProofCase({
        proof: {
          ...completedHostReloadProofFixture({
            sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
            visitedRolePath: "/g/game-a/host",
            snapshot: completedHostReloadSnapshotFixture(),
          }),
          reloadedSnapshot: {
            ...completedHostReloadSnapshotFixture(),
            actionTiles: [{ action: "complete_game" }],
          },
        },
        sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
      }),
    /reloaded completed host reload closure/,
  );
});

test("completed-game shared surface assertion fails closed", () => {
  assert.throws(
    () =>
      assertCompletedGameEndgameSurfaceProof({
        completedGameEndgameSurface: {
          status: "passed",
          clickedThroughFromRoleUrl: true,
          releaseReady: false,
          productionReady: false,
        },
        assertHostPhaseTransitionActionProof: assertProofFixture,
        assertPostDayThreePlayerSurfaceProof: assertProofFixture,
      }),
    /completed-game endgame surface/,
  );
});

test("completed-game fixture satisfies the shared endgame assertion", () => {
  assert.doesNotThrow(() =>
    assertCompletedGameEndgameSurfaceProof({
      completedGameEndgameSurface: completedGameEndgameSurfaceFixture(),
      assertHostPhaseTransitionActionProof: assertProofFixture,
      assertPostDayThreePlayerSurfaceProof: assertProofFixture,
    }),
  );
  assert.doesNotThrow(() =>
    assertCoreLoopCompletedEndgameProgressionSurfaceProof({
      completedGameEndgameSurface: completedGameEndgameSurfaceFixture(),
      assertHostPhaseTransitionActionProof: assertProofFixture,
      assertPostDayThreePlayerSurfaceProof: assertProofFixture,
    }),
  );
  assert.doesNotThrow(() =>
    assertCompletedGameProofReadinessSurfaceProof({
      completedGameEndgameSurface: completedGameEndgameSurfaceFixture(),
      assertHostPhaseTransitionActionProof: assertProofFixture,
      assertPostDayThreePlayerSurfaceProof: assertProofFixture,
    }),
  );
});

test("completed-game transition covers every stale and reload scenario", () => {
  const scenarioFamilies = completedGameEndgameScenarioCaseFamilies();
  const transition = completedGameEndgameTransition({ scenarioFamilies });
  assertCompletedGameEndgameTransition({ transition, scenarioFamilies });
  for (const scenario of [
    ...scenarioFamilies.completedHostStaleCommandCases,
    ...scenarioFamilies.completedPlayerReloadCases,
    scenarioFamilies.completedDeadPlayerStaleVoteCase,
    ...scenarioFamilies.staleCompletedGamePlayerCommandCases,
  ]) {
    assert.match(transition, new RegExp(escapeRegExp(scenario.transitionToken)));
  }
});

test("completed-game reload proof cases fail closed for unknown command state", () => {
  assert.throws(
    () =>
      completedPlayerReloadProofCases({
        actionPlayerRoleUrl: "http://127.0.0.1/g/game-a/action",
        normalPlayerRoleUrl: "http://127.0.0.1/g/game-a/normal",
        deadPlayerRoleUrl: "http://127.0.0.1/g/game-a/dead",
        commandStateBuilders: {},
      }),
    /unknown completed player reload command state: action-player/,
  );
});

function commandStateBuildersFixture() {
  return {
    "action-player": ({ boundary }) => ({ kind: "action", boundary }),
    "normal-player": ({ boundary }) => ({ kind: "normal", boundary }),
    "dead-player": ({ boundary }) => ({ kind: "dead", boundary }),
  };
}

function assertProofFixture() {}

function hostCompleteGameProofFixture() {
  return {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    rawInviteTokensVisible: false,
    sourceRoleUrl: "http://127.0.0.1/g/game-a/host",
    visitedRolePath: "/g/game-a/host",
    surfaceTestId: "host-console-surface",
    setupResyncFromSeq: 920,
    setupSnapshotHost: {
      phase: { id: "N05", state: "open" },
      completed: false,
    },
    completeProof: {
      projection: {
        completed: true,
        slots: [
          { role_revealed: true, alignment_revealed: true },
          { role_revealed: true, alignment_revealed: true },
        ],
      },
    },
  };
}

function recordAssertion(assertionName, asserted) {
  const assertProof = () => {
    asserted.push(assertionName);
  };
  assertProof.assertionName = assertionName;
  return assertProof;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
