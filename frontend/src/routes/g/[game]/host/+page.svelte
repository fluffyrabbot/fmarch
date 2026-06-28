<script>
  import { onMount } from "svelte";
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isModeratorRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import HostCommandActivity from "$lib/components/host-action/HostCommandActivity.svelte";
  import HostControlSurface from "$lib/components/host-action/HostControlSurface.svelte";
  import HostOperationsStrip from "$lib/components/host-action/HostOperationsStrip.svelte";
  import HostPhaseSummary from "$lib/components/host-action/HostPhaseSummary.svelte";
  import HostVotecountPanel from "$lib/components/host-action/HostVotecountPanel.svelte";
  import HostWorkQueueStrip from "$lib/components/host-action/HostWorkQueueStrip.svelte";
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
  import { HOST_CONSOLE_ROUTE_CONTRACT } from "./host-route-model.mjs";
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
      delete window.__fmarchCloseHostLiveProjection;
      delete window.__fmarchDropHostLiveProjection;
      delete window.__fmarchDispatchHostAction;
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
    <HostOperationsStrip
      access={data.access}
      phase={data.phase}
      {projection}
      votecountBoundary={data.votecountBoundary}
      {votecount}
      {hostPrompts}
    />

    <section
      class="host-console-critical-path__replacement-invite"
      data-testid="host-replacement-invite-panel"
    >
      <header>
        <p class="host-console-critical-path__eyebrow">Replacement invite</p>
        <strong data-testid="host-replacement-invite-target">Slot 7 / player-rowan</strong>
      </header>
      <form method="POST" action="?/issueReplacementInvite">
        <input type="hidden" name="principalUserId" value="player-rowan" />
        <button
          class="fm-touch-control"
          type="submit"
          data-testid="host-replacement-invite-submit"
        >
          Issue invite
        </button>
      </form>
      {#if form?.replacementInvite}
        <p
          class="host-console-critical-path__replacement-invite-status"
          data-state={form.replacementInvite.state}
          data-testid="host-replacement-invite-status"
        >
          {form.replacementInvite.message}
        </p>
        {#if form.replacementInvite.state === "ack"}
          <a
            class="host-console-critical-path__replacement-invite-url"
            href={form.replacementInvite.loginUrl}
            data-testid="host-replacement-invite-url"
          >
            {form.replacementInvite.loginUrl}
          </a>
        {/if}
      {/if}
    </section>

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

    <HostPhaseSummary phase={data.phase} {projection} />

    <HostWorkQueueStrip queues={data.workQueues} />

    <HostVotecountPanel
      boundary={data.votecountBoundary}
      rows={votecount}
    />
  {/if}
</main>
