import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION,
  hostedMatrixRawEvidenceContract,
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  devTestGameRealHostedMatrixRawCaptureCommand,
  devTestGameRealHostedMatrixRawCapturePath,
} from "./dev_test_game_real_hosted_matrix_raw_capture_contract.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const devTestGameHostedMatrixRawEvidenceTemplatePath =
  "tools/fixtures/dev_test_game_hosted_matrix_raw_evidence.template.json";
export const devTestGameHostedMatrixRawEvidenceTemplateProofPath =
  "target/dev-test-game/hosted-matrix-raw-evidence-template-proof.json";
export const devTestGameHostedMatrixRawEvidenceTemplateProofCommand =
  "test:dev-test-game-hosted-matrix-raw-evidence-template-proof";
export const devTestGameHostedMatrixRawEvidenceTemplateEnv =
  "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH";

const promotedCellIds = Object.freeze([
  "replacement-private-post",
  "replacement-vote",
  "replacement-action",
]);

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proof = await writeDevTestGameHostedMatrixRawEvidenceTemplateProof({
    env: process.env,
  });
  console.log(
    `wrote ${devTestGameHostedMatrixRawEvidenceTemplateProofPath} (${proof.status})`,
  );
}

export async function writeDevTestGameHostedMatrixRawEvidenceTemplateProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const proof = await buildDevTestGameHostedMatrixRawEvidenceTemplateProof({
    env,
    generatedAt,
  });
  const outputPath = path.join(
    repoRoot,
    devTestGameHostedMatrixRawEvidenceTemplateProofPath,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export async function buildDevTestGameHostedMatrixRawEvidenceTemplateProof({
  env = process.env,
  generatedAt = new Date().toISOString(),
} = {}) {
  const templatePath =
    optionalEnv(env.FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_TEMPLATE_PATH) ??
    devTestGameHostedMatrixRawEvidenceTemplatePath;
  const resolvedTemplatePath = path.resolve(repoRoot, templatePath);
  const template = JSON.parse(await readFile(resolvedTemplatePath, "utf8"));
  assertDevTestGameHostedMatrixRawEvidenceTemplate(template);
  const metadata = await stat(resolvedTemplatePath);
  const templatePathRelative = path.relative(repoRoot, resolvedTemplatePath);
  return assertDevTestGameHostedMatrixRawEvidenceTemplateProof({
    version: 1,
    proof: "dev-test-game-hosted-matrix-raw-evidence-template-proof",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-hosted-matrix-raw-evidence-template-proof",
    proofBoundary:
      "Local validator proof for the operator-facing raw hosted-matrix evidence template. Passing means the template contains the required raw packet fields, capture/redaction/retention placeholders, and promoted replacement-race observations; it does not prove hosted deployment, release readiness, or production readiness.",
    generatedFrom: {
      operatorTemplatePath: templatePathRelative,
      rawEvidenceContract: hostedMatrixRawEvidenceContract,
      rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
      templateOnly: true,
    },
    operatorTemplate: {
      path: templatePathRelative,
      copyToEnv: devTestGameHostedMatrixRawEvidenceTemplateEnv,
      validatorCommand: `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}`,
      validatorProofTarget: devTestGameRealHostedMatrixRawCapturePath,
      promotedCellIds: [...promotedCellIds],
      placeholderFields: [
        "generatedAt",
        "frontendBaseUrl",
        "apiBaseUrl",
        "capture.capturedAt",
        "capture.captureSource",
        "capture.retention.policy",
      ],
      evidence: {
        mtime: metadata.mtime.toISOString(),
        sizeBytes: metadata.size,
      },
    },
    checks: [
      {
        id: "template-readable",
        status: "passed",
        evidence: templatePathRelative,
      },
      {
        id: "raw-evidence-contract-fields-present",
        status: "passed",
        evidence: hostedMatrixRawEvidenceContract.requiredTopLevelFields,
      },
      {
        id: "capture-redaction-retention-placeholders-present",
        status: "passed",
        evidence: [
          "capture.externallyCaptured",
          "capture.capturedAt",
          "capture.captureSource",
          "capture.redaction",
          "capture.retention.policy",
        ],
      },
      {
        id: "promoted-cells-covered",
        status: "passed",
        evidence: [...promotedCellIds],
      },
      {
        id: "fixture-and-demo-markers-absent",
        status: "passed",
        evidence: "template uses external-operator-capture source",
      },
      {
        id: "release-claim-boundary-carried",
        status: "passed",
        releaseReady: false,
        productionReady: false,
      },
    ],
  });
}

export function assertDevTestGameHostedMatrixRawEvidenceTemplate(template) {
  const observations = Array.isArray(template?.observations)
    ? template.observations
    : [];
  const observedCellIds = new Set(
    observations.map((observation) => observation.cellId),
  );
  if (
    template?.version !== DEV_TEST_GAME_HOSTED_MATRIX_RAW_EVIDENCE_VERSION ||
    template.proof !== hostedMatrixRawEvidenceContract.proof ||
    template.status !== hostedMatrixRawEvidenceContract.status ||
    template.generatedAt !== "<ISO-8601_GENERATED_AT>" ||
    template.frontendBaseUrl !== "<FMARCH_HOSTED_MATRIX_FRONTEND_URL>" ||
    template.apiBaseUrl !== "<FMARCH_HOSTED_MATRIX_API_URL>" ||
    template.groupId !== "replacement-race-reload" ||
    template.commandRaceCount !== promotedCellIds.length ||
    template.reloadRecoveryCount !== promotedCellIds.length ||
    template.reconnectRecovery !== true ||
    template.staleConflictMessages !== true ||
    template.rawRoleCredentialsRedacted !== true ||
    template.generatedFrom?.source !== "external-operator-capture" ||
    template.generatedFrom?.fixtureEvidence === true ||
    template.generatedFrom?.operatorFixture === true ||
    template.generatedFrom?.syntheticExternalTarget === true ||
    template.capture?.externallyCaptured !== true ||
    template.capture?.capturedAt !== "<ISO-8601_CAPTURED_AT>" ||
    template.capture?.captureSource !== "<operator-hosted-browser-or-run-id>" ||
    template.capture?.redaction?.rawRoleCredentialsRedacted !== true ||
    template.capture?.redaction?.inviteTokensRedacted !== true ||
    template.capture?.redaction?.sessionCookiesRedacted !== true ||
    template.capture?.retention?.policy !==
      "<raw credentials discarded; redacted packet retained for proof>" ||
    observations.length !== promotedCellIds.length ||
    !promotedCellIds.every((cellId) => observedCellIds.has(cellId)) ||
    !observations.every(
      (observation) =>
        observation.status === "passed" &&
        typeof observation.raceLaneId === "string" &&
        observation.raceLaneId !== "" &&
        typeof observation.reloadLaneId === "string" &&
        observation.reloadLaneId !== "" &&
        Array.isArray(observation.roleSurfaces) &&
        observation.roleSurfaces.includes("host"),
    ) ||
    typeof template.proofBoundary !== "string" ||
    !template.proofBoundary.includes(devTestGameRealHostedMatrixRawCaptureCommand)
  ) {
    throw new Error("hosted matrix raw evidence template drifted");
  }
  return template;
}

export function assertDevTestGameHostedMatrixRawEvidenceTemplateProof(proof) {
  if (
    proof?.version !== 1 ||
    proof.proof !==
      "dev-test-game-hosted-matrix-raw-evidence-template-proof" ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !==
      "local-dev-test-game-hosted-matrix-raw-evidence-template-proof" ||
    typeof proof.generatedFrom?.operatorTemplatePath !== "string" ||
    proof.generatedFrom.operatorTemplatePath === "" ||
    proof.generatedFrom?.templateOnly !== true ||
    proof.generatedFrom?.rawEvidenceContract?.proof !==
      hostedMatrixRawEvidenceContract.proof ||
    proof.generatedFrom?.rawEvidenceContractSummary !==
      hostedMatrixRawEvidenceContractSummary() ||
    proof.operatorTemplate?.copyToEnv !==
      devTestGameHostedMatrixRawEvidenceTemplateEnv ||
    proof.operatorTemplate?.validatorCommand !==
      `npm run ${devTestGameRealHostedMatrixRawCaptureCommand}` ||
    proof.operatorTemplate?.validatorProofTarget !==
      devTestGameRealHostedMatrixRawCapturePath ||
    !Array.isArray(proof.operatorTemplate?.promotedCellIds) ||
    JSON.stringify(proof.operatorTemplate.promotedCellIds) !==
      JSON.stringify(promotedCellIds) ||
    !Array.isArray(proof.operatorTemplate?.placeholderFields) ||
    !Array.isArray(proof.checks) ||
    proof.checks.length !== 6
  ) {
    throw new Error("hosted matrix raw evidence template proof drifted");
  }
  const checks = new Map(proof.checks.map((check) => [check.id, check]));
  for (const id of [
    "template-readable",
    "raw-evidence-contract-fields-present",
    "capture-redaction-retention-placeholders-present",
    "promoted-cells-covered",
    "fixture-and-demo-markers-absent",
    "release-claim-boundary-carried",
  ]) {
    if (checks.get(id)?.status !== "passed") {
      throw new Error(`hosted matrix raw evidence template proof missing ${id}`);
    }
  }
  if (
    checks.get("release-claim-boundary-carried")?.releaseReady !== false ||
    checks.get("release-claim-boundary-carried")?.productionReady !== false
  ) {
    throw new Error("hosted matrix raw evidence template proof boundary drifted");
  }
  return proof;
}

function optionalEnv(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
