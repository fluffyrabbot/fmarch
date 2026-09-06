<script>
  import {
    buildPlayerPrivateQueueViewModel,
  } from "./player-private-queue-model.mjs";

  export let boundary;
  export let items = [];
  export let expandedItems = {};
  export let attention = { state: "unavailable", reviewedIds: [] };
  export let pending = false;
  export let message = "";
  export let onRetry = () => {};
  export let onReview = () => {};
  export let onToggle = () => {};
  export let filter = "all";
  export let onFilter = () => {};
  $: visibleItems = attention.state !== "ready" || filter === "all" ? view.items
    : view.items.filter(item => reviewed.has(item.id) === (filter === "reviewed"));

  $: reviewed = new Set(attention.reviewedIds);

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
  <header class="fm-ledger__head">
    <h2>{view.heading}</h2>
    {#if attention.state === "ready" && view.items.length > 0}
      <select id="private-attention-filter" class="private-filter" aria-label="Filter private queue" data-testid="private-attention-filter" value={filter} on:change={event => onFilter(event.currentTarget.value)}>
        <option value="all">All ({view.items.length})</option>
        <option value="new">New ({view.items.filter(item => !reviewed.has(item.id)).length})</option>
        <option value="reviewed">Reviewed ({view.items.filter(item => reviewed.has(item.id)).length})</option>
      </select>
    {/if}
    <span class="fm-count" data-testid="player-private-count">
      {view.boundary.count}
    </span>
  </header>
  <p
    class="fm-well"
    data-testid="player-private-boundary"
  >
    {view.boundary.detail}
  </p>
  {#if view.items.length > 0}
    {#if message}<p role="status">{message}</p>{/if}
    {#if attention.state !== "ready"}
      <p>Review status is unavailable.</p>
      <button type="button" class="fm-touch-button fm-touch-button--secondary" disabled={pending} on:click={onRetry}>Retry review status</button>

    {/if}
  {/if}
  {#if view.items.length === 0}
    <p data-testid="player-private-empty">
      {view.emptyMessage}
    </p>
  {:else}
    {#if visibleItems.length === 0}<p role="status" data-testid="private-filter-empty">{filter === "new" ? "No new private items." : "No reviewed private items."}</p>{/if}
    {#each visibleItems as item (item.id)}
      <article
        class="player-private-queue__item fm-disclosure"
        id={`private-item-${item.id}`}
        tabindex="-1"
        data-testid={`player-private-${item.id}`}
        data-kind={item.kind}
      >
        <div class="private-item-heading">
          <h3>{item.label}</h3>
          {#if attention.state === "ready"}
            <span data-testid={`private-attention-${item.id}`}>{reviewed.has(item.id) ? "Reviewed" : "New"}</span>
          {/if}
        </div>
        <p>{item.value}</p>
        <div class="private-item-actions">
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-testid={item.reviewTestId}
          data-min-touch-target-px={item.minTouchTargetPx}
          aria-label={item.reviewAriaLabel}
          aria-expanded={item.ariaExpanded}
          aria-controls={item.detailTestId}
          on:click={() => onToggle(item)}
        >
          {item.reviewLabel}
        </button>
        {#if attention.state === "ready" && !reviewed.has(item.id)}
          <button type="button" class="fm-touch-button fm-touch-button--secondary" data-testid={`private-mark-reviewed-${item.id}`} disabled={pending} on:click={() => onReview(item)}>Mark reviewed</button>
        {/if}
        </div>
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
            class="fm-well fm-well--warm"
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
  .private-item-heading { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .private-item-heading > span { color: var(--fm-ink-subtle); font-size: 12px; white-space: nowrap; }
  .private-filter { margin-inline-start: auto; min-height: 44px; max-width: 130px; font: inherit; color: inherit; background: var(--fm-paper); border: 1px solid var(--fm-rule); border-radius: 4px; }
  .private-item-actions { display: flex; flex-wrap: wrap; gap: 8px; }

  .player-private-queue h2 {
    font-size: 18px;
  }

  .player-private-queue > p {
    color: var(--fm-ink-subtle);
    line-height: 1.35;
    margin: 0;
  }
</style>
