import { authReturnPath } from "../../../lib/server/auth-return-path.mjs";
import { workosAuthKitConfigured } from "../../../lib/server/workos-authkit.mjs";
import { pendingCommunityInvitation } from "../../../lib/server/pending-community-invitation.mjs";
import { redirect } from "@sveltejs/kit";

export function load({ cookies, url }) {
  const returnTo = authReturnPath(url.searchParams.get("returnTo"));
  if (pendingCommunityInvitation(cookies) === null) {
    throw redirect(303, `/auth/invite?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return {
    chooser: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo,
      workosAvailable: workosAuthKitConfigured(),
    },
  };
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}
