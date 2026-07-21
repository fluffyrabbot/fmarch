import {
  devTestGameAdminSpineAdminProofPath,
} from "./dev_test_game_local_admin_proof_paths.mjs";
import {
  selectedLocalDependencyTerminalReceiptId,
  normalizeSelectedLocalDependencyTerminalReceipt,
  selectedLocalDependencyTerminalReceiptRowDefinitions,
  selectedLocalDependencyTerminalReceiptRowDefinitionsForReceipt,
  selectedLocalDependencyTerminalReceiptRowFields,
  selectedLocalDependencyTerminalReceiptRowStatuses,
  selectedLocalDependencyTerminalReceiptRowTestIdPrefix,
} from "./dev_test_game_selected_local_dependency_receipt.mjs";
import {
  selectedOperatorHandoffTerminalReceiptId,
  normalizeSelectedOperatorHandoffTerminalReceipt,
  selectedOperatorHandoffTerminalReceiptRowDefinitions,
  selectedOperatorHandoffTerminalReceiptRowDefinitionsForReceipt,
  selectedOperatorHandoffTerminalReceiptRowFields,
  selectedOperatorHandoffTerminalReceiptRowStatuses,
  selectedOperatorHandoffTerminalReceiptRowTestIdPrefix,
} from "./dev_test_game_selected_operator_handoff_receipt.mjs";
import {
  selectedOperatorHandoffReceiptAdminProofCommand,
  selectedOperatorHandoffReceiptAdminProofPath,
} from "./dev_test_game_selected_operator_handoff_receipt_admin_proof_paths.mjs";

const adminSpineAdminProofCommand = "test:dev-test-game-admin-spine-admin-proof";

export const terminalReceiptContractRegistry = Object.freeze([
  Object.freeze({
    id: selectedLocalDependencyTerminalReceiptId,
    label: "selected-local-dependency",
    summaryHeading: "Selected local dependency receipt",
    adminRouteOrder: 20,
    terminalBatchesKey: "selectedLocalDependencyTerminalReceipt",
    summaryLinkFieldId: "roleUrl",
    summaryLinkTestId:
      `${selectedLocalDependencyTerminalReceiptRowTestIdPrefix}-role-url`,
    adminAuditProofRowsParam:
      "requiredSelectedLocalDependencyTerminalReceiptRows",
    adminAuditProofRowStatusesParam:
      "requiredSelectedLocalDependencyTerminalReceiptRowStatuses",
    adminAuditVisibleRowsKey:
      "visibleSelectedLocalDependencyTerminalReceiptRows",
    adminAuditVisibleRowStatusesKey:
      "visibleSelectedLocalDependencyTerminalReceiptRowStatuses",
    rowDefinitions: selectedLocalDependencyTerminalReceiptRowDefinitions,
    normalizeReceipt: normalizeSelectedLocalDependencyTerminalReceipt,
    rowDefinitionsForReceipt:
      selectedLocalDependencyTerminalReceiptRowDefinitionsForReceipt,
    rowFieldsForReceipt: selectedLocalDependencyTerminalReceiptRowFields,
    rowStatusForReceipt: selectedLocalDependencyTerminalReceiptRowStatuses,
    rowTestIdPrefix: selectedLocalDependencyTerminalReceiptRowTestIdPrefix,
    browserProofConsumers: Object.freeze([
      Object.freeze({
        id: "admin-spine-admin-proof",
        command: `npm run ${adminSpineAdminProofCommand}`,
        artifactPath: devTestGameAdminSpineAdminProofPath,
      }),
    ]),
  }),
  Object.freeze({
    id: selectedOperatorHandoffTerminalReceiptId,
    label: "selected-operator-handoff",
    summaryHeading: "Selected operator handoff receipt",
    adminRouteOrder: 10,
    terminalBatchesKey: "selectedOperatorHandoffReceipt",
    adminAuditProofRowsParam:
      "requiredSelectedOperatorHandoffTerminalReceiptRows",
    adminAuditProofRowStatusesParam:
      "requiredSelectedOperatorHandoffTerminalReceiptRowStatuses",
    adminAuditVisibleRowsKey:
      "visibleSelectedOperatorHandoffTerminalReceiptRows",
    adminAuditVisibleRowStatusesKey:
      "visibleSelectedOperatorHandoffTerminalReceiptRowStatuses",
    rowDefinitions: selectedOperatorHandoffTerminalReceiptRowDefinitions,
    normalizeReceipt: normalizeSelectedOperatorHandoffTerminalReceipt,
    rowDefinitionsForReceipt:
      selectedOperatorHandoffTerminalReceiptRowDefinitionsForReceipt,
    rowFieldsForReceipt: selectedOperatorHandoffTerminalReceiptRowFields,
    rowStatusForReceipt: selectedOperatorHandoffTerminalReceiptRowStatuses,
    rowTestIdPrefix: selectedOperatorHandoffTerminalReceiptRowTestIdPrefix,
    browserProofConsumers: Object.freeze([
      Object.freeze({
        id: "selected-operator-handoff-receipt-admin-proof",
        command: `npm run ${selectedOperatorHandoffReceiptAdminProofCommand}`,
        artifactPath: selectedOperatorHandoffReceiptAdminProofPath,
      }),
    ]),
  }),
]);

export * from "./dev_test_game_selected_local_dependency_receipt.mjs";
export * from "./dev_test_game_selected_operator_handoff_receipt.mjs";
