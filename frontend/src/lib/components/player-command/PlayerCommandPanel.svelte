<script>
  import {
    buildPlayerCommandPanelViewModel,
  } from "./player-command-panel-model.mjs";

  export let composer;
  export let phase = {};
  export let votecount = [];
  export let channel = {};
  export let player = {};
  export let body = "";
  export let onCommand = () => {};

  $: view = buildPlayerCommandPanelViewModel({
    composer,
    phase,
    votecount,
    channel,
    player,
  });
</script>

<aside
  class={view.root.className}
  aria-label="Votecount"
  data-component={view.root.data.component}
  data-thumb-zone={view.root.data.thumbZone}
  data-channel-id={view.root.data.channelId}
  data-testid={view.root.testId}
>
  <h2>{view.heading}</h2>
  <div
    class="player-command-panel__deadline fm-well"
    data-testid={view.deadline.testId}
    data-state={view.deadline.state}
    data-projected={view.deadline.isProjected}
  >
    <span>{view.deadline.label}</span>
    <strong>{view.deadline.value}</strong>
    <small>{view.deadline.phaseLabel}</small>
  </div>
  {#each view.rows as row}
    <div class="player-command-panel__vote-row">
      <span>{row.target}</span>
      <strong>{row.tally}</strong>
    </div>
  {/each}
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
    <div
      class="player-command-panel__current-vote fm-well"
      data-testid={view.composer.currentVote.testId}
      data-has-vote={view.composer.currentVote.hasVote}
    >
      <span>{view.composer.currentVote.label}</span>
      <strong>{view.composer.currentVote.value}</strong>
    </div>
    <label class="fm-field">
      <span>{view.composer.label}</span>
      <textarea bind:value={body} rows="3"></textarea>
    </label>
    <div class="fm-touch-row">
      {#each view.composer.buttons as button}
        <button
          type="button"
          class={button.className}
          data-action={button.data.action}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          data-disabled-reason={button.reason}
          disabled={button.disabled}
          on:click={() => onCommand(button.action)}
        >
          {button.label}
        </button>
      {/each}
    </div>
  </div>
  {#if view.composer.actionButtons.length > 0}
    <div class="player-command-panel__actions" data-testid="player-action-commands">
      <h3>{view.composer.actionHeading}</h3>
      {#each view.composer.actionButtons as button}
        <button
          type="button"
          class={button.className}
          data-action={button.data.action}
          data-template-id={button.data.templateId}
          data-target-slots={button.data.targetSlots.join(",")}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          disabled={button.disabled}
          on:click={() => onCommand(button.action)}
        >
          <span>{button.label}</span>
          {#if button.detail}
            <small>{button.detail}</small>
          {/if}
        </button>
      {/each}
    </div>
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

  .player-command-panel__deadline {
    min-block-size: 72px;
  }

  .player-command-panel__deadline span,
  .player-command-panel__deadline small {
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

  .player-command-panel__channel-context,
  .player-command-panel__current-vote {
    min-block-size: 58px;
  }

  .player-command-panel__composer label span,
  .player-command-panel__current-vote span,
  .player-command-panel__channel-context span,
  .player-command-panel__channel-context small {
    color: var(--fm-ink-subtle);
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-transform: uppercase;
  }

  .player-command-panel__current-vote strong {
    color: var(--fm-ink);
    font-size: 16px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-command-panel__channel-context strong {
    color: var(--fm-ink);
    font-size: 16px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

</style>
