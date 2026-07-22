import { redirect } from "@sveltejs/kit";
import { loadAuthKit, workosAuthKitConfigured } from "$lib/server/workos-authkit.mjs";

// WorkOS redirect URI. AuthKit finishes the OAuth ceremony here and seals its
// session cookie; the browser is then routed through /auth/workos/complete,
// which exchanges the WorkOS access token once for the backend-owned
// fmarch_session and discards the AuthKit cookie.
export async function GET(event) {
  if (!workosAuthKitConfigured()) {
    throw redirect(302, "/auth/login");
  }
  const authKit = await loadAuthKit();
  const response = await authKit.handleCallback()(event);
  const location = response.headers.get("location");
  if (typeof location !== "string" || location === "") {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set(
    "location",
    `/auth/workos/complete?returnTo=${encodeURIComponent(safeReturnTo(location))}`,
  );
  return new Response(null, { status: response.status, headers });
}

function safeReturnTo(value) {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//") ? trimmed : "/";
}
