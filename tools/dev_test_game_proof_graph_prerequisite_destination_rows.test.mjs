import assert from "node:assert/strict";
import { test } from "node:test";
import {
  proofGraphPrerequisiteDestinationRoleUrlTestId,
  proofGraphPrerequisiteDestinationRowIds,
  proofGraphPrerequisiteDestinationRowTestId,
  proofGraphPrerequisiteDestinationRows,
  proofGraphPrerequisiteDestinationSectionHeading,
  proofGraphPrerequisiteDestinationSectionId,
} from "./dev_test_game_proof_graph_prerequisite_destination_rows.mjs";

test("proof graph prerequisite destination rows share UI and proof ids", () => {
  const proofGraph = {
    nodes: [
      {
        id: "admin-proof:release",
        requiredLocalPrerequisiteDestinations: [
          {
            id: "local-proof-freshness-admin-surface",
            auditId: "local-proof-freshness",
            roleUrl:
              "/admin/audit/local-proof-freshness?game=<seeded-game>",
          },
        ],
      },
    ],
  };

  assert.equal(
    proofGraphPrerequisiteDestinationSectionId,
    "proof-graph-prerequisite-destinations",
  );
  assert.equal(
    proofGraphPrerequisiteDestinationSectionHeading,
    "Proof graph prerequisite destinations",
  );
  assert.deepEqual(proofGraphPrerequisiteDestinationRowIds(proofGraph), [
    "admin-proof:release:local-proof-freshness-admin-surface",
  ]);
  assert.deepEqual(proofGraphPrerequisiteDestinationRows(proofGraph), [
    {
      nodeId: "admin-proof:release",
      destinationId: "local-proof-freshness-admin-surface",
      auditId: "local-proof-freshness",
      roleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
      rowId: "admin-proof:release:local-proof-freshness-admin-surface",
      rowTestId: proofGraphPrerequisiteDestinationRowTestId(
        "admin-proof:release:local-proof-freshness-admin-surface",
      ),
      roleUrlTestId: proofGraphPrerequisiteDestinationRoleUrlTestId(
        "admin-proof:release:local-proof-freshness-admin-surface",
      ),
    },
  ]);
});
