<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let checkpoint;
</script>

{#if checkpoint}
  <details
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
    <summary>
      <div>
        <span class="fm-eyebrow">Action readiness</span>
        <strong>{checkpoint.heading}</strong>
      </div>
      <span class="fm-chip">{checkpoint.phase.value}</span>
    </summary>

    <div class="fm-proof-disclosure__body">
      <AppStatus
        status={checkpoint.status}
        testId={checkpoint.status.testId}
        className="player-action-submission-checkpoint__status"
      />
      <dl>
        {#each [
          checkpoint.phase,
          checkpoint.actor,
          checkpoint.actionState,
          checkpoint.target,
          checkpoint.receipt,
          checkpoint.recovery,
        ] as item}
          <div class="fm-well" data-testid={item.testId}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
          </div>
        {/each}
      </dl>
    </div>
  </details>
{/if}
