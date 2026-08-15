import { redirect } from "@sveltejs/kit";
import { authReturnPath } from "$lib/server/auth-return-path.mjs";
import {
  beginWorkosAuthorization,
  workosAuthKitConfigured,
} from "$lib/server/workos-authkit.mjs";

export async function GET({ cookies, url }) {
  if (!workosAuthKitConfigured()) {
    throw redirect(302, "/auth/login");
  }
  const returnTo = authReturnPath(url.searchParams.get("returnTo"));
  const providerReturnTo =
    url.searchParams.get("flow") === "link"
      ? `/auth/account/security?fmarchWorkosFlow=link&returnTo=${encodeURIComponent(returnTo)}`
      : returnTo;
  const loginHint = optionalValue(url.searchParams.get("loginHint"));
  const signInUrl = await beginWorkosAuthorization({
    cookies,
    intent: "sign-in",
    returnTo: providerReturnTo,
    loginHint,
  });
  throw redirect(302, signInUrl);
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
