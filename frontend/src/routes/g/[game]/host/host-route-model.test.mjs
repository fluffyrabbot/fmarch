import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_PRINCIPAL_IDS } from "../../../../lib/principal-id.mjs";
import { actions, load } from "./+page.server.js";
import {
  HOST_CONSOLE_ROUTE_CONTRACT,
  buildHostInviteTargets,
  buildHostConsoleRouteData,
  buildHostWorkQueues,
  hostConsoleForbiddenMessage,
  resolveHostConsoleAccess,
  resolveHostRouteCapabilities,
} from "./host-route-model.mjs";

const HOST_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.hostH;
const COHOST_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.cohostC;
const PLAYER_MIRA_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.playerMira;
const PLAYER_ROWAN_PRINCIPAL_ID = FIXTURE_PRINCIPAL_IDS.playerRowan;
const PLAYER_ALEX_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000010";
const PLAYER_JULES_PRINCIPAL_ID = "00000000-0000-5000-8000-000000000011";

test("host console route data is allowed for HostOf scoped to the current game", async () => {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
    nowSeconds: 1781806740,
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
    summary: "Day 1 deadline is active. Slot 7 / player-mira has a pending replacement.",
    capability: {
      visible: true,
      label: "Hosting midsummer",
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
    requiredText: "Live official tally",
  });
  assert.equal(data.shell.activeSurface, "moderator");
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.equal(
    data.projectionBoundary.status,
    "cbor-ws-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(
    data.projectionBoundary.resyncPolicy,
    "single-flight-latest-trailing-refresh",
  );
  assert.equal(
    data.votecountBoundary.status,
    "cbor-ws-projection-deltas-with-resync-and-reconnect",
  );
  assert.equal(data.votecountBoundary.command, "official-votecount-live-ws");
  assert.equal(
    data.hostVotecountEndpoint,
    "/api/gameplay/games/midsummer/votecount",
  );
  assert.equal(
    data.dayVoteOutcomesEndpoint,
    "/api/gameplay/games/midsummer/day-vote-outcomes",
  );
  assert.deepEqual(data.commandContext, {
    gameId: "midsummer",
    principalId: HOST_PRINCIPAL_ID,
    capabilityLabel: "HostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.equal(
    data.liveProjection.endpoint,
    "/live/tickets?game=midsummer&slot_id=slot-7",
  );
  assert.deepEqual(data.votecount, [
    { target: "slot-2 / Ilya", count: 4, needed: 7 },
    { target: "slot-7 / Mira", count: 2, needed: 7 },
  ]);
  assert.deepEqual(data.dayVoteOutcomes, [
    {
      game: null,
      phaseId: "D01",
      sourceSeq: 41,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-2",
      tallies: { "slot-2": 4, "slot-7": 2 },
      majority: 4,
      reason: null,
    },
  ]);
  assert.deepEqual(
    data.criticalActions.map((action) => action.payload.gameId),
    Array(11).fill("midsummer"),
  );
  assert.deepEqual(
    data.criticalActions.map((action) => action.id),
    [
      "extend_deadline",
      "extend_deadline_24h",
      "extend_deadline_48h",
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
      .find((group) => group.id === "deadline")
      .actions.map((action) => action.id),
    ["extend_deadline", "extend_deadline_24h", "extend_deadline_48h"],
  );
  const extend24 = data.criticalActions.find(
    (action) => action.id === "extend_deadline_24h",
  );
  const extend48 = data.criticalActions.find(
    (action) => action.id === "extend_deadline_48h",
  );
  assert.equal(extend24.requiresConfirmation, true);
  assert.equal(extend24.irreversible, undefined);
  assert.equal(extend24.payload.kind, "extend_deadline");
  assert.equal(extend24.payload.phaseId, "D01");
  assert.equal(extend24.payload.extendsTo, "2026-06-20T04:00:00.000Z");
  assert.equal(extend48.payload.extendsTo, "2026-06-21T04:00:00.000Z");
  assert.equal(
    extend24.confirmationText,
    "Extend Day 1 deadline by 24 hours: move the deadline 24 hours later to June 19, 2026 at 9:00 PM PT for Day 1 deadline.",
  );
  assert.equal(
    extend48.confirmationText,
    "Extend Day 1 deadline by 48 hours: move the deadline 48 hours later to June 20, 2026 at 9:00 PM PT for Day 1 deadline.",
  );
  assert.equal(data.deadlineClock.nowSeconds, 1781806740);
  assert.equal(data.phase.deadline, 1781841600);
  assert.equal(
    data.workQueues.find((queue) => queue.id === "deadline").value,
    "Closes in 9h 41m",
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
    accountTestId: "host-player-invite-account",
    available: true,
    slotId: "slot-7",
    principalId: PLAYER_MIRA_PRINCIPAL_ID,
    expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    targetLabel: "Slot 7 / player-mira",
    submitLabel: "Issue player invite",
  });
  assert.equal(
    data.hostLifecycleControlCheckpoint.root.testId,
    "host-lifecycle-control-checkpoint",
  );
  assert.equal(
    data.hostLifecycleControlCheckpoint.root.data.proofCheckId,
    "host-lifecycle-control",
  );
  assert.equal(
    data.hostLifecycleControlCheckpoint.root.data.actionState,
    "enabled:mark_dead,modkill_slot",
  );
  assert.equal(
    data.hostLifecycleControlCheckpoint.root.data.deadlineAffordance,
    "resolve_phase,lock_thread",
  );
  assert.equal(data.hostLifecycleControlCheckpoint.status.state, "ack");
});

