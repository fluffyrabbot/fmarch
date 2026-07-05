import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildHostedIdentityEvidenceFixtureSnapshot,
  devTestGameHostedIdentityCompleteAdminProofCommand,
  devTestGameHostedIdentityCompleteAdminProofPath,
  devTestGameHostedIdentityCompleteEvidencePath,
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  devTestGameHostedIdentityOperatorAdminProofCommand,
  devTestGameHostedIdentityOperatorAdminProofPath,
  devTestGameHostedIdentityOperatorEvidencePath,
  devTestGameHostedIdentityProgressionAdminProofCommand,
  devTestGameHostedIdentityProgressionSummaryCommand,
  devTestGameHostedIdentityProgressionSummaryPath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceFamilyProgressionCases,
  hostedIdentityEvidenceFixturePlans,
  hostedIdentityEvidenceFixturePaths,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
  hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
  hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
  hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
  hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
  hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
  hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
  hostedIdentityEvidenceOperatorInvitePartialFixturePath,
  hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
  hostedIdentityEvidenceOperatorGate,
  hostedIdentityEvidenceOperatorPartialFixturePath,
  hostedIdentityEvidenceOperatorRecoveredFixturePath,
  hostedIdentityOperatorEvidencePacketPath,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceProgressionAdminProofPath,
  hostedIdentityEvidenceProgressionPath,
  hostedIdentityEvidenceRedactedPassFixturePath,
  hostedIdentityEvidenceRequirementGroups,
  hostedIdentityEvidenceSectionInputRows,
  hostedIdentityEvidenceSectionInputStatuses,
  hostedIdentityProviderBoundary,
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
    devTestGameHostedIdentityCompleteAdminProofCommand,
    "test:dev-test-game-hosted-identity-complete-admin-proof",
  );
  assert.equal(
    devTestGameHostedIdentityOperatorAdminProofCommand,
    "test:dev-test-game-hosted-identity-operator-admin-proof",
  );
  assert.equal(
    devTestGameHostedIdentityCompleteEvidencePath,
    "target/dev-test-game/hosted-identity-evidence-complete.json",
  );
  assert.equal(
    devTestGameHostedIdentityCompleteAdminProofPath,
    "target/dev-test-game/hosted-identity-evidence-complete-admin-proof.json",
  );
  assert.equal(
    devTestGameHostedIdentityOperatorEvidencePath,
    "target/dev-test-game/hosted-identity-evidence-operator.json",
  );
  assert.equal(
    devTestGameHostedIdentityOperatorAdminProofPath,
    "target/dev-test-game/hosted-identity-evidence-operator-admin-proof.json",
  );
  assert.equal(
    hostedIdentityOperatorEvidencePacketPath,
    "target/operator-evidence/hosted-identity-redacted.example.json",
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
  assert.deepEqual(handoff.operatorEvidenceGate, hostedIdentityEvidenceOperatorGate);
  assert.equal(
    handoff.operatorEvidenceGate.providerBoundary.id,
    hostedIdentityProviderBoundary.id,
  );
  assert.deepEqual(
    handoff.operatorEvidenceGate.providerBoundary.providers.map((provider) => [
      provider.id,
      provider.status,
      provider.roleSurfaceArchitectureChanged,
    ]),
    [
      ["local-dev-token-provider", "passed", false],
      ["hosted-production-provider", "blocked", false],
    ],
  );
  assert.deepEqual(
    handoff.operatorEvidenceGate.requiredEvidenceFamilies.map((family) => [
      family.id,
      family.checkId,
      family.requiredInputIds,
    ]),
    [
      [
        "account-lifecycle",
        "hosted-account-lifecycle-evidence",
        ["createAccount", "login", "disableAccount", "enableAccount"],
      ],
      [
        "invite-delivery",
        "invite-delivery-evidence",
        ["deliveryChannels", "revocationCovered"],
      ],
      [
        "account-recovery",
        "account-recovery-evidence",
        ["recoveryMethods", "recoveredSessionsPreserveRoleSurfaceAdapter"],
      ],
      [
        "abuse-rate-limit",
        "abuse-and-rate-limit-evidence",
        ["protectedOperations", "rateLimitPolicyRef"],
      ],
      [
        "session-secret-policy",
        "session-secret-policy-evidence",
        ["storage", "rotation", "deploymentSecretSource"],
      ],
      [
        "audit-retention-export",
        "hosted-audit-retention-export-evidence",
        ["eventFamilies", "retentionWindow", "exportRef"],
      ],
    ],
  );
  assert.deepEqual(handoff.operatorEvidenceGate.rejectedRawEvidencePathKinds, [
    "missing",
    "fixture",
  ]);
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
        id: "hosted-account-lifecycle",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-hosted-account-lifecycle.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-hosted-account-lifecycle-admin-proof.json",
      },
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
      {
        id: "abuse-and-rate-limit",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-abuse-and-rate-limit.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-abuse-and-rate-limit-admin-proof.json",
      },
      {
        id: "session-secret-policy",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-session-secret-policy.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-session-secret-policy-admin-proof.json",
      },
      {
        id: "hosted-audit-retention-export",
        evidencePath:
          "target/dev-test-game/hosted-identity-evidence-hosted-audit-retention-export.json",
        adminProofPath:
          "target/dev-test-game/hosted-identity-evidence-hosted-audit-retention-export-admin-proof.json",
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
      hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
      hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
      hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
      hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
      hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
      hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
      hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
      hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
      hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
      hostedIdentityEvidenceOperatorInvitePartialFixturePath,
      hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
      hostedIdentityEvidenceOperatorRecoveredFixturePath,
    ],
  );
  assert.deepEqual(
    hostedIdentityEvidenceFixturePlans.map((plan) => plan.path),
    hostedIdentityEvidenceFixturePaths,
  );
  assert.deepEqual(
    hostedIdentityEvidenceFixturePlans.map((plan) => [
      plan.path,
      plan.status,
      plan.providedFields,
    ]),
    [
      [hostedIdentityEvidencePlaceholderFixturePath, "placeholder", []],
      [
        hostedIdentityEvidenceRedactedPassFixturePath,
        "passed",
        [
          "accountLifecycle",
          "inviteDelivery",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorPartialFixturePath,
        "partial",
        [
          "accountLifecycle",
          "inviteDelivery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
        "partial",
        [
          "inviteDelivery",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
        "partial",
        ["accountLifecycle"],
      ],
      [
        hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
        "partial",
        ["accountRecovery"],
      ],
      [
        hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
        "partial",
        [
          "accountLifecycle",
          "inviteDelivery",
          "accountRecovery",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
        "partial",
        ["abuseAndRateLimitPolicy"],
      ],
      [
        hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
        "partial",
        [
          "accountLifecycle",
          "inviteDelivery",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
        "partial",
        ["sessionSecretPolicy"],
      ],
      [
        hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
        "partial",
        [
          "accountLifecycle",
          "inviteDelivery",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
        "partial",
        ["hostedAuditRetentionExport"],
      ],
      [
        hostedIdentityEvidenceOperatorInvitePartialFixturePath,
        "partial",
        [
          "accountLifecycle",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
      [
        hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
        "partial",
        ["inviteDelivery"],
      ],
      [
        hostedIdentityEvidenceOperatorRecoveredFixturePath,
        "passed",
        [
          "accountLifecycle",
          "inviteDelivery",
          "accountRecovery",
          "abuseAndRateLimitPolicy",
          "sessionSecretPolicy",
          "hostedAuditRetentionExport",
        ],
      ],
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
        "hosted-account-lifecycle",
        "accountLifecycle",
        "hosted-account-lifecycle-evidence",
        "redacted-account-lifecycle-packet",
        hostedIdentityEvidenceOperatorAccountLifecyclePartialFixturePath,
        hostedIdentityEvidenceOperatorAccountLifecycleRecoveredFixturePath,
      ],
      [
        "invite-delivery",
        "inviteDelivery",
        "invite-delivery-evidence",
        "redacted-invite-delivery-packet",
        hostedIdentityEvidenceOperatorInvitePartialFixturePath,
        hostedIdentityEvidenceOperatorInviteRecoveredFixturePath,
      ],
      [
        "account-recovery",
        "accountRecovery",
        "account-recovery-evidence",
        "redacted-account-recovery-packet",
        hostedIdentityEvidenceOperatorPartialFixturePath,
        hostedIdentityEvidenceOperatorAccountRecoveryRecoveredFixturePath,
      ],
      [
        "abuse-and-rate-limit",
        "abuseAndRateLimitPolicy",
        "abuse-and-rate-limit-evidence",
        "redacted-abuse-rate-limit-packet",
        hostedIdentityEvidenceOperatorAbuseRateLimitPartialFixturePath,
        hostedIdentityEvidenceOperatorAbuseRateLimitRecoveredFixturePath,
      ],
      [
        "session-secret-policy",
        "sessionSecretPolicy",
        "session-secret-policy-evidence",
        "redacted-session-secret-packet",
        hostedIdentityEvidenceOperatorSessionSecretPartialFixturePath,
        hostedIdentityEvidenceOperatorSessionSecretRecoveredFixturePath,
      ],
      [
        "hosted-audit-retention-export",
        "hostedAuditRetentionExport",
        "hosted-audit-retention-export-evidence",
        "redacted-audit-retention-packet",
        hostedIdentityEvidenceOperatorAuditRetentionPartialFixturePath,
        hostedIdentityEvidenceOperatorAuditRetentionRecoveredFixturePath,
      ],
    ],
  );
});

test("hosted identity fixture snapshots match the shared packet registry", async () => {
  for (const plan of hostedIdentityEvidenceFixturePlans) {
    const fixture = JSON.parse(await readFile(plan.path, "utf8"));
    assert.deepEqual(
      fixture,
      buildHostedIdentityEvidenceFixtureSnapshot(plan),
      `${plan.path} should match the shared hosted identity fixture registry`,
    );
  }
});
