<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let checkpoint;
</script>

{#if checkpoint}
  <section
    class={checkpoint.root.className}
    data-component={checkpoint.root.data.component}
    data-proof-check-id={checkpoint.root.data.proofCheckId}
    data-phase-id={checkpoint.root.data.phaseId}
    data-phase-state={checkpoint.root.data.phaseState}
    data-slot-id={checkpoint.root.data.slotId}
    data-action-state={checkpoint.root.data.actionState}
    data-deadline-affordance={checkpoint.root.data.deadlineAffordance}
    data-testid={checkpoint.root.testId}
  >
    <header>
      <div>
        <p class="host-console-critical-path__eyebrow">{checkpoint.proofCheckId}</p>
        <h2>{checkpoint.heading}</h2>
      </div>
      <AppStatus
        status={checkpoint.status}
        testId={checkpoint.status.testId}
        className="host-console-critical-path__lifecycle-checkpoint-status"
      />
    </header>

    <dl>
      {#each [
        checkpoint.phase,
        checkpoint.slot,
        checkpoint.actionState,
        checkpoint.deadlineAffordance,
        checkpoint.recovery,
      ] as item}
        <div data-testid={item.testId}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      {/each}
    </dl>
  </section>
{/if}
