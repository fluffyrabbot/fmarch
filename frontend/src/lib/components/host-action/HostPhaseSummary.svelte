<script>
  import {
    buildHostPhaseSummaryViewModel,
  } from "./host-phase-summary.mjs";

  export let phase;
  export let projection;

  $: view = buildHostPhaseSummaryViewModel({
    phase,
    projection,
  });
</script>

<section
  class={view.root.className}
  aria-labelledby={view.root.ariaLabelledby}
  data-component={view.root.data.component}
>
  <p class="fm-eyebrow">{view.eyebrow}</p>
  <h2 id={view.headingId}>{view.heading}</h2>
  <p class={view.statusClassName}>{view.summary}</p>
  <dl class={view.factsClassName}>
    {#each view.facts as fact}
      <div>
        <dt>{fact.label}</dt>
        <dd data-testid={fact.testId}>
          {fact.value}
        </dd>
      </div>
    {/each}
  </dl>
</section>
