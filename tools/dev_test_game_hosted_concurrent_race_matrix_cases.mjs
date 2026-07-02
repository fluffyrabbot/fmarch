import {
  hostedMatrixReconnectLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  hostedMatrixStaleConflictLaneIds,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";

const cloneMilestoneCase = (scenario) => ({ ...scenario });

export {
  hostedMatrixReconnectLaneIds,
  hostedMatrixStaleConflictLaneIds,
};

export const hostedMatrixProgressCheckIds = Object.freeze([
  "hosted-like-api-frontend-target",
  "multi-session-concurrent-command-matrix",
  "reload-recovery-after-races",
  "reconnect-recovery",
  "stale-client-conflict-messages",
  "raw-role-credential-redaction",
  "local-demo-hosted-evidence",
  "real-hosted-evidence-required",
  "real-hosted-deployment",
]);

export const hostedMatrixAdminRequiredCheckIds = Object.freeze([
  "hosted-like-api-frontend-target",
  "multi-session-concurrent-command-matrix",
  "reload-recovery-after-races",
  "reconnect-recovery",
  "stale-client-conflict-messages",
  "raw-role-credential-redaction",
  "real-hosted-deployment",
]);

export const hostedMatrixRelatedAuditIds = Object.freeze([
  "local-race-coverage",
  "local-next-action",
]);

export const hostedMatrixRequestedEvidenceIds = Object.freeze([
  "hosted-concurrent-race-matrix",
  "real-hosted-concurrent-race-matrix",
]);

export const hostedMatrixRealHostedEvidenceInputIds = Object.freeze([
  ...realHostedEvidenceInputIds,
]);

export const hostedMatrixStaleConflictMilestoneCaseDefinitions = Object.freeze([
  Object.freeze({
    id: "hosted-stale-host-control-conflict",
    label: "Hosted stale host-control conflict",
    laneId: "stale-host-control",
    progressCheckId: "stale-client-conflict-messages",
    proofBoundary:
      "Local hosted-like matrix proof that stale host controls surface explicit conflict recovery through the current host role surface.",
  }),
]);

export function hostedMatrixStaleConflictMilestoneCases() {
  return hostedMatrixStaleConflictMilestoneCaseDefinitions.map(cloneMilestoneCase);
}

export function hostedMatrixStaleConflictMilestoneLaneIds() {
  return hostedMatrixStaleConflictMilestoneCases().map((scenario) => scenario.laneId);
}
