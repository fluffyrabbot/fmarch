<script>
  import AdminAuditCard from "./AdminAuditCard.svelte";
  import {
    buildAdminAuditPanelViewModel,
  } from "./admin-surface-model.mjs";

  export let audit = [];

  $: view = buildAdminAuditPanelViewModel({ audit });
</script>

<section class={view.root.className} aria-label={view.root.ariaLabel}>
  {#if view.attentionItems.length > 0}
    <div class="admin-audit-panel__attention">
      {#each view.attentionItems as item}
        <AdminAuditCard {item} />
      {/each}
    </div>
  {:else}
    <p class="admin-audit-panel__all-current">{view.allCurrentMessage}</p>
  {/if}

  {#if view.healthyItems.length > 0}
    <details
      class="admin-audit-panel__current"
      data-testid={view.healthyDisclosure.testId}
    >
      <summary>
        <span>{view.healthyDisclosure.label}</span>
        <small>{view.healthyDisclosure.summary}</small>
      </summary>
      <div class="admin-audit-panel__current-grid">
        {#each view.healthyItems as item}
          <AdminAuditCard {item} />
        {/each}
      </div>
    </details>
  {/if}
</section>

<style>
  .admin-audit-panel,
  .admin-audit-panel__attention,
  .admin-audit-panel__current-grid {
    display: grid;
    gap: 18px;
  }

  .admin-audit-panel__all-current {
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent-soft);
    border-radius: 8px;
    color: var(--fm-accent-ink);
    font-weight: 800;
    margin: 0;
    padding: 14px 16px;
  }

  .admin-audit-panel__current {
    border-block-start: 1px solid var(--fm-line-strong);
  }

  .admin-audit-panel__current > summary {
    align-items: center;
    cursor: pointer;
    display: flex;
    gap: 16px;
    justify-content: space-between;
    min-block-size: 52px;
  }

  .admin-audit-panel__current > summary span {
    color: var(--fm-ink);
    font-family: var(--fm-font-display);
    font-size: 20px;
    font-weight: 700;
  }

  .admin-audit-panel__current > summary small {
    color: var(--fm-ink-muted);
    text-align: end;
  }

  .admin-audit-panel__current[open] {
    padding-block-end: 8px;
  }

  @media (max-width: 760px) {
    .admin-audit-panel__current > summary {
      align-items: start;
      display: grid;
      gap: 2px;
      padding-block: 8px;
    }

    .admin-audit-panel__current > summary small {
      text-align: start;
    }
  }
</style>
