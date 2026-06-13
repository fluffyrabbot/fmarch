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

    // ── Submissions (platform → engine seam, doc 09) ──
    VoteSubmitted,          // { actor: slot, target: slot|no_lynch, phase_id }
    VoteWithdrawn,          // { action_id }
    ActionSubmitted,        // { action_id, template_id, actor, targets, phase_id }
    ActionWithdrawn,        // { action_id }

    // ── Host phase control ──
    DeadlineSet,            // { phase_id, at }   `at` captured as data (determinism)
    DeadlineExtended,
    ThreadLocked,           // { channel_id }
    ThreadUnlocked,
    PhaseAdvanceRequested,  // host triggers resolution of the current window

    // ── Engine output wrappers (see next section) ──
    ResolutionApplied,
    ResolutionTrace,
}
```

`VoteSubmitted` / `ActionSubmitted` are the persisted form of a
[Submission](09-engine-and-packs.md). When a window closes, the resolver folds every
non-withdrawn submission into engine events.

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
    DayVoteRecorded,        // { actor, target, withdrawn, sequence }  running ballots
    DayVoteOutcome,         // OFFICIAL outcome (engine+pack resolved)
    PhaseAnnouncement,      // deaths revealed at phase boundary

    // ── Core night results ──
    PlayerKilled,           // { slot_id, cause, attackers, unstoppable }  see below
    PlayerSaved,            // { slot_id, reasons, sources }
    PlayerConverted,        // { target, new_role, original_role, source }
    ConversionBlocked,      // { target, status, reason }

    // ── Persistent effects (Mark/Clear) ──
    EffectsMarked,          // { effect, target, actor }
    EffectsCleared,         // { effect, targets, actor }

    // ── Information ──
    InvestigationResult,    // { mode, investigator, target, result }  mode per InvestigateMode
    EffectNotification,     // { effect, status, audience }  RESERVED for Mark/Clear effects — NOT the roleblock channel

    // ── Interference ──
    ActionInterfered,       // { actor: SlotId, reason: String }  e.g. reason "roleblocked"

    // ── Reactive ──
    Trigger,                // { trigger_id, payload }  (vengeful/hunter/retaliation)

    // ── Win conditions ──
    WinReached,             // { winner, reason, metadata }
}
```

> **`ActionInterfered` vs `EffectNotification`.** When an action fails to resolve because it
> was interfered with (e.g. a roleblocked Cop), the resolver emits
> `ActionInterfered { actor, reason }` (reason `"roleblocked"`) addressed to the actor whose
> action was stopped, and emits **no** result event for the fizzled action (a roleblocked Cop
> gets no `InvestigationResult`). `EffectNotification` is **reserved for Mark/Clear effects**
> and is explicitly **NOT** the roleblock channel.

> **`PlayerKilled.unstoppable`.** `unstoppable = true` **iff the kill is inherently
> unpreventable by protection** — i.e. the killing action carries the `Strongman` modifier
> ([09](09-engine-and-packs.md)) — **REGARDLESS of whether a protect was actually present on
> the target**. It is a property of the kill, not of this particular night's matchup: a
> Strongman kill against an unprotected slot is still `unstoppable: true`; a plain kill that
> happened to land unopposed is `unstoppable: false`.

> **`cause` vocabulary (two fields, two layers).** `PlayerKilled.cause` is the killing
> action template's `id` (mechanical attribution, e.g. `"factional_kill"`). `Death.cause`
> (inside `PhaseAnnouncement`, below) is a **semantic** tag; the v1 vocabulary is
> `{ "lynch", "night_kill" }`. These are deliberately different fields serving different
> layers — do not conflate them.

`DayVoteOutcome` carries the full tally so projections and disputes have everything:

```rust
struct DayVoteOutcome {
    status: VoteStatus,             // Lynch | NoLynch | NoMajority | Tie | Hammer
    winner: Option<SlotId>,         // the eliminated slot, if any
    contenders: Vec<SlotId>,
    tallies: Map<SlotId, f64>,      // weighted counts
    votes: Map<SlotId, SlotId>,     // active ballots only (withdrawn omitted)
    weights: Map<SlotId, f64>,
    majority: Option<f64>,
    total_weight: f64,
    tiebreak: Option<String>,
    reason: Option<String>,
}

enum VoteStatus { Lynch, NoLynch, NoMajority, Tie, Hammer }
```

`Tie` is the explicit status for a plurality/parity tie with no eliminable winner (e.g. a 2-2
under `tie_breaker: NoElimination`); it is distinct from `NoLynch` (someone *chose* no-lynch)
and from `NoMajority` (a majority threshold was simply not reached).

`DayVoteOutcome.reason` is **optional, non-canonical human-readable prose** (the platform may
rewrite or localize it). It MUST NOT be relied on for replay and is **not part of the asserted
contract**: golden comparison ignores it. The resolver may still emit prose there for humans;
projections and disputes key off the structured fields (`status`, `winner`, `tiebreak`, the
tallies), never `reason`.

`PhaseAnnouncement` (deaths revealed at a phase boundary) has the pinned payload:

```rust
struct PhaseAnnouncement {
    phase_id: PhaseId,
    deaths: Vec<Death>,             // empty if no one died this resolution
}

struct Death { slot_id: SlotId, cause: String }
```

**Every resolution emits exactly ONE trailing `PhaseAnnouncement` as its final inner event.**
It lists the deaths produced in that resolution — for a night, the slots that got
`PlayerKilled` (each `{ slot_id, cause: "night_kill" }`, in event order); for a day, the
lynched slot if any (`cause: "lynch"`) — and is `deaths: []` when no one died. This single
canonical death-reveal signal always fires, even on a resolution that produces only saves,
interferences, or a tie. `Death.cause` is the **semantic** tag (`{ "lynch", "night_kill" }`),
distinct from `PlayerKilled.cause` (the action template `id`) above.

`Seed` and `LogicalTime` carried on engine events are both `u64` (see
[09](09-engine-and-packs.md)): `Seed` is the recorded resolver RNG seed; `LogicalTime`
(`occurred_at`, `started_at`, `finished_at`) is monotonic logical time, never wall-clock.

### The trace

```rust
struct ResolutionTrace {
    run_id: String,
    edges: Vec<GraphEdge>,          // redirect/interaction graph
    generated: Vec<GeneratedAction>,// trigger-produced actions
    effect_changes: Vec<EffectDelta>,
    visibility: Vec<VisibilityEmission>,
    decisions: Vec<DecisionSource>, // which pack rule drove each outcome ← key for audit
    notes: Vec<String>,             // loop-cap hits, diagnostics
}
```

The trace is not folded into player-facing projections; it's the **audit + golden-test
oracle** ([09](09-engine-and-packs.md)).

---

## How events feed projections

| Projection ([02](02-event-sourcing.md)) | Folds from |
|---|---|
| `votecount` (running) | `VoteSubmitted` / `VoteWithdrawn` |
| `votecount` (official) | `DayVoteOutcome` |
| `slot_state` (alive/dead/role/effects) | `PlayerKilled/Saved/Converted`, `EffectsMarked/Cleared`, `RoleAssigned` |
| `thread_view` | `PostSubmitted/Edited/Retracted`, `PhaseAnnouncement` |
| `phase_state` | `DeadlineSet/Extended`, `ThreadLocked/Unlocked`, `ResolutionApplied` |
| reveal flags | `WinReached`, `GameCompleted` (flip role visibility) |

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
3. **Validation at the boundary.** A resolver result is validated (`validate!`) before it's
   appended; failure aborts the append with a typed, path-pointing error — never a silent
   partial write.
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
