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
70 > Investigate 50/40 > Kill 30) and wrote precedence-rule `notes` asserting "Block is
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

Mafia Goon / Godfather / Ninja / Strongman all share `template_id: "factional_kill"`. The
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
2. **Godfather result-flip home** — APPLIED (R2). Added `effects: Vec<Tag>` to `Role` and
   `SlotState`; added optional pack table `investigation_overrides: Map<Tag, ResultOverride>`
   (canonical home for Godfather, forward-compatible with Miller/framers). Pack gains
   `{ "godfather": { "Parity": "town" } }`.
3. **Track result is graph-derived** — APPLIED (R3). Documented in the IR/Investigate spec and
   determinism rules: Track/Watch/Motion results are graph-derived and not `VisibilityRule`-
   configurable beyond hide/show.
4. **Blocked-action channel** — APPLIED (R4). Added `ActionInterfered { actor, reason }` inner
   event; `EffectNotification` is reserved for Mark/Clear and is NOT the roleblock channel.
   `roleblock_stops_action.json` now emits `ActionInterfered{actor: slot_2, reason: "roleblocked"}`
   and no `InvestigationResult`.
5. **Precedence evaluation order** — APPLIED (R3). Determinism rules now state descending
   `Constraints.priority`, canonical phase order Block → Redirect → Protect → Kill →
   Investigate, and that rules are consulted at the point each ability resolves.
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
