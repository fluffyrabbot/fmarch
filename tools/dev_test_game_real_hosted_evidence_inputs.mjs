import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  devTestGameHostedMatrixRawEvidenceTemplatePath,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";

const devTestGameHostedEvidenceLaneCommand =
  "test:dev-test-game-hosted-evidence-lane";
const devTestGameHostedMatrixExternalEvidencePath =
  "target/dev-test-game/hosted-matrix-external.json";

export const realHostedEvidenceInputIds = Object.freeze([
  "command",
  "proof-target",
  "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
  "FMARCH_HOSTED_MATRIX_API_URL",
  "FMARCH_HOSTED_MATRIX_GROUP_ID",
  "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
  "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
]);

export function buildRealHostedEvidenceInputs({
  status,
  mode,
  command = `npm run ${devTestGameHostedEvidenceLaneCommand}`,
  proofTarget = devTestGameHostedMatrixExternalEvidencePath,
} = {}) {
  return assertRealHostedEvidenceInputs({
    status,
    mode,
    command,
    proofTarget,
    requiredEvidence:
      "Raw hosted matrix evidence from a real externally reachable hosted target.",
    env: [
      {
        name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        required: true,
        description: "Externally reachable frontend base URL.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_API_URL",
        required: true,
        description: "Externally reachable API base URL.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
        required: true,
        description: "Hosted matrix group to prove.",
      },
      {
        name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
        required: true,
        description: `${hostedMatrixRawEvidenceContractSummary()} filled from ${devTestGameHostedMatrixRawEvidenceTemplatePath}.`,
      },
      {
        name: "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
        required: false,
        description: "Optional normalized hosted matrix evidence output path.",
      },
    ],
  });
}

export function assertRealHostedEvidenceInputs(inputs) {
  if (
    inputs === null ||
    typeof inputs !== "object" ||
    !["passed", "unproven"].includes(inputs.status) ||
    typeof inputs.mode !== "string" ||
    inputs.mode === "" ||
    typeof inputs.command !== "string" ||
    inputs.command === "" ||
    typeof inputs.proofTarget !== "string" ||
    inputs.proofTarget === "" ||
    typeof inputs.requiredEvidence !== "string" ||
    inputs.requiredEvidence === "" ||
    !Array.isArray(inputs.env) ||
    inputs.env.length !== 5 ||
    !inputs.env.every(
      (item) =>
        typeof item?.name === "string" &&
        item.name.startsWith("FMARCH_HOSTED_MATRIX_") &&
        typeof item.description === "string" &&
        item.description !== "" &&
        typeof item.required === "boolean",
    )
  ) {
    throw new Error("real hosted evidence input contract drifted");
  }
  return inputs;
}
