# 10 — Event schema & result contract

The concrete event taxonomy for both layers ([09-engine-and-packs](09-engine-and-packs.md)),
plus the **result contract** discipline ported from im-human's `V4_RESULT_CONTRACT.md`:
event types are enumerated, each is versioned, and **unknown types are rejected outright**.

Conventions: this is design intent at the type level, not generated code. Rust sketches show
the shape; the authoritative types live in the `domain` and `wire` crates
([03](03-backend.md), [04](04-wire-protocol.md)).

## The envelope

One envelope wraps every persisted event ([02-event-sourcing](02-event-sourcing.md)).

```rust
struct EventEnvelope {
    id: Uuid,                 // unique event id
    stream_id: GameId,        // aggregate = game
    seq: u64,                 // per-stream monotonic order (the canonical game order)
    kind: EventKind,          // tagged discriminant (see taxonomy below)
    version: u16,             // schema version of THIS event kind (additive evolution)
    payload: EventPayload,    // shape determined by `kind`
    actor: ActorId,           // who/what caused it
    occurred_at: LogicalTime, // deterministic timestamp
    causation_id: Option<Uuid>, // command/event that caused this
    meta: EventMeta,          // capability used, request id, run_id, etc. (audit)
}

enum ActorId {
    Slot(SlotId),   // a seat acted (engine-visible identity)
    Host,           // a host/cohost action
    System,         // the engine/resolver
    User(UserId),   // a platform-level action outside any game seat (forum posting, auth)
}
```

> Note `ActorId` is the one place both identity worlds meet. The **engine** only ever emits
> `Slot` / `System`. `User` and `Host` appear only on **platform** events. This keeps the
> `User ≠ Slot` boundary ([01](01-domain-model.md), [09](09-engine-and-packs.md)) visible in
> the type system.

## Two event families

| Family | Caused by | Examples | Folded by |
|---|---|---|---|
| **Platform events** | humans, hosts, the platform | posts, votes-as-submissions, channels, replacement, lifecycle | thread/channel/membership projections |
| **Engine (resolution) events** | the resolver (`System`) | kills, saves, conversions, day outcome, investigations, wins | votecount/slot-state/reveal projections |

Engine events are *only ever produced by `resolve`* ([09](09-engine-and-packs.md)) and
arrive wrapped in a `resolution.applied` envelope.

---

## Platform events

```rust
enum EventKind {
    // ── Game lifecycle ──
    GameCreated,            // pack ref, host, config
    SignupsOpened,
    SlotAdded,              // { slot_id }
    SlotAssigned,           // { slot_id, user_id }  ← occupancy begins (platform-only)
    GameStarted,            // freezes roster; engine state seeded
    GameCompleted,          // { winner_alignment, reason }
    GameArchived,

    // ── Membership / replacement (PLATFORM-ONLY; engine never sees these) ──
    ReplacementRequested,   // { slot_id, reason }
    ReplacementCompleted,   // { slot_id, outgoing_user, incoming_user }  ← seat id unchanged
    SlotModkilled,          // host removes a seat from play (becomes an engine submission)

    // ── Roles ──
    RoleAssigned,           // { slot_id, role_key }  payload ENCRYPTED at rest (06)

    // ── Posting ──
    PostSubmitted,          // { channel_id, slot_or_user, body_ref, attachments, phase_id }
    PostEdited,             // { post_id, new_body_ref }   original recoverable
    PostRetracted,          // { post_id }

    // ── Channels ──
    ChannelCreated,         // { channel_id, scope, phase_gate }
    ChannelMemberAdded,     // { channel_id, slot_id }
    ChannelMemberRemoved,
    ChannelVisibilityChanged,
    PrivateChannelDeclared, // { channel_id, group_id, kind, members, reveals_alignment, source }
    PrivateChannelRevoked,  // { channel_id, group_id, kind, reason, source }

    // ── Submissions (platform → engine seam, doc 09) ──
    VoteSubmitted,          // { actor: slot, target: slot|no_lynch, phase_id }  (overwrites actor's current ballot)
    VoteWithdrawn,          // { actor: slot, phase_id }  ballot-keyed: removes the actor's current ballot (the running tally is ballot-keyed, not action-keyed)
    ActionSubmitted,        // { action_id, template_id, actor, targets, phase_id, grant_id? }
    ActionWithdrawn,        // { action_id, actor, phase_id }

    // ── Host phase control ──
    DeadlineSet,            // { phase_id, at }   `at` captured as data (determinism)
    DeadlineExtended,
    PhaseDeadlineElapsed,   // { phase_id, deadline_at, observed_at, source:"scheduler" }; inert evidence, does not move phase_state
    ThreadLocked,           // host: { channel_id }; vote hammer: { channel_id, phase_id, reason:"hammer", source:"vote_hammer", actor, target }
    ThreadUnlocked,
    PhaseAdvanceRequested,  // host triggers resolution of the current window
    HostPromptResolved,     // { prompt_id, phase_id, kind, reason, decision, resolved_by }; revote/skip-next-day decisions append validated PhaseAdvanced provenance

    // ── Engine output wrappers (see next section) ──
    ResolutionApplied,
    ResolutionTrace,
}
```

