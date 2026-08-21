<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import {
    PLAYER_THREAD_MEDIA_CONTRACT,
    buildPlayerThreadViewModel,
  } from "./player-thread-model.mjs";

  export let thread;
  export let liveOfficialPost = null;
  export let threadPageStatus = null;
  export let quoteEnabled = false;
  export let onLoadOlder = () => {};
  export let onQuote = () => {};

  let activeEmbedSeq = null;
  $: threadView = buildPlayerThreadViewModel(thread, { threadPageStatus, quoteEnabled });
</script>

<section class="player-surface__thread" aria-label="Thread">
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
    <article
      id={`thread-post-${post.seq}`}
      class="player-surface__post"
      data-testid={`thread-post-${post.seq}`}
    >
      <header>
        <div class="player-surface__post-identity">
          <strong>{post.authorLabel}</strong>
        </div>
        <div class="player-surface__post-meta">
          {#if post.permalink !== null}
            <a
              class="player-surface__post-permalink"
              href={post.permalink.href}
              aria-label={post.permalink.ariaLabel}
              data-testid={post.permalink.testId}
            >
              {post.permalink.label}{#if post.permalink.meta !== ""} · {post.permalink.meta}{/if}
            </a>
          {/if}
          {#if post.quoteEnabled}
            <button
              type="button"
              class="fm-touch-button fm-touch-button--secondary player-surface__quote-button"
              data-min-touch-target-px="44"
              data-testid={`player-quote-${post.seq}`}
              on:click={() => onQuote(post)}
            >
              Quote
            </button>
          {/if}
        </div>
      </header>
      {#each post.quotations as quotation}
        <blockquote
          class="player-surface__quote"
          data-testid={`player-quote-block-${post.seq}-${quotation.sourceSeq}`}
        >
          <p>{quotation.excerpt}</p>
          <cite>
            {#if quotation.originalUnavailable}
              Original unavailable
            {:else}
              {quotation.authorLabel}
            {/if}
            <a href={quotation.href}>#{quotation.sourceSeq}</a>
          </cite>
        </blockquote>
      {/each}
      <p class="player-surface__post-body">{post.body}</p>
      {#if post.embed !== null}
        <div class="player-surface__embed" data-testid={`thread-post-embed-${post.seq}`}>
          {#if activeEmbedSeq === post.seq}
            <iframe
              class="player-surface__embed-frame"
              title={post.embed.playLabel}
              src={post.embed.playbackSrc}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              sandbox="allow-scripts allow-same-origin allow-presentation"
              referrerpolicy="no-referrer-when-downgrade"
            ></iframe>
          {:else}
            <button
              type="button"
              class="fm-touch-button fm-touch-button--secondary player-surface__embed-play"
              data-min-touch-target-px="44"
              data-testid={post.embed.testId}
              on:click={() => {
                activeEmbedSeq = post.seq;
              }}
            >
              {post.embed.playLabel}
            </button>
          {/if}
        </div>
      {/if}
      {#if post.citationCount > 0}
        <details
          class="player-surface__citations"
          data-testid={`player-citations-${post.seq}`}
        >
          <summary>
            Quoted {post.citationCount}
            {post.citationCount === 1 ? "time" : "times"}
          </summary>
          <ul>
            {#each post.incomingCitations as citation}
              <li>
                <a
                  href={citation.href}
                  data-testid={`player-citation-${post.seq}-${citation.sourceSeq}`}
                >
                  #{citation.sourceSeq}
                </a>
              </li>
            {/each}
          </ul>
          {#if post.moreCitationCount > 0}
            <p class="player-surface__citations-more">and {post.moreCitationCount} more</p>
          {/if}
        </details>
      {/if}
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
    gap: 0;
    min-inline-size: 0;
  }

  .player-surface__official-post {
    border-color: var(--fm-accent);
    border-inline-start: 6px solid var(--fm-accent);
    gap: 4px;
    min-block-size: 72px;
    margin-block: 12px;
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
    border-block-end: 1px solid var(--fm-line-soft);
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    min-block-size: 52px;
    padding-block: 4px;
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
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    justify-content: space-between;
  }

  .player-surface__post:has(.player-surface__quote-button) header {
    padding-inline-end: 56px;
  }

  .player-surface__post-identity {
    align-items: baseline;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-inline-size: 0;
  }

  .player-surface__post-meta {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    min-inline-size: 0;
  }

  .player-surface__post-permalink {
    color: var(--fm-ink-subtle);
    font-size: 13px;
  }

  .player-surface__post-permalink {
    text-decoration: none;
  }

  .player-surface__post-permalink:hover,
  .player-surface__post-permalink:focus-visible {
    text-decoration: underline;
  }

  .player-surface__quote-button {
    font-size: 13px;
    font-weight: 800;
    inset-block-start: 0;
    inset-inline-end: 0;
    min-inline-size: 44px;
    padding-inline: 12px;
    position: absolute;
    z-index: 1;
  }

  .player-surface__post {
    border-block-end: 1px solid var(--fm-line-soft);
    display: grid;
    gap: 12px;
    padding-block: 6px 22px;
    position: relative;
  }

  .player-surface__post p {
    font-size: 17px;
    line-height: 1.45;
    margin: 0;
    overflow-wrap: anywhere;
  }

  .player-surface__post-body {
    white-space: pre-wrap;
  }

  .player-surface__embed {
    display: grid;
    gap: 8px;
    min-inline-size: 0;
  }

  .player-surface__embed-play {
    justify-self: start;
  }

  .player-surface__embed-frame {
    aspect-ratio: 16 / 9;
    border: 1px solid var(--fm-line);
    border-radius: 6px;
    inline-size: 100%;
    max-block-size: 420px;
  }

  .player-surface__quote {
    border-inline-start: 4px solid var(--fm-line-strong, var(--fm-line));
    display: grid;
    gap: 6px;
    margin: 0;
    min-inline-size: 0;
    padding-inline-start: 12px;
  }

  .player-surface__quote p {
    font-size: 15px;
    white-space: pre-wrap;
  }

  .player-surface__quote cite {
    color: var(--fm-ink-subtle);
    display: flex;
    flex-wrap: wrap;
    font-size: 13px;
    gap: 8px;
  }

  .player-surface__citations {
    min-inline-size: 0;
  }

  .player-surface__citations ul {
    display: grid;
    gap: 4px;
    list-style: none;
    margin: 8px 0 0;
    padding: 0;
  }

  .player-surface__citations-more {
    color: var(--fm-ink-subtle);
    font-size: 13px;
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

  @media (max-width: 560px) {
    .player-surface__post header {
      align-items: start;
    }

    .player-surface__pager {
      min-block-size: 48px;
      padding-block-end: 6px;
    }

    .player-surface__pager > div {
      block-size: 1px;
      clip-path: inset(50%);
      inline-size: 1px;
      overflow: hidden;
      position: absolute;
      white-space: nowrap;
    }

    .player-surface__pager button {
      justify-self: start;
    }
  }
</style>
