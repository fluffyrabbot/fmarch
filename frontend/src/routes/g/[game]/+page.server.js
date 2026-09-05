import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../lib/app/app-route-state-model.mjs";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { frontendFixtureMode } from "../../../lib/server/runtime-mode.mjs";
import { authenticatedApiFetch } from "../../../lib/server/session-capabilities.mjs";
import { loadPlayerGameplaySnapshot } from "../../../lib/server/gameplay-api.mjs";
import {
  applyUpstreamSessionInvalidation,
  upstreamRouteFailure,
} from "../../../lib/server/upstream-route.mjs";
import {
  buildGameRouteData,
  playerChannelForbiddenMessage,
  playerForbiddenMessage,
  resolvePlayerRouteContext,
} from "./game-route-model.mjs";

export async function load({ params, locals, fetch, url, cookies }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const context = resolvePlayerRouteContext({
    game: params.game,
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
  });
  if (!context.access.allowed) {
    throw error(403, playerForbiddenMessage(params.game));
  }
  if (!context.initialChannelAccess.allowed && !context.pendingReplacement) {
    throw error(
      403,
      playerChannelForbiddenMessage({ game: params.game, channel: "main" }),
    );
  }
  const coldLoad = await playerColdLoad({
    apiBaseUrl,
    context,
    cookies,
    fetch,
    fixtureMode,
  });
  const data = buildGameRouteData({
    game: params.game,
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
    coldLoad,
    fixtureMode,
    privateItem: url?.searchParams.get("private") ?? null,
  });

  return {
    ...data,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "player",
      url,
      fixtureMode,
    }),
  };
}

async function playerColdLoad({ apiBaseUrl, context, cookies, fetch, fixtureMode }) {
  if (fixtureMode || context.pendingReplacement) return null;
  const result = await loadPlayerGameplaySnapshot({
    game: context.gameId,
    activeChannel: context.channelId,
    principalId: context.hasPrincipal ? "authenticated" : null,
    actorSlot: context.playerCommandStateSlot,
    fetchImpl: authenticatedApiFetch({ cookies, fetchImpl: fetch }),
    apiBaseUrl,
  });
  if (result.kind === "ready") return result.data;
  const routeFailure = upstreamRouteFailure(result, { resource: "Game state" });
  applyUpstreamSessionInvalidation(cookies, routeFailure);
  throw error(routeFailure.status, routeFailure.message);
}
