# RFC 0001 — First-class replay and history explorer

| Field | Value |
|---|---|
| **Status** | Accepted |
| **Created** | 2026-08-04 |
| **Accepted** | 2026-08-04 |
| **Decision owner** | Project owner |
| **Target** | First public history slice |
| **Related** | [01-domain-model](../arch/01-domain-model.md), [02-event-sourcing](../arch/02-event-sourcing.md), [10-event-schema](../arch/10-event-schema.md), [13-interaction-architecture](../arch/13-interaction-architecture.md) |

## Summary

Add a first-class public history explorer at `/games/{game}/history`. It presents a
server-authored snapshot of public game state at one durable moment, a scrubber over
meaningful public state changes, and an exact share link for the selected moment.

The first version is a **public-knowledge replay**, not an omniscient replay. Scrubbing
back to Day 1 shows only what was public by that moment, even after the game has ended.
Later deaths, replacements, role flips, and the terminal reveal disappear when the
cursor moves before them. Private submissions, private channels, unrevealed roles,
resolver internals, credential principals, and host-only evidence never cross the
response boundary.

Named replacement history is first-class. A game-scoped public persona is distinct
from both the credential principal and the stable slot, while a time-bounded occupancy
epoch records when that persona sat in the slot. This lets the explorer say “Alicia
replaced Rowan in Slot 7” without joining immutable game history to a mutable profile.

The explorer is snapshot-first rather than animation-first. Its primary question is:

> What did the public game look like immediately after this meaningful change?

The canonical moment is an event coordinate, but the URL exposes a stable opaque
`moment_id`, not raw event structure. The browser renders server-computed state and
does not reimplement votes, reveal policy, replacement identity, or engine rules.

## Why now

The domain and storage architecture already make history a first-class truth:

- one immutable, ordered stream owns the game;
- phases partition game activity;
- votes and posts attach to stable slots;
- replacements change occupancy without rewriting slot history;
- deaths and reveals are explicit events;
- projection replay is deterministic and already audited.

What is missing is a supported, presentation-safe read model. Current projection
rebuild tooling proves correctness for operators, the endgame summary exposes only a
terminal slice, and the public game page is a reading publication. None answers
“what was true just after that vote?” or gives that answer a durable URL.

The history explorer turns the event-sourced substrate into a visible product
advantage without exposing the raw stream as a public API.

## Goals

1. Let an anonymous reader move through phases, votes, vote withdrawals,
   replacements, deaths/lifecycle changes, public revelations, and game completion.
2. Show an authoritative public-state snapshot after each selected moment:
   phase, public deadline/lock posture, running votecount, slot lifecycle, occupancy
   epoch with its historical public persona name, public role/alignment facts, and
   terminal result when applicable.
3. Give every selected moment a durable, exact, copyable URL.
4. Preserve the historical knowledge boundary. A past snapshot must not gain facts
   merely because those facts became public later.
5. Remain useful on phone, tablet, desktop, keyboard-only navigation, 200% reflow,
   reduced motion, and forced colors.
6. Feel immediate while keeping game rules and redaction on the server.
7. Rebuild deterministically from the existing game stream.
8. Preserve named replacement history across profile edits, account-method changes,
   returning occupants, explicit game-name changes, and privacy pseudonymization.

## Non-goals for the first version

- Omniscient or “show me the hidden setup” replay.
- Player-private, factional, dead-chat, role-PM, or host/cohost replay.
- Resolver trace visualization. `ResolutionTrace` remains host/operator evidence.
- Counterfactual simulation or changing past commands.
- Autoplay, cinematic transitions, sound, reenactment, or a replay “video.”
- Treating every post as a scrubber stop or replaying the thread body as-of edits.
- Replacing the public game publication. History is a sibling reading mode.
- Public raw-event export.
- Persistent full-state snapshots before a measured replay SLO requires them.
- A generic event-inspection framework shared with admin tooling.

## The product boundary

### Audience and availability

The first slice has the same availability class as the public game publication:
started games may be read anonymously, whether active or complete. Setup streams do
not become public merely because the history endpoint exists.

An active game's explorer ends at the latest committed public moment. It never moves
the reader automatically when new activity arrives. If the reader is at the latest
moment and newer history exists, the UI offers **View latest**. A reader studying an
older moment is not pulled forward.

### Historical knowledge, not present-day hindsight

The snapshot is produced by folding the stream through the selected coordinate and
then applying the public visibility policy at that same coordinate.

Examples:

