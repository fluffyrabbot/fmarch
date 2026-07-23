<script>
  import { onMount } from "svelte";
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
  import PlayerCommandReceipt from "$lib/components/player-command/PlayerCommandReceipt.svelte";
  import PlayerDayEventRail from "$lib/components/player-command/PlayerDayEventRail.svelte";
  import PlayerEndgameSummary from "$lib/components/player-endgame-summary/PlayerEndgameSummary.svelte";
  import { buildPlayerEndgameSummaryViewModel } from "$lib/components/player-endgame-summary/player-endgame-summary-model.mjs";
  import PlayerRoleCard from "$lib/components/player-role-card/PlayerRoleCard.svelte";
  import PlayerPrivateQueue from "$lib/components/player-private-queue/PlayerPrivateQueue.svelte";
  import PlayerThread from "$lib/components/player-thread/PlayerThread.svelte";
  import GameFrame from "$lib/components/gameplay/GameFrame.svelte";
  import GameBar from "$lib/components/gameplay/GameBar.svelte";
  import ChannelTabs from "$lib/components/gameplay/ChannelTabs.svelte";
  import ActionDock from "$lib/components/gameplay/ActionDock.svelte";
  import ComposeSheet from "$lib/components/gameplay/ComposeSheet.svelte";
  import VoteSheet from "$lib/components/gameplay/VoteSheet.svelte";
  import ContextSheet from "$lib/components/gameplay/ContextSheet.svelte";
  import { buildPlayerCommandPanelViewModel } from "$lib/components/player-command/player-command-panel-model.mjs";
  import {
    PLAYER_ROUTE_CONTRACT,
    buildPlayerComposerView,
    buildPlayerPhaseView,
    buildLiveOfficialPost,
    buildPrivateQueueBoundary,
    buildPrivateQueueRouteItems,
  } from "./game-route-model.mjs";
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
    playerCommandInterruptedStatus,
    playerCommandPendingStatus,
    recordPlayerCommandReceipt,
    clearPlayerCommandReceipt,
    playerRefreshKeysForLiveDelta,
    playerResyncKeys,
    playerThreadErrorStatus,
    playerThreadPendingStatus,
    submitPlayerRouteCommand,
    togglePrivateItemExpansion,
    uploadPlayerPostMedia,
  } from "./player-route-controller.mjs";
  import {
    commandAttemptId,
    commandAttemptTimeoutMs,
    executeCommandAttempt,
  } from "$lib/app/command-interruption.mjs";

  export let data;

  let composerBody = data.composer.defaultBody;
  let composerMediaFiles = undefined;
  let composerMediaAlt = "";
  let commandStatus = null;
  $: commandPending = commandStatus?.state === "pending";
  $: commandInterrupted = commandStatus?.state === "interrupted";
  let commandReceipts = [];
  let commandRecoveryAttempts = {};
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
      channel: data.channel,
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
  $: playerActionView = buildPlayerCommandPanelViewModel({
    composer,
    phase,
    votecount,
    channel: data.channel,
    player,
    commandPending,
    commandInterrupted,
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

  async function submitPlayerCommand(action, recoveredAttempt = null) {
    if (commandPending || (commandInterrupted && recoveredAttempt === null)) {
      return;
    }
    const dispatchData = recoveredAttempt?.data ?? currentData;
    let dispatchedMedia = recoveredAttempt?.media ?? [];
    let attempt = recoveredAttempt;
    const optimisticStatus = playerCommandPendingStatus(action);
    commandStatus = optimisticStatus;
    commandReceipts = recordPlayerCommandReceipt(
      commandReceipts,
      action,
      commandStatus,
    );
    try {
      if (action === "submit_post") {
        if (recoveredAttempt === null) {
          dispatchedMedia = await uploadPlayerPostMedia({
            data: dispatchData,
            file: composerMediaFiles?.[0] ?? null,
            alt: composerMediaAlt,
            fetchImpl: fetch,
          });
        }
      }
      attempt = attempt ?? Object.freeze({
        action,
        composerBody,
        media: dispatchedMedia,
        data: dispatchData,
        commandId: commandAttemptId(
          typeof window !== "undefined" &&
            typeof window.__fmarchPlayerCommandIdFactory === "function"
            ? window.__fmarchPlayerCommandIdFactory
            : undefined,
        ),
      });
      const result = await executeCommandAttempt({
        timeoutMs: commandAttemptTimeoutMs(
          typeof window === "undefined" ? null : window,
        ),
        operation: ({ signal }) => submitPlayerRouteCommand({
          action,
          composerBody: attempt.composerBody,
          media: attempt.media,
          commandIdFactory: () => attempt.commandId,
          signal,
          data: dispatchData,
          fetchImpl: fetch,
          projectionStore,
        }),
      });
      const nextAttempts = { ...commandRecoveryAttempts };
      delete nextAttempts[action];
      commandRecoveryAttempts = nextAttempts;
      commandStatus = result.commandStatus;
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody: attempt.composerBody,
        media: dispatchedMedia,
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
      const interruptedStatus = attempt === null
        ? null
        : playerCommandInterruptedStatus(error, {
            action,
            commandId: attempt.commandId,
          });
      commandStatus = interruptedStatus ?? playerCommandErrorStatus(error, action);
      if (interruptedStatus !== null) {
        commandRecoveryAttempts = {
          ...commandRecoveryAttempts,
          [action]: attempt,
        };
      } else {
        const nextAttempts = { ...commandRecoveryAttempts };
        delete nextAttempts[action];
        commandRecoveryAttempts = nextAttempts;
      }
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody: attempt?.composerBody ?? composerBody,
        media: dispatchedMedia,
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

  async function retryPlayerCommand(action) {
    const attempt = commandRecoveryAttempts[action];
    if (attempt !== undefined) {
      await submitPlayerCommand(action, attempt);
    }
  }

  function cancelPlayerCommandRecovery(action) {
    const nextAttempts = { ...commandRecoveryAttempts };
    delete nextAttempts[action];
    commandRecoveryAttempts = nextAttempts;
    commandReceipts = clearPlayerCommandReceipt(commandReceipts, action);
    commandStatus = null;
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

{#if playerForcedRouteState}
  <main class="fm-surface player-surface" data-testid={PLAYER_ROUTE_CONTRACT.surfaceTestId}>
    <RouteState view={playerForcedRouteState} />
  </main>
{:else if playerSurfaceEmpty}
  <main class="fm-surface player-surface" data-testid={PLAYER_ROUTE_CONTRACT.surfaceTestId}>
    <RouteState view={playerEmptyState} />
  </main>
{:else}
  <GameFrame>
    <GameBar
      slot="bar"
      game={data.game}
      {phase}
      {composer}
      {votecount}
      {liveStatus}
      {player}
    />
    <ChannelTabs slot="channels" channels={data.channels} />

    <PlayerThread
      {thread}
      {liveOfficialPost}
      {threadPageStatus}
      onLoadOlder={loadOlderThread}
    />

    <ComposeSheet
      view={playerActionView.composer}
      {composer}
      bind:body={composerBody}
      bind:mediaFiles={composerMediaFiles}
      bind:mediaAlt={composerMediaAlt}
      onCommand={submitPlayerCommand}
    />

    <VoteSheet
      view={playerActionView}
      onCommand={submitPlayerCommand}
      onSelectTarget={selectActionTarget}
    />

    <PlayerDayEventRail
      commands={composer.dayEventCommands ?? []}
      {commandPending}
      {commandInterrupted}
      {player}
      onCommand={submitPlayerCommand}
    />

    <ContextSheet>
      <PlayerPrivateQueue
        boundary={privateQueueBoundary}
        items={privateQueue}
        expandedItems={expandedPrivateItems}
        onToggle={togglePrivateItem}
      />

      {#if player.readOnly !== true}
        <PlayerRoleCard card={playerRoleCard} />
      {/if}

      <details class="fm-surface-drawer player-surface__drawer" data-testid="player-game-record">
        <summary>
          <span class="fm-surface-drawer__label">
            <strong>Game history</strong>
            <small>Completed outcomes and endgame record</small>
          </span>
        </summary>
        <div class="fm-surface-drawer__body">
          <PlayerEndgameSummary view={playerEndgameSummary} />
          <DayVoteOutcomePanel
            outcomes={dayVoteOutcomes}
            boundary={data.dayVoteOutcomeBoundary}
            rootTestId="player-day-vote-outcome"
          />
        </div>
      </details>
    </ContextSheet>

    {#if player.readOnly !== true && commandReceipts.length > 0}
      <div class="player-command-feedback">
        <PlayerCommandReceipt
          receipts={commandReceipts}
          currentStatus={commandStatus}
          onRetry={retryPlayerCommand}
          onCancel={cancelPlayerCommandRecovery}
        />
      </div>
    {/if}

    <ActionDock
      slot="dock"
      view={playerActionView}
      privateCount={privateQueueBoundary.count ?? privateQueue.length}
      dayEventCount={composer.dayEventCommands?.length ?? 0}
      onCommand={submitPlayerCommand}
    />
  </GameFrame>
{/if}

<style>
  .player-command-feedback {
    bottom: calc(82px + env(safe-area-inset-bottom));
    inset-inline-end: max(14px, calc((100vw - 920px) / 2));
    max-inline-size: min(360px, calc(100vw - 28px));
    position: fixed;
    z-index: 13;
  }

  :global(.player-role-card__name) {
    color: var(--fm-ink);
    display: block;
    font-size: 15px;
    font-weight: 800;
    line-height: 1.2;
    margin-block-start: 2px;
    overflow-wrap: anywhere;
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
</style>
