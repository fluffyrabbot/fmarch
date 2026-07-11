<script>
  import AppSurfaceHeader from "$lib/app/AppSurfaceHeader.svelte";
  import RouteState from "$lib/app/RouteState.svelte";
  import { buildRouteStateViewModel } from "$lib/app/app-route-state-model.mjs";
  import {
    BOARD_ROUTE_CONTRACT,
    gameActionTestId,
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
      <section
        class="fm-grid"
        aria-label="Games"
        data-testid={BOARD_ROUTE_CONTRACT.indexTestId}
      >
        {#if data.board.status === "unavailable"}
          <p data-testid={BOARD_ROUTE_CONTRACT.unavailableTestId}>
            The game index is unavailable. Refresh the board to try again.
          </p>
        {:else if data.board.games.length === 0}
          <p data-testid={BOARD_ROUTE_CONTRACT.emptyTestId}>
            No public games are active or completed.
          </p>
        {:else}
          {#each data.board.games as game}
          <article class="fm-panel" data-testid={`game-card-${game.id}`}>
            <p class="fm-eyebrow">{game.statusLabel}</p>
            <h2>{game.title}</h2>
            <p>{game.phaseLabel}</p>
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
                  >
                    <span class="fm-touch-button__label">{action.label}</span>
                    <small class="fm-touch-button__reason">{action.blockedLabel}</small>
                  </button>
                {/if}
              {/each}
            </div>
          </article>
          {/each}
        {/if}
      </section>
      {#if data.board.olderHref !== null}
        <nav aria-label="Game index pagination">
          <a
            class="fm-touch-button fm-touch-button--secondary"
            href={data.board.olderHref}
            data-testid={BOARD_ROUTE_CONTRACT.olderTestId}
          >
            Older games
          </a>
        </nav>
      {/if}
    {/if}
  </main>
{/snippet}

{@render boardSurface()}
