import { buildAppShell } from "../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../lib/app/app-surface-header-model.mjs";
import {
  capabilityLabel,
  normalizeCapabilities,
  resolveSurfaceAccess,
} from "../../../lib/app/capabilities.mjs";
import {
  loadPlayerColdData,
  dayVoteOutcomesUrl,
  playerCommandStateUrl,
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
  const normalizedCapabilities = normalizeCapabilities(capabilities);
  const pendingReplacement = hasPrincipal && normalizedCapabilities.length === 0;
  const access = pendingReplacement ? pendingPlayerAccess(gameId) : resolveSurfaceAccess({
    surface: "player",
    game: gameId,
    capabilities: normalizedCapabilities,
  });
  const channelAccess = resolvePlayerChannelAccess({
    game: gameId,
    channel: channelId,
    capabilities: normalizedCapabilities,
  });
  const canColdLoadActiveChannel =
    !pendingReplacement &&
    (channelId === "main" || (channelAccess.supported && channelAccess.allowed));

  const slotCapability = normalizedCapabilities.find(
    (capability) =>
      capability.kind === "SlotOccupant" &&
      (capability.game === gameId || capability.game === undefined),
  );
  const playerSlotId = slotCapability?.slot ?? "slot-7";
  const playerCommandStateSlot = slotCapability === undefined ? null : playerSlotId;
  const coldLoadFallback = pendingReplacement
    ? pendingReplacementColdLoad(gameId, playerSlotId)
    : playerFixtureColdLoad(gameId);

  const coldLoad = await loadPlayerColdData({
    game: gameId,
    activeChannel: channelId,
    principalUserId,
    actorSlot: playerCommandStateSlot,
    fetchImpl: canColdLoadActiveChannel ? fetchImpl : null,
    apiBaseUrl,
    fallback: coldLoadFallback,
  });

  const privateQueue = buildPrivateQueueRouteItems(coldLoad, {
    game: gameId,
    channel: channelId,
  });
  const playerCapabilityLabel =
    slotCapability === undefined ? access.capabilityLabel : capabilityLabel(slotCapability);
  const phase = buildPlayerPhaseView(coldLoad.commandState);
  const composer = buildPlayerComposerView(
    {
      canonicalVoteTag: "##vote slot-2",
      defaultBody: "##vote slot-2",
      postCommandLabel: "Post",
      voteCommandLabel: "Vote slot-2",
      withdrawCommandLabel: "Withdraw vote",
      voteTargetSlot: "slot-2",
      commandEndpoint: "/commands",
      transportBoundary: LIVE_TRANSPORT_BOUNDARY.proof,
    },
    coldLoad.commandState,
    playerSlotId,
  );

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "player",
      principalUserId,
      capabilities: normalizedCapabilities,
    }),
    game: Object.freeze({
      id: gameId,
      label: "Midsummer Invitational",
    }),
    access,
    pendingReplacement,
    emptyState: pendingReplacement
      ? Object.freeze({
          message:
            "Replacement invite accepted. Slot authority is pending host replacement; refresh this role URL after the host processes the replacement.",
          actionHref: `/g/${encodeURIComponent(gameId)}`,
        })
      : null,
    player: Object.freeze({
      principalUserId,
      slotId: playerSlotId,
      alive: coldLoad.commandState.actorAlive,
      status: coldLoad.commandState.actorStatus,
      gameCompleted: coldLoad.commandState.gameCompleted === true,
      capabilityLabel: playerCapabilityLabel,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "player",
      eyebrow: "Midsummer Invitational",
      title: phase.label,
      summary: phase.summary,
      capabilityLabel: playerCapabilityLabel,
      capabilityTestId: PLAYER_ROUTE_CONTRACT.capabilityTestId,
      liveStatusTestId: PLAYER_ROUTE_CONTRACT.liveStatusTestId,
    }),
    channel: channelAccess,
    channels: buildPlayerChannels({
      game: gameId,
      capabilities: normalizedCapabilities,
      activeChannel: channelId,
    }),
    phase,
    ...coldLoad,
    dayVoteOutcomeBoundary: Object.freeze({
      status: "official-engine-result",
      command: "/day-vote-outcomes",
    }),
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
      dayVoteOutcomesEndpoint: dayVoteOutcomesUrl({ game: gameId }),
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
      commandStateEndpoint:
        hasPrincipal && playerCommandStateSlot !== null
          ? playerCommandStateUrl({
              game: gameId,
              principalUserId,
              slotId: playerCommandStateSlot,
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
    composer,
  });
}

