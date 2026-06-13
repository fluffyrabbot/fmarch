# 09 — The resolution engine & ruleset packs

This is the multi-ruleset core, ported in **minimum robust form** from the prior
`apps/im-human` engine (its "GodEngine" / Engine V4). That project's lasting insight — and
the thing legacy forum-mafia software never has — is that **roles are data, not code**: they
compile to a small closed set of primitive abilities, and an entire culture (mafiascum, MU,
Chinese structured werewolf, epicmafia, copyright-free social-deduction variants) is a
**pack** of declarative tables over that IR, resolved by one deterministic engine.

We keep that structure. We drop everything im-human carried for AI players, RL dataset
generation, and moderation — none of which belongs in fmarch (a *human* forum platform).

## The two layers (the central simplification)

im-human entangled the deduction engine with its AI-simulation harness. Splitting them is
the whole game:

```
┌─ PLATFORM LAYER (docs 01–07) ──────────────────────────────────────┐
│  users, slot↔user occupancy & replacement, channels, posts,        │
│  capabilities, wire, images. Parses posts → submissions.           │
│  Persists engine output into the same event log.                   │
└───────────────▲──────────────────────────────────────┬────────────┘
   submissions  │                                       │ resolution events
┌───────────────┴───────────────────────────────────────▼────────────┐
│  ENGINE LAYER (this doc + 10)                                       │
│  slots(seats) · phases · packs/IR · resolver · events + trace      │
│  PURE. Deterministic. Knows NOTHING about users / accounts /        │
│  replacement / channels.                                            │
└─────────────────────────────────────────────────────────────────────┘
```

- The engine operates only on **slots** (`SlotId`) — the stable seat identity. It never sees
  `UserId`. This is exactly the `User ≠ Slot` distinction from
  [01-domain-model](01-domain-model.md): the engine *is* the layer that proves it's worth
  enforcing. **Replacement is purely a platform concern** — swap the human behind a stable
  `SlotId`; the engine is never told and never cares.
- The engine corresponds to the Rust `domain` crate ([03-backend](03-backend.md)) — pure,
  IO-free, deterministic, exhaustively testable. The pack tables and resolver live here.

## The IR: a closed set of primitive abilities

Every role action compiles to one **IR ability**. The set is **closed and versioned**
(`ir_version`), so the vocabulary evolves additively without breaking existing packs.

### v1 vocabulary (structure-complete, vocabulary-minimal)

We ship the full pack *structure* but a deliberately small *vocabulary*, then grow it:

```rust
/// IR ability vocabulary. Closed set, versioned by `ir_version`.
/// v1 ships these 8; additions (poison, delay, busdrive, grant, remove,
/// retaliate, …) are additive and gated behind a higher ir_version.
enum IrAbility {
    Kill,         // remove a slot from play (subject to precedence)
    Protect,      // guard a slot against kill (doctor/bodyguard family)
    Block,        // prevent a slot's action from resolving (roleblock)
    Redirect,     // change a slot action's target (bus driver / redirect)
    Investigate,  // produce an information result; see InvestigateMode
    Convert,      // change a slot's role/alignment (recruit/cult)
    Mark,         // attach a persistent effect to a slot
    Clear,        // remove a persistent effect from a slot
}

/// Investigate is parameterized rather than split into many primitives.
enum InvestigateMode { Parity, Track, Watch, Motion }
```

