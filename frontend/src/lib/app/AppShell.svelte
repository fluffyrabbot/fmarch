<script>
  import "../styles/app.css";
  import AccountMenu from "./AccountMenu.svelte";
  import { APP_SHELL_CONTRACT } from "./app-shell-model.mjs";
  import { getContext } from "svelte";
  import { readable } from "svelte/store";
  import { THEME_CONTEXT } from "./theme-context.mjs";
  import { resolveTheme } from "./theme.mjs";
  import { page } from "$app/stores";

  // Quick appearance switch: the same validated /appearance action, returning here.
  const QUICK_SCHEMES = Object.freeze([
    Object.freeze({ id: "light", label: "Day" }),
    Object.freeze({ id: "game", label: "Game" }),
    Object.freeze({ id: "dark", label: "Night" }),
  ]);

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
  data-game-bar-owned={shell.gameBarOwned ? "true" : undefined}
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
        <form class="fm-app-shell__daylight" method="POST" action="/appearance" aria-label="Day or night" data-testid="app-shell-daylight">
          <input type="hidden" name="themeId" value={theme.themeId} />
          <!-- An error page never echoes the path it refused; the switch returns to Games. -->
          <input type="hidden" name="return_to" value={$page.error ? "/" : `${$page.url.pathname}${$page.url.search}`} />
          {#each QUICK_SCHEMES as option}
            <button
              class="fm-app-shell__daylight-option"
              type="submit"
              name="scheme"
              value={option.id}
              aria-pressed={theme.preference === option.id ? "true" : "false"}
              title={option.id === "game" ? "Follow the game clock" : `Always ${option.label.toLowerCase()}`}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
                {#if option.id === "light"}<circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                {:else if option.id === "dark"}<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
                {:else}<circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" />{/if}
              </svg>
              <span>{option.label}</span>
            </button>
          {/each}
        </form>
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
  .fm-app-shell__daylight { background: var(--fm-ground); border: 1px solid var(--fm-line); border-radius: 999px; display: inline-flex; flex: none; gap: 2px; margin: 0 0 0 auto; padding: 3px; }
  .fm-app-shell__daylight-option { align-items: center; background: transparent; border: 0; border-radius: 999px; color: var(--fm-ink-muted); cursor: pointer; display: inline-flex; font: inherit; font-size: 13px; font-weight: 800; gap: 5px; min-block-size: 36px; padding: 0 12px; }
  .fm-app-shell__daylight-option:hover { background: var(--fm-surface-muted); color: var(--fm-ink); }
  .fm-app-shell__daylight-option[aria-pressed="true"] { background: var(--fm-accent); color: var(--fm-raised); }
  .fm-app-shell__daylight-option svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.2; }
  @media (max-width: 560px) {
    /* Phones reach appearance through the account menu; the nav keeps the room. */
    .fm-app-shell__daylight { display: none; }
    .fm-app-shell__topbar { gap: 6px; padding-inline: 10px; }
    .fm-app-shell__nav-item { font-size: 14px; padding-inline: 4px; }
  }
  @media (max-width: 560px) { :global(.fm-app-shell:not([data-game-bar-owned])) { --fm-app-topbar-block-size: 60px; } }
  @media (forced-colors: active) { .fm-app-shell__daylight-option[aria-pressed="true"] { outline: 2px solid Highlight; } }
  /* One row at every width: the primary nav takes the room the switch and
     account menu leave and scrolls rather than letting labels overlap. */
  .fm-app-shell__nav--primary { flex: 1 1 auto; min-inline-size: 0; overflow-x: auto; scrollbar-width: none; }
  .fm-app-shell__nav--primary .fm-app-shell__nav-item { flex: none; white-space: nowrap; }
  /* A game surface's own bar is the top bar: the player's game bar and the
     host console's bar both carry the account menu, so nothing sits above. */
  :global(.fm-app-shell[data-game-bar-owned]) { --fm-app-topbar-block-size: 0px; }
</style>
