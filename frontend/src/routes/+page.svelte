<script>
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
  // Counts describe the cards on this page; the board is paginated.
  $: boardSummary =
    !boardForcedRouteState && data.board?.status !== "degraded" && (data.board?.games?.length ?? 0) > 0
      ? {
          inProgress: data.board.games.filter((game) => game.status === "active" && game.phaseId !== null).length,
          gathering: data.board.games.filter((game) => game.status === "active" && game.phaseId === null).length,
          closed: data.board.games.filter((game) => game.status === "completed").length,
        }
      : null;
</script>

<svelte:head>
  <title>fmarch board</title>
</svelte:head>

{#snippet boardSurface()}
  <main class="fm-surface board-surface" data-testid={BOARD_ROUTE_CONTRACT.surfaceTestId}>
    <header class="board-hero">
      <svg class="board-hero__sky" viewBox="0 0 1200 220" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
        <g class="board-hero__stars">
          <circle cx="90" cy="40" r="2" /><circle cx="210" cy="120" r="1.5" /><circle cx="330" cy="60" r="2.4" /><circle cx="470" cy="30" r="1.4" />
          <circle cx="560" cy="140" r="1.8" /><circle cx="690" cy="50" r="1.5" /><circle cx="760" cy="110" r="2.2" /><circle cx="1110" cy="150" r="1.6" />
          <circle cx="1160" cy="40" r="2" />
          <path d="M150 80l3 7 7 3-7 3-3 7-3-7-7-3 7-3z" /><path d="M640 90l2.4 5.6 5.6 2.4-5.6 2.4-2.4 5.6-2.4-5.6-5.6-2.4 5.6-2.4z" />
        </g>
        <path class="board-hero__hills" d="M0 220V186l28-26 24 24 28-34 32 36 28-20 28 24 32-34 36 36 32-22 32 24h900v26zM900 220v-24l30-28 26 22 34-38 34 36 28-24 32 28 36-34 40 32 40-18v48z" />
      </svg>
      <div class="board-hero__copy">
        <p class="fm-eyebrow">The village board</p>
        <h1>Games</h1>
        <p class="board-hero__lede">Every game in the village, from first howl to case closed.</p>
      </div>
      {#if boardSummary}
        <ul class="board-hero__counts" aria-label="Games on this page">
          <li><strong>{boardSummary.inProgress}</strong><span>in progress</span></li>
          <li><strong>{boardSummary.gathering}</strong><span>gathering</span></li>
          <li><strong>{boardSummary.closed}</strong><span>cases closed</span></li>
        </ul>
      {/if}
    </header>

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
  .board-hero { align-items: center; border-block-end: 2px solid var(--fm-line); display: flex; flex-wrap: wrap; gap: 20px 32px; isolation: isolate; margin: -22px -22px 0; overflow: hidden; padding: 36px 22px 48px; position: relative; }
  .board-hero__sky { block-size: 100%; inline-size: 100%; inset: 0; position: absolute; z-index: -1; }
  .board-hero__stars { fill: var(--fm-accent-soft); }
  .board-hero__hills { fill: var(--fm-surface-muted); }
  .board-hero__copy { display: grid; flex: 999 1 420px; gap: 8px; min-inline-size: 0; }
  .board-hero__copy .fm-eyebrow { margin: 0; }
  .board-hero h1 { font-size: clamp(36px, 6vw, 56px); }
  .board-hero__lede { color: var(--fm-ink-muted); font-size: 18px; margin: 0; max-inline-size: 36rem; }
  .board-hero__counts { display: grid; flex: 1 1 300px; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; }
  .board-hero__counts li { background: var(--fm-raised); border: 2px solid var(--fm-line); border-radius: var(--fm-radius-panel); display: grid; padding: 12px 10px; text-align: center; }
  .board-hero__counts strong { font-family: var(--fm-font-display); font-size: 30px; line-height: 1.1; }
  .board-hero__counts span { color: var(--fm-ink-muted); font-size: 13px; font-weight: 700; }
  @media (forced-colors: active) { .board-hero__sky { display: none; } }
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
