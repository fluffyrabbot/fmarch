<script>
  import "../styles/app.css";
  import { APP_SHELL_CONTRACT } from "./app-shell-model.mjs";
  import { activePhaseTheme } from "./phase-theme.mjs";

  export let shell;

  $: phaseTheme = $activePhaseTheme ?? shell.phase ?? undefined;
</script>

<div
  class="fm-app-shell"
  data-component={APP_SHELL_CONTRACT.component}
  data-surface={shell.activeSurface}
  data-phase={phaseTheme}
>
  <a
    class="fm-skip-link"
    href={`#${APP_SHELL_CONTRACT.mainTargetId}`}
    data-testid={APP_SHELL_CONTRACT.skipLinkTestId}
  >
    {APP_SHELL_CONTRACT.skipLinkLabel}
  </a>
  <header
    class="fm-app-shell__topbar"
    data-testid={APP_SHELL_CONTRACT.topbarTestId}
    data-topbar-mode={APP_SHELL_CONTRACT.topbarMode}
    data-sticky-top-px={APP_SHELL_CONTRACT.topbarStickyTopPx}
    data-block-size-px={APP_SHELL_CONTRACT.topbarBlockSizePx}
  >
    <a class="fm-app-shell__brand" href="/">fmarch</a>
    <nav class="fm-app-shell__nav" aria-label={APP_SHELL_CONTRACT.navLabel}>
      {#each shell.surfaces as surface}
        {#if surface.navigation === "link"}
          <a
            class="fm-app-shell__nav-item"
            href={surface.href}
            aria-current={surface.active ? "page" : undefined}
            data-allowed={surface.allowed}
            data-capability={surface.capabilityLabel}
            data-min-touch-target-px={surface.minTouchTargetPx}
            data-testid={surface.testId}
          >
            <span class="fm-app-shell__nav-label">{surface.label}</span>
            <small class="fm-app-shell__nav-capability">{surface.accessLabel}</small>
          </a>
        {:else}
          <button
            type="button"
            class="fm-app-shell__nav-item"
            aria-current={surface.active ? "page" : undefined}
            aria-disabled={surface.ariaDisabled}
            data-allowed={surface.allowed}
            data-min-touch-target-px={surface.minTouchTargetPx}
            data-testid={surface.testId}
            data-blocked-reason={surface.blockedReason}
            disabled
          >
            <span class="fm-app-shell__nav-label">{surface.label}</span>
            <small class="fm-app-shell__nav-reason">{surface.blockedLabel}</small>
          </button>
        {/if}
      {/each}
    </nav>
    <div
      class="fm-app-shell__session"
      data-testid={shell.session.testId}
      data-state={shell.session.state}
      data-capability-count={shell.session.capabilityCount}
    >
      <span data-testid={shell.session.principalTestId}>{shell.session.principalLabel}</span>
      <small>
        <span data-testid={shell.session.gameTestId}>{shell.session.gameLabel}</span>
        <span aria-hidden="true">/</span>
        <span data-testid={shell.session.capabilityTestId}>{shell.session.capabilitySummary}</span>
      </small>
    </div>
  </header>

  <div
    id={APP_SHELL_CONTRACT.mainTargetId}
    data-testid={APP_SHELL_CONTRACT.mainTargetTestId}
    tabindex="-1"
  >
    <slot />
  </div>
</div>
