import {
  hostedTargetPreflightBlockingCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  devTestGameHostedMatrixRawEvidenceTemplatePath,
  devTestGameHostedMatrixRawEvidenceTemplateProofCommand,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import {
  devTestGameHostedTargetPreflightPath,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export const devTestGameHostedEvidenceOperatorChecklistPath =
  "docs/dev-test-game-hosted-evidence-operator-checklist.md";
export const hostedEvidenceLaneCommandText =
  "npm run test:dev-test-game-hosted-evidence-lane";

export const hostedEvidenceOperatorChecklistInputSections = Object.freeze([
  Object.freeze({
    id: "proof-command",
    label: "Proof command",
    requiredInputIds: Object.freeze(["command", "proof-target"]),
  }),
  Object.freeze({
    id: "hosted-target",
    label: "Hosted target",
    requiredInputIds: Object.freeze([
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_GROUP_ID",
    ]),
  }),
  Object.freeze({
    id: "raw-evidence",
    label: "Raw evidence",
    requiredInputIds: Object.freeze([
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ]),
  }),
]);

export function hostedEvidenceOperatorChecklistDescriptor() {
  return assertHostedEvidenceOperatorChecklistDescriptor({
    id: "dev-test-game-hosted-evidence-operator-checklist",
    path: devTestGameHostedEvidenceOperatorChecklistPath,
    status: "blocked-until-operator-input",
    command: hostedEvidenceLaneCommandText,
    proofTarget: devTestGameHostedEvidenceLanePath,
    preflightTarget: devTestGameHostedTargetPreflightPath,
    rawEvidenceTemplatePath: devTestGameHostedMatrixRawEvidenceTemplatePath,
    rawEvidenceTemplateProofCommand:
      `npm run ${devTestGameHostedMatrixRawEvidenceTemplateProofCommand}`,
    rawCaptureCommand: `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
    rawCaptureProofTarget: devTestGameRealHostedMatrixRawCapturePath,
    rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
    blockedCheckIds: [...hostedTargetPreflightBlockingCheckIds],
    inputSections: hostedEvidenceOperatorChecklistInputSections.map((section) => ({
      id: section.id,
      label: section.label,
      requiredInputIds: [...section.requiredInputIds],
    })),
    env: [
      {
        name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        required: true,
        purpose: "Externally reachable frontend base URL.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_API_URL",
        required: true,
        purpose:
          "Externally reachable API base URL for the same hosted deployment.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
        required: true,
        purpose: "Hosted matrix group to prove.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        required: true,
        purpose:
          `${hostedMatrixRawEvidenceContractSummary()} filled from ${devTestGameHostedMatrixRawEvidenceTemplatePath}.`,
      },
      {
        name: "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
        required: false,
        purpose: "Optional normalized hosted matrix evidence output path.",
      },
    ],
    localVsHostedBoundary:
      "Local hosted-like matrix artifacts and synthetic demo evidence can prove the handoff path, but they cannot satisfy hosted deployment evidence.",
  });
}

export function assertHostedEvidenceOperatorChecklistDescriptor(descriptor) {
  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    descriptor.id !== "dev-test-game-hosted-evidence-operator-checklist" ||
    descriptor.path !== devTestGameHostedEvidenceOperatorChecklistPath ||
    descriptor.status !== "blocked-until-operator-input" ||
    descriptor.command !== hostedEvidenceLaneCommandText ||
    descriptor.proofTarget !== devTestGameHostedEvidenceLanePath ||
    descriptor.preflightTarget !== devTestGameHostedTargetPreflightPath ||
    descriptor.rawEvidenceTemplatePath !==
      devTestGameHostedMatrixRawEvidenceTemplatePath ||
    typeof descriptor.rawEvidenceTemplateProofCommand !== "string" ||
    descriptor.rawEvidenceTemplateProofCommand === "" ||
    typeof descriptor.rawCaptureCommand !== "string" ||
    descriptor.rawCaptureCommand === "" ||
    descriptor.rawCaptureProofTarget !== devTestGameRealHostedMatrixRawCapturePath ||
    descriptor.rawEvidenceContractSummary !==
      hostedMatrixRawEvidenceContractSummary() ||
    !Array.isArray(descriptor.blockedCheckIds) ||
    descriptor.blockedCheckIds.length !==
      hostedTargetPreflightBlockingCheckIds.length ||
    !descriptor.blockedCheckIds.every(
      (id, index) => id === hostedTargetPreflightBlockingCheckIds[index],
    ) ||
    !Array.isArray(descriptor.inputSections) ||
    descriptor.inputSections.length !==
      hostedEvidenceOperatorChecklistInputSections.length ||
    !Array.isArray(descriptor.env) ||
    descriptor.env.length === 0 ||
    !descriptor.env.every(
      (input) =>
        typeof input.name === "string" &&
        input.name !== "" &&
        typeof input.required === "boolean" &&
        typeof input.purpose === "string" &&
        input.purpose !== "",
    ) ||
    typeof descriptor.localVsHostedBoundary !== "string" ||
    descriptor.localVsHostedBoundary === ""
  ) {
    throw new Error("hosted evidence operator checklist descriptor drifted");
  }
  return descriptor;
}

export function hostedEvidenceOperatorChecklistMarkdown(
  descriptor = hostedEvidenceOperatorChecklistDescriptor(),
) {
  assertHostedEvidenceOperatorChecklistDescriptor(descriptor);
  return [
    "# Dev-Test-Game Hosted Evidence Operator Checklist",
    "",
    "This checklist is the source-controlled operator contract for unblocking the hosted-deployment release-readiness row. It does not prove hosted deployment by itself; it names the real hosted inputs and proof commands the generated lane must receive.",
    "",
    "## Required Inputs",
    "",
    "| Input | Required | Purpose |",
    "| --- | --- | --- |",
    ...descriptor.env.map(
      (input) =>
        `| \`${input.name}\` | ${input.required ? "yes" : "no"} | ${input.purpose} |`,
    ),
    "",
    "## Proof Commands",
    "",
    `1. Validate the raw evidence template: \`${descriptor.rawEvidenceTemplateProofCommand}\``,
    `2. Capture or validate the real hosted raw packet: \`${descriptor.rawCaptureCommand}\``,
    `3. Rerun the hosted evidence lane: \`${descriptor.command}\``,
    "",
    "## Artifacts",
    "",
    `- Checklist: \`${descriptor.path}\``,
    `- Hosted lane proof target: \`${descriptor.proofTarget}\``,
    `- Hosted target preflight target: \`${descriptor.preflightTarget}\``,
    `- Raw evidence template: \`${descriptor.rawEvidenceTemplatePath}\``,
    `- Raw capture proof target: \`${descriptor.rawCaptureProofTarget}\``,
    "",
    "## Blocked Checks",
    "",
    ...descriptor.blockedCheckIds.map((checkId) => `- \`${checkId}\``),
    "",
    "## Boundary",
    "",
    descriptor.localVsHostedBoundary,
    "",
  ].join("\n");
}
