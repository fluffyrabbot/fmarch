import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCoreLoopCommandProofRoleUrls,
  coreLoopCommandProofRoleUrlRows,
} from "./dev_test_game_core_loop_proof_shape_assertions.mjs";

test("core-loop command proof role URL audit accepts parent-matching command proofs", () => {
  const proof = {
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
    visitedRolePath: "/g/game-a",
    nested: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
      visitedRolePath: "/g/game-a",
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
    },
    bridgePlan: {
      commandKind: "SubmitVote",
    },
  };

  const rows = assertCoreLoopCommandProofRoleUrls({ proof });
  assert.deepEqual(
    rows.map((row) => [row.path, row.status]),
    [["nested", "passed"]],
  );
});

test("core-loop command proof role URL audit rejects missing nested role URLs", () => {
  assert.throws(
    () =>
      assertCoreLoopCommandProofRoleUrls({
        proof: {
          sourceRoleUrl: "http://127.0.0.1:5173/g/game-a/host",
          visitedRolePath: "/g/game-a/host",
          nested: {
            status: "passed",
            clickedAction: "lock_thread",
            commandKind: "LockThread",
          },
        },
      }),
    /core-loop command proof role URL audit failed: nested/,
  );
});

test("core-loop command proof role URL audit rejects parent drift", () => {
  const rows = coreLoopCommandProofRoleUrlRows({
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
    visitedRolePath: "/g/game-a",
    nested: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-b",
      visitedRolePath: "/g/game-a",
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
    },
  });

  assert.equal(rows[0].status, "failed");
  assert.deepEqual(rows[0].errors, ["source-role-url-parent-mismatch"]);
});
