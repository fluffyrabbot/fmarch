<script>
  import { navigating, page } from "$app/stores";
  import AppShell from "$lib/app/AppShell.svelte";
  import AppNavigationPending from "$lib/app/AppNavigationPending.svelte";

  export let data;

  $: appSession = data?.appSession ?? {};
  $: pendingPath = $navigating?.to?.url?.pathname ?? null;
  $: pageRouteData = $page.data?.shellOwner === "layout" ? $page.data : null;
  $: directRouteData = data?.shellOwner === "layout" ? data : null;
  $: layoutShell = (directRouteData ?? pageRouteData)?.shell ?? null;
</script>

{#if layoutShell}
  <AppShell shell={layoutShell}>
    <AppNavigationPending
      path={pendingPath}
      principalUserId={appSession.principalUserId}
      capabilities={appSession.resolvedCapabilities}
    />

    <slot />
  </AppShell>
{:else}
  <AppNavigationPending
    path={pendingPath}
    principalUserId={appSession.principalUserId}
    capabilities={appSession.resolvedCapabilities}
  />

  <slot />
{/if}
