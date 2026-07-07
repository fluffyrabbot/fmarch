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
  <header class="fm-ledger__head">
    <div>
      <p class="fm-eyebrow">Player ops</p>
      <h2>{view.heading}</h2>
    </div>
    <span class="fm-ledger__count" data-testid="player-command-receipt-count">
      {view.items.length}
    </span>
  </header>
  <p class="fm-ledger__summary">{view.summary}</p>
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
            className="fm-ledger__status"
          />
        </article>
      {/each}
    </div>
  {/if}
</section>
