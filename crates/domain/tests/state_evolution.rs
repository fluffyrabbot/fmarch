//! Cross-phase state evolution tests (doc 09): `apply_events` (the canonical
//! state-fold), `check_win` (WinPolicy evaluation), and an end-to-end
//! multi-phase scenario that resolves a night, folds the result forward, then
//! resolves the next window and asserts the win fires at the right point.
//!
//! Hermetic: the pack is loaded from the repo relative to `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

use domain::events::{DayVoteOutcome, InnerEvent, VoteStatus};
use domain::pack::{DeathRevealMode, GrantKind, Pack, PhaseKind, VoteMethod, VoteTieBreaker};
use domain::resolver::{check_win, resolve, ResolutionInput};
use domain::state::{
    apply_events, RevealState, SlotLifecycle, SlotState, StateSnapshot, Submission,
};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn load_pack() -> Pack {
    load_pack_named("mafiascum")
}

fn load_pack_named(name: &str) -> Pack {
    let p = repo_root().join("packs").join(name).join("pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize {name}/pack.json: {e}"))
}

fn resolved_events(input: ResolutionInput) -> Vec<InnerEvent> {
    resolve(input)
        .applied
        .events
        .into_iter()
        .map(|indexed| indexed.event)
        .collect()
}

fn slot(id: &str, role: &str, alignment: &str, status: &str) -> SlotState {
    SlotState {
        slot_id: id.to_string(),
        role_key: role.to_string(),
        alignment: Some(alignment.to_string()),
        role_reveal: RevealState::Private,
        alignment_reveal: RevealState::Private,
        status: match status {
            "alive" => SlotLifecycle::Alive,
            "dead" => SlotLifecycle::Dead,
            "modkilled" => SlotLifecycle::Modkilled,
            other => panic!("unknown test slot lifecycle {other}"),
        },
        status_tags: Vec::new(),
        effects: Vec::new(),
    }
}

fn find<'a>(state: &'a StateSnapshot, id: &str) -> &'a SlotState {
    state
        .slots
        .iter()
        .find(|s| s.slot_id == id)
        .unwrap_or_else(|| panic!("slot {id} missing"))
}

// ───────────────────────── apply_events ─────────────────────────

#[test]
fn apply_player_killed_marks_dead() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "factional_kill".to_string(),
            attackers: vec!["m".to_string()],
            unstoppable: false,
            death_reveal: DeathRevealMode::Full,
        }],
    );
    assert_eq!(find(&next, "a").status, SlotLifecycle::Dead);
    assert_eq!(find(&next, "a").role_reveal, RevealState::Public);
    assert_eq!(find(&next, "a").alignment_reveal, RevealState::Public);

    let concealed = apply_events(
        &state,
        &[InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "janitor_kill".to_string(),
            attackers: vec!["m".to_string()],
            unstoppable: false,
            death_reveal: DeathRevealMode::Concealed,
        }],
    );
    assert_eq!(find(&concealed, "a").status, SlotLifecycle::Dead);
    assert_eq!(find(&concealed, "a").role_reveal, RevealState::Private);
    assert_eq!(find(&concealed, "a").alignment_reveal, RevealState::Private);

    let alignment_only = apply_events(
        &state,
        &[InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "strongman_kill".to_string(),
            attackers: vec!["m".to_string()],
            unstoppable: true,
            death_reveal: DeathRevealMode::AlignmentOnly,
        }],
    );
    assert_eq!(find(&alignment_only, "a").status, SlotLifecycle::Dead);
    assert_eq!(find(&alignment_only, "a").role_reveal, RevealState::Private);
    assert_eq!(
        find(&alignment_only, "a").alignment_reveal,
        RevealState::Public
    );

    // Phase cursor is carried through unchanged by the fold.
    assert_eq!(next.phase_number, 1);
    assert!(matches!(next.phase_kind, PhaseKind::Night));
}

#[test]
fn apply_wolf_carry_queue_and_use_updates_pending_tokens() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        phase_id: "D01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("slot_1", "white_wolf_king", "wolf", "dead")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let queued = apply_events(
        &state,
        &[InnerEvent::WolfCarryQueued {
            owner_id: "slot_1".to_string(),
            token_id: "white_wolf_carry_token".to_string(),
            cause: "wolf_carry".to_string(),
            role_key: "white_wolf_king".to_string(),
            phase_id: "D01".to_string(),
            phase_kind: PhaseKind::Day,
            phase_number: 1,
        }],
    );
    assert_eq!(queued.wolf_carry_tokens.len(), 1);
    assert_eq!(queued.wolf_carry_tokens[0].owner_id, "slot_1");

    let consumed = apply_events(
        &queued,
        &[InnerEvent::WolfCarryUsed {
            owner_id: "slot_1".to_string(),
            target_id: "slot_4".to_string(),
            source_action_id: "wolfkill_001:wolf_carry:1".to_string(),
            effect_id: "white_wolf_carry_token:wolfkill_001:wolf_carry:1".to_string(),
            role_key: "white_wolf_king".to_string(),
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
        }],
    );
    assert!(consumed.wolf_carry_tokens.is_empty());
}

#[test]
fn apply_wolf_beauty_mark_upserts_owner_target_relation() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("slot_1", "wolf_beauty", "wolf", "alive"),
            slot("slot_2", "villager", "town", "alive"),
            slot("slot_3", "villager", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let marked = apply_events(
        &state,
        &[InnerEvent::WolfBeautyMarked {
            beauty_id: "slot_1".to_string(),
            target_id: "slot_2".to_string(),
            effect: "wolf_beauty_mark".to_string(),
            source_action: "beauty_001".to_string(),
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
        }],
    );
    assert_eq!(marked.wolf_beauty_marks.len(), 1);
    assert_eq!(marked.wolf_beauty_marks[0].target_id, "slot_2");

    let replaced = apply_events(
        &marked,
        &[InnerEvent::WolfBeautyMarked {
            beauty_id: "slot_1".to_string(),
            target_id: "slot_3".to_string(),
            effect: "wolf_beauty_mark".to_string(),
            source_action: "beauty_002".to_string(),
            phase_id: "N02".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 2,
        }],
    );
    assert_eq!(replaced.wolf_beauty_marks.len(), 1);
    assert_eq!(replaced.wolf_beauty_marks[0].target_id, "slot_3");
}

