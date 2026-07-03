import {
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
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
    requiredEvidence: hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  },
  {
    id: "hosted-api-url-configured",
    status: "blocked",
    requiredEvidence: hostedTargetPreflightMissingApiUrlRequiredEvidence,
  },
  {
    id: "hosted-targets-external",
    status: "blocked",
    requiredEvidence: hostedTargetPreflightExternalTargetsRequiredEvidence(),
  },
  {
    id: "raw-evidence-path-configured",
    status: "blocked",
    requiredEvidence: hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  },
  {
    id: "raw-evidence-readable",
    status: "blocked",
    requiredEvidence: hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
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

export function hostedEvidenceHandoffInputRows(
  inputs,
  { fallbackInputIds = [], valueOverrides = {} } = {},
) {
  if (inputs !== null && typeof inputs === "object") {
    const env = Array.isArray(inputs.env) ? inputs.env : [];
    return [
      {
        id: "command",
        label: "Command",
        value: String(inputs.command ?? ""),
        required: true,
      },
      {
        id: "proof-target",
        label: "Proof target",
        value: String(inputs.proofTarget ?? ""),
        required: true,
      },
      ...env.map((item) => ({
        id: String(item?.name ?? ""),
        label: String(item?.name ?? ""),
        value: String(item?.description ?? ""),
        required: item?.required === true,
      })),
    ]
      .filter((item) => item.id !== "" && item.value !== "")
      .map((item) => ({
        ...item,
        value: String(valueOverrides[item.id] ?? item.value),
      }));
  }
  return fallbackInputIds.map((id) => {
    const rowId = String(id ?? "");
    return {
      id: rowId,
      label: rowId,
      value: String(valueOverrides[rowId] ?? "required"),
      required: true,
    };
  });
}

export function hostedEvidenceHandoffInputValues(inputs) {
  return Object.fromEntries(
    hostedEvidenceHandoffInputRows(inputs).map((input) => [
      input.id,
      input.value,
    ]),
  );
}

export function hostedEvidenceHandoffBlockedCheckRequiredEvidence(
  checks,
  blockedCheckIds = [],
) {
  const blockedCheckIdSet = new Set(blockedCheckIds.map((id) => String(id)));
  return Object.fromEntries(
    (Array.isArray(checks) ? checks : [])
      .filter(
        (check) =>
          blockedCheckIdSet.has(String(check.id)) &&
          check?.status === "blocked" &&
          typeof check.requiredEvidence === "string" &&
          check.requiredEvidence.trim() !== "",
      )
      .map((check) => [String(check.id), check.requiredEvidence]),
  );
}

export function hostedEvidenceHandoffSummary({
  status,
  preflightStatus,
  inputs,
  command,
  proofTarget,
}) {
  return {
    status: String(status ?? "unknown"),
    preflightStatus: String(preflightStatus ?? "unknown"),
    command: String(inputs?.command ?? command ?? ""),
    proofTarget: String(inputs?.proofTarget ?? proofTarget ?? ""),
  };
}

export function assertHostedEvidenceHandoffChecklist(checklist) {
  if (
    checklist === null ||
    typeof checklist !== "object" ||
    !["blocked", "passed"].includes(checklist.status) ||
    typeof checklist.preflightStatus !== "string" ||
    checklist.preflightStatus === "" ||
    typeof checklist.command !== "string" ||
    checklist.command === "" ||
    typeof checklist.proofTarget !== "string" ||
    checklist.proofTarget === "" ||
    !Array.isArray(checklist.inputIds) ||
    !Array.isArray(checklist.blockedCheckIds) ||
    !Array.isArray(checklist.blockedChecks)
  ) {
    throw new Error("hosted evidence handoff checklist drifted");
  }
  const blockedCheckIds = checklist.blockedChecks.map((check) => check.id);
  if (
    checklist.blockedCheckIds.some((checkId) => !blockedCheckIds.includes(checkId))
  ) {
    throw new Error("hosted evidence handoff checklist missing blocked rows");
  }
  return checklist;
}

export function hostedEvidenceBlockedHandoffChecklistFixture({
  preflightStatus = "blocked",
  command = hostedEvidenceLaneCommand,
  proofTarget = hostedEvidenceLanePath,
  blockedCheckIds = hostedEvidenceHandoffBlockedCheckIds,
  blockedChecks = hostedEvidenceHandoffBlockedChecks,
  blockedReceipt = null,
} = {}) {
  const blockedCheckIdSet = new Set(blockedCheckIds);
  return assertHostedEvidenceHandoffChecklist({
    status: "blocked",
    preflightStatus,
    command,
    proofTarget,
    inputIds: [...hostedEvidenceHandoffInputIds],
    blockedCheckIds: [...blockedCheckIds],
    blockedChecks: blockedChecks
      .filter((check) => blockedCheckIdSet.has(check.id))
      .map((check) => ({ ...check })),
    ...(blockedReceipt === null ? {} : { blockedReceipt }),
  });
}

export function hostedEvidenceBlockedHandoffChecklistFromPreflight({
  preflight,
  command = hostedEvidenceLaneCommand,
  proofTarget = hostedEvidenceLanePath,
}) {
  const blockedChecks = (preflight?.checks ?? [])
    .filter((check) => check?.status === "blocked")
    .map((check) => ({
      id: String(check.id ?? ""),
      status: "blocked",
      requiredEvidence: String(check.requiredEvidence ?? ""),
    }))
    .filter((check) => check.id !== "");
  return hostedEvidenceBlockedHandoffChecklistFixture({
    preflightStatus: String(preflight?.status ?? "unknown"),
    command,
    proofTarget,
    blockedCheckIds: blockedChecks.map((check) => check.id),
    blockedChecks,
    blockedReceipt:
      preflight?.blockedReceipt === undefined
        ? null
        : {
            ...preflight.blockedReceipt,
            command,
            nextProofTarget: proofTarget,
          },
  });
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
