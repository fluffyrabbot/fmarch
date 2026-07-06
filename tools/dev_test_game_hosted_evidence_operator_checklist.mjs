import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  hostedTargetPreflightBlockingCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  assertDevTestGameHostedMatrixRawEvidenceTemplate,
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
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";

export const devTestGameHostedEvidenceOperatorChecklistPath =
  "docs/dev-test-game-hosted-evidence-operator-checklist.md";
export { devTestGameHostedEvidenceOperatorChecklistProofPath };
export const devTestGameHostedEvidenceOperatorChecklistProofCommand =
  "test:dev-test-game-hosted-evidence-operator-checklist";
export const hostedEvidenceLaneCommandText =
  "npm run test:dev-test-game-hosted-evidence-lane";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    checklistProofCommand:
      `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}`,
    checklistProofTarget: devTestGameHostedEvidenceOperatorChecklistProofPath,
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
    descriptor.checklistProofCommand !==
      `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}` ||
    descriptor.checklistProofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath ||
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
    `1. Prove this checklist contract: \`${descriptor.checklistProofCommand}\``,
    `2. Validate the raw evidence template: \`${descriptor.rawEvidenceTemplateProofCommand}\``,
    `3. Capture or validate the real hosted raw packet: \`${descriptor.rawCaptureCommand}\``,
    `4. Rerun the hosted evidence lane: \`${descriptor.command}\``,
    "",
    "## Artifacts",
    "",
    `- Checklist: \`${descriptor.path}\``,
    `- Checklist proof target: \`${descriptor.checklistProofTarget}\``,
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

export async function writeHostedEvidenceOperatorChecklistProof({
  generatedAt = new Date().toISOString(),
} = {}) {
  const proof = await buildHostedEvidenceOperatorChecklistProof({ generatedAt });
  const outputPath = path.join(
    repoRoot,
    devTestGameHostedEvidenceOperatorChecklistProofPath,
  );
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);
  return proof;
}

