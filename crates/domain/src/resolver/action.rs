use super::*;

#[derive(Clone)]
pub(super) struct ProtectionSource {
    pub(super) protector: SlotId,
    pub(super) action_id: String,
    pub(super) template_id: String,
    pub(super) intercept_cause: Option<String>,
    pub(super) guard_retaliation_cause: Option<String>,
    pub(super) cpr_harm_cause: Option<String>,
}
#[derive(Clone)]
pub(super) struct GuardDependency {
    pub(super) guard: SlotId,
    pub(super) ward: SlotId,
    pub(super) template_id: String,
    pub(super) cause: String,
    pub(super) source_action_id: String,
}

#[derive(Clone)]
pub(super) struct HideDependency {
    pub(super) host: SlotId,
    pub(super) hider: SlotId,
    pub(super) template_id: String,
    pub(super) cause: String,
    pub(super) source_action_id: String,
}
/// A landed kill: a (target, attacker) pair, recorded so triggers can react to it
/// after core resolution. `target` is the slot that died; `attacker` is the slot
/// credited with the kill (empty-string-free — every recorded kill has an actor).
#[derive(Clone)]
pub(super) struct KillRecord {
    pub(super) target: SlotId,
    pub(super) attacker: SlotId,
    pub(super) cause: String,
}

pub(super) struct ActionResolutionContext<'a> {
    pub(super) input: &'a ResolutionInput,
    pub(super) protections: &'a BTreeMap<SlotId, Vec<ProtectionSource>>,
    pub(super) cpr_saves: &'a mut BTreeSet<String>,
    pub(super) events: &'a mut Vec<InnerEvent>,
    pub(super) killed: &'a mut Vec<SlotId>,
    pub(super) log: &'a mut Vec<KillRecord>,
    pub(super) trace_decisions: &'a mut Vec<DecisionTrace>,
}

pub(super) struct KillAction<'a> {
    pub(super) target: &'a SlotId,
    pub(super) attacker: &'a SlotId,
    pub(super) cause: &'a str,
    pub(super) unstoppable: bool,
    pub(super) death_reveal: DeathRevealMode,
    pub(super) target_tags: &'a BTreeSet<String>,
}

pub(super) struct ActionInterference<'a> {
    pub(super) action: &'a Action<'a>,
    pub(super) target: &'a SlotId,
    pub(super) ability: IrAbility,
    pub(super) mode: Option<InvestigateMode>,
    pub(super) reason: &'a str,
    pub(super) target_tags: &'a BTreeSet<String>,
}

pub(super) struct CounterUseInput {
    pub(super) phase_id: PhaseId,
    pub(super) phase_kind: PhaseKind,
    pub(super) phase_number: u32,
    pub(super) counter_id: String,
    pub(super) actor: SlotId,
    pub(super) template_id: String,
    pub(super) consumed_action: String,
    pub(super) cadence_policy: String,
    pub(super) phase_scope: String,
    pub(super) limit: u16,
    pub(super) used: u16,
}

pub(super) struct ProtectionResolutionContext<'a> {
    pub(super) input: &'a ResolutionInput,
    pub(super) protections: &'a BTreeMap<SlotId, Vec<ProtectionSource>>,
    pub(super) killed: &'a mut Vec<SlotId>,
    pub(super) log: &'a mut Vec<KillRecord>,
    pub(super) events: &'a mut Vec<InnerEvent>,
    pub(super) trace_decisions: &'a mut Vec<DecisionTrace>,
}

pub(super) fn counter_use_counted(input: CounterUseInput) -> InnerEvent {
    InnerEvent::ActionUseCounted {
        counter_id: input.counter_id,
        actor: input.actor,
        template_id: input.template_id,
        consumed_action: input.consumed_action,
        cadence_policy: input.cadence_policy,
        phase_scope: input.phase_scope,
        limit: input.limit,
        used: input.used,
        remaining: input.limit.saturating_sub(input.used),
        phase_id: input.phase_id,
        phase_kind: input.phase_kind,
        phase_number: input.phase_number,
    }
}

