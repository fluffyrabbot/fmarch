# 11 - Day/night engine port checklist

This is the source-derived checklist for eventually porting the full day and night
action-resolution engine from `apps/im-human` into fmarch.

The goal is behavioral parity with im-human's Engine V4 result surface, not a literal
module-by-module Rust translation. fmarch keeps its better greenfield shape:

- platform layer: users, slots, replacements, channels, posts, capabilities, event store,
  wire, and projections;
- engine layer: slots only, pure state snapshots, submissions, packs, resolver, result
  envelope, trace, and fold.

Anything im-human carried for AI players, reinforcement-learning datasets, simulation
harnesses, or non-forum moderation is out of scope unless it directly affects human game
resolution.

## Source anchors

Use these im-human surfaces as the parity baseline:

- Pipeline: `imhuman_umbrella/apps/engine/docs/V4_RESOLUTION_PIPELINE.md`
- Result contract: `imhuman_umbrella/apps/engine/docs/V4_RESULT_CONTRACT.md`
- Pipeline entry: `imhuman_umbrella/apps/engine/lib/engine_v4/resolve/pipeline.ex`
- Result emission/validation: `imhuman_umbrella/apps/engine/lib/engine_v4/result_emitter.ex`,
  `result_validator.ex`, and `schemas/json/engine_v4/engine_v4_result.schema.json`
- Role spec primitive map: `imhuman_umbrella/apps/engine/lib/engine_v4/role_spec.ex`
- Draft role catalogs: `imhuman_umbrella/catalog/v4/drafts/**/*.json` and
  `imhuman_umbrella/apps/engine/lib/engine_v4/factory/catalogs/**/*.yaml`
- Day steps: `imhuman_umbrella/apps/engine/lib/engine_v4/resolve/day_steps/*.ex`
- Night effects: `imhuman_umbrella/apps/engine/lib/engine_v4/effects/*.ex` and
  `imhuman_umbrella/apps/engine/lib/engine_v4/resolve/effects/*.ex`
- Modifiers: `imhuman_umbrella/apps/engine/lib/engine_v4/modifiers/**/*.ex`
- Policies: `imhuman_umbrella/apps/engine/lib/engine_v4/policy/**/*.ex`
- Regression tests: `imhuman_umbrella/apps/engine/test/engine_v4/**`

Use these fmarch surfaces as the target shape:

- IR/pack schema: `crates/domain/src/ir.rs`, `crates/domain/src/pack.rs`
- Resolver/fold/events: `crates/domain/src/resolver.rs`, `state.rs`, `events.rs`
- Goldens: `packs/*/golden/*.json`, `crates/domain/tests/golden.rs`
- Command/projection seam: `crates/commands/src/lib.rs`, `crates/projections/src/lib.rs`
- Event schema intent: `docs/arch/09-engine-and-packs.md`, `docs/arch/10-event-schema.md`

## Current fmarch state

Already present:

- Closed v1 IR: Kill, Protect, Block, Redirect, Investigate, Convert, Mark, Clear.
- Pack tables for roles, precedence, visibility, redirects, triggers, vote, phases,
  investigation overrides, and win policy.
- Pure slot-only resolver with day vote outcome, basic night action ordering, roleblock,
  two-target bus-driver redirect, protect/strongman kill, parity and track investigations,
  mark/clear, convert, bomb-style kill trigger, phase announcement, win check, and pure
  state fold.
- Golden harness for `mafiascum` and `epicmafia` packs.
- Event-store/projection spine for platform events, running votecount, slot state, slot
  occupancy, phase state, thread view, replacement authority transfer, and unwrapping
  `ResolutionApplied`.
- `Command::ResolvePhase` loads the declared pack, builds a slot-only snapshot, converts
  vote/action events into submissions, runs `resolve`, validates `ResolutionApplied` and
  `ResolutionTrace`, and appends both envelopes plus the post-resolution `ThreadLocked`
  close-state atomically.
- Result and trace validators reject unknown or malformed payloads at the domain and
  projection/command boundaries.
- The v1 pack linter enforces pack/IR version compatibility, including a derived additive
  `ir_version` floor for declared action/policy features, role/alignment/effect references,
  action-local template ids, `mode`/`effect`/`reads_effect` legality, target cardinality,
  window/cadence compatibility, vote weight references, and win-condition references.

Known gaps:

- Golden fixture regeneration tooling exists for the current fixture shape, but a broader
  authoring/regeneration workflow for future pack migrations is still pending.
- The source-derived im-human parity matrix now has no unsupported primitive, modifier,
  result-event, action-id, role-id, or culture-note rows; the only unsupported rows are the
  explicit out-of-scope Engine V4 test families `feature_flags_test` and `init`.
- Later build-order phases remain partial even though the extracted inventory rows are covered:
  release-time ITA replay/refund breadth, richer persistent-effect/source/expiry state, richer
  item UX, and operational UI/tooling hardening are still tracked below.
- Persistent effects now have a rebuildable `slot_effect` projection, and explicit-audience
  notices have a rebuildable `player_notification` projection, but the effect projection stores
  only the v1 effect tag. Source, expiry, visibility, counters, inventories, and other richer
  cross-phase facts are still pending.

## Correct architectural shape

### 1. Packs are the product surface

Roles must be data. A role pack should declare the roles, alignments, actions,
constraints, passives, modifiers, vote rules, phase rules, conflict rules, visibility
rules, triggers, win rules, and result-tampering rules.

The engine should not grow one Rust module per role. It should grow:

- a closed, versioned primitive vocabulary;
- a closed, versioned modifier vocabulary;
- pack validators and migrations;
- deterministic interpretation of the pack tables.

The right way to "port a role" is to add or validate pack data plus the minimal IR behavior
needed by that data. If adding a role requires bespoke resolver code, the missing concept
probably belongs in the IR, trigger table, modifier table, or policy table.

### 2. Resolver stages are design boundaries, not crates

The im-human pipeline has useful stages:

1. ingest and normalize submissions;
2. day orchestration;
3. targeting and redirect graph;
4. pre-effect modifiers;
5. ordering / graph build / graph execute;
6. effect materialization;
7. post-effect modifiers;
8. conflict resolution;
9. execution;
10. triggers;
11. visibility;
12. win check;
13. result and trace emission.

In fmarch these should stay as pure modules/functions inside `domain`, not as IO-aware
services. The boundary is:

```text
ResolutionInput { state, submissions, pack, seed }
  -> ResolutionOutput { applied, trace, post_state }
```

Only the command layer should know how to load events, build snapshots, append envelopes,
advance phases, update projections, or fan out deltas.

### 3. Result contracts gate persistence

The engine output must be a closed event contract:

- unknown inner event kind: reject;
- missing required payload fields: reject;
- event order violations: reject;
- non-canonical fields ignored by golden comparison only when explicitly listed;
- result version bumped for breaking changes;
- trace schema versioned separately once consumers depend on it.

This should happen before `ResolutionApplied` is appended. Bad resolver output must never
enter the event log.

### 4. State folds carry all cross-phase facts

Any fact that can affect a later resolution must fold into `StateSnapshot` or a canonical
engine projection:

- alive/dead status;
- role key and alignment;
- persistent effects;
- limited-use counters;
- cooldowns and cycle history;
- folded vote-weight grants;
- inventories/items;
- lover/linked-player state;
- backup inheritance;
- phase skips and delayed deaths;
- parity baselines and prior investigation baselines where the pack requires them.

If a later resolver run needs to inspect it, it cannot live only in a UI projection or trace.

### 5. Platform remains outside the engine

The engine never sees `UserId`, accounts, sessions, channels, post bodies, replacements,
capabilities, or private-room membership. Platform code parses posts into submissions,
resolves authority, and loads only slot-facing inputs.

The only identity that crosses into the engine is `SlotId`.

## Exhaustive functionality checklist

### A. Engine input and snapshot construction

- [x] Load a game stream into a deterministic engine snapshot. [`load_engine_snapshot` is the
  command-layer audit seam over the stored event stream; Postgres test
  `stored_game_stream_loads_deterministic_slot_only_engine_snapshot` proves repeated loads from
  the same stream produce identical `StateSnapshot` JSON]
- [x] Preserve `UserId != SlotId`; snapshot contains slots only. [`audit_engine_snapshot_identity_boundary`
  scans host/cohost/occupant/replacement user identities from the stored event stream and Postgres
  test `engine_snapshot_identity_audit_keeps_users_out_of_state_snapshot` proves none appear in
  the derived `StateSnapshot`, while stable `SlotId`s remain present]
- [x] Include current phase kind, phase number, phase id, deadline metadata where relevant,
  and pack phase policy. [`StateSnapshot` now carries `phase_id`, `phase_kind`, `phase_number`,
  `phase_deadline`, and `phase_policy`; `current_snapshot` derives them from the stored stream and
  declared pack, while Postgres test
  `stored_game_stream_loads_phase_metadata_deadline_and_pack_policy` proves deadline and mafiascum
  phase policy reach the resolver-facing snapshot]
- [x] Include slot status: alive, dead, modkilled, treestump/limited-vote, and any
  pack-visible status tags. [`SlotState.status` is now typed as `SlotLifecycle`
  (`alive`/`dead`/`modkilled`) with separate `status_tags`; `current_snapshot` folds
  `PlayerKilled`, host status events, explicit status tags, and pack vote-policy tags such as
  `limited_vote:voteless`, while Postgres test
  `stored_game_stream_loads_slot_lifecycle_and_pack_visible_status_tags` proves lynch death,
  modkill, treestump, limited-vote snapshot state, and projection rebuild surfaces]
- [x] Include role key, alignment, public/private reveal state, and role-level effects.
  [`RoleAssigned` is now self-describing with `role_key`, pack-derived `alignment`, and
  `role_effects`; `StateSnapshot` carries resolver-private role/alignment facts plus explicit
  `role_reveal` and `alignment_reveal` visibility states; `current_snapshot` folds role effects and
  reveal transitions from stored events; `CompleteGame` and inner `WinReached` reveal final roles;
  Postgres test `stored_game_stream_loads_role_alignment_reveal_state_and_role_effects` proves the
  event payload, private pre-completion snapshot, projected alignment/effects, public completion
  reveal, and projection rebuild contract]
- [x] Include persistent effects with source, target, phase, expiry, and visibility metadata
  when those fields matter. [`EffectsMarked` now carries `source_action`, phase id/kind/number,
  `duration`, and `visibility`; `StateSnapshot.effect_records` preserves the active structured
  state while `SlotState.effects` remains the tag index used by resolver predicates; `slot_effect`
  projection rows now store source slot/action, phase, duration, and visibility; domain test
  `apply_effects_mark_then_clear`, projection test `slot_effect_projection_round_trips`, command
  test `host_resolve_phase_projects_conversion_and_persistent_effects`, and refreshed goldens prove
  fold, rebuild, stored-stream snapshot, and result-contract coverage]
- [x] Include uses/counters: x-shot, cycle cooldowns, non-consecutive usage, novice/activated,
  limited day actions, inventories, shields, and grants. [command-side
  submission rejects exhausted x-shot counters through typed `ActionUseCounted` /
  `StateSnapshot.use_counters` / `action_counter` projection state after rebuild; odd/even
  mismatch and non-consecutive repeat targets still read folded action history, and grants/items
  still read folded action-grant rows; bulletproof vest shield consumption now records
  `shield:bulletproof_vest` in the same counter projection and survives rebuild; cycle cooldowns
  now use `constraints.cooldown_cycles` with `cooldown:<template_id>` counters and command
  rejection after rebuild; novice/activated gates now use `constraints.active_from` thresholds with
  command pre-append rejection and resolver suppression; ITA `shot_limit` now records
  `day_session:<session_id>:<template_id>` counters with resolver suppression, command rejection,
  golden coverage, and rebuild proof; generated item inventories now record
  `inventory:<grant_id>` counters, command validation rejects exhausted inventory after rebuild, and
  a negative golden proves resolver suppression from folded exhausted inventory state; role-owned
  selectable item grants now use pack-declared `grant_options` and require explicit
  `SubmitAction.grant_id` selection before append]
- [x] Include prior-result memory: parity baselines, visit history when needed, delayed
  poison/death queues, and backup/deprogramming originals. [proven:
  `ActionTemplate.result_memory` now gates prior-result investigation baselines; the resolver
  reads `StateSnapshot.investigation_memory`, emits state-bearing
  `InvestigationMemoryRecorded`, projects it into rebuildable `investigation_memory`, and
  Postgres test `host_resolve_phase_preserves_prior_investigation_memory` proves a framed later
  comparison survives projection rebuild;
  poison now emits source-aware `DelayedDeathQueued`/`DelayedDeathResolved`, folds through
  `StateSnapshot.delayed_deaths`, projects active rows in `delayed_death_queue`, and Postgres test
  `host_resolve_phase_carries_poison_cure_and_delayed_death` proves queued poison survives rebuild
  before cure/death and is consumed after preemption/application;
  `IrAbility::Visit`/`InvestigateMode::PriorMotion` now model source-aware visit-history memory,
  `VisitRecorded` folds into `StateSnapshot.visit_history`, projects into rebuildable
  `visit_history`, golden `prior_motion_reads_visit_history` proves a later resolver decision reads
  folded prior visit state, and Postgres test
  `host_resolve_phase_records_visit_history_for_prior_motion` proves the same read after projection
  rebuild;
  `StateSnapshot.conversion_origins` folds original role/alignment for deprogramming, and
  Postgres test `host_resolve_phase_deprograms_from_conversion_origin` now rebuilds after
  conversion, asserts the N02 engine snapshot carries the folded origin, and then proves
  restore-original deprogramming plus trace/projection rebuild stability;
  `StateSnapshot.linked_slots` folds lover links for later suicide deaths, and
  `StateSnapshot.retaliations` folds Hunter-style chosen death retaliation]
