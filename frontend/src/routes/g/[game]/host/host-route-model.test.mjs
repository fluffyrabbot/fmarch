import assert from "node:assert/strict";
import { test } from "node:test";
import { actions, load } from "./+page.server.js";
import {
  HOST_CONSOLE_ROUTE_CONTRACT,
  buildHostInviteTargets,
  buildHostConsoleRouteData,
  hostConsoleForbiddenMessage,
  resolveHostConsoleAccess,
  resolveHostRouteCapabilities,
} from "./host-route-model.mjs";

test("host console route data is allowed for HostOf scoped to the current game", async () => {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
  });

  assert.equal(data.access.allowed, true);
  assert.deepEqual(data.surfaceHeader, {
    component: "fm-surface-header",
    surface: "moderator",
    className: "fm-surface__masthead",
    eyebrowClassName: "fm-eyebrow",
    statusStackClassName: "fm-status-stack",
    eyebrow: "midsummer",
    title: "Host console",
    summary: "Day 2 deadline is active. Slot 7 / Mira has a pending replacement.",
    capability: {
      visible: true,
      label: "HostOf(midsummer)",
      testId: "host-console-capability",
      className: "fm-capability-pill",
      minTouchTargetPx: 44,
    },
    liveStatus: {
      visible: true,
      testId: "host-live-status",
      className: "fm-live-status",
    },
  });
  assert.deepEqual(HOST_CONSOLE_ROUTE_CONTRACT, {
    surfaceTestId: "host-console-surface",
    capabilityTestId: "host-console-capability",
    liveStatusTestId: "host-live-status",
    requiredText: "official-votecount-live-ws",
  });
  assert.equal(data.shell.activeSurface, "moderator");
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.equal(
    data.projectionBoundary.status,
    "json-ws-command-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(
    data.votecountBoundary.status,
    "json-ws-command-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(data.votecountBoundary.command, "official-votecount-live-ws");
  assert.equal(data.hostVotecountEndpoint, "/games/midsummer/votecount");
  assert.deepEqual(data.commandContext, {
    gameId: "midsummer",
    principalUserId: "host_h",
    capabilityLabel: "HostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.equal(
    data.liveProjection.endpoint,
    "/ws?game=midsummer&principal_user_id=host_h&slot_id=slot-7",
  );
  assert.deepEqual(data.votecount, [
    { target: "slot-2 / Ilya", count: 4, needed: 7 },
    { target: "slot-7 / Mira", count: 2, needed: 7 },
  ]);
  assert.deepEqual(
    data.criticalActions.map((action) => action.payload.gameId),
    Array(9).fill("midsummer"),
  );
  assert.deepEqual(
    data.criticalActions.map((action) => action.id),
    [
      "extend_deadline",
      "process_replacement",
      "resolve_phase",
      "lock_thread",
      "publish_votecount",
      "mark_dead",
      "modkill_slot",
      "complete_game",
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    ],
  );
  assert.deepEqual(
    data.moderatorControls.map((control) => control.id),
    ["deadline", "phase", "host-prompts", "slot-lifecycle", "roles"],
  );
  assert.deepEqual(
    data.moderatorActionGroups.map((group) => group.id),
    [
      "deadline",
      "phase",
      "votecount",
      "replacement",
      "host-prompts",
      "slot-lifecycle",
      "roles",
    ],
  );
  assert.deepEqual(
    data.moderatorActionGroups.find((group) => group.id === "phase").actions.map(
      (action) => action.id,
    ),
    ["resolve_phase", "lock_thread"],
  );
  assert.deepEqual(
    data.moderatorActionGroups
      .find((group) => group.id === "votecount")
      .actions.map((action) => action.id),
    ["publish_votecount"],
  );
  assert.deepEqual(
    data.moderatorActionGroups
      .find((group) => group.id === "host-prompts")
      .actions.map((action) => action.id),
    ["resolve_host_prompt-D01-skip_next_day-slot_1"],
  );
  assert.equal(
    data.moderatorActionGroups.find((group) => group.id === "roles").boundary,
    "Typed command",
  );
  assert.deepEqual(
    data.moderatorActionGroups
      .find((group) => group.id === "roles")
      .actions.map((action) => action.id),
    ["complete_game"],
  );
  assert.deepEqual(data.inviteTargets.player, {
    id: "player",
    eyebrow: "Player invite",
    action: "?/issuePlayerInvite",
    panelTestId: "host-player-invite-panel",
    targetTestId: "host-player-invite-target",
    submitTestId: "host-player-invite-submit",
    statusTestId: "host-player-invite-status",
    urlTestId: "host-player-invite-url",
    slotId: "slot-7",
    principalUserId: "player-mira",
    expectedOccupantUserId: "player-mira",
    targetLabel: "Slot 7 / player-mira",
    submitLabel: "Issue player invite",
  });
});

