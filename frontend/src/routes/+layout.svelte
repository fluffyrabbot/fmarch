<script>
  import { setContext, onMount } from "svelte";
  import { THEME_CONTEXT, createThemeContext } from "$lib/app/theme-context.mjs";
  import { DEFAULT_THEME_PREFERENCE } from "$lib/app/theme.mjs";
  import { navigating, page } from "$app/stores";
  import AppShell from "$lib/app/AppShell.svelte";
  import AppNavigationPending from "$lib/app/AppNavigationPending.svelte";
  import { applyViewerPresentationToShell } from "$lib/app/app-shell-model.mjs";

  export let data;
  let previewReady = !data?.preview;
  let previewTransport;
  onMount(() => {
    let disposed = false;
    if (data?.preview) void import("$lib/dev/preview-transport.mjs").then(({ installPreviewTransport }) => {
      if (disposed) return;
      previewTransport = installPreviewTransport(data.preview);
      previewReady = true;
    });
    return () => { disposed = true; previewTransport?.dispose(); };
  });
  const themeContext = createThemeContext(data?.themePreference);
  setContext(THEME_CONTEXT, themeContext);
  $: themeContext.preferences.set(data?.themePreference ?? DEFAULT_THEME_PREFERENCE);
  $: themeContext.setRoute($page.url.pathname, ($page.data?.shell ?? data?.shell)?.phaseId);
  onMount(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => themeContext.system.set(media.matches ? "dark" : "light");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  });

  // Gameplay controllers own a scoped snapshot; an addressed navigation starts a new scope.
  $: gameplayScope = $page.url.pathname.startsWith("/g/")
    ? `${$page.url.pathname}:${$page.url.searchParams.get("post") ?? ""}` : "other";
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

{#if data?.preview}
  <aside class="fm-preview-toolbar" aria-label="UI preview">
    <a href="/_dev/ui" data-sveltekit-reload>UI workbench</a>
    <span>Simulated data · commands disabled</span>
    <button type="button" on:click={() => previewTransport?.setPhase("D01")}>Day</button>
    <button type="button" on:click={() => previewTransport?.setPhase("N01")}>Night</button>
    <button type="button" on:click={() => previewTransport?.setPhase("T01")}>Twilight</button>
  </aside>
{/if}
{#if previewReady}
{#if presentedLayoutShell}
  <AppShell shell={presentedLayoutShell}>
    <AppNavigationPending
      path={pendingPath}
      principalId={appSession.principalId}
      viewerProfile={appSession.viewerProfile}
      capabilities={appSession.resolvedCapabilities}
    />

    {#key gameplayScope}<slot />{/key}
  </AppShell>
{:else}
  <AppNavigationPending
    path={pendingPath}
    principalId={appSession.principalId}
    viewerProfile={appSession.viewerProfile}
    capabilities={appSession.resolvedCapabilities}
  />

  {#key gameplayScope}<slot />{/key}
{/if}

{/if}
