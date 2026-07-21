<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;

  const KIND_LABELS = {
    discussion_topic: "Discussion topic",
    discussion_post: "Discussion post",
    profile: "Profile",
    game: "Game",
    game_post: "Game post",
  };

  function kindLabel(kind) {
    return KIND_LABELS[kind] ?? "Public result";
  }

  function occurredAt(value) {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
      ? new Date(seconds * 1000).toLocaleString()
      : "Time unavailable";
  }
</script>

<svelte:head><title>Public search | fmarch</title></svelte:head>

<main class="fm-surface search-surface" data-testid="search-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />

  <form method="GET" class="fm-panel search-form" role="search" data-testid="public-search-form">
    <label class="fm-field search-form__query">
      <span>Search public community content</span>
      <input name="q" type="search" minlength="2" maxlength="200" required value={data.search.query} data-testid="public-search-query" />
    </label>
    <label class="fm-field">
      <span>Result type</span>
      <select name="filter" value={data.search.filter} data-testid="public-search-filter">
        <option value="all">Everything public</option>
        <option value="discussions">Discussions</option>
        <option value="profiles">Profiles</option>
        <option value="games">Games and public posts</option>
      </select>
    </label>
    <button class="fm-touch-button" type="submit" data-testid="public-search-submit">Search</button>
  </form>

  {#if data.search.status === "idle"}
    <p class="fm-panel" data-testid="public-search-idle">Enter at least two characters to search public content.</p>
  {:else if data.search.status === "invalid"}
    <p class="fm-panel" role="alert" data-testid="public-search-invalid">Search queries need at least two characters.</p>
  {:else if data.search.status === "unavailable"}
    <p class="fm-panel" role="alert" data-testid="public-search-unavailable">Public search is unavailable. Refresh to try again.</p>
  {:else if data.search.results.length === 0}
    <p class="fm-panel" data-testid="public-search-empty">No public results matched “{data.search.query}”.</p>
  {:else}
    <section class="search-results" aria-label="Public search results" data-testid="public-search-results">
      {#each data.search.results as result, index}
        <article class="fm-panel search-result" data-testid={`public-search-result-${index}`}>
          <header>
            <p class="fm-eyebrow">{kindLabel(result.kind)}</p>
            <time>{occurredAt(result.published_at)}</time>
          </header>
          <h2><a href={result.href} data-testid={`public-search-result-link-${index}`}>{result.title}</a></h2>
          <p>{result.excerpt}</p>
        </article>
      {/each}
    </section>
    {#if data.search.nextHref !== null}
      <nav aria-label="Search pagination">
        <a class="fm-touch-button fm-touch-button--secondary" href={data.search.nextHref} data-testid="public-search-older">More results</a>
      </nav>
    {/if}
  {/if}
</main>

<style>
  .search-surface, .search-results, .search-form { display: grid; gap: 14px; }
  .search-form { align-items: end; grid-template-columns: minmax(0, 1fr) minmax(180px, 0.35fr) auto; }
  .search-result { scroll-margin-block-start: 88px; }
  .search-result header { align-items: baseline; display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; }
  .search-result h2 { margin-block: 6px; }
  .search-result time { color: var(--fm-ink-muted); font-size: 13px; }
  @media (max-width: 720px) { .search-form { grid-template-columns: 1fr; } }
</style>
