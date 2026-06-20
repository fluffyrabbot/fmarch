<script>
  import {
    buildPlayerChannelRailViewModel,
  } from "./player-channel-rail-model.mjs";

  export let channels = [];

  $: view = buildPlayerChannelRailViewModel({ channels });
</script>

<aside
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-component={view.root.data.component}
>
  {#each view.channels as channel}
    <a
      class="player-channel-rail__channel"
      href={channel.href}
      aria-current={channel.ariaCurrent}
      data-testid={`player-channel-${channel.id}`}
      data-min-touch-target-px={channel.minTouchTargetPx}
    >
      <span>{channel.label}</span>
      <small>{channel.capabilityLabel}</small>
    </a>
  {/each}
</aside>

<style>
  .player-channel-rail {
    display: grid;
    gap: 12px;
    min-inline-size: 0;
  }

  .player-channel-rail__channel {
    align-items: start;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid #bdc7c1;
    border-radius: 8px;
    color: #17212b;
    display: grid;
    gap: 2px;
    min-block-size: 56px;
    padding: 10px 12px;
    text-decoration: none;
  }

  .player-channel-rail__channel[aria-current="page"] {
    background: #dfeee7;
    border-color: #557f68;
  }

  .player-channel-rail__channel span {
    font-weight: 800;
  }

  .player-channel-rail__channel small {
    color: #53606f;
    overflow-wrap: anywhere;
  }

  @media (max-width: 1120px) {
    .player-channel-rail {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }

  @media (max-width: 760px) {
    .player-channel-rail {
      grid-template-columns: 1fr;
    }
  }
</style>
