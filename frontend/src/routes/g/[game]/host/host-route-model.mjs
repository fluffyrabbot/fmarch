import { buildHostConsoleCriticalActions } from "../../../../lib/components/host-action/host-console-critical-action.mjs";
import { buildHostConsoleStateEndpoint } from "../../../../lib/components/host-action/host-command-boundary.mjs";

export const HOST_CONSOLE_REQUIRED_CAPABILITIES = Object.freeze([
  "HostOf",
  "CohostOf",
]);

export const HOST_CONSOLE_TABLET_SMOKE_GAME = "tablet-smoke";

export function buildHostConsoleRouteData({
  game,
  capabilities = [],
  principalUserId = "host_h",
}) {
  const gameId = normalizeGame(game);
  const commandPrincipalUserId = normalizePrincipal(principalUserId);
  const access = resolveHostConsoleAccess({
    game: gameId,
    capabilities,
  });

  return Object.freeze({
    game: Object.freeze({
      id: gameId,
      label: gameId,
    }),
    session: Object.freeze({
      principalUserId: commandPrincipalUserId,
    }),
    commandPrincipalUserId,
    commandEndpoint: "/commands",
    hostConsoleStateEndpoint: buildHostConsoleStateEndpoint({
      gameId,
      principalUserId: commandPrincipalUserId,
      slotId: "slot-7",
    }),
    access,
    phase: Object.freeze({
      id: "day-2",
      label: "Day 2",
      state: "open",
      summary: "Day 2 deadline is active. Slot 7 / Mira has a pending replacement.",
      deadlineLabel: "No deadline extension committed",
    }),
    replacement: Object.freeze({
      slotId: "slot-7",
      occupantLabel: "player-mira",
      historyLabel: "Waiting for replacement command proof",
    }),
    criticalActions: buildHostConsoleCriticalActions(gameId),
    workQueues: Object.freeze([
      Object.freeze({
        id: "deadline",
        label: "Deadline",
        value: "Active extension pending",
      }),
      Object.freeze({
        id: "votecount",
        label: "Votecount",
        value: "Ready for official post",
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

  if (game === HOST_CONSOLE_TABLET_SMOKE_GAME) {
    return [
      Object.freeze({
        kind: "HostOf",
        game,
        source: "tablet-smoke-fixture",
      }),
    ];
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

  if (game === HOST_CONSOLE_TABLET_SMOKE_GAME) {
    return "host_h";
  }

  return "";
}

export function hostConsoleForbiddenMessage(game) {
  const gameId = normalizeGame(game);
  return `Host console for ${gameId} requires HostOf(${gameId}) or CohostOf(${gameId}).`;
}

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
