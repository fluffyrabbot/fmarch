<script>
  import AppStatus from "$lib/app/AppStatus.svelte";

  export let item;
</script>

<article class="fm-panel" data-testid={item.testId}>
  <h2>{item.label}</h2>
  <p class="admin-surface__summary">{item.boundary}</p>
  <details class="fm-proof-disclosure admin-surface__technical-details">
    <summary>Technical details</summary>
    <p
      class="admin-surface__boundary fm-well fm-well--kv"
      data-testid={item.boundaryTestId}
    >
      <strong>{item.displayAuthority}</strong>
      <span data-testid={item.evidenceTestId}>{item.boundaryDetail}</span>
    </p>
  </details>
  <AppStatus
    status={item.statusView}
    testId={item.statusTestId}
    className="admin-surface__audit-status"
  />
  <a
    class="fm-touch-button fm-touch-button--secondary"
    data-min-touch-target-px={item.minTouchTargetPx}
    data-testid={item.linkTestId}
    href={item.inspectHref}
  >
    {item.buttonLabel}
  </a>
</article>

<style>
  .admin-surface__summary {
    margin: 10px 0 0;
  }
</style>