- [x] Load non-withdrawn submissions plus audit history for day votes. [`load_engine_phase_input`
  now exposes the typed command-to-resolver reducer output, including ordered `Submission` history;
  Postgres test
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` proves
  command-produced `ActionSubmitted`/`ActionWithdrawn` history is loaded with withdrawn actions
  marked inactive, `VoteSubmitted`/`VoteWithdrawn` history remains auditable for day
  last-write-wins, the `votecount` projection preserves only current ballots across rebuild, and
  `ResolvePhase` excludes withdrawn day voters plus a deliberately stale projection-only ballot
  from the official `DayVoteOutcome`, excludes the withdrawn ballot from persisted
  `ResolutionTrace`, rebuild-preserves both envelopes, and rebuild-restores the log-derived
  running tally; Postgres test
  `host_resolve_phase_loads_action_submissions_from_stream` now also proves a withdrawn night
  action stays out of `ResolutionApplied` and persisted `ResolutionTrace` while the later live
  action resolves and rebuilds identically]
- [x] Validate submitted template ids against the actor's current role. [`SubmitAction`
  front-door validation rejects role-mismatched templates before append, generated item templates
  remain legal only with a matching unspent item grant, and resolver replay now records
  helper-enforced `ResolutionTrace` decision `submission_template_rejected` for historical
  invalid template ids;
  Postgres test `action_submission_rejects_and_traces_invalid_template_ids` proves command
  rejection plus replay/audit behavior, while `action_submission_spends_inventor_item_grant`
  protects the generated-item allowance]
- [x] Validate target cardinality, uniqueness, self-targeting, allowed target state, window,
  and alive/dead/commuted/untargetable constraints. [`constraints.target_state` now models
  pack-owned alive/dead target policy with targeted actions defaulting to `Alive`; pack-linter test
  `action_field_combinations_are_strict` rejects invalid target-state/targetless combinations and
  accepts explicit dead-target actions; Postgres test
  `action_submission_rejects_invalid_target_shape_state_and_window` proves command validation
  rejects zero/overwide/duplicate/self-disallowed/unknown/dead targets and wrong-window actions
  before append while permitting self-allowed commute; Postgres test
  `host_resolve_phase_persists_target_state_trace_decisions` now submits through commands and
  proves commuted/untargetable resolution-time target-state suppressions persist in trace and
  survive projection rebuild]
- [x] Record ingest halts as contract events when an action is suppressed by policy.
  [`ActionIngestHalted` is now a schema-validated `ResolutionApplied` inner event mapped from
  im-human `ingest.halt`; `RESULT_VERSION` advanced to at least 15; result-contract test
  `action_ingest_halted_payload_passes_contract_validation` proves the payload shape; Postgres
  test `action_submission_rejects_and_traces_invalid_template_ids` proves front-door invalid
  templates still reject before `ActionSubmitted`, while a historical invalid submission emits
  durable `ActionIngestHalted` plus the helper-enforced `ResolutionTrace` decision
  `submission_template_rejected` with exact rejection detail]
- [x] Seed all randomness explicitly; never call ambient RNG or wall-clock time in domain.
  [`DetRng` is the only domain RNG; ITA shots and random day-vote ties derive deterministic
  streams from `ResolutionInput.seed`, `ResolutionApplied.started_at` / `finished_at` copy
  `ResolutionInput.logical_time`, domain test
  `random_day_vote_tiebreak_is_seeded_and_deterministic` proves seeded random vote ties replay
  exactly for the same seed and choose a different contender for a different seed, and
  `domain_source_rejects_ambient_rng_and_wall_clock` guards `crates/domain/src` plus the domain
  manifest against ambient RNG or wall-clock APIs]

### B. Pack schema and validators

- [x] Version `ir_version`, pack version, result version, and trace version independently.
  [`unsupported_version_fixture_is_rejected_by_pack_linter` proves unsupported pack/IR versions
  fail pack validation, and `resolve_phase_rejects_unsupported_pack_versions_before_append`
  proves `ResolvePhase` rejects that incompatibility before appending resolution envelopes or
  locking the phase]
- [x] Enforce a derived additive `ir_version` floor for declared action and policy features.
  [`validate_pack_required_ir_version` derives the minimum version, private domain tests
  `pack_required_ir_version_covers_versioned_action_features` and
  `pack_required_ir_version_covers_versioned_policy_features` cover the current version map, and
  pack-validation test `pack_ir_version_must_cover_declared_additive_features` proves a rich pack
  cannot lower `ir_version` below its declared feature floor]
- [x] Validate role references, alignment references, effect tags, trigger ids, and role-local
  action ids.
  [`invalid_reference_contract_fixture_is_rejected_by_pack_linter` proves malformed role,
  alignment, effect-tag, and policy action references fail the pack boundary, and
  `resolve_phase_rejects_invalid_reference_contract_before_append` proves `ResolvePhase` rejects
  the same pack before appending resolution envelopes or locking the phase]
- [x] Validate trigger filter references, trigger ids, and generated trigger production shapes.
  [`invalid_trigger_reference_contract_fixture_is_rejected_by_pack_linter` proves malformed trigger
  filter tags, duplicate ids, unsupported actor/target refs, unsupported generated ability, and
  invalid generated Kill modifiers fail the pack boundary, and
  `resolve_phase_rejects_invalid_trigger_reference_contract_before_append` proves `ResolvePhase`
  rejects the same pack before appending resolution envelopes or locking the phase]
- [x] Enforce `Investigate` has `mode`; non-investigate actions must not have `mode`.
  [`invalid_action_contract_fixture_is_rejected_by_pack_linter` proves both malformed modes at the
  pack boundary, and `resolve_phase_rejects_invalid_action_contract_before_append` proves
  `ResolvePhase` rejects the same pack before appending resolution envelopes or locking the phase]
- [x] Enforce `Mark`/`Clear` have `effect`.
  [`invalid_effect_contract_fixture_is_rejected_by_pack_linter` proves missing/illegal `effect`
  and illegal `reads_effect` fields at the pack boundary, and
  `resolve_phase_rejects_invalid_effect_contract_before_append` proves `ResolvePhase` rejects the
  same pack before appending resolution envelopes or locking the phase]
- [x] Enforce target cardinality and action window/cadence compatibility.
  [`invalid_target_window_contract_fixture_is_rejected_by_pack_linter` proves a `Night` action in
  a Day-only cadence plus `TargetSpec::None` cardinality/state mismatches fail the pack boundary,
  and `resolve_phase_rejects_invalid_target_window_contract_before_append` proves `ResolvePhase`
  rejects the same pack before appending resolution envelopes or locking the phase]
- [x] Enforce `Grant` requires `ir_version >= 2` and a well-formed grant payload.
- [x] Enforce selectable Grant options require `ir_version >= 42`, a Grant action, unique option
  ids, and item options that reference declared `item_actions`; `SubmitAction.grant_id` must select
  one declared option before append.
- [x] Enforce `Link` requires `ir_version >= 3` and a multi-target link shape.
- [x] Enforce `Retaliate` requires `ir_version >= 4` and a single-target shape.
- [x] Enforce `Modifier::Babysitter` requires `ir_version >= 5` and can appear only on
  `Protect` actions.
- [x] Enforce `Modifier::Hider` requires `ir_version >= 6`, can appear only on one-target
  `Mark` actions, and requires a resolution-scoped link effect.
- [x] Enforce `constraints.target_role_filter` requires `ir_version >= 40`, a targetful
  non-personal action, and pack-owned `investigation_results.role_sets.vanilla_roles`;
  command validation rejects mismatched live submissions while the pure resolver emits
  `ActionInterfered { reason: "invalid_target_role" }` for malformed/replayed submissions.
- [x] Enforce v16 `lover_policy` references a declared link effect and gates folded lover
  suicide through pack data.
- [x] Enforce v22 `host_prompt_resolution_effects` declares decision/effect pairs for emitted
  host prompts, rejects incompatible decision/effect combinations, and requires coverage for
  Beloved Princess plus day-vote prompt producers.
- [x] Enforce `Convert` declares the destination role.
- [x] Enforce `reads_effect` only on actions that intentionally read persistent state.
- [x] Enforce v1 window legality: Day, Night, Any against pack cadence. [proven:
  `invalid_target_window_contract_fixture_is_rejected_by_pack_linter` and
  `resolve_phase_rejects_invalid_target_window_contract_before_append`]
- [x] Encode vote policy: majority, plurality, supermajority, hammer, no-lynch, self-vote, weighted voting, dynamic vote modifiers, and tie-break semantics. [proven:
  `validate_pack` now rejects malformed and non-super supermajority ratios,
  hammer on plurality, threshold modifiers on plurality, empty/invalid `PerRole` vote-weight
  maps, malformed `Dynamic` effect weight policies, unsupported `EarliestReached` ties, and `HostDecides`
  ties without a matching `Tie` prompt plus `SelectSlot`/`PkKill` resolution effect; shipped
  packs validate under these stricter rules; pure resolver test
  `no_lynch_votes_produce_no_lynch_outcome_without_death` proves pack-allowed `no_lynch` is an
  official outcome target that emits no day-vote kill; command test
  `submit_vote_enforces_pack_no_lynch_and_self_vote_policy` proves `SubmitVote` rejects
  pack-disallowed no-lynch and self-vote ballots before `VoteSubmitted`; command test
  `submit_vote_hammer_locks_phase_when_threshold_is_reached` proves a threshold-reaching
  `hammer: true` vote atomically appends `VoteSubmitted` plus `ThreadLocked` and rejects later
  ballots through the phase-lock path; `hammer_majority_ignores_late_withdrawal` proves the
  pure resolver freezes the official vote snapshot at the hammering ballot and emits
  `VoteStatus::Hammer`; `host_resolve_phase_emits_hammer_vote_outcome` proves `ResolvePhase`
  persists and projects that official hammer outcome. `WeightPolicy::Dynamic` now requires a
  concrete effect-rule policy; `dynamic_vote_weights_must_reference_declared_effects_and_be_unambiguous`
  proves strict linter boundaries.]
- [x] Encode phase policy: day/night/twilight cadence, substeps, lock rules, phase skips, and announcements. [proven: `validate_phase_policy` now rejects empty/duplicate cadence, `Twilight` cadence/flag mismatches, subsegment keys absent from cadence, empty
  subsegment lists, duplicate subsegments, and non-`snake_case` subsegment ids; domain test
  `phase_policy_shape_is_strict` and `shipped_packs_validate` prove those schema boundaries.
  Command test `host_phase_movement_respects_pack_cadence` proves `StartGame` and host
  `PhaseAdvanced` reject phase ids whose kind is absent from the declared pack cadence and leave
  `phase_state` untouched; command test
  `host_prompt_skip_next_day_rejects_unsupported_pack_cadence` proves unsupported prompt-driven
  phase skips append no `HostPromptResolved` or `PhaseAdvanced` and leave the prompt pending;
  `host_resolve_phase_projects_beloved_princess_host_prompt` now proves pending prompt windows
  reject further votes/actions as `PhaseLocked` until the host opens the follow-up phase, and
  `host_resolve_phase_uses_loved_hated_threshold_adjustments` proves a resolved revote remains a
  usable follow-up voting window; `host_resolve_phase_loads_votes_applies_resolution_and_projects`
  proves prompt-free `ResolvePhase` validates the stored `ResolutionApplied`, preserves semantic
  `lynch` deaths in the trailing `PhaseAnnouncement` across the final win-trigger pass, helper-checks
  exact stored `ResolutionTrace` result-contract and inner-event rows, atomically appends the
  resolved-phase `ThreadLocked`, rejects later votes/actions as `PhaseLocked`, preserves the locked
  `phase_state` through rebuild, and lets host-controlled `AdvancePhase` derive and open the next
  declared Night window from `[Day, Night]` cadence;
  `host_advance_phase_wraps_night_to_next_day_from_pack_cadence` proves
  the same command wraps resolved `N01` to `D02`, reopens voting, and preserves the derived
  `phase_state` through rebuild; `deadline_elapsed_evidence_is_inert_until_deadline_advance_command`
  proves standalone `PhaseDeadlineElapsed` evidence does not move `phase_state`, and the
  deadline command rejects unresolved, stale-phase, and premature observations before atomically
  appending `PhaseDeadlineElapsed` plus pack-derived
  `PhaseAdvanced { reason: "deadline_elapsed" }` with rebuild-stable projection state.
  `host_resolve_phase_carries_day_announcements_and_last_words` proves public
  `DayAnnouncement`, `LastWordsRecorded`, and trailing `PhaseAnnouncement` inner events are
  published as a deterministic system `thread_view` row, rebuild identically, and do not move the
  phase cursor.]
- [x] Encode conflict/precedence policy: standard NAR, mafiascum variants,
  Mafia Universe constraints, and Chinese structured variants. [proven for the pack-schema
  contract: shipped
  pack night order is derived from pack `precedence` plus action priorities, malformed
  ambiguous/cyclic precedence fails validation, and `ResolvePhase`/pure resolver no longer falls
  back to a legacy hardcoded order when night ordering is invalid; focused mafiascum goldens and
  command tests prove persisted pack-derived stage-order trace,
  `night_order_reacts_to_pack_priorities_and_precedence_edges` proves the derivation changes when
  pack priorities or precedence edges change,
  `resolve_phase_uses_pack_derived_non_legacy_precedence_order` proves a valid
  Kill-before-Protect pack persists that order and folds the resulting kill through projections, and command test
  `resolve_phase_rejects_invalid_pack_precedence_before_append` proves invalid standard-NAR
  precedence rejects before `ResolutionApplied`/`ResolutionTrace`/`ThreadLocked` append; goldens prove
  roleblock suppression, doctor/bodyguard protection, Strongman bypasses, and PGO `Visit`
  triggers through the generated-kill/protection path; Chinese structured now declares
  `protect_before_guard_blockable_kills`, validates that enabled `guard_policy` has a
  `Protect`-beats-`Kill` edge, and preserves Guard/Witch poison goldens; Mafia Universe ITA now
  declares `vote_conflict: ResolveShotsBeforeVote`, validates that `ItaShot` packs declare it,
  rejects missing policy at the pure resolver seam, and command/projection proof shows ITA target
  death is folded before official vote outcome; mafiascum now declares `standard_nar` action-id
  buckets for Block, Protect, ordinary Kill, Bodyguard, Martyr, Jailkeeper, and Strongman, validates action shapes and
  required Block/Protect/Kill precedence edges, rejects enabled standard-NAR packs where night
  Block/Protect/ordinary Kill actions are not declared in the corresponding buckets, and the resolver now gates
  Block/Protect/Kill stage participation through those pack-declared buckets with a fallback only for
  non-standard-NAR packs; the pure night resolver now also fail-closes when in-memory standard-NAR
  packs omit `roleblocker_block`, `doctor_protect`, `bodyguard`, or Jailkeeper's explicit
  block/protect bucket declarations, when any standard-NAR action bucket is empty or contains a
  blank id, wrong ability/modifier/window shape, duplicate entry, or unknown action id, and when
  `team_kill_action_ids` contains a blank id, duplicate, unknown, wrong-shaped, or non-`kill_action_ids`
  entry or a Lost/Recluse role no longer exposes a declared team kill before resolution; when
  Bodyguard, Martyr, CPR, or Babysitter protect actions are moved into a bucket that would skip
  their specialized cause-policy path; mafiascum now declares Babysitter's `babysit` as a standard protect
  action with `standard_nar.guard_dependency_cause_policy` owning the generated ward-death cause,
  malformed guard dependency source/cause maps now fail closed, and golden plus command/projection
  proof preserves the Babysitter dependency outcome;
  mafiascum also declares `strongman_bypasses_protect: true`, enabled standard-NAR packs reject a
  missing explicit bypass flag, and a domain regression proves Strongman bypass no longer depends
  on generic `precedence.unless_modifiers`; the pure resolver now also fail-closes when an in-memory
  standard-NAR pack disables the explicit bypass flag; `resolve_phase_rejects_invalid_pack_precedence_before_append`
  proves the same missing explicit Strongman bypass policy rejects at the command seam before
  `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked` append; mafiascum now declares
  `standard_nar.protection_cause_policy` for Doctor, Babysitter, Bodyguard, Martyr, and Jailkeeper
  sources against every cataloged standard-NAR kill-like cause, mafiascum now declares
  `standard_nar.kill_cause_ids` for submitted/chosen/generated kill causes, enabled standard-NAR
  packs reject missing/unknown/duplicate/empty kill-cause catalog entries, the pure resolver now
  fails closed on the same malformed in-memory kill-cause catalog before resolution, and packs reject
  missing protection source maps, missing protection/cause classifications, malformed protection
  source keys, duplicate/unknown causes, causes classified as both blocked and bypassed, ordinary
  kills classified as bypasses, and Strongman causes classified as blocks, and the resolver now
  reads this table instead of the
  generic `protection_blocks_cause` fallback for standard-NAR packs; the pure resolver now
  fail-closes before resolution when in-memory standard-NAR protection/source tables omit or
  malform the protection source map or any declared ordinary, chosen-retaliation, or generated
  kill cause, when a Strongman Kill action is
  missing from `standard_nar.strongman_action_ids`, when ordinary kill causes are classified as
  bypasses, or when submitted/generated Strongman bypass causes are classified as blocks; domain and
  command/projection proof preserves doctor, bodyguard, martyr, jailkeeper, PGO-generated kill, and
  Strongman bypass behavior through the table; mafiascum now declares
  `standard_nar.suppression_policy` for Roleblocker and Jailkeeper sources against every
  night-capable role/item action, enabled standard-NAR packs reject missing suppression source
  maps, missing suppression classifications, malformed block source keys, duplicate/unknown action
  ids, action ids classified as both suppressed and bypassed, roleblockable actions classified as
  bypasses, and
  non-roleblockable actions classified as suppressed; the pack linter now also rejects enabled
  standard-NAR packs whose suppression table can stop a night action unless Block has a precedence
  path before that action's ability; `resolve_phase_rejects_invalid_pack_precedence_before_append`
  proves missing suppression `scope` rejects before append, and the resolver now fails closed
  instead of defaulting missing standard-NAR scope; the pure resolver now also fail-closes before
  night resolution when in-memory standard-NAR suppression tables omit a role action or item
  action classifier, malform the block source map, contain empty/duplicate/unknown action ids,
  classify an action as both suppressed and bypassed, classify a suppression-immune action as
  suppressed, or classify a roleblockable action as bypassed, while generated-trigger feeder
  omissions still fail at the generated-kill ownership boundary; the resolver reads this table
  instead of the generic
  `constraints.roleblockable` boolean for standard-NAR packs; domain goldens prove both
  roleblockable suppression and non-roleblockable Roleblocker survival, while
  command/projection proof preserves `ActionInterfered` and structured suppression trace details;
  `standard_nar.conflict_families` now declares the pack-level conflict families each shipped
  standard-NAR pack actually relies on, requires v44 IR, rejects missing, duplicate, or
  over-claimed family declarations, and the pure resolver fail-closes if an in-memory pack drops
  a required family before night resolution; this keeps the broad conflict/precedence schema as an
  explicit pack contract instead of an emergent consequence of many separate tables;
  Mafia Universe now models `town_roleblocker`, `mafia_roleblocker`, `town_jack_of_all_trades`,
  and `mafia_jack_of_all_trades` as pack aliases over canonical `roleblocker_block`/source
  `block`; the JOAT roles carry one-shot parity investigate/protect/block/track bundles, with
  pure goldens proving town and mafia one-shot block counter consumption and Postgres
  command/projection proof that the mafia-aligned JOAT block suppresses a Doctor save through the
  same standard-NAR table;
  mafiascum `standard_nar` also
  declares `kill_stacking: AggregateAttackers`, with domain/command proof that simultaneous
  landed ordinary/Strongman kills merge attackers into one `PlayerKilled`, trace
  `kill_stacked_on_existing_death`, and rebuild the exact night `PhaseAnnouncement.deaths`
  cause, and the pure resolver now fails closed when an in-memory standard-NAR pack omits
  `kill_stacking`; bodyguard-intercept generated kills that race the bodyguard's direct death use
  the same merge/trace path, with Bodyguard/Martyr intercept death causes declared in
  `standard_nar.intercept_cause_policy`, validated as non-empty non-direct-kill causes with
  missing source maps and malformed source keys rejected, and read by the resolver/trace instead
  of hardcoded cause strings; mafiascum now declares explicit
  `SuppressionScope::{FirstMatchingAction, AllMatchingActions}` for standard-NAR suppression,
  validates that every block source names a scope, preserves ordinary Roleblocker/Jailkeeper
  as single-action suppressors, and proves a catastrophic block source suppresses every submitted
  Inventor action through pure goldens, trace assertions, and command/projection rebuild proof;
  the pure night resolver now also fail-closes when an in-memory standard-NAR suppression table says
  Roleblocker or catastrophic Block can suppress a Redirect-capable action but pack precedence no
  longer contains a Block-before-Redirect path;
  mafiascum now declares `standard_nar.target_state_save_tags` plus
  `standard_nar.target_state_save_policy` for `bulletproof` and `bulletproof_vest`, enabled
  standard-NAR packs reject missing/unknown/duplicate/empty save-tag catalog entries, missing
  save-policy tags, missing save-policy source maps, empty/unknown policy keys, duplicate causes,
  unknown causes, causes classified as both blocked and bypassed, ordinary kills classified as
  target-state bypasses, and Strongman causes classified as target-state blocks; resolver
  regressions prove those malformed in-memory save classifications fail before
  Strongman-vs-bulletproof can rely on implicit
  `unstoppable` behavior; the pure night
  resolver now rejects a standard-NAR pack that reaches resolution with missing target-state save
  catalog, policy, or per-cause classifier instead of silently using legacy fallback behavior, and
  `test_invalid_target_state_policy` plus
  `resolve_phase_rejects_invalid_target_state_policy_before_append` prove missing `bulletproof`
  save policy rejects before `ResolutionApplied`, `ResolutionTrace`, or `ThreadLocked` append;
  mafiascum now
  declares `standard_nar.target_state_gate_tags` plus `standard_nar.target_state_gate_policy` for
  `commuted` and `untargetable`, enabled standard-NAR packs reject missing/unknown/duplicate/empty
  gate-tag catalog entries, missing gate-policy tags, missing gate-policy source maps, unknown
  policy tags, empty blocked-ability lists, duplicate abilities, and unsupported abilities, and a
  resolver regression proves commute-vs-kill/investigate behavior reads the target-state gate table
  rather than hardcoded tag checks; the pure night resolver now rejects a standard-NAR pack that
  reaches resolution
  with missing target-state gate policy, empty/unknown policy keys, duplicate blocked abilities,
  or unsupported blocked abilities instead of silently using legacy fallback behavior, and the
  same invalid fixture/command proof covers missing `commuted` gate policy before append;
  Strong-Willed roleblock immunity is modeled as a standard-NAR suppression bypass rather than a
  bespoke resolver branch, with pack validation requiring `Modifier::StrongWilled` actions to be
  classified in bypasses, pure golden/trace proof that the investigation resolves through a
  roleblock, and command/projection proof that the persisted resolution/trace envelopes audit and
  rebuild; standard-NAR validation now also rejects a night Strongman Kill action unless it is
  explicitly declared in `strongman_action_ids`, keeping protect bypass semantics in the pack
  table instead of implicit modifier fallback; item actions now participate in the same
  standard-NAR action scans, so an item-granted Strongman Kill must be declared as a Strongman
  source and classified in protection-cause, target-state save, and suppression tables before the
  pack validates; Strongman-producing triggers such as `unstoppable_vengeful_retaliates` also
  have explicit malformed-pack regression coverage proving they must be declared in
  `standard_nar.generated_kill_cause_policy` with trigger `on`, produced actor, produced target,
  and Strongman classification matching the trigger rule, and must stay classified in
  protection-cause and target-state save bypass policy, with malformed-pack tests now proving
  omitted generated triggers are named by the protection/source and target-state save classifiers;
  `test_invalid_generated_kill_ownership` plus
  `resolve_phase_rejects_invalid_generated_kill_ownership_before_append` now prove an otherwise
  declared generated kill trigger still rejects before `ResolutionApplied`, `ResolutionTrace`, or
  `ThreadLocked` append when the trigger is not owned by protection-cause, target-state save, and
  roleblock suppression tables; the pure resolver now also fail-closes before the trigger
  fixpoint when an in-memory standard-NAR pack omits that generated trigger from protection,
  target-state save, or roleblock suppression ownership;
  standard-NAR validation now also rejects
  generated-kill policy drift where `generated_kill_cause_policy` and `trigger_fixpoint_policy`
  do not both name the same kill-producing trigger, and the pure resolver rejects a missing
  `pgo_shoots_visitor` trigger-fixpoint source before trigger fixpoint; it also rejects
  ordinary submitted night Kill actions, including item actions, unless they are explicitly
  declared in `kill_action_ids`, classified in conflict tables, and allowed through the
  resolver's Kill stage by that pack table; the pure resolver now also rejects empty or unknown
  generated-kill cause-policy keys and empty or unknown trigger-fixpoint policy keys before trigger
  fixpoint entry, mirroring the pack linter's closed generated-trigger table.
  Remaining breadth: standard NAR variants beyond the core
  block/protect/kill family, Mafia Universe role-madness variants, and broader Chinese
  structured conflict variants.]
- [x] Encode visibility policy: public, private, hidden, stealth/ninja, result tampering,
  watcher/tracker visibility, and death-reveal variants. [proven for the pack-schema
  contract and current behavior: current IR 45 packs must declare `visibility_families`
  matching the visibility surfaces they actually use; the validator rejects missing,
  duplicate, and over-claimed visibility-family declarations; the pure resolver also
  fail-closes before day/night resolution when an in-memory pack drops a required
  visibility family; shipped Mafiascum, Mafia Universe, Epicmafia, Chinese structured,
  and Default Open packs now declare their exact visibility-family set;
  mafiascum
  `visibility.Investigate.unless_modifiers: [Ninja]` owns Ninja hidden visits for
  tracker/watcher/motion-style graph-derived results; pack validation rejects duplicate
  visibility fields/modifiers, `Result` visibility on non-`Investigate` abilities, missing
  Ninja `Investigate` visibility policy, missing `Ninja` unless modifier, and missing
  `TargetId`; the pure night resolver fails closed before resolution if a Ninja pack omits
  that policy; pure goldens preserve Ninja-hidden Watch/Motion behavior; command/projection proof
  now resolves a Ninja kill plus Watch/Motion submissions, preserves hidden-visit results in the
  stored `ResolutionApplied`, folds those graph-derived results only to addressed
  `player_investigation_result` rows, keeps unrelated actors from receiving observer rows,
  keeps the result payloads out of public `thread_view`, audits the envelope, and rebuilds
  projections identically; separate Tracker command/projection proof resolves a visible kill
  visit into an addressed private `Track` result row, keeps it from the tracked actor and
  public `thread_view`, audits the envelope, and rebuilds projections identically;
  result-tampering tables such as Godfather/Miller/Framer `investigation_overrides` now fail
  validation unless the pack declares `visibility.Investigate` with `Result`; Mark/Clear/Link
  action effects now fail validation unless the pack declares `effects.<tag>` duration and
  visibility metadata, with shipped mafiascum and epicmafia douse/framed-style effects covered by
  linter proof; Epicmafia douse now has culture-pack command/projection proof that
  ActorAndTarget `EffectNotification` rows fold only to the arsonist and doused target, not to
  unrelated slots, and not into public `thread_view`, with rebuild-stable notifications;
  death-reveal variants now have v26 linter coverage, result-schema coverage,
  pure golden coverage for Janitor/Flipless concealed flips and AlignmentOnly flips, and
  Postgres command/projection rebuild proof that `slot_state.role_revealed` /
  `slot_state.alignment_revealed` fold Concealed and AlignmentOnly correctly; public
  loud/announcing resolver notices and targeted ActorAndTarget/hidden-filtered mark notices
  now have Postgres command/projection proof that `EffectNotification` rows fold only through
  `player_notification`, preserve their audience rows across rebuild, and do not leak
  notification payloads into the public `thread_view`; default-open Seer results now have
  Postgres command/projection proof that `InvestigationResult` folds only to the addressed
  `player_investigation_result` row, unrelated slots receive no private result row, rebuild
  preserves the private row, and the result payload does not leak into public `thread_view`;
  Chinese structured Prophet alignment reads now have culture-pack command/projection proof that
  the `evil` parity result folds only to the addressed Prophet `player_investigation_result` row,
  not to the investigated wolf, and not into public `thread_view`, with rebuild-stable
  projections. Broader public/private policy surfaces across the remaining culture-pack variants
  remain open.]
- [x] Encode win policy: faction elimination, parity, all-other-factions-eliminated,
  independent win conditions, lovers, executioner/condemner, and culture-specific wins.
  [proven for the pack-schema contract and current behavior: current IR 46 packs must declare
  `win_families` matching ordinary and independent win surfaces they actually use; the validator
  rejects missing, duplicate, and over-claimed win-family declarations; pure day resolution and
  `check_win` fail closed when an in-memory pack drops a required family; shipped Mafiascum,
  Mafia Universe, Epicmafia, Chinese structured, and Default Open packs now declare their exact
  win-family set, including Epicmafia's cult parity family and Mafiascum's target-lynch,
  self-lynch, and Win-triggered-action families; mafiascum v19 `target_lynch_win_policies` folds durable target relations and
  emits independent `WinReached` when the target is lynched; Executioner and Condemner are each
  covered by pure goldens plus command/projection rebuild proof; faction win rules now fail pack
  validation if `FactionEliminated` awards the eliminated faction or if
  `FactionReachesParity` / `AllOtherFactionsEliminated` awards a faction other than the matching
  parity/surviving faction, with shipped-pack validation proving the stricter shape is satisfied;
  `test_invalid_win_policy_contract` and
  `resolve_phase_rejects_invalid_win_policy_contract_before_append` prove the same malformed
  contract is rejected at the command seam before `ResolutionApplied`, `ResolutionTrace`, or
  `ThreadLocked` can append; duplicate `win.rules[*].when` terminal conditions now fail validation
  as first-match dead policy, and the same invalid fixture/command proof covers that duplicate
  `FactionEliminated(mafia)` case before append; duplicate target-lynch win policy role/effect
  sources now fail validation before one Mark action can emit two independent target-win records,
  and the same invalid fixture/command proof covers that duplicate `executioner` +
  `execution_target` source before append; duplicate self-lynch win policy role/source-event
  pairs now fail validation so unique ids cannot silently shadow each other under the resolver's
  first-match self-lynch behavior, with the same invalid fixture/command proof covering
  `jester` + `win.jester` before append; command/projection proof now covers a real
  Jester/Executioner collision where a night target mark exists and the lynched Jester would also
  create post-lynch mafia parity, proving the self-lynch `WinReached` is the only terminal win,
  target-lynch trace does not fire, role/alignment reveal folds, and rebuild preserves state;
  `resolve_phase_folds_night_kill_into_faction_win_and_rebuild`
  proves a default-open Night kill can trigger the ordinary `FactionReachesParity` win rule,
  persist `WinReached` in `ResolutionApplied` / `ResolutionTrace`, fold role/alignment reveal
  into projections, and rebuild `slot_state` identically;
  `resolve_phase_folds_three_faction_elimination_win_and_rebuild` proves epicmafia's
  three-faction `AllOtherFactionsEliminated("town")` rule does not fire after only cult is
  eliminated, then emits town `WinReached` after the last mafia slot is lynched, with trace,
  reveal projection, and rebuild-stable `slot_state` proof; command pipeline tests now route
  target-lynch, self-lynch, two-faction parity, and three-faction all-other wins through one
  shared role/alignment reveal assertion so every proven `WinReached` path covers the same
  projection contract]
- [x] Provide pack-to-pack migration/upcast tools and golden fixture regeneration tools. [proven:
  `domain::load_pack_from_json` routes every pack read through `upcast_pack_json` before
  deserialize/validation, current v1 packs identity-upcast, `test_pack_v0_legacy_shape` proves a
  real v0 legacy shape migrates old top-level/role-local field names into v1 before validation,
  unsupported future pack versions fail with an explicit missing-migration-path error,
  `commands::load_pack` uses that boundary before `ResolvePhase`, `upcast_pack --check` smokes
  accepted current/v0 packs and rejected unsupported fixtures, Postgres test
  `resolve_phase_loads_upcast_v0_pack_before_append` proves a migrated pack can submit, resolve,
  validate, and project a kill, and `check_goldens --check` reruns 139 current fixtures through
  the upcast/load boundary with fixture-local `pack_overrides` for the Cupid cascade-disabled
  variant; `write_mode_regenerates_a_drifted_temp_fixture` proves `check_goldens --write`
  regenerates a drifted copied fixture and that the rewritten copy passes check-mode. Future
  historical pack shapes still require explicit registered migration steps.]

### C. Day resolution

- [x] Treat day votes as first-class submissions, not UI-only state. [proven:
  `SubmitVote`/`WithdrawVote` append `VoteSubmitted`/`VoteWithdrawn` events, `load_engine_phase_input`
  reduces those stored events into ordered `Submission { template_id: "day_vote" }` history,
  `resolve_day` builds active ballots from those submissions rather than from the running
  `votecount` projection, and Postgres test
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` proves
  command-submitted vote/withdraw history reaches `ResolvePhase`, a projection-only stale ballot is
  ignored by the official `DayVoteOutcome`, the persisted trace excludes withdrawn ballots, and
  rebuild restores the event-log-derived running tally.]
- [x] Preserve vote history with `DayVoteRecorded` events, including withdrawals and sequence.
  [proven: `resolve_day` now emits `DayVoteRecorded` for every ordered `day_vote` submission
  before computing the official outcome, including overwritten ballots and targetless withdrawals
  with monotonically increasing sequence numbers; result-contract test
  `day_vote_recorded_payload_passes_contract_validation` proves the submit/withdraw payload shape,
  and Postgres test `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots`
  proves command-produced submit/overwrite/withdraw history persists inside `ResolutionApplied`
  while the official `DayVoteOutcome` still excludes withdrawn and projection-only stale ballots.]
