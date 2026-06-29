import { buildAppStatusViewModel } from "./app-status-model.mjs";

export const APP_ROUTE_STATE_CONTRACT = Object.freeze({
  states: Object.freeze(["empty", "loading", "reject"]),
  surfaces: Object.freeze(["board", "admin", "player", "moderator"]),
  rootTestIdPrefix: "route-state",
  statusTestIdPrefix: "route-state-status",
  actionTestIdPrefix: "route-state-action",
  fixtureQueryParam: "__fmarch_route_state",
});

const ROUTE_STATE_COPY = Object.freeze({
  board: Object.freeze({
    empty: Object.freeze({
      title: "No active games are visible",
      message: "Active games and role queues will appear here when this session has visible projections.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    loading: Object.freeze({
      title: "Loading board",
      message: "Checking active games, role queues, and capability-gated operation paths.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    reject: Object.freeze({
      title: "Board refresh rejected",
      message: "The server rejected the board refresh. Keep the previous visible state as truth and retry.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
  }),
  admin: Object.freeze({
    empty: Object.freeze({
      title: "No operator work is queued",
      message: "Game setup, audit, and recovery tasks will appear here when the backend has work for this operator.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    loading: Object.freeze({
      title: "Loading operator surface",
      message: "Checking authority, setup, audit, and recovery projections.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    reject: Object.freeze({
      title: "Admin action rejected",
      message: "The server rejected this operator action. Review the status message and retry from fresh projections.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
  }),
  player: Object.freeze({
    empty: Object.freeze({
      title: "No visible thread activity",
      message: "Posts, votecounts, and private results will appear when this session has scoped projections.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    loading: Object.freeze({
      title: "Loading game surface",
      message: "Fetching thread, channel, votecount, deadline, and private projection state.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    reject: Object.freeze({
      title: "Player action rejected",
      message: "The server rejected this player action. Keep the visible projection as truth and retry after refresh.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
  }),
  moderator: Object.freeze({
    empty: Object.freeze({
      title: "No moderator work is queued",
      message: "Deadline, votecount, prompt, replacement, and lifecycle work will appear when projections expose it.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    loading: Object.freeze({
      title: "Loading moderator surface",
      message: "Fetching host prompts, official votecount, phase, deadline, and slot lifecycle projections.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
    reject: Object.freeze({
      title: "Moderator command rejected",
      message: "The server rejected this moderator command. Keep the projected state as truth and retry after refresh.",
      actionLabel: "Back to board",
      actionHref: "/",
    }),
  }),
});

export function buildRouteStateViewModel({
  surface,
  state,
  message = null,
  actionHref = null,
} = {}) {
  assertKnown(surface, APP_ROUTE_STATE_CONTRACT.surfaces, "route state surface");
  assertKnown(state, APP_ROUTE_STATE_CONTRACT.states, "route state");

  const copy = ROUTE_STATE_COPY[surface][state];
  const status = buildAppStatusViewModel({
    status: {
      state: state === "loading" ? "pending" : state,
      message: message ?? copy.message,
    },
    testId: routeStateStatusTestId(surface, state),
    className: "fm-route-state__status",
  });

  return Object.freeze({
    surface,
    state,
    rootTestId: routeStateTestId(surface, state),
    title: copy.title,
    message: message ?? copy.message,
    action: Object.freeze({
      label: copy.actionLabel,
      href: actionHref ?? copy.actionHref,
      testId: routeStateActionTestId(surface, state),
      className: "fm-touch-button fm-touch-button--secondary",
      minTouchTargetPx: 44,
    }),
    status,
  });
}

export function buildRouteStateRouteData({
  surface,
  state,
  message = null,
  actionHref = null,
} = {}) {
  assertKnown(surface, APP_ROUTE_STATE_CONTRACT.surfaces, "route state surface");
  assertKnown(state, APP_ROUTE_STATE_CONTRACT.states, "route state");

  return Object.freeze({
    surface,
    state,
    message,
    actionHref,
  });
}

export function resolveFixtureRouteState({
  surface,
  url,
  fixtureMode = false,
} = {}) {
  if (!fixtureMode) {
    return null;
  }

  const searchParams = url?.searchParams;
  const state =
    searchParams instanceof URLSearchParams
      ? searchParams.get(APP_ROUTE_STATE_CONTRACT.fixtureQueryParam)
      : null;
  if (state === null) {
    return null;
  }

  return buildRouteStateRouteData({ surface, state });
}

export function buildRoleRouteStateMatrix() {
  return Object.freeze(
    Object.fromEntries(
      APP_ROUTE_STATE_CONTRACT.surfaces.map((surface) => [
        surface,
        Object.freeze(
          Object.fromEntries(
            APP_ROUTE_STATE_CONTRACT.states.map((state) => [
              state,
              buildRouteStateViewModel({ surface, state }),
            ]),
          ),
        ),
      ]),
    ),
  );
}

export function isAdminRouteEmpty(data) {
  return (
    arrayLength(data?.gameSetup) === 0 &&
    arrayLength(data?.audit) === 0 &&
    arrayLength(data?.recoveryTasks) === 0 &&
    arrayLength(data?.escalations) === 0
  );
}

export function isPlayerRouteEmpty({
  thread,
  votecount,
  privateQueue,
  commandState,
} = {}) {
  return (
    arrayLength(thread?.posts) === 0 &&
    arrayLength(votecount) === 0 &&
    arrayLength(privateQueue) === 0 &&
    commandState?.actorAlive !== true &&
    commandState?.currentVote == null &&
    arrayLength(commandState?.voteTargets) === 0 &&
    arrayLength(commandState?.actions) === 0
  );
}

export function isModeratorRouteEmpty({
  workQueues,
  votecount,
  hostPrompts,
  moderatorActionGroups,
} = {}) {
  return (
    arrayLength(workQueues) === 0 &&
    arrayLength(votecount) === 0 &&
    arrayLength(hostPrompts) === 0 &&
    arrayLength(moderatorActionGroups) === 0
  );
}

export function routeStateTestId(surface, state) {
  return `${APP_ROUTE_STATE_CONTRACT.rootTestIdPrefix}-${surface}-${state}`;
}

export function routeStateStatusTestId(surface, state) {
  return `${APP_ROUTE_STATE_CONTRACT.statusTestIdPrefix}-${surface}-${state}`;
}

export function routeStateActionTestId(surface, state) {
  return `${APP_ROUTE_STATE_CONTRACT.actionTestIdPrefix}-${surface}-${state}`;
}

function assertKnown(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw new TypeError(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}
