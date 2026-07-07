<script>
  import {
    buildPlayerPrivateQueueViewModel,
  } from "./player-private-queue-model.mjs";

  export let boundary;
  export let items = [];
  export let expandedItems = {};
  export let onToggle = () => {};

  $: view = buildPlayerPrivateQueueViewModel({
    boundary,
    items,
    expandedItems,
  });
</script>

<section
  class={view.root.className}
  aria-label="Private queue"
  data-component={view.root.data.component}
  data-boundary-status={view.root.data.boundaryStatus}
>
  <header>
    <h2>{view.heading}</h2>
    <span data-testid="player-private-count">
      {view.boundary.count}
    </span>
  </header>
  <p
    class="player-private-queue__boundary"
    data-testid="player-private-boundary"
  >
    {view.boundary.detail}
  </p>
  {#if view.items.length === 0}
    <p data-testid="player-private-empty">
      {view.emptyMessage}
    </p>
  {:else}
    {#each view.items as item}
      <article
        class="player-private-queue__item"
        data-testid={`player-private-${item.id}`}
        data-kind={item.kind}
      >
        <h3>{item.label}</h3>
        <p>{item.value}</p>
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-testid={item.reviewTestId}
          data-min-touch-target-px={item.minTouchTargetPx}
          aria-expanded={item.ariaExpanded}
          aria-controls={item.detailTestId}
          on:click={() => onToggle(item)}
        >
          {item.reviewLabel}
        </button>
        {#if item.reviewHref}
          <a
            class="fm-touch-button"
            data-testid={item.reviewLinkTestId}
            data-min-touch-target-px={item.minTouchTargetPx}
            href={item.reviewHref}
          >
            {item.reviewLinkLabel}
          </a>
        {/if}
        {#if item.expanded}
          <p
            class="player-private-queue__detail"
            id={item.detailTestId}
            data-testid={item.detailTestId}
          >
            {item.detail}
          </p>
        {/if}
      </article>
    {/each}
  {/if}
</section>

<style>
  .player-private-queue {
    background: var(--fm-raised-veil);
    border: 1px solid var(--fm-line);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    padding: 14px;
  }

  .player-private-queue h2 {
    font-size: 18px;
  }

  .player-private-queue header {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .player-private-queue header span {
    align-items: center;
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    color: var(--fm-ink);
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    justify-content: center;
    min-block-size: 36px;
    min-inline-size: 36px;
    padding-inline: 10px;
  }

  .player-private-queue h3,
  .player-private-queue p {
    margin: 0;
  }

  .player-private-queue > p,
  .player-private-queue__item p {
    color: var(--fm-ink-subtle);
    line-height: 1.35;
  }

  .player-private-queue__boundary {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    padding: 10px 12px;
  }

  .player-private-queue__item {
    border-block-start: 1px solid var(--fm-line-soft);
    display: grid;
    gap: 6px;
    min-block-size: 44px;
    padding-block-start: 10px;
  }

  .player-private-queue__item .fm-touch-button {
    justify-self: start;
  }

  .player-private-queue__item > .fm-touch-button + .fm-touch-button {
    margin-block-start: 2px;
  }

  .player-private-queue__detail {
    background: var(--fm-wash-warm);
    border: 1px solid var(--fm-line-warm);
    border-radius: 8px;
    padding: 10px 12px;
  }
</style>
