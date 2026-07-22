<section class="context-sheet" id="player-context" data-testid="player-context-sheet">
  <header>
    <p class="fm-eyebrow">Your game</p>
    <h2>Private context and history</h2>
  </header>
  <div class="context-sheet__content">
    <slot />
  </div>
</section>

<style>
  .context-sheet {
    border-block-start: 1px solid var(--fm-line-strong);
    display: grid;
    gap: 14px;
    padding-block-start: 22px;
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + 16px);
  }

  .context-sheet h2,
  .context-sheet p {
    margin: 0;
  }

  .context-sheet__content {
    display: grid;
    gap: 12px;
  }
</style>
