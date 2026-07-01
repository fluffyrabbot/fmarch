import assert from "node:assert/strict";
import { test } from "node:test";
import {
  devTestGameHostedIdentityEvidenceCommand,
  devTestGameHostedIdentityEvidencePath,
  hostedIdentityEvidenceBlockedCheckRows,
  hostedIdentityEvidenceBlockedChecks,
  hostedIdentityEvidenceHandoffCase,
  hostedIdentityEvidenceInputIds,
  hostedIdentityEvidencePlaceholderFixturePath,
  hostedIdentityEvidencePlaceholderSchema,
  hostedIdentityEvidenceRequirementGroups,
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
    requiredHostedIdentityEvidenceForCheck("invite-delivery-evidence"),
    "Hosted invite delivery and revocation evidence without exposing raw invite tokens in role URLs or admin surfaces.",
  );
});