#[test]
fn apply_player_saved_is_a_noop() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerSaved {
            slot_id: "a".to_string(),
            reasons: vec!["protected".to_string()],
            sources: vec!["doc".to_string()],
        }],
    );
    assert_eq!(find(&next, "a").status, SlotLifecycle::Alive);
}

#[test]
fn apply_effects_mark_then_clear() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let marked = apply_events(
        &state,
        &[
            InnerEvent::EffectsMarked {
                effect: "poisoned".to_string(),
                target: "a".to_string(),
                actor: "p".to_string(),
                source_action: Some("poison".to_string()),
                phase_id: Some("N01".to_string()),
                phase_kind: Some(PhaseKind::Night),
                phase_number: Some(1),
                duration: domain::EffectDuration::Persistent,
                visibility: domain::EffectVisibility::Actor,
            },
            // Re-marking the same effect is idempotent (de-duplicated).
            InnerEvent::EffectsMarked {
                effect: "poisoned".to_string(),
                target: "a".to_string(),
                actor: "p".to_string(),
                source_action: Some("poison".to_string()),
                phase_id: Some("N01".to_string()),
                phase_kind: Some(PhaseKind::Night),
                phase_number: Some(1),
                duration: domain::EffectDuration::Persistent,
                visibility: domain::EffectVisibility::Actor,
            },
        ],
    );
    assert_eq!(find(&marked, "a").effects, vec!["poisoned".to_string()]);
    assert_eq!(marked.effect_records.len(), 1);
    let record = &marked.effect_records[0];
    assert_eq!(record.effect, "poisoned");
    assert_eq!(record.target, "a");
    assert_eq!(record.source, "p");
    assert_eq!(record.source_action.as_deref(), Some("poison"));
    assert_eq!(record.phase_id.as_deref(), Some("N01"));
    assert_eq!(record.phase_kind, Some(PhaseKind::Night));
    assert_eq!(record.phase_number, Some(1));
    assert_eq!(record.duration, domain::EffectDuration::Persistent);
    assert_eq!(record.visibility, domain::EffectVisibility::Actor);

    let cleared = apply_events(
        &marked,
        &[InnerEvent::EffectsCleared {
            effect: "poisoned".to_string(),
            targets: vec!["a".to_string()],
            actor: "p".to_string(),
        }],
    );
    assert!(find(&cleared, "a").effects.is_empty());
    assert!(cleared.effect_records.is_empty());
}

#[test]
fn apply_resolution_duration_effect_expires_without_durable_state() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let marked = apply_events(
        &state,
        &[InnerEvent::EffectsMarked {
            effect: "fruit_received".to_string(),
            target: "a".to_string(),
            actor: "p".to_string(),
            source_action: Some("send_fruit".to_string()),
            phase_id: Some("N01".to_string()),
            phase_kind: Some(PhaseKind::Night),
            phase_number: Some(1),
            duration: domain::EffectDuration::Resolution,
            visibility: domain::EffectVisibility::Target,
        }],
    );

    assert!(
        find(&marked, "a").effects.is_empty(),
        "resolution-scoped effects expire before the cross-phase tag index"
    );
    assert!(
        marked.effect_records.is_empty(),
        "resolution-scoped effects must not become durable effect records"
    );
}

#[test]
fn apply_delayed_death_queue_then_resolve() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let queued = apply_events(
        &state,
        &[InnerEvent::DelayedDeathQueued {
            queue_id: "poisoned:a:poison_001".to_string(),
            target: "a".to_string(),
            cause: "poison".to_string(),
            effect: "poisoned".to_string(),
            source: "p".to_string(),
            source_action: "poison_001".to_string(),
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
        }],
    );
    assert_eq!(queued.delayed_deaths.len(), 1);
    assert_eq!(queued.delayed_deaths[0].queue_id, "poisoned:a:poison_001");
    assert_eq!(queued.delayed_deaths[0].source_action, "poison_001");

    let resolved = apply_events(
        &queued,
        &[InnerEvent::DelayedDeathResolved {
            queue_id: "poisoned:a:poison_001".to_string(),
            target: "a".to_string(),
            cause: "poison".to_string(),
            effect: "poisoned".to_string(),
            outcome: "applied".to_string(),
            phase_id: "N02".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 2,
        }],
    );
    assert!(resolved.delayed_deaths.is_empty());
}

#[test]
fn apply_visit_recorded_appends_history() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "visitor", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let next = apply_events(
        &state,
        &[InnerEvent::VisitRecorded {
            actor: "a".to_string(),
            target: "b".to_string(),
            template_id: "visit".to_string(),
            source_action: "visit_n01".to_string(),
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
            visible: true,
        }],
    );

    assert_eq!(next.visit_history.len(), 1);
    assert_eq!(next.visit_history[0].actor, "a");
    assert_eq!(next.visit_history[0].target, "b");
    assert_eq!(next.visit_history[0].source_action, "visit_n01");
    assert!(next.visit_history[0].visible);
}

#[test]
fn apply_player_converted_changes_role() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerConverted {
            target: "a".to_string(),
            new_role: "mafia_goon".to_string(),
            new_alignment: Some("mafia".to_string()),
            original_role: "vanilla_townie".to_string(),
            original_alignment: Some("town".to_string()),
            source: "cult".to_string(),
        }],
    );
    assert_eq!(find(&next, "a").role_key, "mafia_goon");
    // R2: a conversion is a faction change — alignment must move with the role.
    assert_eq!(find(&next, "a").alignment.as_deref(), Some("mafia"));
    assert_eq!(next.conversion_origins.len(), 1);
    assert_eq!(next.conversion_origins[0].target, "a");
    assert_eq!(next.conversion_origins[0].original_role, "vanilla_townie");
    assert_eq!(
        next.conversion_origins[0].original_alignment.as_deref(),
        Some("town")
    );
}

#[test]
fn apply_player_converted_keeps_first_origin() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 2,
        phase_id: "N02".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "cultist", "cult", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: vec![domain::ConversionOriginRecord {
            target: "a".to_string(),
            original_role: "cop".to_string(),
            original_alignment: Some("town".to_string()),
            source: "cult_leader".to_string(),
        }],
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerConverted {
            target: "a".to_string(),
            new_role: "mafia_goon".to_string(),
            new_alignment: Some("mafia".to_string()),
            original_role: "cultist".to_string(),
            original_alignment: Some("cult".to_string()),
            source: "converter".to_string(),
        }],
    );
    assert_eq!(next.conversion_origins.len(), 1);
    assert_eq!(next.conversion_origins[0].original_role, "cop");
}

