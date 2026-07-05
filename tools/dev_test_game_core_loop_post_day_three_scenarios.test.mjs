import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertPostDayThreeResolutionSurfaceCase,
  postDayThreeResolutionSurfaceCase,
} from "./dev_test_game_core_loop_post_day_three_scenarios.mjs";

test("post-Day 3 resolution case shares transition and observation facts", () => {
  assert.deepEqual(postDayThreeResolutionSurfaceCase(), {
    transitionFragments: [
      "target:D03:day_vote",
      "host:advance_phase:ack:909",
      "actionPlayer:N03",
    ],
    targetReceiptScenarioId: "d03-target-receipt",
    actionPlayerPrivacyScenarioId: "d03-action-player-privacy",
    hostAdvanceCase: {
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 908,
      setupPhaseId: "D03",
      setupPhaseState: "locked",
      advanceCase: {
        actionId: "advance_phase",
        commandKind: "AdvancePhase",
        streamSeq: 909,
        expectedPhaseId: "N03",
        expectedPhaseState: "open",
        expectedRefreshKeys: [],
      },
    },
    actionPlayerNightThreeCase: {
      proofField: "actionPlayerNightThreeProof",
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
      expectedBoundaryText: "observed host AdvancePhase",
      expectedResyncFromSeq: 909,
      expectedVoteButtonCount: 0,
      expectedVoteTargetCount: 0,
    },
  });
  assert.notEqual(
    postDayThreeResolutionSurfaceCase().transitionFragments,
    postDayThreeResolutionSurfaceCase().transitionFragments,
  );
  assert.notEqual(
    postDayThreeResolutionSurfaceCase().hostAdvanceCase,
    postDayThreeResolutionSurfaceCase().hostAdvanceCase,
  );
});

test("post-Day 3 resolution assertion delegates receipts, host advance, and Night 3 observation", () => {
  const observedPlayers = [];
  const observedHost = [];
  const postDayThreeResolutionSurface = {
    status: "passed",
    clickedThroughFromRoleUrl: true,
    releaseReady: false,
    productionReady: false,
    sourceHostRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
    sourceActionPlayerRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-7",
    sourceTargetRoleUrl: "http://127.0.0.1:5173/g/game-a?slot=slot-4",
    transition:
      "target:D03:day_vote -> host:advance_phase:ack:909 -> actionPlayer:N03",
    targetReceiptProof: { id: "target" },
    actionPlayerPrivacyProof: { id: "privacy" },
    hostAdvanceProof: {
      status: "passed",
      clickedThroughFromRoleUrl: true,
      releaseReady: false,
      productionReady: false,
      rawInviteTokensVisible: false,
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
      visitedRolePath: "/g/game-a/host",
      surfaceTestId: "host-console-surface",
      setupResyncFromSeq: 908,
      setupSnapshotHost: { phase: { id: "D03", state: "locked" } },
      advanceProof: { id: "advance" },
    },
    actionPlayerNightThreeProof: { id: "night-three" },
  };

  assert.doesNotThrow(() =>
    assertPostDayThreeResolutionSurfaceCase({
      postDayThreeResolutionSurface,
      expectedGame: "game-a",
      assertPostDayThreePlayerSurfaceProof: (args) => observedPlayers.push(args),
      assertHostPhaseTransitionActionProof: (args) => observedHost.push(args),
    }),
  );
  assert.deepEqual(
    observedPlayers.map((args) => [
      args.proof.id,
      args.expectedPrincipalUserId,
      args.expectedPhaseId,
      args.expectedPrivateReceipt,
      args.expectedCommandStateEndpoint,
    ]),
    [
      [
        "target",
        "player_rowan",
        "D03",
        true,
        "/games/game-a/player-command-state?principal_user_id=player_rowan&slot_id=slot-4",
      ],
      [
        "privacy",
        "player_mira",
        "D03",
        false,
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      ],
      [
        "night-three",
        "player_mira",
        "N03",
        false,
        "/games/game-a/player-command-state?principal_user_id=player_mira&slot_id=slot-7",
      ],
    ],
  );
  assert.deepEqual(observedHost, [
    {
      proof: { id: "advance" },
      expectedGame: "game-a",
      actionId: "advance_phase",
      commandKind: "AdvancePhase",
      streamSeq: 909,
      expectedPhaseId: "N03",
      expectedPhaseState: "open",
      expectedRefreshKeys: [],
      includeEvidenceInError: false,
    },
  ]);
  assert.throws(
    () =>
      assertPostDayThreeResolutionSurfaceCase({
        postDayThreeResolutionSurface: {
          ...postDayThreeResolutionSurface,
          transition: "target:D03:day_vote",
        },
        expectedGame: "game-a",
        assertPostDayThreePlayerSurfaceProof: () => {},
        assertHostPhaseTransitionActionProof: () => {},
      }),
    /post-Day 3 resolution surface/,
  );
});

test("post-day and post-night production callers use shared transition assertions", async () => {
  const adminProofSource = await readFile(
    "tools/dev_test_game_core_loop_admin_proof.mjs",
    "utf8",
  );
  const readinessSource = await readFile(
    "tools/dev_test_game_release_readiness.mjs",
    "utf8",
  );
  for (const [callerName, source] of [
    ["core-loop admin proof", adminProofSource],
    ["release readiness", readinessSource],
  ]) {
    assert(
      source.includes("assertPostDayThreeResolutionSurfaceCase") &&
        source.includes(
          "./dev_test_game_core_loop_resolution_receipt_privacy_scenarios.mjs",
        ),
      `${callerName} should import the shared post-Day 3 transition assertion`,
    );
    assert(
      source.includes("assertPostNightFourTransitionSurfaceCase") &&
        source.includes(
          "./dev_test_game_core_loop_post_night_four_transition_scenarios.mjs",
        ),
      `${callerName} should import the shared post-Night 4 transition assertion`,
    );
  }
  for (const localTransitionFragment of [
    "target:D03:day_vote",
    "host:advance_phase:ack:909",
    "host:N04:advance_phase:ack:917",
    "deadPlayer:D05:dead_no_controls",
    "actionPlayer:D05:no_lynch_controls",
  ]) {
    assert(
      !readinessSource.includes(localTransitionFragment),
      `release readiness should not carry local transition fragment ${localTransitionFragment}`,
    );
  }
});
