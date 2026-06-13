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
    ActionTemplate, Pack, PhaseKind, TieBreaker, VoteMethod, VoteTieBreaker, WeightPolicy,
};
use crate::state::{PhaseId, Seed, SlotId, StateSnapshot, Submission};

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

/// Resolve a window's submissions into ordered inner events.
pub fn resolve(input: ResolutionInput) -> Vec<InnerEvent> {
    match input.state.phase_kind {
        PhaseKind::Day | PhaseKind::Twilight => resolve_day(&input),
        PhaseKind::Night => resolve_night(&input),
    }
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

    // ── Phase 3: Protect ── collect protected slots -> protecting sources.
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

    // ── Phase 4: Kill ── Protect beats Kill UNLESS the Kill carries Strongman
    // (protect_beats_kill.unless_modifiers inspects the BEATEN action = the Kill).
    let strongman_bypasses_protect = protect_beats_kill_unless_strongman(pack);
    // Slots that got PlayerKilled this resolution, in event order — surfaced as
    // the trailing PhaseAnnouncement's deaths (doc 10).
    let mut killed: Vec<SlotId> = Vec::new();
    for idx in ability_order(&actions, IrAbility::Kill) {
        if actions[idx].blocked {
            continue;
        }
        let cause = actions[idx].template.id.clone();
        let attacker = actions[idx].sub.actor.clone();
        let is_strongman = actions[idx].template.has_modifier(Modifier::Strongman);
        for target in actions[idx].targets.clone() {
            let protectors = protections.get(&target);
            let protected = protectors.map(|p| !p.is_empty()).unwrap_or(false);
            let bypass = is_strongman && strongman_bypasses_protect;
            if protected && !bypass {
                let sources = protectors.cloned().unwrap_or_default();
                events.push(InnerEvent::PlayerSaved {
                    slot_id: target,
                    reasons: vec!["protected".to_string()],
                    sources,
                });
            } else {
                // `unstoppable` is true iff the kill is inherently unpreventable
                // by protection — i.e. it carries Strongman — REGARDLESS of whether
                // a protect was actually present on this target (doc 10).
                let unstoppable = is_strongman && strongman_bypasses_protect;
                killed.push(target.clone());
                events.push(InnerEvent::PlayerKilled {
                    slot_id: target,
                    cause: cause.clone(),
                    attackers: vec![attacker.clone()],
                    unstoppable,
                });
            }
        }
    }

    // ── Phase 5: Investigate ── blocked investigations were already suppressed.
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

    // Deaths revealed at the boundary: the eliminated slot, if any.
    let deaths = winner
        .map(|w| {
            vec![Death {
                slot_id: w,
                cause: "lynch".to_string(),
            }]
        })
        .unwrap_or_default();

    vec![
        InnerEvent::DayVoteOutcome(outcome),
        InnerEvent::PhaseAnnouncement(PhaseAnnouncement {
            phase_id: input.phase_id.clone(),
            deaths,
        }),
    ]
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
