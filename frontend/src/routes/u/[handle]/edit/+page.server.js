import { error, redirect } from "@sveltejs/kit";
import { _profileBody, _profileFailure, _profileRequest } from "../../../profile/edit/+page.server.js";

export async function load({ params, locals, cookies, fetch }) {
  if (!locals.principalUserId) throw redirect(303, `/auth/login?returnTo=/u/${encodeURIComponent(params.handle)}/edit`);
  const response = await _profileRequest({ cookies, fetch, path: `/profiles/${encodeURIComponent(params.handle)}/editor` });
  if (!response.ok) throw error(response.status === 401 || response.status === 403 ? 403 : 404, "Profile editor is unavailable");
  return { profile: await response.json() };
}

export const actions = {
  update: async ({ params, cookies, fetch, request, url }) => {
    const response = await _profileRequest({
      cookies,
      fetch,
      path: `/profiles/${encodeURIComponent(params.handle)}`,
      method: "PUT",
      body: _profileBody(await request.formData()),
    });
    if (!response.ok) return _profileFailure(response, "Unable to update profile");
    throw redirect(303, url.pathname);
  },
};
