<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import AppStatus from "$lib/app/AppStatus.svelte";
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
    {#if data.audit.spineCycles?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-spine-cycles"
      >
        <h2>Core loop cycles</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.spineCycles as cycle}
            <li
              class="admin-audit-detail__entry admin-audit-detail__entry--stack"
              data-testid={`admin-audit-spine-cycle-${cycle.id}`}
            >
              <strong>{cycle.label}</strong>
              <span>{cycle.game}</span>
              <span>{cycle.status}</span>
              {#if cycle.roleUrls?.length > 0}
                <ol class="admin-audit-detail__subentries">
                  {#each cycle.roleUrls as roleUrl}
                    <li>
                      <a
                        data-testid={`admin-audit-spine-role-url-${cycle.id}-${roleUrl.id}`}
                        data-min-touch-target-px="44"
                        href={roleUrl.href}
                      >
                        <strong>{roleUrl.label}</strong>
                        <span>{roleUrl.href}</span>
                      </a>
                    </li>
                  {/each}
                </ol>
              {/if}
              {#if cycle.checkpoints?.length > 0}
                <ol class="admin-audit-detail__subentries">
                  {#each cycle.checkpoints as checkpoint}
                    <li
                      data-testid={`admin-audit-spine-checkpoint-${cycle.id}-${checkpoint.id}`}
                    >
                      <strong>{checkpoint.label}</strong>
                      <span>{checkpoint.status}</span>
                    </li>
                  {/each}
                </ol>
              {/if}
            </li>
          {/each}
        </ol>
      </section>
    {/if}
    {#if data.audit.spineRecoveryHooks?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-spine-recovery-hooks"
      >
        <h2>Recovery hooks</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.spineRecoveryHooks as hook}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-spine-recovery-${hook.id}`}
            >
              <strong>{hook.label}</strong>
              <span>{hook.status}</span>
            </li>
          {/each}
        </ol>
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
    {#if data.audit.proofLaneCoverage?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-proof-lane-coverage"
      >
        <h2>Proof lane coverage</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.proofLaneCoverage as coverage}
            <li
              class="admin-audit-detail__entry admin-audit-detail__entry--stack"
              data-testid={`admin-audit-proof-lane-coverage-${coverage.id}`}
            >
              <strong>{coverage.label}</strong>
              <span>{coverage.status}</span>
              <span>{coverage.laneIds.join(", ")}</span>
            </li>
          {/each}
        </ol>
      </section>
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
    {#if data.audit.reconnectLanes?.length > 0}
      <section class="admin-audit-detail__group" data-testid="admin-audit-detail-reconnect-lanes">
        <h2>Reconnect recovery lanes</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.reconnectLanes as lane}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-reconnect-lane-${lane.id}`}
            >
              <strong>{lane.label}</strong>
              <span>{lane.status}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
    {#if data.audit.staleConflictLanes?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-stale-conflict-lanes"
      >
        <h2>Stale-client conflict lanes</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.staleConflictLanes as lane}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-stale-conflict-lane-${lane.id}`}
            >
              <strong>{lane.label}</strong>
              <span>{lane.status}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}
    {#if data.audit.hostedHandoffChecklist?.inputs?.length > 0 || data.audit.hostedHandoffChecklist?.blockedChecks?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-hosted-handoff-checklist"
      >
        <h2>Hosted handoff checklist</h2>
        <ol class="admin-audit-detail__entries">
          <li
            class="admin-audit-detail__entry admin-audit-detail__entry--stack"
            data-testid="admin-audit-hosted-handoff-summary"
          >
            <strong>{data.audit.hostedHandoffChecklist.status}</strong>
            <span>{data.audit.hostedHandoffChecklist.preflightStatus}</span>
            <span>{data.audit.hostedHandoffChecklist.command}</span>
            <span>{data.audit.hostedHandoffChecklist.proofTarget}</span>
          </li>
          {#each data.audit.hostedHandoffChecklist.inputs as input}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-hosted-handoff-input-${input.id}`}
            >
              <strong>{input.label}</strong>
              <span>{input.value}</span>
              <span>{input.required ? "required" : "optional"}</span>
            </li>
          {/each}
          {#each data.audit.hostedHandoffChecklist.blockedChecks as check}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-hosted-handoff-blocked-check-${check.id}`}
            >
              <strong>{check.id}</strong>
              <span>{check.status}</span>
              <span>{check.requiredEvidence}</span>
            </li>
          {/each}
        </ol>
      </section>
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
    {#if data.audit.realHostedEvidenceInputs?.length > 0}
      <section
        class="admin-audit-detail__group"
        data-testid="admin-audit-detail-real-hosted-evidence-inputs"
      >
        <h2>Real hosted evidence inputs</h2>
        <ol class="admin-audit-detail__entries">
          {#each data.audit.realHostedEvidenceInputs as input}
            <li
              class="admin-audit-detail__entry"
              data-testid={`admin-audit-real-hosted-evidence-input-${input.id}`}
            >
              <strong>{input.label}</strong>
              <span>{input.value}</span>
              <span>{input.required ? "required" : "optional"}</span>
            </li>
          {/each}
        </ol>
      </section>
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
