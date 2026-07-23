import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_ROUTE_STATE_CONTRACT,
  buildRoleRouteStateMatrix,
  buildRouteStateRouteData,
  buildRouteStateViewModel,
  isAdminRouteEmpty,
  isModeratorRouteEmpty,
  isPlayerRouteEmpty,
  resolveFixtureRouteState,
  routeStateActionTestId,
  routeStateStatusTestId,
  routeStateTestId,
} from "./app-route-state-model.mjs";

test("route state contract covers board admin player and moderator non-happy paths", () => {
  assert.deepEqual(APP_ROUTE_STATE_CONTRACT.surfaces, [
    "board",
    "admin",
    "player",
    "moderator",
  ]);
  assert.deepEqual(APP_ROUTE_STATE_CONTRACT.states, ["empty", "loading", "reject"]);
  assert.equal(APP_ROUTE_STATE_CONTRACT.fixtureQueryParam, "__fmarch_route_state");

  const matrix = buildRoleRouteStateMatrix();
  for (const surface of APP_ROUTE_STATE_CONTRACT.surfaces) {
    assert.deepEqual(Object.keys(matrix[surface]), APP_ROUTE_STATE_CONTRACT.states);
    for (const state of APP_ROUTE_STATE_CONTRACT.states) {
      const view = matrix[surface][state];
      assert.equal(view.surface, surface);
      assert.equal(view.state, state);
      assert.equal(view.rootTestId, routeStateTestId(surface, state));
      assert.equal(view.status.testId, routeStateStatusTestId(surface, state));
      assert.equal(view.action.testId, routeStateActionTestId(surface, state));
      assert.equal(view.action.minTouchTargetPx, 44);
      assert.equal(view.action.href, "/");
      assert.equal(view.title.length > 0, true);
      assert.equal(view.message.length > 0, true);
      assert.equal(view.status.message, view.message);
    }
  }
});

test("route state route data is serializable and fixture scoped", () => {
  const routeState = buildRouteStateRouteData({
    surface: "admin",
    state: "loading",
    message: "Checking fixture projections",
    actionHref: "/admin",
  });
  assert.deepEqual(routeState, {
    surface: "admin",
    state: "loading",
    message: "Checking fixture projections",
    actionHref: "/admin",
  });
  assert.equal(Object.isFrozen(routeState), true);

  const url = new URL(
    "http://localhost/admin?__fmarch_route_state=reject",
  );
  assert.deepEqual(
    resolveFixtureRouteState({
      surface: "admin",
      url,
      fixtureMode: true,
    }),
    {
      surface: "admin",
      state: "reject",
      message: null,
      actionHref: null,
    },
  );
  assert.equal(
    resolveFixtureRouteState({
      surface: "admin",
      url,
      fixtureMode: false,
    }),
    null,
  );
  assert.equal(
    resolveFixtureRouteState({
      surface: "admin",
      url: new URL("http://localhost/admin"),
      fixtureMode: true,
    }),
    null,
  );
  assert.throws(
    () =>
      resolveFixtureRouteState({
        surface: "admin",
        url: new URL("http://localhost/admin?__fmarch_route_state=ack"),
        fixtureMode: true,
      }),
    /route state must be one of/,
  );
});

test("route state status semantics preserve loading and reject accessibility", () => {
  const loading = buildRouteStateViewModel({
    surface: "player",
    state: "loading",
  });
  assert.equal(loading.status.state, "pending");
  assert.equal(loading.status.role, "status");
  assert.equal(loading.status.ariaLive, "polite");

  const reject = buildRouteStateViewModel({
    surface: "moderator",
    state: "reject",
    message: "Reject PhaseLocked: reload projections",
  });
  assert.equal(reject.status.state, "reject");
  assert.equal(reject.status.ariaLive, "assertive");
  assert.equal(reject.message, "Reject PhaseLocked: reload projections");
  assert.equal(reject.status.message, reject.message);
});

test("route state model allows explicit recovery hrefs without changing touch contract", () => {
  const view = buildRouteStateViewModel({
    surface: "admin",
    state: "empty",
    actionHref: "/admin",
  });

  assert.equal(view.action.href, "/admin");
  assert.equal(view.action.className, "fm-touch-button fm-touch-button--secondary");
  assert.equal(view.action.minTouchTargetPx, 44);
});

test("route state model rejects unknown surfaces and states", () => {
  assert.throws(
    () => buildRouteStateViewModel({ surface: "profile", state: "empty" }),
    /route state surface must be one of/,
  );
  assert.throws(
    () => buildRouteStateViewModel({ surface: "player", state: "pending" }),
    /route state must be one of/,
  );
});

test("route empty helpers use role-owned visible work queues", () => {
  assert.equal(
    isAdminRouteEmpty({
      gameSetup: [],
      audit: [],
      recoveryTasks: [],
      escalations: [],
    }),
    true,
  );
  assert.equal(
    isAdminRouteEmpty({
      gameSetup: [{ id: "create-game" }],
      audit: [],
      recoveryTasks: [],
      escalations: [],
    }),
    false,
  );

  assert.equal(
    isPlayerRouteEmpty({
      thread: { posts: [] },
      votecount: [],
      privateQueue: [],
      commandState: {
        actorAlive: true,
        voteTargets: [{ kind: "no_lynch" }],
        actions: [],
        currentVote: null,
      },
    }),
    false,
  );
  assert.equal(
    isPlayerRouteEmpty({
      thread: { posts: [] },
      votecount: [],
      privateQueue: [],
      channel: { channel: "dead", allowed: true },
      commandState: {
        actorAlive: false,
        voteTargets: [],
        actions: [],
        currentVote: null,
      },
    }),
    false,
    "an authorized dead-chat route must expose its empty composer",
  );
  assert.equal(
    isPlayerRouteEmpty({
      thread: { posts: [] },
      votecount: [],
      privateQueue: [],
      channel: { channel: "spectator", allowed: true },
      commandState: {
        actorAlive: null,
        voteTargets: [],
        actions: [],
        currentVote: null,
      },
    }),
    false,
    "an authorized empty spectator room must render its read-only surface",
  );
  assert.equal(
    isPlayerRouteEmpty({
      thread: { posts: [] },
      votecount: [],
      privateQueue: [],
    }),
    true,
  );
  assert.equal(
    isPlayerRouteEmpty({
      thread: { posts: [{ seq: 1 }] },
      votecount: [],
      privateQueue: [],
    }),
    false,
  );

  assert.equal(
    isModeratorRouteEmpty({
      workQueues: [],
      votecount: [],
      hostPrompts: [],
      hostTasks: [],
      moderatorActionGroups: [],
    }),
    true,
  );
  assert.equal(
    isModeratorRouteEmpty({
      workQueues: [],
      votecount: [],
      hostPrompts: [],
      hostTasks: [],
      moderatorActionGroups: [{ id: "phase" }],
    }),
    false,
  );
  assert.equal(
    isModeratorRouteEmpty({
      workQueues: [],
      votecount: [],
      hostPrompts: [],
      hostTasks: [{ id: "engine-host-prompt:prompt-1" }],
      moderatorActionGroups: [],
    }),
    false,
  );
});