test("host invite targets derive from projected slot occupancy", () => {
  const targets = buildHostInviteTargets({
    replacement: {
      slotId: "slot_12",
      occupantLabel: "player-alex",
      assignedPrincipalId: PLAYER_ALEX_PRINCIPAL_ID,
    },
    replacementPrincipalId: PLAYER_JULES_PRINCIPAL_ID,
    replacementLabel: "player-jules",
  });

  assert.equal(targets.player.slotId, "slot_12");
  assert.equal(targets.player.available, true);
  assert.equal(targets.player.principalId, PLAYER_ALEX_PRINCIPAL_ID);
  assert.equal(targets.player.expectedOccupantPrincipalId, PLAYER_ALEX_PRINCIPAL_ID);
  assert.equal(targets.player.targetLabel, "Slot 12 / player-alex");
  assert.equal(targets.replacement.slotId, "slot_12");
  assert.equal(targets.replacement.available, true);
  assert.equal(targets.replacement.principalId, PLAYER_JULES_PRINCIPAL_ID);
  assert.equal(targets.replacement.expectedOccupantPrincipalId, PLAYER_ALEX_PRINCIPAL_ID);
  assert.equal(targets.replacement.targetLabel, "Slot 12 / player-jules");
});

test("host invite targets fail closed when a live replacement omits principal authority", () => {
  const targets = buildHostInviteTargets({
    replacement: {
      slotId: "slot_12",
      occupantLabel: "player-alex",
    },
  });

  assert.equal(targets.player.available, false);
  assert.equal(targets.player.principalId, "");
  assert.equal(targets.player.expectedOccupantPrincipalId, "");
  assert.equal(targets.replacement.available, false);
  assert.equal(targets.replacement.expectedOccupantPrincipalId, "");
});

