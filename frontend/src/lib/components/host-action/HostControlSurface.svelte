<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import HostAction from "./HostAction.svelte";
  import {
    buildHostControlSurfaceViewModel,
  } from "./host-control-surface.mjs";

  export let groups = [];
  export let commandStatuses = {};
  export let commandContext = {};
  export let onDispatch = () => {};

  $: view = buildHostControlSurfaceViewModel({
    groups,
    commandStatuses,
    commandContext,
  });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-thumb-zone={view.root.data.thumbZone}
  data-action-priority={view.root.data.actionPriority}
  data-control-rail-mode={view.root.data.controlRailMode}
  data-sticky-top-px={view.root.data.stickyTopPx}
  data-unstick-below-px={view.root.data.unstickBelowPx}
  data-action-tile-stability-mode={view.root.data.actionTileStabilityMode}
  data-game-id={view.root.data.gameId}
  data-principal-user-id={view.root.data.principalUserId}
  data-capability-label={view.root.data.capabilityLabel}
  data-testid={view.root.testId}
>
  <div
    class="host-console-critical-path__command-context"
    data-testid={view.commandContext.testId}
    data-game-id={view.commandContext.gameId}
    data-principal-user-id={view.commandContext.principalUserId}
    data-capability-label={view.commandContext.capabilityLabel}
    data-command-endpoint={view.commandContext.commandEndpoint}
  >
    <span>{view.commandContext.label}</span>
    <strong>{view.commandContext.value}</strong>
    <small>{view.commandContext.commandEndpoint}</small>
  </div>

  {#each view.groups as control}
    <article
      class={control.classes.controlBay}
      data-testid={control.testId}
    >
      <header>
        <div>
          <p class="fm-eyebrow">{control.authority}</p>
          <h2>{control.label}</h2>
        </div>
        <span class="fm-chip">{control.boundary}</span>
      </header>
      <p>{control.value}</p>
      <p class={control.classes.boundary}>
        {control.boundaryDetail}
      </p>
      {#if control.actions.length === 0}
        <p class={control.classes.empty}>
          {control.emptyLabel}
        </p>
      {:else}
        <div class={control.classes.actionBay}>
          {#each control.actions as action}
            <div
              class={control.classes.actionTile}
              data-testid={action.testId}
            >
              <HostAction action={action.config} onDispatch={onDispatch} />
              <div
                class={control.classes.commandStatusFloor}
                data-testid={action.statusFloorTestId}
                data-status-floor-min-px={action.statusFloorMinBlockSizePx}
                aria-hidden={action.status ? undefined : "true"}
              >
                {#if action.status}
                  <AppStatus
                    status={action.status}
                    testId={action.statusTestId}
                    className={control.classes.commandStatus}
                  />
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </article>
  {/each}
</section>
