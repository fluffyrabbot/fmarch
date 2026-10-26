<script>
  import { page } from "$app/stores";
  import { getContext, onDestroy, onMount, tick } from "svelte";
  import DayVoteOutcomePanel from "$lib/components/day-vote-outcome/DayVoteOutcomePanel.svelte";
  import GameFrame from "$lib/components/gameplay/GameFrame.svelte";
  import PlayerSheet from "$lib/components/gameplay/PlayerSheet.svelte";
  import PlayerThread from "$lib/components/player-thread/PlayerThread.svelte";
  import { observeGameLayout } from "$lib/components/gameplay/game-layout.mjs";
  import { captureReadingPosition, restoreReadingPosition } from "$lib/app/post-address.mjs";
  import HostComposer from "$lib/components/host-action/HostComposer.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isModeratorRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import HostCommandActivity from "$lib/components/host-action/HostCommandActivity.svelte";
  import HostConsoleBar from "$lib/components/host-action/HostConsoleBar.svelte";
  import { buildHostTaskWorkspaceViewModel } from "$lib/components/host-action/host-task-workspace.mjs";
  import HostTaskWorkspace from "$lib/components/host-action/HostTaskWorkspace.svelte";
  import HostReplacementChooser from "$lib/components/host-action/HostReplacementChooser.svelte";
  import HostLifecycleControlCheckpoint from "$lib/components/host-action/HostLifecycleControlCheckpoint.svelte";
  import HostPromptResolutionHistory from "$lib/components/host-action/HostPromptResolutionHistory.svelte";
  import HostPhaseSummary from "$lib/components/host-action/HostPhaseSummary.svelte";
  import HostVotecountPanel from "$lib/components/host-action/HostVotecountPanel.svelte";
  import HostWorkQueueStrip from "$lib/components/host-action/HostWorkQueueStrip.svelte";
  import {
    buildHostLifecycleControlCheckpoint,
  } from "$lib/components/host-action/host-lifecycle-control-checkpoint.mjs";
  import {
    attachLiveProjectionPageLifecycle,
    connectLiveProjection,
    LIVE_PROJECTION_CONNECTING_STATUS,
  } from "$lib/app/live-transport.mjs";
  import {
    dispatchHostCommandResult,
    exposeHostCommandDispatchBridgePlan,
    exposeHostLiveProjectionEndpoint,
    exposeHostRouteWindowState,
    recordHostLiveProjectionEvent,
  } from "./host-route-browser-bridge.mjs";
  import { createLiveRouteBrowserReconnect } from "../live-route-browser-reconnect.mjs";
  import {
    appendHostActionEvent,
    appendHostCommandOutcome,
    attachEventConfirmationTrace,
    buildHostCommandRequest,
    buildHostDerivedState,
    buildHostCommandDispatchBridgePlan,
    buildHostProjectionColdLoads,
    buildHostProjectionInitialSnapshot,
    hostCommandErrorOutcome,
    hostCommandInterruptedOutcome,
    hostCommandPendingStatus,
    hostReconnectRefreshKeys,
    persistHostInterruptedCommands,
    restoreHostInterruptedCommands,
    recordHostCommandStatus,
    clearHostCommandStatus,
    dispatchHostRouteAction,
    recoverHostRouteAction,
  } from "./host-route-controller.mjs";
  import { HOST_CONSOLE_ROUTE_CONTRACT, buildHostReplacementInviteTarget } from "./host-route-model.mjs";
  import {
    loadNewerPlayerThreadPage,
    loadOlderPlayerThreadPage,
    playerThreadErrorStatus,
    playerThreadPendingStatus,
  } from "../player-route-controller.mjs";
  import { THEME_CONTEXT } from "$lib/app/theme-context.mjs";
  import { createProjectionStore } from "$lib/app/projection-store.mjs";
  import {
    commandAttemptId,
    commandAttemptTimeoutMs,
    commandProjectionRecoveryTimeoutMs,
    executeCommandAttempt,
  } from "$lib/app/command-interruption.mjs";
  import { resolveCommandRecoveryStorage } from "$lib/app/command-recovery-storage.mjs";
  import "$lib/components/host-action/host-console-critical-path.css";

  export let data;
  const themePhase = getContext(THEME_CONTEXT)?.claim($page.url.pathname);
  onDestroy(() => themePhase?.release());
  export let form;

  let dispatched = [];
  let commandOutcomes = [];
  let hostClockSeconds = data.deadlineClock?.nowSeconds ?? Math.floor(Date.now() / 1000);
  onMount(() => {
    const startedAt = Date.now();
    const initialSeconds = hostClockSeconds;
    const timer = setInterval(() => { hostClockSeconds = initialSeconds + Math.floor((Date.now() - startedAt) / 1000); }, 30_000);
    return () => clearInterval(timer);
  });
  let commandStatuses = {};
  let commandRecoveryAttempts = {};
  let commandRecoveryStorage = null;
  let commandRecoveryStorageAvailable = true;
  let replacementCandidate = null;
  let projection = {
    phase: data.phase,
    replacement: data.replacement,
  };
  $: currentPhase = projection.phase;
  // The host reads the game where it happens (usage-frequency audit,
  // decision 11): the main thread is the reading lane, the decision queue a
  // strip under the bar below the rail width and the rail above it, and a
  // chosen task opens as a sheet below the rail width.
  let thread = data.thread;
  let threadPageStatus = null;
  let hostPostAction = null;
  let hostPostBody = "";
  // "flow" until hydration; then "sheet" below the rail width or "rail".
  let layout = "flow";
  let taskSheetOpen = false;
  let taskSheetReturnTo = null;
  let taskSheetFocus = [];
  let preferredTaskId = null;
  let dayEventSelections = {};
  let recoveryOpenedFor = null;
  onMount(() => observeGameLayout(window, (value) => {
    const first = layout === "flow";
    layout = value;
    if (value === "rail") taskSheetOpen = false;
    // A replacement invite result renders inside the Replacement task
    // (decision 12): show that task where the host left it.
    if (first && form?.replacementInvite !== undefined) void openTask("replacement", null);
  }));
  $: if (form?.replacementInvite !== undefined && preferredTaskId === null) preferredTaskId = "replacement";
  let votecount = data.votecount;
  let dayVoteOutcomes = data.dayVoteOutcomes;
  let hostPrompts = data.hostPrompts;
  let hostTasks = data.hostTasks;
  let hostDayEvents = data.hostDayEvents;
  let dayEventScheduler = data.dayEventScheduler;
  let moderatorActionGroups = data.moderatorActionGroups;
  let liveStatus = LIVE_PROJECTION_CONNECTING_STATUS;
  let projectionHealth = null;
  $: projectionCommandsReady =
    data.commandsEnabled === true &&
    commandRecoveryStorageAvailable === true &&
    projectionHealth?.ready === true;
  $: moderatorSurfaceEmpty = isModeratorRouteEmpty({
    thread,
    votecount,
    hostPrompts,
    hostTasks,
    moderatorActionGroups,
  });
  $: moderatorForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: moderatorEmptyState = buildRouteStateViewModel({
    surface: "moderator",
    state: "empty",
  });
  // The invite names the seat's occupant from the live projection: after a
  // replacement is processed the occupant is the incoming player.
  $: liveReplacementInvite = buildHostReplacementInviteTarget({
    replacement: projection.replacement ?? data.replacement,
    replacementPrincipalId:
      data.replacementInvite.principalId || projection.replacement?.incomingPrincipalId || null,
  });
  $: replacementInvite = Object.freeze({
    ...liveReplacementInvite,
    available: projectionCommandsReady && liveReplacementInvite.available === true,
  });
  $: workspace = buildHostTaskWorkspaceViewModel({
    groups: moderatorActionGroups,
    commandStatuses,
    commandContext: data.commandContext,
    phase: currentPhase,
    replacement: projection.replacement ?? data.replacement,
    hostPrompts,
    hostTasks,
    hostDayEvents,
    roster: projection.roster ?? [],
    dayEventSelections,
    votecount,
    selectedTaskId: preferredTaskId,
    nowSeconds: hostClockSeconds,
  });
  // A task that needs recovery after a reload surfaces itself once: below
  // the rail width that means opening its sheet.
  $: if (
    layout === "sheet" &&
    workspace.selectedTask?.state === "interrupted" &&
    recoveryOpenedFor !== workspace.selectedTask.id &&
    !taskSheetOpen
  ) {
    recoveryOpenedFor = workspace.selectedTask.id;
    void openTask(workspace.selectedTask.id, null);
  }
  $: themePhase?.update(currentPhase?.id);
  $: hostLifecycleControlCheckpoint = buildHostLifecycleControlCheckpoint({
    phase: currentPhase,
    replacement: projection.replacement ?? data.replacement,
    actionGroups: moderatorActionGroups,
    commandContext: data.commandContext,
  });
  const reconnectRefreshKeys = hostReconnectRefreshKeys();
  const projectionStore = createProjectionStore({
    initialSnapshot: buildHostProjectionInitialSnapshot(data),
    coldLoads: buildHostProjectionColdLoads(data),
    liveTransport: data.projectionBoundary,
  });

  projectionStore.subscribe((snapshot) => {
    const derived = buildHostDerivedState({
      gameId: data.game.id,
      snapshot,
      capabilityKind: data.access.capability?.kind,
      nowSeconds: hostClockSeconds,
    });
    projection = derived.projection;
    thread = derived.thread ?? thread;
    votecount = derived.votecount;
    dayVoteOutcomes = derived.dayVoteOutcomes;
    hostPrompts = derived.hostPrompts;
    hostTasks = derived.hostTasks;
    hostDayEvents = derived.hostDayEvents;
    dayEventScheduler = derived.dayEventScheduler;
  });
  $: {
    const derived = buildHostDerivedState({
      gameId: data.game.id,
      snapshot: { host: projection, votecount, dayVoteOutcomes, hostPrompts },
      capabilityKind: data.access.capability?.kind,
      nowSeconds: hostClockSeconds,
      replacementCandidate,
      fixtureMode: data.fixtureMode === true,
    });
    moderatorActionGroups = derived.moderatorActionGroups;
    hostPostAction = derived.hostPostAction;
  }
  projectionStore.subscribeHealth((health) => {
    projectionHealth = health;
  });

  $: if (typeof window !== "undefined") {
    exposeHostRouteWindowState({
      windowRef: window,
      dispatched,
      commandOutcomes,
      commandStatuses,
      projection,
      votecount,
      dayVoteOutcomes,
      hostPrompts,
    });
  }

  onMount(() => {
    if (typeof data.liveProjection?.endpoint !== "string") {
      return;
    }
    let browserReconnect = null;
    const connection = connectLiveProjection({
      url: data.liveProjection.endpoint,
      projectionStore,
      fetchImpl: fetch,
      resyncKeys: reconnectRefreshKeys,
      onEvent(message, snapshot) {
        liveStatus = recordHostLiveProjectionEvent({
          windowRef: window,
          message,
          snapshot,
          currentStatus: liveStatus,
        });
        browserReconnect?.observe(message, snapshot);
      },
    });
    browserReconnect = createLiveRouteBrowserReconnect({
      connection,
      role: "host",
    });
    commandRecoveryStorage = resolveCommandRecoveryStorage(window);
    commandRecoveryStorageAvailable = commandRecoveryStorage !== null;
    exposeHostLiveProjectionEndpoint({
      windowRef: window,
      endpoint: data.liveProjection.endpoint,
    });
    restoreHostCommandRecovery();
    const pageLifecycle = attachLiveProjectionPageLifecycle({
      connection,
      target: window,
    });
    window.__fmarchGetHostLiveProjectionMetrics = () => connection?.metrics?.() ?? null;
    window.__fmarchReconnectHostLiveProjectionNow = () =>
      browserReconnect.reconnectNow();
    window.__fmarchCloseHostLiveProjection = () => {
      connection?.close();
      liveStatus = recordHostLiveProjectionEvent({
        windowRef: window,
        message: { kind: "close" },
        snapshot: null,
        currentStatus: liveStatus,
      });
      return liveStatus;
    };
    window.__fmarchDropHostLiveProjection = () => {
      connection?.drop?.();
    };
    window.__fmarchDispatchHostAction = handleDispatch;
    return () => {
      delete window.__fmarchReconnectHostLiveProjectionNow;
      delete window.__fmarchGetHostLiveProjectionMetrics;
      delete window.__fmarchCloseHostLiveProjection;
      delete window.__fmarchDropHostLiveProjection;
      delete window.__fmarchDispatchHostAction;
      browserReconnect.rejectPending();
      pageLifecycle?.detach();
      connection?.close();
    };
  });

  async function handleDispatch(event, recoveredAttempt = null) {
    if (
      !projectionCommandsReady ||
      commandStatuses[event.actionId]?.state === "pending"
    ) {
      return;
    }
    // Persist selected identity only once a command is dispatched. A later fresh
    // confirmation is always checked against the current chooser selection.
    const selectedReplacement = recoveredAttempt === null
      ? replacementCandidate
      : recoveredAttempt.event?.replacementCandidate ?? null;
    if (event.actionId === "process_replacement" && recoveredAttempt === null) {
      event = Object.freeze({ ...event, replacementCandidate: selectedReplacement });
    }
    if (recoveredAttempt === null) {
      dispatched = appendHostActionEvent(dispatched, event);
    }
    const attempt = recoveredAttempt ?? Object.freeze({
      event,
      command: buildHostCommandRequest({ event, data }).command,
      commandId: commandAttemptId(),
    });
    const optimisticStatus = hostCommandPendingStatus(event);
    recordCommandStatus(event.actionId, optimisticStatus);
    const recoveryPersisted = commitHostCommandRecovery({
      ...commandRecoveryAttempts,
      [event.actionId]: Object.freeze({
        ...attempt,
        interruption: attempt.interruption ?? "connection_lost",
      }),
    });
    if (recoveryPersisted !== true) {
      const outcome = hostCommandErrorOutcome({
        actionId: event.actionId,
        error: new Error(
          "Command was not sent because same-ID reload recovery is unavailable.",
        ),
        event,
      });
      recordCommandStatus(event.actionId, outcome);
      commandOutcomes = appendHostCommandOutcome(commandOutcomes, outcome);
      return;
    }

    try {
      const confirmedOutcome = await executeCommandAttempt({
        timeoutMs: commandAttemptTimeoutMs(
          typeof window === "undefined" ? null : window,
        ),
        operation: ({ signal }) => dispatchHostRouteAction({
          event,
          data,
          fetchImpl: fetch,
          commandIdFactory: () => attempt.commandId,
          signal,
          projectionStore,
          preparedCommand: attempt.command,
          replacementCandidate: selectedReplacement,
          retainedReplacementAttempt: event.actionId === "process_replacement" ? recoveredAttempt : null,
        }),
      });
      const nextAttempts = { ...commandRecoveryAttempts };
      delete nextAttempts[event.actionId];
      commitHostCommandRecovery(nextAttempts);
      const result = await recoverHostRouteAction({
        event,
        outcome: confirmedOutcome,
        fetchImpl: fetch,
        projectionStore,
        projectionRecoveryTimeoutMs: commandProjectionRecoveryTimeoutMs(
          typeof window === "undefined" ? null : window,
        ),
      });
      const outcome = result.outcome;
      const tracedOutcome = attachEventConfirmationTrace(outcome, event);
      commandOutcomes = appendHostCommandOutcome(commandOutcomes, tracedOutcome);
      recordCommandStatus(event.actionId, tracedOutcome);
      if (event.actionId === "publish_host_post" && tracedOutcome.state === "ack") {
        hostPostBody = "";
      }
      if (
        typeof window !== "undefined" &&
        event.confirmationTrace !== undefined &&
        event.confirmationTrace !== null
      ) {
        exposeHostCommandDispatchBridgePlan({
          windowRef: window,
          plan: buildHostCommandDispatchBridgePlan({
            event,
            data,
            preparedCommand: attempt.command,
            optimisticStatus,
            finalStatus: tracedOutcome,
          }),
        });
      }
      dispatchHostCommandResult({
        windowRef: window,
        outcome,
      });
    } catch (error) {
      const interruptedOutcome = hostCommandInterruptedOutcome({
        actionId: event.actionId,
        commandId: attempt.commandId,
        error,
        event,
      });
      const outcome = interruptedOutcome ?? hostCommandErrorOutcome({
        actionId: event.actionId,
        error,
        event,
      });
      if (interruptedOutcome !== null) {
        commitHostCommandRecovery({
          ...commandRecoveryAttempts,
          [event.actionId]: Object.freeze({
            ...attempt,
            interruption: interruptedOutcome.interruption,
          }),
        });
      } else {
        const nextAttempts = { ...commandRecoveryAttempts };
        delete nextAttempts[event.actionId];
        commitHostCommandRecovery(nextAttempts);
        commandOutcomes = appendHostCommandOutcome(commandOutcomes, outcome);
      }
      recordCommandStatus(event.actionId, outcome);
      if (
        typeof window !== "undefined" &&
        event.confirmationTrace !== undefined &&
        event.confirmationTrace !== null
      ) {
        exposeHostCommandDispatchBridgePlan({
          windowRef: window,
          plan: buildHostCommandDispatchBridgePlan({
            event,
            data,
            preparedCommand: attempt?.command ?? null,
            optimisticStatus,
            finalStatus: outcome,
          }),
        });
      }
    }
  }

  async function retryHostCommand(actionId) {
    const attempt = commandRecoveryAttempts[actionId];
    if (attempt !== undefined) {
      await handleDispatch(attempt.event, attempt);
    }
  }

  function cancelHostCommandRecovery(actionId) {
    const nextAttempts = { ...commandRecoveryAttempts };
    delete nextAttempts[actionId];
    commitHostCommandRecovery(nextAttempts);
    commandStatuses = clearHostCommandStatus(commandStatuses, actionId);
  }

  function restoreHostCommandRecovery() {
    const restored = restoreHostInterruptedCommands({
      storage: commandRecoveryStorage,
      game: data.game.id,
      principalId: data.commandPrincipalId,
    });
    commandRecoveryAttempts = restored.attempts;
    if (Object.keys(restored.commandStatuses).length > 0) {
      commandStatuses = restored.commandStatuses;
    }
  }

  function commitHostCommandRecovery(nextAttempts) {
    commandRecoveryAttempts = nextAttempts;
    const persisted = persistHostInterruptedCommands({
      storage: commandRecoveryStorage,
      game: data.game.id,
      principalId: data.commandPrincipalId,
      attempts: nextAttempts,
    });
    if (persisted !== true) {
      commandRecoveryStorageAvailable = false;
    }
    return persisted;
  }

  function recordCommandStatus(actionId, status) {
    commandStatuses = recordHostCommandStatus(commandStatuses, actionId, status);
  }

  function schedulerTime(value) {
    return typeof value === "number"
      ? new Date(value * 1000).toISOString()
      : "Not recorded";
  }

  function hasScheduleObservation(event) {
    return (
      event?.scheduleEvidence?.openObservedAt != null ||
      event?.scheduleEvidence?.lockObservedAt != null
    );
  }

  function hasResolutionEvidence(event) {
    return event?.resolutionEvidence !== null &&
      event?.resolutionEvidence !== undefined;
  }

  function resolutionPolicyLabel(event) {
    if (event?.resolutionEvidence?.kind !== "auto") {
      return "Host decision";
    }
    const policy = event.resolutionEvidence.policyKind;
    return policy === "seeded_random" ? "Seeded random" : "First in stable order";
  }

  function hasNarrativeEvidence(event) {
    return Array.isArray(event?.narratives) && event.narratives.length > 0;
  }

  function hasPrivateRoom(event) {
    return event?.room !== null && event?.room !== undefined;
  }

  function roomPosture(room) {
    return room?.postingAllowed === true
      ? "open for posting"
      : `${room?.state ?? "closed"} · read-only`;
  }

  function taskArticleSelector(taskId) {
    return `article[data-task-id="${CSS.escape(taskId)}"]:not([hidden])`;
  }

  /** Selects a task; below the rail width it opens as a sheet over the thread. */
  async function openTask(taskId, invoker = null) {
    preferredTaskId = taskId;
    await tick();
    if (layout === "sheet") {
      taskSheetReturnTo = invoker;
      taskSheetFocus = [
        `${taskArticleSelector(taskId)} [data-testid="command-recovery-retry-${CSS.escape(taskId)}"]`,
        `${taskArticleSelector(taskId)} [data-testid="critical-host-action-trigger"]`,
        `${taskArticleSelector(taskId)} h2`,
      ];
      taskSheetOpen = true;
      return;
    }
    const article = document.querySelector(taskArticleSelector(taskId));
    article?.querySelector("h2")?.focus({ preventScroll: true });
    article?.scrollIntoView?.({ block: "nearest" });
  }

  function focusComposer() {
    const body = document.querySelector('[data-testid="host-composer-body"]');
    body?.focus({ preventScroll: true });
    body?.scrollIntoView?.({ block: "center" });
  }

  function toggleDayEventWinner(eventId, slot) {
    const current = new Set(dayEventSelections[eventId] ?? []);
    if (current.has(slot)) {
      current.delete(slot);
    } else {
      current.add(slot);
    }
    dayEventSelections = { ...dayEventSelections, [eventId]: [...current].sort() };
  }

  async function loadNewerThread() {
    const position = captureReadingPosition();
    threadPageStatus = playerThreadPendingStatus();
    try {
      const result = await loadNewerPlayerThreadPage({ data, fetchImpl: fetch, projectionStore, thread });
      threadPageStatus = result.threadPageStatus;
      await tick();
      restoreReadingPosition(position);
    } catch (error) {
      threadPageStatus = playerThreadErrorStatus(error);
    }
  }

  async function loadOlderThread() {
    const position = captureReadingPosition();
    threadPageStatus = playerThreadPendingStatus();
    try {
      const result = await loadOlderPlayerThreadPage({ data, fetchImpl: fetch, projectionStore, thread });
      threadPageStatus = result.threadPageStatus;
      await tick();
      restoreReadingPosition(position);
    } catch (error) {
      threadPageStatus = playerThreadErrorStatus(error);
    }
  }

  async function copyPostLink(post) {
    await navigator.clipboard.writeText(new URL(post.permalink.href, window.location.href).toString());
  }
