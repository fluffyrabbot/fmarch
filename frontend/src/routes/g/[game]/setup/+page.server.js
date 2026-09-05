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
import { frontendFixtureMode } from "../../../../lib/server/runtime-mode.mjs";

export async function load({ params, locals, fetch, url, cookies }) {
  const apiBaseUrl = serverApiBaseUrl();
  const fixtureMode = frontendFixtureMode();
  const capabilities = resolveHostRouteCapabilities({
    game: params.game,
    locals,
  });
  const principalId = resolveHostRoutePrincipal({
    game: params.game,
    locals,
  });
  const sessionToken = accessTokenForRequest({ locals, cookies });
  if (principalId === "") {
    throw error(403, "Host setup requires an authenticated host session.");
  }

  const routeData = await buildHostSetupRouteData({
    game: params.game,
    capabilities,
    principalId,
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
      ackMessage: "Player invite issued",
      rejectMessage: "Player invite was rejected",
    }),
};
