import {
  buildHostConsoleActionGroups,
  buildHostConsoleCriticalActions,
} from "../../../../lib/components/host-action/host-console-critical-action.mjs";
import { buildHostConsoleStateEndpoint } from "../../../../lib/components/host-action/host-command-boundary.mjs";
import { buildAppShell } from "../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../lib/app/app-surface-header-model.mjs";
import { LIVE_TRANSPORT_BOUNDARY } from "../../../../lib/app/projection-store.mjs";
import { buildLiveProjectionUrl } from "../../../../lib/app/live-transport.mjs";
import {
  hostVotecountUrl,
  hostPromptsUrl,
  loadHostColdData,
} from "../../../../lib/app/cold-load.mjs";

export const HOST_CONSOLE_REQUIRED_CAPABILITIES = Object.freeze([
  "HostOf",
  "CohostOf",
]);

export const HOST_CONSOLE_ROUTE_CONTRACT = Object.freeze({
  surfaceTestId: "host-console-surface",
  capabilityTestId: "host-console-capability",
  liveStatusTestId: "host-live-status",
  requiredText: "official-votecount-live-ws",
});

export async function buildHostConsoleRouteData({
  game,
  capabilities = [],
  principalUserId = "host_h",
  fetchImpl = null,
  apiBaseUrl = "",
}) {
  const gameId = normalizeGame(game);
  const commandPrincipalUserId = normalizePrincipal(principalUserId);
  const access = resolveHostConsoleAccess({
    game: gameId,
    capabilities,
  });
  const coldLoad = await loadHostColdData({
    game: gameId,
    principalUserId: commandPrincipalUserId,
    fetchImpl,
    apiBaseUrl,
    fallback: HOST_FIXTURE_COLD_LOAD,
  });
  const pendingPromptCount = coldLoad.hostPrompts.filter(
    (prompt) => prompt.status === "pending",
  ).length;

  const criticalActions = buildHostConsoleCriticalActions(gameId, {
    hostPrompts: coldLoad.hostPrompts,
    phase: HOST_FIXTURE_PHASE,
  });

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "moderator",
      principalUserId: commandPrincipalUserId,
      capabilities,
    }),
    game: Object.freeze({
      id: gameId,
      label: gameId,
    }),
    session: Object.freeze({
      principalUserId: commandPrincipalUserId,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "moderator",
      eyebrow: gameId,
      title: "Host console",
      summary: "Day 2 deadline is active. Slot 7 / Mira has a pending replacement.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: HOST_CONSOLE_ROUTE_CONTRACT.capabilityTestId,
      liveStatusTestId: HOST_CONSOLE_ROUTE_CONTRACT.liveStatusTestId,
    }),
    commandPrincipalUserId,
    commandEndpoint: "/commands",
    commandContext: Object.freeze({
      gameId,
      principalUserId: commandPrincipalUserId,
      capabilityLabel: access.capabilityLabel ?? "HostOf(game)",
      commandEndpoint: "/commands",
    }),
    hostConsoleStateEndpoint: buildHostConsoleStateEndpoint({
      gameId,
      principalUserId: commandPrincipalUserId,
      slotId: "slot-7",
    }),
    hostPromptEndpoint: hostPromptsUrl({
      game: gameId,
      principalUserId: commandPrincipalUserId,
    }),
    hostVotecountEndpoint: hostVotecountUrl({ game: gameId }),
    liveProjection: Object.freeze({
      endpoint: buildLiveProjectionUrl({
        apiBaseUrl,
        game: gameId,
        principalUserId: commandPrincipalUserId,
        slotId: "slot-7",
      }),
    }),
    votecountBoundary: Object.freeze({
      status: LIVE_TRANSPORT_BOUNDARY.status,
      protocol: LIVE_TRANSPORT_BOUNDARY.protocol,
      command: "official-votecount-live-ws",
    }),
    projectionBoundary: LIVE_TRANSPORT_BOUNDARY,
    access,
    phase: HOST_FIXTURE_PHASE,
    replacement: Object.freeze({
      slotId: "slot-7",
      occupantLabel: "player-mira",
      lifecycleLabel: "Alive",
      historyLabel: "Waiting for replacement command proof",
    }),
    hostPrompts: coldLoad.hostPrompts,
    votecount: coldLoad.votecount,
    criticalActions,
    moderatorActionGroups: buildHostConsoleActionGroups({
      actions: criticalActions,
      pendingPromptCount,
      votecountCount: coldLoad.votecount.length,
    }),
    moderatorControls: Object.freeze([
      Object.freeze({
        id: "phase",
        label: "Phase",
        value: "Advance, lock, or unlock",
        authority: "HostOf(game)",
      }),
      Object.freeze({
        id: "host-prompts",
        label: "Host prompts",
        value:
          pendingPromptCount === 1
            ? "1 durable prompt pending"
            : `${pendingPromptCount} durable prompts pending`,
        authority: "HostOf(game)",
      }),
      Object.freeze({
        id: "slot-lifecycle",
        label: "Slot lifecycle",
        value: "Alive, dead, modkill",
        authority: "HostOf(game)",
      }),
      Object.freeze({
        id: "roles",
        label: "Roles",
        value: "Bulk reveal after completion",
        authority: "HostOf(game)",
      }),
    ]),
    workQueues: Object.freeze([
      Object.freeze({
        id: "deadline",
        label: "Deadline",
        value: "Active extension pending",
      }),
      Object.freeze({
        id: "votecount",
        label: "Votecount",
        value:
          coldLoad.votecount.length === 0
            ? "No active ballots"
            : `${coldLoad.votecount.length} projected target${coldLoad.votecount.length === 1 ? "" : "s"}`,
      }),
      Object.freeze({
        id: "replacement",
        label: "Replacement",
        value: "Slot 7 / Mira",
      }),
    ]),
  });
}

