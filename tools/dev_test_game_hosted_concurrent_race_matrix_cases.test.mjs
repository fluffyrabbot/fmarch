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
  hostedMatrixStaleConflictMilestoneCases,
  hostedMatrixStaleConflictMilestoneLaneIds,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  staleConflictMessageSurfaceCases,
} from "./dev_test_game_stale_conflict_scenarios.mjs";

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
  assert.equal(hostedMatrixReconnectLaneIds.length, 11);
  assert.equal(hostedMatrixStaleConflictLaneIds.length, 6);
  assert.deepEqual(
    hostedMatrixStaleConflictMilestoneCases().slice(0, 5),
    staleConflictMessageSurfaceCases().map((scenario) => ({
      id: `hosted-${scenario.laneId}`,
      label: `Hosted ${scenario.label}`,
      laneId: scenario.laneId,
      progressCheckId: "stale-client-conflict-messages",
      proofBoundary:
        `Local hosted-like matrix proof backed by the ${scenario.role} ` +
        `role URL stale-client surface: ${scenario.proofBoundary}`,
    })),
  );
  assert.deepEqual(hostedMatrixStaleConflictMilestoneCases().at(-1), {
    id: "hosted-stale-host-control-conflict",
    label: "Hosted stale host-control conflict",
    laneId: "stale-host-control",
    progressCheckId: "stale-client-conflict-messages",
    proofBoundary:
      "Local hosted-like matrix proof that stale host controls surface explicit conflict recovery through the current host role surface.",
  });
  assert.deepEqual(hostedMatrixStaleConflictMilestoneLaneIds(), [
    ...staleConflictMessageSurfaceCases().map((scenario) => scenario.laneId),
    "stale-host-control",
  ]);
  assert.deepEqual(
    hostedMatrixStaleConflictMilestoneLaneIds(),
    hostedMatrixStaleConflictLaneIds,
  );
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
