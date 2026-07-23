<script>
  import { buildPlayerDayEventRailViewModel } from "./player-day-event-rail-model.mjs";

  export let commands = [];
  export let commandPending = false;
  export let commandInterrupted = false;
  export let player = {};
  export let onCommand = () => {};

  $: view = buildPlayerDayEventRailViewModel({
    commands,
    commandPending,
    commandInterrupted,
    player,
  });
</script>

{#if view.items.length > 0}
  <section
    class="player-day-event-rail"
    id="player-day-events"
    aria-label="Open DayEvents"
    aria-busy={view.root.ariaBusy}
    data-component={view.root.componentName}
    data-testid={view.root.testId}
  >
    <header>
      <div>
        <p class="fm-eyebrow">DayEvents</p>
        <h2>{view.heading}</h2>
      </div>
      <span>{view.summary}</span>
    </header>
    <div class="player-day-event-rail__items">
      {#each view.items as item (item.eventId)}
        <article
          data-testid={item.testId}
          data-event-id={item.eventId}
          data-participation-status={item.status}
        >
          <div>
            <strong>{item.label}</strong>
            <small>{item.detail}</small>
          </div>
          <button
            type="button"
            data-action={item.action}
            data-command-recovery-return={item.action}
            data-min-touch-target-px={item.minTouchTargetPx}
            disabled={item.disabled}
            aria-disabled={item.disabled ? "true" : undefined}
            on:click={() => onCommand(item.action)}
          >
            {item.label.startsWith("Leave ") ? "Leave" : "Join"}
          </button>
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .player-day-event-rail {
    border-block-start: 1px solid var(--fm-line-strong);
    display: grid;
    gap: 12px;
    padding-block-start: 18px;
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + 16px);
  }

  .player-day-event-rail header,
  .player-day-event-rail article {
    align-items: center;
    display: flex;
    gap: 14px;
    justify-content: space-between;
  }

  .player-day-event-rail h2,
  .player-day-event-rail p {
    margin: 0;
  }

  .player-day-event-rail header > span,
  .player-day-event-rail small {
    color: var(--fm-ink-muted);
    font-size: 12px;
    font-weight: 700;
  }

  .player-day-event-rail__items {
    display: grid;
    gap: 8px;
  }

  .player-day-event-rail article {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 10px;
    padding: 10px;
  }

  .player-day-event-rail article > div {
    display: grid;
    gap: 3px;
  }

  .player-day-event-rail button {
    background: var(--fm-ink);
    border: 1px solid var(--fm-ink);
    border-radius: 8px;
    color: var(--fm-on-dark);
    font: inherit;
    font-weight: 850;
    min-block-size: 44px;
    min-inline-size: 76px;
    padding: 8px 14px;
  }

  @media (max-width: 560px) {
    .player-day-event-rail header {
      align-items: start;
      display: grid;
    }
  }
</style>
