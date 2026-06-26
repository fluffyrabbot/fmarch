<script>
  import { onMount } from "svelte";
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isPlayerRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import {
    connectLiveProjection,
    LIVE_PROJECTION_CONNECTING_STATUS,
  } from "$lib/app/live-transport.mjs";
  import { createProjectionStore } from "$lib/app/projection-store.mjs";
  import PlayerChannelRail from "$lib/components/player-channel-rail/PlayerChannelRail.svelte";
  import PlayerCommandPanel from "$lib/components/player-command/PlayerCommandPanel.svelte";
  import PlayerCommandReceipt from "$lib/components/player-command/PlayerCommandReceipt.svelte";
  import PlayerPostureStrip from "$lib/components/player-posture/PlayerPostureStrip.svelte";
  import PlayerPrivateQueue from "$lib/components/player-private-queue/PlayerPrivateQueue.svelte";
  import PlayerThread from "$lib/components/player-thread/PlayerThread.svelte";
  import {
    PLAYER_ROUTE_CONTRACT,
    buildPlayerComposerView,
    buildPlayerPhaseView,
    buildLiveOfficialPost,
    buildPrivateQueueBoundary,
    buildPrivateQueueRouteItems,
  } from "./game-route-model.mjs";
  import {
    exposePlayerCommandReceipts,
    exposePlayerCommandDispatchBridgePlan,
    exposePlayerCommandStatus,
    exposePlayerProjection,
    exposePlayerThreadPageStatus,
    recordPlayerLiveProjectionEvent,
    triggerPlayerLiveProjectionResync,
  } from "./player-route-browser-bridge.mjs";
  import {
    buildPlayerCommandDispatchBridgePlan,
    buildPlayerProjectionColdLoads,
    buildPlayerProjectionInitialSnapshot,
    loadOlderPlayerThreadPage,
    playerCommandErrorStatus,
    playerCommandPendingStatus,
    recordPlayerCommandReceipt,
    playerRefreshKeysForLiveDelta,
    playerResyncKeys,
    playerThreadErrorStatus,
    playerThreadPendingStatus,
    submitPlayerRouteCommand,
    togglePrivateItemExpansion,
  } from "./player-route-controller.mjs";

  export let data;

  let composerBody = data.composer.defaultBody;
  let commandStatus = null;
  let commandReceipts = [];
  let thread = data.thread;
  let votecount = data.votecount;
  let commandState = data.commandState;
  let phase = data.phase;
  let composer = data.composer;
  let surfaceHeader = data.surfaceHeader;
  let privateQueue = data.privateQueue;
  let privateQueueBoundary = data.privateQueueBoundary;
  let liveOfficialPost = data.liveOfficialPost;
  let liveStatus = LIVE_PROJECTION_CONNECTING_STATUS;
  let threadPageStatus = null;
  let expandedPrivateItems = data.privateQueueExpandedItems;
  let expandedPrivateRouteKey = JSON.stringify(data.privateQueueExpandedItems);
  $: {
    const nextExpandedPrivateRouteKey = JSON.stringify(data.privateQueueExpandedItems);
    if (nextExpandedPrivateRouteKey !== expandedPrivateRouteKey) {
      expandedPrivateItems = data.privateQueueExpandedItems;
      expandedPrivateRouteKey = nextExpandedPrivateRouteKey;
    }
  }
  $: playerSurfaceEmpty = isPlayerRouteEmpty({
    thread,
    votecount,
    privateQueue,
  });
  $: playerForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: currentData = Object.freeze({
    ...data,
    commandState,
    phase,
    composer,
    surfaceHeader,
  });
  $: playerEmptyState = buildRouteStateViewModel({
    surface: "player",
    state: "empty",
  });
  const projectionStore = createProjectionStore({
    initialSnapshot: buildPlayerProjectionInitialSnapshot(data),
    coldLoads: buildPlayerProjectionColdLoads(data),
    liveTransport: data.projectionBoundary,
  });

  projectionStore.subscribe((snapshot) => {
    thread = snapshot.thread;
    votecount = snapshot.votecount;
    commandState = snapshot.commandState;
    phase = buildPlayerPhaseView(commandState);
    composer = buildPlayerComposerView(data.composer, commandState, data.player.slotId);
    surfaceHeader = Object.freeze({
      ...data.surfaceHeader,
      title: phase.label,
      summary: phase.summary,
    });
    liveOfficialPost = buildLiveOfficialPost(snapshot.thread);
    privateQueue = buildPrivateQueueRouteItems(snapshot, {
      game: data.game.id,
      channel: data.threadPager.channel,
    });
    privateQueueBoundary = buildPrivateQueueBoundary(snapshot);
  });

  const playerProjectionResyncKeys = playerResyncKeys(data);

  onMount(() => {
    const connection = connectLiveProjection({
      url: data.liveProjection.endpoint,
      projectionStore,
      fetchImpl: fetch,
      resyncKeys: playerProjectionResyncKeys,
      refreshKeysForEvent: (message) =>
        playerRefreshKeysForLiveDelta(data, message),
      onEvent(message, snapshot) {
        liveStatus = recordPlayerLiveProjectionEvent({
          windowRef: window,
          message,
          snapshot,
          currentStatus: liveStatus,
        });
      },
    });
    window.__fmarchTriggerPlayerResync = async (fromSeq = 0) => {
      const recovery = await triggerPlayerLiveProjectionResync({
        windowRef: window,
        projectionStore,
        resyncKeys: playerProjectionResyncKeys,
        fetchImpl: fetch,
        fromSeq,
        currentStatus: liveStatus,
      });
      liveStatus = recovery.liveStatus;
      return recovery.snapshot;
    };
    return () => connection?.close();
  });

  async function submitPlayerCommand(action) {
    const dispatchData = currentData;
    const optimisticStatus = playerCommandPendingStatus(action);
    commandStatus = optimisticStatus;
    commandReceipts = recordPlayerCommandReceipt(
      commandReceipts,
      action,
      commandStatus,
    );
    try {
      const result = await submitPlayerRouteCommand({
        action,
        composerBody,
        data: dispatchData,
        fetchImpl: fetch,
        projectionStore,
      });
      commandStatus = result.commandStatus;
      commandReceipts = recordPlayerCommandReceipt(
        commandReceipts,
        action,
        commandStatus,
      );
      if (typeof window !== "undefined") {
        const bridgePlan = buildPlayerCommandDispatchBridgePlan({
          data: dispatchData,
          action,
          composerBody,
          optimisticStatus,
          finalStatus: commandStatus,
        });
        exposePlayerCommandDispatchBridgePlan({
          windowRef: window,
          plan: bridgePlan,
        });
        exposePlayerCommandStatus({ windowRef: window, commandStatus });
        exposePlayerCommandReceipts({ windowRef: window, commandReceipts });
        exposePlayerProjection({ windowRef: window, snapshot: result.snapshot });
      }
    } catch (error) {
      commandStatus = playerCommandErrorStatus(error, action);
      commandReceipts = recordPlayerCommandReceipt(
        commandReceipts,
        action,
        commandStatus,
      );
      if (typeof window !== "undefined") {
        const bridgePlan = buildPlayerCommandDispatchBridgePlan({
          data: dispatchData,
          action,
          composerBody,
          optimisticStatus,
          finalStatus: commandStatus,
        });
        exposePlayerCommandDispatchBridgePlan({
          windowRef: window,
          plan: bridgePlan,
        });
        exposePlayerCommandStatus({ windowRef: window, commandStatus });
        exposePlayerCommandReceipts({ windowRef: window, commandReceipts });
      }
    }
  }

  async function loadOlderThread() {
    threadPageStatus = playerThreadPendingStatus();
    try {
      const result = await loadOlderPlayerThreadPage({
        data,
        fetchImpl: fetch,
        projectionStore,
        thread,
      });
      threadPageStatus = result.threadPageStatus;
      if (typeof window !== "undefined") {
        exposePlayerThreadPageStatus({
          windowRef: window,
          threadPageStatus,
        });
        exposePlayerProjection({ windowRef: window, snapshot: result.snapshot });
      }
    } catch (error) {
      threadPageStatus = playerThreadErrorStatus(error);
    }
  }

  function togglePrivateItem(item) {
    expandedPrivateItems = togglePrivateItemExpansion(expandedPrivateItems, item);
  }
