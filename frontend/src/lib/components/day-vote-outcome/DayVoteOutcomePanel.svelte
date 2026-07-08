<script>
  import {
    buildDayVoteOutcomePanelViewModel,
  } from "./day-vote-outcome-panel.mjs";

  export let outcomes = [];
  export let heading = "Day vote outcome";
  export let rootTestId = "day-vote-outcome";
  export let boundary = {};

  $: view = buildDayVoteOutcomePanelViewModel({
    outcomes,
    heading,
    rootTestId,
    boundary,
  });
</script>

<section
  class={view.root.className}
  data-testid={view.root.testId}
  data-component={view.root.data.component}
  data-state={view.root.data.state}
  data-boundary-status={view.boundary.status}
  aria-label={view.root.ariaLabel}
>
  <header>
    <div>
      <p class="fm-eyebrow">{view.boundary.statusLabel}</p>
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

  {#if view.latest === null}
    <p class={view.empty.className}>{view.empty.message}</p>
  {:else}
    <div class="day-vote-outcome-panel__summary" data-testid={view.latest.testId}>
      <strong>{view.latest.phaseId} {view.latest.status}</strong>
      <p>{view.latest.summary}</p>
      {#if view.latest.reason}
        <p>{view.latest.reason}</p>
      {/if}
    </div>
    {#if view.tallies.length > 0}
      <div class="day-vote-outcome-panel__tallies fm-rowlist">
        {#each view.tallies as row}
          <div
            class={view.classes.tally}
            data-testid={row.testId}
            data-min-touch-target-px={row.minTargetPx}
          >
            <span>{row.slotLabel}</span>
            <strong>{row.count}{row.majority === null ? "" : `/${row.majority}`}</strong>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</section>

<style>
  .day-vote-outcome-panel header {
    align-items: start;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .day-vote-outcome-panel__summary {
    border-block-start: 1px solid var(--fm-line);
    display: grid;
    gap: 8px;
    min-block-size: 76px;
    min-inline-size: 0;
    padding-block-start: 8px;
  }

  .day-vote-outcome-panel__summary strong {
    color: var(--fm-ink);
    font-size: 18px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .day-vote-outcome-panel__summary p,
  .day-vote-outcome-panel__empty {
    color: var(--fm-ink-muted);
    font-size: 15px;
    line-height: 1.35;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .day-vote-outcome-panel__tally {
    align-items: center;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .day-vote-outcome-panel__tally strong {
    font-size: 18px;
    line-height: 1.25;
  }

  @media (max-width: 760px) {
    .day-vote-outcome-panel header {
      grid-template-columns: 1fr;
    }
  }
</style>
