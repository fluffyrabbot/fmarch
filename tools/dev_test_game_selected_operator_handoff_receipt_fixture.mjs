import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  validateDevTestGameAdminSpineTerminalBatches,
} from "./dev_test_game_release_readiness.mjs";
import {
  buildSelectedOperatorHandoffTerminalReceipt,
} from "./dev_test_game_selected_operator_handoff_receipt.mjs";
import {
  hostedMatrixRawEvidenceTemplateDescriptor,
} from "./dev_test_game_hosted_matrix_raw_evidence_template_proof.mjs";
import {
  adminSpineTerminalBatchProofPath,
  selectedOperatorHandoffTerminalBatchFixturePath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import { repoRoot } from "./dev_test_game_spine_runner.mjs";

export const selectedOperatorHandoffReceiptFixtureSource =
  "synthetic-selected-operator-handoff-terminal-receipt";

export function selectedOperatorHandoffPassedReceiptFixture() {
  return buildSelectedOperatorHandoffTerminalReceipt({
    nextAction: {
      selectedOperatorHandoff: selectedOperatorHandoffFixture(),
    },
    proofGraph: {
      edges: [selectedOperatorHandoffProofGraphEdgeFixture()],
    },
  });
}

export function selectedOperatorHandoffTerminalBatchesFixture(
  terminalBatches,
) {
  const receipt = selectedOperatorHandoffPassedReceiptFixture();
  const fixture = {
    ...terminalBatches,
    generatedFrom: {
      ...terminalBatches.generatedFrom,
      selectedOperatorHandoffFixtureSource:
        selectedOperatorHandoffReceiptFixtureSource,
    },
    selectedOperatorHandoffReceipt: receipt,
  };
  validateDevTestGameAdminSpineTerminalBatches(
    fixture,
    { path: selectedOperatorHandoffTerminalBatchFixturePath },
  );
  return fixture;
}

export async function writeSelectedOperatorHandoffTerminalBatchesFixture({
  sourcePath = adminSpineTerminalBatchProofPath,
  outputPath = selectedOperatorHandoffTerminalBatchFixturePath,
} = {}) {
  const absoluteSourcePath = path.resolve(repoRoot, sourcePath);
  const absoluteOutputPath = path.resolve(repoRoot, outputPath);
  const source = JSON.parse(await readFile(absoluteSourcePath, "utf8"));
  validateDevTestGameAdminSpineTerminalBatches(
    source,
    { path: path.relative(repoRoot, absoluteSourcePath) },
  );
  const fixture = selectedOperatorHandoffTerminalBatchesFixture(source);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

function selectedOperatorHandoffFixture() {
  return {
    id: "hosted-deployment:blocked-operator-packet",
    status: "blocked",
    reason: "release-readiness-unproven",
    command: `npm run ${devTestGameHostedEvidenceLaneCommand}`,
    unprovenId: "hosted-deployment",
    proofTarget: devTestGameHostedEvidenceLanePath,
    roleUrl: `/admin/audit/${localAdminAuditIds.hostedEvidenceLane}?game=<seeded-game>`,
    firstMissingInputId: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    selectedProductionFeatureGraphNodeId:
      "production-feature:host-phase-control",
    selectedProductionFeatureRoleUrl:
      `/admin/audit/${localAdminAuditIds.coreLoop}?game=<seeded-game>`,
    rawEvidenceTemplate: hostedMatrixRawEvidenceTemplateDescriptor(),
  };
}

function selectedOperatorHandoffProofGraphEdgeFixture() {
  const handoff = selectedOperatorHandoffFixture();
  return {
    from: "next-action",
    to: handoff.selectedProductionFeatureGraphNodeId,
    relationship: "selected-operator-handoff",
    command: handoff.command,
    firstMissingInputId: handoff.firstMissingInputId,
    roleUrl: handoff.selectedProductionFeatureRoleUrl,
    proofTarget: handoff.proofTarget,
    unprovenId: handoff.unprovenId,
  };
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  const fixture = await writeSelectedOperatorHandoffTerminalBatchesFixture();
  console.log(
    `wrote ${selectedOperatorHandoffTerminalBatchFixturePath} (${fixture.selectedOperatorHandoffReceipt.status})`,
  );
}
