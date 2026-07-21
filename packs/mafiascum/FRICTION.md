# FRICTION — encoding mafiascum against doc-09 / doc-10

Candid report on where the doc-09 (`Pack`/IR) and doc-10 (event/result contract) schemas
strained while encoding a minimal-but-realistic mafiascum pack. Ordered roughly by severity.
"Deviation" means I did something the docs don't literally sanction; every such case is
flagged here, not hidden.

---

## 1. `InvestigateMode` has nowhere to live on an `ActionTemplate` (DEVIATION)

`ActionTemplate` (doc 09) has fields `id, ability, window, targets, modifiers, constraints`.
There is **no field for `InvestigateMode`**. But `Investigate` is explicitly parameterized
(`Parity | Track | Watch | Motion`) and the Cop vs. Tracker distinction is *entirely* the
mode. Two town roles in the required set (Cop = Parity, Tracker = Track) are
indistinguishable in the IR without it.

I added a `"mode"` field to the Investigate action templates (`cop_investigate`,
`tracker_track`). This is a deviation: the struct as written cannot carry it.

**Minimal fix:** add `mode: Option<InvestigateMode>` to `ActionTemplate` (or fold it into a
typed `ability: IrAbility` where `Investigate(InvestigateMode)` is a parameterized variant).
The doc shows `enum InvestigateMode` but never wires it to a template. **Unblocks:** every
information role across all four cultures — they are all "Investigate + a mode."

---

## 2. Godfather "appears town" has no clean home — `effects`/`VisTag` is underspecified (DEVIATION)

The brief (correctly, per doc intent) says model Godfather via a visibility/result modifier,
NOT a new ability. But the tools available don't quite fit:

- `Modifier` is a closed enum: `Strongman, Ninja, Loyal, Roleblockable, Reflexive`. None of
  them means "investigation result flips." Godfather is not Ninja (a Ninja *hides* from
  track; a Godfather is *seen* but reads as the wrong alignment).
- `VisibilityRule.sees` includes a `VisTag` field variant, and `VisField` mentions `Result`,
  but **the semantics of `VisTag` and how a result gets *flipped* (vs merely shown/hidden)
  are never defined.** "sees Result" tells you the investigator gets a result; it does not
  say the pack can *invert* that result for a tagged target.

I modeled Godfather with a role-level `"effects": ["godfather"]` tag on the slot and assumed
the resolver knows that an `Investigate{Parity}` against a slot carrying the `godfather`
effect yields `town`. **That is an assumption the docs do not state.** `Role` in doc 09 has
no `effects` field at all — I added one. The `StateSnapshot` slot also carries `effects` in
my goldens, which doc 09 mentions ("persistent effects") but never gives a shape for.

**Minimal fix (single addition):** define a **result-transform table** keyed by
`(InvestigateMode, target_effect_tag) -> result_override`, OR add a `Detectable`/result-flip
modifier with an explicit value. The cleanest is a new optional pack table
`investigation_overrides: Map<Tag, InvestigateResult>`. **Unblocks:** Godfather, Miller
(town that reads scum), Ninja-vs-Godfather disambiguation, and any "framer"/`Mark`-driven
result tampering — none of which are expressible today.

---

## 3. Visibility table can't express the *track* result shape

`VisibilityRule` says *which fields* are seen (`ActorId|TargetId|ActionType|Result|VisTag`)
and `unless_modifiers`. For a Tracker, the desired result is "the set of slots the watched
slot *visited*." That is neither the tracker's own target nor a boolean result — it's
**derived from the redirect/interaction graph** of *other* actions. The visibility table as
specified describes visibility of a *single emitting action*, not "compute who my target
visited." I encoded `Tracker` as `Investigate{Track}` with `sees: [TargetId, Result]` and
`unless_modifiers: [Ninja]`, but the actual "list of visited slots" computation is left
implicit — the schema gives me no place to say "Track reads the visit graph."

**Ambiguity, not a hard blocker:** a resolver *can* do this internally. But the pack has no
declarative hook for it, so two packs could disagree silently on what Track returns. Worth a
note in the IR spec: Track/Watch/Motion results are graph-derived and not configurable via
`VisibilityRule` beyond hide/show.

---

## 4. The result contract is silent on the "action did not resolve" case (GUESS)

