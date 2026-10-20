export const PLAYER_COMMAND_RECEIPT_CONTRACT = Object.freeze({
  componentName: "player-command-receipt",
  rootClassName: "player-command-receipt fm-proof-disclosure",
  listClassName: "fm-ledger__list",
  itemClassName: "fm-ledger__row",
  emptyClassName: "fm-ledger__empty",
  currentStatusTestId: "player-command-status",
  maxItems: 3,
});

export function buildPlayerCommandReceiptViewModel({ receipts = [] } = {}) {
  const items = receipts
    .slice(-PLAYER_COMMAND_RECEIPT_CONTRACT.maxItems)
    .reverse()
    .map(receiptItem);

  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_COMMAND_RECEIPT_CONTRACT.rootClassName,
      ariaLabel: "Player command receipts",
      data: Object.freeze({
        component: PLAYER_COMMAND_RECEIPT_CONTRACT.componentName,
      }),
    }),
    heading: "Receipts",
    summary:
      items.length === 0
        ? "Ready for player commands"
        : `${items.length} recent player command ${items.length === 1 ? "receipt" : "receipts"}`,
    empty: Object.freeze({
      className: PLAYER_COMMAND_RECEIPT_CONTRACT.emptyClassName,
      testId: "player-command-receipt-empty",
      state: "idle",
      message: "No player commands in flight.",
    }),
    listClassName: PLAYER_COMMAND_RECEIPT_CONTRACT.listClassName,
    items: Object.freeze(items),
  });
}

function receiptItem(receipt) {
  const actionId = String(receipt?.actionId ?? "player-command");
  const state = String(receipt?.state ?? "info");
  return Object.freeze({
    actionId,
    current: receipt?.current === true,
    state,
    label: labelForAction(actionId),
    message: String(receipt?.message ?? "Command updated"),
    testId: `player-command-receipt-${actionId}`,
    statusTestId:
      receipt?.current === true
        ? PLAYER_COMMAND_RECEIPT_CONTRACT.currentStatusTestId
        : `player-command-receipt-status-${actionId}`,
    commandTrace: receipt?.commandTrace ?? null,
    className: PLAYER_COMMAND_RECEIPT_CONTRACT.itemClassName,
  });
}

function labelForAction(actionId) {
  return String(actionId).replaceAll("_", " ").replaceAll("-", " ");
}
