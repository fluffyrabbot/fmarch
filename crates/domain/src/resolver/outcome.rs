use super::*;

pub(super) struct DayVoteResolutionContext<'a> {
    pub(super) input: &'a ResolutionInput,
    pub(super) badges: &'a [BadgeRecord],
    pub(super) events: &'a mut Vec<InnerEvent>,
    pub(super) trace_decisions: &'a mut Vec<DecisionTrace>,
    pub(super) trace_notes: &'a mut Vec<String>,
}

struct OutcomeDecisionInput<'a> {
    tallies: &'a BTreeMap<SlotId, f64>,
    top_contenders: &'a [SlotId],
    max_tally: f64,
    majority: Option<f64>,
    thresholds: &'a BTreeMap<SlotId, f64>,
    tie_breaker: VoteTieBreaker,
    role_tiebreaker_winner: Option<SlotId>,
    earliest_reached_winner: Option<SlotId>,
    seed: Seed,
    no_lynch_target: &'a str,
    force_top_contenders: bool,
    hammer_reached: bool,
}

pub(super) fn resolve_day_vote(context: DayVoteResolutionContext<'_>) {
    let DayVoteResolutionContext {
        input,
        badges,
        events,
        trace_decisions,
        trace_notes,
    } = context;
    let pack = &input.pack;
    let policy = &pack.vote;
    let badge_weights = active_badge_vote_weights(badges);
    let vote_state = apply_events(&input.state, events);
    let pre_vote_deaths = deaths_from_events(events);
    let vote_duel = resolve_vote_duel_action(input, &vote_state, events);

    // Weights: all alive slots carry a weight (Equal = 1.0 each), regardless of
    // whether they cast or withdrew a ballot.
    let mut weights: BTreeMap<SlotId, f64> = BTreeMap::new();
    for slot in &vote_state.slots {
        if slot.is_alive() {
            let mut role_weight = match &policy.weights {
                WeightPolicy::Equal => 1.0,
                WeightPolicy::PerRole(map) => map.get(&slot.role_key).copied().unwrap_or(1.0),
                WeightPolicy::Dynamic(dynamic) => {
                    dynamic_vote_weight(dynamic, slot, &vote_state.action_grants)
                }
            };
            if idiot_vote_loss_applies(pack, slot) {
                role_weight = 0.0;
            }
            let w = badge_weights
                .get(&slot.slot_id)
                .copied()
                .unwrap_or(role_weight);
            weights.insert(slot.slot_id.clone(), w);
        }
    }
    let total_weight: f64 = weights.values().sum();

    // Active ballots: latest non-withdrawn day_vote per actor, in submission
    // order. Withdrawn ballots are omitted entirely.
    const NO_LYNCH_TARGET: &str = "no_lynch";

    let mut valid_vote_targets: BTreeSet<&str> = vote_state
        .slots
        .iter()
        .filter(|slot| slot.is_alive())
        .map(|slot| slot.slot_id.as_str())
        .collect();
    let alive_candidates = valid_vote_targets.clone();
    if policy.no_lynch_allowed {
        valid_vote_targets.insert(NO_LYNCH_TARGET);
    }

    let majority = match &policy.method {
        VoteMethod::Plurality => None,
        VoteMethod::Majority => Some((total_weight / 2.0).floor() + 1.0),
        VoteMethod::Supermajority { num, den } => {
            Some((total_weight * (*num as f64) / (*den as f64)).ceil())
        }
    };
    let mut thresholds: BTreeMap<SlotId, f64> = BTreeMap::new();
    if let Some(base) = majority {
        for slot in vote_state.slots.iter().filter(|slot| slot.is_alive()) {
            let adjustment = policy
                .threshold_adjustments
                .get(&slot.role_key)
                .copied()
                .unwrap_or(0.0);
            let threshold = if vote_duel
                .as_ref()
                .is_some_and(|duel| duel.contains(&slot.slot_id))
            {
                1.0
            } else {
                (base + adjustment).max(1.0)
            };
            thresholds.insert(slot.slot_id.clone(), threshold);
        }
    }

    let mut votes: BTreeMap<SlotId, SlotId> = BTreeMap::new();
    let mut tally_history: Vec<BTreeMap<SlotId, f64>> = Vec::new();
    let mut hammer_reached = false;
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
    for (index, sub) in ordered.iter().enumerate() {
        events.push(InnerEvent::DayVoteRecorded {
            actor: sub.actor.clone(),
            target: sub.targets.first().cloned(),
            withdrawn: sub.withdrawn,
            sequence: (index + 1) as u64,
        });
    }
    for sub in &ordered {
        if sub.withdrawn {
            votes.remove(&sub.actor);
        } else if weights.contains_key(&sub.actor) {
            if let Some(target) = sub.targets.first() {
                if valid_vote_targets.contains(target.as_str()) {
                    votes.insert(sub.actor.clone(), target.clone());
                    if policy.hammer {
                        let mut hammer_votes = votes.clone();
                        if let Some(duel) = &vote_duel {
                            hammer_votes.retain(|_, target| duel.contains(target));
                        }
                        let hammer_tallies = tally_votes(&hammer_votes, &weights);
                        let threshold = majority.and_then(|base| {
                            if target == NO_LYNCH_TARGET {
                                Some(base)
                            } else {
                                thresholds.get(target).copied().or(Some(base))
                            }
                        });
                        if let Some(threshold) = threshold {
                            let tally = hammer_tallies.get(target).copied().unwrap_or(0.0);
                            if tally >= threshold {
                                votes = hammer_votes;
                                hammer_reached = true;
                            }
                        }
                    }
                }
            }
        }
        tally_history.push(tally_votes(&votes, &weights));
        if hammer_reached {
            break;
        }
    }
    if !hammer_reached {
        if let Some(duel) = &vote_duel {
            votes.retain(|_, target| duel.contains(target));
        }
    }

    // Tally weighted counts per candidate.
    let mut tallies = tally_votes(&votes, &weights);
    if let Some(duel) = &vote_duel {
        for participant in duel {
            if valid_vote_targets.contains(participant.as_str()) {
                tallies.entry(participant.clone()).or_insert(0.0);
            }
        }
    }

    // Find the top tally and its contenders.
    let max_tally = tallies.values().cloned().fold(0.0_f64, f64::max);
    let mut contenders: Vec<SlotId> = if vote_duel.is_some() && max_tally <= 0.0 {
        tallies.keys().cloned().collect()
    } else {
        tallies
            .iter()
            .filter(|(_, &v)| max_tally > 0.0 && (v - max_tally).abs() < f64::EPSILON)
            .map(|(k, _)| k.clone())
            .collect()
    };
    contenders.sort();

    let duel_forced_elimination = vote_duel.is_some();
    let tie_breaker = if duel_forced_elimination {
        match policy
            .vote_duel_tie_breaker
            .expect("VoteDuel packs must declare vote.vote_duel_tie_breaker")
        {
            VoteDuelTieBreaker::Random => VoteTieBreaker::Random,
        }
    } else {
        policy.tie_breaker
    };
    let role_tiebreaker_winner =
        role_tiebreaker_winner(&vote_state, &contenders, &policy.tiebreaker_roles);
    let earliest_reached_winner = earliest_reached_winner(&tally_history, &contenders, max_tally);

    let (status, winner, contenders, tiebreak, reason) = decide_outcome(OutcomeDecisionInput {
        tallies: &tallies,
        top_contenders: &contenders,
        max_tally,
        majority,
        thresholds: &thresholds,
        tie_breaker,
        role_tiebreaker_winner,
        earliest_reached_winner,
        seed: input.seed,
        no_lynch_target: NO_LYNCH_TARGET,
        force_top_contenders: duel_forced_elimination,
        hammer_reached,
    });

    let outcome = DayVoteOutcome {
        status,
        winner: winner.clone(),
        contenders,
        tallies,
        votes: votes.clone(),
        weights,
        majority,
        thresholds,
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
    events.push(InnerEvent::DayVoteOutcome(outcome.clone()));
    let vetoed_winner = resolve_vote_veto_action(input, &vote_state, &outcome, events);
    resolve_day_vote_prompts(input, &outcome, events, trace_decisions);
    let mut deaths = pre_vote_deaths;
    let mut trigger_frontier = Vec::new();
    if let Some(w) = &winner {
        if vetoed_winner.as_ref() == Some(w) {
            trace_decisions.push(DecisionTrace {
                stage: "day:veto".to_string(),
                source: format!("slot:{w}"),
                outcome: "lynch_vetoed".to_string(),
                detail: crate::json_atom!({
                    "phase_id": input.phase_id,
                    "target": w,
                }),
            });
        } else if alive_candidates.contains(w.as_str()) {
            if idiot_survives_lynch(input, w) {
                events.push(InnerEvent::PlayerSaved {
                    slot_id: w.clone(),
                    reasons: vec![pack.idiot_policy.survival_reason.clone()],
                    sources: vec![w.clone()],
                });
                events.push(effects_marked(
                    input,
                    pack,
                    pack.idiot_policy.vote_loss_effect.clone(),
                    w.clone(),
                    w.clone(),
                    "day_vote".to_string(),
                    EffectDuration::Persistent,
                ));
            } else if let Some((role_key, original_alignment, target_alignment, survival_reason)) =
                saulus_conversion_on_lynch(input, &vote_state, w)
            {
                trace_decisions.push(DecisionTrace {
                    stage: "day:lynch_trigger".to_string(),
                    source: format!("slot:{w}"),
                    outcome: "saulus_alignment_flipped".to_string(),
                    detail: crate::json_atom!({
                        "target": w,
                        "role": role_key,
                        "original_alignment": original_alignment,
                        "new_alignment": target_alignment,
                        "reason": survival_reason,
                    }),
                });
                events.push(InnerEvent::PlayerSaved {
                    slot_id: w.clone(),
                    reasons: vec![survival_reason],
                    sources: vec![w.clone()],
                });
                events.push(InnerEvent::PlayerConverted {
                    target: w.clone(),
                    new_role: role_key.clone(),
                    new_alignment: Some(target_alignment),
                    original_role: role_key,
                    original_alignment,
                    source: w.clone(),
                });
            } else {
                events.push(InnerEvent::PlayerKilled {
                    slot_id: w.clone(),
                    cause: "day_vote".to_string(),
                    attackers: Vec::new(),
                    unstoppable: true,
                    death_reveal: death_reveal_mode(input, w, "day_vote"),
                });
                let execution_actor = ordered
                    .iter()
                    .rev()
                    .find(|sub| {
                        !sub.withdrawn
                            && sub.targets.first() == Some(w)
                            && votes.get(&sub.actor) == Some(w)
                    })
                    .map(|sub| sub.actor.clone())
                    .unwrap_or_else(|| w.clone());
                trigger_frontier.push(TriggerObservation {
                    on: TriggerOn::Event(TriggerEvent::Lynch),
                    target: w.clone(),
                    actor: execution_actor.clone(),
                    cause: "lynch".to_string(),
                    target_tags: Vec::new(),
                    actor_tags: Vec::new(),
                });
                trigger_frontier.push(TriggerObservation {
                    on: TriggerOn::Event(TriggerEvent::Death),
                    target: w.clone(),
                    actor: execution_actor,
                    cause: "lynch".to_string(),
                    target_tags: Vec::new(),
                    actor_tags: Vec::new(),
                });
                if duel_forced_elimination {
                    if let Some((challenger, source_action)) =
                        vote_duel_instigator_for_target(events, w)
                    {
                        trigger_frontier.push(TriggerObservation {
                            on: TriggerOn::Ability(IrAbility::VoteDuel),
                            target: w.clone(),
                            actor: challenger,
                            cause: source_action,
                            target_tags: Vec::new(),
                            actor_tags: Vec::new(),
                        });
                    }
                }
                deaths.push(Death {
                    slot_id: w.clone(),
                    cause: "lynch".to_string(),
                    template_id: None,
                    audience: None,
                });
                resolve_last_words(input, &outcome, w, events);
                resolve_wolf_beauty_drag(input, w, "lynch", events, &mut deaths, trace_decisions);
            }
        }
    }
    let mut killed: Vec<SlotId> = deaths.iter().map(|death| death.slot_id.clone()).collect();
    let mut kill_log: Vec<KillRecord> = deaths
        .iter()
        .map(|death| KillRecord {
            target: death.slot_id.clone(),
            attacker: death.slot_id.clone(),
            cause: death.cause.clone(),
        })
        .collect();
    let mut cpr_saves: BTreeSet<String> = BTreeSet::new();
    trigger_frontier.extend(phase_end_observations(input, &killed));
    let no_protections = BTreeMap::new();
    let no_transient_effects = BTreeMap::new();
    let generated_kills = apply_trigger_fixpoint(
        TriggerResolutionContext {
            input,
            protections: &no_protections,
            transient_effects: &no_transient_effects,
            killed: &mut killed,
            cpr_saves: &mut cpr_saves,
            events,
            trace_decisions,
            trace_notes,
            produced_kill_collection: ProducedKillCollection::Return,
            cascade: None,
        },
        trigger_frontier,
    );
    for record in generated_kills {
        deaths.push(Death {
            slot_id: record.target.clone(),
            cause: record.cause.clone(),
            template_id: None,
            audience: None,
        });
        kill_log.push(record);
    }
    let chosen_retaliation_start = kill_log.len();
    apply_chosen_retaliations(
        input,
        &BTreeMap::new(),
        &mut killed,
        &mut kill_log,
        &mut cpr_saves,
        events,
        trace_decisions,
    );
    for record in kill_log.iter().skip(chosen_retaliation_start) {
        deaths.push(Death {
            slot_id: record.target.clone(),
            cause: record.cause.clone(),
            template_id: None,
            audience: None,
        });
    }
    for slot_id in apply_lover_suicides(input, &mut killed, &mut kill_log, events, trace_decisions)
    {
        deaths.push(Death {
            slot_id,
            cause: pack.lover_policy.suicide_cause.clone(),
            template_id: None,
            audience: None,
        });
    }
    apply_effect_source_death_reveals(input, &killed, events, trace_decisions);
    resolve_beloved_princess_prompts(input, events, trace_decisions);
    events.push(InnerEvent::PhaseAnnouncement(phase_announcement(
        input, deaths,
    )));
    if let Some(winner) = winner.as_ref() {
        resolve_self_lynch_wins(input, winner, events, trace_decisions);
        if !has_win_reached(events) {
            resolve_target_lynch_wins(input, winner, events, trace_decisions);
        }
    }
}

fn resolve_vote_veto_action(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    outcome: &DayVoteOutcome,
    events: &mut Vec<InnerEvent>,
) -> Option<SlotId> {
    if input.state.phase_kind != PhaseKind::Day {
        return None;
    }
    if !matches!(outcome.status, VoteStatus::Lynch | VoteStatus::Hammer) {
        return None;
    }
    let winner = outcome.winner.as_ref()?;

    let mut submissions: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter_map(|submission| {
            let template = lookup_submission_template(input, submission)?;
            if !phase_window_matches(template.window, input.state.phase_kind) {
                return None;
            }
            template
                .has_ability(IrAbility::Veto)
                .then_some((submission, template))
        })
        .collect();
    submissions.sort_by(|(left, left_template), (right, right_template)| {
        right_template
            .constraints
            .priority
            .cmp(&left_template.constraints.priority)
            .then(left.submitted_at.cmp(&right.submitted_at))
            .then(left.action_id.cmp(&right.action_id))
    });

    for (submission, template) in submissions {
        let Some(actor) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == submission.actor && slot.is_alive())
        else {
            continue;
        };
        let Some(target) = submission.targets.first() else {
            events.push(InnerEvent::ActionInterfered {
                actor: submission.actor.clone(),
                reason: "veto_missing_target".to_string(),
            });
            continue;
        };
        if target != winner {
            events.push(InnerEvent::ActionInterfered {
                actor: submission.actor.clone(),
                reason: "veto_target_not_vote_winner".to_string(),
            });
            continue;
        }
        if let Some(limit) = template.constraints.x_shots {
            if action_counter_exhausted(input, &submission.actor, &template.id, limit) {
                events.push(InnerEvent::ActionInterfered {
                    actor: submission.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
                continue;
            }
            events.push(action_use_counted(
                input,
                submission.actor.clone(),
                template.id.clone(),
                submission.action_id.clone(),
                limit,
            ));
        }
        events.push(InnerEvent::VoteVetoed {
            governor: actor.slot_id.clone(),
            target: target.clone(),
            source_action: submission.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        return Some(target.clone());
    }
    None
}

fn resolve_vote_duel_action(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    events: &mut Vec<InnerEvent>,
) -> Option<BTreeSet<SlotId>> {
    if input.state.phase_kind != PhaseKind::Day {
        return None;
    }

    let mut submissions: Vec<&Submission> = input
        .submissions
        .iter()
        .filter(|submission| !submission.withdrawn)
        .filter(|submission| {
            lookup_submission_template(input, submission)
                .is_some_and(|template| template.has_ability(IrAbility::VoteDuel))
        })
        .collect();
    submissions.sort_by(|left, right| {
        left.submitted_at
            .cmp(&right.submitted_at)
            .then(left.action_id.cmp(&right.action_id))
    });

    for submission in submissions {
        let Some(target) = submission.targets.first().cloned() else {
            continue;
        };
        if target == submission.actor {
            continue;
        }
        let Some(actor_slot) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == submission.actor && slot.is_alive())
        else {
            continue;
        };
        let Some(target_slot) = vote_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == target && slot.is_alive())
        else {
            continue;
        };
        events.push(InnerEvent::VoteDuelDeclared {
            challenger: actor_slot.slot_id.clone(),
            target: target_slot.slot_id.clone(),
            source_action: submission.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        return Some(BTreeSet::from([
            actor_slot.slot_id.clone(),
            target_slot.slot_id.clone(),
        ]));
    }

    None
}

fn vote_duel_instigator_for_target(
    events: &[InnerEvent],
    killed: &SlotId,
) -> Option<(SlotId, String)> {
    events.iter().rev().find_map(|event| {
        if let InnerEvent::VoteDuelDeclared {
            challenger,
            target,
            source_action,
            ..
        } = event
        {
            if challenger == killed || target == killed {
                return Some((challenger.clone(), source_action.clone()));
            }
        }
        None
    })
}

fn resolve_target_lynch_wins(
    input: &ResolutionInput,
    lynched: &SlotId,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.target_lynch_win_policies.is_empty() {
        return;
    }
    let mut matches = Vec::new();
    for record in input.state.target_lynch_win_targets.iter() {
        if &record.target != lynched {
            continue;
        }
        let Some(policy) = input
            .pack
            .target_lynch_win_policies
            .iter()
            .find(|policy| policy.id == record.policy && policy.target_effect == record.effect)
        else {
            continue;
        };
        let owner_is_eligible = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == record.owner)
            .is_some_and(|slot| {
                slot.is_alive()
                    && policy
                        .eligible_roles
                        .iter()
                        .any(|role| role == &slot.role_key)
            });
        if owner_is_eligible {
            matches.push((record, policy));
        }
    }
    matches.sort_by(|(a, a_policy), (b, b_policy)| {
        a_policy
            .id
            .cmp(&b_policy.id)
            .then(a.owner.cmp(&b.owner))
            .then(a.target.cmp(&b.target))
            .then(a.source_action.cmp(&b.source_action))
    });

    for (record, policy) in matches {
        trace_decisions.push(DecisionTrace {
            stage: "day:lynch_trigger".to_string(),
            source: format!("action:{}", record.source_action),
            outcome: "target_lynch_win_reached".to_string(),
            detail: crate::json_atom!({
                "policy": policy.id,
                "owner": record.owner,
                "target": record.target,
                "effect": record.effect,
                "winner": policy.winner,
                "source_action": record.source_action,
                "target_phase_id": record.phase_id,
                "target_phase_kind": record.phase_kind,
                "target_phase_number": record.phase_number,
            }),
        });
        events.push(InnerEvent::WinReached {
            winner: policy.winner.clone(),
            reason: format!(
                "{} {} target {} lynched",
                policy.id, record.owner, record.target
            ),
            metadata: Some(crate::events::WinReachedMetadata {
                policy: Some(policy.id.clone()),
                owner: Some(record.owner.clone()),
                target: Some(record.target.clone()),
                effect: Some(record.effect.clone()),
                source_action: Some(record.source_action.clone()),
                target_phase_id: Some(record.phase_id.clone()),
                target_phase_kind: Some(format!("{:?}", record.phase_kind)),
                target_phase_number: Some(record.phase_number),
                ..crate::events::WinReachedMetadata::default()
            }),
        });
    }
}

fn resolve_day_vote_prompts(
    input: &ResolutionInput,
    outcome: &DayVoteOutcome,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.day_vote_prompt_policies.is_empty() {
        return;
    }
    let status = outcome.status;
    for policy in &input.pack.day_vote_prompt_policies {
        if !policy.statuses.contains(&status) {
            continue;
        }
        let status_name = format!("{status:?}");
        let prompt_id = format!("{}:{}:{}", input.phase_id, policy.prompt_kind, status_name);
        trace_decisions.push(DecisionTrace {
            stage: "day:vote_prompt".to_string(),
            source: "day_vote".to_string(),
            outcome: "host_prompt_issued".to_string(),
            detail: crate::json_atom!({
                "policy": policy.id,
                "prompt_id": prompt_id,
                "kind": policy.prompt_kind,
                "subject": null,
                "reason": policy.prompt_reason,
                "status": status_name,
                "contenders": outcome.contenders,
                "tiebreak": outcome.tiebreak,
                "outcome_reason": outcome.reason,
            }),
        });
        events.push(InnerEvent::HostPromptIssued(HostPromptIssued {
            prompt_id,
            kind: policy.prompt_kind.clone(),
            subject: None,
            reason: policy.prompt_reason.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
            metadata: HostPromptMetadata {
                policy: Some(policy.id.clone()),
                status: Some(status_name),
                contenders: outcome.contenders.clone(),
                tiebreak: outcome.tiebreak.clone(),
                outcome_reason: outcome.reason.clone(),
                ..HostPromptMetadata::default()
            },
        }));
    }
}

fn idiot_vote_loss_applies(pack: &Pack, slot: &SlotState) -> bool {
    pack.idiot_policy.enabled
        && slot
            .effects
            .iter()
            .any(|effect| effect == &pack.idiot_policy.vote_loss_effect)
}

fn dynamic_vote_weight(
    policy: &crate::pack::DynamicVoteWeightPolicy,
    slot: &SlotState,
    action_grants: &[crate::state::ActionGrantRecord],
) -> f64 {
    let mut selected: Option<(i32, String, f64)> = None;
    for rule in &policy.effect_rules {
        if slot.effects.iter().any(|effect| effect == &rule.effect) {
            selected = max_vote_weight_rule(
                selected,
                (
                    rule.priority,
                    format!("effect:{}", rule.effect),
                    rule.weight,
                ),
            );
        }
    }
    for rule in &policy.grant_rules {
        for grant in action_grants {
            if grant.target == slot.slot_id
                && grant.kind == GrantKind::VoteWeight
                && grant.grant_id == rule.grant_id
                && grant.uses > 0
            {
                if let Some(weight) = grant.vote_weight {
                    selected = max_vote_weight_rule(
                        selected,
                        (rule.priority, format!("grant:{}", rule.grant_id), weight),
                    );
                }
            }
        }
    }
    selected.map(|(_, _, weight)| weight).unwrap_or(policy.base)
}

fn max_vote_weight_rule(
    current: Option<(i32, String, f64)>,
    candidate: (i32, String, f64),
) -> Option<(i32, String, f64)> {
    match current {
        Some(current)
            if current.0 > candidate.0
                || (current.0 == candidate.0 && current.1 >= candidate.1) =>
        {
            Some(current)
        }
        _ => Some(candidate),
    }
}

fn idiot_survives_lynch(input: &ResolutionInput, slot_id: &SlotId) -> bool {
    let policy = &input.pack.idiot_policy;
    if !policy.enabled {
        return false;
    }
    let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)
    else {
        return false;
    };
    policy
        .eligible_roles
        .iter()
        .any(|role| role == &slot.role_key)
        && !slot
            .effects
            .iter()
            .any(|effect| effect == &policy.vote_loss_effect)
}

fn saulus_conversion_on_lynch(
    input: &ResolutionInput,
    vote_state: &StateSnapshot,
    slot_id: &SlotId,
) -> Option<(String, Option<String>, String, String)> {
    let policy = &input.pack.saulus_policy;
    if !policy.enabled {
        return None;
    }
    let slot = vote_state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == slot_id)?;
    if !policy
        .eligible_roles
        .iter()
        .any(|role| role == &slot.role_key)
    {
        return None;
    }
    if slot.alignment.as_deref() == Some(policy.target_alignment.as_str()) {
        return None;
    }
    Some((
        slot.role_key.clone(),
        slot.alignment.clone(),
        policy.target_alignment.clone(),
        policy.survival_reason.clone(),
    ))
}

fn resolve_self_lynch_wins(
    input: &ResolutionInput,
    lynched: &SlotId,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    if input.pack.self_lynch_win_policies.is_empty() {
        return;
    }
    let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == lynched)
    else {
        return;
    };
    let mut matches: Vec<_> = input
        .pack
        .self_lynch_win_policies
        .iter()
        .filter(|policy| {
            policy
                .eligible_roles
                .iter()
                .any(|role| role == &slot.role_key)
        })
        .collect();
    matches.sort_by(|a, b| a.id.cmp(&b.id));
    let Some(policy) = matches.first() else {
        return;
    };
    let source_event = policy
        .source_event
        .clone()
        .unwrap_or_else(|| format!("win.{}", policy.id));
    trace_decisions.push(DecisionTrace {
        stage: "day:lynch_trigger".to_string(),
        source: format!("slot:{lynched}"),
        outcome: "self_lynch_win_reached".to_string(),
        detail: crate::json_atom!({
            "policy": policy.id,
            "winner": policy.winner,
            "target": lynched,
            "role": slot.role_key,
            "source_event": source_event,
        }),
    });
    events.push(InnerEvent::WinReached {
        winner: policy.winner.clone(),
        reason: format!("{} {} lynched", policy.id, lynched),
        metadata: Some(crate::events::WinReachedMetadata {
            policy: Some(policy.id.clone()),
            target: Some(lynched.clone()),
            role: Some(slot.role_key.clone()),
            source_event: Some(source_event),
            ..crate::events::WinReachedMetadata::default()
        }),
    });
}

