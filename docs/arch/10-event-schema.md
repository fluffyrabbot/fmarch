# 10 — Event schema & result contract

See the generated [Rust contract reference](../reference/rust-contracts.md)
for current declaration members and source links.

The concrete event taxonomy for both layers ([09-engine-and-packs](09-engine-and-packs.md)),
plus the **result contract** discipline ported from im-human's `V4_RESULT_CONTRACT.md`:
event types are enumerated, each is versioned, and **unknown types are rejected outright**.

Exact contracts live in the owning crates: `eventstore` owns stored headers and
sealed bodies, `domain` owns resolution results, and platform/identity modules
own their event families. `wire` exports browser projections rather than the
stored log. Examples below explain semantics; they are not generated schemas.

## The envelope

[`eventstore::StoredEvent`](../../crates/eventstore/src/lib.rs) exposes a loaded
logical event with global `seq`, aggregate `stream_id`, per-stream `stream_seq`,
`kind`, `version`, and captured logical time. The physical row stores only the
structural header in cleartext. `payload`, `actor`, `causation_id`, and `meta`
are authenticated together in `sealed_body` ([02](02-event-sourcing.md)). There
is no separate event UUID field or overloaded per-stream `seq`.

`ActorId` distinguishes `Slot`, `Host`, `System`, `Principal(PrincipalId)`, and
`PrivacySubject(Uuid)`. Principal authority and privacy subjects never share a
catch-all user string. The slot-only engine does not receive account identity;
platform command audit metadata retains the initiating authority inside the
sealed event body. Public game authorship is a separate projection contract.

## Two event families

| Family | Caused by | Examples | Folded by |
|---|---|---|---|
| **Platform events** | humans, hosts, the platform | posts, votes-as-submissions, channels, replacement, lifecycle | thread/channel/membership projections |
| **Engine (resolution) events** | the resolver (`System`) | kills, saves, conversions, day outcome, investigations, wins | votecount/slot-state/reveal projections |

Phase resolution produces a validated `ResolutionApplied` plus its trace.
Dedicated engine prompt/control paths can also emit validated engine results;
platform effects use explicitly supported outer event kinds and shared folds,
not arbitrary unvalidated inner-event payloads ([17](17-day-runtime-ownership.md)).

---

## Platform events

Representative persisted families (exact payloads and admission are owned by
the corresponding command and projector modules):

