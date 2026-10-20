<script>
  export let view;
  export let commandsAvailable = false;
  export let privateNewCount = null;
  export let onOpenVotePicker = () => {};
  export let onOpenPrivateQueue = () => {};
  export let dayEventCount = 0;

  $: votePicker = view?.votePicker ?? null;
  $: hasPhaseActions = (view?.composer?.actionPicker?.actions?.length ?? 0) > 0;

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
  aria-label={commandsAvailable ? "Player actions" : "Player navigation"}
  data-commands-available={commandsAvailable}
  aria-busy={commandsAvailable ? view?.root?.ariaBusy : undefined}
  data-component="player-action-dock"
  data-channel-id={view?.root?.data?.channelId}
  data-thumb-zone="player-primary-actions"
  data-action-priority="primary"
  data-testid="player-primary-action-zone"
>
  <a
    class="action-dock__vote"
    class:action-dock__vote--cast={votePicker?.hasVote === true}
    href="#player-actions"
    data-testid="player-dock-vote"
    data-has-vote={String(votePicker?.hasVote === true)}
    on:click|preventDefault={onOpenVotePicker}
  >
    <span>{commandsAvailable ? votePicker?.dock.label ?? "Vote" : "Votes"}</span>
  </a>
  {#if commandsAvailable && view?.composer?.readOnly !== true}
    <a
      class="action-dock__tool"
      href="#player-composer"
      data-testid="player-dock-reply"
      on:click={() => focusDestination("player-composer")}
    >
      <span>Reply</span>
    </a>
  {/if}
  {#if commandsAvailable && hasPhaseActions}
    <a class="action-dock__tool" href="#player-phase-actions" data-testid="player-dock-act">
      <span>Act</span>
    </a>
  {/if}
  {#if commandsAvailable && dayEventCount > 0}
    <a class="action-dock__tool" href="#player-day-events" data-testid="player-dock-events">
      <span>Event</span>
      <strong aria-label={`${dayEventCount} open events`}>{dayEventCount}</strong>
    </a>
  {/if}
  <a class="action-dock__tool" href="#player-private-queue" data-testid="player-dock-more"
    aria-label={privateNewCount === null ? "More: your role, messages and history" : `More: ${privateNewCount} new ${privateNewCount === 1 ? "message" : "messages"}`}
    on:click|preventDefault={onOpenPrivateQueue}>
    <span>More</span>
    {#if privateNewCount > 0}<strong aria-hidden="true" data-testid="player-private-new-count">{privateNewCount}</strong>{/if}
  </a>
</nav>

<style>
  .action-dock {
    align-items: stretch;
    backdrop-filter: blur(14px);
    background: var(--fm-topbar-veil);
    border: 1px solid var(--fm-line-strong);
    border-radius: var(--fm-radius-panel);
    bottom: calc(10px + env(safe-area-inset-bottom));
    box-shadow: var(--fm-shadow-floating);
    display: flex;
    gap: 4px;
    inset-inline: max(12px, calc((100vw - 920px) / 2));
    min-block-size: 58px;
    min-inline-size: 0;
    padding: 6px;
    position: fixed;
    z-index: 12;
  }

  .action-dock__vote,
  .action-dock__tool {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--fm-radius-control);
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

  .action-dock__vote {
    background: var(--fm-ink);
    color: var(--fm-action-ink);
    flex: 1 1 auto;
    min-inline-size: 0;
  }

  .action-dock__vote span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .action-dock__vote--cast {
    background: transparent;
    border: 1px solid var(--fm-ink);
    color: var(--fm-ink);
  }

  .action-dock__tool {
    gap: 6px;
  }

  .action-dock__tool strong {
    align-items: center;
    background: var(--fm-accent);
    border-radius: 999px;
    color: var(--fm-action-ink);
    display: inline-flex;
    font-size: 11px;
    justify-content: center;
    min-block-size: 20px;
    min-inline-size: 20px;
  }

  @media (max-width: 560px) {
    .action-dock {
      border-radius: var(--fm-radius-dock);
      inset-inline: 8px;
      flex-wrap: wrap;
    }

    .action-dock__vote {
      flex-basis: 100%;
    }

    .action-dock__vote,
    .action-dock__tool {
      font-size: 12px;
      min-inline-size: 44px;
      padding-inline: 6px;
    }

  }
</style>
