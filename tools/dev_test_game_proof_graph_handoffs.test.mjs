import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminProofGraphRoleHandoffs,
  assertAdminProofGraphRoleHandoffCoverage,
} from "./dev_test_game_proof_graph_handoffs.mjs";
import {
  adminProofDestinationRequirementForLink,
  adminProofDestinationRequirementLinkRows,
  adminProofDestinationRequirementRoleRows,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  hostedEvidenceHandoffInputIds,
  hostedEvidenceLaneHandoffFixture,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedTargetPreflightBlockingCheckIds,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  hostedMatrixAdminRequiredCheckIds,
  hostedMatrixReconnectLaneIds,
  hostedMatrixRequestedEvidenceIds,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";

test("admin proof graph role handoffs cover every admin-proof role URL", () => {
  const handoffs = adminProofGraphRoleHandoffs({
    proofGraph: proofGraphFixture(),
    hostedMatrix: hostedMatrixFixture(),
    hostedEvidenceLane: hostedEvidenceLaneFixture(),
  });

  assert.deepEqual(
    handoffs.map((handoff) => [handoff.linkId, handoff.auditId]),
    adminProofDestinationRequirementLinkRows,
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:seed")
      ?.requiredScenarioIds,
    adminProofDestinationRequirementForLink("admin-proof:seed")
      .requiredScenarioIds,
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:identity")
      ?.requiredSessionIds,
    adminProofDestinationRequirementForLink("admin-proof:identity")
      .requiredSessionIds,
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:hardening")
      ?.requiredCheckIds,
    adminProofDestinationRequirementForLink("admin-proof:hardening")
      .requiredCheckIds,
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:release")
      ?.requiredCheckIds,
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredCheckIds,
  );
  assert.deepEqual(
    handoffs.find((handoff) => handoff.linkId === "admin-proof:release")
      ?.requiredLocalPrerequisiteDestinations,
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredLocalPrerequisiteDestinations,
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
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-concurrent-race-matrix",
    )?.requiredReconnectLaneIds,
    hostedMatrixReconnectLaneIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-concurrent-race-matrix",
    )?.requiredStaleConflictLaneIds,
    hostedMatrixStaleConflictLaneIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-evidence-lane",
    )?.requiredCheckIds,
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredCheckIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-target-preflight",
    )?.requiredCheckIds,
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-target-preflight",
    ).requiredCheckIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-evidence-lane",
    )?.requiredRelatedLinkIds,
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredRelatedLinkIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-evidence-lane",
    )?.requiredHostedHandoffInputIds,
    hostedEvidenceHandoffInputIds,
  );
  assert.deepEqual(
    handoffs.find(
      (handoff) => handoff.linkId === "admin-proof:hosted-evidence-lane",
    )?.requiredHostedHandoffBlockedCheckIds,
    hostedTargetPreflightBlockingCheckIds,
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
    nodes: adminProofDestinationRequirementRoleRows().map(roleNode),
  };
}

function roleNode({ linkId, roleUrl }) {
  return {
    id: linkId,
    roleUrl,
  };
}

function hostedMatrixFixture() {
  return {
    evidenceProgress: [
      { id: hostedMatrixAdminRequiredCheckIds[0] },
      { id: hostedMatrixAdminRequiredCheckIds.at(-1) },
    ],
    cells: [{ id: "player-vote-change" }, { id: "player-night-action" }],
    reconnectLanes: hostedMatrixReconnectLaneIds.map((id) => ({ id })),
    staleConflictLanes: hostedMatrixStaleConflictLaneIds.map((id) => ({ id })),
    requestedEvidence: { id: hostedMatrixRequestedEvidenceIds[0] },
    remainingGaps: [{ id: "gap-a" }, { id: "gap-b" }],
    summary: {
      realHostedDeploymentStatus: "unproven",
    },
  };
}

function hostedEvidenceLaneFixture() {
  return hostedEvidenceLaneHandoffFixture();
}
