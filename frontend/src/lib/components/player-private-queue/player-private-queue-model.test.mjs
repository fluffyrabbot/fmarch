import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerPrivateQueueViewModel,
  buildPrivateQueue,
  buildPrivateQueueBoundary,
  PLAYER_PRIVATE_QUEUE_CONTRACT,
} from "./player-private-queue-model.mjs";

test("player private queue model derives scoped private projection boundary", () => {
  const snapshot = {
    notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
    investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
    slotMentions: [
      {
        game: "midsummer",
        audience_slot: "slot-7",
        channel_id: "private:faction:mafia",
        source_seq: 443,
        phase_id: "D02",
        occurred_at: 1781928000,
      },
      {
        game: "midsummer",
        audience_slot: "slot-7",
        channel_id: "main",
        source_seq: 12,
        phase_id: null,
        occurred_at: 1781920000,
      },
    ],
  };

  assert.deepEqual(buildPrivateQueueBoundary(snapshot), {
    status: PLAYER_PRIVATE_QUEUE_CONTRACT.boundaryStatus,
    detail:
      "Night results, notices, and seats you were addressed as are delivered to you alone.",
    count: 4,
  });
  assert.deepEqual(buildPrivateQueue(snapshot), [
    {
      id: "notification-1",
      kind: "notification",
      label: "Commuted",
      value: "Delivered",
      detail: "Phase Night 2",
      buttonLabel: "Review",
    },
    {
      id: "slot-mention-1",
      kind: "slot-mention",
      label: "Addressed as slot-7",
      value: "private:faction:mafia",
      detail: "Phase Day 2",
      buttonLabel: "Review",
    },
    {
      id: "slot-mention-2",
      kind: "slot-mention",
      label: "Addressed as slot-7",
      value: "Main thread",
      detail: "Addressed outside a phase",
      buttonLabel: "Review",
    },
    {
      id: "investigation-1",
      kind: "investigation-result",
      label: "tracker",
      value: "Result for slot-4",
      detail: "Target slot-4",
      buttonLabel: "Review",
    },
  ]);
});

test("a delivered slot mention names a seat and a room, never an occupant", () => {
  const [item] = buildPrivateQueue({
    slotMentions: [
      {
        game: "midsummer",
        audience_slot: "slot-7",
        channel_id: "main",
        source_seq: 443,
        phase_id: "D02",
        occurred_at: 1781928000,
      },
    ],
  });

  // RFC 0007 §7 invariant 11: the row stores no principal, persona, or
  // occupancy, so the rail cannot render one even by accident. Occupancy was
  // resolved upstream, at read time, by the reader's own capabilities.
  const rendered = JSON.stringify(item);
  for (const forbidden of ["principal", "persona", "profile", "handle", "account"]) {
    assert.equal(
      rendered.includes(forbidden),
      false,
      `slot mention rail row leaked ${forbidden}`,
    );
  }
  assert.equal(item.label, "Addressed as slot-7");
});

test("player private queue model builds disclosure view state without host leakage", () => {
  const view = buildPlayerPrivateQueueViewModel({
    boundary: buildPrivateQueueBoundary({
      notifications: [{}],
      investigationResults: [],
    }),
    items: [
      {
        id: "notification-1",
        kind: "notification",
        label: "Private notification",
        value: "Available",
        detail: "Sent only to you",
        buttonLabel: "Review",
        reviewHref: "/g/midsummer?private=notification-1",
      },
    ],
    expandedItems: { "notification-1": true },
  });

  assert.equal(view.root.className, "player-private-queue fm-card");
  assert.equal(view.root.data.component, "player-private-queue");
  assert.equal(view.root.data.boundaryStatus, "principal-scoped-private-projections");
  assert.equal(view.boundary.count, 1);
  assert.equal(view.items[0].expanded, true);
  assert.equal(view.items[0].reviewTestId, "player-private-review-notification-1");
  assert.equal(view.items[0].reviewLinkTestId, "player-private-link-notification-1");
  assert.equal(view.items[0].reviewHref, "/g/midsummer?private=notification-1");
  assert.equal(view.items[0].reviewLinkLabel, "Open Private notification review");
  assert.equal(view.items[0].detailTestId, "player-private-detail-notification-1");
  assert.equal(view.items[0].reviewLabel, "Hide Private notification");
  assert.equal(view.items[0].ariaExpanded, "true");
  assert.equal(view.items[0].minTouchTargetPx, 44);
});

test("player private queue disclosure buttons name the private row without leaking host data", () => {
  const view = buildPlayerPrivateQueueViewModel({
    boundary: buildPrivateQueueBoundary({
      notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
      investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
    }),
    items: buildPrivateQueue({
      notifications: [{ effect: "Commuted", phase_id: "N02", status: "Delivered" }],
      investigationResults: [{ mode: "tracker", target_slot: "slot-4" }],
    }),
    expandedItems: {},
  });

  assert.deepEqual(
    view.items.map((item) => ({
      id: item.id,
      reviewLabel: item.reviewLabel,
      reviewLinkLabel: item.reviewLinkLabel,
      ariaExpanded: item.ariaExpanded,
      detailTestId: item.detailTestId,
    })),
    [
      {
        id: "notification-1",
        reviewLabel: "Review Commuted",
        reviewLinkLabel: "Open Commuted review",
        ariaExpanded: "false",
        detailTestId: "player-private-detail-notification-1",
      },
      {
        id: "investigation-1",
        reviewLabel: "Review tracker",
        reviewLinkLabel: "Open tracker review",
        ariaExpanded: "false",
        detailTestId: "player-private-detail-investigation-1",
      },
    ],
  );
});

test("player private queue model normalizes missing private rows conservatively", () => {
  assert.deepEqual(buildPrivateQueue({}), []);
  assert.deepEqual(
    buildPrivateQueue({
      notifications: [{}],
      investigationResults: [{}],
    }),
    [
      {
        id: "notification-1",
        kind: "notification",
        label: "Private notification",
        value: "Available",
        detail: "Sent only to you",
        buttonLabel: "Review",
      },
      {
        id: "investigation-1",
        kind: "investigation-result",
        label: "Investigation result",
        value: "Private result",
        detail: "Sent only to you",
        buttonLabel: "Review",
      },
    ],
  );
});