`roleblock_stops_action.json`: the cop is blocked, so **no** `InvestigationResult` fires.
But doc 10's `InnerEvent` set has no "ActionFizzled" / "ActionBlocked" event. The closest is
`EffectNotification { effect, status, audience }`. I emitted
`EffectNotification{ effect:"blocked", status:"applied", audience:[slot_2] }` to tell the cop
they were roleblocked, and emitted **nothing** for the investigation itself.

This is a guess on two axes:
- Whether a blocked action should produce *any* event at all (I say yes — the player must
  learn they were blocked; mafiascum convention notifies roleblocked players).
- Whether `EffectNotification` is the right carrier. Its field names (`effect/status/
  audience`) fit loosely but were clearly designed for `Mark`/`Clear` effects, not roleblock
  feedback. `audience` taking a `[SlotId]` is also an assumption — the type is unspecified.

**Minimal fix:** either bless `EffectNotification` as the canonical "your action was
interfered with" channel and specify `audience: Vec<SlotId>`, or add a dedicated
`ActionInterfered { actor, reason }` inner event. Without one of these, every pack invents
its own blocked-notification convention and goldens won't be portable.

---

## 5. `Block` vs `Protect` priority ordering is unspecified — precedence is a list, not a DAG

Doc 09's `PrecedenceRule` has `beats` / `blocked_by` / `unless_modifiers`, and `Constraints`
has a `priority: i32`. But there's **no statement of how these compose** when several rules
apply to one slot. Concretely: if a doctor is roleblocked AND a strongman attacks the
doctor's target, does Block-on-doctor remove the protect *before* Strongman-vs-Protect is
evaluated? The answer matters and the docs give no global evaluation order — just a flat
`Vec<PrecedenceRule>` plus per-action `priority`.

I imposed an order via `priority` on the action templates (Block 90 > Redirect 80 > Protect
70 > Kill 30 > Investigate 20/10) and wrote precedence-rule `notes` asserting "Block is
evaluated first" and "Redirect rewrites targets before Kill/Protect read them." **This is my
construction; the docs neither prescribe nor forbid it.** Two pack authors could encode the
same roles and get different results on the roleblocked-doctor-vs-strongman corner.

**Minimal fix:** specify that resolution proceeds in descending `Constraints.priority`, and
that `PrecedenceRule`s are consulted at the point each ability resolves. Document a single
canonical phase order (Block → Redirect → Protect → Kill → Investigate is the common one).
This is the highest-leverage clarification for determinism guarantees, which doc 09 §
"Determinism rules" promises but doesn't fully deliver at the precedence layer.

---

## 6. `unless_modifiers` semantics on `protect_beats_kill` are a reverse-lookup (subtle)

`protect_beats_kill` has `unless_modifiers: [Strongman]`. The natural reading: "Protect beats
Kill unless the Kill is Strongman." But the modifier is on the **Kill action**, while the
rule's `when.effect` is **Protect**. So evaluating this rule requires inspecting a *different*
action's modifiers than the one the rule keys on. The doc's struct comment
("Protect beats Kill UNLESS Strongman") matches my reading, so I followed it — but the data
model never says *whose* modifiers `unless_modifiers` inspects (the beating action's? the
beaten action's? the target's effects?). I assumed "the action being beaten" (the Kill).
Flagging because it's load-bearing for the `kill_vs_doctor` golden and its Strongman variant.

---

## 7. Day vote: `DayVoteOutcome.status` enum has no plain "tie" value (GUESS)

`VoteStatus = Lynch | NoLynch | NoMajority | Hammer`. A 2-2 plurality tie under
`tie_breaker: NoElimination` is... which? It's not `NoLynch` (no one *chose* no-lynch); it's
not `Lynch`. I used **`NoMajority`** as the closest fit and put the human explanation in
`reason` + `tiebreak`. Defensible, but "NoMajority" reads oddly for a *plurality* method
(plurality has no majority requirement — the issue is the *tie*, not a missing majority).

**Minimal fix:** add `Tie` to `VoteStatus`, or document that `NoMajority` is the catch-all
for "no eliminable winner." Minor, but goldens depend on the exact string.

---

## 8. `PhaseAnnouncement` shape is undocumented (GUESS)

Doc 10 lists `PhaseAnnouncement // deaths revealed at phase boundary` with no payload struct.
In `day_vote_tiebreak.json` I emitted `PhaseAnnouncement { phase_id, deaths: [] }`. The field
names are invented. Night goldens would need this too (the kill scenarios technically should
emit a `PhaseAnnouncement` at the N→D boundary; I scoped my night goldens to the core
inner-result events only and left the announcement out, since its shape is unspecified). Pin
the payload (`{ phase_id, deaths: Vec<SlotId> }` minimum) so death-reveal projections are
portable.

