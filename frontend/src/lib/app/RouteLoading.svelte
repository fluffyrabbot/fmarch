<script>
  import AppShell from "./AppShell.svelte";
  import RouteState from "./RouteState.svelte";
  import { buildRouteLoadingData } from "./app-shell-model.mjs";

  export let path = "/";
  export let principalUserId = null;
  export let capabilities = [];

  $: loadingData = buildRouteLoadingData({
    path,
    principalUserId,
    capabilities,
  });
</script>

<AppShell shell={loadingData.shell}>
  <main
    class="fm-surface fm-loading-surface"
    data-testid="route-loading-surface"
    data-path={loadingData.path}
  >
    <RouteState view={loadingData.routeState} />
  </main>
</AppShell>