> Why this subset: it covers the common roles across all four target cultures (cop, doctor,
> roleblocker, bus driver, tracker/watcher, recruiter, and persistent-effect roles like
> poisoner via `Mark`+a delayed trigger). `retaliate`, `poison`, `delay`, `busdrive` as a
> distinct primitive, etc. arrive via **triggers** (below) and later `ir_version` bumps —
> never a breaking change. (im-human's full set is ~16: `kill, protect, block, redirect,
> busdrive, investigate, track, watch, convert, poison, delay, mark, clear, grant, remove,
> retaliate`. We grow toward it as packs demand.)

### Modifiers

Capability flags that adjust how an ability interacts with the precedence/visibility tables:

```rust
enum Modifier {
    Strongman,    // kill bypasses protect
    Ninja,        // action hidden from track/watch/investigate
    Loyal,        // immune to conversion
    Roleblockable,// action can be stopped by Block (default true for most)
    Reflexive,    // self-targeting variant
    // x_shots is a *constraint* (a count), not a flag — see Constraints
}
```

## The pack: declarative tables over the IR

A pack is one culture's complete ruleset, as data. fmarch **adds two tables** that im-human
kept outside its pack but which are genuinely culture-specific: `vote` and `phases`.

```rust
struct Pack {
    name: String,
    version: u32,        // this pack's revision
    ir_version: u16,     // IR vocabulary it targets
    roles: Map<RoleKey, Role>,
    precedence: Vec<PrecedenceRule>,        // conflict resolution
    visibility: Map<IrAbility, VisibilityRule>,
    redirects: RedirectPolicy,
    triggers: Vec<TriggerRule>,
    vote: VotePolicy,    // NEW vs im-human: vote rules are culture-specific
    phases: PhasePolicy, // NEW: cadence / subsegments per culture
}
```

### Roles → action templates

```rust
struct Role {
    description: String,
    alignment: Option<AlignmentKey>,   // pack-defined; engine treats as opaque tag
    actions: Vec<ActionTemplate>,
}

struct ActionTemplate {
    id: String,
    ability: IrAbility,
    window: Window,                 // Day | Night | Any
    targets: TargetSpec,            // None | One | Many{max} | Group
    modifiers: Vec<Modifier>,
    constraints: Constraints,
}

struct Constraints {
    max_targets: u16,
    self_allowed: bool,
    unique_targets: bool,
    roleblockable: bool,
    priority: i32,                  // resolution priority within a window
    x_shots: Option<u16>,          // limited-use abilities
}
```

### Precedence — who beats whom

```rust
struct PrecedenceRule {
    id: String,
    when: PrecedenceWhen,           // { effect: IrAbility, target_state: Option<String> }
    beats: Vec<IrAbility>,
    blocked_by: Vec<IrAbility>,
    unless_modifiers: Vec<Modifier>,// e.g. Protect beats Kill UNLESS Strongman
    notes: String,
}
```

### Visibility — what a result reveals

```rust
struct VisibilityRule {
    sees: Vec<VisField>,            // ActorId | TargetId | ActionType | Result | VisTag
    unless_modifiers: Vec<Modifier>,// e.g. tracker sees target UNLESS Ninja
}
```

### Redirects — fixpoint policy

```rust
struct RedirectPolicy {
    order: Vec<IrAbility>,
    loop_cap: u16,                  // termination guard for redirect cycles
    tie_breaker: TieBreaker,        // Stable | Random | First
}
```

### Triggers — reactive abilities

"On ability X against a slot that has Y, produce ability Z." This is how vengeful/hunter,
guard retaliation, and delayed-poison are expressed without new primitives.

```rust
struct TriggerRule {
    id: String,
    on: IrAbility,
    if_target_has: Vec<Tag>,        // modifiers/effects the target must carry
    produces: TriggerProduction,    // { ability, actor: ActorRef, target: TargetRef, modifiers }
}

enum ActorRef  { Actor, Target, TargetGuard, Other }
enum TargetRef { Actor, Target, Killer, Other }
```

### Vote policy (fmarch addition)

Vote weight, majority vs plurality, tiebreaks, and no-lynch are culture-specific, so the
**official day outcome is resolved by the engine under the pack** — not by a forum
projection. The live running tally remains a cheap projection
([02-event-sourcing](02-event-sourcing.md)), but the *authoritative* `day.vote.outcome`
([10-event-schema](10-event-schema.md)) is engine-emitted.

```rust
struct VotePolicy {
    method: VoteMethod,             // Plurality | Majority | Supermajority{num,den}
    no_lynch_allowed: bool,
    self_vote_allowed: bool,
    hammer: bool,                   // does reaching threshold end the day immediately?
    weights: WeightPolicy,          // Equal | PerRole(Map<RoleKey,f64>) | Dynamic
    tie_breaker: VoteTieBreaker,    // NoElimination | Random | HostDecides | EarliestReached
}
```

### Phase policy (fmarch addition)

Phases are ordered, zero-padded, culture-parameterized (from im-human's `ID_SEMANTICS.md`):

```rust
struct PhasePolicy {
    cadence: Vec<PhaseKind>,        // e.g. [Day, Night] or [Day, Night, Twilight]
    subsegments: Map<PhaseKind, Vec<Subsegment>>, // SOD/EOD windows, optional
    twilight: bool,                 // explicit twilight phase between night and next day
}
// phase_id is rendered zero-padded for lexicographic order: "D01", "N01", "T01",
// with optional lowercase subsegment suffixes: "D01a".."D01e".
```

For v1 we ship **only the forum cadence** (long day with SOD/EOD subsegments, two-segment
night, optional twilight). Chat-mafia / real-time variants are future packs; the structure
already accommodates them.

## Submissions: the platform → engine seam

The platform parses human activity (vote posts, night-action forms) into **submissions**.
The engine consumes a window's submissions and resolves them. Submissions are the *only*
input crossing into the engine besides state + pack + seed.

```rust
struct Submission {
    action_id: String,
    actor: SlotId,                  // the acting seat; never a UserId
    template_id: String,            // which of the actor's role actions
    targets: Vec<SlotId>,
    phase_id: PhaseId,
    submitted_at: LogicalTime,      // deterministic; never wall-clock
    withdrawn: bool,                // votes/actions can be retracted before resolution
    metadata: Map<String, Json>,
}
```

A **day vote is just a submission** whose template resolves to the vote, retractable via
`withdrawn`. This unifies night actions and votes under one ingestion path.

## The resolver contract

```rust
fn resolve(input: ResolutionInput) -> ResolutionOutput

struct ResolutionInput {
    game_id: GameId,
    phase_id: PhaseId,
    state: StateSnapshot,           // slots, roles, persistent effects, alive/dead
    submissions: Vec<Submission>,
    pack: Pack,
    seed: Seed,                     // resolver RNG seed; part of the inputs
}

struct ResolutionOutput {
    events: Vec<DomainEvent>,       // deterministic, ordered (see 10)
    trace: ResolutionTrace,         // which table/rule drove each decision
}
```

`resolve` is **pure**: same inputs ⇒ same outputs, always. Its output is persisted as a
`resolution.applied` envelope plus a `resolution.trace` event
([10-event-schema](10-event-schema.md)).

## Determinism rules (non-negotiable — inherited from im-human)

These are load-bearing for replay ([02-event-sourcing](02-event-sourcing.md)) and for
dispute resolution:

1. **Seeded RNG only.** The engine never calls system randomness; all randomness comes from
   the `seed` in `ResolutionInput`. The seed is recorded as event data.
2. **Logical time only.** No wall-clock inside resolution. `submitted_at` and engine
   timestamps are monotonic logical time, captured as data at write time.
3. **Stable ordering.** Equal-time events are ordered by stable id. Resolution order is
   explicit (priority, then stable id), never hash-map iteration order.
4. **Bounded fixpoints.** Redirect and trigger chains have explicit `loop_cap`; on reaching
   it the engine emits a diagnostic note and terminates deterministically.
5. **No hidden global state.** All transient resolution state (target maps, graph,
   effect pool, audits) lives in the resolution context and is reflected in the trace.

## The trace: cross-ruleset auditability

Every resolution emits a `resolution.trace` recording graph edges, generated (triggered)
actions, persistent-effect changes, visibility emissions, and — critically — **the
decision source** (which precedence/visibility/redirect rule drove each outcome). This is
what lets a host explain "why did the strongman kill go through the doctor?" across any
pack. It's also the regression-test oracle (golden traces).

## What we deliberately dropped from im-human

Recorded so it isn't re-added by reflex:

- **AI-player machinery** (`ita.*`, `ai_*`, persona/distribution schemas) — fmarch is human.
- **RL dataset apparatus** (`turn_id`, `decision_seq_in_phase`, `tick_seq_*`, …) — we keep
  only `seq` + `phase_id` + post ordering.
- **Moderation-as-engine-events** (`user.muted/shadowbanned/censored/flagged`) — these are
  platform events ([10](10-event-schema.md)), not engine events.
- **Dual `version` + `event_version` fields** — collapsed to one explicit per-type version.
- **Non-forum phase cadences** — kept expressible in `PhasePolicy`, but not shipped in v1.

See [10-event-schema](10-event-schema.md) for the concrete event taxonomy and result
contract.
