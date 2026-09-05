import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_PRINCIPAL_IDS } from "../principal-id.mjs";
import {
  validateEndgameSummaryResponse,
  validateDayVoteOutcomesResponse,
  validateGameplayObjectRowArray,
  validateGameplayThreadPageResponse,
  validateHostConsoleAuthorityExpectation,
  validateHostConsoleLiveDelta,
  validateHostConsoleStateResponse,
  validatePlayerCommandStateResponse,
  validatePlayerInvestigationResultRow,
  validatePlayerInvestigationResultsResponse,
  validatePlayerNotificationRow,
  validatePlayerNotificationsResponse,
  validatePlayerPrivateLiveDelta,
  validateVotecountResponse,
} from "./gameplay-response-schema.mjs";

test("aggregate DTO schemas reject partial, cross-game, and cross-channel rows", () => {
  assert.equal(validateGameplayObjectRowArray([]), true);
  assert.equal(validateGameplayObjectRowArray([{}]), true);
  assert.equal(validateGameplayObjectRowArray([null]), false);
  assert.equal(validateGameplayThreadPageResponse(threadPage(), { game: "midsummer" }), true);
  assert.equal(
    validateGameplayThreadPageResponse(
      { ...threadPage(), posts: [{ ...threadPost(), game: "other-game" }] },
      { game: "midsummer" },
    ),
    false,
  );
  assert.equal(
    validateGameplayThreadPageResponse(
      { ...threadPage(), posts: [{ ...threadPost(), channel_id: "backroom" }] },
      { game: "midsummer", channel: "main" },
    ),
    false,
  );
  assert.equal(
    validateGameplayThreadPageResponse({ posts: [{}], next_before_seq: null }, { game: "midsummer" }),
    false,
  );
  assert.equal(validateGameplayThreadPageResponse({}), false);
  assert.equal(validateEndgameSummaryResponse(null), true);
  assert.equal(
    validateEndgameSummaryResponse(endgameSummary(), { game: "midsummer" }),
    true,
  );
  assert.equal(validateEndgameSummaryResponse({ completed: false }, { game: "midsummer" }), false);
  assert.equal(validateVotecountResponse([votecountDelta()], { game: "midsummer" }), true);
  assert.equal(
    validateVotecountResponse(
      [{ ...votecountDelta(), body: { ...votecountDelta().body, game: "other-game" } }],
      { game: "midsummer" },
    ),
    false,
  );
  assert.equal(validateDayVoteOutcomesResponse([dayVoteOutcomeDelta()], { game: "midsummer" }), true);
  assert.equal(validateDayVoteOutcomesResponse([{ kind: "DayVoteOutcomeApplied", body: {} }], { game: "midsummer" }), false);
});

