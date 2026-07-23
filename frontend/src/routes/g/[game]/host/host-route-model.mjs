import {
  buildHostConsoleActionGroups,
  buildHostConsoleCriticalActions,
} from "../../../../lib/components/host-action/host-console-critical-action.mjs";
import {
  buildHostLifecycleControlCheckpoint,
} from "../../../../lib/components/host-action/host-lifecycle-control-checkpoint.mjs";
import {
  buildHostConsoleStateEndpoint,
  projectHostConsoleState,
} from "../../../../lib/components/host-action/host-command-boundary.mjs";
import {
  formatDeadlineCountdown,
} from "../../../../lib/components/host-action/host-work-queue-strip.mjs";
import { buildAppShell } from "../../../../lib/app/app-shell-model.mjs";
import { buildAppSurfaceHeaderViewModel } from "../../../../lib/app/app-surface-header-model.mjs";
import {
  capabilityLabel,
  normalizeCapabilities,
} from "../../../../lib/app/capabilities.mjs";
import { LIVE_TRANSPORT_BOUNDARY } from "../../../../lib/app/projection-store.mjs";
import { buildLiveProjectionUrl } from "../../../../lib/app/live-transport.mjs";
import {
  hostVotecountUrl,
  hostPromptsUrl,
  dayVoteOutcomesUrl,
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
  requiredText: "Live official tally",
});

