import {
  hostedMatrixReconnectLaneIds,
} from "./dev_test_game_host_stale_control_scenarios.mjs";
import {
  hostedMatrixStaleConflictLaneIds,
  staleConflictMessageSurfaceCases,
} from "./dev_test_game_stale_conflict_scenarios.mjs";
import {
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  localAdminAuditIds,
} from "./dev_test_game_admin_audit_surface_ids.mjs";

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
  localAdminAuditIds.raceCoverage,
  localAdminAuditIds.nextAction,
]);

export const hostedMatrixRequestedEvidenceIds = Object.freeze([
  "hosted-concurrent-race-matrix",
  "real-hosted-concurrent-race-matrix",
]);

export const hostedMatrixRealHostedEvidenceInputIds = Object.freeze([
  ...realHostedEvidenceInputIds,
]);

export const hostedMatrixRealHostedEvidenceCommand =
  "npm run test:dev-test-game-hosted-matrix-external-evidence";
export const hostedMatrixExternalEvidenceProofTarget =
  "target/dev-test-game/hosted-matrix-external.json";

export const hostedMatrixRealHostedBlockedCheckIds = Object.freeze([
  "real-hosted-targets-externally-reachable",
  "real-hosted-command-race-evidence",
  "real-hosted-reload-coverage-evidence",
  "real-hosted-reconnect-coverage-evidence",
  "real-hosted-stale-client-proof-inputs",
]);

const hostedMatrixRealHostedBlockedChecks = Object.freeze([
  Object.freeze({
    id: "real-hosted-targets-externally-reachable",
    status: "blocked",
    requiredEvidence:
      "Externally reachable hosted frontend and API base URLs for the same deployment, with non-local health evidence.",
  }),
  Object.freeze({
    id: "real-hosted-command-race-evidence",
    status: "blocked",
    requiredEvidence:
      "Raw hosted matrix evidence with command races captured against the externally reachable deployment for the selected matrix group.",
  }),
  Object.freeze({
    id: "real-hosted-reload-coverage-evidence",
    status: "blocked",
    requiredEvidence:
      "Raw hosted matrix evidence with reload recovery coverage for every selected race cell after the hosted command races.",
  }),
  Object.freeze({
    id: "real-hosted-reconnect-coverage-evidence",
    status: "blocked",
    requiredEvidence:
      "Raw hosted matrix evidence with hosted reconnect recovery after the selected race group.",
  }),
  Object.freeze({
    id: "real-hosted-stale-client-proof-inputs",
    status: "blocked",
    requiredEvidence:
      "Raw hosted matrix evidence with stale-client conflict messages for stale player, replacement, cohost, and host surfaces.",
  }),
]);

const staleConflictProgressCheckId = "stale-client-conflict-messages";

export const hostedMatrixStaleConflictMilestoneCaseDefinitions = Object.freeze(
  [
    ...staleConflictMessageSurfaceCases().map((scenario) =>
      Object.freeze({
        id: `hosted-${scenario.laneId}`,
        label: `Hosted ${scenario.label}`,
        laneId: scenario.laneId,
        progressCheckId: staleConflictProgressCheckId,
        proofBoundary:
          `Local hosted-like matrix proof backed by the ${scenario.role} ` +
          `role URL stale-client surface: ${scenario.proofBoundary}`,
      }),
    ),
    Object.freeze({
      id: "hosted-stale-host-control-conflict",
      label: "Hosted stale host-control conflict",
      laneId: "stale-host-control",
      progressCheckId: staleConflictProgressCheckId,
      proofBoundary:
        "Local hosted-like matrix proof that stale host controls surface explicit conflict recovery through the current host role surface.",
    }),
  ],
);

export function hostedMatrixStaleConflictMilestoneCases() {
  return hostedMatrixStaleConflictMilestoneCaseDefinitions.map(cloneMilestoneCase);
}

export function hostedMatrixStaleConflictMilestoneLaneIds() {
  return hostedMatrixStaleConflictMilestoneCases().map((scenario) => scenario.laneId);
}

export function hostedMatrixRealHostedHandoffChecklist({
  command = hostedMatrixRealHostedEvidenceCommand,
  proofTarget = hostedMatrixExternalEvidenceProofTarget,
  preflightStatus = "blocked",
} = {}) {
  return {
    status: "blocked",
    preflightStatus,
    command,
    proofTarget,
    inputIds: [...hostedMatrixRealHostedEvidenceInputIds],
    blockedCheckIds: [...hostedMatrixRealHostedBlockedCheckIds],
    blockedChecks: hostedMatrixRealHostedBlockedChecks.map((check) => ({
      ...check,
    })),
    blockedReceipt: {
      status: "blocked",
      blockedCheckIds: [...hostedMatrixRealHostedBlockedCheckIds],
      command,
      proofTarget,
      nextProofTarget: proofTarget,
      requiredInputs: [
        {
          name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
          value: null,
          required: true,
          purpose: "Externally reachable frontend base URL.",
        },
        {
          name: "FMARCH_HOSTED_MATRIX_API_URL",
          value: null,
          required: true,
          purpose:
            "Externally reachable API base URL for the same hosted deployment.",
        },
        {
          name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
          value: "replacement-race-reload",
          required: true,
          purpose: "Hosted matrix group to prove.",
        },
        {
          name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
          value: null,
          required: true,
          purpose:
            "Readable raw hosted race, reload, reconnect, and stale-client evidence captured from the real target.",
        },
      ],
      missingRequiredInputs: [
        "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
        "FMARCH_HOSTED_MATRIX_API_URL",
        "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
      ],
      operatorAction:
        "Configure externally reachable hosted frontend/API URLs plus raw hosted matrix evidence covering races, reload, reconnect, and stale-client conflicts, then rerun npm run test:dev-test-game-hosted-matrix-external-evidence.",
      localVsHostedBoundary:
        "Local hosted-like matrix artifacts, local-or-loopback evidence, and synthetic demo evidence can prove the handoff shape, but they cannot satisfy real hosted race evidence.",
    },
  };
}
