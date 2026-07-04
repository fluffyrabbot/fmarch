import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidenceInputSectionIds,
  hostedIdentityEvidenceInputSectionStatuses,
  hostedIdentityExpectedRoleSurfaceContract,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
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
});
