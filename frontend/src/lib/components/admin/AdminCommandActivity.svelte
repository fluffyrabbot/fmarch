<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    buildAdminCommandActivityViewModel,
  } from "./admin-surface-model.mjs";

  export let commandStatuses = {};

  $: view = buildAdminCommandActivityViewModel({ commandStatuses });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-testid="admin-command-activity"
>
  <header class="fm-ledger__head">
    <div>
      <p class="fm-eyebrow">Operator ops</p>
      <h2>{view.heading}</h2>
    </div>
    <span class="fm-ledger__count" data-testid="admin-command-activity-count">
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
          data-confirmation-trace-kind={item.confirmationTrace?.kind}
          data-confirmation-surface={item.confirmationTrace?.surface}
          data-confirmation-action-id={item.confirmationTrace?.actionId}
          data-confirmation-status-key={item.confirmationTrace?.statusKey}
          data-confirmation-dispatch-kind={item.confirmationTrace?.dispatchKind}
          data-protocol-message={item.rawMessage}
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
