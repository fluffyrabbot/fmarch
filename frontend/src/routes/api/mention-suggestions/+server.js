import { serverApiBaseUrl } from "../../../lib/server/api-base.mjs";
import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";

/**
 * Composer typeahead proxy. The browser never holds the API bearer token, so
 * the suggestion read goes through the session the same way every other
 * member-scoped read does. The corpus upstream is `public_profile`, so an
 * unknown, private, or redacted handle is indistinguishable here: all three
 * produce an empty list.
 */
export async function GET({ cookies, fetch, locals, request, url }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (typeof token !== "string" || token.trim() === "") {
    return new Response(null, { status: 401 });
  }
  const query = (url.searchParams.get("q") ?? "").trim();
  if (query === "") {
    return Response.json({ suggestions: [] });
  }
  const upstream = new URL("/profiles/mention-suggestions", serverApiBaseUrl() || url.origin);
  upstream.searchParams.set("q", query);
  const response = await fetch(upstream, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    signal: request.signal,
  });
  if (!response.ok) {
    return Response.json({ suggestions: [] }, { status: response.status === 401 ? 401 : 200 });
  }
  return Response.json(await response.json().catch(() => ({ suggestions: [] })));
}