| Selected moment | Public snapshot behavior |
|---|---|
| Before a replacement | Shows Rowan's prior occupancy epoch |
| After a replacement | Shows Lark's new epoch; slot-authored votes/history stay with the slot |
| Before a death | Slot is alive; no death reveal is visible |
| After a full-flip death | Slot is dead and its now-public role/alignment are visible |
| Before an Innocent Child reveal | Alignment remains hidden |
| After the reveal | Public alignment appears |
| Before game completion | Unrevealed roles remain hidden |
| At completion | Terminal public reveal and winner appear |

This is deliberately stricter than applying today's reveal flags to an old state.
“What is publicly known now about Day 1?” is a different, useful analysis lens, but it
is not the first version.

### Public identity boundary

Named history uses four deliberately separate concepts:

```text
Principal ──private binding──▶ GamePersona ──during──▶ OccupancyEpoch ──occupies──▶ Slot
   auth                         public name             time interval              game truth
```

- **Principal** owns authentication and authority. It never appears in a public
  history response.
- **Game persona** owns one public identity within one game. It has an opaque
  `persona_id` and event-folded public name; it is not a profile and is not reused
  across games.
- **Occupancy epoch** is one uninterrupted stint by a persona in a slot. It has an
  opaque `occupancy_id`, start coordinate, optional end coordinate, and typed end
  reason.
- **Slot** remains the engine seat and owns role, alignment, lifecycle, votes, posts,
  and action history across every replacement.

One principal has at most one persona in a game, but that persona may have multiple
occupancy epochs if the same person returns. Each epoch remains distinct, so the UI can
say “Alicia returned to Slot 7” without conflating the two stints. A persona may occupy
at most one open epoch and a slot may have at most one open epoch.

The host supplies and confirms the public game name when the persona is first
registered. Setup may suggest a safe existing display label, but must never silently
publish an email address, account id, external identity subject, or credential
principal. Names are normalized, bounded, and game-wide case-insensitively unique.
A normalized name claimed by one persona is not later recycled to another persona in
the same game, even after a replacement, because reuse would make old prose ambiguous.

An ordinary correction or game-name change is an explicit `GamePersonaRenamed` fact.
Snapshots before it retain the prior name; snapshots after it use the new name. The
moment itself reads, for example, “Alicia now goes by Lark.” Current profile edits
and authentication-method changes have no effect on game history.

Member-lifecycle pseudonymization is different from an ordinary rename. A typed
redaction overlay may replace a persona name across every public moment to preserve a
coherent retained record without retaining the public identifier. The selected moment
and persona identity remain stable, but presentation and cache revision change. This is
the narrow, explicit exception to pure as-of naming required by the 1.0 member-data
lifecycle policy.

No response or public projection may contain `principal_user_id`, raw
`outgoing_user`, raw `incoming_user`, account id, external subject, or another
credential identifier. Public replacement copy is rendered from persona and occupancy
facts only: **Lark replaced Rowan in Slot 7**.

### Persona and occupancy facts

Cut directly from the current mutable slot-to-user payload shape to explicit facts:

```rust
struct GamePersonaRegistered {
    persona_id: GamePersonaId,
    subject_id: SubjectId,
    claim_id: ClaimId, // sealed GamePersonaPresentation for this game/persona
}

struct GamePersonaRenamed {
    persona_id: GamePersonaId,
    subject_id: SubjectId,
    claim_id: ClaimId, // a replacement sealed presentation, never a new owner
}

struct SlotOccupancyStarted {
    transition_id: OccupancyTransitionId,
    occupancy_id: OccupancyId,
    slot_id: SlotId,
    persona_id: GamePersonaId,
    reason: OccupancyStartReason, // Initial | Replacement | Return
}

struct SlotOccupancyEnded {
    transition_id: OccupancyTransitionId,
    occupancy_id: OccupancyId,
    slot_id: SlotId,
    persona_id: GamePersonaId,
    reason: OccupancyEndReason, // Replaced | Withdrawn | Removed
}
```

An initial assignment atomically registers the persona when needed and starts an
epoch. A replacement atomically appends `SlotOccupancyEnded` for the current epoch and
`SlotOccupancyStarted` for the incoming persona with the same `transition_id`. The
public moment classifier coalesces that pair into one replacement moment after the
start fact. A vacancy ends an epoch without starting another; a later return starts a
new epoch.

