<script>
  export let data;
</script>

<svelte:head>
  <title>Admin Artifact | fmarch</title>
</svelte:head>

<main class="admin-artifact">
  <section class="admin-artifact__panel" data-testid="admin-artifact-surface">
    <p class="admin-artifact__eyebrow">Machine evidence</p>
    <h1>{data.artifact.path}</h1>
    <pre data-testid="admin-artifact-contents">{data.artifact.contents}</pre>
  </section>
</main>

<style>
  .admin-artifact {
    margin: 0 auto;
    max-width: 960px;
    padding: 24px;
  }

  .admin-artifact__panel {
    display: grid;
    gap: 16px;
  }

  .admin-artifact__eyebrow {
    color: var(--fm-ink-subtle);
    font-size: 0.85rem;
    font-weight: 700;
    margin: 0;
    text-transform: uppercase;
  }

  .admin-artifact h1 {
    font-size: 1.35rem;
    letter-spacing: 0;
    margin: 0;
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
