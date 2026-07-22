// Data tables that drive the role-smoke browser lane. A new feature proof
// should extend these tables (and the scenario module) instead of adding
// bespoke code to tools/frontend_role_smoke.mjs.

export const commandMockScenarios = Object.freeze([
  Object.freeze({
    command: "ResolveHostPrompt",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([91]) }),
    }),
    effects: Object.freeze([Object.freeze({ set: "hostPromptPending", value: false })]),
  }),
  Object.freeze({
    command: "SetSlotStatus",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([73]) }),
    }),
    effects: Object.freeze([Object.freeze({ set: "slotStatus", fromCommandField: "status" })]),
  }),
  Object.freeze({
    command: "SubmitPost",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([72]) }),
    }),
  }),
]);

export const commandMockFallback = Object.freeze({
  status: 409,
  id: Object.freeze({ literal: 1 }),
  respond: Object.freeze({
    kind: "Reject",
    body: Object.freeze({
      error: "StreamConflict",
      retryable: true,
      message: "reload and retry",
    }),
  }),
});

export function createRoleMockState() {
  return {
    slotStatus: "alive",
    hostPromptPending: true,
  };
}

export const mockStateProjections = Object.freeze({
  hostConsoleState(state) {
    return {
      phase: {
        phase_id: "D01",
        locked: false,
        deadline: 1782000000,
      },
      slots: [
        {
          slot_id: "slot-7",
          occupant_user_id: "player-mira",
          status: state.slotStatus,
          alive: state.slotStatus === "alive",
        },
      ],
      thread_posts: [
        {
          author_slot: "slot-7",
        },
      ],
    };
  },
  hostPrompts(state) {
    return state.hostPromptPending
      ? [
          {
            id: "D01:skip_next_day:slot_1",
            label: "skip_next_day",
            status: "pending",
            decisionKind: "acknowledge",
          },
        ]
      : [];
  },
});

// Installed in array order; Playwright matches the most recently registered
// route first, so the paginated thread entry must stay last to shadow the
// generic thread entry, which passes paginated requests through to it.
export const fixtureApiRoutes = Object.freeze([
  Object.freeze({
    pattern: "**/games/*/thread?*",
    passthroughWhen: Object.freeze({ urlIncludes: "before_seq=" }),
    body: Object.freeze({
      next_before_seq: 440,
      posts: [
        {
          source_seq: 445,
          stream_seq: 92,
          author_slot: "slot-7",
          author_user: "Mira",
          body: "Browser smoke refreshed player post.",
          occurred_at: 1781938800,
          media: [
            {
              id: "browser-refresh-445",
              kind: "image",
              alt: "Browser refreshed post receipt",
              variants: {
                tablet: {
                  url: "/media/midsummer/thread/browser-refresh-445-tablet.jpg",
                  width: 960,
                  height: 720,
                },
                small: {
                  url: "/media/midsummer/thread/browser-refresh-445-small.jpg",
                  width: 480,
                  height: 360,
                },
                original: {
                  url: "/media/midsummer/thread/browser-refresh-445-original.jpg",
                  width: 4000,
                  height: 3000,
                },
              },
            },
          ],
        },
        {
          source_seq: 444,
          stream_seq: 91,
          author_slot: "host",
          author_user: "Host",
          body: "Official votecount for D01\n- slot_2: 1",
          occurred_at: 1781935200,
        },
      ],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/votecount(?:\?.*)?$/,
    body: Object.freeze([
      {
        target: "slot-2 / Ilya",
        count: 3,
        needed: 5,
      },
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/player-command-state(?:\?.*)?$/,
    body: Object.freeze({
      game: "midsummer",
      actor_slot: "slot-7",
      actor_alive: true,
      actor_status: "alive",
      phase: {
        phase_id: "D01",
        phase_kind: "Day",
        phase_number: 1,
        locked: false,
      },
      actions: [],
      vote_targets: [],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/host-console-state(?:\?.*)?$/,
    bodyFrom: "hostConsoleState",
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/host-prompts(?:\?.*)?$/,
    bodyFrom: "hostPrompts",
  }),
  Object.freeze({
    pattern: "**/games/*/thread?*before_seq=*",
    body: Object.freeze({
      next_before_seq: null,
      posts: [
        {
          source_seq: 440,
          stream_seq: 88,
          author_slot: "slot-3",
          author_user: "Tamsin",
          body: "Older context for the live thread.",
          occurred_at: 1781924400,
        },
      ],
    }),
  }),
]);

export const privateChannelCommandMockScenarios = Object.freeze([
  Object.freeze({
    command: "SubmitPost",
    respond: Object.freeze({
      kind: "Ack",
      body: Object.freeze({ stream_seqs: Object.freeze([172]) }),
    }),
  }),
]);

export const privateChannelCommandMockFallback = Object.freeze({
  status: 409,
  id: Object.freeze({ fromEnvelope: true, fallback: 1 }),
  respond: Object.freeze({
    kind: "Reject",
    body: Object.freeze({
      error: "WrongPrivateChannelCommand",
      retryable: false,
      message: "private-channel smoke only accepts SubmitPost",
    }),
  }),
});

export const privateChannelFixtureApiRoutes = Object.freeze([
  Object.freeze({
    pattern: "**/games/*/channels/*/thread?*",
    body: Object.freeze({
      next_before_seq: 440,
      posts: [
        {
          source_seq: 446,
          stream_seq: 172,
          author_slot: "slot-7",
          author_user: "Mira",
          body: "Browser smoke refreshed private channel post.",
          occurred_at: 1781939100,
        },
      ],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/votecount(?:\?.*)?$/,
    body: Object.freeze([
      {
        target: "slot-2 / Ilya",
        count: 3,
        needed: 5,
      },
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/player-command-state(?:\?.*)?$/,
    body: Object.freeze({
      game: "midsummer",
      actor_slot: "slot-7",
      actor_alive: true,
      actor_status: "alive",
      phase: {
        phase_id: "D01",
        phase_kind: "Day",
        phase_number: 1,
        locked: false,
      },
      actions: [],
      vote_targets: [],
    }),
  }),
]);
