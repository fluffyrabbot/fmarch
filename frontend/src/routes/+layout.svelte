<script>
  import { navigating, page } from "$app/stores";
  import AppShell from "$lib/app/AppShell.svelte";
  import AppNavigationPending from "$lib/app/AppNavigationPending.svelte";
  import { applyViewerPresentationToShell } from "$lib/app/app-shell-model.mjs";

  export let data;

  $: appSession = data?.appSession ?? {};
  $: pendingPath = $navigating?.to?.url?.pathname ?? null;
  $: pageRouteData = $page.data?.shellOwner === "layout" ? $page.data : null;
  $: directRouteData = data?.shellOwner === "layout" ? data : null;
  $: layoutShell = (directRouteData ?? pageRouteData)?.shell ?? null;
  $: presentedLayoutShell = applyViewerPresentationToShell(layoutShell, {
    principalId: appSession.principalId,
    viewerProfile: appSession.viewerProfile,
  });
</script>

{#if presentedLayoutShell}
  <AppShell shell={presentedLayoutShell}>
    <AppNavigationPending
      path={pendingPath}
      principalId={appSession.principalId}
      viewerProfile={appSession.viewerProfile}
      capabilities={appSession.resolvedCapabilities}
    />

    <slot />
  </AppShell>
{:else}
  <AppNavigationPending
    path={pendingPath}
    principalId={appSession.principalId}
    viewerProfile={appSession.viewerProfile}
    capabilities={appSession.resolvedCapabilities}
  />

  <slot />
{/if}
