<script>
  import { tick } from "svelte";
  import ConfirmationShell from "$lib/app/ConfirmationShell.svelte";
  import {
    containTabWithinConfirmation,
  } from "$lib/app/confirmation-focus.mjs";
  import {
    buildPlayerCommandPanelViewModel,
  } from "./player-command-panel-model.mjs";

  export let composer;
  export let phase = {};
  export let votecount = [];
  export let channel = {};
  export let player = {};
  export let commandPending = false;
  export let commandInterrupted = false;
  export let body = "";
  export let mediaFiles = undefined;
  export let mediaAlt = "";
  export let onCommand = () => {};
  export let onSelectTarget = () => {};
  export let initialConfirmingAction = null;

  let confirmingAction = initialConfirmingAction;
  let triggerElements = {};
  let confirmElements = {};

  $: view = buildPlayerCommandPanelViewModel({
    composer,
    phase,
    votecount,
    channel,
    player,
    commandPending,
    commandInterrupted,
    confirmingAction,
  });

  async function activateConfirmation(pickerAction) {
    confirmingAction = pickerAction.action;
    await tick();
    confirmElements[pickerAction.action]?.focus();
  }

  async function dispatchCommand(action) {
    await onCommand(action);
    await tick();
    triggerElements[action]?.focus();
  }

  async function confirmPickerAction(pickerAction) {
    confirmingAction = null;
    await dispatchCommand(pickerAction.action);
  }

  async function cancelConfirmation(pickerAction) {
    confirmingAction = null;
    await tick();
    triggerElements[pickerAction.action]?.focus();
  }

  function onConfirmationKeydown(event, pickerAction) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelConfirmation(pickerAction);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    containTabWithinConfirmation(event);
  }
</script>

<aside
  class={view.root.className}
  aria-label="Player actions"
  data-component={view.root.data.component}
  data-thumb-zone={view.root.data.thumbZone}
  data-channel-id={view.root.data.channelId}
  data-action-priority={view.root.data.actionPriority}
  data-testid={view.root.testId}
  aria-busy={view.root.ariaBusy}
