import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import {
  capabilityLabel,
  resolveSurfaceAccess,
} from "../../../lib/app/capabilities.mjs";
import {
  loadPlayerColdData,
  playerThreadUrl,
  playerVotecountUrl,
  principalScopedGameUrl,
} from "../../../lib/app/cold-load.mjs";
import {
  buildLiveProjectionUrl,
  LIVE_TRANSPORT_BOUNDARY,
} from "../../../lib/app/live-transport.mjs";
export {
  buildLiveOfficialPost,
  mergeThreadPage,
  threadPageStatusForResult,
} from "../../../lib/components/player-thread/player-thread-model.mjs";
export {
  buildPrivateQueue,
  buildPrivateQueueBoundary,
} from "../../../lib/components/player-private-queue/player-private-queue-model.mjs";
export {
  buildPlayerChannels,
  resolvePlayerChannelAccess,
} from "../../../lib/components/player-channel-rail/player-channel-rail-model.mjs";
import {
  buildPlayerChannels,
  resolvePlayerChannelAccess,
} from "../../../lib/components/player-channel-rail/player-channel-rail-model.mjs";
import { buildLiveOfficialPost } from "../../../lib/components/player-thread/player-thread-model.mjs";
import {
  buildPrivateQueue,
  buildPrivateQueueBoundary,
} from "../../../lib/components/player-private-queue/player-private-queue-model.mjs";
import { buildPlayerRouteLayoutViewModel } from "./player-route-layout.mjs";

export const PLAYER_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "player-surface",
  capabilityTestId: "player-capability",
  liveStatusTestId: "player-live-status",
  requiredText: "Votecount",
});

export async function buildGameRouteData({
  game,
  principalUserId,
  capabilities = [],
  fetchImpl = null,
  apiBaseUrl = "",
  activeChannel = "main",
  privateItem = null,
}) {
  const gameId = normalizeGame(game);
  const channelId = normalizeChannel(activeChannel);
  const hasPrincipal = hasPrincipalUserId(principalUserId);
  const access = resolveSurfaceAccess({
    surface: "player",
    game: gameId,
    capabilities,
  });
  const channelAccess = resolvePlayerChannelAccess({
    game: gameId,
    channel: channelId,
    capabilities,
  });
  const canColdLoadActiveChannel =
    channelId === "main" || (channelAccess.supported && channelAccess.allowed);

  const slotCapability = capabilities.find(
    (capability) =>
      capability.kind === "SlotOccupant" &&
      (capability.game === gameId || capability.game === undefined),
  );

  const coldLoad = await loadPlayerColdData({
    game: gameId,
    activeChannel: channelId,
    principalUserId,
    fetchImpl: canColdLoadActiveChannel ? fetchImpl : null,
    apiBaseUrl,
    fallback: PLAYER_FIXTURE_COLD_LOAD,
  });

  const privateQueue = buildPrivateQueueRouteItems(coldLoad, {
    game: gameId,
    channel: channelId,
  });
  const playerCapabilityLabel =
    slotCapability === undefined ? access.capabilityLabel : capabilityLabel(slotCapability);

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "player",
      principalUserId,
      capabilities,
    }),
    game: Object.freeze({
      id: gameId,
      label: "Midsummer Invitational",
    }),
    access,
    player: Object.freeze({
      principalUserId,
      slotId: slotCapability?.slot ?? "slot-7",
      capabilityLabel: playerCapabilityLabel,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "player",
      eyebrow: "Midsummer Invitational",
      title: FIXTURE_PHASE.label,
      summary: FIXTURE_PHASE.summary,
      capabilityLabel: playerCapabilityLabel,
      capabilityTestId: PLAYER_ROUTE_CONTRACT.capabilityTestId,
      liveStatusTestId: PLAYER_ROUTE_CONTRACT.liveStatusTestId,
    }),
    channel: channelAccess,
    channels: buildPlayerChannels({
      game: gameId,
      capabilities,
      activeChannel: channelId,
    }),
    phase: FIXTURE_PHASE,
    ...coldLoad,
    privateQueue,
    privateQueueBoundary: buildPrivateQueueBoundary(coldLoad),
    privateQueueExpandedItems: privateQueueExpandedItems({
      items: privateQueue,
      privateItem,
    }),
    liveOfficialPost: buildLiveOfficialPost(coldLoad.thread),
    layout: buildPlayerRouteLayoutViewModel(),
    threadPager: Object.freeze({
      pageSize: 50,
      hasOlder: coldLoad.thread.nextBeforeSeq !== null,
      nextBeforeSeq: coldLoad.thread.nextBeforeSeq,
      channel: channelId,
      olderEndpoint:
        coldLoad.thread.nextBeforeSeq === null
          ? null
          : playerThreadUrl({
              game: gameId,
              channel: channelId,
              principalUserId,
              limit: 50,
              beforeSeq: coldLoad.thread.nextBeforeSeq,
            }),
    }),
    coldLoad: Object.freeze({
      threadEndpoint: playerThreadUrl({
        game: gameId,
        channel: channelId,
        principalUserId,
        limit: 50,
      }),
      votecountEndpoint: playerVotecountUrl({ game: gameId }),
      notificationsEndpoint: hasPrincipal
        ? principalScopedGameUrl({
            game: gameId,
            path: "notifications",
            principalUserId,
          })
        : null,
      investigationResultsEndpoint: hasPrincipal
        ? principalScopedGameUrl({
            game: gameId,
            path: "investigation-results",
            principalUserId,
          })
        : null,
    }),
    liveProjection: Object.freeze({
      endpoint: hasPrincipal
        ? buildLiveProjectionUrl({
            apiBaseUrl,
            game: gameId,
            principalUserId,
          })
        : null,
    }),
    projectionBoundary: LIVE_TRANSPORT_BOUNDARY,
    composer: Object.freeze({
      canonicalVoteTag: "##vote slot-2",
      defaultBody: "##vote slot-2",
      postCommandLabel: "Post",
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      voteTargetSlot: "slot-2",
      commandEndpoint: "/commands",
      transportBoundary: LIVE_TRANSPORT_BOUNDARY.proof,
    }),
  });
}

