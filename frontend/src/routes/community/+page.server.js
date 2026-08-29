import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";
import { serverApiBaseUrl } from "../../lib/server/api-base.mjs";

export async function load({ locals, fetch }) {
  const apiBaseUrl = serverApiBaseUrl();
  const response = await fetch(`${apiBaseUrl}/discussions/areas`);
  const areas = response.ok ? await response.json().catch(() => null) : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalId: locals.principalId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Community",
      title: "Discussions",
      summary: "Public conversations beyond individual games.",
    }),
    community: {
      status: Array.isArray(areas) ? "ready" : "unavailable",
      areas: Array.isArray(areas) ? areas : [],
    },
  };
}
