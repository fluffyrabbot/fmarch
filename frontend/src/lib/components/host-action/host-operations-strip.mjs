export const HOST_OPERATIONS_STRIP_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__operations",
  itemClassName: "host-console-critical-path__operation",
  statusClassName: "host-console-critical-path__operation-status",
  componentName: "host-operations-strip",
  surface: "operations",
  testIdPrefix: "host-operation",
  statusTestIdPrefix: "host-operation-status",
  itemIds: Object.freeze(["phase", "votecount", "prompts", "lifecycle"]),
});

export function buildHostOperationsStripViewModel({
  access = {},
  phase = {},
  projection = {},
  votecountBoundary = {},
  votecount = [],
  hostPrompts = [],
} = {}) {
  const livePhase = projection?.phase ?? {};
  const replacement = projection?.replacement ?? {};
  const pendingPrompts = hostPrompts.filter((prompt) => prompt.status === "pending");
  const deadlineLabel = livePhase.deadlineLabel ?? phase.deadlineLabel ?? "No deadline committed";
  const threadLabel = livePhase.lockedLabel ?? phase.lockedLabel ?? "Thread state unknown";
  const lifecycleLabel = replacement.lifecycleLabel ?? "Unknown lifecycle";
  const historyLabel = replacement.historyLabel ?? "Slot history unavailable";

  return Object.freeze({
    root: Object.freeze({
      className: HOST_OPERATIONS_STRIP_CONTRACT.rootClassName,
      ariaLabel: "Host operations posture",
      data: Object.freeze({
        component: HOST_OPERATIONS_STRIP_CONTRACT.componentName,
      }),
    }),
    items: Object.freeze([
      operationItem({
        id: "phase",
        label: "Phase",
        value: String(phase.label ?? "Current phase"),
        detail: `${deadlineLabel} · ${threadLabel}`,
        status: phaseStatus(deadlineLabel),
      }),
      operationItem({
        id: "votecount",
        label: "Votecount",
        value: countLabel(votecount.length, "projected target", "projected targets"),
        detail: "Live official tally",
        evidence: votecountBoundary.command ?? "official-votecount-live-ws",
        status: votecountStatus({ boundary: votecountBoundary, rows: votecount }),
      }),
      operationItem({
        id: "prompts",
        label: "Host prompts",
        value: countLabel(pendingPrompts.length, "pending prompt", "pending prompts"),
        detail:
          pendingPrompts[0] === undefined
            ? "No pending host prompts"
            : `${pendingPrompts[0].label}: ${pendingPrompts[0].value}`,
        status: promptStatus(pendingPrompts.length),
      }),
      operationItem({
        id: "lifecycle",
        label: "Slot lifecycle",
        value: lifecycleLabel,
        detail: `${replacement.occupantLabel ?? access.capabilityLabel ?? "Unknown slot"} · ${historyLabel}`,
        status: lifecycleStatus({ lifecycleLabel, historyLabel }),
      }),
    ]),
  });
}

function operationItem({ id, label, value, detail, evidence = null, status }) {
  return Object.freeze({
    id,
    label,
    value,
    detail,
    evidence,
    status,
    className: HOST_OPERATIONS_STRIP_CONTRACT.itemClassName,
    statusClassName: HOST_OPERATIONS_STRIP_CONTRACT.statusClassName,
    testId: hostOperationTestId(id),
    statusTestId: hostOperationStatusTestId(id),
  });
}

export function hostOperationTestId(id) {
  return `${HOST_OPERATIONS_STRIP_CONTRACT.testIdPrefix}-${id}`;
}

export function hostOperationStatusTestId(id) {
  return `${HOST_OPERATIONS_STRIP_CONTRACT.statusTestIdPrefix}-${id}`;
}

function phaseStatus(deadlineLabel) {
  if (/no deadline|unknown/i.test(deadlineLabel)) {
    return Object.freeze({
      state: "pending",
      message: "Deadline needs host review",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Phase deadline is projected",
  });
}

function votecountStatus({ boundary, rows }) {
  if (!String(boundary?.status ?? "").includes("ws")) {
    return Object.freeze({
      state: "pending",
      message: "Votecount live boundary not established",
    });
  }
  if (rows.length === 0) {
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

function promptStatus(pendingPromptCount) {
  if (pendingPromptCount > 0) {
    return Object.freeze({
      state: "pending",
      message: "Host prompt requires resolution",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "No pending host prompts",
  });
}

function lifecycleStatus({ lifecycleLabel, historyLabel }) {
  if (/unknown|unavailable/i.test(`${lifecycleLabel} ${historyLabel}`)) {
    return Object.freeze({
      state: "reject",
      message: "Slot lifecycle projection unavailable",
    });
  }
  if (/waiting|pending|replacement/i.test(historyLabel)) {
    return Object.freeze({
      state: "pending",
      message: "Slot lifecycle needs host action",
    });
  }
  return Object.freeze({
    state: "ack",
    message: "Slot lifecycle projection is current",
  });
}

function countLabel(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