#[test]
fn apply_events_is_a_pure_fold() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let events = vec![
        InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "factional_kill".to_string(),
            attackers: vec!["b".to_string()],
            unstoppable: false,
            death_reveal: DeathRevealMode::Full,
        },
        InnerEvent::PhaseAnnouncement(domain::events::PhaseAnnouncement {
            phase_id: "N01".to_string(),
            template_id: None,
            audience: None,
            deaths: vec![],
        }),
    ];
    // Same inputs -> byte-identical output, and the input state is untouched.
    let x = apply_events(&state, &events);
    let y = apply_events(&state, &events);
    assert_eq!(
        serde_json::to_string(&x).unwrap(),
        serde_json::to_string(&y).unwrap()
    );
    assert_eq!(
        find(&state, "a").status,
        SlotLifecycle::Alive,
        "input must not mutate"
    );
}

#[test]
fn apply_action_recorded_extends_history() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 2,
        phase_id: "N02".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "non_consecutive_cop", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[InnerEvent::ActionRecorded {
            actor: "a".to_string(),
            template_id: "investigate_alignment".to_string(),
            targets: vec!["b".to_string()],
            phase_id: "N02".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 2,
            status: "resolved".to_string(),
        }],
    );

    assert_eq!(next.action_history.len(), 1);
    assert_eq!(next.action_history[0].targets, vec!["b"]);
    assert!(state.action_history.is_empty(), "input must not mutate");
}

#[test]
fn apply_action_granted_extends_grants() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "motivator", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[InnerEvent::ActionGranted {
            grant_id: "extra_action".to_string(),
            grant_option: None,
            kind: GrantKind::ExtraAction,
            actor: "a".to_string(),
            target: "b".to_string(),
            source_action: "motivate_n01".to_string(),
            uses: 1,
            vote_weight: None,
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
        }],
    );

    assert_eq!(next.action_grants.len(), 1);
    assert_eq!(next.action_grants[0].grant_id, "extra_action");
    assert_eq!(next.action_grants[0].target, "b");
    assert_eq!(next.action_grants[0].source_action, "motivate_n01");
    assert!(state.action_grants.is_empty(), "input must not mutate");
}

#[test]
fn apply_action_grant_consumed_decrements_explicitly_sourced_grant() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 2,
        phase_id: "N02".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "motivator", "town", "alive"),
            slot("b", "cop", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: vec![
            domain::state::ActionGrantRecord {
                grant_id: "extra_action".to_string(),
                grant_option: None,
                kind: GrantKind::ExtraAction,
                actor: "a".to_string(),
                target: "b".to_string(),
                source_action: "motivate_n01".to_string(),
                uses: 1,
                vote_weight: None,
                phase_id: "N01".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 1,
            },
            domain::state::ActionGrantRecord {
                grant_id: "extra_action".to_string(),
                grant_option: None,
                kind: GrantKind::ExtraAction,
                actor: "a".to_string(),
                target: "b".to_string(),
                source_action: "motivate_n02".to_string(),
                uses: 1,
                vote_weight: None,
                phase_id: "N02".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 2,
            },
        ],
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[InnerEvent::ActionGrantConsumed {
            grant_id: "extra_action".to_string(),
            actor: "b".to_string(),
            action_id: "cop_extra_n02".to_string(),
            source_action: "motivate_n01".to_string(),
            phase_id: "N02".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 2,
            remaining_uses: 0,
        }],
    );

    assert_eq!(next.action_grants[0].uses, 0);
    assert_eq!(next.action_grants[1].uses, 1);
    assert_eq!(state.action_grants[0].uses, 1, "input must not mutate");
}

#[test]
fn apply_action_use_counted_upserts_counter_state() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![slot("a", "vigilante", "town", "alive")],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[InnerEvent::ActionUseCounted {
            counter_id: "x_shot:night_kill".to_string(),
            actor: "a".to_string(),
            template_id: "night_kill".to_string(),
            consumed_action: "vig_n01".to_string(),
            cadence_policy: "x_shot".to_string(),
            phase_scope: "game".to_string(),
            limit: 1,
            used: 1,
            remaining: 0,
            phase_id: "N01".to_string(),
            phase_kind: PhaseKind::Night,
            phase_number: 1,
        }],
    );

    assert_eq!(next.use_counters.len(), 1);
    let counter = &next.use_counters[0];
    assert_eq!(counter.counter_id, "x_shot:night_kill");
    assert_eq!(counter.actor, "a");
    assert_eq!(counter.template_id, "night_kill");
    assert_eq!(counter.consumed_action, "vig_n01");
    assert_eq!(counter.cadence_policy, "x_shot");
    assert_eq!(counter.phase_scope, "game");
    assert_eq!(counter.limit, 1);
    assert_eq!(counter.used, 1);
    assert_eq!(counter.remaining, 0);
    assert!(state.use_counters.is_empty(), "input must not mutate");
}

#[test]
fn apply_players_linked_extends_links() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[
            InnerEvent::PlayersLinked {
                link_id: "link_001".to_string(),
                slots: vec!["a".to_string(), "b".to_string()],
                source: "cupid".to_string(),
            },
            InnerEvent::PlayersLinked {
                link_id: "link_001".to_string(),
                slots: vec!["a".to_string(), "b".to_string()],
                source: "cupid".to_string(),
            },
        ],
    );

    assert_eq!(next.linked_slots.len(), 1);
    assert_eq!(next.linked_slots[0].slots, vec!["a", "b"]);
    assert!(state.linked_slots.is_empty(), "input must not mutate");
}

#[test]
fn apply_retaliation_armed_upserts_choice() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "hunter", "town", "alive"),
            slot("b", "mafia_goon", "mafia", "alive"),
            slot("c", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[
            InnerEvent::RetaliationArmed {
                retaliation_id: "hunt_001".to_string(),
                actor: "a".to_string(),
                target: "b".to_string(),
                source_action: "hunter_retaliate".to_string(),
            },
            InnerEvent::RetaliationArmed {
                retaliation_id: "hunt_001".to_string(),
                actor: "a".to_string(),
                target: "c".to_string(),
                source_action: "hunter_retaliate".to_string(),
            },
        ],
    );

    assert_eq!(next.retaliations.len(), 1);
    assert_eq!(next.retaliations[0].target, "c");
    assert!(state.retaliations.is_empty(), "input must not mutate");
}

