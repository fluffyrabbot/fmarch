import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedGameEndgameRecoveryFeatureSpineRows,
} from "./dev_test_game_core_loop_completed_terminal_scenario_assertions.mjs";
import {
  coreLoopCompletedRecoveryRowsFixture,
  coreLoopSpineRowsFixture,
} from "./dev_test_game_core_loop_spine_target_fixtures.mjs";

test("core-loop spine row fixture shares row ids and role URL hrefs", () => {
  const rows = coreLoopSpineRowsFixture();

  assert.deepEqual(rows.cycles, [
    "d01-n01-d02",
    "d02-n02",
    "n02-d03",
    "d03-n03",
    "n03-d04",
    "d04-n04-d05",
    "d05-n05",
  ]);
  assert.equal(rows.roleUrls.at(0), "d01-n01-d02-host");
  assert.equal(rows.roleUrls.at(-1), "d05-n05-actionPlayer");
  assert.equal(rows.checkpoints.at(0), "d01-n01-d02-d01-resolved-locked");
  assert.equal(rows.checkpoints.at(-1), "d05-n05-n05-completed-player-surface");
  assert.deepEqual(rows.roleSurfaceCheckpoints, [
    "d02-n02-host-lifecycle-control-checkpoint",
    "d02-n02-host-lifecycle-control-locked-checkpoint",
    "d02-n02-host-lifecycle-control-unlocked-checkpoint",
    "d02-n02-host-lifecycle-control-stale-reject-checkpoint",
    "d02-n02-host-phase-advance-transition-checkpoint",
    "d02-n02-player-action-submission-ack-checkpoint",
    "d02-n02-night-action-resolution-receipt-checkpoint",
    "d02-n02-night-action-resolution-privacy-checkpoint",
  ]);
  assert.deepEqual(rows.recoveryHooks, [
    "staleLockedVoteReject",
    "invalidActionReject",
    "normalPlayerDirectActionReject",
    "staleActionConflictReject",
    "staleVoteTransitionReject",
    "staleActionTransitionReject",
    "d03TerminalAdvanceReject",
  ]);
  assert.deepEqual(
    Object.keys(rows.roleUrlHrefs).sort(),
    [...rows.roleUrls].sort(),
  );
});

test("completed recovery rows derive hrefs from proof fields", () => {
  const expectedRows = completedGameEndgameRecoveryFeatureSpineRows({
    cycleId: "d05-n05",
  });
  const proof = {
    completedGameEndgameSurface: Object.fromEntries(
      expectedRows.map((row) => [
        row.proofField,
        { sourceRoleUrl: `http://example.test/${row.roleUrlId}` },
      ]),
    ),
  };

  const recoveryRows = coreLoopCompletedRecoveryRowsFixture(proof);

  assert.deepEqual(recoveryRows.rows, expectedRows);
  assert.deepEqual(
    recoveryRows.roleUrlHrefs,
    Object.fromEntries(
      expectedRows.map((row) => [
        row.roleUrlId,
        `http://example.test/${row.roleUrlId}`,
      ]),
    ),
  );
});
