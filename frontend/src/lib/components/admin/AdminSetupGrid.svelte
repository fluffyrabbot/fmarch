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
    await onConfirmSetupAction(item);
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
    <article
      class="fm-panel"
      data-testid={item.testId}
      aria-busy={item.commandPending ? "true" : undefined}
    >
      <p class="fm-eyebrow">{item.displayAuthority}</p>
      <h2>{item.label}</h2>
      <p>{item.displayValue}</p>
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
        {#if item.href}
          <a
            class="fm-touch-button fm-touch-button--secondary"
            href={item.href}
            data-min-touch-target-px={item.minTouchTargetPx}
            data-testid={item.triggerTestId}
          >
            {item.buttonLabel}
          </a>
        {:else}
          <button
            type="button"
            class="fm-touch-button fm-touch-button--secondary"
            data-min-touch-target-px={item.minTouchTargetPx}
            data-testid={item.triggerTestId}
            disabled={item.triggerDisabled}
            aria-disabled={item.triggerDisabled ? "true" : undefined}
            bind:this={triggerButtonRefs[item.id]}
            on:click={() => onSetupAction(item)}
          >
            {item.buttonLabel}
          </button>
        {/if}
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
              <label class="admin-surface__field fm-field">
                <span>Session token</span>
                <input
                  name="token"
                  value={item.sessionGrant.token}
                  autocomplete="off"
                  data-testid="admin-session-grant-token"
                />
              </label>
              <label class="admin-surface__field fm-field">
                <span>Principal</span>
                <input
                  name="principalUserId"
                  value={item.sessionGrant.principalUserId}
                  autocomplete="off"
                  data-testid="admin-session-grant-principal"
                />
              </label>
              <label class="admin-surface__field fm-field">
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
                <span>Community moderator</span>
              </label>
              <button
                type="submit"
                class="fm-touch-button"
                data-min-touch-target-px={item.minTouchTargetPx}
                data-testid={item.confirmTestId}
                bind:this={confirmButtonRefs[item.id]}
              >
                {item.displayConfirmLabel}
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
                {item.displayConfirmLabel}
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
  .admin-action-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

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

  .admin-surface__grant-form {
    display: grid;
    gap: 10px;
  }

  .admin-surface__confirmation-message {
    color: var(--fm-ink);
    font-size: 13px;
    font-weight: 800;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  @media (max-width: 760px) {
    .admin-action-grid {
      grid-template-columns: 1fr;
    }
  }

  .admin-surface__checkbox span {
    color: var(--fm-ink-muted);
    font-size: 12px;
    font-weight: 800;
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
