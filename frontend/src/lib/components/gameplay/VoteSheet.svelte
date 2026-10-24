<script>
  export let returnAvailable = false;
  export let onReturnToThread = () => {};
  import { tick } from "svelte";
  import ConfirmationShell from "$lib/app/ConfirmationShell.svelte";
  import { containTabWithinConfirmation } from "$lib/app/confirmation-focus.mjs";

  export let view;
  /** The latest official votecount post, linked from the sheet it summarises. */
  export let officialPost = null;
  export let onCommand = () => {};
  export let onSelectTarget = () => {};
  /** Arm a vote row (or Unvote) for confirmation; `null` disarms it. */
  export let onSelectVote = () => {};
  export let initialConfirmingAction = null;
  /** The dock or a post's Vote control asked for the picker. */
  export let pickerRequested = false;

  let confirmingAction = initialConfirmingAction;
  let confirmElements = {};
  let voteConfirmElement = null;

  $: picker = view.votePicker;
  let listOpen = false;
  $: if (pickerRequested || picker.rows.some((row) => row.selected) || picker.unvote?.selected) {
    listOpen = true;
  }

  async function selectVote(action) {
    onSelectVote(action);
    await tick();
    voteConfirmElement?.focus();
  }

  async function confirmVote(action) {
    onSelectVote(null);
    await onCommand(action);
  }

  function onVoteConfirmationKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onSelectVote(null);
    }
  }

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

