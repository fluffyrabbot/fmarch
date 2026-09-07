import { fixtureApiRoutes, mockStateProjections, createRoleMockState } from "./role-fixtures.mjs";
import { encodeServerEnvelopeFrame } from "../app/live-transport.mjs";

function matches(pattern, url) {
  if (pattern instanceof RegExp) return pattern.test(url);
  const expression = pattern.split("**").map(part => part.split("*").map(text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*")).join(".*");
  return new RegExp(`^${expression}$`).test(url);
}

// Returns a fresh value; adapting a preview never mutates proof fixtures.
export function previewResponse(url, { phaseId = "D01", slotId = "slot-7" } = {}) {
  if (url.pathname === "/live/tickets") {
    const search = new URLSearchParams(url.search);
    search.set("fmarch-preview", "1");
    return { url: `/ws?${search}`, expires_at: 4102444800 };
  }
  if (/\/reading-checkpoint$/.test(url.pathname)) return { revision: 0, position: null, available: false };
  if (/\/private-attention$/.test(url.pathname)) return { reviewed_ids: [] };
  const state = createRoleMockState();
  const route = [...fixtureApiRoutes].reverse().find(route => matches(route.pattern, url.href)
    && !(route.passthroughWhen?.urlIncludes && url.href.includes(route.passthroughWhen.urlIncludes)));
  if (!route) return undefined;
  const body = structuredClone(route.bodyFrom ? mockStateProjections[route.bodyFrom](state) : route.body);
  if (/\/(notifications|investigation-results)$/.test(url.pathname)) return [];
  if (body?.game?.phase_id) body.game.phase_id = phaseId;
  if (body?.phase?.phase_id) body.phase.phase_id = phaseId;
  if (body?.actor_slot) {
    body.actor_slot = url.searchParams.get("slot_id") ?? slotId;
    if (!phaseId.startsWith("D")) { body.vote_targets = []; body.day_events = []; }
  }
  if (body?.posts) for (const post of body.posts) {
    post.media = [];
    if (post.body === "Browser smoke refreshed player post.") post.body = "I want to hear from Ilya before we settle the vote.";
  }
  return body;
}

// Installed only by the explicitly enabled workbench, before route children
// mount. This is a simulated transport, not an authority or backend fallback.
export function installPreviewTransport({ phaseId = "D01", slotId = "slot-7" } = {}, target = window) {
  const nativeFetch = target.fetch;
  const NativeWebSocket = target.WebSocket;
  const sockets = new Set();
  let disposed = false;
  const fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, target.location.href);
    if (url.origin !== target.location.origin) return nativeFetch.call(target, input, init);
    if (url.pathname === "/commands") return Response.json({ error: "PreviewOnly", message: "Commands are unavailable in this visual preview." }, { status: 409 });
    if (url.pathname === "/live/tickets" || url.pathname.startsWith("/api/gameplay/games/midsummer")) {
      const body = previewResponse(url, { phaseId, slotId });
      return body === undefined ? new Response(null, { status: 503 }) : Response.json(body);
    }
    return nativeFetch.call(target, input, init);
  };
  class PreviewSocket extends EventTarget {
    constructor(url) {
      super(); this.url = String(url); this.readyState = NativeWebSocket.CONNECTING;
      const query = new URL(url, target.location.href).searchParams;
      const game = query.get("game"), channel = query.get("channel") ?? "main", slot = query.get("slot_id");
      const caps = slot ? [{ kind: "SlotOccupant", body: { game, slot } }] : [{ kind: "HostOf", body: { game } }];
      sockets.add(this);
      this.timer = setTimeout(() => {
        if (disposed || this.readyState === NativeWebSocket.CLOSED) return;
        this.readyState = NativeWebSocket.OPEN;
        this.dispatchEvent(new Event("open"));
        const frame = encodeServerEnvelopeFrame({ v: 3, id: 0, body: { kind: "Hello", body: {
          protocol_v: 3, server: "workbench", scope: { game, channel, slot_id: slot }, caps,
        } } });
        this.dispatchEvent(new MessageEvent("message", { data: Uint8Array.from(frame).buffer }));
      }, 0);
    }
    send() {}
    close() {
      if (this.readyState === NativeWebSocket.CLOSED) return;
      clearTimeout(this.timer); this.readyState = NativeWebSocket.CLOSED; sockets.delete(this);
      this.dispatchEvent(new Event("close"));
    }
  }
  function WebSocket(url, protocols) {
    return new URL(url, target.location.href).searchParams.get("fmarch-preview") === "1"
      ? new PreviewSocket(url) : new NativeWebSocket(url, protocols);
  }
  for (const key of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) WebSocket[key] = NativeWebSocket[key];
  target.fetch = fetch; target.WebSocket = WebSocket;
  return {
    setPhase(next) {
      if (!["D01", "N01", "T01"].includes(next)) throw new TypeError("Unknown preview phase");
      phaseId = next;
      for (const socket of [...sockets]) socket.close();
    },
    dispose() {
      disposed = true;
      for (const socket of [...sockets]) socket.close();
      if (target.fetch === fetch) target.fetch = nativeFetch;
      if (target.WebSocket === WebSocket) target.WebSocket = NativeWebSocket;
    },
  };
}
