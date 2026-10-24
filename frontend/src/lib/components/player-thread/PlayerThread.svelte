<script>
  import AppStatus from "$lib/app/AppStatus.svelte";
  import ThreadRoleReveals from "$lib/components/role-card/ThreadRoleReveals.svelte";
  import {
    PLAYER_THREAD_MEDIA_CONTRACT,
    buildPlayerThreadViewModel,
  } from "./player-thread-model.mjs";

  export let thread;
  export let threadPageStatus = null;
  export let quoteEnabled = false;
  export let roster = [];
  export let onLoadOlder = () => {};
  export let onLoadNewer = () => {};
  export let onQuote = () => {};
  /** Seats the viewer may vote for now; their posts offer "Vote" in the post menu. */
  export let votableAuthorSlots = new Set();
  /** `(slotId, invoker)`: the menu control that asked, for focus return. */
  export let onVoteAuthor = () => {};
  /** `(post)` → a promise that resolves once the post address is on the clipboard. */
  export let onCopyLink = async () => {};

  let activeEmbedSeq = null;
  // Quote is the frequent post action and stays a compact text control; Vote
  // and Copy link live in one overflow per post (usage-frequency audit,
  // decision 10). One menu is open at a time; it closes on Escape, on an
  // outside pointer press, and after any choice.
  let openMenuSeq = null;
  let copyStatus = Object.freeze({});
  let copyTimers = {};
  $: threadView = buildPlayerThreadViewModel(thread, { threadPageStatus, quoteEnabled, roster });

  function toggleMenu(event, seq) {
    openMenuSeq = event.currentTarget.open ? seq : openMenuSeq === seq ? null : openMenuSeq;
  }

  function closeMenu(seq, { focusSummary = false } = {}) {
    const menu = typeof document === "undefined" ? null : document.getElementById(`player-post-menu-${seq}`);
    if (menu) menu.open = false;
    if (openMenuSeq === seq) openMenuSeq = null;
    if (focusSummary) menu?.querySelector("summary")?.focus();
  }

  function onMenuKeydown(event, seq) {
    if (event.key === "Escape" && event.currentTarget.open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(seq, { focusSummary: true });
    }
  }

  function onDocumentPointerDown(event) {
    if (openMenuSeq === null) return;
    if (!event.target?.closest?.(`#player-post-menu-${openMenuSeq}`)) closeMenu(openMenuSeq);
  }

  function voteFromMenu(post, event) {
    const invoker = event.currentTarget.closest("details")?.querySelector("summary") ?? event.currentTarget;
    closeMenu(post.seq);
    onVoteAuthor(post.author.slotId, invoker);
  }

  async function copyFromMenu(post) {
    closeMenu(post.seq, { focusSummary: true });
    let status = "copied";
    try {
      await onCopyLink(post);
    } catch {
      status = "failed";
    }
    copyStatus = Object.freeze({ ...copyStatus, [post.seq]: status });
    clearTimeout(copyTimers[post.seq]);
    copyTimers[post.seq] = setTimeout(() => {
      const { [post.seq]: _, ...rest } = copyStatus;
      copyStatus = Object.freeze(rest);
    }, 2000);
  }
</script>

<svelte:document on:pointerdown={onDocumentPointerDown} />

