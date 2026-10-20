import { capabilityEvidence } from "../../app/capabilities.mjs";
import {
  dayEventRoomLabel,
  dayEventRoomStateLabel,
} from "../../app/day-event-room.mjs";

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
    href(game) {
      return `/g/${encodeURIComponent(game)}`;
    },
    grant({ capabilities, game }) {
      return (
        heldCapability({ capabilities, game, kind: "SlotOccupant" }) ??
        heldCapability({ capabilities, game, kind: "ChannelMember", channel: "main" })
      );
    },
  }),
  Object.freeze({
    id: "dead",
    label: "Dead chat",
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/dead`;
    },
    grant({ capabilities, game }) {
      return heldCapability({ capabilities, game, kind: "DeadViewer" });
    },
  }),
  Object.freeze({
    id: "spectator",
    label: "Spectator room",
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/spectator`;
    },
    grant({ capabilities, game }) {
      return heldCapability({ capabilities, game, kind: "SpectatorOf" });
    },
  }),
]);

export function buildPlayerChannels({
  game,
  capabilities,
  activeChannel = "main",
  dayEventRooms = null,
}) {
  const definitions = playerChannelDefinitions({ capabilities, game, dayEventRooms });
  const channels = definitions.map((channel) => ({
    id: channel.id,
    label: channel.label,
    href: channel.href(game),
    active: channel.id === activeChannel,
    ...grantFields(channel.grant({ capabilities, game })),
    ...(channel.roomState === undefined
      ? {}
      : {
          roomState: channel.roomState,
          postingAllowed: channel.postingAllowed,
          roomStateLabel: channel.roomStateLabel,
          eventId: channel.eventId,
        }),
  }));

  return Object.freeze(
    channels
      .filter((channel) => channel.allowed)
      .map(({ allowed, capability, ...channel }) => Object.freeze(channel)),
  );
}

export function resolvePlayerChannelAccess({
  game,
  channel,
  capabilities = [],
  dayEventRooms = null,
}) {
  let definition = playerChannelDefinitions({ capabilities, game, dayEventRooms }).find(
    (candidate) => candidate.id === channel,
  );
  if (definition === undefined && isPrivateRoomChannel(channel)) {
    definition =
      Array.isArray(dayEventRooms) && channel.startsWith("private:event:")
        ? revokedDayEventRoom(channel)
        : dynamicPrivateChannel(channel);
  }
  if (definition === undefined) {
    return Object.freeze({
      channel,
      supported: false,
      allowed: false,
      label: null,
      capability: null,
      capabilityEvidence: capabilityEvidence(null),
      href: null,
    });
  }

  return Object.freeze({
    channel,
    supported: true,
    ...grantFields(definition.grant({ capabilities, game })),
    label: definition.label,
    href: definition.href(game),
    ...(definition.roomState === undefined
      ? {}
      : {
          roomState: definition.roomState,
          postingAllowed: definition.postingAllowed,
          roomStateLabel: definition.roomStateLabel,
          eventId: definition.eventId,
        }),
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
          stateLabel:
            channel.roomStateLabel === undefined
              ? channel.active
                ? "Current channel"
                : "Open channel"
              : channel.active
                ? `Current channel · ${channel.roomStateLabel}`
                : channel.roomStateLabel,
          minTouchTargetPx: PLAYER_CHANNEL_SWITCHER_CONTRACT.minTouchTargetPx,
        }),
      ),
    ),
  });
}

function playerChannelDefinitions({ capabilities, game, dayEventRooms }) {
  const roomProjectionIsAuthoritative = Array.isArray(dayEventRooms);
  const eventRooms = roomProjectionIsAuthoritative
    ? dayEventRooms.map(dynamicDayEventRoom)
    : [];
  const dynamicChannels = capabilities
    .filter(
      (capability) =>
        capability.kind === "ChannelMember" &&
        capability.game === game &&
        !(
          roomProjectionIsAuthoritative &&
          String(capability.channel).startsWith("private:event:")
        ) &&
        !PLAYER_CHANNELS.some((channel) => channel.id === capability.channel),
    )
    .map((capability) => dynamicPrivateChannel(capability.channel));
  const definitions = [...PLAYER_CHANNELS, ...eventRooms, ...dynamicChannels].sort(
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

function revokedDayEventRoom(channelId) {
  const definition = dynamicPrivateChannel(channelId);
  return Object.freeze({
    ...definition,
    label: "Event room",
    grant() {
      return null;
    },
  });
}

function dynamicDayEventRoom(room) {
  const id = String(room.channelId);
  return Object.freeze({
    id,
    eventId: String(room.eventId),
    label: dayEventRoomLabel(room),
    roomState: String(room.state),
    postingAllowed: room.postingAllowed === true,
    roomStateLabel: dayEventRoomStateLabel(room),
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/${encodeURIComponent(id)}`;
    },
    // The room projection is the membership authority for event rooms.
    grant({ game }) {
      return Object.freeze({ kind: "ChannelMember", game, channel: id });
    },
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
    href(game) {
      return `/g/${encodeURIComponent(game)}/c/${encodeURIComponent(id)}`;
    },
    grant({ capabilities, game }) {
      return heldCapability({ capabilities, game, kind: "ChannelMember", channel: id });
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

function heldCapability({ capabilities, game, kind, channel = undefined }) {
  return (
    capabilities.find(
      (capability) =>
        capability.kind === kind &&
        capability.game === game &&
        (channel === undefined || capability.channel === channel),
    ) ?? null
  );
}

function grantFields(capability) {
  return {
    allowed: capability !== null,
    capability,
    capabilityEvidence: capabilityEvidence(capability),
  };
}