| Family | Event kinds |
|---|---|
| Game and occupancy | `GameCreated`, `SlotAdded`, `GamePersonaRegistered`, `GamePersonaRenamed`, `SlotOccupancyStarted`, `SlotOccupancyEnded`, `GameStarted`, `GameCompleted` |
| Slot and role state | `RoleAssigned`, `SlotStatusChanged` |
| Posting | `PostSubmitted`, `PostEdited`, `PostRetracted` |
| Private rooms | `PrivateChannelDeclared`, `PrivateChannelMemberGranted`, `PrivateChannelMemberRevoked`, `PrivateChannelRevoked` |
| Vote/action intake | `VoteSubmitted`, `VoteWithdrawn`, `ActionSubmitted`, `ActionWithdrawn` |
| Phase control | `DeadlineSet`, `DeadlineExtended`, `PhaseDeadlineElapsed`, `ThreadLocked`, `ThreadUnlocked`, `PhaseAdvanced` |
| Engine output | `ResolutionApplied`, `ResolutionTrace` |
| DayPrograms/DayEvents | See the sole-emitter table in [17-day-runtime-ownership](17-day-runtime-ownership.md#emit-table-dayevent-kinds) |
| Member lifecycle | `MemberDeactivated`, `MemberErasureRequested`, `MemberCredentialsErased`, `MemberAuthorshipPseudonymized`, `MemberPersonalExportRecorded` |

Replacement is a paired occupancy-end/start transition. Host modkill uses
`SlotStatusChanged`; it is not a separate `SlotModkilled` submission to the
engine. Community discussion events have their own bounded context under
[RFC 0003](../rfcs/0003-community-platform-v2.md).

For game-thread `PostSubmitted`, `author` is a closed, public game-author
sum type: `{ kind: "slot", slot_id }` for player posts,
`{ kind: "host_narrator" }` for official host notices and votecounts, or
`{ kind: "system" }` for engine announcements. It is deliberately neither a
credential principal nor a profile reference.

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

The resolver's output is persisted as **one `ResolutionApplied` envelope** that carries the
ordered inner domain events, plus a companion `ResolutionTrace`. This mirrors im-human's
`resolution.v5.applied` and keeps a resolution atomic and replayable as a unit.

The generated reference lists the exact members of
[`ResolutionApplied`](../reference/rust-contracts.md#resolutionapplied),
[`ResolutionTrace`](../reference/rust-contracts.md#resolutiontrace), and
[`InnerEvent`](../reference/rust-contracts.md#innerevent). Applied results and
trace are persisted atomically. The mapping below records port semantics;
serde representation and payload validation remain in the linked Rust source.

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
| `ita.shot.invalidated` | `ItaShotInvalidated` | implemented for same-session and buffered ITA shots invalidated by an earlier target death; result contract, pure fixtures, trace rows, and command/projection rebuild proof cover the policy |
| `ita.shot.refunded` | `ItaShotRefunded` | implemented for already-dead ITA targets under refund policy; result contract, pure fixtures, trace rows, counters, and command/projection rebuild proof cover the policy |
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
> `"lover_suicide"`. Host-prompt PK uses `"host_prompt:pk"` at both layers because the prompt
> resolution itself is the durable kill source. These are deliberately different fields serving
> different layers — do not conflate them.

`Trigger.payload` is a closed [`TriggerPayload`]: `{ on, source_target, source_actor,
source_cause, produced_actor, produced_target, actor_filter? }`. The state fold still
ignores it. `RESULT_VERSION` 19 stored the same keys as an open JSON object; the
`19 → 20` upcast copies those keys (plus optional `actor_filter`) and drops extras.

`InvestigationResult` Track results are a closed [`TrackInvestigationResult`]:
`{ visited }`. Other modes stay on the shared field bag. `RESULT_VERSION` 20 stored
Track as that bag; the `20 → 21` upcast copies `visited` and drops extras.

`DayVoteOutcome` carries the full tally so projections and disputes have everything:

Current declarations: [`DayVoteOutcome`](../reference/rust-contracts.md#dayvoteoutcome),
[`VoteStatus`](../reference/rust-contracts.md#votestatus).

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

Current declarations: [`DayAnnouncement`](../reference/rust-contracts.md#dayannouncement),
[`LastWordsRecorded`](../reference/rust-contracts.md#lastwordsrecorded),
[`LastWordsVoteSummary`](../reference/rust-contracts.md#lastwordsvotesummary).

`WolfSelfDestructed` is the typed culture note for im-human `note.wolf.self_destruct`.
It is emitted before the paired death events; the actual state changes are still ordinary
`PlayerKilled` events for the target and self-sacrificing wolf.

Payloads are variants of [`InnerEvent`](../reference/rust-contracts.md#innerevent): `WolfSelfDestructed`.

`WolfCarryQueued` is an fmarch-local durable engine event: it records the pending
White Wolf carry token after the eligible White Wolf death. `WolfCarryUsed` is the
canonical mapping for im-human `note.wolf.carry`; it is emitted when a later wolf
faction kill consumes that token for one extra target. The generated carry kill is
still an ordinary `PlayerKilled { cause: "wolf_carry" }`, so projections and
trigger observations do not need a separate death lane.

Payloads are variants of [`InnerEvent`](../reference/rust-contracts.md#innerevent): `WolfCarryQueued`, `WolfCarryUsed`.

`WolfBeautyMarked` is an fmarch-local durable mark event for the Wolf Beauty charm:
the ordinary `EffectsMarked` tag remains on the target, while this event preserves
which Beauty owns that mark. `WolfBeautyDragged` is the canonical mapping for
im-human `note.wolf_beauty.drag`; it is emitted when the Beauty dies to an enabled
day-death cause and is followed by ordinary `PlayerKilled` events for dragged slots.

Payloads are variants of [`InnerEvent`](../reference/rust-contracts.md#innerevent): `WolfBeautyMarked`, `WolfBeautyDragged`.

`PhaseAnnouncement` (deaths revealed at a phase boundary) has the pinned payload:

Current declarations: [`PhaseAnnouncement`](../reference/rust-contracts.md#phaseannouncement),
[`Death`](../reference/rust-contracts.md#death).

**Every resolution emits exactly ONE trailing `PhaseAnnouncement` as its final inner event.**
It lists the deaths produced in that resolution — for a night, the slots that got
`PlayerKilled` (each `{ slot_id, cause: "night_kill" }`, in event order); for a day, pre-vote
day-action deaths use their action cause such as `"knight_duel"` / `"ita_shot"` /
`"self_destruct"`, a lynched slot uses `cause: "lynch"`, and generated day-death policy such
as Wolf Beauty or lover-suicide uses the generated cause. It is `deaths: []` when no one died.
v66 packs may attach trailer-level `template_id`/`audience` to day/twilight
`PhaseAnnouncement` events with at least one death, and v67 packs may attach per-death
`template_id`/`audience` from pack-declared cause templates. Night and no-death trailers omit that
metadata. This single canonical death-reveal signal always fires, even on a
resolution that produces only saves, interferences, or a tie. `Death.cause` is the semantic
death-reveal tag, distinct from `PlayerKilled.cause` when the layer needs that distinction.

> **`PhaseAnnouncement` is the *final* inner event UNLESS a win is reached.** When the
> post-resolution state satisfies the pack's `WinPolicy` ([09](09-engine-and-packs.md)), the
> resolver appends a single `WinReached` *after* the trailing `PhaseAnnouncement`, making it the
> true final inner event. Canonical order: *phase results → `PhaseAnnouncement` → optional
> `WinReached`*. Win-check runs once at phase end, never mid-resolution.

`WinReached` records engine-declared victory:

Payloads are variants of [`InnerEvent`](../reference/rust-contracts.md#innerevent): `WinReached`.

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

Current declarations: [`ResolutionTrace`](../reference/rust-contracts.md#resolutiontrace).

The trace is not folded into player-facing projections; it's the **audit + golden-test
oracle** ([09](09-engine-and-packs.md)). The pure resolver returns it beside
`ResolutionApplied`, the command seam persists both atomically, and projections validate it
on replay. The v1 resolver trace records the run id, phase id, schema version, decisions derived
from emitted inner events, redirect graph edges, generated action rows, effect changes, visibility
rows, and notes. Operator trace inspection renders those rows with stream anchors for host/cohost
review.

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
| `day_program` (immutable inline generation and canonical content hash) | `DayProgramAttached` |
| `day_event` (platform event lifecycle and decision) | `DayEventScheduled` / `DayEventOpened` / `DayEventLocked` / `DayEventCancelled` / `DayEventResolved` |
| `day_event_participation` (current typed entries) | `DayEventParticipationSubmitted` / `DayEventParticipationWithdrawn` |
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
   The live registry is `eventstore::upcast` (`crates/eventstore/src/upcaster.rs`):
   every loaded row passes through it. Superseded `(kind, version)` pairs branch
   there and rewrite payload/version to the current shape; everything else is
   identity. `ResolutionApplied` stamps `events.version` from `RESULT_VERSION`
   (legacy header `1` is interpreted via payload `result_version`). Register the
   next `N → N+1` rewrite in `domain::upcast_resolution_applied` before bumping
   the constant. The synthetic kind `UpcastExample` still documents the registry
   shape (version 1 → 2: ensure object payload has `"note"`, defaulting missing
   to `""`).
3. **Validation at the boundary.** A resolver result and its trace are validated before they
   are appended; failure aborts the append with a typed, path-pointing error — never a
   silent partial write.
4. **Determinism preserved end to end.** Every field that could be nondeterministic (seed,
   timestamps, run_id) is captured *as data* at write time so replay is exact.

### Maintenance checklist (when adding an event kind)

1. Add the kind to its owning event family and persistence admission; resolution
   events add an `InnerEvent` variant.
2. Define/version its payload in the owning domain or platform crate. Regenerate
   `wire` TS when a shared browser contract changes ([04](04-wire-protocol.md)).
3. Add the projection fold(s) it affects.
4. Add a golden-trace / parity test ([09](09-engine-and-packs.md)).
5. Bump `result_version` if it's an inner (resolution) event, add the
   `N → N+1` upcast step first, then persist the new header version.

---

## Settled input and pack contracts

Votes enter through typed `SubmitVote`/`WithdrawVote` commands and authoritative
target controls, never post-text parsing ([01](01-domain-model.md)). The engine
port and multiple culture packs are implemented; the v1 eight-ability slice is
historical. Exact vocabulary lives in `domain::ir`, with policy admission in
`domain::pack::validation` and behavioral proof in the pack goldens and
[engine-port checklist](11-engine-port-checklist.md).

For new work, update the owning Rust event contract, its persistence admission,
folds, and proof together. See [08-roadmap](08-roadmap.md) for sequencing and
[04-wire-protocol](04-wire-protocol.md) when transport projections change.
