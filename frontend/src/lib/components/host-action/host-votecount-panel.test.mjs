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
      status: "cbor-ws-projection-deltas-with-resync-and-reconnect",
      command: "official-votecount-live-ws",
    },
    rows: [
      { target: "slot-2", count: 4, needed: 7 },
      { target: "No lynch", count: 1, needed: 7 },
    ],
    roster: [
      {
        slot_id: "slot-2",
        alive: true,
        status: "alive",
        occupancies: [
          { began_seq: 3, ended_seq: null, names: [{ effective_seq: 3, public_name: "Ilya" }] },
        ],
      },
    ],
  });

  assert.equal(view.root.className, HOST_VOTECOUNT_PANEL_CONTRACT.rootClassName);
  assert.equal(view.root.data.component, "host-votecount-panel");
  assert.equal(
    view.boundary.status,
    "cbor-ws-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(view.boundary.command, "official-votecount-live-ws");
  assert.deepEqual(view.rows, [
    {
      target: "slot-2",
      label: "Ilya · S2",
      tally: "4/7",
      fillPercent: 57,
      atHammer: false,
      testId: "host-console-votecount-row-slot-2",
      minTargetPx: 44,
    },
    {
      target: "No lynch",
      label: "No lynch",
      tally: "1/7",
      fillPercent: 14,
      atHammer: false,
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
    votecountRowTestId("slot-7 (replacement)"),
    "host-console-votecount-row-slot-7_replacement_",
  );
  assert.equal(
    buildHostVotecountPanelViewModel({
      boundary: {},
      rows: [{}],
    }).rows[0].testId,
    "host-console-votecount-row-unknown",
  );
});
