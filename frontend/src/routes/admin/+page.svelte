<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import {
    buildRouteStateViewModel,
    isAdminRouteEmpty,
  } from "$lib/app/app-route-state-model.mjs";
  import AdminAuditPanel from "$lib/components/admin/AdminAuditPanel.svelte";
  import AdminCommandActivity from "$lib/components/admin/AdminCommandActivity.svelte";
  import AdminEscalationPanel from "$lib/components/admin/AdminEscalationPanel.svelte";
  import AdminReadinessStrip from "$lib/components/admin/AdminReadinessStrip.svelte";
  import AdminRecoveryPanel from "$lib/components/admin/AdminRecoveryPanel.svelte";
  import AdminSetupGrid from "$lib/components/admin/AdminSetupGrid.svelte";
  import {
    adminConfirmStatus,
    adminPendingStatus,
    adminInterruptedStatus,
    adminReadOnlyStatus,
    adminRejectStatus,
    adminSetupActionMode,
    buildAdminCommandDispatchBridgePlan,
    clearAdminCommandStatus,
    exposeAdminCommandDispatchBridgePlan,
    exposeAdminCommandOutcome,
    exposeAdminFormResult,
    recordAdminCommandStatus,
    recordAdminFormStatus,
    sendAdminSetupCommand,
  } from "./admin-route-controller.mjs";
  import { ADMIN_SURFACE_CONTRACT } from "$lib/components/admin/admin-surface-model.mjs";
  import { ADMIN_ROUTE_CONTRACT } from "./admin-route-contract.mjs";
  import {
    commandAttemptId,
    commandAttemptTimeoutMs,
    executeCommandAttempt,
  } from "$lib/app/command-interruption.mjs";

  export let data;
  export let form;

  let commandStatuses = {};
  let lastFormStatusKey = "";
  let recoveryWorkflowOpen = false;
  let commandRecoveryAttempts = {};

  $: adminSurfaceEmpty = isAdminRouteEmpty(data);
  $: adminForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
  $: adminEmptyState = buildRouteStateViewModel({
    surface: "admin",
    state: "empty",
  });

  $: if (form?.id && `${form.id}:${form.state}:${form.message}` !== lastFormStatusKey) {
    const result = recordAdminFormStatus({
      commandStatuses,
      form,
      lastFormStatusKey,
    });
    lastFormStatusKey = result.lastFormStatusKey;
    commandStatuses = result.commandStatuses;
    if (form.id === "recovery-gate") {
      recoveryWorkflowOpen = true;
    }
    if (typeof window !== "undefined") {
      exposeAdminFormResult({ windowRef: window, form });
    }
  }

  function handleRecoveryTask(item) {
    recoveryWorkflowOpen = true;
    commandStatuses = recordAdminCommandStatus(
      commandStatuses,
      item.id,
      adminConfirmStatus(item),
    );
  }

  async function handleSetupAction(item) {
    const mode = adminSetupActionMode(item);
    if (mode === "confirm") {
      commandStatuses = recordAdminCommandStatus(
        commandStatuses,
        item.id,
        adminConfirmStatus(item),
      );
      return;
    }

    if (mode === "readonly") {
      commandStatuses = recordAdminCommandStatus(
        commandStatuses,
        item.id,
        adminReadOnlyStatus(item),
      );
      return;
    }

    await submitAdminSetupCommand(item);
  }

  async function confirmSetupAction(item) {
    await submitAdminSetupCommand(item);
  }

  function cancelSetupAction(item) {
    const nextAttempts = { ...commandRecoveryAttempts };
    delete nextAttempts[item.id];
    commandRecoveryAttempts = nextAttempts;
    commandStatuses = clearAdminCommandStatus(commandStatuses, item.id);
  }

  async function retrySetupAction(item) {
    const attempt = commandRecoveryAttempts[item.id];
    if (attempt !== undefined) {
      await submitAdminSetupCommand(item, { attempt });
    }
  }

  async function submitAdminSetupCommand(item, { attempt: recoveredAttempt } = {}) {
    if (commandStatuses[item.id]?.state === "pending") {
      return;
    }
    const confirmationStatus = recoveredAttempt?.confirmationStatus ??
      (commandStatuses[item.id]?.confirmationTrace == null
        ? null
        : commandStatuses[item.id]);
    const attempt = recoveredAttempt ?? Object.freeze({
      commandId: commandAttemptId(),
      confirmationStatus,
    });
    const optimisticStatus = adminPendingStatus();
    commandStatuses = recordAdminCommandStatus(
      commandStatuses,
      item.id,
      optimisticStatus,
    );

    try {
      const result = await executeCommandAttempt({
        timeoutMs: commandAttemptTimeoutMs(
          typeof window === "undefined" ? null : window,
        ),
        operation: ({ signal }) => sendAdminSetupCommand({
          item,
          data,
          fetchImpl: fetch,
          commandIdFactory: () => attempt.commandId,
          signal,
        }),
      });
      const nextAttempts = { ...commandRecoveryAttempts };
      delete nextAttempts[item.id];
      commandRecoveryAttempts = nextAttempts;
      commandStatuses = recordAdminCommandStatus(
        commandStatuses,
        item.id,
        result.outcome,
      );
      if (typeof window !== "undefined") {
        if (confirmationStatus !== null) {
          exposeAdminCommandDispatchBridgePlan({
            windowRef: window,
            plan: buildAdminCommandDispatchBridgePlan({
              item,
              data,
              confirmationStatus,
              optimisticStatus,
              finalStatus: result.outcome,
            }),
          });
        }
        exposeAdminCommandOutcome({
          windowRef: window,
          commandStatuses,
          outcome: result.outcome,
        });
      }
    } catch (error) {
      const interruptedStatus = confirmationStatus === null
        ? null
        : adminInterruptedStatus(error, {
            item,
            commandId: attempt.commandId,
            confirmationStatus,
          });
      const finalStatus = interruptedStatus ?? adminRejectStatus(error);
      if (interruptedStatus !== null) {
        commandRecoveryAttempts = {
          ...commandRecoveryAttempts,
          [item.id]: attempt,
        };
      } else {
        const nextAttempts = { ...commandRecoveryAttempts };
        delete nextAttempts[item.id];
        commandRecoveryAttempts = nextAttempts;
      }
      commandStatuses = recordAdminCommandStatus(
        commandStatuses,
        item.id,
        finalStatus,
      );
      if (typeof window !== "undefined" && confirmationStatus !== null) {
        exposeAdminCommandDispatchBridgePlan({
          windowRef: window,
          plan: buildAdminCommandDispatchBridgePlan({
            item,
            data,
            confirmationStatus,
            optimisticStatus,
            finalStatus,
          }),
        });
      }
    }
  }
