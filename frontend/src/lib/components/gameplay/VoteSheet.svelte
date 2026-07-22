<script>
  import { tick } from "svelte";
  import ConfirmationShell from "$lib/app/ConfirmationShell.svelte";
  import { containTabWithinConfirmation } from "$lib/app/confirmation-focus.mjs";

  export let view;
  export let onCommand = () => {};
  export let onSelectTarget = () => {};

  let confirmingAction = null;
  let confirmElements = {};

  async function activateConfirmation(action) {
    confirmingAction = action.action;
    await tick();
    confirmElements[action.action]?.focus();
  }

  async function confirm(action) {
    confirmingAction = null;
    await onCommand(action.action);
  }

  function onConfirmationKeydown(event, action) {
    if (event.key === "Escape") {
      event.preventDefault();
      confirmingAction = null;
      return;
    }
    if (event.key === "Tab") containTabWithinConfirmation(event);
  }
</script>

<section class="vote-sheet" id="player-actions" data-testid="player-action-detail">
  <header>
    <div>
      <p class="fm-eyebrow">Game state</p>
      <h2>Vote and actions</h2>
    </div>
    <div class="vote-sheet__current" data-testid="player-vote-context">
      <span>{view.context.currentVote.label}</span>
      <strong data-testid={view.context.currentVote.testId}>{view.context.currentVote.value}</strong>
    </div>
  </header>

  <div class="vote-sheet__count" data-testid={view.votecount.testId}>
    <h3>{view.votecount.summary}</h3>
    {#if view.votecount.rows.length === 0}
      <p>No votes have been recorded.</p>
    {:else}
      {#each view.votecount.rows as row}
        <div class="player-command-panel__vote-row">
          <span>{row.target}</span>
          <strong>{row.tally}</strong>
        </div>
      {/each}
    {/if}
  </div>

  {#if view.composer?.actionPicker?.actions?.length > 0 || view.composer?.actionPicker?.recoveryCommands?.length > 0}
    <div class="vote-sheet__phase-actions" id="player-phase-actions" data-testid="player-action-commands">
      <h3>{view.composer.actionHeading}</h3>
      {#each view.composer.actionPicker.actions as action (action.action)}
        <article class="vote-sheet__phase-action" data-template-id={action.templateId}>
          {#if action.options.length > 0}
            <div class={action.optionsClassName} role="radiogroup" aria-label={`Target for ${action.label}`}>
              {#each action.options as option (option.slot)}
                <label class={option.className} data-testid={option.testId}>
                  <input
                    type="radio"
                    name={option.name}
                    value={option.slot}
                    checked={option.checked}
                    on:change={() => onSelectTarget(action.templateId, option.slot)}
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </div>
          {/if}
          <button
            type="button"
            class={action.trigger.className}
            data-testid={action.trigger.testId}
            data-action={action.trigger.data.action}
            data-template-id={action.trigger.data.templateId}
            data-target-slots={action.trigger.data.targetSlots.join(",")}
            disabled={action.trigger.disabled}
            aria-expanded={String(confirmingAction === action.action)}
            on:click={() => activateConfirmation(action)}
          >
            <span>{action.label}</span>
            {#if action.detail}<small>{action.detail}</small>{/if}
          </button>
          {#if confirmingAction === action.action}
            <ConfirmationShell
              className={action.confirmation.className}
              confirmation={action.confirmation}
              testId={action.confirmation.confirmationTestId}
              onKeydown={(event) => onConfirmationKeydown(event, action)}
            >
              <p id={action.confirmation.messageId}>{action.confirmation.message}</p>
              <div class={action.confirmation.actionsClassName}>
                <button
                  type="button"
                  class={action.confirmation.confirmClassName}
                  data-testid={action.confirmation.confirmTestId}
                  bind:this={confirmElements[action.action]}
                  on:click={() => confirm(action)}
                >Confirm</button>
                <button
                  type="button"
                  class={action.confirmation.cancelClassName}
                  data-testid={action.confirmation.cancelTestId}
                  on:click={() => confirmingAction = null}
                >Cancel</button>
              </div>
            </ConfirmationShell>
          {/if}
        </article>
      {/each}
      {#each view.composer.actionPicker.recoveryCommands as button (button.action)}
        <button
          type="button"
          class={button.className}
          data-action={button.action}
          data-template-id={button.data.templateId}
          data-target-slots={button.data.targetSlots.join(",")}
          disabled={button.disabled}
          on:click={() => onCommand(button.action)}
        >{button.label}</button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .vote-sheet {
    border-block-start: 1px solid var(--fm-line-strong);
    display: grid;
    gap: 16px;
    padding-block-start: 22px;
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + 16px);
  }

  .vote-sheet header {
    align-items: end;
    display: flex;
    gap: 18px;
    justify-content: space-between;
  }

  .vote-sheet h2,
  .vote-sheet h3,
  .vote-sheet p {
    margin: 0;
  }

  .vote-sheet__current {
    display: grid;
    font-size: 13px;
    text-align: end;
  }

  .vote-sheet__current span,
  .vote-sheet__count > p {
    color: var(--fm-ink-muted);
  }

  .vote-sheet__count,
  .vote-sheet__phase-actions,
  .vote-sheet__phase-action {
    display: grid;
    gap: 10px;
  }

  .player-command-panel__vote-row {
    align-items: center;
    border-block-start: 1px solid var(--fm-line-soft);
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 44px;
    padding-block: 8px;
  }

  .vote-sheet__phase-actions {
    border-block-start: 1px solid var(--fm-line-soft);
    padding-block-start: 16px;
  }

  .vote-sheet__phase-action > button {
    display: grid;
    gap: 2px;
    justify-items: start;
    text-align: start;
  }

  @media (max-width: 560px) {
    .vote-sheet header {
      align-items: start;
      display: grid;
    }

    .vote-sheet__current {
      text-align: start;
    }
  }
</style>
