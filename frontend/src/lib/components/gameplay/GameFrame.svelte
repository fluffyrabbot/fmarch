<main class="game-frame player-surface" data-testid="player-surface">
  <slot name="bar" />
  <div class="game-frame__workspace">
    <slot name="channels" />
    <div class="game-frame__reading-lane">
      <slot />
    </div>
  </div>
  <slot name="dock" />
</main>

<style>
  .game-frame {
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

  .game-frame__reading-lane {
    display: grid;
    gap: 26px;
    margin-inline: auto;
    max-inline-size: 760px;
    min-inline-size: 0;
    padding-block: 0 44px;
    width: 100%;
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
</style>
