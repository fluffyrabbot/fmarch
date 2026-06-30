import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminProofGraphRoleHandoffs,
  assertAdminProofGraphRoleHandoffCoverage,
} from "./dev_test_game_proof_graph_handoffs.mjs";

test("admin proof graph role handoffs cover every admin-proof role URL", () => {
  const handoffs = adminProofGraphRoleHandoffs({
    proofGraph: proofGraphFixture(),
    hostedMatrix: hostedMatrixFixture(),
  });

  assert.deepEqual(
    handoffs.map((handoff) => [handoff.linkId, handoff.auditId]),
    [
      ["admin-proof:core-loop", "local-core-loop"],
      ["admin-proof:hardening", "local-hardening"],
      ["admin-proof:identity", "local-identity-adapter"],
      ["admin-proof:backup", "local-backup-restore"],
      ["admin-proof:ops", "local-ops-artifacts"],
      ["admin-proof:seed", "local-seed-fixtures"],
      ["admin-proof:release", "local-release-readiness"],
      ["admin-proof:race-coverage", "local-race-coverage"],
      [
        "admin-proof:hosted-concurrent-race-matrix",
        "local-hosted-concurrent-race-matrix",
      ],
      ["admin-proof:spine-manifest", "local-spine-manifest"],
    ],
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:seed")
      ?.requiredScenarioIds,
    ["host-phase-controls", "player-action-denied", "local-ops-readiness"],
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:identity")
      ?.requiredSessionIds,
    ["admin", "host", "player"],
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-concurrent-race-matrix",
    )?.requiredUnprovenIds,
    [
      "hosted-concurrent-race-matrix",
      "remaining-gap-1",
      "remaining-gap-2",
    ],
  );
});

test("admin proof graph role handoff coverage fails closed for unmapped nodes", () => {
  assert.throws(
    () =>
      assertAdminProofGraphRoleHandoffCoverage({
        proofGraph: {
          nodes: [
            {
              id: "admin-proof:new-surface",
              roleUrl: "/admin/audit/local-new-surface?game=<seeded-game>",
            },
          ],
        },
        handoffs: [],
      }),
    /proof graph admin proof missing role handoff: admin-proof:new-surface/,
  );
});

function proofGraphFixture() {
  return {
    nodes: [
      roleNode("admin-proof:core-loop", "local-core-loop"),
      roleNode("admin-proof:hardening", "local-hardening"),
      roleNode("admin-proof:identity", "local-identity-adapter"),
      roleNode("admin-proof:backup", "local-backup-restore"),
      roleNode("admin-proof:ops", "local-ops-artifacts"),
      roleNode("admin-proof:seed", "local-seed-fixtures"),
      roleNode("admin-proof:release", "local-release-readiness"),
      roleNode("admin-proof:race-coverage", "local-race-coverage"),
      roleNode(
        "admin-proof:hosted-concurrent-race-matrix",
        "local-hosted-concurrent-race-matrix",
      ),
      roleNode("admin-proof:spine-manifest", "local-spine-manifest"),
    ],
  };
}

function roleNode(id, auditId) {
  return {
    id,
    roleUrl: `/admin/audit/${auditId}?game=<seeded-game>`,
  };
}

function hostedMatrixFixture() {
  return {
    evidenceProgress: [
      { id: "hosted-like-api-frontend-target" },
      { id: "real-hosted-deployment" },
    ],
    cells: [{ id: "player-vote-change" }, { id: "player-night-action" }],
    requestedEvidence: { id: "hosted-concurrent-race-matrix" },
    remainingGaps: [{ id: "gap-a" }, { id: "gap-b" }],
    summary: {
      realHostedDeploymentStatus: "unproven",
    },
  };
}
