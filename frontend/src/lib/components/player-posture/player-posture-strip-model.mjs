export const PLAYER_POSTURE_STRIP_CONTRACT = Object.freeze({
  rootClassName: "player-posture-strip",
  itemClassName: "player-posture-strip__item",
  statusClassName: "player-posture-strip__status",
  componentName: "player-posture-strip",
  surface: "posture",
  testIdPrefix: "player-posture",
  statusTestIdPrefix: "player-posture-status",
  itemIds: Object.freeze(["phase", "deadline", "private"]),
});

export function buildPlayerPostureStripViewModel({
  phase = {},
  privateQueueBoundary = {},
} = {}) {
  const privateCount = Number(privateQueueBoundary.count ?? 0);
  const deadlineLabel = String(phase.deadlineLabel ?? "").trim();
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
        id: "phase",
        label: "Phase",
        value: phase.label ?? "Current phase",
        detail: phase.summary ?? "Waiting on the game to open",
        status: phaseStatus(phase),
      }),
      postureItem({
        id: "deadline",
        label: "Deadline",
        value: deadlineLabel === "" ? "No deadline committed" : deadlineLabel,
        detail:
          deadlineLabel === ""
            ? "The host has not set one"
            : "The phase closes at this time",
        status: deadlineStatus(deadlineLabel),
      }),
      postureItem({
        id: "private",
        label: "Private queue",
        value: countLabel(privateCount, "private item", "private items"),
        detail: "For your eyes only",
        evidence: privateQueueBoundary.status ?? null,
        status: privateQueueStatus(privateCount),
      }),
    ]),
  });
}

function postureItem({ id, label, value, detail, evidence = null, status }) {
  return Object.freeze({
    id,
    label,
    value,
    detail,
    evidence,
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

function phaseStatus(phase) {
  const state = String(phase.state ?? "").trim();
  if (state === "open") {
    return Object.freeze({
      state: "ack",
      message: "The phase is open",
    });
  }
  if (state === "locked") {
    return Object.freeze({
      state: "pending",
      message: "The phase is locked",
    });
  }
  if (state === "complete") {
    return Object.freeze({
      state: "ack",
      message: "The game is complete",
    });
  }
  return Object.freeze({
    state: "pending",
    message: "Phase state pending",
  });
}

function deadlineStatus(deadlineLabel) {
  if (deadlineLabel === "") {
    return Object.freeze({
      state: "pending",
      message: "Deadline not committed",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Deadline is committed",
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