fn resolve_last_words(
    input: &ResolutionInput,
    outcome: &DayVoteOutcome,
    killed: &SlotId,
    events: &mut Vec<InnerEvent>,
) {
    if !input.pack.day_notes.last_words.day_deaths || input.state.phase_kind != PhaseKind::Day {
        return;
    }

    let sequence = events
        .iter()
        .filter(|event| matches!(event, InnerEvent::LastWordsRecorded(_)))
        .count() as u32;
    events.push(InnerEvent::LastWordsRecorded(LastWordsRecorded {
        player_id: killed.clone(),
        reason: "lynch".to_string(),
        template_id: input.pack.day_notes.last_words.template_id.clone(),
        audience: input.pack.day_notes.last_words.audience.clone(),
        window: input.pack.day_notes.last_words.window.clone(),
        sequence,
        day: input.state.phase_number,
        phase_id: input.phase_id.clone(),
        vote: LastWordsVoteSummary {
            status: outcome.status,
            winner: outcome.winner.clone(),
            tallies: outcome.tallies.clone(),
            majority: outcome.majority,
            total_weight: outcome.total_weight,
        },
    }));
}

fn resolve_wolf_beauty_drag(
    input: &ResolutionInput,
    beauty_id: &SlotId,
    day_death_cause: &str,
    events: &mut Vec<InnerEvent>,
    deaths: &mut Vec<Death>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let policy = &input.pack.wolf_beauty;
    if !policy.enabled
        || !policy
            .death_causes
            .iter()
            .any(|cause| cause == day_death_cause)
    {
        return;
    }
    let Some(beauty_role) = slot_role(input, beauty_id) else {
        return;
    };
    if !policy.eligible_roles.iter().any(|role| role == beauty_role) {
        return;
    }
    let Some(mark) = input
        .state
        .wolf_beauty_marks
        .iter()
        .find(|record| &record.beauty_id == beauty_id && record.effect == policy.mark_effect)
    else {
        return;
    };
    let day_state = apply_events(&input.state, events);
    let Some(target_slot) = day_state
        .slots
        .iter()
        .find(|slot| slot.slot_id == mark.target_id)
    else {
        return;
    };
    if !target_slot.is_alive() || deaths.iter().any(|death| death.slot_id == mark.target_id) {
        return;
    }

    trace_decisions.push(DecisionTrace {
        stage: "death:cascade".to_string(),
        source: format!("action:{}", mark.source_action),
        outcome: "wolf_beauty_dragged".to_string(),
        detail: crate::json_atom!({
            "beauty_id": beauty_id.clone(),
            "dragged_id": mark.target_id.clone(),
            "mark_effect": mark.effect.clone(),
            "mark_source_action": mark.source_action.clone(),
            "mark_phase_id": mark.phase_id.clone(),
            "mark_phase_kind": mark.phase_kind,
            "mark_phase_number": mark.phase_number,
            "trigger_cause": day_death_cause,
            "cause": policy.drag_cause.clone(),
        }),
    });
    events.push(InnerEvent::WolfBeautyDragged {
        beauty_id: beauty_id.clone(),
        dragged_ids: vec![mark.target_id.clone()],
        cause: policy.drag_cause.clone(),
        phase_id: input.phase_id.clone(),
        phase_kind: input.state.phase_kind,
        phase_number: input.state.phase_number,
    });
    events.push(InnerEvent::PlayerKilled {
        slot_id: mark.target_id.clone(),
        cause: policy.drag_cause.clone(),
        attackers: vec![beauty_id.clone()],
        unstoppable: true,
        death_reveal: death_reveal_mode(input, &mark.target_id, &policy.drag_cause),
    });
    deaths.push(Death {
        slot_id: mark.target_id.clone(),
        cause: policy.drag_cause.clone(),
        template_id: None,
        audience: None,
    });
}

