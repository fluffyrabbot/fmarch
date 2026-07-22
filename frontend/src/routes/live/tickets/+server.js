import { accessTokenForRequest } from "../../../lib/server/session-capabilities.mjs";
import { publicApiBaseUrl, serverApiBaseUrl } from "../../../lib/server/api-base.mjs";

export async function POST({ cookies, fetch, locals, url }) {
  const token = accessTokenForRequest({ locals, cookies });
  if (token === null) {
    return Response.json(
      { error: "NotAuthorized", retryable: false, message: "an enabled current session is required" },
      { status: 401 },
    );
  }

  const game = url.searchParams.get("game");
  const channel = url.searchParams.get("channel") ?? "main";
  const slotId = url.searchParams.get("slot_id");
  const afterSeq = Number(url.searchParams.get("after_seq") ?? 0);
  const audience = process.env.FMARCH_WS_AUDIENCE?.trim() || "fmarch-live";
  const response = await fetch(`${serverApiBaseUrl()}/auth/websocket-tickets`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      audience,
      game,
      channel,
      ...(slotId === null ? {} : { slot_id: slotId }),
      after_seq: Number.isSafeInteger(afterSeq) && afterSeq >= 0 ? afterSeq : 0,
    }),
  });
  if (!response.ok) {
    return new Response(response.body, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  }

  const ticket = await response.json();
  const socketUrl = new URL("/ws", publicApiBaseUrl() || url.origin);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
  socketUrl.searchParams.set("ticket", ticket.ticket);
  socketUrl.searchParams.set("audience", ticket.audience);
  return Response.json({ url: socketUrl.toString(), expires_at: ticket.expires_at });
}