`VoteSubmitted` / `ActionSubmitted` are the persisted form of a
[Submission](09-engine-and-packs.md). `SubmitVote`/`WithdrawVote` and
`SubmitAction`/`WithdrawAction` are the command/wire front doors; they validate slot
authority, open phase, actor liveness, action template ownership, window, target
cardinality, uniqueness, self-targeting, one-shot exhaustion, odd/even phase parity,
non-consecutive repeat targets, duplicate base template submissions, and explicit
extra-action grant capacity before appending the canonical platform events. When a window
closes, the resolver folds every non-withdrawn submission into engine events.

---

## Engine resolution events

The resolver's output is persisted as **one `resolution.applied` envelope** that carries the
ordered inner domain events, plus a companion `resolution.trace`. This mirrors im-human's
`resolution.v5.applied` and keeps a resolution atomic and replayable as a unit.

```rust
struct ResolutionApplied {
    phase_id: PhaseId,
    phase_kind: PhaseKind,          // Day | Night | Twilight
    phase_number: u32,
    run_id: String,                 // deterministic resolver run id
    result_version: u16,            // resolver contract version
    seed: Seed,                     // the inputs' seed, recorded
    counts: ResolutionCounts,       // { events, kills, saves, … } aggregates
    events: Vec<InnerEvent>,        // ordered; each { index, kind, payload }
    started_at: LogicalTime,
    finished_at: LogicalTime,
}
```

### Inner domain events (the closed, enumerated set)

