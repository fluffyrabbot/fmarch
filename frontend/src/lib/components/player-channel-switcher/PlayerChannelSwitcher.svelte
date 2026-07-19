<script>
  import {
    buildPlayerChannelSwitcherViewModel,
  } from "./player-channel-switcher-model.mjs";

  export let channels = [];

  $: view = buildPlayerChannelSwitcherViewModel({ channels });
</script>

<nav
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
  data-testid={view.root.testId}
>
  {#each view.channels as channel}
    <a
      class="player-channel-switcher__channel"
      href={channel.href}
      aria-current={channel.ariaCurrent}
      data-testid={`player-channel-${channel.id}`}
      data-channel-capability={channel.capabilityLabel}
      data-min-touch-target-px={channel.minTouchTargetPx}
    >
      <span>{channel.label}</span>
      <small>{channel.stateLabel}</small>
    </a>
  {/each}
</nav>

<style>
  .player-channel-switcher {
    display: grid;
    gap: 10px;
    grid-area: channels;
    grid-template-columns: repeat(
      auto-fit,
      minmax(min(160px, 100%), 1fr)
    );
    min-inline-size: 0;
  }

  .player-channel-switcher__channel {
    align-content: center;
    background: var(--fm-raised-veil);
    border: 1px solid var(--fm-line);
    border-radius: 8px;
    color: var(--fm-ink);
    display: grid;
    gap: 2px;
    min-block-size: 52px;
    min-inline-size: 0;
    padding: 8px 12px;
    text-decoration: none;
  }

  .player-channel-switcher__channel[aria-current="page"] {
    background: var(--fm-accent-wash-strong);
    border-color: var(--fm-accent);
  }

  .player-channel-switcher__channel span {
    font-weight: 800;
    overflow-wrap: anywhere;
  }

  .player-channel-switcher__channel small {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 700;
  }
</style>
