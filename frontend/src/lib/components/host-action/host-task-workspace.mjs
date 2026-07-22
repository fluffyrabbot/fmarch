import { visibleHostCommandStatus } from "./host-command-status.mjs";

export const HOST_TASK_WORKSPACE_CONTRACT = Object.freeze({
  rootClassName: "host-task-workspace fm-primary-action-zone",
  componentName: "host-task-workspace",
  thumbZone: "moderator-primary-actions",
  thumbZoneTestId: "moderator-primary-action-zone",
  queueTestId: "host-task-queue",
  canvasTestId: "host-decision-canvas",
  commandContextTestId: "moderator-command-context",
  actionTileStabilityMode: "reserved-status-floor",
  statusFloorMinBlockSizePx: 44,
});

const TASK_POSTURE = Object.freeze({
  deadline: Object.freeze({ rank: 1, urgency: "due-soon", label: "Due soon" }),
  "host-prompts": Object.freeze({ rank: 2, urgency: "attention", label: "Needs decision" }),
  replacement: Object.freeze({ rank: 3, urgency: "attention", label: "Player waiting" }),
  phase: Object.freeze({ rank: 10, urgency: "routine", label: "Routine" }),
  votecount: Object.freeze({ rank: 11, urgency: "routine", label: "Routine" }),
  "slot-lifecycle": Object.freeze({ rank: 12, urgency: "maintenance", label: "Maintenance" }),
  roles: Object.freeze({ rank: 20, urgency: "endgame", label: "Endgame" }),
});

export function buildHostTaskWorkspaceViewModel({
  groups = [],
  commandStatuses = {},
  commandContext = {},
  phase = {},
  replacement = {},
  hostPrompts = [],
  votecount = [],
  selectedTaskId = null,
} = {}) {
  const tasks = groups
    .map((group, index) => buildTask({
      group,
      index,
      commandStatuses,
      phase,
      replacement,
      hostPrompts,
      votecount,
    }))
    .sort((left, right) => left.rank - right.rank || left.sourceIndex - right.sourceIndex);
  const resolvedSelectedId = tasks.some((task) => task.id === selectedTaskId)
    ? selectedTaskId
    : tasks[0]?.id ?? null;
  const selectedTask = tasks.find((task) => task.id === resolvedSelectedId) ?? null;

  return Object.freeze({
    root: Object.freeze({
      className: HOST_TASK_WORKSPACE_CONTRACT.rootClassName,
      ariaLabel: "Host task workspace",
      testId: HOST_TASK_WORKSPACE_CONTRACT.thumbZoneTestId,
      data: Object.freeze({
        component: HOST_TASK_WORKSPACE_CONTRACT.componentName,
        thumbZone: HOST_TASK_WORKSPACE_CONTRACT.thumbZone,
        actionPriority: "primary",
        mode: "exception-queue-decision-canvas",
      }),
    }),
    queue: Object.freeze({
      testId: HOST_TASK_WORKSPACE_CONTRACT.queueTestId,
      label: "Host queue",
      summary: taskSummary(tasks),
      attentionCount: tasks.filter((task) => task.rank < 10).length,
    }),
    canvas: Object.freeze({
      testId: HOST_TASK_WORKSPACE_CONTRACT.canvasTestId,
    }),
    tasks: Object.freeze(tasks),
    selectedTaskId: resolvedSelectedId,
    selectedTask,
    commandContext: buildCommandContext(commandContext),
  });
}

