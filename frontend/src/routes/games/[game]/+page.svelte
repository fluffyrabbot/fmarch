<script>
  export let data;
  export let form;

  function occurredAt(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toLocaleString()
      : "Time unavailable";
  }
</script>

<svelte:head><title>{data.publication.metadata?.title ?? "Public game"} | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="public-game-surface">
  {#if data.publicGame.status === "unavailable"}
    <p class="fm-panel" data-testid="public-game-unavailable">This game is not publicly available.</p>
  {:else}
    <article
      class="public-game-publication"
      data-component={data.publication.root.data.component}
      data-publication-mode={data.publication.root.data.mode}
      data-testid={data.publication.root.testId}
    >
      <header class="public-game-masthead" data-testid={data.publication.metadata.testId}>
        <p class="fm-eyebrow">{data.publication.metadata.eyebrow}</p>
        <h2>{data.publication.metadata.title}</h2>
        <p class="public-game-deck">{data.publication.metadata.deck}</p>
        <div class="public-game-meta" data-testid="public-game-summary">
          <span><strong>{data.publication.metadata.statusLabel}</strong></span>
          <span>{data.publication.metadata.phaseLabel}</span>
          <span>{data.publication.readingLane.postCountLabel}</span>
        </div>
        {#if data.publicGame.subscription !== null}
          <div class="public-game-actions">
            <form method="POST" action="?/watch" data-testid="public-game-watch-control">
              <input type="hidden" name="watch_action" value={data.publicGame.subscription.subscribed ? "unsubscribe" : "subscribe"} />
              <button class="fm-touch-button fm-touch-button--secondary" type="submit" data-testid="public-game-watch-submit">
                {data.publicGame.subscription.subscribed ? "Stop watching" : "Watch this game"}
              </button>
            </form>
            <a href="/inbox" class="fm-touch-button fm-touch-button--secondary" data-testid="public-game-inbox-link">
              Inbox{data.publicGame.subscription.unread_count > 0 ? ` (${data.publicGame.subscription.unread_count})` : ""}
            </a>
          </div>
        {/if}
      </header>

      {#if data.publicGame.posts.length > 0}
        <a class="public-game-skip-posts" href={`#thread-post-${data.publicGame.posts[0].source_seq}`} data-testid={data.publication.readingLane.skipPostsTestId}>
          Skip to first public post
        </a>
      {/if}

      <section
        class="public-game-reading-lane"
        aria-labelledby={data.publication.readingLane.headingId}
        data-testid={data.publication.readingLane.testId}
        style={`--public-game-reading-measure: ${data.publication.readingLane.maxMeasurePx}px`}
      >
        <header class="public-game-thread-heading" data-testid="public-game-thread">
          <h2 id={data.publication.readingLane.headingId} tabindex="-1">{data.publication.readingLane.heading}</h2>
          <span>{data.publication.readingLane.postCountLabel}</span>
        </header>
        {#if data.publicGame.posts.length === 0}
          <p class="public-game-empty" data-testid="public-game-thread-empty">No public main-thread posts yet.</p>
        {:else}
          {#each data.publicGame.posts as post}
            <article
              id={`thread-post-${post.source_seq}`}
              class="public-game-post"
              aria-labelledby={`public-game-post-author-${post.source_seq} public-game-post-meta-${post.source_seq}`}
              tabindex="-1"
              data-testid={`public-game-post-${post.source_seq}`}
            >
              <header>
                <strong id={`public-game-post-author-${post.source_seq}`}>{post.author_slot ?? post.author_user ?? "System"}</strong>
                <a id={`public-game-post-meta-${post.source_seq}`} href={`#thread-post-${post.source_seq}`}>#{post.source_seq} · {occurredAt(post.occurred_at)}</a>
              </header>
              <p>{post.body}</p>
              {#if data.publicGame.hasSession}
                <details class="report-control" data-testid={`public-game-report-${post.source_seq}`}>
                  <summary>Report this post</summary>
                  <form method="POST" action="?/report">
                    <input type="hidden" name="source_seq" value={post.source_seq} />
                    <label class="fm-field"><span>Reason</span><select name="reason_family" required><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hate</option><option value="sexual_content">Sexual content</option><option value="self_harm">Self-harm</option><option value="other">Other</option></select></label>
                    <label class="fm-field"><span>Context (optional)</span><textarea name="details" maxlength="1000"></textarea></label>
                    <button class="fm-touch-button fm-touch-button--secondary" type="submit">Submit report</button>
                  </form>
                </details>
              {/if}
            </article>
          {/each}
        {/if}
        {#if data.publicGame.nextBeforeSeq !== null}
          <a class="fm-touch-button fm-touch-button--secondary public-game-older" href={`?before_seq=${data.publicGame.nextBeforeSeq}#${data.publication.readingLane.headingId}`} data-testid="public-game-older">Older posts</a>
        {/if}
      </section>

      <footer class="public-game-colophon">
        This publication contains only the public main thread. Private channels and role data are excluded.
      </footer>
    </article>
    {#if form?.id === "public-game-report"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="public-game-report-result">{form.message}{form.reportId ? ` Receipt ${form.reportId}` : ""}</p>
    {/if}
    {#if form?.id === "public-game-watch"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="public-game-watch-result">{form.message}</p>
    {/if}
  {/if}
</main>

<style>
  .public-game-publication { display: grid; gap: 32px; margin-inline: auto; max-inline-size: 1080px; padding-block-end: 48px; width: 100%; }
  .public-game-masthead { border-block-end: 1px solid var(--fm-line-strong); display: grid; gap: 10px; margin-inline: auto; max-inline-size: var(--public-game-reading-measure, 760px); padding-block: 4px 22px; width: 100%; }
  .public-game-masthead h2 { font-family: var(--fm-font-display); font-size: clamp(32px, 6vw, 56px); line-height: 1; margin: 0; }
  .public-game-deck { color: var(--fm-ink-muted); font-size: clamp(17px, 2vw, 21px); line-height: 1.45; margin: 0; max-inline-size: 42rem; }
  .public-game-meta, .public-game-actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px 18px; }
  .public-game-meta { color: var(--fm-ink-muted); font-size: 14px; }
  .public-game-meta span + span { border-inline-start: 1px solid var(--fm-line); padding-inline-start: 18px; }
  .public-game-actions form { margin: 0; }
  .public-game-reading-lane { margin-inline: auto; max-inline-size: var(--public-game-reading-measure, 760px); width: 100%; }
  .public-game-skip-posts { block-size: 1px; clip-path: inset(50%); inline-size: 1px; overflow: hidden; position: absolute; white-space: nowrap; }
  .public-game-skip-posts:focus { block-size: auto; clip-path: none; inline-size: auto; inset-inline-start: 16px; padding: 10px 14px; position: fixed; top: 80px; z-index: 20; }
  .public-game-thread-heading { align-items: baseline; display: flex; justify-content: space-between; padding-block-end: 12px; }
  .public-game-thread-heading h2 { font-family: var(--fm-font-display); font-size: 28px; margin: 0; }
  .public-game-thread-heading span { color: var(--fm-ink-muted); font-size: 13px; font-weight: 750; }
  .public-game-post { border-block-start: 1px solid var(--fm-line); padding-block: 20px 24px; scroll-margin-block-start: 88px; }
  .public-game-post header { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; }
  .public-game-post header a { color: var(--fm-ink-muted); font-size: 13px; }
  .public-game-post p { font-size: 17px; line-height: 1.65; margin-block-end: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .report-control { margin-block-start: 10px; }
  .report-control summary { min-block-size: 44px; }
  .report-control form { display: grid; gap: 10px; margin-block-start: 10px; }
  .report-control textarea { min-block-size: 72px; resize: vertical; }
  .public-game-empty { border-block-start: 1px solid var(--fm-line); color: var(--fm-ink-muted); padding-block: 24px; }
  .public-game-older { margin-block-start: 16px; }
  .public-game-colophon { border-block-start: 1px solid var(--fm-line); color: var(--fm-ink-muted); font-size: 13px; margin-inline: auto; max-inline-size: var(--public-game-reading-measure, 760px); padding-block-start: 16px; width: 100%; }

  @media (max-width: 600px) {
    .public-game-publication { gap: 24px; }
    .public-game-masthead h2 { font-size: 34px; }
    .public-game-meta span + span { border: 0; padding: 0; }
    .public-game-post p { font-size: 16px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .public-game-post, #public-game-thread-title { scroll-behavior: auto; }
  }

  @media (forced-colors: active) {
    .public-game-masthead, .public-game-post, .public-game-colophon { border-color: CanvasText; }
    .public-game-skip-posts:focus { border: 2px solid Highlight; }
  }
</style>
