<script>
  import { buildAppStatusViewModel } from "./app-status-model.mjs";

  export let status = null;
  export let testId;
  export let className = "";
  export let politeness = "polite";

  $: view = buildAppStatusViewModel({
    status,
    testId,
    className,
    politeness,
  });
</script>

{#if view.visible}
  <p
    class={view.className}
    data-state={view.state}
    data-testid={view.testId}
    role={view.role}
    aria-live={view.ariaLive}
    aria-atomic={view.ariaAtomic}
  >
    {view.message}
  </p>
{/if}
