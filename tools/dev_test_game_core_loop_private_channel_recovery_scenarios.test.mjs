import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertCoreLoopPrivateChannelRecoveryCoverageSummary,
  buildCoreLoopPrivateChannelRecoveryCoverageSummary,
  completedPrivateChannelReloadScenario,
  completedPrivateChannelTransitionTokens,
  coreLoopPrivateChannelCompletedFeatureTargetKind,
  coreLoopPrivateChannelCompletedPostLaneId,
  coreLoopPrivateChannelInvalidActionFeatureTargetKind,
  coreLoopPrivateChannelRecoveryCoverageFamilies,
  coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions,
  coreLoopPrivateChannelInvalidActionLaneId,
  coreLoopPrivateChannelRecoveryFamilyId,
  coreLoopPrivateChannelRecoveryLaneIds,
  coreLoopPrivateChannelRecoveryScenarioCases,
  coreLoopPrivateChannelRecoveryScenarioFamily,
  coreLoopPrivateChannelPostLaneId,
  coreLoopPrivateChannelStalePostFeatureTargetKind,
  coreLoopPrivateChannelStalePostLaneId,
  privateChannelCompletedFeatureSpineRow,
  privateChannelInvalidActionFeatureSpineRow,
  privateChannelRoleUrlFromPlayerRoleUrl,
  privateChannelRoleUrlWithFallback,
  privateChannelInvalidActionRecoveryScenario,
  privateChannelStalePostFeatureSpineRow,
  privateChannelSubmitPostScenario,
  staleCompletedPrivatePostScenario,
  stalePrivateChannelPostPhaseLockedScenario,
} from "./dev_test_game_core_loop_private_channel_recovery_scenarios.mjs";

test("private-channel recovery family shares post, reload, and stale recovery cases", () => {
  assert.equal(
    coreLoopPrivateChannelRecoveryFamilyId,
    "core-loop-private-channel-recovery",
  );
  assert.equal(coreLoopPrivateChannelPostLaneId, "private-channel");
  assert.equal(
    coreLoopPrivateChannelStalePostLaneId,
    "private-channel-stale-post-after-transition",
  );
  assert.equal(
    coreLoopPrivateChannelCompletedPostLaneId,
    "private-channel-completed-game-recovery",
  );
  assert.equal(
    coreLoopPrivateChannelInvalidActionLaneId,
    "private-channel-invalid-action-recovery",
  );
  const scenarioCases = coreLoopPrivateChannelRecoveryScenarioCases();
  assert.deepEqual(
    scenarioCases.map((scenarioCase) => ({
      key: scenarioCase.key,
      staleRejectKey: scenarioCase.staleRejectKey,
      reloadKey: scenarioCase.reloadKey,
      laneId: scenarioCase.laneId,
      coverage: scenarioCase.coverage,
      scenario: scenarioCase.scenario,
    })),
    [
      {
        key: "submitPost",
        staleRejectKey: undefined,
        reloadKey: undefined,
        laneId: coreLoopPrivateChannelPostLaneId,
        coverage: {
          id: "core-loop-private-channel-post",
          label: "Private channel post and role URL",
        },
        scenario: privateChannelSubmitPostScenario(),
      },
      {
        key: "stalePostAfterPhaseTransition",
        staleRejectKey: "stalePostAfterPhaseTransition",
        reloadKey: undefined,
        laneId: coreLoopPrivateChannelStalePostLaneId,
        coverage: {
          id: "core-loop-private-channel-stale-post",
          label: "Private channel stale post recovery",
        },
        scenario: stalePrivateChannelPostPhaseLockedScenario(),
      },
      {
        key: "completedPrivateChannelReload",
        staleRejectKey: undefined,
        reloadKey: "completedPrivateChannel",
        laneId: coreLoopPrivateChannelCompletedPostLaneId,
        coverage: {
          id: "core-loop-private-channel-completed-game",
          label: "Completed private-channel recovery",
        },
        scenario: completedPrivateChannelReloadScenario(),
      },
      {
        key: "staleCompletedPrivatePost",
        staleRejectKey: "staleCompletedPrivatePost",
        reloadKey: undefined,
        laneId: coreLoopPrivateChannelCompletedPostLaneId,
        coverage: undefined,
        scenario: staleCompletedPrivatePostScenario(),
      },
      {
        key: "invalidActionRecovery",
        staleRejectKey: "invalidActionRecovery",
        reloadKey: undefined,
        laneId: coreLoopPrivateChannelInvalidActionLaneId,
        coverage: {
          id: "core-loop-private-channel-invalid-action",
          label: "Private channel invalid action recovery",
        },
        scenario: privateChannelInvalidActionRecoveryScenario(),
      },
    ],
  );
  assert.notEqual(
    coreLoopPrivateChannelRecoveryScenarioCases()[0].scenario,
    coreLoopPrivateChannelRecoveryScenarioCases()[0].scenario,
  );
  assert.notEqual(
    coreLoopPrivateChannelRecoveryScenarioCases()[0].scenario
      .expectedRefreshKeys,
    coreLoopPrivateChannelRecoveryScenarioCases()[0].scenario
      .expectedRefreshKeys,
  );
  assert.deepEqual(coreLoopPrivateChannelRecoveryLaneIds, [
    coreLoopPrivateChannelPostLaneId,
    coreLoopPrivateChannelStalePostLaneId,
    coreLoopPrivateChannelCompletedPostLaneId,
    coreLoopPrivateChannelInvalidActionLaneId,
  ]);

  const family = coreLoopPrivateChannelRecoveryScenarioFamily();
  assert.equal(family.id, coreLoopPrivateChannelRecoveryFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPrivateChannelRecoveryLaneIds);
  assert.deepEqual(
    family.transitionTokens,
    completedPrivateChannelTransitionTokens(),
  );
  assert.deepEqual(family.scenarios.submitPost, privateChannelSubmitPostScenario());
  assert.deepEqual(
    family.scenarios.stalePostAfterPhaseTransition,
    stalePrivateChannelPostPhaseLockedScenario(),
  );
  assert.deepEqual(
    family.scenarios.invalidActionRecovery,
    privateChannelInvalidActionRecoveryScenario(),
  );
  assert.deepEqual(
    family.reloads.completedPrivateChannel,
    completedPrivateChannelReloadScenario(),
  );
  assert.deepEqual(
    family.staleRejects.staleCompletedPrivatePost,
    staleCompletedPrivatePostScenario(),
  );
  assert.deepEqual(
    family.staleRejects.invalidActionRecovery,
    privateChannelInvalidActionRecoveryScenario(),
  );
});