test("host console route data uses host prompt and votecount cold-loads when available", async () => {
  const seen = [];
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalId: HOST_PRINCIPAL_ID,
    capabilities: [{ kind: "HostOf", game: "midsummer" }],
    fetchImpl: async (url) => {
      seen.push(url);
      if (url === "/api/gameplay/games/midsummer/votecount") {
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
      if (url === "/api/gameplay/games/midsummer/day-vote-outcomes") {
        return jsonResponse([
          {
            DayVoteOutcomeApplied: {
              phase_id: "D01",
              source_seq: 14,
              event_index: 0,
              status: "Lynch",
              winner_slot: "slot-target",
              tallies: { "slot-target": 1 },
            },
          },
        ]);
      }
      if (
        url ===
        "/api/gameplay/games/midsummer/host-console-state?slot_id=slot-7"
      ) {
        return jsonResponse({
          game: "midsummer",
          authority: {
            principal_id: HOST_PRINCIPAL_ID,
            capability: "HostOf",
            allowed_classes: ["phase_resolve", "deadline"],
            denied_classes: [],
          },
          completed: false,
          phase: null,
          slots: [],
          thread_posts: [],
          day_event_scheduler: {
            pending: true,
            auto_resolve_pending: true,
            narrative_pending: true,
            next_due_at: 1781928100,
            wake_seq: 52,
            last_observed_wake_seq: 51,
            lease_until: null,
            retry_not_before: null,
            last_attempt_at: null,
            last_success_at: null,
            last_failure_at: null,
            consecutive_failures: 0,
            total_attempts: 0,
            total_successes: 0,
            last_error: null,
          },
          day_events: [{
            event_id: "event-cookie",
            state: "resolved",
            phase_id: "D01",
            participant_slots: ["slot_1", "slot_2"],
            open_due_at: 1781928000,
            open_observed_at: 1781928001,
            lock_due_at: 1781928060,
            lock_observed_at: 1781928062,
            auto_seed: 73,
            resolution_evidence: {
              kind: "auto",
              policy: { kind: "seeded_random", winners: 1 },
              seed: 73,
              participant_slots: ["slot_2", "slot_1"],
            },
            winner_slots: ["slot_2"],
            reward_keys_applied: ["cookie"],
            narratives: [{
              lifecycle: "resolved",
              template_key: "theme.bakery.resolved",
              template_hash: "a".repeat(64),
              channel_id: "main",
              status: "published",
              body: "event-cookie resolved for slot_2.",
              source_seq: 51,
              published_seq: 53,
            }],
            definition: {
              id: "event-cookie",
              template_key: "theme.raffle",
              participation: {
                who: "alive_slots",
                mode: "opt_in",
                limits: { minimum: 1, maximum: null },
              },
              rewards: [{
                reward_key: "cookie",
                display_name_theme_key: "theme.cookie",
                effects: [{ recipient: "winner" }],
              }],
            },
          }],
          tasks: [
            {
              id: "engine-host-prompt:D01:tie:slot_2",
              kind: "engine_host_prompt",
              state: "ready",
              urgency: "attention",
              intent: "host_decides_tie",
              consequence: "resolve pack-defined tie policy",
              phase_id: "D01",
              subject_slot: "slot_2",
              source_id: "D01:tie:slot_2",
              allowed_commands: [
                {
                  kind: "resolve_host_prompt",
                  permission_class: "host_prompt_resolve",
                },
              ],
              blocked_reason: null,
            },
          ],
        });
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
    "/api/gameplay/games/midsummer/host-prompts",
    "/api/gameplay/games/midsummer/votecount",
    "/api/gameplay/games/midsummer/day-vote-outcomes",
    "/api/gameplay/games/midsummer/host-console-state?slot_id=slot-7",
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
      metadata: {},
    },
  ]);
  assert.deepEqual(data.hostTasks, [
    {
      id: "engine-host-prompt:D01:tie:slot_2",
      kind: "engine_host_prompt",
      state: "ready",
      urgency: "attention",
      intent: "host_decides_tie",
      consequence: "resolve pack-defined tie policy",
      phaseId: "D01",
      subjectSlot: "slot_2",
      sourceId: "D01:tie:slot_2",
      allowedCommands: [
        {
          kind: "resolve_host_prompt",
          permissionClass: "host_prompt_resolve",
        },
      ],
      blockedReason: null,
    },
  ]);
  assert.deepEqual(data.hostDayEvents, [{
    eventId: "event-cookie",
    state: "resolved",
    phaseId: "D01",
    templateKey: "theme.raffle",
    scheduleEvidence: {
      openDueAt: 1781928000,
      openObservedAt: 1781928001,
      lockDueAt: 1781928060,
      lockObservedAt: 1781928062,
    },
    autoSeed: 73,
    resolutionEvidence: {
      kind: "auto",
      policyKind: "seeded_random",
      winnerCount: 1,
      seed: 73,
      participantSlots: ["slot_1", "slot_2"],
    },
    winnerSlots: ["slot_2"],
    rewardKeysApplied: ["cookie"],
    narratives: [{
      lifecycle: "resolved",
      templateKey: "theme.bakery.resolved",
      templateHash: "a".repeat(64),
      channelId: "main",
      status: "published",
      body: "event-cookie resolved for slot_2.",
      sourceSeq: 51,
      publishedSeq: 53,
    }],
    participation: {
      who: "alive_slots",
      mode: "opt_in",
      minimum: 1,
      maximum: null,
    },
    participantSlots: ["slot_1", "slot_2"],
    room: null,
    rewards: [{
      key: "cookie",
      labelKey: "theme.cookie",
      effectCount: 1,
    }],
  }]);
  assert.equal(data.dayEventScheduler.pending, true);
  assert.equal(data.dayEventScheduler.autoResolvePending, true);
  assert.equal(data.dayEventScheduler.narrativePending, true);
  assert.equal(data.dayEventScheduler.wakeSeq, 52);
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
  assert.deepEqual(data.dayVoteOutcomes, [
    {
      game: null,
      phaseId: "D01",
      sourceSeq: 14,
      eventIndex: 0,
      status: "Lynch",
      winnerSlot: "slot-target",
      tallies: { "slot-target": 1 },
      majority: null,
      reason: null,
    },
  ]);
  assert.equal(data.workQueues.find((queue) => queue.id === "votecount").value, "1 projected target");
});