pub(super) fn resolve_duel_actions(
    input: &ResolutionInput,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
    trace_notes: &mut Vec<String>,
) {
    let mut ordered: Vec<(&Submission, &ActionTemplate)> = input
        .submissions
        .iter()
        .filter(|sub| !sub.withdrawn)
        .filter_map(|sub| {
            let template = lookup_submission_template(input, sub)?;
            if !phase_window_matches(template.window, input.state.phase_kind) {
                return None;
            }
            template
                .has_ability(IrAbility::Duel)
                .then_some((sub, template))
        })
        .collect();
    ordered.sort_by(|(a, a_template), (b, b_template)| {
        b_template
            .constraints
            .priority
            .cmp(&a_template.constraints.priority)
            .then(a.submitted_at.cmp(&b.submitted_at))
            .then(a.action_id.cmp(&b.action_id))
    });

    let mut day_state = input.state.clone();
    for (sub, template) in ordered {
        let Some(duel) = &template.duel else {
            continue;
        };
        let Some(target) = sub.targets.first().cloned() else {
            continue;
        };
        let Some(actor_slot) = day_state
            .slots
            .iter()
            .find(|slot| slot.slot_id == sub.actor)
        else {
            continue;
        };
        if !actor_slot.is_alive() {
            continue;
        }
        let Some(target_slot) = day_state.slots.iter().find(|slot| slot.slot_id == target) else {
            continue;
        };
        if !target_slot.is_alive() {
            continue;
        }
        let mut duel_events = Vec::new();
        if let Some(limit) = template.constraints.x_shots {
            if action_counter_exhausted(input, &sub.actor, &template.id, limit) {
                events.push(InnerEvent::ActionInterfered {
                    actor: sub.actor.clone(),
                    reason: "x_shot_exhausted".to_string(),
                });
                continue;
            }
            duel_events.push(action_use_counted(
                input,
                sub.actor.clone(),
                template.id.clone(),
                sub.action_id.clone(),
                limit,
            ));
        }

        let success = target_slot.alignment.as_deref().is_some_and(|alignment| {
            duel.hostile_alignments
                .iter()
                .any(|hostile| hostile == alignment)
        });
        let (result, killed) = if success {
            (DuelResult::Success, target.clone())
        } else {
            (DuelResult::Failure, sub.actor.clone())
        };

        duel_events.push(InnerEvent::DuelResolved {
            knight: sub.actor.clone(),
            target: target.clone(),
            result,
            killed: killed.clone(),
            source_action: sub.action_id.clone(),
            phase_id: input.phase_id.clone(),
            phase_kind: input.state.phase_kind,
            phase_number: input.state.phase_number,
        });
        duel_events.push(InnerEvent::PlayerKilled {
            slot_id: killed.clone(),
            cause: template.id.clone(),
            attackers: vec![sub.actor.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &killed, &template.id),
        });
        let mut killed_slots = vec![killed.clone()];
        let mut cpr_saves = BTreeSet::new();
        let no_protections = BTreeMap::new();
        let no_transient_effects = BTreeMap::new();
        let generated_kills = apply_trigger_fixpoint(
            TriggerResolutionContext {
                input,
                protections: &no_protections,
                transient_effects: &no_transient_effects,
                killed: &mut killed_slots,
                cpr_saves: &mut cpr_saves,
                events: &mut duel_events,
                trace_decisions,
                trace_notes,
                produced_kill_collection: ProducedKillCollection::Return,
                cascade: None,
            },
            vec![TriggerObservation {
                on: TriggerOn::Ability(IrAbility::Duel),
                target: killed.clone(),
                actor: sub.actor.clone(),
                cause: template.id.clone(),
                target_tags: Vec::new(),
                actor_tags: Vec::new(),
            }],
        );
        for record in generated_kills {
            trace_decisions.push(DecisionTrace {
                stage: "duel_resolution".to_string(),
                source: format!("trigger:{}", record.cause),
                outcome: "generated_kill_after_duel".to_string(),
                detail: crate::json_atom!({
                    "source_action": sub.action_id.clone(),
                    "template_id": template.id.clone(),
                    "duel_killed": killed.clone(),
                    "generated_target": record.target,
                    "generated_attacker": record.attacker,
                    "generated_cause": record.cause,
                }),
            });
        }
        events.extend(duel_events.iter().cloned());
        day_state = apply_events(&day_state, &duel_events);
    }
}

