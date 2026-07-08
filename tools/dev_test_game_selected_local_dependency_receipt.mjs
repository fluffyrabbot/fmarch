import {
  nextActionAdminProofPath,
  nextActionPath,
} from "./dev_test_game_spine_artifact_paths.mjs";

export const selectedLocalDependencyTerminalReceiptId =
  "selected-local-dependency-terminal-receipt";
export const selectedLocalDependencyTerminalReceiptRowTestIdPrefix =
  "admin-audit-selected-local-dependency-terminal";
export const selectedLocalDependencyTerminalReceiptRowDefinitions =
  Object.freeze([
    Object.freeze({
      id: "receipt",
      summaryRowId: "receipt",
      testId: `${selectedLocalDependencyTerminalReceiptRowTestIdPrefix}-receipt`,
    }),
    Object.freeze({
      id: "selected-local-dependency",
      summaryRowId: "selected-local-dependency",
      testId:
        `${selectedLocalDependencyTerminalReceiptRowTestIdPrefix}-selected-local-dependency`,
    }),
  ]);

export function buildSelectedLocalDependencyTerminalReceipt({ nextAction }) {
  const localCheck = nextAction?.nextAction?.localCheck;
  const reason = String(nextAction?.nextAction?.reason ?? "unknown");
  if (
    reason !== "release-readiness-local-check-missing" ||
    localCheck === null ||
    typeof localCheck !== "object"
  ) {
    return {
      id: selectedLocalDependencyTerminalReceiptId,
      status: "not_applicable",
      reason,
      proofBoundary:
        "Local admin spine terminal receipt for next-action-selected local readiness prerequisites. It is not applicable unless the canonical next-action receipt is blocked on a missing local readiness check.",
      sourceArtifacts: {
        nextAction: nextActionPath,
        nextActionAdminProof: nextActionAdminProofPath,
      },
      assertions: [
        "canonical next-action receipt did not select a missing local readiness dependency",
      ],
      releaseReady: false,
      productionReady: false,
    };
  }
  return {
    id: selectedLocalDependencyTerminalReceiptId,
    status: "passed",
    reason,
    proofBoundary:
      "Local admin spine terminal receipt for the next-action-selected missing local readiness dependency. It records the prerequisite, recovery command, proof target, and seeded admin role URL before hosted/operator work can be selected; it does not prove hosted deployment, hosted operations, beta readiness, release readiness, or production readiness.",
    sourceArtifacts: {
      nextAction: nextActionPath,
      nextActionAdminProof: nextActionAdminProofPath,
    },
    selectedLocalDependency: {
      id: String(localCheck.id ?? ""),
      status: String(localCheck.status ?? ""),
      command: String(nextAction.nextAction.command ?? ""),
      requiredEvidence: String(localCheck.requiredEvidence ?? ""),
      buildSlice: String(localCheck.buildSlice ?? ""),
      proofTarget: String(localCheck.proofTarget ?? ""),
      roleUrl: String(localCheck.roleUrl ?? ""),
    },
    assertions: [
      "canonical next-action selected a missing local readiness dependency",
      "selected local dependency carries a recovery command",
      "selected local dependency carries a proof target",
      "selected local dependency carries a seeded admin role URL",
    ],
    releaseReady: false,
    productionReady: false,
  };
}

export function assertSelectedLocalDependencyTerminalReceipt(receipt) {
  if (
    receipt?.id !== selectedLocalDependencyTerminalReceiptId ||
    !["passed", "not_applicable"].includes(receipt.status) ||
    receipt.releaseReady !== false ||
    receipt.productionReady !== false ||
    typeof receipt.proofBoundary !== "string" ||
    receipt.proofBoundary.trim() === "" ||
    receipt.sourceArtifacts?.nextAction !== nextActionPath ||
    receipt.sourceArtifacts?.nextActionAdminProof !== nextActionAdminProofPath ||
    !Array.isArray(receipt.assertions)
  ) {
    throw new Error("selected local dependency terminal receipt drifted");
  }
  if (receipt.status === "not_applicable") {
    if (receipt.selectedLocalDependency !== undefined) {
      throw new Error(
        "not applicable selected local dependency receipt carried a dependency",
      );
    }
    return receipt;
  }
  const dependency = receipt.selectedLocalDependency;
  if (
    dependency === null ||
    typeof dependency !== "object" ||
    typeof dependency.id !== "string" ||
    dependency.id.trim() === "" ||
    dependency.status !== "missing" ||
    typeof dependency.command !== "string" ||
    dependency.command.trim() === "" ||
    typeof dependency.requiredEvidence !== "string" ||
    dependency.requiredEvidence.trim() === "" ||
    typeof dependency.buildSlice !== "string" ||
    dependency.buildSlice.trim() === "" ||
    typeof dependency.proofTarget !== "string" ||
    dependency.proofTarget.trim() === "" ||
    typeof dependency.roleUrl !== "string" ||
    !dependency.roleUrl.includes("?game=<seeded-game>")
  ) {
    throw new Error(
      "selected local dependency terminal receipt is missing prerequisite details",
    );
  }
  return receipt;
}

