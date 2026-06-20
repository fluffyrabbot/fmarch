import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("player channel route loads an allowed role PM channel", async () => {
  const seen = [];
  const data = await load({
    params: { game: "midsummer", channel: "role-pm" },
    locals: {
      principalUserId: "player_mira",
      resolvedCapabilities: [
        { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
      ],
    },
    fetch: async (url) => {
      seen.push(url);
      return { ok: false };
    },
  });

  assert.equal(data.shell.activeSurface, "player");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.channel.channel, "role-pm");
  assert.equal(data.channel.allowed, true);
  assert.deepEqual(data.channels.map((channel) => [channel.id, channel.active]), [
    ["role-pm", true],
  ]);
  assert.equal(
    seen[0],
    "/games/midsummer/channels/role-pm/thread?limit=50&principal_user_id=player_mira",
  );
});

test("player channel route rejects missing channel capability", async () => {
  const seen = [];
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer", channel: "role-pm" },
        locals: {
          principalUserId: "player_mira",
          resolvedCapabilities: [
            { kind: "ChannelMember", game: "midsummer", channel: "main" },
          ],
        },
        fetch: async (url) => {
          seen.push(url);
          return { ok: false };
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message ===
        "Game midsummer channel role-pm requires scoped channel capability.",
  );
  assert.deepEqual(seen, []);
});

test("player channel route distinguishes unsupported channels", async () => {
  const seen = [];
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer", channel: "scum-chat" },
        locals: {
          principalUserId: "player_mira",
          resolvedCapabilities: [
            { kind: "ChannelMember", game: "midsummer", channel: "role-pm" },
          ],
        },
        fetch: async (url) => {
          seen.push(url);
          return { ok: false };
        },
      }),
    (err) =>
      err.status === 404 &&
      err.body.message ===
        "Game midsummer does not expose player channel scum-chat.",
  );
  assert.deepEqual(seen, []);
});

test("player dead channel accepts dead-viewer capability", async () => {
  const data = await load({
    params: { game: "midsummer", channel: "dead" },
    locals: {
      principalUserId: "dead_reader",
      resolvedCapabilities: [
        { kind: "DeadViewer", game: "midsummer" },
      ],
    },
    fetch: async () => ({ ok: false }),
  });

  assert.equal(data.access.capabilityLabel, "DeadViewer(midsummer)");
  assert.equal(data.shellOwner, "layout");
  assert.deepEqual(data.channels.map((channel) => [channel.id, channel.active]), [
    ["dead", true],
  ]);
});
