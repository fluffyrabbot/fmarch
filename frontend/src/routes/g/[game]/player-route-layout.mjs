export const PLAYER_ROUTE_LAYOUT_CONTRACT = Object.freeze({
  rootClassName: "game-frame__workspace",
  mode: "reading-first-action-dock",
  minTabletViewportPx: 1024,
  collapseBelowPx: null,
  regions: Object.freeze(["game-bar", "channels", "thread", "composer", "actions", "context", "dock"]),
  commandRail: Object.freeze({
    className: "action-dock",
    mode: "fixed-context-navigation",
    stickyTopPx: null,
    unstickBelowPx: null,
    stabilityMode: "thread-width-stable",
  }),
});

export function buildPlayerRouteLayoutViewModel() {
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_ROUTE_LAYOUT_CONTRACT.rootClassName,
      data: Object.freeze({
        mode: PLAYER_ROUTE_LAYOUT_CONTRACT.mode,
        minTabletViewportPx: PLAYER_ROUTE_LAYOUT_CONTRACT.minTabletViewportPx,
        collapseBelowPx: PLAYER_ROUTE_LAYOUT_CONTRACT.collapseBelowPx,
      }),
    }),
    commandRail: Object.freeze({
      className: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.className,
      data: Object.freeze({
        mode: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.mode,
        stickyTopPx: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.stickyTopPx,
        unstickBelowPx: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.unstickBelowPx,
        stabilityMode: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.stabilityMode,
      }),
    }),
    regions: PLAYER_ROUTE_LAYOUT_CONTRACT.regions,
  });
}
