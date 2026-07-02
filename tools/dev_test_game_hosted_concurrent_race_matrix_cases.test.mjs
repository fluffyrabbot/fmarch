import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  hostedMatrixAdminRequiredCheckIds,
  hostedMatrixProgressCheckIds,
  hostedMatrixRealHostedEvidenceInputIds,
  hostedMatrixReconnectLaneIds,
  hostedMatrixRelatedAuditIds,
  hostedMatrixRequestedEvidenceIds,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";

test("hosted concurrent matrix cases share progress and handoff IDs", () => {
  assert.deepEqual(hostedMatrixProgressCheckIds, [
    "hosted-like-api-frontend-target",
    "multi-session-concurrent-command-matrix",
    "reload-recovery-after-races",
    "reconnect-recovery",
    "stale-client-conflict-messages",
    "raw-role-credential-redaction",
    "local-demo-hosted-evidence",
    "real-hosted-evidence-required",
    "real-hosted-deployment",
  ]);
  assert.deepEqual(hostedMatrixAdminRequiredCheckIds, [
    "hosted-like-api-frontend-target",
    "multi-session-concurrent-command-matrix",
    "reload-recovery-after-races",
    "reconnect-recovery",
    "stale-client-conflict-messages",
    "raw-role-credential-redaction",
    "real-hosted-deployment",
  ]);
  assert.deepEqual(hostedMatrixRelatedAuditIds, [
    "local-race-coverage",
    "local-next-action",
  ]);
  assert.deepEqual(hostedMatrixRequestedEvidenceIds, [
    "hosted-concurrent-race-matrix",
    "real-hosted-concurrent-race-matrix",
  ]);
  assert.deepEqual(
    hostedMatrixRealHostedEvidenceInputIds,
    realHostedEvidenceInputIds,
  );
  assert.equal(hostedMatrixReconnectLaneIds.length, 10);
  assert.equal(hostedMatrixStaleConflictLaneIds.length, 6);
});

test("hosted concurrent matrix consumers import extracted cases", async () => {
  const consumerPaths = [
    "tools/dev_test_game_hosted_concurrent_race_matrix.mjs",
    "tools/dev_test_game_hosted_concurrent_race_matrix_admin_proof.mjs",
    "tools/dev_test_game_release_readiness.mjs",
    "tools/dev_test_game.test.mjs",
  ];
  const sources = await Promise.all(
    consumerPaths.map((consumerPath) => readFile(consumerPath, "utf8")),
  );
  for (const [index, source] of sources.entries()) {
    assert(
      source.includes(
        "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs",
      ),
      `${consumerPaths[index]} should import hosted concurrent matrix cases`,
    );
  }
});
