<script>
  import { onMount } from "svelte";
  /** "flow" (server/no-JavaScript), "sheet" (below the rail width) or "rail". */
  export let layout = "flow";
  /** The surface this frame carries: the player workspace or the host console. */
  export let surfaceTestId = "player-surface";
  export let surfaceClass = "";
  export let component = null;
  export let gameId = null;
  export let railTestId = "player-rail";
  export let railLabel = "Game state";
  /** False for a surface with no bottom dock, so no bottom clearance is reserved. */
  export let dock = true;
  let frame;
  onMount(() => {
    const bar = frame.querySelector("[data-game-bar]");
    if (!bar) return;
    const measure = () => frame.style.setProperty("--fm-game-bar-block-size", `${bar.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  });
</script>

<main
  bind:this={frame}
  class="game-frame player-surface {surfaceClass}"
  data-testid={surfaceTestId}
  data-component={component ?? undefined}
  data-game={gameId ?? undefined}
  data-layout={layout}
  data-dock={dock ? undefined : "false"}
>
  <slot name="bar" />
  <div class="game-frame__workspace">
    <slot name="channels" />
    <div class="game-frame__columns">
      <div class="game-frame__reading-lane">
        <slot />
      </div>
      <!-- Below the rail width this holds the closed sheets (no box of its own);
           from the rail width up it is the sticky second column. Without
           JavaScript its sections simply follow the composer in document order. -->
      <aside class="game-frame__rail" aria-label={railLabel} data-testid={railTestId} data-scroll-container={layout === "rail" ? "" : undefined}>
        <slot name="rail" />
      </aside>
    </div>
  </div>
  <slot name="dock" />
</main>

<style>
  .game-frame {
    --fm-game-bar-block-size: 76px;
    inline-size: 100%;
    min-block-size: calc(100svh - var(--fm-app-topbar-block-size));
    overflow-x: clip;
    padding-block-end: calc(76px + env(safe-area-inset-bottom));
  }

  .game-frame__workspace {
    display: grid;
    gap: 0;
    margin-inline: auto;
    max-inline-size: 980px;
    min-inline-size: 0;
    padding-inline: clamp(14px, 3vw, 30px);
  }

  .game-frame__columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-inline-size: 0;
  }

  .game-frame__reading-lane {
    display: grid;
    gap: var(--fm-space-reading);
    margin-inline: auto;
    max-inline-size: var(--fm-reading-width);
    min-inline-size: 0;
    padding-block: 0 44px;
    width: 100%;
  }

  .game-frame__rail {
    display: grid;
    gap: 22px;
    margin-inline: auto;
    max-inline-size: var(--fm-reading-width);
    min-inline-size: 0;
    width: 100%;
  }

  .game-frame[data-layout="sheet"] .game-frame__rail {
    display: contents;
  }

  .game-frame[data-dock="false"] {
    padding-block-end: 44px;
  }

  @media (max-width: 840px) {
    .game-frame {
      min-block-size: calc(100svh - 64px);
    }

    .game-frame__workspace {
      padding-inline: 14px;
    }

    .game-frame__reading-lane {
      gap: 22px;
      padding-block-start: 0;
    }
  }

  /* Two columns from the rail width: the reading measure plus a sticky rail
     that scrolls on its own when it is taller than the viewport. */
  @media (min-width: 1100px) {
    .game-frame[data-layout="rail"] {
      padding-block-end: 44px;
    }

    .game-frame__workspace {
      max-inline-size: 1220px;
    }

    .game-frame__columns {
      column-gap: 36px;
      grid-template-columns: minmax(0, var(--fm-reading-width)) minmax(260px, 336px);
      justify-content: center;
    }

    .game-frame__reading-lane {
      margin-inline: 0;
    }

    .game-frame__rail {
      align-self: start;
      margin-inline: 0;
      max-block-size: calc(100svh - var(--fm-app-topbar-block-size) - var(--fm-game-bar-block-size, 0px) - 12px);
      max-inline-size: none;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding-block-end: 24px;
      position: sticky;
      scrollbar-gutter: stable;
      top: calc(var(--fm-app-topbar-block-size) + var(--fm-game-bar-block-size, 0px) + 12px);
    }
  }
</style>
