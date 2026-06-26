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
    class="player-command-panel__deadline"
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
      class="player-command-panel__channel-context"
      data-testid={view.composer.channelContext.testId}
      data-channel-id={view.composer.channelContext.channelId}
      data-channel-label={view.composer.channelContext.channelLabel}
      data-capability-label={view.composer.channelContext.capabilityLabel}
      data-actor-slot={view.composer.channelContext.slotId}
    >
      <span>{view.composer.channelContext.label}</span>
      <strong>{view.composer.channelContext.value}</strong>
      <small>{view.composer.channelContext.capabilityLabel}</small>
    </div>
    <label>
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
  .player-command-panel {
    align-content: start;
    background: rgba(255, 255, 255, 0.74);
    border: 1px solid #bdc7c1;
    border-radius: 8px;
    display: grid;
    gap: 12px;
    min-inline-size: 0;
    padding: 14px;
  }

  .player-command-panel__vote-row {
    align-items: center;
    border-block-start: 1px solid #d0d8d3;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 44px;
    padding-block: 8px;
  }

  .player-command-panel__deadline {
    background: #eef4f6;
    border: 1px solid #9aa7b1;
    border-radius: 8px;
    display: grid;
    gap: 2px;
    min-block-size: 72px;
    padding: 10px 12px;
  }

  .player-command-panel__deadline span,
  .player-command-panel__deadline small {
    color: #53606f;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-command-panel__deadline strong {
    color: #17212b;
    font-size: 15px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-command-panel__vote-row span {
    color: #53606f;
    overflow-wrap: anywhere;
  }

  .player-command-panel__composer {
    display: grid;
    gap: 10px;
    margin-block-start: 8px;
  }

  .player-command-panel__actions {
    border-block-start: 1px solid #d0d8d3;
    display: grid;
    gap: 8px;
    padding-block-start: 10px;
  }

  .player-command-panel__actions h3 {
    color: #53606f;
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
    background: #f7f2ea;
    border: 1px solid #d6c7ad;
    border-radius: 8px;
    display: grid;
    gap: 2px;
    min-block-size: 58px;
    padding: 10px 12px;
  }

  .player-command-panel__composer label {
    display: grid;
    gap: 6px;
  }

  .player-command-panel__composer label span,
  .player-command-panel__channel-context span,
  .player-command-panel__channel-context small {
    color: #53606f;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.25;
    overflow-wrap: anywhere;
    text-transform: uppercase;
  }

  .player-command-panel__channel-context strong {
    color: #17212b;
    font-size: 16px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-command-panel__composer textarea {
    border: 1px solid #9aa7b1;
    border-radius: 8px;
    color: #17212b;
    font: inherit;
    line-height: 1.4;
    min-block-size: 78px;
    padding: 10px;
    resize: vertical;
  }

</style>