<section id="player-thread" tabindex="-1" class="player-surface__thread" aria-label="Thread">
  <slot name="recovery" />
  {#if thread.nextAfterSeq != null}
    <button class="fm-touch-button" on:click={onLoadNewer} disabled={threadPageStatus?.state === "pending"}>Load newer posts</button>
  {/if}
  <div
    class="player-surface__pager"
    aria-busy={threadView.pager.root.busy}
    data-component={threadView.pager.root.component}
    data-state={threadView.pager.root.state}
    data-testid={threadView.pager.root.testId}
  >
    <span
      class="fm-sr-only"
      data-next-before-seq={threadView.pager.cursor.nextBeforeSeq}
      data-testid={threadView.pager.cursor.testId}
    >{threadView.pager.cursor.label}</span>
    <button
      type="button"
      class="player-surface__pager-button"
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

  {#each threadView.posts as post (post.seq)}
    <article
      tabindex="-1"
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
          {#if post.quoteEnabled || post.permalink !== null}
            <div class="player-surface__post-actions" data-testid={`player-post-actions-${post.seq}`}>
              {#if post.quoteEnabled}
                <button
                  type="button"
                  class="player-surface__post-action player-surface__quote-button"
                  data-testid={`player-quote-${post.seq}`}
                  on:click={() => onQuote(post)}
                >
                  Quote
                </button>
              {/if}
              {#if post.permalink !== null}
                <details
                  class="player-surface__post-menu"
                  id={`player-post-menu-${post.seq}`}
                  data-testid={`player-post-menu-${post.seq}`}
                  data-copy-status={copyStatus[post.seq] ?? "idle"}
                  on:toggle={(event) => toggleMenu(event, post.seq)}
                  on:keydown={(event) => onMenuKeydown(event, post.seq)}
                >
                  <summary
                    class="player-surface__post-action player-surface__post-menu-toggle"
                    aria-label={`More actions for post #${post.seq}`}
                    data-testid={`player-post-menu-toggle-${post.seq}`}
                  >···</summary>
                  <div class="player-surface__post-menu-items" aria-label={`Post #${post.seq} actions`}>
                    {#if post.author.kind === "slot" && votableAuthorSlots.has(post.author.slotId)}
                      <button
                        type="button"
                        class="player-surface__post-menu-item player-surface__vote-author-button"
                        data-min-touch-target-px="44"
                        data-testid={`player-vote-author-${post.seq}`}
                        on:click={(event) => voteFromMenu(post, event)}
                      >
                        Vote {post.authorLabel}
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="player-surface__post-menu-item"
                      data-min-touch-target-px="44"
                      data-testid={`player-post-copy-${post.seq}`}
                      data-copy-value={post.permalink.href}
                      on:click={() => copyFromMenu(post)}
                    >
                      {copyStatus[post.seq] === "copied" ? "Link copied" : copyStatus[post.seq] === "failed" ? "Could not copy" : "Copy link"}
                    </button>
                  </div>
                </details>
              {/if}
            </div>
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
            {#if quotation.originalState === "unavailable"}
              Original unavailable
            {:else if quotation.originalState === "unresolved"}
              Original post
            {:else}
              {quotation.authorLabel}
            {/if}
            <a href={quotation.href}>#{quotation.sourceSeq}</a>
          </cite>
        </blockquote>
      {/each}
      <p class="player-surface__post-body" data-legibility="author-content" data-testid={`thread-post-body-${post.seq}`}>
        {#each post.bodySegments as segment}
          {#if segment.kind === "mention"}
            <!-- A seat chip, not a link: a slot has no page, and giving it one
                 would be the first step toward a slot-to-human directory. -->
            <span
              class="player-surface__mention"
              data-legibility="rendered"
              data-testid={`thread-post-mention-${post.seq}-${segment.slotId}`}
            >{segment.text}</span>
          {:else}{segment.text}{/if}
        {/each}
      </p>
      <ThreadRoleReveals reveals={post.roleReveals} testId={`thread-post-roles-${post.seq}`} />
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
                  data-legibility="author-content"
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
    scroll-margin-block-start: calc(var(--fm-app-topbar-block-size, 64px) + var(--fm-game-bar-block-size, 0px) + 16px);
    display: grid;
    gap: 0;
    min-inline-size: 0;
  }


  /* One slim line: the cursor label is read by screen readers only. */
  .player-surface__pager {
    border-block-end: 1px solid var(--fm-line-soft);
    display: flex;
    justify-content: center;
  }

  .player-surface__pager-button {
    background: transparent;
    border: 0;
    color: var(--fm-ink-muted);
    cursor: pointer;
    display: inline-grid;
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    justify-items: center;
    min-block-size: 44px;
    padding: 8px 16px;
    text-transform: uppercase;
  }

  .player-surface__pager-button:disabled {
    cursor: default;
  }

  .player-surface__pager-button:hover:not(:disabled),
  .player-surface__pager-button:focus-visible {
    color: var(--fm-ink);
  }

  .player-surface__pager-button .fm-touch-button__reason {
    font-size: 11px;
    font-weight: 700;
    text-transform: none;
  }

  .player-surface__post header {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    justify-content: space-between;
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

  .player-surface__post-actions {
    align-items: center;
    display: flex;
    flex: 0 0 auto;
    gap: 2px;
  }

  /* Compact row controls: 32px tall, text only. The menu items below keep
     the 44px floor because they are the targets a thumb actually lands on. */
  .player-surface__post-action {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink-subtle);
    cursor: pointer;
    display: inline-flex;
    font: inherit;
    font-size: 13px;
    font-weight: 800;
    justify-content: center;
    line-height: 1;
    min-block-size: 32px;
    min-inline-size: 32px;
    padding: 0 8px;
  }

  .player-surface__post-action:hover,
  .player-surface__post-action:focus-visible,
  .player-surface__post-menu[open] > summary {
    background: var(--fm-surface-muted);
    color: var(--fm-ink);
  }

  .player-surface__post-menu {
    position: relative;
  }

  .player-surface__post-menu > summary {
    letter-spacing: 1px;
    list-style: none;
  }

  .player-surface__post-menu > summary::-webkit-details-marker {
    display: none;
  }

  .player-surface__post-menu-items {
    background: var(--fm-raised);
    border: 1px solid var(--fm-line-strong);
    border-radius: var(--fm-radius-control);
    box-shadow: var(--fm-shadow-floating);
    display: grid;
    inset-block-start: calc(100% + 4px);
    inset-inline-end: 0;
    min-inline-size: 168px;
    padding: 4px;
    position: absolute;
    z-index: 6;
  }

  .player-surface__post-menu-item {
    background: transparent;
    border: 0;
    border-radius: var(--fm-radius-control);
    color: var(--fm-ink);
    cursor: pointer;
    font: inherit;
    font-size: 14px;
    font-weight: 750;
    min-block-size: 44px;
    padding: 0 12px;
    text-align: start;
    white-space: nowrap;
  }

  .player-surface__post-menu-item:hover,
  .player-surface__post-menu-item:focus-visible {
    background: var(--fm-surface-muted);
  }

  /* Fine-pointer devices (mouse, trackpad) reveal the row on hover or
     keyboard focus; coarse pointers (touch) keep it visible at its compact
     height. Keyed on pointer precision, not hover capability: the tablet
     interaction contract forbids hover media queries so that no affordance
     depends on hover, and focus-within keeps this one reachable regardless. */
  @media (pointer: fine) {
    .player-surface__post-actions {
      opacity: 0;
      transition: opacity 120ms ease-out;
    }

    .player-surface__post:hover .player-surface__post-actions,
    .player-surface__post:focus-within .player-surface__post-actions,
    .player-surface__post-actions:has(.player-surface__post-menu[open]) {
      opacity: 1;
    }
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

  /* Matches the community mention weight so one mention reads the same on both
     surfaces, while staying unlinked: a seat has no page to point at. */
  .player-surface__mention {
    font-weight: 600;
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
    border-radius: var(--fm-radius-small);
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
    border-radius: var(--fm-radius-small);
    display: block;
    inline-size: 100%;
    max-block-size: 420px;
    object-fit: cover;
  }

  .player-surface__media-unavailable {
    background: var(--fm-confirm-wash);
    border: 1px solid var(--fm-official);
    border-radius: var(--fm-radius-small);
    color: var(--fm-official-ink);
    font-size: 14px;
    font-weight: 800;
    min-block-size: 44px;
    padding: 12px;
  }

  @media (max-width: 560px) {
    .player-surface__post {
      gap: 8px;
      padding-block: 6px 14px;
    }

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
