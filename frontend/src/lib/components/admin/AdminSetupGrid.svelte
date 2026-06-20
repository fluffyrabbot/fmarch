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
    buildAdminSetupGridViewModel,
  } from "./admin-surface-model.mjs";

  export let items = [];
  export let commandStatuses = {};
  export let sessionGrant;
  export let onSetupAction = () => {};
  export let onConfirmSetupAction = () => {};
  export let onCancelSetupAction = () => {};

  let confirmButtonRefs = {};
  let triggerButtonRefs = {};
  const focusedConfirmations = new Set();

  $: view = buildAdminSetupGridViewModel({
    items,
    commandStatuses,
    sessionGrant,
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

  async function cancelSetupAction(item) {
    onCancelSetupAction(item);
    await returnFocusToTrigger({ item, triggerButtonRefs, tick });
  }

  async function confirmSetupAction(item) {
    onConfirmSetupAction(item);
    await returnFocusToTrigger({ item, triggerButtonRefs, tick });
  }

  function onConfirmationKeydown(event, item) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelSetupAction(item);
      return;
    }

    containTabWithinConfirmation(event);
  }
</script>

<section
  class={view.root.className}
  aria-label={view.root.ariaLabel}
  data-thumb-zone={view.root.data.thumbZone}
  data-action-tile-stability-mode={view.root.data.actionTileStabilityMode}
  data-testid={view.root.testId}
>
  {#each view.items as item}
    <article class="fm-panel" data-testid={item.testId}>
      <p class="fm-eyebrow">{item.authority}</p>
      <h2>{item.label}</h2>
      <p>{item.value}</p>
      <p
        class="admin-surface__boundary"
        data-testid={item.boundaryTestId}
      >
        <strong>{item.boundary}</strong>
        <span>{item.boundaryDetail}</span>
      </p>
      <div class={item.actionTileClassName}>
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-min-touch-target-px={item.minTouchTargetPx}
          data-testid={item.triggerTestId}
          bind:this={triggerButtonRefs[item.id]}
          on:click={() => onSetupAction(item)}
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
          {#if item.isSessionGrant}
            <ConfirmationShell
              element="form"
              method="POST"
              action="?/grantSession"
              className="admin-surface__grant-form"
              confirmation={item.confirmation}
              testId="admin-session-grant-form"
              onKeydown={(event) => onConfirmationKeydown(event, item)}
            >
              <p
                id={item.confirmation.messageId}
                class="admin-surface__confirmation-message"
                data-testid={item.confirmation.messageTestId}
              >
                {item.confirmation.message}
              </p>
              <label class="admin-surface__field">
                <span>Session token</span>
                <input
                  name="token"
                  value={item.sessionGrant.token}
                  autocomplete="off"
                  data-testid="admin-session-grant-token"
                />
              </label>
              <label class="admin-surface__field">
                <span>Principal</span>
                <input
                  name="principalUserId"
                  value={item.sessionGrant.principalUserId}
                  autocomplete="off"
                  data-testid="admin-session-grant-principal"
                />
              </label>
              <label class="admin-surface__field">
                <span>Expires at</span>
                <input
                  name="expiresAt"
                  inputmode="numeric"
                  value={item.sessionGrant.expiresAt}
                  data-testid="admin-session-grant-expires-at"
                />
              </label>
              <label class="admin-surface__checkbox">
                <input
                  type="checkbox"
                  name="globalCapability"
                  value="GlobalMod"
                  checked={item.sessionGrant.globalCapabilities.includes("GlobalMod")}
                  data-testid="admin-session-grant-global-mod"
                />
                <span>GlobalMod</span>
              </label>
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
                on:click={() => cancelSetupAction(item)}
              >
                Cancel
              </button>
            </ConfirmationShell>
          {:else}
            <ConfirmationShell
              className="fm-touch-row"
              confirmation={item.confirmation}
              onKeydown={(event) => onConfirmationKeydown(event, item)}
            >
              <span
                id={item.confirmation.messageId}
                class="admin-surface__confirmation-message"
                data-testid={item.confirmation.messageTestId}
              >
                {item.confirmation.message}
              </span>
              <button
                type="button"
                class="fm-touch-button"
                data-min-touch-target-px={item.minTouchTargetPx}
                data-testid={item.confirmTestId}
                bind:this={confirmButtonRefs[item.id]}
                on:click={() => confirmSetupAction(item)}
              >
                {item.confirmLabel}
              </button>
              <button
                type="button"
                class="fm-touch-button fm-touch-button--secondary"
                data-min-touch-target-px={item.minTouchTargetPx}
                data-testid={item.cancelTestId}
                on:click={() => cancelSetupAction(item)}
              >
                Cancel
              </button>
            </ConfirmationShell>
          {/if}
      {/if}
    </article>
  {/each}
</section>

<style>
  .admin-surface__boundary {
    background: #eef2f5;
    border: 1px solid #a8b4bd;
    border-radius: 8px;
    display: grid;
    gap: 2px;
    padding: 10px 12px;
  }

  .admin-surface__boundary strong,
  .admin-surface__boundary span {
    overflow-wrap: anywhere;
  }

  .admin-surface__boundary strong {
    color: #17212b;
    font-size: 13px;
  }

  .admin-surface__boundary span {
    color: #425063;
    font-size: 12px;
    line-height: 1.3;
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

  .admin-surface__grant-form {
    display: grid;
    gap: 10px;
  }

  .admin-surface__confirmation-message {
    color: #17212b;
    font-size: 13px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .admin-surface__field {
    display: grid;
    gap: 4px;
  }

  .admin-surface__field span,
  .admin-surface__checkbox span {
    color: #425063;
    font-size: 12px;
    font-weight: 800;
  }

  .admin-surface__field input {
    border: 1px solid #a8b4bd;
    border-radius: 8px;
    color: #17212b;
    font: inherit;
    min-block-size: 44px;
    min-inline-size: 0;
    padding: 8px 10px;
    width: 100%;
  }

  .admin-surface__checkbox {
    align-items: center;
    display: inline-flex;
    gap: 10px;
    min-block-size: 44px;
  }

  .admin-surface__checkbox input {
    block-size: 22px;
    inline-size: 22px;
  }
</style>
