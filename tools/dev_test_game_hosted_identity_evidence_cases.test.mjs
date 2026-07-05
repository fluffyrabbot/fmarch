import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityProgressionAdminProofCommand,
  devTestGameHostedIdentityProgressionSummaryCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceFixturePaths,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityEvidenceOperatorInvitePartialFixturePath,
  hostedIdentityEvidenceOperatorPartialFixturePath,
  hostedIdentityEvidenceOperatorRecoveredFixturePath,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceRequirementGroups,
  hostedIdentityEvidenceSectionInputRows,
  hostedIdentityEvidenceSectionInputStatuses,
  hostedIdentityRoleSurfaceContractDiff,
  requiredHostedIdentityEvidenceForCheck,
} from "./dev_test_game_hosted_identity_evidence_cases.mjs";

test("hosted identity evidence cases share handoff inputs and blocked groups", () => {
  const blockedChecks = hostedIdentityEvidenceBlockedCheckRows();
  const handoff = hostedIdentityEvidenceHandoffCase();

  assert.equal(
    handoff.command,
    `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
  );
  assert.equal(
    devTestGameHostedIdentityProgressionAdminProofCommand,
    "test:dev-test-game-hosted-identity-progression-admin-proof",
  );
  assert.equal(
    devTestGameHostedIdentityProgressionSummaryCommand,
    "test:dev-test-game-hosted-identity-progression-summary",
  );
  assert.equal(
    devTestGameHostedIdentityProgressionSummaryPath,
    "target/dev-test-game/hosted-identity-progression-summary.json",
  );
  assert.equal(handoff.proofTarget, devTestGameHostedIdentityEvidencePath);
  assert.equal(
    handoff.placeholderFixturePath,
    hostedIdentityEvidencePlaceholderFixturePath,
  );
  assert.deepEqual(handoff.inputIds, hostedIdentityEvidenceInputIds);
  assert.deepEqual(
    handoff.inputSections.map((section) => section.id),
    hostedIdentityEvidenceInputSectionIds,
  );
  assert.deepEqual(hostedIdentityEvidenceInputSectionStatuses(handoff.inputSections), {
    "proof-command": "provided",
    "evidence-file": "missing",
    "role-surface-contracts": "missing",
    "identity-operations": "missing",
  });
  assert.deepEqual(hostedIdentityEvidenceSectionInputRows(handoff.inputSections), [
    { id: "proof-command-command", status: "provided" },
    { id: "proof-command-proof-target", status: "provided" },
    {
      id: "evidence-file-FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
      status: "missing",
    },
    {
      id: "role-surface-contracts-redacted-role-surface-contract-packet",
      status: "missing",
    },
    {
      id: "role-surface-contracts-redacted-identity-adapter-contract-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-account-lifecycle-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-invite-delivery-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-account-recovery-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-abuse-rate-limit-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-session-secret-packet",
      status: "missing",
    },
    {
      id: "identity-operations-redacted-audit-retention-packet",
      status: "missing",
    },
  ]);
  assert.deepEqual(
    hostedIdentityEvidenceSectionInputStatuses(handoff.inputSections),
    {
      "proof-command-command": "provided",
      "proof-command-proof-target": "provided",
      "evidence-file-FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH": "missing",
      "role-surface-contracts-redacted-role-surface-contract-packet": "missing",
      "role-surface-contracts-redacted-identity-adapter-contract-packet":
        "missing",
      "identity-operations-redacted-account-lifecycle-packet": "missing",
      "identity-operations-redacted-invite-delivery-packet": "missing",
      "identity-operations-redacted-account-recovery-packet": "missing",
      "identity-operations-redacted-abuse-rate-limit-packet": "missing",
      "identity-operations-redacted-session-secret-packet": "missing",
      "identity-operations-redacted-audit-retention-packet": "missing",
    },
  );
  assert.deepEqual(
    handoff.blockedCheckIds,
    hostedIdentityEvidenceBlockedChecks.map((check) => check.id),
  );
  assert.deepEqual(
    handoff.blockedChecks.map((check) => [check.id, check.status]),
    hostedIdentityEvidenceBlockedChecks.map((check) => [check.id, "blocked"]),
  );
  assert.deepEqual(
    handoff.requirementGroups,
    hostedIdentityEvidenceRequirementGroups(blockedChecks),
  );
  assert.equal(handoff.blockedReceipt.status, "blocked");
  assert.equal(
    handoff.blockedReceipt.command,
    `npm run ${devTestGameHostedIdentityEvidenceCommand}`,
  );
  assert.equal(handoff.blockedReceipt.proofTarget, devTestGameHostedIdentityEvidencePath);
  assert.equal(
    handoff.blockedReceipt.nextProofTarget,
    devTestGameHostedIdentityEvidencePath,
  );
  assert.deepEqual(
    handoff.blockedReceipt.missingRequiredInputs,
    [
      "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
      "redacted-role-surface-contract-packet",
      "redacted-identity-adapter-contract-packet",
      "redacted-account-lifecycle-packet",
      "redacted-invite-delivery-packet",
      "redacted-account-recovery-packet",
      "redacted-abuse-rate-limit-packet",
      "redacted-session-secret-packet",
      "redacted-audit-retention-packet",
    ],
  );
  assert.deepEqual(handoff.blockedReceipt.firstMissingOperatorArtifact, {
    inputId: "FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH",
    checkId: "hosted-identity-evidence-path-configured",
    sectionId: "evidence-file",
    sectionLabel: "Evidence file",
    requiredEvidence: "Set FMARCH_HOSTED_IDENTITY_EVIDENCE_PATH.",
    purpose: "Readable redacted hosted identity evidence JSON path.",
    proofTarget: devTestGameHostedIdentityEvidencePath,
    roleSurfaceDrilldown: {
      localCapabilityAuditId: "local-identity-adapter",
      localCapabilityRoleUrl:
        "/admin/audit/local-identity-adapter?game=<seeded-game>",
      handoffAuditId: "local-hosted-identity-evidence",
      handoffRoleUrl:
        "/admin/audit/local-hosted-identity-evidence?game=<seeded-game>",
      proofGraphNodeId: "admin-proof:hosted-identity-evidence",
      productionFeatureGraphNodeId: "production-feature:identity-adapter",
      proofGraphEvidencePath: "target/dev-test-game/proof-graph.json",
    },
  });
  assert.deepEqual(
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => ({
      id: progression.id,
      evidencePath: hostedIdentityEvidenceProgressionPath(progression.id),
      adminProofPath: hostedIdentityEvidenceProgressionAdminProofPath(
        progression.id,
      ),
    })),
    [
      {
        id: "invite-delivery",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-invite-delivery.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-invite-delivery-admin-proof.json",
      },
      {
        id: "account-recovery",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-account-recovery.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-account-recovery-admin-proof.json",
      },
    ],
  );
  assert.deepEqual(
    handoff.blockedReceipt.requiredInputs.map((input) => [
      input.name,
      input.value,
      input.required,
    ]),
    hostedIdentityEvidenceInputIds.map((id) => [
      id,
      id === "command"
        ? `npm run ${devTestGameHostedIdentityEvidenceCommand}`
        : id === "proof-target"
          ? devTestGameHostedIdentityEvidencePath
          : null,
      true,
    ]),
  );
  assert.match(
    handoff.blockedReceipt.operatorAction,
    /redacted hosted identity evidence JSON packet/,
  );
  assert.match(
    handoff.blockedReceipt.localVsHostedBoundary,
    /local identity adapter proves the role-surface capability model only/,
  );
  assert.equal(hostedIdentityEvidencePlaceholderSchema.properties.version.const, 1);
  assert.equal(
    hostedIdentityEvidencePlaceholderSchema.properties.releaseReady.const,
    false,
  );
  assert.equal(
    requiredHostedIdentityEvidenceForCheck("invite-delivery-evidence"),
    "Redacted hosted invite delivery and revocation intake packet without raw invite tokens in role URLs or admin surfaces.",
  );
  assert.deepEqual(
    hostedIdentityRoleSurfaceContractDiff({
      roleSurfaceArchitectureChanged: false,
      roleSurfaceContract: hostedIdentityExpectedRoleSurfaceContract,
    }).mismatches,
    [],
  );
  assert.deepEqual(
    hostedIdentityRoleSurfaceContractDiff({
      roleSurfaceArchitectureChanged: true,
      roleSurfaceContract: {
        ...hostedIdentityExpectedRoleSurfaceContract,
        roleUrlPatterns: [
          ...hostedIdentityExpectedRoleSurfaceContract.roleUrlPatterns,
          { id: "invite-token-url", href: "/invite/:token" },
        ],
      },
    }).mismatches.map((mismatch) => mismatch.path),
    [
      "hostedIdentity.roleSurfaceArchitectureChanged",
      "hostedIdentity.roleSurfaceContract.roleUrlPatterns.length",
    ],
  );
  assert.equal(
    hostedIdentityEvidenceRedactedPassFixturePath,
    "tools/fixtures/dev_test_game_hosted_identity_evidence.redacted-pass.json",
  );
  assert.deepEqual(
    hostedIdentityEvidenceFixturePaths,
    [
      hostedIdentityEvidencePlaceholderFixturePath,
      hostedIdentityEvidenceRedactedPassFixturePath,
      hostedIdentityEvidenceOperatorPartialFixturePath,
      hostedIdentityEvidenceOperatorInvitePartialFixturePath,
      hostedIdentityEvidenceOperatorRecoveredFixturePath,
    ],
  );
  assert.deepEqual(
    hostedIdentityEvidenceFamilyProgressionCases.map((progression) => [
      progression.id,
      progression.field,
      progression.checkId,
      progression.missingInputId,
      progression.missingFixturePath,
      progression.recoveredFixturePath,
    ]),
    [
      [
        "invite-delivery",
        "inviteDelivery",
        "invite-delivery-evidence",
        "redacted-invite-delivery-packet",
        hostedIdentityEvidenceOperatorInvitePartialFixturePath,
        hostedIdentityEvidenceOperatorRecoveredFixturePath,
      ],
      [
        "account-recovery",
        "accountRecovery",
        "account-recovery-evidence",
        "redacted-account-recovery-packet",
        hostedIdentityEvidenceOperatorPartialFixturePath,
        hostedIdentityEvidenceOperatorRecoveredFixturePath,
      ],
    ],
  );
});
