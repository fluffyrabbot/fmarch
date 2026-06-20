import { resolveFixtureRouteState } from "../lib/app/app-route-state-model.mjs";
import { buildBoardRouteData } from "../lib/app/app-shell-model.mjs";

export function load({ locals, url }) {
  const data = buildBoardRouteData({
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
  });
  return {
    ...data,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "board",
      url,
      fixtureMode: process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1",
    }),
  };
}
