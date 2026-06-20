<script>
  import {
    buildAdminEscalationPanelViewModel,
  } from "./admin-surface-model.mjs";

  export let escalations = [];

  $: view = buildAdminEscalationPanelViewModel({ escalations });
</script>

<div class={view.root.className} aria-label={view.root.ariaLabel}>
  {#each view.items as item}
    <article class="fm-panel" data-testid={item.testId}>
      <h2>{item.label}</h2>
      <p>{item.value}</p>
    </article>
  {/each}
</div>
