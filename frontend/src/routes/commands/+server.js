import { accessTokenForRequest } from "../../lib/server/session-capabilities.mjs";
import { serverApiBaseUrl } from "../../lib/server/api-base.mjs";

export async function POST({ cookies, fetch, locals, request }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (token === null) {
    return Response.json(
      { error: "NotAuthorized", retryable: false, message: "an enabled current session is required" },
      { status: 401 },
    );
  }
  const response = await fetch(`${serverApiBaseUrl()}/commands`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: await request.arrayBuffer(),
    signal: request.signal,
  });
  const headers = { "content-type": response.headers.get("content-type") ?? "application/json" };
  // A rate-limited command names its wait; the composer needs it to hold the draft.
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter !== null) headers["retry-after"] = retryAfter;
  return new Response(response.body, { status: response.status, headers });
}
