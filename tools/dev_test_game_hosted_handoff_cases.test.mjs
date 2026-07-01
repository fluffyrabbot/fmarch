import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceHandoffBlockedCheckIds,
  hostedEvidenceHandoffCase,
  hostedEvidenceHandoffInputIds,
  hostedEvidenceLaneCommand,
  hostedEvidenceLaneHandoffFixture,
  hostedEvidenceLanePath,
  hostedEvidenceRealHostedInputsFixture,
  hostedMatrixExternalEvidencePath,
} from "./dev_test_game_hosted_handoff_cases.mjs";

test("hosted evidence handoff cases share real hosted input and blocked check IDs", () => {
  const handoff = hostedEvidenceHandoffCase();
  assert.deepEqual(handoff.inputIds, hostedEvidenceHandoffInputIds);
  assert.deepEqual(handoff.blockedCheckIds, hostedEvidenceHandoffBlockedCheckIds);

  const inputs = hostedEvidenceRealHostedInputsFixture();
  assert.equal(inputs.status, "unproven");
  assert.equal(inputs.mode, "not_configured");
  assert.equal(inputs.command, hostedEvidenceLaneCommand);
  assert.equal(inputs.proofTarget, hostedMatrixExternalEvidencePath);
  assert.deepEqual(
    ["command", "proof-target", ...inputs.env.map((item) => item.name)],
    hostedEvidenceHandoffInputIds,
  );

  const checklist = hostedEvidenceBlockedHandoffChecklistFixture();
  assert.equal(checklist.status, "blocked");
  assert.equal(checklist.preflightStatus, "blocked");
  assert.equal(checklist.command, hostedEvidenceLaneCommand);
  assert.equal(checklist.proofTarget, hostedEvidenceLanePath);
  assert.deepEqual(checklist.inputIds, hostedEvidenceHandoffInputIds);
  assert.deepEqual(checklist.blockedCheckIds, hostedEvidenceHandoffBlockedCheckIds);
  assert.deepEqual(
    checklist.blockedChecks.map((check) => [check.id, check.status]),
    hostedEvidenceHandoffBlockedCheckIds.map((id) => [id, "blocked"]),
  );

  const lane = hostedEvidenceLaneHandoffFixture();
  assert.deepEqual(lane.blockedCheckIds, hostedEvidenceHandoffBlockedCheckIds);
  assert.deepEqual(lane.hostedEvidence.realHostedEvidenceInputs, inputs);
});