pub(super) fn death_reveal_mode(
    input: &ResolutionInput,
    target: &SlotId,
    cause: &str,
) -> DeathRevealMode {
    let mut mode = input.pack.death_reveal.default;
    if let Some(by_cause) = input.pack.death_reveal.by_cause.get(cause) {
        mode = strictest_death_reveal(mode, *by_cause);
    }
    if let Some(slot) = input
        .state
        .slots
        .iter()
        .find(|slot| &slot.slot_id == target)
    {
        for effect in &slot.effects {
            if let Some(by_effect) = input.pack.death_reveal.by_effect.get(effect) {
                mode = strictest_death_reveal(mode, *by_effect);
            }
        }
    }
    mode
}

fn strictest_death_reveal(left: DeathRevealMode, right: DeathRevealMode) -> DeathRevealMode {
    if death_reveal_rank(right) > death_reveal_rank(left) {
        right
    } else {
        left
    }
}

fn death_reveal_rank(mode: DeathRevealMode) -> u8 {
    match mode {
        DeathRevealMode::Full => 0,
        DeathRevealMode::AlignmentOnly => 1,
        DeathRevealMode::Concealed => 2,
    }
}

/// Resolve a single kill against `target` by `attacker` (template id `cause`).
/// `unstoppable` is the already-computed Strongman bypass flag for this kill.
/// Pushes `PlayerSaved` (if protected and not bypassed) or `PlayerKilled`, and on
/// a death records the slot in `killed` and a `KillRecord` in `log`.
pub(super) fn resolve_one_kill(context: ActionResolutionContext<'_>, action: KillAction<'_>) {
    let ActionResolutionContext {
        input,
        protections,
        cpr_saves,
        events,
        killed,
        log,
        trace_decisions,
    } = context;
    let KillAction {
        target,
        attacker,
        cause,
        unstoppable,
        death_reveal,
        target_tags,
    } = action;
    let pack = &input.pack;
    let phase_id = &input.phase_id;
    let phase_kind = input.state.phase_kind;
    let phase_number = input.state.phase_number;
    // A slot already killed this resolution is not killed twice.
    if killed.contains(target) {
        if night_resolution_aggregates_kill_attackers(pack) {
            let _ = merge_stacked_kill_attribution(
                target,
                attacker,
                cause,
                unstoppable,
                events,
                log,
                trace_decisions,
            );
        }
        return;
    }
    let protectors: Vec<&ProtectionSource> = protections
        .get(target)
        .into_iter()
        .flat_map(|sources| sources.iter())
        .filter(|source| protection_blocks_cause(pack, cause, source))
        .collect();
    if !protectors.is_empty() && !unstoppable {
        let sources = protectors
            .iter()
            .map(|source| source.protector.clone())
            .collect();
        trace_decisions.push(DecisionTrace {
            stage: "kill_resolution".to_string(),
            source: format!("cause:{cause}"),
            outcome: "kill_prevented_by_protection".to_string(),
            detail: serde_json::json!({
                "target": target,
                "attacker": attacker,
                "cause": cause,
                "unstoppable": unstoppable,
                "protectors": protectors.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                        "intercepts": source.intercept_cause.is_some(),
                        "intercept_cause": source.intercept_cause.as_deref(),
                        "guard_retaliation_cause": source.guard_retaliation_cause.as_deref(),
                        "cpr_harm_cause": source.cpr_harm_cause.as_deref(),
                    })
                }).collect::<Vec<_>>(),
            }),
        });
        events.push(InnerEvent::PlayerSaved {
            slot_id: target.clone(),
            reasons: vec!["protected".to_string()],
            sources,
        });
        for source in &protectors {
            if source.cpr_harm_cause.is_some() {
                cpr_saves.insert(source.action_id.clone());
            }
        }
        for source in &protectors {
            let Some(intercept_cause) = source.intercept_cause.as_deref() else {
                continue;
            };
            if killed.contains(&source.protector) {
                if night_resolution_aggregates_kill_attackers(pack) {
                    let _ = merge_stacked_kill_attribution(
                        &source.protector,
                        attacker,
                        intercept_cause,
                        false,
                        events,
                        log,
                        trace_decisions,
                    );
                }
                continue;
            }
            killed.push(source.protector.clone());
            events.push(InnerEvent::PlayerKilled {
                slot_id: source.protector.clone(),
                cause: intercept_cause.to_string(),
                attackers: vec![attacker.clone()],
                unstoppable: false,
                death_reveal: DeathRevealMode::Full,
            });
            log.push(KillRecord {
                target: source.protector.clone(),
                attacker: attacker.clone(),
                cause: intercept_cause.to_string(),
            });
        }
        for source in &protectors {
            let Some(retaliation_cause) = source.guard_retaliation_cause.as_deref() else {
                continue;
            };
            if killed.contains(attacker) {
                if night_resolution_aggregates_kill_attackers(pack) {
                    let _ = merge_stacked_kill_attribution(
                        attacker,
                        &source.protector,
                        retaliation_cause,
                        false,
                        events,
                        log,
                        trace_decisions,
                    );
                }
                continue;
            }
            let attacker_protectors = protections
                .get(attacker)
                .into_iter()
                .flat_map(|sources| sources.iter())
                .filter(|protector| protection_blocks_cause(pack, retaliation_cause, protector))
                .collect::<Vec<_>>();
            if !attacker_protectors.is_empty() {
                trace_decisions.push(DecisionTrace {
                    stage: "kill_resolution".to_string(),
                    source: format!("cause:{retaliation_cause}"),
                    outcome: "guard_retaliation_prevented_by_protection".to_string(),
                    detail: serde_json::json!({
                        "protected_target": target,
                        "protector": source.protector,
                        "attacker": attacker,
                        "source_action": source.action_id,
                        "template_id": source.template_id,
                        "cause": retaliation_cause,
                        "attacker_protectors": attacker_protectors.iter().map(|protector| {
                            serde_json::json!({
                                "protector": protector.protector,
                                "action_id": protector.action_id,
                                "template_id": protector.template_id,
                            })
                        }).collect::<Vec<_>>(),
                    }),
                });
                events.push(InnerEvent::PlayerSaved {
                    slot_id: attacker.clone(),
                    reasons: vec!["protected".to_string()],
                    sources: attacker_protectors
                        .iter()
                        .map(|protector| protector.protector.clone())
                        .collect(),
                });
                continue;
            }
            killed.push(attacker.clone());
            trace_decisions.push(DecisionTrace {
                stage: "kill_resolution".to_string(),
                source: format!("cause:{retaliation_cause}"),
                outcome: "guard_retaliation_killed_attacker".to_string(),
                detail: serde_json::json!({
                    "protected_target": target,
                    "protector": source.protector,
                    "attacker": attacker,
                    "source_action": source.action_id,
                    "template_id": source.template_id,
                    "cause": retaliation_cause,
                }),
            });
            events.push(InnerEvent::PlayerKilled {
                slot_id: attacker.clone(),
                cause: retaliation_cause.to_string(),
                attackers: vec![source.protector.clone()],
                unstoppable: false,
                death_reveal: DeathRevealMode::Full,
            });
            log.push(KillRecord {
                target: attacker.clone(),
                attacker: source.protector.clone(),
                cause: retaliation_cause.to_string(),
            });
        }
    } else if let Some(reason) = bulletproof_reason(target_tags)
        .filter(|reason| target_state_save_blocks_cause(pack, cause, reason, unstoppable))
    {
        events.push(InnerEvent::PlayerSaved {
            slot_id: target.clone(),
            reasons: vec![reason.to_string()],
            sources: vec![target.clone()],
        });
        if reason == "bulletproof_vest" {
            events.push(counter_use_counted(CounterUseInput {
                phase_id: phase_id.clone(),
                phase_kind,
                phase_number,
                counter_id: format!("shield:{reason}"),
                actor: target.clone(),
                template_id: reason.to_string(),
                consumed_action: cause.to_string(),
                cadence_policy: "shield".to_string(),
                phase_scope: "effect".to_string(),
                limit: 1,
                used: 1,
            }));
            events.push(InnerEvent::EffectsCleared {
                effect: "bulletproof_vest".to_string(),
                targets: vec![target.clone()],
                actor: target.clone(),
                source_action: None,
                phase_id: None,
                phase_kind: None,
                phase_number: None,
            });
        }
    } else {
        if !protectors.is_empty() && unstoppable {
            trace_decisions.push(DecisionTrace {
                stage: "kill_resolution".to_string(),
                source: format!("cause:{cause}"),
                outcome: "protection_bypassed_by_unstoppable_kill".to_string(),
                detail: serde_json::json!({
                    "target": target,
                    "attacker": attacker,
                    "cause": cause,
                    "unstoppable": unstoppable,
                    "protectors": protectors.iter().map(|source| {
                        serde_json::json!({
                            "protector": source.protector,
                            "action_id": source.action_id,
                            "template_id": source.template_id,
                            "intercepts": source.intercept_cause.is_some(),
                            "intercept_cause": source.intercept_cause.as_deref(),
                            "guard_retaliation_cause": source.guard_retaliation_cause.as_deref(),
                            "cpr_harm_cause": source.cpr_harm_cause.as_deref(),
                        })
                    }).collect::<Vec<_>>(),
                }),
            });
        }
        killed.push(target.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: target.clone(),
            cause: cause.to_string(),
            attackers: vec![attacker.clone()],
            unstoppable,
            death_reveal,
        });
        log.push(KillRecord {
            target: target.clone(),
            attacker: attacker.clone(),
            cause: cause.to_string(),
        });
    }
}

