<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import { buildRouteStateViewModel } from "$lib/app/app-route-state-model.mjs";
  import {
    BOARD_ROUTE_CONTRACT,
    gameActionTestId,
    workbenchActionTestId,
  } from "$lib/app/app-shell-model.mjs";

  export let data;

  $: boardForcedRouteState = data.routeState
    ? buildRouteStateViewModel(data.routeState)
    : null;
</script>

<svelte:head>
  <title>fmarch board</title>
</svelte:head>

{#snippet boardSurface()}
  <main class="fm-surface" data-testid={BOARD_ROUTE_CONTRACT.surfaceTestId}>
    <AppSurfaceHeader header={data.surfaceHeader} />

    {#if boardForcedRouteState}
      <RouteState view={boardForcedRouteState} />
    {:else}
      <section class="fm-grid fm-grid--three" aria-label="Workbench">
        {#each data.workbench as item}
          <article class="fm-panel" data-testid={`workbench-${item.id}`}>
            <h2>{item.label}</h2>
            <p>{item.value}</p>
            {#if item.action.navigation === "link"}
              <a
                class={item.action.className}
                href={item.action.href}
                data-testid={workbenchActionTestId(item.id)}
              >
                {item.action.label}
              </a>
            {:else}
              <button
                type="button"
                class={item.action.className}
                data-testid={workbenchActionTestId(item.id)}
                data-blocked-reason={item.action.blockedReason}
                aria-disabled={item.action.ariaDisabled}
                disabled
                title={item.action.blockedReason}
              >
                {item.action.label}
              </button>
            {/if}
          </article>
        {/each}
      </section>

      <section class="fm-grid" aria-label="Active games">
        {#each data.board.games as game}
          <article class="fm-panel" data-testid={`game-card-${game.id}`}>
            <p class="fm-eyebrow">{game.phase}</p>
            <h2>{game.title}</h2>
            <p>{game.deadline}</p>
            <p>{game.activity}</p>
            <div class="fm-touch-row">
              {#each game.actions as action}
                {#if action.navigation === "link"}
                  <a
                    class={action.className}
                    href={action.href}
                    data-testid={gameActionTestId(game.id, action.id)}
                  >
                    {action.label}
                  </a>
                {:else}
                  <button
                    type="button"
                    class={action.className}
                    data-testid={gameActionTestId(game.id, action.id)}
                    data-blocked-reason={action.blockedReason}
                    aria-disabled={action.ariaDisabled}
                    disabled
                    title={action.blockedReason}
                  >
                    {action.label}
                  </button>
                {/if}
              {/each}
            </div>
          </article>
        {/each}
      </section>
    {/if}
  </main>
{/snippet}

{@render boardSurface()}
