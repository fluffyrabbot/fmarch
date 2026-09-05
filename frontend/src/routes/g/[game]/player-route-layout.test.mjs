import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("player command receipts remain visible while unhealthy controls stay hidden", async () => {
  const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

  assert.match(source, /\{#if commandReceipts\.length > 0\}/);
  assert.doesNotMatch(
    source,
    /\{#if projectionCommandsReady[^}]*commandReceipts\.length/u,
  );
  assert.match(source, /\{#if projectionCommandsReady\}\s*<ActionDock/u);
});

test("player live invalidation precedes best-effort recovery restore and dispatch is journaled", async () => {
  const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

  assert.ok(
    source.indexOf("const connection = connectLiveProjection") <
      source.indexOf("restorePlayerCommandRecovery();"),
  );
  assert.match(
    source,
    /const recoveryPersisted = commitPlayerCommandRecovery\(\{[\s\S]*?\[action\]:[\s\S]*?\}\);\s*if \(recoveryPersisted !== true\) \{[\s\S]*?same-ID reload recovery is unavailable[\s\S]*?\}\s*const confirmedStatus = await executeCommandAttempt/u,
  );
  assert.match(
    source,
    /delete nextAttempts\[action\];\s*commitPlayerCommandRecovery\(nextAttempts\);\s*const result = await recoverPlayerRouteCommand/u,
  );
  assert.match(source, /data-testid="player-command-recovery-storage-warning"/);
});