test("host console route data is allowed for CohostOf scoped to the current game", async () => {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    principalId: COHOST_PRINCIPAL_ID,
    capabilities: [{ kind: "CohostOf", game: "midsummer" }],
    fetchImpl: async (url) =>
      url.endsWith("/host-console-state?slot_id=slot-7")
        ? jsonResponse({
            game: "midsummer",
            authority: {
              principal_id: COHOST_PRINCIPAL_ID,
              capability: "CohostOf",
              allowed_classes: [
                "deadline",
                "replacement",
                "host_prompt_resolve",
              ],
              denied_classes: ["phase_resolve", "lifecycle"],
            },
            completed: false,
            phase: null,
            slots: [],
            thread_posts: [],
          })
        : jsonResponse(null),
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
    [
      "process_replacement",
      "resolve_host_prompt-D01-skip_next_day-slot_1",
    ],
  );
  assert.deepEqual(data.authority, {
    principalId: COHOST_PRINCIPAL_ID,
    capabilityKind: "CohostOf",
    allowedClasses: ["deadline", "host_prompt_resolve", "replacement"],
    deniedClasses: ["lifecycle", "phase_resolve"],
  });
  assert.deepEqual(
    data.moderatorControls.map((control) => [control.id, control.authority]),
    [
      ["host-prompts", "CohostOf(game) · host_prompt_resolve"],
    ],
  );
  assert.deepEqual(
    data.moderatorActionGroups.map((group) => [group.id, group.authority]),
    [
      ["replacement", "CohostOf(game) · replacement"],
      ["host-prompts", "CohostOf(game) · host_prompt_resolve"],
    ],
  );
  assert.deepEqual(data.commandContext, {
    gameId: "midsummer",
    principalId: COHOST_PRINCIPAL_ID,
    capabilityLabel: "CohostOf(midsummer)",
    commandEndpoint: "/commands",
  });
  assert.equal(
    data.hostLifecycleControlCheckpoint.root.data.actionState,
    "disabled:requires HostOf capability",
  );
  assert.equal(data.hostLifecycleControlCheckpoint.status.state, "pending");
});

test("host work queue deadline countdown recomputes from the projected phase", () => {
  const fixtureQueues = buildHostWorkQueues({
    phase: { deadline: 1781841600 },
    votecountCount: 2,
    nowSeconds: 1781806740,
  });
  assert.deepEqual(fixtureQueues.map((queue) => [queue.id, queue.value]), [
    ["deadline", "Closes in 9h 41m"],
    ["votecount", "2 projected targets"],
      ["replacement", "No replacement pending"],
  ]);

  const extendedQueues = buildHostWorkQueues({
    phase: { deadline: 1781841600 + 86400 },
    votecountCount: 1,
    nowSeconds: 1781806740,
  });
  assert.equal(
    extendedQueues.find((queue) => queue.id === "deadline").value,
    "Closes in 33h 41m",
  );
  assert.equal(
    extendedQueues.find((queue) => queue.id === "votecount").value,
    "1 projected target",
  );

  const noDeadlineQueues = buildHostWorkQueues({
    phase: { deadline: null },
    votecountCount: 0,
    nowSeconds: 1781806740,
  });
  assert.equal(
    noDeadlineQueues.find((queue) => queue.id === "deadline").value,
    "No deadline committed",
  );
  assert.equal(
    noDeadlineQueues.find((queue) => queue.id === "votecount").value,
    "No active ballots",
  );
});

