import { error, fail, redirect } from "@sveltejs/kit";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ locals, cookies, fetch }) {
  if (!locals.principalId) throw redirect(303, "/auth/login?returnTo=/profile/edit");
  const response = await _profileRequest({ locals, cookies, fetch, path: "/profiles/me/editor" });
  if (response.status === 404) return { profile: null };
  if (!response.ok) throw error(response.status === 401 || response.status === 403 ? 403 : 502, "Profile editor is unavailable");
  return { profile: await response.json() };
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
    throw redirect(303, "/profile/edit");
  },

  update: async ({ locals, cookies, fetch, request }) => {
    const form = await request.formData();
    const expectedRevision = _profileRevision(form);
    if (expectedRevision === null) {
      return fail(400, {
        state: "reject",
        message: "This profile version is invalid. Reload the page and try again.",
      });
    }
    const response = await _profileRequest({
      locals,
      cookies,
      fetch,
      path: "/profiles/me",
      method: "PUT",
      body: _profileBody(form, { includeHandle: false, expectedRevision }),
    });
    if (!response.ok) return _profileFailure(response, "Unable to update profile");
    throw redirect(303, "/profile/edit");
  },
};

export function _profileBody(form, { includeHandle = true, expectedRevision = undefined } = {}) {
  const body = {
    display_name: text(form.get("displayName")),
    bio: text(form.get("bio")),
    visibility: text(form.get("visibility")),
  };
  if (includeHandle) body.handle = text(form.get("handle"));
  if (expectedRevision !== undefined) body.expected_revision = expectedRevision;
  return body;
}

// Revisions are event-stream positions, so an update must explicitly carry the
// version the editor read. Do not coerce malformed values into a different
// revision: a stale or tampered form should be rejected rather than overwrite
// a newer profile state.
export function _profileRevision(form) {
  const value = text(form.get("expected_revision"));
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) ? revision : null;
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