export async function buildHostedEvidenceOperatorChecklistProof({
  generatedAt = new Date().toISOString(),
} = {}) {
  const descriptor = hostedEvidenceOperatorChecklistDescriptor();
  const checklistPath = path.join(repoRoot, descriptor.path);
  const packagePath = path.join(repoRoot, "package.json");
  const rawTemplatePath = path.join(repoRoot, descriptor.rawEvidenceTemplatePath);
  const [checklistMarkdown, packageJsonRaw, rawTemplateRaw] = await Promise.all([
    readFile(checklistPath, "utf8"),
    readFile(packagePath, "utf8"),
    readFile(rawTemplatePath, "utf8"),
  ]);
  const [checklistStats, rawTemplateStats] = await Promise.all([
    stat(checklistPath),
    stat(rawTemplatePath),
  ]);
  const packageJson = JSON.parse(packageJsonRaw);
  const rawTemplate = JSON.parse(rawTemplateRaw);
  assertDevTestGameHostedMatrixRawEvidenceTemplate(rawTemplate);
  const expectedScript =
    "node tools/dev_test_game_hosted_evidence_operator_checklist.mjs";
  const checklistProofScript =
    packageJson.scripts?.[devTestGameHostedEvidenceOperatorChecklistProofCommand];
  const hostedLaneScript =
    packageJson.scripts?.["test:dev-test-game-hosted-evidence-lane"];
  if (checklistProofScript !== expectedScript) {
    throw new Error("hosted evidence operator checklist package script drifted");
  }
  if (descriptor.command !== `npm run test:dev-test-game-hosted-evidence-lane`) {
    throw new Error("hosted evidence operator checklist lane command drifted");
  }
  if (hostedLaneScript !== "node tools/dev_test_game_hosted_evidence_lane.mjs") {
    throw new Error("hosted evidence lane package script drifted");
  }
  if (checklistMarkdown !== hostedEvidenceOperatorChecklistMarkdown(descriptor)) {
    throw new Error("hosted evidence operator checklist markdown drifted");
  }
  return assertHostedEvidenceOperatorChecklistProof({
    version: 1,
    proof: "dev-test-game-hosted-evidence-operator-checklist",
    status: "passed",
    releaseReady: false,
    productionReady: false,
    generatedAt,
    scope: "local-dev-test-game-hosted-evidence-operator-checklist",
    proofBoundary:
      "Local operator-checklist contract proof for the hosted evidence handoff. Passing means the source-controlled checklist, descriptor, package scripts, and raw hosted matrix evidence template agree; it does not prove hosted deployment, release readiness, or production readiness.",
    descriptor,
    generatedFrom: {
      checklistPath: descriptor.path,
      packageJson: "package.json",
      rawEvidenceTemplatePath: descriptor.rawEvidenceTemplatePath,
      checklistProofCommand: descriptor.checklistProofCommand,
      checklistProofTarget: descriptor.checklistProofTarget,
      hostedEvidenceLaneCommand: descriptor.command,
      templateOnly: true,
    },
    evidence: {
      checklist: {
        path: descriptor.path,
        mtime: checklistStats.mtime.toISOString(),
        sizeBytes: checklistStats.size,
      },
      rawEvidenceTemplate: {
        path: descriptor.rawEvidenceTemplatePath,
        mtime: rawTemplateStats.mtime.toISOString(),
        sizeBytes: rawTemplateStats.size,
      },
      packageScripts: {
        [devTestGameHostedEvidenceOperatorChecklistProofCommand]:
          checklistProofScript,
        "test:dev-test-game-hosted-evidence-lane": hostedLaneScript,
      },
    },
    checks: [
      {
        id: "checklist-markdown-matches-descriptor",
        status: "passed",
        evidence: descriptor.path,
      },
      {
        id: "package-script-present",
        status: "passed",
        evidence: devTestGameHostedEvidenceOperatorChecklistProofCommand,
      },
      {
        id: "hosted-lane-command-present",
        status: "passed",
        evidence: descriptor.command,
      },
      {
        id: "raw-evidence-template-readable",
        status: "passed",
        evidence: descriptor.rawEvidenceTemplatePath,
      },
      {
        id: "raw-evidence-template-contract-valid",
        status: "passed",
        evidence: descriptor.rawEvidenceContractSummary,
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

export function assertHostedEvidenceOperatorChecklistProof(proof) {
  if (
    proof?.version !== 1 ||
    proof.proof !== "dev-test-game-hosted-evidence-operator-checklist" ||
    proof.status !== "passed" ||
    proof.releaseReady !== false ||
    proof.productionReady !== false ||
    proof.scope !==
      "local-dev-test-game-hosted-evidence-operator-checklist" ||
    assertHostedEvidenceOperatorChecklistDescriptor(proof.descriptor) === null ||
    proof.generatedFrom?.checklistPath !==
      devTestGameHostedEvidenceOperatorChecklistPath ||
    proof.generatedFrom?.packageJson !== "package.json" ||
    proof.generatedFrom?.rawEvidenceTemplatePath !==
      devTestGameHostedMatrixRawEvidenceTemplatePath ||
    proof.generatedFrom?.checklistProofCommand !==
      `npm run ${devTestGameHostedEvidenceOperatorChecklistProofCommand}` ||
    proof.generatedFrom?.checklistProofTarget !==
      devTestGameHostedEvidenceOperatorChecklistProofPath ||
    proof.generatedFrom?.hostedEvidenceLaneCommand !==
      hostedEvidenceLaneCommandText ||
    proof.generatedFrom?.templateOnly !== true ||
    !Array.isArray(proof.checks) ||
    proof.checks.length !== 6 ||
    typeof proof.proofBoundary !== "string" ||
    !proof.proofBoundary.includes("does not prove hosted deployment")
  ) {
    throw new Error("hosted evidence operator checklist proof drifted");
  }
  const checks = new Map(proof.checks.map((check) => [check.id, check]));
  for (const checkId of [
    "checklist-markdown-matches-descriptor",
    "package-script-present",
    "hosted-lane-command-present",
    "raw-evidence-template-readable",
    "raw-evidence-template-contract-valid",
    "release-claim-boundary-carried",
  ]) {
    if (checks.get(checkId)?.status !== "passed") {
      throw new Error(`hosted evidence operator checklist missing ${checkId}`);
    }
  }
  return proof;
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const proof = await writeHostedEvidenceOperatorChecklistProof({
    generatedAt: new Date().toISOString(),
  });
  console.log(
    `wrote ${devTestGameHostedEvidenceOperatorChecklistProofPath} (${proof.status})`,
  );
}
