import { redirect } from "@sveltejs/kit";
import { authReturnPath } from "$lib/server/auth-return-path.mjs";
import {
  beginWorkosAuthorization,
  workosAuthKitConfigured,
} from "$lib/server/workos-authkit.mjs";
import { pendingCommunityInvitation } from "$lib/server/pending-community-invitation.mjs";

export async function GET({ cookies, url }) {
  if (!workosAuthKitConfigured()) {
    throw redirect(302, "/auth/register");
  }
  const returnTo = authReturnPath(url.searchParams.get("returnTo"));
  const loginHint = optionalValue(url.searchParams.get("loginHint"));
  const invitationCredential = pendingCommunityInvitation(cookies);
  if (invitationCredential === null) {
    throw redirect(302, `/auth/register?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const signUpUrl = await beginWorkosAuthorization({
    cookies,
    intent: "sign-up",
    returnTo,
    loginHint,
  });
  throw redirect(302, signUpUrl);
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
