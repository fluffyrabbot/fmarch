use crate::events::{
    DecisionTrace, EffectDeltaTrace, GeneratedActionTrace, InnerEvent, ResolutionApplied,
    ResolutionTrace, TraceEdge,
};

pub(super) struct ResolutionTraceInput<'a> {
    pub(super) applied: &'a ResolutionApplied,
    pub(super) trace_edges: Vec<TraceEdge>,
    pub(super) trace_decisions: Vec<DecisionTrace>,
    pub(super) trace_notes: Vec<String>,
}

pub(super) fn build_resolution_trace(input: ResolutionTraceInput<'_>) -> ResolutionTrace {
    let ResolutionTraceInput {
        applied,
        trace_edges,
        trace_decisions,
        trace_notes,
    } = input;
    let mut decisions = Vec::new();
    decisions.push(DecisionTrace {
        stage: "result_contract".to_string(),
        source: format!("domain::resolve/result_version:{}", applied.result_version),
        outcome: format!("{} inner events validated", applied.counts.events),
        detail: crate::json_atom!({
            "kills": applied.counts.kills,
            "saves": applied.counts.saves,
        }),
    });
    decisions.extend(trace_decisions);

    let mut effect_changes = Vec::new();
    let mut generated = Vec::new();
    let mut notes = Vec::new();

    for indexed in &applied.events {
        let outcome = match &indexed.event {
            InnerEvent::DayVoteOutcome(_) => "day_vote_outcome",
            InnerEvent::DayAnnouncement(note) => {
                notes.push(format!(
                    "day announcement for {} emitted at event_index {}",
                    note.player_id, indexed.index
                ));
                "day_announcement"
            }
            InnerEvent::LastWordsRecorded(note) => {
                notes.push(format!(
                    "last words for {} recorded at event_index {}",
                    note.player_id, indexed.index
                ));
                "last_words_recorded"
            }
            InnerEvent::HostPromptIssued(note) => {
                let prompt_id = &note.prompt_id;
                let kind = &note.kind;
                notes.push(format!(
                    "host prompt {prompt_id} ({kind}) emitted at event_index {}",
                    indexed.index
                ));
                "host_prompt_issued"
            }
            InnerEvent::PlayerKilled { .. } => "player_killed",
            InnerEvent::SlotStatusTagged {
                slot_id,
                tag,
                source,
            } => {
                effect_changes.push(EffectDeltaTrace {
                    effect: tag.clone(),
                    target: slot_id.clone(),
                    operation: "status_tag".to_string(),
                    detail: crate::json_atom!({
                        "source": source,
                        "event_index": indexed.index,
                    }),
                });
                "slot_status_tagged"
            }
            InnerEvent::PlayerSaved { .. } => "player_saved",
            InnerEvent::PlayerConverted { .. } => "player_converted",
            InnerEvent::ConversionBlocked { .. } => "conversion_blocked",
            InnerEvent::EffectsMarked {
                effect,
                target,
                actor,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
                duration,
                visibility,
            } => {
                effect_changes.push(EffectDeltaTrace {
                    effect: effect.clone(),
                    target: target.clone(),
                    operation: "mark".to_string(),
                    detail: crate::json_atom!({
                        "actor": actor,
                        "event_index": indexed.index,
                        "source_action": source_action,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "duration": duration,
                        "visibility": visibility,
                    }),
                });
                "effects_marked"
            }
            InnerEvent::EffectsCleared {
                effect,
                targets,
                actor,
                ..
            } => {
                for target in targets {
                    effect_changes.push(EffectDeltaTrace {
                        effect: effect.clone(),
                        target: target.clone(),
                        operation: "clear".to_string(),
                        detail: crate::json_atom!({
                            "actor": actor,
                            "event_index": indexed.index
                        }),
                    });
                }
                "effects_cleared"
            }
            InnerEvent::ActionGranted {
                grant_id,
                grant_option,
                kind,
                actor,
                target,
                source_action,
                uses,
                vote_weight,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: grant_id.clone(),
                    source: "ActionGranted".to_string(),
                    actor: actor.clone(),
                    targets: vec![target.clone()],
                    detail: crate::json_atom!({
                        "kind": kind,
                        "grant_option": grant_option,
                        "source_action": source_action,
                        "uses": uses,
                        "vote_weight": vote_weight,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "action_granted"
            }
            InnerEvent::ActionGrantConsumed {
                grant_id,
                actor,
                action_id,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
                remaining_uses,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ActionGrantConsumed".to_string(),
                    actor: actor.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "grant_id": grant_id,
                        "source_action": source_action,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "remaining_uses": remaining_uses,
                        "event_index": indexed.index,
                    }),
                });
                "action_grant_consumed"
            }
            InnerEvent::BadgeChanged {
                badge_id,
                owner,
                previous_owner,
                vote_weight,
                actor,
                source_action,
                reason,
                destroyed,
                ..
            } => {
                notes.push(format!(
                    "badge {badge_id} changed at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "BadgeChanged".to_string(),
                    actor: actor.clone(),
                    targets: owner.clone().into_iter().collect(),
                    detail: crate::json_atom!({
                        "badge_id": badge_id,
                        "previous_owner": previous_owner,
                        "vote_weight": vote_weight,
                        "reason": reason,
                        "destroyed": destroyed,
                        "event_index": indexed.index,
                    }),
                });
                "badge_changed"
            }
            InnerEvent::DuelResolved {
                knight,
                target,
                result,
                killed,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "duel {source_action} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "DuelResolved".to_string(),
                    actor: knight.clone(),
                    targets: vec![target.clone()],
                    detail: crate::json_atom!({
                        "result": result,
                        "killed": killed,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "duel_resolved"
            }
            InnerEvent::WolfSelfDestructed {
                wolf_id,
                target_id,
                cause,
                unstoppable,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf self-destruct {source_action} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "WolfSelfDestructed".to_string(),
                    actor: wolf_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: crate::json_atom!({
                        "cause": cause,
                        "unstoppable": unstoppable,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_self_destructed"
            }
            InnerEvent::WolfCarryQueued {
                owner_id,
                token_id,
                cause,
                role_key,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf carry token {token_id} queued for {owner_id} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: token_id.clone(),
                    source: "WolfCarryQueued".to_string(),
                    actor: owner_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "cause": cause,
                        "role_key": role_key,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_carry_queued"
            }
            InnerEvent::WolfCarryUsed {
                owner_id,
                target_id,
                source_action_id,
                effect_id,
                role_key,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf carry {source_action_id} used by {owner_id} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action_id.clone(),
                    source: "WolfCarryUsed".to_string(),
                    actor: owner_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: crate::json_atom!({
                        "effect_id": effect_id,
                        "role_key": role_key,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_carry_used"
            }
            InnerEvent::WolfBeautyMarked {
                beauty_id,
                target_id,
                effect,
                source_action,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf beauty mark {source_action} recorded at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "WolfBeautyMarked".to_string(),
                    actor: beauty_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: crate::json_atom!({
                        "effect": effect,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_beauty_marked"
            }
            InnerEvent::WolfBeautyDragged {
                beauty_id,
                dragged_ids,
                cause,
                phase_id,
                phase_kind,
                phase_number,
            } => {
                notes.push(format!(
                    "wolf beauty drag by {beauty_id} resolved at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: format!("{beauty_id}:wolf_beauty_drag"),
                    source: "WolfBeautyDragged".to_string(),
                    actor: beauty_id.clone(),
                    targets: dragged_ids.clone(),
                    detail: crate::json_atom!({
                        "cause": cause,
                        "phase_id": phase_id,
                        "phase_kind": phase_kind,
                        "phase_number": phase_number,
                        "event_index": indexed.index,
                    }),
                });
                "wolf_beauty_dragged"
            }
            InnerEvent::ItaSessionOpened {
                session_id,
                label,
                day,
                window,
                status,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} opened at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionOpened".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "label": label,
                        "day": day,
                        "window": window,
                        "status": status,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_opened"
            }
            InnerEvent::ItaSessionLifecycleChanged {
                session_id,
                control,
                from_status,
                to_status,
                message,
                recorded_at,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} lifecycle {from_status}->{to_status} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionLifecycleChanged".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "control": control,
                        "from_status": from_status,
                        "to_status": to_status,
                        "message": message,
                        "recorded_at": recorded_at,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_lifecycle_changed"
            }
            InnerEvent::ItaSessionAnnouncement {
                session_id,
                status,
                message,
                recorded_at,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} announcement {status} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionAnnouncement".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "status": status,
                        "message": message,
                        "recorded_at": recorded_at,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_announcement"
            }
            InnerEvent::ItaShotQueued {
                session_id,
                action_id,
                actor,
                targets,
                queue_position,
                queue_length,
                ..
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotQueued".to_string(),
                    actor: actor.clone(),
                    targets: targets.clone(),
                    detail: crate::json_atom!({
                        "session_id": session_id,
                        "queue_position": queue_position,
                        "queue_length": queue_length,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_queued"
            }
            InnerEvent::ItaShotBuffered {
                session_id,
                action_id,
                template_id,
                actor_id,
                targets,
                submitted_at,
                release_at,
                delay_ms,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotBuffered".to_string(),
                    actor: actor_id.clone(),
                    targets: targets.clone(),
                    detail: crate::json_atom!({
                        "session_id": session_id,
                        "template_id": template_id,
                        "submitted_at": submitted_at,
                        "release_at": release_at,
                        "delay_ms": delay_ms,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_buffered"
            }
            InnerEvent::ItaShotInvalidated {
                session_id,
                action_id,
                actor_id,
                target_id,
                reason,
                invalidated_by,
                submitted_at,
                timestamp,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotInvalidated".to_string(),
                    actor: actor_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: crate::json_atom!({
                        "session_id": session_id,
                        "reason": reason,
                        "invalidated_by": invalidated_by,
                        "submitted_at": submitted_at,
                        "timestamp": timestamp,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_invalidated"
            }
            InnerEvent::ItaShotResolved {
                session_id,
                action_id,
                actor,
                target,
                outcome,
                hit_chance,
                roll,
                kill,
                shield_before,
                shield_after,
                shield_spent,
                hp_before,
                hp_after,
                protection_path,
                ..
            } => {
                let mut detail = crate::json_atom!({
                    "session_id": session_id,
                    "outcome": outcome,
                    "hit_chance": hit_chance,
                    "roll": roll,
                    "kill": kill,
                    "event_index": indexed.index,
                });
                if shield_before.is_some() || shield_after.is_some() || *shield_spent {
                    detail["shield_before"] = crate::json_atom!(shield_before);
                    detail["shield_after"] = crate::json_atom!(shield_after);
                    detail["shield_spent"] = crate::json_atom!(shield_spent);
                    detail["protection_path"] = crate::json_atom!(protection_path);
                }
                if hp_before.is_some() || hp_after.is_some() {
                    detail["hp_before"] = crate::json_atom!(hp_before);
                    detail["hp_after"] = crate::json_atom!(hp_after);
                    detail["protection_path"] = crate::json_atom!(protection_path);
                }
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotResolved".to_string(),
                    actor: actor.clone(),
                    targets: vec![target.clone()],
                    detail,
                });
                "ita_shot_resolved"
            }
            InnerEvent::ItaShotRefunded {
                session_id,
                action_id,
                actor_id,
                target_id,
                reason,
                policy,
                hit_chance,
                roll,
                hp_before,
                hp_after,
                protection_path,
                submitted_at,
                timestamp,
                counters,
            } => {
                generated.push(GeneratedActionTrace {
                    action_id: action_id.clone(),
                    source: "ItaShotRefunded".to_string(),
                    actor: actor_id.clone(),
                    targets: vec![target_id.clone()],
                    detail: crate::json_atom!({
                        "session_id": session_id,
                        "reason": reason,
                        "policy": policy,
                        "hit_chance": hit_chance,
                        "roll": roll,
                        "hp_before": hp_before,
                        "hp_after": hp_after,
                        "protection_path": protection_path,
                        "submitted_at": submitted_at,
                        "timestamp": timestamp,
                        "counters": counters,
                        "event_index": indexed.index,
                    }),
                });
                "ita_shot_refunded"
            }
            InnerEvent::ItaSessionUpdated {
                session_id,
                queue_length,
                shots_resolved,
                global_shots_fired,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} updated at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionUpdated".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "queue_length": queue_length,
                        "shots_resolved": shots_resolved,
                        "global_shots_fired": global_shots_fired,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_updated"
            }
            InnerEvent::ItaSessionClosed {
                session_id,
                last_status,
                ..
            } => {
                notes.push(format!(
                    "ITA session {session_id} closed at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: session_id.clone(),
                    source: "ItaSessionClosed".to_string(),
                    actor: session_id.clone(),
                    targets: Vec::new(),
                    detail: crate::json_atom!({
                        "last_status": last_status,
                        "event_index": indexed.index,
                    }),
                });
                "ita_session_closed"
            }
            InnerEvent::InvestigationResult { .. } => "investigation_result",
            InnerEvent::InfoResult { .. } => "info_result",
            InnerEvent::InvestigationMemoryRecorded { .. } => "investigation_memory_recorded",
            InnerEvent::AlignmentRevealed { .. } => "alignment_revealed",
            InnerEvent::RoleRevealed { .. } => "role_revealed",
            InnerEvent::VoteDuelDeclared { .. } => "vote_duel_declared",
            InnerEvent::VoteVetoed {
                governor,
                target,
                source_action,
                ..
            } => {
                notes.push(format!(
                    "vote veto by {governor} saved {target} at event_index {}",
                    indexed.index
                ));
                generated.push(GeneratedActionTrace {
                    action_id: source_action.clone(),
                    source: "VoteVetoed".to_string(),
                    actor: governor.clone(),
                    targets: vec![target.clone()],
                    detail: crate::json_atom!({
                        "event_index": indexed.index,
                    }),
                });
                "vote_vetoed"
            }
            InnerEvent::ActionIngestHalted { .. } => "action_ingest_halted",
            InnerEvent::ActionInterfered { .. } => "action_interfered",
            InnerEvent::ActionUseCounted { .. } => "action_use_counted",
            InnerEvent::ActionRecorded { .. } => "action_recorded",
            InnerEvent::PlayersLinked { .. } => "players_linked",
            InnerEvent::RetaliationArmed { .. } => "retaliation_armed",
            InnerEvent::BackupTargeted { .. } => "backup_targeted",
            InnerEvent::TargetLynchWinTargeted { .. } => "target_lynch_win_targeted",
            InnerEvent::DelayedDeathQueued { .. } => "delayed_death_queued",
            InnerEvent::DelayedDeathResolved { .. } => "delayed_death_resolved",
            InnerEvent::VisitRecorded { .. } => "visit_recorded",
            InnerEvent::Trigger {
                trigger_id,
                payload,
            } => {
                notes.push(format!(
                    "trigger {trigger_id} emitted at event_index {}",
                    indexed.index
                ));
                let actor = payload
                    .get("produced_actor")
                    .and_then(|value| value.as_str())
                    .unwrap_or(trigger_id)
                    .to_string();
                let targets = payload
                    .get("produced_target")
                    .and_then(|value| value.as_str())
                    .map(|target| vec![target.to_string()])
                    .unwrap_or_default();
                generated.push(GeneratedActionTrace {
                    action_id: trigger_id.clone(),
                    source: "Trigger".to_string(),
                    actor,
                    targets,
                    detail: crate::json_atom!({
                        "on": payload.get("on").cloned().unwrap_or(serde_json::Value::Null),
                        "source_target": payload.get("source_target").cloned().unwrap_or(serde_json::Value::Null),
                        "source_actor": payload.get("source_actor").cloned().unwrap_or(serde_json::Value::Null),
                        "source_cause": payload.get("source_cause").cloned().unwrap_or(serde_json::Value::Null),
                        "produced_actor": payload.get("produced_actor").cloned().unwrap_or(serde_json::Value::Null),
                        "produced_target": payload.get("produced_target").cloned().unwrap_or(serde_json::Value::Null),
                        "actor_filter": payload.get("actor_filter").cloned().unwrap_or(serde_json::Value::Null),
                        "event_index": indexed.index,
                    }),
                });
                "trigger"
            }
            InnerEvent::WinReached { metadata, .. } => {
                if let Some(metadata) = metadata {
                    for award in &metadata.survival_awards {
                        decisions.push(DecisionTrace {
                            stage: "win:survival".to_string(),
                            source: format!("slot:{}", award.slot_id),
                            outcome: "survival_win_awarded".to_string(),
                            detail: crate::json_atom!({
                                "policy": award.policy,
                                "winner": award.winner,
                                "slot_id": award.slot_id,
                                "role": award.role,
                                "source_event": award.source_event,
                            }),
                        });
                    }
                }
                "win_reached"
            }
            InnerEvent::DayVoteRecorded { .. } => "day_vote_recorded",
            InnerEvent::PhaseAnnouncement(_) => "phase_announcement",
            InnerEvent::EffectNotification { .. } => "effect_notification",
        };
        decisions.push(DecisionTrace {
            stage: "inner_event".to_string(),
            source: format!("event_index:{}", indexed.index),
            outcome: outcome.to_string(),
            detail: crate::json::JsonAtom::Null,
        });
    }
    notes.extend(trace_notes);

    ResolutionTrace {
        phase_id: applied.phase_id.clone(),
        run_id: applied.run_id.clone(),
        trace_version: crate::events::TRACE_VERSION,
        edges: trace_edges,
        generated,
        effect_changes,
        visibility: Vec::new(),
        decisions,
        notes,
    }
}