#[test]
fn apply_backup_targeted_upserts_choice() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "universal_backup", "town", "alive"),
            slot("b", "cop", "town", "alive"),
            slot("c", "doctor", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[
            InnerEvent::BackupTargeted {
                backup: "a".to_string(),
                source_target: "b".to_string(),
                source_role: "cop".to_string(),
                source_action: "target_backup_n01".to_string(),
                phase_id: "N01".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 1,
            },
            InnerEvent::BackupTargeted {
                backup: "a".to_string(),
                source_target: "c".to_string(),
                source_role: "doctor".to_string(),
                source_action: "target_backup_n02".to_string(),
                phase_id: "N02".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 2,
            },
        ],
    );

    assert_eq!(next.backup_targets.len(), 1);
    assert_eq!(next.backup_targets[0].source_target, "c");
    assert_eq!(next.backup_targets[0].source_role, "doctor");
    assert!(state.backup_targets.is_empty(), "input must not mutate");
}

#[test]
fn apply_target_lynch_win_targeted_upserts_by_policy_and_owner() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "executioner", "executioner", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
            slot("c", "doctor", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let next = apply_events(
        &state,
        &[
            InnerEvent::TargetLynchWinTargeted {
                policy: "executioner".to_string(),
                owner: "a".to_string(),
                target: "b".to_string(),
                effect: "execution_target".to_string(),
                source_action: "executioner_target_n01".to_string(),
                phase_id: "N01".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 1,
            },
            InnerEvent::TargetLynchWinTargeted {
                policy: "executioner".to_string(),
                owner: "a".to_string(),
                target: "c".to_string(),
                effect: "execution_target".to_string(),
                source_action: "executioner_target_n02".to_string(),
                phase_id: "N02".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 2,
            },
            InnerEvent::TargetLynchWinTargeted {
                policy: "condemner".to_string(),
                owner: "a".to_string(),
                target: "b".to_string(),
                effect: "condemner_target".to_string(),
                source_action: "condemner_target_n02".to_string(),
                phase_id: "N02".to_string(),
                phase_kind: PhaseKind::Night,
                phase_number: 2,
            },
        ],
    );

    assert_eq!(next.target_lynch_win_targets.len(), 2);
    assert_eq!(next.target_lynch_win_targets[0].target, "c");
    assert_eq!(
        next.target_lynch_win_targets[0].source_action,
        "executioner_target_n02"
    );
    assert_eq!(next.target_lynch_win_targets[1].policy, "condemner");
    assert_eq!(next.target_lynch_win_targets[1].target, "b");
    assert!(
        state.target_lynch_win_targets.is_empty(),
        "input must not mutate"
    );
}

#[test]
fn resolve_returns_applied_trace_and_post_state() {
    let pack = load_pack();
    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        phase_id: "D01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let output = resolve(ResolutionInput {
        game_id: "output".to_string(),
        phase_id: "D01".to_string(),
        run_id: "output:D01:1".to_string(),
        state,
        submissions: vec![
            vote("v1", "slot_1", "slot_3", 1),
            vote("v2", "slot_2", "slot_3", 2),
        ],
        day_phase_inputs: Default::default(),
        pack,
        seed: 9,
        logical_time: 42,
    });

    assert_eq!(output.applied.run_id, "output:D01:1");
    assert_eq!(output.trace.run_id, output.applied.run_id);
    assert_eq!(output.applied.started_at, 42);
    assert!(output
        .trace
        .decisions
        .iter()
        .any(|decision| decision.outcome == "day_vote_outcome"));
    assert_eq!(
        find(&output.post_state, "slot_3").status,
        SlotLifecycle::Dead
    );
}

