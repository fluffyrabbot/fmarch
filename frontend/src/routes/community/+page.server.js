import { buildAppShell } from "../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../lib/app/app-surface-header-model.mjs";

export async function load({ locals, fetch }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(`${apiBaseUrl}/discussions/areas`);
  const areas = response.ok ? await response.json().catch(() => null) : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalUserId: locals.principalUserId,
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
