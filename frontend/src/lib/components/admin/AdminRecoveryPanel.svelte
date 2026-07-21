<script>
  import { tick } from "svelte";
  import ConfirmationShell from "$lib/app/ConfirmationShell.svelte";
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    containTabWithinConfirmation,
    focusFirstNewConfirmation,
    returnFocusToTrigger,
  } from "$lib/app/confirmation-focus.mjs";
  import {
    buildAdminRecoveryPanelViewModel,
  } from "./admin-surface-model.mjs";

  export let tasks = [];
  export let commandStatuses = {};
  export let game;
  export let principalUserId;
  export let onRecoveryTask = () => {};
  export let onCancelRecoveryTask = () => {};

  let confirmButtonRefs = {};
  let triggerButtonRefs = {};
  const focusedConfirmations = new Set();

  $: view = buildAdminRecoveryPanelViewModel({
    tasks,
    commandStatuses,
    game,
    principalUserId,
  });
  $: focusNewConfirmation(view.items);

  function focusNewConfirmation(items) {
    focusFirstNewConfirmation({
      items,
      focusedConfirmations,
      confirmButtonRefs,
      tick,
    });
  }

  async function cancelRecoveryTask(item) {
    onCancelRecoveryTask(item);
    await returnFocusToTrigger({ item, triggerButtonRefs, tick });
  }

  function onConfirmationKeydown(event, item) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelRecoveryTask(item);
      return;
    }

    containTabWithinConfirmation(event);
  }
</script>

<div
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-thumb-zone={view.root.data.thumbZone}
  data-action-tile-stability-mode={view.root.data.actionTileStabilityMode}
  data-testid={view.root.testId}
>
  {#each view.items as item}
    <article class="fm-panel" data-testid={item.testId}>
      <p class="fm-eyebrow">{item.displayAuthority}</p>
      <h2>{item.label}</h2>
      <p>{item.value}</p>
      <details class="fm-proof-disclosure admin-surface__technical-details">
        <summary>Technical details</summary>
        <p
          class="fm-well fm-well--kv"
          data-testid={item.boundaryTestId}
        >
          <strong>{item.boundary}</strong>
          <span>{item.boundaryDetail}</span>
        </p>
      </details>
      <div class={item.actionTileClassName}>
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-min-touch-target-px={item.minTouchTargetPx}
          data-testid={item.triggerTestId}
          bind:this={triggerButtonRefs[item.id]}
          on:click={() => onRecoveryTask(item)}
        >
          {item.buttonLabel}
        </button>
        <div
          class={item.statusFloorClassName}
          data-testid={item.statusFloorTestId}
          data-status-floor-min-px={item.statusFloorMinBlockSizePx}
          aria-hidden={item.status ? undefined : "true"}
        >
          {#if item.status}
            <AppStatus
              status={item.status}
              testId={item.statusTestId}
              className="admin-surface__command-status"
            />
          {/if}
        </div>
      </div>
      {#if item.status && item.status.state === "confirm"}
          <ConfirmationShell
            element="form"
            method="POST"
            action={item.form.action}
            className="fm-touch-row"
            confirmation={item.confirmation}
            testId={item.formTestId}
            onKeydown={(event) => onConfirmationKeydown(event, item)}
          >
            <span
              id={item.confirmation.messageId}
              class="admin-surface__confirmation-message"
              data-testid={item.confirmation.messageTestId}
            >
              {item.confirmation.message}
            </span>
            <input type="hidden" name="game" value={item.form.game} />
            <input
              type="hidden"
              name="principalUserId"
              value={item.form.principalUserId}
            />
            <button
              type="submit"
              class="fm-touch-button"
              data-min-touch-target-px={item.minTouchTargetPx}
              data-testid={item.confirmTestId}
              bind:this={confirmButtonRefs[item.id]}
            >
              {item.confirmLabel}
            </button>
            <button
              type="button"
              class="fm-touch-button fm-touch-button--secondary"
              data-min-touch-target-px={item.minTouchTargetPx}
              data-testid={item.cancelTestId}
              on:click={() => cancelRecoveryTask(item)}
            >
              Cancel
            </button>
          </ConfirmationShell>
      {/if}
    </article>
  {/each}
</div>

<style>
  .admin-surface__technical-details > p {
    margin: 0 12px 12px;
  }

  .admin-surface__action-tile {
    align-content: start;
    display: grid;
    gap: 8px;
    grid-template-rows: auto minmax(44px, auto);
    min-inline-size: 0;
  }

  .admin-surface__command-status-floor {
    align-items: start;
    display: grid;
    min-block-size: 44px;
  }

  .admin-surface__command-status {
    margin: 0;
  }

  .admin-surface__confirmation-message {
    color: var(--fm-ink);
    font-size: 13px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
</style>
