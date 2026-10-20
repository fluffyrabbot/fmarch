<script>
  export let shell;
  export let includeNavigation = false;
</script>
<details class="account-menu">
  <summary data-testid="account-menu-toggle" class="fm-touch-button fm-touch-button--secondary" aria-label={includeNavigation ? 'Navigation and account' : 'Account menu'}>{includeNavigation ? 'Menu' : shell.session.initials}</summary>
  <nav aria-label="Account navigation">
    <span data-testid={shell.session.viewerTestId}>{shell.session.viewerLabel}</span>
    {#each shell.surfaces.filter(surface => surface.allowed && (includeNavigation || surface.group === 'workspace') && surface.id !== 'player') as surface}
      <a href={surface.href} data-testid={surface.testId} data-capability-kind={surface.capability?.kind} aria-current={surface.active ? 'page' : undefined}>{surface.label}</a>
    {/each}
    <a href={shell.session.href} data-testid={shell.session.testId}>{shell.session.actionLabel}</a>
  </nav>
</details>
<style>
  .account-menu { position: relative; }
  summary { list-style: none; cursor: pointer; }
  summary::-webkit-details-marker { display: none; }
  nav { position: absolute; inset-inline-end: 0; top: calc(100% + 6px); min-width: 220px; display: grid; background: var(--fm-surface); border: 1px solid var(--fm-line); border-radius: 8px; padding: 8px; box-shadow: 0 8px 24px #0002; z-index: 40; }
  a { display: flex; align-items: center; min-height: 44px; padding: 8px 12px; color: var(--fm-ink); text-decoration: none; }
  a:hover, a:focus-visible { background: var(--fm-surface-muted); }
</style>
