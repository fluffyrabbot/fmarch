export const PLAYER_POSTURE_STRIP_CONTRACT = Object.freeze({
  rootClassName: "player-posture-strip",
  itemClassName: "player-posture-strip__item",
  statusClassName: "player-posture-strip__status",
  componentName: "player-posture-strip",
  surface: "posture",
  testIdPrefix: "player-posture",
  statusTestIdPrefix: "player-posture-status",
  itemIds: Object.freeze(["channel", "thread", "votecount", "private"]),
});

export function buildPlayerPostureStripViewModel({
  channel = {},
  phase = {},
  projectionBoundary = {},
  threadPager = {},
  votecount = [],
  privateQueueBoundary = {},
} = {}) {
  const privateCount = Number(privateQueueBoundary.count ?? 0);
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_POSTURE_STRIP_CONTRACT.rootClassName,
      ariaLabel: "Player posture",
      data: Object.freeze({
        component: PLAYER_POSTURE_STRIP_CONTRACT.componentName,
      }),
    }),
    items: Object.freeze([
      postureItem({
        id: "channel",
        label: "Channel",
        value: channel.label ?? "Unknown channel",
        detail: channel.capabilityLabel ?? "No scoped channel capability",
        status: channelStatus(channel),
      }),
      postureItem({
        id: "thread",
        label: "Thread",
        value: threadPager.hasOlder === true ? "Older posts available" : "At oldest loaded post",
        detail: threadPager.olderEndpoint ?? `Channel ${threadPager.channel ?? "unknown"}`,
        status: threadStatus(threadPager),
      }),
      postureItem({
        id: "votecount",
        label: "Votecount",
        value: countLabel(votecount.length, "projected target", "projected targets"),
        detail: projectionBoundary.status ?? "Projection boundary unknown",
        status: votecountStatus({ projectionBoundary, votecount }),
      }),
      postureItem({
        id: "private",
        label: "Private queue",
        value: countLabel(privateCount, "private item", "private items"),
        detail: privateQueueBoundary.status ?? "Principal-scoped private projections",
        status: privateQueueStatus(privateCount),
      }),
    ]),
  });
}

function postureItem({ id, label, value, detail, status }) {
  return Object.freeze({
    id,
    label,
    value,
    detail,
    status,
    className: PLAYER_POSTURE_STRIP_CONTRACT.itemClassName,
    statusClassName: PLAYER_POSTURE_STRIP_CONTRACT.statusClassName,
    testId: playerPostureTestId(id),
    statusTestId: playerPostureStatusTestId(id),
  });
}

export function playerPostureTestId(id) {
  return `${PLAYER_POSTURE_STRIP_CONTRACT.testIdPrefix}-${id}`;
}

export function playerPostureStatusTestId(id) {
  return `${PLAYER_POSTURE_STRIP_CONTRACT.statusTestIdPrefix}-${id}`;
}

function channelStatus(channel) {
  if (channel.supported === false) {
    return Object.freeze({
      state: "reject",
      message: "Channel is not available",
    });
  }
  if (channel.allowed === false) {
    return Object.freeze({
      state: "reject",
      message: "Channel requires scoped capability",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Channel capability resolved",
  });
}

function threadStatus(threadPager) {
  if (threadPager.hasOlder === true) {
    return Object.freeze({
      state: "pending",
      message: "Older posts can be loaded",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Loaded thread is at oldest post",
  });
}

function votecountStatus({ projectionBoundary, votecount }) {
  if (!String(projectionBoundary.status ?? "").includes("ws")) {
    return Object.freeze({
      state: "pending",
      message: "Live projection boundary not established",
    });
  }
  if (votecount.length === 0) {
    return Object.freeze({
      state: "pending",
      message: "No active projected ballots",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Votecount projection is live",
  });
}

function privateQueueStatus(privateCount) {
  if (privateCount > 0) {
    return Object.freeze({
      state: "pending",
      message: "Private items are ready to review",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "No private items visible",
  });
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
