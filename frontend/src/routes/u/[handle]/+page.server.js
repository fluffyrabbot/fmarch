import { fail, redirect } from "@sveltejs/kit";
import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ params, locals, cookies, fetch }) {
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(`${apiBaseUrl}/profiles/${encodeURIComponent(params.handle)}`);
  const profile = response.ok ? await response.json() : null;
  const token = accessTokenForRequest({ locals, cookies });
  const muteResponse = profile !== null && typeof token === "string" && token.trim() !== ""
    ? await fetch(`${apiBaseUrl}/mutes/profiles/${encodeURIComponent(params.handle)}`, {
        headers: authHeaders(token),
      })
    : null;
  const mute = muteResponse?.ok ? await muteResponse.json().catch(() => null) : null;
  return {
    shellOwner: "layout",
    shell: buildAppShell({
      activeSurface: "community",
      principalId: locals.principalId,
      capabilities: locals.resolvedCapabilities,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "board",
      eyebrow: "Profile",
      title: profile?.display_name ?? "Profile",
      summary: profile === null ? "Public profile" : profile.bio,
    }),
    profile: profile === null ? { status: "unavailable", handle: params.handle } : { status: "ready", ...profile },
    mute,
  };
}

export const actions = {
  mute: async ({ params, locals, cookies, fetch }) => updateMute({
    params,
    locals,
    cookies,
    fetch,
    method: "PUT",
    fallback: "Unable to mute this member",
  }),
  unmute: async ({ params, locals, cookies, fetch }) => updateMute({
    params,
    locals,
    cookies,
    fetch,
    method: "DELETE",
    fallback: "Unable to unmute this member",
  }),
};

async function updateMute({ params, locals, cookies, fetch, method, fallback }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") {
    return fail(401, { id: "profile-mute", state: "reject", message: "Sign in to manage muted members" });
  }
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  const response = await fetch(`${apiBaseUrl}/mutes/profiles/${encodeURIComponent(params.handle)}`, {
    method,
    headers: authHeaders(token),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    return fail([400, 401, 404, 409].includes(response.status) ? response.status : 502, {
      id: "profile-mute",
      state: "reject",
      message: payload?.message ?? fallback,
    });
  }
  throw redirect(303, `/u/${encodeURIComponent(params.handle)}`);
}

function authHeaders(token) {
  return { authorization: `Bearer ${token}`, accept: "application/json" };
}