test("host invite targets derive from projected slot occupancy", () => {
  const targets = buildHostInviteTargets({
    replacement: {
      slotId: "slot_12",
      occupantLabel: "player-alex",
    },
    replacementPrincipalUserId: "player-jules",
  });

  assert.equal(targets.player.slotId, "slot_12");
  assert.equal(targets.player.principalUserId, "player-alex");
  assert.equal(targets.player.expectedOccupantUserId, "player-alex");
  assert.equal(targets.player.targetLabel, "Slot 12 / player-alex");
  assert.equal(targets.replacement.slotId, "slot_12");
  assert.equal(targets.replacement.principalUserId, "player-jules");
  assert.equal(targets.replacement.expectedOccupantUserId, "player-alex");
  assert.equal(targets.replacement.targetLabel, "Slot 12 / player-jules");
});

test("host console route data uses host prompt and votecount cold-loads when available", async () => {
  const seen = [];
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalUserId: "host_h",
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === "/games/midsummer/votecount") {
        return jsonResponse([
          {
            VoteCountChanged: {
              candidate_slot: "slot-target",
              count: 1,
              majority: 3,
            },
          },
        ]);
      }
      return jsonResponse([
        {
          prompt_id: "D01:tie:slot_2",
          kind: "tie",
          reason: "host_decides_tie",
          status: "pending",
          phase_id: "D01",
          subject_slot: "slot_2",
        },
      ]);
    },
  });

  assert.deepEqual(seen, [
    "/games/midsummer/host-prompts?principal_user_id=host_h",
    "/games/midsummer/votecount",
  ]);
  assert.deepEqual(data.hostPrompts, [
    {
      id: "D01:tie:slot_2",
      label: "tie",
      value: "host_decides_tie",
      status: "pending",
      phaseId: "D01",
      subjectSlot: "slot_2",
      decisionKind: "acknowledge",
    },
  ]);
  assert.equal(
    data.criticalActions.at(-1).payload.promptId,
    "D01:tie:slot_2",
  );
  assert.deepEqual(
    data.moderatorActionGroups
      .find((group) => group.id === "host-prompts")
      .actions.map((action) => action.payload.promptId),
    ["D01:tie:slot_2"],
  );
  assert.equal(
    data.moderatorActionGroups.find((group) => group.id === "votecount").value,
    "1 projected target",
  );
  assert.deepEqual(
    data.moderatorActionGroups
      .find((group) => group.id === "votecount")
      .actions.map((action) => action.id),
    ["publish_votecount"],
  );
  assert.deepEqual(data.votecount, [
    { target: "slot-target", count: 1, needed: 3 },
  ]);
  assert.equal(data.workQueues.find((queue) => queue.id === "votecount").value, "1 projected target");
});

test("host console route data is allowed for CohostOf scoped to the current game", async () => {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalUserId: "cohost_c",
    capabilities: [{ kind: "CohostOf", game: "midsummer" }],
  });
  const access = resolveHostConsoleAccess({
    game: "midsummer",
    capabilities: [{ kind: "CohostOf", game: "midsummer" }],
  });

  assert.equal(access.allowed, true);
  assert.equal(access.capabilityLabel, "CohostOf(midsummer)");
  assert.equal(data.access.allowed, true);
  assert.equal(data.access.capabilityLabel, "CohostOf(midsummer)");
  assert.deepEqual(
    data.criticalActions.map((action) => action.id),
    ["extend_deadline"],
  );
  assert.deepEqual(
    data.moderatorControls.map((control) => [control.id, control.authority]),
    [["deadline", "CohostOf(game)"]],
  );
  assert.deepEqual(
    data.moderatorActionGroups.map((group) => [group.id, group.authority]),
    [["deadline", "CohostOf(game)"]],
  );
  assert.deepEqual(data.commandContext, {
    gameId: "midsummer",
    principalUserId: "cohost_c",
    capabilityLabel: "CohostOf(midsummer)",
    commandEndpoint: "/commands",
  });
});

