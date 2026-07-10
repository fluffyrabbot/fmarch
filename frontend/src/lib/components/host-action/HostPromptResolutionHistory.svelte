<script>
  import {
    buildHostPromptResolutionHistoryViewModel,
  } from "./host-prompt-resolution-history.mjs";

  export let hostPrompts = [];

  $: view = buildHostPromptResolutionHistoryViewModel({ hostPrompts });
</script>

<section
  class={view.root.className}
  data-testid={view.root.testId}
  aria-label={view.root.ariaLabel}
>
  <header>
    <div>
      <p class="fm-eyebrow">Host prompt history</p>
      <h2>{view.heading}</h2>
    </div>
    <span class="fm-chip">{view.rows.length}</span>
  </header>
  {#if view.rows.length === 0}
    <p class={view.empty.className}>{view.empty.message}</p>
  {:else}
    <div class="host-prompt-resolution-history__rows">
      {#each view.rows as row}
        <div class={row.className} data-testid={row.testId}>
          <strong>{row.label}</strong>
          <span>{row.detail}</span>
        </div>
      {/each}
    </div>
  {/if}
</section>
