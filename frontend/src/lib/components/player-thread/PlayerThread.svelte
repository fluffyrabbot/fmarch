<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    PLAYER_THREAD_MEDIA_CONTRACT,
    buildPlayerThreadViewModel,
  } from "./player-thread-model.mjs";

  export let phase;
  export let thread;
  export let liveOfficialPost = null;
  export let threadPageStatus = null;
  export let onLoadOlder = () => {};

  $: threadView = buildPlayerThreadViewModel(thread, { threadPageStatus });
</script>

<section class="player-surface__thread" aria-label="Thread">
  {#if phase.deadlineLabel}
    <div class="player-surface__deadline fm-card" data-testid="player-deadline">
      {phase.deadlineLabel}
    </div>
  {/if}

  {#if liveOfficialPost !== null}
    <aside
      class="player-surface__official-post fm-card"
      data-testid="player-live-official-post"
    >
      <span>{liveOfficialPost.label}</span>
      <strong>{liveOfficialPost.value}</strong>
      <small>{liveOfficialPost.detail}</small>
    </aside>
  {/if}

  <div
    class="player-surface__pager fm-card"
    aria-busy={threadView.pager.root.busy}
    data-component={threadView.pager.root.component}
    data-state={threadView.pager.root.state}
    data-testid={threadView.pager.root.testId}
  >
    <div>
      <span>Thread page</span>
      <strong
        data-next-before-seq={threadView.pager.cursor.nextBeforeSeq}
        data-testid={threadView.pager.cursor.testId}
      >
        {threadView.pager.cursor.label}
      </strong>
    </div>
    <button
      type="button"
      class="fm-touch-button fm-touch-button--secondary"
      aria-disabled={threadView.pager.button.ariaDisabled}
      disabled={threadView.pager.button.disabled}
      data-min-touch-target-px={threadView.pager.button.minTouchTargetPx}
      data-next-before-seq={threadView.pager.button.nextBeforeSeq}
      data-testid={threadView.pager.button.testId}
      on:click={onLoadOlder}
    >
      <span class="fm-touch-button__label">{threadView.pager.button.label}</span>
      {#if threadView.pager.button.disabledReason !== null}
        <small class="fm-touch-button__reason">{threadView.pager.button.disabledReason}</small>
      {/if}
    </button>
  </div>
  {#if threadPageStatus}
    <AppStatus
      status={threadPageStatus}
      testId="player-thread-page-status"
      className="player-surface__command-status"
    />
  {/if}

  {#each threadView.posts as post}
    <article class="player-surface__post fm-card" data-testid={`thread-post-${post.seq}`}>
      <header>
        <strong>{post.authorLabel}</strong>
        <span>{post.meta}</span>
      </header>
      <p>{post.body}</p>
      {#if post.media.items.length > 0 || post.media.withheld.length > 0}
        <div
          class="player-surface__post-media"
          data-component={PLAYER_THREAD_MEDIA_CONTRACT.component}
          data-boundary-status={post.mediaBoundary.status}
          data-testid={`thread-post-media-boundary-${post.seq}`}
        >
          {#each post.media.items as item}
            <figure
              class="player-surface__media-item"
              data-testid={item.testId}
              data-media-variant={item.variant}
            >
              <picture>
                {#each item.sources as source}
                  {#if source.srcset !== null}
                    <source type={source.type} srcset={source.srcset} sizes={item.sizes} />
                  {/if}
                {/each}
                <img
                  src={item.src}
                  sizes={item.sizes}
                  alt={item.alt}
                  width={item.width}
                  height={item.height}
                  loading="lazy"
                  decoding="async"
                />
              </picture>
            </figure>
          {/each}
          {#each post.media.withheld as item}
            <p
              class="player-surface__media-unavailable"
              data-testid={`thread-post-media-withheld-${item.id}`}
            >
              {PLAYER_THREAD_MEDIA_CONTRACT.unavailableLabel}
            </p>
          {/each}
        </div>
      {/if}
    </article>
  {/each}

  <slot />
</section>

<style>
  .player-surface__thread {
    display: grid;
    gap: 12px;
    min-inline-size: 0;
  }

  .player-surface__deadline {
    color: var(--fm-accent-ink);
    font-size: 18px;
    font-weight: 800;
    min-block-size: 52px;
  }

  .player-surface__official-post {
    border-color: var(--fm-accent);
    border-inline-start: 6px solid var(--fm-accent);
    gap: 4px;
    min-block-size: 72px;
  }

  .player-surface__official-post span,
  .player-surface__official-post small {
    color: var(--fm-ink-muted);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .player-surface__official-post strong {
    color: var(--fm-accent-ink);
    font-size: 17px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-surface__pager {
    align-items: center;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 64px;
  }

  .player-surface__pager span {
    color: var(--fm-ink-subtle);
    display: block;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .player-surface__pager strong {
    display: block;
    margin-block-start: 2px;
    overflow-wrap: anywhere;
  }

  .player-surface__post header {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .player-surface__post span {
    color: var(--fm-ink-subtle);
  }

  .player-surface__post p {
    font-size: 17px;
    line-height: 1.45;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .player-surface__post-media {
    display: grid;
    gap: 8px;
  }

  .player-surface__media-item {
    margin: 0;
  }

  .player-surface__media-item picture {
    display: block;
    inline-size: 100%;
  }

  .player-surface__media-item img {
    background: var(--fm-surface-tint);
    border: 1px solid var(--fm-line);
    border-radius: 6px;
    display: block;
    inline-size: 100%;
    max-block-size: 420px;
    object-fit: cover;
  }

  .player-surface__media-unavailable {
    background: var(--fm-confirm-wash);
    border: 1px solid var(--fm-official);
    border-radius: 6px;
    color: var(--fm-official-ink);
    font-size: 14px;
    font-weight: 800;
    min-block-size: 44px;
    padding: 12px;
  }
</style>
