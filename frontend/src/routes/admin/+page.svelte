<script>
  import { goto } from "$app/navigation";
  import { page } from "$app/stores";
  import { tick } from "svelte";
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
  import { ADMIN_ROUTE_CONTRACT } from "./admin-route-contract.mjs";
  import {
    adjacentAdminInboxTaskId,
    adminInboxTaskHref,
    adminInboxTaskId,
    buildAdminOperatorInbox,
  } from "./admin-operator-inbox.mjs";
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
  $: operatorInbox = buildAdminOperatorInbox({
    gameSetup: data.gameSetup,
    audit: data.audit,
    recoveryTasks: data.recoveryTasks,
    commandStatuses,
    selectedTaskId: adminInboxTaskId($page.url),
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

  async function selectAdminTask(taskId, { focus = "canvas", replaceState = false } = {}) {
    await goto(adminInboxTaskHref({ url: $page.url, taskId }), {
      keepFocus: true,
      noScroll: true,
      replaceState,
    });
    await tick();
    const targetTestId = focus === "task"
      ? operatorInbox.selectedTask?.testId
      : operatorInbox.selectedTask?.panelTestId;
    document.getElementById(targetTestId)?.focus({ preventScroll: true });
  }

  function activateAdminTask(event, taskId) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void selectAdminTask(taskId);
  }

  function handleAdminTaskKeydown(event, taskId) {
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      void selectAdminTask(taskId);
      return;
    }
    const nextTaskId = adjacentAdminInboxTaskId({
      tasks: operatorInbox.tasks,
      selectedTaskId: taskId,
      key: event.key,
    });
    if (nextTaskId === null) return;
    event.preventDefault();
    void selectAdminTask(nextTaskId, { focus: "task", replaceState: true });
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
    <section
      class="admin-operator-inbox"
      data-component={operatorInbox.root.data.component}
      data-inbox-mode={operatorInbox.root.data.mode}
      data-selection-mode={operatorInbox.root.data.selectionMode}
      data-initial-canvas-count={operatorInbox.root.data.initialCanvasCount}
      data-testid={operatorInbox.root.testId}
    >
      <nav class="admin-operator-inbox__queue" aria-label="Operator inbox" data-testid={operatorInbox.queue.testId}>
        <header>
          <div><p class="fm-eyebrow">Needs attention</p><h2>{operatorInbox.queue.heading}</h2></div>
          <strong>{operatorInbox.queue.attentionCount}</strong>
        </header>
        <p>{operatorInbox.queue.summary}</p>
        <div class="admin-operator-inbox__tasks" role="tablist" aria-label="Operator tasks">
          {#each operatorInbox.tasks as task}
            <a
              id={task.testId}
              href={adminInboxTaskHref({ url: $page.url, taskId: task.id })}
              role="tab"
              data-state={task.state}
              data-kind={task.kind}
              data-testid={task.testId}
              aria-selected={task.id === operatorInbox.selectedTaskId ? "true" : "false"}
              aria-controls={task.panelTestId}
              tabindex={task.id === operatorInbox.selectedTaskId ? 0 : -1}
              on:click={(event) => activateAdminTask(event, task.id)}
              on:keydown={(event) => handleAdminTaskKeydown(event, task.id)}
            >
              <span>{task.badge}</span>
              <strong>{task.label}</strong>
              <small>{task.summary}</small>
            </a>
          {/each}
        </div>
      </nav>

      <section class="admin-operator-inbox__canvas" data-testid={operatorInbox.canvas.testId}>
        {#if operatorInbox.selectedTask}
          <div
            id={operatorInbox.selectedTask.panelTestId}
            role="tabpanel"
            aria-labelledby={operatorInbox.selectedTask.testId}
            tabindex="-1"
            data-testid={operatorInbox.selectedTask.panelTestId}
          >
            {#if operatorInbox.selectedTask.kind === "setup"}
              <AdminSetupGrid
                items={[operatorInbox.selectedTask.item]}
                {commandStatuses}
                sessionGrant={data.command.sessionGrant}
                onSetupAction={handleSetupAction}
                onConfirmSetupAction={confirmSetupAction}
                onCancelSetupAction={cancelSetupAction}
                onRetrySetupAction={retrySetupAction}
              />
            {:else if operatorInbox.selectedTask.kind === "audit"}
              <header class="admin-operator-inbox__canvas-heading">
                <div><p class="fm-eyebrow">{operatorInbox.selectedTask.badge}</p><h2>{operatorInbox.selectedTask.label}</h2></div>
                <span data-state={operatorInbox.selectedTask.state}>{operatorInbox.selectedTask.state}</span>
              </header>
              <p>{operatorInbox.selectedTask.summary}</p>
              <a
                class="fm-touch-button"
                href={operatorInbox.selectedTask.item.inspectHref ?? operatorInbox.selectedTask.item.href}
                data-testid={`admin-inbox-review-audit-${operatorInbox.selectedTask.sourceId}`}
              >Review check</a>
            {:else}
              <header class="admin-operator-inbox__canvas-heading">
                <div><p class="fm-eyebrow">{operatorInbox.selectedTask.badge}</p><h2>{operatorInbox.selectedTask.label}</h2></div>
                <span data-state={operatorInbox.selectedTask.state}>{operatorInbox.selectedTask.state}</span>
              </header>
              <p>{operatorInbox.selectedTask.summary}</p>
              <button
                type="button"
                class="fm-touch-button"
                data-testid={`admin-inbox-open-recovery-${operatorInbox.selectedTask.sourceId}`}
                on:click={() => handleRecoveryTask(operatorInbox.selectedTask.item)}
              >Open recovery check</button>
            {/if}
          </div>
        {/if}
      </section>
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

    <details class="fm-surface-drawer" data-testid="admin-recent-activity">
      <summary><span class="fm-surface-drawer__label"><strong>Recent activity</strong><small>Command outcomes and recovery state</small></span></summary>
      <div class="fm-surface-drawer__body"><AdminCommandActivity {commandStatuses} /></div>
    </details>

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

  .admin-operator-inbox { align-items: start; display: grid; gap: 22px; grid-template-columns: 260px minmax(0, 1fr); }
  .admin-operator-inbox__queue, .admin-operator-inbox__canvas { background: var(--fm-surface-tint); border: 1px solid var(--fm-line-soft); border-radius: 12px; min-inline-size: 0; }
  .admin-operator-inbox__queue { display: grid; gap: 12px; padding: 14px; }
  .admin-operator-inbox__queue > header { align-items: center; display: flex; gap: 12px; justify-content: space-between; }
  .admin-operator-inbox__queue h2, .admin-operator-inbox__queue p, .admin-operator-inbox__canvas h2, .admin-operator-inbox__canvas p { margin: 0; }
  .admin-operator-inbox__queue > header > strong { align-items: center; background: var(--fm-accent-wash); border-radius: 999px; color: var(--fm-accent-ink); display: inline-flex; justify-content: center; min-block-size: 36px; min-inline-size: 36px; }
  .admin-operator-inbox__queue > p { color: var(--fm-ink-muted); font-size: 13px; line-height: 1.4; }
  .admin-operator-inbox__tasks { display: grid; gap: 6px; }
  .admin-operator-inbox__tasks a { background: transparent; border: 1px solid transparent; border-radius: 9px; color: var(--fm-ink); display: grid; gap: 3px; min-block-size: 64px; padding: 9px 10px; text-align: start; text-decoration: none; }
  .admin-operator-inbox__tasks a:hover, .admin-operator-inbox__tasks a[aria-selected="true"] { background: var(--fm-raised); border-color: var(--fm-line-strong); }
  .admin-operator-inbox__tasks a > span { color: var(--fm-ink-muted); font-size: 10px; font-weight: 850; text-transform: uppercase; }
  .admin-operator-inbox__tasks a[data-state="blocked"] > span, .admin-operator-inbox__tasks a[data-state="interrupted"] > span { color: var(--fm-danger-ink); }
  .admin-operator-inbox__tasks a > small { color: var(--fm-ink-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .admin-operator-inbox__canvas { padding: clamp(18px, 3vw, 28px); }
  .admin-operator-inbox__canvas > [role="tabpanel"] { display: grid; gap: 18px; }
  .admin-operator-inbox__canvas-heading { align-items: center; border-block-end: 1px solid var(--fm-line); display: flex; gap: 16px; justify-content: space-between; padding-block-end: 14px; }
  .admin-operator-inbox__canvas-heading > span { border: 1px solid var(--fm-line); border-radius: 999px; font-size: 11px; font-weight: 850; padding: 7px 10px; text-transform: uppercase; }

  .admin-surface__split {
    display: grid;
    gap: 18px;
    grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.6fr);
  }

  .admin-surface__audit-stack {
    display: grid;
    gap: 18px;
  }

  @media (max-width: 1024px) {
    .admin-surface__split {
      grid-template-columns: 1fr;
    }

  }

  @media (max-width: 820px) {
    .admin-operator-inbox { gap: 12px; grid-template-columns: 1fr; }
    .admin-operator-inbox__queue { gap: 6px; padding: 10px; }
    .admin-operator-inbox__queue > p { display: none; }
    .admin-operator-inbox__tasks { display: flex; margin-inline: -10px; overflow-x: auto; padding-inline: 10px; }
    .admin-operator-inbox__tasks a { flex: 0 0 160px; min-block-size: 56px; padding-block: 6px; }
    .admin-operator-inbox__canvas { padding: 12px; }
  }

  @media (max-width: 760px) {
    .admin-surface { gap: 10px; }
    .admin-game-picker { gap: 8px; padding: 8px; }
    .admin-game-picker .fm-field > span { block-size: 1px; clip-path: inset(50%); inline-size: 1px; overflow: hidden; position: absolute; white-space: nowrap; }
    .admin-operator-inbox { gap: 8px; }
    .admin-operator-inbox__tasks a > small { display: none; }
    .admin-operator-inbox__canvas-heading { align-items: start; display: grid; gap: 8px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .admin-operator-inbox__tasks { scroll-behavior: auto; }
  }

  @media (forced-colors: active) {
    .admin-operator-inbox__queue, .admin-operator-inbox__canvas { border-color: CanvasText; }
    .admin-operator-inbox__tasks a[aria-selected="true"] { border-color: Highlight; outline: 2px solid Highlight; }
  }

</style>