export async function buildHostConsoleRouteData({
  game,
  capabilities = [],
  principalUserId = "host_h",
  fetchImpl = null,
  apiBaseUrl = "",
  publicApiBaseUrl = null,
}) {
  const gameId = normalizeGame(game);
  const commandPrincipalUserId = normalizePrincipal(principalUserId);
  const access = resolveHostConsoleAccess({
    game: gameId,
    capabilities,
  });
  const replacement = Object.freeze({
    slotId: "slot-7",
    occupantLabel: "player-mira",
    lifecycleLabel: "Alive",
    historyLabel: "Waiting for replacement command proof",
  });
  const authorityFallback = buildHostAuthorityFallback({
    access,
    principalUserId: commandPrincipalUserId,
  });
  const serverHostConsoleStateEndpoint = buildHostConsoleStateEndpoint({
    gameId,
    slotId: replacement.slotId,
    apiBaseUrl,
  });
  const coldLoad = await loadHostColdData({
    game: gameId,
    principalUserId: commandPrincipalUserId,
    fetchImpl,
    apiBaseUrl,
    hostConsoleStateEndpoint: serverHostConsoleStateEndpoint,
    fallback: HOST_FIXTURE_COLD_LOAD,
  });
  const hostProjection = projectHostConsoleState(
    coldLoad.hostConsoleState,
    Object.freeze({
      authority: authorityFallback,
      completed: false,
      phase: HOST_FIXTURE_PHASE,
      replacement,
      tasks: HOST_FIXTURE_HOST_TASKS,
      dayEvents: HOST_FIXTURE_DAY_EVENTS,
      dayEventScheduler: null,
    }),
  );
  const pendingPromptCount = coldLoad.hostPrompts.filter(
    (prompt) => prompt.status === "pending",
  ).length;
  const criticalActions = buildHostConsoleCriticalActions(gameId, {
    hostPrompts: coldLoad.hostPrompts,
    phase: hostProjection.phase,
    replacement: hostProjection.replacement,
    completed: hostProjection.completed,
    capabilityKind: hostProjection.authority.capabilityKind,
    allowedPermissionClasses: hostProjection.authority.allowedClasses,
  });
  const moderatorActionGroups = buildHostConsoleActionGroups({
    actions: criticalActions,
    pendingPromptCount,
    votecountCount: coldLoad.votecount.length,
    capabilityKind: hostProjection.authority.capabilityKind,
  });
  const moderatorControls = buildModeratorControls({
    actionGroups: moderatorActionGroups,
  });
  const hostLifecycleControlCheckpoint = buildHostLifecycleControlCheckpoint({
    phase: hostProjection.phase,
    replacement: hostProjection.replacement,
    actionGroups: moderatorActionGroups,
    commandContext: {
      gameId,
      principalUserId: commandPrincipalUserId,
      capabilityLabel: access.capabilityLabel ?? "HostOf(game)",
      commandEndpoint: "/commands",
    },
  });

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "moderator",
      principalUserId: commandPrincipalUserId,
      capabilities,
      phase: hostProjection.phase,
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
      slotId: replacement.slotId,
      apiBaseUrl: publicApiBaseUrl ?? apiBaseUrl,
    }),
    hostPromptEndpoint: hostPromptsUrl({
      game: gameId,
      principalUserId: commandPrincipalUserId,
    }),
    hostVotecountEndpoint: hostVotecountUrl({ game: gameId }),
    dayVoteOutcomesEndpoint: dayVoteOutcomesUrl({ game: gameId }),
    liveProjection: Object.freeze({
      endpoint: buildLiveProjectionUrl({
        // Browser-facing socket URL: must stay on the public base even when
        // SSR fetches ride the private network.
        apiBaseUrl: publicApiBaseUrl ?? apiBaseUrl,
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
    authority: hostProjection.authority,
    completed: hostProjection.completed,
    phase: hostProjection.phase,
    replacement: hostProjection.replacement,
    inviteTargets: buildHostInviteTargets({
      replacement: {
        slotId: "slot-7",
        occupantLabel: "player-mira",
      },
    }),
    hostPrompts: coldLoad.hostPrompts,
    hostTasks: hostProjection.tasks,
    hostDayEvents: hostProjection.dayEvents,
    dayEventScheduler: hostProjection.dayEventScheduler,
    votecount: coldLoad.votecount,
    dayVoteOutcomes: coldLoad.dayVoteOutcomes,
    dayVoteOutcomeBoundary: Object.freeze({
      status: "official-engine-result",
      command: "/day-vote-outcomes",
    }),
    criticalActions,
    moderatorActionGroups,
    hostLifecycleControlCheckpoint,
    moderatorControls,
    deadlineClock: HOST_FIXTURE_DEADLINE_CLOCK,
    workQueues: buildHostWorkQueues({
      phase: hostProjection.phase,
      votecountCount: coldLoad.votecount.length,
      nowSeconds: HOST_FIXTURE_DEADLINE_CLOCK.nowSeconds,
    }),
  });
}

export function buildHostWorkQueues({
  phase = {},
  votecountCount = 0,
  nowSeconds = null,
} = {}) {
  const countdown = formatDeadlineCountdown({
    deadlineSeconds: phase?.deadline,
    nowSeconds,
  });
  return Object.freeze([
    Object.freeze({
      id: "deadline",
      label: "Deadline",
      value: countdown ?? "No deadline committed",
    }),
    Object.freeze({
      id: "votecount",
      label: "Votecount",
      value:
        votecountCount === 0
          ? "No active ballots"
          : `${votecountCount} projected target${votecountCount === 1 ? "" : "s"}`,
    }),
    Object.freeze({
      id: "replacement",
      label: "Replacement",
      value: "Slot 7 / Mira",
    }),
  ]);
}

export function buildHostInviteTargets({
  replacement = {},
  replacementPrincipalUserId = "player-rowan",
} = {}) {
  const slotId = normalizeSlotId(replacement.slotId ?? "slot-7");
  const occupant = normalizePrincipal(replacement.occupantLabel ?? "player-mira");
  const replacementPrincipal = normalizePrincipal(replacementPrincipalUserId);
  return Object.freeze({
    player: Object.freeze({
      id: "player",
      eyebrow: "Player invite",
      action: "?/issuePlayerInvite",
      panelTestId: "host-player-invite-panel",
      targetTestId: "host-player-invite-target",
      submitTestId: "host-player-invite-submit",
      statusTestId: "host-player-invite-status",
      urlTestId: "host-player-invite-url",
      accountTestId: "host-player-invite-account",
      slotId,
      principalUserId: occupant,
      expectedOccupantUserId: occupant,
      targetLabel: `${slotDisplayLabel(slotId)} / ${occupant}`,
      submitLabel: "Issue player invite",
    }),
    replacement: Object.freeze({
      id: "replacement",
      eyebrow: "Replacement invite",
      action: "?/issueReplacementInvite",
      panelTestId: "host-replacement-invite-panel",
      targetTestId: "host-replacement-invite-target",
      submitTestId: "host-replacement-invite-submit",
      statusTestId: "host-replacement-invite-status",
      urlTestId: "host-replacement-invite-url",
      accountTestId: "host-replacement-invite-account",
      slotId,
      principalUserId: replacementPrincipal,
      expectedOccupantUserId: occupant,
      targetLabel: `${slotDisplayLabel(slotId)} / ${replacementPrincipal}`,
      submitLabel: "Issue invite",
    }),
  });
}

function buildModeratorControls({ actionGroups }) {
  const controlIds = new Set([
    "deadline",
    "phase",
    "host-prompts",
    "slot-lifecycle",
    "roles",
  ]);
  return Object.freeze(
    actionGroups
      .filter((group) => controlIds.has(group.id))
      .map((group) =>
        Object.freeze({
          id: group.id,
          label: group.label,
          value: group.value,
          authority: group.authority,
        }),
      ),
  );
}

function buildHostAuthorityFallback({ access, principalUserId }) {
  return Object.freeze({
    principalUserId,
    capabilityKind: access.capability?.kind === "CohostOf" ? "CohostOf" : "HostOf",
    allowedClasses: Object.freeze([]),
    deniedClasses: Object.freeze([]),
  });
}

export function resolveHostConsoleAccess({ game, capabilities = [] }) {
  const gameId = normalizeGame(game);
  const normalizedCapabilities = normalizeCapabilities(capabilities);
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
  hostConsoleState: null,
  votecount: Object.freeze([
    Object.freeze({ target: "slot-2 / Ilya", count: 4, needed: 7 }),
    Object.freeze({ target: "slot-7 / Mira", count: 2, needed: 7 }),
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

const HOST_FIXTURE_HOST_TASKS = Object.freeze([
  Object.freeze({
    id: "engine-host-prompt:D01:skip_next_day:slot_1",
    kind: "engine_host_prompt",
    state: "ready",
    urgency: "attention",
    intent: "beloved_princess_death",
    consequence: "resolve pack-defined skip_next_day policy",
    phaseId: "D01",
    subjectSlot: "slot_1",
    sourceId: "D01:skip_next_day:slot_1",
    allowedCommands: Object.freeze([
      Object.freeze({
        kind: "resolve_host_prompt",
        permissionClass: "host_prompt_resolve",
      }),
    ]),
    blockedReason: null,
  }),
  Object.freeze({
    id: "day-event-resolve:event-cookie",
    kind: "day_event_resolve",
    state: "ready",
    urgency: "attention",
    intent: "Resolve theme.raffle",
    consequence: "apply 1 reward binding atomically",
    phaseId: "D01",
    subjectSlot: null,
    sourceId: "event-cookie",
    allowedCommands: Object.freeze([
      Object.freeze({
        kind: "resolve_day_event",
        permissionClass: "day_event_resolve",
      }),
    ]),
    blockedReason: null,
  }),
]);

const HOST_FIXTURE_DAY_EVENTS = Object.freeze([
  Object.freeze({
    eventId: "event-cookie",
    state: "locked",
    phaseId: "D01",
    templateKey: "theme.raffle",
    participation: Object.freeze({
      who: "alive_slots",
      mode: "opt_in",
      minimum: 1,
      maximum: null,
    }),
    participantSlots: Object.freeze(["slot-1", "slot-2", "slot-7"]),
    rewards: Object.freeze([
      Object.freeze({
        key: "cookie",
        labelKey: "theme.cookie",
        effectCount: 1,
      }),
    ]),
  }),
]);

const HOST_FIXTURE_PHASE = Object.freeze({
  id: "D01",
  label: "Day 2",
  state: "open",
  locked: false,
  summary: "Day 2 deadline is active. Slot 7 / Mira has a pending replacement.",
  deadline: 1781841600,
  deadlineLabel: "No deadline extension committed",
  lockedLabel: "Thread open",
});

const HOST_FIXTURE_DEADLINE_CLOCK = Object.freeze({
  nowSeconds: 1781806740,
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

function normalizeSlotId(slotId) {
  if (typeof slotId !== "string" || slotId.trim() === "") {
    throw new TypeError("host route slot id must be a non-empty string");
  }
  return slotId;
}

function slotDisplayLabel(slotId) {
  const suffix = slotId.match(/\d+/)?.[0];
  return suffix === undefined ? slotId : `Slot ${suffix}`;
}