pub(super) fn merge_stacked_kill_attribution(
    target: &SlotId,
    attacker: &SlotId,
    cause: &str,
    unstoppable: bool,
    events: &mut [InnerEvent],
    log: &mut Vec<KillRecord>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Option<KillRecord> {
    let Some(InnerEvent::PlayerKilled {
        cause: original_cause,
        attackers,
        unstoppable: original_unstoppable,
        ..
    }) = events.iter_mut().find(
        |event| matches!(event, InnerEvent::PlayerKilled { slot_id, .. } if slot_id == target),
    )
    else {
        return None;
    };

    if !attackers.contains(attacker) {
        attackers.push(attacker.clone());
    }
    *original_unstoppable = *original_unstoppable || unstoppable;
    let record = KillRecord {
        target: target.clone(),
        attacker: attacker.clone(),
        cause: cause.to_string(),
    };
    log.push(record.clone());
    trace_decisions.push(DecisionTrace {
        stage: "kill_resolution".to_string(),
        source: format!("cause:{cause}"),
        outcome: "kill_stacked_on_existing_death".to_string(),
        detail: serde_json::json!({
            "target": target,
            "attacker": attacker,
            "cause": cause,
            "existing_cause": original_cause,
            "unstoppable": unstoppable,
            "merged_attackers": attackers,
        }),
    });
    Some(record)
}

pub(super) fn apply_chosen_retaliations(
    input: &ResolutionInput,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    cpr_saves: &mut BTreeSet<String>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for retaliation in &input.state.retaliations {
        if !killed_now.contains(&retaliation.actor) || killed.contains(&retaliation.target) {
            continue;
        }
        let death_cause = player_kill_cause(events, &retaliation.actor);
        if let Some(reason) =
            chosen_retaliation_suppression_reason(input, &retaliation.actor, death_cause.as_deref())
        {
            trace_decisions.push(DecisionTrace {
                stage: "death:cascade".to_string(),
                source: format!("retaliation:{}", retaliation.retaliation_id),
                outcome: "chosen_retaliation_suppressed".to_string(),
                detail: serde_json::json!({
                    "policy": "death_retaliation",
                    "timing": "ImmediateBeforePhaseAnnouncement",
                    "reason": reason,
                    "retaliation_id": retaliation.retaliation_id.clone(),
                    "actor": retaliation.actor.clone(),
                    "target": retaliation.target.clone(),
                    "source_action": retaliation.source_action.clone(),
                    "source_death_cause": death_cause,
                }),
            });
            continue;
        }
        let Some(target_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == retaliation.target)
        else {
            continue;
        };
        if !target_slot.is_alive() {
            continue;
        }
        let strongman = night_resolution_chosen_retaliation_bypasses_protect(
            &input.pack,
            &retaliation.source_action,
        );
        trace_decisions.push(DecisionTrace {
            stage: "death:cascade".to_string(),
            source: format!("retaliation:{}", retaliation.retaliation_id),
            outcome: "chosen_retaliation".to_string(),
            detail: serde_json::json!({
                "retaliation_id": retaliation.retaliation_id.clone(),
                "actor": retaliation.actor.clone(),
                "target": retaliation.target.clone(),
                "source_action": retaliation.source_action.clone(),
                "source_death_cause": death_cause,
                "cause": retaliation.source_action.clone(),
                "unstoppable": strongman,
                "timing": "ImmediateBeforePhaseAnnouncement",
            }),
        });
        let retaliation_target_tags = target_tags(input, &BTreeMap::new(), &retaliation.target);
        resolve_one_kill(
            ActionResolutionContext {
                input,
                protections,
                cpr_saves,
                events,
                killed,
                log: kill_log,
                trace_decisions,
            },
            KillAction {
                target: &retaliation.target,
                attacker: &retaliation.actor,
                cause: &retaliation.source_action,
                unstoppable: strongman,
                death_reveal: death_reveal_mode(
                    input,
                    &retaliation.target,
                    &retaliation.source_action,
                ),
                target_tags: &retaliation_target_tags,
            },
        );
    }
}

pub(super) fn apply_cpr_harms(
    input: &ResolutionInput,
    protections: &BTreeMap<SlotId, Vec<ProtectionSource>>,
    cpr_saves: &BTreeSet<String>,
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) {
    let killed_before: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for (target, sources) in protections {
        let Some(target_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| &slot.slot_id == target)
        else {
            continue;
        };
        if !target_slot.is_alive() || killed_before.contains(target) {
            continue;
        }
        for source in sources {
            let Some(cause) = source.cpr_harm_cause.as_deref() else {
                continue;
            };
            if cpr_saves.contains(&source.action_id) {
                continue;
            }
            trace_decisions.push(DecisionTrace {
                stage: "night:cpr".to_string(),
                source: format!("action:{}", source.action_id),
                outcome: "cpr_harm_applied".to_string(),
                detail: serde_json::json!({
                    "action_id": source.action_id,
                    "template_id": source.template_id,
                    "protector": source.protector,
                    "target": target,
                    "cause": cause,
                }),
            });
            if killed.contains(target) {
                if night_resolution_aggregates_kill_attackers(&input.pack) {
                    let _ = merge_stacked_kill_attribution(
                        target,
                        &source.protector,
                        cause,
                        false,
                        events,
                        kill_log,
                        trace_decisions,
                    );
                }
                continue;
            }
            killed.push(target.clone());
            events.push(InnerEvent::PlayerKilled {
                slot_id: target.clone(),
                cause: cause.to_string(),
                attackers: vec![source.protector.clone()],
                unstoppable: false,
                death_reveal: death_reveal_mode(input, target, cause),
            });
            kill_log.push(KillRecord {
                target: target.clone(),
                attacker: source.protector.clone(),
                cause: cause.to_string(),
            });
        }
    }
}

fn player_kill_cause(events: &[InnerEvent], slot_id: &SlotId) -> Option<String> {
    events.iter().rev().find_map(|event| match event {
        InnerEvent::PlayerKilled {
            slot_id: killed,
            cause,
            ..
        } if killed == slot_id => Some(cause.clone()),
        _ => None,
    })
}

fn chosen_retaliation_suppression_reason(
    input: &ResolutionInput,
    actor: &SlotId,
    death_cause: Option<&str>,
) -> Option<&'static str> {
    let policy = &input.pack.death_retaliation;
    if !policy.enabled {
        return None;
    }
    if policy.timing != Some(DeathRetaliationTiming::ImmediateBeforePhaseAnnouncement) {
        panic!(
            "invalid death_retaliation policy: enabled policy must declare ImmediateBeforePhaseAnnouncement timing"
        );
    }
    let role = slot_role(input, actor)?;
    if !policy
        .eligible_roles
        .iter()
        .any(|eligible| eligible == role)
    {
        return None;
    }
    let Some(cause) = death_cause else {
        return Some("missing_death_cause");
    };
    if policy
        .suppressed_death_causes
        .iter()
        .any(|suppressed| suppressed == cause)
    {
        return Some("suppressed_death_cause");
    }
    if policy
        .allowed_death_causes
        .iter()
        .any(|allowed| allowed == cause)
    {
        return None;
    }
    Some("death_cause_not_allowed")
}

