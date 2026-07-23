<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import CommandRecovery from "$lib/app/CommandRecovery.svelte";
  import HostAction from "./HostAction.svelte";
  import { buildHostTaskWorkspaceViewModel } from "./host-task-workspace.mjs";

  export let groups = [];
  export let commandStatuses = {};
  export let commandContext = {};
  export let phase = {};
  export let replacement = {};
  export let hostPrompts = [];
  export let hostTasks = [];
  export let votecount = [];
  export let onDispatch = () => {};
  export let onRetry = () => {};
  export let onCancel = () => {};

  let preferredTaskId = null;
  $: view = buildHostTaskWorkspaceViewModel({
    groups,
    commandStatuses,
    commandContext,
    phase,
    replacement,
    hostPrompts,
    hostTasks,
    votecount,
    selectedTaskId: preferredTaskId,
  });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-thumb-zone={view.root.data.thumbZone}
  data-action-priority={view.root.data.actionPriority}
  data-workspace-mode={view.root.data.mode}
  data-testid={view.root.testId}
>
  <nav class="host-task-workspace__queue" aria-label="Host task queue" data-testid={view.queue.testId}>
    <header data-testid="host-task-queue-summary">
      <div>
        <p class="fm-eyebrow">Attention</p>
        <h2>{view.queue.label}</h2>
      </div>
      <strong aria-label={`${view.queue.attentionCount} decisions need attention`}>
        {view.queue.attentionCount}
      </strong>
    </header>
    <p>{view.queue.summary}</p>
    <div class="host-task-workspace__task-list">
      {#each view.tasks as task}
        <button
          type="button"
          class:host-task-workspace__task--selected={task.id === view.selectedTaskId}
          data-state={task.state}
          data-urgency={task.urgency}
          data-task-id={task.id}
          data-task-kind={task.kind}
          data-task-source-id={task.sourceId}
          data-testid={task.testId}
          aria-pressed={task.id === view.selectedTaskId}
          on:click={() => preferredTaskId = task.id}
        >
          <span>{task.urgencyLabel}</span>
          <strong>{task.label}</strong>
          <small>{task.meta}</small>
        </button>
      {/each}
    </div>
  </nav>

  <section class="host-task-workspace__canvas" data-testid={view.canvas.testId}>
    {#if view.selectedTask}
      {#each view.tasks as task}
        <article
          class="host-task-workspace__decision"
          data-testid={task.panelTestId}
          data-task-id={task.id}
          data-task-kind={task.kind}
          data-task-source-id={task.sourceId}
          hidden={task.id !== view.selectedTaskId}
        >
          <header>
            <div>
              <p class="fm-eyebrow">{task.urgencyLabel}</p>
              <h2>{task.label}</h2>
            </div>
            <span data-state={task.state}>{task.state}</span>
          </header>
          <p class="host-task-workspace__intent">{task.intent}</p>
          <div class="host-task-workspace__consequence">
            <span>Consequence</span>
            <strong>{task.consequence}</strong>
          </div>

          {#if task.actions.length === 0}
            <p class="host-task-workspace__empty">No action is currently required.</p>
          {:else}
            <div class="host-task-workspace__actions">
              {#each task.actions as action}
                <div
                  class="host-task-workspace__action"
                  data-action-priority={action.priority}
                  data-testid={action.testId}
                  aria-busy={action.status?.state === "pending" ? "true" : undefined}
                >
                  <HostAction action={action.config} onDispatch={onDispatch} />
                  <div
                    class="host-task-workspace__status-floor"
                    data-testid={action.statusFloorTestId}
                    data-status-floor-min-px={action.statusFloorMinBlockSizePx}
                    aria-hidden={action.status ? undefined : "true"}
                  >
                    {#if action.status}
                      <AppStatus status={action.status} testId={action.statusTestId} />
                      <CommandRecovery status={action.status} {onRetry} {onCancel} />
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}

          <details class="host-task-workspace__diagnostics">
            <summary>Technical details</summary>
            <dl>
              <div><dt>Required access</dt><dd>{task.diagnostics.authority}</dd></div>
              <div><dt>Dispatch boundary</dt><dd>{task.diagnostics.boundary}</dd></div>
              <div><dt>Protocol</dt><dd>{task.diagnostics.protocol}</dd></div>
            </dl>
          </details>
        </article>
      {/each}
    {:else}
      <p class="host-task-workspace__empty">No host decisions are available.</p>
    {/if}

    <details
      class="host-task-workspace__command-context fm-proof-disclosure"
      data-testid={view.commandContext.testId}
      data-game-id={view.commandContext.gameId}
      data-principal-user-id={view.commandContext.principalUserId}
      data-capability-label={view.commandContext.capabilityLabel}
      data-command-endpoint={view.commandContext.commandEndpoint}
    >
      <summary>{view.commandContext.summary}</summary>
      <div class="fm-proof-disclosure__body">
        <span>{view.commandContext.label}</span>
        <strong>{view.commandContext.value}</strong>
        <small>{view.commandContext.commandEndpoint}</small>
      </div>
    </details>
  </section>
</section>