#[test]
fn random_day_vote_tiebreak_is_seeded_and_deterministic() {
    let mut pack = load_pack();
    pack.vote.method = VoteMethod::Plurality;
    pack.vote.tie_breaker = VoteTieBreaker::Random;

    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
            slot("slot_4", "vanilla_townie", "town", "alive"),
            slot("slot_5", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let resolve_winner = |seed| {
        let output = resolve(ResolutionInput {
            game_id: format!("vote-random-{seed}"),
            phase_id: "D02".to_string(),
            run_id: format!("vote-random:D02:{seed}"),
            state: state.clone(),
            submissions: vec![
                vote("vote_1", "slot_1", "slot_3", 1),
                vote("vote_2", "slot_2", "slot_4", 2),
            ],
            day_phase_inputs: Default::default(),
            pack: pack.clone(),
            seed,
            logical_time: 100 + seed,
        });
        output
            .applied
            .events
            .into_iter()
            .find_map(|event| match event.event {
                InnerEvent::DayVoteOutcome(outcome) => Some(outcome),
                _ => None,
            })
            .expect("resolution should emit a day vote outcome")
    };

    let seed_one_first = resolve_winner(1);
    let seed_one_again = resolve_winner(1);
    let seed_four = resolve_winner(4);

    assert_eq!(seed_one_first.status, VoteStatus::Lynch);
    assert_eq!(seed_one_first.winner.as_deref(), Some("slot_3"));
    assert_eq!(seed_one_first.tiebreak.as_deref(), Some("Random"));
    assert_eq!(seed_one_first, seed_one_again);
    assert_eq!(seed_four.status, VoteStatus::Lynch);
    assert_eq!(seed_four.winner.as_deref(), Some("slot_4"));
    assert_eq!(seed_four.tiebreak.as_deref(), Some("Random"));
    assert_ne!(seed_one_first.winner, seed_four.winner);
}

#[test]
fn day_vote_ballots_are_last_write_wins_per_actor() {
    let mut pack = load_pack();
    pack.vote.method = VoteMethod::Majority;

    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
            slot("slot_4", "vanilla_townie", "town", "alive"),
            slot("slot_5", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let output = resolve(ResolutionInput {
        game_id: "last-write-votes".to_string(),
        phase_id: "D02".to_string(),
        run_id: "last-write-votes:D02:1".to_string(),
        state,
        submissions: vec![
            vote("vote_1a", "slot_1", "slot_4", 1),
            vote("vote_1b", "slot_1", "slot_5", 2),
            vote("vote_2a", "slot_2", "slot_4", 3),
            Submission {
                action_id: "vote_2_withdraw".to_string(),
                actor: "slot_2".to_string(),
                template_id: "day_vote".to_string(),
                targets: Vec::new(),
                phase_id: "D02".to_string(),
                submitted_at: 4,
                withdrawn: true,
                metadata: Default::default(),
            },
            vote("vote_3", "slot_3", "slot_5", 5),
        ],
        day_phase_inputs: Default::default(),
        pack,
        seed: 12,
        logical_time: 112,
    });

    let outcome = output
        .applied
        .events
        .iter()
        .find_map(|event| match &event.event {
            InnerEvent::DayVoteOutcome(outcome) => Some(outcome),
            _ => None,
        })
        .expect("resolution should emit a day vote outcome");
    assert_eq!(
        outcome.votes.get("slot_1").map(String::as_str),
        Some("slot_5"),
        "slot_1's later ballot should replace the earlier slot_4 ballot"
    );
    assert!(
        !outcome.votes.contains_key("slot_2"),
        "slot_2's withdrawal should remove the earlier active ballot"
    );
    assert_eq!(
        outcome.votes.get("slot_3").map(String::as_str),
        Some("slot_5")
    );
    assert_eq!(outcome.tallies.get("slot_4").copied(), None);
    assert_eq!(outcome.tallies.get("slot_5").copied(), Some(2.0));
    assert_eq!(outcome.status, VoteStatus::NoMajority);
}

#[test]
fn no_lynch_votes_produce_no_lynch_outcome_without_death() {
    let mut pack = load_pack();
    pack.vote.method = VoteMethod::Majority;
    pack.vote.no_lynch_allowed = true;

    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let output = resolve(ResolutionInput {
        game_id: "no-lynch".to_string(),
        phase_id: "D02".to_string(),
        run_id: "no-lynch:D02:1".to_string(),
        state,
        submissions: vec![
            vote("vote_1", "slot_1", "no_lynch", 1),
            vote("vote_2", "slot_2", "no_lynch", 2),
        ],
        day_phase_inputs: Default::default(),
        pack,
        seed: 11,
        logical_time: 111,
    });

    let outcome = output
        .applied
        .events
        .iter()
        .find_map(|event| match &event.event {
            InnerEvent::DayVoteOutcome(outcome) => Some(outcome),
            _ => None,
        })
        .expect("resolution should emit a day vote outcome");
    assert_eq!(outcome.status, VoteStatus::NoLynch);
    assert_eq!(outcome.winner, None);
    assert_eq!(
        outcome.tallies.get("no_lynch").copied(),
        Some(2.0),
        "no_lynch is an official pack-governed vote target"
    );
    assert!(
        output.applied.events.iter().all(|event| !matches!(
            &event.event,
            InnerEvent::PlayerKilled { cause, .. } if cause == "day_vote"
        )),
        "a no-lynch outcome must not emit a day-vote kill"
    );
}

#[test]
fn day_vote_statuses_distinguish_no_lynch_no_majority_and_tie() {
    let base_pack = load_pack();
    let state_for = |pack: &Pack| StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let resolve_status = |pack: Pack, submissions: Vec<Submission>, label: &str| {
        let output = resolve(ResolutionInput {
            game_id: format!("vote-status-{label}"),
            phase_id: "D02".to_string(),
            run_id: format!("vote-status:D02:{label}"),
            state: state_for(&pack),
            submissions,
            day_phase_inputs: Default::default(),
            pack,
            seed: 33,
            logical_time: 133,
        });
        output
            .applied
            .events
            .iter()
            .find_map(|event| match &event.event {
                InnerEvent::DayVoteOutcome(outcome) => Some(outcome.status),
                _ => None,
            })
            .expect("resolution should emit a day vote outcome")
    };

    let mut no_lynch_pack = base_pack.clone();
    no_lynch_pack.vote.method = VoteMethod::Majority;
    no_lynch_pack.vote.no_lynch_allowed = true;
    assert_eq!(
        resolve_status(
            no_lynch_pack,
            vec![
                vote("vote_1", "slot_1", "no_lynch", 1),
                vote("vote_2", "slot_2", "no_lynch", 2),
            ],
            "no-lynch",
        ),
        VoteStatus::NoLynch
    );

    let mut no_majority_pack = base_pack.clone();
    no_majority_pack.vote.method = VoteMethod::Majority;
    assert_eq!(
        resolve_status(
            no_majority_pack,
            vec![vote("vote_1", "slot_1", "slot_3", 1)],
            "no-majority",
        ),
        VoteStatus::NoMajority
    );

    let mut tie_pack = base_pack;
    tie_pack.vote.method = VoteMethod::Plurality;
    tie_pack.vote.tie_breaker = VoteTieBreaker::NoElimination;
    assert_eq!(
        resolve_status(
            tie_pack,
            vec![
                vote("vote_1", "slot_1", "slot_2", 1),
                vote("vote_2", "slot_2", "slot_3", 2),
            ],
            "tie",
        ),
        VoteStatus::Tie
    );
}

#[test]
fn day_vote_policy_matrix_covers_methods_and_tie_breakers() {
    let base_pack = load_pack();

    let state_for = |pack: &Pack| StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "vanilla_townie", "town", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    let resolve_outcome =
        |pack: Pack, submissions: Vec<Submission>, seed: u64, label: &str| -> DayVoteOutcome {
            let output = resolve(ResolutionInput {
                game_id: format!("vote-policy-{label}"),
                phase_id: "D02".to_string(),
                run_id: format!("vote-policy:D02:{label}"),
                state: state_for(&pack),
                submissions,
                day_phase_inputs: Default::default(),
                pack,
                seed,
                logical_time: 200 + seed,
            });
            output
                .applied
                .events
                .iter()
                .find_map(|event| match &event.event {
                    InnerEvent::DayVoteOutcome(outcome) => Some(outcome.clone()),
                    _ => None,
                })
                .expect("resolution should emit a day vote outcome")
        };

    let mut majority_pack = base_pack.clone();
    majority_pack.vote.method = VoteMethod::Majority;
    majority_pack.vote.hammer = false;
    let majority = resolve_outcome(
        majority_pack,
        vec![
            vote("majority_1", "slot_1", "slot_3", 1),
            vote("majority_2", "slot_2", "slot_3", 2),
        ],
        41,
        "majority",
    );
    assert_eq!(majority.status, VoteStatus::Lynch);
    assert_eq!(majority.winner.as_deref(), Some("slot_3"));
    assert_eq!(majority.majority, Some(2.0));
    assert_eq!(majority.tiebreak, None);

    let mut plurality_pack = base_pack.clone();
    plurality_pack.vote.method = VoteMethod::Plurality;
    plurality_pack.vote.tie_breaker = VoteTieBreaker::NoElimination;
    let plurality = resolve_outcome(
        plurality_pack,
        vec![vote("plurality_1", "slot_1", "slot_3", 1)],
        42,
        "plurality",
    );
    assert_eq!(plurality.status, VoteStatus::Lynch);
    assert_eq!(plurality.winner.as_deref(), Some("slot_3"));
    assert_eq!(plurality.majority, None);

    let mut supermajority_pack = base_pack.clone();
    supermajority_pack.vote.method = VoteMethod::Supermajority { num: 2, den: 3 };
    supermajority_pack.vote.hammer = false;
    let supermajority = resolve_outcome(
        supermajority_pack,
        vec![
            vote("supermajority_1", "slot_1", "slot_3", 1),
            vote("supermajority_2", "slot_2", "slot_3", 2),
        ],
        43,
        "supermajority",
    );
    assert_eq!(supermajority.status, VoteStatus::Lynch);
    assert_eq!(supermajority.winner.as_deref(), Some("slot_3"));
    assert_eq!(supermajority.majority, Some(2.0));

    let mut hammer_pack = base_pack.clone();
    hammer_pack.vote.method = VoteMethod::Majority;
    hammer_pack.vote.hammer = true;
    let hammer = resolve_outcome(
        hammer_pack,
        vec![
            vote("hammer_1", "slot_1", "slot_3", 1),
            vote("hammer_2", "slot_2", "slot_3", 2),
        ],
        44,
        "hammer",
    );
    assert_eq!(hammer.status, VoteStatus::Hammer);
    assert_eq!(hammer.winner.as_deref(), Some("slot_3"));

    let split_votes = vec![
        vote("tie_1", "slot_1", "slot_2", 1),
        vote("tie_2", "slot_2", "slot_3", 2),
    ];

    let mut no_elimination_pack = base_pack.clone();
    no_elimination_pack.vote.method = VoteMethod::Plurality;
    no_elimination_pack.vote.tie_breaker = VoteTieBreaker::NoElimination;
    let no_elimination = resolve_outcome(
        no_elimination_pack,
        split_votes.clone(),
        45,
        "no-elimination",
    );
    assert_eq!(no_elimination.status, VoteStatus::Tie);
    assert_eq!(no_elimination.winner, None);
    assert_eq!(no_elimination.contenders, vec!["slot_2", "slot_3"]);
    assert_eq!(no_elimination.tiebreak.as_deref(), Some("NoElimination"));

    let mut earliest_reached_pack = base_pack.clone();
    earliest_reached_pack.vote.method = VoteMethod::Plurality;
    earliest_reached_pack.vote.tie_breaker = VoteTieBreaker::EarliestReached;
    // `earliest_a` must win the same-timestamp ordering despite appearing second.
    let mut withdraw_slot_3 = vote("earliest_d", "slot_3", "slot_2", 3);
    withdraw_slot_3.withdrawn = true;
    let earliest_reached = resolve_outcome(
        earliest_reached_pack,
        vec![
            vote("earliest_b", "slot_2", "slot_3", 1),
            vote("earliest_a", "slot_1", "slot_2", 1),
            vote("earliest_c", "slot_3", "slot_2", 2),
            withdraw_slot_3,
        ],
        46,
        "earliest-reached",
    );
    assert_eq!(earliest_reached.status, VoteStatus::Lynch);
    assert_eq!(earliest_reached.winner.as_deref(), Some("slot_2"));
    assert_eq!(
        earliest_reached.tiebreak.as_deref(),
        Some("EarliestReached")
    );
    assert_eq!(
        earliest_reached.reason.as_deref(),
        Some("earliest reached final tally selected slot_2")
    );

    let mut host_decides_pack = base_pack.clone();
    host_decides_pack.vote.method = VoteMethod::Plurality;
    host_decides_pack.vote.tie_breaker = VoteTieBreaker::HostDecides;
    let host_decides = resolve_outcome(host_decides_pack, split_votes.clone(), 46, "host-decides");
    assert_eq!(host_decides.status, VoteStatus::Tie);
    assert_eq!(host_decides.winner, None);
    assert_eq!(host_decides.contenders, vec!["slot_2", "slot_3"]);
    assert_eq!(host_decides.tiebreak.as_deref(), Some("HostDecides"));

    let mut random_pack = base_pack;
    random_pack.vote.method = VoteMethod::Plurality;
    random_pack.vote.tie_breaker = VoteTieBreaker::Random;
    let random_first = resolve_outcome(random_pack.clone(), split_votes.clone(), 47, "random-a");
    let random_again = resolve_outcome(random_pack, split_votes, 47, "random-b");
    assert_eq!(random_first.status, VoteStatus::Lynch);
    assert_eq!(random_first.tiebreak.as_deref(), Some("Random"));
    assert_eq!(random_first, random_again);
    assert!(matches!(
        random_first.winner.as_deref(),
        Some("slot_2") | Some("slot_3")
    ));
}

// ───────────────────────── check_win ─────────────────────────

#[test]
fn check_win_town_when_mafia_eliminated() {
    let pack = load_pack();
    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        phase_id: "D02".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    match check_win(&state, &pack) {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "town"),
        other => panic!("expected town win, got {other:?}"),
    }
}

#[test]
fn check_win_mafia_at_parity() {
    let pack = load_pack();
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    match check_win(&state, &pack) {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "mafia"),
        other => panic!("expected mafia win, got {other:?}"),
    }
}

