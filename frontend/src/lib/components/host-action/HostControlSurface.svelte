<script>
  import HostControlGroup from "./HostControlGroup.svelte";
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
  <header class="host-console-critical-path__control-heading">
    <div>
      <p class="fm-eyebrow">Host workspace</p>
      <h2>Actions</h2>
    </div>
    <p>Make the next game change. Supporting evidence stays below.</p>
  </header>

  <details
    class="host-console-critical-path__command-context fm-proof-disclosure"
    data-testid={view.commandContext.testId}
    data-game-id={view.commandContext.gameId}
    data-principal-user-id={view.commandContext.principalUserId}
    data-capability-label={view.commandContext.capabilityLabel}
    data-command-endpoint={view.commandContext.commandEndpoint}
  >
    <summary>{view.commandContext.summary}</summary>
    <div class="fm-proof-disclosure__body">
      <span>{view.commandContext.label}</span>
      <strong>{view.commandContext.value}</strong>
      <small>{view.commandContext.commandEndpoint}</small>
    </div>
  </details>

  {#each view.queues as queue}
    {#if queue.collapsible}
      <details
        class="host-console-critical-path__control-queue host-console-critical-path__control-queue--collapsible"
        data-queue={queue.id}
        data-testid={queue.testId}
      >
        <summary>
          <span>{queue.label}</span>
          <small>{queue.countLabel} · {queue.summary}</small>
        </summary>
        <div class="host-console-critical-path__control-queue-groups">
          {#each queue.groups as control}
            <HostControlGroup {control} {onDispatch} />
          {/each}
        </div>
      </details>
    {:else}
      <section
        class="host-console-critical-path__control-queue host-console-critical-path__control-queue--now"
        data-queue={queue.id}
        data-testid={queue.testId}
      >
        <header class="host-console-critical-path__control-queue-heading">
          <div>
            <p class="fm-eyebrow">Next decision</p>
            <h3>{queue.label}</h3>
          </div>
          <p>{queue.summary}</p>
        </header>
        <div class="host-console-critical-path__control-queue-groups">
          {#each queue.groups as control}
            <HostControlGroup {control} {onDispatch} />
          {/each}
        </div>
      </section>
    {/if}
  {/each}
</section>
