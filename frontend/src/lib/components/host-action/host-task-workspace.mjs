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
  hostTasks = [],
  hostDayEvents = [],
  dayEventSelections = {},
  votecount = [],
  selectedTaskId = null,
} = {}) {
  const promptGroup = groups.find((group) => group.id === "host-prompts") ?? null;
  const groupTasks = groups
    .filter((group) => group.id !== "host-prompts")
    .map((group, index) => buildTask({
      group,
      index,
      commandStatuses,
      phase,
      replacement,
      hostPrompts,
      votecount,
    }));
  const instanceTasks = hostTasks.map((task, index) =>
    buildHostTaskInstance({
      task,
      index: groups.length + index,
      promptGroup,
      hostPrompts,
      hostDayEvents,
      dayEventSelections,
      gameId: commandContext.gameId,
      commandStatuses,
    }),
  );
  const tasks = [...groupTasks, ...instanceTasks]
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
  const activeStatus = activeTaskStatus(group.actions, commandStatuses);
  const state = taskState(activeStatus);
  const rank = ["interrupted", "blocked"].includes(state) ? 0 : posture.rank;
  const actions = buildTaskActions(group.actions, commandStatuses);
  const primaryAction = group.actions[0] ?? null;

  return Object.freeze({
    id: group.id,
    kind: group.id,
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

function buildHostTaskInstance({
  task,
  index,
  promptGroup,
  hostPrompts,
  hostDayEvents,
  dayEventSelections,
  gameId,
  commandStatuses,
}) {
  const allowedCommandKinds = new Set(
    task.allowedCommands?.map((command) => command.kind) ?? [],
  );
  const promptActions = promptGroup?.actions?.filter(
    (action) =>
      action.payload?.promptId === task.sourceId &&
      allowedCommandKinds.has(action.payload?.kind),
  ) ?? [];
  const dayEventDecision = task.kind === "day_event_resolve";
  const dayEvent = dayEventDecision
    ? buildDayEventContext({
        event: hostDayEvents.find((candidate) => candidate.eventId === task.sourceId),
        selectedSlots: dayEventSelections[task.sourceId] ?? [],
        task,
        gameId,
      })
    : null;
  const sourceActions = dayEventDecision
    ? dayEvent?.action === null || dayEvent?.action === undefined
      ? []
      : [dayEvent.action]
    : promptActions;
  const activeStatus = activeTaskStatus(sourceActions, commandStatuses);
  const state = taskState(activeStatus, task.state);
  const prompt = hostPrompts.find((candidate) => candidate.id === task.sourceId);
  const rank = ["interrupted", "blocked"].includes(state) ? 0 : 2;
  const blockedReason =
    state === "blocked"
      ? task.blockedReason ?? "No permitted resolution command is available."
      : null;
  return Object.freeze({
    id: task.id,
    kind: task.kind,
    sourceId: task.sourceId,
    sourceIndex: index,
    rank,
    urgency: task.urgency,
    urgencyLabel: stateLabel(state, "Needs decision"),
    state,
    label:
      prompt?.label ??
      dayEvent?.label ??
      (dayEventDecision ? "DayEvent decision" : "Host decision"),
    intent: task.intent,
    consequence: blockedReason ?? task.consequence,
    meta:
      dayEvent?.meta ??
      [task.phaseId, task.subjectSlot].filter(Boolean).join(" · "),
    testId: `host-task-${stableTestId(task.id)}`,
    panelTestId: `moderator-control-${stableTestId(task.id)}`,
    actions: buildTaskActions(sourceActions, commandStatuses),
    dayEvent,
    emptyLabel: state === "blocked"
      ? "No permitted resolution command is available."
      : dayEventDecision
        ? "Select at least one participant before resolving this event."
        : "No action is currently required.",
    diagnostics: Object.freeze({
      authority: promptGroup?.authority ?? "Host team",
      boundary: promptGroup?.boundary ?? "Typed command",
      protocol: dayEventDecision
        ? "ResolveDayEvent"
        : promptGroup?.boundaryDetail ?? "ResolveHostPrompt",
    }),
  });
}

function buildDayEventContext({ event, selectedSlots, task, gameId }) {
  if (event === null || event === undefined) {
    return Object.freeze({
      eventId: task.sourceId,
      label: "DayEvent decision",
      meta: task.phaseId,
      participantSummary: "Participant projection unavailable",
      participants: Object.freeze([]),
      rewards: Object.freeze([]),
      action: null,
    });
  }
  const availableSlots = new Set(event.participantSlots);
  const winners = [...new Set(selectedSlots.map(String))]
    .filter((slot) => availableSlots.has(slot))
    .sort();
  const participants = event.participantSlots.map((slot) =>
    Object.freeze({
      slot,
      selected: winners.includes(slot),
      disabled: task.state !== "ready",
      testId: `day-event-winner-${stableTestId(event.eventId)}-${stableTestId(slot)}`,
    }),
  );
  const label = presentThemeKey(event.templateKey, "DayEvent decision");
  const rewardLabels = event.rewards.map((reward) =>
    presentThemeKey(reward.labelKey || reward.key, reward.key || "Reward"),
  );
  const selectedLabel =
    winners.length === 1 ? winners[0] : `${winners.length} participants`;
  const outcomeLabel =
    winners.length === 0
      ? "select at least one winner before applying rewards"
      : `select ${selectedLabel} and apply ${rewardLabels.length} reward binding${
          rewardLabels.length === 1 ? "" : "s"
        } atomically`;
  const action =
    task.state !== "ready"
      ? null
      : Object.freeze({
          id: `resolve_day_event-${stableTestId(event.eventId)}`,
          label: winners.length === 0 ? "Select a winner" : "Resolve event",
          objectLabel: label,
          outcomeLabel,
          confirmationText: `Resolve ${label}: ${outcomeLabel} for ${label}.`,
          irreversible: true,
          disabled: winners.length === 0,
          payload: Object.freeze({
            kind: "resolve_day_event",
            gameId,
            eventId: event.eventId,
            winnerSlots: Object.freeze(winners),
          }),
        });
  return Object.freeze({
    eventId: event.eventId,
    label,
    meta: `${event.phaseId ?? task.phaseId} · ${event.participantSlots.length} participant${
      event.participantSlots.length === 1 ? "" : "s"
    }`,
    participantSummary: `${event.participantSlots.length} joined · minimum ${event.participation.minimum}`,
    participants: Object.freeze(participants),
    rewards: Object.freeze(rewardLabels),
    action,
  });
}

function presentThemeKey(value, fallback) {
  const normalized = String(value ?? "")
    .split(".")
    .at(-1)
    ?.replace(/[_-]+/gu, " ")
    .trim();
  if (!normalized) {
    return fallback;
  }
  return normalized[0].toUpperCase() + normalized.slice(1);
}

function activeTaskStatus(actions, commandStatuses) {
  const statuses = actions
    .map((action) => commandStatuses[action.id])
    .filter(Boolean);
  return statuses.find((status) => status.state === "interrupted")
    ?? statuses.find((status) => status.state === "reject")
    ?? statuses.find((status) => status.state === "pending")
    ?? statuses.find((status) => status.state === "ack")
    ?? null;
}

function buildTaskActions(sourceActions, commandStatuses) {
  return sourceActions.map((action, actionIndex) => {
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
}

function taskState(status, fallback = "ready") {
  if (status?.state === "interrupted") return "interrupted";
  if (status?.state === "reject") return "blocked";
  if (status?.state === "pending") return "pending";
  if (status?.state === "ack") return "updated";
  return fallback;
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

function stableTestId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]+/g, "-");
}
