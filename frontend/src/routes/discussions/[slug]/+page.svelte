<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";

  export let data;
  export let form;

  $: discussion = data.discussion;
  $: rejection = form?.state === "reject" ? form.message : null;
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
            <p class="fm-eyebrow">{topic.posting_state}</p>
            <h2>{topic.title}</h2>
            <p>
              {topic.post_count} posts
              {#if topic.author} · started by <a href={`/u/${encodeURIComponent(topic.author.handle)}`}>{topic.author.display_name}</a>{/if}
            </p>
            <a class="fm-touch-button fm-touch-button--secondary" href={`/discussions/${encodeURIComponent(discussion.area.slug)}/t/${encodeURIComponent(topic.topic)}`} data-testid={`discussion-topic-open-${topic.topic}`}>
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
    {:else if discussion.hasSession}
      <p data-testid="discussion-profile-required">Create or make public your <a href="/profile/edit">community profile</a> before starting a public topic.</p>
    {:else}
      <p data-testid="discussion-post-sign-in">Sign in to start a topic or reply.</p>
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