test("host console access accepts API-shaped game capabilities", () => {
  const access = resolveHostConsoleAccess({
    game: "midsummer",
    capabilities: [
      {
        kind: "HostOf",
        body: { game: "midsummer" },
        source: "auth-session",
      },
    ],
  });

  assert.equal(access.allowed, true);
  assert.equal(access.capabilityLabel, "HostOf(midsummer)");
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
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
  });

  assert.equal(data.game.id, "midsummer");
  assert.equal(data.shellOwner, "layout");
  assert.equal(data.access.capabilityLabel, "HostOf(midsummer)");
  assert.equal(data.session.principalId, HOST_PRINCIPAL_ID);
  assert.equal(data.commandEndpoint, "/commands");
});

test("load rejects non-host access before the shell renders", async () => {
  await assert.rejects(
    async () =>
      load({
        params: { game: "midsummer" },
        locals: {
          principalId: PLAYER_MIRA_PRINCIPAL_ID,
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
      if (url === "/games/midsummer/host-console-state?slot_id=slot-7") {
        return jsonResponse({
          slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_MIRA_PRINCIPAL_ID }],
        });
      }
      return jsonResponse({
        account_id: "rowan@example.test",
        principal_id: PLAYER_ROWAN_PRINCIPAL_ID,
        invited_by_principal_id: HOST_PRINCIPAL_ID,
        game: "midsummer",
        expires_at: observed.at(-1).body.expires_at,
        global_capabilities: [],
      });
    },
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      accountId: "rowan@example.test",
      principalId: PLAYER_ROWAN_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(
    observed[0].url,
    "/games/midsummer/host-console-state?slot_id=slot-7",
  );
  assert.equal(observed[0].authorization, "Bearer host-session-token");
  assert.equal(observed[0].accept, "application/json");
  assert.equal(observed[1].url, "/auth/game-invitations");
  assert.equal(observed[1].method, "POST");
  assert.equal(observed[1].authorization, "Bearer host-session-token");
  assert.equal(observed[1].accept, "application/json");
  assert.equal(observed[1].body.account_id, "rowan@example.test");
  assert.equal(observed[1].body.expected_principal_id, PLAYER_ROWAN_PRINCIPAL_ID);
  assert.equal(observed[1].body.game, "midsummer");
  assert.equal(observed[1].body.global_capabilities, undefined);
  assert.match(observed[1].body.invite_token, /^replacement-midsummer-/);
  assert.deepEqual(result.replacementInvite, {
    state: "ack",
    message: "Replacement invite issued",
    accountId: "rowan@example.test",
    principalId: PLAYER_ROWAN_PRINCIPAL_ID,
    invitedByPrincipalId: HOST_PRINCIPAL_ID,
    game: "midsummer",
    returnTo: "/g/midsummer",
    loginUrl: `http://localhost/auth/game-invite?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}&account=rowan%40example.test`,
    loginPath: `/auth/game-invite?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}&account=rowan%40example.test`,
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
      if (url === "/games/midsummer/host-console-state?slot_id=slot-7") {
        return jsonResponse({
          slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_MIRA_PRINCIPAL_ID }],
        });
      }
      return jsonResponse({
        account_id: "mira@example.test",
        principal_id: PLAYER_MIRA_PRINCIPAL_ID,
        invited_by_principal_id: HOST_PRINCIPAL_ID,
        game: "midsummer",
        expires_at: observed.at(-1).body.expires_at,
        global_capabilities: [],
      });
    },
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(
    observed[0].url,
    "/games/midsummer/host-console-state?slot_id=slot-7",
  );
  assert.equal(observed[0].authorization, "Bearer host-session-token");
  assert.equal(observed[0].accept, "application/json");
  assert.equal(observed[1].url, "/auth/game-invitations");
  assert.equal(observed[1].method, "POST");
  assert.equal(observed[1].authorization, "Bearer host-session-token");
  assert.equal(observed[1].accept, "application/json");
  assert.equal(observed[1].body.account_id, "mira@example.test");
  assert.equal(observed[1].body.expected_principal_id, PLAYER_MIRA_PRINCIPAL_ID);
  assert.equal(observed[1].body.game, "midsummer");
  assert.equal(observed[1].body.global_capabilities, undefined);
  assert.match(observed[1].body.invite_token, /^player-midsummer-/);
  assert.deepEqual(result.playerInvite, {
    state: "ack",
    message: "Player invite issued",
    accountId: "mira@example.test",
    principalId: PLAYER_MIRA_PRINCIPAL_ID,
    invitedByPrincipalId: HOST_PRINCIPAL_ID,
    game: "midsummer",
    returnTo: "/g/midsummer",
    loginUrl: `http://localhost/auth/game-invite?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}&account=mira%40example.test`,
    loginPath: `/auth/game-invite?returnTo=%2Fg%2Fmidsummer&invite=${observed[1].body.invite_token}&account=mira%40example.test`,
    expiresAt: observed[1].body.expires_at,
  });
});

