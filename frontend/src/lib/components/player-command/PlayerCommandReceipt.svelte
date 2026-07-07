<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    buildPlayerCommandReceiptViewModel,
  } from "./player-command-receipt-model.mjs";

  export let receipts = [];

  $: view = buildPlayerCommandReceiptViewModel({ receipts });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-testid="player-command-receipt"
>
  <header>
    <div>
      <p class="fm-eyebrow">Player ops</p>
      <h2>{view.heading}</h2>
    </div>
    <span data-testid="player-command-receipt-count">
      {view.items.length}
    </span>
  </header>
  <p>{view.summary}</p>
  {#if view.items.length === 0}
    <p
      class={view.empty.className}
      data-state={view.empty.state}
      data-testid={view.empty.testId}
    >
      {view.empty.message}
    </p>
  {:else}
    <div class={view.listClassName}>
      {#each view.items as item}
        <article
          class={item.className}
          data-testid={item.testId}
          data-command-trace-kind={item.commandTrace?.kind}
          data-command-surface={item.commandTrace?.surface}
          data-command-action-id={item.commandTrace?.actionId}
          data-command-status-key={item.commandTrace?.statusKey}
          data-command-dispatch-kind={item.commandTrace?.dispatchKind}
          data-command-refresh-keys={item.commandTrace?.projectionRefreshKeys?.join(",")}
        >
          <strong>{item.label}</strong>
          <AppStatus
            status={{ state: item.state, message: item.message }}
            testId={item.statusTestId}
            className="player-command-receipt__status"
          />
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .player-command-receipt {
    background: var(--fm-surface-tint);
    border: 1px solid var(--fm-line);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    min-inline-size: 0;
    padding: 14px;
  }

  .player-command-receipt header {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
  }

  .player-command-receipt header h2,
  .player-command-receipt header p,
  .player-command-receipt > p {
    margin: 0;
  }

  .player-command-receipt header span {
    align-items: center;
    background: var(--fm-accent-ink);
    border-radius: 999px;
    color: var(--fm-on-dark);
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    inline-size: 36px;
    justify-content: center;
    min-block-size: 36px;
  }

  .player-command-receipt > p {
    color: var(--fm-ink-subtle);
    font-size: 14px;
    line-height: 1.4;
  }

  .player-command-receipt__empty {
    background: var(--fm-surface-tint);
    border: 1px solid var(--fm-line-soft);
    border-radius: 8px;
    color: var(--fm-ink-subtle);
    font-weight: 700;
    padding: 10px 12px;
  }

  .player-command-receipt__list {
    display: grid;
    gap: 8px;
  }

  .player-command-receipt__item {
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-soft);
    border-radius: 8px;
    display: grid;
    gap: 8px;
    padding: 10px 12px;
  }

  .player-command-receipt__item strong {
    color: var(--fm-ink);
    font-size: 13px;
    overflow-wrap: anywhere;
    text-transform: capitalize;
  }

  .player-command-receipt__status {
    margin: 0;
  }
</style>
