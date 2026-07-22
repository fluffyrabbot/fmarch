import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../../lib/app/app-route-state-model.mjs";
import { publicApiBaseUrl, serverApiBaseUrl } from "../../../../../lib/server/api-base.mjs";
import {
  buildGameRouteData,
  playerChannelForbiddenMessage,
  playerChannelNotFoundMessage,
  playerForbiddenMessage,
} from "../../game-route-model.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const data = await buildGameRouteData({
    game: params.game,
    activeChannel: params.channel,
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    publicApiBaseUrl: publicApiBaseUrl(),
    privateItem: url?.searchParams.get("private") ?? null,
  });

  if (!data.access.allowed) {
    throw error(403, playerForbiddenMessage(params.game));
  }
  if (!data.channel.supported) {
    throw error(404, playerChannelNotFoundMessage(params));
  }
  if (!data.channel.allowed) {
    throw error(403, playerChannelForbiddenMessage(params));
  }

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
