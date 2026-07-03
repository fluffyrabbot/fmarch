import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adminProofDestinationRequirementCases,
  adminProofDestinationRequirementForLink,
  adminProofDestinationRequirementLinkRows,
  adminProofDestinationRequirementRoleRows,
  adminProofDestinationRoleUrl,
  adminProofDestinationRequirements,
} from "./dev_test_game_proof_graph_handoff_cases.mjs";
import {
  hostedIdentityEvidenceHandoffCase,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";
import {
  staleConflictMessageLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedEvidenceHandoffCase,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedOpsSignalCheckIds,
  hostedOpsSignalRelatedAuditIds,
} from "./dev_test_game_hosted_ops_signal_cases.mjs";
import {
  seedScenarioCoverageGroups,
} from "./dev_test_game_seed_scenario_cases.mjs";
import {
  localAdminAuditHandoffCheckIds,
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  localHostedEvidenceLaneDemoProofCheckId,
  localNextActionAdminSurfaceCheckId,
  localProofFreshnessAdminSurfaceCheckId,
  localProofGraphAdminRoleHandoffsCheckId,
} from "./dev_test_game_local_readiness_dependencies.mjs";

test("admin proof destination handoff cases share link and audit rows", () => {
  assert.deepEqual(adminProofDestinationRequirementLinkRows, [
    ["admin-proof:core-loop", "local-core-loop"],
    ["admin-proof:hardening", "local-hardening"],
    ["admin-proof:identity", "local-identity-adapter"],
    ["admin-proof:hosted-identity-evidence", "local-hosted-identity-evidence"],
    ["admin-proof:backup", "local-backup-restore"],
    ["admin-proof:ops", "local-ops-artifacts"],
    ["admin-proof:seed", "local-seed-fixtures"],
    ["admin-proof:release", "local-release-readiness"],
    ["admin-proof:release-runbook", "local-release-runbook"],
    ["admin-proof:race-coverage", "local-race-coverage"],
    ["admin-proof:hosted-target-preflight", "local-hosted-target-preflight"],
    ["admin-proof:hosted-evidence-lane", "local-hosted-evidence-lane"],
    [
      "admin-proof:hosted-concurrent-race-matrix",
      "local-hosted-concurrent-race-matrix",
    ],
    ["admin-proof:hosted-ops-signals", "local-hosted-ops-signals"],
    ["admin-proof:spine-manifest", localAdminAuditIds.spineManifest],
  ]);
  assert.equal(
    adminProofDestinationRequirementCases.length,
    adminProofDestinationRequirementLinkRows.length,
  );
  assert.deepEqual(
    adminProofDestinationRequirementRoleRows(),
    adminProofDestinationRequirementLinkRows.map(([linkId, auditId]) => ({
      linkId,
      auditId,
      roleUrl: `/admin/audit/${auditId}?game=<seeded-game>`,
    })),
  );
  assert.equal(
    adminProofDestinationRoleUrl({
      auditId: "local-core-loop",
      game: "midsummer",
    }),
    "/admin/audit/local-core-loop?game=midsummer",
  );
});

test("admin proof destination handoff cases carry shared row requirements", () => {
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hardening")
      .requiredCheckIds,
    [
      "idempotent-retry",
      "concurrent-action-race",
      ...staleConflictMessageLaneIds,
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:seed")
      .requiredScenarioIds,
    seedScenarioCoverageGroups.allDemo,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffInputs,
    hostedIdentityEvidenceHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffBlockedChecks,
    hostedIdentityEvidenceHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-target-preflight")
      .requiredCheckIds,
    hostedTargetPreflightCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredCheckIds,
    ["hosted-target-preflight", ...hostedTargetPreflightBlockingCheckIds],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffInputs,
    hostedEvidenceHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffBlockedChecks,
    hostedEvidenceHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-ops-signals")
      .requiredCheckIds,
    hostedOpsSignalCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:hosted-ops-signals")
      .requiredRelatedLinkIds,
    hostedOpsSignalRelatedAuditIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredLocalPrerequisiteDestinations,
    [
      {
        id: localProofGraphAdminRoleHandoffsCheckId,
        auditId: localAdminAuditIds.proofGraph,
      },
      {
        id: localProofFreshnessAdminSurfaceCheckId,
        auditId: localAdminAuditIds.proofFreshness,
      },
      {
        id: localNextActionAdminSurfaceCheckId,
        auditId: localAdminAuditIds.nextAction,
      },
      {
        id: localHostedEvidenceLaneDemoProofCheckId,
        auditId: "local-hosted-evidence-lane",
      },
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:spine-manifest")
      .requiredCheckIds,
    [
      "live-spine-order-recorded",
      localAdminAuditHandoffCheckIds.proofFreshness,
      localAdminAuditHandoffCheckIds.nextAction,
    ],
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink("admin-proof:spine-manifest")
      .requiredRelatedLinkIds,
    [localAdminAuditIds.proofFreshness, localAdminAuditIds.nextAction],
  );
});

test("admin proof destination handoff cases return cloned mutable rows", () => {
  const requirements = adminProofDestinationRequirements();
  requirements.find((item) => item.linkId === "admin-proof:release")
    .requiredCheckIds.push("mutated");
  requirements.find((item) => item.linkId === "admin-proof:hosted-evidence-lane")
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-evidence-lane")
    .requiredHostedHandoffBlockedChecks.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-identity-evidence")
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find((item) => item.linkId === "admin-proof:hosted-identity-evidence")
    .requiredHostedHandoffBlockedChecks.push("mutated");
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:release")
      .requiredCheckIds.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink("admin-proof:hosted-evidence-lane")
      .requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:hosted-identity-evidence",
    ).requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
});
