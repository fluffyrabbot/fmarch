<script>
  import {
    buildHostWorkQueueStripViewModel,
  } from "./host-work-queue-strip.mjs";

  export let queues = [];

  $: view = buildHostWorkQueueStripViewModel({ queues });
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
>
  {#each view.queues as queue}
    <article
      class={queue.className}
      data-testid={queue.testId}
      data-min-block-px={queue.minBlockPx}
    >
      <h2>{queue.label}</h2>
      <p>{queue.value}</p>
    </article>
  {/each}
</section>
