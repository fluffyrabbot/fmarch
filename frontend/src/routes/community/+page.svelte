<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
</script>

<svelte:head><title>Community | fmarch</title></svelte:head>

<main class="fm-surface" data-testid="community-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  {#if data.community.status === "unavailable"}
    <p data-testid="community-unavailable">The community directory is unavailable. Refresh to try again.</p>
  {:else if data.community.areas.length === 0}
    <p data-testid="community-empty">No public discussion areas exist yet.</p>
  {:else}
    <section class="fm-grid" aria-label="Discussion areas" data-testid="community-area-index">
      {#each data.community.areas as area}
        <article class="fm-panel" data-testid={`community-area-${area.slug}`}>
          <p class="fm-eyebrow">Discussion area</p>
          <h2>{area.title}</h2>
          <p>{area.description}</p>
          <a class="fm-touch-button fm-touch-button--secondary" href={`/discussions/${encodeURIComponent(area.slug)}`}>
            Open area
          </a>
        </article>
      {/each}
    </section>
  {/if}
</main>
