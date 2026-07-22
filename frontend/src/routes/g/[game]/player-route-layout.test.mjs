import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerRouteLayoutViewModel,
  PLAYER_ROUTE_LAYOUT_CONTRACT,
} from "./player-route-layout.mjs";

test("player route layout keeps a stable reading lane with a fixed action dock", () => {
  const view = buildPlayerRouteLayoutViewModel();

  assert.equal(view.root.className, PLAYER_ROUTE_LAYOUT_CONTRACT.rootClassName);
  assert.equal(view.root.data.mode, "reading-first-action-dock");
  assert.equal(view.root.data.minTabletViewportPx, 1024);
  assert.equal(view.root.data.collapseBelowPx, null);
  assert.deepEqual(view.commandRail, {
    className: "action-dock",
    data: {
      mode: "fixed-context-navigation",
      stickyTopPx: null,
      unstickBelowPx: null,
      stabilityMode: "thread-width-stable",
    },
  });
  assert.deepEqual(view.regions, [
    "game-bar",
    "channels",
    "thread",
    "composer",
    "actions",
    "context",
    "dock",
  ]);
});