>
  <h2>{view.heading}</h2>
  <div class={view.context.className} data-testid="player-vote-context">
    <div
      class="player-command-panel__deadline"
      data-testid={view.context.deadline.testId}
      data-state={view.context.deadline.state}
      data-projected={view.context.deadline.isProjected}
    >
      <span>{view.context.deadline.label}</span>
      <strong>{view.context.deadline.value}</strong>
    </div>
    <div
      class="player-command-panel__current-vote"
      data-testid={view.context.currentVote.testId}
      data-has-vote={view.context.currentVote.hasVote}
    >
      <span>{view.context.currentVote.label}</span>
      <strong>{view.context.currentVote.value}</strong>
    </div>
  </div>
  {#if view.quickActions.buttons.length > 0}
    <div
      class={view.quickActions.className}
      aria-label="Quick vote actions"
      data-testid={view.quickActions.testId}
    >
      {#each view.quickActions.buttons as button}
        <button
          type="button"
          class={button.className}
          data-action={button.data.action}
          data-command-recovery-return={button.action}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          data-disabled-reason={button.reason}
          disabled={button.disabled}
          aria-disabled={button.disabled ? "true" : undefined}
          bind:this={triggerElements[button.action]}
          on:click={() => dispatchCommand(button.action)}
        >
          {button.label}
        </button>
      {/each}
    </div>
  {/if}
  <details
    class={view.votecount.className}
    data-testid={view.votecount.testId}
    open={view.votecount.open}
  >
    <summary>{view.votecount.summary}</summary>
    <div class="fm-proof-disclosure__body">
      {#each view.votecount.rows as row}
        <div class="player-command-panel__vote-row">
          <span>{row.target}</span>
          <strong>{row.tally}</strong>
        </div>
      {/each}
    </div>
  </details>
  {#if view.composer.readOnly !== true}
  <div class="player-command-panel__composer" data-testid="player-composer">
    <div
      class="player-command-panel__channel-context fm-well fm-well--warm"
      data-testid={view.composer.channelContext.testId}
      data-channel-id={view.composer.channelContext.channelId}
      data-channel-label={view.composer.channelContext.channelLabel}
      data-capability-label={view.composer.channelContext.capabilityLabel}
      data-actor-slot={view.composer.channelContext.slotId}
      data-actor-alive={view.composer.channelContext.actorAlive}
      data-actor-status={view.composer.channelContext.actorStatus}
    >
      <span>{view.composer.channelContext.label}</span>
      <strong>{view.composer.channelContext.value}</strong>
      <small>{view.composer.channelContext.audienceLabel}</small>
    </div>
    <label class="fm-field">
      <span>{view.composer.label}</span>
      <textarea bind:value={body} rows="3"></textarea>
    </label>
    <details
      class="player-command-panel__media fm-proof-disclosure"
      data-testid="player-media-composer"
      data-max-encoded-bytes={composer.mediaMaxEncodedBytes}
    >
      <summary>Attach an image</summary>
      <div class="fm-proof-disclosure__body">
        <label class="fm-field">
          <span>Image file</span>
          <input
            data-testid="player-media-file"
            type="file"
            accept={(composer.mediaUploadTypes ?? ["image/png", "image/jpeg"]).join(",")}
            bind:files={mediaFiles}
          />
        </label>
        <label class="fm-field">
          <span>Image description</span>
          <input
            data-testid="player-media-alt"
            type="text"
            maxlength="1000"
            placeholder="Describe the image for players using assistive technology"
            bind:value={mediaAlt}
          />
        </label>
        <small>PNG or JPEG, up to 12 MiB. The server removes container metadata.</small>
      </div>
    </details>
    <div class="fm-touch-row">
      {#each view.composer.buttons as button}
        <button
          type="button"
          class={button.className}
          data-action={button.data.action}
          data-command-recovery-return={button.action}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          data-disabled-reason={button.reason}
          disabled={button.disabled}
          aria-disabled={button.disabled ? "true" : undefined}
          bind:this={triggerElements[button.action]}
          on:click={() => dispatchCommand(button.action)}
        >
          {button.label}
        </button>
      {/each}
    </div>
  </div>
  {#if view.composer.actionPicker.actions.length > 0 || view.composer.actionPicker.recoveryCommands.length > 0}
    <div
      class="player-command-panel__actions {view.composer.actionPicker.root.className}"
      data-component={view.composer.actionPicker.root.data.component}
      data-testid={view.composer.actionPicker.root.testId}
    >
      <h3>{view.composer.actionHeading}</h3>
      {#each view.composer.actionPicker.actions as pickerAction (pickerAction.action)}
        <div
          class={pickerAction.className}
          data-template-id={pickerAction.templateId}
          data-selected-target={pickerAction.selectedTarget}
        >
          {#if pickerAction.options.length > 0}
            <div
              class={pickerAction.optionsClassName}
              role="radiogroup"
              aria-label={`Target for ${pickerAction.label}`}
            >
              {#each pickerAction.options as option (option.slot)}
                <label
                  class={option.className}
                  data-testid={option.testId}
                  data-min-touch-target-px={option.minTouchTargetPx}
                >
                  <input
                    type="radio"
                    name={option.name}
                    value={option.slot}
                    checked={option.checked}
                    on:change={() => onSelectTarget(pickerAction.templateId, option.slot)}
                  />
                  <span>{option.label}</span>
                </label>
              {/each}
            </div>
          {/if}
          <button
            type="button"
            class={pickerAction.trigger.className}
            data-testid={pickerAction.trigger.testId}
            data-action={pickerAction.trigger.data.action}
            data-command-recovery-return={pickerAction.action}
            data-template-id={pickerAction.trigger.data.templateId}
            data-target-slots={pickerAction.trigger.data.targetSlots.join(",")}
            data-min-touch-target-px={pickerAction.trigger.data.minTouchTargetPx}
            disabled={pickerAction.trigger.disabled}
            aria-disabled={pickerAction.trigger.disabled ? "true" : undefined}
            aria-expanded={pickerAction.trigger.ariaExpanded}
            bind:this={triggerElements[pickerAction.action]}
            on:click={() => activateConfirmation(pickerAction)}
          >
            <span>{pickerAction.label}</span>
            {#if pickerAction.detail}
              <small>{pickerAction.detail}</small>
            {/if}
          </button>
          {#if pickerAction.confirming}
            <ConfirmationShell
              className={pickerAction.confirmation.className}
              confirmation={pickerAction.confirmation}
              testId={pickerAction.confirmation.confirmationTestId}
              onKeydown={(event) => onConfirmationKeydown(event, pickerAction)}
            >
              <p
                id={pickerAction.confirmation.messageId}
                data-testid={pickerAction.confirmation.messageTestId}
              >
                {pickerAction.confirmation.message}
              </p>
              <div class={pickerAction.confirmation.actionsClassName}>
                <button
                  type="button"
                  class={pickerAction.confirmation.confirmClassName}
                  data-testid={pickerAction.confirmation.confirmTestId}
                  data-min-touch-target-px={pickerAction.trigger.data.minTouchTargetPx}
                  bind:this={confirmElements[pickerAction.action]}
                  on:click={() => confirmPickerAction(pickerAction)}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  class={pickerAction.confirmation.cancelClassName}
                  data-testid={pickerAction.confirmation.cancelTestId}
                  data-min-touch-target-px={pickerAction.trigger.data.minTouchTargetPx}
                  on:click={() => cancelConfirmation(pickerAction)}
                >
                  Cancel
                </button>
              </div>
            </ConfirmationShell>
          {/if}
        </div>
      {/each}
      {#each view.composer.actionPicker.recoveryCommands as button (button.action)}
        <button
          type="button"
          class={button.className}
          data-action={button.data.action}
          data-command-recovery-return={button.action}
          data-template-id={button.data.templateId}
          data-target-slots={button.data.targetSlots.join(",")}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          disabled={button.disabled}
          aria-disabled={button.disabled ? "true" : undefined}
          bind:this={triggerElements[button.action]}
          on:click={() => dispatchCommand(button.action)}
        >
          <span>{button.label}</span>
          {#if button.detail}
            <small>{button.detail}</small>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
  {/if}
</aside>

<style>
  .player-command-panel__vote-row {
    align-items: center;
    border-block-start: 1px solid var(--fm-line-soft);
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 44px;
    padding-block: 8px;
  }

  .player-command-panel__context {
    background: var(--fm-surface-muted);
    border: 1px solid var(--fm-line-strong);
    border-radius: 8px;
    display: grid;
    gap: 0;
    padding: 4px 10px;
    min-inline-size: 0;
  }

  .player-command-panel__deadline,
  .player-command-panel__current-vote {
    align-items: center;
    display: grid;
    gap: 8px;
    grid-template-columns: auto minmax(0, 1fr);
    min-block-size: 32px;
    min-inline-size: 0;
    padding: 3px 0;
  }

  .player-command-panel__current-vote {
    border-block-start: 1px solid var(--fm-line-strong);
  }

  .player-command-panel__deadline span,
  .player-command-panel__current-vote span {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-command-panel__deadline strong {
    color: var(--fm-ink);
    font-size: 15px;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-align: end;
  }

  .player-command-panel__current-vote strong {
    color: var(--fm-ink);
    font-size: 15px;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-align: end;
  }

  .player-command-panel__vote-row span {
    color: var(--fm-ink-subtle);
    overflow-wrap: anywhere;
  }

  .player-command-panel__composer {
    display: grid;
    gap: 10px;
    margin-block-start: 8px;
  }

  .player-command-panel__quick-actions {
    --fm-action-tray-min: 104px;
    border-block-start: 1px solid var(--fm-line-soft);
    padding-block-start: 10px;
  }

  .player-command-panel__quick-actions button:disabled {
    display: none;
  }

  .player-command-panel__actions {
    border-block-start: 1px solid var(--fm-line-soft);
    display: grid;
    gap: 8px;
    padding-block-start: 10px;
  }

  .player-command-panel__actions h3 {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    line-height: 1.25;
    margin: 0;
    text-transform: uppercase;
  }

  .player-command-panel__actions button {
    display: grid;
    gap: 2px;
    justify-items: start;
    text-align: start;
  }

  .player-command-panel__actions small {
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
    opacity: 0.74;
    overflow-wrap: anywhere;
  }

  .player-command-panel__channel-context {
    min-block-size: 58px;
  }

  .player-command-panel__composer label span,
  .player-command-panel__channel-context span,
  .player-command-panel__channel-context small {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-transform: uppercase;
  }

  .player-command-panel__channel-context strong {
    color: var(--fm-ink);
    font-size: 16px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

</style>
