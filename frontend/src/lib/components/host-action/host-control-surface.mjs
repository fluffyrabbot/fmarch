export const HOST_CONTROL_SURFACE_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__moderator-controls fm-primary-action-zone",
  thumbZone: "moderator-primary-actions",
  actionPriority: "primary",
  thumbZoneTestId: "moderator-primary-action-zone",
  commandContextTestId: "moderator-command-context",
  controlRail: Object.freeze({
    mode: "flow-host-control-actions",
    stickyTopPx: 0,
    unstickBelowPx: 0,
  }),
  controlBayClassName: "host-console-critical-path__control-bay fm-card",
  actionBayClassName: "host-console-critical-path__action-bay fm-action-tray",
  actionTileClassName: "host-console-critical-path__action-tile",
  actionTileStabilityMode: "reserved-status-floor",
  commandStatusFloorClassName: "host-console-critical-path__command-status-floor",
  commandStatusFloorMinBlockSizePx: 44,
  boundaryClassName: "host-console-critical-path__boundary",
  diagnosticsClassName: "host-console-critical-path__diagnostics",
  emptyClassName: "host-console-critical-path__empty-action",
  commandStatusClassName: "host-console-critical-path__command-status",
  componentName: "host-control-surface",
});

export function buildHostControlSurfaceViewModel({
  groups = [],
  commandStatuses = {},
  commandContext = {},
} = {}) {
  const context = buildHostCommandContextViewModel(commandContext);
  const nextGroupId = groups.find(
    (group) => group.id !== "roles" && group.actions.length > 0,
  )?.id;
  const controls = Object.freeze(
    groups.map((group) => buildHostControlGroup({
      group,
      commandStatuses,
      nextGroupId,
    })),
  );
  return Object.freeze({
    root: Object.freeze({
      className: HOST_CONTROL_SURFACE_CONTRACT.rootClassName,
      ariaLabel: "Moderator controls",
      data: Object.freeze({
        component: HOST_CONTROL_SURFACE_CONTRACT.componentName,
        thumbZone: HOST_CONTROL_SURFACE_CONTRACT.thumbZone,
        actionPriority: HOST_CONTROL_SURFACE_CONTRACT.actionPriority,
        controlRailMode: HOST_CONTROL_SURFACE_CONTRACT.controlRail.mode,
        stickyTopPx: HOST_CONTROL_SURFACE_CONTRACT.controlRail.stickyTopPx,
        unstickBelowPx: HOST_CONTROL_SURFACE_CONTRACT.controlRail.unstickBelowPx,
        actionTileStabilityMode: HOST_CONTROL_SURFACE_CONTRACT.actionTileStabilityMode,
        gameId: context.gameId,
        principalUserId: context.principalUserId,
        capabilityLabel: context.capabilityLabel,
      }),
      testId: HOST_CONTROL_SURFACE_CONTRACT.thumbZoneTestId,
    }),
    commandContext: context,
    groups: controls,
    queues: buildHostControlQueues(controls, nextGroupId),
  });
}

