<script>
  import { page } from "$app/stores";
  import AppShell from "$lib/app/AppShell.svelte";
  import { buildRouteErrorData } from "$lib/app/app-shell-model.mjs";

  $: routeError = buildRouteErrorData({
    status: $page.status,
    message: $page.error?.message,
    path: $page.url?.pathname,
    principalUserId: $page.data?.appSession?.principalUserId,
    capabilities: $page.data?.appSession?.resolvedCapabilities,
  });
</script>

<svelte:head>
  <title>{routeError.error.status} {routeError.error.title}</title>
</svelte:head>

<AppShell shell={routeError.shell}>
  <main
    class="fm-surface fm-error-surface"
    data-testid="route-error-surface"
    data-status={routeError.error.status}
  >
    <section class="fm-panel fm-error-panel" data-testid="route-error-panel">
      <p class="fm-eyebrow">{routeError.error.status}</p>
      <h1>{routeError.error.title}</h1>
      <p>{routeError.error.message}</p>
      <p class="fm-error-panel__path">{routeError.error.path}</p>
      <a
        class="fm-touch-button"
        href={routeError.error.actionHref}
        data-testid="route-error-action"
      >
        {routeError.error.actionLabel}
      </a>
    </section>
  </main>
</AppShell>