</script>

<svelte:head>
  <title>{data.game.label} host console</title>
</svelte:head>

{#if moderatorForcedRouteState || moderatorSurfaceEmpty}
  <main
    class="host-console-critical-path"
    data-component="host-console-route"
    data-game={data.game.id}
    data-testid={HOST_CONSOLE_ROUTE_CONTRACT.surfaceTestId}
  >
    <HostConsoleBar
      shell={data.shell}
      capability={data.access.capability}
      game={data.game}
      phase={currentPhase}
      {liveStatus}
      nowSeconds={hostClockSeconds}
    />
    <div class="host-console-critical-path__body">
      <RouteState view={moderatorForcedRouteState ?? moderatorEmptyState} />
    </div>
  </main>
{:else}
  <GameFrame
    {layout}
    surfaceTestId={HOST_CONSOLE_ROUTE_CONTRACT.surfaceTestId}
    surfaceClass="host-console-critical-path"
    railTestId="host-rail"
    railLabel="Host decisions"
    dock={false}
    component="host-console-route"
    gameId={data.game.id}
  >
    <HostConsoleBar
      slot="bar"
      shell={data.shell}
      capability={data.access.capability}
      game={data.game}
      phase={currentPhase}
      {liveStatus}
      nowSeconds={hostClockSeconds}
      attentionCount={workspace.queue.attentionCount}
      tasks={workspace.tasks}
      decisions={workspace.decisions}
      postAvailable={projectionCommandsReady && hostPostAction !== null}
      onOpenTask={openTask}
      onPost={focusComposer}
    />

    {#if data.commandsEnabled === true && !commandRecoveryStorageAvailable}
      <section
        class="fm-section"
        data-testid="host-command-recovery-storage-warning"
        role="status"
      >
        <strong>Reload recovery unavailable</strong>
        <p>Keep this page open while a command is pending; browser storage is unavailable.</p>
      </section>
    {/if}

    {#if !projectionCommandsReady && data.commandsEnabled === true}
      <section
        class="fm-section"
        data-testid="host-projection-command-health"
        role="status"
      >
        <strong>Host commands paused</strong>
        <p>
          Authoritative host state is {projectionHealth?.state ?? "unavailable"}.
          Controls return after a validated refresh.
        </p>
      </section>
    {/if}

    {#if layout !== "rail"}
      <HostWorkQueueStrip
        decisions={workspace.decisions}
        selectedTaskId={workspace.selectedTaskId}
        attentionCount={workspace.queue.attentionCount}
        summary={workspace.queue.summary}
        layout="strip"
        onSelect={openTask}
      />
    {/if}

    <PlayerThread
      {thread}
      {threadPageStatus}
      roster={projection.roster ?? []}
      onLoadOlder={loadOlderThread}
      onLoadNewer={loadNewerThread}
      onCopyLink={copyPostLink}
    />

    <HostComposer
      action={hostPostAction}
      ready={projectionCommandsReady}
      bind:body={hostPostBody}
      status={commandStatuses.publish_host_post}
      onCommand={handleDispatch}
      onRetry={retryHostCommand}
      onCancel={cancelHostCommandRecovery}
    />

    <details
      class="host-console-critical-path__drawer"
      data-testid="host-supporting-evidence"
      data-legibility="technical"
    >
      <summary>
        <span>Technical details</span>
        <small>Access, receipts, game state, vote record, and lifecycle checks</small>
      </summary>
      <div class="host-console-critical-path__drawer-content">
        <section
          class="host-task-workspace__command-context fm-proof-disclosure"
          data-legibility="technical"
          data-testid={workspace.commandContext.testId}
          data-game-id={workspace.commandContext.gameId}
          data-principal-id={workspace.commandContext.principalId}
          data-capability-kind={workspace.commandContext.capabilityEvidence.kind}
          data-capability-scope={workspace.commandContext.capabilityEvidence.scope}
          data-command-endpoint={workspace.commandContext.commandEndpoint}
        >
          <div class="fm-proof-disclosure__body">
            <span>{workspace.commandContext.label}</span>
            <strong>{workspace.commandContext.value}</strong>
            <small>{workspace.commandContext.commandEndpoint}</small>
            {#if workspace.selectedTask}
              <dl class="host-task-workspace__diagnostics" data-task-id={workspace.selectedTask.id}>
                <div><dt>Required access</dt><dd>{workspace.selectedTask.diagnostics.authority}</dd></div>
                <div><dt>Dispatch boundary</dt><dd>{workspace.selectedTask.diagnostics.boundary}</dd></div>
                <div><dt>Protocol</dt><dd>{workspace.selectedTask.diagnostics.protocol}</dd></div>
              </dl>
            {/if}
          </div>
        </section>

        <HostCommandActivity
          {commandStatuses}
          {commandOutcomes}
        />

        <section
          class="fm-section"
          data-testid="host-day-event-scheduler"
          data-pending={dayEventScheduler?.pending === true}
        >
          <header>
            <p class="fm-eyebrow">DayEvent automation</p>
            <strong>
              {dayEventScheduler?.pending
                ? dayEventScheduler?.autoResolvePending
                  ? "Automatic resolution pending"
                  : dayEventScheduler?.narrativePending
                    ? "Narrative delivery pending"
                  : "Schedule work pending"
                : "Scheduler caught up"}
            </strong>
          </header>
          {#if dayEventScheduler}
            <p data-testid="host-day-event-scheduler-health">
              {dayEventScheduler.totalSuccesses}/{dayEventScheduler.totalAttempts}
              successful observations · wake {dayEventScheduler.lastObservedWakeSeq}/{dayEventScheduler.wakeSeq}
            </p>
            <p>Next due: {schedulerTime(dayEventScheduler.nextDueAt)}</p>
            {#if dayEventScheduler.lastError}
              <p role="status">Retrying after: {dayEventScheduler.lastError}</p>
            {/if}
          {:else}
            <p>No scheduled DayEvent work has been projected.</p>
          {/if}
          {#if hostDayEvents.some(hasScheduleObservation)}
            <ul data-testid="host-day-event-schedule-evidence">
              {#each hostDayEvents as event (event.eventId)}
                {#if hasScheduleObservation(event)}
                  <li>
                    <strong>{event.eventId}</strong>
                    · opened {schedulerTime(event.scheduleEvidence?.openObservedAt)}
                    · locked {schedulerTime(event.scheduleEvidence?.lockObservedAt)}
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
          {#if hostDayEvents.some(hasResolutionEvidence)}
            <ul data-testid="host-day-event-resolution-evidence">
              {#each hostDayEvents as event (event.eventId)}
                {#if hasResolutionEvidence(event)}
                  <li>
                    <strong>{event.eventId}</strong>
                    · {resolutionPolicyLabel(event)}
                    · winners {event.winnerSlots.join(", ")}
                    {#if event.resolutionEvidence.seed !== null}
                      · seed {event.resolutionEvidence.seed}
                    {/if}
                    · rewards {event.rewardKeysApplied.join(", ")}
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
          {#if hostDayEvents.some(hasNarrativeEvidence)}
            <ul data-testid="host-day-event-narrative-evidence">
              {#each hostDayEvents as event (event.eventId)}
                {#each event.narratives as narrative (`${event.eventId}:${narrative.lifecycle}`)}
                  <li>
                    <strong>{event.eventId} · {narrative.lifecycle}</strong>
                    · {narrative.status} to {narrative.channelId}
                    {#if narrative.body}
                      · {narrative.body}
                    {/if}
                  </li>
                {/each}
              {/each}
            </ul>
          {/if}
          {#if hostDayEvents.some(hasPrivateRoom)}
            <ul data-testid="host-day-event-room-evidence">
              {#each hostDayEvents as event (event.eventId)}
                {#if event.room}
                  <li
                    data-event-room={event.room.channelId}
                    data-member-count={event.room.memberCount}
                  >
                    <strong>{event.eventId} · private room</strong>
                    · {event.room.memberCount} members
                    · {event.room.membership}
                    · {roomPosture(event.room)}
                  </li>
                {/if}
              {/each}
            </ul>
          {/if}
        </section>

        <HostLifecycleControlCheckpoint
          checkpoint={hostLifecycleControlCheckpoint}
        />

        <HostPromptResolutionHistory {hostPrompts} />

        <HostVotecountPanel
          boundary={data.votecountBoundary}
          rows={votecount}
          roster={projection.roster ?? []}
        />

        <DayVoteOutcomePanel
          outcomes={dayVoteOutcomes}
          boundary={data.dayVoteOutcomeBoundary}
          rootTestId="host-day-vote-outcome"
          roster={projection.roster ?? []}
        />

        <HostPhaseSummary phase={data.phase} {projection} />
      </div>
    </details>

    <svelte:fragment slot="rail">
      <PlayerSheet
        {layout}
        open={taskSheetOpen}
        label={workspace.selectedTask?.label ?? "Host task"}
        testId="host-task-sheet"
        detent="full"
        returnTo={taskSheetReturnTo}
        focusSelectors={taskSheetFocus}
        onClose={() => { taskSheetOpen = false; }}
      >
        {#if layout === "rail"}
          <HostWorkQueueStrip
            decisions={workspace.decisions}
            selectedTaskId={workspace.selectedTaskId}
            attentionCount={workspace.queue.attentionCount}
            summary={workspace.queue.summary}
            layout="rail"
            onSelect={openTask}
          />
        {/if}
        {#if projectionCommandsReady}
          <HostTaskWorkspace
            view={workspace}
            onToggleDayEventWinner={toggleDayEventWinner}
            onDispatch={handleDispatch}
            onRetry={retryHostCommand}
            onCancel={cancelHostCommandRecovery}
          >
            <svelte:fragment slot="replacement-chooser">
              <HostReplacementChooser
                gameId={data.game.id}
                replacement={projection.replacement}
                authority={projection.authority}
                completed={projection.completed}
                ready={projectionCommandsReady}
                onSelection={(candidate) => replacementCandidate = candidate}
                commandStatus={commandStatuses.process_replacement}
                showRecovery={!moderatorActionGroups.some((group) => group.actions.some((action) => action.id === "process_replacement"))}
                onRetry={retryHostCommand}
                onCancel={cancelHostCommandRecovery}
              />
            </svelte:fragment>
            <svelte:fragment slot="replacement-invite">
              <section
                class="host-console-critical-path__invite-panel fm-section"
                data-testid={replacementInvite.panelTestId}
              >
                <header>
                  <p class="fm-eyebrow">{replacementInvite.eyebrow}</p>
                  <strong data-testid={replacementInvite.targetTestId}>{replacementInvite.targetLabel}</strong>
                </header>
                <form method="POST" action={replacementInvite.action}>
                  <label class="fm-field">
                    <span>Account</span>
                    <input
                      name="accountId"
                      type="text"
                      autocomplete="username"
                      required
                      disabled={!replacementInvite.available}
                      data-testid={replacementInvite.accountTestId}
                    />
                  </label>
                  <input type="hidden" name="principalId" value={replacementInvite.principalId} />
                  <input type="hidden" name="slotId" value={replacementInvite.slotId} />
                  <input
                    type="hidden"
                    name="expectedOccupantPrincipalId"
                    value={replacementInvite.expectedOccupantPrincipalId}
                  />
                  <button
                    class="touch-control"
                    type="submit"
                    disabled={!replacementInvite.available}
                    data-testid={replacementInvite.submitTestId}
                  >
                    {replacementInvite.submitLabel}
                  </button>
                </form>
                {#if !replacementInvite.available}
                  <p class="host-console-critical-path__invite-status" data-state="blocked">
                    Invite unavailable until the live slot projection includes its assigned principal.
                  </p>
                {/if}
                {#if form?.replacementInvite}
                  <p
                    class="host-console-critical-path__invite-status"
                    data-state={form.replacementInvite.state}
                    data-testid={replacementInvite.statusTestId}
                  >
                    {form.replacementInvite.message}
                  </p>
                  {#if form.replacementInvite.state === "ack"}
                    <a
                      class="host-console-critical-path__invite-url"
                      href={form.replacementInvite.loginUrl}
                      data-testid={replacementInvite.urlTestId}
                    >
                      {form.replacementInvite.loginUrl}
                    </a>
                  {/if}
                {/if}
              </section>
            </svelte:fragment>
          </HostTaskWorkspace>
        {:else if data.commandsEnabled === true}
          <p class="host-task-workspace__empty" data-testid="host-task-sheet-paused">Host commands return after a validated refresh.</p>
        {/if}
      </PlayerSheet>
    </svelte:fragment>
  </GameFrame>
{/if}
