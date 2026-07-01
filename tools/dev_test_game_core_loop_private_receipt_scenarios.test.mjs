import assert from "node:assert/strict";
import { test } from "node:test";
import {
  completedPrivateChannelReloadScenario,
  completedPrivateChannelSnapshot,
  completedPrivateChannelTransition,
  staleCompletedPrivatePostScenario,
} from "./dev_test_game_core_loop_private_receipt_scenarios.mjs";

test("completed private-channel scenarios build reusable snapshots and transitions", () => {
  const reloadScenario = completedPrivateChannelReloadScenario();
  const staleScenario = staleCompletedPrivatePostScenario();

  assert.equal(
    completedPrivateChannelTransition(),
    [
      reloadScenario.transitionToken,
      staleScenario.transitionToken,
    ].join(" -> "),
  );

  assert.deepEqual(
    completedPrivateChannelSnapshot({
      scenario: reloadScenario,
      receiptState: "reject:GameAlreadyCompleted",
      boundary: staleScenario.routeBoundary,
    }),
    {
      checkpoint: {
        phaseId: "N05",
        phaseState: "open",
        actorSlot: "slot-7",
        actionState: "disabled:game complete",
        receiptState: "reject:GameAlreadyCompleted",
      },
      commandPanelChannelId: "role-pm",
      channelContext: {
        channelId: "role-pm",
        actorSlot: "slot-7",
        capabilityLabel: "ChannelMember(role-pm)",
        actorStatus: "alive",
      },
      commandState: {
        actorSlot: "slot-7",
        gameCompleted: true,
        actions: [],
        voteTargets: [],
        boundary:
          "Seeded browser completed private-channel GameAlreadyCompleted recovery refreshed role-pm controls.",
      },
      threadPostBodies: ["Completed private channel remains readable."],
      buttons: [
        { action: "withdraw_vote", disabled: true, reason: "" },
        { action: "submit_post", disabled: true, reason: "" },
      ],
      enabledMutatingButtons: [],
    },
  );
});
