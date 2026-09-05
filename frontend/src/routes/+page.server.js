import { resolveFixtureRouteState } from "../lib/app/app-route-state-model.mjs";
import {
  buildBoardRouteData,
  fixtureBoardGameIndexPage,
} from "../lib/app/app-shell-model.mjs";
import { serverApiBaseUrl } from "../lib/server/api-base.mjs";
import { decodeGameIndexPage } from "../lib/server/game-index-response.mjs";
import { frontendFixtureMode } from "../lib/server/runtime-mode.mjs";
import { fetchUpstreamJson } from "../lib/server/upstream-client.mjs";

export async function load({ locals, fetch, request, url }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const gameIndexResult =
    fixtureMode && apiBaseUrl === ""
      ? fixtureGameIndexResult()
      : await _loadBoardGameIndex({
          fetchImpl: fetch,
          apiBaseUrl,
          url,
          signal: request?.signal,
        });
  const data = buildBoardRouteData({
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
    gameIndexPage: gameIndexResult.kind === "ok" ? gameIndexResult.value : null,
  });
  return {
    ...data,
    board:
      gameIndexResult.kind === "ok"
        ? data.board
        : degradedBoard(gameIndexResult),
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "board",
      url,
      fixtureMode,
    }),
  };
}

export async function _loadBoardGameIndex({
  fetchImpl,
  apiBaseUrl,
  url,
  signal,
  timeoutMs,
}) {
  const search = new URLSearchParams();
  const requestedCursor = url?.searchParams?.get("cursor");
  const cursor =
    typeof requestedCursor === "string" && requestedCursor !== ""
      ? requestedCursor
      : null;
  if (cursor !== null) {
    search.set("cursor", cursor);
  }
  search.set("limit", "12");
  let decodedPage = null;
  const result = await fetchUpstreamJson({
    fetchImpl,
    url: `${apiBaseUrl}/games?${search.toString()}`,
    signal,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    validate(value) {
      decodedPage = decodeGameIndexPage(value, { cursor, limit: 12 });
      return decodedPage !== null;
    },
  });
  return result.kind === "ok"
    ? Object.freeze({ ...result, value: decodedPage })
    : result;
}

function fixtureGameIndexResult() {
  return Object.freeze({
    kind: "ok",
    value: fixtureBoardGameIndexPage(),
    status: 200,
    requestId: null,
    retryAfterSeconds: null,
  });
}

function degradedBoard(result) {
  return Object.freeze({
    status: "degraded",
    games: Object.freeze([]),
    nextCursor: null,
    olderHref: null,
    degradation: Object.freeze({
      kind: result.kind,
      upstreamStatus: result.status,
      retryAfterSeconds: result.retryAfterSeconds,
      requestId: result.requestId,
    }),
  });
}
