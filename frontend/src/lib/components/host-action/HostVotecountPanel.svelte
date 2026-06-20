<script>
  import {
    buildHostVotecountPanelViewModel,
  } from "./host-votecount-panel.mjs";

  export let boundary;
  export let rows = [];

  $: view = buildHostVotecountPanelViewModel({
    boundary,
    rows,
  });
</script>

<section
  class={view.root.className}
  data-testid={view.root.testId}
  data-component={view.root.data.component}
  aria-label={view.root.ariaLabel}
>
  <header>
    <div>
      <p class="host-console-critical-path__eyebrow">
        {view.boundary.status}
      </p>
      <h2>{view.heading}</h2>
    </div>
    <span data-testid={view.boundary.commandTestId}>
      {view.boundary.command}
    </span>
  </header>
  {#if view.rows.length === 0}
    <p class={view.empty.className}>{view.empty.message}</p>
  {:else}
    <div class={view.classes.rows}>
      {#each view.rows as row}
        <div
          class={view.classes.row}
          data-testid={row.testId}
          data-min-touch-target-px={row.minTargetPx}
        >
          <span>{row.target}</span>
          <strong>{row.tally}</strong>
        </div>
      {/each}
    </div>
  {/if}
</section>
