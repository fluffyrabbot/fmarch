import { error, fail, redirect } from "@sveltejs/kit";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ locals, cookies, fetch }) {
  if (!locals.principalUserId) throw redirect(303, "/auth/login?returnTo=/profile/edit");
  const response = await _profileRequest({ locals, cookies, fetch, path: "/profiles/me/editor" });
  if (response.status === 404) return { profile: null };
  if (!response.ok) throw error(response.status === 401 || response.status === 403 ? 403 : 502, "Profile editor is unavailable");
  const profile = await response.json();
  throw redirect(303, `/u/${encodeURIComponent(profile.handle)}/edit`);
}

export const actions = {
  create: async ({ locals, cookies, fetch, request }) => {
    const form = await request.formData();
    const response = await _profileRequest({
      cookies,
      locals,
      fetch,
      path: "/profiles",
      method: "POST",
      body: _profileBody(form),
    });
    if (!response.ok) return _profileFailure(response, "Unable to create profile");
    const profile = await response.json();
    throw redirect(303, `/u/${encodeURIComponent(profile.handle)}/edit`);
  },
};

export function _profileBody(form) {
  return {
    handle: text(form.get("handle")),
    display_name: text(form.get("displayName")),
    bio: text(form.get("bio")),
    visibility: text(form.get("visibility")),
  };
}

export async function _profileRequest({ locals, cookies, fetch, path, method = "GET", body = null }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") return new Response(null, { status: 401 });
  const apiBaseUrl = process.env.FMARCH_API_BASE_URL ?? "";
  return fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(body === null ? {} : { "content-type": "application/json" }) },
    ...(body === null ? {} : { body: JSON.stringify(body) }),
  });
}

export async function _profileFailure(response, fallback) {
  const payload = await response.json().catch(() => null);
  return fail(response.status === 400 || response.status === 401 || response.status === 403 || response.status === 409 ? response.status : 502, {
    state: "reject",
    message: typeof payload?.message === "string" ? payload.message : fallback,
  });
}

function text(value) { return typeof value === "string" ? value : ""; }
