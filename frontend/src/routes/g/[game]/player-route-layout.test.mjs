import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerRouteLayoutViewModel,
  PLAYER_ROUTE_LAYOUT_CONTRACT,
} from "./player-route-layout.mjs";

test("player route layout preserves the three-zone tablet cockpit at 1024px", () => {
  const view = buildPlayerRouteLayoutViewModel();

  assert.equal(view.root.className, PLAYER_ROUTE_LAYOUT_CONTRACT.rootClassName);
  assert.equal(view.root.data.mode, "tablet-three-zone-cockpit");
  assert.equal(view.root.data.minTabletViewportPx, 1024);
  assert.equal(view.root.data.collapseBelowPx, 960);
  assert.deepEqual(view.commandRail, {
    className: "player-surface__command-stack",
    data: {
      mode: "sticky-tablet-command-rail",
      stickyTopPx: 22,
      unstickBelowPx: 960,
      stabilityMode: "primary-controls-before-live-receipts",
    },
  });
  assert.deepEqual(view.regions, ["channels", "thread", "commands"]);
  assert.equal(view.root.data.collapseBelowPx < view.root.data.minTabletViewportPx, true);
  assert.equal(
    view.commandRail.data.unstickBelowPx,
    view.root.data.collapseBelowPx,
  );
});
