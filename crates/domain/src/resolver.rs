//! The pure, deterministic resolver (doc 09).
//!
//! `resolve(ResolutionInput) -> Vec<InnerEvent>` implements the night and day
//! pipelines the goldens exercise. Determinism is mandatory: resolution order is
//! driven by the canonical phase order (Block -> Redirect -> Protect -> Kill ->
//! Investigate) and, within an ability, descending `Constraints.priority` then
//! stable submission ordering. No hash-map iteration order ever reaches output.

use std::collections::BTreeMap;

use crate::events::{DayVoteOutcome, Death, InnerEvent, PhaseAnnouncement, VoteStatus};
use crate::ir::{InvestigateMode, IrAbility, Modifier};
use crate::pack::{
    ActionTemplate, ActorRef, Pack, PhaseKind, TargetRef, TieBreaker, TriggerRule, VoteMethod,
    VoteTieBreaker, WeightPolicy, WinCondition,
};
use crate::state::{apply_events, PhaseId, Seed, SlotId, SlotState, StateSnapshot, Submission};

/// Resolver contract version (doc 10 `result_version`).
pub const RESULT_VERSION: u16 = 1;

pub struct ResolutionInput {
    pub game_id: String,
    pub phase_id: PhaseId,
    pub state: StateSnapshot,
    pub submissions: Vec<Submission>,
    pub pack: Pack,
    pub seed: Seed,
}

/// A tiny deterministic PRNG (SplitMix64), seeded from `Seed`. The shipped pack
/// uses only `Stable`/`NoElimination` tie-breakers, so this is currently unused
/// for the goldens; it exists so any future `Random` tie-break stays seeded and
/// reproducible rather than reaching for system randomness.
#[allow(dead_code)]
struct DetRng(u64);

