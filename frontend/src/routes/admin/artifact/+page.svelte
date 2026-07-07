<script>
  export let data;
</script>

<svelte:head>
  <title>Admin Artifact | fmarch</title>
</svelte:head>

<main class="fm-surface admin-artifact">
  <section class="admin-artifact__panel" data-testid="admin-artifact-surface">
    <p class="fm-eyebrow">Machine evidence</p>
    <h1>{data.artifact.path}</h1>
    <pre data-testid="admin-artifact-contents">{data.artifact.contents}</pre>
  </section>
</main>

<style>
  .admin-artifact {
    align-content: start;
    margin-inline: auto;
    max-inline-size: 960px;
    width: 100%;
  }

  .admin-artifact__panel {
    display: grid;
    gap: 16px;
  }

  .admin-artifact h1 {
    font-size: 1.35rem;
    overflow-wrap: anywhere;
  }

  .admin-artifact pre {
    background: var(--fm-surface-cool);
    border: 1px solid var(--fm-line-cool);
    border-radius: 8px;
    color: var(--fm-ink);
    margin: 0;
    overflow: auto;
    padding: 16px;
    white-space: pre-wrap;
  }
</style>
