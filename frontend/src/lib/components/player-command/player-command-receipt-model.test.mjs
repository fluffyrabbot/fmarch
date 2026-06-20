import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerCommandReceiptViewModel,
  PLAYER_COMMAND_RECEIPT_CONTRACT,
} from "./player-command-receipt-model.mjs";

test("player command receipt model exposes a stable empty state", () => {
  const view = buildPlayerCommandReceiptViewModel();

  assert.equal(view.root.data.component, "player-command-receipt");
  assert.equal(view.root.className, PLAYER_COMMAND_RECEIPT_CONTRACT.rootClassName);
  assert.equal(view.summary, "Ready for player commands");
  assert.equal(view.items.length, 0);
  assert.deepEqual(view.empty, {
    className: "player-command-receipt__empty",
    testId: "player-command-receipt-empty",
    state: "idle",
    message: "No player commands in flight.",
  });
});

test("player command receipt model renders the current command status", () => {
  const view = buildPlayerCommandReceiptViewModel({
    receipts: [
      {
        actionId: "submit_vote",
        state: "reject",
        message: "Reject PhaseLocked: reload and retry",
        commandTrace: {
          kind: "command-trace",
          surface: "player",
          actionId: "submit_vote",
          statusKey: "submit_vote",
          dispatchKind: "submit_vote",
          projectionRefreshKeys: ["votecount"],
        },
        current: true,
      },
    ],
  });

  assert.equal(view.summary, "1 recent player command receipt");
  assert.deepEqual(view.items[0], {
    actionId: "submit_vote",
    state: "reject",
    label: "submit vote",
    message: "Reject PhaseLocked: reload and retry",
    testId: "player-command-receipt-submit_vote",
    statusTestId: "player-command-status",
    commandTrace: {
      kind: "command-trace",
      surface: "player",
      actionId: "submit_vote",
      statusKey: "submit_vote",
      dispatchKind: "submit_vote",
      projectionRefreshKeys: ["votecount"],
    },
    className: "player-command-receipt__item",
  });
});

test("player command receipt model caps rows and keeps newest first", () => {
  const view = buildPlayerCommandReceiptViewModel({
    receipts: [
      { actionId: "submit_vote", state: "ack", message: "vote ack" },
      { actionId: "withdraw_vote", state: "ack", message: "withdraw ack" },
      { actionId: "submit_post", state: "ack", message: "post ack" },
      {
        actionId: "submit_vote",
        state: "reject",
        message: "vote rejected",
        current: true,
      },
    ],
  });

  assert.deepEqual(
    view.items.map((item) => [item.actionId, item.statusTestId]),
    [
      ["submit_vote", "player-command-status"],
      ["submit_post", "player-command-receipt-status-submit_post"],
      ["withdraw_vote", "player-command-receipt-status-withdraw_vote"],
    ],
  );
});