- [x] Compute official `DayVoteOutcome` from pack policy, not from the running projection.
  [proven: `day_vote_outcome` projection rows fold only from `ResolutionApplied`
  `DayVoteOutcome` inner events; Postgres test
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` injects a
  projection-only `vote_ballot` actor, proves that actor is absent from the persisted
  `DayVoteOutcome` and the official host-console `day_vote_outcome` row, proves the stale running
  `votecount` row remains projection-local until rebuild, and then proves rebuild preserves the
  official engine result while discarding the stale running ballot.]
- [x] Support last-write-wins ballots per actor/phase. [proven: pure resolver test
  `day_vote_ballots_are_last_write_wins_per_actor` proves later ballots overwrite earlier ballots
  for the same actor and withdrawal removes that actor from the official vote map/tally; Postgres
  test `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` proves the
  same command-submitted submit/overwrite/withdraw history reaches `ResolvePhase`, persists
  `DayVoteRecorded`, folds to the official host-console `day_vote_outcome`, and rebuilds the
  running `votecount` projection back to the log-derived current ballots.]
- [x] Support `NoLynch` distinctly from no majority and tie. [proven: pure resolver test
  `day_vote_statuses_distinguish_no_lynch_no_majority_and_tie` proves the same day-vote resolver
  emits distinct `VoteStatus::NoLynch`, `VoteStatus::NoMajority`, and `VoteStatus::Tie` outcomes;
  `no_lynch_votes_produce_no_lynch_outcome_without_death` proves `NoLynch` is an official
  pack-governed vote target with no day-vote death; Postgres tests
  `no_lynch_votes_resolve_to_official_engine_outcome`,
  `host_resolve_phase_uses_loved_hated_threshold_adjustments`, and
  `host_resolve_phase_projects_epicmafia_pk_tie_prompt` prove the three statuses persist through
  `ResolutionApplied`, host prompts where configured, `day_vote_outcome`, and projection rebuild.]
- [x] Support pack-declared role vote weights for doublevoter, triplevoter, x-voter, and voteless. [mafiascum
  `WeightPolicy::PerRole`; weighted day golden and command/projection integration covered;
  Chinese v15 `idiot_policy` also removes vote weight from slots carrying the persistent
  `idiot_vote_loss` effect, and command submission now rejects later ballots from those slots
  before appending `VoteSubmitted`]
- [x] Support loved/hated target threshold modifiers. [mafiascum
  `vote.threshold_adjustments`; loved no-majority and hated lynch goldens plus
  command/projection integration covered]
- [x] Support sheriff badge vote weight. [v7 `Badge` IR emits folded `BadgeChanged`;
  Chinese structured sheriff badge owner contributes 1.5 in official `DayVoteOutcome`]
- [x] Support effect/grant-based dynamic pack vote weights. [`WeightPolicy::Dynamic`
  declares a finite base weight plus declared-effect and declared-grant rules with unique priorities;
  `dynamic_vote_effect_mark_action` proves a legal Night `Mark` action creates the
  vote-weight effect, `dynamic_vote_effect_weight` proves the pure resolver reads
  folded slot effects, `dynamic_vote_grant_action` proves a legal Night `Grant`
  action creates a folded `VoteWeight` `ActionGranted`, `dynamic_vote_grant_weight`
  proves the pure resolver reads folded vote-weight grants, and
  `host_resolve_phase_uses_dynamic_effect_vote_weight` /
  `host_resolve_phase_uses_vote_weight_action_grant`
  proves Postgres `SubmitAction` -> N01 `ResolvePhase` -> `AdvancePhase` -> D02
  `DayVoteOutcome` -> rebuild stability. `dynamic_vote_grant_hammer` and
  `submit_vote_hammer_uses_folded_vote_weight_grant` prove the same folded grant
  state drives live `SubmitVote` hammer locking. `dynamic_vote_grant_no_majority_prompt`
  and `host_resolve_phase_uses_dynamic_vote_weight_for_no_majority_prompt` prove folded
  vote-weight grants can raise the majority threshold enough to emit a rebuild-stable
  `NoMajority` revote prompt. `dynamic_vote_grant_pk_tie_prompt` and
  `host_resolve_phase_uses_dynamic_vote_weight_for_pk_tie_prompt` prove the same folded
  state can turn a simple plurality into a `HostDecides` tie, emit a PK prompt, and carry
  the host-selected kill through validated envelopes and rebuild.]
- [x] Support majority, plurality, supermajority, hammer, no-elimination ties,
  random/stable/host-decided tie policies, and PK/revote loops.
  [proven: pure resolver test `day_vote_policy_matrix_covers_methods_and_tie_breakers`
  covers Majority, Plurality, Supermajority, Hammer, NoElimination, HostDecides, and
  seeded deterministic Random outcomes; command tests
  `submit_vote_hammer_locks_phase_when_threshold_is_reached` and
  `host_resolve_phase_emits_hammer_vote_outcome` prove live hammer locking plus validated
  `ResolutionApplied`/projection/rebuild behavior; mafiascum v21
  `day_vote_prompt_policies` emits a rebuild-stable `revote` `HostPromptIssued` for
  official `NoMajority` outcomes as proven by
  `host_resolve_phase_uses_loved_hated_threshold_adjustments`; epicmafia v21 plurality
  uses `HostDecides` to emit a rebuild-stable `pk` `HostPromptIssued` for official `Tie`
  outcomes as proven by `host_resolve_phase_projects_epicmafia_pk_tie_prompt`; v22
  `host_prompt_resolution_effects` declares the host decision/effect rows consumed by
  command-side prompt resolution]
- [x] Emit a lynch as `PlayerKilled` plus `PhaseAnnouncement` so state fold is uniform.
  [`host_resolve_phase_loads_votes_applies_resolution_and_projects` proves the command path
  stores the lynched slot as `PlayerKilled`, projects the death, and carries the public lynch
  death in the single trailer `PhaseAnnouncement`; target-lynch win goldens prove optional
  `WinReached` remains after the announcement]
- [x] Support day action substeps from im-human where in scope: announcement,
  knight duel, ITA session, last words, wolf self-destruct, day deaths, and public reveal
  timing. [proven: golden proof `day_substep_goldens_expose_canonical_host_console_ordering`
  runs real Mafia Universe and Chinese structured scenarios and asserts host-consumable
  event order for `DayAnnouncement`, `AlignmentRevealed`, `ItaSessionOpened` /
  `ItaShotQueued` / `ItaShotResolved` / `ItaSessionUpdated` / `ItaSessionClosed`,
  `DuelResolved`, `WolfSelfDestructed`, `WolfCarryQueued`, day-action
  `PlayerKilled`, `DayVoteOutcome`, `LastWordsRecorded`, `WolfBeautyDragged`, and
  the trailing `PhaseAnnouncement`. Existing command/projection tests prove the same
  typed events for reveal-town, Knight duel, ITA, day vigilante/desperado,
  wolf self-destruct, day notes/last words, PK, and revote survive validated
  `ResolutionApplied`, thread/slot/host-prompt projections, and rebuild. Twilight
  and instant-action support are proven in the dedicated action-window row below.]
- [x] Finish port/catalog coverage for day action ids observed in V4 role drafts:
  `day_desperado`, `day_self_destruct`, `duel`, `kill`, `knight_duel`,
  `reveal_town`, and `veto`. [sheriff_destroy/sheriff_election/sheriff_pass are modeled in
  `packs/chinese_structured` and covered by goldens; `knight_duel` is modeled in
  `packs/chinese_structured` and covered by success/failure goldens; Chinese
  `day_self_destruct` is modeled as `SelfDestruct` on `white_wolf_king`; Chinese
  source `night_kill` is covered for both `wolf` and `white_wolf_king` by canonical fmarch
  `wolf_night_kill` via `ActionTemplate.source_ids` and modeled as the faction kill that can
  consume White Wolf carry, with pure and Postgres White Wolf King night-kill proof;
  `beauty_mark` is modeled as a persistent Mark action for Wolf Beauty; Chinese
  `heal_potion`/`poison_potion` are modeled as Witch Protect/Kill actions; Chinese
  `night_guard` is modeled as Guard Protect with poison-blocking policy; Mafia Universe
  `reveal_town` is modeled as canonical `RevealTown` through Innocent Child; Mafia Universe
  source `kill` is modeled for `town_day_vigilante` and `mafia_day_vigilante` as canonical
  `day_vigilante_kill` before the day vote outcome; Mafia Universe source `day_desperado`
  is modeled as canonical `day_desperado` with declarative `alignment_failback` before the
  day vote outcome; Mafiascum `day_self_destruct` is modeled as canonical `SelfDestruct`
  through `day_self_destructor`, covered by `day_self_destruct_trade`, and integrated through
  `host_resolve_phase_carries_mafiascum_day_self_destruct_trade`; Mafiascum `veto` is modeled
  as canonical `Veto` through `governor`, covered by `governor_veto_cancels_lynch`, and
  integrated through `host_resolve_phase_carries_mafiascum_governor_veto`, proving the typed
  `VoteVetoed` event cancels the lynch death while preserving the official `DayVoteOutcome`]
- [x] Cover the remaining day-only or day-capable role observed in V4 drafts:
  dual-window Mafiascum `white_wolf_king`; covered role ids in this row include
  `day_vigilante`, `gladiator`, `governor`, `innocent_child`, `knight`,
  `mafia_day_desperado`, `mafia_day_vigilante`, `sheriff_badge_helper`,
  `town_day_desperado`, and `town_day_vigilante`. [`knight` is
  modeled in `packs/chinese_structured` and integrated through command/projection;
  `white_wolf_king` is modeled for the Chinese self-destruct and carry-token verticals;
  `wolf_beauty` is modeled for charm plus lynch/Witch-poison drag and direct-death race
  stacking; `witch` is modeled for heal and poison potion verticals; `guard` is modeled for
  night protection, Guard-blocked poison, and non-lethal Guard+Witch double-save; `hunter` is
  modeled for chosen
  death-retaliation with Chinese poison suppression; `idiot` is modeled for first-lynch
  survival plus persistent vote loss; Mafia Universe `innocent_child` is modeled with pure
  golden and Postgres alignment-only reveal/thread/rebuild proof; Mafia Universe
  `town_day_vigilante` and `mafia_day_vigilante` are modeled with pure day-kill golden
  coverage and a Postgres D01 submit/resolve/thread/rebuild vertical; Mafia Universe
  `town_day_desperado` and `mafia_day_desperado` are modeled with pure success/failback
  golden coverage and a Postgres D01 trace/thread/rebuild vertical; Mafiascum `governor` is
  modeled with pure veto golden coverage and a Postgres D01 veto/thread/rebuild vertical;
  Mafiascum `day_vigilante` is modeled as canonical Day-window `day_vigilante_kill`
  with source alias `kill`, covered by `day_vigilante_kill_before_vote`, and integrated
  through `host_resolve_phase_carries_mafiascum_day_vigilante_kill`; Mafiascum
  `white_wolf_king` is modeled as a dual-window role with Day `SelfDestruct` and Night
  `Kill`, covered by `white_wolf_king_day_self_destruct` and
  `white_wolf_king_night_kill`, and integrated through
  `host_resolve_phase_carries_mafiascum_white_wolf_king_dual_window`]
- [x] Support day-targeting action windows distinct from ordinary votes. [proven:
  Mafia Universe `day_vigilante_kill` now resolves submitted Day `Kill` actions before ITA,
  duel, and official vote outcome; Mafia Universe `day_desperado` uses the same pre-vote
  lane plus pack-owned `alignment_failback`; Mafiascum `day_vigilante_kill` now uses the
  same submitted Day `Kill` lane before the vote outcome; Mafiascum `white_wolf_king`
  now proves a role can carry both Day `SelfDestruct` and Night `Kill` actions while
  resolving the day action before voting; `Window::Twilight` now proves pack-declared
  non-vote actions resolve outside ordinary Day voting, `golden_twilight_self_destruct_window`
  proves no `DayVoteOutcome` is emitted in Twilight, and
  `host_resolve_phase_carries_twilight_self_destruct_window` proves Postgres command/projection
  integration rejects ordinary votes in `T01` while carrying the Twilight action through
  `ResolutionApplied`, slot deaths, thread announcement, audit, and rebuild]
- [x] Support instant actions and twilight actions if a pack declares them. [proven:
  Twilight is modeled as `Window::Twilight` requiring `ir_version >= 48`, strictly validated
  against phase cadence and `active_from`, resolved by the pure Twilight resolver for
  `SelfDestruct`, and integrated through the command/projection seam via
  `golden_twilight_self_destruct_window` and
  `host_resolve_phase_carries_twilight_self_destruct_window`. Instant is modeled as
  `Window::Instant` requiring `ir_version >= 49`; `instant_action_window_is_strict_and_versioned`
  proves strict pack validation, `golden_instant_self_destruct_window` proves the pure instant
  resolver emits no ordinary `DayVoteOutcome`, and
  `submit_action_resolves_instant_self_destruct_atomically` proves `SubmitAction` appends
  `ActionSubmitted`, `ResolutionApplied`, and `ResolutionTrace` atomically, folds deaths and
  thread announcements through projections, marks the submission resolved, skips replay during
  ordinary `ResolvePhase`, audits the unsupported instant envelope boundary, and rebuilds
  projections identically.]
- [x] Support day win checks after phase results and after canonical announcements.
  [proven: `finalize_resolution` folds all day result events, preserves the single canonical
  `PhaseAnnouncement`, then runs ordinary `check_win` on the post-result state and leaves any
  faction `WinReached` as the final event; `golden_day_action_kill_triggers_post_announcement_win`
  proves a Day `Kill` can eliminate the last mafia before the official vote outcome while
  emitting `PlayerKilled`, `DayVoteOutcome`, `PhaseAnnouncement`, then `WinReached`; Postgres test
  `host_resolve_phase_day_action_win_runs_after_announcement` proves the same ordering through
  `ResolvePhase`, `ResolutionApplied`/`ResolutionTrace` validation, slot projection, thread
  announcement, resolution audit, and projection rebuild.]

### D. Night and general action primitives

- [x] Kill.
- [x] Protect/doctor.
- [x] Roleblock (single-action suppression plus `ActionInterfered`).
- [x] Catastrophic roleblock / multi-action suppression policy. [mafiascum now models
  catastrophic suppression with explicit `AllMatchingActions` scope, while ordinary
  Roleblocker/Jailkeeper keep `FirstMatchingAction`; pack validation rejects missing scope, pure
  goldens prove ordinary one-of-two and catastrophic two-of-two suppression, and
  command/projection proof preserves the two `ActionInterfered` events and
  `action_suppressed` trace decisions across rebuild]
- [x] Redirect/retarget.
- [x] Two-target busdrive.
- [x] Multi-target swap/mass redirect/mirror. [mafiascum now models ordered multi-target
  redirection as `RedirectKind::Rotate` behind IR v25; `traffic_controller.mass_redirect`
  declares the pack-owned target ring and `source_ids: ["mirror"]`, pack validation rejects
  old-IR or under-targeted Rotate actions, pure goldens prove one Rotate action rewrites a kill,
  protect, and watch target, and command/projection proof preserves the three redirect edges and
  killed-slot projection across rebuild]
- [x] Lightning rod / mass target pull.
- [x] Investigate. [Parity investigations emit `InvestigationResult`; mafiascum Cop,
  Godfather/Miller/Framer result overrides, Weak Cop backlash, and Chinese Prophet
  good/evil labels are covered by goldens; v36 role-set investigations cover mafiascum and
  Mafia Universe Vanilla Cop, Neapolitan, and Gunsmith through pack-owned vanilla/gun-bearing
  role sets plus command/projection rebuild proof; v37 role disclosure covers mafiascum
  `role_cop`/`role_scan` with pure and command/projection rebuild proof; v37/v38 role and
  full-role disclosure covers Mafia Universe `role_scan`/`full_role_scan` plus town/mafia
  Role Cop and Full Cop variants with pure and command/projection rebuild proof; v39
  investigator-scoped `result_memory` covers Mafia Universe `parity_scan` plus town/mafia
  Parity Cop variants with first-scan raw parity, later `same`/`different` output, pure golden,
  and command/projection rebuild proof; Chinese Prophet also has command/projection rebuild proof]
- [x] Track.
- [x] Watch.
- [x] Motion detect.
- [x] Convert / recruit / cult. [direct and structured `AssignRole` conversion emit
  `PlayerConverted` with original role/alignment; structured `DecisionTrace` assignment details
  and command/projection path covered]
- [x] Deprogram / restore original role. [`RestoreOriginal` reads folded conversion-origin
  memory and restores role/alignment with structured `DecisionTrace` origin details]
- [x] Poison. [persistent poisoned mark plus delayed death on a later night]
- [x] Heal/cure poison. [cure_poison Clear preempts pending poison death]
- [x] Douse.
- [x] Ignite. [reads doused carried into the resolution]
- [x] Mark persistent effect.
- [x] Clear persistent effect.
- [x] Cleanse / same-night cleanse preemption. [Clear doused preempts same-resolution ignite]
- [x] Commute.
- [x] Untargetable / rolestop / shield-all. [mafiascum passive untargetable,
  self-commute, active `rolestop`, and group `shield` now all use pack-owned target-state
  gates; `rolestop`/`shield` are resolution-scoped `Mark` actions with linter coverage preventing
  persistent/no-target/wrong-ability forms, pure goldens prove skipped kills plus investigation
  interference, and command/projection proof shows submitted actions persist trace decisions while
  temporary `untargetable` effects do not leak into durable `slot_effect` state]
- [x] Jailkeep as block plus protect policy. [`standard_nar.jailkeep_action_ids` must also be
  declared in both block and protect buckets; pure golden trace proves one submitted `jail`
  suppresses the jailed slot's action and protects the jailed slot from an ordinary kill, and
  Postgres command/projection proof persists `ResolutionApplied`/`ResolutionTrace` through rebuild]
- [x] Guard/bodyguard intercept kill. [`standard_nar.bodyguard_action_ids` classifies the
  submitted protect action and `standard_nar.intercept_cause_policy.bodyguard` owns the generated
  intercept death cause; pure resolver regression mutates the cause and proves trace attribution
  follows pack data, pure resolver now rejects Bodyguard misclassified into the generic protect
  bucket, while command/projection proof preserves the bodyguard-intercepted PGO path]
- [x] Martyr/intercept variants beyond bodyguard. [`Modifier::Martyr` plus
  `standard_nar.martyr_action_ids` makes non-Bodyguard self-sacrificing protection table-driven,
  and `standard_nar.intercept_cause_policy.martyr_protect` owns its generated death cause; pure
  goldens prove ordinary `martyr_intercept`, generated Strongman bypass, and fail-closed rejection
  when `martyr_protect` is misclassified into the generic protect bucket, and a Postgres
  command/projection test proves submitted `martyr_protect` survives rebuild]
- [x] CPR and post-death consequences. [`Modifier::Cpr` plus
  `standard_nar.cpr_action_ids` models `cpr_protect` as a pack-owned Protect+Kill variant whose
  Kill is a deferred post-protection consequence rather than an ordinary Kill stage participant;
  `standard_nar.cpr_harm_cause_policy` owns the generated harm death cause and fails closed if
  a source is missing or the map is otherwise malformed at night resolution; pure goldens prove
  successful save, harmful unneeded CPR, a mutated pack-owned harm cause, fail-closed rejection
  when `cpr_protect` is misclassified into the generic
  protect bucket, and Strongman bypass without extra CPR harm, pack validation enforces the
  Protect+Kill+Cpr shape plus non-empty CPR harm cause, and a Postgres command/projection test
  proves submitted `cpr_protect` harm survives rebuild. Recursive trigger-on-CPR-death behavior
  remains outside this proof]
- [x] Vanillaize. [`vanillaiser` and `vanillizer` are pack-declared roles whose canonical
  `vanillaize` action is `Convert::AssignRole` to `vanilla_townie`; pure golden/trace coverage
  proves Cop -> Vanilla Townie mutation and a Postgres command/projection test proves the
  submitted mutation survives rebuild]
- [x] Restore mutation. [`Convert::RestoreOriginal` reads the first folded
  `ConversionOriginRecord`; pure deprogramming golden/trace coverage proves restoration, and the
  vanillaize command proof rebuilds after mutation, loads the folded origin, restores the Cop role,
  and rebuild-preserves both trace envelopes]
- [x] Grant item. [generated `ActionGranted` item fact plus private target notification;
  pack-declared single-use item action consumption emits durable `ActionGrantConsumed`
  plus typed `ActionUseCounted { counter_id: "inventory:<grant_id>" }` and decrements
  command/projection state; generated vest item marks persistent `bulletproof_vest` and later vest
  consumption rebuilds; selectable pack-owned item choices are modeled with v42 `grant_options`
  and command-side `SubmitAction.grant_id` selection]
- [x] Grant extra action / motivate. [generated `ActionGranted` extra-action fact plus private
  target notification; command-side extra-action legality plus durable `ActionGrantConsumed`
  remaining-use projection are covered]
- [x] Remove/grant ability contract boundary. [im-human's frozen `RoleSpec.@primitive_handlers`
  exposes no standalone `remove` primitive; ability/item grants map to fmarch `IrAbility::Grant`
  and durable `ActionGranted` / `ActionGrantConsumed`, effect removal maps to `Clear`, and
  role-ability removal remains the already-proven reversible role-mutation path via
  `Convert::AssignRole` / `Convert::RestoreOriginal`. The source-derived inventory script now
  parses only the primitive-handler map so schema fields such as `base_actions` and
  `role_modifiers` are not counted as unsupported primitives.]
- [x] Backup inheritance. [passive `backup:cop` and pack-policy targeted backup both
  emit ordinary `PlayerConverted` inheritance with structured `DecisionTrace` attribution;
  targeted choices fold through `BackupTargeted` and command/projection rebuild proof]
- [x] Targeted backup. [`universal_backup.target_backup` maps im-human `inherit_role`,
  emits foldable `BackupTargeted`, inherits the chosen source target when that source dies,
  and persists targeted inheritance trace attribution through command/projection]
- [x] Schedule/delay. [im-human `schedule` catalog rows are grant-style effects
  (`grant_item`, `motivate`) and map to `IrAbility::Grant` / `ActionGranted`; delayed death maps
  to source-aware `DelayedDeathQueued` / `DelayedDeathResolved`. Pack validation now rejects
  resolution-scoped `poisoned` marks because pending poison requires a persistent queued input;
  pure goldens cover grant scheduling, delayed poison application, and cure preemption, while the
  command proof rebuilds active and consumed `delayed_death_queue` rows.]
- [x] Phase skip. [im-human `phase_skip` / Beloved Princess maps to a prompt-driven
  phase-control contract: resolver emits `HostPromptIssued { kind: "skip_next_day" }`,
  pack validation requires a matching `host_prompt_resolution_effects` entry, and
  `ResolveHostPrompt` appends `HostPromptResolved` plus `PhaseAdvanced { reason:
  "skip_next_day", skipped_phase_id }` atomically. Command proofs cover successful skip to the next
  night, unsupported-cadence rejection without appended control events, phase lock behavior, and
  rebuild-stable prompt/phase projections.]
- [x] Visit-triggered effects. [PGO family proven: im-human `pgo` maps to fmarch
  `paranoid_gun_owner` carrying the `pgo` effect plus the `pgo_shoots_visitor` `Visit`
  trigger; pack validation rejects `pgo` effects without a `Visit` trigger that produces
  `Kill { actor: Target, target: Actor }`; pure goldens cover lethal PGO, protected PGO, and
  Bodyguard-intercepted PGO generated kills, while command/projection tests rebuild the lethal,
  protected, and bodyguard-intercepted paths. Standard-NAR validation now also requires
  `pgo_shoots_visitor` to be classified by `standard_nar.generated_kill_cause_policy` with
  matching trigger shape, and the pure night resolver fails closed before the trigger fixpoint if
  that table entry is missing, malformed, or names a non-trigger source. Selective im-human
  `visitor_kill` maps to
  `selective_visit_killer` carrying `visitor_kill`, a pack-declared
  `visitor_kill_marked_visitor` `Visit` trigger with `if_actor_has:
  ["visitor_kill_target"]`, and ordinary generated-kill classification. Pack validation rejects
  visitor-kill effects without the target-filtered trigger shape, pure goldens prove only marked
  visitors die, trace notes record the trigger event index, and the Postgres `ResolvePhase` proof
  rebuilds the projected marked-visitor death while preserving the ordinary visitor.]
- [x] Death-triggered effects. [im-human `bomb` maps to a role-carried `bomb` effect plus
  `bomb_retaliates` `Kill` trigger; im-human `vengeful` maps to role-carried
  `vengeful`/`unstoppable_vengeful` effects plus pack-declared `Kill` triggers; pack validation
  rejects Bomb/Vengeful effects without the required generated-kill trigger shape, and
  standard-NAR validation classifies mafiascum trigger-produced kill causes through
  `standard_nar.generated_kill_cause_policy`, including trigger `on`, actor, target, and the
  Strongman-style `unstoppable_vengeful_retaliates` bypass. Landed kills now also emit a distinct
  `Death` trigger observation; mafiascum `death_cursed_townie` carries `death_curse`, and the
  pack-declared `death_curse_retaliates` `Death` trigger has pure golden/trace coverage plus a
  Postgres `ResolvePhase` projection-rebuild proof. Hunter chosen
  retaliation reads folded `RetaliationArmed` state and mafiascum standard-NAR classifies the
  folded `hunter_retaliate` generated death through
  `standard_nar.chosen_retaliation_cause_policy`; the resolver fails closed before consuming the
  folded retaliation if that policy entry is missing or malformed. Chinese `death_retaliation` gates Hunter's
  chosen shot by death cause, allowing ordinary wolf kill and suppressing Witch poison. Mafiascum
  Babysitter uses `Protect` + `Modifier::Babysitter` to generate a ward death when the protector
  dies, and the resolver rejects `babysit` when it is moved out of the ordinary protect bucket;
  mafiascum Hider uses `Mark` + `Modifier::Hider` plus
  `standard_nar.hide_dependency_cause_policy` to generate a hider death when the host dies, with
  malformed hide dependency source/cause maps rejected before resolution;
  Chinese Cupid/lovers uses folded link state to generate lover suicide after night kills,
  Witch poison, and day lynches, with structured trace attribution for the generated lover death
  and standard-NAR stacking when lover suicide races a direct death. Pure goldens and
  command/projection rebuild proofs cover Bomb, Vengeful, Hunter, Babysitter, Hider, and
  lover-suicide paths.]
- [x] Lynch-triggered effects. [Chinese v15 `idiot_policy` saves the first
  eligible Idiot lynch with `PlayerSaved`, marks `idiot_vote_loss`, command-side vote
  submission rejects later vote-lost Idiot ballots with `Reject::VoteNotAllowed` before
  append, and later lynches land normally; Chinese Cupid/lovers now cascades from a lynched
  lover through shared
  `lover_policy` and has a command/projection rebuild proof; im-human `super_saint` maps to
  a role-carried `super_saint` effect plus `super_saint_retaliates` `Lynch` trigger, pack
  validation rejects Super-Saint effects without the required generated-kill trigger shape, and
  pure/command proofs show the latest active voter on the wagon dies through the generated-kill
  fixpoint; im-human `lynch_target_win` maps to fmarch's `TargetLynchWinTargeted` +
  `WinReached` policy path; mafiascum Executioner and Condemner now both win independently when
  their folded target relation is lynched, with pure goldens plus command/projection rebuild
  proofs]
- [x] Win-triggered effects. [im-human dynamic `win.executioner`, `win.condemner`, and
  `win.jester` result strings now map to canonical `WinReached`; Executioner/Condemner use
  `target_lynch_win_policies`, while Jester uses v25 `self_lynch_win_policies` so a lynched
  eligible role wins independently before ordinary faction `WinPolicy` fallback. Pack validation
  rejects unknown roles, unknown winner alignments, duplicate ids, missing Day cadence, and
  malformed source events; pure golden plus command/projection rebuild proof covers Jester
  self-lynch suppressing post-lynch mafia parity.]
- [x] Culture-specific effects: knight duel, white-wolf carry,
  wolf beauty drag, cupid link, lover suicide, idiot survival, guard/witch policy,
  and Chinese structured notes.
  [Cupid `link_lovers` emits foldable `PlayersLinked`, v16 `lover_policy`
  gates lover-suicide generated deaths from folded link state, Chinese Cupid maps im-human
  `note.cupid.link` to `PlayersLinked`, keeps non-draftable `lovers_helper` as policy
  metadata, and has setup/night-kill/lynch/Witch-poison/cascade-disabled/direct-death-race
  goldens plus command/projection rebuild proof for night, day, Witch-poison, and stacked
  direct-death cascades,
  and sheriff election/pass/destroy emits foldable `BadgeChanged` plus rebuildable
  `sheriff_badge` state; Knight duel emits
  typed `DuelResolved` plus foldable `PlayerKilled`; Chinese `guard_policy` declares
  Guard-blocked Witch poison and non-lethal Guard+Witch double-save, covered by goldens
  plus Postgres command/projection rebuild proof; Chinese `death_retaliation` declares
  Hunter poison suppression and ordinary-kill retaliation, covered by goldens plus
  Postgres command/projection rebuild proof, with poison suppression now carrying structured
  `chosen_retaliation_suppressed` trace attribution; Chinese v15 `idiot_policy` declares
  first-lynch survival and persistent vote loss, covered by goldens plus Postgres
  command/projection rebuild proof; Chinese v11/v12 White Wolf and Wolf Beauty notes map
  im-human `note.wolf.carry`, `note.wolf.self_destruct`, and `note.wolf_beauty.drag` to
  typed `WolfCarryUsed`, `WolfSelfDestructed`, and `WolfBeautyDragged`; `white_wolf_king`
  queues and consumes carry through self-destruct, passive `white_wolf_carry` is modeled as
  an eligible role whose folded `WolfCarryQueued` token is consumed by the command/projection
  seam, and `wolf_beauty` has mark, lynch drag, Witch-poison drag, and direct-death stacking
  goldens plus Postgres rebuild proof]
- [x] Port/catalog night action ids observed in V4 role drafts: `babysit`,
  `beauty_mark`, `block`, `bodyguard`, `bus_drive`, `commute`, `convert`,
  `cpr_protect`, `cure_poison`, `deprogram`, `douse`, `empower`, `extinguish`,
  `follow`, `friendly_neighbor`, `full_role_scan`, `grant_item`, `guard_retaliate`,
  `gunsmith`, `heal_potion`, `hide`, `ignite`, `inherit_role`, `inspect_corpse`,
  `investigate`, `investigate_alignment`, `investigate_killer`, `investigate_pt`,
  `investigate_specialist`, `investigate_vanilla`, `jail`, `janitor_kill`, `kill`,
  `link_lovers`, `mailman`, `mark_alignment`, `mark_role`, `motion_detector`,
  `motivate`, `neapolitan`, `neighborize`, `night_desperado`, `night_guard`,
  `night_kill`, `observe`, `parity_scan`, `poison`, `poison_potion`,
  `power_role_kill`, `protect`, `redirect`, `report`, `result_mod`, `role_guard`,
  `role_scan`, `role_watcher`, `rolestop`, `security_guard`, `send_fruit`,
  `shield`, `strongman_kill`, `track`, `traffic_analyst`, `vanillaize`, `visit`,
  `voyeur`, and `watch`. [proven: the generated im-human parity matrix now has no
  unsupported `action_id` rows for this catalog; each row is modeled in pack, implemented in
  resolver, covered by golden, and integrated through command/projection. Chinese
  `investigate_alignment` is modeled as
  `Investigate` + `Parity` on Prophet with pack-owned good/evil result labels; Chinese source
  `night_kill` rows are now parity-mapped to canonical `wolf_night_kill` through pack
  `source_ids` for both `wolf` and `white_wolf_king`, with pure and Postgres White Wolf King
  night-kill proof; Mafia Universe `send_fruit` and Mafiascum Fruit Vendor `send_fruit` are modeled
  as resolution-scoped target-visible `Mark` actions that emit private `EffectNotification`
  without persistent `EffectsMarked` state;
  Mafiascum `role_watcher`, `role_guard`, and `security_guard` are modeled as v55
  action-investigation modes over the resolved visible visit graph: Role Watcher receives
  actor-private unique visitor roles, Role Guard sends unique visitor roles to the watched
  target, and Security Guard sends visible visitor identities to the watched target, with
  Ninja-hidden visits excluded by pure golden and Postgres projection/rebuild proof;
  Mafia Universe `night_desperado` is modeled as a non-factional standard-NAR `Kill` for
  `town_night_desperado` and `mafia_night_desperado`, with pack-owned
  `alignment_failback` self-death on same-alignment targets, standard-NAR protection,
  suppression, kill-cause cataloging, pure success/failback golden coverage, and a Postgres
  trace/projection/rebuild vertical; Mafia Universe `power_role_kill` is modeled as an ordinary
  standard-NAR `Kill` for `town_power_role_killer` and `mafia_power_role_killer`, constrained by
  pack-owned `target_role_filter: PowerRole` against the vanilla role set, with pure
  kill/reject goldens and a Postgres submit/resolve/rebuild vertical; Mafia Universe
  `town_vigilante` and `mafia_vigilante` map their shared source `kill` action to canonical
  `vigilante_kill` as ordinary non-factional standard-NAR night kills, with role-scoped
  inventory aliases, pure alignment-variant golden coverage, and a Postgres kill/rebuild
  vertical; Mafia Universe `town_ninja` and `mafia_ninja` map their shared source `kill`
  action to canonical `ninja_kill` as ordinary non-factional standard-NAR night kills hidden
  from graph-derived visit results by `Modifier::Ninja`, with pure Watch/Motion golden
  coverage and a Postgres private-result/rebuild vertical; Mafia Universe `mark_alignment`
  is modeled for `town_alignment_oracle` and `mafia_alignment_oracle` as a hidden persistent
  `alignment_oracle_mark`; v57 `effect_source_death_reveals` emits canonical
  `AlignmentRevealed` for the marked target when the Oracle source dies, with pure
  mark/source-death goldens and a Postgres N01 mark -> rebuild -> N02 source-death public
  reveal/thread/rebuild vertical; Mafia Universe `mark_role` is modeled for
  `town_role_oracle` and `mafia_role_oracle` as a hidden persistent `role_oracle_mark`;
  v58 `effect_source_death_reveals.Role` emits canonical `RoleRevealed` for the marked
  target when the Oracle source dies, with pure town/mafia mark plus source-death goldens and a
  Postgres N01 mark -> rebuild -> N02 source-death public role-reveal/thread/rebuild vertical;
  Mafia Universe `janitor_kill` is modeled for `town_janitor` and `mafia_janitor` as an
  ordinary non-factional standard-NAR night kill cause with pack-owned
  `death_reveal.by_cause = Concealed`, pure town/mafia concealed-death golden coverage, shipped
  pack validation, and a Postgres kill/concealed-slot-state/rebuild vertical;
  Mafia Universe `inherit_role` maps to canonical `target_backup` for
  `town_universal_backup` and `mafia_universal_backup`, emits foldable `BackupTargeted`
  source choices through the pack `backup_policy`, inherits selected source roles as
  `PlayerConverted` when those sources die, and has pure designation/inheritance goldens plus a
  Postgres N01 source-choice -> rebuild -> N02 source-death inheritance trace/rebuild vertical;
  Mafia Universe `town_day_vigilante`
  and `mafia_day_vigilante` map their shared source `kill` action to canonical
  `day_vigilante_kill` as ordinary day kills that resolve before official vote outcome, with
  pure alignment-variant golden coverage and a Postgres D01 kill/thread/rebuild vertical;
  Mafia Universe `town_day_desperado` and `mafia_day_desperado` map source `day_desperado`
  to canonical `day_desperado` as pre-vote Day kills with declarative `alignment_failback`
  self-death on non-hostile targets, strict v41 pack validation, pure success/failback golden
  coverage, and a Postgres D01 trace/thread/rebuild vertical; Mafiascum `bus_drive` now maps
  through pack `source_ids` to canonical `bus_driver_swap` as a Night `Redirect`/`Swap` action,
  with `golden_busdriver_redirect` and `trace_records_redirect_edge_for_busdriver` covering pure
  resolver output and trace edges, plus `host_resolve_phase_persists_redirect_trace_edge` proving
  Postgres command/projection fold and rebuild; Mafiascum `follow` now maps through pack
  `source_ids` to canonical `track` as a Night `Investigate`/`Track` action, with
  `golden_tracker_tracks_visit` covering pure resolver output and
  `host_resolve_phase_projects_tracker_private_visit_result` proving private result projection,
  non-leakage, resolution audit, and rebuild; Mafiascum `guard_retaliate` now maps through pack
  `source_ids` to canonical `bodyguard` as a Night `Protect` action with `Bodyguard`
  interception, with `golden_bodyguard_intercept` covering pure resolver output and
  `host_resolve_phase_bodyguard_intercepts_generated_pgo_trigger_kill` proving intercept death,
  trace attribution, projection fold, and rebuild; Mafiascum `inspect_corpse` is modeled on
  `coroner` as a dead-target Night `Investigate`/`FullRole` action, with
  `golden_coroner_inspects_corpse` proving corpse role/alignment output and
  `host_resolve_phase_carries_mafiascum_coroner_corpse_inspection` proving live-target rejection,
  private result projection, resolution audit, and rebuild; Mafiascum `investigate_killer` is
  modeled on `psychologist` as the v50 `Investigate`/`Killer` role-set mode backed by
  pack-owned `killer_roles`, with `golden_psychologist_detects_killer` proving positive and
  negative resolver output and `host_resolve_phase_carries_mafiascum_psychologist_killer_info`
  proving private result projection, non-leakage, resolution audit, and rebuild; Mafiascum
  `investigate_pt` is modeled on `pt_cop` as the v52 `Investigate`/`PtAccess` mode that reads
  folded `PrivateChannelDeclared` membership from `StateSnapshot.private_channels`, with
  `golden_pt_cop_reads_private_topic_access` proving positive and negative resolver output,
  `pt_access_investigation_result_payload_passes_contract_validation` proving the list-shaped
  result-schema contract, and `host_resolve_phase_carries_mafiascum_pt_cop_access` proving
  `StartGame` private-channel declaration, private result projection, non-leakage, resolution
  audit, and rebuild; Mafiascum
  `investigate_specialist` is modeled on `specialist` as the v51 `Investigate`/`Specialist`
  role-set mode backed by pack-owned `specialist_roles`, with
  `golden_specialist_detects_specialist` proving positive and negative resolver output,
  `specialist_investigation_result_payload_passes_contract_validation` proving the result-schema
  contract, and `host_resolve_phase_carries_mafiascum_specialist_info` proving private result
  projection, non-leakage, resolution audit, and rebuild; Mafiascum
  `traffic_analyst` now maps through pack `source_ids` to canonical `prior_motion` as a Night
  `Investigate`/`PriorMotion` action, with `golden_prior_motion_reads_visit_history` proving the
  folded-visit read and `host_resolve_phase_records_visit_history_for_prior_motion` proving
  visit-history projection, private result projection, resolution audit, and rebuild; Mafiascum
  `convert` now maps through pack `source_ids` to canonical `cult_recruit` as a Night
  `Convert`/`AssignRole` action, with `golden_cult_recruit_converts_to_cultist` proving cult
  assignment and `host_resolve_phase_deprograms_from_conversion_origin` proving conversion-origin
  fold, deprogramming, resolution trace validation, projection rebuild, and persisted trace
  stability; Mafiascum `result_mod` now maps through role-scoped pack `source_ids` to canonical
  Framer `frame` and Lawyer `lawyer_cover` as Night `Mark` actions whose hidden `framed` and
  `lawyered` tags drive pack-owned `investigation_overrides`, with `golden_framer_parity_override`
  and `golden_lawyer_parity_override` covering same-night Parity result flips plus
  `host_resolve_phase_applies_lawyer_result_mod_override` proving command submission,
  result-schema validation, resolution audit, and rebuild; Mafiascum `mailman`, `observe`, and
  `report` now map to canonical v54 `Info` actions that emit typed private `InfoResult` rows, with
  `golden_info_actions_private_results` covering actor/target audience routing,
  `info_result_payload_passes_contract_validation` covering the result-schema contract, and
  `host_resolve_phase_projects_mafiascum_info_results` proving command submission,
  `player_info_result` projection, public-thread non-leakage, resolution audit, and rebuild]

### E. Modifiers and constraints

- [x] Strongman / pierce.
- [x] Ninja / stealthy. [mafiascum `ninja` maps im-human `stealthy` to `Modifier::Ninja`;
  pure goldens show Ninja kills are hidden from Watch/Motion visit-derived results, pack
  validation plus the pure night resolver now fail closed if Ninja visibility policy is missing,
  and command/projection proof resolves a Ninja kill plus Watch/Motion submissions with rebuild-stable
  hidden-visit results. Mafia Universe now also declares `town_ninja` and `mafia_ninja` with
  canonical `ninja_kill`, standard-NAR protection/block participation, pure town/mafia
  Watch/Motion hidden-visit coverage, and a Postgres private-result/rebuild vertical.]
- [x] Godfather / result override.
- [x] Miller/framer-style result tampering.
- [x] Loyal / conversion immunity. [epicmafia loyal conversion block golden plus
  structured `DecisionTrace` block reason; Postgres command/projection vertical helper-enforces
  actor/template/mode/reason trace detail, proves no conversion projection mutation, and
  rebuild-preserves the trace envelope]
- [x] Disloyal. [mafiascum `disloyal_cult_recruit` declares `Modifier::Disloyal`;
  pure golden `disloyal_cult_recruit_cross_alignment` proves same-alignment targets emit
  `ActionInterfered { reason: "disloyal" }` while cross-alignment targets convert normally, trace
  coverage proves the generic action-constraint suppression detail, pack validation gates the
  modifier at IR 57 and rejects no-target disloyal actions, and Postgres test
  `host_resolve_phase_persists_disloyal_modifier_trace_and_projection` proves command-submitted
  actions, persisted `ResolutionApplied`/`ResolutionTrace`, envelope audit, and rebuild-stable
  slot projections.]
- [x] Macho. [mafiascum role-effect tag blocks ordinary protection; covered by golden plus
  `host_resolve_phase_macho_target_ignores_doctor_protection`, which proves `Command::ResolvePhase`
  kills a Doctor-protected Macho target and rebuild preserves slot state]
- [x] Strong-willed. [mafiascum `strong_willed_cop` declares `Modifier::StrongWilled`;
  standard-NAR suppression validation requires the action to bypass roleblocks, pure golden plus
  trace test prove the investigation resolves through an ordinary roleblock, and
  `host_resolve_phase_strong_willed_bypasses_roleblock` proves command submission, persisted
  `ResolutionApplied`/`ResolutionTrace`, envelope audit, and rebuild.]
- [x] Roleblockable/non-roleblockable. [mafiascum `standard_nar.suppression_policy`
  classifies every night-capable role/item action for Roleblocker and Jailkeeper block
  sources; validator rejects missing/typo/misclassified rows; goldens prove a roleblockable
  Cop is suppressed while non-roleblockable `roleblocker_block` survives a block. Mafiascum
  source aliases now map `roleblocker`, `hooker`, `jailer`, and `mafia_roleblocker` source
  `block` to canonical `roleblocker_block`, with pure golden plus Postgres
  command/projection/rebuild proof that all three alias roles suppress roleblockable actions.]
- [x] Reflexive / self-targetable. [`Reflexive` is now the canonical pack modifier for
  targeted self-allowed actions; pack validation rejects mismatches between `Reflexive` and
  `constraints.self_allowed`, the pure resolver enforces target count, duplicate-target, and
  non-reflexive self-target constraints with `ActionInterfered`, and command validation proves
  the reflexive commuter self-target appends while non-reflexive self-targets reject before append.]
- [x] X-shot. [v1 supports positive pack-declared x-shot counts through the typed
  `ActionUseCounted` counter surface. Mafiascum now models `jack_of_all_trades` as one-shot
  parity investigate/protect/block/track choices; pure golden and Postgres
  command/projection/rebuild proof show JOAT block consumes `x_shot:roleblocker_block` and
  suppresses a factional kill. Mafiascum `two_shot_vigilante` proves multi-shot count semantics:
  pure goldens cover second-charge consumption (`used = 2`, `remaining = 0`) and exhausted third
  attempts, while `host_resolve_phase_carries_mafiascum_two_shot_counter` proves
  `ResolvePhase` persistence, projection rebuild, and reject-before-append after exhaustion. The abstract
  `core:jack_of_all_trades` inventory row is represented by concrete culture-pack JOAT roles.]
- [x] X-voter. [mafiascum `x_voter` is modeled as a pack-declared 2.0
  `WeightPolicy::PerRole` role, matching im-human legacy voting behavior; pure golden and
  command/projection `ResolvePhase` test prove the weighted `DayVoteOutcome` and rebuild-stable
  projections. Explicit `ActionGranted`-style vote-power grants are covered separately by
  `test_dynamic_vote_effect`'s `VoteWeight` grant proof.]
- [x] Doublevoter / triplevoter. [mafiascum `doublevoter` contributes 2.0 and
  `triplevoter` contributes 3.0 through pack-declared `WeightPolicy::PerRole`; pure goldens and
  command/projection `ResolvePhase` tests prove both weights affect official `DayVoteOutcome` and
  rebuild-stable projections.]
- [x] Loved / hated. [target role threshold adjustments are pack-declared and covered by
  goldens plus `Command::ResolvePhase`]
- [x] Voteless. [mafiascum `voteless` ballot remains recordable but contributes 0.0]
- [x] Activated / novice. [`constraints.active_from` models Novice/Activated phase-kind/number
  thresholds; resolver emits `ActionInterfered.reason = "novice_inactive" |
  "activated_inactive"` before the threshold and resolves normally afterward; command validation
  rejects pre-threshold submissions before append; covered by `novice_*` / `activated_*` goldens
  and `action_submission_rejects_inactive_novice_and_activated_actions`]
- [x] Odd/even night. [`constraints.phase_parity` models Odd/Even night gates; mafiascum
  `odd_night_cop`/`even_night_cop` preserve source modifiers, pure goldens prove wrong-night
  `ActionInterfered.reason = "odd_night"` and allowed even-night resolution, and
  command/projection proof rejects wrong-night submissions before append while resolving and
  rebuilding the allowed even-night action.]
- [x] Odd/even cycle. [`constraints.cycle_parity` models Odd/Even game-cycle gates separately
  from night-only `phase_parity`; mafiascum `odd_cycle_cop`/`even_cycle_cop` preserve source
  aliases, validation rejects ambiguous `phase_parity` + `cycle_parity` combinations, pure
  goldens prove wrong-cycle `ActionInterfered.reason = "odd_cycle"` and allowed even-cycle
  resolution, and command/projection proof rejects wrong-cycle submissions before append while
  resolving and rebuilding the allowed even-cycle action.]
- [x] Night-specific/day-specific. [`ActionTemplate.window` is the canonical phase-kind gate for
  im-human `night_specific`/day-specific action policy; command validation rejects wrong-window
  actions before append, and pure resolver goldens prove valid templates injected into the wrong
  phase emit `ActionInterfered.reason = "night_specific" | "day_specific"` without resolving.]
- [x] Non-consecutive. [`NonConsecutive` blocks same-target consecutive-night repeats and allows
  different targets; pure goldens prove both branches, command validation rejects the repeated
  target before append from rebuilt `action_history`, and
  `action_submission_rejects_cadence_and_exhausted_constraints` now resolves the allowed N02
  different-target action, audits envelopes, and rebuilds `action_history`.]
- [x] Cycle-X and X-cycle cooldown. [`constraints.cooldown_cycles` models same-phase-kind
  cooldown windows, the resolver emits `ActionUseCounted { counter_id:
  "cooldown:<template_id>", cadence_policy: "cooldown", phase_scope: "phase_kind" }`, command
  validation rejects still-cooling actions from rebuilt `action_counter` projection state, and
  `cooldown_cop_*` plus `long_cooldown_cop_*` goldens prove one-cycle and two-cycle use,
  suppression, and expiry; `action_submission_rejects_cadence_and_exhausted_constraints` keeps
  one-cycle command/rebuild coverage green, while
  `action_submission_respects_multi_cycle_cooldown_expiry` proves N01 two-cycle use, N02/N03
  reject-before-append, N04 acceptance, refreshed counter projection, and rebuild]
- [x] Compulsive. [missing required night action emits interference plus action-history audit
  record; pure golden plus `host_resolve_phase_records_missing_compulsive_action` prove persisted
  `ResolutionApplied`, envelope audit, `action_history` projection, and rebuild]
- [x] Lazy. [`Modifier::Lazy` plus `constraints.lazy_requires_multiple_non_town` models
  im-human's multiple-non-town endgame restriction; pack validation rejects mismatches, mafiascum
  `lazy_cop` declares the constraint, pure goldens prove blocked one-non-town and allowed
  multiple-non-town branches, and command validation rejects one-non-town submissions before
  append.]
- [x] Indecisive. [`Modifier::Indecisive` preserves im-human's targeting-limiter vocabulary
  while reusing the consecutive-target action-history gate; mafiascum `indecisive_cop` declares
  the modifier, pure goldens prove same-target suppression with `ActionInterfered.reason =
  "indecisive"` and different-target resolution, command validation rejects repeated targets
  before append, and the inventory mapping now records the canonical Rust name.]
- [x] Uncooperative. [`Modifier::Uncooperative` plus pack-declared
  `constraints.uncooperative_result` models setup-defined ambiguous/weakened feedback; validation
  rejects missing, mismatched, non-Investigate, or empty feedback labels; mafiascum
  `uncooperative_cop` emits `InvestigationResult.result = "ambiguous"` while still resolving, and
  command/projection proof verifies that result through persisted `ResolutionApplied`.]
- [x] Roaming. [`Modifier::Roaming` models the mafiascum source rule "cannot target the same
  player twice" as an all-prior-target action-history gate; mafiascum `roaming_cop` declares the
  modifier, pure goldens prove an N03 repeat of an N01 target is suppressed while a new target
  resolves, and command validation rejects the N03 repeat before append after projection rebuild.]
- [x] Personal. [`Modifier::Personal` plus `constraints.personal_only` now model
  self-only action targeting; pack validation rejects mismatches between the modifier, the
  constraint, self-target allowance, and one-target shape; mafiascum Commuter declares Personal;
  pure golden `personal_commute_rejects_other_target` proves non-self personal targeting emits
  `ActionInterfered.reason = "personal"` while `commuter_avoids_targeting` preserves valid
  self-commute behavior; command validation rejects non-self Commuter targets before append.]
- [x] Announcing/loud. [mafiascum `Loud`/`Announcing` modifiers emit public
  `EffectNotification` events; pure golden plus
  `host_resolve_phase_projects_loud_and_announcing_notifications` prove persisted
  `ResolutionApplied`, per-slot `player_notification` projection, envelope audit, and rebuild.]
- [x] Weak. [Parity scum backlash covered by pure golden plus
  `host_resolve_phase_weak_cop_dies_on_scum_result`, which proves scum result, Weak Cop
  self-death, phase announcement, envelope audit, slot-state projection, and rebuild; other weak
  reads pending]
- [x] Blocked. [im-human `blocked` maps to standard-NAR `Roleblockable` suppression;
  mafiascum validation classifies every night action as suppressed or bypassed for each block
  source, pure goldens prove roleblockable Cop suppression and non-roleblockable Roleblocker
  bypass, and `host_resolve_phase_non_roleblockable_block_survives_roleblock` proves command
  submission, persisted suppression trace, envelope audit, and rebuild.]
- [x] Disabled endgame. [`Modifier::DisabledEndgame` plus
  `constraints.disabled_at_or_below_alive` models the configurable player-count threshold
  separately from Lazy's non-town rule; validation rejects missing, mismatched, or zero thresholds;
  mafiascum `disabled_endgame_cop` blocks at three living players and resolves above that
  threshold in pure goldens, and command validation rejects threshold use before append.]
- [x] Lost. [`RoleModifier::Lost` models the stored mafia modifier separately from action
  modifiers; mafiascum declares `lost_mafia_goon` plus `standard_nar.team_kill_action_ids =
  ["factional_kill"]`; validation requires Lost roles to be mafia-aligned and to expose a
  declared team-kill action; the pure resolver now also rejects in-memory standard-NAR
  team-kill bucket drift before resolution; pure goldens prove blocked-with-teammate and
  allowed-when-solo resolution, and command validation rejects Lost factional kill before append
  when another mafia is alive.]
- [x] Recluse. [`RoleModifier::Recluse` shares the stored role-modifier/team-kill seam
  with Lost; mafiascum declares `recluse_mafia_goon` and
  `standard_nar.team_kill_action_ids = ["factional_kill"]`; validation requires
  team-kill restricted role modifiers to be mafia-aligned and expose a declared team-kill action;
  the pure resolver now also rejects in-memory standard-NAR team-kill bucket drift before
  resolution; pure goldens prove non-Recluse teammates block while all-Recluse living mafia teams
  may submit, and command validation rejects Recluse factional kill before append when a
  non-Recluse mafia teammate is alive.]
- [x] Simultaneous. [`Modifier::Simultaneous` models im-human's
  `allows_multiple_submissions` action metadata at the base role-action submission seam:
  non-granted duplicate same-template submissions now emit `ActionInterfered.reason =
  "duplicate_submission"` unless the template carries Simultaneous. Pack validation rejects
  Simultaneous on `standard_nar.team_kill_action_ids`; mafiascum `simultaneous_vigilante`
  proves duplicate same-template personal night kills in pure goldens and through command
  submission, resolution, projection, and rebuild.]
- [x] Backup. [`backup_policy` maps im-human passive `backup:<role>` effects and targeted
  `backup_target` source selection into canonical Rust `BackupTargeted` and
  `PlayerConverted` inner events. Mafiascum declares `backup_cop`,
  `universal_backup`, `inherit_role`, and `backup_target`; validation requires
  IR v17 plus declared passive/targeted effects and role refs. Mafia Universe now declares
  `town_universal_backup`, `mafia_universal_backup`, `inherit_role`, and `backup_target` through
  the same targeted backup policy. Pure goldens prove passive inheritance, targeted designation,
  targeted inheritance, and MU town/mafia designation/inheritance variants; command tests prove
  `ResolvePhase` appends/folds Backup through Postgres projections and rebuilds slot state
  identically.]
- [x] Vengeful. [im-human's action modifier metadata maps to fmarch's
  pack-declared `TriggerOn::Kill+vengeful_retaliates` trigger table. Mafiascum
  now uses the canonical `vengeful` role id with the `vengeful` effect;
  `kill_retaliation_trigger_contracts_are_strict` rejects Vengeful effects
  without a `Kill` trigger from target to actor, and the generated matrix marks
  the modifier, primitive, and `mafiascum:vengeful` role rows green. Pure
  goldens prove ordinary retaliation and Doctor-protected retaliation; Postgres
  command tests prove `ResolvePhase` appends/folds the generated trigger,
  persists trace rows, protects ordinary generated kills, enforces the trigger
  loop cap, and rebuilds projections identically.]
- [x] Lover. [Cupid link and lover-suicide generated death are covered by setup,
  night-kill, day-lynch, Witch-poison, and disabled-policy goldens plus command/projection
  rebuild proof for night and day cascades; generated lover deaths emit structured
  `DecisionTrace` attribution keyed by folded link id]
- [x] Mason/neighbor private-channel metadata. [`private_channels` is a v29
  pack policy that maps im-human `mason`/`neighbor` action metadata to durable
  setup channel declarations instead of resolver output. Mafiascum declares
  canonical `mason`, `neighbor`, `friendly_neighbor`, and `neighborizer` roles;
  `StartGame` emits deterministic `PrivateChannelDeclared` events for matching
  groups with at least two members, and projections fold them into
  `private_channel_member` without leaking into public `thread_view`.
  Validation rejects missing roles, duplicate groups/roles, wrong
  mason/neighbor alignment reveal contracts, and packs below IR v29; a Postgres
  command test proves append, projection, public non-leakage, and rebuild
  determinism.]
- [x] Treestump. [`treestump_policy` is a v30 Mafia Universe pack policy that maps
  im-human `treestump` death metadata to canonical `SlotStatusTagged` inner events.
  `mafia_universe` declares `town_treestump` and `mafia_treestump`; validation rejects
  missing/duplicate eligible roles, empty status tags, and packs below IR v30. Pure
  goldens `treestump_status_on_lynch` and `mafia_treestump_status_on_lynch` prove
  dead town- and mafia-aligned Treestumps receive the durable `treestump` status tag
  before `PhaseAnnouncement`; command/projection proof covers ResolvePhase append,
  projection rebuild, dead Treestump posting after unlock, and continued dead-slot
  vote/action rejection.]
- [x] Bulletproof and bulletproof vest.
- [x] Janitor / flipless / alignment-only flip. [Mafiascum `death_reveal` policy models
  `janitor_kill` cause concealment, `flipless` target-effect concealment, and
  `alignment_only_flip` target-effect alignment-only reveal; pure golden
  `golden_death_reveal_policy` proves all three non-default policy paths, while
  `host_resolve_phase_conceals_janitor_and_flipless_death_reveals` and
  `host_resolve_phase_projects_alignment_only_death_reveal` prove command resolution, replay audit,
  and rebuildable `slot_state.role_revealed` / `slot_state.alignment_revealed` projection]
- [x] Better/worse ITA chance, percent ITA vulnerability, ITA shields.
  [`ita.modifier_components` plus `ita.role_modifier_refs` are a v32 Mafia Universe
  pack policy for named shooter `hit_bonus` / `hit_penalty`, target `target_evade`,
  and one-shot `shields` components.
  `ItaShotOutcome::Blocked` records shielded would-be hits without killing, and
  `ItaCounters` carries `shots_blocked`, `shields_remaining`, and `shields_spent`.
  Pack validation rejects packs below IR v32, unknown component refs, duplicate refs,
  empty components/effective modifiers, and out-of-range probability modifiers. Pure
  golden `ita_chance_and_shields`
  proves better chance, worse chance, target evade, and shield blocking in one
  deterministic D01 session; Postgres command/projection proof covers ResolvePhase,
  trace inspection, action-counter projection, audit, and rebuild. Buffering/refunds
  and HP/hybrid ITA protection remain future ITA slices.]
- [x] Combined/complex modifiers through composition, not bespoke branches.
  [Mafia Universe v32 declares named ITA modifier components and per-role refs,
  while resolver code folds them through `effective_role_override` before hit chance
  and shield evaluation. Pure golden `ita_chance_and_shields` includes
  `mafia_ita_evasive_shielded`, composing percent ITA vulnerability with one ITA
  shield; the Postgres proof `host_resolve_phase_carries_ita_chance_overrides_and_shields`
  confirms the composed target resolves as a would-be hit at 0.5 chance, spends its
  shield, emits trace detail, updates counters, audits, and rebuilds. This proves the
  ITA modifier-family composition seam only; broader cross-family modifier algebra
  remains future work.]

### F. Targeting, graph, and conflict resolution

- [x] Deterministic initial target map.
- [x] Redirect graph construction.
- [x] Redirect fixpoint with loop cap and diagnostics. [proven for mafiascum Bus Driver,
  Lightning Rod, ordered Rotate, and two-rule Retarget cycle goldens; redirect rewrites emit
  `ResolutionTrace.edges`, redirect graph truncation emits `ResolutionTrace.notes`, and a
  command/projection rebuild test helper-enforces the Bus Driver redirect edge detail while
  preserving the persisted trace envelope]
- [x] Stable handling of redirect cycles and strongly connected components.
- [x] V1 night ability stage ordering from pack precedence/priority, not hardcoded Rust match arms.
- [x] Conflict rules for block vs action, protect vs kill, strongman vs protect,
  commute vs same-night kill, cleanse vs poison, conversion vs pending death,
  kill stacking, guard/witch/babysitter interactions, and multi-kill attribution.
  [proven: block vs action, block vs protect, protect vs kill, strongman vs
  protect, bodyguard intercept, babysitter dependency death, commute vs kill/investigate, untargetable vs
  kill/investigate, bulletproof saves, vest consumption, and Strongman vs
  bulletproof have mafiascum goldens; roleblock suppression, protect saves, and strongman
  protection bypass now emit structured `DecisionTrace` details; `standard_nar` now makes the
  mafiascum Block/Protect/ordinary Kill/Bodyguard/Martyr/CPR/Jailkeeper/Strongman action catalog linter-backed,
  blank/empty-bucket fail-closed, and table-driven for submitted ordinary Kill/Bodyguard/Martyr/CPR/Strongman classification, and
  `standard_nar.kill_cause_ids` catalogs submitted/chosen/generated standard-NAR kill causes and
  now fails closed in the pure resolver when the catalog is missing, empty, duplicate, unknown, or
  omits a derived kill cause,
  and `standard_nar.protection_cause_policy` classifies which
  Doctor/Babysitter/Bodyguard/Martyr/CPR/Jailkeeper sources block or are bypassed by every
  cataloged standard-NAR kill-like cause and now fails closed when the in-memory protection map is
  missing a source or otherwise malformed;
  `standard_nar.suppression_policy`
  classifies which Roleblocker/Jailkeeper block sources suppress or bypass every night-capable
  role/item action and now carries explicit scope so ordinary block sources suppress only the
  first matching submitted action while catastrophic block sources suppress all matching actions,
  and now fails closed when the in-memory suppression map is missing a source or otherwise
  malformed;
  `standard_nar.target_state_save_tags` catalogs save tags, `standard_nar.target_state_save_policy`
  classifies which cataloged standard-NAR kill-like causes are blocked or bypassed by
  `bulletproof` and `bulletproof_vest`, and resolver proof shows the catalog/table controls
  Strongman-vs-bulletproof and fails closed when either is missing, a save-policy source is
  omitted, or the save-policy map is malformed at night resolution;
  `standard_nar.target_state_gate_tags` catalogs gate tags,
  `standard_nar.target_state_gate_policy` classifies whether `commuted`/`untargetable` block
  Kill, Investigate, or both, and resolver proof shows the catalog/table controls
  commute-vs-kill/investigate and fails closed when either is missing, a gate-policy source is
  omitted, or the gate-policy map is malformed at night resolution;
  `standard_nar.kill_stacking:
  AggregateAttackers` now merges simultaneous landed ordinary/Strongman kills into one
  `PlayerKilled`, ORs `unstoppable`, preserves both attackers, traces
  `kill_stacked_on_existing_death`, and carries exact night death causes through
  `PhaseAnnouncement`; bodyguard-intercept generated kills that race an existing direct
  bodyguard death now merge into that same `PlayerKilled` with trace attribution; the resolver now
  fails closed before night resolution when an in-memory standard-NAR pack omits `kill_stacking`,
  while `standard_nar.intercept_cause_policy` owns the Bodyguard/Martyr generated death cause
  names and fails closed if a source is missing or the map is otherwise malformed at night
  resolution;
  `standard_nar.cpr_harm_cause_policy` owns deferred CPR harm death cause names, fails closed if
  a source is missing or the map is otherwise malformed at night resolution, and preserves save
  provenance so only unneeded CPR emits `PlayerKilled`;
  Hider
  dependency deaths that race an existing direct hider death now merge into that same
  `PlayerKilled`, preserve the host as attacker, OR `unstoppable`, and trace both
  `hider_dependency_death` and `kill_stacked_on_existing_death`; Babysitter dependency deaths
  that race an existing direct ward death now merge into that same `PlayerKilled`, preserve the
  Babysitter as attacker, OR `unstoppable`, and trace both `babysitter_dependency_death` and
  `kill_stacked_on_existing_death`; `standard_nar.guard_dependency_cause_policy` owns Babysitter
  generated ward-death cause names and fails closed if a source is missing or the map is
  otherwise malformed at night resolution; Babysitter and Hider dependency deaths now emit
  structured `DecisionTrace` attribution, and
  `standard_nar.hide_dependency_cause_policy` owns Hider generated hider-death cause names and
  fails closed if a source is missing or the map is otherwise malformed at night resolution;
  multiple protected ordinary kill attempts on the same target now
  preserve one `PlayerSaved` and one `kill_prevented_by_protection` trace decision per blocked
  attacker, never synthesize `PlayerKilled`, and rebuild-preserve the persisted
  `ResolutionApplied`/`ResolutionTrace` envelopes; commute skipped kills and untargetable investigation
  interference and active rolestop/shield target-state gates also emit helper-enforced structured
  `DecisionTrace` details; both trace lanes have domain tests and command/projection rebuild proof;
  `conversion_policy.on_dead_target = Block` and
  `conversion_policy.on_pending_death = Block` now own same-resolution dead-target conversion
  blocks and active pending-death conversion blocks, emit `ConversionBlocked` with
  helper-enforced `dead_target`/`pending_death` actor/template/mode/reason trace detail, fail closed
  when missing from Convert packs, and have pure golden plus command/projection rebuild proof;
  delayed poison applied, cure-poison preemption, and cleanse-before-ignite read-effect preemption
  now emit structured `DecisionTrace` details with domain and command/projection rebuild proof;
  pending poison whose target is already dead now resolves the queue as `target_already_dead`,
  emits a structured `pending_poison_target_already_dead` trace decision, and has pure golden plus
  command/projection rebuild-preserved trace proof;
  Guard-blocked Witch poison now helper-enforces the persisted `kill_prevented_by_protection`
  trace detail through both the pure Chinese structured golden and the command/projection seam,
  proving the Guard action is the only credited protector while the same-target Witch heal is
  excluded from poison protection credit;
  shipped Chinese structured `guard_policy.same_target_witch = NoDeath` now helper-enforces the
  persisted double-save `kill_prevented_by_protection` trace detail through both the pure golden
  and command/projection seam, proving both the Guard and Witch heal are credited as protectors
  and that projection rebuild preserves the trace envelope;
  shipped Chinese structured `guard_policy` now explicitly declares `guard_self_allowed=true`
  and `guard_night_one_allowed=true`; pure goldens prove the shipped self-save-on-N01 path and
  disabled override variants for self-save and night-one Guard, while a Postgres
  command/projection rebuild proof shows N01 Guard self-save is accepted before append and
  preserved through replay;
  Chinese Hunter `death_retaliation` now explicitly declares
  `timing: ImmediateBeforePhaseAnnouncement`; allowed wolf-kill retaliation emits the chosen
  target kill before the trailing `PhaseAnnouncement` and emits no host prompt, while poison
  suppression emits a structured `chosen_retaliation_suppressed` trace decision with
  actor/target/source-action/death-cause/timing attribution, proven by pure golden and
  command/projection rebuild-preserved trace checks;
  `guard_policy.same_target_witch = KillTarget` now requires a pack-owned
  `same_target_witch_kill_cause`, emits a structured `guard_witch_same_target_killed`
  trace decision, and is proven with a Chinese structured override golden plus a
  minimal command/projection rebuild pack fixture, while the shipped Chinese structured pack
  continues to prove `same_target_witch = NoDeath`]
- [x] Same-ability action ordering by priority, submitted time, and action id.
- [x] Seeded random tie resolution where a pack chooses random. [domain test
  `random_day_vote_tiebreak_is_seeded_and_deterministic` sets the mafiascum pack vote policy to
  `Plurality` + `Random`, proves the same stored seed resolves the tie to the same contender, and
  proves a different stored seed can select a different tied contender]
- [x] Trace every target rewrite, suppression, conflict, generated action, and loop-cap hit.
  [proven: `cargo test -p domain --test golden trace_records` now passes all 66 pure trace-family
  goldens, including target rewrites, suppression, conflict decisions, generated trigger rows,
  target-state gates, stage-order diagnostics, and redirect/trigger loop-cap diagnostics; the
  Super-Saint generated-trigger assertion derives the event index from the emitted `Trigger` and
  verifies the matching `ResolutionTrace.generated` row; `host_resolve_phase_persists_combined_trace_audit_branches`
  proves one persisted Postgres trace can carry a helper-enforced redirect edge, roleblock
  suppression decision, protect-vs-kill conflict decision, Trigger inner-event decision,
  generated-trigger row, and generated-trigger note through projection rebuild;
  `host_resolve_phase_persists_mass_redirect_rotate_trace_edges` proves one ordered Rotate action
  persists three deterministic redirect edges; `host_resolve_phase_persists_redirect_loop_cap_trace_note`
  proves shipped mafiascum redirect loop-cap truncation persists in `ResolutionTrace.notes` while
  retained redirect edges helper-enforce the applied rewrite; and
  `host_resolve_phase_persists_trigger_loop_cap_trace_note` proves the current validator-clean
  low-cap fixture persists trigger fixpoint truncation, helper-enforced generated-trigger note,
  row, and typed inner-event trace decision, standalone `EffectsMarked` resolver/projection state,
  killed slots, slot effects, and the trace envelope through rebuild]

### G. Triggers, generated actions, and fixpoints

- [x] Trigger table in packs covers on-kill, on-lynch, on-visit, on-death, on-phase,
  on-win, and effect-specific triggers. [proven for `Kill`, `Visit`, and `Lynch`
  observations; `Death` observations are now distinct from `Kill` ability observations and proven
  by `death_curse_retaliates` pure golden/trace coverage plus a Postgres `ResolvePhase`
  projection-rebuild proof; durable `EffectsMarked` now emits an `EffectMarked` observation whose
  fresh effect tag can satisfy `if_target_has`, proven by mafiascum `death_marker` /
  `death_mark_detonates` pure golden/trace coverage plus a Postgres `ResolvePhase`
  projection-rebuild proof; trigger validation now rejects duplicate trigger ids and empty,
  unknown, or duplicate effect tags in both `if_target_has` and `if_actor_has`, rejects
  resolver-skipped production refs, restricts generated `Kill` modifiers to `Strongman`, and
  currently permits only generated `Kill` plus modifier-free self-targeted generated `Visit`; `PhaseEnd` observations are now emitted for slots still alive after
  core resolution, proven by mafiascum `phase_end_doomed_townie` /
  `phase_end_doom_claims` pure golden/trace coverage plus a Postgres `ResolvePhase`
  projection-rebuild proof; non-kill `Win` observations run before finality and are proven by
  mafiascum `win_witness_townie` / `win_witness_observes` pure golden/trace coverage plus a
  Postgres `ResolvePhase` projection-rebuild proof while preserving exactly one final
  `WinReached` as the result-contract event]
- [x] Generated actions re-enter normal resolution with source/cause attribution.
  [proven: motivator/inventor grants emit schema-required `ActionGranted.source_action`
  facts that carry through folded state, trace `generated` rows, action-grant projections, and
  rebuild; extra-action and item spends emit schema-required `ActionGrantConsumed.source_action`
  facts that decrement the explicitly sourced generated grant in folded state/projections and
  preserve that source in trace `generated` rows, item spends also emit rebuildable
  `inventory:<grant_id>` counters, trigger-produced kills carry source/cause attribution,
  emit `ResolutionTrace.generated` trigger rows with source/produced actor-target detail
  across the current death/effect/phase/win/visit/lynch and Epicmafia bomb trigger goldens,
  with Postgres `ResolvePhase` proofs for PGO, including protected and Bodyguard-intercepted
  generated kills, selective visitor-kill, death, EffectMarked, PhaseEnd, Win, Super-Saint Lynch,
  ordinary protected Vengeful, Strongman Vengeful Doctor/Bodyguard bypasses, and Epicmafia Bomb
  triggers that persist and rebuild-preserve generated rows, preserve standard-NAR generated-kill
  cause policy, and Hunter
  retaliation uses its armed `source_action` with a persisted `chosen_retaliation`
  `ResolutionTrace.decisions` row tying folded target/source death cause to the generated kill;
  Babysitter dependency deaths use the pack-declared
  `standard_nar.guard_dependency_cause_policy` cause while trace decisions carry stage/source,
  template/submitted action ids, attacker, protector, ward, and direct-death race merge details;
  Hider dependency deaths use the pack-declared `standard_nar.hide_dependency_cause_policy` cause
  while trace decisions carry stage/source, template/submitted action ids, attacker, host, hider,
  and direct-death race merge details;
  lover-suicide and Wolf Beauty drag generated deaths now carry helper-enforced stage/source/detail
  trace attribution for folded-link/mark-source decisions and direct-death race merges, including
  Chinese structured Cupid night-kill and lynch cascades; generated vest items now write ordinary
  persistent effects that re-enter later
  kill resolution; ordinary `vengeful_retaliates` generated kills now have a pure golden/trace
  proof and a Postgres `ResolvePhase` rebuild proof showing the trigger payload preserves
  `source_target`/`source_actor`/`source_cause`, the produced kill enters normal Doctor protection,
  and the protection trace is helper-enforced as sourced to `cause:vengeful_retaliates`; generated
  trigger kills now also re-enter target-state gates with same-resolution transient effects, proven
  by `host_resolve_phase_generated_pgo_kill_obeys_transient_target_state`, where a PGO-generated
  kill preserves `source_target`/`source_actor`/`source_cause`, emits a `ResolutionTrace.generated`
  row, is skipped by an ordinary `kill_skipped_by_target_state` decision sourced to
  `cause:pgo_shoots_visitor`, and rebuild-preserves the trace envelope and all-alive slot state]
- [x] Generated kills still pass through protect/strongman policy unless explicitly
  unstoppable. [proven for trigger-produced kills: a mafiascum PGO generated kill is stopped by
  ordinary Doctor protection, another PGO generated kill is intercepted by a Bodyguard that dies
  from `bodyguard_intercept`, while Martyr protection uses a distinct `martyr_intercept` cause;
  ordinary `vengeful_retaliates` is stopped by Doctor protection in both pure and Postgres
  `ResolvePhase` proofs, while pack-declared `unstoppable_vengeful_retaliates` generated kills
  carry `Strongman`, bypass Doctor, Bodyguard, Martyr, and CPR protection, emit the same structured
  protect-vs-kill `DecisionTrace` as submitted kills, and rebuild-preserves the persisted traces;
  `standard_nar.generated_kill_cause_policy` now owns generated-trigger shape plus
  ordinary-vs-Strongman classification and fails closed for both night and day trigger fixpoints
  when entries are missing, malformed, or outside the trigger table;
  `standard_nar.trigger_fixpoint_policy` separately owns
  generated-trigger fixpoint participation, produced-kill re-entry, loop-cap source, and trace
  expectations before the resolver enters the trigger loop, fails closed for empty or unknown
  trigger-fixpoint sources, and the pack linter requires both generated-kill policy entries to move
  together for every kill-producing trigger; protection and
  target-state save classifier gaps now name omitted generated-trigger causes explicitly, and
  suppression omissions now also name any night action that can feed a generated-kill trigger;
  `test_invalid_generated_kill_ownership` plus
  `resolve_phase_rejects_invalid_generated_kill_ownership_before_append` prove those cross-table
  ownership gaps reject before command/projection append, and focused resolver regressions prove
  the same ownership gaps fail closed before trigger fixpoint entry;
  `standard_nar.chosen_retaliation_cause_policy`
  separately owns folded Hunter-style chosen-retaliation causes before `RetaliationArmed` state is
  consumed, including unknown Retaliate sources and Strongman policy drift]
- [x] Bomb, hunter, vengeful, super-saint, executioner, condemner, PGO, visitor-kill,
  beloved-princess, babysitter, hider, and lover-suicide scenarios have goldens.
  [proven for Bomb, Hunter, Vengeful Townie including an ordinary protected generated-kill variant,
  Super-Saint, Executioner, Condemner, PGO, selective visitor-kill, Beloved Princess, Babysitter,
  Hider, and lover-suicide; Bomb/Vengeful/Hunter/PGO/visitor-kill are reflected in the
  source-derived parity matrix with strict pack-linter contracts where applicable]
- [x] Fixpoint termination is deterministic and emits trace diagnostics.
  [proven: `cargo test -p domain --test golden loop_cap` covers redirect loop-cap and trigger
  loop-cap trace notes; Postgres tests
  `host_resolve_phase_persists_redirect_loop_cap_trace_note` and
  `host_resolve_phase_persists_trigger_loop_cap_trace_note` prove those diagnostics persist and
  survive rebuild; `standard_nar_trigger_fixpoint_policy_classifies_every_generated_kill_trigger`
  plus the `trigger_fixpoint_policy` resolver goldens prove generated-kill trigger policy fails
  closed before the fixpoint when missing, malformed, or unknown-source; seeded command-pipeline
  replay audits cover PGO trigger diagnostics, Babysitter/Hider generated-death dependency graphs,
  two-phase Hunter retaliation, and Cupid/Lovers folded state through trace inspection and
  projection rebuild]

### H. Visibility, notifications, and private results

- [x] Track/watch/motion results are graph-derived and obey stealth/ninja visibility.
  [mafiascum graph-derived result proof now includes pure goldens plus Postgres
  command/projection checks that Watch/Motion Ninja-hidden results and visible Tracker results
  fold only into addressed `player_investigation_result` rows, do not leak result payloads into
  public `thread_view`, and rebuild identically]
- [x] Investigation parity/alignment results honor effect overrides.
  [mafiascum Cop/Godfather/Miller/Framer proof now includes a rebuildable
  `player_investigation_result` projection and
  `GET /games/{game}/investigation-results` capability filtering: addressed Cop slots see only
  their own private `PlayerInvestigationResult`, hosts see all results, and outsiders are
  rejected; mafiascum and Mafia Universe role-set investigations now prove the same private
  projection/non-leakage/rebuild path for Vanilla, Neapolitan, and Gunsmith results; mafiascum
  Role Cop and Mafia Universe Role/Full Cop variants prove the same path for role-key and
  role+alignment disclosure]
- [x] Roleblock/interference emits `ActionInterfered`, not a fake info result.
  [proven with mafiascum roleblock goldens plus structured suppression trace detail]
- [x] Mark/Clear, motivator grants, granted items, vest consumption, and private notices
  emit `EffectNotification`/notification events with explicit audience. [proven for non-hidden
  Mark/Clear effects, including actor/target douse notices, hidden Mark effects filtered from
  player notices, Epicmafia ActorAndTarget douse notices with unrelated-slot and public-thread
  non-leak proof, motivator/inventor grants, granted vest item mark notices, vest consumption,
  loud/announcing action notices, Cupid lover-knowledge notices, and Mafia Universe Fruit Vendor
  private fruit notices with no persistent slot effect; `EffectNotification` now has explicit
  result-contract coverage for required `audience`; `player_notification` rebuild proof covers
  per-recipient and hidden-filtered projection; the Mafia Universe Inventor command vertical now
  proves grant/item/vest notices are addressed only to intended targets, absent for unrelated
  slots, absent from the public thread, and rebuild/audit-stable through item spend and vest
  marking, while the vest-save vertical proves automatic vest consumption clears state without
  leaking a clear notice to the attacker]
- [x] Public phase announcements are a canonical event, not UI prose.
- [x] Death reveal, role reveal, janitor, flipless, alignment-only flip, and endgame reveal are
  projection rules backed by events. [`PlayerKilled.death_reveal` now carries pack-derived `Full`,
  `Concealed`, or `AlignmentOnly` flip policy; ordinary deaths reveal role/alignment, Janitor and
  Flipless deaths keep role/alignment private, AlignmentOnly deaths reveal alignment while keeping
  role private, and `WinReached`/`GameCompleted` reveal every slot.
  `host_resolve_phase_reveals_killed_slot_without_endgame` and
  `host_resolve_phase_conceals_janitor_and_flipless_death_reveals` prove ordinary/concealed
  command resolution; `host_resolve_phase_projects_alignment_only_death_reveal` proves
  alignment-only command resolution, result-schema validation, replay audit, and rebuildable
  `slot_state.role_revealed` / `slot_state.alignment_revealed` projection]
- [x] Trace is available to hosts/admins but not leaked to players unless authorized.
  [`vertical_resolution_traces_are_host_audit_only` proves stored `ResolutionTrace` JSON and HTML
  are available to host/cohost principals, including filtered `run_id` reads, while ordinary slot
  occupants and outsiders receive `NotAuthorized` for both `/games/{game}/resolution-traces` and
  `/games/{game}/resolution-traces/view`]

### I. Result contract and persistence

- [x] Resolver returns `ResolutionOutput`, not bare inner events.
- [x] `ResolutionApplied` contains indexed inner events, result version, run id, seed,
  phase, counts, started/finished logical time, and deterministic metadata.
- [x] Exactly one trailing `PhaseAnnouncement` exists per resolution, followed only by
  optional `WinReached`. [`validate_resolution_applied` enforces exactly one trailer
  announcement, phase-id agreement, and at most one final `WinReached`; result-contract tests
  cover missing, duplicate, non-trailing, phase-mismatched, non-final-win, and multiple-win
  payloads; `host_resolve_phase_projects_win_trigger_before_final_win` proves pre-win trigger
  observations can precede the trailer while preserving exactly one final faction win]
- [x] `ResolutionTrace` is persisted beside `ResolutionApplied` or otherwise addressable
  by run id.
- [x] Inner event kinds are closed and schema-validated.
- [x] Unknown kinds are rejected outright.
- [x] Golden comparison strips only explicitly non-canonical prose fields. [`domain::normalize_golden_event`
  strips `DayVoteOutcome.reason` and `WinReached.reason` while preserving canonical payload fields;
  unit tests prove the narrow stripping rule and whole-number JSON normalization, and
  `check_goldens --check` proved the rule across 139 current pack fixtures]
- [x] Projections fold all v1 state-changing inner events.
- [x] Rebuild from the event log produces identical projections for the current v1 tables.

### J. Command/platform seam

- [x] Wire `ResolvePhase` through `commands::handle`.
- [x] Load pack by game's `GameCreated.pack`.
- [x] Load current phase and build `PhaseKind`/number from phase policy. [`ResolvePhase` reads
  the current `phase_state`, derives `PhaseKind`/number from that phase id, and passes those values
  into `current_snapshot`; Postgres tests
  `stored_game_stream_loads_phase_metadata_deadline_and_pack_policy`,
  `host_resolve_phase_loads_votes_applies_resolution_and_projects`, and
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` prove the
  resolver-facing snapshot/input/envelope carry the expected Day/Night phase metadata]
