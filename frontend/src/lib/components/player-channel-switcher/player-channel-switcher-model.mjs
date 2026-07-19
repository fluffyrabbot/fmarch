import { hasCapability } from "../../app/capabilities.mjs";

export const PLAYER_CHANNEL_SWITCHER_CONTRACT = Object.freeze({
  rootClassName: "player-channel-switcher",
  componentName: "player-channel-switcher",
  rootTestId: "player-channel-switcher",
  minTouchTargetPx: 44,
});

const PLAYER_CHANNELS = Object.freeze([
  Object.freeze({
    id: "main",
    label: "Main thread",
    capabilityLabel: "SlotOccupant or ChannelMember(main)",
    href(game) {
      return `/g/${encodeURIComponent(game)}`;
    },
    allowed({ capabilities, game }) {
      return (
        hasCapability({ capabilities, kind: "SlotOccupant", game }) ||
        hasChannelMember({ capabilities, game, channel: "main" })
      );
    },
  }),
  Object.freeze({
    id: "dead",
    label: "Dead chat",
    capabilityLabel: "DeadViewer(game)",
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/dead`;
    },
    allowed({ capabilities, game }) {
      return hasCapability({ capabilities, kind: "DeadViewer", game });
    },
  }),
  Object.freeze({
    id: "spectator",
    label: "Spectator room",
    capabilityLabel: "SpectatorOf(game)",
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/spectator`;
    },
    allowed({ capabilities, game }) {
      return hasCapability({ capabilities, kind: "SpectatorOf", game });
    },
  }),
]);

export function buildPlayerChannels({ game, capabilities, activeChannel = "main" }) {
  const definitions = playerChannelDefinitions({ capabilities, game });
  const channels = definitions.map((channel) => ({
    id: channel.id,
    label: channel.label,
    href: channel.href(game),
    active: channel.id === activeChannel,
    capabilityLabel: channel.capabilityLabel,
    allowed: channel.allowed({ capabilities, game }),
  }));

  return Object.freeze(
    channels
      .filter((channel) => channel.allowed)
      .map(({ allowed, ...channel }) => Object.freeze(channel)),
  );
}

export function resolvePlayerChannelAccess({
  game,
  channel,
  capabilities = [],
}) {
  let definition = playerChannelDefinitions({ capabilities, game }).find(
    (candidate) => candidate.id === channel,
  );
  if (definition === undefined && isPrivateRoomChannel(channel)) {
    definition = dynamicPrivateChannel(channel);
  }
  if (definition === undefined) {
    return Object.freeze({
      channel,
      supported: false,
      allowed: false,
      label: null,
      capabilityLabel: null,
      href: null,
    });
  }

  return Object.freeze({
    channel,
    supported: true,
    allowed: definition.allowed({ capabilities, game }),
    label: definition.label,
    capabilityLabel: definition.capabilityLabel,
    href: definition.href(game),
  });
}

export function buildPlayerChannelSwitcherViewModel({ channels = [] } = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_CHANNEL_SWITCHER_CONTRACT.rootClassName,
      ariaLabel: "Channels",
      testId: PLAYER_CHANNEL_SWITCHER_CONTRACT.rootTestId,
      data: Object.freeze({
        component: PLAYER_CHANNEL_SWITCHER_CONTRACT.componentName,
      }),
    }),
    channels: Object.freeze(
      channels.map((channel) =>
        Object.freeze({
          ...channel,
          ariaCurrent: channel.active ? "page" : undefined,
          stateLabel: channel.active ? "Current channel" : "Open channel",
          minTouchTargetPx: PLAYER_CHANNEL_SWITCHER_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
  });
}

function playerChannelDefinitions({ capabilities, game }) {
  const dynamicChannels = capabilities
    .filter(
      (capability) =>
        capability.kind === "ChannelMember" &&
        capability.game === game &&
        !PLAYER_CHANNELS.some((channel) => channel.id === capability.channel),
    )
    .map((capability) => dynamicPrivateChannel(capability.channel));
  const definitions = [...PLAYER_CHANNELS, ...dynamicChannels].sort(
    (left, right) => channelOrder(left.id) - channelOrder(right.id),
  );
  const seen = new Set();
  return definitions.filter((channel) => {
    if (seen.has(channel.id)) {
      return false;
    }
    seen.add(channel.id);
    return true;
  });
}

function channelOrder(channelId) {
  if (channelId === "main") return 0;
  if (channelId.startsWith("private:role_pm:")) return 1;
  if (channelId === "dead") return 2;
  if (channelId === "spectator") return 3;
  return 4;
}

function dynamicPrivateChannel(channelId) {
  const id = String(channelId);
  return Object.freeze({
    id,
    label: privateChannelLabel(id),
    capabilityLabel: `ChannelMember(${id})`,
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/${encodeURIComponent(id)}`;
    },
    allowed({ capabilities, game }) {
      return hasChannelMember({ capabilities, game, channel: id });
    },
  });
}

function privateChannelLabel(channelId) {
  if (channelId.startsWith("private:role_pm:")) {
    return "Role PM";
  }
  const cleaned = channelId
    .replace(/^private:/, "")
    .replace(/[-_]+/g, " ")
    .trim();
  if (cleaned === "") {
    return "Private room";
  }
  return cleaned
    .split(/\s+/)
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

function isPrivateRoomChannel(channel) {
  return typeof channel === "string" && channel.startsWith("private:");
}

function hasChannelMember({ capabilities, game, channel }) {
  return capabilities.some(
    (capability) =>
      capability.kind === "ChannelMember" &&
      capability.game === game &&
      capability.channel === channel,
  );
}