test("host console access rejects missing and wrong-game capabilities", () => {
  assert.equal(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [],
    }).allowed,
    false,
  );
  assert.equal(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [{ kind: "HostOf", game: "other-game" }],
    }).allowed,
    false,
  );
  assert.deepEqual(
    resolveHostConsoleAccess({
      game: "midsummer",
      capabilities: [{ kind: "SlotOccupant", game: "midsummer" }],
    }).required,
    ["HostOf(midsummer)", "CohostOf(midsummer)"],
  );
});

test("load returns host shell data when locals carry a resolved host capability", async () => {
  const data = await load({
    params: { game: "midsummer" },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
  });

  assert.equal(data.game.id, "midsummer");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.equal(data.session.principalUserId, "host_h");
  assert.equal(data.commandEndpoint, "/commands");
});

test("load rejects non-host access before the shell renders", async () => {
  await assert.rejects(
    async () =>
      load({
        params: { game: "midsummer" },
        locals: {
          principalUserId: "user_a",
          resolvedCapabilities: [{ kind: "SlotOccupant", game: "midsummer" }],
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === hostConsoleForbiddenMessage("midsummer"),
  );
});

test("load rejects host capability without an authenticated principal", async () => {
  await assert.rejects(
    async () =>
      load({
        params: { game: "midsummer" },
        locals: {
          resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
        },
      }),
    (err) =>
      err.status === 403 &&
      err.body.message === "Host console requires an authenticated host session.",
  );
});

test("host action issues a replacement invite through the authenticated host session", async () => {
  const observed = [];
  const result = await actions.issueReplacementInvite({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "host-session-token" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed.push({
        url,
        method: init.method,
        authorization: init.headers.authorization,
        accept: init.headers.accept,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      });
      if (url === "/games/midsummer/host-console-state?principal_user_id=host_h&slot_id=slot-7") {
        return jsonResponse({
          slots: [{ slot_id: "slot-7", occupant_user_id: "player-mira" }],
        });
      }
      return jsonResponse({
        principal_user_id: "player-rowan",
        invited_by_user_id: "host_h",
        game: "midsummer",
        expires_at: observed.at(-1).body.expires_at,
        global_capabilities: [],
      });
    },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      principalUserId: " player-rowan ",
      slotId: "slot-7",
      expectedOccupantUserId: "player-mira",
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(
    observed[0].url,
    "/games/midsummer/host-console-state?principal_user_id=host_h&slot_id=slot-7",
  );
  assert.equal(observed[0].authorization, "Bearer host-session-token");
  assert.equal(observed[0].accept, "application/json");
  assert.equal(observed[1].url, "/auth/invites");
  assert.equal(observed[1].method, "POST");
  assert.equal(observed[1].authorization, "Bearer host-session-token");
  assert.equal(observed[1].accept, "application/json");
  assert.equal(observed[1].body.principal_user_id, "player-rowan");
  assert.equal(observed[1].body.game, "midsummer");
  assert.equal(observed[1].body.global_capabilities, undefined);
  assert.match(observed[1].body.invite_token, /^replacement-midsummer-/);
  assert.deepEqual(result.replacementInvite, {
    state: "ack",
    message: "Replacement invite issued",
    principalUserId: "player-rowan",
    invitedByUserId: "host_h",
    game: "midsummer",
    returnTo: "/g/midsummer",
    loginUrl: `http://localhost/auth/login?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}`,
    loginPath: `/auth/login?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}`,
    expiresAt: observed[1].body.expires_at,
  });
});

test("host action issues a player invite through the authenticated host session", async () => {
  const observed = [];
  const result = await actions.issuePlayerInvite({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "host-session-token" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed.push({
        url,
        method: init.method,
        authorization: init.headers.authorization,
        accept: init.headers.accept,
        body: init.body === undefined ? undefined : JSON.parse(init.body),
      });
      if (url === "/games/midsummer/host-console-state?principal_user_id=host_h&slot_id=slot-7") {
        return jsonResponse({
          slots: [{ slot_id: "slot-7", occupant_user_id: "player-mira" }],
        });
      }
      return jsonResponse({
        principal_user_id: "player-mira",
        invited_by_user_id: "host_h",
        game: "midsummer",
        expires_at: observed.at(-1).body.expires_at,
        global_capabilities: [],
      });
    },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      principalUserId: " player-mira ",
      slotId: "slot-7",
      expectedOccupantUserId: "player-mira",
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(
    observed[0].url,
    "/games/midsummer/host-console-state?principal_user_id=host_h&slot_id=slot-7",
  );
  assert.equal(observed[0].authorization, "Bearer host-session-token");
  assert.equal(observed[0].accept, "application/json");
  assert.equal(observed[1].url, "/auth/invites");
  assert.equal(observed[1].method, "POST");
  assert.equal(observed[1].authorization, "Bearer host-session-token");
  assert.equal(observed[1].accept, "application/json");
  assert.equal(observed[1].body.principal_user_id, "player-mira");
  assert.equal(observed[1].body.game, "midsummer");
  assert.equal(observed[1].body.global_capabilities, undefined);
  assert.match(observed[1].body.invite_token, /^player-midsummer-/);
  assert.deepEqual(result.playerInvite, {
    state: "ack",
    message: "Player invite issued",
    principalUserId: "player-mira",
    invitedByUserId: "host_h",
    game: "midsummer",
    returnTo: "/g/midsummer",
    loginUrl: `http://localhost/auth/login?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}`,
    loginPath: `/auth/login?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}`,
    expiresAt: observed[1].body.expires_at,
  });
});

test("host action rejects stale player invite targets before issuing an invite", async () => {
  const observed = [];
  const result = await actions.issuePlayerInvite({
    cookies: {
      get(name) {
        return name === "fmarch_session" ? "host-session-token" : undefined;
      },
    },
    fetch: async (url, init) => {
      observed.push({
        url,
        method: init.method,
        authorization: init.headers.authorization,
        accept: init.headers.accept,
      });
      return jsonResponse({
        slots: [{ slot_id: "slot-7", occupant_user_id: "player-rowan" }],
      });
    },
    locals: {
      principalUserId: "host_h",
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      principalUserId: "player-mira",
      slotId: "slot-7",
      expectedOccupantUserId: "player-mira",
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.playerInvite.state, "reject");
  assert.match(result.data.playerInvite.message, /Invite target is stale/);
  assert.equal(result.data.playerInvite.currentOccupantUserId, "player-rowan");
  assert.deepEqual(observed, [
    {
      url: "/games/midsummer/host-console-state?principal_user_id=host_h&slot_id=slot-7",
      method: undefined,
      authorization: "Bearer host-session-token",
      accept: "application/json",
    },
  ]);
});

test("host action rejects replacement invite issuance without a host session", async () => {
  const result = await actions.issueReplacementInvite({
    cookies: { get: () => undefined },
    fetch: unreachableFetch,
    params: { game: "midsummer" },
    request: formRequest({ principalUserId: "player-rowan" }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(result.status, 401);
  assert.equal(result.data.replacementInvite.state, "reject");
});

test("route model does not grant tablet smoke access by itself", () => {
  const capabilities = resolveHostRouteCapabilities({
    game: "00000000-0000-0000-0000-000000000002",
    locals: {},
  });

  assert.deepEqual(capabilities, []);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}

function formRequest(fields) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return new Request("http://localhost/g/midsummer/host", {
    method: "POST",
    body: formData,
  });
}

async function unreachableFetch() {
  throw new Error("fetch must not be called");
}
