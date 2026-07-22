<script>
  export let view;
  export let composer;
  export let body = "";
  export let mediaFiles = undefined;
  export let mediaAlt = "";
  export let onCommand = () => {};
</script>

{#if view?.readOnly !== true}
  <section class="compose-sheet" id="player-composer" data-testid="player-composer">
    <header>
      <div
        data-testid={view.channelContext.testId}
        data-channel-id={view.channelContext.channelId}
        data-capability-label={view.channelContext.capabilityLabel}
      >
        <p class="fm-eyebrow">Reply</p>
        <h2>{view.channelContext.channelLabel}</h2>
        <span class="fm-sr-only">{view.channelContext.label}: {view.channelContext.value}</span>
      </div>
      <span>{view.channelContext.audienceLabel}</span>
    </header>
    <label class="fm-field">
      <span>{view.label}</span>
      <textarea bind:value={body} rows="5"></textarea>
    </label>
    <details
      class="compose-sheet__media fm-proof-disclosure"
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
    <div class="compose-sheet__actions">
      {#each view.buttons as button}
        <button
          type="button"
          class={button.className}
          data-action={button.action}
          data-command-recovery-return={button.action}
          data-min-touch-target-px={button.data.minTouchTargetPx}
          data-disabled-reason={button.reason}
          disabled={button.disabled}
          aria-disabled={button.disabled ? "true" : undefined}
          on:click={() => onCommand(button.action)}
        >
          {button.label}
        </button>
      {/each}
    </div>
  </section>
{/if}

<style>
  .compose-sheet {
    border-block-start: 1px solid var(--fm-line-strong);
    display: grid;
    gap: 14px;
    padding-block-start: 22px;
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size) + 16px);
  }

  .compose-sheet header {
    align-items: end;
    display: flex;
    gap: 18px;
    justify-content: space-between;
  }

  .compose-sheet h2,
  .compose-sheet p {
    margin: 0;
  }

  .compose-sheet header > span {
    color: var(--fm-ink-muted);
    font-size: 12px;
    text-align: end;
  }

  .compose-sheet__actions {
    display: flex;
    justify-content: end;
  }

  @media (max-width: 560px) {
    .compose-sheet header {
      align-items: start;
      display: grid;
      gap: 4px;
    }

    .compose-sheet header > span {
      text-align: start;
    }

    .compose-sheet__actions > button {
      inline-size: 100%;
      justify-content: center;
    }
  }
</style>
