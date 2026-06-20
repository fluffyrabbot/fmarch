export const HOST_CONTROL_SURFACE_CONTRACT = Object.freeze({
  rootClassName: "host-console-critical-path__moderator-controls",
  thumbZone: "moderator-primary-actions",
  thumbZoneTestId: "moderator-primary-action-zone",
  commandContextTestId: "moderator-command-context",
  controlRail: Object.freeze({
    mode: "sticky-tablet-host-control-rail",
    stickyTopPx: 22,
    unstickBelowPx: 760,
  }),
  controlBayClassName: "host-console-critical-path__control-bay",
  actionBayClassName: "host-console-critical-path__action-bay",
  actionTileClassName: "host-console-critical-path__action-tile",
  actionTileStabilityMode: "reserved-status-floor",
  commandStatusFloorClassName: "host-console-critical-path__command-status-floor",
  commandStatusFloorMinBlockSizePx: 44,
  boundaryClassName: "host-console-critical-path__boundary",
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
  return Object.freeze({
    root: Object.freeze({
      className: HOST_CONTROL_SURFACE_CONTRACT.rootClassName,
      ariaLabel: "Moderator controls",
      data: Object.freeze({
        component: HOST_CONTROL_SURFACE_CONTRACT.componentName,
        thumbZone: HOST_CONTROL_SURFACE_CONTRACT.thumbZone,
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
    groups: Object.freeze(
      groups.map((group) =>
        Object.freeze({
          ...group,
          testId: `moderator-control-${group.id}`,
          classes: Object.freeze({
            controlBay: HOST_CONTROL_SURFACE_CONTRACT.controlBayClassName,
            actionBay: HOST_CONTROL_SURFACE_CONTRACT.actionBayClassName,
            actionTile: HOST_CONTROL_SURFACE_CONTRACT.actionTileClassName,
            boundary: HOST_CONTROL_SURFACE_CONTRACT.boundaryClassName,
            empty: HOST_CONTROL_SURFACE_CONTRACT.emptyClassName,
            commandStatusFloor: HOST_CONTROL_SURFACE_CONTRACT.commandStatusFloorClassName,
            commandStatus: HOST_CONTROL_SURFACE_CONTRACT.commandStatusClassName,
          }),
          actions: Object.freeze(
            group.actions.map((action) =>
              Object.freeze({
                config: action,
                testId: `critical-host-action-${action.id}`,
                status: commandStatuses[action.id] ?? null,
                statusTestId: `host-command-status-${action.id}`,
                statusFloorTestId: `host-command-status-floor-${action.id}`,
                statusFloorMinBlockSizePx:
                  HOST_CONTROL_SURFACE_CONTRACT.commandStatusFloorMinBlockSizePx,
                statusMessage: commandStatusMessage(commandStatuses[action.id]),
              }),
            ),
          ),
        }),
      ),
    ),
  });
}

export function commandStatusMessage(status) {
  if (status === undefined || status === null) {
    return "";
  }
  return status.message;
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
    label: "Command authority",
    value: `${normalizedCapability} as ${normalizedPrincipal}`,
    gameId: normalizedGameId,
    principalUserId: normalizedPrincipal,
    capabilityLabel: normalizedCapability,
    commandEndpoint: String(commandEndpoint),
  });
}
