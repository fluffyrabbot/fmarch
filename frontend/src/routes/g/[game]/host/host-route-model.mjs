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
import {
  canonicalPrincipalId,
  FIXTURE_PRINCIPAL_IDS,
} from "../../../../lib/principal-id.mjs";

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
  principalId = FIXTURE_PRINCIPAL_IDS.hostH,
  fetchImpl = null,
  apiBaseUrl = "",
}) {
  const gameId = normalizeGame(game);
  const commandPrincipalId = normalizePrincipal(principalId);
  const access = resolveHostConsoleAccess({
    game: gameId,
    capabilities,
  });
  const replacement = HOST_FIXTURE_REPLACEMENT;
  const authorityFallback = buildHostAuthorityFallback({
    access,
    principalId: commandPrincipalId,
  });
  const serverHostConsoleStateEndpoint = buildHostConsoleStateEndpoint({
    gameId,
    slotId: replacement.slotId,
    apiBaseUrl,
  });
  const coldLoad = await loadHostColdData({
    game: gameId,
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
      principalId: commandPrincipalId,
      capabilityLabel: access.capabilityLabel ?? "HostOf(game)",
      commandEndpoint: "/commands",
    },
  });

  return Object.freeze({
    shell: buildAppShell({
      game: gameId,
      activeSurface: "moderator",
      principalId: commandPrincipalId,
      capabilities,
      phase: hostProjection.phase,
    }),
    game: Object.freeze({
      id: gameId,
      label: gameId,
    }),
    session: Object.freeze({
      principalId: commandPrincipalId,
    }),
    surfaceHeader: buildAppSurfaceHeaderViewModel({
      surface: "moderator",
      eyebrow: gameId,
      title: "Host console",
      summary: "Day 1 deadline is active. Slot 7 / Mira has a pending replacement.",
      capabilityLabel: access.capabilityLabel,
      capabilityTestId: HOST_CONSOLE_ROUTE_CONTRACT.capabilityTestId,
      liveStatusTestId: HOST_CONSOLE_ROUTE_CONTRACT.liveStatusTestId,
    }),
    commandPrincipalId,
    commandEndpoint: "/commands",
    commandContext: Object.freeze({
      gameId,
      principalId: commandPrincipalId,
      capabilityLabel: access.capabilityLabel ?? "HostOf(game)",
      commandEndpoint: "/commands",
    }),
    hostConsoleStateEndpoint: buildHostConsoleStateEndpoint({
      gameId,
      slotId: replacement.slotId,
      // Browser reads must stay same-origin so the gameplay proxy can derive
      // bearer authority from the httpOnly app session. Only the websocket
      // URL below is handed the public API base directly.
      apiBaseUrl: "",
    }),
    hostPromptEndpoint: hostPromptsUrl({
      game: gameId,
    }),
    hostVotecountEndpoint: hostVotecountUrl({ game: gameId }),
    dayVoteOutcomesEndpoint: dayVoteOutcomesUrl({ game: gameId }),
    liveProjection: Object.freeze({
      endpoint: buildLiveProjectionUrl({
        game: gameId,
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
    inviteTargets: buildHostInviteTargets({ replacement: hostProjection.replacement }),
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
  replacement = HOST_FIXTURE_REPLACEMENT,
  replacementPrincipalId = FIXTURE_PRINCIPAL_IDS.playerRowan,
  replacementLabel = "player-rowan",
} = {}) {
  const slotId = normalizeSlotId(replacement.slotId ?? "slot-7");
  const occupant = normalizePrincipal(replacement.assignedPrincipalId);
  const publicName = normalizePublicPersonaName(replacement.occupantLabel, "player-mira");
  const replacementPrincipal = normalizePrincipal(replacementPrincipalId);
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
      principalId: occupant,
      expectedOccupantPrincipalId: occupant,
      targetLabel: `${slotDisplayLabel(slotId)} / ${publicName}`,
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
      principalId: replacementPrincipal,
      expectedOccupantPrincipalId: occupant,
      targetLabel: `${slotDisplayLabel(slotId)} / ${replacementLabel}`,
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

function buildHostAuthorityFallback({ access, principalId }) {
  return Object.freeze({
    principalId,
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
  return canonicalPrincipalId(locals.principalId) ?? "";
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
      phase_id: "D01",
      source_seq: 41,
      event_index: 0,
      status: "Lynch",
      winner_slot: "slot-2",
      tallies: Object.freeze({ "slot-2": 4, "slot-7": 2 }),
      majority: 4,
      reason: null,
    }),
  ]),
  hostPrompts: Object.freeze([
    Object.freeze({
      prompt_id: "D01:skip_next_day:slot_1",
      kind: "skip_next_day",
      reason: "beloved_princess_death",
      status: "pending",
      phase_id: "D01",
      subject_slot: "slot_1",
    }),
  ]),
});

const HOST_FIXTURE_REPLACEMENT = Object.freeze({
  slotId: "slot-7",
  occupantLabel: "player-mira",
  assignedPrincipalId: FIXTURE_PRINCIPAL_IDS.playerMira,
  lifecycleLabel: "Alive",
  historyLabel: "Waiting for replacement command proof",
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
  label: "Day 1",
  state: "open",
  locked: false,
  summary: "Day 1 deadline is active. Slot 7 / Mira has a pending replacement.",
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

function normalizePrincipal(principalId) {
  const canonicalId = canonicalPrincipalId(principalId);
  if (canonicalId === null) {
    throw new TypeError("host route principal must be a canonical UUID");
  }
  return canonicalId;
}

function normalizePublicPersonaName(publicName, fallback) {
  return typeof publicName === "string" && publicName.trim() !== ""
    ? publicName.trim()
    : fallback;
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
