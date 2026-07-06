<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import AppStatus from "$lib/app/AppStatus.svelte";
  import AdminAuditDescriptorRows from "$lib/components/admin/AdminAuditDescriptorRows.svelte";
  import {
    buildAdminAuditPanelViewModel,
  } from "$lib/components/admin/admin-surface-model.mjs";

  export let data;
  export let form;

  const surfaceTestId = "admin-audit-detail-surface";
  const statusTestId = "admin-audit-detail-status";
  const evidenceTestId = "admin-audit-detail-evidence";
  const backTestId = "admin-audit-detail-back";
  $: auditView = buildAdminAuditPanelViewModel({ audit: [data.audit] }).items[0];
  $: hostedHandoffRows = [
    ...(data.audit.hostedHandoffChecklistRows ?? []),
    ...(data.audit.hostedHandoffOperatorRows ?? []),
    ...(data.audit.hostedHandoffProgressionRows ?? []),
    ...(data.audit.hostedHandoffBlockedReceiptRows ?? []),
  ];
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
    {#if data.audit.spineCycleRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-spine-cycles"
      >
        <h2>Core loop cycles</h2>
        <AdminAuditDescriptorRows rows={data.audit.spineCycleRows} />
      </section>
    {/if}
    {#if data.audit.scenarioFamilyRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-scenario-families"
      >
        <h2>Core loop families</h2>
        <AdminAuditDescriptorRows rows={data.audit.scenarioFamilyRows} />
      </section>
    {/if}
    {#if data.audit.spineRecoveryHookRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-spine-recovery-hooks"
      >
        <h2>Recovery hooks</h2>
        <AdminAuditDescriptorRows rows={data.audit.spineRecoveryHookRows} />
      </section>
    {/if}
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
    {#if data.audit.accountControls}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-identity-account-controls"
      >
        <h2>Account lifecycle controls</h2>
        <div class="admin-audit-detail__controls">
          <form
            method="POST"
            action={data.audit.accountControls.disableAction}
            data-testid="admin-identity-account-disable-form"
          >
            <input
              type="hidden"
              name="accountId"
              value={data.audit.accountControls.accountId}
            />
            <input
              type="hidden"
              name="expectedDisabled"
              value={data.audit.accountControls.currentDisabled}
            />
            <button
              type="submit"
              class="fm-touch-button"
              data-min-touch-target-px="44"
              data-testid="admin-identity-account-disable-submit"
            >
              Disable account
            </button>
          </form>
          <form
            method="POST"
            action={data.audit.accountControls.enableAction}
            data-testid="admin-identity-account-enable-form"
          >
            <input
              type="hidden"
              name="accountId"
              value={data.audit.accountControls.accountId}
            />
            <input
              type="hidden"
              name="expectedDisabled"
              value={data.audit.accountControls.currentDisabled}
            />
            <button
              type="submit"
              class="fm-touch-button fm-touch-button--secondary"
              data-min-touch-target-px="44"
              data-testid="admin-identity-account-enable-submit"
            >
              Enable account
            </button>
          </form>
        </div>
        <p
          class="admin-audit-detail__entry"
          data-testid="admin-identity-account-control-target"
        >
          <strong>{data.audit.accountControls.accountId}</strong>
          <span>{data.audit.accountControls.principalUserId}</span>
          <span>{data.audit.accountControls.currentDisabled ? "disabled" : "enabled"}</span>
        </p>
        {#if form?.id === "account-disable" || form?.id === "account-enable"}
          <AppStatus
            status={form}
            testId={`admin-identity-${form.id}-status`}
            className="admin-surface__audit-status"
          />
        {/if}
      </section>
    {/if}
    {#if data.audit.checksRows?.length > 0}
      <AdminAuditDescriptorRows
        rows={data.audit.checksRows}
        listTestId="admin-audit-detail-checks"
      />
    {/if}
    {#if data.audit.batchRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-admin-spine-batches"
      >
        <h2>Admin spine batches</h2>
        <AdminAuditDescriptorRows rows={data.audit.batchRows} />
      </section>
    {/if}
    {#if data.audit.terminalValidationRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-admin-spine-terminal-validations"
      >
        <h2>Admin spine terminal validations</h2>
        <AdminAuditDescriptorRows rows={data.audit.terminalValidationRows} />
      </section>
    {/if}
    {#if data.audit.localPrerequisiteRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-local-prerequisites"
      >
        <h2>Local prerequisites before hosted work</h2>
        <AdminAuditDescriptorRows rows={data.audit.localPrerequisiteRows} />
      </section>
    {/if}
    {#if data.audit.scenarioRows?.length > 0}
      <AdminAuditDescriptorRows
        rows={data.audit.scenarioRows}
        listTestId="admin-audit-detail-scenarios"
      />
    {/if}
    {#if data.audit.proofLaneCoverageRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-proof-lane-coverage"
      >
        <h2>Proof lane coverage</h2>
        <AdminAuditDescriptorRows rows={data.audit.proofLaneCoverageRows} />
      </section>
    {/if}
    {#if data.audit.productionFeatureDestinationSections?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-production-feature-destination-summary"
      >
        <h2>Production feature destinations</h2>
        {#each data.audit.productionFeatureDestinationSections as section}
          <section
            class="admin-audit-detail__subgroup"
            data-testid={section.testId}
          >
            <h3>{section.heading}</h3>
            <AdminAuditDescriptorRows rows={section.rows} />
          </section>
        {/each}
      </section>
    {/if}
    {#if data.audit.sessionsRows?.length > 0}
      <AdminAuditDescriptorRows
        rows={data.audit.sessionsRows}
        listTestId="admin-audit-detail-sessions"
      />
    {/if}
    {#if data.audit.reconnectLaneRows?.length > 0}
      <section class="admin-audit-detail__group" data-testid="admin-audit-detail-reconnect-lanes">
        <h2>Reconnect recovery lanes</h2>
        <AdminAuditDescriptorRows rows={data.audit.reconnectLaneRows} />
      </section>
    {/if}
    {#if data.audit.staleConflictLaneRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-stale-conflict-lanes"
      >
        <h2>Stale-client conflict lanes</h2>
        <AdminAuditDescriptorRows rows={data.audit.staleConflictLaneRows} />
      </section>
    {/if}
    {#if data.audit.handoffPathRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-handoff-path"
      >
        <h2>Handoff path</h2>
        <AdminAuditDescriptorRows rows={data.audit.handoffPathRows} />
      </section>
    {/if}
    {#if data.audit.artifactSummarySections?.length > 0}
      {#each data.audit.artifactSummarySections as section}
        <section class="admin-audit-detail__group" data-testid={section.testId}>
          <h2>{section.heading}</h2>
          <AdminAuditDescriptorRows rows={section.rows} />
        </section>
      {/each}
    {/if}
    {#if data.audit.selectedOperatorHandoffRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-selected-operator-handoff"
      >
        <h2>Selected operator handoff</h2>
        <AdminAuditDescriptorRows rows={data.audit.selectedOperatorHandoffRows} />
      </section>
    {/if}
    {#if hostedHandoffRows.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-hosted-handoff-checklist"
      >
        <h2>Hosted handoff checklist</h2>
        <AdminAuditDescriptorRows rows={hostedHandoffRows} />
      </section>
    {/if}
    {#if data.audit.unprovenRows?.length > 0}
      <AdminAuditDescriptorRows
        rows={data.audit.unprovenRows}
        listTestId="admin-audit-detail-unproven"
      />
    {/if}
    {#if data.audit.setupCommandEvidenceRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-setup-command-evidence"
      >
        <h2>Setup command evidence</h2>
        <AdminAuditDescriptorRows rows={data.audit.setupCommandEvidenceRows} />
      </section>
    {/if}
    {#if data.audit.realHostedEvidenceInputRows?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-real-hosted-evidence-inputs"
      >
        <h2>Real hosted evidence inputs</h2>
        <AdminAuditDescriptorRows rows={data.audit.realHostedEvidenceInputRows} />
      </section>
    {/if}
    {#if data.audit.relatedLinkRows?.length > 0}
      <AdminAuditDescriptorRows
        rows={data.audit.relatedLinkRows}
        listTestId="admin-audit-detail-related-links"
      />
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

  .admin-audit-detail__subgroup {
    display: grid;
    gap: 8px;
  }

  .admin-audit-detail__group h2 {
    color: #18212d;
    font-size: 0.95rem;
    margin: 0;
  }

  .admin-audit-detail__subgroup h3 {
    color: #334155;
    font-size: 0.88rem;
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

  .admin-audit-detail__entry h3 {
    color: #334155;
    font-size: 0.88rem;
    margin: 0;
  }

  .admin-audit-detail__entry h4 {
    color: #455466;
    font-size: 0.82rem;
    margin: 0;
  }

  .admin-audit-detail__entry--stack {
    display: grid;
  }

  .admin-audit-detail__subentries {
    display: grid;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .admin-audit-detail__subentries li {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-block-size: 44px;
  }

  .admin-audit-detail__subentries a {
    align-items: center;
    color: inherit;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    min-block-size: 44px;
    text-decoration: none;
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

  .admin-audit-detail__controls {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
</style>
