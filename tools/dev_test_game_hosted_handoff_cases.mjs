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

export const hostedEvidenceHandoffInputSectionDefinitions = Object.freeze([
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

export const hostedEvidenceHandoffInputSectionIds = Object.freeze(
  hostedEvidenceHandoffInputSectionDefinitions.map((section) => section.id),
);

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
    inputSections: hostedEvidenceHandoffInputSections(),
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

export function hostedEvidenceHandoffInputSections({
  providedInputIds = ["command", "proof-target"],
} = {}) {
  const providedInputIdSet = new Set(providedInputIds.map((id) => String(id)));
  return hostedEvidenceHandoffInputSectionDefinitions.map((section) => {
    const requiredInputIds = [...section.requiredInputIds];
    const providedSectionInputIds = requiredInputIds.filter((inputId) =>
      providedInputIdSet.has(inputId),
    );
    const missingInputs = requiredInputIds.filter(
      (inputId) => !providedSectionInputIds.includes(inputId),
    );
    return {
      id: section.id,
      label: section.label,
      status: missingInputs.length === 0 ? "provided" : "missing",
      requiredInputIds,
      providedInputIds: providedSectionInputIds,
      missingInputs,
    };
  });
}

export function hostedEvidenceHandoffInputSectionStatuses(sections) {
  return Object.fromEntries(
    (Array.isArray(sections) ? sections : []).map((section) => [
      String(section.id),
      String(section.status ?? ""),
    ]),
  );
}

export function hostedEvidenceHandoffSectionInputRows(sections) {
  return (Array.isArray(sections) ? sections : []).flatMap((section) =>
    (Array.isArray(section.requiredInputIds)
      ? section.requiredInputIds
      : []
    ).map((inputId) => ({
      id: `${section.id}-${inputId}`,
      status: Array.isArray(section.providedInputIds) &&
        section.providedInputIds.includes(inputId)
        ? "provided"
        : "missing",
    })),
  );
}

export function hostedEvidenceHandoffSectionInputStatuses(sections) {
  return Object.fromEntries(
    hostedEvidenceHandoffSectionInputRows(sections).map((row) => [
      row.id,
      row.status,
    ]),
  );
}

export function hostedEvidenceProvidedInputIdsFromPreflight(preflight) {
  const checks = new Map(
    (Array.isArray(preflight?.checks) ? preflight.checks : []).map((check) => [
      String(check.id ?? ""),
      check,
    ]),
  );
  const target = preflight?.target ?? {};
  return [
    "command",
    "proof-target",
    ...(checks.get("hosted-frontend-url-configured")?.status === "passed"
      ? ["FMARCH_HOSTED_MATRIX_FRONTEND_URL"]
      : []),
    ...(checks.get("hosted-api-url-configured")?.status === "passed"
      ? ["FMARCH_HOSTED_MATRIX_API_URL"]
      : []),
    ...(typeof target.groupId === "string" && target.groupId !== ""
      ? ["FMARCH_HOSTED_MATRIX_GROUP_ID"]
      : []),
    ...(checks.get("raw-evidence-readable")?.status === "passed" &&
    typeof target.rawEvidencePath === "string" &&
    target.rawEvidencePath !== ""
      ? ["FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH"]
      : []),
  ];
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
    !Array.isArray(checklist.blockedChecks) ||
    !Array.isArray(checklist.inputSections)
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

export function hostedEvidenceHandoffChecklistFixture({
  status = "blocked",
  preflightStatus = "blocked",
  command = hostedEvidenceLaneCommand,
  proofTarget = hostedEvidenceLanePath,
  blockedCheckIds = hostedEvidenceHandoffBlockedCheckIds,
  blockedChecks = hostedEvidenceHandoffBlockedChecks,
  inputSections = hostedEvidenceHandoffInputSections(),
  blockedReceipt = null,
} = {}) {
  const blockedCheckIdSet = new Set(blockedCheckIds);
  return assertHostedEvidenceHandoffChecklist({
    status,
    preflightStatus,
    command,
    proofTarget,
    inputIds: [...hostedEvidenceHandoffInputIds],
    blockedCheckIds: [...blockedCheckIds],
    blockedChecks: blockedChecks
      .filter((check) => blockedCheckIdSet.has(check.id))
      .map((check) => ({ ...check })),
    inputSections,
    ...(blockedReceipt === null ? {} : { blockedReceipt }),
  });
}

export function hostedEvidenceBlockedHandoffChecklistFixture(options = {}) {
  return hostedEvidenceHandoffChecklistFixture({ ...options, status: "blocked" });
}

export function hostedEvidenceHandoffChecklistFromPreflight({
  preflight,
  command = hostedEvidenceLaneCommand,
  proofTarget = hostedEvidenceLanePath,
  inputSections = hostedEvidenceHandoffInputSections({
    providedInputIds: hostedEvidenceProvidedInputIdsFromPreflight(preflight),
  }),
}) {
  const blockedChecks = (preflight?.checks ?? [])
    .filter((check) => check?.status === "blocked")
    .map((check) => ({
      id: String(check.id ?? ""),
      status: "blocked",
      requiredEvidence: String(check.requiredEvidence ?? ""),
    }))
    .filter((check) => check.id !== "");
  return hostedEvidenceHandoffChecklistFixture({
    status: String(preflight?.status ?? "unknown"),
    preflightStatus: String(preflight?.status ?? "unknown"),
    command,
    proofTarget,
    blockedCheckIds: blockedChecks.map((check) => check.id),
    blockedChecks,
    inputSections,
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

export function hostedEvidenceBlockedHandoffChecklistFromPreflight(options) {
  return hostedEvidenceHandoffChecklistFromPreflight(options);
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
    hostedHandoffChecklist: hostedEvidenceBlockedHandoffChecklistFixture({
      blockedCheckIds,
    }),
  };
}
