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
  data-boundary-status={view.boundary.status}
  aria-label={view.root.ariaLabel}
>
  <header>
    <div>
      <p class="fm-eyebrow">
        {view.boundary.statusLabel}
      </p>
      <h2>{view.heading}</h2>
    </div>
    <span
      class="fm-chip"
      data-command={view.boundary.command}
      data-testid={view.boundary.commandTestId}
    >
      {view.boundary.label}
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
          data-at-hammer={row.atHammer}
        >
          <span class="fm-wagon__name">{row.target}</span>
          <span class="fm-wagon__track" aria-hidden="true">
            <span
              class="fm-wagon__fill"
              style={`--fm-wagon-fill: ${row.fillPercent}%`}
            ></span>
          </span>
          <strong class="fm-wagon__count">{row.tally}</strong>
        </div>
      {/each}
    </div>
  {/if}
</section>
