import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./u/[handle]/+page.server.js";

test("public profile exposes the signed-in member's private mute state", async () => {
  const requests = [];
  const data = await load({
    params: { handle: "quiet-member" },
    cookies: { get: () => "member-session" },
    locals: { principalUserId: "reader", resolvedCapabilities: [] },
    fetch: async (url, options = {}) => {
      requests.push({ url, authorization: options.headers?.authorization });
      return url.startsWith("/mutes/")
        ? Response.json({ handle: "quiet-member", display_name: "Quiet Member", muted: true })
        : Response.json({ handle: "quiet-member", display_name: "Quiet Member", bio: "Public bio" });
    },
  });
  assert.deepEqual(requests, [
    { url: "/profiles/quiet-member", authorization: undefined },
    { url: "/mutes/profiles/quiet-member", authorization: "Bearer member-session" },
  ]);
  assert.equal(data.profile.status, "ready");
  assert.equal(data.mute.muted, true);
});

test("public profile mute action writes only the authenticated private relationship", async () => {
  let mutation;
  await assert.rejects(
    actions.mute({
      params: { handle: "quiet-member" },
      cookies: { get: () => "member-session" },
      locals: { principalUserId: "reader" },
      fetch: async (url, options) => {
        mutation = { url, method: options.method, authorization: options.headers.authorization };
        return Response.json({ handle: "quiet-member", muted: true });
      },
    }),
    (failure) => failure.status === 303 && failure.location === "/u/quiet-member",
  );
  assert.deepEqual(mutation, {
    url: "/mutes/profiles/quiet-member",
    method: "PUT",
    authorization: "Bearer member-session",
  });
});
