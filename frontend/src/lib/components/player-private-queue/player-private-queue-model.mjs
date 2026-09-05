export const PLAYER_PRIVATE_QUEUE_CONTRACT = Object.freeze({
  rootClassName: "player-private-queue fm-card",
  componentName: "player-private-queue",
  boundaryStatus: "principal-scoped-private-projections",
  minTouchTargetPx: 44,
});

export function buildPrivateQueueBoundary({
  notifications = [],
  investigationResults = [],
  slotMentions = [],
} = {}) {
  return Object.freeze({
    status: PLAYER_PRIVATE_QUEUE_CONTRACT.boundaryStatus,
    detail:
      "Night results, notices, and seats you were addressed as are delivered to you alone.",
    count:
      notifications.length + investigationResults.length + slotMentions.length,
  });
}

export function buildPrivateQueue({
  notifications = [],
  investigationResults = [],
  slotMentions = [],
} = {}) {
  return Object.freeze([
    ...notifications.map((notification, index) => {
      const phaseLabel = phaseLabelFromId(notification.phase_id);
      return Object.freeze({
        id: `notification-${index + 1}`,
        kind: "notification",
        label: notification.effect ?? "Private notification",
        value: notification.status ?? phaseLabel ?? "Available",
        detail:
          phaseLabel === null
            ? "Sent only to you"
            : `Phase ${phaseLabel}`,
        buttonLabel: "Review",
      });
    }),
    // RFC 0007 §7: the delivered row names a seat, not a person. It reaches
    // this rail because the API resolved current occupancy at read time, so a
    // seat that changed hands carries its pending mentions to whoever holds it
    // now and no row is ever rewritten.
    ...slotMentions.map((mention, index) => {
      const phaseLabel = phaseLabelFromId(mention.phase_id);
      return Object.freeze({
        id: `slot-mention-${index + 1}`,
        kind: "slot-mention",
        label: `Addressed as ${mention.audience_slot}`,
        value: channelLabel(mention.channel_id),
        detail:
          phaseLabel === null
            ? "Addressed outside a phase"
            : `Phase ${phaseLabel}`,
        buttonLabel: "Review",
      });
    }),
    ...investigationResults.map((result, index) =>
      Object.freeze({
        id: `investigation-${index + 1}`,
        kind: "investigation-result",
        label: result.mode ?? "Investigation result",
        value:
          result.result ??
          (result.target_slot === undefined
            ? "Private result"
            : `Result for ${result.target_slot}`),
        detail:
          result.target_slot === undefined
            ? "Sent only to you"
            : `Target ${result.target_slot}`,
        buttonLabel: "Review",
      }),
    ),
  ]);
}

export function buildPlayerPrivateQueueViewModel({
  boundary = buildPrivateQueueBoundary(),
  items = [],
  expandedItems = {},
}) {
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_PRIVATE_QUEUE_CONTRACT.rootClassName,
      data: Object.freeze({
        component: PLAYER_PRIVATE_QUEUE_CONTRACT.componentName,
        boundaryStatus: boundary.status,
      }),
    }),
    heading: "Private queue",
    boundary: Object.freeze({
      detail: boundary.detail,
      count: Number(boundary.count ?? 0),
    }),
    emptyMessage: "No private results visible to this session.",
    items: Object.freeze(
      items.map((item) =>
        Object.freeze({
          ...item,
          expanded: expandedItems[item.id] === true,
          detailTestId: `player-private-detail-${item.id}`,
          reviewTestId: `player-private-review-${item.id}`,
          reviewLinkTestId: `player-private-link-${item.id}`,
          reviewHref: item.reviewHref ?? null,
          reviewLinkLabel: `Open ${item.label} review`,
          reviewLabel:
            expandedItems[item.id] === true
              ? `Hide ${item.label}`
              : `Review ${item.label}`,
          ariaExpanded: expandedItems[item.id] === true ? "true" : "false",
          minTouchTargetPx: PLAYER_PRIVATE_QUEUE_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
  });
}
/// A room the reader can already see, named as the composer names it. The
/// mention row carries no prose, so this is a pointer, never a preview.
function channelLabel(channelId) {
  const channel = String(channelId ?? "").trim();
  if (channel === "") {
    return "A room you can read";
  }
  return channel === "main" ? "Main thread" : channel;
}

import { phaseLabelFromId } from "../../phase-id.mjs";
