<script>
  import { onMount } from "svelte";
  import DayVoteOutcomePanel from "$lib/components/day-vote-outcome/DayVoteOutcomePanel.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isModeratorRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import HostCommandActivity from "$lib/components/host-action/HostCommandActivity.svelte";
  import HostConsoleBar from "$lib/components/host-action/HostConsoleBar.svelte";
  import HostTaskWorkspace from "$lib/components/host-action/HostTaskWorkspace.svelte";
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
  import {
    HOST_CONSOLE_ROUTE_CONTRACT,
    buildHostInviteTargets,
    buildHostWorkQueues,
  } from "./host-route-model.mjs";
  import { activePhaseTheme, phaseThemeKey } from "$lib/app/phase-theme.mjs";
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
  export let form;

  let dispatched = [];
  let commandOutcomes = [];
  let commandStatuses = {};
  let commandRecoveryAttempts = {};
  let commandRecoveryStorage = null;
  let commandRecoveryStorageAvailable = true;
  let projection = {
    phase: data.phase,
    replacement: data.replacement,
  };
  $: currentPhase = projection.phase;
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
    workQueues: data.workQueues,
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
  $: inviteTargets = gateHostInviteTargets(
    buildHostInviteTargets({ replacement: projection.replacement }),
    projectionCommandsReady,
  );
  $: workQueues = buildHostWorkQueues({
    phase: currentPhase,
    replacement: projection.replacement,
    votecountCount: votecount.length,
    nowSeconds: data.deadlineClock?.nowSeconds,
  });
  $: hostAttentionCount = hostTasks.length + moderatorActionGroups.filter(
    (group) => ["deadline", "replacement"].includes(group.id) && group.actions.length > 0,
  ).length;
  $: if (typeof window !== "undefined") {
    activePhaseTheme.set(phaseThemeKey(currentPhase));
  }
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
      nowSeconds: data.deadlineClock?.nowSeconds,
    });
    projection = derived.projection;
    votecount = derived.votecount;
    dayVoteOutcomes = derived.dayVoteOutcomes;
    hostPrompts = derived.hostPrompts;
    hostTasks = derived.hostTasks;
    hostDayEvents = derived.hostDayEvents;
    dayEventScheduler = derived.dayEventScheduler;
    moderatorActionGroups = derived.moderatorActionGroups;
  });
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
      activePhaseTheme.set(null);
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
      activePhaseTheme.set(null);
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

  function gateHostInviteTargets(targets, ready) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(targets).map(([key, target]) => [
          key,
          Object.freeze({
            ...target,
            available: ready === true && target.available === true,
          }),
        ]),
      ),
    );
  }
</script>

<svelte:head>
  <title>{data.game.label} host console</title>
</svelte:head>

<main
  class="host-console-critical-path"
  data-component="host-console-route"
  data-game={data.game.id}
  data-testid={HOST_CONSOLE_ROUTE_CONTRACT.surfaceTestId}
