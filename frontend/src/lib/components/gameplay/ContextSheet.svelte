<script>
  /** In the rail the role card and Messages carry their own headings. */
  export let layout = "flow";
</script>

<section class="context-sheet" id="player-context" tabindex="-1" aria-label="More" data-testid="player-context-sheet">
  {#if layout !== "rail"}
    <header>
      <h2>More</h2>
    </header>
  {/if}
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
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + var(--fm-game-bar-block-size, 0px) + 16px);
  }

  :global(dialog.player-sheet) .context-sheet,
  :global(.player-sheet--rail) .context-sheet {
    border-block-start: 0;
    padding-block-start: 4px;
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
