<script>
  // A role card in a native modal dialog: focus containment, Escape and the
  // inert page come from <dialog>. The card renders bare; the dialog panel
  // wears the frame (and, in Moonlit Den, the alignment ears).
  import { tick } from "svelte";
  import RoleCard from "./RoleCard.svelte";

  export let card = null;
  export let open = false;
  export let eyebrow = "Role";
  export let onClose = () => {};
  export let testId = "role-modal";

  let dialog;
  const titleId = `role-modal-title-${Math.random().toString(36).slice(2, 8)}`;

  $: if (dialog) sync(open && card !== null);

  async function sync(shouldOpen) {
    await tick();
    if (shouldOpen && !dialog.open) dialog.showModal();
    if (!shouldOpen && dialog.open) dialog.close();
  }

  function closeFromBackdrop(event) {
    if (event.target === dialog) dialog.close();
  }
</script>

<dialog
  class="role-modal"
  bind:this={dialog}
  aria-labelledby={titleId}
  data-alignment={card?.alignment.id}
  data-testid={testId}
  on:close={() => onClose()}
  on:click={closeFromBackdrop}
>
  {#if card}
    <div class="role-modal__panel">
      <div class="role-modal__bar">
        <p class="role-modal__eyebrow" id={titleId}>{eyebrow} · {card.name}</p>
        <form method="dialog">
          <button class="role-modal__close" type="submit" aria-label="Close" data-testid={`${testId}-close`}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </form>
      </div>
      <div class="role-modal__body">
        <RoleCard card={{ ...card, variant: "full", framed: false }} />
      </div>
      <div class="role-modal__actions">
        <slot name="actions" />
        <form method="dialog">
          <button class="fm-touch-button" type="submit" data-testid={`${testId}-done`}>Done</button>
        </form>
      </div>
    </div>
  {/if}
</dialog>

<style>
  .role-modal {
    --role-ink: var(--fm-align-town);
    background: transparent;
    border: 0;
    box-sizing: border-box;
    color: var(--fm-ink);
    inline-size: min(480px, calc(100vw - 32px));
    max-block-size: calc(100svh - 32px);
    overflow: visible;
    padding: 16px 0 0;
  }
  .role-modal[data-alignment="mafia"] { --role-ink: var(--fm-align-mafia); }
  .role-modal[data-alignment="independent"] { --role-ink: var(--fm-align-independent); }
  .role-modal::backdrop { background: color-mix(in srgb, var(--fm-ink) 55%, transparent); }
  .role-modal__panel {
    background: var(--fm-raised);
    border: 2px solid var(--fm-line);
    border-radius: calc(var(--fm-radius-panel) + 4px);
    box-shadow: var(--fm-shadow-floating);
    display: flex;
    flex-direction: column;
    max-block-size: calc(100svh - 48px);
    overflow: hidden;
  }
  .role-modal__bar { align-items: center; display: flex; gap: 12px; padding: 14px 14px 0 24px; }
  .role-modal__bar form { margin: 0; }
  .role-modal__eyebrow {
    color: var(--fm-ink-muted);
    flex: 1;
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.06em;
    margin: 0;
    text-transform: uppercase;
  }
  .role-modal__close {
    align-items: center;
    background: transparent;
    block-size: 44px;
    border: 2px solid var(--fm-line);
    border-radius: 999px;
    color: var(--fm-ink);
    cursor: pointer;
    display: inline-flex;
    inline-size: 44px;
    justify-content: center;
  }
  .role-modal__close:hover { background: var(--fm-surface-muted); }
  .role-modal__close svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-width: 2.4; }
  .role-modal__body { min-block-size: 0; overflow-y: auto; padding: 10px 24px 20px; }
  .role-modal__actions {
    align-items: center;
    background: var(--fm-surface-tint);
    border-block-start: 2px solid var(--fm-line);
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    border-end-end-radius: inherit;
    border-end-start-radius: inherit;
    justify-content: flex-end;
    padding: 16px 24px 20px;
  }
  .role-modal__actions form { margin: 0; }
  @media (prefers-reduced-motion: no-preference) {
    .role-modal[open] .role-modal__panel { animation: role-modal-rise 160ms ease-out; }
  }
  @keyframes role-modal-rise { from { opacity: 0; transform: translateY(8px); } }
</style>
