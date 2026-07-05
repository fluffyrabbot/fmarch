import {
  hostedTargetPreflightBlockingCheckIds,
  hostedTargetPreflightExternalTargetsRequiredEvidence,
  hostedTargetPreflightMissingApiUrlRequiredEvidence,
  hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  hostedTargetPreflightRawCaptureRequiredEvidence,
  hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence,
} from "./dev_test_game_hosted_target_preflight_cases.mjs";
import {
  hostedMatrixRawEvidenceContractSummary,
} from "./dev_test_game_hosted_matrix_raw_evidence_contract.mjs";
import {
  buildRealHostedEvidenceInputs,
  realHostedEvidenceInputIds,
} from "./dev_test_game_real_hosted_evidence_inputs.mjs";
import {
  devTestGameHostedTargetPreflightPath,
  devTestGameHostedEvidenceLanePath,
} from "./dev_test_game_adjacent_artifact_paths.mjs";
import {
  localAdminAuditIds,
  localAdminAuditRoleUrl,
} from "./dev_test_game_admin_audit_surface_ids.mjs";
import {
  devTestGameProofGraphPath,
} from "./dev_test_game_proof_graph_paths.mjs";

export const hostedEvidenceHandoffInputIds = realHostedEvidenceInputIds;
export const hostedEvidenceHandoffBlockedCheckIds =
  hostedTargetPreflightBlockingCheckIds;
export const hostedEvidenceLaneCommand =
  "npm run test:dev-test-game-hosted-evidence-lane";
export const hostedEvidenceLanePath = devTestGameHostedEvidenceLanePath;
export const devTestGameHostedEvidenceLaneAdminProofPath =
  "target/dev-test-game/hosted-evidence-lane-admin-proof.json";
export const devTestGameHostedEvidenceLaneRealCaptureAdminProofPath =
  "target/dev-test-game/hosted-evidence-lane-real-capture-admin-proof.json";
export const devTestGameHostedEvidenceLaneRealCaptureSourcePath =
  "target/dev-test-game/hosted-evidence-lane-real-capture-source.json";
export const devTestGameHostedEvidenceLaneRealCaptureAdminProofCommand =
  "npm run test:dev-test-game-hosted-evidence-lane-real-capture-admin-proof";
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
  {
    id: "raw-evidence-real-hosted-target",
    status: "blocked",
    requiredEvidence: hostedTargetPreflightSyntheticRawEvidenceRequiredEvidence,
  },
]);

export const hostedEvidenceHandoffInputCheckIds = Object.freeze({
  FMARCH_HOSTED_MATRIX_FRONTEND_URL: "hosted-frontend-url-configured",
  FMARCH_HOSTED_MATRIX_API_URL: "hosted-api-url-configured",
  FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: "raw-evidence-path-configured",
});

export const hostedEvidenceHandoffInputSectionsByInputId = Object.freeze({
  FMARCH_HOSTED_MATRIX_FRONTEND_URL: Object.freeze({
    id: "hosted-target",
    label: "Hosted target",
  }),
  FMARCH_HOSTED_MATRIX_API_URL: Object.freeze({
    id: "hosted-target",
    label: "Hosted target",
  }),
  FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH: Object.freeze({
    id: "raw-evidence",
    label: "Raw evidence",
  }),
});

const hostedEvidenceHandoffBlockedEvidenceByCheckId = Object.freeze({
  "hosted-frontend-url-configured":
    hostedTargetPreflightMissingFrontendUrlRequiredEvidence,
  "hosted-api-url-configured":
    hostedTargetPreflightMissingApiUrlRequiredEvidence,
  "raw-evidence-path-configured":
    hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  "raw-evidence-readable":
    hostedTargetPreflightMissingRawEvidencePathRequiredEvidence,
  "raw-evidence-real-hosted-target":
    hostedTargetPreflightRawCaptureRequiredEvidence,
});

export function hostedEvidenceRequiredInputsFixture({
  frontendBaseUrl = null,
  apiBaseUrl = null,
  groupId = "replacement-race-reload",
  rawEvidencePath = null,
} = {}) {
  return [
    {
      name: "FMARCH_HOSTED_MATRIX_FRONTEND_URL",
      value: frontendBaseUrl,
      required: true,
      purpose: "Externally reachable frontend base URL.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_API_URL",
      value: apiBaseUrl,
      required: true,
      purpose: "Externally reachable API base URL for the same hosted deployment.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_GROUP_ID",
      value: groupId,
      required: true,
      purpose: "Hosted matrix group to prove.",
    },
    {
      name: "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH",
      value: rawEvidencePath,
      required: true,
      purpose: hostedMatrixRawEvidenceContractSummary(),
    },
    {
      name: "FMARCH_HOSTED_MATRIX_EVIDENCE_PATH",
      value: null,
      required: false,
      purpose: "Optional normalized hosted matrix evidence output path.",
    },
  ];
}

