<script>
  import { tick } from "svelte";
  import {
    COMMAND_INTERRUPTION_CONTRACT,
    isCommandInterruptionStatus,
  } from "./command-interruption.mjs";

  export let status = null;
  export let onRetry = () => {};
  export let onCancel = () => {};

  $: visible = isCommandInterruptionStatus(status);

  let retryButton;
  let focusedCommandId = null;

  $: if (visible && focusedCommandId !== status.commandId) {
    focusedCommandId = status.commandId;
    focusRetry();
  }

  async function focusRetry() {
    await tick();
    retryButton?.focus();
  }

  async function settle(callback) {
    const actionId = status.actionId;
    const scrollY = typeof window === "undefined" ? 0 : window.scrollY;
    await callback(actionId);
    await tick();
    if (typeof document === "undefined") {
      return;
    }
    const recoveryStillVisible = document.querySelector(
      `[data-testid="command-recovery-${CSS.escape(actionId)}"]`,
    );
    if (recoveryStillVisible) {
      retryButton?.focus();
      return;
    }
    document.querySelector(
      `[data-command-recovery-return="${CSS.escape(actionId)}"]`,
    )?.focus({ preventScroll: true });
    window.scrollTo(0, scrollY);
  }
</script>

{#if visible}
  <section
    class="fm-command-recovery"
    aria-label="Command recovery"
    data-interruption={status.interruption}
    data-command-id={status.commandId}
    data-testid={`command-recovery-${status.actionId}`}
  >
    <p>Retry uses the original command identity, so it will not create duplicate work.</p>
    <div class="fm-touch-row">
      <button
        type="button"
        class="fm-touch-button"
        data-testid={`command-recovery-retry-${status.actionId}`}
        bind:this={retryButton}
        on:click={() => settle(onRetry)}
      >
        {COMMAND_INTERRUPTION_CONTRACT.retryLabel}
      </button>
      <button
        type="button"
        class="fm-touch-button fm-touch-button--secondary"
        data-testid={`command-recovery-cancel-${status.actionId}`}
        on:click={() => settle(onCancel)}
      >
        {COMMAND_INTERRUPTION_CONTRACT.cancelLabel}
      </button>
    </div>
  </section>
{/if}

<style>
  .fm-command-recovery {
    display: grid;
    gap: 8px;
    margin-block-start: 8px;
  }

  .fm-command-recovery p {
    color: var(--fm-ink-subtle);
    font-size: 13px;
    line-height: 1.35;
    margin: 0;
  }
</style>
