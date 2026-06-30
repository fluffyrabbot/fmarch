import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAdminAuditRelatedHandoff,
  assertAdminAuditRelatedHandoffs,
  requiredRelatedDestinationsForHandoff,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";

test("related handoff requirements map to admin audit destination proof inputs", () => {
  assert.deepEqual(requiredRelatedDestinationsForHandoff(handoffFixture()), [
    {
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      auditId: "local-hosted-concurrent-race-matrix",
      requiredChecks: ["real-hosted-deployment"],
      requiredCheckStatuses: { "real-hosted-deployment": "unproven" },
      requiredScenarios: ["host-phase-controls"],
      requiredSessions: ["host"],
      requiredUnproven: ["hosted-concurrent-race-matrix"],
      requiredRelatedLinks: ["local-next-action"],
    },
  ]);
  assert.deepEqual(requiredRelatedDestinationsForHandoff(null), []);
  assert.deepEqual(requiredRelatedDestinationsForHandoffs([handoffFixture()]), [
    {
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      auditId: "local-hosted-concurrent-race-matrix",
      requiredChecks: ["real-hosted-deployment"],
      requiredCheckStatuses: { "real-hosted-deployment": "unproven" },
      requiredScenarios: ["host-phase-controls"],
      requiredSessions: ["host"],
      requiredUnproven: ["hosted-concurrent-race-matrix"],
      requiredRelatedLinks: ["local-next-action"],
    },
  ]);
});

test("related handoff assertion verifies source link and destination rows", () => {
  assert.doesNotThrow(() =>
    assertAdminAuditRelatedHandoff({
      adminRoleSurface: adminRoleSurfaceFixture(),
      handoff: handoffFixture(),
      proofName: "next-action admin proof",
    }),
  );
  assert.doesNotThrow(() =>
    assertAdminAuditRelatedHandoffs({
      adminRoleSurface: adminRoleSurfaceFixture(),
      handoffs: [handoffFixture()],
      proofName: "proof graph admin proof",
    }),
  );
});

test("related handoff assertion fails closed for missing destination rows", () => {
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visibleUnproven: [],
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination missing unproven row: hosted-concurrent-race-matrix/,
  );
});

function handoffFixture() {
  return {
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    requiredCheckIds: ["real-hosted-deployment"],
    requiredCheckStatuses: { "real-hosted-deployment": "unproven" },
    requiredScenarioIds: ["host-phase-controls"],
    requiredSessionIds: ["host"],
    requiredUnprovenIds: ["hosted-concurrent-race-matrix"],
    requiredRelatedLinkIds: ["local-next-action"],
  };
}

function adminRoleSurfaceFixture() {
  return {
    visibleRelatedLinks: ["admin-proof:hosted-concurrent-race-matrix"],
    visibleRelatedDestinations: [
      {
        linkId: "admin-proof:hosted-concurrent-race-matrix",
        auditId: "local-hosted-concurrent-race-matrix",
        detailRoleUrl:
          "/admin/audit/local-hosted-concurrent-race-matrix?game=<seeded-game>",
        visibleChecks: ["real-hosted-deployment"],
        visibleScenarios: ["host-phase-controls"],
        visibleSessions: ["host"],
        visibleUnproven: ["hosted-concurrent-race-matrix"],
        visibleRelatedLinks: ["local-next-action"],
      },
    ],
  };
}
