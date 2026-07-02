import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceBlockedHandoffChecklistFromPreflight,
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

test("hosted evidence handoff builds blocked checklist from preflight rows", () => {
  const checklist = hostedEvidenceBlockedHandoffChecklistFromPreflight({
    preflight: {
      status: "blocked",
      checks: [
        {
          id: "hosted-frontend-url-configured",
          status: "passed",
          requiredEvidence: "configured",
        },
        {
          id: "hosted-targets-external",
          status: "blocked",
          requiredEvidence: "Use an external target.",
        },
        {
          id: "raw-evidence-readable",
          status: "blocked",
          requiredEvidence: "Attach readable raw evidence.",
        },
      ],
    },
    command: "npm run test:dev-test-game-hosted-evidence-lane",
    proofTarget: "target/dev-test-game/hosted-evidence-lane.json",
  });

  assert.deepEqual(checklist, {
    status: "blocked",
    preflightStatus: "blocked",
    command: "npm run test:dev-test-game-hosted-evidence-lane",
    proofTarget: "target/dev-test-game/hosted-evidence-lane.json",
    inputIds: hostedEvidenceHandoffInputIds,
    blockedCheckIds: ["hosted-targets-external", "raw-evidence-readable"],
    blockedChecks: [
      {
        id: "hosted-targets-external",
        status: "blocked",
        requiredEvidence: "Use an external target.",
      },
      {
        id: "raw-evidence-readable",
        status: "blocked",
        requiredEvidence: "Attach readable raw evidence.",
      },
    ],
  });
});