</script>

<svelte:head>
  <title>{data.game.label} player view</title>
</svelte:head>

<main class="fm-surface player-surface" data-testid={PLAYER_ROUTE_CONTRACT.surfaceTestId}>
  <AppSurfaceHeader header={surfaceHeader} {liveStatus} />

  <PlayerPostureStrip
    channel={data.channel}
    {phase}
    projectionBoundary={data.projectionBoundary}
    threadPager={data.threadPager}
    {votecount}
    {privateQueueBoundary}
  />

  {#if playerForcedRouteState}
    <RouteState view={playerForcedRouteState} />
  {:else if playerSurfaceEmpty}
    <RouteState view={playerEmptyState} />
  {:else}
    <section
      class={data.layout.root.className}
      data-layout-mode={data.layout.root.data.mode}
      data-min-tablet-viewport-px={data.layout.root.data.minTabletViewportPx}
      data-collapse-below-px={data.layout.root.data.collapseBelowPx}
    >
      <PlayerChannelRail channels={data.channels} />

      <PlayerThread
        {phase}
        {thread}
        {liveOfficialPost}
        {threadPageStatus}
        onLoadOlder={loadOlderThread}
      >
        <PlayerPrivateQueue
          boundary={privateQueueBoundary}
          items={privateQueue}
          expandedItems={expandedPrivateItems}
          onToggle={togglePrivateItem}
        />
      </PlayerThread>

      <div
        class={data.layout.commandRail.className}
        data-command-rail-mode={data.layout.commandRail.data.mode}
        data-sticky-top-px={data.layout.commandRail.data.stickyTopPx}
        data-unstick-below-px={data.layout.commandRail.data.unstickBelowPx}
        data-stability-mode={data.layout.commandRail.data.stabilityMode}
      >
        <PlayerCommandPanel
          {composer}
          {phase}
          {votecount}
          channel={data.channel}
          player={data.player}
          bind:body={composerBody}
          onCommand={submitPlayerCommand}
        />
        <PlayerCommandReceipt receipts={commandReceipts} />
      </div>
    </section>
  {/if}
</main>

<style>
  .player-surface__layout {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(164px, 0.52fr) minmax(420px, 1.6fr) minmax(248px, 0.72fr);
    align-items: start;
  }

  .player-surface__command-stack {
    align-self: start;
    display: grid;
    gap: 12px;
    max-block-size: calc(
      100svh - var(--fm-app-topbar-block-size) - var(--fm-app-sticky-rail-gap) -
        env(safe-area-inset-top) - env(safe-area-inset-bottom)
    );
    min-inline-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    position: sticky;
    top: calc(
      var(--fm-app-topbar-block-size) + var(--fm-app-sticky-rail-gap) +
        env(safe-area-inset-top)
    );
  }

  @media (min-width: 1280px) {
    .player-surface__layout {
      grid-template-columns: 220px minmax(0, 1fr) 300px;
    }
  }

  @media (max-width: 959px) {
    .player-surface__layout {
      grid-template-columns: 1fr;
    }

    .player-surface__command-stack {
      max-block-size: none;
      overflow: visible;
      position: static;
    }
  }
</style>
