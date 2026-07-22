<script>
  import { buildPlayerChannelSwitcherViewModel } from "$lib/components/player-channel-switcher/player-channel-switcher-model.mjs";

  export let channels = [];
  $: view = buildPlayerChannelSwitcherViewModel({ channels });
</script>

<nav
  class="channel-tabs"
  aria-label={view.root.ariaLabel}
  data-component="player-channel-tabs"
  data-testid={view.root.testId}
>
  {#each view.channels as channel}
    <a
      href={channel.href}
      aria-current={channel.ariaCurrent}
      data-testid={`player-channel-${channel.id}`}
      data-channel-capability={channel.capabilityLabel}
      data-min-touch-target-px={channel.minTouchTargetPx}
    >
      <span>{channel.label}</span>
      {#if channel.active}<span class="fm-sr-only">Current channel</span>{/if}
    </a>
  {/each}
</nav>

<style>
  .channel-tabs {
    border-block-end: 1px solid var(--fm-line);
    display: flex;
    gap: 6px;
    min-inline-size: 0;
    overflow-x: auto;
    padding-block: 8px;
    scrollbar-width: thin;
  }

  .channel-tabs a {
    align-items: center;
    border-block-end: 3px solid transparent;
    color: var(--fm-ink-muted);
    display: inline-flex;
    flex: 0 0 auto;
    font-size: 14px;
    font-weight: 800;
    min-block-size: 44px;
    padding-inline: 12px;
    text-decoration: none;
  }

  .channel-tabs a[aria-current="page"] {
    border-block-end-color: var(--fm-accent);
    color: var(--fm-ink);
  }
</style>