function buildHostControlGroup({ group, commandStatuses, nextGroupId }) {
  return Object.freeze({
    ...group,
    priority: group.id === nextGroupId ? "now" : group.id === "roles" ? "endgame" : "later",
    testId: `moderator-control-${group.id}`,
    diagnostics: Object.freeze({
      testId: `moderator-control-${group.id}-diagnostics`,
      summary: "Technical details",
      authority: group.authority,
      boundary: group.boundary,
      protocol: group.boundaryDetail,
      statuses: Object.freeze(
        group.actions
          .map((action) => ({
            action: action.label,
            message: commandStatuses[action.id]?.message,
          }))
          .filter((status) => typeof status.message === "string"),
      ),
    }),
    classes: Object.freeze({
      controlBay: HOST_CONTROL_SURFACE_CONTRACT.controlBayClassName,
      actionBay: HOST_CONTROL_SURFACE_CONTRACT.actionBayClassName,
      actionTile: HOST_CONTROL_SURFACE_CONTRACT.actionTileClassName,
      boundary: HOST_CONTROL_SURFACE_CONTRACT.boundaryClassName,
      diagnostics: HOST_CONTROL_SURFACE_CONTRACT.diagnosticsClassName,
      empty: HOST_CONTROL_SURFACE_CONTRACT.emptyClassName,
      commandStatusFloor: HOST_CONTROL_SURFACE_CONTRACT.commandStatusFloorClassName,
      commandStatus: HOST_CONTROL_SURFACE_CONTRACT.commandStatusClassName,
    }),
    actions: Object.freeze(
      group.actions.map((action, actionIndex) =>
        Object.freeze({
          config: action,
          priority:
            group.id === nextGroupId && actionIndex === 0 ? "primary" : "secondary",
          testId: `critical-host-action-${action.id}`,
          status: visibleCommandStatus(
            commandStatuses[action.id],
            action.label,
          ),
          protocolStatusMessage:
            commandStatuses[action.id]?.message ?? "",
          statusTestId: `host-command-status-${action.id}`,
          statusFloorTestId: `host-command-status-floor-${action.id}`,
          statusFloorMinBlockSizePx:
            HOST_CONTROL_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
          statusMessage: commandStatusMessage(
            commandStatuses[action.id],
            action.label,
          ),
        }),
      ),
    ),
  });
}

function buildHostControlQueues(groups, nextGroupId) {
  const queueDefinitions = [
    {
      id: "now",
      label: "Now",
      summary: groups.find((group) => group.id === nextGroupId)?.value
        ?? "No immediate host action is required.",
      groups: groups.filter((group) => group.id === nextGroupId),
      collapsible: false,
    },
    {
      id: "later",
      label: "Later",
      summary: "Supporting game controls",
      groups: groups.filter((group) => group.id !== nextGroupId && group.id !== "roles"),
      collapsible: true,
    },
    {
      id: "endgame",
      label: "Endgame",
      summary: "Reveal only when the game is complete",
      groups: groups.filter((group) => group.id === "roles"),
      collapsible: true,
    },
  ];
  return Object.freeze(queueDefinitions
    .filter((queue) => queue.groups.length > 0)
    .map((queue) => Object.freeze({
      ...queue,
      groups: Object.freeze(queue.groups),
      countLabel: `${queue.groups.length} ${queue.groups.length === 1 ? "area" : "areas"}`,
      testId: `moderator-action-queue-${queue.id}`,
    })));
}

export function commandStatusMessage(status, actionLabel = "Action") {
  if (status === undefined || status === null) {
    return "";
  }
  if (status.state === "pending") {
    return `${actionLabel} is in progress.`;
  }
  if (status.state === "ack") {
    return `${actionLabel} completed.`;
  }
  if (status.state === "reject") {
    return status.retryable === true
      ? `${actionLabel} could not be completed. Refresh and try again.`
      : `${actionLabel} could not be completed.`;
  }
  return `${actionLabel} updated.`;
}

function visibleCommandStatus(status, actionLabel) {
  if (status === undefined || status === null) {
    return null;
  }
  return Object.freeze({
    ...status,
    message: commandStatusMessage(status, actionLabel),
  });
}

function buildHostCommandContextViewModel({
  gameId = "game",
  principalUserId = "host",
  capabilityLabel = "HostOf(game)",
  commandEndpoint = "/commands",
} = {}) {
  const normalizedGameId = String(gameId);
  const normalizedPrincipal = String(principalUserId);
  const normalizedCapability = String(capabilityLabel);
  return Object.freeze({
    testId: HOST_CONTROL_SURFACE_CONTRACT.commandContextTestId,
    summary: `Hosting as @${normalizedPrincipal}`,
    label: "Technical access",
    value: `${normalizedCapability} · @${normalizedPrincipal}`,
    gameId: normalizedGameId,
    principalUserId: normalizedPrincipal,
    capabilityLabel: normalizedCapability,
    commandEndpoint: String(commandEndpoint),
  });
}
