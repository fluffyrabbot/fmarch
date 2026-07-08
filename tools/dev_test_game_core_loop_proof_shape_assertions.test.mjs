import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCoreLoopCommandProofRoleUrls,
  assertCoreLoopCommandProofRoleUrlAudit,
  assertCoreLoopCommandProofRoleUrlAuditExpectation,
  buildCoreLoopCommandProofRoleUrlAudit,
  coreLoopCommandProofRoleUrlAuditExpectation,
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

test("core-loop command proof role URL audit summary records checked count", () => {
  const proof = {
    sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
    visitedRolePath: "/g/game-a",
    voteProof: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
      visitedRolePath: "/g/game-a",
      clickedAction: "submit_vote",
      commandKind: "SubmitVote",
    },
    postProof: {
      status: "passed",
      sourceRoleUrl: "http://127.0.0.1:5173/g/game-a",
      visitedRolePath: "/g/game-a",
      clickedAction: "submit_post",
      commandKind: "SubmitPost",
    },
  };
  const audit = buildCoreLoopCommandProofRoleUrlAudit(proof);

  assert.deepEqual(audit, { status: "passed", checkedCount: 2 });
  assert.deepEqual(
    assertCoreLoopCommandProofRoleUrlAudit({ proof, audit }),
    audit,
  );
  assert.throws(
    () =>
      assertCoreLoopCommandProofRoleUrlAudit({
        proof,
        audit: { status: "passed", checkedCount: 1 },
      }),
    /audit summary drifted/,
  );
});

test("core-loop command proof role URL audit expectation records visible count", () => {
  assert.deepEqual(coreLoopCommandProofRoleUrlAuditExpectation, {
    status: "passed",
    checkedCount: 39,
  });
  assert.deepEqual(
    assertCoreLoopCommandProofRoleUrlAuditExpectation({
      audit: { status: "passed", checkedCount: 39 },
    }),
    coreLoopCommandProofRoleUrlAuditExpectation,
  );
  assert.throws(
    () =>
      assertCoreLoopCommandProofRoleUrlAuditExpectation({
        audit: { status: "passed", checkedCount: 38 },
      }),
    /audit expectation drifted/,
  );
});