Do not keep `SlotAssigned`/`ReplacementCompleted` as a second canonical occupancy
language. This is a pre-1.0 greenfield refactor: update fixtures and projection rebuilds
to the epoch model, then resolve breakage forward. The live authority selector reads
the one open occupancy epoch and follows its private persona-to-principal binding;
engine input continues to see only the slot.

## UX shapes considered

### Shape A — Thread with a time lens

Put the scrubber above the existing public thread and change the thread, votecount,
and roster as time moves.

Advantages:

- preserves the familiar reading context;
- makes “what happened around this post?” intuitive;
- can eventually support post-addressed history links.

Problems:

- thread scroll position and history time become competing navigation axes;
- as-of post editing/retraction and pagination become part of the first slice;
- long games make every scrub action expensive and visually disruptive;
- the public publication's deliberately quiet reading shape becomes an application.

**Decision:** do not use this as the first shape. Add links between the publication
and history instead.

### Shape B — Forensic event ledger

Render a filterable list of event rows with a detail inspector.

Advantages:

- close to the underlying stream;
- easy to paginate;
- useful for hosts and engine developers.

Problems:

- answers “which events exist?” rather than “what was the game state?”;
- pushes readers to mentally fold votes, deaths, and replacements;
- raw event language leaks implementation concepts and invites unsafe exposure;
- dense tables degrade poorly on phone and at 200% reflow.

**Decision:** reserve this shape for host/operator evidence, not public history.

### Shape C — Omniscient playback

Show all roles from the beginning and animate phases/actions like a game replay.

Advantages:

- dramatic completed-game experience;
- useful for strategy review;
- makes causal chains visible.

Problems:

- creates a second, much harder visibility model;
- conflates public history with private resolver trace;
- encourages autoplay, transition, and graph scope before basic history is proven;
- cannot safely serve active games under the public read boundary.

**Decision:** possible later as an explicit completed-game lens, never as an implicit
mode of the public explorer.

### Shape D — Snapshot plus meaningful-moment timeline

Show one authoritative state canvas, a compact description of what just changed, and
a scrubber whose stops are meaningful public state transitions.

Advantages:

- directly answers the product question;
- separates time navigation from thread reading;
- has a useful server-rendered and no-JavaScript form;
- adapts cleanly from one column to wider layouts;
- keeps the API snapshot-shaped and redacted.

Cost:

- needs a purpose-built public history reducer and moment index;
- does not initially reenact the conversation between state changes.

**Decision:** adopt Shape D.

## Recommended interaction model

### Page anatomy

The document order is:

1. **History masthead** — game label, active/complete status, selected phase, and a
   link back to the public thread.
2. **Moment transport** — previous, next, phase jump, native range scrubber, latest,
   and copy-link controls.
3. **What changed** — one plain-language statement for the selected moment, such as
   “Slot 4 voted Slot 9” or “Night 2 ended; Slots 3 and 11 died.”
4. **State at this moment** — phase posture, running votecount, roster/lifecycle,
   revealed facts, and winner when present.
5. **Nearby moments** — a short chronological list around the cursor for precise
   selection without dragging.
6. **Record provenance** — states that this is public knowledge as of the selected
   moment and links to the current public thread near the closest preceding post.

Conceptually:

```text
┌ History · Day 2 ─────────────────────────── Back to thread ┐
│ [Prev]  Day 1 | Night 1 | Day 2 ━━━●━━━━  63 / 214 [Next] │
│                                   [Latest] [Copy moment]   │
├ What changed ──────────────────────────────────────────────┤
│ Slot 4 withdrew their vote from Slot 9.                   │
├ State at this moment ──────────────────────────────────────┤
│ Day 2 · voting open       Votecount                        │
│ 13 alive · 2 dead         Slot 9  █████  5 / 8            │
│                           Slot 2  ███    3                 │
│ Roster: stable slot rows, occupancy epochs, public flips  │
├ Around this moment ────────────────────────────────────────┤
│ 61 Slot 8 voted Slot 9                                    │
│ 62 Lark replaced Rowan in Slot 2                          │
│ 63 Slot 4 withdrew ← selected                             │
│ 64 Deadline extended                                      │
└────────────────────────────────────────────────────────────┘
```

The visual is illustrative, not a card mandate. In keeping with the interaction
architecture, typography, rules, and spacing should do most of the grouping.

### Scrubber semantics

- The range value is a **public moment ordinal**, not a raw event sequence.
- Pointer movement updates the preview label locally; authoritative state is fetched
  on commit, not on every pointer pixel.