</script>

<svelte:head>
  <title>fmarch admin</title>
</svelte:head>

<main class="fm-surface admin-surface" data-testid={ADMIN_ROUTE_CONTRACT.surfaceTestId}>
  <AppSurfaceHeader header={data.surfaceHeader} />

  {#if data.gameSelection?.options?.length > 0}
    <form method="GET" class="admin-game-picker fm-panel" data-testid="admin-game-picker">
      <label class="fm-field" for="admin-game-picker-select">
        <span>Game workspace</span>
        <select id="admin-game-picker-select" name="game" data-testid="admin-game-picker-select">
          {#each data.gameSelection.options as game}
            <option value={game.id} selected={game.selected}>{game.label}</option>
          {/each}
        </select>
      </label>
      <button class="fm-touch-button fm-touch-button--secondary" type="submit">Open game</button>
    </form>
  {/if}

  {#if adminForcedRouteState}
    <RouteState view={adminForcedRouteState} />
  {:else if adminSurfaceEmpty}
    <RouteState view={adminEmptyState} />
  {:else}
    <section class="admin-surface__section" aria-labelledby="admin-next-actions-heading">
      <header class="admin-surface__section-heading">
        <div>
          <p class="fm-eyebrow">Needs attention</p>
          <h2 id="admin-next-actions-heading">Administrator actions</h2>
        </div>
        <p>Start with game setup, access, or recovery work.</p>
      </header>

      <section
        class={ADMIN_SURFACE_CONTRACT.operatorRailClassName}
        aria-label="Admin operator actions"
        data-control-rail-mode={ADMIN_SURFACE_CONTRACT.operatorRailMode}
        data-testid="admin-operator-action-rail"
      >
        <AdminSetupGrid
          items={data.gameSetup}
          {commandStatuses}
          sessionGrant={data.command.sessionGrant}
          onSetupAction={handleSetupAction}
          onConfirmSetupAction={confirmSetupAction}
          onCancelSetupAction={cancelSetupAction}
          onRetrySetupAction={retrySetupAction}
        />

      </section>

      <details
        class="fm-surface-drawer"
        data-testid="admin-recovery-workflow"
        bind:open={recoveryWorkflowOpen}
      >
        <summary>
          <span class="fm-surface-drawer__label">
            <strong>Recovery workflow</strong>
            <small>Run operator recovery checks when routine setup is not enough</small>
          </span>
        </summary>
        <div class="fm-surface-drawer__body">
          <AdminRecoveryPanel
            tasks={data.recoveryTasks}
            {commandStatuses}
            game={data.shell.game}
            principalUserId={data.operator.principalUserId}
            onRecoveryTask={handleRecoveryTask}
            onCancelRecoveryTask={cancelSetupAction}
          />
        </div>
      </details>

      <AdminCommandActivity {commandStatuses} />
    </section>

    <details class="fm-surface-drawer" data-testid="admin-status-overview">
      <summary>
        <span class="fm-surface-drawer__label">
          <strong>Admin snapshot</strong>
          <small>Access, available actions, system checks, and recovery posture</small>
        </span>
      </summary>
      <div class="fm-surface-drawer__body">
        <AdminReadinessStrip
          operator={data.operator}
          gameSetup={data.gameSetup}
          audit={data.audit}
          recoveryTasks={data.recoveryTasks}
        />
      </div>
    </details>

    <details class="fm-surface-drawer" data-testid="admin-supporting-evidence">
      <summary>
        <span class="fm-surface-drawer__label">
          <strong>System checks</strong>
          <small>Inspect evidence and escalation queues when an action needs diagnosis</small>
        </span>
      </summary>
      <div class="fm-surface-drawer__body">
        <section class="admin-surface__split">
          <div class="admin-surface__audit-stack">
            <AdminAuditPanel audit={data.audit} />
          </div>

          <AdminEscalationPanel escalations={data.escalations} />
        </section>
      </div>
    </details>
  {/if}
</main>

<style>
  .admin-game-picker {
    align-items: end;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .admin-game-picker select {
    min-block-size: var(--fm-touch-target);
    width: 100%;
  }

  .admin-surface__section {
    display: grid;
    gap: 18px;
  }

  .admin-surface__section-heading {
    align-items: end;
    border-block-end: 1px solid var(--fm-line);
    display: flex;
    gap: 24px;
    justify-content: space-between;
    padding-block-end: 12px;
  }

  .admin-surface__section-heading > p {
    color: var(--fm-ink-muted);
    margin: 0;
    max-inline-size: 34rem;
    text-align: end;
  }

  .admin-surface__split {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr);
  }

  .admin-surface__operator-actions {
    align-self: start;
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(0, 1.45fr) minmax(260px, 0.55fr);
    overflow: visible;
    position: static;
  }

  .admin-surface__audit-stack {
    display: grid;
    gap: 18px;
  }

  @media (max-width: 1024px) {
    .admin-surface__split {
      grid-template-columns: 1fr;
    }

    .admin-surface__operator-actions {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 760px) {
    .admin-game-picker {
      align-items: stretch;
      grid-template-columns: 1fr;
    }

    .admin-surface__section-heading {
      align-items: start;
      display: grid;
      gap: 4px;
    }

    .admin-surface__section-heading > p {
      text-align: start;
    }
  }

</style>
