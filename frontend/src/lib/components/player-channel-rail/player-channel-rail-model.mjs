import { hasCapability } from "../../app/capabilities.mjs";

export const PLAYER_CHANNEL_RAIL_CONTRACT = Object.freeze({
  rootClassName: "player-channel-rail",
  componentName: "player-channel-rail",
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
    id: "role-pm",
    label: "Role PM",
    capabilityLabel: "ChannelMember(role-pm)",
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/role-pm`;
    },
    allowed({ capabilities, game }) {
      return hasChannelMember({ capabilities, game, channel: "role-pm" });
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
]);

export function buildPlayerChannels({ game, capabilities, activeChannel = "main" }) {
  const channels = PLAYER_CHANNELS.map((channel) => ({
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
  const definition = PLAYER_CHANNELS.find((candidate) => candidate.id === channel);
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

export function buildPlayerChannelRailViewModel({ channels = [] } = {}) {
  return Object.freeze({
    root: Object.freeze({
      className: PLAYER_CHANNEL_RAIL_CONTRACT.rootClassName,
      ariaLabel: "Channels",
      data: Object.freeze({
        component: PLAYER_CHANNEL_RAIL_CONTRACT.componentName,
      }),
    }),
    channels: Object.freeze(
      channels.map((channel) =>
        Object.freeze({
          ...channel,
          ariaCurrent: channel.active ? "page" : undefined,
          minTouchTargetPx: PLAYER_CHANNEL_RAIL_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
  });
}

function hasChannelMember({ capabilities, game, channel }) {
  return capabilities.some(
    (capability) =>
      capability.kind === "ChannelMember" &&
      capability.game === game &&
      capability.channel === channel,
  );
}
