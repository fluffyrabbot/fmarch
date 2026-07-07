export const PLAYER_PRIVATE_QUEUE_CONTRACT = Object.freeze({
  rootClassName: "player-private-queue fm-card",
  componentName: "player-private-queue",
  boundaryStatus: "principal-scoped-private-projections",
  minTouchTargetPx: 44,
});

export function buildPrivateQueueBoundary({
  notifications = [],
  investigationResults = [],
} = {}) {
  return Object.freeze({
    status: PLAYER_PRIVATE_QUEUE_CONTRACT.boundaryStatus,
    detail:
      "Notifications and investigation results are loaded from principal-scoped endpoints only.",
    count: notifications.length + investigationResults.length,
  });
}

export function buildPrivateQueue({ notifications = [], investigationResults = [] } = {}) {
  return Object.freeze([
    ...notifications.map((notification, index) =>
      Object.freeze({
        id: `notification-${index + 1}`,
        kind: "notification",
        label: notification.effect ?? "Private notification",
        value: notification.status ?? notification.phase_id ?? "Available",
        detail:
          notification.phase_id === undefined
            ? "Principal-scoped notification"
            : `Phase ${notification.phase_id}`,
        buttonLabel: "Review",
      }),
    ),
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
            ? "Private investigation result"
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
