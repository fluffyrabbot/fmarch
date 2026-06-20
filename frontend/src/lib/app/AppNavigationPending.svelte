<script>
  import "../styles/app.css";
  import AppStatus from "./AppStatus.svelte";
  import { buildNavigationPendingData } from "./app-shell-model.mjs";

  export let path = null;
  export let principalUserId = null;
  export let capabilities = [];

  $: view = buildNavigationPendingData({
    path,
    principalUserId,
    capabilities,
  });
</script>

{#if view.visible}
  <section
    class="fm-navigation-pending"
    data-component={view.component}
    data-testid={view.rootTestId}
    data-surface={view.surface}
    data-path={view.path}
    data-active-nav-testid={view.activeNavTestId}
    data-session-principal={view.sessionPrincipal}
    data-capability-summary={view.capabilitySummary}
    aria-label={view.label}
  >
    <div class="fm-navigation-pending__copy">
      <p class="fm-navigation-pending__eyebrow">{view.surface}</p>
      <p class="fm-navigation-pending__title">{view.title}</p>
    </div>
    <AppStatus
      status={view.status}
      testId={view.statusTestId}
      className="fm-navigation-pending__status"
    />
  </section>
{/if}