This is the result contract. **Adding a new inner event kind requires bumping
`result_version` and updating the validator; unknown kinds are rejected** ([validation](#result-contract--validation)).

```rust
enum InnerEvent {
    // ── Day flow ──
    DayVoteRecorded,        // { actor, target?, withdrawn, sequence }  running ballots
    DayVoteOutcome,         // OFFICIAL outcome (engine+pack resolved)
    DayAnnouncement,        // prior-night death note emitted by day-note culture policy
    LastWordsRecorded,      // last-word note for a day-death victim
    HostPromptIssued,       // durable host/admin prompt emitted by engine policy
    PhaseAnnouncement,      // deaths revealed at phase boundary

    // ── Core night results ──
    PlayerKilled,           // { slot_id, cause, attackers, unstoppable, death_reveal=Full }  see below
    PlayerSaved,            // { slot_id, reasons, sources }
    PlayerConverted,        // { target, new_role, new_alignment, original_role, original_alignment, source }  (R2: carries alignment; apply_events updates BOTH role_key and alignment)
    ConversionBlocked,      // { target, status, reason }

    // ── Persistent effects (Mark/Clear) ──
    EffectsMarked,          // { effect, target, actor }
    EffectsCleared,         // { effect, targets, actor }
    ActionGranted,          // { grant_id, kind, actor, target, uses, phase_id, phase_kind, phase_number }
    ActionGrantConsumed,    // { grant_id, actor, action_id, phase_id, phase_kind, phase_number, remaining_uses }
    BadgeChanged,           // { badge_id, owner, previous_owner, vote_weight, actor, source_action, reason, destroyed, phase_id, phase_kind, phase_number }
    DuelResolved,           // { knight, target, result, killed, source_action, phase_id, phase_kind, phase_number }
    WolfSelfDestructed,     // { wolf_id, target_id, cause, unstoppable, source_action, phase_id, phase_kind, phase_number }
    WolfCarryQueued,        // { owner_id, token_id, cause, role_key, phase_id, phase_kind, phase_number }
    WolfCarryUsed,          // { owner_id, target_id, source_action_id, effect_id, role_key, phase_id, phase_kind, phase_number }
    WolfBeautyMarked,       // { beauty_id, target_id, effect, source_action, phase_id, phase_kind, phase_number }
    WolfBeautyDragged,      // { beauty_id, dragged_ids, cause, phase_id, phase_kind, phase_number }
    ItaSessionOpened,       // { session_id, label, day, window, status, phase_id, phase_kind, phase_number }
    ItaShotQueued,          // { session_id, action_id, actor, targets, submitted_at, queue_position, queue_length, previous_queue_length, counters }
    ItaShotBuffered,        // { session_id, action_id, actor_id, targets, submitted_at, release_at, delay_ms }
    ItaShotInvalidated,     // { session_id, action_id, actor_id, target_id, reason, invalidated_by?, submitted_at, timestamp }
    ItaShotResolved,        // { session_id, action_id, actor, target, outcome, hit_chance, roll, kill, submitted_at, timestamp, counters }
    ItaShotRefunded,        // { session_id, action_id, actor_id, target_id, reason, policy?, hit_chance?, roll?, hp_before?, hp_after?, protection_path?, submitted_at, timestamp, counters }
    ItaSessionUpdated,      // { session_id, queue_length, queue_delta, shots_resolved, global_shots_fired, counters, phase_id, phase_kind, phase_number }
    ItaSessionClosed,       // { session_id, last_status, phase_id, phase_kind, phase_number }
    PlayersLinked,          // { link_id, slots, source }
    RetaliationArmed,       // { retaliation_id, actor, target, source_action }
    BackupTargeted,         // { backup, source_target, source_role, source_action, phase_id, phase_kind, phase_number }

    // ── Information ──
    InvestigationResult,    // { mode, investigator, target, result }  mode per InvestigateMode
    AlignmentRevealed,      // { slot_id, alignment, source_action, phase_id, phase_kind, phase_number }
    VoteDuelDeclared,       // { challenger, target, source_action, phase_id, phase_kind, phase_number }
    EffectNotification,     // { effect, status, audience }  visible Mark/Clear or loud/announcing notice; NOT roleblock

    // ── Interference ──
    ActionIngestHalted,    // { action_id, actor, actor_role, template_id, targets, phase_id, phase_kind, phase_number, reason, grant_id }
    ActionInterfered,       // { actor: SlotId, reason: String }  e.g. reason "roleblocked"
    ActionRecorded,         // { actor, template_id, targets, phase_id, phase_kind, phase_number, status }  cadence/audit history

    // ── Reactive ──
    Trigger,                // { trigger_id, payload }  (bomb/vengeful/PGO retaliation)

    // ── Win conditions ──
    WinReached,             // { winner, reason, metadata }
}
```

### im-human V4 result-kind mapping

The im-human result schema uses dotted string event names. fmarch persists canonical Rust
`InnerEvent` variants inside `ResolutionApplied`; the mapping below is the Phase-0 contract.
Rows marked unsupported are real im-human result kinds that must not be silently stored as
unknown Rust events.

| im-human result kind | Canonical fmarch inner event | Status |
|---|---|---|
| `day.vote.recorded` | `DayVoteRecorded` | implemented; emitted for ordered day-vote submit/withdraw history before outcome |
| `day.vote.outcome` | `DayVoteOutcome` | implemented |
| `note.day.announcement` | `DayAnnouncement` | implemented; prior-night death note from `DayPhaseInputs.night_victims` when pack day-note policy enables it |
| `note.day.last_words` | `LastWordsRecorded` | implemented; day-death last words after lynch, before trailing `PhaseAnnouncement` |
| — fmarch local | `HostPromptIssued` | implemented; Beloved Princess, NoMajority revote, and HostDecides PK prompts |
| `phase.announcement` | `PhaseAnnouncement` | implemented |
| `player.killed` | `PlayerKilled` | implemented |
| `player.saved` | `PlayerSaved` | implemented; also canonical for Chinese Idiot first-lynch survival, paired with `EffectsMarked` vote loss |
| `player.converted` | `PlayerConverted` | implemented |
| `effects.conversion_blocked` | `ConversionBlocked` | implemented |
| `effects.marked` | `EffectsMarked` | implemented |
| `effects.cleared` | `EffectsCleared` | implemented |
| `player.effect_notification` | `EffectNotification` | implemented for visible Mark/Clear, grant, loud/announcing, and private Cupid lover-knowledge notices |
| `investigation.result` | `InvestigationResult` | implemented for parity and track; Chinese Prophet Parity uses pack-owned good/evil labels |
| — fmarch local | `AlignmentRevealed` | implemented; mafiascum Innocent Child public alignment-only reveal |
| — fmarch local | `VoteDuelDeclared` | implemented; mafiascum Gladiator vote duel constrains the following official `DayVoteOutcome` to challenger and target, with no-ballot/tied duels resolved by pack-declared seeded random elimination |
| — fmarch local | `ActionRecorded` | implemented; folds action cadence/audit history |
| `ingest.halt` | `ActionIngestHalted` | implemented; historical/replay submission halted by ingest policy and paired with trace diagnostics |
| — fmarch local | `ActionGranted` | implemented; folds generated extra-action/item grants |
| — fmarch local | `ActionGrantConsumed` | implemented; decrements folded generated extra-action/item uses and projects remaining inventory |
| `note.sheriff.pass` | `BadgeChanged` | implemented; folds sheriff badge election/pass/destroy and vote weight |
| `note.knight.duel` | `DuelResolved` | implemented; Chinese structured Knight duel emits typed outcome plus `PlayerKilled` |
| `note.wolf.self_destruct` | `WolfSelfDestructed` | implemented for Chinese structured White Wolf King; paired `PlayerKilled` events kill the target and actor |
| `note.wolf.carry` | `WolfCarryUsed` | implemented for Chinese structured White Wolf carry; `WolfCarryQueued` is the local durable token event |
| `note.wolf_beauty.drag` | `WolfBeautyDragged` | implemented for Chinese structured Wolf Beauty lynch and Witch-poison drag; `WolfBeautyMarked` is the local durable charm event |
| `note.cupid.link` | `PlayersLinked` | implemented; Chinese Cupid setup emits the foldable link event, and v16 `lover_policy` decides whether day/night lover-suicide reads that folded state |
| `ita.session.opened` | `ItaSessionOpened` | implemented for the first Mafia Universe ITA vertical |
| `ita.session.updated` | `ItaSessionUpdated` | implemented for resolved-shot counter snapshots |
| `ita.session.closed` | `ItaSessionClosed` | implemented for auto-closing pack sessions |
| `ita.shot.queued` | `ItaShotQueued` | implemented for accepted ITA shots |
| `ita.shot.buffered` | `ItaShotBuffered` | implemented for pack-declared ITA session `buffer_delay_ms`; newly buffered shots defer same-pass queue/resolve/kill |
| `ita.shot.invalidated` | `ItaShotInvalidated` | canonical contract/import schema frozen; resolver queue invalidation policy still pending |
| `ita.shot.refunded` | `ItaShotRefunded` | canonical contract/import schema frozen; resolver refund policy still pending |
| `ita.shot.resolved` | `ItaShotResolved` | implemented for deterministic hit/miss plus paired `PlayerKilled` on hit |
| — fmarch local | `PlayersLinked` | implemented; folds Cupid/lovers-style cross-slot link state; later day/night cascade is pack-policy gated |
| — fmarch local | `RetaliationArmed` | implemented; folds Hunter-style chosen death retaliation state |
| — fmarch local | `BackupTargeted` | implemented; folds targeted backup source choices for later inheritance |
| `trigger.fired` | `Trigger` | fmarch canonical trace/result trigger event; payload includes observed `on`, source target/actor/cause, and produced actor/target |
| `win.reached` | `WinReached` | implemented |
| `win.executioner` | `WinReached` | implemented; dynamic im-human trigger-win result mapped through target-lynch independent win metadata |
| `win.condemner` | `WinReached` | implemented; dynamic im-human trigger-win result mapped through target-lynch independent win metadata |
| `win.jester` | `WinReached` | implemented; dynamic im-human trigger-win result mapped through self-lynch independent win metadata |
| `win.survivor` | `WinReached` | implemented; dynamic im-human alive-at-end win result mapped through `metadata.survival_awards[]` on the terminal faction win |
> **`ActionInterfered` vs `EffectNotification`.** When an action fails to resolve because it
> was interfered with (e.g. a roleblocked Cop), the resolver emits
> `ActionInterfered { actor, reason }` (reason `"roleblocked"`) addressed to the actor whose
> action was stopped, and emits **no** result event for the fizzled action (a roleblocked Cop
> gets no `InvestigationResult`). `EffectNotification` is **reserved for player-facing
> notifications** such as visible Mark/Clear effects, grant notices, loud/announcing modifiers,
> and Cupid lover knowledge, and is explicitly **NOT** the roleblock channel. Projection code
> folds it into `player_notification` as one row per audience slot.

> **`ActionIngestHalted` vs command rejection.** Front-door command validation still rejects
> illegal submissions before appending `ActionSubmitted`. `ActionIngestHalted` is emitted only
> when a historical or replayed submission is present in resolver input but is halted by ingest
> policy before normal action resolution, such as a template no longer available to the actor.
> The event is the durable result-contract fact; `ResolutionTrace` carries the richer host/admin
> diagnostic decision.

> **`PlayerKilled.unstoppable`.** `unstoppable = true` **iff the kill is inherently
> unpreventable by protection** — either the killing action carries the `Strongman` modifier
> ([09](09-engine-and-packs.md)) or the kill is an explicitly unstoppable generated dependency
> such as `Modifier::Babysitter` ward death or `Modifier::Hider` host-death fallout. It is
> true **regardless of whether a protect was actually present on the target**. It is a
> property of the kill, not of this particular night's matchup: a Strongman kill against an
> unprotected slot is still `unstoppable: true`; a plain kill that happened to land unopposed
> is `unstoppable: false`.

> **`PlayerKilled.death_reveal`.** `death_reveal` is the pack-owned flip policy for this
> death. It defaults to `Full` for ordinary role+alignment reveal and is omitted from JSON when
> default. Non-default modes are stored explicitly: `Concealed` keeps role and alignment private
> for Janitor/Flipless deaths, and `AlignmentOnly` reveals alignment while keeping role private.
> The field is derived from `Pack.death_reveal` by cause/effect before projection.

> **`cause` vocabulary (two fields, two layers).** `PlayerKilled.cause` is the killing
> action template's `id` (mechanical attribution, e.g. `"factional_kill"`; a day lynch uses
> `"day_vote"` per R1; a trigger-produced kill uses the trigger's `id`, e.g.
> `"bomb_retaliates"`; a Babysitter dependency death uses the protect action id, e.g.
> `"babysit"`; a Hider dependency death uses `"hide"`). `Death.cause` (inside
> `PhaseAnnouncement`, below) is a **semantic**
> death-reveal tag: night announcements collapse killed slots to `"night_kill"`, while day
> announcements use semantic day causes such as `"lynch"` plus generated policy causes such as
> `"lover_suicide"`. These are deliberately different fields serving different layers — do not
> conflate them.

`Trigger.payload` is intentionally opaque to the state fold, but the resolver emits a
canonical attribution shape for generated kills: `{ on, source_target, source_actor,
source_cause, produced_actor, produced_target }`.

`DayVoteOutcome` carries the full tally so projections and disputes have everything:

```rust
struct DayVoteOutcome {
    status: VoteStatus,             // Lynch | NoLynch | NoMajority | Tie | Hammer
    winner: Option<SlotId>,         // the eliminated slot, if any
    contenders: Vec<SlotId>,
    tallies: Map<SlotId, f64>,      // weighted counts
    votes: Map<SlotId, SlotId>,     // active ballots only (withdrawn omitted)
    weights: Map<SlotId, f64>,
    majority: Option<f64>,          // base threshold for majority/supermajority methods
    thresholds: Map<SlotId, f64>,   // effective candidate threshold after loved/hated policy
    total_weight: f64,
    tiebreak: Option<String>,
    reason: Option<String>,
}

enum VoteStatus { Lynch, NoLynch, NoMajority, Tie, Hammer }
```

`Hammer` is the explicit status for a pack-declared hammer vote that reached threshold and
froze the official vote snapshot at that ballot. `Tie` is the explicit status for a
plurality/parity tie with no eliminable winner (e.g. a 2-2 under
`tie_breaker: NoElimination`); it is distinct from `NoLynch` (someone *chose* no-lynch)
and from `NoMajority` (a majority threshold was simply not reached).
For plurality methods, `majority` is null and `thresholds` is empty. For majority and
supermajority methods, `thresholds` records the effective threshold for each alive slot so
target-role modifiers such as loved/hated are auditable from the result payload itself.
When a preceding `VoteDuelDeclared` exists, ballots targeting non-participants are omitted
from `votes`, the challenger/target thresholds are lowered to `1.0`, and if the duel has
no ballot or a tied top tally the resolver uses `vote.vote_duel_tie_breaker` (`Random` in
the shipped mafiascum pack) to force one duel participant to be eliminated. This models
the mafiascum Gladiator "only these two can be eliminated" surface without reusing the
lethal Chinese `DuelResolved` event.

`DayVoteOutcome.reason` is **optional, non-canonical human-readable prose** (the platform may
rewrite or localize it). It MUST NOT be relied on for replay and is **not part of the asserted
contract**: golden comparison ignores it. The resolver may still emit prose there for humans;
projections and disputes key off the structured fields (`status`, `winner`, `tiebreak`, the
tallies), never `reason`.

`DayAnnouncement` and `LastWordsRecorded` are day-note events. They are public culture notes,
not state transitions; `apply_events` treats them as no-ops. The current implemented source is
the Mafia Universe day-note vertical: prior-night victims are supplied as `DayPhaseInputs`, and
last words are derived from a day lynch. They are emitted before the single trailing
`PhaseAnnouncement`.

```rust
struct DayAnnouncement {
    player_id: SlotId,
    cause: String,
    template_id: Option<String>,    // v63 pack-declared public note template
    audience: Option<String>,       // v63 pack-declared audience, e.g. "public"
    source_action_id: Option<String>,
    attackers: Vec<SlotId>,
    unstoppable: bool,
    role_key: Option<RoleKey>,
    role_payload: Option<DayNoteRolePayload>, // v63 RoleKey or Hidden
    recorded_at: Option<LogicalTime>,
    sequence: u32,
    day: u32,
    night: u32,
    phase_id: PhaseId,
}

struct LastWordsRecorded {
    player_id: SlotId,
    reason: String,                 // v1: "lynch"
    template_id: Option<String>,    // v63 pack-declared public note template
    audience: Option<String>,       // v63 pack-declared audience, e.g. "public"
    window: Option<String>,         // v63 pack-declared speaking window
    sequence: u32,
    day: u32,
    phase_id: PhaseId,
    vote: LastWordsVoteSummary,
}

struct LastWordsVoteSummary {
    status: VoteStatus,
    winner: Option<SlotId>,
    tallies: Map<SlotId, f64>,
    majority: Option<f64>,
    total_weight: f64,
}
```

`WolfSelfDestructed` is the typed culture note for im-human `note.wolf.self_destruct`.
It is emitted before the paired death events; the actual state changes are still ordinary
`PlayerKilled` events for the target and self-sacrificing wolf.

```rust
struct WolfSelfDestructed {
    wolf_id: SlotId,
    target_id: SlotId,
    cause: String,                  // v1: "self_destruct"
    unstoppable: bool,
    source_action: String,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}
```

`WolfCarryQueued` is an fmarch-local durable engine event: it records the pending
White Wolf carry token after the eligible White Wolf death. `WolfCarryUsed` is the
canonical mapping for im-human `note.wolf.carry`; it is emitted when a later wolf
faction kill consumes that token for one extra target. The generated carry kill is
still an ordinary `PlayerKilled { cause: "wolf_carry" }`, so projections and
trigger observations do not need a separate death lane.

```rust
struct WolfCarryQueued {
    owner_id: SlotId,
    token_id: Tag,                  // v1: "white_wolf_carry_token"
    cause: String,                  // v1: "wolf_carry"
    role_key: RoleKey,              // v1: "white_wolf_king"
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}

struct WolfCarryUsed {
    owner_id: SlotId,
    target_id: SlotId,
    source_action_id: String,
    effect_id: String,
    role_key: RoleKey,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}
```

`WolfBeautyMarked` is an fmarch-local durable mark event for the Wolf Beauty charm:
the ordinary `EffectsMarked` tag remains on the target, while this event preserves
which Beauty owns that mark. `WolfBeautyDragged` is the canonical mapping for
im-human `note.wolf_beauty.drag`; it is emitted when the Beauty dies to an enabled
day-death cause and is followed by ordinary `PlayerKilled` events for dragged slots.

```rust
struct WolfBeautyMarked {
    beauty_id: SlotId,
    target_id: SlotId,
    effect: Tag,                    // v1: "wolf_beauty_mark"
    source_action: String,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}

struct WolfBeautyDragged {
    beauty_id: SlotId,
    dragged_ids: Vec<SlotId>,
    cause: String,                  // v1: "trigger:wolf_beauty_drag"
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}
```

`PhaseAnnouncement` (deaths revealed at a phase boundary) has the pinned payload:

```rust
struct PhaseAnnouncement {
    phase_id: PhaseId,
    template_id: Option<String>,    // v66 day-death public trailer template
    audience: Option<String>,       // v66 day-death public trailer audience
    deaths: Vec<Death>,             // empty if no one died this resolution
}

struct Death { slot_id: SlotId, cause: String }
```

**Every resolution emits exactly ONE trailing `PhaseAnnouncement` as its final inner event.**
It lists the deaths produced in that resolution — for a night, the slots that got
`PlayerKilled` (each `{ slot_id, cause: "night_kill" }`, in event order); for a day, pre-vote
day-action deaths use their action cause such as `"knight_duel"` / `"ita_shot"` /
`"self_destruct"`, a lynched slot uses `cause: "lynch"`, and generated day-death policy such
as Wolf Beauty or lover-suicide uses the generated cause. It is `deaths: []` when no one died.
v66 packs may attach `template_id`/`audience` to day/twilight `PhaseAnnouncement` events with at
least one death; night and no-death trailers omit that metadata. This single canonical
death-reveal signal always fires, even on a
resolution that produces only saves, interferences, or a tie. `Death.cause` is the semantic
death-reveal tag, distinct from `PlayerKilled.cause` when the layer needs that distinction.

> **`PhaseAnnouncement` is the *final* inner event UNLESS a win is reached.** When the
> post-resolution state satisfies the pack's `WinPolicy` ([09](09-engine-and-packs.md)), the
> resolver appends a single `WinReached` *after* the trailing `PhaseAnnouncement`, making it the
> true final inner event. Canonical order: *phase results → `PhaseAnnouncement` → optional
> `WinReached`*. Win-check runs once at phase end, never mid-resolution.

`WinReached` (engine-declared victory) has the pinned payload:

```rust
struct WinReached {
    winner: AlignmentKey,           // the winning faction tag (pack-opaque, e.g. "town" / "mafia")
    reason: String,                 // human-readable cause, e.g. "faction mafia reaches parity (1 vs 1 others)"
    metadata: Json,                 // optional structured detail; `null` when no pack policy adds detail
}
```

`WinReached.reason` is a stable, resolver-derived string, but (R3) it is **NOT part of the
asserted golden contract** — the asserted contract is `{winner}`. The golden harness **strips
`WinReached.reason` before comparison**, exactly as it strips `DayVoteOutcome.reason`; the
resolver may still emit prose there for humans. `metadata.survival_awards[]` records pack-declared
alive-at-end co-winners such as Survivor while keeping the terminal faction in `winner`.
A reveal-flags projection flips role/alignment visibility off `WinReached`
([How events feed projections](#how-events-feed-projections)).

`Seed` and `LogicalTime` carried on engine events are both `u64` (see
[09](09-engine-and-packs.md)): `Seed` is the recorded resolver RNG seed; `LogicalTime`
(`occurred_at`, `started_at`, `finished_at`) is monotonic logical time, never wall-clock.

### The trace

```rust
struct ResolutionTrace {
    phase_id: PhaseId,
    run_id: String,
    trace_version: u16,
    edges: Vec<TraceEdge>,          // redirect/interaction graph
    generated: Vec<GeneratedActionTrace>, // trigger-produced actions and action grants
    effect_changes: Vec<EffectDeltaTrace>,
    visibility: Vec<VisibilityTrace>,
    decisions: Vec<DecisionTrace>,  // which pack rule drove each outcome ← key for audit
    notes: Vec<String>,             // loop-cap hits, diagnostics
}
```

The trace is not folded into player-facing projections; it's the **audit + golden-test
oracle** ([09](09-engine-and-packs.md)). The pure resolver returns it beside
`ResolutionApplied`, the command seam persists both atomically, and projections validate it
on replay. The v1 resolver trace records the run id, phase id, schema version, a minimal
decision list derived from the emitted inner events, and effect deltas for `EffectsMarked`
and `EffectsCleared`; `generated` records `ActionGranted` and `ActionGrantConsumed` rows.
Graph/visibility detail is still pending richer resolver trace emission.

---

## How events feed projections

| Projection ([02](02-event-sourcing.md)) | Folds from |
|---|---|
| `votecount` (running) | `VoteSubmitted` / `VoteWithdrawn` |
| `votecount` (official) | `DayVoteOutcome` |
| `slot_state` (alive/dead/role/alignment/reveal flags) | `PlayerKilled/Saved/Converted`, `RoleAssigned`, `WinReached`, `GameCompleted` |
| `slot_effect` (persistent effect tags) | `EffectsMarked/Cleared` |
| `action_grant` (generated action/item inventory) | `ActionGranted/ActionGrantConsumed` |
| `player_notification` (per-recipient notices) | `EffectNotification`; exposed as wire `PlayerNotification` through capability-filtered REST |
| `host_prompt` (host/admin interventions) | `HostPromptIssued` / `HostPromptResolved` |
| `host_phase_control` (host prompt phase movement audit) | provenance-bearing `PhaseAdvanced`; exposed as host/cohost-only wire `HostPhaseControl` |
| `sheriff_badge` (badge owner/weight) | `BadgeChanged` |
| `slot_state.alive=false` for Knight duel deaths | `PlayerKilled` emitted with `DuelResolved` |
| `slot_state.alive=false` for lethal ITA hits | `PlayerKilled` emitted with `ItaShotResolved` |
| `thread_view` | `PostSubmitted/Edited/Retracted`, public `DayAnnouncement` / `LastWordsRecorded` / `PhaseAnnouncement` rows derived from `ResolutionApplied` |
| `phase_state` | `DeadlineSet/Extended`, `ThreadLocked/Unlocked`, `ResolutionApplied` |
| reveal flags | `PlayerKilled.death_reveal`, `WinReached`, `GameCompleted` |

The **running tally** is a cheap fold of submissions for live UX; the **official outcome** is
the engine's `DayVoteOutcome`. Both exist on purpose ([09](09-engine-and-packs.md)).

---

## Result contract & validation

Ported discipline from im-human's `V4_RESULT_CONTRACT.md`:

1. **Enumerated kinds.** `EventKind` and `InnerEvent` are closed enums. A payload whose kind
   isn't in the set is **rejected before persistence**, not stored and ignored.
2. **Per-kind versioning.** Each kind has its own `version` / the resolver has
   `result_version`. Evolution is additive ([02](02-event-sourcing.md),
   [04](04-wire-protocol.md)); upcasters handle old versions on replay.
3. **Validation at the boundary.** A resolver result and its trace are validated before they
   are appended; failure aborts the append with a typed, path-pointing error — never a
   silent partial write.
4. **Determinism preserved end to end.** Every field that could be nondeterministic (seed,
   timestamps, run_id) is captured *as data* at write time so replay is exact.

### Maintenance checklist (when adding an event kind)

1. Add the variant to `EventKind` / `InnerEvent`.
2. Define/version its payload struct in the `domain` crate; regenerate `wire` TS
   ([04](04-wire-protocol.md)).
3. Add the projection fold(s) it affects.
4. Add a golden-trace / parity test ([09](09-engine-and-packs.md)).
5. Bump `result_version` if it's an inner (resolution) event.

---

## Open calls carried forward

- **Vote syntax → submission parsing.** Strict tags (`##vote`) recommended
  ([01](01-domain-model.md)); the parser emits `VoteSubmitted`/`VoteWithdrawn`.
- **Initial IR vocabulary size.** v1 ships 8 abilities ([09](09-engine-and-packs.md)); the
  first real pack (pick one culture — mafiascum is the most documented) will tell us which
  ability to add first.
- **First pack to author.** Recommend mafiascum as the reference pack: best-documented
  precedence/visibility rules, exercises kill/protect/block/investigate/redirect without
  needing conversion-heavy mechanics on day one.

Next concrete step: encode this taxonomy as the `domain` + `wire` Rust types and author a
**minimal mafiascum pack** that exercises a night resolution and a day vote end-to-end — the
spine of the vertical slice ([08-roadmap](08-roadmap.md)).
