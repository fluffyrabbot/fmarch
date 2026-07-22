import { accessTokenForRequest } from "../../../../lib/server/session-capabilities.mjs";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";

const ALLOWED_GAMEPLAY_READ = /^games\/[^/]+\/(?:channels\/[^/]+\/thread|notifications|investigation-results|player-command-state|host-phase-controls|host-prompts|host-console-state|setup-state|export)$/u;

export async function GET({ cookies, fetch, locals, params, request, url }) {
  const path = params.path ?? "";
  if (!ALLOWED_GAMEPLAY_READ.test(path)) {
    return new Response(null, { status: 404 });
  }
  const token = accessTokenForRequest({ locals, cookies });
  if (token === null) {
    return new Response(null, { status: 401 });
  }
  const upstream = new URL(`/${path}`, serverApiBaseUrl() || url.origin);
  upstream.search = url.search;
  const response = await fetch(upstream, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: request.headers.get("accept") ?? "application/json",
    },
    signal: request.signal,
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