fn active_badge_vote_weights(badges: &[BadgeRecord]) -> BTreeMap<SlotId, f64> {
    badges
        .iter()
        .filter(|badge| !badge.destroyed)
        .filter_map(|badge| Some((badge.owner.clone()?, badge.vote_weight?)))
        .collect()
}

fn tally_votes(
    votes: &BTreeMap<SlotId, SlotId>,
    weights: &BTreeMap<SlotId, f64>,
) -> BTreeMap<SlotId, f64> {
    let mut tallies = BTreeMap::new();
    for (voter, target) in votes {
        let w = weights.get(voter).copied().unwrap_or(0.0);
        *tallies.entry(target.clone()).or_insert(0.0) += w;
    }
    tallies
}

fn role_tiebreaker_winner(
    state: &StateSnapshot,
    contenders: &[SlotId],
    tiebreaker_roles: &[String],
) -> Option<SlotId> {
    if tiebreaker_roles.is_empty() {
        return None;
    }
    contenders.iter().find_map(|contender| {
        let slot = state.slots.iter().find(|slot| &slot.slot_id == contender)?;
        tiebreaker_roles
            .iter()
            .any(|role_key| role_key == &slot.role_key)
            .then(|| contender.clone())
    })
}

fn earliest_reached_winner(
    tally_history: &[BTreeMap<SlotId, f64>],
    contenders: &[SlotId],
    final_tally: f64,
) -> Option<SlotId> {
    // History follows the resolver's deterministic (submitted_at, action_id) order.
    tally_history.iter().find_map(|tallies| {
        contenders.iter().find_map(|contender| {
            (tallies
                .get(contender)
                .is_some_and(|tally| (*tally - final_tally).abs() < f64::EPSILON))
            .then(|| contender.clone())
        })
    })
}

