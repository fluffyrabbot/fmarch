import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  buildPlayerRouteLayoutViewModel,
  PLAYER_ROUTE_LAYOUT_CONTRACT,
} from "./player-route-layout.mjs";

test("player route layout keeps a stable reading lane, sheets below the rail width and a rail above it", () => {
  const view = buildPlayerRouteLayoutViewModel();

  assert.equal(view.root.className, PLAYER_ROUTE_LAYOUT_CONTRACT.rootClassName);
  assert.equal(view.root.data.mode, "reading-first-action-dock");
  assert.equal(view.root.data.minTabletViewportPx, 1024);
  assert.equal(view.root.data.railMinViewportPx, 1100);
  assert.equal(view.root.data.collapseBelowPx, null);
  assert.deepEqual(view.commandRail, {
    className: "action-dock",
    data: {
      mode: "fixed-context-navigation",
      renderedBelowPx: 1100,
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
    "rail",
    "dock",
  ]);
  assert.deepEqual(view.sheets, ["vote", "more"]);
});

test("the route renders the dock only below the rail width and the sheets in the rail slot", async () => {
  const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

  assert.match(source, /<svelte:fragment slot="dock">\s*\{#if layout !== "rail"\}\s*<ActionDock/u);
  assert.match(source, /<svelte:fragment slot="rail">[\s\S]*?<PlayerSheet[\s\S]*?testId="player-vote-sheet"[\s\S]*?<VoteSheet[\s\S]*?<PlayerSheet[\s\S]*?testId="player-more-sheet"[\s\S]*?<ContextSheet/u);
  assert.doesNotMatch(source, /return-to-thread|returnToThread|readerNavigation\?\.open\(/u);
  // The composer stays in-flow after the thread on every width.
  assert.ok(source.indexOf("<PlayerThread") < source.indexOf("<ComposeSheet"));
  assert.ok(source.indexOf("<ComposeSheet") < source.indexOf('<svelte:fragment slot="rail">'));
});

test("player feedback lives in the game bar while commands stay gated", async () => {
  const source = await readFile(new URL("./+page.svelte", import.meta.url), "utf8");

  assert.match(source, /<GameBar[\s\S]*?<PlayerFeedback[\s\S]*?<\/GameBar>/);
  assert.doesNotMatch(source, /player-command-feedback|<PlayerCommandReceipt/);
  assert.doesNotMatch(
    source,
    /\{#if projectionCommandsReady[^}]*commandReceipts\.length/u,
  );
  assert.doesNotMatch(source, /\{#if projectionCommandsReady\}\s*<ActionDock/u);
  assert.match(source, /commandsAvailable=\{projectionCommandsReady &&/u);
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
    /const confirmedRecovery = playerCommandRecoveryAfterConfirmation\([\s\S]*?commitPlayerCommandRecovery\(confirmedRecovery.attempts\);\s*const result = await recoverPlayerRouteCommand/u,
  );
  assert.match(source, /data-testid="player-command-recovery-storage-warning"/);
});
