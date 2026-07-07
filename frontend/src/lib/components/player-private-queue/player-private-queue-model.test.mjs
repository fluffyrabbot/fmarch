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
  };

  assert.deepEqual(buildPrivateQueueBoundary(snapshot), {
    status: PLAYER_PRIVATE_QUEUE_CONTRACT.boundaryStatus,
    detail:
      "Night results and notices are delivered to you alone.",
    count: 2,
  });
  assert.deepEqual(buildPrivateQueue(snapshot), [
    {
      id: "notification-1",
      kind: "notification",
      label: "Commuted",
      value: "Delivered",
      detail: "Phase N02",
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