pub(super) fn apply_guard_dependency_deaths(
    input: &ResolutionInput,
    dependencies: &[GuardDependency],
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<KillRecord> {
    let mut generated = Vec::new();
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for dependency in dependencies {
        if !killed_now.contains(&dependency.guard) {
            continue;
        }
        let Some(ward_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == dependency.ward)
        else {
            continue;
        };
        if !ward_slot.is_alive() {
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:dependency_death".to_string(),
            source: format!("action:{}", dependency.source_action_id),
            outcome: "babysitter_dependency_death".to_string(),
            detail: serde_json::json!({
                "action_id": dependency.source_action_id.clone(),
                "template_id": dependency.template_id.clone(),
                "protector": dependency.guard.clone(),
                "ward": dependency.ward.clone(),
                "cause": dependency.cause.clone(),
                "attackers": [dependency.guard.clone()],
            }),
        });
        if killed.contains(&dependency.ward) {
            if night_resolution_aggregates_kill_attackers(&input.pack) {
                if let Some(record) = merge_stacked_kill_attribution(
                    &dependency.ward,
                    &dependency.guard,
                    &dependency.cause,
                    true,
                    events,
                    kill_log,
                    trace_decisions,
                ) {
                    generated.push(record);
                }
            }
            continue;
        }
        killed.push(dependency.ward.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: dependency.ward.clone(),
            cause: dependency.cause.clone(),
            attackers: vec![dependency.guard.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &dependency.ward, &dependency.cause),
        });
        let record = KillRecord {
            target: dependency.ward.clone(),
            attacker: dependency.guard.clone(),
            cause: dependency.cause.clone(),
        };
        kill_log.push(record.clone());
        generated.push(record);
    }
    generated
}