fn decide_outcome(
    input: OutcomeDecisionInput<'_>,
) -> (
    VoteStatus,
    Option<SlotId>,
    Vec<SlotId>,
    Option<String>,
    Option<String>,
) {
    let OutcomeDecisionInput {
        tallies,
        top_contenders,
        max_tally,
        majority,
        thresholds,
        tie_breaker,
        role_tiebreaker_winner,
        earliest_reached_winner,
        seed,
        no_lynch_target,
        force_top_contenders,
        hammer_reached,
    } = input;
    if top_contenders.is_empty() || (!force_top_contenders && max_tally <= 0.0) {
        return (VoteStatus::NoLynch, None, Vec::new(), None, None);
    }

    let contenders = if force_top_contenders {
        top_contenders.to_vec()
    } else if let Some(base_threshold) = majority {
        let mut eligible: Vec<(SlotId, f64)> = tallies
            .iter()
            .filter_map(|(slot_id, tally)| {
                let threshold = thresholds.get(slot_id).copied().unwrap_or(base_threshold);
                if *tally > 0.0 && *tally >= threshold {
                    Some((slot_id.clone(), *tally))
                } else {
                    None
                }
            })
            .collect();
        if eligible.is_empty() {
            return (
                VoteStatus::NoMajority,
                None,
                top_contenders.to_vec(),
                None,
                None,
            );
        }
        let eligible_max = eligible
            .iter()
            .map(|(_, tally)| *tally)
            .fold(0.0_f64, f64::max);
        eligible.retain(|(_, tally)| (*tally - eligible_max).abs() < f64::EPSILON);
        eligible
            .into_iter()
            .map(|(slot_id, _)| slot_id)
            .collect::<Vec<_>>()
    } else {
        top_contenders.to_vec()
    };

    if contenders.len() == 1 {
        if contenders[0] == no_lynch_target {
            return (
                VoteStatus::NoLynch,
                None,
                contenders,
                None,
                Some("no_lynch reached the vote threshold".to_string()),
            );
        }
        let status = if hammer_reached {
            VoteStatus::Hammer
        } else {
            VoteStatus::Lynch
        };
        return (status, Some(contenders[0].clone()), contenders, None, None);
    }

    // A tie among multiple contenders.
    if let Some(winner) = role_tiebreaker_winner.filter(|winner| contenders.contains(winner)) {
        return (
            VoteStatus::Lynch,
            Some(winner.clone()),
            contenders,
            Some("RoleTiebreaker".to_string()),
            Some(format!("role tiebreaker selected {winner}")),
        );
    }

    match tie_breaker {
        VoteTieBreaker::NoElimination => {
            let names = contenders.join(" and ");
            (
                VoteStatus::Tie,
                None,
                contenders,
                Some("NoElimination".to_string()),
                Some(format!(
                    "plurality tie between {names}; tie_breaker=NoElimination yields no elimination"
                )),
            )
        }
        VoteTieBreaker::EarliestReached => {
            let winner = earliest_reached_winner.unwrap_or_else(|| {
                contenders
                    .first()
                    .expect("tied contenders must include an earliest fallback")
                    .clone()
            });
            let status = if winner == no_lynch_target {
                VoteStatus::NoLynch
            } else {
                VoteStatus::Lynch
            };
            let eliminated = (status == VoteStatus::Lynch).then_some(winner.clone());
            (
                status,
                eliminated,
                contenders,
                Some("EarliestReached".to_string()),
                Some(format!("earliest reached final tally selected {winner}")),
            )
        }
        VoteTieBreaker::HostDecides => (
            VoteStatus::Tie,
            None,
            contenders,
            Some("HostDecides".to_string()),
            None,
        ),
        VoteTieBreaker::Random => {
            let mut rng = DetRng::new(seed ^ 0x4441_595f_564f_5445);
            let index = (rng.next_u64() as usize) % contenders.len();
            let winner = contenders[index].clone();
            let status = if winner == no_lynch_target {
                VoteStatus::NoLynch
            } else {
                VoteStatus::Lynch
            };
            let eliminated = (status == VoteStatus::Lynch).then_some(winner.clone());
            (
                status,
                eliminated,
                contenders,
                Some("Random".to_string()),
                Some(format!("seeded random tie_breaker selected {winner}")),
            )
        }
    }
}
