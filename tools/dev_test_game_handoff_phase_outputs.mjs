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
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  terminalHostedIdentityNextActionAdminProofBatchScript,
  terminalProofGraphReceiptBatchRegistry,
  terminalRefreshAdminProofBatchScript,
} from "./dev_test_game_proof_graph_receipt_artifact_rows.mjs";
import {
  devTestGameReleaseReadinessScript,
} from "./dev_test_game_spine_readiness_steps.mjs";

export const devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId =
  "hosted-evidence-operator-checklist-handoff";
export const devTestGameHostedIdentityHandoffPhaseId =
  "hosted-identity-handoff";
export const devTestGameHandoffPhaseNextActionScript =
  "tools/dev_test_game_next_action.mjs";
export const devTestGameHostedIdentityPhaseLocalNextActionId =
  "hosted-identity";
export const proofGraphHandoffPhaseOutputSectionId =
  "proof-graph-handoff-phase-outputs";
export const proofGraphHandoffPhaseOutputSectionHeading =
  "Handoff phase outputs";
export const proofGraphHandoffPhaseOutputRowTestIdPrefix =
  "proof-graph-handoff-phase-output";

export const devTestGameHostedEvidenceOperatorChecklistProofHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
    step: "checklist-proof",
    kind: "node",
    script: "tools/dev_test_game_hosted_evidence_operator_checklist.mjs",
    artifacts: [devTestGameHostedEvidenceOperatorChecklistProofPath],
  });

export const devTestGameHostedEvidenceOperatorChecklistPhaseLocalNextActionId =
  "hosted-evidence-operator-checklist";

export const devTestGameHostedEvidenceOperatorChecklistPhaseLocalNextActionHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
    step: "phase-local-next-action",
    kind: "node",
    script: devTestGameHandoffPhaseNextActionScript,
    phaseLocalNextAction: {
      id: devTestGameHostedEvidenceOperatorChecklistPhaseLocalNextActionId,
      outputPath: hostedEvidenceOperatorChecklistNextActionPath,
    },
    artifacts: [hostedEvidenceOperatorChecklistNextActionPath],
  });

export const devTestGameHostedEvidenceOperatorChecklistAdminProofHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
    step: "admin-proof",
    kind: "node",
    script:
      "tools/dev_test_game_hosted_evidence_operator_checklist_admin_proof.mjs",
    env: {
      FMARCH_DEV_TEST_GAME_NEXT_ACTION:
        hostedEvidenceOperatorChecklistNextActionPath,
    },
    artifacts: [devTestGameHostedEvidenceOperatorChecklistAdminProofPath],
  });

export const devTestGameHostedEvidenceOperatorChecklistReadinessHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedEvidenceOperatorChecklistHandoffPhaseId,
    step: "readiness-refresh",
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    readinessReason: "hosted-evidence-operator-checklist-handoff",
    changedInputs: [
      hostedEvidenceOperatorChecklistNextActionPath,
      devTestGameHostedEvidenceOperatorChecklistProofPath,
      devTestGameHostedEvidenceOperatorChecklistAdminProofPath,
    ],
  });

export const devTestGameHostedEvidenceOperatorChecklistHandoffPhaseSteps =
  Object.freeze([
    devTestGameHostedEvidenceOperatorChecklistProofHandoffStep,
    devTestGameHostedEvidenceOperatorChecklistPhaseLocalNextActionHandoffStep,
    devTestGameHostedEvidenceOperatorChecklistAdminProofHandoffStep,
    devTestGameHostedEvidenceOperatorChecklistReadinessHandoffStep,
  ]);

export const devTestGameHostedIdentityPhaseLocalNextActionHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedIdentityHandoffPhaseId,
    step: "phase-local-next-action",
    kind: "node",
    script: devTestGameHandoffPhaseNextActionScript,
    phaseLocalNextAction: {
      id: devTestGameHostedIdentityPhaseLocalNextActionId,
      outputPath: hostedIdentityNextActionPath,
      sequenceStage: devTestGameHostedIdentityPhaseLocalNextActionId,
    },
    artifacts: [hostedIdentityNextActionPath],
  });

