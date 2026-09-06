import { loadPrivateAttention } from "../../../../../lib/server/private-attention.mjs";
import { requestedPost } from "../../../../../lib/app/post-address.mjs";
import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../../lib/app/app-route-state-model.mjs";
import { serverApiBaseUrl } from "../../../../../lib/server/api-base.mjs";
import { frontendFixtureMode } from "../../../../../lib/server/runtime-mode.mjs";
import { authenticatedApiFetch } from "../../../../../lib/server/session-capabilities.mjs";
import { loadPlayerGameplaySnapshot } from "../../../../../lib/server/gameplay-api.mjs";
import {
  applyUpstreamSessionInvalidation,
  upstreamRouteFailure,
} from "../../../../../lib/server/upstream-route.mjs";
import {
  buildGameRouteData,
  playerChannelForbiddenMessage,
  playerChannelNotFoundMessage,
  playerForbiddenMessage,
  resolvePlayerRouteContext,
} from "../../game-route-model.mjs";

export async function load({ params, locals, fetch, url, cookies }) {
  let aroundSeq;
  try { aroundSeq = requestedPost(url); } catch { throw error(400, "Invalid post address"); }
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const context = resolvePlayerRouteContext({
    game: params.game,
    activeChannel: params.channel,
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
  });
  if (!context.access.allowed) {
    throw error(403, playerForbiddenMessage(params.game));
  }
  if (!context.initialChannelAccess.supported) {
    throw error(404, playerChannelNotFoundMessage(params));
  }
  if (!context.initialChannelAccess.allowed) {
    throw error(403, playerChannelForbiddenMessage(params));
  }
  let coldLoad = null;
  if (!fixtureMode) {
    const result = await loadPlayerGameplaySnapshot({
      aroundSeq,
      game: context.gameId,
      activeChannel: context.channelId,
      principalId: context.hasPrincipal ? "authenticated" : null,
      actorSlot: context.playerCommandStateSlot,
      fetchImpl: authenticatedApiFetch({ cookies, fetchImpl: fetch }),
      apiBaseUrl,
    });
    if (result.kind !== "ready") {
      const routeFailure = upstreamRouteFailure(result, { resource: "Game channel" });
      applyUpstreamSessionInvalidation(cookies, routeFailure);
      throw error(routeFailure.status, routeFailure.message);
    }
    coldLoad = result.data;
  }
  const data = buildGameRouteData({
    game: params.game,
    activeChannel: params.channel,
    principalId: locals.principalId,
    capabilities: locals.resolvedCapabilities,
    coldLoad,
    fixtureMode,
    privateItem: url?.searchParams.get("private") ?? null,
  });
  if (!data.channel.allowed) {
    throw error(403, playerChannelForbiddenMessage(params));
  }

  return {
    ...data,
    privateAttention: await loadPrivateAttention({ game: context.gameId, cookies, fetch, apiBaseUrl, fixtureMode,
      enabled: context.playerCommandStateSlot !== null && !context.pendingReplacement }),
    coldLoad: { ...data.coldLoad, threadEndpoint: aroundSeq === null ? data.coldLoad.threadEndpoint : `${data.coldLoad.threadEndpoint}&around_seq=${aroundSeq}` },
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "player",
      url,
      fixtureMode,
    }),
  };
}