- Arrow keys move one moment. Page Up/Page Down move to phase boundaries. Home/End
  move to the first/latest public moment.
- Previous/next buttons are always present and remain ordinary links without
  JavaScript.
- The slider shows phase segmentation and marker emphasis for phase changes, deaths,
  replacements, and reveals. Vote stops remain selectable without giving each one a
  visually dominant tick.
- Scrubbing uses `replaceState`, so moving through 100 votes does not create 100 Back
  entries. Arriving from or leaving for another page retains normal browser history.
- Selection moves no focus. After a snapshot loads, a polite status announcement says
  the moment label and phase; focus remains on the control the reader used.

### Share links

The browser route is:

```text
/games/{game}/history?at={moment_id}
```

With no `at`, the route opens the latest public moment. Once loaded, the browser URL is
replaced with the exact `moment_id`, so copying the address always captures a fixed
state rather than a moving “latest.”

`Copy moment` copies the same URL and confirms inline. Filters and expanded roster
details remain local UI preferences in the first version; they do not enter the
canonical link.

### Relationship to posts

Posts do not become scrubber stops in the first version. Votes and commands can occur
between posts, and a post-heavy game would make the transport unusable if every post
were a stop.

The explorer provides **Open thread near this moment**, resolving to the closest
public main-thread post at or before the selected outer stream sequence. The public
thread may link back to the explorer with “View game state here” later. Reconstructing
post bodies as they appeared before later edits/retractions is separate scope.

## Responsive behavior

The same semantic document order is used at every width.

### Phone

- One column; no horizontal roster table.
- Moment transport is a compact sticky bottom region with 44px controls and safe-area
  padding. It must not cover the selected state heading or final roster row.
- Phase jump is a native select; roster rows are stacked label/value groups.
- “What changed” appears immediately before the state it changes.

### Tablet (primary design width, 1024–1280px)

- Timeline spans the content width.
- “What changed” and the compact phase/votecount summary may sit side by side when
  both remain readable; roster continues below at full width.
- No permanent inspector rail is introduced.
- Touch targets remain at least 44px and no function depends on hover.

### Desktop

- Content stays within a bounded history measure rather than stretching tables across
  the viewport.
- Extra width may place the nearby-moments list beside the state canvas, but the DOM
  order remains state before nearby moments.
- The number of initially expanded information regions does not increase with width.

### Motion and reflow

- State changes use no required animation. A subtle change highlight is optional and
  disabled by `prefers-reduced-motion`.
- At a 720px CSS viewport (the 200% reflow equivalent used by existing proof), there
  is no horizontal page overflow.
- Forced-colors mode preserves selected-moment, vote-leader, dead/alive, and focus
  boundaries without relying on color alone.
- A native range control is an enhancement, not the sole means of navigation.

## What counts as a moment

A public moment is a committed coordinate after which public state or public game
interpretation meaningfully changes.

Initial included classes:

| Family | Included moments |
|---|---|
| Phase | start/advance, public deadline change, public thread lock/unlock |
| Vote | submission, replacement ballot, withdrawal, hammer, official day outcome |
| Occupancy | named replacement, withdrawal/vacancy, return, public persona rename |
| Lifecycle | death, modkill, alive restoration if supported, public status change |
| Reveal | public role reveal, public alignment reveal, phase death announcement |
| Terminal | winner reached, game completed |

The moment classifier is an allowlist. Unknown event or inner-event kinds fail closed:
they do not silently become public timeline entries.

Public DayEvent/program activity, public rewards, badges, duels, ITA shots, and future
pack-specific announcements should enter through an explicit second classifier table
once the core families are proven. The reducer may already fold their public effects;
classification determines navigation and copy, not domain truth.

`ResolutionApplied` contains multiple ordered inner events. Therefore a history
coordinate is not merely `stream_seq`:

```rust
struct HistoryCoordinate {
    stream_seq: i64,
    inner_index: Option<u32>, // None = after a top-level platform event
}
```

Selecting a public inner event folds all preceding events in the envelope through that
inner index, including hidden facts needed for correct later state, and then redacts the
output. Hidden inner events are never moment rows and never appear in labels or nearby
lists.

## Durable moment identity

Raw `stream_seq` plus inner index is an internal event-store coordinate and would leak
resolution structure. A share link instead uses a deterministic opaque
`HistoryMomentId`, for example a versioned base32 digest over game id, coordinate, and
event kind:

```text
hm1_7F5K2Q9M...
```

Properties:

