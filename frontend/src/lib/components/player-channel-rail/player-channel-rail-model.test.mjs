import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPlayerChannelRailViewModel,
  buildPlayerChannels,
  PLAYER_CHANNEL_RAIL_CONTRACT,
  resolvePlayerChannelAccess,
} from "./player-channel-rail-model.mjs";

test("player channel rail filters channels to scoped capabilities", () => {
  assert.deepEqual(
    buildPlayerChannels({
      game: "midsummer",
      capabilities: [
        { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
        { kind: "ChannelMember", game: "midsummer", channel: "private:mafia_day_chat" },
        { kind: "DeadViewer", game: "midsummer" },
        { kind: "ChannelMember", game: "other", channel: "main" },
      ],
    }).map((channel) => channel.id),
    ["private:role_pm:slot-7", "dead", "private:mafia_day_chat"],
  );

  assert.deepEqual(
    buildPlayerChannels({
      game: "midsummer",
      capabilities: [
        { kind: "SlotOccupant", game: "midsummer", slot: "slot-7" },
        { kind: "ChannelMember", game: "other", channel: "private:role_pm:slot-7" },
        { kind: "DeadViewer", game: "other" },
      ],
    }).map((channel) => channel.id),
    ["main"],
  );
});

test("player channel rail model exposes active and touch contracts", () => {
  const view = buildPlayerChannelRailViewModel({
    channels: buildPlayerChannels({
      game: "midsummer",
      capabilities: [{ kind: "SlotOccupant", game: "midsummer", slot: "slot-7" }],
    }),
  });

  assert.equal(view.root.className, PLAYER_CHANNEL_RAIL_CONTRACT.rootClassName);
  assert.equal(view.root.ariaLabel, "Channels");
  assert.equal(view.root.data.component, "player-channel-rail");
  assert.deepEqual(view.channels, [
    {
      id: "main",
      label: "Main thread",
      href: "/g/midsummer",
      active: true,
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
      ariaCurrent: "page",
      minTouchTargetPx: 44,
    },
  ]);
});

test("player channel rail encodes game ids in channel hrefs", () => {
  const channels = buildPlayerChannels({
    game: "game with spaces",
    capabilities: [{ kind: "ChannelMember", game: "game with spaces", channel: "private:role_pm:slot-7" }],
  });

  assert.deepEqual(channels, [
    {
      id: "private:role_pm:slot-7",
      label: "Role PM",
      href: "/g/game%20with%20spaces/c/private%3Arole_pm%3Aslot-7",
      active: false,
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    },
  ]);
});

test("player channel rail marks the active private channel and resolves access", () => {
  const capabilities = [
    { kind: "ChannelMember", game: "midsummer", channel: "private:role_pm:slot-7" },
  ];
  const channels = buildPlayerChannels({
    game: "midsummer",
    capabilities,
    activeChannel: "private:role_pm:slot-7",
  });

  assert.deepEqual(channels, [
    {
      id: "private:role_pm:slot-7",
      label: "Role PM",
      href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
      active: true,
      capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    },
  ]);
  assert.deepEqual(resolvePlayerChannelAccess({
    game: "midsummer",
    channel: "private:role_pm:slot-7",
    capabilities,
  }), {
    channel: "private:role_pm:slot-7",
    supported: true,
    allowed: true,
    label: "Role PM",
    capabilityLabel: "ChannelMember(private:role_pm:slot-7)",
    href: "/g/midsummer/c/private%3Arole_pm%3Aslot-7",
  });
  assert.equal(resolvePlayerChannelAccess({
    game: "midsummer",
    channel: "scum-chat",
    capabilities,
  }).supported, false);
  assert.deepEqual(resolvePlayerChannelAccess({
    game: "midsummer",
    channel: "private:mafia_day_chat",
    capabilities,
  }), {
    channel: "private:mafia_day_chat",
    supported: true,
    allowed: false,
    label: "Mafia day chat",
    capabilityLabel: "ChannelMember(private:mafia_day_chat)",
    href: "/g/midsummer/c/private%3Amafia_day_chat",
  });
});

test("player channel rail exposes capability-derived private rooms", () => {
  const capabilities = [
    { kind: "SlotOccupant", game: "midsummer", slot: "slot_1" },
    {
      kind: "ChannelMember",
      game: "midsummer",
      channel: "private:mafia_day_chat",
    },
  ];
  const channels = buildPlayerChannels({
    game: "midsummer",
    capabilities,
    activeChannel: "private:mafia_day_chat",
  });

  assert.deepEqual(channels, [
    {
      id: "main",
      label: "Main thread",
      href: "/g/midsummer",
      active: false,
      capabilityLabel: "SlotOccupant or ChannelMember(main)",
    },
    {
      id: "private:mafia_day_chat",
      label: "Mafia day chat",
      href: "/g/midsummer/c/private%3Amafia_day_chat",
      active: true,
      capabilityLabel: "ChannelMember(private:mafia_day_chat)",
    },
  ]);
  assert.deepEqual(
    resolvePlayerChannelAccess({
      game: "midsummer",
      channel: "private:mafia_day_chat",
      capabilities,
    }),
    {
      channel: "private:mafia_day_chat",
      supported: true,
      allowed: true,
      label: "Mafia day chat",
      capabilityLabel: "ChannelMember(private:mafia_day_chat)",
      href: "/g/midsummer/c/private%3Amafia_day_chat",
    },
  );
});

test("player channel rail derives Mason and Neighbor rooms from capabilities", () => {
  const capabilities = [
    {
      kind: "ChannelMember",
      game: "midsummer",
      channel: "private:mason",
    },
    {
      kind: "ChannelMember",
      game: "midsummer",
      channel: "private:neighbor",
    },
  ];

  assert.deepEqual(
    buildPlayerChannels({ game: "midsummer", capabilities }),
    [
      {
        id: "private:mason",
        label: "Mason",
        href: "/g/midsummer/c/private%3Amason",
        active: false,
        capabilityLabel: "ChannelMember(private:mason)",
      },
      {
        id: "private:neighbor",
        label: "Neighbor",
        href: "/g/midsummer/c/private%3Aneighbor",
        active: false,
        capabilityLabel: "ChannelMember(private:neighbor)",
      },
    ],
  );
});