test("private-channel recovery feature rows promote browser proofs", () => {
  assert.deepEqual(
    privateChannelStalePostFeatureSpineRow({
      cycleId: "d01-n01-d02",
      roleUrlId: "d01-n01-d02-privateChannel",
    }),
    {
      targetKey: "privateChannelStalePostRecovery",
      featureSlotId: coreLoopPrivateChannelStalePostLaneId,
      cycleId: "d01-n01-d02",
      role: "privateChannel",
      roleUrlId: "d01-n01-d02-privateChannel",
      checkpointId: "d01-n01-d02-d02-day-controls-return",
      adminCheckId: coreLoopPrivateChannelPostLaneId,
      featureTargetKind: coreLoopPrivateChannelStalePostFeatureTargetKind,
    },
  );
  assert.deepEqual(
    privateChannelCompletedFeatureSpineRow({
      cycleId: "d05-n05",
      roleUrlId: "d01-n01-d02-privateChannel",
    }),
    {
      targetKey: "privateChannelCompletedRecovery",
      featureSlotId: coreLoopPrivateChannelCompletedPostLaneId,
      cycleId: "d05-n05",
      role: "privateChannel",
      roleUrlId: "d01-n01-d02-privateChannel",
      checkpointId: "d05-n05-n05-completed-player-surface",
      adminCheckId: coreLoopPrivateChannelPostLaneId,
      featureTargetKind: coreLoopPrivateChannelCompletedFeatureTargetKind,
    },
  );
  assert.deepEqual(
    privateChannelInvalidActionFeatureSpineRow({
      cycleId: "d01-n01-d02",
      roleUrlId: "d01-n01-d02-privateChannel",
    }),
    {
      targetKey: "privateChannelInvalidActionRecovery",
      featureSlotId: coreLoopPrivateChannelInvalidActionLaneId,
      cycleId: "d01-n01-d02",
      role: "privateChannel",
      roleUrlId: "d01-n01-d02-privateChannel",
      checkpointId: "d01-n01-d02-n01-action-open",
      adminCheckId: coreLoopPrivateChannelPostLaneId,
      featureTargetKind: coreLoopPrivateChannelInvalidActionFeatureTargetKind,
    },
  );
});

