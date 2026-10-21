<script>
  import { goto } from "$app/navigation";
  import RoleCard from "$lib/components/role-card/RoleCard.svelte";
  import RoleModal from "$lib/components/role-card/RoleModal.svelte";

  export let data;

  $: roles = data.roles;
  $: contract = roles.contract;
  let modalOpen = false;

  // Without script every row is a plain link that selects the role. With it,
  // narrow screens (where the detail card sits below the list) open the same
  // card in a modal instead of scrolling the reader away.
  async function selectRow(event, row) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    await goto(row.href, { noScroll: true, keepFocus: true, replaceState: true });
    if (window.matchMedia("(max-width: 959px)").matches) modalOpen = true;
  }
</script>

<svelte:head><title>Roles · {roles.pack.name} | fmarch</title></svelte:head>

<main class="fm-surface roles-surface" data-testid={contract.surfaceTestId}>
  <header class="roles-hero">
    <svg class="roles-hero__sky" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <g class="roles-hero__stars">
        <circle cx="90" cy="40" r="2" /><circle cx="210" cy="120" r="1.5" /><circle cx="330" cy="60" r="2.4" /><circle cx="470" cy="30" r="1.4" />
        <circle cx="560" cy="140" r="1.8" /><circle cx="690" cy="50" r="1.5" /><circle cx="760" cy="110" r="2.2" /><circle cx="1110" cy="150" r="1.6" />
        <circle cx="1160" cy="40" r="2" />
        <path d="M150 80l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /><path d="M640 90l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z" />
      </g>
      <path class="roles-hero__hills" d="M0 220V186l28-26 24 24 28-34 32 36 28-20 28 24 32-34 36 36 32-22 32 24h900v26zM900 220v-24l30-28 26 22 34-38 34 36 28-24 32 28 36-34 40 32 40-18v48z" />
    </svg>
    <div class="roles-hero__copy">
      <p class="fm-eyebrow">Role reference · {roles.pack.name} pack</p>
      <h1>Roles</h1>
      <p class="roles-hero__lede">Every role this pack can deal, what it does, and when it acts. Pick one to read its card.</p>
    </div>
    <ul class="roles-hero__counts" aria-label="Roles by alignment">
      {#each roles.counts as count}
        <li data-alignment={count.id}><strong>{count.count}</strong><span>{count.label}</span></li>
      {/each}
    </ul>
  </header>

  <div class="roles-filters">
    <form class="roles-search" method="GET" role="search" data-testid={contract.searchTestId}>
      <label class="fm-field">
        <span>Search roles</span>
        <input name="q" type="search" maxlength="80" value={roles.query.q} placeholder="Doctor, block, reads…" />
      </label>
      {#if roles.query.alignment !== "all"}<input type="hidden" name="alignment" value={roles.query.alignment} />{/if}
      {#if roles.query.acts !== "any"}<input type="hidden" name="acts" value={roles.query.acts} />{/if}
      {#if roles.query.view !== "table"}<input type="hidden" name="view" value={roles.query.view} />{/if}
      <button class="fm-touch-button fm-touch-button--secondary" type="submit">Search</button>
    </form>
    {#each [["Alignment", roles.alignmentOptions], ["Acts", roles.actsOptions], ["View", roles.viewOptions]] as [label, options]}
      <nav class="roles-segment" aria-label={label}>
        <span class="roles-segment__label" aria-hidden="true">{label}</span>
        <span class="roles-segment__options">
          {#each options as option}
            <a href={option.href} aria-current={option.current ? "true" : undefined} data-sveltekit-noscroll data-sveltekit-keepfocus>{option.label}</a>
          {/each}
        </span>
      </nav>
    {/each}
  </div>

  <p class="roles-result" aria-live="polite">{roles.resultLine}</p>

  <div class="roles-layout">
    <div class="roles-list">
      {#if roles.rows.length === 0}
        <div class="roles-empty" data-testid={contract.emptyTestId}>
          <p>No roles match these filters.</p>
          <a class="fm-touch-button fm-touch-button--secondary" href={roles.clearHref}>Clear filters</a>
        </div>
      {:else if roles.query.view === "cards"}
        <ul class="roles-grid" data-testid={contract.gridTestId}>
          {#each roles.rows as row (row.key)}
            <li>
              <a class="roles-grid__link" href={row.href} aria-current={row.selected ? "true" : undefined} data-testid={row.testId} on:click={(event) => selectRow(event, row)}>
                <RoleCard card={row.compactCard} headingLevel={2} />
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="roles-table-scroll">
          <table class="roles-table" data-testid={contract.tableTestId}>
            <caption class="fm-sr-only">Roles in the {roles.pack.name} pack</caption>
            <thead>
              <tr><th scope="col">Role</th><th scope="col">Alignment</th><th scope="col">Acts</th><th scope="col">Abilities</th><th scope="col">Traits</th></tr>
            </thead>
            <tbody>
              {#each roles.rows as row (row.key)}
                <tr data-alignment={row.alignment.id} data-selected={row.selected ? "true" : "false"} data-testid={row.testId}>
                  <th scope="row">
                    <a class="roles-table__role" href={row.href} aria-current={row.selected ? "true" : undefined} on:click={(event) => selectRow(event, row)}>
                      <span class="roles-crest" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" focusable="false"><path d={row.alignment.icon} /></svg></span>
                      <span class="roles-table__name"><span>{row.name}</span><code>{row.key}</code></span>
                    </a>
                  </th>
                  <td><span class="roles-alignment">{row.alignment.label}</span></td>
                  <td>
                    <span class="roles-windows">
                      {#each row.windows as window}
                        <span class="role-window" data-window={window.id}><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true" focusable="false"><path d={window.icon} /></svg>{window.label}</span>
                      {/each}
                    </span>
                  </td>
                  <td>{row.abilitiesText}</td>
                  <td class:roles-table__trait={row.traitsText !== null}>{row.traitsText ?? "—"}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    {#if roles.selected}
      <aside class="roles-detail" aria-label="Selected role" data-testid={contract.detailTestId}>
        <p class="fm-eyebrow">Selected role</p>
        <RoleCard card={roles.selected.card} />
        <button class="fm-touch-button" type="button" on:click={() => (modalOpen = true)}>Open as modal</button>
      </aside>
    {/if}
  </div>

  <RoleModal
    card={roles.selected?.card ?? null}
    open={modalOpen}
    eyebrow="Role reference"
    testId={contract.modalTestId}
    onClose={() => (modalOpen = false)}
  />
</main>

<style>
  .roles-surface { align-content: start; grid-template-columns: minmax(0, 1fr); }

  .roles-hero { align-items: center; border-block-end: 2px solid var(--fm-line); display: flex; flex-wrap: wrap; gap: 20px 32px; isolation: isolate; margin: -22px -22px 0; overflow: hidden; padding: 36px 22px 48px; position: relative; }
  .roles-hero__sky { block-size: 100%; inline-size: 100%; inset: 0; position: absolute; z-index: -1; }
  .roles-hero__stars { fill: var(--fm-accent-soft); }
  .roles-hero__hills { fill: var(--fm-surface-muted); }
  .roles-hero__copy { display: grid; flex: 999 1 420px; gap: 8px; min-inline-size: 0; }
  .roles-hero__copy .fm-eyebrow { margin: 0; }
  .roles-hero h1 { font-size: clamp(36px, 6vw, 56px); margin: 0; }
  .roles-hero__lede { color: var(--fm-ink-muted); font-size: 18px; margin: 0; max-inline-size: 36rem; }
  .roles-hero__counts { display: grid; flex: 1 1 300px; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
  .roles-hero__counts li { background: var(--fm-raised); border: 2px solid var(--fm-line); border-radius: var(--fm-radius-panel); display: grid; padding: 12px 10px; text-align: center; }
  .roles-hero__counts strong { color: var(--fm-align-town); font-family: var(--fm-font-display); font-size: 30px; line-height: 1.1; }
  .roles-hero__counts [data-alignment="mafia"] strong { color: var(--fm-align-mafia); }
  .roles-hero__counts [data-alignment="independent"] strong { color: var(--fm-align-independent); }
  .roles-hero__counts span { color: var(--fm-ink-muted); font-size: 13px; font-weight: 700; }

  .roles-filters { align-items: flex-end; display: flex; flex-wrap: wrap; gap: 14px 20px; padding-block: 24px 4px; }
  .roles-search { align-items: flex-end; display: flex; flex: 1 1 300px; gap: 8px; margin: 0; min-inline-size: 0; }
  .roles-search .fm-field { flex: 1; min-inline-size: 0; }
  .roles-segment { display: grid; gap: 6px; }
  .roles-segment__label { color: var(--fm-ink-muted); font-size: 13px; font-weight: 800; }
  .roles-segment__options { background: var(--fm-raised); border: 2px solid var(--fm-line); border-radius: 999px; display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px; }
  .roles-segment a { align-items: center; border-radius: 999px; color: var(--fm-ink-muted); display: inline-flex; font-size: 14px; font-weight: 800; min-block-size: 38px; padding: 0 14px; text-decoration: none; }
  .roles-segment a:hover { background: var(--fm-surface-muted); color: var(--fm-ink); }
  .roles-segment a[aria-current="true"] { background: var(--fm-accent); color: var(--fm-action-ink); }

  .roles-result { color: var(--fm-ink-muted); font-size: 14px; font-weight: 700; margin: 0; }

  .roles-layout { align-items: flex-start; display: flex; flex-wrap: wrap; gap: 28px; }
  .roles-list { flex: 999 1 560px; min-inline-size: 0; }
  .roles-detail { display: grid; flex: 1 1 360px; gap: 14px; max-inline-size: 480px; min-inline-size: 0; }
  .roles-detail .fm-eyebrow { margin: 0; }
  .roles-detail .fm-touch-button { justify-self: start; }

  .roles-table-scroll { background: var(--fm-raised); border: 2px solid var(--fm-line); border-radius: var(--fm-radius-panel); overflow-x: auto; }
  .roles-table { border-collapse: collapse; font-size: 14px; inline-size: 100%; min-inline-size: 760px; }
  .roles-table thead th { border-block-end: 2px solid var(--fm-line); color: var(--fm-ink-muted); font-size: 12px; font-weight: 800; letter-spacing: 0.08em; padding: 14px 16px; text-align: start; text-transform: uppercase; }
  .roles-table tbody tr { border-block-end: 1.5px solid var(--fm-line-soft); }
  .roles-table tbody tr:last-child { border-block-end: 0; }
  .roles-table tbody tr[data-selected="true"] { background: var(--fm-accent-wash); box-shadow: inset 4px 0 0 var(--fm-accent); }
  .roles-table td,
  .roles-table tbody th { font-weight: 700; padding: 8px 16px; text-align: start; vertical-align: middle; }
  .roles-table__trait { color: var(--fm-accent-ink); }
  .roles-table__role { align-items: center; color: inherit; display: flex; gap: 12px; min-block-size: 48px; text-decoration: none; }
  .roles-table__role:hover .roles-table__name > span { text-decoration: underline; }
  .roles-table__name { display: grid; min-inline-size: 0; }
  .roles-table__name > span { font-size: 16px; font-weight: 800; }
  .roles-table__name code { color: var(--fm-ink-muted); font-family: var(--fm-font-mono); font-size: 11px; font-weight: 400; }

  .roles-table tr,
  .roles-hero__counts li { --role-ink: var(--fm-align-town); --role-wash: var(--fm-align-town-wash); }
  .roles-table tr[data-alignment="mafia"] { --role-ink: var(--fm-align-mafia); --role-wash: var(--fm-align-mafia-wash); }
  .roles-table tr[data-alignment="independent"] { --role-ink: var(--fm-align-independent); --role-wash: var(--fm-align-independent-wash); }
  .roles-crest { align-items: center; background: var(--role-wash); block-size: 36px; border-radius: 12px; color: var(--role-ink); display: inline-flex; flex: 0 0 36px; justify-content: center; }
  .roles-alignment { background: var(--role-wash); border-radius: 999px; color: var(--role-ink); display: inline-flex; font-size: 13px; font-weight: 800; padding: 3px 10px; }
  .roles-windows { display: flex; flex-wrap: wrap; gap: 4px; }
  svg { fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2.2; }
  .roles-hero__sky { fill: initial; stroke: none; }

  .roles-grid { display: grid; gap: 24px 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); list-style: none; margin: 0; padding: 0; }
  .roles-grid__link { border: 3px solid transparent; border-radius: calc(var(--fm-radius-panel) + 6px); color: inherit; display: block; padding: 3px; text-decoration: none; }
  .roles-grid__link:hover { border-color: var(--fm-line-strong); }
  .roles-grid__link[aria-current="true"] { border-color: var(--fm-accent); }

  .roles-empty { align-items: center; border: 2px dashed var(--fm-line-strong); border-radius: var(--fm-radius-panel); display: grid; gap: 12px; justify-items: center; padding: 40px 20px; }
  .roles-empty p { color: var(--fm-ink-muted); font-size: 16px; font-weight: 700; margin: 0; }

  @media (forced-colors: active) {
    .roles-hero__sky { display: none; }
    .roles-table tbody tr[data-selected="true"] { outline: 2px solid Highlight; }
  }
</style>
