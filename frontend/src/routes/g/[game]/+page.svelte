<script>
  import { onMount } from "svelte";
  import DayVoteOutcomePanel from "$lib/components/day-vote-outcome/DayVoteOutcomePanel.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isPlayerRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import {
    attachLiveProjectionPageLifecycle,
    connectLiveProjection,
    LIVE_PROJECTION_CONNECTING_STATUS,
  } from "$lib/app/live-transport.mjs";
  import { createProjectionStore } from "$lib/app/projection-store.mjs";
  import { activePhaseTheme, phaseThemeKey } from "$lib/app/phase-theme.mjs";
  import PlayerActionSubmissionCheckpoint from "$lib/components/player-command/PlayerActionSubmissionCheckpoint.svelte";
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
  import { buildPlayerActionSubmissionCheckpoint } from "$lib/components/player-command/player-action-submission-checkpoint.mjs";
  import {
    PLAYER_ROUTE_CONTRACT,
    buildPlayerComposerView,
    buildPlayerChannels,
    buildPlayerPhaseView,
    buildLiveOfficialPost,
    buildPrivateQueueBoundary,
    buildPrivateQueueRouteItems,
    resolvePlayerChannelAccess,
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
    persistPlayerInterruptedCommands,
    applyPlayerComposerChannelDraft,
    clearedPlayerComposerDraft,
    playerRefreshKeysForLiveDelta,
    playerResyncKeys,
    restorePlayerInterruptedCommands,
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
  import {
    attachQuotation,
    removeAttachedQuotation,
    submittedQuotationsPayload,
  } from "$lib/app/game-quotation-model.mjs";

  export let data;

  let composerBody = data.composer.defaultBody ?? "";
  let composerMediaFiles = undefined;
  let composerMediaAlt = "";
  let composerMediaEpoch = 0;
  let attachedQuotations = [];
  let composerDrafts = Object.freeze({});
  let quoteChannel = data.threadPager.channel;
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
  let channel = data.channel;
  let channels = data.channels;
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
      channel,
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
    channel,
    channels,
    surfaceHeader,
  });
  $: if (data.threadPager.channel !== quoteChannel) {
    const switched = applyPlayerComposerChannelDraft({
      drafts: composerDrafts,
      previousChannel: quoteChannel,
      nextChannel: data.threadPager.channel,
      current: {
        body: composerBody,
        quotations: attachedQuotations,
      },
    });
    composerDrafts = switched.drafts;
    quoteChannel = data.threadPager.channel;
    composerBody = switched.draft.body;
    composerMediaAlt = switched.draft.mediaAlt;
    composerMediaFiles = switched.draft.mediaFiles;
    attachedQuotations = switched.draft.quotations;
    composerMediaEpoch += 1;
  }
  $: playerActionView = buildPlayerCommandPanelViewModel({
    composer,
    phase,
    votecount,
    channel,
    player,
    commandPending,
    commandInterrupted,
  });
  $: quoteEnabled =
    player.readOnly !== true &&
    player.gameCompleted !== true &&
    playerActionView.composer?.readOnly !== true;
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
    channels = buildPlayerChannels({
      game: data.game.id,
      capabilities: data.channelCapabilities,
      activeChannel: data.threadPager.channel,
      dayEventRooms: commandState?.dayEventRooms ?? [],
    });
    channel = resolvePlayerChannelAccess({
      game: data.game.id,
      channel: data.threadPager.channel,
      capabilities: data.channelCapabilities,
      dayEventRooms: commandState?.dayEventRooms ?? [],
    });
    if (
      channel.allowed !== true &&
      data.threadPager.channel.startsWith("private:event:")
    ) {
      thread = Object.freeze({
        posts: Object.freeze([]),
        nextBeforeSeq: null,
      });
    }
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
    liveOfficialPost = buildLiveOfficialPost(thread);
    privateQueue = buildPrivateQueueRouteItems(snapshot, {
      game: data.game.id,
      channel: data.threadPager.channel,
    });
    privateQueueBoundary = buildPrivateQueueBoundary(snapshot);
  });

  const playerProjectionResyncKeys = playerResyncKeys(data);

  onMount(() => {
    exposePlayerProjection({
      windowRef: window,
      snapshot: projectionStore.getSnapshot(),
    });
    restorePlayerCommandRecovery();
    const connection = connectLiveProjection({
      url: data.liveProjection.endpoint,
      projectionStore,
      fetchImpl: fetch,
      resyncKeys: playerProjectionResyncKeys,
      authorizationLossRefreshKeys:
        data.coldLoad.commandStateEndpoint == null ? [] : ["commandState"],
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
    const pageLifecycle = attachLiveProjectionPageLifecycle({
      connection,
      target: window,
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
      pageLifecycle?.detach();
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
        quotations: submittedQuotationsPayload(attachedQuotations),
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
          quotations: attempt.quotations ?? [],
          commandIdFactory: () => attempt.commandId,
          signal,
          data: dispatchData,
          fetchImpl: fetch,
          projectionStore,
        }),
      });
      const nextAttempts = { ...commandRecoveryAttempts };
      delete nextAttempts[action];
      commitPlayerCommandRecovery(nextAttempts);
      commandStatus = result.commandStatus;
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody: attempt.composerBody,
        media: dispatchedMedia,
        quotations: attempt.quotations ?? [],
        optimisticStatus,
        finalStatus: commandStatus,
      });
      commandReceipts = recordPlayerCommandReceipt(
        commandReceipts,
        action,
        commandStatus,
        bridgePlan.projectionRefreshKeys,
      );
      if (action === "submit_post" && commandStatus?.state === "ack") {
        const draft = clearedPlayerComposerDraft();
        attachedQuotations = draft.quotations;
        composerBody = draft.body;
        composerMediaAlt = draft.mediaAlt;
        composerMediaFiles = draft.mediaFiles;
        composerMediaEpoch += 1;
        composerDrafts = Object.freeze({
          ...composerDrafts,
          [quoteChannel]: draft,
        });
      }
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
        commitPlayerCommandRecovery({
          ...commandRecoveryAttempts,
          [action]: Object.freeze({
            ...attempt,
            interruption: interruptedStatus.interruption,
          }),
        });
      } else {
        const nextAttempts = { ...commandRecoveryAttempts };
        delete nextAttempts[action];
        commitPlayerCommandRecovery(nextAttempts);
      }
      const bridgePlan = buildPlayerCommandDispatchBridgePlan({
        data: dispatchData,
        action,
        composerBody: attempt?.composerBody ?? composerBody,
        media: dispatchedMedia,
        quotations: attempt?.quotations ?? submittedQuotationsPayload(attachedQuotations),
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
    commitPlayerCommandRecovery(nextAttempts);
    commandReceipts = clearPlayerCommandReceipt(commandReceipts, action);
    commandStatus = null;
  }

  function restorePlayerCommandRecovery() {
    const restored = restorePlayerInterruptedCommands({
      storage: window.sessionStorage,
      game: data.game.id,
    });
    commandRecoveryAttempts = restored.attempts;
    if (restored.commandStatus !== null) {
      commandStatus = restored.commandStatus;
      commandReceipts = restored.commandReceipts;
      exposePlayerCommandStatus({ windowRef: window, commandStatus });
      exposePlayerCommandReceipts({ windowRef: window, commandReceipts });
    }
  }

  function commitPlayerCommandRecovery(nextAttempts) {
    commandRecoveryAttempts = nextAttempts;
    persistPlayerInterruptedCommands({
      storage: window.sessionStorage,
      game: data.game.id,
      attempts: nextAttempts,
    });
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

  function quotePlayerPost(post) {
    attachedQuotations = attachQuotation(attachedQuotations, post, data.game.id);
    if (typeof document === "undefined") {
      return;
    }
    window.setTimeout(() => {
      document.getElementById("player-composer")?.querySelector("textarea")?.focus();
    });
  }

  function removeQuotedPost(sourceSeq) {
    attachedQuotations = removeAttachedQuotation(attachedQuotations, sourceSeq);
  }
</script>

<svelte:head>
  <title>{data.game.label} player view</title>
</svelte:head>

{#if playerForcedRouteState}
  <main class="fm-surface player-surface" data-testid={PLAYER_ROUTE_CONTRACT.surfaceTestId}>
    <span class="fm-sr-only" data-testid={PLAYER_ROUTE_CONTRACT.capabilityTestId}>
      {player.capabilityLabel}
    </span>
    <RouteState view={playerForcedRouteState} />
  </main>
{:else if playerSurfaceEmpty}
  <main class="fm-surface player-surface" data-testid={PLAYER_ROUTE_CONTRACT.surfaceTestId}>
    <span class="fm-sr-only" data-testid={PLAYER_ROUTE_CONTRACT.capabilityTestId}>
      {player.capabilityLabel}
    </span>
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
    <ChannelTabs slot="channels" {channels} />

    {#if player.gameCompleted}
      <section class="player-game-complete" data-testid="player-game-complete">
        <strong>The game is complete.</strong>
        <span>Final role and alignment facts are public. Player commands are closed.</span>
      </section>
    {/if}

    <PlayerThread
      {thread}
      {liveOfficialPost}
      {threadPageStatus}
      {quoteEnabled}
      onLoadOlder={loadOlderThread}
      onQuote={quotePlayerPost}
    />

    <ComposeSheet
      view={playerActionView.composer}
      {composer}
      bind:body={composerBody}
      bind:mediaFiles={composerMediaFiles}
      bind:mediaAlt={composerMediaAlt}
      mediaResetKey={composerMediaEpoch}
      {attachedQuotations}
      onCommand={submitPlayerCommand}
      onRemoveQuote={removeQuotedPost}
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
        <PlayerActionSubmissionCheckpoint
          checkpoint={playerActionSubmissionCheckpoint}
        />
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

  .player-game-complete {
    display: grid;
    gap: 0.25rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--fm-line-strong);
    border-radius: 12px;
    background: var(--fm-raised);
  }

  .player-game-complete span {
    color: var(--fm-ink-muted);
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
