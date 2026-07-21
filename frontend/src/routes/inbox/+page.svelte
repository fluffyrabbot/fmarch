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

  function targetLabel(kind) {
    return kind === "discussion_topic" ? "Discussion" : "Public game";
  }
</script>

<svelte:head><title>Update inbox | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="community-inbox-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  <section class="fm-panel inbox-summary" data-testid="community-inbox-summary">
    <strong>{data.inbox.unreadCount} unread</strong>
    <span>Only public posts from watches active when the post was published appear here.</span>
  </section>

  {#if data.inbox.items.length === 0}
    <p class="fm-panel" data-testid="community-inbox-empty">No watched updates yet. Watch a public discussion or game thread to begin.</p>
  {:else}
    <ol class="inbox-list" data-testid="community-inbox-list">
      {#each data.inbox.items as item}
        <li class:unread={item.unread} class="fm-panel inbox-item" data-testid={`community-inbox-item-${item.source_seq}`}>
          <div>
            <p class="fm-eyebrow">{targetLabel(item.target_kind)}{item.unread ? " · Unread" : ""}</p>
            <h2><a href={item.href}>{item.title}</a></h2>
            <p>Update #{item.source_seq} · {occurredAt(item.occurred_at)}</p>
          </div>
          <div class="inbox-actions">
            {#if item.unread}
              <form method="POST" action="?/markRead">
                <input type="hidden" name="target_kind" value={item.target_kind} />
                <input type="hidden" name="scope_id" value={item.scope_id} />
                <input type="hidden" name="source_seq" value={item.source_seq} />
                <button type="submit" class="fm-touch-button" data-testid={`community-inbox-read-${item.source_seq}`}>Mark read</button>
              </form>
            {/if}
            {#if item.subscribed}
              <form method="POST" action="?/unwatch">
                <input type="hidden" name="target_kind" value={item.target_kind} />
                <input type="hidden" name="scope_id" value={item.scope_id} />
                <button type="submit" class="fm-touch-button fm-touch-button--secondary" data-testid={`community-inbox-unwatch-${item.source_seq}`}>Stop watching</button>
              </form>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  {/if}

  {#if data.inbox.nextCursor !== null}
    <a class="fm-touch-button fm-touch-button--secondary" href={`?before_seq=${data.inbox.nextCursor}`} data-testid="community-inbox-older">Older updates</a>
  {/if}
  {#if form?.state === "reject"}
    <p role="alert" class="fm-panel" data-testid="community-inbox-reject">{form.message}</p>
  {/if}
</main>

<style>
  .inbox-summary { display: flex; flex-wrap: wrap; gap: 8px 24px; }
  .inbox-list { display: grid; gap: 12px; list-style: none; padding: 0; }
  .inbox-item { align-items: center; display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; }
  .inbox-item.unread { border-inline-start: 5px solid var(--fm-accent); }
  .inbox-item h2 { margin-block: 4px; }
  .inbox-actions { display: flex; flex-wrap: wrap; gap: 8px; }
</style>
