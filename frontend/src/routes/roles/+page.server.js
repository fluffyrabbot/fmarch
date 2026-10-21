import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildRolesRouteData, parseRolesQuery } from "./roles-route-model.mjs";

// The role reference is public and static: no API read, no session forwarding.
export function load({ locals, url }) {
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "roles",
      principalId: locals.principalId,
      viewerProfile: locals.viewerProfile,
      capabilities: locals.resolvedCapabilities,
    }),
    roles: buildRolesRouteData({ query: parseRolesQuery(url.searchParams) }),
  };
}