<section class="vote-sheet" id="player-actions" tabindex="-1" data-testid="player-action-detail">
  {#if returnAvailable}<button type="button" class="fm-touch-button fm-touch-button--secondary" data-testid="return-to-thread" on:click={onReturnToThread}>Return to thread</button>{/if}
  <header>
    <div>
      <p class="fm-eyebrow">Game state</p>
      <h2>Vote</h2>
    </div>
    <div class="vote-sheet__current" data-testid="player-vote-context">
      <span>{view.context.deadline.label}</span>
      <strong
        data-testid={view.context.deadline.testId}
        data-state={view.context.deadline.state}
        data-projected={view.context.deadline.isProjected}
      >{view.context.deadline.phaseLabel} · {view.context.deadline.value}</strong>
      <span>{view.context.currentVote.label}</span>
      <strong
        data-testid={view.context.currentVote.testId}
        data-has-vote={String(view.context.currentVote.hasVote)}
      >{view.context.currentVote.value}</strong>
    </div>
  </header>

  {#if officialPost !== null}
    <a
      class="vote-sheet__official"
      href={`#thread-post-${officialPost.seq}`}
      data-testid="player-live-official-post"
    >
      <span>{officialPost.label}</span>
      <strong>{officialPost.value}</strong>
      <small>{officialPost.detail}</small>
    </a>
  {/if}

  <details class="vote-picker" data-testid={picker.testId} data-has-vote={String(picker.hasVote)} bind:open={listOpen}>
    <summary data-testid="player-vote-picker-toggle">
      <strong>{picker.summary}</strong>
      <span>{picker.dock.label === "Vote" ? "Choose a vote" : picker.dock.label}</span>
    </summary>
    {#if picker.rows.length === 0}
      <p>No votes have been recorded.</p>
    {:else}
      <ul class="vote-picker__rows">
        {#each picker.rows as row (row.key)}
          <li class="vote-picker__row" data-current={String(row.current)} data-selected={String(row.selected)}>
            <button
              type="button"
              class="vote-picker__option"
              data-testid={row.testId}
              data-vote-key={row.key}
              data-vote-action={row.action}
              disabled={!row.selectable}
              aria-expanded={row.selectable ? String(row.selected) : undefined}
              on:click={() => selectVote(row.selected ? null : row.action)}
            >
              <span class="vote-picker__name">{row.label}</span>
              {#if row.note}<small>{row.note}</small>{/if}
              <strong class="vote-picker__tally">{row.tally}</strong>
            </button>
            {#if row.confirmation}
              <div
                class="vote-picker__confirmation"
                role="group"
                aria-label={row.confirmation.message}
                data-testid="player-vote-confirmation"
                on:keydown={onVoteConfirmationKeydown}
              >
                <p>{row.confirmation.message}</p>
                <div class="vote-picker__confirmation-actions">
                  <button
                    type="button"
                    class="fm-touch-button"
                    data-testid="player-vote-confirm"
                    data-action={row.action}
                    bind:this={voteConfirmElement}
                    on:click={() => confirmVote(row.action)}
                  >{row.confirmation.confirmLabel}</button>
                  <button
                    type="button"
                    class="fm-touch-button fm-touch-button--secondary"
                    data-testid="player-vote-cancel"
                    on:click={() => onSelectVote(null)}
                  >Cancel</button>
                </div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if picker.rows.length > 0}
      <div class="vote-picker__unvote">
        <button
          type="button"
          class="fm-touch-button fm-touch-button--secondary"
          data-testid="player-vote-unvote"
          data-vote-action={picker.unvote.action}
          disabled={picker.unvote.disabled}
          data-disabled-reason={picker.unvote.reason}
          aria-expanded={String(picker.unvote.selected)}
          on:click={() => selectVote(picker.unvote.selected ? null : picker.unvote.action)}
        >{picker.unvote.label}</button>
        {#if picker.unvote.disabled && picker.unvote.reason}<small>{picker.unvote.reason}</small>{/if}
        {#if picker.unvote.confirmation}
          <div
            class="vote-picker__confirmation"
            role="group"
            aria-label={picker.unvote.confirmation.message}
            data-testid="player-vote-confirmation"
            on:keydown={onVoteConfirmationKeydown}
          >
            <p>{picker.unvote.confirmation.message}</p>
            <div class="vote-picker__confirmation-actions">
              <button
                type="button"
                class="fm-touch-button"
                data-testid="player-vote-confirm"
                data-action={picker.unvote.action}
                bind:this={voteConfirmElement}
                on:click={() => confirmVote(picker.unvote.action)}
              >{picker.unvote.confirmation.confirmLabel}</button>
              <button
                type="button"
                class="fm-touch-button fm-touch-button--secondary"
                data-testid="player-vote-cancel"
                on:click={() => onSelectVote(null)}
              >Cancel</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </details>

  {#if view.composer?.actionPicker?.actions?.length > 0}
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
              <p
                id={action.confirmation.messageId}
                data-testid={action.confirmation.messageTestId}
              >{action.confirmation.message}</p>
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
    </div>
  {/if}
</section>

<style>
  .vote-sheet {
    border-block-start: 1px solid var(--fm-line-strong);
    display: grid;
    gap: 16px;
    padding-block-start: 22px;
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + var(--fm-game-bar-block-size, 0px) + 16px);
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
  .vote-picker > p,
  .vote-picker small {
    color: var(--fm-ink-muted);
  }

  .vote-sheet__official {
    border: 1px solid var(--fm-accent);
    border-inline-start: 6px solid var(--fm-accent);
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink);
    display: grid;
    gap: 2px;
    padding: 10px 14px;
    text-decoration: none;
  }

  .vote-sheet__official span,
  .vote-sheet__official small {
    color: var(--fm-ink-muted);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .vote-sheet__official strong {
    color: var(--fm-accent-ink);
    overflow-wrap: anywhere;
  }

  .vote-picker,
  .vote-sheet__phase-actions,
  .vote-sheet__phase-action {
    display: grid;
    gap: 10px;
  }

  .vote-picker > summary {
    align-items: baseline;
    cursor: pointer;
    display: flex;
    gap: 12px;
    justify-content: space-between;
    min-block-size: 44px;
    padding-block: 10px;
  }

  .vote-picker > summary span {
    color: var(--fm-ink-muted);
    font-size: 13px;
  }

  .vote-picker__rows {
    display: grid;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .vote-picker__row {
    border-block-start: 1px solid var(--fm-line-soft);
  }

  /* Keep a row clear of the sticky top bar and the fixed action dock when it
     is scrolled or focused into view. */
  .vote-picker > summary,
  .vote-picker__option,
  .vote-picker__confirmation button,
  .vote-picker__unvote button {
    scroll-margin-block: calc(var(--fm-app-topbar-block-size) + var(--fm-game-bar-block-size, 0px) + 16px)
      calc(96px + env(safe-area-inset-bottom));
  }

  .vote-picker__option {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink);
    column-gap: 10px;
    display: grid;
    font: inherit;
    grid-template-columns: minmax(0, 1fr) auto auto;
    inline-size: 100%;
    min-block-size: 44px;
    padding: 8px 6px;
    text-align: start;
  }

  .vote-picker__option:disabled {
    color: var(--fm-ink-muted);
    cursor: default;
  }

  .vote-picker__row[data-current="true"] .vote-picker__name,
  .vote-picker__row[data-selected="true"] .vote-picker__name {
    font-weight: 850;
  }

  .vote-picker__row[data-selected="true"] {
    background: var(--fm-surface-tint);
  }

  .vote-picker__name {
    overflow-wrap: anywhere;
  }

  .vote-picker__tally {
    font-variant-numeric: tabular-nums;
  }

  .vote-picker__confirmation {
    display: grid;
    gap: 8px;
    padding: 4px 6px 12px;
  }

  .vote-picker__confirmation p {
    font-weight: 750;
  }

  .vote-picker__confirmation-actions,
  .vote-picker__unvote {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
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
