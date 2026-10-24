import { PLAYER_RAIL_MIN_WIDTH_PX } from "../../../lib/components/gameplay/player-layout.mjs";

// Below the rail width Vote and More are bottom sheets opened from the dock;
// from it up they are a sticky rail beside the reading lane and the dock is
// not rendered. The composer follows the thread on every width.
export const PLAYER_ROUTE_LAYOUT_CONTRACT = Object.freeze({
  rootClassName: "game-frame__workspace",
  mode: "reading-first-action-dock",
  minTabletViewportPx: 1024,
  railMinViewportPx: PLAYER_RAIL_MIN_WIDTH_PX,
  collapseBelowPx: null,
  regions: Object.freeze(["game-bar", "channels", "thread", "composer", "rail", "dock"]),
  sheets: Object.freeze(["vote", "more"]),
  commandRail: Object.freeze({
    className: "action-dock",
    mode: "fixed-context-navigation",
    renderedBelowPx: PLAYER_RAIL_MIN_WIDTH_PX,
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
        railMinViewportPx: PLAYER_ROUTE_LAYOUT_CONTRACT.railMinViewportPx,
        collapseBelowPx: PLAYER_ROUTE_LAYOUT_CONTRACT.collapseBelowPx,
      }),
    }),
    commandRail: Object.freeze({
      className: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.className,
      data: Object.freeze({
        mode: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.mode,
        renderedBelowPx: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.renderedBelowPx,
        stickyTopPx: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.stickyTopPx,
        unstickBelowPx: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.unstickBelowPx,
        stabilityMode: PLAYER_ROUTE_LAYOUT_CONTRACT.commandRail.stabilityMode,
      }),
    }),
    regions: PLAYER_ROUTE_LAYOUT_CONTRACT.regions,
    sheets: PLAYER_ROUTE_LAYOUT_CONTRACT.sheets,
  });
}
