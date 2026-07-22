import { workosAuthKitConfigured } from "../../../lib/server/workos-authkit.mjs";

export function load({ url }) {
  return {
    chooser: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
      workosAvailable: workosAuthKitConfigured(),
    },
  };
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed === "/auth/register" ||
    trimmed.startsWith("/auth/register?") ||
    trimmed.startsWith("/auth/register/")
    ? "/"
    : trimmed;
}