function buildTask({
  group,
  index,
  commandStatuses,
  phase,
  replacement,
  hostPrompts,
  votecount,
}) {
  const posture = TASK_POSTURE[group.id] ?? Object.freeze({
    rank: 15,
    urgency: "routine",
    label: "Available",
  });
  const statuses = group.actions
    .map((action) => commandStatuses[action.id])
    .filter(Boolean);
  const activeStatus = statuses.find((status) => status.state === "interrupted")
    ?? statuses.find((status) => status.state === "reject")
    ?? statuses.find((status) => status.state === "pending")
    ?? statuses.find((status) => status.state === "ack")
    ?? null;
  const state = taskState(activeStatus);
  const rank = ["interrupted", "blocked"].includes(state) ? 0 : posture.rank;
  const actions = group.actions.map((action, actionIndex) => {
    const status = commandStatuses[action.id] ?? null;
    return Object.freeze({
      config: Object.freeze({
        ...action,
        disabled:
          action.disabled === true ||
          status?.state === "pending" ||
          status?.state === "interrupted",
      }),
      priority: actionIndex === 0 ? "primary" : "secondary",
      testId: `critical-host-action-${action.id}`,
      status: visibleHostCommandStatus(status, action.label),
      statusTestId: `host-command-status-${action.id}`,
      statusFloorTestId: `host-command-status-floor-${action.id}`,
      statusFloorMinBlockSizePx: HOST_TASK_WORKSPACE_CONTRACT.statusFloorMinBlockSizePx,
    });
  });
  const primaryAction = group.actions[0] ?? null;

  return Object.freeze({
    id: group.id,
    sourceIndex: index,
    rank,
    urgency: posture.urgency,
    urgencyLabel: stateLabel(state, posture.label),
    state,
    label: group.label,
    intent: group.value,
    consequence: primaryAction?.outcomeLabel ?? group.emptyLabel,
    meta: taskMeta({ groupId: group.id, phase, replacement, hostPrompts, votecount }),
    testId: `host-task-${group.id}`,
    panelTestId: `moderator-control-${group.id}`,
    actions: Object.freeze(actions),
    diagnostics: Object.freeze({
      authority: group.authority,
      boundary: group.boundary,
      protocol: group.boundaryDetail,
    }),
  });
}

function taskState(status) {
  if (status?.state === "interrupted") return "interrupted";
  if (status?.state === "reject") return "blocked";
  if (status?.state === "pending") return "pending";
  if (status?.state === "ack") return "updated";
  return "ready";
}

function stateLabel(state, fallback) {
  if (state === "interrupted") return "Recovery needed";
  if (state === "blocked") return "Blocked";
  if (state === "pending") return "In progress";
  if (state === "updated") return "Updated";
  return fallback;
}

function taskMeta({ groupId, phase, replacement, hostPrompts, votecount }) {
  if (groupId === "deadline") return phase.deadlineLabel ?? "Active phase deadline";
  if (groupId === "host-prompts") {
    const count = hostPrompts.filter((prompt) => prompt.status === "pending").length;
    return `${count} unresolved prompt${count === 1 ? "" : "s"}`;
  }
  if (groupId === "replacement") {
    return `${replacement.slotId ?? "Slot"} · ${replacement.occupantLabel ?? "player"}`;
  }
  if (groupId === "votecount") {
    return `${votecount.length} target${votecount.length === 1 ? "" : "s"}`;
  }
  return "Available when needed";
}

function taskSummary(tasks) {
  const attention = tasks.filter((task) => task.rank < 10).length;
  if (attention === 0) return "No host decisions need attention.";
  return `${attention} decision${attention === 1 ? "" : "s"} need attention.`;
}

function buildCommandContext(commandContext) {
  const gameId = String(commandContext.gameId ?? "game");
  const principalUserId = String(commandContext.principalUserId ?? "host");
  const capabilityLabel = String(commandContext.capabilityLabel ?? "HostOf(game)");
  return Object.freeze({
    testId: HOST_TASK_WORKSPACE_CONTRACT.commandContextTestId,
    summary: `Hosting as @${principalUserId}`,
    label: "Technical access",
    value: `${capabilityLabel} · @${principalUserId}`,
    gameId,
    principalUserId,
    capabilityLabel,
    commandEndpoint: String(commandContext.commandEndpoint ?? "/commands"),
  });
}
