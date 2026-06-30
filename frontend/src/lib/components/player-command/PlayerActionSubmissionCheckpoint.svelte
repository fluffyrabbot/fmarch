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
    data-actor-slot={checkpoint.root.data.actorSlot}
    data-action-state={checkpoint.root.data.actionState}
    data-selected-action={checkpoint.root.data.selectedAction}
    data-target-slots={checkpoint.root.data.targetSlots}
    data-receipt-state={checkpoint.root.data.receiptState}
    data-testid={checkpoint.root.testId}
  >
    <header>
      <div>
        <p>{checkpoint.proofCheckId}</p>
        <h2>{checkpoint.heading}</h2>
      </div>
      <AppStatus
        status={checkpoint.status}
        testId={checkpoint.status.testId}
        className="player-action-submission-checkpoint__status"
      />
    </header>

    <dl>
      {#each [
        checkpoint.phase,
        checkpoint.actor,
        checkpoint.actionState,
        checkpoint.target,
        checkpoint.receipt,
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
