import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminProofDestinationRequirementForLink,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  releaseReadinessBuildableItemIds,
} from "./dev_test_game_release_readiness_cases.mjs";
import {
  assertProductionFacingSurfaceChecklist,
  assertProductionFacingSurfaceGraphCoverage,
  productionFacingSurfaceChecklistItems,
} from "./dev_test_game_production_surface_checklist.mjs";

test("production-facing surface checklist derives every buildable readiness surface", () => {
  const checklist = productionFacingSurfaceChecklistItems();
  assert.deepEqual(
    checklist.map((item) => item.unprovenId),
    releaseReadinessBuildableItemIds,
  );
  assertProductionFacingSurfaceChecklist(checklist);
});

test("production-facing surface checklist binds proof graph nodes to admin audits", () => {
  for (const item of productionFacingSurfaceChecklistItems()) {
    const destination = adminProofDestinationRequirementForLink(
      item.proofGraphNodeId,
    );
    assert.equal(item.adminAuditId, destination.auditId);
    assert.ok(item.roleUrl.includes(`/admin/audit/${destination.auditId}`));
    assert.equal(
      item.productionFeatureSpineTarget.sourceCheckId,
      "local-core-loop-proof",
    );
    assert.ok(item.command.startsWith("npm run test:"));
    assert.ok(item.proofTarget.startsWith("target/"));
  }
});

test("production-facing surface graph coverage fails closed for missing proof node", () => {
  const checklist = productionFacingSurfaceChecklistItems();
  const proofGraph = {
    nodes: checklist
      .filter((item) => item.proofGraphNodeId !== "admin-proof:release-runbook")
      .map((item) => ({ id: item.proofGraphNodeId })),
  };
  assert.throws(
    () =>
      assertProductionFacingSurfaceGraphCoverage({
        checklist,
        proofGraph,
      }),
    /production-facing surface missing proof graph node: admin-proof:release-runbook/,
  );
});

test("production-facing surface graph coverage accepts declared admin proof nodes", () => {
  const checklist = productionFacingSurfaceChecklistItems();
  const proofGraph = {
    nodes: checklist.map((item) => ({ id: item.proofGraphNodeId })),
  };
  assert.equal(
    assertProductionFacingSurfaceGraphCoverage({ checklist, proofGraph }),
    true,
  );
});

test("production-facing surface checklist rejects malformed surface declarations", () => {
  const [first] = productionFacingSurfaceChecklistItems();
  assert.throws(
    () =>
      assertProductionFacingSurfaceChecklist([
        {
          ...first,
          proofGraphNodeId: "admin-proof:missing",
        },
      ]),
    /production-facing surface .* is missing an admin proof destination/,
  );
  assert.throws(
    () =>
      assertProductionFacingSurfaceChecklist([
        {
          ...first,
          roleUrl: "/admin/audit/local-hosted-evidence-lane",
        },
      ]),
    /production-facing surface .* is missing a seeded role URL/,
  );
});