test("player command-state schema binds the response to game and actor slot", () => {
  const response = playerCommandState();
  const expected = { game: "midsummer", actorSlot: "slot-4" };

  assert.equal(validatePlayerCommandStateResponse(response, expected), true);
  assert.equal(
    validatePlayerCommandStateResponse(
      { ...response, game: "other-game" },
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerCommandStateResponse(
      { ...response, actor_slot: "slot-9" },
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerCommandStateResponse(
      { ...response, actions: [{}] },
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerCommandStateResponse(
      { ...response, day_event_rooms: [{}] },
      expected,
    ),
    false,
  );
});

test("private notification rows require the canonical shape and exact audience", () => {
  const expected = { game: "midsummer", actorSlot: "slot-4" };
  const row = playerNotification();

  assert.equal(validatePlayerNotificationRow(row, expected), true);
  assert.equal(validatePlayerNotificationsResponse([row], expected), true);
  assert.equal(validatePlayerNotificationsResponse([], {}), false);
  assert.equal(
    validatePlayerNotificationsResponse(
      [{ ...row, game: "other-game" }],
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerNotificationsResponse(
      [{ ...row, audience_slot: "slot-9" }],
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerNotificationRow(
      { ...row, event_index: "1" },
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerNotificationRow({ ...row, status: "" }, expected),
    false,
  );
});

test("private investigation rows enforce the canonical result union", () => {
  const expected = { game: "midsummer", actorSlot: "slot-4" };
  const row = playerInvestigationResult();

  assert.equal(validatePlayerInvestigationResultRow(row, expected), true);
  assert.equal(validatePlayerInvestigationResultsResponse([], {}), false);
  assert.equal(
    validatePlayerInvestigationResultsResponse(
      [
        row,
        {
          ...row,
          event_index: 2,
          result: {
            vanilla: true,
            visited: ["slot-2"],
            alignment: "town",
          },
        },
      ],
      expected,
    ),
    true,
  );
  for (const invalid of [
    { ...row, audience_slot: "slot-9" },
    { ...row, game: "other-game" },
    { ...row, target_slot: null },
    { ...row, result: "" },
    { ...row, result: { visited: [null] } },
    { ...row, result: { invented: true } },
  ]) {
    assert.equal(
      validatePlayerInvestigationResultRow(invalid, expected),
      false,
    );
  }
});

test("private live deltas bind both their envelope and rows", () => {
  const expected = { game: "midsummer", actorSlot: "slot-4" };
  const notification = playerNotification();
  const investigation = playerInvestigationResult();
  const notificationsDelta = {
    kind: "PlayerNotificationsChanged",
    body: { game: "midsummer", notifications: [notification] },
  };
  const investigationsDelta = {
    kind: "PlayerInvestigationResultsChanged",
    body: { game: "midsummer", results: [investigation] },
  };

  assert.equal(validatePlayerPrivateLiveDelta(notificationsDelta, expected), true);
  assert.equal(validatePlayerPrivateLiveDelta(investigationsDelta, expected), true);
  assert.equal(
    validatePlayerPrivateLiveDelta(
      {
        kind: "PlayerNotificationsChanged",
        body: { notifications: [] },
      },
      {},
    ),
    false,
  );
  assert.equal(
    validatePlayerPrivateLiveDelta(
      {
        ...notificationsDelta,
        body: { ...notificationsDelta.body, game: "other-game" },
      },
      expected,
    ),
    false,
  );
  assert.equal(
    validatePlayerPrivateLiveDelta(
      {
        ...investigationsDelta,
        body: {
          ...investigationsDelta.body,
          results: [{ ...investigation, audience_slot: "slot-9" }],
        },
      },
      expected,
    ),
    false,
  );
});

test("host console schema binds complete authority while preserving null state", () => {
  const expected = {
    game: "midsummer",
    expectedPrincipalId: FIXTURE_PRINCIPAL_IDS.hostH,
    expectedCapabilityKind: "HostOf",
  };
  const response = hostConsoleState();

  assert.equal(validateHostConsoleStateResponse(response, expected), true);
  assert.equal(response.phase, null);
  assert.equal(response.day_event_scheduler, null);
  assert.equal(
    validateHostConsoleStateResponse({ ...response, game: "other-game" }, expected),
    false,
  );
  assert.equal(
    validateHostConsoleStateResponse(
      {
        ...response,
        authority: {
          ...response.authority,
          principal_id: FIXTURE_PRINCIPAL_IDS.cohostC,
        },
      },
      expected,
    ),
    false,
  );
  assert.equal(
    validateHostConsoleStateResponse(
      { ...response, slots: [{ slot_id: "slot-7" }] },
      expected,
    ),
    false,
  );
});

test("DayEvent audit seeds remain exact decimal strings above the JS safe-integer limit", () => {
  const expected = hostExpectation();
  const seed = "9007199254740993";
  const response = {
    ...hostConsoleState(),
    day_events: [hostDayEvent(seed)],
  };

  assert.equal(validateHostConsoleStateResponse(response, expected), true);
  assert.equal(
    validateHostConsoleLiveDelta(
      {
        kind: "HostConsoleDayEventsChanged",
        body: {
          game: "midsummer",
          day_events: [hostDayEvent(seed)],
          removed_event_ids: [],
        },
      },
      expected,
    ),
    true,
  );
  for (const invalidEvent of [
    hostDayEvent(9_007_199_254_740_993),
    hostDayEvent("09007199254740993"),
    hostDayEvent("18446744073709551616"),
    {
      ...hostDayEvent(seed),
      resolution_evidence: {
        ...hostDayEvent(seed).resolution_evidence,
        seed: "9007199254740994",
      },
    },
  ]) {
    assert.equal(
      validateHostConsoleStateResponse(
        { ...hostConsoleState(), day_events: [invalidEvent] },
        expected,
      ),
      false,
    );
  }
});

test("host expectation excludes missing, text-shaped, and operator authority", () => {
  assert.equal(
    validateHostConsoleAuthorityExpectation({
      expectedPrincipalId: FIXTURE_PRINCIPAL_IDS.hostH,
      expectedCapabilityKind: "HostOf",
    }),
    true,
  );
  assert.equal(
    validateHostConsoleAuthorityExpectation({
      expectedPrincipalId: "host_h",
      expectedCapabilityKind: "HostOf",
    }),
    false,
  );
  assert.equal(
    validateHostConsoleAuthorityExpectation({
      expectedPrincipalId: FIXTURE_PRINCIPAL_IDS.hostH,
      expectedCapabilityKind: "GlobalOperator",
    }),
    false,
  );
});

test("host live-delta schema accepts every canonical wire cell", () => {
  const expected = hostExpectation();
  for (const delta of validHostLiveDeltas()) {
    assert.equal(validateHostConsoleLiveDelta(delta, expected), true, delta.kind);
  }
});

test("host live-delta schema rejects wrong-game and missing authority", () => {
  const expected = hostExpectation();
  for (const delta of validHostLiveDeltas()) {
    assert.equal(
      validateHostConsoleLiveDelta(
        { ...delta, body: { ...delta.body, game: "other-game" } },
        expected,
      ),
      false,
      delta.kind,
    );
  }

  assert.equal(
    validateHostConsoleLiveDelta(
      {
        kind: "HostConsoleHeaderChanged",
        body: {
          game: "midsummer",
          completed: false,
          phase: null,
        },
      },
      expected,
    ),
    false,
  );
  assert.equal(
    validateHostConsoleLiveDelta(validHostLiveDeltas()[2], {
      game: "midsummer",
      expectedPrincipalId: null,
      expectedCapabilityKind: "HostOf",
    }),
    false,
  );
});

test("host live-delta schema rejects malformed cells and unknown kinds", () => {
  const expected = hostExpectation();
  const malformed = [
    {
      kind: "HostConsoleSlotsChanged",
      body: { game: "midsummer", slots: [{}], removed_slot_ids: [] },
    },
    {
      kind: "HostConsoleThreadPostsChanged",
      body: { game: "midsummer", posts: [{}] },
    },
    {
      kind: "HostConsoleThreadPostRemoved",
      body: { game: "midsummer", stream_seq: "4" },
    },
    {
      kind: "HostConsoleDayEventsChanged",
      body: { game: "midsummer", day_events: [{}], removed_event_ids: [] },
    },
    {
      kind: "HostConsoleSchedulerChanged",
      body: { game: "midsummer", day_event_scheduler: {} },
    },
    {
      kind: "HostConsoleTasksChanged",
      body: { game: "midsummer", tasks: [{}] },
    },
    {
      kind: "HostConsoleMysteryChanged",
      body: { game: "midsummer" },
    },
  ];

  for (const delta of malformed) {
    assert.equal(validateHostConsoleLiveDelta(delta, expected), false, delta.kind);
  }
});

function playerCommandState() {
  return {
    game: "midsummer",
    actor_slot: "slot-4",
    actor_alive: true,
    actor_status: "alive",
    role_key: null,
    role: null,
    game_completed: false,
    phase: null,
    actions: [],
    current_actions: [],
    vote_targets: [],
    current_vote: null,
    day_events: [],
    day_event_rooms: [],
    post_policies: [],
    boundary: "live",
  };
}

function threadPost() {
  return {
    game: "midsummer",
    source_seq: 1,
    stream_seq: 1,
    channel_id: "main",
    author: { kind: "system" },
    phase_id: null,
    body: "live post",
    media: [],
    quotations: [],
    citation_count: 0,
    occurred_at: 1,
  };
}

function threadPage() {
  return {
    game: {
      game: "midsummer",
      pack: "midsummer",
      status: "active",
      phase_id: null,
      updated_seq: 1,
      completed_seq: null,
    },
    posts: [threadPost()],
    next_before_seq: null,
  };
}

function votecountDelta() {
  return {
    kind: "VoteCountChanged",
    body: {
      game: "midsummer",
      phase_id: "D01",
      candidate_slot: "slot-2",
      count: 2,
    },
  };
}

function dayVoteOutcomeDelta() {
  return {
    kind: "DayVoteOutcomeApplied",
    body: {
      game: "midsummer",
      phase_id: "D01",
      source_seq: 3,
      event_index: 1,
      status: "eliminated",
      winner_slot: "slot-2",
      contenders: ["slot-2"],
      tallies: { "slot-2": 2 },
      votes: { "slot-1": "slot-2" },
      weights: { "slot-1": 1 },
      majority: 2,
      thresholds: { majority: 2 },
      total_weight: 2,
      tiebreak: null,
      reason: null,
    },
  };
}

function endgameSummary() {
  return {
    game: "midsummer",
    completed: false,
    winner: null,
    slots: [],
    vote_history: [],
    boundary: "reveal-gated",
  };
}

function playerNotification() {
  return {
    game: "midsummer",
    phase_id: "N01",
    event_index: 1,
    audience_slot: "slot-4",
    effect: "Commuted",
    status: "Delivered",
  };
}

function playerInvestigationResult() {
  return {
    game: "midsummer",
    phase_id: "N01",
    event_index: 1,
    audience_slot: "slot-4",
    mode: "parity",
    target_slot: "slot-2",
    result: "town",
  };
}

function hostConsoleState() {
  return {
    game: "midsummer",
    authority: {
      principal_id: FIXTURE_PRINCIPAL_IDS.hostH,
      capability: "HostOf",
      allowed_classes: ["phase_resolve"],
      denied_classes: [],
    },
    completed: false,
    phase: null,
    slots: [],
    thread_posts: [],
    day_event_scheduler: null,
    day_events: [],
    tasks: [],
  };
}

function hostDayEvent(seed) {
  return {
    event_id: "event-cookie",
    state: "resolved",
    phase_id: "D01",
    definition: {},
    room: null,
    participant_slots: ["slot-1"],
    open_due_at: null,
    open_observed_at: null,
    lock_due_at: null,
    lock_observed_at: null,
    auto_seed: seed,
    resolution_evidence: {
      kind: "auto",
      policy: { kind: "seeded_random", winners: 1 },
      seed,
      participant_slots: ["slot-1"],
    },
    winner_slots: ["slot-1"],
    reward_keys_applied: ["cookie"],
    narratives: [],
  };
}

function hostExpectation() {
  return {
    game: "midsummer",
    expectedPrincipalId: FIXTURE_PRINCIPAL_IDS.hostH,
    expectedCapabilityKind: "HostOf",
  };
}

function validHostLiveDeltas() {
  const state = hostConsoleState();
  return [
    { kind: "HostConsoleStateChanged", body: state },
    {
      kind: "HostConsoleHeaderChanged",
      body: {
        game: state.game,
        authority: state.authority,
        completed: state.completed,
        phase: state.phase,
      },
    },
    {
      kind: "HostConsoleSlotsChanged",
      body: { game: state.game, slots: [], removed_slot_ids: [] },
    },
    {
      kind: "HostConsoleThreadPostsChanged",
      body: { game: state.game, posts: [] },
    },
    {
      kind: "HostConsoleThreadPostRemoved",
      body: { game: state.game, stream_seq: 4 },
    },
    {
      kind: "HostConsoleDayEventsChanged",
      body: { game: state.game, day_events: [], removed_event_ids: [] },
    },
    {
      kind: "HostConsoleSchedulerChanged",
      body: { game: state.game, day_event_scheduler: null },
    },
    {
      kind: "HostConsoleTasksChanged",
      body: { game: state.game, tasks: [] },
    },
  ];
}

test("thread DTO accepts absent and null optional embeds but rejects malformed embeds", () => {
  for (const embed of [undefined, null]) {
    assert.equal(validateGameplayThreadPageResponse({ ...threadPage(), posts: [{ ...threadPost(), embed }] }, { game: "midsummer" }), true);
  }
  for (const embed of [false, {}, "invalid"]) {
    assert.equal(validateGameplayThreadPageResponse({ ...threadPage(), posts: [{ ...threadPost(), embed }] }, { game: "midsummer" }), false);
  }
});

test("thread DTO checks decided mention span fields", () => {
  for (const mentions of [[], [{ slot_id: "slot-2", offset: 0, len: 7 }]]) {
    assert.equal(validateGameplayThreadPageResponse({ ...threadPage(), posts: [{ ...threadPost(), mentions }] }, { game: "midsummer" }), true);
  }
  for (const mentions of [null, [{}], [{ slot_id: "slot-2", offset: -1, len: 7 }], [{ slot_id: "slot-2", offset: 0, len: 0 }]]) {
    assert.equal(validateGameplayThreadPageResponse({ ...threadPage(), posts: [{ ...threadPost(), mentions }] }, { game: "midsummer" }), false);
  }
});
