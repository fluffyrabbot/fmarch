import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../lib/app/app-route-state-model.mjs";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostRouteCapabilities,
  resolveHostRoutePrincipal,
} from "./host-route-model.mjs";

export async function load({ params, locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const capabilities = resolveHostRouteCapabilities({
    game: params.game,
    locals,
  });
  const principalUserId = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  if (principalUserId === "") {
    throw error(403, "Host console requires an authenticated host session.");
  }

  const routeData = await buildHostConsoleRouteData({
    game: params.game,
    capabilities,
    principalUserId,
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
  });

  if (!routeData.access.allowed) {
    throw error(403, hostConsoleForbiddenMessage(params.game));
  }

  return {
    ...routeData,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "moderator",
      url,
      fixtureMode,
    }),
  };
}
