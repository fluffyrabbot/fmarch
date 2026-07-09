<script>
  export let view;
</script>

{#if view}
  <section
    class={view.root.className}
    data-component={view.root.data.component}
    data-state={view.root.data.state}
    data-winner-alignment={view.root.data.winnerAlignment}
    data-testid={view.root.testId}
  >
    <header>
      <div>
        <p class="fm-eyebrow">{view.eyebrow}</p>
        <h2>{view.heading}</h2>
      </div>
    </header>

    <div class="player-endgame-summary__winner fm-well" data-testid={view.winner.testId}>
      <strong>{view.winner.label}</strong>
      <p>{view.winner.detail}</p>
      {#if view.winner.phaseId}
        <small>Declared at {view.winner.phaseId}</small>
      {/if}
    </div>

    {#if view.rows.length > 0}
      <div class="player-endgame-summary__reveals fm-rowlist">
        {#each view.rows as row (row.testId)}
          <div
            class={row.className}
            data-testid={row.testId}
            data-min-touch-target-px={row.minTouchTargetPx}
          >
            <span>{row.slotLabel}</span>
            <strong>{row.roleLabel}</strong>
            <span>{row.alignmentLabel}</span>
            <small>{row.fateLabel}</small>
          </div>
        {/each}
      </div>
    {/if}

    {#if view.voteHistory.rows.length > 0}
      <div
        class="player-endgame-summary__vote-history"
        data-testid={view.voteHistory.testId}
      >
        <h3>{view.voteHistory.heading}</h3>
        <div class="fm-rowlist">
          {#each view.voteHistory.rows as row (row.testId)}
            <div
              class={row.className}
              data-testid={row.testId}
              data-min-touch-target-px={row.minTouchTargetPx}
            >
              <div>
                <strong>{row.phaseLabel}</strong>
                <span>{row.resultLabel}</span>
              </div>
              <p>{row.tallyLabel}</p>
              <small>{row.ballotLabel}</small>
              <small>{row.majorityLabel}</small>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    <p class="player-endgame-summary__boundary" data-testid={view.boundary.testId}>
      {view.boundary.message}
    </p>
  </section>
{/if}