export function hostedEvidenceFirstMissingOperatorArtifact({
  blockedCheckIds = [],
  missingRequiredInputs,
  requiredInputs = hostedEvidenceRequiredInputsFixture(),
  rawCapture,
} = {}) {
  const resolvedMissingRequiredInputs =
    missingRequiredInputs ??
    requiredInputs
      .filter((input) => input.required === true && input.value === null)
      .map((input) => input.name);
  const missingInputId =
    resolvedMissingRequiredInputs[0] ??
    (Array.isArray(rawCapture?.blockedCheckIds) &&
    rawCapture.blockedCheckIds.length > 0
      ? "FMARCH_HOSTED_MATRIX_RAW_EVIDENCE_PATH"
      : null);
  if (missingInputId === null) {
    return null;
  }
  const checkId =
    hostedEvidenceHandoffInputCheckIds[missingInputId] ??
    blockedCheckIds.find((id) => String(id).startsWith("raw-evidence-")) ??
    String(blockedCheckIds[0] ?? "");
  const section = hostedEvidenceHandoffInputSectionsByInputId[missingInputId] ?? {
    id: "hosted-target",
    label: "Hosted target",
  };
  const requiredInput = requiredInputs.find(
    (input) => input.name === missingInputId,
  );
  const requiredEvidence =
    hostedEvidenceHandoffBlockedEvidenceByCheckId[checkId] ??
    hostedTargetPreflightRawCaptureRequiredEvidence;
  return {
    inputId: missingInputId,
    checkId,
    sectionId: section.id,
    sectionLabel: section.label,
    requiredEvidence,
    purpose: String(requiredInput?.purpose ?? requiredEvidence),
    proofTarget: devTestGameHostedTargetPreflightPath,
    roleSurfaceDrilldown: {
      localCapabilityAuditId: localAdminAuditIds.coreLoop,
      localCapabilityRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.coreLoop),
      handoffAuditId: localAdminAuditIds.hostedEvidenceLane,
      handoffRoleUrl: localAdminAuditRoleUrl(localAdminAuditIds.hostedEvidenceLane),
      proofGraphNodeId: "admin-proof:hosted-evidence-lane",
      productionFeatureGraphNodeId: "production-feature:host-phase-control",
      proofGraphEvidencePath: devTestGameProofGraphPath,
    },
  };
}

function hostedEvidenceFirstMissingProgressionCase({
  id,
  label,
  requiredInputValues,
  blockedCheckIds,
  rawCaptureBlockedCheckIds,
}) {
  const requiredInputs = hostedEvidenceRequiredInputsFixture(requiredInputValues);
  const missingRequiredInputs = requiredInputs
    .filter((input) => input.required === true && input.value === null)
    .map((input) => input.name);
  const rawCapture = Object.freeze({
    status: rawCaptureBlockedCheckIds.length === 0 ? "passed" : "blocked",
    blockedCheckIds: Object.freeze([...rawCaptureBlockedCheckIds]),
  });
  const firstMissingOperatorArtifact = hostedEvidenceFirstMissingOperatorArtifact({
    blockedCheckIds,
    missingRequiredInputs,
    requiredInputs,
    rawCapture,
  });
  return Object.freeze({
    id,
    label,
    blockedCheckIds: Object.freeze([...blockedCheckIds]),
    missingRequiredInputs: Object.freeze([...missingRequiredInputs]),
    requiredInputs: Object.freeze(requiredInputs.map((input) => Object.freeze(input))),
    rawCapture,
    firstMissingOperatorArtifact:
      firstMissingOperatorArtifact === null
        ? null
        : Object.freeze({
            ...firstMissingOperatorArtifact,
            roleSurfaceDrilldown: Object.freeze(
              firstMissingOperatorArtifact.roleSurfaceDrilldown,
            ),
          }),
  });
}

export const hostedEvidenceFirstMissingProgressionCases = Object.freeze([
  hostedEvidenceFirstMissingProgressionCase({
    id: "missing-hosted-target-inputs",
    label: "Missing hosted target inputs",
    blockedCheckIds: hostedTargetPreflightBlockingCheckIds,
    rawCaptureBlockedCheckIds: [
      "raw-evidence-path-configured",
      "raw-evidence-contract-valid",
      "fixture-and-demo-markers-absent",
      "capture-redaction-retention-metadata",
    ],
  }),
  hostedEvidenceFirstMissingProgressionCase({
    id: "demo-raw-evidence-still-blocked",
    label: "Demo raw evidence still blocked",
    requiredInputValues: {
      frontendBaseUrl: "https://fmarch-demo.example.test",
      apiBaseUrl: "https://api.fmarch-demo.example.test",
      rawEvidencePath: "target/dev-test-game/hosted-matrix-demo-raw.json",
    },
    blockedCheckIds: ["raw-evidence-real-hosted-target"],
    rawCaptureBlockedCheckIds: [
      "fixture-and-demo-markers-absent",
      "capture-redaction-retention-metadata",
    ],
  }),
  hostedEvidenceFirstMissingProgressionCase({
    id: "real-raw-capture-ready",
    label: "Real raw capture ready",
    requiredInputValues: {
      frontendBaseUrl: "https://fmarch.example.test",
      apiBaseUrl: "https://api.fmarch.example.test",
      rawEvidencePath: "target/dev-test-game/hosted-matrix-raw-evidence.json",
    },
    blockedCheckIds: [],
    rawCaptureBlockedCheckIds: [],
  }),
]);

export function hostedEvidenceFirstMissingProgressionCaseById(id) {
  const found = hostedEvidenceFirstMissingProgressionCases.find(
    (item) => item.id === id,
  );
  if (found === undefined) {
    throw new Error(`unknown hosted evidence first-missing progression case: ${id}`);
  }
  return found;
}

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
