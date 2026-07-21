import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";

export async function load({ params, locals, fetch }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(`${apiBaseUrl}/profiles/${encodeURIComponent(params.handle)}`);
  const profile = response.ok ? await response.json() : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalUserId: locals.principalUserId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Profile",
      title: profile?.display_name ?? "Profile",
      summary: profile === null ? "Public profile" : profile.bio,
    }),
    profile: profile === null ? { status: "unavailable", handle: params.handle } : { status: "ready", ...profile },
  };
}
