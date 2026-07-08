import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coreLoopRoleSurfaceProofCases,
  coreLoopRoleSurfaceProofEvidenceKeys,
  coreLoopRoleSurfaceProofCaseKeys,
  coreLoopRoleSurfaceProofInventory,
} from "./dev_test_game_core_loop_role_surface_proof_cases.mjs";
import {
  coreLoopRoleSurfaceSpineCheckpointRows,
} from "./dev_test_game_core_loop_role_surface_checkpoint_rows.mjs";
import {
  hostPhaseTransitionSurfaceFixture,
  hostRoleSurfaceCheckpointFixture,
  nightActionResolutionReceiptSurfaceFixture,
  normalNightActionResolutionPrivacySurfaceFixture,
  playerActionSubmissionRoleSurfaceFixture,
} from "./dev_test_game_core_loop_role_surface_test_fixtures.mjs";
import {
  assertCoreLoopRoleSurfaceProofFunctionsImplemented,
  coreLoopRoleSurfaceProofFunctionKeys,
} from "./dev_test_game_core_loop_admin_proof.mjs";

test("core loop admin proof role surfaces have one declarative serial order", () => {
  const caseKeys = coreLoopRoleSurfaceProofCaseKeys();
  assert.equal(new Set(caseKeys).size, caseKeys.length);
  assert.equal(
    new Set(coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey)).size,
    coreLoopRoleSurfaceProofCases.length,
  );
  assert.deepEqual(caseKeys, [
    "hostRoleSurface",
    "playerRoleSurface",
    "targetResolutionReceiptSurface",
    "normalResolutionPrivacySurface",
    "targetDayVoteReceiptSurface",
    "normalDayVotePrivacySurface",
    "hostPhaseTransitionSurface",
    "targetPostDayVoteAdvanceSurface",
    "normalPostDayVoteAdvanceSurface",
    "nightActionResolutionReceiptSurface",
    "normalNightActionResolutionPrivacySurface",
    "hostNightActionTransitionSurface",
    "dayThreeVoteResolutionSurface",
    "postDayThreeResolutionSurface",
    "nightThreeEmptyResolutionSurface",
    "dayFourSurvivorRoleSurface",
    "nightFourNoActionSurface",
    "nightFourNoActionResolutionSurface",
    "postNightFourTransitionSurface",
    "dayFiveNoLynchResolutionSurface",
    "completedGameEndgameSurface",
    "privateChannelRoleSurface",
  ]);
  assert.deepEqual(
    coreLoopRoleSurfaceProofEvidenceKeys({ omit: ["hostRoleSurface"] }),
    caseKeys.slice(1),
  );
  assert.deepEqual(coreLoopRoleSurfaceProofInventory(), {
    rows: coreLoopRoleSurfaceProofCases.map(({ surfaceKey, proofKey }) => ({
      surfaceKey,
      proofKey,
    })),
  });
});

test("core loop admin proof browser registry covers extracted proof keys", () => {
  const proofKeys = coreLoopRoleSurfaceProofCases.map(({ proofKey }) => proofKey);
  const fakeRegistry = Object.fromEntries(
    proofKeys.map((proofKey) => [proofKey, () => ({ status: "passed" })]),
  );

  assert.deepEqual(coreLoopRoleSurfaceProofFunctionKeys(), proofKeys);
  assert.doesNotThrow(() =>
    assertCoreLoopRoleSurfaceProofFunctionsImplemented(),
  );
  assert.throws(
    () =>
      assertCoreLoopRoleSurfaceProofFunctionsImplemented({
        ...fakeRegistry,
        privateChannelRoleSurface: undefined,
      }),
    /missing=privateChannelRoleSurface extra=<none>/,
  );
  assert.throws(
    () =>
      assertCoreLoopRoleSurfaceProofFunctionsImplemented({
        ...fakeRegistry,
        unexpectedProofSurface: () => ({ status: "passed" }),
      }),
    /missing=<none> extra=unexpectedProofSurface/,
  );
});

test("core loop role surface spine checkpoint rows are scenario-owned", () => {
  assert.deepEqual(
    coreLoopRoleSurfaceSpineCheckpointRows({
      hostRoleSurface: hostRoleSurfaceCheckpointFixture(),
      hostPhaseTransitionSurface: hostPhaseTransitionSurfaceFixture(),
      playerRoleSurface: playerActionSubmissionRoleSurfaceFixture(),
      nightActionResolutionReceiptSurface:
        nightActionResolutionReceiptSurfaceFixture(),
      normalNightActionResolutionPrivacySurface:
        normalNightActionResolutionPrivacySurfaceFixture(),
    }),
    [
      "d02-n02-host-lifecycle-control-checkpoint",
      "d02-n02-host-lifecycle-control-locked-checkpoint",
      "d02-n02-host-lifecycle-control-unlocked-checkpoint",
      "d02-n02-host-lifecycle-control-stale-reject-checkpoint",
      "d02-n02-host-phase-advance-transition-checkpoint",
      "d02-n02-player-action-submission-ack-checkpoint",
      "d02-n02-night-action-resolution-receipt-checkpoint",
      "d02-n02-night-action-resolution-privacy-checkpoint",
    ],
  );
  assert.deepEqual(coreLoopRoleSurfaceSpineCheckpointRows(), []);
});