export const devTestGameHostedIdentityNextActionAdminProofBatchHandoffStep =
  terminalProofGraphHandoffBatchStep({
    step: "hosted-identity-next-action-admin-proof-batch",
    script: terminalHostedIdentityNextActionAdminProofBatchScript,
    artifacts: [hostedIdentityNextActionAdminProofPath],
  });

export const devTestGameHostedIdentityDefaultNextActionRefreshHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedIdentityHandoffPhaseId,
    step: "default-next-action-refresh",
    kind: "node",
    script: devTestGameHandoffPhaseNextActionScript,
    artifacts: [nextActionPath],
  });

export const devTestGameTerminalRefreshAdminProofBatchHandoffStep =
  terminalProofGraphHandoffBatchStep({
    step: "terminal-refresh-admin-proof-batch",
    script: terminalRefreshAdminProofBatchScript,
    artifacts: [
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
      adminSpineTerminalBatchProofPath,
    ],
  });

export const devTestGameHostedIdentityTerminalRefreshReadinessHandoffStep =
  handoffStepDescriptor({
    phaseId: devTestGameHostedIdentityHandoffPhaseId,
    step: "readiness-refresh",
    kind: "node",
    script: devTestGameReleaseReadinessScript,
    readinessReason: "hosted-identity-handoff-terminal-refresh",
    changedInputs: [
      adminSpineTerminalBatchProofPath,
      proofFreshnessAdminProofPath,
      nextActionAdminProofPath,
    ],
  });

export const devTestGameHostedIdentityTerminalProofBatchHandoffSteps =
  Object.freeze([
    devTestGameHostedIdentityNextActionAdminProofBatchHandoffStep,
    devTestGameTerminalRefreshAdminProofBatchHandoffStep,
  ]);

export const devTestGameHostedIdentityHandoffPhaseSteps = Object.freeze([
  devTestGameHostedIdentityPhaseLocalNextActionHandoffStep,
  devTestGameHostedIdentityNextActionAdminProofBatchHandoffStep,
  devTestGameHostedIdentityDefaultNextActionRefreshHandoffStep,
  devTestGameTerminalRefreshAdminProofBatchHandoffStep,
  devTestGameHostedIdentityTerminalRefreshReadinessHandoffStep,
]);

export function proofGraphHandoffPhaseOutputRowTestId(rowId) {
  return `${proofGraphHandoffPhaseOutputRowTestIdPrefix}-${rowId}`;
}

export function proofGraphHandoffPhaseOutputArtifactTestId(rowId) {
  return `${proofGraphHandoffPhaseOutputRowTestId(rowId)}-artifact`;
}

export const devTestGameHandoffPhaseOutputs = Object.freeze(
  [
    ...devTestGameHostedEvidenceOperatorChecklistHandoffPhaseSteps,
    ...devTestGameHostedIdentityHandoffPhaseSteps,
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

function handoffStepDescriptor({
  phaseId,
  step,
  kind,
  script,
  artifacts = [],
  ...descriptor
}) {
  return Object.freeze({
    phaseId,
    step,
    kind,
    script,
    ...descriptor,
    artifacts: Object.freeze([...artifacts]),
  });
}

function terminalProofGraphHandoffBatchStep({ step, script, artifacts }) {
  const batch = terminalProofGraphReceiptBatchRegistry.find(
    (candidate) => candidate.script === script,
  );
  if (batch === undefined) {
    throw new Error(`unknown terminal proof graph handoff batch: ${script}`);
  }
  return handoffStepDescriptor({
    phaseId: devTestGameHostedIdentityHandoffPhaseId,
    step,
    kind: "custom",
    script: batch.script,
    label: batch.label,
    proofIds: batch.proofIds,
    artifacts,
  });
}
