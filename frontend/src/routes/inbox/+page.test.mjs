import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";

test("community inbox loads the authenticated update page and private mute controls", async () => {
  const requested = [];
  const data = await load({
    cookies: { get: () => "member-session" },
    locals: { principalId: "member_b", resolvedCapabilities: [] },
    url: new URL("http://localhost/inbox?before_seq=90"),
    fetch: async (url, options) => {
      requested.push({ url, authorization: options.headers.authorization });
      if (url.startsWith("/mutes")) {
        return Response.json({
          members: [{ handle: "quiet-member", display_name: "Quiet Member", muted: true }],
          next_cursor: null,
        });
      }
      return Response.json({
        items: [{
          surface_id: "00000000-0000-0000-0000-000000000111",
          source_seq: 80,
          title: "Watched topic",
          href: "/discussions/general/t/00000000-0000-0000-0000-000000000111#post-80",
          occurred_at: 1_800_000_000,
          unread: true,
          subscribed: true,
        }],
        unread_count: 1,
        next_cursor: 80,
      });
    },
  });
  assert.deepEqual(requested, [
    { url: "/inbox?limit=50&before_seq=90", authorization: "Bearer member-session" },
    { url: "/mutes?limit=50", authorization: "Bearer member-session" },
  ]);
  assert.equal(data.shell.activeSurface, "inbox");
  assert.equal(data.inbox.unreadCount, 1);
  assert.equal(data.inbox.items[0].title, "Watched topic");
  assert.equal(data.inbox.nextCursor, "80");
  assert.equal(data.mutedMembers[0].handle, "quiet-member");
});

test("community inbox rejects a signed-out browser", async () => {
  await assert.rejects(
    load({
      cookies: { get: () => undefined },
      locals: { principalId: null, resolvedCapabilities: [] },
      url: new URL("http://localhost/inbox"),
      fetch: async () => { throw new Error("fetch must not run"); },
    }),
    (failure) => failure.status === 401,
  );
});

test("mark read advances the typed target cursor", async () => {
  let mutation;
  await assert.rejects(
    actions.markRead({
      cookies: { get: () => "member-session" },
      request: new Request("http://localhost/inbox?/markRead", {
        method: "POST",
        body: new URLSearchParams({
          surface_id: "00000000-0000-0000-0000-000000000222",
          source_seq: "81",
        }),
      }),
      fetch: async (url, options) => {
        mutation = { url, method: options.method, body: JSON.parse(options.body) };
        return Response.json({ subscribed: true, unread_count: 0 });
      },
    }),
    (failure) => failure.status === 303 && failure.location === "/inbox",
  );
  assert.deepEqual(mutation, {
    url: "/subscriptions/00000000-0000-0000-0000-000000000222/read",
    method: "POST",
    body: { read_through_seq: 81 },
  });
});

test("inbox unmute action removes the private member relationship", async () => {
  let mutation;
  await assert.rejects(
    actions.unmute({
      cookies: { get: () => "member-session" },
      locals: { principalId: "member_b" },
      request: new Request("http://localhost/inbox?/unmute", {
        method: "POST",
        body: new URLSearchParams({ handle: "quiet-member" }),
      }),
      fetch: async (url, options) => {
        mutation = { url, method: options.method, authorization: options.headers.authorization };
        return Response.json({ handle: "quiet-member", muted: false });
      },
    }),
    (failure) => failure.status === 303 && failure.location === "/inbox",
  );
  assert.deepEqual(mutation, {
    url: "/mutes/profiles/quiet-member",
    method: "DELETE",
    authorization: "Bearer member-session",
  });
});
