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

### Current vocabulary (structure-complete, versioned additions)

We ship the full pack *structure* but a deliberately small *vocabulary*, then grow it:

```rust
/// IR ability vocabulary. Closed set, versioned by `ir_version`.
/// v1 shipped the first 8; additions (poison, delay, busdrive, grant, remove,
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
    Grant,        // v2: create a generated capability/item grant
    Link,         // v3: create a foldable cross-slot link fact
    Retaliate,    // v4: arm a chosen death-triggered retaliation target
    Visit,        // v24: record a source-aware visit fact with no other effect
}

/// Investigate is parameterized rather than split into many primitives.
enum InvestigateMode {
    Parity, Vanilla, Neapolitan, Gunsmith, Role, FullRole, Track, Watch, Motion, PriorMotion
}
```

> Why this subset: it covers the common roles across all four target cultures (cop, doctor,
> roleblocker, bus driver, tracker/watcher, recruiter, and persistent-effect roles like
> poisoner via `Mark`+a delayed trigger). `retaliate`, `poison`, `delay`, `busdrive` as a
> distinct primitive, etc. arrive via **triggers** (below) and later `ir_version` bumps —
> never a breaking change. (im-human's full set is ~16: `kill, protect, block, redirect,
> busdrive, investigate, track, watch, convert, poison, delay, mark, clear, grant, remove,
> retaliate`. `Grant` was the first v2 addition; `Link` is the first v3 addition for
> Cupid/lovers-style cross-slot state; `Retaliate` is the first v4 addition for
> Hunter-style chosen death retaliation. `Modifier::Babysitter` is the first v5 modifier
> addition for protect-plus-death-trigger guard dependencies. `Modifier::Hider` is the first
> v6 modifier addition for same-night hide links. The rest grow in as packs demand.)

### Modifiers

Capability flags that adjust how an ability interacts with the precedence/visibility tables:

```rust
enum Modifier {
    Strongman,    // kill bypasses protect
    Ninja,        // action hidden from track/watch/investigate
    Loyal,        // immune to conversion
    Bodyguard,    // protect intercepts a saved kill and kills the protector
    Martyr,       // protect intercepts with martyr_intercept attribution
    Cpr,          // protect saves only if needed; otherwise kills its target
    Babysitter,   // protected ward dies if the protecting actor dies
    Hider,        // hide link: actor becomes untargetable behind non-mafia host
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
    item_actions: Map<Tag, ActionTemplate>, // generated item actions keyed by grant_id
    roles: Map<RoleKey, Role>,
    precedence: Vec<PrecedenceRule>,        // conflict resolution
    visibility: Map<IrAbility, VisibilityRule>,
    redirects: RedirectPolicy,
    triggers: Vec<TriggerRule>,
    vote: VotePolicy,    // NEW vs im-human: vote rules are culture-specific
    phases: PhasePolicy, // NEW: cadence / subsegments per culture
    investigation_overrides: Option<Map<Tag, ResultOverride>>, // OPTIONAL; result-flip table (below)
    investigation_results: InvestigationResultPolicy, // OPTIONAL; culture-owned result labels
    effects: Map<Tag, EffectPolicy>, // OPTIONAL; lifecycle/visibility policy for Mark/Clear tags
    conversion_policy: ConversionPolicy, // OPTIONAL; timing/conflict policy for Convert
    ita: ItaPolicy,     // OPTIONAL; Mafia Universe ITA session policy, default empty
    death_retaliation: DeathRetaliationPolicy, // OPTIONAL; culture-gated chosen final shots
    idiot_policy: IdiotPolicy, // OPTIONAL; culture-gated first-lynch survival and vote loss
    win: WinPolicy,      // win conditions, evaluated on the post-resolution state (below)
}
```

`domain::validate_pack` is the v1 semantic gate after deserialize. It rejects unsupported
`version` / `ir_version`, invalid role/alignment/effect references, illegal
`mode` / `effect` / `reads_effect` combinations, target cardinality mismatches, action
windows absent from the declared cadence, bad vote weight references, version-gated
action and policy surfaces, and invalid win alignment references before a pack can drive
command-side resolution. `validate_pack_required_ir_version` derives the minimum
`ir_version` implied by declared features, so lowering a rich pack below its additive
feature floor fails even if individual fields deserialize.

Pack reads now enter through `domain::load_pack_from_json`, which calls
`domain::upcast_pack_json` before deserializing and validating the `Pack`. The current migration
table has a v1 identity path and a v0-to-v1 path for the legacy `vote_policy` / `phase_policy` /
`action_order` / role-local `action_templates` shape. Unsupported pack versions fail with an
explicit "no migration path is registered" error before command-side resolution can append
`ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`. The operational smoke tool is
`cargo run -p commands --bin upcast_pack -- --check <packs/name/pack.json>`; the legacy fixture
`packs/test_pack_v0_legacy_shape/pack.json` proves the migration normalizes to pack v1 / IR v1,
and `resolve_phase_loads_upcast_v0_pack_before_append` proves the command path can submit,
resolve, validate, and project through the migrated pack.

Golden fixture checking/regeneration uses the same boundary: `domain::golden_events_from_input_value`
reruns a fixture input, `domain::normalize_golden_event` strips only explicitly non-canonical
`DayVoteOutcome.reason` / `WinReached.reason` prose plus whole-number JSON float drift, and
`cargo run -p commands --bin check_goldens -- --check` walks `packs/*/golden/*.json`. Fixtures
that intentionally model a pack-policy variant declare `pack_overrides` in the fixture; the current
repo-wide proof checked 307 golden fixtures without drift. Write-mode is
`cargo run -p commands --bin check_goldens -- --write <fixture-or-dir>`; binary test
`write_mode_regenerates_a_drifted_temp_fixture` proves it repairs a drifted temp-copy fixture and
that the regenerated copy immediately passes check-mode.

Current additive IR gates are:

| Minimum `ir_version` | Gate |
| --- | --- |
| 2 | `IrAbility::Grant` |
| 3 | `IrAbility::Link` |
| 4 | `IrAbility::Retaliate` |
| 5 | `Modifier::Babysitter` |
| 6 | `Modifier::Hider` |
| 7 | `IrAbility::Badge` |
| 8 | `IrAbility::Duel` |
| 9 | `IrAbility::ItaShot` |
| 10 | `IrAbility::SelfDestruct` |
| 11 | `wolf_carry` |
| 12 | `wolf_beauty` |
| 13 | `guard_policy` |
| 14 | `death_retaliation` |
| 15 | `idiot_policy` |
| 16 | `lover_policy` |
| 17 | `backup_policy` |
| 19 | `target_lynch_win_policies` |
| 20 | `beloved_princess_policy` |
| 21 | `day_vote_prompt_policies` |
| 22 | `host_prompt_resolution_effects` |
| 23 | `ActionTemplate.result_memory` |
| 24 | `IrAbility::Visit` and `InvestigateMode::PriorMotion` |
| 25 | `RedirectKind::Rotate` and `self_lynch_win_policies` |
| 26 | non-default `death_reveal` |
| 27 | non-empty `role_modifiers` |
| 28 | `Modifier::Simultaneous` |
| 29 | `private_channels` |
| 30 | `treestump_policy` |
| 31 | `ita.role_overrides` |
| 32 | `ita.modifier_components` and `ita.role_modifier_refs` |
| 33 | `IrAbility::RevealTown` |
| 34 | `IrAbility::VoteDuel` |
| 35 | `faction_actions` |
| 36 | `InvestigateMode::Vanilla`, `InvestigateMode::Neapolitan`, and `InvestigateMode::Gunsmith` |
| 37 | `InvestigateMode::Role` |
| 38 | `InvestigateMode::FullRole` |
| 39 | investigator-scoped / same-different `ActionTemplate.result_memory` |
| 68 | explicit `backup_policy.priority` |

The guard tests are `pack_required_ir_version_covers_versioned_action_features`,
`pack_required_ir_version_covers_versioned_policy_features`, and
`pack_ir_version_must_cover_declared_additive_features`; `shipped_packs_validate`
keeps the shipped packs honest against the same map. `unsupported_version_fixture_is_rejected_by_pack_linter`
proves unsupported pack/IR versions are rejected at the pack boundary, and
`resolve_phase_rejects_unsupported_pack_versions_before_append` proves command-side resolution now
uses the upcast/load boundary and surfaces unsupported pack versions before appending
`ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.

### Roles → action templates

```rust
struct Role {
    description: String,
    alignment: Option<AlignmentKey>,   // pack-defined; engine treats as opaque tag
    actions: Vec<ActionTemplate>,
    effects: Vec<Tag>,                 // persistent effect tags carried by the role (default empty)
}

struct ActionTemplate {
    id: String,
    source_ids: Vec<String>,          // source-catalog ids covered by this canonical fmarch id
    ability: IrAbility,
    additional_abilities: Vec<IrAbility>, // default empty; one submission can compose primitives
    window: Window,                 // Day | Night | Any
    targets: TargetSpec,            // None | One | Many | Group  (cardinality lives in Constraints.max_targets)
    modifiers: Vec<Modifier>,
    constraints: Constraints,
    mode: Option<InvestigateMode>,  // REQUIRED iff ability == Investigate; absent/null otherwise
    result_memory: Option<ResultMemorySpec>, // OPTIONAL; prior-result baseline policy for Investigate
    redirect: Option<RedirectKind>, // REQUIRED iff ability == Redirect; see redirect policy
    effect_duration: Option<EffectDuration>, // Persistent | Resolution; action-local migration override
    grant: Option<GrantSpec>,       // REQUIRED iff ability == Grant
    badge: Option<BadgeSpec>,       // REQUIRED iff ability == Badge
    duel: Option<DuelSpec>,         // REQUIRED iff ability == Duel
    conversion: Option<ConversionSpec>, // v2 Convert policy: AssignRole | RestoreOriginal
}

struct Constraints {
    max_targets: u16,
    self_allowed: bool,
    unique_targets: bool,
    target_state: Option<TargetState>, // Any | Alive | Dead; omitted targeted actions default Alive
    roleblockable: bool,
    priority: i32,                  // resolution priority within a window
    x_shots: Option<u16>,          // limited-use abilities
    cooldown_cycles: Option<u16>,  // same-phase-kind cooldown after legal use
    active_from: Option<ActivationGate>, // novice/activated phase gate
    phase_parity: Option<PhaseParity>, // Odd | Even, for odd/even phase-kind actions
    cycle_parity: Option<PhaseParity>, // Odd | Even, for odd/even game-cycle actions
}
```

`invalid_action_contract_fixture_is_rejected_by_pack_linter` proves missing `Investigate.mode`
and illegal non-`Investigate` mode are rejected at the pack boundary; the Postgres command test
`resolve_phase_rejects_invalid_action_contract_before_append` proves the same malformed pack cannot
append `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.

`invalid_reference_contract_fixture_is_rejected_by_pack_linter` proves malformed role, alignment,
effect-tag, and policy action references are rejected at the pack boundary;
`resolve_phase_rejects_invalid_reference_contract_before_append` proves the same malformed pack
cannot append `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.

`invalid_trigger_reference_contract_fixture_is_rejected_by_pack_linter` proves trigger filter tags,
duplicate trigger ids, unsupported actor/target refs, unsupported generated abilities, and invalid
generated Kill modifiers are rejected at the pack boundary;
`resolve_phase_rejects_invalid_trigger_reference_contract_before_append` proves the same malformed
pack cannot append `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.

`invalid_target_window_contract_fixture_is_rejected_by_pack_linter` proves `TargetSpec::None`
cardinality/state mismatches and action windows absent from `phases.cadence` are rejected at the
pack boundary; `resolve_phase_rejects_invalid_target_window_contract_before_append` proves the same
malformed pack cannot append `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.

`ActionTemplate.source_ids` is a parity/accounting field, not a command alias table.
Submissions still use the canonical `id`; `source_ids` records source-catalog action names that
the canonical fmarch template intentionally covers. The Chinese structured wolf faction kill is
canonicalized as `wolf_night_kill`, with source id `night_kill` from the im-human Wolf and White
Wolf King drafts.

`Pack.faction_actions` declares same-faction submissions that are target votes for one shared
action rather than independent executions. The initial supported quota is one resolved submission
per declared action/alignment. The resolver uses each submission's first target as the faction vote,
keeps the earliest representative for the winning target, emits `faction_vote_superseded` for other
same-target votes, and with `target_tie: BlockAll` emits `faction_vote_tie` for split top targets.
Chinese structured uses this for `wolf_night_kill`; broader "N kills per faction" quotas remain a
future additive policy.

`Pack.effects` is the canonical v1 policy table for `Mark`/`Clear` tags. Each
`EffectPolicy` declares `duration` (`Persistent` by default; `Resolution` for same-resolution
state such as `commuted`) and `visibility` (`Hidden`, `Public`, `Actor`, `Target`,
`ActorAndTarget`; `Hidden` by default). A non-hidden `Mark` emits
`EffectNotification { effect, status: "marked", audience }`; a non-hidden `Clear` emits the
same shape with `status: "cleared"`. `ActionTemplate.effect_duration` remains as an
action-local override during the port, but pack-level policy is the preferred authoring
surface. Durable state honors that expiry boundary: only `Persistent` marks fold into
`StateSnapshot.effect_records` and projection `slot_effect` rows, while any
`EffectsMarked { duration: Resolution }` event expires before cross-phase snapshot state and
therefore cannot leak into a later resolver input.

`Pack.investigation_results` is the pack-owned label table for base information results.
The default Parity vocabulary remains `town` / `scum`, but a culture can rename those labels
without a resolver branch. Chinese structured Prophet uses the ordinary `Investigate` +
`Parity` mode for `investigate_alignment`, while its pack maps `town -> good` and
`wolf -> evil` so `InvestigationResult.result` matches the source culture wording.
Role-set investigation modes are the v36 extension: `Vanilla`, `Neapolitan`, and `Gunsmith`
read `investigation_results.role_sets.vanilla_roles` and `.gun_bearing_roles`, so culture
packs decide which roles count as vanilla or gun-bearing without hardcoding role ids in the
resolver.
Role disclosure is the v37 extension: `Role` emits `{ "role": "<role_key>" }`, letting packs
model Role Cop style private disclosure with the same `InvestigationResult` projection/privacy
surface as other investigation modes.
Full-role disclosure is the v38 extension: `FullRole` emits
`{ "role": "<role_key>", "alignment": "<alignment>" }`, so culture packs can model Full Cop
style private disclosure without a bespoke role branch.

`ActionTemplate.result_memory` is the v23 prior-result memory policy for `Investigate`
actions. `record: true` emits state-bearing `InvestigationMemoryRecorded`; `compare_previous:
true` formats the player/admin-facing `InvestigationResult.result` as `{ previous, current,
changed }` using the folded baseline for the same investigator, target, and mode. The raw
current result remains the value recorded for future resolutions. This keeps
`InvestigationResult` a per-resolution fact while moving future-affecting baselines into
`StateSnapshot.investigation_memory` and the rebuildable `investigation_memory` projection.
The v39 extension lets packs set `scope: "Investigator"` and `output: "SameDifferent"` for
Parity Cop style roles: the first scan emits the raw parity label, later scans compare against
that investigator's prior baseline and emit `same` or `different`, while the raw current result
continues to replace the folded baseline for replay.

`IrAbility::Visit` is the v24 source-aware visit primitive. It emits
`VisitRecorded { actor, target, template_id, source_action, phase_id, phase_kind, phase_number,
visible }`, folds into `StateSnapshot.visit_history`, and persists in the rebuildable
`visit_history` projection. It intentionally has no other effect; roles that kill, protect,
mark, or investigate still use those primitives. `InvestigateMode::PriorMotion` reads that
folded visit ledger and returns `{ "prior_motion": bool }`, true when the target either made
or received a prior visible visit. Ordinary `Motion` remains a same-resolution graph query.

`IrAbility::Grant` is the first v2 IR addition. A `Grant` action carries `GrantSpec {
grant_id, kind, uses, visibility }`, where `kind` is `ExtraAction` or `Item`; selectable grants
declare pack-owned `grant_options`. The resolver emits state-bearing `ActionGranted` plus a
private/player-facing `EffectNotification` when the grant visibility is non-hidden. For selectable
grants, `ActionGranted.grant_option` records the chosen option, and that fact is folded into
`StateSnapshot.action_grants` and the rebuildable `action_grant` projection. `SubmitAction.grant_id`
spends generated extra actions and generated items explicitly; `ActionGrantConsumed` decrements
folded/projected remaining uses. Item spends also emit
`ActionUseCounted { counter_id: "inventory:<grant_id>", cadence_policy: "inventory",
phase_scope: "grant" }`, so generated inventories share the typed `action_counter` surface with
x-shot, cooldown, shield, and ITA-session use. Direct resolver callers and command validation both
treat exhausted inventory counters as authoritative. Item grants are spendable only when
`Pack.item_actions` declares a matching generated action keyed by the grant id, keeping item
templates in pack data rather than role code. The mafiascum pack proves both an information item
and a vest item: `bulletproof_vest_item` is a generated `Mark` action that writes the persistent
`bulletproof_vest` effect, which a later kill consumes through the ordinary vest save path and
records as typed shield consumption in `action_counter`.

im-human's `schedule` primitive is a tier/primitive marker for grant-like catalog actions such as
`motivate` and `grant_item`; fmarch maps those through `IrAbility::Grant`, not a separate
`Schedule` enum variant. Delayed death is the other scheduling surface: persistent poison emits
`DelayedDeathQueued`, a later resolution emits `DelayedDeathResolved`, and the rebuildable
`delayed_death_queue` projection stores only active future death queues. Because the queue depends
on a durable mark, pack validation rejects `poisoned` Mark actions whose effective duration is
`Resolution`.

im-human's `phase_skip` primitive is modeled as prompt-driven phase control. The pure resolver
emits `HostPromptIssued { kind: "skip_next_day" }` for configured deaths such as Beloved Princess;
the command layer then resolves the prompt with `HostPromptResolved` and a provenance-bearing
`PhaseAdvanced { reason: "skip_next_day", skipped_phase_id }`. `host_prompt` and
`host_phase_control` are rebuildable projections, and invalid cadences reject the prompt
transition before any control event is appended.

The source-derived im-human primitive contract does not currently expose a standalone `remove`
handler. fmarch therefore keeps removal specific to the thing being removed: persistent effects use
`IrAbility::Clear`, while role-ability removal/restoration is modeled as ordinary reversible role
mutation through `Convert::AssignRole` and `Convert::RestoreOriginal`. Schema fields such as
`base_actions` and `role_modifiers` are inventory metadata, not resolver primitives.
Broader item inventory catalog/UX beyond generated actions remains a later legality slice.

`IrAbility::Link` is the first v3 IR addition. A `Link` action targets at least two unique
slots and emits `PlayersLinked { link_id, slots, source }`. `apply_events` folds that into
`StateSnapshot.linked_slots`; lover-suicide reads the folded link state on later resolutions
instead of scanning old action submissions or trigger payloads.
Chinese structured Cupid uses the same primitive for `link_lovers` during the setup night:
`PlayersLinked` is the canonical fmarch mapping for im-human `note.cupid.link`, and later
lover death cascade is produced from folded link state by a shared post-death policy pass.
The pass runs over both night deaths and day deaths, so night kills, Witch poison, lynches,
and other day substep deaths all use the same folded state. Under standard NAR, if a linked
slot already died directly in the same resolution, `lover_suicide` stacks onto that existing
`PlayerKilled` event by adding the dead lover as an attacker and preserving a cascade trace
decision. v16 `lover_policy` controls whether that folded link generates `lover_suicide`,
records the source helper role (`lovers_helper`) as non-draftable culture metadata, and carries
the im-human `lovers_known_to_each_other` setting. When that flag is true, the link resolution
also emits a private `EffectNotification { effect: "lovers_link", status: <link_id>, audience:
<linked slots> }`; the platform folds it into `player_notification` so each lover can read the
knowledge after replay. Private lover communication/rooms remain later platform work.

`IrAbility::Retaliate` is the first v4 IR addition. A `Retaliate` action targets exactly one
slot and emits `RetaliationArmed { retaliation_id, actor, target, source_action }`.
`apply_events` folds that into `StateSnapshot.retaliations`; when the actor dies in a later
resolution, the chosen target is killed by `source_action` through the normal generated-kill
path. In standard-NAR packs, `standard_nar.chosen_retaliation_cause_policy` classifies each
folded `Retaliate` source action as ordinary or Strongman-like before the chosen shot can fire.

`IrAbility::Badge` is the first v7 rich-day addition. A `Badge` action carries `BadgeSpec {
badge_id, operation, vote_weight }`, where `operation` is `Elect`, `Pass`, or `Destroy`.
Election/pass target exactly one slot; destroy targets none. The resolver emits
`BadgeChanged` before the official day vote, folds it into `StateSnapshot.badges`, and stores
it in the rebuildable `sheriff_badge` projection. The Chinese structured sheriff badge uses
this to give the current badge owner a `1.5` vote weight until passed or destroyed.

`IrAbility::Duel` is the first v8 rich-day kill addition. A `Duel` action carries
`DuelSpec { hostile_alignments }`, targets exactly one slot, and must use the Day window.
The Chinese structured Knight declares `hostile_alignments: ["wolf"]`. During `resolve_day`,
duel actions resolve before the official vote: hostile targets produce
`DuelResolved { result: Success, killed: target }` plus `PlayerKilled`, while non-hostile
targets produce `DuelResolved { result: Failure, killed: knight }` plus `PlayerKilled`.
Those pre-vote deaths are folded into the transient day snapshot before `DayVoteOutcome`, so
dead voters and dead candidates do not participate in the official tally.

`IrAbility::ItaShot` is the first v9 Mafia Universe rich-day addition. ITA sessions live in
pack-level `ItaPolicy { sessions, default_hit_chance, auto_close, vote_conflict }`; an
`ItaShot` action must be a Day/One-target action, and packs with `ItaShot` must declare at
least one session plus `vote_conflict: ResolveShotsBeforeVote`.
`ItaSessionSpec.shot_limit` is the pack-owned per-shooter session limit. Accepted limited shots
emit `ActionUseCounted { counter_id: "day_session:<session_id>:<template_id>",
cadence_policy: "day_session", phase_scope: "session" }` before `ItaShotQueued`; folded
`StateSnapshot.use_counters` and the rebuildable `action_counter` projection reject later
same-session shots before they can queue. During `resolve_day`, accepted shots emit
`ItaSessionOpened`, `ItaShotQueued`, `ItaShotResolved`, `ItaSessionUpdated`, and (when
`auto_close`) `ItaSessionClosed`. Sessions may also declare `buffer_delay_ms`; newly buffered
shots emit `ItaShotBuffered { session_id, action_id, template_id, actor_id, targets, submitted_at,
release_at, delay_ms }`, fold into `StateSnapshot.buffered_ita_shots`, and release from folded
state in a later command-resolved phase once `release_at <= logical_time`. A hit also emits ordinary
`PlayerKilled { cause: "ita_shot" }`, so lethal ITA hits fold through the same state/projection
path as lynches, night kills, and Knight duel deaths. `ResolveShotsBeforeVote` is the first
Mafia Universe day-conflict policy: ITA deaths are folded before `DayVoteOutcome`, and an
unvalidated ITA pack missing that declaration is rejected at the resolver seam rather than using
implicit Rust ordering. The first vertical uses a tiny
`mafia_universe` pack with a deterministic 50 percent D1 session and one shot per shooter;
release-time success, invalidation, and `REFUND_SHOT` replay now have command/projection rebuild,
trace, result-schema, and semantic minimizer proof. HP/shields and vulnerability modifiers are
covered by pack-owned ITA modifier components and role refs; v61 `hit_points` components now
feed `ItaCounters.hp_remaining` / `hp_damage` and `ItaShotResolved.hp_before` / `hp_after`, with
hybrid shield-plus-HP targets consuming shields before damaging HP.
v62 `ItaPolicy.lifecycle` lets packs opt into host/admin `ControlItaSession` operations for
manual open, pause, cancel, update, and manual close. Current-phase `ItaSessionControlRecorded`
stream events feed `DayPhaseInputs.ita_session_controls`; `resolve_day` emits
`ItaSessionLifecycleChanged` plus `ItaSessionAnnouncement`, records lifecycle trace decisions and
generated rows, and prevents paused/cancelled/closed sessions from queuing ITA shots.

`IrAbility::SelfDestruct` is the first v10 Chinese structured day-death addition. A
`SelfDestruct` action carries `SelfDestructSpec { cause, kill_target, sacrifice_actor,
unstoppable }`, must use the Day window, and targets exactly one slot. During `resolve_day`,
self-destruct resolves after badge changes and before ITA/Knight/vote: it emits
`WolfSelfDestructed` plus ordinary `PlayerKilled` events for the target and actor, so both
deaths fold before `DayVoteOutcome` and appear in the trailing `PhaseAnnouncement`. The first
vertical is `chinese_structured:white_wolf_king`.

White Wolf carry is the first v11 Chinese structured cross-phase culture trigger. The
`wolf_carry` pack policy declares eligible White Wolf roles, wolf-kill roles, the durable token
id, and the generated kill cause. When an eligible White Wolf King self-destructs, the resolver
emits `WolfCarryQueued` after the actor death; `apply_events` folds that token into
`StateSnapshot.wolf_carry_tokens`. The same folded token path covers the passive
`white_wolf_carry` role from the im-human Chinese draft: a prior typed `WolfCarryQueued`
envelope for that role is loaded into the next `ResolvePhase` snapshot and may be consumed by the
wolf faction kill. On the next wolf faction `Kill` action, the first submitted target remains
the ordinary wolf kill and each extra target consumes one pending carry token, emits
`WolfCarryUsed` (the canonical mapping for im-human `note.wolf.carry`), then resolves a normal
`PlayerKilled { cause: "wolf_carry" }` credited to the White Wolf owner. Wolf Beauty drag is the
first v12 Chinese structured day-death drag. The `wolf_beauty` pack policy declares the
persistent charm effect, eligible role keys, day-death causes, and generated drag cause. The
night `beauty_mark` action uses the ordinary `Mark` primitive and emits both `EffectsMarked` and
`WolfBeautyMarked`; repeated marks replace the owner-target relation and clear the previous tag.
When a marked Wolf Beauty is lynched, the day resolver emits `WolfBeautyDragged` (the canonical
mapping for im-human `note.wolf_beauty.drag`) plus ordinary
`PlayerKilled { cause: "trigger:wolf_beauty_drag" }` events for the dragged target before the
trailing `PhaseAnnouncement`. Chinese Witch is modeled as `heal_potion` (`Protect`) and
`poison_potion` (`Kill`) night actions; a poison death of a marked Wolf Beauty also emits
`WolfBeautyDragged` and the dragged `PlayerKilled` before the trailing night announcement. If
the dragged target already died directly in the same night, the drag note is still emitted and
`trigger:wolf_beauty_drag` stacks onto the existing `PlayerKilled` event as additional
attribution.
Chinese Guard is modeled as `night_guard` (`Protect`) with a v13 `guard_policy`: the pack
declares which Guard action ids may block configured kill causes such as `poison_potion`, which
Witch heal actions participate in same-target double-save policy, and that the shipped Chinese
same-target Guard+Witch rule is `NoDeath`. The same policy explicitly declares whether Guard
self-save and night-one Guard actions are legal; the shipped Chinese pack allows both, while
override goldens prove disabled self-save and disabled night-one variants fail through the normal
action-constraint path. Lethal same-target variants remain separate culture-policy work. Chinese
Hunter is modeled with the
existing `Retaliate` chosen-target state plus a v14 `death_retaliation` policy. The shipped
Chinese pack declares `timing: ImmediateBeforePhaseAnnouncement`, so an allowed chosen shot lands
in the same resolution before the trailing `PhaseAnnouncement` and emits no host prompt. It allows
that shot after `wolf_night_kill`/`lynch` deaths and suppresses it for `poison`/`poison_potion`
deaths, matching the im-human culture note that Hunter trigger availability depends on
poison-vs-ordinary death policy. Chinese Idiot is modeled without a
new event kind: v15 `idiot_policy` makes the first eligible lynch emit `PlayerSaved` with
reason `idiot_survival`, then marks the public persistent `idiot_vote_loss` effect with
`EffectsMarked`. Later official `DayVoteOutcome` calculation treats that effect as zero vote
weight; command vote submission also rejects later ballots from that slot with
`Reject::VoteNotAllowed` before appending `VoteSubmitted`, while a later lynch of the same slot
lands as an ordinary `PlayerKilled`. Chinese
Cupid/lovers policy is v16 `lover_policy`: it references the `lovers_link` effect metadata,
declares `source_helper_role: "lovers_helper"` without making that helper draftable, and gates
the generated lover-suicide death through `suicide_on_lover_death`. Chinese goldens cover the
night-kill, lynch, and Witch-poison cascade paths, and the command pipeline proves the setup
link can later drive night, day, and Witch-poison lover-suicide projection/rebuild.

Day announcements and last words are pack-level culture policy, not IR abilities. A pack may
enable `day_notes.announcements` to turn normalized `ResolutionInput.day_phase_inputs.
night_victims` into `DayAnnouncement` events, and may enable `day_notes.last_words.day_deaths`
to emit `LastWordsRecorded` for a lynched slot. Both events are typed public notes and state
no-ops; the ordinary `PlayerKilled` plus trailing `PhaseAnnouncement` remains the authoritative
death fold/reveal. v63 makes the public-note envelope pack-owned: night-victim announcements may
declare `template_id`, `audience`, and `role_payload` (`RoleKey` or `Hidden`), while last words
may declare `template_id`, `audience`, and `window`. v66 adds `day_notes.day_deaths`, which lets
a pack attach `template_id` and `audience` to the trailing day-death `PhaseAnnouncement` when a
Day/Twilight resolution actually produced deaths. v67 adds per-death `cause_templates`, so each
`PhaseAnnouncement.deaths[]` entry may carry its own `template_id`/`audience` based on the
pack-declared death cause. Mafia Universe opts into revealed-role night-victim notes, post-lynch
last words, public day-death trailer metadata, and per-cause public text for lynch, day-action,
ITA, and lover-suicide deaths. EpicMafia opts into public PK prompt-death text for
`host_prompt:pk`, while Chinese structured opts into culture-pack day-death trailer metadata plus
per-cause Hunter retaliation, lover-suicide, and lynch text where those causes are shipped.
Mafiascum opts into public trailer metadata plus per-cause lynch, Hunter retaliation,
lover-suicide, day-vigilante, self-destruct, Hero/VoteDuel retaliation, and Super-Saint
retaliation text. Pure goldens also prove hidden-role multiple-death ordering plus lynch,
day-action kill, ITA kill, Knight duel, White Wolf self-destruct, Wolf Beauty drag, Chinese
lover-suicide, Chinese Hunter lynch-retaliation, and Mafiascum day-action/retaliation ordering
through the trailer/per-death metadata path. The first
vertical is `mafia_universe`, with pure goldens plus Postgres command/projection rebuild and
semantic minimizer proof.

`Modifier::Babysitter` is the first v5 modifier addition. It is legal only on `Protect`
actions. The action protects its target normally; if the protecting actor dies during the
same resolution, the ward receives a generated `PlayerKilled` with the pack-declared
`standard_nar.guard_dependency_cause_policy` cause. This models im-human's mafiascum `babysit`
surface as pack data (`Protect` plus modifier) rather than a role-specific resolver branch. If
the ward already has a same-resolution death when the Babysitter dependency fires, the dependency
uses the standard stacking path: one `PlayerKilled` remains, the Babysitter is merged into
`attackers`, `unstoppable` is ORed, and trace records both `babysitter_dependency_death` and
`kill_stacked_on_existing_death`.

`Modifier::Hider` is the first v6 modifier addition. It is legal only on one-target,
resolution-scoped `Mark` actions. The action records a same-resolution hide link from host to
hider; if the host has a known non-mafia alignment, the actor receives transient
`untargetable` state for that resolution. If the host dies, the linked hider receives a
generated, unstoppable `PlayerKilled` with the pack-declared
`standard_nar.hide_dependency_cause_policy` cause. If that hider already has a same-resolution
death, the hide dependency uses the standard stacking path: one
`PlayerKilled` remains, the host is merged into its `attackers`, `unstoppable` is ORed, and
the trace records both `hider_dependency_death` and `kill_stacked_on_existing_death`.

`Convert` supports the original v1 direct role assignment and the v2 `ConversionSpec`
surface. `AssignRole` names the destination role explicitly; mafiascum `vanillaize` is modeled
as `AssignRole { role: "vanilla_townie" }`, not as a bespoke resolver branch. `RestoreOriginal`
reads the target's first folded `ConversionOriginRecord` and restores that role/alignment, so
vanillaize and deprogramming/restore mutation share the same foldable origin memory.
Packs with `Convert` actions must also declare `conversion_policy.on_dead_target = Block` and
`conversion_policy.on_pending_death = Block`. When a target was killed earlier in the same
resolution, the resolver emits `ConversionBlocked { reason: "dead_target" }` plus a
`night:conversion` trace decision instead of silently skipping or converting the dead slot. When a
target is alive but has an active delayed death that was not cleared in the same resolution, the
resolver emits `ConversionBlocked { reason: "pending_death" }`; the delayed-death resolver then
continues to apply or preempt that queued death under the normal pending-effect policy.
`Pack.backup_policy` owns backup inheritance. Passive backups use a configured effect prefix
such as `backup:`; when a matching role dies, the backup slot receives a normal
`PlayerConverted` into that role. Targeted backups are ordinary `Mark` actions using the
configured `targeted_effect`; the resolver emits `BackupTargeted { backup, source_target,
source_role, source_action, phase_id, phase_kind, phase_number }`, folds that source choice
into `StateSnapshot.backup_targets`, and later inherits the chosen source target's current
role when that source dies. v68 adds explicit `backup_policy.priority`: omitted priority keeps the
legacy `TargetedThenPassive` order, while `PassiveThenTargeted` lets a culture pack prefer a passive
role-specific backup tag when both passive and targeted source roles die in the same resolution.
`backup_priority_policy_is_explicit_and_versioned` proves explicit priority is gated behind v68,
and `backup_priority_targeted_over_passive` proves the shipped Mafiascum policy plus the alternate
passive-first resolver branch.

> **`mode` and `Investigate`.** `IrAbility` stays a **flat tag** (we do *not* parameterize the
> enum as `Investigate(InvestigateMode)`); the mode rides alongside on the template. `mode`
> is **REQUIRED iff `ability == Investigate`** and **must be absent/null** for every other
> ability. This is what distinguishes Cop (`Investigate` + `Parity`) from Tracker
> (`Investigate` + `Track`) in the IR — without it the two info roles are indistinguishable.
> Track/Watch/Motion results are **graph-derived** (computed from the interaction graph) and
> are NOT configurable via `VisibilityRule` beyond hide/show. `PriorMotion` is deliberately
> different: it reads the folded `visit_history` state from prior resolutions.
>
> **v1 scope.** v1 implements graph-derived **Track**, **Watch**, and **Motion**:
> Track returns `{ "visited": [SlotId, …] }` for post-redirect targets the tracked slot
> visibly visited; Watch returns `{ "visitors": [SlotId, …] }` for visible actors who
> targeted the watched slot; Motion returns `{ "motion": bool }`, true iff the target visibly
> visited or was visibly visited. The currently resolving info action is excluded from its own
> graph query, so a Motion Detector does not make its target active merely by checking it.
> `PriorMotion` returns `{ "prior_motion": bool }` from source-aware `VisitRecorded` history.

> **Action constraints and announcement modifiers.** v1 implements action-gating before the
> pack-derived night stages, and the same one-shot marker is used by the rich-day Knight duel
> substep. `constraints.phase_parity` suppresses odd/even phase-kind actions on the wrong
> numbered phase with `ActionInterfered.reason = "odd_night" | "even_night"`.
> `constraints.cycle_parity` is the distinct im-human odd/even-cycle gate; it suppresses actions
> on the wrong numbered game cycle with `ActionInterfered.reason = "odd_cycle" | "even_cycle"`,
> and pack validation rejects templates that combine the two parity gates. `ActionTemplate.window`
> is the canonical im-human night-specific/day-specific policy: command validation rejects
> wrong-window submissions before append, and the pure resolver emits
> `ActionInterfered.reason = "night_specific" | "day_specific"` if a valid template is injected
> into the wrong phase kind. `constraints.x_shots` is a positive pack-declared action-use
> limit: each legal attempt emits
> `ActionUseCounted { counter_id: "x_shot:<template_id>", actor, template_id, consumed_action,
> limit, used, remaining, phase_* }`, folds into `StateSnapshot.use_counters`, and persists in
> the rebuildable `action_counter` projection; later attempts from the same slot are suppressed
> as `"x_shot_exhausted"` only once the declared count is exhausted. Mafiascum
> `two_shot_vigilante` proves multi-shot counting through pure goldens plus a
> `ResolvePhase`/projection-rebuild vertical. `constraints.cooldown_cycles` uses the same counter surface with
> `counter_id = "cooldown:<template_id>"`, `cadence_policy = "cooldown"`, and
> `phase_scope = "phase_kind"`; command validation and the resolver suppress same-phase-kind
> attempts until the declared number of numbered cycles has elapsed. Mafiascum
> `long_cooldown_cop` proves a two-cycle window through pure goldens plus a
> command/projection/rebuild vertical that rejects N02/N03 and accepts N04. `constraints.active_from`
> models Novice/Activated gates as phase-kind/phase-number thresholds; before that threshold the
> resolver emits `ActionInterfered.reason = "novice_inactive" | "activated_inactive"`, and command
> validation rejects the same submissions before append. `constraints.target_state` is the
> pack-owned alive/dead target policy: omitted targeted actions default to `Alive`, explicit
> `Dead` supports future corpse-targeting actions, and `Any` is reserved for targetless or
> all-state actions. ITA `shot_limit` uses
> `day_session:<session_id>:<template_id>` counters so limited day-session shots are folded,
> projected, rejected by command validation, and replayed by the resolver after rebuild.
> Generated item spends use `inventory:<grant_id>` counters; command validation rejects exhausted
> inventory from `action_counter`, and the resolver emits `"inventory_exhausted"` when replayed
> state presents an exhausted inventory counter.
> `Modifier::Loud` and
> `Modifier::Announcing` emit public `EffectNotification` events naming the action template
> before the action resolves. `Modifier::Weak` is implemented for Parity investigations that
> return `"scum"`: the investigator receives the result, then dies with `cause = "weak"`.
> Macho is represented as a target-state effect tag (`"macho"`) on the protected slot; ordinary
> Protect effects do not save a macho target. `Modifier::NonConsecutive` records and checks
> action target history: a resolved action blocks the same actor/template from targeting the same
> slot on the next numbered night, emitting `"non_consecutive"` and an `ActionRecorded` audit
> fact with `status = "suppressed"`. `Modifier::Compulsive` emits `"compulsive_missing"` plus an
> `ActionRecorded` audit fact with `status = "missing"` when an alive slot has no matching night
> submission. In im-human V4 these two modifiers are metadata markers; fmarch v1 makes them
> enforcing resolver constraints so the pack can be played without a separate host-side shim.

> **Composed action templates.** `additional_abilities` lets one submitted action participate
> in multiple primitive stages without asking the command/API layer to submit phantom actions.
> The shipped mafiascum `jail` action is the first use: primary `Block` plus additional
> `Protect`, so the target is roleblocked during the Block stage and protected during the
> Protect stage. Validation rejects duplicate abilities and primary-ability repeats.

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

`Pack.standard_nar` is the first linter-backed conflict catalog over those precedence
edges. When enabled, it names the concrete pack action ids that participate in standard
block/protect/kill interactions: Block actions, ordinary Protect actions, Bodyguard
intercepts, Martyr intercepts, CPR Protect+Kill actions, Jailkeeper Block+Protect actions, and
ordinary and Strongman submitted Kill actions. It also declares the standard-NAR kill-cause
catalog used by protection and target-state save tables; validation checks that catalog against
the pack's night Kill/Retaliate actions and kill-producing triggers, and generated-trigger gaps in
protection/save and suppression classifiers are reported with the trigger id. Validation requires those ids to exist with the expected IR/modifier shape,
requires Bodyguard/Martyr actions to declare their generated intercept death causes through
`intercept_cause_policy`, requires CPR actions to declare their deferred harm causes through
`cpr_harm_cause_policy`, requires Babysitter-style dependencies to declare their generated ward
death causes through `guard_dependency_cause_policy`, requires Hider-style dependencies to declare
their generated hider death causes through `hide_dependency_cause_policy`, and requires the supporting Block/Protect/Kill precedence edges. For
enabled packs, submitted ordinary Kill, Bodyguard, Martyr, CPR, and Strongman classification is read from this
table; packs without the table continue to use the modifier vocabulary directly.
Folded Hunter-style chosen retaliation causes are classified by
`chosen_retaliation_cause_policy`, including whether the `source_action` bypasses protection as a
Strongman-style kill; the resolver fails closed before consuming `RetaliationArmed` state when a
standard-NAR Retaliate action is missing from that table.
Trigger-produced Kill causes in standard-NAR packs are also classified by
`generated_kill_cause_policy`, including the trigger `on` discriminant, produced actor,
produced target, and whether the generated cause bypasses protection as a Strongman-style kill;
the resolver fails closed before night or day trigger fixpoints if a kill-producing trigger is
missing from that table or if the declared shape drifts from the trigger rule.
`trigger_fixpoint_policy` separately declares which generated-kill triggers participate in the
bounded fixpoint, whether produced kills re-enter the frontier, which loop-cap source applies, and
whether trigger trace notes are required. Pack validation now also requires the
`generated_kill_cause_policy` and `trigger_fixpoint_policy` entries to move together for each
kill-producing trigger, so a future generated kill cannot be classified without an explicit
fixpoint contract or vice versa.
The shipped mafiascum policy also declares `kill_stacking: AggregateAttackers`: when multiple
landed kills hit the same target, the resolver emits one `PlayerKilled`, appends each distinct
attacker to its `attackers`, ORs `unstoppable`, and records a `kill_stacked_on_existing_death`
trace decision. Night `PhaseAnnouncement.deaths` is derived from the emitted `PlayerKilled`
events, so direct, generated, delayed, and stacked kills surface the same exact cause as the
durable death event. The same stacking rule applies when an intercept death races an
existing death for that protector: the protector keeps one `PlayerKilled`, while the pack-declared
intercept cause and generated attacker are merged into its attribution and trace.

### Visibility — what a result reveals

```rust
struct VisibilityRule {
    sees: Vec<VisField>,            // ActorId | TargetId | ActionType | Result | VisTag
    unless_modifiers: Vec<Modifier>,// e.g. tracker sees target UNLESS Ninja
}
```

`VisibilityRule` governs hide/show of a single emitting action's fields. It does **not** flip
a *result value* — that is the job of the `investigation_overrides` table below.
For packs with `Modifier::Ninja` actions, the validator requires an `Investigate` visibility
rule whose `unless_modifiers` includes `Ninja`, and the night resolver rejects a Ninja pack that
reaches resolution without that policy. This keeps tracker/watcher/motion hidden-visit behavior
pack-owned instead of silently revealing visits when a mutated or unvalidated pack omits the
table.

`Pack.death_reveal` is the separate v26 policy for death flips. It defaults to `Full`, may
override by kill cause (for example Mafiascum `janitor_kill -> Concealed`) or by target
effect/role tag (for example `flipless -> Concealed` or `alignment_only_flip -> AlignmentOnly`),
and folds through `PlayerKilled`. The projection keeps independent `role_revealed` and
`alignment_revealed` flags so `AlignmentOnly` packs can reveal alignment without pretending a
role flip occurred.

### Investigation overrides — result tampering by effect tag

The optional `investigation_overrides` table maps a persistent effect `Tag` to a
`ResultOverride`, which in turn maps an `InvestigateMode` to the result value returned when
the investigated slot carries that effect tag. This is the **canonical home for Godfather**
(carries the `godfather` effect → a `Parity` investigation reads `town`), Miller (carries
`miller` → `Parity` reads `scum`), framers (`Mark` writes `framed` before Investigate →
`Parity` reads `scum`), and any other `Mark`-driven result tampering.

```rust
/// Optional pack table: investigation_overrides: Map<Tag, ResultOverride>
/// e.g. { "godfather": { "Parity": "town" }, "miller": { "Parity": "scum" } }
struct ResultOverride {
    by_mode: Map<InvestigateMode, String>, // mode (at minimum Parity) -> overridden result value
}
```

The resolver consults this table when emitting an `InvestigationResult`: if the investigated
slot carries a tag present in `investigation_overrides`, and that tag's `ResultOverride` has
an entry for the active `InvestigateMode`, the override value replaces the otherwise-derived
result. Same-resolution `Mark` effects are visible to later investigations in the derived
night ability order; absent a match, the normal result stands.

> **v1 scope.** The `investigation_overrides` inner map keys are the `InvestigateMode`
> variant *name string* (e.g. `"Parity"`).

### Redirects — fixpoint policy

```rust
struct RedirectPolicy {
    order: Vec<IrAbility>,
    loop_cap: u16,                  // termination guard for redirect cycles
    tie_breaker: TieBreaker,        // Stable | Random | First
}

enum RedirectKind {
    Swap,      // Bus Driver: two targets swap places for later target readers
    Pull,      // Lightning Rod: target-reading actions are pulled to actor/target
    Retarget,  // Redirector: actions aimed at first target move to second target
}
```

> **v1 scope.** v1 applies redirect actions as an ordered target-rewrite graph before
> Kill/Protect/Investigate read targets. A single redirect action can rewrite a target at most
> once, so a Bus Driver swap (`a`↔`b`) remains one-hop while separate redirect actions compose
> deterministically. `loop_cap` bounds the number of rewrite rules applied to any target.
> Shipped mafiascum goldens cover Bus Driver `Swap`, Lightning Rod `Pull`, and a two-rule
> `Retarget` cycle that lands back on the original target. `tie_breaker` remains reserved for
> future same-source competing redirects.

### Triggers — reactive abilities

"On observed event X against a slot that has Y, produce ability Z." `X` can be an
ability landing on a slot (for example `Kill`) or a resolver observation such as `Visit`,
`Lynch`, `Death`, `EffectMarked`, `PhaseEnd`, or `Win`.
This is how bomb/vengeful retaliation and PGO visitor kills are expressed without new
role-specific primitives.

```rust
struct TriggerRule {
    id: String,
    on: TriggerOn,
    if_target_has: Vec<Tag>,        // modifiers/effects the target must carry
    if_actor_has: Vec<Tag>,         // modifiers/effects the observed actor must carry
    produces: TriggerProduction,    // { ability, actor: ActorRef, target: TargetRef, modifiers }
}

enum TriggerOn { Ability(IrAbility), Event(TriggerEvent) }
enum TriggerEvent { Visit, Lynch, Death, EffectMarked, PhaseEnd, Win }
enum ActorRef  { Actor, Target, TargetGuard, Other }
enum TargetRef { Actor, Target, Killer, Other }
```

> **Trigger fixpoint & loop-cap.** After core resolution, the resolver fires every trigger
> whose `on` observation lands on a slot matching `if_target_has` (matched against the slot's
> persistent `effects` tags plus any tags carried by the current observation, such as a freshly
> emitted `EffectsMarked` effect), emits a `Trigger { trigger_id, payload }`, and resolves the
> `produces` action (a produced `Kill` runs through the same kill path — Protect still applies).
> A produced kill becomes new `Kill` and `Death` observations, so trigger chains are a bounded
> fixpoint.
> **v1 reuses `redirects.loop_cap`** as the trigger iteration cap (no separate field): on
> reaching it the resolver records a diagnostic note in the trace and terminates
> deterministically. Shipped cases: **Bomb** (epicmafia), **Vengeful Townie** (mafiascum)
> on `Kill`, **Paranoid Gun Owner** (mafiascum) on `Visit`, **Super-Saint** (mafiascum)
> on `Lynch`, **Death-Cursed Townie** (mafiascum) on `Death`, and **Death Marker**
> (mafiascum) on `EffectMarked`. Phase-boundary passives use `PhaseEnd`; the resolver emits
> one `PhaseEnd` observation for each slot still alive after core resolution, with
> `actor == target == slot` and `source_cause == "phase_end:<phase_id>"`.
> Win passives use `Win`; when ordinary faction win policy would fire, the resolver removes the
> trailer, emits one `Win` observation for each alive slot with `actor == target == slot` and
> `source_cause == "win:<winner>"`, runs non-kill win triggers, rebuilds the trailer, and only
> then appends the final `WinReached` from the post-trigger state. Observation-local tags include
> `win` and `winner:<winner>`, while shipped `win_witness_observes` proves the trigger path without
> pretending win-triggered kills have protection semantics yet.
> In standard-NAR packs, `standard_nar.trigger_fixpoint_policy` declares the observed trigger
> `on`, `produced_kill_reenters`, `loop_cap: RedirectLoopCap`, and `trace: true` contract for each
> kill-producing trigger before the resolver enters the trigger loop. The linter requires this
> entry to pair with the trigger's `standard_nar.generated_kill_cause_policy` entry. Non-kill triggers such as
> `win_witness_observes` participate without generated-kill policy entries.
> The mafiascum PGO source role is canonicalized as `paranoid_gun_owner` in fmarch; the
> im-human `pgo` primitive maps to the role-carried `pgo` effect plus `pgo_shoots_visitor`
> trigger. Pack validation rejects a `pgo` effect unless the pack also declares a `Visit`
> trigger that produces `Kill { actor: Target, target: Actor }`. im-human's more selective
> `visitor_kill` primitive maps to `selective_visit_killer` carrying `visitor_kill` plus the
> `visitor_kill_marked_visitor` `Visit` trigger with `if_actor_has:
> ["visitor_kill_target"]`, so the pack decides which visitor tags are killed without a
> role-specific resolver branch. Pack validation rejects duplicate trigger ids and rejects empty,
> unknown, or duplicate effect tags in both `if_target_has` and `if_actor_has`, so trigger filters
> cannot silently depend on absent, typoed, or repeated tags.
> Trigger productions are also fail-closed to shapes the resolver can interpret: generated
> `Kill` may use `Actor`/`Target` actor refs, `Actor`/`Target`/`Killer` target refs, and only the
> `Strongman` modifier, while the only supported non-kill production is modifier-free
> `Visit { actor: Target, target: Target }`.
> The same strictness applies to kill-retaliation effects: `bomb` must declare a `Kill`
> trigger that produces `Kill { actor: Target, target: Killer }`, `vengeful` must declare a
> `Kill` trigger that produces `Kill { actor: Target, target: Actor }`, and
> `unstoppable_vengeful` must use the same shape with `Strongman`.
> Lynch retaliation is also pack-checked: `super_saint` must declare a `Lynch` trigger that
> produces `Kill { actor: Target, target: Actor }`, letting the day resolver's execution-responsible
> voter observation feed the same generated-kill fixpoint.
> Landed deaths also emit a separate `Death` observation. Mafiascum's `death_cursed_townie`
> carries `death_curse`, and `death_curse_retaliates` proves a pack-owned `Death` trigger can
> react to the death actor without overloading the `Kill` ability observation.
> Durable marks emit `EffectMarked` observations after `EffectsMarked`; the observation carries
> the fresh effect tag so `if_target_has` can match marks that are not yet folded into
> `StateSnapshot`. Mafiascum's `death_marker` uses `death_mark` to apply `death_marked`, and
> `death_mark_detonates` proves an effect-specific trigger can produce an ordinary protected kill
> through the same generated-kill fixpoint and trace path.
> Phase-boundary triggers follow the same generated-kill contract. Mafiascum's
> `phase_end_doomed_townie` carries `phase_end_doomed`, and `phase_end_doom_claims` proves a
> pack-owned `PhaseEnd` trigger can generate a self-kill before the trailing
> `PhaseAnnouncement`; slots already killed earlier in the same resolution do not receive a
> `PhaseEnd` observation.
> Win triggers run before the final result event. Mafiascum's `win_witness_townie` carries
> `win_witness`, and `win_witness_observes` proves a pack-owned `Win` trigger can emit a traceable
> `Trigger` before the rebuilt `PhaseAnnouncement` while `WinReached` remains final.
> In standard-NAR packs, every kill-producing trigger also needs a
> `standard_nar.generated_kill_cause_policy` entry. The table owns the trigger `on`,
> produced actor, produced target, and whether that trigger id is an ordinary generated kill or a
> Strongman-style protection bypass, so trigger-produced kills do not inherit source-shape or
> bypass semantics directly from resolver-local checks.

> **Persistent-effect action fields (`effect` / `reads_effect`).** Two optional, additive
> `ActionTemplate` fields support `Mark`/`Clear` and effect-reading kills:
> - `effect: Tag` — the tag a `Mark`/`Clear` writes/removes (REQUIRED for those abilities), and
>   the target role id a `Convert` recruits into (the cult leader's `effect: "cultist"`).
> - `reads_effect: Tag` — on a `Kill`, the action ignores its submitted targets and kills every
>   alive slot carrying that tag (the **Arsonist** `ignite` reads `"doused"`). This is the
>   cross-phase effect read that proves persistent state end to end: `douse` Marks `"doused"`
>   one night, `apply_events` carries it, and a later `ignite` reads it.
> - pending poison is represented without a new primitive: `poison` is a `Mark` of `"poisoned"`
>   plus state-bearing `DelayedDeathQueued`. On a later night, the resolver reads
>   `StateSnapshot.delayed_deaths` and emits `DelayedDeathResolved` as either `applied` or
>   `preempted_by_clear`; the visible/clearable `"poisoned"` tag remains the policy handle.
>   Fresh same-night poison queues for a later resolution and cannot kill immediately.
> - `invalid_effect_contract_fixture_is_rejected_by_pack_linter` proves missing/illegal `effect`
>   and illegal `reads_effect` fields are rejected at the pack boundary; the Postgres command test
>   `resolve_phase_rejects_invalid_effect_contract_before_append` proves the same malformed pack
>   cannot append `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked`.
>
> Both default-absent, so every existing pack and golden deserializes unchanged.

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
    weights: WeightPolicy,          // Equal | PerRole(Map<RoleKey,f64>) | Dynamic(policy)
    threshold_adjustments: Map<RoleKey, f64>, // target role -> threshold delta
    tie_breaker: VoteTieBreaker,    // NoElimination | Random | HostDecides | EarliestReached
}

struct DynamicVoteWeightPolicy {
    base: f64,
    effect_rules: Vec<DynamicVoteWeightRule>,
    grant_rules: Vec<DynamicVoteWeightGrantRule>,
}

struct DynamicVoteWeightRule {
    effect: Tag,
    weight: f64,
    priority: i32,
}

struct DynamicVoteWeightGrantRule {
    grant_id: Tag,
    priority: i32,
}
```

`WeightPolicy::PerRole` is strict pack data: every referenced role must exist and every
weight must be finite and non-negative. The mafiascum pack uses this for `doublevoter`
(`2.0`), `triplevoter` (`3.0`), `x_voter` (`2.0` in this pack profile), and `voteless`
(`0.0`); the official `DayVoteOutcome` includes the active ballots, per-slot weights,
weighted tallies, and total alive vote weight.

`WeightPolicy::Dynamic` is also strict pack data. A dynamic policy declares a finite
non-negative `base` weight plus at least one `effect_rules` or `grant_rules` entry. Every effect
rule references a declared effect, has a finite non-negative absolute `weight`, and has a unique
`priority`; every grant rule references a declared `GrantKind::VoteWeight` action whose
`vote_weight` is finite and non-negative, and shares the same unique priority namespace. The
resolver reads folded persistent slot effects and folded active `ActionGranted` vote-weight
facts from `StateSnapshot`, applies the highest-priority active rule for that slot, and otherwise
uses `base`. The `test_dynamic_vote_effect` pack proves this contract with a legal Night `Mark`
action that creates a folded `vote_empowered` effect and a legal Night `Grant` action that creates
a folded `vote_power_boost` grant, then later day votes where each source can make that ballot
contribute `2.0`. The `test_dynamic_vote_hammer` pack proves the command front door uses the
same folded `VoteWeight` state for live hammer simulation: with only two alive slots, slot 1's
single granted `2.0` ballot reaches the `2.0` majority threshold and atomically locks the phase.
The `test_dynamic_vote_prompt` pack proves the same state also drives host prompt generation:
granting slot 1 a `2.0` vote raises total alive weight to `4.0`, so two ordinary ballots on slot 1
fall below the `3.0` majority threshold and emit a revote `HostPromptIssued`.
The `test_dynamic_vote_pk` pack proves the plurality prompt branch too: slot 1's granted `2.0`
ballot turns an otherwise simple top plurality into a weighted `HostDecides` tie, emits a PK
`HostPromptIssued`, and the host-selected contender is killed through validated prompt envelopes.

`threshold_adjustments` is likewise strict pack data. Each referenced role must exist, and
the resolver applies the adjustment to that candidate's majority/supermajority threshold
with a minimum effective threshold of `1.0`. The mafiascum pack uses this for `loved`
(`+1.0`) and `hated` (`-1.0`), and `DayVoteOutcome.thresholds` records the effective
per-candidate thresholds used for dispute/audit. The pack linter rejects threshold
adjustments on plurality vote methods because plurality has no threshold to modify.

The vote policy validator now rejects malformed supermajority ratios, supermajorities that
are not stricter than simple majority, hammer enabled on plurality, empty or invalid
`PerRole` weight tables, malformed dynamic effect weight policies, and `EarliestReached` tie
breaking until the resolver implements that policy. `HostDecides`
ties are valid only when a `Tie` `day_vote_prompt_policy` has a matching `SelectSlot` /
`PkKill` `host_prompt_resolution_effect`, so host-decided day ties always have an executable
follow-up path. `NoElimination` and seeded `Random` are resolver-owned tie policies.

`no_lynch` is a first-class resolver target when `no_lynch_allowed` is true. It appears in
`DayVoteOutcome.votes`, `tallies`, and `contenders` like any other candidate, but a winning
`no_lynch` produces `VoteStatus::NoLynch`, no `winner`, and no day-vote `PlayerKilled` event.
The command front door also reads the game pack before appending `VoteSubmitted`: `SubmitVote`
rejects `VoteTarget::NoLynch` when `no_lynch_allowed` is false, and rejects self-targeted slot
votes when `self_vote_allowed` is false. When `hammer` is true, `SubmitVote` simulates the
official day-vote outcome after the proposed ballot and atomically appends `ThreadLocked` with
`reason: "hammer"` alongside the threshold-reaching `VoteSubmitted`; later ballots are rejected
through the same phase-lock path as host locks. Pack-declared x-voter, triplevoter,
effect/grant-based dynamic vote weights, and sheriff badge weights are supported.

### Host prompt resolution effects (fmarch addition)

Resolver prompt producers emit durable `HostPromptIssued` rows; packs also declare how those
prompts are resolved by hosts:

```rust
struct HostPromptResolutionEffectPolicy {
    id: String,
    prompt_kind: String,
    prompt_reason: String,
    decision: HostPromptDecisionKind,        // SelectSlot | Acknowledge
    effect: HostPromptResolutionEffect,      // PkKill | AdvanceRevote | SkipNextDay | AcknowledgeOnly
}
```

Validation rejects incompatible decision/effect pairs, duplicate prompt pairs, and v22 packs that
emit Beloved Princess or day-vote prompts without matching resolution effects. Command-side
`ResolveHostPrompt` loads the game's pack and derives the durable consequence from this table
before appending `HostPromptResolved`, `ResolutionApplied`/`ResolutionTrace`, or `PhaseAdvanced`.
For revote and skip-next-day effects, command construction uses a typed phase-control payload and
the projection fold validates `source_prompt_id`, `source_phase_id`, `reason`, and
`skipped_phase_id` before moving `phase_state`. Provenance-bearing phase movements also fold into
`host_phase_control` audit rows so host/admin tools can inspect prompt id, source phase, target
phase, skipped phase, and resolver identity without scanning raw events.

The projections crate also ships `audit_rebuild`, a rollback-only operator command/library report
that snapshots each rebuildable projection table for one game, replays the stored event stream, and
emits a JSON drift report without mutating live read models. The same report is exposed through
host/cohost-only `/games/{game}/projection-audit` JSON and
`/games/{game}/projection-audit/view` HTML, with API coverage for host/cohost success, non-host
rejection, synthetic `slot_state` drift rendering, and proof that rollback audit does not repair
the live tampered projection row. The projection audit HTML links the drifted-table count to the
first drifted table and gives drifted table rows plus before/rebuilt JSON blocks stable anchors.
The commands crate ships `audit_resolution`, which reruns
ordinary `ResolvePhase` envelopes from the stored event-prefix and compares both
`ResolutionApplied` and `ResolutionTrace` to the persisted payloads. It also reconstructs PK
`ResolveHostPrompt` envelopes from `HostPromptIssued` plus `HostPromptResolved` and compares the
host-selected kill envelope and trace. PK prompt resolution uses the same v67 day-death metadata
helper as the pure resolver, so a pack-declared `host_prompt:pk` cause template appears on the
trailing prompt `PhaseAnnouncement`. Revote and skip-next-day prompt decisions do not produce
resolution envelopes; their phase movement is audited through `host_phase_control`. Drifted
resolution phases include compact structural `diffs[]` entries with the envelope side, JSON path
or missing-envelope root, rebuilt expected value, and stored actual value, while retaining the
full rebuilt/stored envelope payloads for deeper inspection. The report also includes a compact
`summary` with status counts and first drift paths. Applied drift, trace drift, and missing-trace
cases are covered by command-level synthetic drift tests, and the `audit_resolution` binary is
covered for matched zero-exit JSON output plus drifted non-zero exit with the same `summary` and
`diffs[]` JSON. The same report is exposed through host/cohost-only
`/games/{game}/resolution-audit` JSON and `/games/{game}/resolution-audit/view` HTML, with API
coverage for host/cohost success, non-host rejection, and synthetic-drift rendering of summary
counts, phase status, drift path, expected/actual values, drift-row anchors, expected/actual JSON
anchors, and summary links to the first matching drift row. Richer trace browsing now has a first
operator surface: `inspect_trace`, `/games/{game}/resolution-traces` JSON, and
`/games/{game}/resolution-traces/view` HTML flatten stored `ResolutionTrace` rows with
stream-sequence anchors, decisions, redirect edges, generated actions, effect changes, visibility,
and notes. The trace view preserves the `run_id` filter and has API coverage for host/cohost
success, non-host rejection, filtered rendering, and one anchored decision plus redirect-edge
assertion. `/games/{game}/host-phase-controls/view` now renders those phase-control rows as
host/cohost-only HTML with prompt id, prompt reason, source phase, target phase, skipped phase, and
resolver identity. `/games/{game}/operator` provides a read-only host/cohost HTML index that links
projection rebuild audit, resolution replay audit, trace inspection, host phase-control audit, and
a proof-run command index for one game, with API coverage for host/cohost success and non-host
rejection. `/games/{game}/operator/proof-runs` is read-only and backed by
`docs/ops/proof-runs.json`: it exposes exact local commands for game-specific audits,
large-action-graph regression, seeded determinism lanes, generated culture lanes, default_open
lanes, the fixture minimizer, and a checked game-specific audit bundle without claiming
hosted/background execution. The API crate has a manifest validation test that rejects unknown
manifest fields, rejects unknown command-template placeholders, requires selectors for `cargo test`
entries, checks game/local scope consistency, and confirms each listed selector still names an
async test in `crates/commands/tests/pipeline.rs`. Manifest entries carry stable IDs, the proof-run
page renders those IDs as row anchors, and the API vertical proves a representative anchor renders.
`prove_game_specific_audits` now seeds a fixture-backed game, expands the manifest's three
game-specific command templates for that concrete id, executes them, and fails if expected audit
counts drift. With `--output`, it writes the same JSON report atomically through a temporary file
and rename; the operator proof-run page renders manifest-listed artifact paths display-only and,
when a local JSON artifact parses successfully with an internal `artifact_path` matching the
manifest row and a compatible `manifest_version`, also renders `game_id`, `manifest_version`, and
`retention_comparison.normalized_match` plus filesystem `modified_at_unix_seconds`,
`age_seconds`, and the manifest's `freshness_max_age_seconds`. Missing, malformed, stale,
path-mismatched, or version-mismatched local artifacts remain inert page metadata and do not execute
server work. The proof-run page header and status JSON also expose compact production/fixture
artifact summaries: production rows must be trusted for the browser smoke to pass, while fixture
rows are allowed to exercise negative states. The manifest-listed bundle was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --output target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json crates/commands/fixtures/night-passing.json`,
which created game `08d8a45f-6c3b-4401-8e31-8d7637f36a82` and wrote
`target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json`; `audit_rebuild`
returned `ok: true` with all 13 rebuildable projection tables matching, `audit_resolution` returned
`ok: true` with one matched `N01` phase and zero drifted/skipped envelopes, and `inspect_trace`
returned one anchored `N01` trace with four decisions covering result-contract validation,
protected kill resolution, and the two emitted inner events. This proves the local CLI bundle for
that fresh stored fixture game only; it is not hosted or background execution evidence.
The retention lane was then rerun with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --compare-with target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json --output target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json crates/commands/fixtures/night-passing.json`,
which created game `3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b`, wrote
`target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json`, and returned
`retention_comparison.normalized_match: true`. The allowed rerun drift is explicit:
`game_id`, `artifact_path`, command-embedded game UUIDs, `run_id`, `applied_stream_seq`, and
`trace_stream_seq` are normalized before comparison; other report fields must remain equal.
The manifest sets `artifact_freshness_max_age_seconds: 86400`, making local proof artifacts stale
after one day. The host/cohost operator proof-run HTML vertical was rerun with both local artifacts
present and now asserts that both artifact paths, parsed artifact metadata, and freshness fields
render for authorized hosts/cohosts, while preserving non-host rejection and the page text that it
does not execute background jobs. A focused API unit test covers missing, malformed, stale,
path-mismatched, version-mismatched, and valid artifact JSON fixtures: only the valid fresh artifact
renders parsed metadata. A query-gated `fixture=artifact-provenance` row suite now points at
missing, malformed, stale, path-mismatched, and version-mismatched local artifact fixtures; the
host/cohost API vertical, the live HTTP smoke vertical, and `npm run operator:browser-smoke` prove
those rows render `artifact not present locally`, `artifact metadata unreadable`, `artifact stale`,
`artifact path mismatch`, and `artifact manifest version incompatible` while row-local `game_id`,
`manifest_version`, and `retention_comparison.normalized_match` metadata are absent. The
host/cohost-only
`/games/{game}/operator/proof-runs/status` JSON endpoint mirrors the HTML table without executing
commands. Its current contract is `contract_version: 1`: the root carries game id, manifest
version, execution mode, production/fixture summary counts, and row families; each row carries
stable ids, fixture scope, rendered command, proof boundary, optional artifact path, artifact state
(`missing`, `malformed`, `stale`, `path_mismatch`, `version_mismatch`, or `trusted`), freshness
fields for trusted/stale artifacts, and trusted metadata only for fresh path/version-matching
artifacts. A focused API unit test validates the versioned shape, row-derived summary counts, and
state-specific fields across all eight artifact states. The proof-run manifest parser, artifact
classifier, status builder, contract DTO, and fixture rows now live in `commands::operator_proof`,
so the HTTP JSON endpoint and HTML page render the same shared model. The no-server
`cargo run -q -p commands --bin export_operator_proof_status -- <game> --fixture
artifact-provenance` exporter emits that same `contract_version: 1` JSON without starting Axum,
touching Postgres, or executing proof commands. The saved snapshot
`crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json` captures the
audited `artifact-provenance` contract projection with normalized game ids and artifact age/mtime
fields. `cargo run -q -p commands --bin audit_operator_proof_status -- --output
target/operator-proof/current-status-audit-report.json
crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json
target/operator-proof/current-status-audit-check.json` compares two status JSON files, writes the
saved audit report artifact, normalizes
`$.game`, game ids embedded in command text, `modified_at_unix_seconds`, and `age_seconds`, and
reports row-addressed JSON-path drift for command text, artifact states, freshness ceilings,
mismatch metadata, trusted metadata, and row-derived summary counts; the command exits nonzero on
drift. Focused shared-module tests prove a fresh `artifact-provenance` export matches that saved
snapshot and that mutating `checked-game-specific-audit-bundle` reports
`$.rows["checked-game-specific-audit-bundle"].artifact.state`. `docs/ops/proof-runs.json` now
publishes two local-only rows for those commands: `operator-proof-status-export` and
`operator-proof-status-snapshot-audit`, both with exact proof boundaries and stable
`#proof-run-{id}` anchors. The status-audit row is now a provenance-tracked production artifact:
the manifest declares `artifact_kind: operator_proof_status_audit_report`, expected input paths,
freshness, manifest version, and diff count; the shared classifier distinguishes missing,
malformed, stale, path-mismatched, input-mismatched, drifted, and trusted saved reports. The same
API vertical proves the v1 contract for all five trusted artifact
rows and all five untrusted fixture rows, plus the artifact-less status export row and trusted
status-audit/go-no-go/retention report artifact rows, non-host rejection, and summary counts (`production.trusted = 12`,
`production.non_trusted = 0`,
`fixtures.non_trusted = 5`), and compares the host/cohost HTTP status JSON with the no-server
shared model after normalizing the current game id and wall-clock-derived artifact age/mtime
fields. The host/cohost-only `/operator/proof-runs/status-audit` JSON route reads the saved
`target/operator-proof/current-status-audit-report.json` artifact and the companion
`/operator/proof-runs/status-audit/view` page renders the same normalized-field list, expected and
actual input paths, saved report path, and row-addressed diffs without executing proof commands.
The query-gated `fixture=artifact-state-drift` route mutates only the in-memory actual status JSON
and proves that a non-empty
`$.rows["checked-game-specific-audit-bundle"].artifact.state` diff is visible in JSON and HTML.
Additional query-gated `fixture=saved-report-malformed`, `fixture=saved-report-stale`, and
`fixture=saved-report-drifted` routes prove malformed, stale, and drifted saved-report artifact
states are visible without executing proof commands.
`cargo run -q -p commands --bin audit_operator_proof_artifacts -- --output
target/operator-proof/current-artifact-go-no-go-report.json
00000000-0000-0000-0000-000000000000` loads the published manifest, builds the shared
`artifact-provenance` status model, writes a compact report with production/fixture counts,
artifact row ids, paths, states, rerun commands, and trusted metadata carried from artifact
classifiers, and exits nonzero when any production artifact row is not trusted. The refreshed
compact report carries the large-action graph row's game id, elapsed milliseconds, threshold, trace
row count, and phase/decision trace-anchor booleans, plus the determinism fuzz row's actual and
expected family/seed counts and manifest-match boolean, so operators can audit those proof claims
without opening the underlying JSON files. The host/cohost-only `/operator/proof-runs/go-no-go`
JSON route and companion `/operator/proof-runs/go-no-go/view` page read that saved report without
executing commands.
Query-gated `fixture=missing-production-artifact`, `fixture=stale-production-artifact`, and
`fixture=drifted-production-artifact` modes prove production no-go states are visible in JSON and
HTML with `production.non_trusted = 1`.
The host/cohost API vertical, seeded live HTTP smoke, and `npm run operator:browser-smoke` now
assert the go/no-go JSON row metadata and rendered HTML for the large-action trace counters/anchor
booleans and determinism actual/expected family and seed counters.
The live HTTP and browser artifacts at
`target/operator-browser-smoke/live-http-dom-proof.json` and
`target/operator-browser-smoke/playwright-dom-proof.json` both record the base artifact path, the
retention artifact path, the status-audit report path, the go/no-go report path, both parsed
`game_id` values, `manifest_version: 1`,
`retention_comparison.normalized_match: true`, the five provenance fixture rows, their untrusted
markers, freshness checks, compact summary counts, and the `--compare-with` command text on the
proof-run page; the live HTTP artifact also records proof-run status JSON contract checks, and the
Playwright artifact records browser-fetched JSON `contract_version: 1`, row-derived summary, and
state-specific artifact checks, plus the go/no-go page's large-action and determinism trusted
metadata text. The Playwright smoke now fails if any production manifest artifact row is not
`trusted`, while still allowing query-gated fixture rows to prove negative states. This is
hosted/browser display evidence for existing local artifacts, not evidence that the server produced
them.
Artifact doc-truth rows for `docs/ops/proof-runs.json`: `checked-game-specific-audit-bundle`
currently has artifact state `trusted`, artifact path
`target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json`, and proof boundary
`Seeds a fixture-backed game, expands the manifest's game-specific command templates for that id,
executes them, and fails on mismatched audit counts.` `game-specific-audit-artifact-retention`
currently has artifact state `trusted`, artifact path
`target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json`, and proof boundary
`Regenerates the checked game-specific bundle and fails unless the old and new reports match after
normalizing expected rerun drift fields.` `operator-proof-status-snapshot-audit` currently has
artifact state `trusted`, artifact path `target/operator-proof/current-status-audit-report.json`,
and proof boundary `Compares the saved normalized artifact-provenance status snapshot against the
latest exported status, writes the audit report artifact, and fails on row-addressed contract
drift.` `operator-proof-artifact-go-no-go` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-artifact-go-no-go-report.json`, rendered command
`cargo run -q -p commands --bin audit_operator_proof_artifacts -- --output
target/operator-proof/current-artifact-go-no-go-report.json
00000000-0000-0000-0000-000000000000`, and proof boundary `Loads the
published proof-run manifest, classifies artifact-provenance rows, writes the compact go/no-go
report with trusted metadata for artifact rows that have proof-specific counters, and fails if any
production artifact row is not trusted.`
`operator-proof-artifact-retention` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-artifact-retention-report.json`, rendered command
`cargo run -q -p commands --bin audit_operator_proof_artifact_retention -- --output
target/operator-proof/current-artifact-retention-report.json
target/operator-proof/previous-artifact-go-no-go-report.json
target/operator-proof/current-artifact-go-no-go-report.json`, and proof boundary `Compares the
previous and current go/no-go reports after normalizing wall-clock freshness and fails on production
artifact state regressions.`
`operator-proof-projection-rebuild` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-projection-rebuild-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
audit_projection_rebuild_artifact -- --output
target/operator-proof/current-projection-rebuild-report.json
08d8a45f-6c3b-4401-8e31-8d7637f36a82`, and proof boundary `Runs the projection rebuild audit for
the checked fixture game inside a rollback-only transaction, writes a versioned report with table
counts, and fails on rebuild drift.`
`operator-proof-resolution-diff` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-resolution-diff-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
audit_resolution_diff_artifact -- --output
target/operator-proof/current-resolution-diff-report.json
08d8a45f-6c3b-4401-8e31-8d7637f36a82`, and proof boundary `Runs the resolution replay diff for
the checked fixture game, writes a versioned report with normalized stream-detail fields and
row-addressed envelope diffs, and fails on resolution drift.`
`operator-proof-trace-inspection` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-trace-inspection-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
audit_trace_inspection_artifact -- --output
target/operator-proof/current-trace-inspection-report.json
08d8a45f-6c3b-4401-8e31-8d7637f36a82`, and proof boundary `Exports the host/admin trace
inspection for the checked fixture game, writes a versioned report with normalized stream fields
and row-count summaries, and fails when no stored trace is available.`
`operator-proof-large-action-graph-performance` currently has artifact state `trusted`, artifact
path `target/operator-proof/current-large-action-graph-performance-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
audit_large_action_graph_performance_artifact -- --output
target/operator-proof/current-large-action-graph-performance-report.json`, and proof boundary
`Runs the dense Mafiascum N01 large-action-graph scenario, writes a versioned report with fixture
dimensions, replay/projection status, trace row count, explicit phase/decision trace anchoring
flags, elapsed milliseconds, and the configured regression ceiling, and fails when the ceiling,
audits, or trace anchors fail.` This command was rerun locally after refreshing the dev database to
the current projection migrations and emitted `ok: true`, `trace_row_count: 72`,
`phase_trace_anchored: true`, and `decision_trace_anchored: true`.
`operator-proof-determinism-fuzz` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-determinism-fuzz-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
audit_determinism_fuzz_artifact -- --output
target/operator-proof/current-determinism-fuzz-report.json`, and proof boundary `Runs the known
seeded command-pipeline replay/projection/trace scenario families as local Postgres integration
tests, writes a versioned report with exact expected family/seed manifest coverage and first
failing seed, and fails on failed, missing, or manifest-mismatched seeded families; this is
deterministic generator coverage, not exhaustive state-space verification.` This command was rerun
locally and emitted `ok: true`, `family_count: 12`, `seed_count: 57`, `expected_family_count: 12`,
`expected_seed_count: 57`, and `family_manifest_matched: true`.
`operator-proof-generated-shrink-matrix` currently has artifact state `trusted`, artifact path
`target/operator-proof/current-generated-shrink-matrix-report.tmp.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test
pipeline generated_shrink_matrix_writes_compact_operator_report -- --nocapture && test -f
target/operator-proof/current-generated-shrink-matrix-report.tmp.json`, and proof boundary `Runs
the bounded deterministic generated shrink matrix for PGO, PgoProjectionState, Babysitter, BabysitterProjectionState, Hider, HiderProjectionState, Hunter, HunterProjectionState, VengefulFixpoint, VengefulProjectionState, StrongmanVengefulFixpoint, BodyguardStrongmanVengefulFixpoint, BackupInheritance, BackupProjectionState, ConversionDeprogramming, ConversionProjectionState, MarkClearVisibility, MarkClearExpiry, PoisonCure, Ignite, ExtraAction, ItemGrant, PrivateNotification, Lovers, LoversProjectionState, Bomb, and
BombProjectionState against local Postgres, writes a versioned report with two cases per family plus success and
bad-expectation shrink preservation metadata, and does not prove exhaustive randomized coverage.`
This row is trusted through the artifact classifier with `ok: true`, `family_count: 27`,
`case_count: 54`, `expected_family_count: 27`, `expected_case_count: 54`, and
`family_manifest_matched: true`.
`operator-proof-command-projection-resolution` currently has artifact state `trusted`, artifact
path `target/operator-proof/current-command-projection-resolution-report.json`, rendered command
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
prove_command_projection_resolution -- --output
target/operator-proof/current-command-projection-resolution-report.json
crates/commands/fixtures/night-passing.json`, and proof boundary `Local-Postgres-only proof: seeds
the checked fixture through commands::handle, runs Command::ResolvePhase against the local
DATABASE_URL Postgres service, compares resolution replay and projection rebuild results for that
generated game, writes the saved report under target/operator-proof, and does not prove hosted,
multi-node, production, browser, or exhaustive state-space behavior.` This command was run against a
scratch database on the local Postgres service and emitted `ok: true`, 20 matched projection tables,
one matched resolution envelope, zero drifted tables, zero drifted phases, and zero diffs.
The API manifest unit test now mechanically checks those artifact doc-truth rows in both this
engine note and the checklist: every manifest row with an `artifact_path` must have its artifact
path, rendered command, exact proof boundary, current `trusted` artifact state, and production
go/no-go counts documented.
The report-only completion audit runs as `python3 tools/engine_port_completion_audit.py --output
target/operator-proof/current-engine-port-completion-audit.json` after regenerating the im-human
inventory/parity matrix with `python3 tools/im_human_engine_inventory.py --fmarch-root .`.
Read-only consumers can use `python3 tools/engine_port_completion_audit.py --check --output
target/operator-proof/current-engine-port-completion-audit.json`; it does not rewrite the saved
artifact, and fails if the saved audit is missing, stale versus any declared input, or different
from the generated report. The current artifact reports `ok: false`, `freshness.status: fresh`,
20 tracked inputs, eight parsed build-order phases, 192 exhaustive checklist rows, 192 checked
rows, 0 unchecked rows, zero rows marked `partly proven`, 593 parity-matrix rows, 2 unsupported
parity rows, 0 actionable unsupported rows, and 2 explicit out-of-scope test-family rows
(`feature_flags_test` and `init`). It also records `browser_smoke.ok: true`, 42 rendered HTML pages, one
browser-fetched JSON surface, all 14 browser-smoke-required go/no-go metadata needles present,
trusted metadata rows for large-action, determinism, and generated shrink matrix proof rows, and a
manifest/status trusted command/projection proof row that has not yet been promoted into the
browser-smoke required needle set. The audit now treats explicit out-of-scope parity rows as visible but non-actionable
and blocks completion on the four partial build-order phases: Phase 4 persistent/generated-action
systems, Phase 5 rich day systems, Phase 6 culture packs, and Phase 7 operational hardening.
A seeded live-HTTP smoke test now starts a local Axum server and verifies the operator index,
operator proof-run index, projection rebuild view, resolution replay view, resolution trace view,
host phase-control view, artifact go/no-go view, artifact retention JSON/view, projection rebuild
report JSON/view, resolution diff report JSON/view, trace inspection report JSON/view, and
retention/rebuild/resolution-diff/trace-inspection fixture views render expected headings, status
text, links, rows, or saved-artifact paths; it
writes repeatable DOM evidence to `target/operator-browser-smoke/live-http-dom-proof.json`.
`npm run operator:browser-smoke` now starts the Rust server on a temporary local port, seeds the
same operator-smoke game, drives Playwright Chromium through those operator HTML surfaces including
retention regression/recovery fixtures, projection rebuild report fixtures, and resolution diff
report fixtures, and trace inspection report fixtures, and writes
`target/operator-browser-smoke/playwright-dom-proof.json` plus one screenshot per page; the browser
artifact derives selectors from `docs/ops/proof-runs.json` and checks every rendered
`#proof-run-{id}` row anchor. Richer trace browsing has a first navigation layer:
each trace run summary links to anchored Decisions,
Redirect Edges, Generated Actions, Effect Changes, Visibility, and Notes sections. Decision and
redirect-edge rows also have stable copyable row anchors and links to their anchored JSON detail
blocks. A full graph UI remains future operational tooling.

There is also an initial seeded determinism fuzz lane in the command pipeline: generated
day-vote scenarios append legal vote changes/withdrawals, resolve with stored seeds, and then
require `audit_resolution`, `inspect_trace`, and `audit_rebuild` to agree. The manifest-listed
day-vote proof lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline seeded_day_vote_scenarios_replay_audit_and_rebuild_deterministically -- --nocapture`,
which passed one filtered pipeline test across its five deterministic seeds. A companion night lane
generates legal N01 action graphs across Doctor, Roleblocker, Tracker, Watcher, Bus Driver,
Mafia Goon, and Strongman before running the same audit trio. The manifest-listed night lane was
rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_night_action_graphs_replay_audit_and_rebuild_deterministically`,
which passed one filtered pipeline test across its five deterministic seeds. A trigger/dependency
lane now generates legal N01 graphs for PGO visit triggers, Babysitter dependency deaths, and Hider
host-death dependencies through `Command::SubmitAction`, then requires `audit_resolution`,
`inspect_trace`, and `audit_rebuild` to agree. The manifest-listed trigger/dependency lane was
rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_trigger_dependency_graphs_replay_audit_and_rebuild_deterministically`,
which passed one filtered pipeline test across its five deterministic seeds. A persistent-trigger
lane now generates legal two-phase Hunter retaliation and Cupid/Lovers games, proving folded N01
state is consumed by N02 resolution under the same audit trio. The manifest-listed persistent
trigger-state lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_persistent_trigger_state_replay_audit_and_rebuild_deterministically`,
which passed one filtered pipeline test across its four deterministic seeds. A day-trigger policy
lane now generates two fixed Mafiascum D01 games for Super-Saint lynch
retaliation and Hero/VoteDuel retaliation, proving legal votes/actions, `ResolvePhase`,
`audit_resolution`, anchored `inspect_trace` notes/generated rows, and `audit_rebuild`. The
manifest-listed day-trigger lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline seeded_day_trigger_policy_replay_audit_and_rebuild_deterministically -- --nocapture`,
which passed one filtered pipeline test across its two deterministic seeds. A large-action-graph
lane now resolves one deterministic 40-slot / 29-action Mafiascum N01 graph across redirect,
protect, investigation, kill, and
trigger/dependency families, then requires replay audit, trace inspection, projection rebuild,
bounded event/trace rows, and a generous local duration ceiling. The manifest-listed large
action graph lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands large_action_graph_resolves_and_audits_within_regression_ceiling`,
which passed one filtered pipeline test for the fixed dense graph. A bounded property-style lane
now generates six Mafiascum N01 cases from fixed seeds with variable roster composition, target
selection, and interference edges; failure messages include the seed, roster, and submitted
actions so cases can be promoted to fixed regressions. The manifest-listed generated Mafiascum N01
lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands generated_night_action_graphs_replay_audit_and_rebuild_deterministically`,
which passed one filtered pipeline test across its six fixed generated seeds.
`minimize_night_fixture` is the first developer tool for those promotions: it reads a replayable
JSON fixture, runs the same
resolution/trace/rebuild audit trio, and with `--reduce` greedily drops actions then slots while
preserving the original failure class. Fixtures can now carry semantic expectations for inner
events, anchored trace decisions, trace notes, and generated-action rows; the runner fails the
replay if those metadata-backed invariants are missing even when the generic audit trio is green.
`crates/commands/fixtures/night-babysitter-dependency-minimized.json` keeps the Babysitter dependency
case at four slots and three actions, while
`crates/commands/fixtures/night-hider-dependency-minimized.json` promotes a Hider host-death
dependency to three slots and two actions. `crates/commands/fixtures/night-pgo-trigger-minimized.json`
adds the trigger-note side of the lane with a two-slot, one-action PGO visit trigger replay that
checks the `Trigger` inner event, generated kill, generated-action trace row, and anchored
diagnostic note. `--reduce` now also runs for successful fixtures that declare expectations and
keeps a candidate only when the same semantic expectation count still passes. These minimized
trigger/dependency fixtures replay through legal commands and require `audit_resolution`, anchored
`inspect_trace`, and `audit_rebuild` to agree; this is covered by the
`minimized_trigger_dependency_fixtures_replay_semantic_expectations` Postgres selector. The generated
Mafiascum N01 replay helper now emits
matching `expectations` metadata for unambiguous PGO visit-trigger, Babysitter dependency-death, and
Hider host-death generated cases, avoiding raw-action inference when redirect/bus target mutation
or obvious actor suppression is present. `crates/commands/fixtures/night-pgo-trigger-nonminimal.json`
is the first success-shrinking regression: `--reduce` removes the irrelevant extra slot while
preserving all four PGO semantic expectations. `--write-reduced <path>` now writes the minimized
fixture after reduction; the non-minimal PGO replay was reduced into
`target/operator-proof/night-pgo-trigger-reduced.tmp.json` and replayed from that written file with
one audited resolution, one trace, clean projection rebuild, and all four semantic expectations
checked by `nonminimal_pgo_trigger_fixture_shrinks_to_checked_semantic_replay`. The report now
explicitly separates replay success, failure-class preservation, and
success-invariant preservation; `crates/commands/fixtures/night-pgo-trigger-bad-expectation.json`
is a negative semantic-expectation fixture proving `--write-reduced` can save a reduced failing
artifact without marking it as a promoted success fixture. `--write-report <path>` now persists the
same JSON report that is printed to stdout. The generated Mafiascum N01 failure-artifact proof
writes `target/operator-proof/generated-mafiascum-n01-bad-pgo-expectation.fixture.tmp.json`, invokes
`minimize_night_fixture --reduce --write-reduced --write-report`, and verifies the saved report
preserves `semantic_expectation` failure class while keeping `promoted_success_fixture: false`.
The Chinese Structured N01 failure-artifact proof now uses the same helper to write
`target/operator-proof/generated-chinese-n01-bad-prophet-expectation.fixture.tmp.json`, shrink it,
and verify the saved report preserves `semantic_expectation` failure class without promoting the
fixture as a success. This proves a reusable artifact-backed promotion path for generated Mafiascum
and Chinese Structured failure fixtures plus hand-minimized trigger/dependency replays, not
automatic property-test shrinking across every generated failure path. The Mafiascum and Chinese
Structured N01 generated replay lanes now route their resolve, result validation, event-count,
representative-event, audit, trace-count, anchored trace-decision, and projection-rebuild failures
through the shrink helper before panicking; the panic message includes the saved report path,
reduced fixture path, preservation booleans, and reduction step count. Setup and legal action
submission failures in those N01 replay lanes use the same shrink-backed wrapper. The Chinese
Structured D01 generated replay lane now uses the same saved artifact/minimizer report path for
setup, action/vote submission, resolve, result validation, event extraction, audit, trace-count,
anchored generated-row, and projection-rebuild failures. The Mafia Universe ITA generated replay
lane now uses the same shrink-backed path for setup, action submission, resolve, result validation,
event extraction, audit, trace-count, anchored generated-row, and projection-rebuild failures. The
Epicmafia D01 PK loop now emits minimizer-ready vote plus host-prompt fixtures, and routes setup,
vote submission, day resolve, prompt resolve, prompt payload validation, audit, trace-count,
anchored trace-decision, and projection-rebuild failures through saved shrink reports. The
Epicmafia N01 Bomb/Cult loop now routes setup, action submission, resolve, result validation,
Bomb trigger extraction, Cult/Loyal event extraction, audit, trace-count, trace note,
anchored generated-row, anchored trace-decision, and projection-rebuild failures through the same
saved shrink report path. Its minimizer fixture now preserves eight N01 semantic expectations for
the Bomb trigger, trigger-generated action row, trigger note, plain Cult conversion, Loyal
conversion block, and conversion trace decisions. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_night_fixture_replays_semantic_expectations_through_minimizer --test pipeline -- --nocapture`,
which passed one filtered pipeline test and checked all eight expectations through
`minimize_night_fixture`. The D01 PK minimizer fixture now also preserves the HostDecides tie
outcome, PK prompt issue, host-selected kill, and anchored prompt issue/resolution trace decisions
across the ordinary day and host-prompt resolution envelopes. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_pk_fixture_replays_prompt_through_minimizer --test pipeline -- --nocapture`,
which passed one filtered pipeline test, checked five PK expectations, and promoted the reduced
success fixture. The `default_open` N01/D01 generated replay lanes now use that same artifact-backed
minimizer path for setup, action/vote submission, resolve, result validation, event extraction,
audit, trace-count, exact anchored trace decisions, and projection-rebuild failures. Their
minimizer fixtures now also preserve lane-specific semantic expectations: N01 requires the
Guardian save, Seer scum result, and anchored save/investigation trace rows, while D01 requires the
lynch outcome, day-vote kill, town win, and anchored day-vote trace row. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`,
which passed one filtered pipeline test and checked four semantic expectations for each generated
default_open fixture through `minimize_night_fixture`. A non-mafiascum generated
replay lane now covers six
Chinese Structured N01 cases from fixed seeds across Wolf, Witch, Guard, Prophet, Cupid, Hunter,
Wolf Beauty, and passive roles using legal command submissions and the same audit trio. This
manifest-listed Chinese Structured N01 lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands generated_chinese_structured_night_graphs_replay_audit_and_rebuild_deterministically`,
which passed one filtered pipeline test across its six fixed generated seeds. Those six generated
N01 fixtures now also carry artifact-backed semantic minimizer expectations for Prophet parity
results, Witch heal/poison x-shot use, unsaved poison kills, Guard/Witch protection decisions when
the generated graph produces them, Cupid lover links plus private lover notices, Hunter
`RetaliationArmed`, and Wolf Beauty persistent mark rows. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_chinese_structured_night_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`,
which passed one filtered pipeline test across all six fixed seeds and checked every generated
Chinese N01 semantic expectation through `minimize_night_fixture`. `minimize_night_fixture` now also
accepts real command-submitted `setup_phases`, so folded-state Chinese cascade fixtures can seed an
N01 setup phase before minimizing the target N02. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands chinese_folded_state_cascade_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`,
which passed one filtered pipeline test covering Wolf Beauty drag after prior mark, Cupid
lover-suicide after prior link, Hunter retaliation after prior target choice, and Hunter poison
suppression after prior target choice. A second Chinese
Structured generated lane covers six D01 cases from fixed seeds with legal command
submissions for sheriff election, Knight duel, White Wolf self-destruct, and ordinary votes, then
requires replay audit, trace inspection, and projection rebuild. This manifest-listed Chinese
Structured D01 lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`,
which passed one filtered pipeline test across its six fixed generated seeds. A Mafia Universe
generated lane now covers six fixed-seed D01 ITA sessions with legal command submissions, several
queued shots, mixed deterministic hit/miss outcomes under the pack's 50 percent session policy,
and the same audit trio. This manifest-listed Mafia Universe ITA lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_mafia_universe_ita_sessions_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`,
which passed one filtered pipeline test across its six fixed generated seeds. The generated Chinese
Structured D01 and Mafia Universe ITA fixtures now also carry artifact-backed semantic minimizer
expectations for sheriff badge election, Knight duel x-shot/death semantics, White Wolf
self-destruct generated rows, ITA session open/update/close rows, every queued/resolved ITA shot,
and generic ITA hit/miss outcomes. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline generated_phase5_day_fixtures_replay_semantic_expectations_through_minimizer -- --nocapture`,
which passed one filtered pipeline test across all twelve fixed D01 seeds and checked every emitted
Phase 5 day semantic expectation through `minimize_night_fixture`. `minimize_night_fixture`
can now assert folded `sheriff_badge` projection rows, and dedicated Chinese sheriff fixtures
preserve election, pass, and destroy `BadgeChanged` events, badge-weighted `DayVoteOutcome`
rows, trace generated rows, projection rows, replay audit, rebuild audit, and reduced success
promotion. The ITA buffered-release fixtures now prove a setup-phase `ItaShotBuffered` folds into
`StateSnapshot.buffered_ita_shots`, then later command-resolved releases cover success,
same-release target-dead invalidation, `REFUND_SHOT` refund after an intervening target death, and
HP/hybrid protection where buffered shots either consume HP or preserve HP behind a spent shield;
the command tests audit/rebuild projections and the fixture lane promotes reduced success,
invalidated, refunded, and HP/hybrid semantic fixtures. This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline phase5_ita_buffered_release_fixture_replays_semantic_expectations_through_minimizer -- --nocapture`,
which passed one filtered pipeline test across the ITA buffered success, invalidation, refund, and
HP/hybrid release fixtures. ITA lifecycle controls now have pure golden coverage for manual
open/update/pause/resume/cancel/close, result-schema coverage for lifecycle payloads, and
command/projection plus minimizer proof for a host-recorded pause control. The command proof was
rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline host_resolve_phase_applies_ita_lifecycle_pause_control -- --nocapture`,
which passed one filtered pipeline test and proved a paused session emits lifecycle/announcement
events, rejects a submitted ITA shot, surfaces trace rows, audits resolution envelopes, and
rebuilds projections. The minimizer proof was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline phase5_ita_lifecycle_fixture_replays_semantic_expectations_through_minimizer -- --nocapture`,
which passed one filtered pipeline test for the lifecycle semantic fixture. The sheriff fixture
proof was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline phase5_sheriff_badge_fixtures_replay_semantic_expectations_through_minimizer -- --nocapture`,
which passed one filtered pipeline test across all three sheriff fixtures. Dedicated Phase 5
announcement/prompt fixtures now also prove that minimization preserves Mafia Universe prior-night
`DayAnnouncement` template/audience/role payload metadata, lynch `LastWordsRecorded`
template/audience/window metadata, trailing `PhaseAnnouncement`, and Mafiascum NoMajority revote
`HostPromptIssued` plus prompt trace decisions. The direct Mafia Universe command proof now covers
two prior-night deaths in source order with revealed role payloads, thread projection, replay audit,
and projection rebuild; pure golden `day_notes_hidden_role_multiple_deaths` covers the hidden-role
payload path. `minimize_night_fixture` prompt
fixtures now carry the command-native `HostPromptDecision` shape and can assert stream-level prompt
resolution effects; the Mafiascum NoMajority fixture now acknowledges the prompt and checks
`HostPromptResolved` plus prompt-driven `PhaseAdvanced { phase_id: "D01R1", reason: "revote" }`,
and the Beloved Princess fixture now acknowledges the skip-next-day prompt and checks
`HostPromptResolved` plus prompt-driven `PhaseAdvanced { phase_id: "N02", skipped_phase_id: "D02",
reason: "skip_next_day" }`; the Virgin night-death alias now has the same minimized
prompt-resolution proof for `N01:skip_next_day:slot_2`; the dynamic vote-weight prompt fixture
now uses a legal N01 `VoteWeight` grant setup phase and proves the folded grant drives a D02
NoMajority revote prompt plus `HostPromptResolved` / `PhaseAdvanced { phase_id: "D02R1",
reason: "revote" }`; the dynamic vote-weight PK fixture now uses the same legal N01
`VoteWeight` grant setup phase and proves the folded grant drives a D02 `HostDecides` tie,
`HostPromptIssued { kind: "pk" }`, `HostPromptResolved`, and host-selected
`PlayerKilled { cause: "host_prompt:pk" }` through three audited resolution envelopes and three
validated traces. `pack_declared_pk_prompt_policies_have_semantic_minimizer_coverage` now scans
every pack-declared PK `day_vote_prompt_policies`/`host_prompt_resolution_effects` pair and
requires matching golden plus semantic minimizer coverage for the Epicmafia and dynamic
vote-weight PK policies.
This was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline phase5_day_note_and_revote_prompt_fixtures_replay_semantic_expectations_through_minimizer -- --nocapture`,
which passed one filtered pipeline test across the command-resolved setup-plus-day announcement
fixture, no-majority revote prompt-resolution fixture, Beloved Princess skip-next-day
prompt-resolution fixture, Virgin night-death skip-next-day fixture, and dynamic vote-weight
NoMajority revote fixture, and dynamic vote-weight PK prompt-resolution fixture, checking every
emitted semantic expectation through
`minimize_night_fixture`. An Epicmafia
generated lane now covers three fixed-seed D01 plurality ties that emit PK prompts and
host-selected kills, plus three fixed-seed N01 Bomb/Cult graphs that
submit Bomb-triggering mafia kills and plain/loyal cult recruits through legal commands, again
requiring replay audit, trace inspection, and projection rebuild. This manifest-listed Epicmafia
lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_pk_bomb_cult_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`,
which passed one filtered pipeline test across its six fixed generated seeds. `default_open` is the
first copyright-free default candidate: a deliberately small Citizen/Guardian/Seer/Agent pack with a
guardian-save plus seer-check N01 golden, majority-elimination D01 golden, command/projection
verticals for both paths, parity-matrix rows for its actions and day-vote policy, and three-seed
N01/D01 generated replay lanes under the same audit trio. The manifest-listed `default_open` N01
lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_night_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`,
which passed one filtered pipeline test across its three fixed generated seeds.
The manifest-listed `default_open` D01 lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_day_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`,
which passed one filtered pipeline test across its three fixed generated seeds.
The manifest-listed fixture minimizer lane was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin minimize_night_fixture -- crates/commands/fixtures/night-passing.json`,
which replayed the checked-in passing fixture with one audited resolution, one trace, and clean
projection rebuild. The manifest-listed checked game-specific audit bundle was rerun locally with
`DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --output target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json crates/commands/fixtures/night-passing.json`,
which created game `08d8a45f-6c3b-4401-8e31-8d7637f36a82`, wrote
`target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json`, and executed the three
game-specific manifest templates against it with matching projection, replay, and trace reports. A
retention rerun compared that artifact with
`target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json` after normalizing expected
rerun drift fields and returned `normalized_match: true`. A
manifest audit found current local rerun evidence in both this engine note and the checklist for
every local-only proof row in `docs/ops/proof-runs.json`; the standalone game-specific rows remain
command templates that require a concrete game id. The proof-run page now reads those local JSON
artifacts only for display metadata: valid path/version-matching artifacts show `game_id`,
`manifest_version`, and `retention_comparison.normalized_match`, while missing, malformed,
path-mismatched, or version-mismatched artifacts keep the manifest path visible without parsed
metadata or server execution.
`audit_resolution` compares replayed resolution JSON semantically with a tiny numeric tolerance for
persisted `jsonb` floating-point rolls while keeping structure exact. Broader culture-pack
generation, true property-test shrinking, and production-grade benchmark coverage remain future
work.

Generated command-pipeline failures print a `minimize_night_fixture` JSON block directly. To replay
or reduce one locally:

```bash
DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch \
  cargo run -p commands --bin minimize_night_fixture -- crates/commands/fixtures/night-passing.json

DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch \
  cargo run -p commands --bin minimize_night_fixture -- --reduce /tmp/generated-night-failure.json
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

`validate_pack` now treats `phases` as strict pack data instead of an incidental action-window
dependency: cadence must be non-empty and deduplicated, `Twilight` cadence must agree with the
`twilight` flag, subsegment maps may only name declared phase kinds, present subsegment lists
must be non-empty, and subsegment ids are unique lowercase `snake_case` ASCII. Host-driven
`StartGame` and `PhaseAdvanced` commands now load the game pack before appending and reject phase
ids whose `PhaseKind` is absent from `phases.cadence` (including Twilight when the pack does not
declare it); rejected movement appends no event and leaves `phase_state` unchanged. Host-prompt
phase effects (`revote`, `skip_next_day`) are also pack-cadence gated before `HostPromptResolved`
is appended, so unsupported prompt transitions leave the prompt pending and preserve
`phase_state`. Engine submissions now treat a pending host prompt for the current phase as a
locked/prompt-waiting window: votes and action submissions reject until the host resolves the
prompt and opens a follow-up phase such as `D01R1` or `N02`. Prompt-free ordinary
`ResolvePhase` appends a provenance-bearing `ThreadLocked { reason: "phase_resolved" }`
after `ResolutionApplied` / `ResolutionTrace` in the same transaction, so the resolved phase
stays durably closed across projection rebuilds until host-controlled `AdvancePhase` derives the
next declared window from `phases.cadence` and appends
`PhaseAdvanced { reason: "resolved_phase", source_phase_id }`. `AdvancePhase` rejects unresolved
or prompt-waiting phases, so hammer/manual locks cannot masquerade as resolution completion.
Timer evidence uses the same cursor-moving seam rather than an alternate projection shortcut:
`PhaseDeadlineElapsed` is stored as inert scheduler evidence, while `AdvancePhaseByDeadline`
rejects unresolved phases, stale phase ids, and observations before the stored deadline, then
atomically appends `PhaseDeadlineElapsed` plus pack-derived
`PhaseAdvanced { reason: "deadline_elapsed", source_phase_id }`. The event actor is `System`;
the command remains host-gated until fmarch grows a first-class scheduler principal.

### Win policy (fmarch addition)

Win detection is a pack table over the **post-resolution state** — minimal but real:

```rust
struct WinPolicy { rules: Vec<WinRule> }            // empty => engine never declares a win
struct WinRule   { winner: AlignmentKey, when: WinCondition }

enum WinCondition {
    FactionEliminated(AlignmentKey),     // the named faction has 0 alive
    FactionReachesParity(AlignmentKey),  // the named faction's alive count >= all OTHER alive combined
}
```

Rules are evaluated **in order** on the state *after* the resolution's events are folded
forward (`apply_events`, below); the **first match wins**. `FactionEliminated(f)` fires when
`f` has zero alive slots. `FactionReachesParity(f)` fires when `f`'s alive count is `>=` the
combined alive count of every *other* faction (slots with no alignment count as "other"); for
robustness it requires `f` itself to have `>= 1` alive, so a wiped faction never "reaches
parity" with the empty set. With exactly two factions this is the usual mafia-parity check.
The mafiascum pack ships two rules: **town** wins on `FactionEliminated("mafia")`; **mafia**
wins on `FactionReachesParity("mafia")` (the elimination rule is listed first so an all-mafia-dead
state is a town win, not a degenerate parity).

> **Three+ factions (`AllOtherFactionsEliminated`).** The two-faction conditions above
> cannot express "the survivor faction is the *only* one left" once a third faction (e.g. a
> cult) exists: a town win then requires BOTH mafia AND cult wiped — a conjunction. v1 adds
> one minimal condition for this: `AllOtherFactionsEliminated(f)` fires when **every**
> alignment other than `f` (and every alignment-less slot) has 0 alive **and** `f` has `>= 1`
> alive. The **epicmafia** pack (town/mafia/cult) ships rules in order: *town* on
> `AllOtherFactionsEliminated("town")`, then *mafia* on `FactionReachesParity("mafia")`, then
> *cult* on `FactionReachesParity("cult")`. Two-faction packs are unaffected (they never use
> the new variant). This is the explicit 3-faction semantics; no case is left ambiguous.

> **Self-lynch independent wins (`self_lynch_win_policies`).** Some im-human win-trigger
> passives are not ordinary faction checks and do not require a prior target action. The
> mafiascum Jester is modeled as a pack row:
> `SelfLynchWinPolicy { id: "jester", eligible_roles: ["jester"], winner: "jester",
> source_event: "win.jester" }`. When an eligible role is lynched, the day resolver appends a
> final `WinReached` with that metadata after `PhaseAnnouncement` and suppresses the ordinary
> post-resolution `WinPolicy` fallback. This mirrors im-human's trigger-win precedence while
> keeping Rust's stored result contract canonical: dynamic `win.*` result strings map to the
> single typed `WinReached` event.

### `apply_events` — cross-phase state evolution

State carries forward between resolutions by a single pure fold:

```rust
fn apply_events(state: &StateSnapshot, events: &[InnerEvent]) -> StateSnapshot  // PURE
```

Deterministic (no clock/RNG); folds only the state-bearing inner events:
`PlayerKilled` → that slot's `status` becomes `"dead"` and its role/alignment reveal state
follows the event's pack-derived `death_reveal` mode; `EffectsMarked`/`EffectsCleared` →
add/remove the effect tag on the slot's `effects` index and upsert/remove the corresponding
source-aware `EffectRecord`; `PlayerConverted` → set the slot's `role_key` to the new role;
`ActionRecorded` → append one cross-phase action-history fact;
`ActionGranted` → append one generated capability/item fact; `ActionGrantConsumed` →
decrement the oldest matching generated grant; `ActionUseCounted` → upsert one typed limited-use
counter for x-shot/cooldown/shield/ITA-session/inventory accounting;
`InvestigationMemoryRecorded` → upsert one prior-result baseline keyed by investigator, target,
and mode; `PlayersLinked` → append one
cross-slot link fact; `RetaliationArmed` → upsert one death-triggered chosen retaliation;
`BackupTargeted` → upsert one targeted backup source choice
fact; `DelayedDeathQueued`/`DelayedDeathResolved` → add/remove one source-aware delayed death
queue; `WolfCarryQueued`/`WolfCarryUsed` → add/remove one pending White Wolf carry token;
`WolfBeautyMarked` → upsert the current Wolf Beauty owner-target charm; `WinReached` flips
role/alignment reveal state public. The first `PlayerConverted` for a target also appends a
`ConversionOriginRecord` so deprogramming can restore the original role/alignment without guessing
from the current role.
Every other inner event — `PlayerSaved`, `InvestigationResult`, `DayVoteOutcome`,
`DayAnnouncement`, `LastWordsRecorded`, `WolfSelfDestructed`, `WolfCarryUsed`,
`WolfBeautyDragged`, `EffectNotification`, `PhaseAnnouncement`, … — is otherwise a **no-op**
except for the explicit carry token consumption above. `EffectNotification` is
still folded by the platform projection layer into `player_notification`; it is not part of
`StateSnapshot` because future resolver decisions do not read private notices. `phase_kind` /
`phase_number` are carried through unchanged: advancing the phase cursor is the
engine/platform's job, not this fold's.

### Target-state effects

Some common mafiascum mechanics are target-state policy, not new IR primitives:

- `bulletproof` is a role/slot effect tag that absorbs an ordinary kill and emits
  `PlayerSaved { reasons: ["bulletproof"] }`.
- `bulletproof_vest` is a consumable slot effect tag that absorbs an ordinary kill, emits
  `PlayerSaved { reasons: ["bulletproof_vest"] }`, records
  `ActionUseCounted { counter_id: "shield:bulletproof_vest", cadence_policy: "shield",
  phase_scope: "effect" }` into `StateSnapshot.use_counters` / `action_counter`, then emits
  `EffectsCleared` so the fold consumes the vest.
- `commuted` is a resolution-scoped `Mark` effect declared in `Pack.effects` with
  `duration: Resolution`; it is visible to later Kill/Investigate stages but does not persist.
- `untargetable` is a role/slot effect tag. Kills aimed at `untargetable`/`commuted` targets
  do not land; investigations emit `ActionInterfered { reason: "untargetable" }`. In
  standard-NAR packs, `standard_nar.target_state_gate_policy` declares which target-state tags
  block `Kill`, `Investigate`, or both.
- `poisoned` is a persistent `Mark` effect plus a `DelayedDeathQueued` record. Pending poison
  death reads only queued deaths carried into the resolution; `Clear("poisoned")` emits
  `DelayedDeathResolved { outcome: "preempted_by_clear" }`, while an unapplied queue emits
  `DelayedDeathResolved { outcome: "applied" }` plus `PlayerKilled`. Fresh same-night poison is
  only carried forward. `Clear("doused")` similarly preempts a later same-resolution `ignite`.

In the shipped mafiascum pack, Strongman bypasses `Protect`, `bulletproof`, and
`bulletproof_vest`, but not `untargetable`/`commuted` target-state gates. The
`standard_nar.target_state_save_tags` catalog plus `standard_nar.target_state_save_policy` table
own the bulletproof/vest split: each save tag is first declared in the catalog, then classifies
every standard-NAR kill-like cause as blocked or bypassed, and validation rejects missing,
unknown, duplicate, or empty catalog tags, missing policy tags, unknown causes, ordinary kills in
`bypasses`, or Strongman-style causes in
`blocks`. The night resolver also rejects a standard-NAR pack that reaches resolution with a
missing save catalog or table, so a mutated or unvalidated pack cannot silently fall back to implicit
Strongman/unstoppable save behavior. The `standard_nar.target_state_gate_tags` catalog plus
`standard_nar.target_state_gate_policy` table owns the earlier commuted/untargetable gate: each
gate tag is first declared in the catalog, then declares the blocked abilities, and validation
rejects missing, unknown, duplicate, or empty catalog tags, missing policy tags, unknown policy
tags, duplicate blocked abilities, empty policies, and abilities outside the currently
implemented `Kill`/`Investigate` gate. The night resolver also rejects a standard-NAR pack that
reaches resolution with a missing gate catalog or table, so a mutated or unvalidated
pack cannot silently fall back to hardcoded commute/untargetable behavior.

> **Day lynch emits a `PlayerKilled` (R1).** A day lynch is carried structurally by
> `DayVoteOutcome.winner` **and** additionally emits a `PlayerKilled { slot_id, cause:
> "day_vote", attackers: [], unstoppable: true }`, so the lynch death folds **uniformly**
> through `apply_events`/`slot_state` exactly like a night kill — no special "apply the lynch
> locally just for the win-check" path. (The trailing `PhaseAnnouncement` still carries the
> semantic `Death { cause: "lynch" }`.) The post-resolution state the engine runs `check_win`
> against is therefore a single, plain `apply_events` fold.
>
> **R4 — next `StateSnapshot` & the phase cursor.** The state the *next* resolution reads is
> built from the `slot_state`/effects projection (the fold of `PlayerKilled/Saved/Converted` +
> `EffectsMarked/Cleared`), not handed back by `resolve`. **Advancing the phase cursor**
> (`phase_kind`/`phase_number` → the next window) is a **lifecycle command**, not the engine's
> job: `apply_events` carries the cursor through unchanged, and the platform sets the next
> window before invoking `resolve` again.

### Win-check in the resolver

After a resolution produces its inner events, the resolver computes the post-resolution state
(via `apply_events`, plus the local lynch application above), evaluates `WinPolicy`, and — iff
a rule fires — appends a `WinReached { winner, reason }` as the **FINAL** inner event, after
the trailing `PhaseAnnouncement`. Day-note events such as `DayAnnouncement` and
`LastWordsRecorded` are phase results and therefore appear before the trailing announcement.
If a pack declares non-kill `Win` triggers, the tentative ordinary win is observed before finality:
the resolver runs those triggers before the trailer, rebuilds the `PhaseAnnouncement`, recomputes
the post-trigger win state, and then appends the final `WinReached`.
Canonical inner-event order is therefore: *phase results → the one trailing
`PhaseAnnouncement` → optional `WinReached`*. If a pack-specific independent-win policy such as
`target_lynch_win_policies` or `self_lynch_win_policies` already appended that final
`WinReached`, ordinary faction `WinPolicy` evaluation is skipped for the same resolution. Otherwise
win-check runs **once, at phase end**, never mid-resolution. `validate_resolution_applied`
enforces exactly one trailer announcement, matching the envelope `phase_id`, followed only by an
optional final `WinReached`; malformed stored envelopes fail before projection folding. A standalone
`check_win(state, pack) -> Option<WinReached>` is also exposed for callers that want to test a
state directly.

Public announcement publication is a derived projection, not a cursor-moving event path. When a
stored `ResolutionApplied` contains public `DayAnnouncement`, `LastWordsRecorded`, or trailing
`PhaseAnnouncement` inner events, `thread_view` derives one deterministic system-authored main
thread row from the envelope. v66 day-death `PhaseAnnouncement` template/audience metadata and v67
per-death cause template/audience metadata are published in that row when present. Projection
rebuilds reproduce that row from the log, and the phase cursor remains owned only by `GameStarted`
/ `PhaseAdvanced`.

## Submissions: the platform → engine seam

The platform parses human activity (vote posts, night-action forms) into **submissions**.
The engine consumes a window's submissions and resolves them. Submissions are the only
player/action input crossing into the engine; host/culture phase inputs such as pending
day announcements are carried separately in `ResolutionInput.day_phase_inputs`.

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

Packs may also declare faction action coordination. A coordinated faction action lets multiple
same-alignment actors submit the same template as votes for one shared action. The v35 policy
supports a single resolved submission per action/alignment and explicit split-vote behavior; Chinese
structured blocks all tied wolf-kill votes with `target_tie: BlockAll`. Broader multi-kill faction
quotas remain future additive IR.

## The resolver contract

```rust
fn resolve(input: ResolutionInput) -> ResolutionOutput

struct ResolutionInput {
    game_id: GameId,
    phase_id: PhaseId,
    run_id: String,
    state: StateSnapshot,           // slots, roles, persistent effects, action history, alive/dead
    submissions: Vec<Submission>,
    day_phase_inputs: DayPhaseInputs,
    pack: Pack,
    seed: Seed,                     // resolver RNG seed; part of the inputs
    logical_time: LogicalTime,
}

struct ResolutionOutput {
    applied: ResolutionApplied,     // deterministic, indexed event envelope (see 10)
    trace: ResolutionTrace,         // which table/rule drove each decision
    post_state: StateSnapshot,      // state after folding applied.events
}
```

The `StateSnapshot` the resolver reads (and that the goldens encode) is canonically:

```rust
struct StateSnapshot {
    phase_kind: PhaseKind,          // Day | Night | Twilight
    phase_number: u32,
    slots: Vec<SlotState>,
    effect_records: Vec<EffectRecord>,
    action_history: Vec<ActionUseRecord>,
    use_counters: Vec<ActionCounterRecord>,
    investigation_memory: Vec<InvestigationMemoryRecord>,
    delayed_deaths: Vec<DelayedDeathRecord>,
    visit_history: Vec<VisitRecord>,
    action_grants: Vec<ActionGrantRecord>,
    conversion_origins: Vec<ConversionOriginRecord>,
    linked_slots: Vec<LinkRecord>,
    retaliations: Vec<RetaliationRecord>,
    badges: Vec<BadgeRecord>,
}

struct ActionUseRecord {
    actor: SlotId,
    template_id: String,
    targets: Vec<SlotId>,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
    status: String,                 // "resolved" | "suppressed" | "missing"
}

struct ActionCounterRecord {
    counter_id: Tag,
    actor: SlotId,
    template_id: String,
    consumed_action: String,
    cadence_policy: String,         // e.g. "x_shot"
    phase_scope: String,            // e.g. "game"
    limit: u16,
    used: u16,
    remaining: u16,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}

struct ActionGrantRecord {
    grant_id: Tag,
    grant_option: Option<Tag>,
    kind: GrantKind,                // ExtraAction | Item
    actor: SlotId,                  // source slot that created the grant
    target: SlotId,                 // slot receiving the generated capability/item
    source_action: ActionId,
    uses: u16,
    phase_id: PhaseId,
    phase_kind: PhaseKind,
    phase_number: u32,
}

struct LinkRecord {
    link_id: String,
    slots: Vec<SlotId>,
    source: SlotId,
}

struct RetaliationRecord {
    retaliation_id: String,
    actor: SlotId,
    target: SlotId,
    source_action: String,
}

struct ConversionOriginRecord {
    target: SlotId,
    original_role: RoleKey,
    original_alignment: Option<AlignmentKey>,
    source: SlotId,
}

struct EffectRecord {
    effect: Tag,
    target: SlotId,
    source: SlotId,
    source_action: Option<String>,
    phase_id: Option<PhaseId>,
    phase_kind: Option<PhaseKind>,
    phase_number: Option<u32>,
    duration: EffectDuration,       // Persistent | Resolution
    visibility: EffectVisibility,   // Hidden | Public | Actor | Target | ActorAndTarget
}

struct SlotState {
    slot_id: SlotId,
    role_key: RoleKey,
    alignment: Option<AlignmentKey>,
    role_reveal: RevealState,       // private | public
    alignment_reveal: RevealState,  // private | public
    status: SlotLifecycle,          // alive | dead | modkilled
    status_tags: Vec<Tag>,          // pack-visible tags: treestump, limited_vote:*, etc.
    effects: Vec<Tag>,              // role-level and persistent effect tags on the slot
}
```

`StateSnapshot.effect_records` is the canonical source-aware active effect state. `SlotState.effects`
is the derived fast tag index where role-level `Role.effects` (and any active `Mark`-applied tags)
surface to resolver predicates — e.g. the `godfather` tag that drives `investigation_overrides`.

### Scalar conventions

Two resolver-input scalars are pinned so JSON authors and goldens don't drift:

```rust
type Seed        = u64;  // resolver RNG seed; a bare integer in JSON
type LogicalTime = u64;  // monotonic logical time (submitted_at, engine timestamps); a bare integer
```

`TargetSpec` carries **no embedded count**: it is `None | One | Many | Group`. Cardinality is
the **single responsibility of `Constraints.max_targets`** (e.g. the bus driver is
`targets: Many` + `max_targets: 2`).

`resolve` is **pure**: same inputs ⇒ same outputs, always. Its output is persisted as a
`resolution.applied` envelope plus a `resolution.trace` event
([10-event-schema](10-event-schema.md)).

> **v1 golden coverage.** Stacked kills, multiple protectors on one slot, and stacked blocks
> all **compose** in the engine, but are **not yet golden-covered** (deferred). The v1 goldens
> exercise the single-actor cases of each interaction.

## Determinism rules (non-negotiable — inherited from im-human)

These are load-bearing for replay ([02-event-sourcing](02-event-sourcing.md)) and for
dispute resolution:

1. **Seeded RNG only.** The engine never calls system randomness; all randomness comes from
   the `seed` in `ResolutionInput`. The seed is recorded as event data.
   The current seeded RNG consumer is `DetRng`: ITA shots derive their stream from
   `seed ^ 0x4954_415f_5348_4f54`, and random day-vote tie breaks derive theirs from
   `seed ^ 0x4441_595f_564f_5445`. A pack-declared random plurality tie therefore resolves
   to the same winner on replay and may resolve to a different winner only when the stored
   seed changes.
2. **Logical time only.** No wall-clock inside resolution. `submitted_at` and engine
   timestamps are monotonic logical time, captured as data at write time. `ResolutionApplied`
   `started_at` / `finished_at` are copied from `ResolutionInput.logical_time`.
3. **Stable ordering.** Equal-time events are ordered by stable id. Resolution order is
   explicit (pack-derived ability order, then priority, then stable id), never hash-map
   iteration order.
4. **Bounded fixpoints.** Redirect and trigger chains have explicit `loop_cap`; on reaching
   it the engine emits a diagnostic note and terminates deterministically. Standard-NAR packs
   declare trigger loop participation and trace expectations through
   `standard_nar.trigger_fixpoint_policy`.
5. **No hidden global state.** All transient resolution state (target maps, graph,
   effect pool, audits) lives in the resolution context and is reflected in the trace.
6. **Explicit precedence evaluation order.** Night ability order is derived from pack
   `PrecedenceRule` edges plus each ability's maximum declared `Constraints.priority`; equal
   priorities without a precedence relation are invalid, and the resolver no longer falls back to
   a legacy hardcoded order when pack-derived ordering fails. The canonical mafiascum pack order is
   **Block → Redirect → Protect → Mark → Clear → Link → Grant → Retaliate → Kill → Convert
   → Investigate → Visit** for the currently shipped action set. Pack-validation test
   `night_order_reacts_to_pack_priorities_and_precedence_edges` mutates a small pack to prove both
   priority changes and precedence edges alter that derived order. Command test
   `resolve_phase_uses_pack_derived_non_legacy_precedence_order` proves a valid Kill-before-Protect
   pack persists `["Kill", "Protect"]` and kills a self-protecting target through projections.
   A rule's `unless_modifiers` inspects
   the modifiers of the **BEATEN** action (the one named in `beats`), never the beating action
   or the target — e.g. `protect_beats_kill` with `unless_modifiers: [Strongman]` inspects the
   **Kill**'s modifiers. Track/Watch/Motion results are **graph-derived** from resolved
   post-redirect, non-blocked, non-hidden visits and are NOT configurable via `VisibilityRule`
   beyond hide/show; Ninja hide/show is backed by `visibility.Investigate.unless_modifiers`
   and fails closed if a Ninja pack omits that policy. Triggered visit observations use the same `Visit` discriminant the pack
   trigger table deserializes, so PGO-style visit triggers run through the normal generated-kill
   fixpoint and protection/bodyguard precedence path; the pack linter now requires that shape for
   any role-carried `pgo` effect and any role-carried `visitor_kill` effect without the
   target-filtered Visit trigger shape. The mafiascum pack also declares
   `standard_nar`, a concrete action-id catalog for Block, Protect, ordinary Kill, Bodyguard, Martyr, CPR, Jailkeeper, and
   Strongman, a concrete kill-cause catalog for submitted/chosen/generated standard-NAR kills, plus `kill_stacking: AggregateAttackers`. The validator rejects malformed
   standard-NAR action shapes, missing supporting precedence edges, or missing kill-stacking
   policy, and enabled packs classify submitted ordinary Kill/Bodyguard/Martyr/CPR/Strongman actions from that table
   rather than from resolver-local role branches. It also rejects enabled standard-NAR packs whose
   suppression policy can stop a night action unless Block has a precedence path before that
   action's ability; `resolve_phase_rejects_invalid_pack_precedence_before_append` proves the command
   path surfaces that pack validation failure before appending `ResolutionApplied`,
   `ResolutionTrace`, or `ThreadLocked`. Folded chosen-retaliation Kill causes are
   classified through `standard_nar.chosen_retaliation_cause_policy` before the resolver consumes
   `RetaliationArmed` state. Trigger-produced Kill causes are classified
   through `standard_nar.generated_kill_cause_policy`, which validates trigger shape and drives
   ordinary-vs-Strongman protection behavior for generated kills before the trigger fixpoint runs.
   A stacked landed kill merges attribution into
   the first `PlayerKilled` and emits a `kill_stacked_on_existing_death` trace decision; night
   `PhaseAnnouncement.deaths` mirrors emitted `PlayerKilled` causes instead of using a generic
   `night_kill` trailer cause. Bodyguard/Martyr intercept deaths that race an existing direct
   death for the protector use the same merge path, preserving one durable death with both attackers.
7. **Protection source policy.** `Protect` records explicit protectors. A normal protect emits
   `PlayerSaved` when it stops a kill; multiple blocked attacks on the same protected target
   each emit their own `PlayerSaved` and `kill_prevented_by_protection` trace attribution, but
   never synthesize a `PlayerKilled` or death announcement. A protect carrying
   `Modifier::Bodyguard` or `Modifier::Martyr` emits the intercept death cause declared in
   `standard_nar.intercept_cause_policy` for enabled standard-NAR packs, with the legacy
   modifier-derived `bodyguard_intercept`/`martyr_intercept` fallback only for packs that do not
   enable standard NAR. A Strongman kill bypasses the protect and therefore does not trigger the
   save/intercept path. A protect carrying
   `Modifier::Cpr` records whether it actually saved a target; if no blockable attack is saved and
   the target is otherwise alive, the post-protection pass emits `PlayerKilled` with the
   pack-declared `standard_nar.cpr_harm_cause_policy` cause and the CPR actor as attacker. CPR's
   Kill ability is intentionally ignored for ordinary night-stage ordering so deferred CPR harm
   cannot move generic Kill before Clear/read-effect preemption. A protect
   carrying `Modifier::Babysitter` also records a guard dependency: if the protector dies in the
   same resolution, the ward receives a generated, unstoppable `PlayerKilled` with the
   pack-declared `standard_nar.guard_dependency_cause_policy` cause. Packs with
   `guard_policy.enabled` may reserve specific kill causes for declared Guard actions; the
   shipped Chinese pack declares `protect_before_guard_blockable_kills` (`Protect` beats `Kill`)
   so `night_guard` blocks `poison_potion`, while Witch `heal_potion` alone does not. Enabled
   guard policies without that precedence edge fail pack validation.
8. **Target-state gates.** Kill/Investigate stages consult role effects, slot effects, and
   same-resolution transient marks. `untargetable`/`commuted` gates run before kill saves;
   bulletproof/vest saves run after ordinary Protect and before death. In standard-NAR packs,
  `untargetable`/`commuted` gate behavior is read from
   `standard_nar.target_state_gate_tags` plus `standard_nar.target_state_gate_policy`, and bulletproof/vest save-vs-bypass behavior is read from
   `standard_nar.target_state_save_tags` plus `standard_nar.target_state_save_policy`; standard-NAR resolution fails closed if either
   target-state catalog or table is missing. Non-standard packs keep the legacy hardcoded
   `commuted`/`untargetable` gate tags and Strongman `unstoppable` save fallback until they opt
   into explicit tables. Vest consumption is expressed as `EffectsCleared`, so projection
   rebuilds consume it through the same fold as any other cleared effect. A `Modifier::Hider` mark
   grants transient `untargetable` to the acting hider only when the chosen host is known
   non-mafia; the host itself is not made untargetable by the hide action. If the host dies while
   the hider is already dead from a
   direct same-resolution kill, the hide dependency merges into the hider's existing death and
   preserves the dependency in trace using the pack-declared
   `standard_nar.hide_dependency_cause_policy` cause.

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