pub(super) fn apply_hide_dependency_deaths(
    input: &ResolutionInput,
    dependencies: &[HideDependency],
    killed: &mut Vec<SlotId>,
    kill_log: &mut Vec<KillRecord>,
    events: &mut Vec<InnerEvent>,
    trace_decisions: &mut Vec<DecisionTrace>,
) -> Vec<KillRecord> {
    let mut generated = Vec::new();
    let killed_now: BTreeSet<SlotId> = killed.iter().cloned().collect();
    for dependency in dependencies {
        if !killed_now.contains(&dependency.host) {
            continue;
        }
        let Some(hider_slot) = input
            .state
            .slots
            .iter()
            .find(|slot| slot.slot_id == dependency.hider)
        else {
            continue;
        };
        if !hider_slot.is_alive() {
            continue;
        }
        trace_decisions.push(DecisionTrace {
            stage: "night:dependency_death".to_string(),
            source: format!("action:{}", dependency.source_action_id),
            outcome: "hider_dependency_death".to_string(),
            detail: serde_json::json!({
                "action_id": dependency.source_action_id.clone(),
                "template_id": dependency.template_id.clone(),
                "host": dependency.host.clone(),
                "hider": dependency.hider.clone(),
                "cause": dependency.cause.clone(),
                "attackers": [dependency.host.clone()],
            }),
        });
        if killed.contains(&dependency.hider) {
            if night_resolution_aggregates_kill_attackers(&input.pack) {
                if let Some(record) = merge_stacked_kill_attribution(
                    &dependency.hider,
                    &dependency.host,
                    &dependency.cause,
                    true,
                    events,
                    kill_log,
                    trace_decisions,
                ) {
                    generated.push(record);
                }
            }
            continue;
        }
        killed.push(dependency.hider.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: dependency.hider.clone(),
            cause: dependency.cause.clone(),
            attackers: vec![dependency.host.clone()],
            unstoppable: true,
            death_reveal: death_reveal_mode(input, &dependency.hider, &dependency.cause),
        });
        let record = KillRecord {
            target: dependency.hider.clone(),
            attacker: dependency.host.clone(),
            cause: dependency.cause.clone(),
        };
        kill_log.push(record.clone());
        generated.push(record);
    }
    generated
}

