<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import HostAction from "./HostAction.svelte";

  export let control;
  export let onDispatch = () => {};
</script>

<article
  class={control.classes.controlBay}
  data-priority={control.priority}
  data-testid={control.testId}
>
  <header>
    <div>
      <p class="fm-eyebrow">Host control</p>
      <h2>{control.label}</h2>
    </div>
  </header>
  <p class="host-console-critical-path__intent">{control.value}</p>
  {#if control.actions.length === 0}
    <p class={control.classes.empty}>
      {control.emptyLabel}
    </p>
  {:else}
    <div class={control.classes.actionBay}>
      {#each control.actions as action}
        <div
          class={control.classes.actionTile}
          data-action-priority={action.priority}
          data-testid={action.testId}
          aria-busy={action.status?.state === "pending" ? "true" : undefined}
        >
          <HostAction action={action.config} onDispatch={onDispatch} />
          <div
            class={control.classes.commandStatusFloor}
            data-testid={action.statusFloorTestId}
            data-status-floor-min-px={action.statusFloorMinBlockSizePx}
            aria-hidden={action.status ? undefined : "true"}
          >
            {#if action.status}
              <AppStatus
                status={action.status}
                testId={action.statusTestId}
                className={control.classes.commandStatus}
              />
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
  <details
    class={control.classes.diagnostics}
    data-testid={control.diagnostics.testId}
  >
    <summary>{control.diagnostics.summary}</summary>
    <dl>
      <div>
        <dt>Required access</dt>
        <dd>{control.diagnostics.authority}</dd>
      </div>
      <div>
        <dt>Dispatch boundary</dt>
        <dd>{control.diagnostics.boundary}</dd>
      </div>
      <div>
        <dt>Protocol</dt>
        <dd>{control.diagnostics.protocol}</dd>
      </div>
      {#each control.diagnostics.statuses as status}
        <div>
          <dt>{status.action} outcome</dt>
          <dd>{status.message}</dd>
        </div>
      {/each}
    </dl>
  </details>
</article>
