import { fail, redirect } from "@sveltejs/kit";
import { authReturnPath } from "../../../lib/server/auth-return-path.mjs";
import {
  pendingCommunityInvitation,
  storePendingCommunityInvitation,
} from "../../../lib/server/pending-community-invitation.mjs";

export function load({ cookies, url }) {
  const accountId = optional(url.searchParams.get("account"));
  const returnTo = authReturnPath(url.searchParams.get("returnTo"));
  const invitationCredential = optional(url.searchParams.get("invite"));
  if (invitationCredential !== "") {
    storePendingCommunityInvitation(cookies, invitationCredential, url);
    const clean = new URLSearchParams({ returnTo });
    if (accountId !== "") clean.set("account", accountId);
    throw redirect(303, `/auth/invite?${clean.toString()}`);
  }
  return {
    admission: {
      invitationReady: pendingCommunityInvitation(cookies) !== null,
      accountId,
      returnTo,
    },
  };
}

export const actions = {
  default: async ({ cookies, request, url }) => {
    const form = await request.formData();
    const submittedCredential = optional(form.get("invitationCredential"));
    if (submittedCredential !== "") {
      storePendingCommunityInvitation(cookies, submittedCredential, url);
    }
    const invitationCredential =
      submittedCredential !== "" ? submittedCredential : pendingCommunityInvitation(cookies);
    const accountId = optional(form.get("accountId"));
    const returnTo = authReturnPath(form.get("returnTo"));
    if (invitationCredential === null || accountId === "") {
      return fail(400, {
        state: "reject",
        message: "Community invitation and invited account are required",
        invitationReady: invitationCredential !== null,
        accountId,
        returnTo,
      });
    }
    const query = new URLSearchParams({
      account: accountId,
      returnTo,
    });
    throw redirect(303, `/auth/register?${query.toString()}`);
  },
};

function optional(value) {
  return typeof value === "string" ? value.trim() : "";
}