export function playerForbiddenMessage(game) {
  return `Game ${normalizeGame(game)} requires SlotOccupant, ChannelMember, or DeadViewer capability.`;
}

export function playerChannelForbiddenMessage({ game, channel }) {
  return `Game ${normalizeGame(game)} channel ${normalizeChannel(channel)} requires scoped channel capability.`;
}

export function playerChannelNotFoundMessage({ game, channel }) {
  return `Game ${normalizeGame(game)} does not expose player channel ${normalizeChannel(channel)}.`;
}

function normalizeGame(game) {
  if (typeof game !== "string" || game.trim() === "") {
    throw new TypeError("game route param must be a non-empty string");
  }
  return game;
}

function normalizeChannel(channel) {
  if (typeof channel !== "string" || channel.trim() === "") {
    throw new TypeError("channel route param must be a non-empty string");
  }
  return channel;
}

function hasPrincipalUserId(principalUserId) {
  return typeof principalUserId === "string" && principalUserId.trim() !== "";
}

export function buildPrivateQueueRouteItems(snapshot, { game, channel }) {
  return withPrivateQueueReviewLinks(buildPrivateQueue(snapshot), { game, channel });
}

function withPrivateQueueReviewLinks(items, { game, channel }) {
  const baseHref =
    channel === "main"
      ? `/g/${encodeURIComponent(game)}`
      : `/g/${encodeURIComponent(game)}/c/${encodeURIComponent(channel)}`;
  return Object.freeze(
    items.map((item) => {
      const params = new URLSearchParams({ private: item.id });
      return Object.freeze({
        ...item,
        reviewHref: `${baseHref}?${params.toString()}`,
      });
    }),
  );
}

function privateQueueExpandedItems({ items, privateItem }) {
  if (typeof privateItem !== "string" || privateItem.trim() === "") {
    return Object.freeze({});
  }
  const item = items.find((candidate) => candidate.id === privateItem);
  if (item === undefined) {
    return Object.freeze({});
  }
  return Object.freeze({ [item.id]: true });
}

const FIXTURE_PHASE = Object.freeze({
  label: "Day 2",
  state: "open",
  deadlineLabel: "Jun 19, 2026, 9:00 PM",
  summary: "Seven votes to hammer. Thread is open.",
});

const PLAYER_FIXTURE_COLD_LOAD = Object.freeze({
  votecount: Object.freeze([
    Object.freeze({ target: "slot-2 / Ilya", count: 4, needed: 7 }),
    Object.freeze({ target: "slot-7 / Mira", count: 2, needed: 7 }),
    Object.freeze({ target: "No lynch", count: 1, needed: 7 }),
  ]),
  thread: Object.freeze({
    nextBeforeSeq: 441,
    posts: Object.freeze([
      Object.freeze({
        seq: 442,
        authorSlot: "slot-2",
        authorLabel: "Ilya",
        body: "Pressure stays here until the replacement answer lands.",
        meta: "2 min ago",
        media: Object.freeze([
          Object.freeze({
            id: "receipt-442",
            kind: "image",
            alt: "Tablet-safe vote receipt",
            variants: Object.freeze({
              tablet: Object.freeze({
                url: "/media/midsummer/thread/receipt-442-tablet.jpg",
                width: 960,
                height: 720,
              }),
              small: Object.freeze({
                url: "/media/midsummer/thread/receipt-442-small.jpg",
                width: 480,
                height: 360,
              }),
              original: Object.freeze({
                url: "/media/midsummer/thread/receipt-442-original.jpg",
                width: 4000,
                height: 3000,
              }),
            }),
          }),
        ]),
      }),
      Object.freeze({
        seq: 443,
        authorSlot: "slot-7",
        authorLabel: "Mira",
        body: "##vote slot-2",
        meta: "1 min ago",
      }),
    ]),
  }),
  notifications: Object.freeze([
    Object.freeze({ effect: "Commuted", phase_id: "N02", status: "Delivered" }),
  ]),
  investigationResults: Object.freeze([
    Object.freeze({ mode: "tracker", target_slot: "slot-4", result: "No visit" }),
  ]),
});
