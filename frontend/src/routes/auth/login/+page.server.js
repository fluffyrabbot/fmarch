import { authReturnPath } from "../../../lib/server/auth-return-path.mjs";
import { workosAuthKitConfigured } from "../../../lib/server/workos-authkit.mjs";

export function load({ locals, url }) {
  return {
    chooser: {
      principalUserId:
        typeof locals.principalUserId === "string" ? locals.principalUserId : null,
      accountId: optionalToken(url.searchParams.get("account")),
      returnTo: authReturnPath(url.searchParams.get("returnTo")),
      workosAvailable: workosAuthKitConfigured(),
      workosError: optionalWorkosError(url.searchParams.get("error")),
    },
  };
}

function optionalWorkosError(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase();
  return /^workos_[a-z0-9_.-]{1,96}$/u.test(trimmed) ? trimmed : "";
}

function optionalToken(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}
