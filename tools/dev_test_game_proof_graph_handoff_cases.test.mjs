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
  realHostedObservabilityHandoffCase,
  realHostedObservabilityHandoffCheckIds,
} from "./dev_test_game_real_hosted_observability_handoff_cases.mjs";
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
    ["admin-proof:core-loop", localAdminAuditIds.coreLoop],
    ["admin-proof:hardening", localAdminAuditIds.hardening],
    ["admin-proof:identity", localAdminAuditIds.identityAdapter],
    [
      "admin-proof:hosted-identity-evidence",
      localAdminAuditIds.hostedIdentityEvidence,
    ],
    ["admin-proof:backup", localAdminAuditIds.backupRestore],
    ["admin-proof:ops", localAdminAuditIds.opsArtifacts],
    ["admin-proof:seed", localAdminAuditIds.seedFixtures],
    ["admin-proof:release", localAdminAuditIds.releaseReadiness],
    ["admin-proof:release-runbook", localAdminAuditIds.releaseRunbook],
    ["admin-proof:race-coverage", localAdminAuditIds.raceCoverage],
    [
      "admin-proof:hosted-target-preflight",
      localAdminAuditIds.hostedTargetPreflight,
    ],
    ["admin-proof:hosted-evidence-lane", localAdminAuditIds.hostedEvidenceLane],
    [
      "admin-proof:hosted-concurrent-race-matrix",
      localAdminAuditIds.hostedConcurrentRaceMatrix,
    ],
    ["admin-proof:hosted-ops-signals", localAdminAuditIds.hostedOpsSignals],
    [
      "admin-proof:real-hosted-observability-handoff",
      localAdminAuditIds.realHostedObservabilityHandoff,
    ],
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
      auditId: localAdminAuditIds.coreLoop,
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
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredCheckIds,
    realHostedObservabilityHandoffCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffInputs,
    realHostedObservabilityHandoffCase().inputIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffBlockedChecks,
    realHostedObservabilityHandoffCase().blockedCheckIds,
  );
  assert.deepEqual(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredRelatedLinkIds,
    [localAdminAuditIds.hostedOpsSignals, localAdminAuditIds.nextAction],
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
        auditId: localAdminAuditIds.hostedEvidenceLane,
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
  requirements
    .find(
      (item) =>
        item.linkId === "admin-proof:real-hosted-observability-handoff",
    )
    .requiredHostedHandoffInputs.push("mutated");
  requirements
    .find(
      (item) =>
        item.linkId === "admin-proof:real-hosted-observability-handoff",
    )
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
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffInputs.includes("mutated"),
    false,
  );
  assert.equal(
    adminProofDestinationRequirementForLink(
      "admin-proof:real-hosted-observability-handoff",
    ).requiredHostedHandoffBlockedChecks.includes("mutated"),
    false,
  );
});
