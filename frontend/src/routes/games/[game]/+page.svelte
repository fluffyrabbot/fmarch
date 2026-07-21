<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
  export let form;

  function occurredAt(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toLocaleString()
      : "Time unavailable";
  }
</script>

<svelte:head><title>{data.publicGame.game?.pack ?? "Public game"} | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="public-game-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  {#if data.publicGame.status === "unavailable"}
    <p class="fm-panel" data-testid="public-game-unavailable">This game is not publicly available.</p>
  {:else}
    <section class="fm-panel public-game-summary" data-testid="public-game-summary">
      <p><strong>Status:</strong> {data.publicGame.game.status}</p>
      <p><strong>Phase:</strong> {data.publicGame.game.phase_id ?? "Complete"}</p>
      {#if data.publicGame.subscription !== null}
        <form method="POST" action="?/watch" data-testid="public-game-watch-control">
          <input type="hidden" name="watch_action" value={data.publicGame.subscription.subscribed ? "unsubscribe" : "subscribe"} />
          <button class="fm-touch-button fm-touch-button--secondary" type="submit" data-testid="public-game-watch-submit">
            {data.publicGame.subscription.subscribed ? "Stop watching" : "Watch this game"}
          </button>
        </form>
        <a href="/inbox" class="fm-touch-button fm-touch-button--secondary" data-testid="public-game-inbox-link">
          Inbox{data.publicGame.subscription.unread_count > 0 ? ` (${data.publicGame.subscription.unread_count})` : ""}
        </a>
      {/if}
    </section>
    <section class="fm-panel" aria-label="Public main thread" data-testid="public-game-thread">
      {#if data.publicGame.posts.length === 0}
        <p data-testid="public-game-thread-empty">No public main-thread posts yet.</p>
      {:else}
        {#each data.publicGame.posts as post}
          <article id={`thread-post-${post.source_seq}`} class="public-game-post" data-testid={`public-game-post-${post.source_seq}`}>
            <header>
              <strong>{post.author_slot ?? post.author_user ?? "System"}</strong>
              <a href={`#thread-post-${post.source_seq}`}>#{post.source_seq} · {occurredAt(post.occurred_at)}</a>
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
        <a class="fm-touch-button fm-touch-button--secondary" href={`?before_seq=${data.publicGame.nextBeforeSeq}`} data-testid="public-game-older">Older posts</a>
      {/if}
    </section>
    {#if form?.id === "public-game-report"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="public-game-report-result">{form.message}{form.reportId ? ` Receipt ${form.reportId}` : ""}</p>
    {/if}
    {#if form?.id === "public-game-watch"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="public-game-watch-result">{form.message}</p>
    {/if}
  {/if}
</main>

<style>
  .public-game-summary { display: flex; flex-wrap: wrap; gap: 12px 28px; }
  .public-game-post { border-block-start: 1px solid var(--fm-border); padding-block: 14px; scroll-margin-block-start: 88px; }
  .public-game-post header { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; }
  .public-game-post p { margin-block-end: 0; white-space: pre-wrap; }
  .report-control { margin-block-start: 10px; }
  .report-control form { display: grid; gap: 10px; margin-block-start: 10px; }
  .report-control textarea { min-block-size: 72px; resize: vertical; }
</style>
