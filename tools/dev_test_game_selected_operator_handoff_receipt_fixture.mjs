import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameHostedEvidenceLaneCommand,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_hosted_evidence_lane.mjs";
import {
  devTestGameHostedTargetPreflightPath,
} from "./dev_test_game_hosted_target_preflight.mjs";
import {
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedEvidenceLocalVsHostedBoundary,
  hostedEvidenceOperatorAction,
} from "./dev_test_game_hosted_handoff_cases.mjs";
import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
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
  hostedEvidenceOperatorChecklistDescriptor,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
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
      nodes: [selectedOperatorHandoffProofGraphPacketNodeFixture()],
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
  const fixture = selectedOperatorHandoffTerminalBatchesFixture(source);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

function selectedOperatorHandoffFixture() {
  const blockedOperatorPacket = selectedOperatorHandoffBlockedOperatorPacket();
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
    blockedOperatorPacket,
  };
}

function selectedOperatorHandoffBlockedOperatorPacket() {
  const rawEvidenceTemplate = hostedMatrixRawEvidenceTemplateDescriptor();
  return {
    status: "blocked",
    firstMissingInputId: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
    firstMissingCheckId: "hosted-frontend-url-configured",
    firstMissingSectionId: "hosted-target",
    firstMissingSectionLabel: "Hosted target",
    firstMissingRequiredEvidence:
      hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
    rawEvidenceContractSummary: hostedMatrixRawEvidenceContractSummary(),
    rawEvidenceContractRequiredTopLevelFields: [
      "frontendBaseUrl",
      "apiBaseUrl",
      "groupId",
      "commandRaceCount",
      "reloadRecoveryCount",
      "reconnectRecovery",
      "staleConflictMessages",
      "rawRoleCredentialsRedacted",
      "observations",
    ],
    rawEvidenceTemplate,
    operatorAction: hostedEvidenceOperatorAction,
    operatorChecklist: hostedEvidenceOperatorChecklistDescriptor(),
    localVsHostedBoundary: hostedEvidenceLocalVsHostedBoundary,
    proofTarget: devTestGameHostedTargetPreflightPath,
    nextProofTarget: devTestGameHostedTargetPreflightPath,
    missingRequiredInputs: [
      "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      "FMARCH_HOSTED_MATRIX_API_URL",
      "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
    ],
    selectedProductionFeatureGraphNodeId:
      "production-feature:host-phase-control",
    selectedProductionFeatureRoleUrl: localAdminAuditRoleUrl(
      localAdminAuditIds.coreLoop,
    ),
    roleSurfaceDrilldown: {
      localCapabilityAuditId: localAdminAuditIds.coreLoop,
      localCapabilityRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      handoffAuditId: localAdminAuditIds.hostedEvidenceLane,
      handoffRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      proofGraphNodeId: "admin-proof:hosted-evidence-lane",
      productionFeatureGraphNodeId: "production-feature:host-phase-control",
      proofGraphEvidencePath: "target/dev-test-game/proof-graph.json",
    },
  };
}

function selectedOperatorHandoffProofGraphPacketNodeFixture() {
  const handoff = selectedOperatorHandoffFixture();
  const packet = handoff.blockedOperatorPacket;
  return {
    id: "selected-operator-handoff-packet",
    packetId: handoff.id,
    kind: "selected-operator-handoff-packet",
    status: packet.status,
    proofTarget: handoff.proofTarget,
    packetProofTarget: packet.proofTarget,
    nextProofTarget: packet.nextProofTarget,
    firstMissingInputId: packet.firstMissingInputId,
    firstMissingCheckId: packet.firstMissingCheckId,
    selectedProductionFeatureGraphNodeId:
      packet.selectedProductionFeatureGraphNodeId,
    selectedProductionFeatureRoleUrl:
      packet.selectedProductionFeatureRoleUrl,
    rawEvidenceTemplate: packet.rawEvidenceTemplate,
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