function pendingPlayerAccess(game) {
  return Object.freeze({
    surface: "player",
    allowed: true,
    pending: true,
    capability: null,
    capabilityLabel: `PendingReplacement(${game})`,
    required: Object.freeze([
      `SlotOccupant(${game})`,
      `ChannelMember(${game})`,
      `DeadViewer(${game})`,
    ]),
  });
}

function pendingReplacementColdLoad(game, slotId) {
  return Object.freeze({
    commandState: Object.freeze({
      game,
      actorSlot: slotId,
      actorAlive: false,
      actorStatus: "pending_replacement",
      roleKey: null,
      gameCompleted: false,
      phase: null,
      actions: Object.freeze([]),
      boundary:
        "Replacement invite has no current SlotOccupant authority until the host processes replacement.",
    }),
    votecount: Object.freeze([]),
    dayVoteOutcomes: Object.freeze([]),
    thread: Object.freeze({
      nextBeforeSeq: null,
      posts: Object.freeze([]),
    }),
    notifications: Object.freeze([]),
    investigationResults: Object.freeze([]),
  });
}

export function buildPlayerPhaseView(commandState) {
  if (commandState?.gameCompleted === true) {
    return Object.freeze({
      label: "Endgame",
      state: "complete",
      deadlineLabel: "",
      summary: "The game is complete.",
    });
  }
  const phase = commandState?.phase;
  if (phase === null || phase === undefined || phase.phaseId === "") {
    return FIXTURE_PHASE;
  }
  const label = `${phase.phaseKind} ${phase.phaseNumber}`;
  const state = phase.locked ? "locked" : "open";
  return Object.freeze({
    label,
    state,
    deadlineLabel:
      typeof phase.deadline === "number" ? formatDeadline(phase.deadline) : "",
    summary: `${label} is ${state}.`,
  });
}

export function buildPlayerComposerView(baseComposer, commandState, actorSlot) {
  const withdrawState = playerWithdrawVoteState(commandState);
  return Object.freeze({
    ...baseComposer,
    voteCommands: buildPlayerVoteCommands(baseComposer, commandState),
    currentVoteLabel: playerCurrentVoteLabel(commandState?.currentVote ?? null),
    hasCurrentVote: commandState?.currentVote != null,
    canWithdrawVote: withdrawState.canWithdrawVote,
    withdrawDisabledReason: withdrawState.reason,
    actionCommands: buildPlayerActionCommands(commandState, actorSlot),
  });
}

export function playerWithdrawVoteState(commandState) {
  if (commandState?.currentVote == null) {
    return Object.freeze({ canWithdrawVote: false, reason: "No current vote" });
  }
  if (commandState?.phase?.locked === true) {
    return Object.freeze({ canWithdrawVote: false, reason: "Phase locked" });
  }
  if (commandState?.gameCompleted === true) {
    return Object.freeze({ canWithdrawVote: false, reason: "Game complete" });
  }
  return Object.freeze({ canWithdrawVote: true, reason: "" });
}

export function playerCurrentVoteLabel(currentVote) {
  if (currentVote == null) {
    return "No current vote";
  }
  if (currentVote.kind === "no_lynch") {
    return "Current vote: No lynch";
  }
  return `Current vote: ${currentVote.label}`;
}

export function buildPlayerVoteCommands(baseComposer, commandState) {
  if (!Array.isArray(commandState?.voteTargets)) {
    return Object.freeze(baseComposer.voteCommands ?? []);
  }
  const targets = commandState.voteTargets;
  return Object.freeze(
    targets.map((target, index) => {
      if (target.kind === "no_lynch") {
        return Object.freeze({
          action: "submit_vote:no_lynch",
          commandKind: "submit_vote",
          label: "Vote no lynch",
          voteTarget: "NoLynch",
        });
      }
      return Object.freeze({
        action: index === 0 ? "submit_vote" : `submit_vote:${target.slotId}`,
        commandKind: "submit_vote",
        label: `Vote ${target.label}`,
        voteTarget: { Slot: target.slotId },
      });
    }),
  );
}

