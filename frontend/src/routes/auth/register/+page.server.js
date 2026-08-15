import { authReturnPath } from "../../../lib/server/auth-return-path.mjs";
import { workosAuthKitConfigured } from "../../../lib/server/workos-authkit.mjs";

export function load({ url }) {
  return {
    chooser: {
      accountId: optionalField(url.searchParams.get("account")),
      returnTo: authReturnPath(url.searchParams.get("returnTo")),
      workosAvailable: workosAuthKitConfigured(),
    },
  };
}

function optionalField(value) {
  return typeof value === "string" ? value.trim() : "";
}
