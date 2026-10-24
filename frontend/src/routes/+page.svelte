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
  <main class="fm-surface board-surface" data-testid={BOARD_ROUTE_CONTRACT.surfaceTestId}>
    <AppSurfaceHeader header={data.surfaceHeader} />

    {#if boardForcedRouteState}
      <RouteState view={boardForcedRouteState} />
    {:else}
      <section
        class="fm-grid"
        aria-label="Games"
        data-testid={BOARD_ROUTE_CONTRACT.indexTestId}
      >
        {#if data.board.status === "degraded"}
          <div
            role="status"
            aria-live="polite"
            data-testid={BOARD_ROUTE_CONTRACT.unavailableTestId}
          >
            <p>The game index is temporarily unavailable. Refresh the board to try again.</p>
            {#if data.board.degradation.retryAfterSeconds !== null}
              <p>
                Try again in {data.board.degradation.retryAfterSeconds}
                {data.board.degradation.retryAfterSeconds === 1 ? "second" : "seconds"}.
              </p>
            {/if}
            {#if data.board.degradation.requestId !== null}
              <p>Reference: {data.board.degradation.requestId}</p>
            {/if}
          </div>
        {:else if data.board.games.length === 0}
          <p data-testid={BOARD_ROUTE_CONTRACT.emptyTestId}>
            No public games are active or completed.
          </p>
        {:else}
          {#each data.board.games as game}
          <article
            class="fm-panel board-card"
            data-testid={`game-card-${game.id}`}
            data-relation={game.relationKind}
            data-phase-kind={game.phaseKind}
          >
            <div class="board-card__badges">
              <p class="fm-eyebrow board-phase" data-phase-kind={game.phaseKind}>{game.phaseLabel}</p>
              {#if game.relation}<p class="board-relation">{game.relation}</p>{/if}
            </div>
            <h2>{game.title}</h2>
            <p class="board-card__meta">{game.statusLabel} · {game.signupLabel}</p>
            {#if game.hostName}<p>Hosted by {game.hostName}</p>{/if}
            {#if game.deadline}<p>Deadline <time datetime={game.deadline}>{new Date(game.deadline).toLocaleString()}</time></p>{/if}
            {#if game.seatsTotal !== null}
              <p class="board-seats">
                {#if game.seatPips}
                  <span class="board-seats__pips" aria-hidden="true">
                    {#each game.seatPips as filled}
                      <svg class="board-seats__pip" data-filled={filled ? "true" : "false"} viewBox="0 0 24 24" width="16" height="16" focusable="false">
                        <ellipse cx="12" cy="16" rx="4.2" ry="3.6" /><circle cx="6.6" cy="10.6" r="1.8" /><circle cx="10.2" cy="7.6" r="1.8" /><circle cx="13.8" cy="7.6" r="1.8" /><circle cx="17.4" cy="10.6" r="1.8" />
                      </svg>
                    {/each}
                  </span>
                {/if}
                <span>{game.seatsFilled} of {game.seatsTotal} seats filled</span>
              </p>
            {/if}
            <div class="fm-touch-row board-card__actions">
              {#each game.actions as action}
                <a
                  class={action.className}
                  href={action.href}
                  data-testid={gameActionTestId(game.id, action.id)}
                >
                  {action.label}
                </a>
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

<style>
  .board-surface { align-content: start; }
  .board-surface > .fm-grid { gap: 28px 20px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); }
  .board-card { align-content: start; }
  .board-card h2 { overflow-wrap: anywhere; }
  .board-card p { margin: 0; overflow-wrap: anywhere; }
  .board-card__badges { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; }
  .board-phase { margin: 0; }
  .board-card__meta { color: var(--fm-ink-muted); font-size: var(--fm-size-label); font-weight: 700; }
  .board-relation { background: var(--fm-accent-wash); border-radius: var(--fm-radius-control); color: var(--fm-accent-ink); font-size: 13px; font-weight: 800; padding: 3px 10px; }
  .board-seats { align-items: center; display: flex; flex-wrap: wrap; gap: 6px 10px; }
  .board-seats__pips { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .board-seats__pip { color: var(--fm-line-strong); fill: currentColor; }
  .board-seats__pip[data-filled="true"] { color: var(--fm-accent); }
  .board-card__actions { margin-block-start: auto; }
  @media (forced-colors: active) { .board-seats__pip { fill: CanvasText; } .board-seats__pip[data-filled="false"] { fill: GrayText; } }
</style>
