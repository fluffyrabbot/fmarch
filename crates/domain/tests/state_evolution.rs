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
    load_pack_named("mafiascum")
}

fn load_pack_named(name: &str) -> Pack {
    let p = repo_root().join("packs").join(name).join("pack.json");
    let raw = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("read {p:?}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("deserialize {name}/pack.json: {e}"))
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
            new_alignment: Some("mafia".to_string()),
            original_role: "vanilla_townie".to_string(),
            source: "cult".to_string(),
        }],
    );
    assert_eq!(find(&next, "a").role_key, "mafia_goon");
    // R2: a conversion is a faction change — alignment must move with the role.
    assert_eq!(find(&next, "a").alignment.as_deref(), Some("mafia"));
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

// ───────────────── epicmafia 3-faction win semantics (R5) ─────────────────

#[test]
fn epicmafia_town_wins_only_when_both_mafia_and_cult_eliminated() {
    let pack = load_pack_named("epicmafia");
    // mafia dead but cult still alive -> NOT a town win yet (AllOthers not met).
    let still_cult = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 3,
        slots: vec![
            slot("a", "villager", "town", "alive"),
            slot("b", "villager", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
            slot("c", "cultist", "cult", "alive"),
        ],
    };
    // town(2) vs others(1 cult): town AllOthers? no. mafia parity? 0 -> no.
    // cult parity? 1 >= 2? no. So no win while the cult survives.
    assert!(check_win(&still_cult, &pack).is_none());

    // Both mafia AND cult eliminated -> town wins via AllOtherFactionsEliminated.
    let both_dead = StateSnapshot {
        phase_kind: PhaseKind::Day,
        phase_number: 4,
        slots: vec![
            slot("a", "villager", "town", "alive"),
            slot("b", "villager", "town", "alive"),
            slot("m", "mafia_goon", "mafia", "dead"),
            slot("c", "cultist", "cult", "dead"),
        ],
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
        slots: vec![
            slot("t", "villager", "town", "alive"),
            slot("c", "cult_leader", "cult", "alive"),
        ],
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
    // R1: the lynch ALSO emits a PlayerKilled so the death folds uniformly.
    assert!(
        day_events.iter().any(|e| matches!(
            e,
            InnerEvent::PlayerKilled { slot_id, cause, attackers, unstoppable }
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
        "dead",
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
        slots: vec![
            slot("slot_1", "arsonist", "mafia", "alive"),
            slot("slot_2", "villager", "town", "alive"),
            slot("slot_3", "villager", "town", "alive"),
            slot("slot_4", "villager", "town", "alive"),
        ],
    };

    // N01: douse slot_2.
    let n01_events = resolve(ResolutionInput {
        game_id: "arson".to_string(),
        phase_id: "N01".to_string(),
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
        pack: pack.clone(),
        seed: 1,
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
    let n02_events = resolve(ResolutionInput {
        game_id: "arson".to_string(),
        phase_id: "N02".to_string(),
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
        seed: 1,
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
    assert_eq!(find(&after_n02, "slot_2").status, "dead");
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
