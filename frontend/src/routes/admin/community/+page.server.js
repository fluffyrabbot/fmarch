import { error, fail, redirect } from "@sveltejs/kit";
import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

export async function load({ cookies, fetch, locals, url }) {
  if (typeof locals.principalId !== "string" || locals.principalId.trim() === "") {
    throw redirect(303, `/auth/login?returnTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
  }
  if (!isGlobalAdmin(locals)) throw error(403, "Community stewardship requires GlobalAdmin.");
  const sessionToken = accessTokenForRequest({ locals, cookies });
  if (!sessionToken) throw redirect(303, "/auth/login?returnTo=%2Fadmin%2Fcommunity");
  const root = url.searchParams.get("root_membership_id");
  const query = root && UUID_PATTERN.test(root)
    ? `?root_membership_id=${encodeURIComponent(root)}`
    : "";
  const response = await fetch(`${serverApiBaseUrl()}/admin/community/stewardship${query}`, {
    headers: { accept: "application/json", authorization: `Bearer ${sessionToken}` },
  });
  const body = await response.json();
  if (!response.ok) throw error(response.status, body?.message ?? "Community stewardship unavailable");
  return { snapshot: body };
}

export const actions = {
  suspend: mutationAction({
    path: "/admin/community/membership-suspensions",
    fields(form) {
      const membershipId = uuid(form, "membershipId");
      const reason = required(form, "reason");
      if (reason.length > 280) throw new FormReject("Suspension reason must be at most 280 characters");
      return { membership_id: membershipId, reason };
    },
    success: "Membership suspended and its pending invitations revoked",
  }),
  restore: mutationAction({
    path: "/admin/community/membership-restorations",
    fields: (form) => ({ membership_id: uuid(form, "membershipId") }),
    success: "Membership restored; prior invitations remain revoked",
  }),
  revoke: mutationAction({
    path: "/admin/community/invitation-revocations",
    fields: (form) => ({ invitation_id: uuid(form, "invitationId") }),
    success: "Invitation revoked",
  }),
};

function mutationAction({ path, fields, success }) {
  return async ({ cookies, fetch, locals, request }) => {
    if (!isGlobalAdmin(locals)) return fail(403, { state: "reject", message: "GlobalAdmin required" });
    const sessionToken = accessTokenForRequest({ locals, cookies });
    if (!sessionToken) return fail(401, { state: "reject", message: "Authenticated admin session required" });
    let payload;
    try {
      payload = fields(await request.formData());
    } catch (cause) {
      return fail(400, { state: "reject", message: cause instanceof FormReject ? cause.message : "Invalid request" });
    }
    const response = await fetch(`${serverApiBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${sessionToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) return fail(response.status, { state: "reject", message: body?.message ?? "Stewardship operation rejected" });
    return { state: "ack", message: success };
  };
}

class FormReject extends Error {}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function uuid(form, key) {
  const value = form.get(key);
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new FormReject(`A valid ${key} is required`);
  return value;
}

function required(form, key) {
  const value = form.get(key);
  if (typeof value !== "string" || value.trim() === "") throw new FormReject(`${key} is required`);
  return value.trim();
}

function isGlobalAdmin(locals) {
  return (Array.isArray(locals.resolvedCapabilities) ? locals.resolvedCapabilities : [])
    .some((capability) => capability?.kind === "GlobalAdmin");
}