- identical projection rebuilds produce identical ids;
- the id does not disclose raw sequence or inner-event count;
- old ids remain resolvable after new events append;
- changing presentation copy does not change the id;
- a classifier/version change must retain aliases for any id already served.

Opaque identity is an API-stability and presentation boundary, not an authorization
mechanism. Only indexed public moments resolve, and no security decision depends on a
moment id being unguessable.

The ordinal used by the range control is computed from ordered moment rows at read time.
It is navigation metadata, not durable identity.

## Architecture

### 1. First-class persona and occupancy projections

Replace the live-only `slot_occupancy` shape with projections that preserve both the
private subject binding and the full public occupancy history. Canonical game events
carry only UUID references; the public name lives in a sealed subject claim and is
resolved at the application boundary before append:

```text
game_persona
  game_id
  persona_id
  registered_seq

game_persona_subject_binding
  game_id
  persona_id
  subject_id
  current_claim_id          nullable only when redacted
  lifecycle                 active | redacted

game_persona_public
  game_id
  persona_id
  current_public_name
  registered_seq
  renamed_seq

game_persona_name_history
  game_id
  persona_id
  effective_seq
  public_name

game_persona_name_claim
  game_id
  normalized_name
  persona_id
  first_claimed_seq

slot_occupancy_epoch
  game_id
  occupancy_id
  transition_id
  slot_id
  persona_id
  began_seq
  ended_seq              nullable
  start_reason
  end_reason             nullable

game_persona_redaction
  game_id
  persona_id
  replacement_public_name
  redacted_at

game_history_publication
  game_id
  publication_revision
```

Use partial unique constraints for one open epoch per slot and one open epoch per
persona. A current-occupancy query is a view/selector over open epochs, not a separately
writable table. Capability resolution joins that private selector to
`game_persona_subject_binding`, then `privacy_subject`; public history has no reason
to query either authority table and joins only `game_persona_public`, persona id, and
as-of name history. The physical split keeps a convenient public query from
accidentally selecting a credential binding. Redaction clears `current_claim_id` and
marks the binding redacted; an alias is public presentation only, never a principal.

Name-claim ownership and rename history are synchronously projected from the game
stream. The claim table has a unique `(game_id, normalized_name)` key and permits an
existing owner to reclaim its own earlier name, but never transfers that name to a
different persona. The member-lifecycle redaction projection is applied after the as-of
fold and increments the game's `publication_revision`; it never mutates game events or
binds a public persona back to credentials.

### 2. A dedicated public moment index

Add a small, rebuildable synchronous projection containing navigation metadata, not
full state snapshots:

```text
public_game_history_moment
  game_id
  moment_id
  stream_seq
  coordinate_index     -1 for a top-level event; otherwise inner event index
  phase_id             nullable
  kind                 closed public presentation kind
  subject_slots        presentation-safe slot ids only
  subject_personas     presentation-safe game persona ids only
  occurred_at
  nearest_public_post_seq nullable

  PK (game_id, moment_id)
  UNIQUE (game_id, stream_seq, coordinate_index)
  INDEX (game_id, stream_seq, coordinate_index)
```

The projection is appended in the same transaction as other required read models and
is fully rebuildable. It contains no private payload, user principal, role assignment,
channel body, resolver trace, free-form host reason, or copied persona name. Labels are
rendered from the historical persona fold plus the current redaction overlay so a rename
or required pseudonymization cannot leave stale prose in the moment index.

Store typed facts needed to render a stable label; do not persist localized prose as
the canonical contract. `kind` is closed and unknown kinds reject during projection
development rather than falling back to raw event names.

### 3. One pure public-history fold

Implement one Rust reducer that accepts an upcasted stream prefix and selected inner
coordinate and returns an internal historical state. A separate redaction/presentation
step returns `PublicHistorySnapshot`.

The browser must not:

- tally ballots;
- infer hammer thresholds;
- apply death reveal rules;
- join replacement personas to credential users or mutable profiles;
- interpret resolution events;
- decide whether a fact was public.

At the latest coordinate, the reducer's public outputs must agree with the existing
authoritative public projections for phase, votecount, slot lifecycle/reveal, and game
result. This equivalence is a proof obligation, not duplicated business logic allowed
to drift.

The greenfield-pre-1.0 stance favors extracting shared pure fold functions from current
projection arms where necessary. Do not create a compatibility adapter that preserves
two independent interpretations.

### 4. Prefix loading, not raw export

