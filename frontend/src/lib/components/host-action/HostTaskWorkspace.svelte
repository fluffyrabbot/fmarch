<script>
  // The decision canvas: one selected task with its intent, consequence and
  // actions. Below the rail width it is the body of the task sheet; from the
  // rail width up it follows the queue in the rail (usage-frequency audit,
  // decision 11). The queue itself is HostWorkQueueStrip.
  import AppStatus from "$lib/app/AppStatus.svelte";
  import CommandRecovery from "$lib/app/CommandRecovery.svelte";
  import HostAction from "./HostAction.svelte";

  /** The workspace view model (`buildHostTaskWorkspaceViewModel`). */
  export let view;
  export let onToggleDayEventWinner = () => {};
  export let onDispatch = () => {};
  export let onRetry = () => {};
  export let onCancel = () => {};
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
  <div class="host-task-workspace__canvas" data-testid={view.canvas.testId}>
    {#if view.selectedTask === null}
      <p class="host-task-workspace__empty">Nothing needs you right now</p>
    {/if}
    {#if view.tasks.length > 0}
      {#each view.tasks as task (task.id)}
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
              <h2 tabindex="-1">{task.label}</h2>
              {#if task.meta}
                <p class="host-task-workspace__meta" data-testid={`${task.panelTestId}-meta`}>{task.meta}</p>
              {/if}
            </div>
            <span data-state={task.state}>{task.state}</span>
          </header>
          <p class="host-task-workspace__intent">{task.intent}</p>
          {#if task.consequence}
            <p class="host-task-workspace__consequence">{task.consequence}</p>
          {/if}

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
                            onToggleDayEventWinner(task.dayEvent.eventId, participant.slot)}
                        />
                        <span>{participant.label}</span>
                      </label>
                    {/each}
                  </div>
                </fieldset>
              {/if}
            </section>
          {/if}

          {#if task.kind === "replacement"}
            <slot name="replacement-chooser" />
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
                  <HostAction
                    action={action.config}
                    showConsequence={action.config.outcomeLabel !== task.intent}
                    onDispatch={onDispatch}
                  />
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

          {#if task.kind === "replacement"}
            <slot name="replacement-invite" />
          {/if}
        </article>
      {/each}
    {/if}
  </div>
</section>

<style>
  .host-task-workspace__day-event {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: var(--fm-radius-dock);
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
    border-radius: var(--fm-radius-control);
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