fn target_state_interference_reason(reason: &str) -> String {
    if reason == "commuted" || reason == "untargetable" {
        "untargetable".to_string()
    } else {
        reason.to_string()
    }
}

pub(super) fn emit_action_interfered_by_target_state(
    trace_decisions: &mut Vec<DecisionTrace>,
    events: &mut Vec<InnerEvent>,
    interference: ActionInterference<'_>,
) {
    let ActionInterference {
        action,
        target,
        ability,
        mode,
        reason,
        target_tags,
    } = interference;
    let mut detail = serde_json::json!({
        "action_id": action.sub.action_id,
        "template_id": action.template.id,
        "actor": action.sub.actor,
        "target": target,
        "ability": format!("{ability:?}"),
        "reason": reason,
        "target_tags": target_tags,
    });
    if let Some(mode) = mode {
        detail["mode"] = serde_json::json!(mode);
    }
    trace_decisions.push(DecisionTrace {
        stage: "night:target_state".to_string(),
        source: format!("action:{}", action.sub.action_id),
        outcome: "action_interfered_by_target_state".to_string(),
        detail,
    });
    events.push(InnerEvent::ActionInterfered {
        actor: action.sub.actor.clone(),
        reason: target_state_interference_reason(reason),
    });
}

pub(super) fn night_resolution_aggregates_kill_attackers(pack: &Pack) -> bool {
    pack.night_resolution.is_explicit()
        && matches!(
            pack.night_resolution.kill_stacking,
            Some(KillStackingPolicy::AggregateAttackers)
        )
}