#[allow(dead_code)]
impl DetRng {
    fn new(seed: Seed) -> Self {
        DetRng(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// One resolved night action: a submission paired with its role action template.
struct Action<'a> {
    sub: &'a Submission,
    template: &'a ActionTemplate,
    /// Live targets (after any redirect rewrite).
    targets: Vec<SlotId>,
    blocked: bool,
}

impl<'a> Action<'a> {
    fn ability(&self) -> IrAbility {
        self.template.ability
    }
}

/// A landed kill: a (target, attacker) pair, recorded so triggers can react to it
/// after core resolution. `target` is the slot that died; `attacker` is the slot
/// credited with the kill (empty-string-free — every recorded kill has an actor).
#[derive(Clone)]
struct KillRecord {
    target: SlotId,
    attacker: SlotId,
}

/// Resolve a single kill against `target` by `attacker` (template id `cause`).
/// `unstoppable` is the already-computed Strongman bypass flag for this kill.
/// Pushes `PlayerSaved` (if protected and not bypassed) or `PlayerKilled`, and on
/// a death records the slot in `killed` and a `KillRecord` in `log`.
#[allow(clippy::too_many_arguments)]
fn resolve_one_kill(
    target: &SlotId,
    attacker: &SlotId,
    cause: &str,
    unstoppable: bool,
    protections: &BTreeMap<SlotId, Vec<SlotId>>,
    events: &mut Vec<InnerEvent>,
    killed: &mut Vec<SlotId>,
    log: &mut Vec<KillRecord>,
) {
    // A slot already killed this resolution is not killed twice.
    if killed.contains(target) {
        return;
    }
    let protectors = protections.get(target);
    let protected = protectors.map(|p| !p.is_empty()).unwrap_or(false);
    if protected && !unstoppable {
        let sources = protectors.cloned().unwrap_or_default();
        events.push(InnerEvent::PlayerSaved {
            slot_id: target.clone(),
            reasons: vec!["protected".to_string()],
            sources,
        });
    } else {
        killed.push(target.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: target.clone(),
            cause: cause.to_string(),
            attackers: vec![attacker.clone()],
            unstoppable,
        });
        log.push(KillRecord {
            target: target.clone(),
            attacker: attacker.clone(),
        });
    }
}

/// Is a role immune to conversion? A role is immune iff it carries the `Loyal`
/// modifier on any of its actions, or its role-level `effects` include a
/// pack-configured immune tag (`"loyal"`). v1 uses the `"loyal"` effect tag and
/// the `Loyal` modifier interchangeably as the conversion-immunity signal.
fn conversion_immune(input: &ResolutionInput, role_key: &str) -> bool {
    let Some(role) = input.pack.roles.get(role_key) else {
        return false;
    };
    if role.effects.iter().any(|e| e == "loyal") {
        return true;
    }
    role.actions.iter().any(|a| a.has_modifier(Modifier::Loyal))
}

/// Does a trigger's `if_target_has` match a slot? The slot matches iff it carries
/// every named tag among its persistent `effects` OR (for modifier tags) one of
/// its role's actions carries the corresponding modifier. v1 matches on the
/// slot's `effects` tags (e.g. the `"bomb"` effect carried by the Bomb role).
fn trigger_target_matches(trig: &TriggerRule, slot: &SlotState) -> bool {
    trig.if_target_has
        .iter()
        .all(|tag| slot.effects.contains(tag))
}

/// Resolve a window's submissions into ordered inner events.
///
/// Canonical inner-event ordering: the phase's own results, then the single
/// trailing `PhaseAnnouncement` (doc 10), then — iff the post-resolution state
/// satisfies a `WinPolicy` rule — a final `WinReached`. Win-check runs **once**,
/// at phase end, on the state produced by folding this resolution's events
/// (`apply_events`); it never runs mid-resolution.
pub fn resolve(input: ResolutionInput) -> Vec<InnerEvent> {
    let mut events = match input.state.phase_kind {
        PhaseKind::Day | PhaseKind::Twilight => resolve_day(&input),
        PhaseKind::Night => resolve_night(&input),
    };

    // Evaluate win conditions on the post-resolution state. The win event is the
    // FINAL inner event, appended after the trailing PhaseAnnouncement.
    //
    // R1: the day **lynch** now emits a `PlayerKilled { cause: "lynch" }` (see
    // `resolve_day`), so the eliminated slot folds through `apply_events` exactly
    // like a night kill. There is no longer a local "apply the lynch just for the
    // win-check" hack — the post-resolution state is a single, uniform fold.
    let post_state = apply_events(&input.state, &events);
    if let Some(win) = check_win(&post_state, &input.pack) {
        events.push(win);
    }

    events
}

/// Evaluate the pack's `WinPolicy` against a (post-resolution) state. Rules are
/// tried in order; the FIRST match wins and yields a `WinReached`. Returns
/// `None` if no rule fires. PURE: a fold over alive-counts, no clock/RNG.
pub fn check_win(state: &StateSnapshot, pack: &Pack) -> Option<InnerEvent> {
    for rule in &pack.win.rules {
        let (fires, reason) = match &rule.when {
            WinCondition::FactionEliminated(faction) => {
                let alive = alive_in_faction(state, faction);
                (
                    alive == 0,
                    format!("faction {faction} eliminated (0 alive)"),
                )
            }
            WinCondition::FactionReachesParity(faction) => {
                let alive = alive_in_faction(state, faction);
                let others = alive_total(state) - alive;
                (
                    alive > 0 && alive >= others,
                    format!("faction {faction} reaches parity ({alive} vs {others} others)"),
                )
            }
            WinCondition::AllOtherFactionsEliminated(faction) => {
                // R5: faction `f` is the sole surviving faction. Every other
                // alive slot (any other alignment, or alignment-less) must be 0,
                // and `f` must have >= 1 alive.
                let alive = alive_in_faction(state, faction);
                let others = alive_total(state) - alive;
                (
                    alive > 0 && others == 0,
                    format!("all factions other than {faction} eliminated ({alive} alive)"),
                )
            }
        };
        if fires {
            return Some(InnerEvent::WinReached {
                winner: rule.winner.clone(),
                reason,
                metadata: serde_json::Value::Null,
            });
        }
    }
    None
}

/// Count alive slots whose alignment equals `faction`.
fn alive_in_faction(state: &StateSnapshot, faction: &str) -> usize {
    state
        .slots
        .iter()
        .filter(|s| s.is_alive() && s.alignment.as_deref() == Some(faction))
        .count()
}

/// Total alive slots, all factions (and alignment-less slots) included.
fn alive_total(state: &StateSnapshot) -> usize {
    state.slots.iter().filter(|s| s.is_alive()).count()
}

// ───────────────────────────── Night ─────────────────────────────

fn resolve_night(input: &ResolutionInput) -> Vec<InnerEvent> {
    let pack = &input.pack;

    // Build the action list from non-withdrawn submissions, resolving each to
    // its role's action template. Submissions whose template can't be found are
    // dropped (the platform owns submission legality; the engine is total).
    let mut actions: Vec<Action> = Vec::new();
    for sub in &input.submissions {
        if sub.withdrawn {
            continue;
        }
        let Some(template) = lookup_template(input, &sub.actor, &sub.template_id) else {
            continue;
        };
        actions.push(Action {
            sub,
            template,
            targets: sub.targets.clone(),
            blocked: false,
        });
    }

    let mut events: Vec<InnerEvent> = Vec::new();
    // Determinism diagnostics (trigger loop-cap hits). Trace-bound; see below.
    let mut trigger_notes: Vec<String> = Vec::new();

    // ── Phase 1: Block ── highest-priority interaction; evaluated before any
    // blocked action reads its targets.
    let mut blocked_slots: Vec<SlotId> = Vec::new();
    for idx in ability_order(&actions, IrAbility::Block) {
        for t in &actions[idx].targets {
            if !blocked_slots.contains(t) {
                blocked_slots.push(t.clone());
            }
        }
    }
    // Mark roleblockable actions whose actor was blocked; emit interference and
    // suppress their result. (A Block is itself not roleblockable in the pack.)
    for action in &mut actions {
        if action.template.constraints.roleblockable && blocked_slots.contains(&action.sub.actor) {
            action.blocked = true;
        }
    }
    for action in &actions {
        if action.blocked {
            events.push(InnerEvent::ActionInterfered {
                actor: action.sub.actor.clone(),
                reason: "roleblocked".to_string(),
            });
        }
    }

    // ── Phase 2: Redirect ── bus driver rewrites target maps before
    // Kill/Protect/Investigate read their targets. A roleblocked bus driver does
    // not swap.
    let swap = build_swap_map(&actions, pack);
    if !swap.is_empty() {
        for action in &mut actions {
            if action.blocked {
                continue;
            }
            if matches!(
                action.ability(),
                IrAbility::Kill | IrAbility::Protect | IrAbility::Investigate
            ) {
                for t in &mut action.targets {
                    if let Some(dest) = swap.get(t) {
                        *t = dest.clone();
                    }
                }
            }
        }
    }

    // ── Phase 3: Mark / Clear ── persistent-effect writes (doc 09). A blocked
    // marker does not write. `EffectsMarked`/`EffectsCleared` fold across phases
    // via `apply_events`, so a tag written this night is readable next night
    // (the Arsonist's "doused" tag is the canonical cross-phase carrier). These
    // are emitted BEFORE Kill so an ignite that `reads_effect` sees this night's
    // own douses too if a pack ever wants same-night ignition; the shipped
    // Arsonist douses one night and ignites the next.
    for idx in ability_order(&actions, IrAbility::Mark) {
        if actions[idx].blocked {
            continue;
        }
        let Some(effect) = actions[idx].template.effect.clone() else {
            continue; // Mark REQUIRES an effect tag; malformed templates are skipped.
        };
        let actor = actions[idx].sub.actor.clone();
        for target in actions[idx].targets.clone() {
            events.push(InnerEvent::EffectsMarked {
                effect: effect.clone(),
                target,
                actor: actor.clone(),
            });
        }
    }
    for idx in ability_order(&actions, IrAbility::Clear) {
        if actions[idx].blocked {
            continue;
        }
        let Some(effect) = actions[idx].template.effect.clone() else {
            continue;
        };
        let actor = actions[idx].sub.actor.clone();
        let targets = actions[idx].targets.clone();
        if !targets.is_empty() {
            events.push(InnerEvent::EffectsCleared {
                effect,
                targets,
                actor,
            });
        }
    }

    // ── Phase 4: Protect ── collect protected slots -> protecting sources.
    let mut protections: BTreeMap<SlotId, Vec<SlotId>> = BTreeMap::new();
    for idx in ability_order(&actions, IrAbility::Protect) {
        if actions[idx].blocked {
            continue;
        }
        let actor = actions[idx].sub.actor.clone();
        for t in actions[idx].targets.clone() {
            protections.entry(t).or_default().push(actor.clone());
        }
    }

    // ── Phase 5: Kill ── Protect beats Kill UNLESS the Kill carries Strongman
    // (protect_beats_kill.unless_modifiers inspects the BEATEN action = the Kill).
    let strongman_bypasses_protect = protect_beats_kill_unless_strongman(pack);
    // Slots that got PlayerKilled this resolution, in event order — surfaced as
    // the trailing PhaseAnnouncement's deaths (doc 10). Each kill is also recorded
    // (target -> attacker) so triggers can react to it after core resolution.
    let mut killed: Vec<SlotId> = Vec::new();
    let mut kill_log: Vec<KillRecord> = Vec::new();
    for idx in ability_order(&actions, IrAbility::Kill) {
        if actions[idx].blocked {
            continue;
        }
        let cause = actions[idx].template.id.clone();
        let attacker = actions[idx].sub.actor.clone();
        let is_strongman = actions[idx].template.has_modifier(Modifier::Strongman);
        // An ignite-style Kill `reads_effect`: its targets are every slot
        // currently carrying that persistent effect tag, in stable slot order —
        // NOT the submitted targets. This is the cross-phase effect read.
        let targets: Vec<SlotId> = match &actions[idx].template.reads_effect {
            Some(tag) => input
                .state
                .slots
                .iter()
                .filter(|s| s.is_alive() && s.effects.contains(tag))
                .map(|s| s.slot_id.clone())
                .collect(),
            None => actions[idx].targets.clone(),
        };
        for target in targets {
            resolve_one_kill(
                &target,
                &attacker,
                &cause,
                is_strongman && strongman_bypasses_protect,
                &protections,
                &mut events,
                &mut killed,
                &mut kill_log,
            );
        }
    }

    // ── Phase 6: Convert ── change a target's role/alignment (doc 09). A target
    // carrying the `Loyal` modifier (via its role's effects, or a pack-configured
    // immune tag) is NOT converted; the resolver emits `ConversionBlocked`
    // instead. `PlayerConverted` carries `new_alignment` (R2) and folds via
    // `apply_events`. Dead targets (e.g. just killed this night) are not converted.
    for idx in ability_order(&actions, IrAbility::Convert) {
        if actions[idx].blocked {
            continue;
        }
        let source = actions[idx].sub.actor.clone();
        let new_role = match actions[idx].template.effect.clone() {
            Some(r) => r,
            None => continue, // Convert REQUIRES a target role id in `effect`.
        };
        for target in actions[idx].targets.clone() {
            if killed.contains(&target) {
                continue; // a dead slot cannot be converted
            }
            let Some(slot) = input.state.slots.iter().find(|s| s.slot_id == target) else {
                continue;
            };
            if conversion_immune(input, &slot.role_key) {
                events.push(InnerEvent::ConversionBlocked {
                    target: target.clone(),
                    status: "blocked".to_string(),
                    reason: "loyal".to_string(),
                });
                continue;
            }
            let new_alignment = pack.roles.get(&new_role).and_then(|r| r.alignment.clone());
            events.push(InnerEvent::PlayerConverted {
                target: target.clone(),
                new_role: new_role.clone(),
                new_alignment,
                original_role: slot.role_key.clone(),
                source: source.clone(),
            });
        }
    }

    // ── Phase 7: Investigate ── blocked investigations were already suppressed.
    for idx in ability_order(&actions, IrAbility::Investigate) {
        if actions[idx].blocked {
            continue;
        }
        let Some(mode) = actions[idx].template.mode else {
            continue; // Investigate REQUIRES a mode; malformed templates are skipped.
        };
        let investigator = actions[idx].sub.actor.clone();
        for target in actions[idx].targets.clone() {
            match mode {
                InvestigateMode::Parity => {
                    let result = parity_result(input, &target, mode);
                    events.push(InnerEvent::InvestigationResult {
                        mode,
                        investigator: investigator.clone(),
                        target,
                        result: serde_json::Value::String(result),
                    });
                }
                InvestigateMode::Track => {
                    let visited = tracked_visits(&actions, &target, pack);
                    events.push(InnerEvent::InvestigationResult {
                        mode,
                        investigator: investigator.clone(),
                        target,
                        result: serde_json::json!({ "visited": visited }),
                    });
                }
                InvestigateMode::Watch | InvestigateMode::Motion => {
                    // Graph-derived watch/motion are out of scope for v1 goldens.
                }
            }
        }
    }

    // ── Phase 8: Triggers ── reactive abilities (doc 09). After core resolution,
    // fire every trigger whose `on` ability landed against a slot carrying one of
    // `if_target_has`, and resolve the action it `produces` (actor/target chosen
    // per ActorRef/TargetRef). The shipped case is the Bomb: on a Kill landing on
    // the bomb -> produce a Kill targeting the killer. Determinism: kills are
    // processed in stable order; a produced kill that itself lands on a bomb is
    // re-examined, bounded by `redirects.loop_cap` (reused as the trigger loop
    // cap — see note). On reaching the cap the engine pushes a diagnostic note
    // and terminates deterministically.
    let loop_cap = pack.redirects.loop_cap as usize;
    let mut frontier = kill_log.clone();
    let mut iterations = 0usize;
    while !frontier.is_empty() {
        if iterations >= loop_cap {
            trigger_notes.push(format!(
                "trigger loop_cap ({loop_cap}) reached; terminating trigger fixpoint"
            ));
            break;
        }
        iterations += 1;
        let mut next_frontier: Vec<KillRecord> = Vec::new();
        for kr in &frontier {
            for trig in &pack.triggers {
                if trig.on != IrAbility::Kill {
                    continue;
                }
                let Some(target_slot) = input.state.slots.iter().find(|s| s.slot_id == kr.target)
                else {
                    continue;
                };
                if !trigger_target_matches(trig, target_slot) {
                    continue;
                }
                let produced_actor = match trig.produces.actor {
                    ActorRef::Target => kr.target.clone(),
                    ActorRef::Actor => kr.attacker.clone(),
                    ActorRef::TargetGuard | ActorRef::Other => continue,
                };
                let produced_target = match trig.produces.target {
                    TargetRef::Killer | TargetRef::Actor => kr.attacker.clone(),
                    TargetRef::Target => kr.target.clone(),
                    TargetRef::Other => continue,
                };
                let payload = serde_json::json!({
                    "on": "Kill",
                    "source_target": kr.target,
                    "source_attacker": kr.attacker,
                    "produced_target": produced_target,
                });
                events.push(InnerEvent::Trigger {
                    trigger_id: trig.id.clone(),
                    payload,
                });
                if trig.produces.ability == IrAbility::Kill {
                    let strongman = trig.produces.modifiers.contains(&Modifier::Strongman);
                    resolve_one_kill(
                        &produced_target,
                        &produced_actor,
                        &trig.id,
                        strongman,
                        &protections,
                        &mut events,
                        &mut killed,
                        &mut next_frontier,
                    );
                }
            }
        }
        frontier = next_frontier;
    }

    // ── Trailing PhaseAnnouncement ── every resolution ends with exactly one
    // PhaseAnnouncement listing the deaths it produced (empty if none); it is the
    // single canonical death-reveal signal (doc 10).
    let deaths = killed
        .into_iter()
        .map(|slot_id| Death {
            slot_id,
            cause: "night_kill".to_string(),
        })
        .collect();
    // `trigger_notes` are determinism diagnostics (loop-cap hits) destined for the
    // `ResolutionTrace.notes` channel (doc 10). `resolve` returns only the inner
    // event stream in this crate, so notes are debug-asserted, not emitted as
    // inner events (which are a closed set and must not carry diagnostics).
    debug_assert!(
        trigger_notes.len() <= 1,
        "at most one loop-cap note per resolution"
    );
    events.push(InnerEvent::PhaseAnnouncement(PhaseAnnouncement {
        phase_id: input.phase_id.clone(),
        deaths,
    }));

    events
}

/// Build the bus-driver swap map: for a Redirect action with exactly two live,
/// distinct targets `[a, b]`, actions aimed at `a` land on `b` and vice versa.
/// A roleblocked redirect does not swap. Multiple redirects compose in
/// descending priority, honoring `loop_cap` as a termination guard.
fn build_swap_map(actions: &[Action], pack: &Pack) -> BTreeMap<SlotId, SlotId> {
    let mut swap: BTreeMap<SlotId, SlotId> = BTreeMap::new();
    let cap = pack.redirects.loop_cap as usize;
    let mut applied = 0usize;
    for idx in ability_order(actions, IrAbility::Redirect) {
        if actions[idx].blocked {
            continue;
        }
        if applied >= cap {
            break; // loop_cap termination guard
        }
        let t = &actions[idx].targets;
        if t.len() == 2 && t[0] != t[1] {
            swap.insert(t[0].clone(), t[1].clone());
            swap.insert(t[1].clone(), t[0].clone());
            applied += 1;
        }
    }
    let _ = pack.redirects.tie_breaker; // Stable: source ordering is already stable.
    swap
}

/// Compute the slots a tracked slot visited this night: the (post-redirect)
/// targets of that slot's own actions, excluding Ninja-hidden actions per the
/// visibility rule. Stable, de-duplicated ordering.
fn tracked_visits(actions: &[Action], tracked: &SlotId, pack: &Pack) -> Vec<SlotId> {
    let ninja_hides = pack
        .visibility
        .get(&IrAbility::Investigate)
        .map(|v| v.unless_modifiers.contains(&Modifier::Ninja))
        .unwrap_or(false);
    let mut visited: Vec<SlotId> = Vec::new();
    for action in actions {
        if &action.sub.actor != tracked {
            continue;
        }
        if action.blocked {
            continue;
        }
        if ninja_hides && action.template.has_modifier(Modifier::Ninja) {
            continue;
        }
        for t in &action.targets {
            if !visited.contains(t) {
                visited.push(t.clone());
            }
        }
    }
    visited
}

/// Parity investigation result: a slot's alignment-derived "town"/"scum",
/// after applying `investigation_overrides` (e.g. the godfather effect flips a
/// Parity read to "town").
fn parity_result(input: &ResolutionInput, target: &SlotId, mode: InvestigateMode) -> String {
    let slot = input.state.slots.iter().find(|s| &s.slot_id == target);
    let base = match slot.and_then(|s| s.alignment.as_deref()) {
        Some("town") => "town",
        Some(_) => "scum",
        None => "scum",
    }
    .to_string();

    if let (Some(slot), Some(overrides)) = (slot, input.pack.investigation_overrides.as_ref()) {
        for tag in &slot.effects {
            if let Some(ro) = overrides.get(tag) {
                if let Some(value) = ro.by_mode.get(&mode) {
                    return value.clone();
                }
            }
        }
    }
    base
}

/// Does `protect_beats_kill` list `Strongman` in its `unless_modifiers`? If so,
/// a Strongman kill removes Protect from its blockers at evaluation time.
fn protect_beats_kill_unless_strongman(pack: &Pack) -> bool {
    pack.precedence.iter().any(|rule| {
        rule.when.effect == IrAbility::Protect
            && rule.beats.contains(&IrAbility::Kill)
            && rule.unless_modifiers.contains(&Modifier::Strongman)
    })
}

/// Indices of actions with the given ability, ordered by descending
/// `Constraints.priority`, then by ascending `submitted_at`, then by `action_id`
/// for a total, stable order.
fn ability_order(actions: &[Action], ability: IrAbility) -> Vec<usize> {
    let mut idxs: Vec<usize> = actions
        .iter()
        .enumerate()
        .filter(|(_, a)| a.ability() == ability)
        .map(|(i, _)| i)
        .collect();
    idxs.sort_by(|&a, &b| {
        let pa = actions[a].template.constraints.priority;
        let pb = actions[b].template.constraints.priority;
        pb.cmp(&pa)
            .then(
                actions[a]
                    .sub
                    .submitted_at
                    .cmp(&actions[b].sub.submitted_at),
            )
            .then(actions[a].sub.action_id.cmp(&actions[b].sub.action_id))
    });
    idxs
}

/// Look up an actor's action template by `template_id` via their role.
fn lookup_template<'a>(
    input: &'a ResolutionInput,
    actor: &SlotId,
    template_id: &str,
) -> Option<&'a ActionTemplate> {
    let slot = input.state.slots.iter().find(|s| &s.slot_id == actor)?;
    let role = input.pack.roles.get(&slot.role_key)?;
    role.actions.iter().find(|t| t.id == template_id)
}

