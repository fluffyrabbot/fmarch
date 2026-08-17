<script>
  export let view;
  export let composer;
  export let body = "";
  export let mediaFiles = undefined;
  export let mediaAlt = "";
  export let mediaResetKey = 0;
  export let attachedQuotations = [];
  export let onCommand = () => {};
  export let onRemoveQuote = () => {};
</script>

{#if view?.readOnly !== true}
  <section class="compose-sheet" id="player-composer" data-testid="player-composer">
    <header>
      <div
        data-testid={view.channelContext.testId}
        data-channel-id={view.channelContext.channelId}
        data-capability-label={view.channelContext.capabilityLabel}
        data-actor-slot={view.channelContext.slotId}
        data-actor-alive={view.channelContext.actorAlive}
        data-actor-status={view.channelContext.actorStatus}
      >
        <p class="fm-eyebrow">Reply</p>
        <h2>{view.channelContext.channelLabel}</h2>
        <span class="fm-sr-only">{view.channelContext.label}: {view.channelContext.value}</span>
      </div>
      <span>{view.channelContext.audienceLabel}</span>
    </header>
    {#if attachedQuotations.length > 0}
      <ul class="compose-sheet__quotes" data-testid="player-quote-chips">
        {#each attachedQuotations as quotation}
          <li data-testid={`player-quote-chip-${quotation.sourceSeq}`}>
            <strong>{quotation.authorLabel}</strong>
            <span>#{quotation.sourceSeq}</span>
            <p>{quotation.excerpt}</p>
            <button
              type="button"
              class="fm-touch-button fm-touch-button--secondary"
              data-min-touch-target-px="44"
              data-testid={`player-quote-remove-${quotation.sourceSeq}`}
              on:click={() => onRemoveQuote(quotation.sourceSeq)}
            >
              Remove
            </button>
          </li>
        {/each}
      </ul>
    {/if}
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
          {#key mediaResetKey}
            <input
              data-testid="player-media-file"
              type="file"
              accept={(composer.mediaUploadTypes ?? ["image/png", "image/jpeg"]).join(",")}
              bind:files={mediaFiles}
            />
          {/key}
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
{:else}
  <section
    class="compose-sheet compose-sheet--read-only"
    data-testid="player-composer-read-only"
    data-channel-id={view?.channelContext?.channelId}
    aria-live="polite"
  >
    <p class="fm-eyebrow">Read-only room</p>
    <h2>{view?.channelContext?.channelLabel ?? "Channel history"}</h2>
    <p>{view?.reason ?? "Posting is unavailable in this room."}</p>
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

  .compose-sheet--read-only {
    color: var(--fm-ink-muted);
  }

  .compose-sheet header > span {
    color: var(--fm-ink-muted);
    font-size: 12px;
    text-align: end;
  }

  .compose-sheet__quotes {
    display: grid;
    gap: 10px;
    list-style: none;
    margin: 0;
    min-inline-size: 0;
    padding: 0;
  }

  .compose-sheet__quotes li {
    border: 1px solid var(--fm-line-strong, var(--fm-line));
    display: grid;
    gap: 6px;
    min-inline-size: 0;
    padding: 10px;
  }

  .compose-sheet__quotes p {
    margin: 0;
    overflow-wrap: anywhere;
    white-space: pre-wrap;
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
