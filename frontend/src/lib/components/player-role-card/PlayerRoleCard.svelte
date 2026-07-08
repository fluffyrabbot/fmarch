<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let card;
</script>

{#if card}
  <section
    class={card.root.className}
    data-component={card.root.data.component}
    data-proof-check-id={card.root.data.proofCheckId}
    data-role-state={card.root.data.roleState}
    data-role-key={card.root.data.roleKey}
    data-role-alignment={card.root.data.roleAlignment}
    data-testid={card.root.testId}
  >
    <header>
      <div>
        <p>{card.proofCheckId}</p>
        <h2>{card.heading}</h2>
      </div>
      <AppStatus
        status={card.status}
        testId={card.status.testId}
        className="player-role-card__status"
      />
    </header>

    <div class="player-role-card__identity">
      <p class="player-role-card__name" data-testid={card.name.testId}>
        {card.name.value}
      </p>
      <span class="fm-chip" data-testid={card.alignment.testId}>
        {card.alignment.label}
      </span>
    </div>
    <p class="player-role-card__description" data-testid={card.description.testId}>
      {card.description.value}
    </p>
  </section>
{/if}