export function buildPlayerActionCommands(commandState, actorSlot) {
  const actions = commandState?.actions ?? [];
  if (actions.length === 0) {
    return Object.freeze([]);
  }
  const legal = actions.map((action) =>
    Object.freeze({
      action: action.action,
      commandKind: action.commandKind,
      label: action.label,
      detail: action.detail,
      actionId: action.actionId,
      templateId: action.templateId,
      targets: action.targets,
      grantId: action.grantId,
    }),
  );
  const first = actions[0];
  const invalidRecovery = Object.freeze({
    action: `submit_invalid_action:${first.templateId}`,
    commandKind: "submit_invalid_action",
    label: "Try invalid self-action",
    detail: `${first.templateId} -> own slot`,
    actionId: `invalid_self_${first.templateId}`,
    templateId: first.templateId,
    targets: Object.freeze([actorSlot]),
    grantId: first.grantId,
  });
  return Object.freeze([...legal, invalidRecovery]);
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

function formatDeadline(value) {
  return new Date(value * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Los_Angeles",
  });
}

const FIXTURE_PHASE = Object.freeze({
  label: "Day 2",
  state: "open",
  deadlineLabel: "Jun 19, 2026, 9:00 PM",
  summary: "Seven votes to hammer. Thread is open.",
});

const PLAYER_FIXTURE_COLD_LOAD = Object.freeze({
  commandState: Object.freeze({
    game: "midsummer",
    actorSlot: "slot-7",
    roleKey: null,
    phase: null,
    actions: Object.freeze([]),
    voteTargets: Object.freeze([
      Object.freeze({ kind: "slot", slotId: "slot-2", label: "Slot 2" }),
      Object.freeze({ kind: "no_lynch", slotId: null, label: "No lynch" }),
    ]),
    currentVote: null,
    boundary:
      "Fixture player route data does not invent role action availability.",
  }),
  votecount: Object.freeze([
    Object.freeze({ target: "slot-2 / Ilya", count: 4, needed: 7 }),
    Object.freeze({ target: "slot-7 / Mira", count: 2, needed: 7 }),
    Object.freeze({ target: "No lynch", count: 1, needed: 7 }),
  ]),
  dayVoteOutcomes: Object.freeze([
    Object.freeze({
      phaseId: "D01",
      sourceSeq: 41,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-2",
      tallies: Object.freeze({ "slot-2": 4, "slot-7": 2 }),
      majority: 4,
      reason: null,
    }),
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

const PLAYER_ACTION_OPEN_FIXTURE_COLD_LOAD = Object.freeze({
  ...PLAYER_FIXTURE_COLD_LOAD,
  commandState: Object.freeze({
    game: "seeded-action-open",
    actorSlot: "slot-7",
    actorAlive: true,
    actorStatus: "alive",
    roleKey: "mafia_goon",
    gameCompleted: false,
    phase: Object.freeze({
      phaseId: "N02",
      phaseKind: "Night",
      phaseNumber: 2,
      locked: false,
    }),
    actions: Object.freeze([
      Object.freeze({
        action: "submit_action:factional_kill",
        commandKind: "submit_action",
        actionId: "factional_kill",
        templateId: "factional_kill",
        ability: "Kill",
        window: "Night",
        label: "Submit factional kill",
        detail: "factional_kill -> slot-2",
        targets: Object.freeze(["slot-2"]),
        targetOptions: Object.freeze(["slot-2", "slot-3"]),
        grantId: "grant-factional-kill",
      }),
    ]),
    voteTargets: Object.freeze([]),
    currentVote: null,
    boundary: "Seeded local action-open player command state.",
  }),
});

function playerFixtureColdLoad(gameId) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId)) {
    return PLAYER_ACTION_OPEN_FIXTURE_COLD_LOAD;
  }
  return PLAYER_FIXTURE_COLD_LOAD;
}