- [x] Load roles, alignments, slot statuses, effects, counters, and pending submissions. [`current_snapshot`
  folds role/alignment assignments, lifecycle/status tags, persistent effects, action counters, and
  prior state-bearing inner events from the stored stream; Postgres snapshot tests cover role,
  alignment, reveal state, role effects, lifecycle/status tags, and phase policy, while command
  resolver tests cover persistent effects/counters and
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` proves pending
  action/vote submissions plus role/alignment state reach the resolver input]
- [x] Convert `VoteSubmitted`/`VoteWithdrawn` into engine day submissions.
- [x] Convert `ActionSubmitted`/`ActionWithdrawn` into engine action submissions, with
  `Command::SubmitAction`/`Command::WithdrawAction` as the canonical command and wire
  front doors; `SubmitAction.grant_id` is the explicit generated-action spend surface for
  extra-action grants.
- [x] Append `ResolutionApplied` and `ResolutionTrace` atomically.
- [x] Advance/lock/unlock phases according to phase policy after resolution. [`ResolvePhase`
  atomically appends the resolved-phase `ThreadLocked`; Postgres test
  `host_resolve_phase_loads_votes_applies_resolution_and_projects` proves late votes/actions reject,
  `phase_state` rebuild preserves the lock, host `AdvancePhase` derives and unlocks the next
  declared cadence phase, and a non-host `AdvancePhase` appends nothing; Postgres test
  `host_advance_phase_wraps_night_to_next_day_from_pack_cadence` proves Night wraps to the next
  Day; Postgres test `deadline_elapsed_evidence_is_inert_until_deadline_advance_command` proves
  deadline evidence is inert until the host-gated deadline-advance command appends
  `PhaseDeadlineElapsed` plus pack-derived `PhaseAdvanced`, while non-host deadline advancement
  appends no evidence or phase-control event]
- [x] Keep running votecount projection separate from official engine outcome. [Postgres test
  `engine_phase_input_preserves_submit_withdraw_history_and_current_day_ballots` injects a
  projection-only stale `vote_ballot` row, proves `ResolvePhase` ignores it when producing
  `DayVoteOutcome`, then proves projection rebuild removes the stale row]
- [x] Capability checks remain platform-only; engine does not authorize. [`commands::handle`
  resolves `caps` before host/slot commands while `domain::resolve` receives only slot-keyed
  `ResolutionInput`; Postgres tests prove non-host `ResolvePhase`, `AdvancePhase`, and
  `AdvancePhaseByDeadline` reject before appending events, non-occupant votes reject as
  `NotYourSlot`, and accepted resolver input is already reduced to slot/action submissions]
- [x] Support replay and dispute tooling from stored result envelopes and traces. [`audit_resolution_envelopes`
  reruns stored ordinary `ResolvePhase` envelopes and reports matched/drifted/skipped
  `ResolutionApplied`/`ResolutionTrace` pairs; `inspect_resolution_traces` exposes run-id-filtered,
  `ResolutionApplied`-anchored trace rows for host/admin inspection; Postgres test
  `host_resolve_phase_loads_votes_applies_resolution_and_projects` proves a matched replay audit,
  anchored result-contract and day-vote trace inspection, and stability for both reports after
  projection rebuild]

### K. Tooling and test proof

- [x] Pack linter.
- [x] Result validator.
- [x] Trace validator.
- [x] Golden scenario harness by pack. [Rust golden tests and `check_goldens --check` both resolve
  fixtures with their declared pack, including `pack_overrides` for intentional pack-policy variants]
- [x] Cross-language fixture import from im-human V4 outputs. [proven:
  `tools/import_im_human_v4_fixture.py` imports frozen im-human Engine V4 result JSON into
  canonical `ResolutionApplied` JSON using the source-derived im-human result-kind map and
  explicit per-event payload-shape validators; `python3 -m unittest
  tools/tests/test_import_im_human_v4_fixture.py` proves checked fixture import, unknown event
  rejection, known-unsupported event rejection, and malformed payload rejection; Rust result-contract
  test `imported_im_human_v4_fixture_payload_passes_contract_validation` proves the checked imported
  artifact passes fmarch schema validation before it can count as parity coverage]
- [x] Property tests for determinism, ordering, replay, and graph fixpoint termination. [proven:
  `seeded_property_family_replays_ordering_and_fixpoints_deterministically` runs a seeded
  pure-domain scenario family across replay and three submission-order permutations, covering
  same-ability ordering, redirect graph stability, redirect loop-cap termination diagnostics, and
  trigger fixpoint loop-cap termination diagnostics]
- [x] Small-scope scenario tests for every primitive/modifier interaction. [proven:
  `tools/check_primitive_modifier_interactions.py --check` derives product-pack interactions from
  action abilities plus explicit modifiers/modifier-like constraints, reports 68 covered
  interactions across 42 unique primitive/modifier pairs with zero uncovered rows, lists the five
  explicit unsupported primitive/modifier parity rows separately, and the targeted
  `check_goldens --check` lane reruns all 145 referenced interaction fixtures]
- [x] Regression matrix mapping each im-human Engine V4 test family to fmarch coverage. [proven:
  `tools/check_engine_v4_test_family_coverage.py --check` reads the source-derived
  `test_families` inventory, verifies all 28 Engine V4 families have a coverage mapping, checks
  every mapped evidence path/needle, and confirms the regenerated parity matrix agrees; the current
  report maps 26 families to fmarch proof surfaces and leaves only `feature_flags_test` plus
  `init` as explicit out-of-scope/non-resolution rows]
- [x] Inventory script that reports unported primitives, modifiers, event kinds, and
  culture notes from im-human. [proven:
  `tools/report_unported_im_human_inventory.py --check` reads the generated parity matrix and
  emits a focused unsupported-inventory report with exact matrix line numbers, categories,
  classifications, and rationales; the current report lists 2 unsupported rows total, both
  classified as explicit out-of-scope `test_family` rows (`feature_flags_test` and `init`), with
  requested-category counts of 0 primitives, 0 action modifiers, 0 effect modifiers, 0 result
  event kinds, and 0 culture notes]
- [x] CI command that runs all domain goldens and schema validators without Postgres.
  [proven: `python3 tools/run_domain_ci_no_postgres.py --check --output
  target/operator-proof/current-domain-ci-no-postgres-report.json` runs four no-Postgres lanes:
  `cargo test -p domain --test golden` (430 tests), `check_goldens --check` over all 12
  golden-owning pack directories (281 fixtures), `cargo test -p domain --test result_contract`
  (63 tests), and `cargo test -p domain --test pack_validation` (138 tests). The saved report
  records `ok: true`, 4 passed lanes, zero failed lanes, and explicitly excludes Postgres
  command/projection integration.]
- [x] Integration command that runs command/projection resolution against Postgres. [proven:
  `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/<scratch-db> cargo run -q -p commands
  --bin prove_command_projection_resolution -- --output
  target/operator-proof/current-command-projection-resolution-report.json
  crates/commands/fixtures/night-passing.json` seeds the checked fixture through
  `commands::handle`, runs `Command::ResolvePhase`, writes the saved report under
  `target/operator-proof`, and compares both audit surfaces; the checked run reported
  `ok: true`, 20 matched projection-rebuild tables, one matched resolution envelope, zero
  drifted tables, zero drifted phases, and zero diffs. This is local-Postgres-only proof.]

## Build order

### Phase 0 - Freeze the target contract

Do this before adding more mechanics.

1. Add a mechanical inventory script that extracts im-human primitive names, modifier names,
   result event kinds, day-step names, and test families.
2. Commit a parity matrix under fmarch that marks each row as: unsupported, modeled in pack,
   implemented in resolver, covered by golden, integrated through command/projection.
3. Decide the canonical Rust event names and mapping from im-human event strings.
4. Add result-schema validation for fmarch inner events.

Exit proof: adding an unknown inner event or malformed payload fails a domain test. The refreshed
`target/operator-proof/current-engine-port-completion-audit.json` currently marks Phase 0 complete:
the generated parity matrix has 593 rows, and the unsupported-inventory report has zero unsupported
rows in the requested primitive/modifier/result/culture categories, leaving only the two explicit
out-of-scope test-family rows.

### Phase 1 - Wire the resolution seam end to end

1. Implement `Command::ResolvePhase`.
2. Build `StateSnapshot` from projections/event stream.
3. Load the declared pack from `GameCreated.pack`.
4. Convert vote/action events into `Submission`s.
5. Run the pure resolver.
6. Validate the output.
7. Append `ResolutionApplied` and `ResolutionTrace` in one transaction.
8. Fold resulting deaths/wins/conversions/effects into projections.

Exit proof: a real Postgres integration test creates a game, submits votes, resolves day,
appends `ResolutionApplied`, kills the lynched slot, and rebuilds projections identically.

### Phase 2 - Make pack validation strict

1. Add pack linter and schema tests.
2. Reject invalid template/mode/effect/target combinations.
3. Enforce additive IR evolution and pack version compatibility.
4. Move hardcoded resolver ordering toward pack-derived precedence tables.
5. Route pack reads through an explicit upcast/load boundary before command-side resolution.

Exit proof: every shipped pack validates; intentionally malformed pack fixtures fail with
actionable errors.

### Phase 3 - Reach common mafiascum night parity

Prioritize roles that stress the architecture:

1. Cop/godfather/miller/framer via investigation overrides. [done for mafiascum parity goldens
   plus `vertical_investigation_results_are_capability_filtered`, which proves rebuildable
   player-facing private results for Godfather town-read, Miller scum-read, and same-night
   Framer scum-read through the API capability boundary; mafiascum `vanilla_cop`,
   `neapolitan`, and `gunsmith` now use v36 pack-owned role sets, pure positive/negative
   goldens, and a Postgres private-result/non-leakage/rebuild vertical; mafiascum
   `role_cop`/`role_scan` now uses v37 `InvestigateMode::Role` with a pure golden and
   Postgres private-result/non-leakage/rebuild vertical; Mafia Universe
   `role_scan`/`full_role_scan` now use v37 `InvestigateMode::Role` and v38
   `InvestigateMode::FullRole` for town/mafia Role Cop and Full Cop variants, with pure
   town/mafia goldens and a Postgres private-result/non-leakage/rebuild vertical; Mafia
   Universe `parity_scan` now uses v39 investigator-scoped `result_memory` for town/mafia
   Parity Cop variants, with pure same/different memory golden and a Postgres
   private-result/non-leakage/memory/rebuild vertical]
2. Doctor/bodyguard/jailkeeper/roleblocker/strongman. [done for mafiascum protection/blocking
   goldens plus structured trace decisions for roleblock suppression, protect save, and
   strongman protection bypass; `standard_nar` lints the concrete mafiascum action ids and drives
   submitted Bodyguard/Strongman classification; `standard_nar.kill_stacking:
   AggregateAttackers` proves ordinary/Strongman stacked landed-kill attribution through domain
   and command/projection rebuild tests, with pure resolver fail-closed coverage for missing
   in-memory policy; Mafiascum `faith_healer` now maps source `protect` to
   `faith_healer_protect`, declares pack-owned `standard_nar.action_chance: 0.5`, and has
   deterministic save/miss goldens plus a Postgres command/projection/rebuild vertical]
3. Tracker/watcher/motion with visit graph derivation. [done for mafiascum graph-info goldens;
   Mafia Universe town/mafia Tracker, Watcher, and Motion Detector variants now reuse the same
   graph-derived `Track`/`Watch`/`Motion` result modes through pack data, pure goldens, and a
   command/projection rebuild vertical]
4. Bus driver/lightning rod/redirect cycles with graph fixpoint. [done for mafiascum ordered
   redirect graph goldens, helper-enforced redirect `TraceEdge` diagnostics, loop-cap truncation
   note coverage, and command/projection rebuild proof; Mafia Universe `town_bus_driver`,
   `mafia_bus_driver`, `town_redirector`, and `mafia_redirector` now map `bus_drive` to
   `bus_driver_swap` and `redirect` directly to canonical `redirect`, with pure swap/cycle
   goldens plus a Postgres composed swap+retarget trace/rebuild vertical]
5. Bulletproof/vest, commute, untargetable. [done for mafiascum target-state goldens plus
   structured trace decisions for commute skipped kills, passive untargetable investigation
   interference, and active rolestop/shield-all target-state gates; command/projection proof shows
   resolution-scoped gates do not become durable slot effects; Mafia Universe `town_commuter` and
   `mafia_commuter` now map `commute` directly to canonical self-only `commute` with pure
   town/mafia target-state and Personal rejection goldens; Mafia Universe `town_rolestopper`,
   `mafia_rolestopper`, and `rolestop` now map to canonical active `rolestop` with pack-owned
   `untargetable` target-state gates, pure town/mafia goldens, and a Postgres trace,
   non-durable-effect, and rebuild vertical]
6. X-shot, odd/even, non-consecutive, indecisive, uncooperative, roaming, compulsive, lazy, weak, macho, personal, loud/announcing.
   [done for one-shot and multi-shot x-shot counts, odd/even night, target-repeat
   non-consecutive, and command-side rejection before append for exhausted x-shot,
   wrong odd/even night, repeated non-consecutive, Indecisive, and Roaming targets,
   one-non-town Lazy actions, and non-self Personal targets; compulsive missing-action audit,
   Indecisive different-target allowance, Roaming new-target allowance, Uncooperative ambiguous
   feedback, Disabled Endgame threshold blocking, Lazy multiple-non-town allowance,
   Weak Parity scum backlash,
   macho protection immunity, Personal self-only targeting, loud/announcing notifications, and
   broader cycle-cooldown windows]

Exit proof: mafiascum pack has goldens for each common interaction family and deterministic
round-trip state folds.

### Phase 4 - Port persistent and generated-action systems

1. Poison/douse/ignite/heal/cleanse. [done for persistent poisoned/doused tags, delayed poison death,
   cure/cleanse preemption, read-effect ignite, helper-enforced command trace detail for standalone
   and conversion-racing pending poison applied, pending poison preempted, and cleanse-preempted
   read-effect targets, plus command/projection rebuild proof; Mafia Universe `town_poisoner`,
   `mafia_poisoner`, `town_poison_doctor`, `mafia_poison_doctor`, `poison`, and
   `cure_poison` now reuse the same persistent `poisoned` delayed-death/clear spine with pure
   mark, cure, pending-kill, and already-dead goldens plus a Postgres queue/effect/trace/rebuild
   vertical; Mafia Universe `town_arsonist`, `mafia_arsonist`, `town_firefighter`,
   `mafia_firefighter`, `douse`, `ignite`, and `extinguish` now reuse the same persistent
   `doused` mark, read-effect ignite, and Clear-preemption spine with pure mark/kill/preempt
   goldens plus a Postgres notification/trace/rebuild vertical; Mafia Universe `town_healer` and
   `mafia_healer` now reuse the `cure_poison` Clear spine with alias-specific pure preemption
   goldens plus a Postgres two-alignment queue/effect/trace/rebuild vertical; Mafia Universe
   `town_firefighter_preempt` now reuses the `extinguish` Clear spine with alias-specific pure
   preemption golden plus a Postgres douse/clear/read-effect trace/rebuild vertical.]
2. Mark/Clear with expiry and visibility. [done for current v1 `Persistent`/`Resolution`
   duration and `Hidden`/`Public`/`Actor`/`Target`/`ActorAndTarget` visibility now drive
   Mark/Clear notifications; Mafia Universe `town_empowerer`, `mafia_empowerer`, and `empower`
   now use a hidden resolution-scoped `empowered` Mark plus `standard_nar.empower_effects`
   to bypass same-night block and redirect for the empowered actor, with strict pack validation,
   pure town/mafia goldens, and a Postgres trace/rebuild vertical; Mafia Universe
   `town_fruit_vendor`, `mafia_fruit_vendor`, Mafia Universe `send_fruit`, and Mafiascum
   `fruit_vendor`/`send_fruit` now use a target-visible resolution-scoped `fruit_received`
   Mark to emit private fruit notifications without persistent `EffectsMarked`/`slot_effects`,
   with pure culture-pack goldens and Postgres notification/rebuild verticals; persistent
   `EffectsMarked` source action, phase id/kind/number, duration, and visibility are carried
   through `EffectRecord`, `slot_effect`, projection rebuild, and command snapshots; direct
   `EffectsMarked { duration: Resolution }` fixture/history events now expire before durable
   `SlotState.effects`, `effect_records`, `slot_effect`, and command snapshot state, proven by
   pure state evolution, projection/rebuild, and Postgres command snapshot tests]
3. Motivator/grant item/extra action and private notifications. [done for pack-declared
   `Grant` actions, `ActionGranted` state/projection facts, durable `ActionGrantConsumed`
   remaining-use folds, typed `inventory:<grant_id>` counters for item spends, trace generated
   rows, private target notifications, and `SubmitAction.grant_id` enforcement across phases;
   pack-declared single-use item actions are consumable through command/projection/resolver;
   generated vest items write persistent state and later consume through the ordinary vest-save
   path; Mafia Universe `town_motivator`, `mafia_motivator`, and `motivate` now reuse the
   `extra_action` Grant spine with alignment-specific pure goldens plus a Postgres
   grant/private-notification/spend/trace/rebuild vertical; Mafia Universe `town_inventor`,
   `mafia_inventor`, and `grant_item` now use one canonical Grant action with v42 pack-owned
   `grant_options` for `parity_scanner_item` and `bulletproof_vest_item`; command submission
   rejects missing/unknown selections, selected options produce alignment-specific pure grant
   goldens, parity scanner spend/exhaustion goldens, a vest mark golden, and a Postgres
   private-notification/spend/inventory-counter/effect/trace/rebuild vertical; richer item UX
   remains pending]
4. Conversion/deprogramming/backup inheritance. [done for conversion origin memory,
   vanillaize as `Convert::AssignRole`, helper-enforced command trace decisions for hand-built
   cult conversion, dead-target/pending-death/loyal conversion blocks, vanillaize assignment, and
   restore-original deprogramming, plus exact anchored Cult/Loyal conversion trace detail in the
   Epicmafia generated replay lane,
   helper-enforced passive backup inheritance attribution, helper-enforced targeted backup
   inheritance attribution including folded target-phase `policy_detail`, and targeted backup via
   v17 `backup_policy` + folded `BackupTargeted`; broader multi-source priority variants
   remain pending]
5. Trigger fixpoint for bomb, hunter, vengeful, PGO, lovers, babysitter, hider.
   [partly done: the trigger queue now supports `Kill`, `Visit`, `Lynch`, `Death`,
   `EffectMarked`, `PhaseEnd`, and non-kill `Win` observations,
   re-enters generated kills into the bounded fixpoint, and has goldens for Bomb,
   Vengeful Townie, Death-Cursed Townie, Death Marker, Phase-End Doomed Townie, Win Witness, Super-Saint, PGO, and pack-declared Strongman Vengeful retaliation plus
   command/projection rebuild tests for lethal PGO, protected PGO, Bodyguard-intercepted PGO,
   Martyr intercept, Super-Saint lynch retaliation, and Strongman bypass trigger paths for Doctor,
   Bodyguard, Martyr, Death-Cursed retaliation, effect-marked generated kills, and
   phase-end generated kills plus a command/projection rebuild test for non-kill Win triggers;
   Cupid/lovers now
   use `IrAbility::Link`, folded `PlayersLinked`, v16 `lover_policy`, lover-suicide
   night-kill/day-lynch/Witch-poison, direct-death-race, and cascade-disabled goldens,
   structured generated-death and stacked-death trace attribution, and command/projection
   rebuild proof for night, day, Witch-poison, and direct-death-race cascades; Hunter uses
   `IrAbility::Retaliate`, folded `RetaliationArmed`,
   `standard_nar.chosen_retaliation_cause_policy`, goldens,
   resolver fail-closed proof, and helper-enforced command/projection trace/rebuild proof; Chinese Hunter adds v14 cause-gated
   `death_retaliation` so `wolf_night_kill` fires the chosen shot and `poison_potion`
   suppresses it with structured trace attribution, with goldens plus command/projection rebuild proof; Babysitter uses
   `Protect` + `Modifier::Babysitter` with a golden, structured dependency-death trace
   attribution, and command/projection rebuild proof; Hider uses `Mark` +
   `Modifier::Hider` with pack-owned `standard_nar.hide_dependency_cause_policy` cause
   attribution, goldens, structured dependency-death trace attribution, and command/projection
   rebuild proof; trigger-produced kills now cover ordinary Doctor protection,
   Bodyguard and Martyr interception, and pack-declared Strongman bypass of Doctor, Bodyguard, and Martyr through the
   normal kill policy with persisted trace/rebuild proof; Super-Saint now reacts to the day
   `Lynch` observation and kills the latest active voter on the wagon with persisted
   trigger/rebuild proof; Executioner and Condemner use v19 `target_lynch_win_policies` plus
   folded target relations and independent target-lynch `WinReached` events, with both roles
   carrying helper-enforced persisted trace/rebuild proof for the generalized command path; Jester uses v25
   `self_lynch_win_policies` to map im-human `win.jester` into a final `WinReached`, suppressing
   ordinary faction `WinPolicy` fallback and carrying helper-enforced persisted trace/rebuild proof; trigger loop-cap
   diagnostics are now carried in `ResolutionTrace.notes` with a cyclic retaliation fixture and a
   persisted trigger-trace command/rebuild assertion.
   Beloved Princess now uses v20 `beloved_princess_policy` to emit a `HostPromptIssued`
   skip-next-day prompt before the trailing `PhaseAnnouncement`, with host-prompt projection and
   command/rebuild proof. Seeded command-pipeline fuzz now drives PGO, Babysitter, and Hider
   trigger/dependency graphs through legal `SubmitAction` commands, `ResolvePhase`,
   `audit_resolution`, `inspect_trace`, and `audit_rebuild`; another seeded lane drives two-phase
   Hunter retaliation and Cupid/Lovers folded state through the same audit trio. Remaining fuzz
   gaps are broader culture-specific policy variants and shrinking]

Exit proof: multi-phase goldens show effects carrying forward only through state folds.

### Phase 5 - Port rich day systems

1. Weighted voting modifiers and thresholds. [done: pack-declared hammer now
   freezes the official vote snapshot at the threshold-reaching ballot, emits
   `VoteStatus::Hammer`, and is proven through pure golden plus command/projection
   rebuild proof; x-voter is proven through pack-declared `WeightPolicy::PerRole`;
   effect-based dynamic pack weights are proven through legal Mark-created folded
   `EffectsMarked`; explicit `ActionGranted`-style vote-weight grants are proven through
   legal Grant-created folded `VoteWeight` grants, command/projection rebuild proof, and
   live hammer-lock, NoMajority revote-prompt, and HostDecides PK-prompt simulation through
   the same folded state; `day_vote_policy_matrix_covers_methods_and_tie_breakers` covers
   Majority, Plurality, Supermajority, Hammer, NoElimination, HostDecides, and seeded
   deterministic Random vote outcomes]
2. Sheriff badge/pass.
3. Knight duel / public day duels. [v8 `Duel` IR and `DuelResolved`; Chinese structured
   success/failure goldens; command/projection death/rebuild proof. v34 `VoteDuel` now models
   mafiascum Gladiator separately as `VoteDuelDeclared` plus a restricted official
   `DayVoteOutcome`; the pack-declared `vote_duel_tie_breaker: Random` forces seeded
   elimination for no-ballot/tied duels, with golden and command/projection rebuild proof.]
4. ITA session mechanics. [partly done: v9 `ItaShot`, pack-level `ItaPolicy`, first
   `mafia_universe` vertical emits `ItaSessionOpened`/`ActionUseCounted`/`ItaShotQueued`/
   `ItaShotResolved`/`ItaSessionUpdated`/`ItaSessionClosed`, `shot_limit` suppresses exhausted
   session shots through folded counters, and command/projection proves lethal hit plus counter
   rebuilds; `vote_conflict: ResolveShotsBeforeVote` now makes ITA-before-vote policy pack-owned;
   v32 ITA modifier components/role refs add better/worse hit chance, target evade,
   one-shot shield blocking, and one composed evade+shield target with pure golden and
   command/projection proof; v59 `ItaSessionSpec.buffer_delay_ms` emits `ItaShotBuffered` and
   defers same-pass queue/resolve/kill with pure golden plus command/projection rebuild proof;
   release-time replay, invalidation, and refund remain pending]
5. Last words and day announcements. [partly done: `DayNotePolicy` emits
   `DayAnnouncement` from `DayPhaseInputs.night_victims` and `LastWordsRecorded` after a
   lynch; `mafia_universe` golden plus Postgres command/projection rebuild proof]
6. Wolf self-destruct / day-death culture mechanics. [partly done: v10 `SelfDestruct`
   emits `WolfSelfDestructed` plus paired `PlayerKilled` events for Chinese structured White
   Wolf King; v11 `WolfCarryQueued`/`WolfCarryUsed` queues the White Wolf carry token and
   consumes it on the next two-target wolf faction kill; v12 `WolfBeautyMarked`/
   `WolfBeautyDragged` models Wolf Beauty charm plus lynch, Witch-poison drag, and direct-death
   race stacking, with goldens, structured mark-source and stacked-death trace attribution, plus
   Postgres command/projection rebuild proof; v13 `guard_policy` models Chinese
   `night_guard` blocking `poison_potion`, keeps Witch heal from acting as a poison antidote,
   proves non-lethal Guard+Witch double-save, proves the shipped self-save-on-N01 policy plus
   disabled self-save/night-one override variants, and proves the lethal `KillTarget`
   same-target variant through an override golden plus minimal command/projection fixture;
   v14 `death_retaliation` models Chinese
   Hunter trigger availability for ordinary wolf kill versus Witch poison plus the immediate
   before-announcement no-host-prompt timing contract; v15
   `idiot_policy` maps Chinese Idiot first lynch survival to `PlayerSaved` plus
   `idiot_vote_loss`; command-side vote submission rejects later vote-lost Idiot ballots
   with `Reject::VoteNotAllowed` before append, and official later vote tallies give that
   slot zero vote weight.]
7. PK/revote/no-majority host prompts as events, not UI-only state.
   [partly done: `HostPromptIssued` is now a closed inner event folded into the rebuildable
   `host_prompt` projection, proven for the Beloved Princess skip-next-day prompt and mafiascum
   no-majority revote prompts with helper-enforced trace detail; epicmafia HostDecides plurality
   ties now emit PK prompts with golden, helper-enforced issue/resolution traces,
   command/projection, and rebuild proof. `Command::ResolveHostPrompt` now folds
   `HostPromptResolved` decisions through pack-declared v22 `host_prompt_resolution_effects`
   and a typed command-side `HostPromptEffect` mapper; host-prompt `PhaseAdvanced` payloads are
   command-constructed through a typed provenance shape and projection-validated before phase_state
   moves:
   host-selected PK kills append validated `ResolutionApplied`/`ResolutionTrace` envelopes with
   rebuild proof; resolving a mafiascum no-majority revote prompt opens a fresh `D01R1` vote
   window, and a second `ResolvePhase` lynches from that revote ballot set with rebuild proof;
   folded dynamic vote-weight grants can now emit a NoMajority revote prompt when they raise the
   majority threshold above an ordinary two-vote wagon, with prompt resolution and rebuild proof;
   folded dynamic vote-weight grants can also emit a HostDecides PK prompt when they turn a
   simple plurality into a weighted tie, with host-selected kill envelopes, audit, and rebuild
   proof;
   resolving a Beloved Princess skip-next-day prompt records `HostPromptResolved`, appends durable
   `PhaseAdvanced { phase_id: "N02", skipped_phase_id: "D02" }`, rejects voting in that night
   window, and rebuild-preserves prompt, phase, and slot state. Automated host scheduling around
   skipped day/night cadence remains unimplemented]

Exit proof: official `DayVoteOutcome` and day substep events can drive a host console
without recomputing rules client-side.

### Phase 6 - Culture packs and policy breadth

1. Mafia Universe. [partly done: ITA `ita_shot` is modeled in `packs/mafia_universe`,
   covered by a golden and result-schema events, proven through a command/projection rebuild
   vertical, declares pack-owned `ResolveShotsBeforeVote` conflict policy, and now covered by a
   six-seed generated D01 replay lane with mixed deterministic hit/miss outcomes plus
   `audit_resolution`, exact anchored ITA hit/miss generated rows in `inspect_trace`, and
   `audit_rebuild`; ITA better/worse chance, target evade, one-shot shields, and a composed
   evade+shield role are modeled as v32 modifier components/role refs with golden plus
   command/projection coverage; basic standard-NAR roles/actions now cover `kill` ->
   `factional_kill`, `protect` -> `doctor_protect`, `block` -> `roleblocker_block` for
   `town_roleblocker`, `mafia_roleblocker`, and the one-shot `town_jack_of_all_trades` /
   `mafia_jack_of_all_trades` bundles, `jail`, `bodyguard`, Martyr, CPR, and
   `strongman_kill`, with pure goldens for save, town and mafia roleblock-opens-kill, strongman
   bypass, jail block-plus-protect, bodyguard intercept,
   martyr intercept, CPR save, and CPR harm plus Postgres command/projection/rebuild
   verticals for roleblock-opens-kill and CPR harm; the common investigative set now covers
   `town_cop`, `mafia_cop`, `town_alignment_cop`, `mafia_alignment_cop`, `godfather`,
   `miller`, `mafia_framer`, and `town_framer`, mapping MU `investigate` /
   `investigate_alignment` to `cop_investigate` and `result_mod` to `frame`, with pure goldens
   for ordinary parity, Godfather, Miller, same-night Mafia/Town Framer overrides, and the
   alignment-cop culture aliases plus Postgres private-result/effect/rebuild verticals for framed
   and alias investigation paths; the
   MU graph-info set now covers `town_tracker`, `town_watcher`, `town_motion_detector`,
   `town_voyeur`, `mafia_tracker`, `mafia_watcher`, `mafia_motion_detector`, and
   `mafia_voyeur`, mapping `track`, `watch`, `motion_detector`, and `voyeur` directly to
   canonical pack action ids with pure town/mafia variant goldens plus Postgres
   private-result/non-leakage/rebuild verticals; Voyeur is v56 `InvestigateMode::Voyeur` and
   reports visible action ids on the watched target while excluding Ninja-hidden visits and
   watch-style observation actions; the MU role-set info
   set now covers `town_vanilla_cop`, `mafia_vanilla_cop`, `town_neapolitan`,
   `mafia_neapolitan`, `town_gunsmith`, `mafia_gunsmith`, `investigate_vanilla`,
   `neapolitan`, and `gunsmith` through v36 pack-owned vanilla/gun-bearing role sets,
   pure town/mafia variant goldens, and a Postgres private-result/non-leakage/rebuild
   vertical; the MU role/full-role info set now covers `town_role_cop`, `mafia_role_cop`,
   `town_full_cop`, `mafia_full_cop`, `role_scan`, and `full_role_scan` through v37/v38
   role-disclosure modes, pure town/mafia variant goldens, and a Postgres
   private-result/non-leakage/rebuild vertical; the MU parity-scan set now covers
   `town_parity_cop`, `mafia_parity_cop`, and `parity_scan` through v39 investigator-scoped
   memory, pure same/different golden coverage, and a Postgres private-result/memory/rebuild
   vertical; the MU public-reveal set now covers `innocent_child` and `reveal_town` through
   canonical v33 `RevealTown`, pure golden coverage, and a Postgres alignment-only
   projection/thread/rebuild vertical; the MU Alignment Oracle set now covers
   `town_alignment_oracle`, `mafia_alignment_oracle`, and `mark_alignment` through v57
   `effect_source_death_reveals`, a hidden persistent `alignment_oracle_mark`, pure mark and
   source-death reveal goldens, and a Postgres N01 mark -> rebuild -> N02 Oracle death public
   alignment-reveal/thread/rebuild vertical; the MU Role Oracle set now covers
   `town_role_oracle`, `mafia_role_oracle`, and `mark_role` through v58
   `effect_source_death_reveals.Role`, a hidden persistent `role_oracle_mark`, pure mark and
   source-death reveal goldens, and a Postgres N01 mark -> rebuild -> N02 Oracle death public
   role-reveal/thread/rebuild vertical; the MU Janitor set now covers `town_janitor`,
   `mafia_janitor`, and `janitor_kill` through a standard-NAR kill cause plus pack-owned
   `death_reveal.by_cause = Concealed`, pure town/mafia concealed-death golden coverage, shipped
   pack validation, and a Postgres kill/concealed-slot-state/rebuild vertical; the MU Backup set
   now covers `town_universal_backup`, `mafia_universal_backup`, and `inherit_role` through
   canonical `target_backup`, hidden persistent `backup_target`, `BackupTargeted` source-choice
   facts, `PlayerConverted` targeted inheritance, pure designation/inheritance goldens, and a
   Postgres N01 source-choice -> rebuild -> N02 source-death inheritance trace/rebuild vertical;
   the MU redirect set
   now covers `town_bus_driver`, `mafia_bus_driver`, `town_redirector`, and
   `mafia_redirector`, mapping `bus_drive` to `bus_driver_swap` and `redirect` directly to
   canonical pack actions with pure swap/cycle goldens plus a Postgres composed
   swap+retarget trace/rebuild vertical; the MU Empowerer set now covers `town_empowerer`,
   `mafia_empowerer`, and `empower` through a hidden resolution-scoped `empowered` Mark and
   `standard_nar.empower_effects`, proving same-night block/redirect bypass in pure
   town/mafia goldens plus a Postgres trace/rebuild vertical; the MU commute/rolestop set now covers
   `town_commuter`, `mafia_commuter`, `commute`, `town_rolestopper`,
   `mafia_rolestopper`, and `rolestop` through pack-owned target-state gates, pure
   town/mafia Personal/untargetable goldens, and Postgres command-validation/trace/rebuild
   verticals; the MU poison/cure set now covers `town_poisoner`, `mafia_poisoner`,
   `town_poison_doctor`, `mafia_poison_doctor`, `poison`, and `cure_poison` through the
   pack-owned persistent `poisoned` effect, pure delayed-death goldens, and a Postgres
   queue/effect/trace/rebuild vertical; the MU arson/firefighter set now covers
   `town_arsonist`, `mafia_arsonist`, `town_firefighter`, `mafia_firefighter`, `douse`,
   `ignite`, and `extinguish` through pack-owned `doused`, read-effect ignite, pure
   mark/kill/preempt goldens, and a Postgres notification/trace/rebuild vertical; the MU healer
   aliases `town_healer` and `mafia_healer` are now modeled as `cure_poison` Clear roles with
   alias-specific goldens and a Postgres two-alignment queue/effect/trace/rebuild vertical; MU
   `town_firefighter_preempt` is now modeled as an `extinguish` Clear alias with an
   alias-specific golden and a Postgres douse/clear/read-effect trace/rebuild vertical; MU
   `town_motivator`, `mafia_motivator`, and `motivate` are now modeled as `extra_action`
   Grant roles/actions with pure grant goldens and a Postgres private-notification,
   grant-spend, trace, and rebuild vertical; MU `town_inventor`, `mafia_inventor`, and
   `grant_item` are now modeled through one canonical Grant action with v42 pack-owned
   `grant_options` for `parity_scanner_item` and `bulletproof_vest_item`, explicit
   `SubmitAction.grant_id` selection, pure grant/spend/exhaustion/vest-mark goldens, and a Postgres
   missing/unknown-selection/private-notification/inventory-counter/effect/trace/rebuild vertical; MU
   `town_fruit_vendor`, `mafia_fruit_vendor`, Mafia Universe `send_fruit`, and Mafiascum
   `fruit_vendor`/`send_fruit` are now modeled as target-visible resolution-scoped
   `fruit_received` Mark actions that emit private `EffectNotification`/`player_notification`
   rows and no persistent `slot_effects`, with pure culture-pack goldens and Postgres
   notification/rebuild verticals;
   MU `town_night_desperado`, `mafia_night_desperado`, and `night_desperado` are now modeled
   as non-factional standard-NAR kills with pack-owned `alignment_failback` self-death on
   same-alignment targets, pure success/failback golden coverage, and a Postgres
   trace/projection/rebuild vertical; MU `town_power_role_killer`,
   `mafia_power_role_killer`, and `power_role_kill` are now modeled as ordinary standard-NAR
   kills gated by pack-owned `target_role_filter: PowerRole`, with command-time vanilla-target
   rejection, pure resolver `invalid_target_role` coverage, and a Postgres kill/rebuild
   vertical; MU `town_vigilante`, `mafia_vigilante`, and `vigilante_kill` are now modeled as
   ordinary non-factional standard-NAR night kills with role-scoped source `kill` aliases, pure
   alignment-variant golden coverage, and a Postgres kill/rebuild vertical; MU `town_ninja`,
   `mafia_ninja`, and `ninja_kill` are now modeled as ordinary non-factional standard-NAR night
   kills hidden from graph-derived visit results, with pure Watch/Motion coverage and a
   Postgres private-result/rebuild vertical; MU `town_day_vigilante`, `mafia_day_vigilante`,
   and `day_vigilante_kill` are now modeled as ordinary pre-vote Day kills with pure
   alignment-variant coverage and a Postgres D01 kill/thread/rebuild vertical; MU
   `town_day_desperado`, `mafia_day_desperado`, `day_desperado`, and v41
   `alignment_failback` are now modeled as pre-vote Day kills that kill hostile targets or
   self-kill on non-hostile targets, with pure success/failback coverage and a Postgres D01
   trace/thread/rebuild vertical. Richer MU item-selection UX remains pending.]
2. Chinese structured werewolf. [partly done: Prophet `investigate_alignment` now has
   linter coverage, good/evil goldens, parity-matrix coverage, result-schema coverage via
   `InvestigationResult`, and a command/projection rebuild vertical; Cupid `link_lovers`
   now has linter/order coverage, setup, night-kill cascade, day-lynch cascade,
   Witch-poison cascade, private lover-knowledge notification, and cascade-disabled goldens,
   `note.cupid.link` parity-matrix coverage, `PlayersLinked` result-schema coverage, v16
   `lover_policy` coverage for non-draftable `lovers_helper`, and command/projection
   rebuild verticals for night/day cascades plus per-recipient lover notification projection;
   Chinese source `night_kill` is mapped to canonical `wolf_night_kill`
   through validated pack `source_ids`, v35 `faction_actions` now resolves coordinated wolf
   votes with BlockAll split-vote ties, and same-target/tied wolf votes have golden plus
   command/projection rebuild coverage; Guard self-save/night-one
   policy is explicitly declared in `guard_policy`, covered by shipped and disabled-variant
   goldens plus a command/projection rebuild proof; generated N01/D01 replay lanes now include
   exact anchored `inspect_trace` decisions/generated rows]
3. Epicmafia-style variants. [partly done: Bomb trigger, Cult conversion, loyal conversion
   block, and HostDecides PK prompts are modeled in `packs/epicmafia`, covered by goldens and
   result-schema events, proven through command/projection verticals, and now covered by a
   six-case generated replay lane across D01 PK prompt resolution and N01 Bomb/Cult graphs with
   `audit_resolution`, exact anchored PK prompt issue/resolution and Cult/Loyal conversion detail
   in `inspect_trace`, and `audit_rebuild`]
4. Any copyright-free/default social-deduction pack fmarch wants to ship.
   [partly done: `default_open` is the first copyright-free default candidate with
   Citizen/Guardian/Seer/Agent roles, linter coverage through `shipped_packs_validate`,
   parity-matrix rows for the pack, actions, and majority day-vote policy, N01
   guardian-save/seer-check plus D01 majority-elimination goldens, command/projection rebuild
   verticals for both paths, and three-seed N01/D01 replay lanes under `audit_resolution`,
   exact anchored `inspect_trace` inner-event decisions, and `audit_rebuild`; it is not yet claimed
   as the final default pack]

Exit proof: each culture pack has a green linter, parity matrix, goldens, result schema
coverage, and a playable vertical scenario through the command pipeline.

### Phase 7 - Operational hardening

1. Replay tooling and resolution diff UI.
   [partly proven: `cargo run -p commands --bin audit_resolution -- <game_uuid>` scans stored
   `ResolutionApplied` / `ResolutionTrace` pairs, reruns ordinary `ResolvePhase` envelopes from
   the event-stream prefix with the stored seed/run id/logical time, reconstructs PK
   `ResolveHostPrompt` envelopes from `HostPromptIssued` + `HostPromptResolved`, emits a JSON
   `ResolutionEnvelopeAuditReport`, and exits non-zero on drift. Drifted phases now include
   compact structural `diffs[]` entries that identify the envelope side, JSON path or
   missing-envelope root, rebuilt expected value, and stored actual value; this is proven by
   command-level synthetic `ResolutionApplied` drift, `ResolutionTrace` drift, and missing-trace
   tests. CLI coverage proves `audit_resolution` exits zero and prints JSON for a matched game,
   exits non-zero on drift, and prints the same compact `summary` plus `diffs[]` JSON for a
   drifted game. The same report is exposed at host/cohost-only
   `/games/{game}/resolution-audit` JSON and `/games/{game}/resolution-audit/view` HTML, with an
   API vertical proving host success, cohost success, non-host rejection, compact `summary` /
   phase-status / drift-path JSON, and synthetic-drift HTML rendering of summary counts, phase
   status, drift path, expected/actual values, drift-row anchors, expected/actual JSON anchors,
   and summary links to the first matching drift row. Revote and skip-next-day prompt decisions
   have no `ResolutionApplied` envelope and remain covered by `host_phase_control`; `inspect_trace` plus
   `/games/{game}/resolution-traces` JSON and `/games/{game}/resolution-traces/view` HTML expose
   stored trace rows with stream anchors, decisions, redirect edges, generated actions, effect
   changes, visibility rows, and notes for operator review. The manifest-listed command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -p commands --bin audit_resolution -- 08d8a45f-6c3b-4401-8e31-8d7637f36a82`
   was rerun by `prove_game_specific_audits` against freshly seeded fixture game
   `08d8a45f-6c3b-4401-8e31-8d7637f36a82` and
   returned `ok: true`, `audited: 1`, `skipped: 0`, one matched `N01` phase, and zero drifted
   envelopes. Richer visual diff editing remains future work]
