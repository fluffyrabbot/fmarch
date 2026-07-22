import { error } from "@sveltejs/kit";
import { resolveFixtureRouteState } from "../../../../lib/app/app-route-state-model.mjs";
import {
  hostConsoleForbiddenMessage,
  resolveHostRouteCapabilities,
  resolveHostRoutePrincipal,
} from "../host/host-route-model.mjs";
import {
  buildHostSetupRouteData,
} from "./setup-route-model.mjs";
import {
  _issueHostScopedInvite,
} from "../host/+page.server.js";
import { accessTokenForRequest } from "../../../../lib/server/session-capabilities.mjs";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";

export async function load({ params, locals, fetch, url, cookies }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const capabilities = resolveHostRouteCapabilities({
    game: params.game,
    locals,
  });
  const principalUserId = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  const sessionToken = accessTokenForRequest({ locals, cookies });
  if (principalUserId === "") {
    throw error(403, "Host setup requires an authenticated host session.");
  }

  const routeData = await buildHostSetupRouteData({
    game: params.game,
    capabilities,
    principalUserId,
    fetchImpl: fixtureMode && apiBaseUrl === "" ? null : fetch,
    apiBaseUrl,
    sessionToken,
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

export const actions = {
  issuePlayerInvite: async ({ cookies, fetch, locals, params, request, url }) =>
    await _issueHostScopedInvite({
      cookies,
      fetch,
      locals,
      params,
      request,
      url,
      field: "playerInvite",
      tokenPrefix: "player",
      defaultPrincipalUserId: "player-mira",
      ackMessage: "Player invite issued",
      rejectMessage: "Player invite was rejected",
    }),
};