export function resolveHostConsoleAccess({ game, capabilities = [] }) {
  const gameId = normalizeGame(game);
  const normalizedCapabilities = capabilities.map(normalizeCapability);
  const capability = normalizedCapabilities.find(
    (candidate) =>
      HOST_CONSOLE_REQUIRED_CAPABILITIES.includes(candidate.kind) &&
      candidate.game === gameId,
  );

  return Object.freeze({
    allowed: capability !== undefined,
    required: HOST_CONSOLE_REQUIRED_CAPABILITIES.map((kind) =>
      capabilityLabel({ kind, game: gameId }),
    ),
    capability: capability ?? null,
    capabilityLabel:
      capability === undefined ? null : capabilityLabel(capability),
  });
}

export function resolveHostRouteCapabilities({ game, locals = {} }) {
  if (Array.isArray(locals.resolvedCapabilities)) {
    return locals.resolvedCapabilities;
  }

  if (Array.isArray(locals.capabilities)) {
    return locals.capabilities;
  }

  return [];
}

export function resolveHostRoutePrincipal({ game, locals = {} }) {
  if (
    typeof locals.principalUserId === "string" &&
    locals.principalUserId.trim() !== ""
  ) {
    return locals.principalUserId;
  }

  return "";
}

export function hostConsoleForbiddenMessage(game) {
  const gameId = normalizeGame(game);
  return `Host console for ${gameId} requires HostOf(${gameId}) or CohostOf(${gameId}).`;
}

const HOST_FIXTURE_COLD_LOAD = Object.freeze({
  votecount: Object.freeze([
    Object.freeze({ target: "slot-2 / Ilya", count: 4, needed: 7 }),
    Object.freeze({ target: "slot-7 / Mira", count: 2, needed: 7 }),
  ]),
  hostPrompts: Object.freeze([
    Object.freeze({
      id: "D01:skip_next_day:slot_1",
      label: "skip_next_day",
      value: "beloved_princess_death",
      status: "pending",
      phaseId: "D01",
      subjectSlot: "slot_1",
      decisionKind: "acknowledge",
    }),
  ]),
});

const HOST_FIXTURE_PHASE = Object.freeze({
  id: "D01",
  label: "Day 2",
  state: "open",
  locked: false,
  summary: "Day 2 deadline is active. Slot 7 / Mira has a pending replacement.",
  deadlineLabel: "No deadline extension committed",
  lockedLabel: "Thread open",
});

function normalizeGame(game) {
  if (typeof game !== "string" || game.trim() === "") {
    throw new TypeError("host route game param must be a non-empty string");
  }
  return game;
}

function normalizePrincipal(principalUserId) {
  if (typeof principalUserId !== "string" || principalUserId.trim() === "") {
    throw new TypeError("host route principal must be a non-empty string");
  }
  return principalUserId;
}

function normalizeCapability(capability) {
  if (capability === null || typeof capability !== "object") {
    throw new TypeError("resolved capabilities must be objects");
  }

  return Object.freeze({
    kind: requiredCapabilityField(capability.kind, "kind"),
    game: requiredCapabilityField(capability.game, "game"),
    source:
      typeof capability.source === "string" && capability.source.trim() !== ""
        ? capability.source
        : null,
  });
}

function requiredCapabilityField(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`capability ${field} must be a non-empty string`);
  }
  return value;
}

function capabilityLabel(capability) {
  return `${capability.kind}(${capability.game})`;
}
