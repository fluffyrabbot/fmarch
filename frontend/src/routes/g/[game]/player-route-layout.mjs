export const PLAYER_ROUTE_LAYOUT_CONTRACT = Object.freeze({
  rootClassName: "player-surface__layout",
  mode: "tablet-three-zone-cockpit",
  minTabletViewportPx: 1024,
  collapseBelowPx: 960,
  regions: Object.freeze(["channels", "thread", "commands"]),
  commandRail: Object.freeze({
    className: "player-surface__command-stack",
    mode: "sticky-tablet-command-rail",
    stickyTopPx: 22,
    unstickBelowPx: 960,
    stabilityMode: "primary-controls-before-live-receipts",
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
