<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
  export let form;

  $: discussion = data.discussion;
  $: thread = discussion.thread;
  $: rejection = form?.id === "discussion-mutation" && form?.state === "reject" ? form.message : null;

  function occurredAt(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toLocaleString()
      : "Time unavailable";
  }
</script>

<svelte:head><title>{thread?.topic?.title ?? "Discussion topic"} | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="discussion-thread-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  {#if discussion.status === "unavailable"}
    <p data-testid="discussion-thread-unavailable">This topic is unavailable or no longer public.</p>
    <a class="fm-touch-button fm-touch-button--secondary" href={`/discussions/${encodeURIComponent(discussion.area.slug)}`}>Back to area</a>
  {:else}
    <nav aria-label="Discussion breadcrumbs">
      <a href="/community">Community</a> /
      <a href={`/discussions/${encodeURIComponent(thread.area.slug)}`}>{thread.area.title}</a>
    </nav>

    <section class="fm-panel" aria-label="Discussion thread" data-testid="discussion-thread">
      <p class="fm-eyebrow">{thread.topic.posting_state}</p>
      <h2>{thread.topic.title}</h2>
      {#if discussion.subscription !== null}
        <div class="discussion-watch" data-testid="discussion-watch-control">
          <form method="POST" action="?/watch">
            <input type="hidden" name="watch_action" value={discussion.subscription.subscribed ? "unsubscribe" : "subscribe"} />
            <button class="fm-touch-button fm-touch-button--secondary" type="submit" data-testid="discussion-watch-submit">
              {discussion.subscription.subscribed ? "Stop watching" : "Watch this topic"}
            </button>
          </form>
          <a href="/inbox" class="fm-touch-button fm-touch-button--secondary" data-testid="discussion-inbox-link">
            Inbox{discussion.subscription.unread_count > 0 ? ` (${discussion.subscription.unread_count})` : ""}
          </a>
        </div>
      {/if}
      {#each thread.posts as post}
        <article id={`post-${post.source_seq}`} class="discussion-post" data-testid={`discussion-post-${post.source_seq}`}>
          <header>
            {#if post.author}
              <a href={`/u/${encodeURIComponent(post.author.handle)}`}><strong>{post.author.display_name}</strong></a>
            {:else}
              <strong>Archived member</strong>
            {/if}
            <a class="discussion-post__permalink" href={`#post-${post.source_seq}`} aria-label={`Permalink to post ${post.source_seq}`}>
              #{post.source_seq} · {occurredAt(post.created_at)}
            </a>
          </header>
          <p>{post.body}</p>
          {#if discussion.hasSession}
            <details class="discussion-report" data-testid={`discussion-report-${post.source_seq}`}>
              <summary>Report this post</summary>
              <form method="POST" action="?/report" class="discussion-form">
                <input type="hidden" name="source_seq" value={post.source_seq} />
                <label class="fm-field"><span>Reason</span><select name="reason_family" required><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="hate">Hate</option><option value="sexual_content">Sexual content</option><option value="self_harm">Self-harm</option><option value="other">Other</option></select></label>
                <label class="fm-field"><span>Context (optional)</span><textarea name="details" maxlength="1000"></textarea></label>
                <button class="fm-touch-button fm-touch-button--secondary" type="submit">Submit report</button>
              </form>
            </details>
          {/if}
        </article>
      {/each}

      <nav class="discussion-pagination" aria-label="Discussion post pagination">
        {#if thread.next_before_seq !== null}
          <a class="fm-touch-button fm-touch-button--secondary" href={`?before_seq=${thread.next_before_seq}`} data-testid="discussion-posts-older">Older posts</a>
        {/if}
        <a class="fm-touch-button fm-touch-button--secondary" href={`/discussions/${encodeURIComponent(thread.area.slug)}/t/${encodeURIComponent(thread.topic.topic)}`}>Newest posts</a>
      </nav>

      {#if discussion.canPost && thread.topic.posting_state === "open"}
        <form method="POST" action="?/createPost" class="discussion-form" data-testid="discussion-create-post-form">
          <label class="fm-field"><span>Reply</span><textarea name="body" required maxlength="10000" data-testid="discussion-post-body"></textarea></label>
          <button type="submit" class="fm-touch-button" data-testid="discussion-create-post-submit">Post reply</button>
        </form>
      {:else if thread.topic.posting_state === "locked"}
        <p data-testid="discussion-topic-locked">This topic is locked.</p>
      {:else if discussion.hasSession}
        <p data-testid="discussion-profile-required">Create or make public your <a href="/profile/edit">community profile</a> before replying publicly.</p>
      {:else}
        <p data-testid="discussion-post-sign-in">Sign in to reply.</p>
      {/if}

      {#if discussion.canModerate}
        <div class="discussion-moderation" data-testid="discussion-moderation-controls">
          <form method="POST" action="?/postingState" class="discussion-form">
            <label class="fm-field"><span>Posting</span><select name="posting_state" value={thread.topic.posting_state} data-testid="discussion-posting-state"><option value="open">Open</option><option value="locked">Locked</option></select></label>
            <button type="submit" class="fm-touch-button fm-touch-button--secondary" data-testid="discussion-posting-state-submit">Update posting</button>
          </form>
          <form method="POST" action="?/visibility" class="discussion-form">
            <label class="fm-field"><span>Visibility</span><select name="visibility" value={thread.topic.visibility} data-testid="discussion-visibility"><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label>
            <button type="submit" class="fm-touch-button fm-touch-button--secondary">Update visibility</button>
          </form>
        </div>
      {:else}
        <p data-testid="discussion-moderation-denied">Moderation requires GlobalMod.</p>
      {/if}
    </section>

    {#if rejection}<p role="alert" data-testid="discussion-mutation-reject">{rejection}</p>{/if}
    {#if form?.id === "discussion-report"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="discussion-report-result">{form.message}{form.reportId ? ` Receipt ${form.reportId}` : ""}</p>
    {/if}
    {#if form?.id === "discussion-watch"}
      <p role={form.state === "reject" ? "alert" : "status"} class="fm-panel" data-testid="discussion-watch-result">{form.message}</p>
    {/if}
  {/if}
</main>

<style>
  .discussion-form, .discussion-moderation { display: grid; gap: 12px; }
  .discussion-watch { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 12px; }
  .discussion-post { border-block-start: 1px solid var(--fm-border); padding-block: 14px; scroll-margin-block-start: 88px; }
  .discussion-post header { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; }
  .discussion-post p { margin-block-end: 0; white-space: pre-wrap; }
  .discussion-post__permalink { color: var(--fm-ink-muted); font-size: 13px; }
  .discussion-report { margin-block-start: 10px; }
  .discussion-pagination { display: flex; flex-wrap: wrap; gap: 8px; margin-block: 16px; }
  textarea { min-block-size: 112px; resize: vertical; }
</style>
