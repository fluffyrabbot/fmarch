import {
  hostedTargetPreflightBlockingCheckIds,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  buildRealHostedEvidenceInputs,
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";

export const hostedEvidenceHandoffInputIds = realHostedEvidenceInputIds;
export const hostedEvidenceHandoffBlockedCheckIds =
  hostedTargetPreflightBlockingCheckIds;
export const hostedEvidenceLaneCommand =
  "npm run test:dev-test-game-hosted-evidence-lane";
export const hostedEvidenceLanePath =
  "target/dev-test-game/hosted-evidence-lane.json";
export const hostedMatrixExternalEvidencePath =
  "target/dev-test-game/hosted-matrix-external.json";

const hostedEvidenceHandoffBlockedChecks = Object.freeze([
  {
    id: "hosted-frontend-url-configured",
    status: "blocked",
    requiredEvidence: "Set FMARCH_HOSTED_MATRIX_FRONTEND_URL.",
  },
  {
    id: "hosted-api-url-configured",
    status: "blocked",
    requiredEvidence: "Set FMARCH_HOSTED_MATRIX_API_URL.",
  },
  {
    id: "hosted-targets-external",
    status: "blocked",
    requiredEvidence:
      "Both hosted target URLs must be externally reachable http(s) URLs, not localhost or loopback.",
  },
  {
    id: "raw-evidence-path-configured",
    status: "blocked",
    requiredEvidence: "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH.",
  },
  {
    id: "raw-evidence-readable",
    status: "blocked",
    requiredEvidence: "Set FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH.",
  },
]);

export function hostedEvidenceHandoffCase() {
  return {
    inputIds: [...hostedEvidenceHandoffInputIds],
    blockedCheckIds: [...hostedEvidenceHandoffBlockedCheckIds],
  };
}

export function hostedEvidenceRealHostedInputsFixture({
  status = "unproven",
  mode = "not_configured",
} = {}) {
  return buildRealHostedEvidenceInputs({ status, mode });
}

export function hostedEvidenceBlockedHandoffChecklistFixture({
  preflightStatus = "blocked",
  command = hostedEvidenceLaneCommand,
  proofTarget = hostedEvidenceLanePath,
  blockedCheckIds = hostedEvidenceHandoffBlockedCheckIds,
  blockedChecks = hostedEvidenceHandoffBlockedChecks,
} = {}) {
  const blockedCheckIdSet = new Set(blockedCheckIds);
  return {
    status: "blocked",
    preflightStatus,
    command,
    proofTarget,
    inputIds: [...hostedEvidenceHandoffInputIds],
    blockedCheckIds: [...blockedCheckIds],
    blockedChecks: blockedChecks
      .filter((check) => blockedCheckIdSet.has(check.id))
      .map((check) => ({ ...check })),
  };
}

export function hostedEvidenceLaneHandoffFixture({
  realHostedEvidenceInputMode = "not_configured",
  realHostedEvidenceInputStatus = "unproven",
  blockedCheckIds = hostedEvidenceHandoffBlockedCheckIds,
} = {}) {
  return {
    blockedCheckIds: [...blockedCheckIds],
    hostedEvidence: {
      realHostedEvidenceInputs: hostedEvidenceRealHostedInputsFixture({
        status: realHostedEvidenceInputStatus,
        mode: realHostedEvidenceInputMode,
      }),
    },
  };
}
