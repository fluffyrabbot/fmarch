import { readingPosition } from "../../../../lib/app/reading-checkpoint.mjs";
import { accessTokenForRequest } from "../../../../lib/server/session-capabilities.mjs";
import { serverApiBaseUrl } from "../../../../lib/server/api-base.mjs";

const ALLOWED_GAMEPLAY_READ = /^games\/[^/]+(?:\/(?:channels\/[^/]+\/reading-checkpoint|channels\/(?!main(?:\/|$))[^/]+\/thread|votecount|day-vote-outcomes|endgame-summary|notifications|investigation-results|slot-mentions|private-attention|player-command-state|host-phase-controls|host-prompts|host-console-state|setup-state|export))?$/u;
const CLIENT_SELECTED_AUTHORITY_PARAMS = Object.freeze([
  "principal_id",
  "principalId",
]);

export async function GET({ cookies, fetch, locals, params, request, url }) {
  const path = params.path ?? "";
  if (!ALLOWED_GAMEPLAY_READ.test(path)) {
    return new Response(null, { status: 404 });
  }
  if (CLIENT_SELECTED_AUTHORITY_PARAMS.some((key) => url.searchParams.has(key))) {
    return new Response(null, { status: 400 });
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
    headers: { "cache-control": "private, no-store", "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}


export async function POST({ cookies, fetch, params, request, url }) {
  const checkpoint = /^games\/[^/]+\/channels\/[^/]+\/reading-checkpoint$/u.test(params.path ?? "");
  if (!checkpoint && !/^games\/[^/]+\/private-attention$/u.test(params.path ?? "")) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== url.origin) return new Response(null, { status: 403 });
  const token = accessTokenForRequest({ cookies });
  if (token === null) return new Response(null, { status: 401 });
  const payload = await request.json().catch(() => null);
  if (checkpoint && (!Number.isSafeInteger(payload?.expected_revision) || payload.expected_revision < 0 || !readingPosition(payload.position))) return new Response(null, { status: 400 });
  if (!checkpoint && (typeof payload?.item_id !== "string" || payload.item_id.length > 512)) return new Response(null, { status: 400 });
  const upstream = new URL(`/${params.path}`, serverApiBaseUrl() || url.origin);
  const response = await fetch(upstream, { method: "POST", headers: {
    authorization: `Bearer ${token}`, "content-type": "application/json",
  }, body: JSON.stringify(checkpoint ? { expected_revision: payload.expected_revision, position: { source_seq: payload.position.source_seq, offset_px: payload.position.offset_px } } : { item_id: payload.item_id }), signal: request.signal });
  return new Response(response.body, { status: response.status, headers: { "cache-control": "private, no-store", "content-type": "application/json" } });
}