test("private-channel recovery coverage uses core-loop lane families", () => {
  assert(Object.isFrozen(coreLoopPrivateChannelRecoveryCoverageFamilyDefinitions));
  assert.deepEqual(
    coreLoopPrivateChannelRecoveryCoverageFamilies().map((family) => ({
      id: family.id,
      laneIds: family.laneIds,
    })),
    [
      {
        id: "core-loop-private-channel-post",
        laneIds: [coreLoopPrivateChannelPostLaneId],
      },
      {
        id: "core-loop-private-channel-stale-post",
        laneIds: [coreLoopPrivateChannelStalePostLaneId],
      },
      {
        id: "core-loop-private-channel-completed-game",
        laneIds: [coreLoopPrivateChannelCompletedPostLaneId],
      },
      {
        id: "core-loop-private-channel-invalid-action",
        laneIds: [coreLoopPrivateChannelInvalidActionLaneId],
      },
    ],
  );
  const lanes = coreLoopPrivateChannelRecoveryLaneIds.map((id) => ({
    id,
    status: "passed",
  }));
  const summary = buildCoreLoopPrivateChannelRecoveryCoverageSummary(lanes);

  assert.deepEqual(summary.sourceLaneIds, coreLoopPrivateChannelRecoveryLaneIds);
  assert.equal(summary.familyCount, 4);
  assert.equal(
    summary.passedLaneCount,
    coreLoopPrivateChannelRecoveryLaneIds.length,
  );
  assert.equal(
    assertCoreLoopPrivateChannelRecoveryCoverageSummary({ summary, lanes }),
    summary,
  );
});

test("private-channel role URL helper preserves explicit channel or derives fallback", () => {
  assert.equal(
    privateChannelRoleUrlWithFallback({
      privateChannelRoleUrl:
        "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
      playerRoleUrl: "http://127.0.0.1:5173/g/game-a?x=1",
    }),
    "http://127.0.0.1:5173/g/game-a/c/private%3Amafia_day_chat",
  );
  assert.equal(
    privateChannelRoleUrlFromPlayerRoleUrl(
      "http://127.0.0.1:5173/g/game-a?x=1",
    ),
    "http://127.0.0.1:5173/g/game-a/c/private%3Arole_pm%3Aslot-7?private=notification-1",
  );
  assert.equal(
    privateChannelRoleUrlWithFallback({
      playerRoleUrl: "http://127.0.0.1:5173/g/game-a/",
    }),
    "http://127.0.0.1:5173/g/game-a/c/private%3Arole_pm%3Aslot-7?private=notification-1",
  );
  assert.throws(
    () => privateChannelRoleUrlWithFallback({}),
    /private channel proof missing source player role URL/,
  );
});

test("private-channel recovery family imports case-only scenario definitions", async () => {
  const recoverySource = await readFile(
    "tools/dev_test_game_core_loop_private_channel_recovery_scenarios.mjs",
    "utf8",
  );
  const assertionSource = await readFile(
    "tools/dev_test_game_core_loop_private_channel_scenario_assertions.mjs",
    "utf8",
  );

  assert(
    recoverySource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs",
    ),
    "private-channel recovery family should derive scenarios from the case-only module",
  );
  assert(
    !recoverySource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_assertions.mjs",
    ),
    "private-channel recovery family should not import scenario cases through assertion helpers",
  );
  assert(
    assertionSource.includes(
      "./dev_test_game_core_loop_private_channel_scenario_case_definitions.mjs",
    ),
    "private-channel assertions should consume shared case definitions",
  );
  assert(
    !/export\s+function\s+completedPrivateChannelReloadScenario\b/.test(
      assertionSource,
    ) &&
      !/export\s+function\s+staleCompletedPrivatePostScenario\b/.test(
        assertionSource,
      ),
    "private-channel assertions should not redefine raw scenario cases",
  );
});
