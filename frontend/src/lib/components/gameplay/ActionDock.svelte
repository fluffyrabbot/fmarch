<script>
  export let view;
  export let privateCount = 0;
  export let dayEventCount = 0;
  export let onCommand = () => {};

  $: quickActions = view?.quickActions?.buttons ?? [];
  $: hasPhaseActions = (view?.composer?.actionPicker?.actions?.length ?? 0) > 0 ||
    (view?.composer?.actionPicker?.recoveryCommands?.length ?? 0) > 0;

  function focusDestination(destinationId) {
    window.setTimeout(() => {
      const destination = document.getElementById(destinationId);
      const focusTarget = destination?.querySelector("textarea, input, button, [tabindex]");
      focusTarget?.focus();
    });
  }
</script>

<nav
  class="action-dock"
  aria-label="Player actions"
  aria-busy={view?.root?.ariaBusy}
  data-component="player-action-dock"
  data-thumb-zone="player-primary-actions"
  data-action-priority="primary"
  data-testid="player-primary-action-zone"
>
  <div class="action-dock__actions" data-testid="player-quick-vote-actions">
    {#each quickActions as button}
      {#if !button.disabled || button.action === "withdraw_vote"}
        <button
          type="button"
          class:action-dock__primary={button.className === "fm-touch-button"}
          data-action={button.action}
          data-command-recovery-return={button.action}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          data-disabled-reason={button.reason}
          disabled={button.disabled}
          aria-disabled={button.disabled ? "true" : undefined}
          on:click={() => onCommand(button.action)}
        >
          {button.label}
        </button>
      {/if}
    {/each}
  </div>
  {#if view?.composer?.readOnly !== true}
    <a
      class="action-dock__tool"
      href="#player-composer"
      data-testid="player-dock-reply"
      on:click={() => focusDestination("player-composer")}
    >
      <span>Reply</span>
    </a>
  {/if}
  {#if hasPhaseActions}
    <a class="action-dock__tool" href="#player-phase-actions" data-testid="player-dock-act">
      <span>Act</span>
    </a>
  {/if}
  {#if dayEventCount > 0}
    <a class="action-dock__tool" href="#player-day-events" data-testid="player-dock-events">
      <span>Event</span>
      <strong aria-label={`${dayEventCount} open events`}>{dayEventCount}</strong>
    </a>
  {/if}
  <a class="action-dock__tool" href="#player-actions" data-testid="player-dock-count">
    <span>Count</span>
  </a>
  <a class="action-dock__tool" href="#player-context" data-testid="player-dock-more">
    <span>More</span>
    {#if privateCount > 0}<strong aria-label={`${privateCount} private items`}>{privateCount}</strong>{/if}
  </a>
</nav>

<style>
  .action-dock {
    align-items: stretch;
    backdrop-filter: blur(14px);
    background: var(--fm-topbar-veil);
    border: 1px solid var(--fm-line-strong);
    border-radius: 12px;
    bottom: calc(10px + env(safe-area-inset-bottom));
    box-shadow: 0 12px 38px color-mix(in srgb, var(--fm-ground) 36%, transparent);
    display: flex;
    gap: 4px;
    inset-inline: max(12px, calc((100vw - 920px) / 2));
    min-block-size: 58px;
    min-inline-size: 0;
    padding: 6px;
    position: fixed;
    z-index: 12;
  }

  .action-dock__actions {
    display: flex;
    flex: 1 1 auto;
    gap: 4px;
    min-inline-size: 0;
    overflow-x: auto;
  }

  .action-dock button,
  .action-dock__tool {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 8px;
    color: var(--fm-ink);
    display: inline-flex;
    flex: 0 0 auto;
    font: inherit;
    font-size: 13px;
    font-weight: 850;
    justify-content: center;
    min-block-size: 44px;
    min-inline-size: 64px;
    padding: 8px 12px;
    text-decoration: none;
  }

  .action-dock button {
    border: 1px solid var(--fm-line-strong);
  }

  .action-dock button.action-dock__primary {
    background: var(--fm-ink);
    border-color: var(--fm-ink);
    color: var(--fm-on-dark);
  }

  .action-dock button:disabled {
    display: none;
  }

  .action-dock__tool {
    gap: 6px;
  }

  .action-dock__tool strong {
    align-items: center;
    background: var(--fm-accent);
    border-radius: 999px;
    color: var(--fm-on-dark);
    display: inline-flex;
    font-size: 11px;
    justify-content: center;
    min-block-size: 20px;
    min-inline-size: 20px;
  }

  @media (max-width: 560px) {
    .action-dock {
      border-radius: 10px;
      inset-inline: 8px;
    }

    .action-dock button,
    .action-dock__tool {
      font-size: 12px;
      min-inline-size: 44px;
      padding-inline: 6px;
    }

    .action-dock__tool[data-testid="player-dock-count"],
    .action-dock__tool[data-testid="player-dock-more"] {
      display: none;
    }
  }
</style>
