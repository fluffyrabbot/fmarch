<script>
  import "../styles/app.css";
  import AccountMenu from "./AccountMenu.svelte";
  import { APP_SHELL_CONTRACT } from "./app-shell-model.mjs";
  import { getContext } from "svelte";
  import { readable } from "svelte/store";
  import { THEME_CONTEXT } from "./theme-context.mjs";
  import { resolveTheme } from "./theme.mjs";

  export let shell;

  const themeContext = getContext(THEME_CONTEXT);
  const themeStore = themeContext?.resolved ?? readable(null);
  $: theme = $themeStore ?? resolveTheme({ phaseId: shell.phaseId });
  $: primarySurfaces = shell.surfaces.filter((surface) => surface.group === "primary");
  $: workspaceSurfaces = shell.surfaces.filter((surface) => surface.group === "workspace");
</script>

<div
  class="fm-app-shell"
  data-component={APP_SHELL_CONTRACT.component}
  data-surface={shell.activeSurface}
  data-theme={theme.themeId}
  data-scheme={theme.scheme}
  data-palette={theme.palette}
  data-phase={theme.phase ?? undefined}
>
  <a
    class="fm-skip-link"
    href={`#${APP_SHELL_CONTRACT.mainTargetId}`}
    data-testid={APP_SHELL_CONTRACT.skipLinkTestId}
  >
    {APP_SHELL_CONTRACT.skipLinkLabel}
  </a>
  {#if !shell.gameBarOwned}
    <header class="fm-app-shell__topbar" data-testid={APP_SHELL_CONTRACT.topbarTestId}>
      {#if shell.game && shell.activeSurface === 'moderator'}
        <a href="/" class="fm-app-shell__brand">Games</a>
        <span class="fm-app-shell__game-title">{shell.gameTitle ?? 'Game host'}</span>
        <AccountMenu {shell} includeNavigation />
      {:else}
        <nav class="fm-app-shell__nav fm-app-shell__nav--primary" aria-label={APP_SHELL_CONTRACT.navLabel}>
          {#each primarySurfaces.filter(surface => surface.allowed) as surface}
            <a class="fm-app-shell__nav-item" href={surface.href} aria-current={surface.active ? 'page' : undefined} data-testid={surface.testId}>{surface.label}</a>
          {/each}
        </nav>
        <AccountMenu {shell} />
      {/if}
    </header>
  {/if}


  <div
    id={APP_SHELL_CONTRACT.mainTargetId}
    data-testid={APP_SHELL_CONTRACT.mainTargetTestId}
    tabindex="-1"
  >
    <slot />
  </div>
</div>

<style>
  .fm-app-shell__topbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .fm-app-shell__nav--primary { display: flex; flex-wrap: nowrap; border: 0; padding: 0; gap: 0; }
  .fm-app-shell__nav-item { padding-inline: clamp(6px, 2vw, 16px); }
  .fm-app-shell__game-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  :global(.fm-app-shell[data-surface="player"]) { --fm-app-topbar-block-size: 0px; }
</style>
