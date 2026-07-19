import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerRouteLayoutViewModel,
  PLAYER_ROUTE_LAYOUT_CONTRACT,
} from "./player-route-layout.mjs";

test("player route layout uses a full-width channel switcher over two tablet zones", () => {
  const view = buildPlayerRouteLayoutViewModel();

  assert.equal(view.root.className, PLAYER_ROUTE_LAYOUT_CONTRACT.rootClassName);
  assert.equal(view.root.data.mode, "tablet-two-zone-channel-switcher");
  assert.equal(view.root.data.minTabletViewportPx, 1024);
  assert.equal(view.root.data.collapseBelowPx, 840);
  assert.deepEqual(view.commandRail, {
    className: "player-surface__command-stack",
    data: {
      mode: "sticky-tablet-command-column",
      stickyTopPx: 22,
      unstickBelowPx: 840,
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
