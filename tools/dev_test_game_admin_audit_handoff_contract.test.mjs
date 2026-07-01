import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertAdminAuditRelatedHandoff,
  assertAdminAuditRelatedHandoffs,
  requiredRelatedDestinationsForHandoff,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  hostedEvidenceHandoffCase,
} from "./dev_test_game_hosted_handoff_cases.mjs";

test("related handoff requirements map to admin audit destination proof inputs", () => {
  assert.deepEqual(requiredRelatedDestinationsForHandoff(handoffFixture()), [
    {
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      auditId: "local-hosted-concurrent-race-matrix",
      requiredChecks: ["real-hosted-deployment"],
      requiredCheckStatuses: { "real-hosted-deployment": "unproven" },
      requiredScenarios: ["host-phase-controls"],
      requiredSessions: ["host"],
      requiredReconnectLanes: ["reconnect-recovery"],
      requiredStaleConflictLanes: ["stale-action-conflict-message"],
      requiredUnproven: ["hosted-concurrent-race-matrix"],
      requiredLocalPrerequisiteDestinations: [
        {
          id: "local-proof-freshness-admin-surface",
          auditId: "local-proof-freshness",
        },
      ],
      requiredHostedHandoffInputs: hostedHandoffInputIdsFixture(),
      requiredHostedHandoffBlockedChecks: hostedHandoffBlockedCheckIdsFixture(),
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
      requiredReconnectLanes: ["reconnect-recovery"],
      requiredStaleConflictLanes: ["stale-action-conflict-message"],
      requiredUnproven: ["hosted-concurrent-race-matrix"],
      requiredLocalPrerequisiteDestinations: [
        {
          id: "local-proof-freshness-admin-surface",
          auditId: "local-proof-freshness",
        },
      ],
      requiredHostedHandoffInputs: hostedHandoffInputIdsFixture(),
      requiredHostedHandoffBlockedChecks: hostedHandoffBlockedCheckIdsFixture(),
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

test("related handoff assertion fails closed for missing local prerequisite navigation", () => {
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visitedLocalPrerequisiteDestinations: [],
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination did not navigate local prerequisite: local-proof-freshness-admin-surface/,
  );
});

test("related handoff assertion fails closed for missing hardening lane rows", () => {
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visibleStaleConflictLanes: [],
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination missing stale-conflict lane: stale-action-conflict-message/,
  );
});

test("related handoff assertion fails closed for missing hosted handoff rows", () => {
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visibleHostedHandoffInputs: ["command", "proof-target"],
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination missing hosted handoff input: FMARCH_HOSTED_MATRIX_FRONTEND_URL/,
  );
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visibleHostedHandoffBlockedChecks: [],
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination missing hosted handoff blocked check: hosted-frontend-url-configured/,
  );
});

function handoffFixture() {
  const hostedHandoff = hostedEvidenceHandoffCase();
  return {
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    requiredCheckIds: ["real-hosted-deployment"],
    requiredCheckStatuses: { "real-hosted-deployment": "unproven" },
    requiredScenarioIds: ["host-phase-controls"],
    requiredSessionIds: ["host"],
    requiredReconnectLaneIds: ["reconnect-recovery"],
    requiredStaleConflictLaneIds: ["stale-action-conflict-message"],
    requiredUnprovenIds: ["hosted-concurrent-race-matrix"],
    requiredLocalPrerequisiteDestinations: [
      {
        id: "local-proof-freshness-admin-surface",
        auditId: "local-proof-freshness",
      },
    ],
    requiredHostedHandoffInputIds: hostedHandoff.inputIds,
    requiredHostedHandoffBlockedCheckIds: hostedHandoff.blockedCheckIds,
    requiredRelatedLinkIds: ["local-next-action"],
  };
}

function adminRoleSurfaceFixture() {
  const hostedHandoff = hostedEvidenceHandoffCase();
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
        visibleReconnectLanes: ["reconnect-recovery"],
        visibleStaleConflictLanes: ["stale-action-conflict-message"],
        visibleUnproven: ["hosted-concurrent-race-matrix"],
        visibleLocalPrerequisites: ["local-proof-freshness-admin-surface"],
        visibleLocalPrerequisiteRoleUrls: {
          "local-proof-freshness-admin-surface":
            "/admin/audit/local-proof-freshness?game=game-a",
        },
        visitedLocalPrerequisiteDestinations: [
          {
            id: "local-proof-freshness-admin-surface",
            auditId: "local-proof-freshness",
            detailRoleUrl: "/admin/audit/local-proof-freshness?game=<seeded-game>",
            clickedThrough: true,
          },
        ],
        visibleHostedHandoffInputs: hostedHandoff.inputIds,
        visibleHostedHandoffBlockedChecks: hostedHandoff.blockedCheckIds,
        visibleRelatedLinks: ["local-next-action"],
      },
    ],
  };
}

function hostedHandoffInputIdsFixture() {
  return hostedEvidenceHandoffCase().inputIds;
}

function hostedHandoffBlockedCheckIdsFixture() {
  return hostedEvidenceHandoffCase().blockedCheckIds;
}
