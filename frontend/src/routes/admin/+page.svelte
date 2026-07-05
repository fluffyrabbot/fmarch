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

  export let data;
  export let form;

  let commandStatuses = {};
  let lastFormStatusKey = "";

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
    if (typeof window !== "undefined") {
      exposeAdminFormResult({ windowRef: window, form });
    }
  }

  function handleRecoveryTask(item) {
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
    commandStatuses = clearAdminCommandStatus(commandStatuses, item.id);
  }

  async function submitAdminSetupCommand(item) {
    const confirmationStatus =
      commandStatuses[item.id]?.confirmationTrace == null
        ? null
        : commandStatuses[item.id];
    const optimisticStatus = adminPendingStatus();
    commandStatuses = recordAdminCommandStatus(
      commandStatuses,
      item.id,
      optimisticStatus,
    );

    try {
      const result = await sendAdminSetupCommand({
        item,
        data,
        fetchImpl: fetch,
      });
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
      const finalStatus = adminRejectStatus(error);
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

  {#if adminForcedRouteState}
    <RouteState view={adminForcedRouteState} />
  {:else if adminSurfaceEmpty}
    <RouteState view={adminEmptyState} />
  {:else}
    <AdminReadinessStrip
      operator={data.operator}
      gameSetup={data.gameSetup}
      audit={data.audit}
      recoveryTasks={data.recoveryTasks}
    />

    <section
      class={ADMIN_SURFACE_CONTRACT.operatorRailClassName}
      aria-label="Admin operator actions"
      data-control-rail-mode={ADMIN_SURFACE_CONTRACT.operatorRailMode}
      data-sticky-top-px={ADMIN_SURFACE_CONTRACT.operatorRailStickyTopPx}
      data-unstick-below-px={ADMIN_SURFACE_CONTRACT.operatorRailUnstickBelowPx}
      data-testid="admin-operator-action-rail"
    >
      <AdminSetupGrid
        items={data.gameSetup}
        {commandStatuses}
        sessionGrant={data.command.sessionGrant}
        onSetupAction={handleSetupAction}
        onConfirmSetupAction={confirmSetupAction}
        onCancelSetupAction={cancelSetupAction}
      />

      <AdminRecoveryPanel
        tasks={data.recoveryTasks}
        {commandStatuses}
        game={data.shell.game}
        principalUserId={data.operator.principalUserId}
        onRecoveryTask={handleRecoveryTask}
        onCancelRecoveryTask={cancelSetupAction}
      />
    </section>

    <AdminCommandActivity {commandStatuses} />

    <section class="admin-surface__split">
      <div class="admin-surface__audit-stack">
        <AdminAuditPanel audit={data.audit} />
      </div>

      <AdminEscalationPanel escalations={data.escalations} />
    </section>
  {/if}
</main>

<style>
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
    max-block-size: calc(
      100svh - var(--fm-app-topbar-block-size) - var(--fm-app-sticky-rail-gap) -
        env(safe-area-inset-top) - env(safe-area-inset-bottom)
    );
    overflow: auto;
    overscroll-behavior: contain;
    position: sticky;
    top: calc(
      var(--fm-app-topbar-block-size) + var(--fm-app-sticky-rail-gap) +
        env(safe-area-inset-top)
    );
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
    .admin-surface__operator-actions {
      max-block-size: none;
      overflow: visible;
      position: static;
    }
  }
</style>
