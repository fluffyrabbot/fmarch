import { FIXTURE_PRINCIPAL_IDS } from "../principal-id.mjs";

// Shared deterministic projections for browser proof and the UI workbench.
export function createRoleMockState() {
  return {
    slotStatus: "alive",
    hostPromptPending: true,
  };
}

export const mockStateProjections = Object.freeze({
  hostConsoleState(state) {
    return {
      game: "midsummer",
      authority: {
        principal_id: FIXTURE_PRINCIPAL_IDS.hostH,
        capability: "HostOf",
        allowed_classes: [
          "setup",
          "phase_resolve",
          "host_prompt_resolve",
          "lifecycle",
          "replacement",
          "deadline",
          "narrative",
          "ita_control",
          "effect_spec",
          "day_event_ops",
          "day_event_resolve",
          "program_attach",
        ],
        denied_classes: [],
      },
      completed: false,
      phase: {
        phase_id: "D01",
        locked: false,
        deadline: 1782000000,
      },
      slots: [
        {
          slot_id: "slot-7",
          occupancy_id: "occupancy-slot-7",
          persona_id: "persona-mira",
          public_name: "Mira",
          assigned_principal_id: FIXTURE_PRINCIPAL_IDS.playerMira,
          status: state.slotStatus,
          alive: state.slotStatus === "alive",
          status_tags: [],
          role_key: null,
          alignment: null,
          role_revealed: false,
          alignment_revealed: false,
        },
      ],
      thread_posts: [
        {
          stream_seq: 72,
          author: { kind: "slot", slot_id: "slot-7" },
          phase_id: "D01",
          body: "Browser smoke host console thread post.",
          quotations: [],
        },
      ],
      day_event_scheduler: null,
      day_events: [
        {
          event_id: "event-cookie",
          state: "locked",
          phase_id: "D01",
          definition: {
            id: "event-cookie",
            template_key: "theme.raffle",
            participation: {
              who: "alive_slots",
              mode: "opt_in",
              limits: { minimum: 1, maximum: null },
            },
            rewards: [
              {
                reward_key: "cookie",
                display_name_theme_key: "theme.cookie",
                effects: [{}],
              },
            ],
          },
          room: null,
          participant_slots: ["slot-1", "slot-2", "slot-7"],
          open_due_at: null,
          open_observed_at: null,
          lock_due_at: null,
          lock_observed_at: null,
          auto_seed: null,
          resolution_evidence: null,
          winner_slots: [],
          reward_keys_applied: [],
          narratives: [],
        },
      ],
      tasks: [
        ...(state.hostPromptPending
          ? [
            {
              id: "engine-host-prompt:D01:skip_next_day:slot_1",
              kind: "engine_host_prompt",
              state: "ready",
              urgency: "attention",
              intent: "beloved_princess_death",
              consequence: "resolve pack-defined skip_next_day policy",
              phase_id: "D01",
              subject_slot: "slot_1",
              source_id: "D01:skip_next_day:slot_1",
              allowed_commands: [
                {
                  kind: "resolve_host_prompt",
                  permission_class: "host_prompt_resolve",
                },
              ],
              blocked_reason: null,
            },
            ]
          : []),
        {
          id: "day-event-resolve:event-cookie",
          kind: "day_event_resolve",
          state: "ready",
          urgency: "attention",
          intent: "Resolve theme.raffle",
          consequence: "apply 1 reward binding atomically",
          phase_id: "D01",
          subject_slot: null,
          source_id: "event-cookie",
          allowed_commands: [
            {
              kind: "resolve_day_event",
              permission_class: "day_event_resolve",
            },
          ],
          blocked_reason: null,
        },
      ],
    };
  },
  hostPrompts(state) {
    return state.hostPromptPending
        ? [
          {
            game: "midsummer",
            phase_id: "D01",
            event_index: 0,
            prompt_id: "D01:skip_next_day:slot_1",
            kind: "skip_next_day",
            subject_slot: "slot_1",
            reason: "beloved_princess_death",
            metadata: {},
            status: "pending",
            decision: null,
            public_resolution: null,
            resolved_at: null,
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
    pattern: "**/live/tickets?*",
    body: Object.freeze({
      url: "/ws?ticket=fmarch-smoke-ticket&audience=fmarch-live",
      expires_at: 4_102_444_800,
    }),
  }),
  Object.freeze({
    pattern: "**/api/gameplay/games/*?*",
    passthroughWhen: Object.freeze({ urlIncludes: "before_seq=" }),
    body: Object.freeze({
      game: Object.freeze({
        game: "midsummer",
        pack: "midsummer",
        status: "running",
        phase_id: "D01",
        updated_seq: 92,
        completed_seq: null,
      }),
      next_before_seq: 440,
      posts: [
        {
          game: "midsummer",
          source_seq: 445,
          stream_seq: 92,
          channel_id: "main",
          author: { kind: "slot", slot_id: "slot-7" },
          phase_id: "D01",
          body: "Browser smoke refreshed player post.",
          media: [],
          quotations: [],
          citation_count: 0,
          occurred_at: 1781938800,
        },
        {
          game: "midsummer",
          source_seq: 444,
          stream_seq: 91,
          channel_id: "main",
          author: { kind: "host_narrator" },
          phase_id: "D01",
          body: "Official votecount for D01\n- slot_2: 1",
          media: [],
          quotations: [],
          citation_count: 0,
          occurred_at: 1781935200,
        },
        {
          game: "midsummer",
          source_seq: 443,
          stream_seq: 90,
          channel_id: "main",
          author: { kind: "slot", slot_id: "slot-7" },
          phase_id: "D01",
          body: "@slot-2 explain the wagon",
          media: [],
          quotations: [],
          mentions: [{ slot_id: "slot-2", offset: 0, len: 7 }],
          citation_count: 0,
          occurred_at: 1781933400,
        },
        {
          game: "midsummer",
          source_seq: 442,
          stream_seq: 89,
          channel_id: "main",
          author: { kind: "slot", slot_id: "slot-2" },
          phase_id: "D01",
          body: "Pressure stays here until the replacement answer lands.",
          occurred_at: 1781931600,
          media: [
            {
              content_id:
                "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              alt: "Tablet-safe vote receipt",
              variants: {
                tablet: {
                  avif_url: "/media/midsummer/thread/receipt-442-tablet.png",
                  webp_url: "/media/midsummer/thread/receipt-442-tablet.png",
                  width: 960,
                  height: 720,
                },
                thumb: {
                  avif_url: "/media/midsummer/thread/receipt-442-small.png",
                  webp_url: "/media/midsummer/thread/receipt-442-small.png",
                  width: 480,
                  height: 360,
                },
              },
            },
          ],
          quotations: [],
          citation_count: 0,
        },
      ],
    }),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/votecount(?:\?.*)?$/,
    body: Object.freeze([
      {
        kind: "VoteCountChanged",
        body: {
          game: "midsummer",
          phase_id: "D01",
          candidate_slot: "slot-2 / Ilya",
          count: 3,
          majority: 5,
        },
      },
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/day-vote-outcomes(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/endgame-summary(?:\?.*)?$/,
    body: null,
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/notifications(?:\?.*)?$/,
    body: Object.freeze([
      Object.freeze({
        game: "midsummer",
        phase_id: "N02",
        event_index: 0,
        audience_slot: "slot-7",
        effect: "Commuted",
        status: "Delivered",
      }),
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/investigation-results(?:\?.*)?$/,
    body: Object.freeze([
      Object.freeze({
        game: "midsummer",
        phase_id: "N02",
        event_index: 1,
        audience_slot: "slot-7",
        mode: "tracker",
        target_slot: "slot-4",
        result: "No visit",
      }),
    ]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/slot-mentions(?:\?.*)?$/,
    body: Object.freeze([]),
  }),
  Object.freeze({
    pattern: /\/games\/[^/]+\/player-command-state(?:\?.*)?$/,
    body: Object.freeze({
      game: "midsummer",
      actor_slot: "slot-7",
      actor_alive: true,
      actor_status: "alive",
      game_completed: false,
      role_key: null,
      role: null,
      phase: {
        phase_id: "D01",
        locked: false,
        deadline: null,
      },
      actions: [],
      current_actions: [],
      vote_targets: [
        { kind: "slot", slot_id: "slot-2", label: "Slot 2" },
        { kind: "no_lynch", slot_id: null, label: "No lynch" },
      ],
      current_vote: null,
      mention_targets: [
        { channel_id: "main", slots: ["slot-2", "slot-3", "slot-7"] },
      ],
      day_events: [
        {
          event_id: "event-cookie",
          template_key: "theme.raffle",
          phase_id: "D01",
          participation_status: "available",
          participant_count: 2,
          minimum_participants: 1,
          maximum_participants: null,
          reward_keys: ["cookie"],
          can_submit: true,
          can_withdraw: false,
        },
      ],
      day_event_rooms: [],
      post_policies: [],
      boundary: "live",
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
    pattern: "**/api/gameplay/games/*?*before_seq=*",
    body: Object.freeze({
      next_before_seq: null,
      posts: [
        {
          game: "midsummer",
          source_seq: 440,
          stream_seq: 88,
          channel_id: "main",
          author: { kind: "slot", slot_id: "slot-3" },
          phase_id: "D01",
          body: "Older context for the live thread.",
          media: [],
          quotations: [],
          citation_count: 0,
          occurred_at: 1781924400,
        },
      ],
    }),
  }),
]);

