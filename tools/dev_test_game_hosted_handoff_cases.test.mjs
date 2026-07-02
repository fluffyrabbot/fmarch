import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertHostedEvidenceHandoffChecklist,
  hostedEvidenceBlockedHandoffChecklistFixture,
  hostedEvidenceBlockedHandoffChecklistFromPreflight,
  hostedEvidenceHandoffBlockedCheckRequiredEvidence,
  hostedEvidenceHandoffBlockedCheckIds,
  hostedEvidenceHandoffCase,
  hostedEvidenceHandoffInputRows,
  hostedEvidenceHandoffInputIds,
  hostedEvidenceHandoffInputValues,
  hostedEvidenceHandoffSummary,
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
  assert.deepEqual(
    hostedEvidenceHandoffInputRows(inputs).map((input) => [
      input.id,
      input.value,
      input.required,
    ]),
    [
      ["command", hostedEvidenceLaneCommand, true],
      ["proof-target", hostedMatrixExternalEvidencePath, true],
      [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "Externally reachable frontend base URL.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_API_URL",
        "Externally reachable API base URL.",
        true,
      ],
      ["FMARCH_HOSTED_MATRIX_GROUP_ID", "Hosted matrix group to prove.", true],
      [
        "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        "Raw hosted matrix evidence captured from the real target.",
        true,
      ],
      [
        "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
        "Optional normalized hosted matrix evidence output path.",
        false,
      ],
    ],
  );
  assert.deepEqual(hostedEvidenceHandoffInputValues(inputs), {
    command: hostedEvidenceLaneCommand,
    "proof-target": hostedMatrixExternalEvidencePath,
    FMARCH_HOSTED_MATRIX_FRONTEND_URL:
      "Externally reachable frontend base URL.",
    FMARCH_HOSTED_MATRIX_API_URL: "Externally reachable API base URL.",
    FMARCH_HOSTED_MATRIX_GROUP_ID: "Hosted matrix group to prove.",
    FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH:
      "Raw hosted matrix evidence captured from the real target.",
    FMARCH_HOSTED_MATRIX_EVIDENCE_PATH:
      "Optional normalized hosted matrix evidence output path.",
  });

  const checklist = hostedEvidenceBlockedHandoffChecklistFixture();
  assert.equal(assertHostedEvidenceHandoffChecklist(checklist), checklist);
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
  assert.deepEqual(
    hostedEvidenceHandoffBlockedCheckRequiredEvidence(
      checklist.blockedChecks,
      checklist.blockedCheckIds,
    ),
    Object.fromEntries(
      checklist.blockedChecks.map((check) => [check.id, check.requiredEvidence]),
    ),
  );
  assert.deepEqual(
    hostedEvidenceHandoffSummary({
      status: "blocked",
      preflightStatus: "blocked",
      inputs,
      command: "fallback",
      proofTarget: "fallback.json",
    }),
    {
      status: "blocked",
      preflightStatus: "blocked",
      command: hostedEvidenceLaneCommand,
      proofTarget: hostedMatrixExternalEvidencePath,
    },
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
