import { error } from "@sveltejs/kit";
import {
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostRouteCapabilities,
  resolveHostRoutePrincipal,
} from "./host-route-model.mjs";

export function load({ params, locals }) {
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

  const routeData = buildHostConsoleRouteData({
    game: params.game,
    capabilities,
    principalUserId,
  });

  if (!routeData.access.allowed) {
    throw error(403, hostConsoleForbiddenMessage(params.game));
  }

  return routeData;
}