test("WorkOS host invite returns an account-addressed sign-in link through the verified session", async () => {
  const workosEnv = {
    WORKOS_CLIENT_ID: "client_test",
    WORKOS_API_KEY: "sk_test",
    WORKOS_REDIRECT_URI: "https://fmarch.example.test/auth/callback",
    WORKOS_COOKIE_PASSWORD: "0123456789abcdef0123456789abcdef",
  };
  const previous = {};
  for (const [name, value] of Object.entries(workosEnv)) {
    previous[name] = process.env[name];
    process.env[name] = value;
  }
  const observed = [];
  try {
    const result = await actions.issuePlayerInvite({
      cookies: {
        get: (name) => (name === "fmarch_session" ? "fmss_host-session" : undefined),
      },
      fetch: async (url, init) => {
        observed.push({ url, authorization: init.headers.authorization });
        return jsonResponse({
          slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_MIRA_PRINCIPAL_ID }],
        });
      },
      locals: {
        principalId: HOST_PRINCIPAL_ID,
        resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
      },
      params: { game: "midsummer" },
      request: formRequest({
        accountId: "mira@example.test",
        principalId: PLAYER_MIRA_PRINCIPAL_ID,
        slotId: "slot-7",
        expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
      }),
      url: new URL("https://fmarch.example.test/g/midsummer/host"),
    });

    assert.deepEqual(observed, [{
      url: "/games/midsummer/host-console-state?slot_id=slot-7",
      authorization: "Bearer fmss_host-session",
    }]);
    assert.equal(result.playerInvite.identityProvider, "workos");
    assert.equal(
      result.playerInvite.loginPath,
      "/auth/login/workos?returnTo=%2Fg%2Fmidsummer&loginHint=mira%40example.test",
    );
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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
        slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_ROWAN_PRINCIPAL_ID }],
      });
    },
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(result.status, 409);
  assert.equal(result.data.playerInvite.state, "reject");
  assert.match(result.data.playerInvite.message, /Invite target is stale/);
  assert.equal(result.data.playerInvite.currentOccupantPrincipalId, PLAYER_ROWAN_PRINCIPAL_ID);
  assert.deepEqual(observed, [
    {
      url: "/games/midsummer/host-console-state?slot_id=slot-7",
      method: undefined,
      authorization: "Bearer host-session-token",
      accept: "application/json",
    },
  ]);
});

test("host action retries stale player invites against the current occupant", async () => {
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
      if (url === "/games/midsummer/host-console-state?slot_id=slot-7") {
        return jsonResponse({
        slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_ROWAN_PRINCIPAL_ID }],
        });
      }
      return jsonResponse({
        account_id: "rowan@example.test",
        principal_id: PLAYER_ROWAN_PRINCIPAL_ID,
        invited_by_principal_id: HOST_PRINCIPAL_ID,
        game: "midsummer",
        expires_at: observed.at(-1).body.expires_at,
        global_capabilities: [],
      });
    },
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    request: formRequest({
      accountId: "rowan@example.test",
      principalId: PLAYER_ROWAN_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_ROWAN_PRINCIPAL_ID,
    }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(observed[1].url, "/auth/game-invitations");
  assert.equal(observed[1].body.account_id, "rowan@example.test");
  assert.equal(observed[1].body.expected_principal_id, PLAYER_ROWAN_PRINCIPAL_ID);
  assert.match(observed[1].body.invite_token, /^player-midsummer-/);
  assert.equal(result.playerInvite.state, "ack");
  assert.equal(result.playerInvite.principalId, PLAYER_ROWAN_PRINCIPAL_ID);
});

