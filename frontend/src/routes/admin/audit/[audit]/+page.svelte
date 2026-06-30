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

  function prerequisiteRoleHref(prerequisite) {
    const roleUrl = String(prerequisite?.roleUrl ?? "");
    const game = String(data.audit?.artifactSummary?.game ?? "");
    return roleUrl.replace("<seeded-game>", encodeURIComponent(game));
  }
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
    {#if data.audit.localPrerequisites?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-local-prerequisites"
      >
        <h2>Local prerequisites before hosted work</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.localPrerequisites as prerequisite}
            <li
              class="admin-audit-detail__entry admin-audit-detail__entry--stack"
              data-testid={`admin-audit-local-prerequisite-${prerequisite.id}`}
            >
              <strong>{prerequisite.label}</strong>
              <span>{prerequisite.status}</span>
              <span>{prerequisite.command}</span>
              <span>{prerequisite.proofTarget}</span>
              <span>{prerequisite.evidence}</span>
              <span>{prerequisite.requiredEvidence}</span>
              <a
                data-testid={`admin-audit-local-prerequisite-role-url-${prerequisite.id}`}
                data-min-touch-target-px="44"
                href={prerequisiteRoleHref(prerequisite)}
              >
                {prerequisite.roleUrl}
              </a>
            </li>
          {/each}
        </ol>
      </section>
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
    {#if data.audit.sessions?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-sessions">
        {#each data.audit.sessions as session}
          <li
            class="admin-audit-detail__entry"
            data-testid={`admin-audit-session-${session.role}`}
          >
            <strong>{session.role}</strong>
            <span>{session.capabilities.join(", ")}</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if data.audit.unproven?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-unproven">
        {#each data.audit.unproven as item}
          <li
            class="admin-audit-detail__entry"
            data-testid={`admin-audit-unproven-${item.id}`}
          >
            <strong>{item.id}</strong>
            <span>{item.status}</span>
            <span>{item.requiredEvidence}</span>
          </li>
        {/each}
      </ol>
    {/if}
    {#if data.audit.relatedLinks?.length > 0}
      <ol class="admin-audit-detail__entries" data-testid="admin-audit-detail-related-links">
        {#each data.audit.relatedLinks as link}
          <li class="admin-audit-detail__entry">
            <a
              data-testid={`admin-audit-related-link-${link.id}`}
              data-min-touch-target-px="44"
              href={link.href}
            >
              <strong>{link.label}</strong>
              <span>{link.status}</span>
            </a>
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

  .admin-audit-detail__group {
    display: grid;
    gap: 10px;
  }

  .admin-audit-detail__group h2 {
    color: #18212d;
    font-size: 0.95rem;
    margin: 0;
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

  .admin-audit-detail__entry--stack {
    display: grid;
  }

  .admin-audit-detail__entry span {
    color: #455466;
  }

  .admin-audit-detail__entry a {
    color: inherit;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    min-block-size: 44px;
    text-decoration: none;
  }
</style>
