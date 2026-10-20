<script>
  import { tick } from "svelte";

  /** From `buildPlayerCommandStatusLine`, or `null` when there is nothing to say. */
  export let line = null;
  export let onRetry = () => {};
  export let onCancel = () => {};
  export let onDismiss = () => {};

  let retryButton;
  let focusedCommandId = null;

  // An unresolved command takes focus once, without scrolling the reader away.
  $: if (line?.recovery && focusedCommandId !== line.recovery.commandId) {
    focusedCommandId = line.recovery.commandId;
    tick().then(() => retryButton?.focus({ preventScroll: true }));
  }

  // After Retry or Dismiss, focus stays on Retry while the command is still
  // unresolved; otherwise it returns to the control that sent it (a vote's
  // picker row is gone by then, so votes return to the dock's vote control).
  async function settle(callback) {
    const actionId = line.actionId;
    const scrollY = typeof window === "undefined" ? 0 : window.scrollY;
    await callback(actionId);
    await tick();
    if (typeof document === "undefined") return;
    if (line?.recovery) {
      retryButton?.focus({ preventScroll: true });
      return;
    }
    const origin =
      document.querySelector(`[data-command-recovery-return="${CSS.escape(actionId)}"]`) ??
      (actionId.startsWith("submit_vote") || actionId === "withdraw_vote"
        ? document.querySelector('[data-testid="player-dock-vote"]')
        : null);
    origin?.focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  }
</script>

{#if line}
  <div class="command-line" data-state={line.state}>
    <p
      data-testid={line.testId}
      data-state={line.state}
      data-action-id={line.actionId}
      role="status"
      aria-live={line.ariaLive}
      aria-atomic="true"
      aria-busy={line.busy ? "true" : undefined}
    >{line.text}</p>
    {#if line.recovery}
      <div
        class="command-line__actions"
        role="group"
        aria-label={line.text}
        data-testid={line.recovery.testId}
        data-command-id={line.recovery.commandId}
        data-interruption={line.recovery.interruption}
        data-outcome={line.recovery.outcome}
      >
        <button
          type="button"
          class="command-line__button command-line__button--primary"
          data-testid={line.recovery.retry.testId}
          bind:this={retryButton}
          disabled={!line.recovery.retry.enabled}
          on:click={() => settle(onRetry)}
        >{line.recovery.retry.label}</button>
        <button
          type="button"
          class="command-line__button"
          data-testid={line.recovery.dismiss.testId}
          on:click={() => settle(onCancel)}
        >{line.recovery.dismiss.label}</button>
      </div>
    {:else if line.dismiss}
      <button
        type="button"
        class="command-line__button"
        data-testid={line.dismiss.testId}
        on:click={onDismiss}
      >{line.dismiss.label}</button>
    {/if}
  </div>
{/if}

<style>
  /* Attached under the game bar and kept in view while the player reads or
     votes further down, so a command's outcome is never off screen. */
  .command-line {
    align-items: center;
    backdrop-filter: blur(14px);
    background: var(--fm-raised-veil);
    border-block-end: 1px solid var(--fm-line);
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    inset-block-start: var(--fm-app-topbar-block-size);
    justify-content: space-between;
    padding: 8px clamp(14px, 3vw, 30px);
    position: sticky;
    z-index: 11;
  }

  .command-line p {
    flex: 1 1 16rem;
    font-size: 14px;
    font-weight: 700;
    margin: 0;
  }

  .command-line[data-state="reject"] p,
  .command-line[data-state="error"] p,
  .command-line[data-state="interrupted"] p {
    color: var(--fm-danger-ink);
  }

  .command-line[data-state="pending"] p,
  .command-line[data-state="ack"] p {
    color: var(--fm-ink-subtle);
  }

  .command-line__actions {
    display: flex;
    gap: 6px;
  }

  .command-line__button {
    background: transparent;
    border: 1px solid var(--fm-line-strong);
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink);
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    min-block-size: 44px;
    min-inline-size: 44px;
    padding: 6px 12px;
  }

  .command-line__button--primary {
    background: var(--fm-ink);
    border-color: var(--fm-ink);
    color: var(--fm-action-ink);
  }

  .command-line__button:disabled {
    opacity: 0.55;
  }
</style>
