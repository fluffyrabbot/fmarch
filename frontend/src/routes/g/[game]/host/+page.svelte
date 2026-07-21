<script>
  import { onMount } from "svelte";
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import DayVoteOutcomePanel from "$lib/components/day-vote-outcome/DayVoteOutcomePanel.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isModeratorRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import HostCommandActivity from "$lib/components/host-action/HostCommandActivity.svelte";
  import HostControlSurface from "$lib/components/host-action/HostControlSurface.svelte";
  import HostLifecycleControlCheckpoint from "$lib/components/host-action/HostLifecycleControlCheckpoint.svelte";
  import HostOperationsStrip from "$lib/components/host-action/HostOperationsStrip.svelte";
  import HostPromptResolutionHistory from "$lib/components/host-action/HostPromptResolutionHistory.svelte";
  import HostPhaseSummary from "$lib/components/host-action/HostPhaseSummary.svelte";
  import HostVotecountPanel from "$lib/components/host-action/HostVotecountPanel.svelte";
  import HostWorkQueueStrip from "$lib/components/host-action/HostWorkQueueStrip.svelte";
  import {
    buildHostLifecycleControlCheckpoint,
  } from "$lib/components/host-action/host-lifecycle-control-checkpoint.mjs";
  import {
    connectLiveProjection,
    LIVE_PROJECTION_CONNECTING_STATUS,
  } from "$lib/app/live-transport.mjs";
  import {
    dispatchHostCommandResult,
    exposeHostCommandDispatchBridgePlan,
    exposeHostLiveProjectionEndpoint,
    exposeHostRouteWindowState,
    recordHostLiveProjectionEvent,
    triggerHostLiveProjectionResync,
  } from "./host-route-browser-bridge.mjs";
  import {
    appendHostActionEvent,
    appendHostCommandOutcome,
    attachEventConfirmationTrace,
    buildHostDerivedState,
    buildHostCommandDispatchBridgePlan,
    buildHostProjectionColdLoads,
    buildHostProjectionInitialSnapshot,
    hostCommandErrorOutcome,
    hostCommandPendingStatus,
    hostProjectionResyncKeys,
    recordHostCommandStatus,
    sendHostRouteAction,
  } from "./host-route-controller.mjs";
  import {
    HOST_CONSOLE_ROUTE_CONTRACT,
    buildHostInviteTargets,
    buildHostWorkQueues,
  } from "./host-route-model.mjs";
  import { activePhaseTheme, phaseThemeKey } from "$lib/app/phase-theme.mjs";
  import { createProjectionStore } from "$lib/app/projection-store.mjs";
  import "$lib/components/host-action/host-console-critical-path.css";

  export let data;
  export let form;

  let dispatched = [];
  let commandOutcomes = [];
  let commandStatuses = {};
  let projection = {
    phase: data.phase,
    replacement: data.replacement,
  };
  let votecount = data.votecount;
  let dayVoteOutcomes = data.dayVoteOutcomes;
  let hostPrompts = data.hostPrompts;
  let moderatorActionGroups = data.moderatorActionGroups;
  let liveStatus = LIVE_PROJECTION_CONNECTING_STATUS;
  $: moderatorSurfaceEmpty = isModeratorRouteEmpty({
    workQueues: data.workQueues,
    votecount,
    hostPrompts,
    moderatorActionGroups,
  });
  $: moderatorForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: moderatorEmptyState = buildRouteStateViewModel({
    surface: "moderator",
    state: "empty",
  });
  $: inviteTargets = buildHostInviteTargets({
    replacement: projection.replacement,
  });
  $: workQueues = buildHostWorkQueues({
    phase: projection.phase ?? data.phase,
    votecountCount: votecount.length,
    nowSeconds: data.deadlineClock?.nowSeconds,
  });
  $: if (typeof window !== "undefined") {
    activePhaseTheme.set(phaseThemeKey(projection.phase ?? data.phase));
  }
  $: hostLifecycleControlCheckpoint = buildHostLifecycleControlCheckpoint({
    phase: projection.phase ?? data.phase,
    replacement: projection.replacement ?? data.replacement,
    actionGroups: moderatorActionGroups,
    commandContext: data.commandContext,
  });
  const resyncKeys = hostProjectionResyncKeys();
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
    });
    projection = derived.projection;
    votecount = derived.votecount;
    dayVoteOutcomes = derived.dayVoteOutcomes;
    hostPrompts = derived.hostPrompts;
    moderatorActionGroups = derived.moderatorActionGroups;
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
    exposeHostLiveProjectionEndpoint({
      windowRef: window,
      endpoint: data.liveProjection.endpoint,
    });
    const connection = connectLiveProjection({
      url: data.liveProjection.endpoint,
      projectionStore,
      fetchImpl: fetch,
      resyncKeys,
      onEvent(message, snapshot) {
        liveStatus = recordHostLiveProjectionEvent({
          windowRef: window,
          message,
          snapshot,
          currentStatus: liveStatus,
        });
      },
    });
    window.__fmarchGetHostLiveProjectionMetrics = () => connection?.metrics?.() ?? null;
    window.__fmarchTriggerHostResync = async (fromSeq = 0) => {
      const recovery = await triggerHostLiveProjectionResync({
        windowRef: window,
        projectionStore,
        resyncKeys,
        fetchImpl: fetch,
        fromSeq,
        currentStatus: liveStatus,
      });
      liveStatus = recovery.liveStatus;
      return recovery.snapshot;
    };
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
      delete window.__fmarchTriggerHostResync;
      delete window.__fmarchGetHostLiveProjectionMetrics;
      delete window.__fmarchCloseHostLiveProjection;
      delete window.__fmarchDropHostLiveProjection;
      delete window.__fmarchDispatchHostAction;
      activePhaseTheme.set(null);
      connection?.close();
    };
  });

  async function handleDispatch(event) {
    dispatched = appendHostActionEvent(dispatched, event);
    const optimisticStatus = hostCommandPendingStatus(event);
    recordCommandStatus(event.actionId, optimisticStatus);

    try {
      const result = await sendHostRouteAction({
        event,
        data,
        fetchImpl: fetch,
        projectionStore,
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
      const outcome = hostCommandErrorOutcome({
        actionId: event.actionId,
        error,
        event,
      });
      commandOutcomes = appendHostCommandOutcome(commandOutcomes, outcome);
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
            optimisticStatus,
            finalStatus: outcome,
          }),
        });
      }
    }
  }

  function recordCommandStatus(actionId, status) {
    commandStatuses = recordHostCommandStatus(commandStatuses, actionId, status);
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
  <AppSurfaceHeader header={data.surfaceHeader} {liveStatus} />

  {#if moderatorForcedRouteState}
    <RouteState view={moderatorForcedRouteState} />
  {:else if moderatorSurfaceEmpty}
    <RouteState view={moderatorEmptyState} />
  {:else}
    <details
      class="host-console-critical-path__drawer"
      data-testid="host-status-overview"
    >
      <summary>
        <span>Game snapshot</span>
        <small>Phase, votecount, prompts, and player status</small>
      </summary>
      <div class="host-console-critical-path__drawer-content">
        <HostOperationsStrip
          access={data.access}
          phase={data.phase}
          {projection}
          votecountBoundary={data.votecountBoundary}
          {votecount}
          {hostPrompts}
        />
      </div>
    </details>

    <HostControlSurface
      groups={moderatorActionGroups}
      {commandStatuses}
      commandContext={data.commandContext}
      onDispatch={handleDispatch}
    />

    <HostCommandActivity
      {commandStatuses}
      {commandOutcomes}
    />

    <details
      class="host-console-critical-path__drawer"
      data-testid="host-supporting-evidence"
    >
      <summary>
        <span>Supporting evidence</span>
        <small>Game status, vote record, and lifecycle checks</small>
      </summary>
      <div class="host-console-critical-path__drawer-content">
        <HostWorkQueueStrip queues={workQueues} />

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
                  data-testid={inviteTarget.accountTestId}
                />
              </label>
              <input
                type="hidden"
                name="principalUserId"
                value={inviteTarget.principalUserId}
              />
              <input type="hidden" name="slotId" value={inviteTarget.slotId} />
              <input
                type="hidden"
                name="expectedOccupantUserId"
                value={inviteTarget.expectedOccupantUserId}
              />
              <button
                class="touch-control"
                type="submit"
                data-testid={inviteTarget.submitTestId}
              >
                {inviteTarget.submitLabel}
              </button>
            </form>
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
              {:else if inviteTarget.id === "player" && inviteResult.currentOccupantUserId}
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
                    name="principalUserId"
                    value={inviteResult.currentOccupantUserId}
                  />
                  <input
                    type="hidden"
                    name="slotId"
                    value={inviteResult.slotId ?? inviteTarget.slotId}
                  />
                  <input
                    type="hidden"
                    name="expectedOccupantUserId"
                    value={inviteResult.currentOccupantUserId}
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
</main>