#[test]
fn check_win_none_when_game_continues() {
    let pack = load_pack();
    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        phase_id: "D01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    assert!(check_win(&state, &pack).is_none());
}

// ───────────────── epicmafia 3-faction win semantics (R5) ─────────────────

#[test]
fn epicmafia_town_wins_only_when_both_mafia_and_cult_eliminated() {
    let pack = load_pack_named("epicmafia");
    // mafia dead but cult still alive -> NOT a town win yet (AllOthers not met).
    let still_cult = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 3,
        phase_id: "D03".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("a", "villager", "town", "alive"),
            slot("b", "villager", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
            slot("c", "cultist", "cult", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    // town(2) vs others(1 cult): town AllOthers? no. mafia parity? 0 -> no.
    // cult parity? 1 >= 2? no. So no win while the cult survives.
    assert!(check_win(&still_cult, &pack).is_none());

    // Both mafia AND cult eliminated -> town wins via AllOtherFactionsEliminated.
    let both_dead = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 4,
        phase_id: "D04".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("a", "villager", "town", "alive"),
            slot("b", "villager", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
            slot("c", "cultist", "cult", "dead"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    match check_win(&both_dead, &pack) {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "town"),
        other => panic!("expected town win, got {other:?}"),
    }
}

#[test]
fn epicmafia_cult_wins_at_parity() {
    let pack = load_pack_named("epicmafia");
    // cult(1) vs others(1 town) -> cult parity fires (mafia already gone).
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 2,
        phase_id: "N02".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("t", "villager", "town", "alive"),
            slot("c", "cult_leader", "cult", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    match check_win(&state, &pack) {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "cult"),
        other => panic!("expected cult win, got {other:?}"),
    }
}

// ───────────────────── multi-phase end-to-end ─────────────────────

/// Resolve a night, fold its events forward with `apply_events`, then resolve
/// the next day window on the carried-forward state and assert (a) state evolved
/// correctly and (b) the win is detected at the right moment — not before.
#[test]
fn multi_phase_state_carries_forward_and_win_fires_at_the_right_point() {
    let pack = load_pack();

    // N01 roster: 2 town + 1 mafia. Mafia kills one townie (no protector).
    let n01 = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("slot_1", "mafia_goon", "mafia", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let night_events = resolved_events(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "N01".to_string(),
        run_id: "mp:N01:1".to_string(),
        state: n01.clone(),
        submissions: vec![Submission {
            action_id: "k1".to_string(),
            actor: "slot_1".to_string(),
            template_id: "factional_kill".to_string(),
            targets: vec!["slot_2".to_string()],
            phase_id: "N01".to_string(),
            submitted_at: 1,
            withdrawn: false,
            metadata: Default::default(),
        }],
        day_phase_inputs: Default::default(),
        pack: pack.clone(),
        seed: 1,
        logical_time: 1,
    });

    // After N01: slot_2 dead. Alive = slot_1 mafia + slot_3 town = parity 1-1,
    // so the mafia win ALREADY fires at the end of the night.
    assert!(
        night_events
            .iter()
            .any(|e| matches!(e, InnerEvent::WinReached { .. })),
        "mafia should win at N01 once it reaches parity"
    );

    // Fold the night forward: state must carry slot_2's death across the phase.
    let after_n01 = apply_events(&n01, &night_events);
    assert_eq!(find(&after_n01, "slot_2").status, SlotLifecycle::Dead);
    assert_eq!(find(&after_n01, "slot_1").status, SlotLifecycle::Alive);
    assert_eq!(find(&after_n01, "slot_3").status, SlotLifecycle::Alive);

    // Now demonstrate the negative case: a roster that does NOT reach a win on
    // the night, then reaches one on the following day lynch.
    let n01_safe = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: load_pack().phases,
        slots: vec![
            slot("slot_1", "mafia_goon", "mafia", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
            slot("slot_4", "vanilla_townie", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };
    let night_safe = resolved_events(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "N01".to_string(),
        run_id: "mp:N01:safe".to_string(),
        state: n01_safe.clone(),
        submissions: vec![Submission {
            action_id: "k1".to_string(),
            actor: "slot_1".to_string(),
            template_id: "factional_kill".to_string(),
            targets: vec!["slot_2".to_string()],
            phase_id: "N01".to_string(),
            submitted_at: 1,
            withdrawn: false,
            metadata: Default::default(),
        }],
        day_phase_inputs: Default::default(),
        pack: pack.clone(),
        seed: 1,
        logical_time: 1,
    });
    // After this night: mafia 1, town 2 -> no parity, no win yet.
    assert!(
        !night_safe
            .iter()
            .any(|e| matches!(e, InnerEvent::WinReached { .. })),
        "no win should fire while town outnumbers mafia"
    );
    let after_safe = apply_events(&n01_safe, &night_safe);
    assert_eq!(find(&after_safe, "slot_2").status, SlotLifecycle::Dead);

    // D02 on the carried-forward state (advance the cursor — the engine's job,
    // not apply_events'): town lynches the mafia goon. Mafia eliminated -> town wins.
    let mut d02 = after_safe.clone();
    d02.phase_kind = PhaseKind::Day;
    d02.phase_number = 2;
    let day_events = resolved_events(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "D02".to_string(),
        run_id: "mp:D02:1".to_string(),
        state: d02.clone(),
        submissions: vec![
            vote("v1", "slot_3", "slot_1", 1),
            vote("v2", "slot_4", "slot_1", 2),
        ],
        pack: pack.clone(),
        day_phase_inputs: Default::default(),
        seed: 1,
        logical_time: 2,
    });

    // slot_1 (the only mafia) is lynched -> mafia eliminated -> town wins.
    let lynched = day_events.iter().any(
        |e| matches!(e, InnerEvent::DayVoteOutcome(o) if o.winner.as_deref() == Some("slot_1")),
    );
    assert!(lynched, "slot_1 should be lynched on D02");
    // R1: the lynch ALSO emits a PlayerKilled so the death folds uniformly.
    assert!(
        day_events.iter().any(|e| matches!(
            e,
            InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable, .. }
                if slot_id == "slot_1" && cause == "day_vote" && attackers.is_empty() && *unstoppable
        )),
        "the lynch must emit a PlayerKilled (cause=day_vote, unstoppable, no attackers)"
    );
    match day_events.last() {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "town"),
        other => panic!("expected trailing town WinReached, got {other:?}"),
    }
    // Contract note (R1): the lynch now folds through `apply_events` like any
    // other death, because the resolver emits a `PlayerKilled` for it. The
    // lynched slot is therefore "dead" after the fold — no special apply path.
    let after_d02 = apply_events(&d02, &day_events);
    assert_eq!(
        find(&after_d02, "slot_1").status,
        SlotLifecycle::Dead,
        "R1: apply_events folds the lynch PlayerKilled to dead"
    );
}

// ─────────────────── arsonist: persistent cross-phase ───────────────────

/// PERSISTENT-effect primitive, end to end across phases (doc 09). N01: the
/// Arsonist `douse`s two slots -> `EffectsMarked`. The marks are folded forward
/// with `apply_events`, surviving the phase boundary on the carried state. N02:
/// the Arsonist `ignite`s -> a Kill that READS the "doused" effect and kills
/// every doused slot. This proves a persistent effect written one phase is read
/// the next, with no per-night re-submission of the targets.
#[test]
fn arsonist_persistent_effect_carries_across_phases() {
    let pack = load_pack_named("epicmafia");

    let n01 = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_id: "N01".to_string(),
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "arsonist", "mafia", "alive"),
            slot("slot_2", "villager", "town", "alive"),
            slot("slot_3", "villager", "town", "alive"),
            slot("slot_4", "villager", "town", "alive"),
        ],
        private_channels: Vec::new(),
        effect_records: Vec::new(),
        action_history: Vec::new(),
        use_counters: Vec::new(),
        investigation_memory: Vec::new(),
        delayed_deaths: Vec::new(),
        visit_history: Vec::new(),
        action_grants: Vec::new(),
        conversion_origins: Vec::new(),
        linked_slots: Vec::new(),
        retaliations: Vec::new(),
        backup_targets: Vec::new(),
        target_lynch_win_targets: Vec::new(),
        wolf_carry_tokens: Vec::new(),
        wolf_beauty_marks: Vec::new(),
        badges: Vec::new(),
        buffered_ita_shots: Vec::new(),
    };

    // N01: douse slot_2.
    let n01_events = resolved_events(ResolutionInput {
        game_id: "arson".to_string(),
        phase_id: "N01".to_string(),
        run_id: "arson:N01:1".to_string(),
        state: n01.clone(),
        submissions: vec![Submission {
            action_id: "d1".to_string(),
            actor: "slot_1".to_string(),
            template_id: "douse".to_string(),
            targets: vec!["slot_2".to_string()],
            phase_id: "N01".to_string(),
            submitted_at: 1,
            withdrawn: false,
            metadata: Default::default(),
        }],
        day_phase_inputs: Default::default(),
        pack: pack.clone(),
        seed: 1,
        logical_time: 1,
    });
    assert!(
        n01_events.iter().any(|e| matches!(
            e,
            InnerEvent::EffectsMarked { effect, target, .. }
                if effect == "doused" && target == "slot_2"
        )),
        "N01 douse must emit EffectsMarked(doused, slot_2)"
    );
    // No kill on N01 (douse alone never kills).
    assert!(
        !n01_events
            .iter()
            .any(|e| matches!(e, InnerEvent::PlayerKilled { .. })),
        "douse alone must not kill"
    );

    // Fold N01 forward: slot_2 now carries the persistent "doused" tag.
    let after_n01 = apply_events(&n01, &n01_events);
    assert_eq!(
        find(&after_n01, "slot_2").effects,
        vec!["doused".to_string()]
    );

    // N02: douse slot_3, then ignite. Advance the phase cursor (engine's job).
    let mut n02 = after_n01.clone();
    n02.phase_number = 2;
    let n02_events = resolved_events(ResolutionInput {
        game_id: "arson".to_string(),
        phase_id: "N02".to_string(),
        run_id: "arson:N02:1".to_string(),
        state: n02.clone(),
        submissions: vec![
            Submission {
                action_id: "d2".to_string(),
                actor: "slot_1".to_string(),
                template_id: "douse".to_string(),
                targets: vec!["slot_3".to_string()],
                phase_id: "N02".to_string(),
                submitted_at: 1,
                withdrawn: false,
                metadata: Default::default(),
            },
            Submission {
                action_id: "ig".to_string(),
                actor: "slot_1".to_string(),
                template_id: "ignite".to_string(),
                targets: vec![],
                phase_id: "N02".to_string(),
                submitted_at: 2,
                withdrawn: false,
                metadata: Default::default(),
            },
        ],
        pack: pack.clone(),
        day_phase_inputs: Default::default(),
        seed: 1,
        logical_time: 2,
    });

    // ignite reads the "doused" effect off the state. slot_2 was doused on N01
    // (and carried across via apply_events); slot_3's N02 douse (priority 60) is
    // emitted before ignite (priority 30) but folds onto state only after this
    // resolution — so this night ignite kills exactly the PRE-EXISTING doused
    // slot_2, proving cross-phase persistence (not same-night same-resolution).
    let killed: Vec<&str> = n02_events
        .iter()
        .filter_map(|e| match e {
            InnerEvent::PlayerKilled { slot_id, cause, .. } if cause == "ignite" => {
                Some(slot_id.as_str())
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        killed,
        vec!["slot_2"],
        "ignite must kill exactly the slot doused on the PRIOR night (slot_2)"
    );

    // And slot_3's fresh douse is recorded this night for a FUTURE ignite.
    assert!(
        n02_events.iter().any(|e| matches!(
            e,
            InnerEvent::EffectsMarked { effect, target, .. }
                if effect == "doused" && target == "slot_3"
        )),
        "N02 douse must mark slot_3 for a later ignite"
    );

    // Fold N02: slot_2 dead, slot_3 now doused (ready for the next ignite).
    let after_n02 = apply_events(&n02, &n02_events);
    assert_eq!(find(&after_n02, "slot_2").status, SlotLifecycle::Dead);
    assert_eq!(
        find(&after_n02, "slot_3").effects,
        vec!["doused".to_string()]
    );
}

fn vote(action_id: &str, actor: &str, target: &str, at: u64) -> Submission {
    Submission {
        action_id: action_id.to_string(),
        actor: actor.to_string(),
        template_id: "day_vote".to_string(),
        targets: vec![target.to_string()],
        phase_id: "D02".to_string(),
        submitted_at: at,
        withdrawn: false,
        metadata: Default::default(),
    }
}
