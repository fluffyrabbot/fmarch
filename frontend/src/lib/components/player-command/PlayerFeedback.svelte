<script>
  import { tick } from "svelte";
  import { playerFeedback } from "./player-feedback-model.mjs";
  export let status = null;
  export let attempt = null;
  export let roster = [];
  export let retryAvailable = false;
  export let retryEnabled = true;
  export let onRetry = () => {};
  export let onDismiss = () => {};
  $: view = playerFeedback({ status, attempt, roster });
  let retryButton;
  let focusedAttempt = null;
  $: if (status?.state === "interrupted" && attempt?.commandId !== focusedAttempt) {
    focusedAttempt = attempt?.commandId;
    tick().then(() => retryButton?.focus({ preventScroll: true }));
  }
  $: canRetry = attempt && (status?.state === "interrupted" || retryAvailable);
  async function settle(callback) {
    const action = view.actionId;
    const returnSelector = `[data-command-recovery-return="${CSS.escape(action)}"]`;
    const returnTop = document.querySelector(returnSelector)?.getBoundingClientRect().top;
    await callback(action);
    await tick();
    if (status?.state === "interrupted" || (retryAvailable && status?.state === "reject")) retryButton?.focus({ preventScroll: true });
    else {
      const control = document.querySelector(returnSelector);
      control?.focus({ preventScroll: true });
      // Keep the original action in place as the inline feedback collapses
      // and refreshed posts arrive above it.
      if (control && Number.isFinite(returnTop)) {
        await new Promise(requestAnimationFrame);
        window.scrollBy({ top: control.getBoundingClientRect().top - returnTop, behavior: "instant" });
      }
    }
  }
</script>

{#if view}
  <div class="player-feedback" data-testid="player-feedback" data-state={view.state} data-component="player-feedback" data-action-id={view.actionId}
    data-command-trace-kind={status?.commandTrace?.kind}
    data-command-surface={status?.commandTrace?.surface}
    data-command-action-id={status?.commandTrace?.actionId}
    data-command-status-key={status?.commandTrace?.statusKey}
    data-command-dispatch-kind={status?.commandTrace?.dispatchKind}
    data-command-refresh-keys={status?.commandTrace?.projectionRefreshKeys?.join(",")} data-outcome={status?.state === "interrupted" ? "unknown" : status?.state === "reject" ? "confirmed-rejection" : undefined}>
    <p role="status" aria-live={["reject", "interrupted"].includes(view.state) ? "assertive" : "polite"} aria-atomic="true" data-testid="player-command-status" data-state={view.state}>{view.message}</p>
    <span class="player-feedback__actions">
    {#if canRetry}
      <span class="player-feedback__recovery" data-testid={`command-recovery-${view.actionId}`} data-command-id={status?.commandId} data-interruption={status?.interruption} data-outcome={status?.state === "reject" ? "confirmed-rejection" : "unknown"}>
      <button class="fm-touch-button fm-touch-button--secondary" data-testid={`command-recovery-retry-${view.actionId}`} bind:this={retryButton} disabled={!retryEnabled} on:click={() => settle(onRetry)}>Retry</button>
      </span>
    {/if}
    {#if view.dismissible}
      <button class="fm-touch-button fm-touch-button--secondary" data-testid={`command-recovery-cancel-${view.actionId}`} on:click={() => settle(onDismiss)}>Dismiss</button>
    {/if}
    </span>
  </div>
{:else if status?.state === "ack"}
  <p class="fm-sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="player-command-status" data-state="ack">Saved.</p>
{/if}
<style>
  .player-feedback { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; grid-column: 1 / -1; border-block-start: 1px solid var(--fm-line); padding-block-start: 8px; }
  .player-feedback__actions { display: flex; flex: 0 0 auto; gap: 8px; }
  .player-feedback__actions:empty { display: none; }
  .player-feedback p { flex: 1 1 220px; margin: 0; font-size: 14px; overflow-wrap: anywhere; }
</style>