// ───────────────────────────── Day ─────────────────────────────

fn resolve_day(input: &ResolutionInput) -> Vec<InnerEvent> {
    let pack = &input.pack;
    let policy = &pack.vote;

    // Weights: all alive slots carry a weight (Equal = 1.0 each), regardless of
    // whether they cast or withdrew a ballot.
    let mut weights: BTreeMap<SlotId, f64> = BTreeMap::new();
    for slot in &input.state.slots {
        if slot.is_alive() {
            let w = match &policy.weights {
                WeightPolicy::Equal => 1.0,
                WeightPolicy::PerRole(map) => map.get(&slot.role_key).copied().unwrap_or(1.0),
                WeightPolicy::Dynamic => 1.0,
            };
            weights.insert(slot.slot_id.clone(), w);
        }
    }
    let total_weight: f64 = weights.values().sum();

    // Active ballots: latest non-withdrawn day_vote per actor, in submission
    // order. Withdrawn ballots are omitted entirely.
    let mut votes: BTreeMap<SlotId, SlotId> = BTreeMap::new();
    let mut ordered: Vec<&Submission> = input
        .submissions
        .iter()
        .filter(|s| s.template_id == "day_vote")
        .collect();
    ordered.sort_by(|a, b| {
        a.submitted_at
            .cmp(&b.submitted_at)
            .then(a.action_id.cmp(&b.action_id))
    });
    for sub in ordered {
        if sub.withdrawn {
            votes.remove(&sub.actor);
            continue;
        }
        if let Some(target) = sub.targets.first() {
            votes.insert(sub.actor.clone(), target.clone());
        }
    }

    // Tally weighted counts per candidate.
    let mut tallies: BTreeMap<SlotId, f64> = BTreeMap::new();
    for (voter, target) in &votes {
        let w = weights.get(voter).copied().unwrap_or(0.0);
        *tallies.entry(target.clone()).or_insert(0.0) += w;
    }

    // Find the top tally and its contenders.
    let max_tally = tallies.values().cloned().fold(0.0_f64, f64::max);
    let mut contenders: Vec<SlotId> = tallies
        .iter()
        .filter(|(_, &v)| max_tally > 0.0 && (v - max_tally).abs() < f64::EPSILON)
        .map(|(k, _)| k.clone())
        .collect();
    contenders.sort();

    let majority = match &policy.method {
        VoteMethod::Plurality => None,
        VoteMethod::Majority => Some((total_weight / 2.0).floor() + 1.0),
        VoteMethod::Supermajority { num, den } => {
            Some((total_weight * (*num as f64) / (*den as f64)).ceil())
        }
    };

    let (status, winner, tiebreak, reason) =
        decide_outcome(&contenders, max_tally, majority, policy.tie_breaker);

    let outcome = DayVoteOutcome {
        status,
        winner: winner.clone(),
        contenders,
        tallies,
        votes,
        weights,
        majority,
        total_weight,
        tiebreak,
        reason,
    };

    // R1: a lynch is a death like any other. We emit the structural
    // `DayVoteOutcome` (the authoritative tally + winner) AND a `PlayerKilled`
    // for the eliminated slot, so the death folds uniformly through
    // `apply_events`/`slot_state` — the lynch is no longer a special apply path.
    // `cause` is the action template id ("day_vote"); `attackers` is empty (the
    // town is the collective actor); `unstoppable` is true (a lynch cannot be
    // protected against). The trailing `PhaseAnnouncement` carries the semantic
    // `cause: "lynch"` Death.
    let mut events: Vec<InnerEvent> = vec![InnerEvent::DayVoteOutcome(outcome)];
    let deaths = match &winner {
        Some(w) => {
            events.push(InnerEvent::PlayerKilled {
                slot_id: w.clone(),
                cause: "day_vote".to_string(),
                attackers: Vec::new(),
                unstoppable: true,
            });
            vec![Death {
                slot_id: w.clone(),
                cause: "lynch".to_string(),
            }]
        }
        None => Vec::new(),
    };
    events.push(InnerEvent::PhaseAnnouncement(PhaseAnnouncement {
        phase_id: input.phase_id.clone(),
        deaths,
    }));
    events
}

