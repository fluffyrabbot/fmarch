import { workosAuthKitConfigured } from "../../../lib/server/workos-authkit.mjs";

export function load({ locals, url }) {
  return {
    chooser: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      accountId: optionalToken(url.searchParams.get("account")),
      returnTo: safeReturnTo(url.searchParams.get("returnTo")),
      workosAvailable: workosAuthKitConfigured(),
    },
  };
}

function optionalToken(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function safeReturnTo(value) {
  if (typeof value !== "string") {
    return "/";
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed === "/auth/login" ||
    trimmed.startsWith("/auth/login?") ||
    trimmed.startsWith("/auth/login/")
    ? "/"
    : trimmed;
}
