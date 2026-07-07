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
  <header>
    <div>
      <p class="fm-eyebrow">Operator ops</p>
      <h2>{view.heading}</h2>
    </div>
    <span data-testid="admin-command-activity-count">
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
          data-confirmation-trace-kind={item.confirmationTrace?.kind}
          data-confirmation-surface={item.confirmationTrace?.surface}
          data-confirmation-action-id={item.confirmationTrace?.actionId}
          data-confirmation-status-key={item.confirmationTrace?.statusKey}
          data-confirmation-dispatch-kind={item.confirmationTrace?.dispatchKind}
        >
          <strong>{item.label}</strong>
          <AppStatus
            status={{ state: item.state, message: item.message }}
            testId={item.statusTestId}
            className="admin-command-activity__status"
          />
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .admin-command-activity {
    background: var(--fm-surface-cool);
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    display: grid;
    gap: 10px;
    padding: 14px;
  }

  .admin-command-activity header {
    align-items: center;
    display: flex;
    gap: 12px;
    justify-content: space-between;
  }

  .admin-command-activity header h2,
  .admin-command-activity header p,
  .admin-command-activity > p {
    margin: 0;
  }

  .admin-command-activity header span {
    align-items: center;
    background: var(--fm-ink);
    border-radius: 999px;
    color: var(--fm-on-dark);
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    inline-size: 36px;
    justify-content: center;
    min-block-size: 36px;
  }

  .admin-command-activity > p {
    color: var(--fm-ink-muted);
    font-size: 14px;
    line-height: 1.4;
  }

  .admin-command-activity__empty {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-cool);
    border-radius: 8px;
    color: var(--fm-ink-muted);
    font-weight: 700;
    padding: 10px 12px;
  }

  .admin-command-activity__list {
    display: grid;
    gap: 8px;
  }

  .admin-command-activity__item {
    align-items: start;
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-cool);
    border-radius: 8px;
    display: grid;
    gap: 8px;
    grid-template-columns: minmax(140px, 0.55fr) minmax(0, 1fr);
    padding: 10px 12px;
  }

  .admin-command-activity__item strong {
    color: var(--fm-ink);
    font-size: 13px;
    overflow-wrap: anywhere;
    text-transform: capitalize;
  }

  .admin-command-activity__status {
    margin: 0;
  }

  @media (max-width: 760px) {
    .admin-command-activity__item {
      grid-template-columns: 1fr;
    }
  }
</style>
