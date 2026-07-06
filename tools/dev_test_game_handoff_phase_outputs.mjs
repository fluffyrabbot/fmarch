import {
  adminSpineTerminalBatchProofPath,
  hostedEvidenceOperatorChecklistNextActionPath,
  hostedIdentityNextActionAdminProofPath,
  hostedIdentityNextActionPath,
  nextActionAdminProofPath,
  nextActionPath,
  proofFreshnessAdminProofPath,
} from "./dev_test_game_spine_artifact_paths.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist.mjs";
import {
  devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
} from "./dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs";
import {
  terminalHostedIdentityNextActionAdminProofBatchScript,
  terminalRefreshAdminProofBatchScript,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";

export const devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId =
  "hosted-evidence-operator-checklist-handoff";
export const devTestGameHostedIdentityHandoffPhaseId =
  "hosted-identity-handoff";
export const devTestGameHandoffPhaseNextActionScript =
  "tools/dev_test_game_next_action.mjs";
export const proofGraphHandoffPhaseOutputSectionId =
  "proof-graph-handoff-phase-outputs";
export const proofGraphHandoffPhaseOutputSectionHeading =
  "Handoff phase outputs";
export const proofGraphHandoffPhaseOutputRowTestIdPrefix =
  "proof-graph-handoff-phase-output";

export function proofGraphHandoffPhaseOutputRowTestId(rowId) {
  return `${proofGraphHandoffPhaseOutputRowTestIdPrefix}-${rowId}`;
}

export function proofGraphHandoffPhaseOutputArtifactTestId(rowId) {
  return `${proofGraphHandoffPhaseOutputRowTestId(rowId)}-artifact`;
}

export const devTestGameHandoffPhaseOutputs = Object.freeze(
  [
    {
      phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
      step: "checklist-proof",
      kind: "node",
      script: "tools/dev_test_game_hosted_evidence_operator_checklist.mjs",
      artifacts: [devTestGameHostedEvidenceOperatorChecklistProofPath],
    },
    {
      phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
      step: "phase-local-next-action",
      kind: "node",
      script: devTestGameHandoffPhaseNextActionScript,
      artifacts: [hostedEvidenceOperatorChecklistNextActionPath],
    },
    {
      phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
      step: "admin-proof",
      kind: "node",
      script:
        "tools/dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs",
      artifacts: [devTestGameHostedEvidenceOperatorChecklistAdminProofPath],
    },
    {
      phaseId: devTestGameHostedIdentityHandoffPhaseId,
      step: "phase-local-next-action",
      kind: "node",
      script: devTestGameHandoffPhaseNextActionScript,
      artifacts: [hostedIdentityNextActionPath],
    },
    {
      phaseId: devTestGameHostedIdentityHandoffPhaseId,
      step: "hosted-identity-next-action-admin-proof-batch",
      kind: "custom",
      script: terminalHostedIdentityNextActionAdminProofBatchScript,
      artifacts: [hostedIdentityNextActionAdminProofPath],
    },
    {
      phaseId: devTestGameHostedIdentityHandoffPhaseId,
      step: "default-next-action-refresh",
      kind: "node",
      script: devTestGameHandoffPhaseNextActionScript,
      artifacts: [nextActionPath],
    },
    {
      phaseId: devTestGameHostedIdentityHandoffPhaseId,
      step: "terminal-refresh-admin-proof-batch",
      kind: "custom",
      script: terminalRefreshAdminProofBatchScript,
      artifacts: [
        proofFreshnessAdminProofPath,
        nextActionAdminProofPath,
        adminSpineTerminalBatchProofPath,
      ],
    },
  ].flatMap((step) =>
    step.artifacts.map((artifact) =>
      Object.freeze({
        id: `${step.phaseId}:${step.step}:${artifact}`,
        phaseId: step.phaseId,
        step: step.step,
        script: step.script,
        kind: step.kind,
        artifact,
      }),
    ),
  ),
);
