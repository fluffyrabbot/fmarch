<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    buildAdminAuditPanelViewModel,
  } from "$lib/components/admin/admin-surface-model.mjs";

  export let data;

  const surfaceTestId = "admin-audit-detail-surface";
  const statusTestId = "admin-audit-detail-status";
  const evidenceTestId = "admin-audit-detail-evidence";
  const backTestId = "admin-audit-detail-back";
  $: auditView = buildAdminAuditPanelViewModel({ audit: [data.audit] }).items[0];
</script>

<svelte:head>
  <title>{data.audit.label} audit</title>
</svelte:head>

<main
  class="fm-surface admin-audit-detail"
  data-testid={surfaceTestId}
  data-audit-id={data.audit.id}
>
  <AppSurfaceHeader header={data.surfaceHeader} />

  <section class="fm-panel admin-audit-detail__panel">
    <p class="admin-surface__boundary">
      <strong>{auditView.authority}</strong>
      <span>{auditView.boundary}</span>
    </p>
    <AppStatus
      status={auditView.statusView}
      testId={statusTestId}
      className="admin-surface__audit-status"
    />
    {#if data.audit.entries?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-entries">
        {#each data.audit.entries as entry}
          <li
            class="admin-audit-detail__entry"
            data-testid={`admin-audit-entry-${entry.eventKind}`}
          >
            <strong>{entry.eventKind}</strong>
            <span>{entry.principalUserId}</span>
            {#if entry.actorUserId}
              <span>{entry.actorUserId}</span>
            {/if}
          </li>
        {/each}
      </ol>
    {/if}
    {#if data.audit.checks?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-checks">
        {#each data.audit.checks as check}
          <li
            class="admin-audit-detail__entry"
            data-testid={`admin-audit-check-${check.id}`}
          >
            <strong>{check.id}</strong>
            <span>{check.status}</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if data.audit.scenarios?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-scenarios">
        {#each data.audit.scenarios as scenario}
          <li
            class="admin-audit-detail__entry"
            data-testid={`admin-audit-scenario-${scenario.id}`}
          >
            <strong>{scenario.title}</strong>
            <span>{scenario.status}</span>
            <span>{scenario.role}</span>
          </li>
        {/each}
      </ol>
    {/if}
    <a
      class="fm-touch-button fm-touch-button--secondary"
      data-testid={evidenceTestId}
      data-min-touch-target-px="44"
      href={auditView.href}
    >
      Machine evidence
    </a>
    <a
      class="fm-touch-button"
      data-testid={backTestId}
      data-min-touch-target-px="44"
      href={data.overviewHref}
    >
      Admin overview
    </a>
  </section>
</main>

<style>
  .admin-audit-detail__panel {
    display: grid;
    gap: 14px;
  }

  .admin-surface__boundary {
    display: grid;
    gap: 4px;
    overflow-wrap: anywhere;
  }

  .admin-surface__boundary strong {
    color: #18212d;
    font-size: 0.86rem;
  }

  .admin-surface__boundary span {
    color: #455466;
    font-size: 0.9rem;
  }

  .admin-audit-detail__entries {
    display: grid;
    gap: 10px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .admin-audit-detail__entry {
    border: 1px solid #d7e0ea;
    border-radius: 8px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-block-size: 44px;
    padding: 10px 12px;
  }

  .admin-audit-detail__entry strong {
    color: #18212d;
  }

  .admin-audit-detail__entry span {
    color: #455466;
  }
</style>
