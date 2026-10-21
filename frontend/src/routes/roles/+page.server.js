import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { serverApiBaseUrl } from "../../lib/server/api-base.mjs";
import { loadRoleReference } from "./roles-reference-loader.mjs";
import { frontendFixtureMode } from "../../lib/server/runtime-mode.mjs";
import { buildRolesRouteData, parseRolesQuery } from "./roles-route-model.mjs";

// The role reference is public and game-free: no session is forwarded, and
// every filter is a query parameter so the page works without script.
export async function load({ locals, url, fetch, request }) {
  const query = parseRolesQuery(url.searchParams);
  const apiBaseUrl = serverApiBaseUrl();
  const result = await loadRoleReference({
    fetchImpl: fetch,
    apiBaseUrl,
    packKey: query.pack,
    signal: request?.signal,
    fixture: frontendFixtureMode() && apiBaseUrl === "",
  });
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "roles",
      principalId: locals.principalId,
      viewerProfile: locals.viewerProfile,
      capabilities: locals.resolvedCapabilities,
    }),
    roles: buildRolesRouteData({
      query,
      catalog: result.kind === "ok" ? result.catalog : [],
      reference: result.kind === "ok" ? result.reference : null,
    }),
  };
}
