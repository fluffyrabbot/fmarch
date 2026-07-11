import { resolveFixtureRouteState } from "../lib/app/app-route-state-model.mjs";
import {
  buildBoardRouteData,
  fixtureBoardGameIndexPage,
} from "../lib/app/app-shell-model.mjs";

export async function load({ locals, fetch, url }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const fixtureMode = process.env.FMARCH_FRONTEND_FIXTURE_SESSION === "1";
  const gameIndexPage =
    fixtureMode && apiBaseUrl === ""
      ? fixtureBoardGameIndexPage()
      : await loadBoardGameIndex({ fetchImpl: fetch, apiBaseUrl, url });
  const data = buildBoardRouteData({
    principalUserId: locals.principalUserId,
    capabilities: locals.resolvedCapabilities,
    gameIndexPage,
  });
  return {
    ...data,
    shellOwner: "layout",
    routeState: resolveFixtureRouteState({
      surface: "board",
      url,
      fixtureMode,
    }),
  };
}

async function loadBoardGameIndex({ fetchImpl, apiBaseUrl, url }) {
  if (typeof fetchImpl !== "function") {
    return null;
  }
  const search = new URLSearchParams();
  const cursor = url?.searchParams?.get("cursor");
  if (typeof cursor === "string" && cursor !== "") {
    search.set("cursor", cursor);
  }
  search.set("limit", "12");
  const response = await fetchImpl(`${apiBaseUrl}/games?${search.toString()}`);
  if (!response.ok) {
    return null;
  }
  const page = await response.json();
  return page !== null && typeof page === "object" ? page : null;
}
