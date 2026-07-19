<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let card;
</script>

{#if card}
  <details
    class={card.root.className}
    data-component={card.root.data.component}
    data-proof-check-id={card.root.data.proofCheckId}
    data-role-state={card.root.data.roleState}
    data-role-key={card.root.data.roleKey}
    data-role-alignment={card.root.data.roleAlignment}
    data-testid={card.root.testId}
  >
    <summary>
      <div>
        <span class="fm-eyebrow">Your role</span>
        <strong class="player-role-card__name" data-testid={card.name.testId}>
          {card.name.value}
        </strong>
      </div>
      <span class="fm-chip" data-testid={card.alignment.testId}>
        {card.alignment.label}
      </span>
    </summary>

    <div class="fm-proof-disclosure__body">
      <AppStatus
        status={card.status}
        testId={card.status.testId}
        className="player-role-card__status"
      />
      <p class="player-role-card__description" data-testid={card.description.testId}>
        {card.description.value}
      </p>
    </div>
  </details>
{/if}