Add an event-store read that loads an upcasted game stream through a coordinate. It is
an internal repository capability and never a public raw-event endpoint. The history
service folds that prefix, fetches the selected moment plus neighbors and phase jumps,
redacts it, and returns one bounded response.

Persistent per-moment state snapshots are deferred. First measure replay against a
representative 60-slot long-game stream. If the cold SLO fails, add deterministic
checkpoints at phase boundaries or a declared event interval; do not store a full
roster/votecount copy for every vote by default.

### 5. HTTP read contract

Use one public endpoint:

```http
GET /games/{game}/history
GET /games/{game}/history?at={moment_id}
GET /games/{game}/history?ordinal={positive_integer}
```

`at` and `ordinal` are mutually exclusive. `ordinal` exists for enhanced range
navigation; every successful response supplies `canonical_moment_id`, and the browser
rewrites the URL to `at`.

Illustrative response:

```json
{
  "version": 1,
  "game": "uuid",
  "canonical_moment_id": "hm1_7F5K2Q9M",
  "publication_revision": 3,
  "bounds": { "ordinal": 63, "count": 214, "is_latest": false },
  "moment": {
    "kind": "vote_withdrawn",
    "label": "Slot 4 withdrew their vote from Slot 9",
    "phase_id": "D02",
    "occurred_at": 1785864000
  },
  "navigation": {
    "previous": "hm1_...",
    "next": "hm1_...",
    "previous_phase": "hm1_...",
    "next_phase": "hm1_...",
    "latest": "hm1_..."
  },
  "phases": [
    { "phase_id": "D01", "first_ordinal": 1, "last_ordinal": 48 },
    { "phase_id": "N01", "first_ordinal": 49, "last_ordinal": 55 },
    { "phase_id": "D02", "first_ordinal": 56, "last_ordinal": 104 }
  ],
  "state": {
    "phase": { "phase_id": "D02", "kind": "day", "number": 2, "locked": false },
    "votecount": [],
    "slots": [
      {
        "slot_id": "slot-2",
        "occupancy": {
          "occupancy_id": "00000000-0000-0000-0000-000000000002",
          "persona_id": "00000000-0000-0000-0000-000000000001",
          "public_name": "Lark",
          "stint": 1
        },
        "status": "alive",
        "role": null,
        "alignment": null
      }
    ],
    "winner": null
  },
  "nearby_moments": [],
  "thread_context": { "nearest_public_post_seq": 181 },
  "boundary": "public_knowledge_as_of_moment"
}
```

The selected moment and its game facts are immutable, but its public presentation may
change under a typed member-lifecycle pseudonymization or moderation overlay. Every
response therefore carries `publication_revision`; the `ETag` covers both moment id
and revision. Exact responses may use bounded public caching but must revalidate, not
declare `immutable`. Ordinary later game events do not change an earlier exact response.
The moving no-argument latest response also revalidates.

### 6. Frontend route

Add a sibling SvelteKit publication route at `/games/[game]/history`. It is server
rendered from the history response and remains navigable through ordinary previous,
next, and phase links without hydration.

Enhancement adds:

- range scrubbing;
- request cancellation with `AbortController`;
- an in-memory cache keyed by `(moment_id, publication_revision)`;
- prefetch of only the previous and next snapshots after idle;
- copy-link feedback;
- a “new history available” indication without forced cursor movement.

No browser store becomes authoritative. A failed fetch leaves the old snapshot visible,
marks it as still selected, and offers Retry; it does not optimistically invent the next
state.

## Keeping it simple and responsive

The simplicity rule is: **one selected moment, one server snapshot, one change
description**.

Avoid these tempting early abstractions:

- no canvas timeline;
- no client event interpreter;
- no entire-stream download;
- no virtualized raw event table;
- no animation scheduler;
- no cross-game generic replay framework;
- no per-viewer private replay mode hidden behind flags;
- no persistent snapshot system before measurement.

Responsiveness comes from controlling work rather than duplicating rules:

1. Range pointer input changes only a local ordinal/phase preview.
2. Committing a stop starts one cancellable request.
3. The selected snapshot remains visible with a small loading state.
4. Neighbor snapshots are cached/prefetched after the selected request settles.
5. Exact moment responses are cacheable with publication-revision revalidation.
6. The response includes bounded nearby navigation rather than the whole timeline.
7. The Rust fold is benchmarked on the mash-scale fixture before checkpoint storage is
   introduced.

## Budgets and acceptance criteria

### Product behavior

