<script>
  // One surface, three topologies (usage-frequency audit, decision 9).
  // "sheet": a native modal <dialog> rising from the bottom edge; Escape,
  // the backdrop, a swipe down on the grip and the Close control dismiss it,
  // and focus returns to the control that opened it. "rail": a plain panel
  // in the sticky desktop rail. "flow": the server/no-JavaScript shape, an
  // ordinary section in document order.
  import { tick } from "svelte";

  export let layout = "flow";
  export let open = false;
  export let label;
  export let testId;
  /** The control that opened the sheet; focus returns there on close. */
  export let returnTo = null;
  /** Selectors tried in order for the element to focus once opened. */
  export let focusSelectors = [];
  export let onClose = () => {};

  const SWIPE_CLOSE_PX = 72;
  let dialog = null;
  let panel = null;
  let dragStart = null;
  let dragOffset = 0;
  let dragging = false;

  $: if (dialog) void sync(layout === "sheet" && open);

  async function sync(shouldOpen) {
    await tick();
    if (!dialog) return;
    if (shouldOpen && !dialog.open) {
      dialog.showModal();
      pinDetent();
      focusInitial();
    } else if (!shouldOpen && dialog.open) {
      dialog.close();
    }
  }

  // The sheet rises from the bottom edge, so a content-sized panel would move
  // its top edge every time something inside grew or shrank (an armed
  // confirmation, a filtered list, a live delivery). Pin the height the sheet
  // opened with; later changes scroll inside the body instead.
  function pinDetent() {
    if (!panel) return;
    panel.style.blockSize = "";
    panel.style.blockSize = `${Math.ceil(panel.getBoundingClientRect().height)}px`;
  }

  function focusInitial() {
    for (const selector of focusSelectors) {
      const target = dialog.querySelector(selector);
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView?.({ block: "nearest" });
        return;
      }
    }
  }

  function closed() {
    dragStart = null;
    dragOffset = 0;
    dragging = false;
    if (panel) {
      panel.style.blockSize = "";
      panel.style.transform = "";
    }
    const target = returnTo;
    if (target?.isConnected) target.focus({ preventScroll: true });
    onClose();
  }

  function closeFromBackdrop(event) {
    if (event.target === dialog) dialog.close();
  }

  function dragBegin(event) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // A press on Close is a click, not the start of a swipe: capturing the
    // pointer here would retarget its release and the click would never
    // reach the button.
    if (event.target.closest("button, a, input, select, textarea")) return;
    dragStart = event.clientY;
    dragOffset = 0;
    dragging = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  // The drag offset is written as a CSSOM property, never a style attribute:
  // the release baseline keeps inline style out of component markup.
  function applyDrag() {
    if (panel) panel.style.transform = dragOffset > 0 ? `translateY(${dragOffset}px)` : "";
  }

  function dragMove(event) {
    if (dragStart === null) return;
    dragOffset = Math.max(0, event.clientY - dragStart);
    applyDrag();
  }

  function dragEnd() {
    if (dragStart === null) return;
    const offset = dragOffset;
    dragStart = null;
    dragging = false;
    dragOffset = 0;
    applyDrag();
    if (offset >= SWIPE_CLOSE_PX) dialog.close();
  }
</script>

{#if layout === "sheet"}
  <dialog
    class="player-sheet"
    bind:this={dialog}
    aria-label={label}
    data-testid={testId}
    data-layout={layout}
    on:close={closed}
    on:click={closeFromBackdrop}
  >
    <div
      class="player-sheet__panel"
      bind:this={panel}
      class:player-sheet__panel--dragging={dragging}
    >
      <div
        class="player-sheet__head"
        on:pointerdown={dragBegin}
        on:pointermove={dragMove}
        on:pointerup={dragEnd}
        on:pointercancel={dragEnd}
      >
        <span class="player-sheet__grip" aria-hidden="true" data-testid={`${testId}-grip`}></span>
        <form method="dialog">
          <button class="player-sheet__close" type="submit" aria-label={`Close ${label}`} data-testid={`${testId}-close`}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </form>
      </div>
      <div class="player-sheet__body" data-scroll-container>
        <slot />
      </div>
    </div>
  </dialog>
{:else}
  <div class="player-sheet player-sheet--{layout}" data-testid={testId} data-layout={layout}>
    <slot />
  </div>
{/if}

<style>
  dialog.player-sheet {
    background: transparent;
    border: 0;
    box-sizing: border-box;
    color: var(--fm-ink);
    inline-size: 100%;
    inset: auto 0 0 0;
    margin: 0;
    max-block-size: calc(100svh - 40px);
    max-inline-size: none;
    overflow: visible;
    padding: 0;
  }

  dialog.player-sheet::backdrop {
    background: color-mix(in srgb, var(--fm-ink) 45%, transparent);
  }

  .player-sheet__panel {
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-strong);
    border-block-end: 0;
    border-start-end-radius: 18px;
    border-start-start-radius: 18px;
    box-shadow: var(--fm-shadow-floating);
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    margin-inline: auto;
    max-block-size: calc(100svh - 40px);
    max-inline-size: 720px;
    padding-block-end: env(safe-area-inset-bottom);
    transition: transform 160ms ease-out;
  }

  .player-sheet__panel--dragging {
    transition: none;
  }

  .player-sheet__head {
    align-items: center;
    cursor: grab;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 52px;
    padding: 6px 10px 0 10px;
    touch-action: none;
  }

  .player-sheet__grip {
    background: var(--fm-line-strong);
    block-size: 5px;
    border-radius: 999px;
    inline-size: 44px;
    justify-self: center;
  }

  .player-sheet__head form {
    margin: 0;
  }

  .player-sheet__close {
    align-items: center;
    background: transparent;
    block-size: 44px;
    border: 1px solid var(--fm-line-strong);
    border-radius: 999px;
    color: var(--fm-ink);
    cursor: pointer;
    display: inline-flex;
    inline-size: 44px;
    justify-content: center;
  }

  .player-sheet__close:hover,
  .player-sheet__close:focus-visible {
    background: var(--fm-surface-muted);
  }

  .player-sheet__close svg {
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-width: 2.4;
  }

  .player-sheet__body {
    min-block-size: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 18px 20px;
  }

  .player-sheet--rail,
  .player-sheet--flow {
    display: grid;
    min-inline-size: 0;
  }

  @media (prefers-reduced-motion: no-preference) {
    dialog.player-sheet[open] .player-sheet__panel:not(.player-sheet__panel--dragging) {
      animation: player-sheet-rise 180ms ease-out;
    }
  }

  @keyframes player-sheet-rise {
    from { transform: translateY(24px); opacity: 0.6; }
  }
</style>