fn decide_outcome(
    contenders: &[SlotId],
    max_tally: f64,
    majority: Option<f64>,
    tie_breaker: VoteTieBreaker,
) -> (VoteStatus, Option<SlotId>, Option<String>, Option<String>) {
    if contenders.is_empty() || max_tally <= 0.0 {
        return (VoteStatus::NoLynch, None, None, None);
    }

    // Majority/supermajority methods require the top tally to clear the threshold.
    if let Some(thresh) = majority {
        if max_tally < thresh {
            return (VoteStatus::NoMajority, None, None, None);
        }
    }

    if contenders.len() == 1 {
        return (VoteStatus::Lynch, Some(contenders[0].clone()), None, None);
    }

    // A tie among multiple contenders.
    match tie_breaker {
        VoteTieBreaker::NoElimination => {
            let names = contenders.join(" and ");
            (
                VoteStatus::Tie,
                None,
                Some("NoElimination".to_string()),
                Some(format!(
                    "plurality tie between {names}; tie_breaker=NoElimination yields no elimination"
                )),
            )
        }
        // Other tie-breakers are typed but not exercised by the v1 goldens.
        VoteTieBreaker::EarliestReached => (
            VoteStatus::Tie,
            None,
            Some("EarliestReached".to_string()),
            None,
        ),
        VoteTieBreaker::HostDecides => {
            (VoteStatus::Tie, None, Some("HostDecides".to_string()), None)
        }
        VoteTieBreaker::Random => (VoteStatus::Tie, None, Some("Random".to_string()), None),
    }
}

// Keep TieBreaker referenced for future redirect tie-breaks without a warning.
const _: TieBreaker = TieBreaker::Stable;