>
  <HostConsoleBar
    game={data.game}
    phase={currentPhase}
    capabilityLabel={data.access.capabilityLabel}
    {liveStatus}
    attentionCount={hostAttentionCount}
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

  <div class="host-console-critical-path__body">
    {#if moderatorForcedRouteState}
      <RouteState view={moderatorForcedRouteState} />
    {:else if moderatorSurfaceEmpty}
      <RouteState view={moderatorEmptyState} />
    {:else}
      {#if projectionCommandsReady}
        <HostTaskWorkspace
          groups={moderatorActionGroups}
          {commandStatuses}
          commandContext={data.commandContext}
          phase={currentPhase}
          replacement={projection.replacement ?? data.replacement}
          {hostPrompts}
          {hostTasks}
          {hostDayEvents}
          {votecount}
          onDispatch={handleDispatch}
          onRetry={retryHostCommand}
          onCancel={cancelHostCommandRecovery}
        />
      {:else if data.commandsEnabled === true}
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

      <details
        class="host-console-critical-path__drawer"
        data-testid="host-supporting-evidence"
      >
        <summary>
          <span>Evidence and activity</span>
          <small>Receipts, game state, vote record, and lifecycle checks</small>
        </summary>
        <div class="host-console-critical-path__drawer-content">
          <HostCommandActivity
            {commandStatuses}
            {commandOutcomes}
          />

          <HostWorkQueueStrip queues={workQueues} />

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
          />

          <DayVoteOutcomePanel
            outcomes={dayVoteOutcomes}
            boundary={data.dayVoteOutcomeBoundary}
            rootTestId="host-day-vote-outcome"
          />

          <HostPhaseSummary phase={data.phase} {projection} />
        </div>
      </details>

      <details
        class="host-console-critical-path__drawer"
        data-testid="host-invite-workflows"
        open={form?.playerInvite !== undefined || form?.replacementInvite !== undefined}
      >
        <summary>
          <span>Player access</span>
          <small>Invite players and replacements</small>
        </summary>
        <div class="host-console-critical-path__invite-grid">
          {#each [
            [inviteTargets.player, form?.playerInvite],
            [inviteTargets.replacement, form?.replacementInvite],
          ] as [inviteTarget, inviteResult]}
            <section
              class="host-console-critical-path__invite-panel fm-section"
              data-testid={inviteTarget.panelTestId}
            >
            <header>
              <p class="fm-eyebrow">{inviteTarget.eyebrow}</p>
              <strong data-testid={inviteTarget.targetTestId}>{inviteTarget.targetLabel}</strong>
            </header>
            <form method="POST" action={inviteTarget.action}>
              <label class="fm-field">
                <span>Account</span>
                <input
                  name="accountId"
                  type="text"
                  autocomplete="username"
                  required
                  disabled={!inviteTarget.available}
                  data-testid={inviteTarget.accountTestId}
                />
              </label>
              <input
                type="hidden"
                name="principalId"
                value={inviteTarget.principalId}
              />
              <input type="hidden" name="slotId" value={inviteTarget.slotId} />
              <input
                type="hidden"
                name="expectedOccupantPrincipalId"
                value={inviteTarget.expectedOccupantPrincipalId}
              />
              <button
                class="touch-control"
                type="submit"
                disabled={!inviteTarget.available}
                data-testid={inviteTarget.submitTestId}
              >
                {inviteTarget.submitLabel}
              </button>
            </form>
            {#if !inviteTarget.available}
              <p class="host-console-critical-path__invite-status" data-state="blocked">
                Invite unavailable until the live slot projection includes its assigned principal.
              </p>
            {/if}
            {#if inviteResult}
              <p
                class="host-console-critical-path__invite-status"
                data-state={inviteResult.state}
                data-testid={inviteTarget.statusTestId}
              >
                {inviteResult.message}
              </p>
              {#if inviteResult.state === "ack"}
                <a
                  class="host-console-critical-path__invite-url"
                  href={inviteResult.loginUrl}
                  data-testid={inviteTarget.urlTestId}
                >
                  {inviteResult.loginUrl}
                </a>
              {:else if projectionCommandsReady && inviteTarget.id === "player" && inviteResult.currentOccupantPrincipalId}
                <form
                  class="host-console-critical-path__invite-retry"
                  method="POST"
                  action={inviteTarget.action}
                  data-testid="host-player-invite-retry"
                >
                  <label class="fm-field">
                    <span>Account</span>
                    <input
                      name="accountId"
                      type="text"
                      autocomplete="username"
                      required
                      data-testid="host-player-invite-retry-account"
                    />
                  </label>
                  <input
                    type="hidden"
                    name="principalId"
                    value={inviteResult.currentOccupantPrincipalId}
                  />
                  <input
                    type="hidden"
                    name="slotId"
                    value={inviteResult.slotId ?? inviteTarget.slotId}
                  />
                  <input
                    type="hidden"
                    name="expectedOccupantPrincipalId"
                    value={inviteResult.currentOccupantPrincipalId}
                  />
                  <button
                    class="touch-control"
                    type="submit"
                    data-testid="host-player-invite-retry-submit"
                  >
                    Issue current player invite
                  </button>
                </form>
              {/if}
            {/if}
            </section>
          {/each}
        </div>
      </details>
    {/if}
  </div>
</main>
