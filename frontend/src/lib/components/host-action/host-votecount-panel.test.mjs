import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_VOTECOUNT_PANEL_CONTRACT,
  buildHostVotecountPanelViewModel,
  votecountRowTestId,
} from "./host-votecount-panel.mjs";

test("host votecount panel model exposes live official-count boundary", () => {
  const view = buildHostVotecountPanelViewModel({
    boundary: {
      status: "json-ws-command-projection-deltas-with-resync",
      command: "official-votecount-live-ws",
    },
    rows: [
      { target: "slot-2 / Ilya", count: 4, needed: 7 },
      { target: "No lynch", count: 1, needed: 7 },
    ],
  });

  assert.equal(view.root.className, HOST_VOTECOUNT_PANEL_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "host-votecount-panel");
  assert.equal(view.boundary.status, "json-ws-command-projection-deltas-with-resync");
  assert.equal(view.boundary.command, "official-votecount-live-ws");
  assert.deepEqual(view.rows, [
    {
      target: "slot-2 / Ilya",
      tally: "4/7",
      testId: "host-console-votecount-row-slot-2_Ilya",
      minTargetPx: 44,
    },
    {
      target: "No lynch",
      tally: "1/7",
      testId: "host-console-votecount-row-No_lynch",
      minTargetPx: 44,
    },
  ]);
});

test("host votecount panel model represents empty ballot state", () => {
  const view = buildHostVotecountPanelViewModel({
    boundary: null,
    rows: [],
  });

  assert.equal(view.boundary.status, "unknown");
  assert.equal(view.boundary.command, "official-votecount-live-ws");
  assert.equal(view.empty.message, "No active ballots");
  assert.equal(view.rows.length, 0);
});

test("host votecount row test ids normalize arbitrary targets", () => {
  assert.equal(
    votecountRowTestId("slot-7 / Mira (replacement)"),
    "host-console-votecount-row-slot-7_Mira_replacement_",
  );
  assert.equal(
    buildHostVotecountPanelViewModel({
      boundary: {},
      rows: [{}],
    }).rows[0].testId,
    "host-console-votecount-row-unknown",
  );
});
