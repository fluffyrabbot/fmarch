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
  <div class="player-surface__deadline" data-testid="player-deadline">
    {phase.deadlineLabel}
  </div>

  {#if liveOfficialPost !== null}
    <aside
      class="player-surface__official-post"
      data-testid="player-live-official-post"
    >
      <span>{liveOfficialPost.label}</span>
      <strong>{liveOfficialPost.value}</strong>
      <small>{liveOfficialPost.detail}</small>
    </aside>
  {/if}

  <div
    class="player-surface__pager"
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
    <article class="player-surface__post" data-testid={`thread-post-${post.seq}`}>
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
              <img
                src={item.src}
                srcset={item.srcset}
                sizes={item.sizes}
                alt={item.alt}
                width={item.width}
                height={item.height}
                loading="lazy"
                decoding="async"
              />
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

  .player-surface__deadline,
  .player-surface__official-post,
  .player-surface__pager,
  .player-surface__post {
    background: rgba(255, 255, 255, 0.74);
    border: 1px solid #bdc7c1;
    border-radius: 8px;
  }

  .player-surface__deadline {
    color: #173824;
    font-size: 18px;
    font-weight: 800;
    min-block-size: 52px;
    padding: 14px;
  }

  .player-surface__official-post {
    border-color: #557f68;
    border-inline-start: 6px solid #557f68;
    display: grid;
    gap: 4px;
    min-block-size: 72px;
    padding: 12px 14px;
  }

  .player-surface__official-post span,
  .player-surface__official-post small {
    color: #425063;
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .player-surface__official-post strong {
    color: #173824;
    font-size: 17px;
    line-height: 1.25;
    overflow-wrap: anywhere;
  }

  .player-surface__pager {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 64px;
    padding: 12px 14px;
  }

  .player-surface__pager span {
    color: #53606f;
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

  .player-surface__post {
    display: grid;
    gap: 10px;
    padding: 14px;
  }

  .player-surface__post header {
    align-items: center;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .player-surface__post span {
    color: #53606f;
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

  .player-surface__media-item img {
    aspect-ratio: 4 / 3;
    background: #edf2f0;
    border: 1px solid #bdc7c1;
    border-radius: 6px;
    display: block;
    inline-size: 100%;
    max-block-size: 420px;
    object-fit: cover;
  }

  .player-surface__media-unavailable {
    background: #fff8e5;
    border: 1px solid #d5bd6f;
    border-radius: 6px;
    color: #4f3f05;
    font-size: 14px;
    font-weight: 800;
    min-block-size: 44px;
    padding: 12px;
  }
</style>
