import { redirect } from "@sveltejs/kit";
import { loadAuthKit } from "$lib/server/workos-authkit.mjs";

export async function GET({ url }) {
  const authKit = await loadAuthKit();
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const loginHint = optionalValue(url.searchParams.get("loginHint"));
  const signUpUrl = await authKit.getSignUpUrl({
    returnTo,
    ...(loginHint === null ? {} : { loginHint }),
  });
  throw redirect(302, signUpUrl);
}

function optionalValue(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function safeReturnTo(value) {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") && !trimmed.startsWith("/auth/")
    ? trimmed
    : "/";
}
