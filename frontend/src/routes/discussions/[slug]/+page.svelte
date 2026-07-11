<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";

  export let data;
  export let form;

  $: discussion = data.discussion;
  $: rejection = form?.state === "reject" ? form.message : null;
  $: selected = discussion.thread?.topic ?? null;
</script>

<svelte:head>
  <title>{discussion.area.title} | fmarch</title>
</svelte:head>

<main class="fm-surface" data-testid="discussion-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />

  {#if discussion.status === "unavailable"}
    <p data-testid="discussion-unavailable">This discussion area is unavailable. Refresh to try again.</p>
  {:else}
    <section class="fm-grid" aria-label="Discussion topics" data-testid="discussion-topic-index">
      {#if discussion.topics.length === 0}
        <p data-testid="discussion-topic-empty">No discussion topics yet.</p>
      {:else}
        {#each discussion.topics as topic}
          <article class="fm-panel" data-testid={`discussion-topic-${topic.topic}`}>
            <p class="fm-eyebrow">{topic.status}</p>
            <h2>{topic.title}</h2>
            <p>{topic.post_count} posts</p>
            <a class="fm-touch-button fm-touch-button--secondary" href={`?topic=${topic.topic}`} data-testid={`discussion-topic-open-${topic.topic}`}>
              Open topic
            </a>
          </article>
        {/each}
      {/if}
    </section>

    {#if discussion.nextCursor}
      <a class="fm-touch-button fm-touch-button--secondary" href={`?cursor=${discussion.nextCursor}`} data-testid="discussion-topic-older">Older topics</a>
    {/if}

    {#if discussion.canPost}
      <section class="fm-panel" aria-label="Create discussion topic">
        <h2>Start a topic</h2>
        <form method="POST" action="?/createTopic" class="discussion-form" data-testid="discussion-create-topic-form">
          <label class="fm-field"><span>Title</span><input name="title" required maxlength="180" data-testid="discussion-topic-title" /></label>
          <label class="fm-field"><span>Opening post</span><textarea name="body" required maxlength="10000" data-testid="discussion-topic-body"></textarea></label>
          <button type="submit" class="fm-touch-button" data-testid="discussion-create-topic-submit">Create topic</button>
        </form>
      </section>
    {:else}
      <p data-testid="discussion-post-sign-in">Sign in to start a topic or reply.</p>
    {/if}

    {#if selected}
      <section class="fm-panel" aria-label="Discussion thread" data-testid="discussion-thread">
        <p class="fm-eyebrow">{selected.status}</p>
        <h2>{selected.title}</h2>
        {#each discussion.thread.posts as post}
          <article class="discussion-post" data-testid={`discussion-post-${post.source_seq}`}>
            <p>{post.body}</p>
          </article>
        {/each}
        {#if discussion.canPost && selected.status === "open"}
          <form method="POST" action="?/createPost" class="discussion-form" data-testid="discussion-create-post-form">
            <input type="hidden" name="topic" value={selected.topic} />
            <label class="fm-field"><span>Reply</span><textarea name="body" required maxlength="10000" data-testid="discussion-post-body"></textarea></label>
            <button type="submit" class="fm-touch-button" data-testid="discussion-create-post-submit">Post reply</button>
          </form>
        {:else if selected.status === "locked"}
          <p data-testid="discussion-topic-locked">This topic is locked. Refresh the area before trying another action.</p>
        {/if}

        {#if discussion.canModerate}
          <form method="POST" action="?/moderate" class="discussion-form" data-testid="discussion-moderation-form">
            <input type="hidden" name="topic" value={selected.topic} />
            <label class="fm-field"><span>Moderation</span><select name="status" value={selected.status} data-testid="discussion-moderation-status"><option value="open">Open</option><option value="locked">Lock</option><option value="hidden">Hide</option></select></label>
            <button type="submit" class="fm-touch-button fm-touch-button--secondary" data-testid="discussion-moderation-submit">Update topic</button>
          </form>
        {:else}
          <p data-testid="discussion-moderation-denied">Moderation requires GlobalMod.</p>
        {/if}
      </section>
    {/if}

    {#if rejection}
      <p role="alert" data-testid="discussion-mutation-reject">{rejection}</p>
    {/if}
  {/if}
</main>

<style>
  .discussion-form { display: grid; gap: 12px; }
  .discussion-post { border-block-start: 1px solid var(--fm-border); padding-block: 12px; }
  .discussion-post p { margin: 0; white-space: pre-wrap; }
  textarea { min-block-size: 112px; resize: vertical; }
</style>
