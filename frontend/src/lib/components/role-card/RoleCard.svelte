<script>
  // One role, three sizes: "full" for modals, sheets and reference detail,
  // "compact" for grids and pickers, "chip" inline in posts. `card` is a
  // buildRoleCardViewModel result; a bare full card leaves its frame and ears
  // to the surface that hosts it.
  export let card;
  export let headingLevel = 2;
  // A host surface may own the summary's test id (the player role card does).
  export let summaryTestId = null;
</script>

{#if card}
  {#if card.variant === "chip"}
    <span
      class="role-chip"
      data-component={card.contract.component}
      data-variant="chip"
      data-role-key={card.key}
      data-alignment={card.alignment.id}
      data-testid={card.contract.rootTestId}
    >
      <span class="role-chip__crest" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="12" height="12" focusable="false"><path d={card.alignment.icon} /></svg>
      </span>
      <span data-testid={card.contract.nameTestId}>{card.name}</span>
      <span class="fm-sr-only">({card.alignment.label})</span>
    </span>
  {:else}
    <article
      class="role-card"
      data-component={card.contract.component}
      data-variant={card.variant}
      data-framed={card.framed ? "true" : "false"}
      data-role-key={card.key}
      data-alignment={card.alignment.id}
      data-testid={card.contract.rootTestId}
      aria-label={`${card.name}, ${card.alignment.label} role`}
    >
      <header class="role-card__header">
        <span class="role-card__crest" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d={card.alignment.icon} /></svg>
        </span>
        <div class="role-card__identity">
          {#if card.variant === "full"}
            <p class="role-card__eyebrow">{card.alignment.label} · {card.packName}</p>
          {/if}
          <svelte:element this={`h${headingLevel}`} class="role-card__name" data-testid={card.contract.nameTestId}>{card.name}</svelte:element>
          <code class="role-card__key" data-legibility="technical">{card.key}</code>
        </div>
        {#if card.variant === "compact"}
          <span class="role-card__alignment">{card.alignment.label}</span>
        {/if}
      </header>

      <p class="role-card__summary" data-testid={summaryTestId ?? undefined}>{card.summary}</p>

      {#if card.variant === "compact"}
        <ul class="role-card__badges" aria-label="Acts and abilities">
          {#each card.windows as window}
            <li class="role-window" data-window={window.id}>
              <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d={window.icon} /></svg>{window.label}
            </li>
          {/each}
          {#each card.abilities as ability}
            <li class="role-tag">{ability.label}</li>
          {/each}
          {#each card.traits as trait}
            <li class="role-tag role-tag--trait">{trait.short}</li>
          {/each}
        </ul>
      {:else}
        <section class="role-card__section" aria-label="Abilities">
          <h3 class="role-card__label">Abilities</h3>
          {#each card.abilities as ability}
            <div class="role-card__ability" data-testid={card.contract.abilityTestId}>
              <div class="role-card__ability-head">
                <svg class="role-card__ability-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d={ability.icon} /></svg>
                <span class="role-card__ability-name">{ability.label}</span>
                <span class="role-window" data-window={ability.window.id}>
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false"><path d={ability.window.icon} /></svg>{ability.window.label}
                </span>
              </div>
              <p class="role-card__targets">Targets {ability.targets}</p>
              <ul class="role-card__tags" aria-label="Constraints">
                {#each ability.tags as tag}<li class="role-tag">{tag}</li>{/each}
              </ul>
            </div>
          {:else}
            <p class="role-card__none">No actions. This role plays through talk, reads and the vote.</p>
          {/each}
        </section>

        {#if card.traits.length > 0}
          <section class="role-card__section" aria-label="Traits">
            <h3 class="role-card__label">Traits</h3>
            {#each card.traits as trait}
              <p class="role-card__trait" data-testid={card.contract.traitTestId}>
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d={card.icons.trait} /></svg>
                <span>{trait.text}</span>
              </p>
            {/each}
          </section>
        {/if}

        <dl class="role-card__facts">
          <dt>Wins when</dt>
          <dd>{card.win}</dd>
          <dt>Channels</dt>
          <dd class="role-card__channels">
            {#each card.channels as channel}
              <span class="role-channel" data-empty={channel.empty ? "true" : "false"}>
                <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d={card.icons.chat} /></svg>{channel.label}
              </span>
            {/each}
          </dd>
        </dl>
      {/if}
    </article>
  {/if}
{/if}

<style>
  .role-card,
  .role-chip {
    --role-ink: var(--fm-align-town);
    --role-wash: var(--fm-align-town-wash);
  }
  [data-alignment="mafia"] { --role-ink: var(--fm-align-mafia); --role-wash: var(--fm-align-mafia-wash); }
  [data-alignment="independent"] { --role-ink: var(--fm-align-independent); --role-wash: var(--fm-align-independent-wash); }

  svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.2; flex: none; }

  .role-card {
    background: var(--fm-raised);
    border: 2px solid var(--fm-line);
    border-radius: var(--fm-radius-panel);
    box-sizing: border-box;
    color: var(--fm-ink);
    display: grid;
    gap: 18px;
    min-inline-size: 0;
    padding: 22px 22px 20px;
    position: relative;
  }
  .role-card[data-variant="compact"] { gap: 10px; padding: 16px 18px; }
  .role-card[data-framed="false"] { background: transparent; border: 0; border-radius: 0; padding: 0; }

  .role-card__header { align-items: flex-start; display: flex; gap: 14px; }
  .role-card[data-variant="compact"] .role-card__header { align-items: center; gap: 12px; }
  .role-card__crest {
    align-items: center;
    background: var(--role-wash);
    block-size: 56px;
    border-radius: 18px;
    color: var(--role-ink);
    display: inline-flex;
    flex: 0 0 56px;
    justify-content: center;
  }
  .role-card__crest svg { block-size: 28px; inline-size: 28px; }
  .role-card[data-variant="compact"] .role-card__crest { block-size: 40px; border-radius: 13px; flex-basis: 40px; }
  .role-card[data-variant="compact"] .role-card__crest svg { block-size: 22px; inline-size: 22px; }
  .role-card__identity { display: grid; flex: 1; gap: 2px; min-inline-size: 0; }
  .role-card__eyebrow {
    color: var(--role-ink);
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }
  .role-card__name {
    font-family: var(--fm-font-display);
    font-size: 30px;
    font-weight: 600;
    letter-spacing: -0.01em;
    line-height: 1.1;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .role-card[data-variant="compact"] .role-card__name { font-size: 21px; line-height: 1.15; }
  .role-card__key { color: var(--fm-ink-muted); font-family: var(--fm-font-mono); font-size: 12px; overflow-wrap: anywhere; }
  .role-card__alignment {
    background: var(--role-wash);
    border-radius: 999px;
    color: var(--role-ink);
    flex: none;
    font-size: 12px;
    font-weight: 800;
    padding: 3px 10px;
  }

  .role-card__summary { font-size: 16px; line-height: 1.5; margin: 0; }
  .role-card[data-variant="compact"] .role-card__summary {
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    color: var(--fm-ink-muted);
    display: -webkit-box;
    font-size: 14px;
    line-height: 1.45;
    line-clamp: 2;
    overflow: hidden;
  }

  .role-card__section { display: grid; gap: 8px; }
  .role-card__label {
    color: var(--fm-ink-muted);
    font-family: var(--fm-font-ui);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: 0.08em;
    margin: 0;
    text-transform: uppercase;
  }
  .role-card__ability {
    background: var(--fm-surface-tint);
    border: 2px solid var(--fm-line);
    border-radius: var(--fm-radius-control);
    display: grid;
    gap: 8px;
    padding: 12px 14px;
  }
  .role-card__ability-head { align-items: center; display: flex; gap: 10px; }
  .role-card__ability-icon { color: var(--fm-accent); }
  .role-card__ability-name { flex: 1; font-size: 16px; font-weight: 800; min-inline-size: 0; }
  .role-card__targets { color: var(--fm-ink-muted); font-size: 14px; margin: 0; }
  .role-card__tags,
  .role-card__badges { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
  .role-card__badges { align-items: center; }
  .role-card__none {
    border: 2px dashed var(--fm-line-strong);
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink-muted);
    font-size: 14px;
    margin: 0;
    padding: 12px 14px;
  }
  .role-card__trait {
    align-items: center;
    background: var(--fm-accent-wash);
    border-radius: var(--fm-radius-control);
    color: var(--fm-accent-ink);
    display: flex;
    font-size: 15px;
    font-weight: 700;
    gap: 10px;
    margin: 0;
    padding: 10px 14px;
  }

  .role-card__facts {
    align-items: baseline;
    border-block-start: 2px dashed var(--fm-line);
    display: grid;
    font-size: 14px;
    gap: 8px 16px;
    grid-template-columns: auto minmax(0, 1fr);
    margin: 0;
    padding-block-start: 14px;
  }
  .role-card__facts dt { color: var(--fm-ink-muted); font-weight: 800; }
  .role-card__facts dd { font-weight: 700; margin: 0; }
  .role-card__channels { display: flex; flex-wrap: wrap; gap: 6px; }
  .role-channel {
    align-items: center;
    background: var(--role-wash);
    border-radius: 999px;
    color: var(--role-ink);
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    gap: 5px;
    padding: 1px 10px 1px 7px;
  }
  .role-channel[data-empty="true"] { background: var(--fm-surface-muted); color: var(--fm-ink-muted); }

  /* Shared with the reference table, so global under this component's classes. */
  :global(.role-window) {
    align-items: center;
    background: var(--fm-surface-muted);
    border-radius: 999px;
    box-shadow: inset 0 0 0 1.5px var(--fm-line-strong);
    color: var(--fm-ink);
    display: inline-flex;
    font-size: 12px;
    font-weight: 800;
    gap: 5px;
    padding: 2px 10px 2px 7px;
    white-space: nowrap;
  }
  :global(.role-window[data-window="passive"]) { color: var(--fm-ink-muted); }
  :global(.role-tag) {
    border: 1.5px solid var(--fm-line-strong);
    border-radius: 999px;
    color: var(--fm-ink-muted);
    font-size: 12px;
    font-weight: 700;
    padding: 2px 9px;
  }
  :global(.role-tag--trait) { background: var(--fm-accent-wash); border-color: transparent; color: var(--fm-accent-ink); }

  .role-chip {
    align-items: center;
    background: var(--role-wash);
    border-radius: 999px;
    color: var(--role-ink);
    display: inline-flex;
    font-weight: 800;
    gap: 6px;
    line-height: 1.5;
    padding: 2px 11px 2px 3px;
    vertical-align: baseline;
  }
  .role-chip__crest {
    align-items: center;
    background: var(--role-ink);
    block-size: 20px;
    border-radius: 999px;
    color: var(--fm-raised);
    display: inline-flex;
    inline-size: 20px;
    justify-content: center;
  }
  .role-chip__crest svg { stroke-width: 2.8; }

  @media (forced-colors: active) {
    .role-card__crest, .role-chip__crest, :global(.role-window) { forced-color-adjust: auto; border: 1px solid CanvasText; }
  }
</style>
