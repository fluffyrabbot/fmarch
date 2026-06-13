//! Cross-phase state evolution tests (doc 09): `apply_events` (the canonical
//! state-fold), `check_win` (WinPolicy evaluation), and an end-to-end
//! multi-phase scenario that resolves a night, folds the result forward, then
//! resolves the next window and asserts the win fires at the right point.
//!
//! Hermetic: the pack is loaded from the repo relative to `CARGO_MANIFEST_DIR`.

use std::path::PathBuf;

use domain::events::InnerEvent;
use domain::pack::{Pack, PhaseKind};
use domain::resolver::{check_win, resolve, ResolutionInput};
use domain::state::{apply_events, SlotState, StateSnapshot, Submission};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}

fn load_pack() -> Pack {
    let p = repo_root().join("packs/mafiascum/pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize pack.json: {e}"))
}

fn slot(id: &str, role: &str, alignment: &str, status: &str) -> SlotState {
    SlotState {
        slot_id: id.to_string(),
        role_key: role.to_string(),
        alignment: Some(alignment.to_string()),
        status: status.to_string(),
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
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "factional_kill".to_string(),
            attackers: vec!["m".to_string()],
            unstoppable: false,
        }],
    );
    assert_eq!(find(&next, "a").status, "dead");
    // Phase cursor is carried through unchanged by the fold.
    assert_eq!(next.phase_number, 1);
    assert!(matches!(next.phase_kind, PhaseKind::Night));
}

#[test]
fn apply_player_saved_is_a_noop() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerSaved {
            slot_id: "a".to_string(),
            reasons: vec!["protected".to_string()],
            sources: vec!["doc".to_string()],
        }],
    );
    assert_eq!(find(&next, "a").status, "alive");
}

#[test]
fn apply_effects_mark_then_clear() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
    };
    let marked = apply_events(
        &state,
        &[
            InnerEvent::EffectsMarked {
                effect: "poisoned".to_string(),
                target: "a".to_string(),
                actor: "p".to_string(),
            },
            // Re-marking the same effect is idempotent (de-duplicated).
            InnerEvent::EffectsMarked {
                effect: "poisoned".to_string(),
                target: "a".to_string(),
                actor: "p".to_string(),
            },
        ],
    );
    assert_eq!(find(&marked, "a").effects, vec!["poisoned".to_string()]);

    let cleared = apply_events(
        &marked,
        &[InnerEvent::EffectsCleared {
            effect: "poisoned".to_string(),
            targets: vec!["a".to_string()],
            actor: "p".to_string(),
        }],
    );
    assert!(find(&cleared, "a").effects.is_empty());
}

#[test]
fn apply_player_converted_changes_role() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        slots: vec![slot("a", "vanilla_townie", "town", "alive")],
    };
    let next = apply_events(
        &state,
        &[InnerEvent::PlayerConverted {
            target: "a".to_string(),
            new_role: "mafia_goon".to_string(),
            original_role: "vanilla_townie".to_string(),
            source: "cult".to_string(),
        }],
    );
    assert_eq!(find(&next, "a").role_key, "mafia_goon");
}

#[test]
fn apply_events_is_a_pure_fold() {
    let state = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "mafia_goon", "mafia", "alive"),
        ],
    };
    let events = vec![
        InnerEvent::PlayerKilled {
            slot_id: "a".to_string(),
            cause: "factional_kill".to_string(),
            attackers: vec!["b".to_string()],
            unstoppable: false,
        },
        InnerEvent::PhaseAnnouncement(domain::events::PhaseAnnouncement {
            phase_id: "N01".to_string(),
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
    assert_eq!(find(&state, "a").status, "alive", "input must not mutate");
}

// ───────────────────────── check_win ─────────────────────────

#[test]
fn check_win_town_when_mafia_eliminated() {
    let pack = load_pack();
    let state = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 2,
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
        ],
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
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "alive"),
        ],
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
        slots: vec![
            slot("a", "vanilla_townie", "town", "alive"),
            slot("b", "vanilla_townie", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "alive"),
        ],
    };
    assert!(check_win(&state, &pack).is_none());
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
        slots: vec![
            slot("slot_1", "mafia_goon", "mafia", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
        ],
    };
    let night_events = resolve(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "N01".to_string(),
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
        pack: pack.clone(),
        seed: 1,
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
    assert_eq!(find(&after_n01, "slot_2").status, "dead");
    assert_eq!(find(&after_n01, "slot_1").status, "alive");
    assert_eq!(find(&after_n01, "slot_3").status, "alive");

    // Now demonstrate the negative case: a roster that does NOT reach a win on
    // the night, then reaches one on the following day lynch.
    let n01_safe = StateSnapshot {
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        slots: vec![
            slot("slot_1", "mafia_goon", "mafia", "alive"),
            slot("slot_2", "vanilla_townie", "town", "alive"),
            slot("slot_3", "vanilla_townie", "town", "alive"),
            slot("slot_4", "vanilla_townie", "town", "alive"),
        ],
    };
    let night_safe = resolve(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "N01".to_string(),
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
        pack: pack.clone(),
        seed: 1,
    });
    // After this night: mafia 1, town 2 -> no parity, no win yet.
    assert!(
        !night_safe
            .iter()
            .any(|e| matches!(e, InnerEvent::WinReached { .. })),
        "no win should fire while town outnumbers mafia"
    );
    let after_safe = apply_events(&n01_safe, &night_safe);
    assert_eq!(find(&after_safe, "slot_2").status, "dead");

    // D02 on the carried-forward state (advance the cursor — the engine's job,
    // not apply_events'): town lynches the mafia goon. Mafia eliminated -> town wins.
    let mut d02 = after_safe.clone();
    d02.phase_kind = PhaseKind::Day;
    d02.phase_number = 2;
    let day_events = resolve(ResolutionInput {
        game_id: "mp".to_string(),
        phase_id: "D02".to_string(),
        state: d02.clone(),
        submissions: vec![
            vote("v1", "slot_3", "slot_1", 1),
            vote("v2", "slot_4", "slot_1", 2),
        ],
        pack: pack.clone(),
        seed: 1,
    });

    // slot_1 (the only mafia) is lynched -> mafia eliminated -> town wins.
    let lynched = day_events.iter().any(
        |e| matches!(e, InnerEvent::DayVoteOutcome(o) if o.winner.as_deref() == Some("slot_1")),
    );
    assert!(lynched, "slot_1 should be lynched on D02");
    match day_events.last() {
        Some(InnerEvent::WinReached { winner, .. }) => assert_eq!(winner, "town"),
        other => panic!("expected trailing town WinReached, got {other:?}"),
    }
    // Contract note: `apply_events` folds the night-style death events; the day
    // *lynch* is carried by `DayVoteOutcome.winner` (doc 10) and is NOT one of
    // apply_events' folded kinds, so the lynched slot is still "alive" after the
    // fold alone. The resolver applies the lynch locally for its phase-end
    // win-check; persisting it into the next StateSnapshot is the engine's job.
    let after_d02 = apply_events(&d02, &day_events);
    assert_eq!(
        find(&after_d02, "slot_1").status,
        "alive",
        "apply_events does not fold the lynch death (DayVoteOutcome.winner)"
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