- A copied exact-moment URL restores the same moment after more game events append.
- Scrubbing before and after a replacement preserves the slot and changes from the
  named outgoing persona/epoch to the named incoming persona/epoch.
- A returning persona reuses its game persona, starts a distinct occupancy epoch, and
  is presented as a return rather than a new credential identity.
- Persona renames follow as-of history; member-lifecycle pseudonymization replaces the
  name across old moments and advances the publication revision without changing links.
- Scrubbing before and after a death changes lifecycle and reveal flags according to
  the pack-authored death reveal.
- Scrubbing before completion hides terminally revealed facts; completion reveals them.
- Vote submissions and withdrawals produce the same running tally as the authoritative
  live votecount at the equivalent latest coordinate.
- Multiple public inner events in one resolution can be selected independently.
- The response contains no private body, action target, unrevealed role/alignment,
  resolver note, credential principal, account label, external subject, or raw
  replacement user id.

### Interaction and accessibility

- Previous, next, phase jump, latest, and share are at least 44px touch targets.
- Every function except direct range dragging works without JavaScript.
- The range has an explicit accessible name, current value text, minimum, and maximum.
- Keyboard operation covers moment, phase-boundary, first, and latest navigation.
- Snapshot loading does not move focus and exposes a polite status announcement.
- Phone and 720px reflow layouts have no horizontal page overflow.
- Reduced motion and forced colors preserve full operation and selection meaning.
- The sticky phone transport never obscures focused content.

### Performance

Initial targets, to be replaced by measured baselines:

- range pointer work stays local and does not issue a request before commit;
- cached previous/next movement paints within one animation frame of activation;
- uncached navigation exposes pending feedback within 100ms;
- one history response is normally under 128 KiB and has a hard bounded roster,
  neighbor, and phase-manifest shape;
- a representative 60-slot long-game cold fold completes under 1 second locally and a
  warm exact-moment read under 250ms before the implementation slice is complete;
- benchmark failure triggers checkpoint design, not client-side rule folding.

## Proof plan

### Pure reducer and redaction

- Golden stream covering two phases, vote replace/withdraw, Rowan → Lark replacement,
  Lark rename, Rowan return in a new epoch, two deaths with different reveal modes,
  public alignment-only reveal, and game completion.
- Assertion at every public moment, not only final state.
- Hidden role assignment, action, investigation, conversion, and private channel facts
  remain absent before and after unrelated public moments.
- Terminal reveal appears only at the terminal coordinate.
- Latest-state equivalence against existing projections.

### Persona and occupancy integrity

- Initial assignment, atomic replacement close/open, vacancy, return, and rename rebuild
  to identical persona, name-history, and occupancy-epoch rows.
- One open epoch per slot and per persona is enforced under concurrent commands.
- A principal has one game persona while a returning persona receives a new epoch.
- Historical replacement prose uses names effective at that moment, never current
  profile or authentication labels.
- Game-wide normalized name claims cannot be recycled to another persona.
- Capability resolution follows only the open epoch's private principal binding.
- Pseudonymization removes the prior public name from every serialized historical
  response, advances `publication_revision`, and preserves slot/persona/epoch continuity.

### Projection and rebuild

- Moment ids and order are byte-identical after rebuild.
- Multiple inner events at one outer sequence preserve order.
- Unknown kinds fail closed.
- No projection row contains prohibited payload fields or free-form private text.
- Appending later events does not change earlier ids.

### API

- Active and completed public games succeed anonymously; setup/non-public games do not.
- Invalid, cross-game, and unknown moment ids return typed bounded errors.
- `at` and `ordinal` canonicalize to the same selected moment.
- Exact responses revalidate by an ETag containing moment id and publication revision.
- Overload uses the existing bounded admission/error posture.

### Frontend

- Server-rendered previous/next/phase navigation.
- Hydrated range commit, cancellation, stale-response suppression, retry, copy-link, and
  neighbor-cache behavior.
- Phone, tablet, desktop, 200% reflow, reduced-motion, and forced-colors fixtures.
- Keyboard traversal and focus retention.
- A 60-slot roster fixture with a dense vote phase.

### Security review

Treat the history endpoint as a new public projection, not as a harmless view over an
existing stream. Include payload-key denylist assertions and representative private
sentinel strings in vertical tests. The test passes only when no sentinel appears in
serialized API or rendered HTML. Use distinct sentinels for principal id, account id,
external subject, mutable profile display name, and persona public name so the proof
also demonstrates that only the persona name crosses the boundary and that a later
pseudonymization removes it from every historical cursor.

