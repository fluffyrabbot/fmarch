import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";

test("player channel route loads an allowed role PM channel", async () => {
  const seen = [];
  const data = await withFixtureMode(() => load({
    params: { game: "midsummer", channel: "private:role_pm:slot-7" },
    locals: {
      principalId: "player_mira",
      resolvedCapabilities: [
        { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
      ],
    },
    fetch: async (url) => {
      seen.push(url);
      return { ok: false };
    },
  }));

  assert.equal(data.shell.activeSurface, "player");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.channel.channel, "private:role_pm:slot-7");
  assert.equal(data.channel.allowed, true);
  assert.deepEqual(data.channels.map((channel) => [channel.id, channel.active]), [
    ["private:role_pm:slot-7", true],
  ]);
  assert.deepEqual(seen, []);
});

test("player channel route rejects missing channel capability", async () => {
  const seen = [];
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer", channel: "private:role_pm:slot-7" },
        locals: {
          principalId: "player_mira",
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
        "Game midsummer channel private:role_pm:slot-7 requires scoped channel capability.",
  );
  assert.deepEqual(seen, []);
});

test("player channel route rejects missing dynamic private-room capability", async () => {
  const seen = [];
  await assert.rejects(
    async () =>
      await load({
        params: { game: "midsummer", channel: "private:mafia_day_chat" },
        locals: {
          principalId: "player_target",
          resolvedCapabilities: [
            { kind: "SlotOccupant", game: "midsummer", slot: "slot-2" },
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
        "Game midsummer channel private:mafia_day_chat requires scoped channel capability.",
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
          principalId: "player_mira",
          resolvedCapabilities: [
            { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
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
  const data = await withFixtureMode(() => load({
    params: { game: "midsummer", channel: "dead" },
    locals: {
      principalId: "dead_reader",
      resolvedCapabilities: [
        { kind: "DeadViewer", game: "midsummer" },
      ],
    },
    fetch: async () => ({ ok: false }),
  }));

  assert.equal(data.access.capabilityLabel, "DeadViewer(midsummer)");
  assert.equal(data.shellOwner, "layout");
  assert.deepEqual(data.channels.map((channel) => [channel.id, channel.active]), [
    ["dead", true],
  ]);
});

test("an allowed private channel fails closed when its projection is unavailable", async () => {
  await assert.rejects(
    load({
      params: { game: "midsummer", channel: "private:role_pm:slot-7" },
      locals: {
        principalId: "player_mira",
        resolvedCapabilities: [
          { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
        ],
      },
      cookies: { get: () => "session-token", delete() {} },
      fetch: async () => ({
        ok: false,
        status: 503,
        headers: new Headers(),
      }),
    }),
    (failure) =>
      failure.status === 503 &&
      failure.body.message === "Game channel is temporarily unavailable.",
  );
});

async function withFixtureMode(operation) {
  const previous = process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
  process.env.FMARCH_FRONTEND_FIXTURE_SESSION = "1";
  try {
    return await operation();
  } finally {
    if (previous === undefined) {
      delete process.env.FMARCH_FRONTEND_FIXTURE_SESSION;
    } else {
      process.env.FMARCH_FRONTEND_FIXTURE_SESSION = previous;
    }
  }
}