---

## 9. Pack field-shape mismatches between prose and the goldens' needs

Smaller items where I had to invent shape because doc 09 gives a Rust *sketch* but no
serialization contract:

- **`PrecedenceWhen.when`**: doc shows `{ effect: IrAbility, target_state: Option<String> }`.
  I used `"when": { "effect": "Block", "target_state": null }`. Fine, but `target_state`'s
  vocabulary is never enumerated — what strings are legal? I never needed a non-null value,
  so I dodged it, but a "protect only if target is alive"-type rule would hit this wall.
- **`TargetSpec`**: enum `None | One | Many{max} | Group`. The bus driver needs exactly two
  targets. I used `"targets": "Many"` + `constraints.max_targets: 2`, duplicating the count.
  `Many{max}` suggests the max lives *in* the TargetSpec; `Constraints.max_targets` *also*
  carries it. Two sources of truth for the same number — pick one.
- **`StateSnapshot`**: never given a concrete shape in doc 09 (just "slots, roles, persistent
  effects, alive/dead"). I built `{ phase_kind, phase_number, slots:[{slot_id, role_key,
  alignment, status, effects}] }`. All field names here are my invention.
- **`seed`**: typed `Seed` with no shape. I used a bare integer. Doc says "recorded as event
  data" — fine — but JSON authors need to know if it's `u64`, hex string, or bytes.
- **`submitted_at` / `LogicalTime`**: I used monotonic integers (1,2,3…) per determinism
  rule 2. Doc says "monotonic logical time" but not the representation. Integer is the
  obvious choice; pinning it avoids string-vs-int golden drift.

---

## 10. Factional kill: one event source, multiple potential actors (not a blocker, noted)

Mafia Goon / Godfather / Ninja share `template_id: "factional_kill"`; Strongman uses the
observed role-specific `template_id: "strongman_kill"` so the port keeps that im-human action
id visible in the pack and parity matrix. The
faction submits **one** kill. The engine is user-agnostic and slot-only, so "which slot
submitted the factional kill" is just whichever mafia slot the platform attributes it to.
This works fine under the current model (the submission carries `actor: SlotId`), but doc 09
never discusses **faction-shared actions** (one action, many eligible actors, one shot per
night per faction). The `x_shots` constraint is per-action-template, not per-faction. A
faction night-kill quota ("mafia get 1 kill/night regardless of how many goons") is not
expressible as a constraint today; I relied on the platform submitting exactly one. Worth a
`faction_quota` concept eventually — but out of scope for this minimal pack.

---

## Summary of additions I'd prioritize (one line each)

1. **`mode` on `ActionTemplate`** (or parameterize `IrAbility::Investigate`). Blocks every
   info role. *Highest priority.*
2. **An `investigation_overrides` table / result-flip mechanism.** Unblocks Godfather,
   Miller, framers. *The single most important new capability for mafiascum specifically.*
3. **A canonical precedence evaluation order** (priority-descending + named phase order).
   Delivers the determinism doc 09 already promises. *Highest priority for correctness.*
4. **Bless `EffectNotification` (or add `ActionInterfered`) as the blocked-action channel**,
   with `audience: Vec<SlotId>` pinned. Unblocks portable roleblock goldens.
5. **Pin payload shapes** for `PhaseAnnouncement`, `DayVoteOutcome.status` (add `Tie`),
   `StateSnapshot`, `Seed`, `LogicalTime`. Pure spec hygiene; goldens can't be authoritative
   without it.

Everything in deliverables 1 and 2 conforms to the doc-09/doc-10 *intent*; the deviations
above (mode field, role/slot `effects`, EffectNotification-for-roleblock, invented payload
shapes) are the price of the docs being type-sketches rather than serialization contracts.

---

## Resolution (review round 1)

Reviewer rulings applied; the loop is closed. One line per finding:

1. **`mode` on `ActionTemplate`** — APPLIED (R1). Added `mode: Option<InvestigateMode>` to
   `ActionTemplate`, REQUIRED iff `ability == Investigate`. `IrAbility` stays a flat tag. The
   pack's `"mode"` on cop/tracker is now canonical, not a deviation.
2. **Godfather/Miller/Framer result-flip home** — APPLIED (R2). Added `effects: Vec<Tag>` to
   `Role` and `SlotState`; added optional pack table
   `investigation_overrides: Map<Tag, ResultOverride>` (canonical home for Godfather,
   Miller, and Mark-driven Framer). Pack now carries `godfather -> town`, `miller -> scum`,
   and `framed -> scum` Parity overrides, with goldens for all three.
3. **Track/Watch/Motion results are graph-derived** — APPLIED (R9). Documented in the
   IR/Investigate spec and determinism rules: Track returns visited slots, Watch returns
   visitors, and Motion returns a boolean active/inactive result from resolved post-redirect,
   non-blocked, non-hidden visits. Goldens cover ordinary Track, multi-visitor Watch, visible
   Motion, and Ninja-hidden Watch/Motion.
4. **Blocked-action channel** — APPLIED (R4). Added `ActionInterfered { actor, reason }` inner
   event; `EffectNotification` is reserved for Mark/Clear and is NOT the roleblock channel.
   `roleblock_stops_action.json` now emits `ActionInterfered{actor: slot_2, reason: "roleblocked"}`
   and no `InvestigationResult`. Roleblock suppression now also emits structured
   `DecisionTrace` detail with the suppressed action and blocking source.
5. **Precedence evaluation order** — APPLIED (R3). The resolver now derives v1 night ability
   order from pack precedence plus `Constraints.priority`; the mafiascum pack order is
   Block → Redirect → Protect → Mark → Clear → Grant → Kill → Investigate, and validation
   rejects ambiguous priority ties, cycles, and unsupported precedence fields.
6. **`unless_modifiers` reverse-lookup** — APPLIED (R3). Documented that `unless_modifiers`
   inspects the BEATEN action's modifiers (the one in `beats`), not the beating action/target.
7. **`Tie` vote status** — APPLIED (R5). `VoteStatus` gains `Tie`; `day_vote_tiebreak.json`
   status changed `NoMajority` → `Tie`.
8. **`PhaseAnnouncement` shape** — APPLIED (R5). Pinned `{ phase_id, deaths: Vec<{slot_id, cause}> }`.
9. **Payload-shape pins** — APPLIED (R5, R6). `StateSnapshot`/`SlotState` made canonical in
   doc 09; `Seed = u64`, `LogicalTime = u64` pinned; `TargetSpec` reduced to
   `None | One | Many | Group` with `Constraints.max_targets` the single source of cardinality
   (bus_driver `Many` + `max_targets: 2` is canonical).
10. **Faction quota** — DEFERRED (R7). One-line note added: v1 submits exactly one factional
    action per faction per night; `faction_quota` is future work, out of the v1 schema.
11. **Composed Jailkeeper and Bodyguard intercept** — APPLIED (R8). Added additive
    `ActionTemplate.additional_abilities` so one `jail` submission resolves as both Block and
    Protect, without command-side phantom actions. Added `Modifier::Bodyguard` so a Protect can
    save the target and kill the protector via `bodyguard_intercept`. Goldens cover
    `bodyguard_intercept.json`, `jailkeeper_block_protect.json`, and
    `roleblock_stops_doctor_protect.json`. Protect saves and strongman protection bypasses now
    emit structured `DecisionTrace` detail, including protectors and bypass outcome, with a
    persisted command/projection rebuild proof.
12. **Ordered redirect graph** — APPLIED (R10). Added `ActionTemplate.redirect` with
    `Swap`, `Pull`, and `Retarget` kinds. The resolver applies grouped redirect rules once per
    redirect action, bounded by `redirects.loop_cap`, so Bus Driver swaps stay one-hop while
    separate redirect actions compose deterministically. Goldens cover Bus Driver preservation,
    Lightning Rod pull, and a two-redirect cycle. Redirect rewrites now emit deterministic
    `ResolutionTrace.edges`, graph truncation emits a loop-cap note, and a command/projection
    test proves the persisted trace envelope survives rebuild.
13. **Target-state gates** — APPLIED (R11). Added `effect_duration: Resolution` for
    same-night-only Mark effects such as Commuter. Resolver target-state checks now read role
    effects, slot effects, and same-resolution transient marks. Goldens cover Bulletproof,
    bulletproof vest consumption, Commuter dodging kill/investigation, passive untargetable
    blocking kill/investigation, and Strongman piercing Bulletproof. Commuted skipped kills and
    untargetable investigation interference now emit structured `DecisionTrace` detail, with a
    persisted command/projection rebuild proof. Rolestop/shield-all action variants remain future
    work.
14. **Action constraints and announcement modifiers** — APPLIED (R12). Added
    `constraints.phase_parity` for odd/even night actions, strict v1 one-shot support via
    `constraints.x_shots = 1` plus typed `ActionUseCounted` / `action_counter` state, Weak
    Parity backlash, macho target-state protection immunity, and Loud/Announcing public
    notifications. Bulletproof vest consumption now records `shield:bulletproof_vest` in the same
    typed counter surface, and `constraints.cooldown_cycles` records
    `cooldown:<template_id>` counters for same-phase-kind cooldowns. `constraints.active_from`
    models Novice/Activated phase gates with command rejection and resolver suppression. Added
    `ActionRecorded` and `StateSnapshot.action_history` for target-repeat non-consecutive and
    Compulsive missing-action audit. Goldens cover each proven path, and a command/projection
    test proves N01 history blocks a repeated N02 target after persistence/rebuild. Multi-shot
    counters remain future work.
15. **Persistent poison/douse/cleanse timing** — APPLIED (R13). Poison is modeled as a
    persistent `Mark("poisoned")`; pending poison kills on a later night unless a same-resolution
    `Clear("poisoned")` resolves first. Arson douse/ignite uses the same persistent-effect
    surface: `Mark("doused")`, `Kill.reads_effect = "doused"`, and `Clear("doused")` preempts
    ignite. Goldens cover poison mark/no same-night death, pending poison death, cure preemption,
    ignite from carried douse, and cleanse preemption. A command/projection test proves poison
    mark, cure, delayed death, and rebuild through the persisted event stream. Pending poison
    applied, cure preemption, and cleanse-before-ignite read-effect preemption now emit
    structured `DecisionTrace` detail with persisted command/projection rebuild proof.
16. **Effect policy table** — APPLIED (R14). Added pack-level `effects` metadata as the
    canonical home for Mark/Clear lifecycle and visibility: `commuted` is now
    `duration: Resolution` / `visibility: Hidden`, while `poisoned` and `doused` remain
    persistent but can emit explicit-audience notifications (`Target` and `ActorAndTarget`,
    respectively). Resolver Mark/Clear output now emits `EffectNotification` for non-hidden
    effect policy, and goldens cover poison mark, poison cure, douse cleanse, and Commuter
    target-state gating. Richer persisted effect metadata — source, phase, exact expiry, and
    visibility in the `slot_effect` projection — remains future work; the projection still
    stores only the v1 effect tag.
17. **Generated grant surface** — APPLIED (R15). Added v2 `IrAbility::Grant` with
    `GrantSpec { grant_id, kind, uses, visibility }`, plus state-bearing
    `ActionGranted` and the rebuildable `action_grant` projection. The mafiascum pack now
    carries `motivator.motivate` (`ExtraAction`) and `inventor.grant_item` (`Item`), both with
    target-private `EffectNotification` output. Goldens cover both grant kinds, a
    command/projection test proves `Command::ResolvePhase` appends/projects a motivator grant,
    and the trace `generated` table derives rows from `ActionGranted`. `SubmitAction.grant_id`
    now consumes extra-action and item grants through durable `ActionGrantConsumed`; the
    generated vest item also writes ordinary persistent state that later resolves through the
    vest-save path.
18. **Conversion origin, deprogramming, and backup inheritance** — APPLIED (R16/R17). Enriched
    `PlayerConverted` with `original_alignment` and added folded
    `StateSnapshot.conversion_origins`, so restore-original mechanics read a real event-derived
    memory surface. Added structured `ConversionSpec` with `AssignRole` and `RestoreOriginal`;
    mafiascum now carries `cult_leader.cult_recruit`, `deprogrammer.deprogram`, `cultist`, and
    passive `backup_cop` (`backup:cop`). R17 adds `backup_policy`, `universal_backup.target_backup`
    (`inherit_role`), and folded `BackupTargeted` source choices. Goldens cover deprogramming
    from recorded origin, passive backup-cop inheritance, and targeted backup inheritance after
    the selected source dies; conversion assignment and restore-original deprogramming now emit
    structured `DecisionTrace` detail with persisted command/projection rebuild proof. Passive
    and targeted backup inheritance now also emit structured attribution traces; the targeted
    backup command/projection vertical persists and rebuild-preserves that trace envelope.
    Multi-source backup priority variants remain future work.
19. **Trigger observations for vengeful, PGO, and Super-Saint** — APPLIED (R17). Generalized
    trigger matching from ability-only `on` values to `TriggerOn` observations so packs can react
    to `Kill`, `Visit`, and `Lynch` without role-specific resolver branches. Added mafiascum
    canonical `vengeful`, `paranoid_gun_owner`, and `super_saint` passive roles plus trigger table
    rows; goldens prove Vengeful Townie retaliation, PGO visitor kills, and Super-Saint lynch
    retaliation against the latest active voter on the wagon. Command/projection tests prove the
    PGO trigger death and Super-Saint lynch trigger through persisted `Command::ResolvePhase` plus
    rebuild. A protected PGO visitor is now proven to be saved by ordinary Doctor protection, with
    persisted protect-vs-generated-kill `DecisionTrace` detail and rebuild-preserved trace
    envelope. A Bodyguard-protected PGO visitor is now proven to survive while the Bodyguard dies
    from `bodyguard_intercept`, with `intercepts: true` in the persisted trace and rebuild-preserved
    slot state. A pack-declared `unstoppable_vengeful_retaliates` trigger-produced kill now carries
    `Strongman`, bypasses Doctor and Bodyguard protection through the same kill policy, leaves the
    bypassed Bodyguard alive, and rebuild-preserves its persisted bypass trace envelopes. Trigger
    loop-cap diagnostics now flow into `ResolutionTrace.notes` with a cyclic retaliation fixture and
    persisted trigger-trace rebuild assertion. Beloved Princess now emits a durable host prompt
    through policy; broader trigger-family policy remains future work.
19a. **Mason/neighbor private-channel metadata** — APPLIED (R29). Mafiascum now declares
    canonical `mason`, `neighbor`, `friendly_neighbor`, and `neighborizer` roles plus a
    pack-owned `private_channels` table. `StartGame` emits deterministic
    `PrivateChannelDeclared` events for setup groups with at least two members, and the
    rebuildable `private_channel_member` projection stores membership metadata without leaking it
    into public `thread_view`. Pack validation enforces v29, declared roles, unique groups/roles,
    and the im-human alignment-reveal split: Mason reveals Town, Neighbor reveals no alignment.
20. **Target-lynch independent wins** — APPLIED (R19). Replaced the single Executioner-specific
    policy with v19 `target_lynch_win_policies`, the foldable `TargetLynchWinTargeted`
    owner-target event, and mafiascum `executioner.executioner_target` plus
    `condemner.condemner_target` hidden persistent Mark actions. Goldens prove both target
    designation flows and later independent `WinReached` events when the chosen target is lynched.
    A Condemner command/projection vertical proves the generalized relation survives persisted
    `Command::ResolvePhase`, carries into the day snapshot, reveals roles on target-lynch win, and
    rebuild-preserves slot state, slot effects, and the target-lynch trace envelope.
21. **Beloved Princess host prompt** — APPLIED (R20). Added v20 `beloved_princess_policy`,
    the closed `HostPromptIssued` inner event, and the rebuildable `host_prompt` projection.
    Mafiascum `beloved_princess` now emits a `skip_next_day` host prompt when lynched, before the
    trailing `PhaseAnnouncement`. Goldens prove the resolver event order and trace decision, and a
    command/projection vertical proves the prompt persists through `Command::ResolvePhase` and
    rebuilds identically. Broader vote-result host prompts are tracked separately below.
22. **No-majority revote host prompt** — APPLIED (R21/R22). Added v21
    `day_vote_prompt_policies`, with mafiascum mapping official `NoMajority` outcomes to a
    `HostPromptIssued { kind: "revote", reason: "no_majority" }` before the trailing
    `PhaseAnnouncement`. The existing tie/no-majority and Loved-threshold goldens now prove the
    prompt event; a trace assertion proves deterministic prompt attribution, and the Loved
    threshold command/projection vertical proves the `host_prompt` row rebuilds identically.
    The same generic policy now maps epicmafia `HostDecides` `Tie` outcomes to
    `HostPromptIssued { kind: "pk", reason: "host_decides_tie" }`, with a focused golden,
    trace assertion, and command/projection rebuild proof. R22 adds pack-declared
    `host_prompt_resolution_effects` rows for PK, revote, and skip-next-day prompts, with strict
    validation for decision/effect compatibility and producer coverage. `Command::ResolveHostPrompt`
    now maps projected prompts plus host decisions through those pack rows into a typed
    command-side `HostPromptEffect`, records `HostPromptResolved`, resolves the prompt row, and
    appends the host-selected PK kill through validated `ResolutionApplied`/`ResolutionTrace`
    envelopes. Host-prompt `PhaseAdvanced` payloads are now command-constructed through typed
    provenance fields, projection-validated before `phase_state` moves, and folded into host-only
    `host_phase_control` audit rows. Resolving a mafiascum
    no-majority revote prompt now advances to a fresh `D01R1` vote window; a command/projection
    vertical proves that the second `ResolvePhase` reads only the revote ballots, lynches, and
    rebuilds prompt, phase, and slot state identically. Resolving a Beloved Princess
    skip-next-day prompt now appends durable phase control to `N02` with `D02` recorded as the
    skipped day, rejects votes in that night window, and rebuilds prompt, phase, and slot state
    identically. Automated host scheduling around skipped day/night cadence remains future work.
23. **Cupid links and lover suicide** — APPLIED (R18). Added v3 `IrAbility::Link`, the
    state-bearing `PlayersLinked` result event, and folded `StateSnapshot.linked_slots`, so
    cross-slot lover state is event-derived and available to later resolutions. The mafiascum
    pack now carries `cupid.link_lovers`; goldens prove Cupid setup and lover-suicide generated
    death, and a command/projection test proves the link carries through persisted
    `Command::ResolvePhase` plus rebuild. Lover-suicide generated deaths now emit structured
    `DecisionTrace` attribution keyed by the folded link id, and the command/projection vertical
    rebuild-preserves that trace envelope. Hunter choice, babysitter/hider targeting policy, and
    lover private-channel metadata remain future work.
24. **Hunter chosen retaliation** — APPLIED (R19). Added v4 `IrAbility::Retaliate`, the
    state-bearing `RetaliationArmed` result event, and folded `StateSnapshot.retaliations`, so a
    Hunter can choose a target before dying and later generate a deterministic retaliation kill
    from event-derived state. The mafiascum pack now carries `hunter.hunter_retaliate`; goldens
    prove arming and later death-triggered retaliation, and a command/projection test proves the
    armed choice carries through persisted `Command::ResolvePhase` plus rebuild. Same-resolution
    post-trigger hunter choices and babysitter/hider targeting policy remain future work.
25. **Babysitter guard dependency** — APPLIED (R20). Added v5 `Modifier::Babysitter` as a
    pack-gated modifier that is legal only on `Protect` actions. The mafiascum pack now carries
    `babysitter.babysit`; the resolver records a guard dependency when the action protects a
    ward, and if the Babysitter dies in the same resolution the ward receives a generated
    `PlayerKilled` with cause `babysit`. A golden proves the target is first saved by Babysitter
    protection and then dies when the Babysitter is killed; a command/projection test proves the
    generated death through persisted `Command::ResolvePhase` plus rebuild. The generated ward
    death now emits structured `DecisionTrace` attribution carrying the submitted babysit action
    id, and the command/projection test rebuild-preserves that trace envelope. Hider targeting
    policy and broader guard/witch culture policy remain future work.
26. **Hider hide link** — APPLIED (R21). Added v6 `Modifier::Hider` as a pack-gated modifier
    legal only on one-target, resolution-scoped `Mark` actions. The mafiascum pack now carries
    `hider.hide` and hidden `hide_link`; the resolver records a same-resolution host-to-hider
    dependency, grants transient `untargetable` to the Hider only behind a known non-mafia host,
    and generates a `PlayerKilled` with the pack-declared
    `night_resolution.hide_dependency_cause_policy` cause if the host dies. Goldens prove direct kill
    suppression behind a town host and generated Hider death on host death; a command/projection
    test proves both through persisted `Command::ResolvePhase` plus rebuild. The generated hider
    death now emits structured `DecisionTrace` attribution carrying the submitted hide action id
    and template id,
    and the command/projection test rebuild-preserves that trace envelope. im-human currently has
    contradictory town-host host-death expectations across docs/death-trigger code and at least
    one regression, so exact culture-policy variants remain future work alongside broader
    guard/witch policy.
