<script>
  import { onMount } from "svelte";
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import DayVoteOutcomePanel from "$lib/components/day-vote-outcome/DayVoteOutcomePanel.svelte";
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
  import { activePhaseTheme, phaseThemeKey } from "$lib/app/phase-theme.mjs";
  import PlayerChannelRail from "$lib/components/player-channel-rail/PlayerChannelRail.svelte";
  import PlayerActionSubmissionCheckpoint from "$lib/components/player-command/PlayerActionSubmissionCheckpoint.svelte";
  import PlayerCommandPanel from "$lib/components/player-command/PlayerCommandPanel.svelte";
  import PlayerCommandReceipt from "$lib/components/player-command/PlayerCommandReceipt.svelte";
  import PlayerPostureStrip from "$lib/components/player-posture/PlayerPostureStrip.svelte";
  import PlayerEndgameSummary from "$lib/components/player-endgame-summary/PlayerEndgameSummary.svelte";
  import { buildPlayerEndgameSummaryViewModel } from "$lib/components/player-endgame-summary/player-endgame-summary-model.mjs";
  import PlayerRoleCard from "$lib/components/player-role-card/PlayerRoleCard.svelte";
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
    buildPlayerActionSubmissionCheckpoint,
  } from "$lib/components/player-command/player-action-submission-checkpoint.mjs";
  import { buildPlayerRoleCardViewModel } from "$lib/components/player-role-card/player-role-card-model.mjs";
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
  let dayVoteOutcomes = data.dayVoteOutcomes;
  let endgameSummary = data.endgameSummary;
  let commandState = data.commandState;
  let player = data.player;
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
  let selectedActionTargets = Object.freeze({});

  function selectActionTarget(templateId, slot) {
    selectedActionTargets = Object.freeze({
      ...selectedActionTargets,
      [String(templateId)]: String(slot),
    });
    composer = buildPlayerComposerView(
      data.composer,
      commandState,
      data.player.slotId,
      selectedActionTargets,
    );
  }
  $: {
    const nextExpandedPrivateRouteKey = JSON.stringify(data.privateQueueExpandedItems);
    if (nextExpandedPrivateRouteKey !== expandedPrivateRouteKey) {
      expandedPrivateItems = data.privateQueueExpandedItems;
      expandedPrivateRouteKey = nextExpandedPrivateRouteKey;
    }
  }
  $: playerSurfaceEmpty =
    data.pendingReplacement === true ||
    isPlayerRouteEmpty({
      thread,
      votecount,
      privateQueue,
      commandState,
    });
  $: playerForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: currentData = Object.freeze({
    ...data,
    commandState,
    dayVoteOutcomes,
    endgameSummary,
    player,
    phase,
    composer,
    surfaceHeader,
  });
  $: playerActionSubmissionCheckpoint = buildPlayerActionSubmissionCheckpoint({
    commandState,
    composer,
    player,
    commandStatus,
  });
  $: playerRoleCard = buildPlayerRoleCardViewModel({ commandState, player });
  $: playerEndgameSummary = buildPlayerEndgameSummaryViewModel({
    endgameSummary: endgameSummary ?? null,
    gameCompleted: player.gameCompleted === true,
  });
  $: if (typeof window !== "undefined") {
    activePhaseTheme.set(phaseThemeKey(phase));
  }
  $: playerEmptyState = buildRouteStateViewModel({
    surface: "player",
    state: "empty",
    message: data.emptyState?.message ?? null,
    actionHref: data.emptyState?.actionHref ?? null,
  });
  const projectionStore = createProjectionStore({
    initialSnapshot: buildPlayerProjectionInitialSnapshot(data),
    coldLoads: buildPlayerProjectionColdLoads(data),
    liveTransport: data.projectionBoundary,
  });

  projectionStore.subscribe((snapshot) => {
    thread = snapshot.thread;
    votecount = snapshot.votecount;
    dayVoteOutcomes = Array.isArray(snapshot.dayVoteOutcomes)
      ? snapshot.dayVoteOutcomes
      : [];
    endgameSummary = snapshot.endgameSummary ?? null;
    commandState = snapshot.commandState;
    player = Object.freeze({
      ...data.player,
      alive: commandState?.actorAlive ?? data.player.alive,
      status: commandState?.actorStatus ?? data.player.status,
      gameCompleted: commandState?.gameCompleted === true,
      capabilityLabel:
        commandState?.actorStatus === "replaced"
          ? `No current SlotOccupant(${data.player.slotId})`
          : data.player.capabilityLabel,
    });
    phase = buildPlayerPhaseView(commandState);
    composer = buildPlayerComposerView(
      data.composer,
      commandState,
      data.player.slotId,
      selectedActionTargets,
    );
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
      reconnectDelayMs: 1500,
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
    window.__fmarchPlayerColdLoadEndpoints = data.coldLoad;
    window.__fmarchPlayerResyncKeys = playerProjectionResyncKeys;
    window.__fmarchGetPlayerLiveProjectionMetrics = () => connection?.metrics?.() ?? null;
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
    window.__fmarchClosePlayerLiveProjection = () => {
      connection?.close();
      liveStatus = recordPlayerLiveProjectionEvent({
        windowRef: window,
        message: { kind: "close" },
        snapshot: null,
        currentStatus: liveStatus,
      });
      return liveStatus;
    };
    window.__fmarchDropPlayerLiveProjection = () => {
      connection?.drop?.();
    };
    return () => {
      delete window.__fmarchTriggerPlayerResync;
      delete window.__fmarchClosePlayerLiveProjection;
      delete window.__fmarchDropPlayerLiveProjection;
      delete window.__fmarchPlayerColdLoadEndpoints;
      delete window.__fmarchPlayerResyncKeys;
      delete window.__fmarchGetPlayerLiveProjectionMetrics;
      activePhaseTheme.set(null);
      connection?.close();
    };
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
        commandIdFactory:
          typeof window === "undefined"
            ? undefined
            : window.__fmarchPlayerCommandIdFactory,
        data: dispatchData,
        fetchImpl: fetch,
        projectionStore,
      });
      commandStatus = result.commandStatus;
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody,
        optimisticStatus,
        finalStatus: commandStatus,
      });
      commandReceipts = recordPlayerCommandReceipt(
        commandReceipts,
        action,
        commandStatus,
        bridgePlan.projectionRefreshKeys,
      );
      if (typeof window !== "undefined") {
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
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody,
        optimisticStatus,
        finalStatus: commandStatus,
      });
      commandReceipts = recordPlayerCommandReceipt(
        commandReceipts,
        action,
        commandStatus,
        bridgePlan.projectionRefreshKeys,
      );
      if (typeof window !== "undefined") {
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

  <PlayerPostureStrip {phase} {privateQueueBoundary} />

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
        <PlayerEndgameSummary view={playerEndgameSummary} />

        <PlayerRoleCard card={playerRoleCard} />

        <PlayerActionSubmissionCheckpoint
          checkpoint={playerActionSubmissionCheckpoint}
        />

        <PlayerCommandPanel
          {composer}
          {phase}
          {votecount}
          channel={data.channel}
          {player}
          bind:body={composerBody}
          onCommand={submitPlayerCommand}
          onSelectTarget={selectActionTarget}
        />
        <PlayerCommandReceipt receipts={commandReceipts} />

        <DayVoteOutcomePanel
          outcomes={dayVoteOutcomes}
          boundary={data.dayVoteOutcomeBoundary}
          rootTestId="player-day-vote-outcome"
        />
      </div>
    </section>
  {/if}
</main>

<style>
  .player-surface__layout {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(164px, 0.4fr) minmax(420px, 2.1fr) minmax(264px, 0.75fr);
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

  :global(.player-role-card header),
  :global(.player-action-submission-checkpoint header) {
    align-items: start;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  :global(.player-role-card header p) {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1.25;
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  :global(.player-role-card h2) {
    color: var(--fm-ink);
    font-size: 18px;
    line-height: 1.2;
    margin: 0;
  }

  :global(.player-role-card__identity) {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  :global(.player-role-card__name) {
    color: var(--fm-ink);
    font-size: 18px;
    font-weight: 800;
    line-height: 1.2;
    margin: 0;
  }

  :global(.player-role-card__description) {
    color: var(--fm-ink-muted);
    font-size: 14px;
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
  }

  :global(.player-role-card__status) {
    margin: 0;
  }

  :global(.player-action-submission-checkpoint header p) {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0;
    line-height: 1.25;
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  :global(.player-action-submission-checkpoint h2) {
    color: var(--fm-ink);
    font-size: 18px;
    line-height: 1.2;
    margin: 0;
  }

  :global(.player-action-submission-checkpoint dl) {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0;
  }

  :global(.player-action-submission-checkpoint dt) {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    margin: 0 0 4px;
    text-transform: uppercase;
  }

  :global(.player-action-submission-checkpoint dd) {
    color: var(--fm-ink);
    font-size: 14px;
    line-height: 1.3;
    margin: 0;
    overflow-wrap: anywhere;
  }

  :global(.player-action-submission-checkpoint__status) {
    margin: 0;
  }

  :global(.player-endgame-summary header p) {
    margin: 0;
  }

  :global(.player-endgame-summary h2) {
    color: var(--fm-ink);
    font-size: 18px;
    line-height: 1.2;
    margin: 0;
  }

  :global(.player-endgame-summary h3) {
    color: var(--fm-ink);
    font-size: 15px;
    line-height: 1.25;
    margin: 0;
  }

  :global(.player-endgame-summary__winner strong) {
    color: var(--fm-ink);
    font-size: 17px;
    line-height: 1.25;
  }

  :global(.player-endgame-summary__winner p),
  :global(.player-endgame-summary__boundary) {
    color: var(--fm-ink-muted);
    font-size: 13px;
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
  }

  :global(.player-endgame-summary__row) {
    align-items: center;
    display: grid;
    gap: 4px 10px;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  :global(.player-endgame-summary__row span),
  :global(.player-endgame-summary__row small) {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 700;
  }

  :global(.player-endgame-summary__row strong) {
    color: var(--fm-ink);
    font-size: 14px;
  }

  :global(.player-endgame-summary__vote-history) {
    display: grid;
    gap: 8px;
  }

  :global(.player-endgame-summary__vote-row > div) {
    align-items: baseline;
    display: flex;
    gap: 8px;
    justify-content: space-between;
  }

  :global(.player-endgame-summary__vote-row p),
  :global(.player-endgame-summary__vote-row small) {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    line-height: 1.35;
    margin: 0;
    overflow-wrap: anywhere;
  }

  :global(.player-action-target-picker__action) {
    display: grid;
    gap: 8px;
  }

  :global(.player-action-target-picker__options) {
    display: grid;
    gap: 6px;
  }

  :global(.player-action-target-picker__confirmation) {
    display: grid;
    gap: 10px;
  }

  :global(.player-action-target-picker__confirmation p) {
    color: var(--fm-ink);
    font-size: 14px;
    line-height: 1.4;
    margin: 0;
    overflow-wrap: anywhere;
  }

  @media (min-width: 1280px) {
    .player-surface__layout {
      grid-template-columns: 200px minmax(0, 1fr) 320px;
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

    :global(.player-action-submission-checkpoint header),
    :global(.player-action-submission-checkpoint dl) {
      grid-template-columns: 1fr;
    }
  }
</style>
