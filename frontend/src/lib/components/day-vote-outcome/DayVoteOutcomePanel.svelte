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
  aria-label={view.root.ariaLabel}
>
  <header>
    <div>
      <p class="fm-eyebrow">{view.boundary.status}</p>
      <h2>{view.heading}</h2>
    </div>
    <span data-testid={view.boundary.commandTestId}>{view.boundary.command}</span>
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
      <div class="day-vote-outcome-panel__tallies">
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
  .day-vote-outcome-panel {
    border-block-start: 4px solid var(--fm-ink-subtle);
    display: grid;
    gap: 14px;
    min-inline-size: 0;
    padding-block-start: 14px;
  }

  .day-vote-outcome-panel header {
    align-items: start;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .day-vote-outcome-panel header span {
    align-items: center;
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    color: var(--fm-ink-muted);
    display: inline-flex;
    font-size: 13px;
    font-weight: 700;
    min-block-size: 36px;
    padding-inline: 12px;
  }

  .day-vote-outcome-panel__summary,
  .day-vote-outcome-panel__tally {
    border-block-start: 1px solid var(--fm-line);
    min-inline-size: 0;
    padding-block-start: 8px;
  }

  .day-vote-outcome-panel__summary {
    display: grid;
    gap: 8px;
    min-block-size: 76px;
  }

  .day-vote-outcome-panel__summary strong,
  .day-vote-outcome-panel__tally strong {
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

  .day-vote-outcome-panel__tallies {
    display: grid;
    gap: 8px;
  }

  .day-vote-outcome-panel__tally {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 44px;
  }

  .day-vote-outcome-panel__tally span {
    overflow-wrap: anywhere;
  }

  @media (max-width: 760px) {
    .day-vote-outcome-panel header {
      grid-template-columns: 1fr;
    }
  }
</style>