## Delivery slices

### Slice 1 — Game persona and occupancy foundation

- Replace `SlotAssigned`/`ReplacementCompleted` with persona registration/rename and
  occupancy start/end facts across commands, wire types, projections, setup/host UI,
  fixtures, export/rebuild, and capability resolution.
- Require an explicit safe public game name, reserve normalized names game-wide, and
  prove atomic replacement, return, vacancy, rename, and pseudonymization behavior.
- Remove the live-only occupancy table as a writable concept; current occupancy is the
  one open epoch.

### Slice 2 — Historical public-state core

- Extract/share pure projection folds where current and historical state would otherwise
  diverge.
- Define `HistoryCoordinate`, closed `PublicMomentKind`, deterministic moment id, public
  history state, named persona/epoch presentation, and redacted response types.
- Prove the golden stream and latest-state equivalence.

### Slice 3 — Moment index and API

- Add and rebuild `public_game_history_moment`.
- Add bounded prefix loading and history query service.
- Expose the public endpoint, canonical selection, publication-revision ETag, and
  vertical redaction tests.

### Slice 4 — Server-rendered explorer

- Add the route, masthead, previous/next/phase links, moment statement, phase/votecount,
  named occupancy roster, nearby moments, provenance, and thread/history cross-links.
- Prove no-JavaScript navigation and responsive document order.

### Slice 5 — Scrubber enhancement and performance proof

- Add native range enhancement, cancellation, cache/prefetch, copy link, and active-game
  latest indication.
- Run dense-vote and 60-slot browser/performance fixtures.
- Add server checkpoints only if the measured cold-fold budget fails.

Each slice should be an atomic commit with its mechanically selected proof lanes green.
Because this crosses eventstore, projections, API, wire/frontend contracts, and browser
readiness, the completed slice should finish with sprint proof and then a full proof sweep
before landing the frontier to `main`.

## Alternatives explicitly rejected

- **Use the completed-game export in the browser:** exposes the wrong trust boundary,
  downloads private facts, and duplicates folding in TypeScript.
- **Query current projection tables with historical timestamps:** those tables represent
  current state and do not retain enough ordered history.
- **Store JSON state after every event:** simple reads, but multiplies roster-sized data
  by every vote before a replay benchmark justifies it.
- **Use raw stream sequence as the public URL:** cannot distinguish inner moments and
  exposes resolution structure.
- **Apply current reveal flags to past snapshots:** creates hindsight leakage and makes
  “as of” semantically dishonest.
- **Join replacement users to current profiles:** mutable profile state rewrites old
  game prose, profile privacy can erase the label, and credential identity crosses the
  wrong boundary.
- **Copy two names onto `ReplacementCompleted`:** handles one happy path but has no
  identity for returns, vacancies, mid-game renames, authority lookup, or
  pseudonymization. Persona plus occupancy epoch is the smaller complete model.
- **Merge public history and host trace inspection:** their audiences, payload safety,
  and explanatory vocabulary are different.

## Resolved decisions

1. **Replacement identity:** introduce first-class game personas and occupancy epochs;
   named history is required in the first slice.
2. **Active-game freshness:** use explicit Latest plus revalidation in v1; add a public
   live signal only after the static route is proven.
3. **Public DayEvent breadth:** land the core history families first, then add a second
   explicit classifier increment for public DayEvent/program moments.
4. **Moment identity:** use a versioned BLAKE3/base32 id with rebuild and alias tests
   before any link is served.
5. **Checkpoint threshold:** benchmark the current mash artifact first, then ratify the
   cold/warm budget; introduce checkpoints only when measurement requires them.

## Decision

The accepted product shape is:

- public-knowledge-as-of replay for active and completed public games;
- snapshot plus meaningful-moment timeline;
- stable opaque exact-moment links;
- named, game-scoped personas joined to stable slots by time-bounded occupancy epochs;
- server-authoritative folds and redaction;
- no autoplay, raw ledger, omniscient mode, private replay, or snapshots-by-default.

Slice 1, the game-persona and occupancy foundation, is required 1.0 substrate
and follows closure of the active maintainable-core frontier. It is
intentionally a direct domain refactor rather than a compatibility layer: named
history, live authority, setup, replacement, and later replay must share one
occupancy model.

The explorer query and UI slices remain accepted direction but are explicitly
deferred beyond 1.0. They become active only after the required platform scope
is complete and the owner opens the public-history frontier; the canonical
scope decision lives in `docs/ops/completion-registry.json`.