test("host action rejects replacement invite issuance without a host session", async () => {
  const result = await actions.issueReplacementInvite({
    cookies: { get: () => undefined },
    fetch: unreachableFetch,
    params: { game: "midsummer" },
    request: formRequest({ principalId: PLAYER_ROWAN_PRINCIPAL_ID }),
    url: new URL("http://localhost/g/midsummer/host"),
  });

  assert.equal(result.status, 401);
  assert.equal(result.data.replacementInvite.state, "reject");
});

test("host invites reject missing or text-shaped principal authority before any API call", async () => {
  const common = {
    cookies: { get: (name) => (name === "fmarch_session" ? "host-session-token" : undefined) },
    fetch: unreachableFetch,
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    url: new URL("http://localhost/g/midsummer/host"),
  };

  const missingPrincipal = await actions.issuePlayerInvite({
    ...common,
    request: formRequest({
      accountId: "mira@example.test",
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
  });
  assert.equal(missingPrincipal.status, 400);
  assert.match(missingPrincipal.data.playerInvite.message, /canonical UUID/);

  const textExpectedOccupant = await actions.issuePlayerInvite({
    ...common,
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: "player-mira",
    }),
  });
  assert.equal(textExpectedOccupant.status, 400);
  assert.match(textExpectedOccupant.data.playerInvite.message, /Expected occupant principal/);

  const missingSlot = await actions.issuePlayerInvite({
    ...common,
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
  });
  assert.equal(missingSlot.status, 400);
  assert.match(missingSlot.data.playerInvite.message, /Invite slot is required/);
});

test("host invites refuse malformed projection or mismatched invite response authority", async () => {
  const common = {
    cookies: { get: (name) => (name === "fmarch_session" ? "host-session-token" : undefined) },
    locals: {
      principalId: HOST_PRINCIPAL_ID,
      resolvedCapabilities: [{ kind: "HostOf", game: "midsummer" }],
    },
    params: { game: "midsummer" },
    url: new URL("http://localhost/g/midsummer/host"),
  };

  const malformedProjection = await actions.issuePlayerInvite({
    ...common,
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
    fetch: async () =>
      jsonResponse({
        slots: [{ slot_id: "slot-7", assigned_principal_id: "player-mira" }],
      }),
  });
  assert.equal(malformedProjection.status, 502);
  assert.match(malformedProjection.data.playerInvite.message, /projection is unavailable/);

  const observed = [];
  const mismatchedInvite = await actions.issuePlayerInvite({
    ...common,
    request: formRequest({
      accountId: "mira@example.test",
      principalId: PLAYER_MIRA_PRINCIPAL_ID,
      slotId: "slot-7",
      expectedOccupantPrincipalId: PLAYER_MIRA_PRINCIPAL_ID,
    }),
    fetch: async (url, init) => {
      observed.push(String(url));
      if (String(url).includes("host-console-state")) {
        return jsonResponse({
          slots: [{ slot_id: "slot-7", assigned_principal_id: PLAYER_MIRA_PRINCIPAL_ID }],
        });
      }
      return jsonResponse({
        account_id: "mira@example.test",
        principal_id: PLAYER_ROWAN_PRINCIPAL_ID,
        invited_by_principal_id: HOST_PRINCIPAL_ID,
        game: "midsummer",
      });
    },
  });
  assert.equal(mismatchedInvite.status, 502);
  assert.match(mismatchedInvite.data.playerInvite.message, /mismatched principal authority/);
  assert.deepEqual(observed, [
    "/games/midsummer/host-console-state?slot_id=slot-7",
    "/auth/game-invitations",
  ]);
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

test("host live projection endpoint uses the same-origin authenticated ticket broker", async () => {
  const data = await buildHostConsoleRouteData({
    game: "midsummer",
    capabilities: [{ kind: "HostOf", game: "midsummer", source: "fixture" }],
    principalId: HOST_PRINCIPAL_ID,
    fetchImpl: null,
    apiBaseUrl: "http://fmarch.railway.internal:8080",
  });
  assert.equal(
    data.liveProjection.endpoint,
    "/live/tickets?game=midsummer&slot_id=slot-7",
  );
});
