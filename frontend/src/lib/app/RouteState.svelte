<script>
  import AppStatus from "./AppStatus.svelte";

  export let view;
</script>

<section
  class="fm-route-state"
  data-testid={view.rootTestId}
  data-surface={view.surface}
  data-state={view.state}
>
  <div class="fm-route-state__copy">
    <p class="fm-eyebrow">{view.surface}</p>
    <h2>{view.title}</h2>
    <p>{view.message}</p>
  </div>

  <AppStatus
    status={view.status}
    testId={view.status.testId}
    className="fm-route-state__status"
  />

  <a
    class={view.action.className}
    href={view.action.href}
    data-testid={view.action.testId}
  >
    {view.action.label}
  </a>
</section>
