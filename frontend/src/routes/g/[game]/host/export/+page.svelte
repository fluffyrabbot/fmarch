<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  export let data;
</script>

<svelte:head><title>Completed-game export | fmarch</title></svelte:head>
<main class="fm-surface" data-testid="completed-game-export-surface">
  <AppSurfaceHeader header={data.surfaceHeader} />
  <section class="fm-panel" data-testid="completed-game-export-manifest">
    <p class="fm-eyebrow">Manifest v{data.exportManifest.version}</p>
    <h2>Completed game archive</h2>
    <p data-testid="completed-game-export-event-count">{data.exportManifest.events.length} events</p>
    <code data-testid="completed-game-export-checksum">{data.exportManifest.checksum_sha256}</code>
  </section>
</main>
