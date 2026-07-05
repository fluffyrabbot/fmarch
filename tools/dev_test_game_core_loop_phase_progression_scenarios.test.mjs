import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertDayFourSurvivorRoleSurfaceCase,
  assertNightThreeEmptyResolutionSurfaceCase,
  coreLoopPhaseProgressionAliasOnlyProofLaneIds,
  coreLoopPhaseProgressionDemoOnlySeedScenarioIds,
  coreLoopPhaseProgressionFamilyId,
  coreLoopPhaseProgressionLaneIds,
  coreLoopPhaseProgressionRequiredSeedScenarioIds,
  coreLoopPhaseProgressionScenarioCases,
  coreLoopPhaseProgressionScenarioFamily,
  coreLoopPhaseProgressionSeedAliasEntries,
  coreLoopPhaseProgressionSpineSourceLaneIds,
  dayFourSurvivorRoleSurfaceCase,
  nightThreeActionResolutionLaneId,
  nightThreeEmptyResolutionSurfaceCase,
} from "./dev_test_game_core_loop_phase_progression_scenarios.mjs";
import {
  staleDayTwoVoteAfterTransitionRecoveryScenario,
  staleNightOneActionAfterTransitionRecoveryScenario,
} from "./dev_test_game_core_loop_action_scenario_cases.mjs";
import {
  coreLoopVoteResolutionScenarioFamily,
} from "./dev_test_game_core_loop_vote_resolution_scenarios.mjs";
import {
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";

test("core loop phase progression family names proof, seed, and stale reject cases", () => {
  assert.equal(
    coreLoopPhaseProgressionFamilyId,
    "core-loop-phase-progression",
  );
  assert.deepEqual(coreLoopPhaseProgressionLaneIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
    nightThreeActionResolutionLaneId,
    "action-loop",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionSpineSourceLaneIds, [
    "core-loop",
    "day-vote-resolution",
    "action-loop",
    "resolution-receipts",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionRequiredSeedScenarioIds, [
    "night-action-loop",
    nightThreeActionResolutionLaneId,
  ]);
  assert.deepEqual(coreLoopPhaseProgressionDemoOnlySeedScenarioIds, [
    "day-vote-resolution",
    "day-vote-no-lynch",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionAliasOnlyProofLaneIds, [
    "action-loop",
    "stale-action-conflict",
  ]);
  assert.deepEqual(coreLoopPhaseProgressionSeedAliasEntries, [
    ["night-action-loop", ["action-loop", "stale-action-conflict"]],
  ]);
  const scenarioCases = coreLoopPhaseProgressionScenarioCases();
  assert.deepEqual(
    scenarioCases.map((scenarioCase) => ({
      key: scenarioCase.key,
      group: scenarioCase.group,
      scenario: scenarioCase.scenario,
    })),
    [
      {
        key: "dayThreeVoteResolution",
        group: "surfaces",
        scenario:
          coreLoopVoteResolutionScenarioFamily().surfaces.dayThreeVoteResolution,
      },
      {
        key: "postDayThreeResolution",
        group: "surfaces",
        scenario: postDayThreeResolutionSurfaceCase(),
      },
      {
        key: "nightThreeEmptyResolution",
        group: "surfaces",
        scenario: nightThreeEmptyResolutionSurfaceCase(),
      },
      {
        key: "dayFourSurvivorRole",
        group: "surfaces",
        scenario: dayFourSurvivorRoleSurfaceCase(),
      },
      {
        key: "staleDayTwoVote",
        group: "staleRejects",
        scenario: staleDayTwoVoteAfterTransitionRecoveryScenario(),
      },
      {
        key: "staleNightOneAction",
        group: "staleRejects",
        scenario: staleNightOneActionAfterTransitionRecoveryScenario(),
      },
    ],
  );

  const family = coreLoopPhaseProgressionScenarioFamily();
  assert.equal(family.id, coreLoopPhaseProgressionFamilyId);
  assert.deepEqual(family.laneIds, coreLoopPhaseProgressionLaneIds);
  assert.deepEqual(
    family.spineSourceLaneIds,
    coreLoopPhaseProgressionSpineSourceLaneIds,
  );
  assert.deepEqual(family.seedScenarioIds, [
    ...coreLoopPhaseProgressionRequiredSeedScenarioIds,
    ...coreLoopPhaseProgressionDemoOnlySeedScenarioIds,
  ]);
  assert.deepEqual(family.surfaces, {
    dayThreeVoteResolution:
      coreLoopVoteResolutionScenarioFamily().surfaces.dayThreeVoteResolution,
    postDayThreeResolution: postDayThreeResolutionSurfaceCase(),
    nightThreeEmptyResolution: nightThreeEmptyResolutionSurfaceCase(),
    dayFourSurvivorRole: dayFourSurvivorRoleSurfaceCase(),
  });
  assert.deepEqual(family.staleRejects, {
    staleDayTwoVote: staleDayTwoVoteAfterTransitionRecoveryScenario(),
    staleNightOneAction: staleNightOneActionAfterTransitionRecoveryScenario(),
  });
  assert.equal(
    family.surfaces.dayThreeVoteResolution.playerVoteCase.clickedAction,
    "submit_vote",
  );
  assert.equal(
    family.surfaces.postDayThreeResolution.actionPlayerNightThreeCase
      .expectedPhaseId,
    "N03",
  );
  assert.equal(
    family.surfaces.nightThreeEmptyResolution.actionPlayerDayFourCase
      .expectedPhaseId,
    "D04",
  );
  assert.equal(
    family.surfaces.dayFourSurvivorRole.survivorCase.expectedSlot,
    "slot-5",
  );
  assert.equal(
    family.staleRejects.staleDayTwoVote.messageIncludes,
    "stale vote state, refresh and use current vote controls",
  );
  assert.equal(
    family.staleRejects.staleNightOneAction.messageIncludes,
    "stale action state, refresh and use current action controls",
  );
  assert.notEqual(
    coreLoopPhaseProgressionScenarioCases()[2].scenario.transitionFragments,
    coreLoopPhaseProgressionScenarioCases()[2].scenario.transitionFragments,
  );
});

test("phase progression shares empty Night 3 and Day 4 survivor assertions", () => {
  const nightThree = nightThreeEmptyResolutionSurfaceCase();
  assert.deepEqual(nightThree.transitionFragments, [
    "actionPlayer:N03:no_action",
    "resolve_phase:ack:910",
    "advance_phase:ack:911",
    "actionPlayer:D04:no_lynch_vote",
  ]);
  assert.equal(nightThree.hostTransitionCase.resolveCase.streamSeq, 910);
  assert.equal(nightThree.hostTransitionCase.advanceCase.expectedPhaseId, "D04");
  assert.equal(dayFourSurvivorRoleSurfaceCase().survivorCase.expectedSlot, "slot-5");

  const observedPlayers = [];
  const observedHostTransitions = [];
  const game = "game-a";
  const baseRoleUrl = `http://127.0.0.1:5173/g/${game}`;

  assert.doesNotThrow(() =>
    assertNightThreeEmptyResolutionSurfaceCase({
      nightThreeEmptyResolutionSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceHostRoleUrl: `${baseRoleUrl}/host`,
        sourceActionPlayerRoleUrl: baseRoleUrl,
        transition:
          "actionPlayer:N03:no_action -> host:resolve_phase:ack:910 -> host:advance_phase:ack:911 -> actionPlayer:D04:no_lynch_vote",
        actionPlayerNoActionProof: { id: "n03-no-action" },
        hostTransitionProof: { id: "n03-host-transition" },
        actionPlayerDayFourProof: { id: "d04-player" },
      },
      assertPostDayThreePlayerSurfaceProof: (args) =>
        observedPlayers.push(args),
      assertNightThreeEmptyHostTransitionProof: (args) =>
        observedHostTransitions.push(args),
    }),
  );

  assert.deepEqual(
    observedPlayers.map((args) => [
      args.proof.id,
      args.expectedPhaseId,
      args.expectedVoteButtonCount,
      args.expectedVoteTargetCount,
    ]),
    [
      ["n03-no-action", "N03", undefined, undefined],
      ["d04-player", "D04", 1, 1],
    ],
  );
  assert.deepEqual(observedHostTransitions, [
    {
      proof: { id: "n03-host-transition" },
      expectedGame: game,
      sourceRoleUrl: `${baseRoleUrl}/host`,
      includeEvidenceInError: false,
    },
  ]);

  assert.doesNotThrow(() =>
    assertDayFourSurvivorRoleSurfaceCase({
      dayFourSurvivorRoleSurface: {
        status: "passed",
        clickedThroughFromRoleUrl: true,
        releaseReady: false,
        productionReady: false,
        sourceRoleUrl: baseRoleUrl,
        survivorProof: { id: "d04-survivor" },
      },
      assertPostDayThreePlayerSurfaceProof: (args) =>
        observedPlayers.push(args),
    }),
  );
  assert.deepEqual(observedPlayers.at(-1), {
    proof: { id: "d04-survivor" },
    sourceRoleUrl: baseRoleUrl,
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
    expectedCommandStateEndpoint:
      `/games/${game}/player-command-state?principal_user_id=player_sage&slot_id=slot-5`,
    expectedNotificationsEndpoint:
      `/games/${game}/notifications?principal_user_id=player_sage`,
    expectedVoteButtonCount: 2,
    expectedVoteTargetCount: 2,
    includeEvidenceInError: false,
  });
});
