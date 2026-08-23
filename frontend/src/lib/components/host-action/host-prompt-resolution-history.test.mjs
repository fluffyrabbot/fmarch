import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT,
  buildHostPromptResolutionHistoryViewModel,
} from "./host-prompt-resolution-history.mjs";

test("host prompt history renders every typed public resolution family", () => {
  const view = buildHostPromptResolutionHistoryViewModel({
    hostPrompts: [
      {
        id: "D01:pk:Tie",
        status: "resolved",
        publicResolution: {
          kind: "day_vote_elimination",
          phase_id: "D01",
          selected_slot: "slot-2",
          reason: "host_decides_tie",
        },
      },
      {
        id: "D03R2:revote:NoMajority",
        status: "resolved",
        publicResolution: {
          kind: "phase_advance",
          source_phase_id: "D03R2",
          target_phase_id: "N03",
          reason: "no_majority_no_lynch",
        },
      },
      {
        id: "N02:notice:test",
        status: "resolved",
        publicResolution: {
          kind: "acknowledged",
          phase_id: "N02",
          reason: "role_notice",
        },
      },
      { id: "D04:pending", status: "pending" },
    ],
  });

  assert.equal(view.root.testId, HOST_PROMPT_RESOLUTION_HISTORY_CONTRACT.rootTestId);
  assert.deepEqual(
    view.rows.map((row) => [row.label, row.detail, row.testId]),
    [
      [
        "Day 1 official elimination",
        "Slot 2 selected after host decision",
        "host-prompt-resolution-D01:pk:Tie",
      ],
      [
        "Day 3 revote 2 -> Night 3",
        "No majority no lynch recorded",
        "host-prompt-resolution-D03R2:revote:NoMajority",
      ],
      [
        "Night 2 acknowledgement",
        "Role notice recorded",
        "host-prompt-resolution-N02:notice:test",
      ],
    ],
  );
});

test("host prompt history ignores unresolved and untyped prompts", () => {
  const view = buildHostPromptResolutionHistoryViewModel({
    hostPrompts: [
      { id: "D01:pending", status: "pending", publicResolution: {} },
      { id: "D02:earlier", status: "resolved" },
    ],
  });

  assert.deepEqual(view.rows, []);
  assert.equal(view.empty.message, "No resolved host prompt outcomes.");
});
