<script>
  import AccountMenu from "$lib/app/AccountMenu.svelte";
  export let shell = null;
  import { onMount } from "svelte";
  import { deadlineCountdown } from "$lib/app/deadline-countdown.mjs";
  import { capabilityEvidence } from "$lib/app/capabilities.mjs";
  import { capabilitySentence } from "$lib/app/presentation-copy.mjs";

  export let game;
  export let phase = {};
  export let composer = {};
  export let votecount = [];
  export let liveStatus = null;
  export let player = {};
  /** "day", "night", "twilight" or null before the first phase. */
  export let phaseKind = null;
  /** Open day events the player can join or leave; one becomes a bar notice. */
  export let dayEvents = [];
  /** `{ value }` for the night action's sent state, or null when none applies. */
  export let nightAction = null;
  /** The vote facts reveal the vote surface (a sheet below the rail width);
      the anchor stays for readers without scripting. */
  export let onOpenVote = (invoker) => {};

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
  $: hasVote = currentVote !== "" && currentVote !== "No current vote";
  let now = Date.now();
  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 30_000);
    return () => clearInterval(timer);
  });
  $: hasDeadline = typeof phase.deadlineAt === "number";
  $: countdown = deadlineCountdown(phase.deadlineAt, now);
  $: degraded = liveStatus !== null && !["connected", "updated", "recovered"].includes(liveStatus.state);
  // The facts follow the phase: by day a player checks their vote first, then
  // the clock; by night the clock, then whether their action went through.
  // Phones show only the first fact.
  $: nightFacts = phaseKind === "night";
  $: voteFacts = phaseKind === "day" || phaseKind === "twilight";
  $: events = Array.isArray(dayEvents) ? dayEvents : [];
  $: eventNotice = events.length === 0
    ? null
    : events.length === 1 ? String(events[0].label ?? "Open event") : `${events.length} open events`;
</script>

<header class="game-bar" data-testid="player-game-bar" data-phase-kind={phaseKind ?? undefined}>
  <div class="game-bar__identity">
    <span>{game.label}</span>
    <h1>{phase.label}</h1>
    <span
      class="fm-sr-only"
      data-testid="player-capability"
      data-capability-kind={capabilityEvidence(player.capability).kind}
      data-capability-scope={capabilityEvidence(player.capability).scope}
    >{capabilitySentence(player.capability, { gameTitle: game.label })}</span>
  </div>
  <div class="game-bar__side">
    <div class="game-bar__facts" aria-label="Current game state">
      {#if voteFacts && composer.currentVoteLabel}
        <a href="#player-actions" data-testid="player-game-bar-current-vote" data-has-vote={String(hasVote)} on:click|preventDefault={(event) => onOpenVote(event.currentTarget)}>
          <span>Your vote</span>
          <strong>{hasVote ? currentVote : "None yet"}</strong>
        </a>
      {/if}
      {#if hasDeadline}
        <a
          href="#player-actions"
          data-testid="player-game-bar-deadline"
          data-state={phase.state}
          data-projected="true"
          on:click|preventDefault={(event) => onOpenVote(event.currentTarget)}
        >
          <span>Deadline</span>
          {#if countdown}
            <strong title={phase.deadlineLabel}>{countdown}</strong>
            <span class="fm-sr-only">{phase.deadlineLabel}</span>
          {:else}
            <strong>{phase.deadlineLabel}</strong>
          {/if}
        </a>
      {/if}
      {#if nightFacts && nightAction}
        <a href="#player-phase-actions" data-testid="player-game-bar-night-action" on:click|preventDefault={(event) => onOpenVote(event.currentTarget, "actions")}>
          <span>Night action</span>
          <strong>{nightAction.value}</strong>
        </a>
      {:else if voteFacts && voteProgress}
        <a href="#player-actions" data-testid="player-game-bar-vote-progress" class="game-bar__fact--wide" on:click|preventDefault={(event) => onOpenVote(event.currentTarget)}>
          <span>Leading count</span>
          <strong>{voteProgress}</strong>
        </a>
      {/if}
    </div>
    {#if eventNotice}
      <a class="game-bar__notice" href="#player-day-events" data-testid="player-game-bar-events" data-event-count={events.length}>
        <span>{eventNotice}</span>
      </a>
    {/if}
    {#if degraded}
      <p class="game-bar__connection" data-state={liveStatus.state} data-testid="player-live-status">
        {liveStatus.state === "connecting" ? "Reconnecting…" : liveStatus.message}
      </p>
    {/if}
    {#if shell}<AccountMenu {shell} includeNavigation />{/if}
  </div>
  <slot />
</header>

<style>
  .game-bar {
    align-items: center;
    background: var(--fm-raised);
    border-block-end: 1px solid var(--fm-line);
    display: grid;
    gap: 8px 16px;
    grid-template-columns: minmax(0, 1fr) auto;
    position: sticky;
    top: var(--fm-app-topbar-block-size);
    margin-block-end: 8px;
    z-index: 11;
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

  .game-bar__side {
    align-items: center;
    display: flex;
    gap: 12px;
    min-inline-size: 0;
  }

  .game-bar__facts {
    align-items: stretch;
    display: flex;
    gap: 4px;
  }

  .game-bar__facts a {
    align-content: center;
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink);
    display: grid;
    min-block-size: 48px;
    min-inline-size: 104px;
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

  .game-bar__notice {
    align-items: center;
    background: var(--fm-accent-wash);
    border: 1px solid var(--fm-accent);
    border-radius: 999px;
    color: var(--fm-accent-ink);
    display: inline-flex;
    font-size: 13px;
    font-weight: 800;
    min-block-size: 36px;
    padding: 0 12px;
    text-decoration: none;
    white-space: nowrap;
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

  @media (max-width: 900px) {
    .game-bar__fact--wide {
      display: none;
    }
  }

  @media (max-width: 680px) {
    .game-bar {
      gap: 6px 8px;
      min-block-size: 60px;
      padding-block: 6px;
    }

    .game-bar__side {
      gap: 8px;
    }

    .game-bar h1 {
      font-size: 22px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .game-bar__facts a {
      min-inline-size: 0;
      padding-inline: 8px;
    }

    /* One fact on a phone: the first one for the phase. */
    .game-bar__facts a:not(:first-child) {
      display: none;
    }

    .game-bar__notice {
      font-size: 12px;
      padding-inline: 10px;
    }

    .game-bar__connection {
      grid-column: 1 / -1;
      max-inline-size: none;
      text-align: start;
    }
  }
</style>
