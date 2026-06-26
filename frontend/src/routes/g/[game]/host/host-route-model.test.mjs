import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "./+page.server.js";
import {
  HOST_CONSOLE_ROUTE_CONTRACT,
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
    ["phase", "host-prompts", "slot-lifecycle", "roles"],
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

test("host console route data is allowed for CohostOf scoped to the current game", () => {
  const access = resolveHostConsoleAccess({
    game: "midsummer",
    capabilities: [{ kind: "CohostOf", game: "midsummer" }],
  });

  assert.equal(access.allowed, true);
  assert.equal(access.capabilityLabel, "CohostOf(midsummer)");
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
    async json() {
      return body;
    },
  };
}
