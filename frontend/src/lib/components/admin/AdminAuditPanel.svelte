<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    buildAdminAuditPanelViewModel,
  } from "./admin-surface-model.mjs";

  export let audit = [];

  $: view = buildAdminAuditPanelViewModel({ audit });
</script>

<div class={view.root.className} aria-label={view.root.ariaLabel}>
  {#each view.items as item}
    <article class="fm-panel" data-testid={item.testId}>
      <h2>{item.label}</h2>
      <p
        class="admin-surface__boundary"
        data-testid={item.boundaryTestId}
      >
        <strong>{item.authority}</strong>
        <span>{item.boundary}</span>
      </p>
      <p
        class="admin-surface__evidence"
        data-testid={item.evidenceTestId}
      >
        {item.boundaryDetail}
      </p>
      <AppStatus
        status={item.statusView}
        testId={item.statusTestId}
        className="admin-surface__audit-status"
      />
      <a
        class="fm-touch-button fm-touch-button--secondary"
        data-min-touch-target-px={item.minTouchTargetPx}
        data-testid={item.linkTestId}
        href={item.inspectHref}
      >
        {item.buttonLabel}
      </a>
    </article>
  {/each}
</div>

<style>
  .admin-surface__boundary,
  .admin-surface__evidence {
    overflow-wrap: anywhere;
  }

  .admin-surface__boundary {
    display: grid;
    gap: 4px;
    margin: 10px 0 0;
  }

  .admin-surface__boundary strong {
    color: #18212d;
    font-size: 0.82rem;
  }

  .admin-surface__boundary span,
  .admin-surface__evidence {
    color: #455466;
    font-size: 0.86rem;
  }

  .admin-surface__evidence {
    margin: 6px 0 0;
  }
</style>
