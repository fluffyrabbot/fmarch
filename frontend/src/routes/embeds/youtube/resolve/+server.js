import { accessTokenForRequest } from "../../../../lib/server/session-capabilities.mjs";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";

export async function POST({ cookies, fetch, request, env = process.env }) {
  const token = accessTokenForRequest({ cookies });
  if (token === null) {
    return Response.json(
      { error: "NotAuthorized", retryable: false, message: "an enabled current session is required" },
      { status: 401 },
    );
  }
  const response = await fetch(`${serverApiBaseUrl(env)}/embeds/youtube/resolve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: await request.arrayBuffer(),
    signal: request.signal,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
