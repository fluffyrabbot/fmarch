<script>
  export let game;
  export let phase = {};
  export let composer = {};
  export let votecount = [];
  export let liveStatus = null;
  export let player = {};

  $: voteRows = Array.isArray(votecount) ? votecount : [];
  $: leadingVote = voteRows.reduce(
    (best, row) => Number(row?.count ?? 0) > Number(best?.count ?? 0) ? row : best,
    null,
  );
  $: voteProgress = leadingVote === null
    ? null
    : `${Number(leadingVote.count ?? 0)}/${Number(leadingVote.needed ?? 0)} votes`;
  $: currentVote = String(composer.currentVoteLabel ?? "")
    .replace(/^Current vote:\s*/u, "")
    .trim();
  $: degraded = liveStatus !== null && !["connected", "updated", "recovered"].includes(liveStatus.state);
</script>

<header class="game-bar" data-testid="player-game-bar">
  <div class="game-bar__identity">
    <span>{game.label}</span>
    <h1>{phase.label}</h1>
    <span class="fm-sr-only" data-testid="player-capability">{player.capabilityLabel}</span>
  </div>
  <div class="game-bar__facts" aria-label="Current game state">
    {#if phase.deadlineLabel}
      <a
        href="#player-actions"
        data-testid="player-game-bar-deadline"
        data-state={phase.state}
        data-projected="true"
      >
        <span>Deadline</span>
        <strong>{phase.deadlineLabel}</strong>
      </a>
    {/if}
    {#if voteProgress}
      <a href="#player-actions" data-testid="player-game-bar-vote-progress">
        <span>Leading count</span>
        <strong>{voteProgress}</strong>
      </a>
    {/if}
    {#if currentVote !== "" && currentVote !== "No current vote"}
      <a href="#player-actions" data-testid="player-game-bar-current-vote">
        <span>Your vote</span>
        <strong>{currentVote}</strong>
      </a>
    {/if}
  </div>
  {#if degraded}
    <p class="game-bar__connection" data-state={liveStatus.state} data-testid="player-live-status">
      {liveStatus.state === "connecting" ? "Reconnecting…" : liveStatus.message}
    </p>
  {/if}
</header>

<style>
  .game-bar {
    align-items: center;
    background: var(--fm-raised-veil);
    border-block-end: 1px solid var(--fm-line);
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(0, 1fr) auto auto;
    min-block-size: 76px;
    padding: 10px clamp(14px, 3vw, 30px);
  }

  .game-bar__identity {
    display: grid;
    gap: 1px;
    min-inline-size: 0;
  }

  .game-bar__identity > span {
    color: var(--fm-ink-subtle);
    font-size: 11px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .game-bar h1 {
    color: var(--fm-ink);
    font-family: var(--fm-font-display);
    font-size: clamp(24px, 3vw, 32px);
    line-height: 1;
    margin: 0;
  }

  .game-bar__facts {
    align-items: stretch;
    display: flex;
    gap: 4px;
  }

  .game-bar__facts a {
    align-content: center;
    border-radius: 8px;
    color: var(--fm-ink);
    display: grid;
    min-block-size: 48px;
    min-inline-size: 116px;
    padding: 5px 10px;
    text-decoration: none;
  }

  .game-bar__facts a:focus-visible {
    background: var(--fm-surface-muted);
  }

  .game-bar__facts span {
    color: var(--fm-ink-subtle);
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .game-bar__facts strong {
    font-size: 13px;
    overflow-wrap: anywhere;
  }

  .game-bar__connection {
    color: var(--fm-pending);
    font-size: 12px;
    font-weight: 800;
    margin: 0;
    max-inline-size: 120px;
    text-align: end;
  }

  .game-bar__connection[data-state="error"],
  .game-bar__connection[data-state="closed"] {
    color: var(--fm-danger-ink);
  }

  @media (max-width: 680px) {
    .game-bar {
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) auto;
      min-block-size: 60px;
      padding-block: 6px;
      position: relative;
    }

    .game-bar__facts a {
      min-inline-size: 0;
      padding-inline: 8px;
    }

    .game-bar__facts a:not(:last-child) {
      display: none;
    }

    .game-bar__connection {
      font-size: 0;
      inset-block-end: 7px;
      inset-inline-start: 14px;
      max-inline-size: 12px;
      position: absolute;
    }

    .game-bar__connection::before {
      block-size: 9px;
      background: currentColor;
      border-radius: 999px;
      content: "";
      display: block;
      inline-size: 9px;
    }
  }
</style>
