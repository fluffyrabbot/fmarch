import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../lib/app/app-route-state-model.mjs";
import { buildGameRouteData, playerForbiddenMessage } from "./game-route-model.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const data = await buildGameRouteData({
    game: params.game,
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    privateItem: url?.searchParams.get("private") ?? null,
  });

  if (!data.access.allowed) {
    throw error(403, playerForbiddenMessage(params.game));
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
