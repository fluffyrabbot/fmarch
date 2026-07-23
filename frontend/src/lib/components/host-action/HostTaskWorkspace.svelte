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
  export let hostDayEvents = [];
  export let votecount = [];
  export let onDispatch = () => {};
  export let onRetry = () => {};
  export let onCancel = () => {};

  let preferredTaskId = null;
  let dayEventSelections = {};
  $: view = buildHostTaskWorkspaceViewModel({
    groups,
    commandStatuses,
    commandContext,
    phase,
    replacement,
    hostPrompts,
    hostTasks,
    hostDayEvents,
    dayEventSelections,
    votecount,
    selectedTaskId: preferredTaskId,
  });

  function toggleDayEventWinner(eventId, slot) {
    const current = new Set(dayEventSelections[eventId] ?? []);
    if (current.has(slot)) {
      current.delete(slot);
    } else {
      current.add(slot);
    }
    dayEventSelections = {
      ...dayEventSelections,
      [eventId]: [...current].sort(),
    };
  }
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

          {#if task.dayEvent}
            <section
              class="host-task-workspace__day-event"
              data-testid={`host-day-event-workspace-${task.dayEvent.eventId}`}
            >
              <header>
                <div>
                  <span>Participants</span>
                  <strong>{task.dayEvent.participantSummary}</strong>
                </div>
                <div>
                  <span>Rewards</span>
                  <strong>{task.dayEvent.rewards.join(", ") || "No rewards projected"}</strong>
                </div>
              </header>
              {#if task.dayEvent.participants.length === 0}
                <p>No participants are available for selection.</p>
              {:else}
                <fieldset>
                  <legend>Select winner slots</legend>
                  <div class="host-task-workspace__winner-grid">
                    {#each task.dayEvent.participants as participant}
                      <label
                        data-testid={participant.testId}
                        data-selected={participant.selected}
                      >
                        <input
                          type="checkbox"
                          checked={participant.selected}
                          disabled={participant.disabled}
                          on:change={() =>
                            toggleDayEventWinner(task.dayEvent.eventId, participant.slot)}
                        />
                        <span>{participant.slot}</span>
                      </label>
                    {/each}
                  </div>
                </fieldset>
              {/if}
            </section>
          {/if}

          {#if task.actions.length === 0}
            <p class="host-task-workspace__empty">{task.emptyLabel ?? "No action is currently required."}</p>
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

<style>
  .host-task-workspace__day-event {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 10px;
    display: grid;
    gap: 12px;
    padding: 12px;
  }

  .host-task-workspace__day-event > header {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .host-task-workspace__day-event > header div {
    display: grid;
    gap: 2px;
  }

  .host-task-workspace__day-event span,
  .host-task-workspace__day-event legend {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
  }

  .host-task-workspace__day-event fieldset {
    border: 0;
    margin: 0;
    padding: 0;
  }

  .host-task-workspace__winner-grid {
    display: grid;
    gap: 8px;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    margin-block-start: 8px;
  }

  .host-task-workspace__winner-grid label {
    align-items: center;
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    display: flex;
    gap: 8px;
    min-block-size: 44px;
    padding: 8px 10px;
  }

  .host-task-workspace__winner-grid label[data-selected="true"] {
    background: var(--fm-accent-soft);
    border-color: var(--fm-accent);
  }

  @media (max-width: 560px) {
    .host-task-workspace__day-event > header {
      grid-template-columns: 1fr;
    }
  }
</style>
