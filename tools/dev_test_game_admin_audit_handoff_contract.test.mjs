import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  assertAdminAuditRelatedHandoff,
  assertAdminAuditRelatedHandoffs,
  assertGeneratedAdminProofHandoffPath,
  requiredRelatedDestinationsForHandoff,
  requiredRelatedDestinationsForHandoffs,
} from "./dev_test_game_admin_audit_handoff_contract.mjs";
import {
  hostedAdminHandoffProofArtifactCases,
} from "./dev_test_game_hosted_handoff_proof_cases.mjs";
import {
  hostedEvidenceHandoffCase,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedMatrixAdminRequiredCheckIds,
  hostedMatrixRequestedEvidenceIds,
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_hosted_concurrent_race_matrix_cases.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  localReadinessDependencyDestinationFor,
  localProofFreshnessAdminSurfaceCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";

test("related handoff requirements map to admin audit destination proof inputs", () => {
  assert.deepEqual(requiredRelatedDestinationsForHandoff(handoffFixture()), [
    {
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      auditId: "local-hosted-concurrent-race-matrix",
      requiredChecks: [hostedMatrixAdminRequiredCheckIds.at(-1)],
      requiredCheckStatuses: {
        [hostedMatrixAdminRequiredCheckIds.at(-1)]: "unproven",
      },
      requiredScenarios: ["host-phase-controls"],
      requiredSessions: ["host"],
      requiredReconnectLanes: ["reconnect-recovery"],
      requiredStaleConflictLanes: hostedMatrixStaleConflictLaneIds,
      requiredUnproven: [hostedMatrixRequestedEvidenceIds[0]],
      requiredLocalPrerequisiteDestinations: [
        localReadinessDependencyDestinationFor(
          localProofFreshnessAdminSurfaceCheckId,
        ),
      ],
      requiredHostedHandoffInputs: hostedHandoffInputIdsFixture(),
      requiredHostedHandoffBlockedChecks: hostedHandoffBlockedCheckIdsFixture(),
      requiredHostedHandoffSummary: null,
      requiredHostedHandoffBlockedReceipt: null,
      requiredRelatedLinks: ["local-next-action"],
    },
  ]);
  assert.deepEqual(requiredRelatedDestinationsForHandoff(null), []);
  assert.deepEqual(requiredRelatedDestinationsForHandoffs([handoffFixture()]), [
    {
      linkId: "admin-proof:hosted-concurrent-race-matrix",
      auditId: "local-hosted-concurrent-race-matrix",
      requiredChecks: [hostedMatrixAdminRequiredCheckIds.at(-1)],
      requiredCheckStatuses: {
        [hostedMatrixAdminRequiredCheckIds.at(-1)]: "unproven",
      },
      requiredScenarios: ["host-phase-controls"],
      requiredSessions: ["host"],
      requiredReconnectLanes: ["reconnect-recovery"],
      requiredStaleConflictLanes: hostedMatrixStaleConflictLaneIds,
      requiredUnproven: [hostedMatrixRequestedEvidenceIds[0]],
      requiredLocalPrerequisiteDestinations: [
        localReadinessDependencyDestinationFor(
          localProofFreshnessAdminSurfaceCheckId,
        ),
      ],
      requiredHostedHandoffInputs: hostedHandoffInputIdsFixture(),
      requiredHostedHandoffBlockedChecks: hostedHandoffBlockedCheckIdsFixture(),
      requiredHostedHandoffSummary: null,
      requiredHostedHandoffBlockedReceipt: null,
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

test("related handoff assertion fails closed for local prerequisite role URL drift", () => {
  assert.throws(
    () =>
      assertAdminAuditRelatedHandoff({
        adminRoleSurface: {
          ...adminRoleSurfaceFixture(),
          visibleRelatedDestinations: [
            {
              ...adminRoleSurfaceFixture().visibleRelatedDestinations[0],
              visibleLocalPrerequisiteRoleUrls: {
                [localProofFreshnessAdminSurfaceCheckId]:
                  "/admin/audit/local-next-action?game=game-a",
              },
            },
          ],
        },
        handoff: handoffFixture(),
        proofName: "proof graph admin proof",
      }),
    /proof graph admin proof handoff destination local prerequisite role URL drifted: local-proof-freshness-admin-surface/,
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
    /proof graph admin proof handoff destination missing stale-conflict lane: replacement-stale-conflict-message/,
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

test("generated hosted admin proof artifacts carry visible shared handoff paths", async (t) => {
  for (const artifactCase of hostedAdminHandoffProofArtifactCases) {
    await t.test(artifactCase.label, async (t) => {
      let proof;
      try {
        proof = JSON.parse(await readFile(artifactCase.path, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") {
          t.skip(
            `${artifactCase.path} absent; run ${artifactCase.command} to generate it`,
          );
          return;
        }
        throw error;
      }
      assertGeneratedAdminProofHandoffPath({
        proof,
        proofName: artifactCase.label,
      });
    });
  }
});

function handoffFixture() {
  const hostedHandoff = hostedEvidenceHandoffCase();
  return {
    linkId: "admin-proof:hosted-concurrent-race-matrix",
    auditId: "local-hosted-concurrent-race-matrix",
    requiredCheckIds: [hostedMatrixAdminRequiredCheckIds.at(-1)],
    requiredCheckStatuses: {
      [hostedMatrixAdminRequiredCheckIds.at(-1)]: "unproven",
    },
    requiredScenarioIds: ["host-phase-controls"],
    requiredSessionIds: ["host"],
    requiredReconnectLaneIds: ["reconnect-recovery"],
    requiredStaleConflictLaneIds: hostedMatrixStaleConflictLaneIds,
    requiredUnprovenIds: [hostedMatrixRequestedEvidenceIds[0]],
    requiredLocalPrerequisiteDestinations: [
      localReadinessDependencyDestinationFor(
        localProofFreshnessAdminSurfaceCheckId,
      ),
    ],
    requiredHostedHandoffInputIds: hostedHandoff.inputIds,
    requiredHostedHandoffBlockedCheckIds: hostedHandoff.blockedCheckIds,
    requiredRelatedLinkIds: [localAdminAuditIds.nextAction],
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
        visibleChecks: [hostedMatrixAdminRequiredCheckIds.at(-1)],
        visibleCheckStatuses: {
          [hostedMatrixAdminRequiredCheckIds.at(-1)]: "unproven",
        },
        visibleScenarios: ["host-phase-controls"],
        visibleSessions: ["host"],
        visibleReconnectLanes: ["reconnect-recovery"],
        visibleStaleConflictLanes: hostedMatrixStaleConflictLaneIds,
        visibleUnproven: [hostedMatrixRequestedEvidenceIds[0]],
        visibleLocalPrerequisites: [localProofFreshnessAdminSurfaceCheckId],
        visibleLocalPrerequisiteRoleUrls: {
          [localProofFreshnessAdminSurfaceCheckId]: localAdminAuditRoleUrl(
            localAdminAuditIds.proofFreshness,
            { game: "game-a" },
          ),
        },
        visitedLocalPrerequisiteDestinations: [
          {
            id: localProofFreshnessAdminSurfaceCheckId,
            auditId: localAdminAuditIds.proofFreshness,
            detailRoleUrl: localAdminAuditRoleUrl(
              localAdminAuditIds.proofFreshness,
            ),
            clickedThrough: true,
          },
        ],
        visibleHostedHandoffInputs: hostedHandoff.inputIds,
        visibleHostedHandoffBlockedChecks: hostedHandoff.blockedCheckIds,
        visibleRelatedLinks: [localAdminAuditIds.nextAction],
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
