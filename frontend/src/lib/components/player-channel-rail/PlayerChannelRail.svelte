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
      class="player-channel-rail__channel fm-rail__item"
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