export function normalizeSelectedLocalDependencyTerminalReceipt(receipt) {
  if (
    receipt === null ||
    typeof receipt !== "object" ||
    receipt.id !== selectedLocalDependencyTerminalReceiptId ||
    !["passed", "not_applicable"].includes(receipt.status) ||
    receipt.sourceArtifacts === null ||
    typeof receipt.sourceArtifacts !== "object" ||
    !Array.isArray(receipt.assertions)
  ) {
    return null;
  }
  return Object.freeze({
    id: receipt.id,
    status: receipt.status,
    reason: String(receipt.reason ?? ""),
    proofBoundary: String(receipt.proofBoundary ?? ""),
    sourceArtifacts: Object.freeze({
      nextAction: String(receipt.sourceArtifacts.nextAction ?? ""),
      nextActionAdminProof: String(
        receipt.sourceArtifacts.nextActionAdminProof ?? "",
      ),
    }),
    assertions: Object.freeze(receipt.assertions.map((item) => String(item))),
    ...(receipt.selectedLocalDependency === undefined
      ? {}
      : {
          selectedLocalDependency: Object.freeze({
            id: String(receipt.selectedLocalDependency.id ?? ""),
            status: String(receipt.selectedLocalDependency.status ?? ""),
            command: String(receipt.selectedLocalDependency.command ?? ""),
            requiredEvidence: String(
              receipt.selectedLocalDependency.requiredEvidence ?? "",
            ),
            buildSlice: String(
              receipt.selectedLocalDependency.buildSlice ?? "",
            ),
            proofTarget: String(
              receipt.selectedLocalDependency.proofTarget ?? "",
            ),
            roleUrl: String(receipt.selectedLocalDependency.roleUrl ?? ""),
          }),
        }),
  });
}

export function selectedLocalDependencyTerminalReceiptRowFields(receipt) {
  return Object.freeze({
    receipt: Object.freeze([
      Object.freeze({ id: "status", value: receipt.status, emphasized: true }),
      Object.freeze({ id: "id", value: receipt.id }),
      Object.freeze({ id: "reason", value: receipt.reason }),
      Object.freeze({ id: "proofBoundary", value: receipt.proofBoundary }),
      Object.freeze({
        id: "sourceNextAction",
        value: receipt.sourceArtifacts.nextAction,
      }),
      Object.freeze({
        id: "sourceNextActionAdminProof",
        value: receipt.sourceArtifacts.nextActionAdminProof,
      }),
    ]),
    ...(receipt.selectedLocalDependency === undefined
      ? {}
      : {
          "selected-local-dependency":
            selectedLocalDependencyTerminalReceiptDependencyRowFields(
              receipt.selectedLocalDependency,
            ),
        }),
  });
}

export function selectedLocalDependencyTerminalReceiptRows(receipt) {
  const rowFields = selectedLocalDependencyTerminalReceiptRowFields(receipt);
  return selectedLocalDependencyTerminalReceiptRowDefinitions
    .filter((definition) => rowFields[definition.id] !== undefined)
    .map((definition) => definition.id);
}

export function selectedLocalDependencyTerminalReceiptRowDefinitionsForReceipt(
  receipt,
) {
  const rowFields = selectedLocalDependencyTerminalReceiptRowFields(receipt);
  return Object.freeze(
    selectedLocalDependencyTerminalReceiptRowDefinitions.filter(
      (definition) => rowFields[definition.id] !== undefined,
    ),
  );
}

export function selectedLocalDependencyTerminalReceiptRowStatuses(receipt) {
  const rowFields = selectedLocalDependencyTerminalReceiptRowFields(receipt);
  return Object.freeze(
    Object.fromEntries(
      Object.entries(rowFields).map(([id, fields]) => [
        id,
        selectedLocalDependencyTerminalReceiptRowStatusText(fields),
      ]),
    ),
  );
}

function selectedLocalDependencyTerminalReceiptDependencyRowFields(dependency) {
  return Object.freeze([
    Object.freeze({ id: "status", value: dependency.status, emphasized: true }),
    Object.freeze({ id: "id", value: dependency.id }),
    Object.freeze({ id: "command", value: dependency.command }),
    Object.freeze({
      id: "requiredEvidence",
      value: dependency.requiredEvidence,
    }),
    Object.freeze({ id: "buildSlice", value: dependency.buildSlice }),
    Object.freeze({ id: "proofTarget", value: dependency.proofTarget }),
    Object.freeze({ id: "roleUrl", value: dependency.roleUrl }),
  ]);
}

function selectedLocalDependencyTerminalReceiptRowStatusText(fields) {
  return fields.map((field) => field.value).join("\n");
}