2. Host/admin trace inspection.
   [partly proven: host-prompt phase-control decisions now fold into rebuildable
   `host_phase_control` audit rows and are exposed through host/cohost-only
   `/games/{game}/host-phase-controls` JSON plus `/games/{game}/host-phase-controls/view` HTML with
   prompt id, reason, source phase, target phase, skipped phase, and resolver identity; stored
   `ResolutionTrace` rows are exposed through host/cohost-only `/games/{game}/resolution-traces`
   JSON, `/games/{game}/resolution-traces/view` HTML, and `inspect_trace`; `/games/{game}/operator`
   is a read-only host/cohost HTML index that links projection rebuild audit, resolution replay
   audit, trace inspection, host phase-control audit, and a local proof-run command index for one
   game. `/games/{game}/operator/proof-runs` is backed by `docs/ops/proof-runs.json` and exposes
   exact local-only commands for large-action, seeded determinism, generated culture-pack,
   default_open, fixture-minimizer, and checked game-specific audit-bundle proof lanes, plus
   game-specific audit CLI templates, without claiming hosted/background execution. API verticals prove host/cohost success, non-host
   rejection, `run_id` filtered rendering, anchored decision plus redirect-edge content, and
   proof-run index access control/content. An API unit test parses the manifest, rejects unknown
   manifest fields, rejects unknown command-template placeholders, requires selectors for
   `cargo test` entries, checks game/local scope consistency, and confirms each listed selector
   still names an async test in `crates/commands/tests/pipeline.rs`; the same test validates
   stable proof-run ID uniqueness/shape, and the operator vertical proves a representative
   proof-run row anchor renders.
   A seeded
   live-HTTP smoke vertical starts a local Axum server and verifies the operator index, proof-run
   index, projection rebuild view, resolution replay view, resolution trace view, host
   phase-control view, artifact go/no-go view, artifact retention JSON/view, projection rebuild
   report JSON/view, resolution diff report JSON/view, trace inspection report JSON/view, and
   retention/rebuild/resolution-diff/trace-inspection fixture views render expected headings,
   status text, links, rows, or saved-artifact paths, then writes
   repeatable DOM evidence to `target/operator-browser-smoke/live-http-dom-proof.json`.
   `npm run operator:browser-smoke` starts the Rust server on a temporary local port, seeds the same
   operator-smoke game, drives Playwright Chromium through those operator HTML surfaces including
   retention regression/recovery fixtures, projection rebuild report fixtures, and resolution diff
   report fixtures, and trace inspection report fixtures, and writes
   `target/operator-browser-smoke/playwright-dom-proof.json` plus one screenshot per page; the
   browser artifact derives selectors from `docs/ops/proof-runs.json` and checks every rendered
   `#proof-run-{id}` row anchor. Trace run
   summaries now link to anchored Decisions, Redirect Edges, Generated Actions, Effect Changes,
   Visibility, and Notes sections; decision and redirect-edge rows now have stable row anchors plus
   links to anchored JSON detail blocks; the trace vertical proves the section, row, and detail
   anchors render for a seeded trace. The manifest-listed command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -p commands --bin inspect_trace -- 08d8a45f-6c3b-4401-8e31-8d7637f36a82`
   was rerun against the same freshly seeded fixture game and returned one anchored `N01` trace
   with four decisions: result-contract validation, protected kill resolution, and the two emitted
   inner events. Interactive trace graph navigation remains future work]
3. Projection rebuild and audit commands.
   [partly proven: `cargo run -p projections --bin audit_rebuild -- <game_uuid>` snapshots
   every rebuildable projection table, replays the game stream inside a rollback-only
   transaction, emits a JSON `ProjectionAuditReport`, and exits non-zero on row drift. The same
   callable library report is exposed through host/cohost-only
   `/games/{game}/projection-audit` JSON and `/games/{game}/projection-audit/view` HTML; the API
   vertical proves host/cohost success, non-host rejection, synthetic `slot_state` projection drift
   rendering, linked drift-count summary, stable drifted-table row anchors, stable before/rebuilt
   JSON anchors, and that rollback audit does not repair the live tampered projection row. Ordinary
   `ResolvePhase` and PK host-prompt envelope drift are covered by `audit_resolution`; stored trace
   inspection is covered by `inspect_trace` and the host/cohost-only trace route; host phase-control
   JSON/HTML inspection and the host/cohost operator index link these proven surfaces from one game
   page. The manifest-listed command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -p projections --bin audit_rebuild -- 08d8a45f-6c3b-4401-8e31-8d7637f36a82`
   was rerun against the same freshly seeded fixture game and returned `ok: true` with all 13
   rebuildable projection tables matching]
