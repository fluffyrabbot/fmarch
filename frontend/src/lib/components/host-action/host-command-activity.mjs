export const HOST_COMMAND_ACTIVITY_CONTRACT = Object.freeze({
  componentName: "host-command-activity",
  rootClassName: "host-console-critical-path__command-activity",
  listClassName: "host-console-critical-path__command-activity-list",
  itemClassName: "host-console-critical-path__command-activity-item",
  emptyClassName: "host-console-critical-path__command-activity-empty",
  maxItems: 3,
});

export function buildHostCommandActivityViewModel({
  commandStatuses = {},
  commandOutcomes = [],
} = {}) {
  const pending = Object.entries(commandStatuses)
    .filter(([, status]) => status?.state === "pending")
    .map(([actionId, status]) => activityItem({
      actionId,
      status,
      source: "status",
    }));
  const recentOutcomes = commandOutcomes
    .slice()
    .reverse()
    .map((status) =>
      activityItem({
        actionId: status.actionId ?? "host-command",
        status,
        source: "outcome",
      }),
    );
  const items = [...pending, ...recentOutcomes].slice(
    0,
    HOST_COMMAND_ACTIVITY_CONTRACT.maxItems,
  );

  return Object.freeze({
    root: Object.freeze({
      className: HOST_COMMAND_ACTIVITY_CONTRACT.rootClassName,
      ariaLabel: "Host command activity",
      data: Object.freeze({
        component: HOST_COMMAND_ACTIVITY_CONTRACT.componentName,
      }),
    }),
    heading: "Command activity",
    summary:
      items.length === 0
        ? "Ready for host commands"
        : `${items.length} recent host command ${items.length === 1 ? "event" : "events"}`,
    empty: Object.freeze({
      className: HOST_COMMAND_ACTIVITY_CONTRACT.emptyClassName,
      testId: "host-command-activity-empty",
      state: "idle",
      message: "No host commands in flight.",
    }),
    listClassName: HOST_COMMAND_ACTIVITY_CONTRACT.listClassName,
    items: Object.freeze(items),
  });
}

function activityItem({ actionId, status, source }) {
  const normalizedActionId = String(actionId);
  const state = String(status?.state ?? "info");
  return Object.freeze({
    actionId: normalizedActionId,
    source,
    state,
    label: labelForAction(normalizedActionId),
    message: String(status?.message ?? status?.error ?? "Command updated"),
    testId: `host-command-activity-${normalizedActionId}`,
    statusTestId: `host-command-activity-status-${normalizedActionId}`,
    confirmationTrace: status?.confirmationTrace ?? null,
    className: HOST_COMMAND_ACTIVITY_CONTRACT.itemClassName,
  });
}

function labelForAction(actionId) {
  return String(actionId)
    .replace(/^resolve_host_prompt-/, "resolve prompt ")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
}
