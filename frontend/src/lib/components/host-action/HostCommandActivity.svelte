<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    buildHostCommandActivityViewModel,
  } from "./host-command-activity.mjs";

  export let commandStatuses = {};
  export let commandOutcomes = [];

  $: view = buildHostCommandActivityViewModel({
    commandStatuses,
    commandOutcomes,
  });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-testid="host-command-activity"
>
  <header>
    <div>
      <p class="host-console-critical-path__eyebrow">Host ops</p>
      <h2>{view.heading}</h2>
    </div>
    <span data-testid="host-command-activity-count">
      {view.items.length}
    </span>
  </header>
  <p>{view.summary}</p>
  {#if view.items.length === 0}
    <p
      class={view.empty.className}
      data-state={view.empty.state}
      data-testid={view.empty.testId}
    >
      {view.empty.message}
    </p>
  {:else}
    <div class={view.listClassName}>
      {#each view.items as item}
        <article
          class={item.className}
          data-testid={item.testId}
          data-source={item.source}
          data-confirmation-trace-kind={item.confirmationTrace?.kind}
          data-confirmation-surface={item.confirmationTrace?.surface}
          data-confirmation-action-id={item.confirmationTrace?.actionId}
          data-confirmation-status-key={item.confirmationTrace?.statusKey}
          data-confirmation-dispatch-kind={item.confirmationTrace?.dispatchKind}
        >
          <strong>{item.label}</strong>
          <AppStatus
            status={{ state: item.state, message: item.message }}
            testId={item.statusTestId}
            className="host-console-critical-path__command-activity-status"
          />
        </article>
      {/each}
    </div>
  {/if}
</section>