fn protection_blocks_cause(pack: &Pack, cause: &str, source: &ProtectionSource) -> bool {
    if pack.night_resolution.is_explicit() {
        return pack
            .night_resolution
            .protection_cause_policy
            .get(&source.template_id)
            .is_some_and(|policy| {
                policy.blocks.iter().any(|blocked| blocked == cause)
                    || policy.bypasses.iter().any(|bypassed| bypassed == cause)
            });
    }
    if pack.guard_policy.enabled
        && pack
            .guard_policy
            .guard_blockable_causes
            .iter()
            .any(|configured| configured == cause)
    {
        return pack
            .guard_policy
            .guard_action_ids
            .iter()
            .any(|action_id| action_id == &source.template_id);
    }
    true
}

pub(super) fn apply_guard_witch_same_target_policy(context: ProtectionResolutionContext<'_>) {
    let ProtectionResolutionContext {
        input,
        protections,
        killed,
        log,
        events,
        trace_decisions,
    } = context;
    if !input.pack.guard_policy.enabled
        || input.pack.guard_policy.same_target_witch != GuardWitchSameTargetPolicy::KillTarget
    {
        return;
    }
    let Some(cause) = input
        .pack
        .guard_policy
        .same_target_witch_kill_cause
        .as_deref()
    else {
        panic!("invalid guard policy: KillTarget same-target policy requires same_target_witch_kill_cause");
    };

    for (target, sources) in protections {
        if killed.contains(target) {
            continue;
        }
        let guard_sources: Vec<_> = sources
            .iter()
            .filter(|source| {
                input
                    .pack
                    .guard_policy
                    .guard_action_ids
                    .iter()
                    .any(|action_id| action_id == &source.template_id)
            })
            .collect();
        let witch_sources: Vec<_> = sources
            .iter()
            .filter(|source| {
                input
                    .pack
                    .guard_policy
                    .witch_heal_action_ids
                    .iter()
                    .any(|action_id| action_id == &source.template_id)
            })
            .collect();
        if guard_sources.is_empty() || witch_sources.is_empty() {
            continue;
        }

        let attackers = guard_sources
            .iter()
            .chain(witch_sources.iter())
            .map(|source| source.protector.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        trace_decisions.push(DecisionTrace {
            stage: "night:guard_policy".to_string(),
            source: "guard_policy.same_target_witch".to_string(),
            outcome: "guard_witch_same_target_killed".to_string(),
            detail: serde_json::json!({
                "target": target,
                "cause": cause,
                "policy": "KillTarget",
                "guard_sources": guard_sources.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                    })
                }).collect::<Vec<_>>(),
                "witch_sources": witch_sources.iter().map(|source| {
                    serde_json::json!({
                        "protector": source.protector,
                        "action_id": source.action_id,
                        "template_id": source.template_id,
                    })
                }).collect::<Vec<_>>(),
            }),
        });
        killed.push(target.clone());
        events.push(InnerEvent::PlayerKilled {
            slot_id: target.clone(),
            cause: cause.to_string(),
            attackers: attackers.clone(),
            unstoppable: true,
            death_reveal: death_reveal_mode(input, target, cause),
        });
        for attacker in attackers {
            log.push(KillRecord {
                target: target.clone(),
                attacker,
                cause: cause.to_string(),
            });
        }
    }
}

fn target_state_save_blocks_cause(
    pack: &Pack,
    cause: &str,
    save_tag: &str,
    unstoppable: bool,
) -> bool {
    if pack.night_resolution.is_explicit() {
        if !pack
            .night_resolution
            .target_state_save_tags
            .iter()
            .any(|tag| tag == save_tag)
        {
            return false;
        }
        return pack
            .night_resolution
            .target_state_save_policy
            .get(save_tag)
            .is_some_and(|policy| policy.blocks.iter().any(|blocked| blocked == cause));
    }
    !unstoppable
}
