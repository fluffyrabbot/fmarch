<script>
  import { buildHostWorkQueueStripViewModel } from "./host-work-queue-strip.mjs";

  export let decisions = [];
  export let selectedTaskId = null;
  export let attentionCount = 0;
  export let summary = "";
  /** "strip" under the host bar below the rail width, "rail" above it. */
  export let layout = "strip";
  /** `(taskId, invoker)`: open that decision's canvas. */
  export let onSelect = () => {};

  $: view = buildHostWorkQueueStripViewModel({ decisions, selectedTaskId, attentionCount, summary, layout });
</script>

<nav
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-testid={view.root.testId}
  data-component={view.root.data.component}
  data-thumb-zone={view.root.data.thumbZone}
  data-layout={view.root.data.layout}
>
  <header data-testid={view.summary.testId}>
    <div>
      <p class="fm-eyebrow">{view.summary.label}</p>
      <p>{view.summary.text}</p>
    </div>
    <strong aria-label={view.summary.attentionLabel}>{view.summary.attentionCount}</strong>
  </header>
  {#if view.tasks.length > 0}
    <div class="host-task-queue__list">
      {#each view.tasks as task (task.id)}
        <button
          type="button"
          class:host-task-queue__task--selected={task.selected}
          data-state={task.state}
          data-urgency={task.urgency}
          data-task-id={task.id}
          data-task-kind={task.kind}
          data-task-source-id={task.sourceId}
          data-testid={task.testId}
          data-min-touch-target-px={task.minBlockPx}
          aria-pressed={layout === "rail" ? task.selected : undefined}
          aria-haspopup={layout === "strip" ? "dialog" : undefined}
          on:click={(event) => onSelect(task.id, event.currentTarget)}
        >
          <span>{task.urgencyLabel}</span>
          <strong>{task.label}</strong>
          <small>{task.meta}</small>
        </button>
      {/each}
    </div>
  {/if}
</nav>