4. Performance tests around large action graphs.
   [partly proven: `large_action_graph_resolves_and_audits_within_regression_ceiling` builds a
   deterministic 40-slot / 29-action Mafiascum N01 graph through legal `SubmitAction` commands
   across redirect, protect, investigative, kill, PGO, Babysitter, Hider, Hunter, and Cupid
   families, resolves with a fixed seed, validates replay audit, exact anchored trace inspection
   for result-contract, PGO, Babysitter, Hider, and Cupid rows, projection rebuild, bounded
   event/trace rows, and a 20-second local regression ceiling. This manifest-listed lane was rerun
   locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands large_action_graph_resolves_and_audits_within_regression_ceiling`
   and passed one filtered pipeline test for the fixed dense graph. This is a regression guard,
   not a production benchmark]
5. Determinism fuzzing with random but seeded scenario generation.
   [partly proven: the command pipeline now has seeded day-vote scenario generation across five
   deterministic seeds. Each generated game appends legal vote changes/withdrawals, resolves
   through `Command::ResolvePhase`, then proves `audit_resolution`, exact anchored day-vote
   inner-event decisions in `inspect_trace`, and `audit_rebuild` all stay clean. This
   manifest-listed lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands seeded_day_vote_scenarios_replay_audit_and_rebuild_deterministically -- --nocapture`
   and passed one filtered pipeline test across the five deterministic seeds. A second seeded lane now generates legal Mafiascum N01 action
   graphs across Doctor, Roleblocker, Tracker, Watcher, Bus Driver, Mafia Goon, and Strongman,
   submits through `Command::SubmitAction`, resolves, and runs the same audit trio with exact
   anchored result-contract plus representative inner-event trace decisions. This second lane was
   rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_night_action_graphs_replay_audit_and_rebuild_deterministically`
   and passed one filtered pipeline test across its five deterministic seeds. A third
   seeded lane now generates legal PGO, Babysitter, and Hider trigger/dependency graphs, then
   proves replay, exact anchored PGO trigger notes plus Babysitter/Hider dependency-death trace
   decisions, and projection rebuild audits. This third lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_trigger_dependency_graphs_replay_audit_and_rebuild_deterministically`
   and passed one filtered pipeline test across its five deterministic seeds. A fourth seeded lane now
   generates legal two-phase Hunter retaliation and Cupid/Lovers games and proves folded N01
   trigger state is consumed by N02 resolution under the same audit trio, with exact anchored N01
   state-production and N02 cascade-consumption trace decisions. This fourth lane was rerun
   locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands seeded_persistent_trigger_state_replay_audit_and_rebuild_deterministically`
   and passed one filtered pipeline test across its four deterministic seeds. The large-action-graph
   lane adds a fixed dense scenario with exact anchored trace assertions for its representative
   generated rows plus explicit event/trace/duration ceilings and was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands large_action_graph_resolves_and_audits_within_regression_ceiling`,
   passing one filtered pipeline test. A bounded property-style lane now generates six Mafiascum
   N01 cases from fixed seeds with variable role composition, target selection, and interference
   edges; every failure includes the seed, roster,
   and submitted actions so a case can be promoted to a fixed regression; `inspect_trace` now
   helper-enforces exact anchored result-contract plus representative inner-event decisions. This
   generated Mafiascum lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands generated_night_action_graphs_replay_audit_and_rebuild_deterministically`
   and passed one filtered pipeline test across its six fixed generated seeds. `minimize_night_fixture`
   now replays that seed/roster/action JSON fixture through the command pipeline and, with
   `--reduce`, greedily removes actions then slots while preserving the original failure class.
   Generated failures now print valid minimizer JSON directly, and
   `crates/commands/fixtures/night-passing.json` is a checked-in passing replay sample documented
   in the engine notes. `crates/commands/fixtures/night-babysitter-dependency-minimized.json`
   persists a four-slot, three-action Babysitter generated-death replay, and
   `crates/commands/fixtures/night-hider-dependency-minimized.json` promotes a three-slot,
   two-action Hider host-death dependency replay. `crates/commands/fixtures/night-pgo-trigger-minimized.json`
   covers the remaining trigger-note side with a two-slot, one-action PGO replay. `minimize_night_fixture`
   now asserts fixture metadata for expected inner events, anchored trace decisions, trace notes,
   and generated-action rows; the Babysitter and Hider minimized replays each pass with three
   checked semantic expectations, while the PGO replay passes with four checked semantic
   expectations including the `Trigger` inner event, generated kill, generated-action trace row,
   and anchored diagnostic note. `--reduce` now also reduces successful fixtures with expectations
   only while the same expectation count remains green. The generated Mafiascum N01 fixture JSON
   helper now emits matching `expectations` metadata for unambiguous PGO visit-trigger,
   Babysitter dependency-death, and Hider host-death cases, while avoiding inference when
   redirect/bus target mutation or obvious actor suppression is present.
   `crates/commands/fixtures/night-pgo-trigger-nonminimal.json` proves the success-shrinking path:
   `--reduce` removes the irrelevant extra slot while preserving all four declared PGO
   expectations. `--write-reduced <path>` now writes the post-reduction fixture; the non-minimal
   PGO replay was reduced into `target/operator-proof/night-pgo-trigger-reduced.tmp.json` and then
   replayed from that written artifact with one audited resolution, one trace, clean projection
   rebuild, and all four semantic expectations checked. The report now distinguishes replay
   success, failure-class preservation, and success-invariant preservation.
   `crates/commands/fixtures/night-pgo-trigger-bad-expectation.json` proves the negative
   semantic-expectation path: `--write-reduced` can save a reduced failing artifact while reporting
   `promoted_success_fixture: false`. `--write-report <path>` now persists the minimizer JSON
   report, and the generated Mafiascum N01 failure-artifact proof writes
   `target/operator-proof/generated-mafiascum-n01-bad-pgo-expectation.fixture.tmp.json`, invokes
   `minimize_night_fixture --reduce --write-reduced --write-report`, and verifies the saved report
   preserves `semantic_expectation` failure class while keeping `promoted_success_fixture: false`.
   The Chinese Structured N01 failure-artifact proof uses the same helper to write
   `target/operator-proof/generated-chinese-n01-bad-prophet-expectation.fixture.tmp.json`, shrink it,
   and verify the saved report preserves `semantic_expectation` failure class without promoting the
   fixture as a success.
   The Mafiascum and Chinese Structured N01 generated replay lanes now route their resolve,
   result validation, event-count, representative-event, audit, trace-count, anchored trace-decision,
   and projection-rebuild failures through the shrink helper before panicking; the panic message
   includes the saved report path, reduced fixture path, preservation booleans, and reduction step count.
   Setup and legal action submission failures in those N01 replay lanes use the same shrink-backed
   wrapper. The Chinese Structured D01 generated replay lane now uses the same saved artifact/minimizer
   report path for setup, action/vote submission, resolve, result validation, event extraction, audit,
   trace-count, anchored generated-row, and projection-rebuild failures. The Mafia Universe ITA
   generated replay lane now uses the same shrink-backed path for setup, action submission, resolve,
   result validation, event extraction, audit, trace-count, anchored generated-row, and projection-rebuild
   failures. The Epicmafia D01 PK loop now emits minimizer-ready vote plus host-prompt fixtures, and
   routes setup, vote submission, day resolve, prompt resolve, prompt payload validation, audit,
   trace-count, anchored trace-decision, and projection-rebuild failures through saved shrink reports.
   The Epicmafia N01 Bomb/Cult loop now routes setup, action submission, resolve, result validation,
   Bomb trigger extraction, Cult/Loyal event extraction, audit, trace-count, trace note, anchored
   generated-row, anchored trace-decision, and projection-rebuild failures through the same saved
   shrink report path. Its minimizer fixture now preserves eight N01 semantic expectations for the
   Bomb trigger, trigger-generated action row, trigger note, plain Cult conversion, Loyal
   conversion block, and conversion trace decisions. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_night_fixture_replays_semantic_expectations_through_minimizer --test pipeline -- --nocapture`
   and passed one filtered pipeline test, checking all eight expectations through
   `minimize_night_fixture`. The D01 PK minimizer fixture now also preserves the HostDecides tie
   outcome, PK prompt issue, host-selected kill, and anchored prompt issue/resolution trace
   decisions across the ordinary day and host-prompt resolution envelopes. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_pk_fixture_replays_prompt_through_minimizer --test pipeline -- --nocapture`
   and passed one filtered pipeline test, checking five PK expectations and promoting the reduced
   success fixture. The `default_open` N01/D01 generated replay lanes now use the same saved
   artifact/minimizer report path for setup, action/vote submission, resolve, result validation,
   event extraction, audit, trace-count, exact anchored trace decisions, and projection-rebuild
   failures. Their minimizer fixtures now also preserve lane-specific semantic expectations: N01
   requires the Guardian save, Seer scum result, and anchored save/investigation trace rows, while
   D01 requires the lynch outcome, day-vote kill, town win, and anchored day-vote trace row. This
   was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`
   and passed one filtered pipeline test, checking four semantic expectations for each generated
   default_open fixture through `minimize_night_fixture`. This is a reusable artifact-backed minimized replay promotion path, not true property-test shrinking. A first non-mafiascum lane
   now generates six Chinese Structured N01 cases
   from fixed seeds across Wolf, Witch, Guard, Prophet, Cupid, Hunter, Wolf Beauty, and passive
   roles, then proves `audit_resolution`, exact anchored result-contract plus representative
   inner-event decisions in `inspect_trace`, and `audit_rebuild`. This Chinese Structured N01 lane
   was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -q -p commands generated_chinese_structured_night_graphs_replay_audit_and_rebuild_deterministically`
   and passed one filtered pipeline test across its six fixed generated seeds. Those six generated
   N01 fixtures now also carry artifact-backed semantic minimizer expectations for Prophet parity
   results, Witch heal/poison x-shot use, unsaved poison kills, Guard/Witch protection decisions
   when the generated graph produces them, Cupid lover links plus private lover notices, Hunter
   `RetaliationArmed`, and Wolf Beauty persistent mark rows. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_chinese_structured_night_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`
   and passed one filtered pipeline test across all six fixed seeds, checking every generated
   Chinese N01 semantic expectation through `minimize_night_fixture`. `minimize_night_fixture` now
   also accepts real command-submitted `setup_phases`, so folded-state Chinese cascade fixtures can
   seed an N01 setup phase before minimizing the target N02. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands chinese_folded_state_cascade_fixtures_replay_semantic_expectations_through_minimizer --test pipeline -- --nocapture`
   and passed one filtered pipeline test covering Wolf Beauty drag after prior mark, Cupid
   lover-suicide after prior link, Hunter retaliation after prior target choice, and Hunter poison
   suppression after prior target choice. A second
   non-mafiascum lane now generates six Chinese Structured D01 cases from fixed seeds with legal
   sheriff election, Knight duel, White Wolf self-destruct, and ordinary vote submissions, then
   proves the same audit trio plus exact anchored BadgeChanged, DuelResolved, and
   WolfSelfDestructed generated rows. This Chinese Structured D01 lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_chinese_structured_day_graphs_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`
   and passed one filtered pipeline test across its six fixed generated seeds. A third
   non-mafiascum lane now generates six Mafia Universe D01 ITA sessions from fixed seeds with
   legal command submissions, four queued shots, mixed deterministic hit/miss outcomes under the
   pack's 50 percent ITA policy, exact anchored hit/miss generated rows in `inspect_trace`, and
   the same audit trio. This Mafia Universe ITA lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_mafia_universe_ita_sessions_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`
   and passed one filtered pipeline test across its six fixed generated seeds. The generated Chinese
   Structured D01 and Mafia Universe ITA fixtures now also carry artifact-backed semantic minimizer
   expectations for sheriff badge election, Knight duel x-shot/death semantics, White Wolf
   self-destruct generated rows, ITA session open/update/close rows, every queued/resolved ITA shot,
   and generic ITA hit/miss outcomes. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline generated_phase5_day_fixtures_replay_semantic_expectations_through_minimizer -- --nocapture`
   and passed one filtered pipeline test across all twelve fixed D01 seeds, checking every emitted
   Phase 5 day semantic expectation through `minimize_night_fixture`. Dedicated Phase 5
   announcement/prompt fixtures now also prove that minimization preserves Mafia Universe
   prior-night `DayAnnouncement`, lynch `LastWordsRecorded`, trailing `PhaseAnnouncement`, and
   Mafiascum NoMajority revote `HostPromptIssued` plus prompt trace decisions.
   `minimize_night_fixture` prompt fixtures now carry the command-native `HostPromptDecision`
   shape and can assert stream-level prompt resolution effects; the Mafiascum NoMajority fixture
   now acknowledges the prompt and checks `HostPromptResolved` plus prompt-driven
   `PhaseAdvanced { phase_id: "D01R1", reason: "revote" }`. This was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands --test pipeline phase5_day_note_and_revote_prompt_fixtures_replay_semantic_expectations_through_minimizer -- --nocapture`
   and passed one filtered pipeline test across the command-resolved setup-plus-day announcement
   fixture and the no-majority revote prompt-resolution fixture, checking every emitted semantic
   expectation through `minimize_night_fixture`. A fourth
   non-mafiascum lane now generates three Epicmafia D01 PK prompt cases and three
   Epicmafia N01 Bomb/Cult cases from fixed seeds, proving the same audit trio across host-prompt
   resolution and night action graphs; PK prompt issue/resolution, Bomb trigger note/generated
   rows, Bomb/Cult/Loyal inner-event rows, and Cult/Loyal conversion decisions now have exact
   anchored `inspect_trace` detail in that lane. This Epicmafia lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_epicmafia_pk_bomb_cult_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`
   and passed one filtered pipeline test across its six fixed generated seeds. A fifth
   non-mafiascum lane now generates three
   `default_open` N01 Guardian/Seer/Agent cases and three `default_open` D01
   majority-elimination cases from fixed seeds, proving the same audit trio plus exact anchored
   N01 investigation and D01 day-vote inner-event trace decisions for the first copyright-free
   default candidate. The `default_open` N01 lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_night_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`
   and passed one filtered pipeline test across its three fixed generated seeds. The `default_open`
   D01 lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands generated_default_open_day_replay_audit_and_rebuild_deterministically --test pipeline -- --nocapture`
   and passed one filtered pipeline test across its three fixed generated seeds. The fixed
   `host_resolve_phase_carries_default_open_guardian_seer` vertical now helper-enforces
   exact anchored N01 result-contract, saved-target, and investigation trace rows and was rerun
   locally with `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands host_resolve_phase_carries_default_open_guardian_seer`,
   passing one filtered pipeline test. The fixed `host_resolve_phase_carries_default_open_day_majority`
   vertical now helper-enforces exact anchored D01 result-contract, day-vote, lynch-death, and win
   trace rows and was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo test -p commands host_resolve_phase_carries_default_open_day_majority`,
   passing one filtered pipeline test. This remains local command/projection proof for the
   copyright-free default candidate. `audit_resolution` now treats
   tiny `jsonb` floating-point rendering differences as numeric equality while keeping the replayed
   JSON structure exact. The manifest-listed fixture minimizer lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin minimize_night_fixture -- crates/commands/fixtures/night-passing.json`
   and replayed the checked-in fixture with one audited resolution, one trace, and clean projection
   rebuild. The manifest-listed checked game-specific audit bundle was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --output target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json crates/commands/fixtures/night-passing.json`;
   it created fixture game `08d8a45f-6c3b-4401-8e31-8d7637f36a82`, expanded and executed the three
   game-specific manifest templates for that id, wrote
   `target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json` atomically, and failed
   no checks: projection rebuild matched all 13 rebuildable tables, resolution replay matched one
   `N01` envelope pair with zero drift, and trace inspection returned one anchored `N01` trace with
   four decisions. The operator proof-run page renders manifest-listed artifact paths display-only
   and, when local JSON parses successfully with an internal `artifact_path` matching the manifest
   row and a compatible `manifest_version`, also renders `game_id`, `manifest_version`, and
   `retention_comparison.normalized_match` plus filesystem `modified_at_unix_seconds`,
   `age_seconds`, and the manifest's `freshness_max_age_seconds`. Missing, malformed, stale,
   path-mismatched, or version-mismatched local artifacts remain inert page metadata with no server
   execution. The proof-run page header and status JSON also expose compact production/fixture
   artifact summaries: production rows must be trusted for the browser smoke to pass, while fixture
   rows are allowed to exercise negative states. The retention lane was rerun locally with
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin prove_game_specific_audits -- --compare-with target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json --output target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json crates/commands/fixtures/night-passing.json`;
   it created fixture game `3e3cccc1-c837-46d3-b0d6-1b83ae0cc82b`, wrote
   `target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json`, and returned
   `retention_comparison.normalized_match: true` after normalizing `game_id`, `artifact_path`,
   command-embedded game UUIDs, `run_id`, `applied_stream_seq`, and `trace_stream_seq`. A completion
   audit found the original 15 local-only proof rows in `docs/ops/proof-runs.json` have current
   local evidence here and in the engine notes. This remains local CLI evidence for freshly seeded
   stored fixture games, not hosted/background execution evidence. The host/cohost operator proof-run HTML vertical
   was rerun with both local artifact files present and now asserts both artifact paths render for
   authorized hosts/cohosts, while preserving non-host rejection and the page's "server page does not
   execute background jobs" boundary. This proves hosted display of existing local artifacts, not
   server-side artifact production. `docs/ops/proof-runs.json` now declares
   `artifact_freshness_max_age_seconds: 86400`, making local proof artifacts stale after one day. A
   focused API unit test covers missing, malformed, stale, path-mismatched, version-mismatched, and
   valid artifact JSON fixtures and proves only valid fresh path/version-matching JSON renders
   parsed metadata. A query-gated `fixture=artifact-provenance` row suite now points at missing,
   malformed, stale, path-mismatched, and version-mismatched local artifact fixtures; the
   host/cohost API vertical, the live HTTP smoke vertical, and `npm run operator:browser-smoke`
   prove those rows render `artifact not present locally`, `artifact metadata unreadable`,
   `artifact stale`, `artifact path mismatch`, and `artifact manifest version incompatible` while
   row-local `game_id`, `manifest_version`, and `retention_comparison.normalized_match` metadata are
   absent. The host/cohost-only
   `/games/{game}/operator/proof-runs/status` JSON endpoint mirrors the HTML table without
   executing commands. Its current contract is `contract_version: 1`: the root carries game id,
   manifest version, execution mode, production/fixture summary counts, and row families; each row
   carries stable ids, fixture scope, rendered command, proof boundary, optional artifact path,
   artifact state (`missing`, `malformed`, `stale`, `path_mismatch`, `version_mismatch`,
   `input_mismatch`, `drifted`, or `trusted`), freshness fields for trusted/stale/drifted
   artifacts, and trusted metadata only for fresh path/version-matching game-audit artifacts. A
   focused shared `commands::operator_proof` unit test validates the versioned shape, row-derived
   summary counts, and state-specific fields across all eight
   artifact states. The proof-run manifest parser, artifact classifier, status builder, contract
   DTO, and fixture rows now live in `commands::operator_proof`, so the HTTP JSON endpoint and HTML
   page render the same shared model. The no-server
   `cargo run -q -p commands --bin export_operator_proof_status -- <game> --fixture
   artifact-provenance` exporter emits that same `contract_version: 1` JSON without starting Axum,
   touching Postgres, or executing proof commands. The saved snapshot
   `crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json` captures the
   audited `artifact-provenance` contract projection with normalized game ids and artifact age/mtime
   fields. `cargo run -q -p commands --bin audit_operator_proof_status -- --output
   target/operator-proof/current-status-audit-report.json
   crates/commands/fixtures/operator-proof-status-artifact-provenance.snapshot.json
   target/operator-proof/current-status-audit-check.json` compares two status JSON files, writes the
   saved audit report artifact, normalizes `$.game`, game ids embedded in command text,
   `modified_at_unix_seconds`, and `age_seconds`, and reports row-addressed JSON-path drift for
   command text, artifact states, freshness ceilings, mismatch metadata, trusted metadata, and
   row-derived summary counts; the command exits nonzero on drift. Focused shared-module tests prove a fresh `artifact-provenance`
   export matches that saved snapshot and that mutating `checked-game-specific-audit-bundle`
   reports `$.rows["checked-game-specific-audit-bundle"].artifact.state`.
   `docs/ops/proof-runs.json` now publishes two local-only rows for those commands:
   `operator-proof-status-export` and `operator-proof-status-snapshot-audit`, both with exact proof
   boundaries and stable `#proof-run-{id}` anchors. The status-audit row is now a
   provenance-tracked production artifact: the manifest declares
   `artifact_kind: operator_proof_status_audit_report`, expected input paths, freshness, manifest
   version, and diff count; the shared classifier distinguishes missing, malformed, stale,
   path-mismatched, input-mismatched, drifted, and trusted saved reports. The same API vertical proves the v1 contract for
   all five trusted artifact rows and all five untrusted fixture rows, plus the artifact-less
   status export row, non-host rejection, and summary counts (`production.trusted = 11`,
   `production.non_trusted = 0`, `fixtures.non_trusted = 5`), and compares the host/cohost HTTP
   status JSON with the no-server shared model after normalizing the current game id and
   wall-clock-derived artifact age/mtime fields. The host/cohost-only
   `/operator/proof-runs/status-audit` JSON route reads the saved
   `target/operator-proof/current-status-audit-report.json` artifact and the companion
   `/operator/proof-runs/status-audit/view` page renders the same normalized-field list, expected
   and actual input paths, saved report path, and row-addressed diffs without executing proof
   commands. The query-gated `fixture=artifact-state-drift` route mutates only the in-memory actual
   status JSON and proves that a non-empty
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
   compact report carries the large-action graph row's game id, elapsed milliseconds, threshold,
   trace row count, and phase/decision trace-anchor booleans, plus the determinism fuzz row's
   actual and expected family/seed counts and manifest-match boolean, so operators can audit those
   proof claims without opening the underlying JSON files. The host/cohost-only
   `/operator/proof-runs/go-no-go` JSON route and companion `/operator/proof-runs/go-no-go/view`
   page read that saved report without executing commands. Query-gated
   `fixture=missing-production-artifact`,
   `fixture=stale-production-artifact`, and `fixture=drifted-production-artifact` modes prove
   production no-go states are visible in JSON and HTML with `production.non_trusted = 1`.
   The host/cohost API vertical, seeded live HTTP smoke, and `npm run operator:browser-smoke` now
   assert the go/no-go JSON row metadata and rendered HTML for the large-action trace
   counters/anchor booleans and determinism actual/expected family and seed counters.
   The live HTTP smoke vertical and
   `npm run operator:browser-smoke`
   were also rerun after both artifacts existed; their DOM evidence files
   `target/operator-browser-smoke/live-http-dom-proof.json` and
   `target/operator-browser-smoke/playwright-dom-proof.json` both record the base artifact path,
   the retention artifact path, the status-audit report path, the go/no-go report path, both parsed
   `game_id` values, `manifest_version: 1`,
   `retention_comparison.normalized_match: true`, the five provenance fixture rows, their
   untrusted markers, freshness checks, compact summary counts, and the retention lane's
   `--compare-with` command text on the proof-run page. The live HTTP artifact also records
   proof-run status JSON contract checks, and the Playwright artifact records browser-fetched JSON
   `contract_version: 1`, row-derived summary, and state-specific artifact checks. The Playwright
   smoke now fails if any production manifest artifact row is not `trusted`, while still allowing
   query-gated fixture rows to prove negative states, and the go/no-go page evidence includes the
   large-action and determinism trusted metadata text. The Playwright run also wrote
   `target/operator-browser-smoke/operator-proof-runs.png`.
   Artifact doc-truth rows for `docs/ops/proof-runs.json`: `checked-game-specific-audit-bundle`
   currently has artifact state `trusted`, artifact path
   `target/operator-proof/game-specific-audit-bundle-20260613T000000Z.json`, and proof boundary
   `Seeds a fixture-backed game, expands the manifest's game-specific command templates for that id,
   executes them, and fails on mismatched audit counts.` `game-specific-audit-artifact-retention`
   currently has artifact state `trusted`, artifact path
   `target/operator-proof/game-specific-audit-bundle-20260613T001500Z.json`, and proof boundary
   `Regenerates the checked game-specific bundle and fails unless the old and new reports match
   after normalizing expected rerun drift fields.` `operator-proof-status-snapshot-audit`
   currently has artifact state `trusted`, artifact path
   `target/operator-proof/current-status-audit-report.json`, and proof boundary `Compares the saved
   normalized artifact-provenance status snapshot against the latest exported status, writes the
   audit report artifact, and fails on row-addressed contract drift.` `operator-proof-artifact-go-no-go`
   currently has artifact state `trusted`, artifact path
   `target/operator-proof/current-artifact-go-no-go-report.json`, rendered command
   `cargo run -q -p commands --bin audit_operator_proof_artifacts -- --output
   target/operator-proof/current-artifact-go-no-go-report.json
   00000000-0000-0000-0000-000000000000`, and proof boundary `Loads the
   published proof-run manifest, classifies artifact-provenance rows, writes the compact go/no-go
   report with trusted metadata for artifact rows that have proof-specific counters, and fails if
   any production artifact row is not trusted.`
   `operator-proof-artifact-retention` currently has artifact state `trusted`, artifact path
   `target/operator-proof/current-artifact-retention-report.json`, rendered command
   `cargo run -q -p commands --bin audit_operator_proof_artifact_retention -- --output
   target/operator-proof/current-artifact-retention-report.json
   target/operator-proof/previous-artifact-go-no-go-report.json
   target/operator-proof/current-artifact-go-no-go-report.json`, and proof boundary `Compares the
   previous and current go/no-go reports after normalizing wall-clock freshness and fails on
   production artifact state regressions.`
   `operator-proof-projection-rebuild` currently has artifact state `trusted`, artifact path
   `target/operator-proof/current-projection-rebuild-report.json`, rendered command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
   audit_projection_rebuild_artifact -- --output
   target/operator-proof/current-projection-rebuild-report.json
   08d8a45f-6c3b-4401-8e31-8d7637f36a82`, and proof boundary `Runs the projection rebuild audit
   for the checked fixture game inside a rollback-only transaction, writes a versioned report with
   table counts, and fails on rebuild drift.`
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
   path `target/operator-proof/current-large-action-graph-performance-report.json`, rendered
   command `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands
   --bin audit_large_action_graph_performance_artifact -- --output
   target/operator-proof/current-large-action-graph-performance-report.json`, and proof boundary
   `Runs the dense Mafiascum N01 large-action-graph scenario, writes a versioned report with
   fixture dimensions, replay/projection status, trace row count, explicit phase/decision trace
   anchoring flags, elapsed milliseconds, and the configured regression ceiling, and fails when
   the ceiling, audits, or trace anchors fail.` This command was rerun locally after refreshing the
   dev database to the current projection migrations and emitted `ok: true`, `trace_row_count: 72`,
   `phase_trace_anchored: true`, and `decision_trace_anchored: true`.
   `operator-proof-determinism-fuzz` currently has artifact state `trusted`, artifact path
   `target/operator-proof/current-determinism-fuzz-report.json`, rendered command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
   audit_determinism_fuzz_artifact -- --output
   target/operator-proof/current-determinism-fuzz-report.json`, and proof boundary `Runs the known
   seeded command-pipeline replay/projection/trace scenario families as local Postgres integration
   tests, writes a versioned report with exact expected family/seed manifest coverage and first
   failing seed, and fails on failed, missing, or manifest-mismatched seeded families; this is
   deterministic generator coverage, not exhaustive state-space verification.` This command was
   rerun locally and emitted `ok: true`, `family_count: 11`, `seed_count: 55`,
   `expected_family_count: 11`, `expected_seed_count: 55`, and `family_manifest_matched: true`.
   `operator-proof-command-projection-resolution` currently has artifact state `trusted`, artifact
   path `target/operator-proof/current-command-projection-resolution-report.json`, rendered command
   `DATABASE_URL=postgres://fmarch:fmarch@localhost:5544/fmarch cargo run -q -p commands --bin
   prove_command_projection_resolution -- --output
   target/operator-proof/current-command-projection-resolution-report.json
   crates/commands/fixtures/night-passing.json`, and proof boundary `Local-Postgres-only proof:
   seeds the checked fixture through commands::handle, runs Command::ResolvePhase against the local
   DATABASE_URL Postgres service, compares resolution replay and projection rebuild results for that
   generated game, writes the saved report under target/operator-proof, and does not prove hosted,
   multi-node, production, browser, or exhaustive state-space behavior.` This command was run
   against a scratch database on the local Postgres service and emitted `ok: true`, 20 matched
   projection tables, one matched resolution envelope, zero drifted tables, zero drifted phases, and
   zero diffs.
   The API manifest unit test now mechanically checks those artifact doc-truth rows in both the
   engine note and this checklist: every manifest row with an `artifact_path` must have its artifact
   path, rendered command, exact proof boundary, current `trusted` artifact state, and production
   go/no-go counts documented.
   The report-only completion audit now runs as
   `python3 tools/engine_port_completion_audit.py --output
   target/operator-proof/current-engine-port-completion-audit.json` after regenerating the
   im-human inventory/parity matrix with `python3 tools/im_human_engine_inventory.py --fmarch-root
   .`. Read-only consumers can use `python3 tools/engine_port_completion_audit.py --check --output
   target/operator-proof/current-engine-port-completion-audit.json`; it does not rewrite the saved
   artifact, and fails if the saved audit is missing, stale versus any declared input, or different
   from the generated report. The current artifact reports `ok: false`, `freshness.status: fresh`,
   19 tracked inputs, eight parsed build-order phases, 192 exhaustive checklist rows, 192 checked
   rows, 0 unchecked rows, zero rows marked `partly proven`, 593 parity-matrix rows, 2
   unsupported parity rows, 0 actionable unsupported rows, and 2 explicit out-of-scope test-family
   rows (`feature_flags_test` and `init`). Mafia Universe now models `vanilla_town`, `blank_town_role`,
   `blank_mafia_role`, `mafia_doctor`, `mafia_bodyguard`, `mafia_jailkeeper`,
   `town_alignment_cop`, `mafia_alignment_cop`, `mafia_cop`, `town_voyeur`, `mafia_voyeur`,
   `town_alignment_oracle`, `mafia_alignment_oracle`, `town_role_oracle`,
   `mafia_role_oracle`, `town_janitor`, `mafia_janitor`, `town_universal_backup`,
   `mafia_universal_backup`, and `serial_killer`; its
   `serial_killer_kill` is a standard-NAR protectable/blockable kill cause, with pure golden and
   Postgres private-result/rebuild proof covering the alias roles. Mafiascum `mailman`, `observe`, and `report` now map to v54
   `InfoResult` through canonical `Info` actions and the new `player_info_result` projection,
   covering the generic info scan/mail/report surface; Mafiascum source `result_mod` is now mapped for canonical Framer
   `frame` and Lawyer `lawyer_cover`, and the `result_mod` primitive is covered as
   `Mark+investigation_overrides`; Mafiascum source `kill` aliases are now mapped for the canonical
   day-vigilante, vigilante, mafia-goon, ninja, and serial-killer kill templates, source role
   aliases now map `goon`, `janitor`, `mafia_ninja`, `mafia_strongman`, and vanilla-mafia
   `werewolf` to their canonical pack roles, and `serial_killer` is now a real independent role with
   pure goldens plus Postgres `ResolvePhase` verticals for both the sole-survivor win and the living
   independent blocking mafia parity through v53 `win.rules[].blocked_by_alive`. The primitive/modifier interaction proof artifact records
   68 covered product-pack interactions across 42 unique primitive/modifier pairs, zero uncovered
   interactions, and five explicit unsupported primitive/modifier parity rows. The Engine V4
   test-family coverage artifact maps all 28 source-derived test-family buckets, with 26 mapped to
   fmarch proof surfaces and two explicit out-of-scope/non-resolution buckets. The unported
   im-human inventory artifact reports only those 2 explicit out-of-scope unsupported parity rows,
   including zero unsupported primitive, modifier, result-event, and culture-note rows; the
   completion audit treats those explicit out-of-scope rows as visible but non-actionable and
   blocks completion on the remaining partial build-order phases instead. The no-Postgres domain CI artifact
   reports `ok: true`, four passed lanes, zero failed lanes, 14 golden-owning pack directories, 303
   checked golden fixtures, and Rust validator totals of 455 golden-harness tests, 66
   result-contract tests, and 146 pack-validation tests. It also records `browser_smoke.ok: true`, 42 rendered HTML pages, one
   browser-fetched JSON surface, all 10 existing browser-smoke-required go/no-go metadata needles
   present, trusted metadata rows for large-action and determinism proof rows, and a manifest/status
   trusted command/projection proof row that has not yet been promoted into the browser-smoke
   required needle set. The local-Postgres
   command/projection artifact reports `ok: true`, one matched `Command::ResolvePhase` resolution
   envelope, 20 matched projection tables, zero drifted tables, zero drifted phases, and zero
   diffs, with proof boundary limited to a scratch database on the local Postgres service. Broader
   culture-pack generation, production benchmark coverage, hosted/operator production capture, and
   true property-test shrinking remain future work]

Exit proof: a stored game can be replayed from event zero and produce semantically identical
resolution envelopes and projections.

## Recommended next slice

Continue Phase 5 rich day systems by widening semantic minimizer coverage across unresolved
host-decision shapes: Beloved Princess skip-next-day prompt resolution and any PK prompt variants
not already covered by the Epicmafia generated lane. Start by reusing the command-native
`HostPromptDecision` fixture shape for a skip-next-day prompt, then prove `HostPromptResolved`,
prompt-driven `PhaseAdvanced { reason: "skip_next_day" }`, projection rebuild, and minimized
success promotion before widening to additional culture-pack variants.
