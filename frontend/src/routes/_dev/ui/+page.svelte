<script>
  import "$lib/styles/app.css";

  export let data;
</script>

<svelte:head>
  <title>fmarch UI workbench</title>
  <meta
    name="description"
    content="Deterministic local role surfaces for fmarch UI and UX iteration."
  />
</svelte:head>

<main class="ui-workbench" data-testid="ui-workbench">
  <header class="ui-workbench__hero">
    <div>
      <p class="fm-eyebrow">Local fixture environment</p>
      <h1>UI workbench</h1>
      <p class="fm-summary">
        Review real application routes with deterministic data. Pick a surface,
        resize to a canonical viewport, edit, and let Vite refresh the page.
      </p>
    </div>
    <div class="ui-workbench__command" aria-label="Workbench command">
      <span>Start from the repository root</span>
      <code>npm run ui:dev</code>
    </div>
  </header>

  <section class="fm-section fm-section--accent" aria-labelledby="viewport-heading">
    <div>
      <p class="fm-eyebrow">Responsive baseline</p>
      <h2 id="viewport-heading">Canonical viewports</h2>
    </div>
    <div class="ui-workbench__viewports">
      {#each data.viewports as viewport}
        <div class="fm-well fm-well--kv">
          <strong>{viewport.label}</strong>
          <span>{viewport.size}</span>
        </div>
      {/each}
    </div>
  </section>

  {#each data.scenarioGroups as group}
    <section class="fm-section" aria-labelledby={`group-${group.id}`}>
      <div class="ui-workbench__section-heading">
        <div>
          <p class="fm-eyebrow">Fixture scenarios</p>
          <h2 id={`group-${group.id}`}>{group.label}</h2>
        </div>
        <p>{group.summary}</p>
      </div>

      <div class="ui-workbench__grid">
        {#each group.scenarios as scenario}
          <article class="fm-card ui-workbench__scenario" data-scenario={scenario.id}>
            <div>
              <h3>{scenario.label}</h3>
              <p>{scenario.description}</p>
            </div>
            <a class="fm-touch-button" href={scenario.href} data-sveltekit-reload>
              Open surface
            </a>
            {#if scenario.states.length > 0}
              <div class="ui-workbench__states" aria-label={`${scenario.label} route states`}>
                <span>Route state</span>
                {#each scenario.states as state}
                  <a
                    class="ui-workbench__state-link"
                    href={state.href}
                    data-sveltekit-reload
                  >{state.label}</a>
                {/each}
              </div>
            {/if}
          </article>
        {/each}
      </div>
    </section>
  {/each}

  <aside class="fm-card ui-workbench__proof">
    <div>
      <p class="fm-eyebrow">Before you push</p>
      <h2>Use the existing proof lanes</h2>
    </div>
    <p>
      Run <code>npm run test:ui-workbench</code> for this launcher, then
      <code>npm run test:frontend-role-proof:quick</code> for touched role surfaces.
      Use the full browser lane when behavior or responsive layout changes materially.
    </p>
  </aside>
</main>

<style>
  .ui-workbench {
    display: grid;
    gap: 36px;
    margin-inline: auto;
    max-inline-size: 1280px;
    padding: clamp(22px, 4vw, 56px);
  }

  .ui-workbench__hero {
    align-items: end;
    border-block-end: 1px solid var(--fm-line);
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) minmax(240px, 0.45fr);
    padding-block-end: 28px;
  }

  .ui-workbench h1,
  .ui-workbench h2,
  .ui-workbench h3,
  .ui-workbench p {
    margin-block-start: 0;
  }

  .ui-workbench h1 {
    font-family: var(--fm-font-display);
    font-size: clamp(38px, 6vw, 68px);
    line-height: 0.95;
    margin-block-end: 16px;
  }

  .ui-workbench__command {
    background: var(--fm-ink);
    border-radius: 8px;
    color: var(--fm-on-dark);
    display: grid;
    gap: 8px;
    padding: 16px;
  }

  .ui-workbench__command span {
    color: var(--fm-on-dark-soft);
    font-size: 12px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .ui-workbench code {
    font-family: var(--fm-font-mono);
  }

  .ui-workbench__command code {
    font-size: 15px;
    overflow-wrap: anywhere;
  }

  .ui-workbench__viewports,
  .ui-workbench__grid {
    display: grid;
    gap: 14px;
  }

  .ui-workbench__viewports {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ui-workbench__grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .ui-workbench__section-heading {
    align-items: end;
    display: flex;
    gap: 24px;
    justify-content: space-between;
  }

  .ui-workbench__section-heading > p {
    color: var(--fm-ink-muted);
    line-height: 1.4;
    max-inline-size: 40rem;
  }

  .ui-workbench__scenario {
    grid-template-rows: 1fr auto auto;
  }

  .ui-workbench__scenario p,
  .ui-workbench__proof > p {
    color: var(--fm-ink-muted);
    line-height: 1.45;
    margin-block: 8px 0;
  }

  .ui-workbench__scenario > .fm-touch-button {
    justify-self: stretch;
    justify-content: center;
  }

  .ui-workbench__states {
    align-items: center;
    border-block-start: 1px solid var(--fm-line-soft);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding-block-start: 12px;
  }

  .ui-workbench__states > span {
    color: var(--fm-ink-muted);
    font-size: 12px;
    font-weight: 800;
    margin-inline-end: 2px;
    text-transform: uppercase;
  }

  .ui-workbench__state-link {
    color: var(--fm-accent-ink);
    font-size: 13px;
    font-weight: 800;
    min-block-size: 36px;
    padding: 9px 4px;
  }

  .ui-workbench__proof {
    align-items: start;
    grid-template-columns: minmax(220px, 0.4fr) minmax(0, 1fr);
  }

  .ui-workbench__proof code {
    background: var(--fm-surface-muted);
    border-radius: 4px;
    color: var(--fm-ink);
    padding: 2px 5px;
  }

  @media (max-width: 900px) {
    .ui-workbench__hero,
    .ui-workbench__proof {
      grid-template-columns: 1fr;
    }

    .ui-workbench__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .ui-workbench {
      gap: 28px;
    }

    .ui-workbench__grid,
    .ui-workbench__viewports {
      grid-template-columns: 1fr;
    }

    .ui-workbench__section-heading {
      align-items: start;
      display: grid;
      gap: 8px;
    }
  }
</style>
