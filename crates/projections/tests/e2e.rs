//! End-to-end + determinism integration tests against REAL Postgres.
//!
//! The migrations dir bundles BOTH the event-store schema (0001) and the
//! projection tables (0002), so one `#[sqlx::test(migrations = ...)]` builds the
//! full schema on an ephemeral DB. Requires `DATABASE_URL` (compose PG :5544);
//! never silently passes without a DB.

use std::collections::BTreeMap;
use std::process::Command as ProcessCommand;

use domain::events::{IndexedEvent, ResolutionCounts};
use domain::pack::{GrantKind, Pack, PhaseKind};
use domain::state::{RevealState, SlotLifecycle, SlotState, StateSnapshot, Submission};
use domain::{resolve, InnerEvent, ResolutionApplied, ResolutionInput};
use eventstore::{ActorId, EventInput};
use projections::{
    action_counters, action_grants, append_and_project, append_discussion_and_project,
    append_profile_and_project, audit_rebuild, day_vote_outcomes, discussion_area_by_slug,
    discussion_posts, discussion_topic_by_id, discussion_topics, game_index, host_phase_controls,
    host_prompts, phase_state, player_notifications, profile_editor_by_handle,
    public_profile_by_handle, rebuild, rebuild_discussion_stream, rebuild_profile_stream,
    slot_effects, slot_state, votecount,
};
use sqlx::PgPool;
use uuid::Uuid;

fn load_pack() -> Pack {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../packs/mafiascum/pack.json"
    );
    let raw = std::fs::read_to_string(path).expect("read pack.json");
    serde_json::from_str(&raw).expect("parse pack.json")
}

fn slot(id: &str, role: &str, align: &str) -> SlotState {
    SlotState {
        slot_id: id.into(),
        role_key: role.into(),
        alignment: Some(align.into()),
        role_reveal: RevealState::Private,
        alignment_reveal: RevealState::Private,
        status: SlotLifecycle::Alive,
        status_tags: vec![],
        effects: vec![],
    }
}

fn empty_phase_announcement(index: usize, phase_id: &str) -> IndexedEvent {
    IndexedEvent {
        index,
        event: InnerEvent::PhaseAnnouncement(domain::PhaseAnnouncement {
            phase_id: phase_id.into(),
            template_id: None,
            audience: None,
            deaths: Vec::new(),
        }),
    }
}

fn submission(action_id: &str, actor: &str, template: &str, target: &str, at: u64) -> Submission {
    Submission {
        action_id: action_id.into(),
        actor: actor.into(),
        template_id: template.into(),
        targets: vec![target.into()],
        phase_id: "N01".into(),
        submitted_at: at,
        withdrawn: false,
        metadata: BTreeMap::new(),
    }
}

/// Build the event stream a real command pipeline would write for a small game:
/// role assignments, day votes, then a night resolution that kills a slot.
fn scenario_events(pack: &Pack) -> Vec<EventInput> {
    let mut evs = Vec::new();

    // RoleAssigned for each slot (platform events). slot_4/slot_5 are extra
    // townies so that killing slot_3 leaves town ahead of mafia (no win-condition
    // is reached) — this scenario intentionally stays mid-game so role-reveal
    // remains off.
    for (sid, role) in [
        ("slot_1", "mafia_goon"),
        ("slot_2", "doctor"),
        ("slot_3", "vanilla_townie"),
        ("slot_4", "vanilla_townie"),
        ("slot_5", "vanilla_townie"),
    ] {
        evs.push(EventInput::new(
            "RoleAssigned",
            1,
            serde_json::json!({ "slot_id": sid, "role_key": role }),
            ActorId::System,
            10,
        ));
    }

    // Day-1 votes: slot_2 and slot_3 both vote slot_1; slot_1 votes slot_3.
    evs.push(EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": "slot_2", "target": "slot_1", "phase_id": "D01", "weight": 1.0 }),
        ActorId::Slot("slot_2".into()),
        20,
    ));
    evs.push(EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": "slot_3", "target": "slot_1", "phase_id": "D01", "weight": 1.0 }),
        ActorId::Slot("slot_3".into()),
        21,
    ));
    evs.push(EventInput::new(
        "VoteSubmitted",
        1,
        serde_json::json!({ "actor": "slot_1", "target": "slot_3", "phase_id": "D01", "weight": 1.0 }),
        ActorId::Slot("slot_1".into()),
        22,
    ));
    // slot_3 withdraws its vote on slot_1.
    evs.push(EventInput::new(
        "VoteWithdrawn",
        1,
        serde_json::json!({ "actor": "slot_3", "target": "slot_1", "phase_id": "D01", "weight": 1.0 }),
        ActorId::Slot("slot_3".into()),
        23,
    ));
    evs.push(EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "main",
            "slot_or_user": { "slot": "slot_2" },
            "body": "I think slot 1 is caught.",
            "phase_id": "D01",
        }),
        ActorId::Slot("slot_2".into()),
        24,
    ));

    // Night-1 resolution: Mafia kills slot_3, no protection → PlayerKilled.
    let state = StateSnapshot {
        phase_id: "N01".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        phase_deadline: None,
        phase_policy: pack.phases.clone(),
        slots: vec![
            slot("slot_1", "mafia_goon", "mafia"),
            slot("slot_2", "doctor", "town"),
            slot("slot_3", "vanilla_townie", "town"),
            slot("slot_4", "vanilla_townie", "town"),
            slot("slot_5", "vanilla_townie", "town"),
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
    let subs = vec![submission(
        "sub_001",
        "slot_1",
        "factional_kill",
        "slot_3",
        1,
    )];
    let output = resolve(ResolutionInput {
        game_id: "game_e2e".into(),
        phase_id: "N01".into(),
        run_id: "run_e2e_001".into(),
        state,
        submissions: subs,
        day_phase_inputs: Default::default(),
        pack: pack.clone(),
        seed: 424242,
        logical_time: 100,
    });
    // Sanity: the engine actually killed slot_3.
    assert!(
        output.applied.events.iter().any(
            |indexed| matches!(&indexed.event, domain::InnerEvent::PlayerKilled { slot_id, .. } if slot_id == "slot_3")
        ),
        "expected the resolver to kill slot_3, got {:?}",
        output.applied.events
    );

    evs.push(EventInput::new(
        "ResolutionApplied",
        1,
        serde_json::to_value(&output.applied).unwrap(),
        ActorId::System,
        200,
    ));

    evs
}

/// Engine → store → projection: persist the scenario via `append_and_project`
/// and assert the projections reflect it (read-your-writes, doc 02).
#[sqlx::test(migrations = "../projections/migrations")]
async fn engine_store_projection(pool: sqlx::PgPool) {
    let pack = load_pack();
    let game = Uuid::new_v4();
    let events = scenario_events(&pack);

    append_and_project(&pool, game, &events)
        .await
        .expect("append_and_project ok");

    // slot_state: slot_3 killed by the night resolution; slot_1/slot_2 alive.
    let slots = slot_state(&pool, game).await.unwrap();
    let by_id: BTreeMap<_, _> = slots.iter().map(|s| (s.slot_id.clone(), s)).collect();

    assert_eq!(by_id.len(), 5, "five slots projected");
    assert!(by_id["slot_1"].alive, "slot_1 alive");
    assert!(by_id["slot_2"].alive, "slot_2 alive");
    assert!(!by_id["slot_3"].alive, "slot_3 killed at night → dead");
    assert!(
        by_id["slot_4"].alive && by_id["slot_5"].alive,
        "extra townies alive"
    );

    // role_key folded from RoleAssigned; ordinary death flips reveal only the
    // killed slot while living roles remain hidden.
    assert_eq!(by_id["slot_2"].role_key.as_deref(), Some("doctor"));
    assert!(
        !by_id["slot_1"].role_revealed,
        "living roles remain hidden until end-game"
    );
    assert!(
        !by_id["slot_1"].alignment_revealed,
        "living alignments remain hidden until end-game"
    );
    assert!(
        by_id["slot_3"].role_revealed,
        "killed slot should be revealed by the ordinary death flip"
    );
    assert!(
        by_id["slot_3"].alignment_revealed,
        "killed slot alignment should be revealed by the ordinary death flip"
    );

    // votecount (running, ballot-keyed, UNWEIGHTED): D01 → slot_1 has 1 current
    // ballot (slot_2 and slot_3 both voted slot_1, then slot_3 withdrew). The
    // ballot targeting slot_3 is cleared when the night resolution kills that
    // slot, so dead targets cannot remain in the current tally.
    let vc = votecount(&pool, game).await.unwrap();
    let tally: BTreeMap<(String, String), i64> = vc
        .iter()
        .map(|r| ((r.phase_id.clone(), r.candidate_slot.clone()), r.count))
        .collect();
    assert_eq!(
        tally[&("D01".into(), "slot_1".into())],
        1,
        "2 ballots - 1 withdrawn = 1"
    );
    assert!(!tally.contains_key(&("D01".into(), "slot_3".into())));

    let thread = projections::thread_view(&pool, game, None, 50)
        .await
        .unwrap();
    assert_eq!(thread.posts.len(), 2);
    let player_post = thread
        .posts
        .iter()
        .find(|post| post.author_slot.as_deref() == Some("slot_2"))
        .expect("slot_2 player post");
    assert_eq!(player_post.phase_id, "D01");
    assert_eq!(player_post.body, "I think slot 1 is caught.");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn official_day_vote_outcome_projection_records_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let outcome = domain::DayVoteOutcome {
        status: domain::VoteStatus::NoLynch,
        winner: None,
        contenders: vec!["no_lynch".into()],
        tallies: BTreeMap::from([("no_lynch".into(), 2.0)]),
        votes: BTreeMap::from([
            ("slot_1".into(), "no_lynch".into()),
            ("slot_2".into(), "no_lynch".into()),
        ]),
        weights: BTreeMap::from([("slot_1".into(), 1.0), ("slot_2".into(), 1.0)]),
        majority: Some(2.0),
        thresholds: BTreeMap::from([("slot_1".into(), 2.0), ("slot_2".into(), 2.0)]),
        total_weight: 2.0,
        tiebreak: None,
        reason: Some("no_lynch reached the vote threshold".into()),
    };
    let applied = ResolutionApplied {
        phase_id: "D01".into(),
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        run_id: "run_day_vote_outcome_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 22,
        started_at: 22,
        finished_at: 23,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::DayVoteOutcome(outcome),
            },
            empty_phase_announcement(1, "D01"),
        ],
    };

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(applied).unwrap(),
            ActorId::System,
            9,
        )],
    )
    .await
    .unwrap();

    let rows = day_vote_outcomes(&pool, game).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].phase_id, "D01");
    assert_eq!(rows[0].source_seq, 1);
    assert_eq!(rows[0].status, "NoLynch");
    assert_eq!(rows[0].winner_slot, None);
    assert_eq!(rows[0].votes["slot_1"], "no_lynch");
    assert_eq!(rows[0].tallies["no_lynch"], 2.0);

    let before = serde_json::to_string(&rows).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before,
        serde_json::to_string(&day_vote_outcomes(&pool, game).await.unwrap()).unwrap(),
        "official day vote outcome rebuild must match incremental fold"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_decides_prompt_finalizes_official_day_vote_outcome(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let outcome = domain::DayVoteOutcome {
        status: domain::VoteStatus::Tie,
        winner: None,
        contenders: vec!["slot-1".into(), "slot-2".into()],
        tallies: BTreeMap::from([("slot-1".into(), 2.0), ("slot-2".into(), 2.0)]),
        votes: BTreeMap::new(),
        weights: BTreeMap::new(),
        majority: None,
        thresholds: BTreeMap::new(),
        total_weight: 4.0,
        tiebreak: Some("HostDecides".into()),
        reason: Some("tied vote requires host decision".into()),
    };
    let applied = ResolutionApplied {
        phase_id: "D01".into(),
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        run_id: "run_host_decides_outcome_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 23,
        started_at: 23,
        finished_at: 24,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::DayVoteOutcome(outcome),
            },
            empty_phase_announcement(1, "D01"),
        ],
    };

    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "ResolutionApplied",
                1,
                serde_json::to_value(applied).unwrap(),
                ActorId::System,
                1,
            ),
            EventInput::new(
                "HostPromptResolved",
                1,
                serde_json::json!({
                    "prompt_id": "D01:pk:Tie",
                    "phase_id": "D01",
                    "kind": "pk",
                    "reason": "host_decides_tie",
                    "decision": { "kind": "select_slot", "slot": "slot-2" },
                    "public_resolution": {
                        "kind": "day_vote_elimination",
                        "phase_id": "D01",
                        "selected_slot": "slot-2",
                        "reason": "host_decides_tie"
                    },
                    "resolved_by": "host_h"
                }),
                ActorId::Host,
                2,
            ),
        ],
    )
    .await
    .unwrap();

    let rows = day_vote_outcomes(&pool, game).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].status, "Lynch");
    assert_eq!(rows[0].winner_slot.as_deref(), Some("slot-2"));
    assert_eq!(rows[0].tiebreak.as_deref(), Some("HostDecides"));
    assert_eq!(rows[0].reason.as_deref(), Some("host_decides_tie"));
    assert_eq!(rows[0].tallies["slot-1"], 2.0);
    assert_eq!(rows[0].tallies["slot-2"], 2.0);

    let before = serde_json::to_string(&rows).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before,
        serde_json::to_string(&day_vote_outcomes(&pool, game).await.unwrap()).unwrap(),
        "HostDecides outcome rebuild must match incremental fold"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn effect_notifications_project_per_audience_slot_and_rebuild(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "N00".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 0,
        run_id: "run_notifications_001".into(),
        result_version: domain::RESULT_VERSION,
        seed: 10,
        started_at: 10,
        finished_at: 11,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::EffectNotification {
                    effect: "lovers_link".into(),
                    status: "link_001".into(),
                    audience: vec!["slot_2".into(), "slot_3".into()],
                },
            },
            empty_phase_announcement(1, "N00"),
        ],
    };

    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "SlotAdded",
                1,
                serde_json::json!({ "slot_id": "slot_2" }),
                ActorId::Host,
                1,
            ),
            EventInput::new(
                "SlotAdded",
                1,
                serde_json::json!({ "slot_id": "slot_3" }),
                ActorId::Host,
                2,
            ),
            EventInput::new(
                "ResolutionApplied",
                1,
                serde_json::to_value(applied).unwrap(),
                ActorId::System,
                3,
            ),
        ],
    )
    .await
    .unwrap();

    let notices = player_notifications(&pool, game).await.unwrap();
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].phase_id, "N00");
    assert_eq!(notices[0].event_index, 0);
    assert_eq!(notices[0].audience_slot, "slot_2");
    assert_eq!(notices[0].effect, "lovers_link");
    assert_eq!(notices[0].status, "link_001");
    assert_eq!(notices[1].audience_slot, "slot_3");

    let notices_before = serde_json::to_string(&notices).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        notices_before,
        serde_json::to_string(&player_notifications(&pool, game).await.unwrap()).unwrap(),
        "player_notification rebuild must preserve explicit-audience notices"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn host_prompt_projection_records_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "D01".into(),
        phase_kind: PhaseKind::Day,
        phase_number: 1,
        run_id: "run_host_prompt_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 101,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::HostPromptIssued(domain::HostPromptIssued {
                    prompt_id: "D01:skip_next_day:slot_1".into(),
                    kind: "skip_next_day".into(),
                    subject: Some("slot_1".into()),
                    reason: "beloved_princess_lynched".into(),
                    phase_id: "D01".into(),
                    phase_kind: PhaseKind::Day,
                    phase_number: 1,
                    metadata: serde_json::json!({
                        "policy": "beloved_princess",
                        "death_cause": "lynch",
                        "role": "beloved_princess"
                    }),
                }),
            },
            empty_phase_announcement(1, "D01"),
        ],
        started_at: 10,
        finished_at: 11,
    };

    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "SlotAdded",
                1,
                serde_json::json!({ "slot_id": "slot_1" }),
                ActorId::Host,
                1,
            ),
            EventInput::new(
                "ResolutionApplied",
                1,
                serde_json::to_value(applied).unwrap(),
                ActorId::System,
                2,
            ),
        ],
    )
    .await
    .unwrap();

    let before = host_prompts(&pool, game).await.unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].phase_id, "D01");
    assert_eq!(before[0].event_index, 0);
    assert_eq!(before[0].prompt_id, "D01:skip_next_day:slot_1");
    assert_eq!(before[0].kind, "skip_next_day");
    assert_eq!(before[0].subject_slot.as_deref(), Some("slot_1"));
    assert_eq!(before[0].reason, "beloved_princess_lynched");
    assert_eq!(before[0].phase_kind, "Day");
    assert_eq!(before[0].phase_number, 1);
    assert_eq!(before[0].metadata["policy"], "beloved_princess");
    assert_eq!(before[0].status, "pending");
    assert_eq!(before[0].decision, None);

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "HostPromptResolved",
            1,
            serde_json::json!({
                "prompt_id": "D01:skip_next_day:slot_1",
                "phase_id": "D01",
                "kind": "skip_next_day",
                "reason": "beloved_princess_lynched",
                "decision": {
                    "kind": "acknowledge",
                    "metadata": { "skip_phase": "D02" }
                },
                "public_resolution": {
                    "kind": "phase_advance",
                    "source_phase_id": "D01",
                    "target_phase_id": "N02",
                    "reason": "skip_next_day",
                    "skipped_phase_id": "D02"
                },
                "resolved_by": "host_h"
            }),
            ActorId::Host,
            3,
        )],
    )
    .await
    .unwrap();

    let before = host_prompts(&pool, game).await.unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].status, "resolved");
    assert_eq!(before[0].resolved_by.as_deref(), Some("host_h"));
    assert_eq!(before[0].resolved_at, Some(3));
    assert_eq!(
        before[0].public_resolution.as_ref().unwrap()["kind"],
        "phase_advance"
    );
    assert_eq!(
        before[0].decision.as_ref().unwrap()["metadata"]["skip_phase"],
        "D02"
    );

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PhaseAdvanced",
            1,
            serde_json::json!({
                "phase_id": "N02",
                "source_prompt_id": "D01:skip_next_day:slot_1",
                "source_phase_id": "D01",
                "skipped_phase_id": "D02",
                "reason": "skip_next_day"
            }),
            ActorId::Host,
            4,
        )],
    )
    .await
    .unwrap();

    let controls = host_phase_controls(&pool, game).await.unwrap();
    assert_eq!(controls.len(), 1);
    assert_eq!(controls[0].prompt_id, "D01:skip_next_day:slot_1");
    assert_eq!(controls[0].prompt_kind.as_deref(), Some("skip_next_day"));
    assert_eq!(
        controls[0].prompt_reason.as_deref(),
        Some("beloved_princess_lynched")
    );
    assert_eq!(controls[0].source_phase_id, "D01");
    assert_eq!(controls[0].target_phase_id, "N02");
    assert_eq!(controls[0].skipped_phase_id.as_deref(), Some("D02"));
    assert_eq!(controls[0].reason, "skip_next_day");
    assert_eq!(controls[0].resolved_by.as_deref(), Some("host_h"));
    assert_eq!(controls[0].resolved_at, Some(3));
    assert_eq!(controls[0].occurred_at, 4);

    let before_json = serde_json::to_string(&before).unwrap();
    let controls_before_json = serde_json::to_string(&controls).unwrap();
    let audit = audit_rebuild(&pool, game).await.unwrap();
    assert!(
        audit.ok,
        "rollback replay audit should find byte-identical projection rows: {audit:?}"
    );
    let control_audit = audit
        .tables
        .iter()
        .find(|table| table.table == "host_phase_control")
        .expect("host_phase_control audit table");
    assert_eq!(control_audit.before_rows, 1);
    assert_eq!(control_audit.rebuilt_rows, 1);
    assert_eq!(
        controls_before_json,
        serde_json::to_string(&host_phase_controls(&pool, game).await.unwrap()).unwrap(),
        "rollback replay audit must not mutate live projection rows"
    );

    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&host_prompts(&pool, game).await.unwrap()).unwrap(),
        "host_prompt rebuild must preserve operator prompts"
    );
    assert_eq!(
        controls_before_json,
        serde_json::to_string(&host_phase_controls(&pool, game).await.unwrap()).unwrap(),
        "host_phase_control rebuild must preserve prompt phase-control audit rows"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase_advanced_validates_host_prompt_phase_control_and_rolls_back(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "GameStarted",
            1,
            serde_json::json!({ "phase_id": "D01" }),
            ActorId::Host,
            1,
        )],
    )
    .await
    .unwrap();

    for (payload, expected) in [
        (
            serde_json::json!({
                "phase_id": "N02",
                "source_prompt_id": "",
                "source_phase_id": "D01",
                "skipped_phase_id": "D02",
                "reason": "skip_next_day"
            }),
            "source_prompt_id must not be empty",
        ),
        (
            serde_json::json!({
                "phase_id": "N02",
                "source_prompt_id": "D01:skip_next_day:slot_1",
                "skipped_phase_id": "D02",
                "reason": "skip_next_day"
            }),
            "source_phase_id must not be empty",
        ),
        (
            serde_json::json!({
                "phase_id": "N02",
                "source_prompt_id": "D01:skip_next_day:slot_1",
                "source_phase_id": "D01",
                "skipped_phase_id": "",
                "reason": "skip_next_day"
            }),
            "skipped_phase_id must not be empty",
        ),
    ] {
        let err = append_and_project(
            &pool,
            game,
            &[EventInput::new(
                "PhaseAdvanced",
                1,
                payload,
                ActorId::Host,
                2,
            )],
        )
        .await
        .expect_err("malformed host-prompt phase-control payload should be rejected");
        assert!(
            err.to_string().contains(expected),
            "expected error containing {expected:?}, got {err}"
        );
        assert_eq!(
            phase_state(&pool, game).await.unwrap().unwrap().phase_id,
            "D01",
            "malformed PhaseAdvanced must roll back before moving phase_state"
        );
    }

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PhaseAdvanced",
            1,
            serde_json::json!({
                "phase_id": "N02",
                "source_prompt_id": "D01:skip_next_day:slot_1",
                "source_phase_id": "D01",
                "skipped_phase_id": "D02",
                "reason": "skip_next_day"
            }),
            ActorId::Host,
            2,
        )],
    )
    .await
    .expect("valid host-prompt phase-control payload should project");
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        "N02"
    );
}

/// Rebuild determinism (REQUIRED, doc 02): after building projections
/// incrementally, `rebuild` truncates and re-folds from the log; the rebuilt
/// tables must be byte-for-byte identical to the incrementally-built ones.
#[sqlx::test(migrations = "../projections/migrations")]
async fn rebuild_is_deterministic(pool: sqlx::PgPool) {
    let pack = load_pack();
    let game = Uuid::new_v4();
    let events = scenario_events(&pack);

    append_and_project(&pool, game, &events).await.unwrap();

    // Snapshot the incrementally-built projections.
    let vc_before = votecount(&pool, game).await.unwrap();
    let ss_before = slot_state(&pool, game).await.unwrap();
    let thread_before = projections::thread_view(&pool, game, None, 50)
        .await
        .unwrap();
    let vc_before_json = serde_json::to_string(&vc_before).unwrap();
    let ss_before_json = serde_json::to_string(&ss_before).unwrap();
    let thread_before_json = serde_json::to_string(&thread_before).unwrap();

    // Rebuild from the log alone.
    rebuild(&pool, game).await.unwrap();

    let vc_after = votecount(&pool, game).await.unwrap();
    let ss_after = slot_state(&pool, game).await.unwrap();
    let thread_after = projections::thread_view(&pool, game, None, 50)
        .await
        .unwrap();

    // Byte-for-byte identical (same canonical ordering on both reads).
    assert_eq!(
        vc_before_json,
        serde_json::to_string(&vc_after).unwrap(),
        "votecount: rebuild != incremental"
    );
    assert_eq!(
        ss_before_json,
        serde_json::to_string(&ss_after).unwrap(),
        "slot_state: rebuild != incremental"
    );
    assert_eq!(
        thread_before_json,
        serde_json::to_string(&thread_after).unwrap(),
        "thread_view: rebuild != incremental"
    );

    // And rebuilding twice is also identical (idempotent).
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        ss_before_json,
        serde_json::to_string(&slot_state(&pool, game).await.unwrap()).unwrap(),
        "second rebuild diverged"
    );
    assert_eq!(
        thread_before_json,
        serde_json::to_string(
            &projections::thread_view(&pool, game, None, 50)
                .await
                .unwrap()
        )
        .unwrap(),
        "second thread_view rebuild diverged"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn audit_rebuild_cli_exits_zero_for_match_and_nonzero_for_drift(pool: sqlx::PgPool) {
    let pack = load_pack();
    let matched_game = Uuid::new_v4();
    append_and_project(&pool, matched_game, &scenario_events(&pack))
        .await
        .expect("append matched projection CLI scenario");

    let matched_output = run_audit_rebuild_cli(&pool, matched_game).await;
    assert!(
        matched_output.status.success(),
        "matched projection audit should exit zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&matched_output.stdout),
        String::from_utf8_lossy(&matched_output.stderr)
    );
    assert!(
        matched_output.stderr.is_empty(),
        "matched projection audit should not write stderr: {}",
        String::from_utf8_lossy(&matched_output.stderr)
    );
    let matched_report: serde_json::Value =
        serde_json::from_slice(&matched_output.stdout).expect("matched audit stdout is JSON");
    assert_eq!(matched_report["game_id"], matched_game.to_string());
    assert_eq!(matched_report["ok"], true);
    assert!(matched_report["tables"]
        .as_array()
        .expect("matched projection tables")
        .iter()
        .all(|table| table["matches"] == true));

    let drift_game = Uuid::new_v4();
    append_and_project(&pool, drift_game, &scenario_events(&pack))
        .await
        .expect("append drift projection CLI scenario");
    tamper_slot_state_role(&pool, drift_game, "slot_2", "tampered_doctor").await;

    let drift_output = run_audit_rebuild_cli(&pool, drift_game).await;
    assert!(
        !drift_output.status.success(),
        "drifted projection audit should exit non-zero\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stdout),
        String::from_utf8_lossy(&drift_output.stderr)
    );
    assert!(
        String::from_utf8_lossy(&drift_output.stderr)
            .contains("projection rebuild audit found drift"),
        "drift projection audit stderr should name drift\nstderr:\n{}",
        String::from_utf8_lossy(&drift_output.stderr)
    );
    let drift_report: serde_json::Value =
        serde_json::from_slice(&drift_output.stdout).expect("drift audit stdout is JSON");
    assert_eq!(drift_report["game_id"], drift_game.to_string());
    assert_eq!(drift_report["ok"], false);
    let slot_state = drift_report["tables"]
        .as_array()
        .expect("drift projection tables")
        .iter()
        .find(|table| table["table"] == "slot_state")
        .expect("slot_state drift table");
    assert_eq!(slot_state["matches"], false);
    let before_slot = slot_state["before"]
        .as_array()
        .expect("slot_state before rows")
        .iter()
        .find(|row| row["slot_id"] == "slot_2")
        .expect("tampered slot before row");
    let rebuilt_slot = slot_state["rebuilt"]
        .as_array()
        .expect("slot_state rebuilt rows")
        .iter()
        .find(|row| row["slot_id"] == "slot_2")
        .expect("rebuilt slot row");
    assert_eq!(before_slot["role_key"], "tampered_doctor");
    assert_eq!(rebuilt_slot["role_key"], "doctor");
    let live_role: String =
        sqlx::query_scalar("SELECT role_key FROM slot_state WHERE game_id = $1 AND slot_id = $2")
            .bind(drift_game)
            .bind("slot_2")
            .fetch_one(&pool)
            .await
            .expect("live drifted projection row after rollback audit");
    assert_eq!(live_role, "tampered_doctor");
}

async fn run_audit_rebuild_cli(pool: &PgPool, game: Uuid) -> std::process::Output {
    let database_url = database_url_for_pool(pool).await;
    let bin = std::env::var("CARGO_BIN_EXE_audit_rebuild")
        .unwrap_or_else(|_| env!("CARGO_BIN_EXE_audit_rebuild").to_string());
    ProcessCommand::new(bin)
        .arg(game.to_string())
        .env("DATABASE_URL", database_url)
        .output()
        .expect("run audit_rebuild binary")
}

async fn tamper_slot_state_role(pool: &PgPool, game: Uuid, slot: &str, role_key: &str) {
    let update =
        sqlx::query("UPDATE slot_state SET role_key = $3 WHERE game_id = $1 AND slot_id = $2")
            .bind(game)
            .bind(slot)
            .bind(role_key)
            .execute(pool)
            .await
            .expect("tamper live slot_state role");
    assert_eq!(update.rows_affected(), 1, "one slot_state row tampered");
}

async fn database_url_for_pool(pool: &PgPool) -> String {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .expect("query current test database");
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test");
    let (without_query, query) = base
        .split_once('?')
        .map(|(left, right)| (left, Some(right)))
        .unwrap_or((base.as_str(), None));
    let slash = without_query
        .rfind('/')
        .expect("DATABASE_URL includes database path");
    let mut url = format!("{}/{}", &without_query[..slash], database);
    if let Some(query) = query {
        url.push('?');
        url.push_str(query);
    }
    url
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn persistent_effect_projection_marks_clears_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        run_id: "run_effect_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 99,
        counts: ResolutionCounts {
            events: 4,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::EffectsMarked {
                    effect: "doused".into(),
                    target: "slot_1".into(),
                    actor: "slot_a".into(),
                    source_action: Some("douse_n01".into()),
                    phase_id: Some("N01".into()),
                    phase_kind: Some(PhaseKind::Night),
                    phase_number: Some(1),
                    duration: domain::EffectDuration::Persistent,
                    visibility: domain::EffectVisibility::Target,
                },
            },
            IndexedEvent {
                index: 1,
                event: InnerEvent::EffectsMarked {
                    effect: "doused".into(),
                    target: "slot_2".into(),
                    actor: "slot_a".into(),
                    source_action: Some("douse_n01".into()),
                    phase_id: Some("N01".into()),
                    phase_kind: Some(PhaseKind::Night),
                    phase_number: Some(1),
                    duration: domain::EffectDuration::Persistent,
                    visibility: domain::EffectVisibility::Target,
                },
            },
            IndexedEvent {
                index: 2,
                event: InnerEvent::EffectsCleared {
                    effect: "doused".into(),
                    targets: vec!["slot_1".into()],
                    actor: "slot_a".into(),
                },
            },
            empty_phase_announcement(3, "N01"),
        ],
        started_at: 10,
        finished_at: 11,
    };

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(applied).unwrap(),
            ActorId::System,
            10,
        )],
    )
    .await
    .unwrap();

    let before = slot_effects(&pool, game).await.unwrap();
    assert_eq!(
        before
            .iter()
            .map(|effect| (
                effect.slot_id.as_str(),
                effect.effect.as_str(),
                effect.source_slot.as_str(),
                effect.source_action.as_deref(),
                effect.phase_id.as_deref(),
                effect.phase_kind.as_deref(),
                effect.phase_number,
                effect.duration.as_str(),
                effect.visibility.as_str(),
            ))
            .collect::<Vec<_>>(),
        vec![(
            "slot_2",
            "doused",
            "slot_a",
            Some("douse_n01"),
            Some("N01"),
            Some("Night"),
            Some(1),
            "Persistent",
            "Target",
        )],
        "EffectsCleared removes only the named targets and preserves source metadata"
    );

    let before_json = serde_json::to_string(&before).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&slot_effects(&pool, game).await.unwrap()).unwrap(),
        "slot_effect: rebuild != incremental"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn resolution_scoped_effect_projection_expires_without_slot_effect(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        run_id: "run_resolution_effect_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 100,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::EffectsMarked {
                    effect: "fruit_received".into(),
                    target: "slot_1".into(),
                    actor: "slot_a".into(),
                    source_action: Some("send_fruit_n01".into()),
                    phase_id: Some("N01".into()),
                    phase_kind: Some(PhaseKind::Night),
                    phase_number: Some(1),
                    duration: domain::EffectDuration::Resolution,
                    visibility: domain::EffectVisibility::Target,
                },
            },
            empty_phase_announcement(1, "N01"),
        ],
        started_at: 12,
        finished_at: 13,
    };

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(applied).unwrap(),
            ActorId::System,
            12,
        )],
    )
    .await
    .unwrap();

    assert!(
        slot_effects(&pool, game).await.unwrap().is_empty(),
        "resolution-scoped EffectsMarked must not persist into slot_effect"
    );

    rebuild(&pool, game).await.unwrap();
    assert!(
        slot_effects(&pool, game).await.unwrap().is_empty(),
        "slot_effect rebuild must preserve resolution-scoped expiry"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_grant_projection_records_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        run_id: "run_grant_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 100,
        counts: ResolutionCounts {
            events: 4,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::ActionGranted {
                    grant_id: "extra_action".into(),
                    grant_option: None,
                    kind: GrantKind::ExtraAction,
                    actor: "slot_1".into(),
                    target: "slot_2".into(),
                    source_action: "motivate_n01".into(),
                    uses: 1,
                    vote_weight: None,
                    phase_id: "N01".into(),
                    phase_kind: PhaseKind::Night,
                    phase_number: 1,
                },
            },
            IndexedEvent {
                index: 1,
                event: InnerEvent::ActionGrantConsumed {
                    grant_id: "extra_action".into(),
                    actor: "slot_2".into(),
                    action_id: "cop_extra_n02".into(),
                    source_action: "motivate_n01".into(),
                    phase_id: "N02".into(),
                    phase_kind: PhaseKind::Night,
                    phase_number: 2,
                    remaining_uses: 0,
                },
            },
            IndexedEvent {
                index: 2,
                event: InnerEvent::ActionGranted {
                    grant_id: "parity_scanner_item".into(),
                    grant_option: Some("parity_scanner_item".into()),
                    kind: GrantKind::Item,
                    actor: "slot_3".into(),
                    target: "slot_4".into(),
                    source_action: "grant_item_n01".into(),
                    uses: 1,
                    vote_weight: None,
                    phase_id: "N01".into(),
                    phase_kind: PhaseKind::Night,
                    phase_number: 1,
                },
            },
            empty_phase_announcement(3, "N01"),
        ],
        started_at: 10,
        finished_at: 11,
    };

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(applied).unwrap(),
            ActorId::System,
            10,
        )],
    )
    .await
    .unwrap();

    let before = action_grants(&pool, game).await.unwrap();
    assert_eq!(before.len(), 2);
    assert_eq!(before[0].slot_id, "slot_2");
    assert_eq!(before[0].grant_id, "extra_action");
    assert_eq!(before[0].grant_option, None);
    assert_eq!(before[0].kind, "ExtraAction");
    assert_eq!(before[0].source_slot, "slot_1");
    assert_eq!(before[0].source_action, "motivate_n01");
    assert_eq!(before[0].uses, 0);
    assert_eq!(before[1].slot_id, "slot_4");
    assert_eq!(before[1].grant_id, "parity_scanner_item");
    assert_eq!(
        before[1].grant_option.as_deref(),
        Some("parity_scanner_item")
    );
    assert_eq!(before[1].kind, "Item");
    assert_eq!(before[1].source_slot, "slot_3");
    assert_eq!(before[1].source_action, "grant_item_n01");
    assert_eq!(before[1].uses, 1);

    let before_json = serde_json::to_string(&before).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&action_grants(&pool, game).await.unwrap()).unwrap(),
        "action_grant: rebuild != incremental"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn action_counter_projection_records_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: "N01".into(),
        phase_kind: PhaseKind::Night,
        phase_number: 1,
        run_id: "run_action_counter_projection".into(),
        result_version: domain::RESULT_VERSION,
        seed: 101,
        counts: ResolutionCounts {
            events: 2,
            kills: 0,
            saves: 0,
        },
        events: vec![
            IndexedEvent {
                index: 0,
                event: InnerEvent::ActionUseCounted {
                    counter_id: "x_shot:night_kill".into(),
                    actor: "slot_1".into(),
                    template_id: "night_kill".into(),
                    consumed_action: "vig_n01".into(),
                    cadence_policy: "x_shot".into(),
                    phase_scope: "game".into(),
                    limit: 1,
                    used: 1,
                    remaining: 0,
                    phase_id: "N01".into(),
                    phase_kind: PhaseKind::Night,
                    phase_number: 1,
                },
            },
            empty_phase_announcement(1, "N01"),
        ],
        started_at: 10,
        finished_at: 11,
    };

    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "ResolutionApplied",
            1,
            serde_json::to_value(applied).unwrap(),
            ActorId::System,
            10,
        )],
    )
    .await
    .unwrap();

    let before = action_counters(&pool, game).await.unwrap();
    assert_eq!(before.len(), 1);
    let counter = &before[0];
    assert_eq!(counter.slot_id, "slot_1");
    assert_eq!(counter.counter_id, "x_shot:night_kill");
    assert_eq!(counter.template_id, "night_kill");
    assert_eq!(counter.consumed_action, "vig_n01");
    assert_eq!(counter.cadence_policy, "x_shot");
    assert_eq!(counter.phase_scope, "game");
    assert_eq!(counter.limit, 1);
    assert_eq!(counter.used, 1);
    assert_eq!(counter.remaining, 0);
    assert_eq!(counter.phase_id, "N01");
    assert_eq!(counter.phase_kind, "Night");
    assert_eq!(counter.phase_number, 1);

    let before_json = serde_json::to_string(&before).unwrap();
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter: rebuild != incremental"
    );
}

/// PostSubmitted folds into `thread_view` with stable event cursors. The public
/// main thread ignores private-channel posts and pages newest windows while
/// returning rows oldest-to-newest for rendering.
#[sqlx::test(migrations = "../projections/migrations")]
async fn thread_view_pages_main_thread_posts(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let mut events = Vec::new();
    for (idx, body) in [
        "first visible post",
        "second visible post",
        "third visible post",
    ]
    .into_iter()
    .enumerate()
    {
        events.push(EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "slot_or_user": { "slot": "slot_1" },
                "body": body,
                "phase_id": "D01",
                "media": [{
                    "id": format!("receipt-{idx}"),
                    "kind": "image",
                    "alt": "tablet proof receipt",
                    "variants": {
                        "tablet": {
                            "url": format!("/media/live/receipt-{idx}-tablet.jpg"),
                            "width": 960,
                            "height": 720
                        },
                        "small": {
                            "url": format!("/media/live/receipt-{idx}-small.jpg"),
                            "width": 480,
                            "height": 360
                        },
                        "original": {
                            "url": format!("/media/live/receipt-{idx}-original.jpg"),
                            "width": 4000,
                            "height": 3000
                        }
                    }
                }],
            }),
            ActorId::Slot("slot_1".into()),
            30 + idx as i64,
        ));
    }
    events.push(EventInput::new(
        "PostSubmitted",
        1,
        serde_json::json!({
            "channel_id": "scum_chat",
            "slot_or_user": { "slot": "slot_2" },
            "body": "private post",
            "phase_id": "D01",
        }),
        ActorId::Slot("slot_2".into()),
        40,
    ));

    append_and_project(&pool, game, &events).await.unwrap();

    let latest = projections::thread_view(&pool, game, None, 2)
        .await
        .unwrap();
    assert_eq!(
        latest
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec!["second visible post", "third visible post"]
    );
    assert!(
        latest.next_before_seq.is_some(),
        "a full page with an extra older row exposes an older-page cursor"
    );

    let older = projections::thread_view(&pool, game, latest.next_before_seq, 2)
        .await
        .unwrap();
    assert_eq!(older.posts.len(), 1);
    assert_eq!(older.posts[0].body, "first visible post");
    assert_eq!(older.posts[0].media[0]["id"], "receipt-0");
    assert_eq!(
        older.posts[0].media[0]["variants"]["tablet"]["url"],
        "/media/live/receipt-0-tablet.jpg"
    );
    assert_eq!(older.next_before_seq, None);

    let private = projections::thread_view_for_channel(&pool, game, "scum_chat", None, 10)
        .await
        .unwrap();
    assert_eq!(
        private
            .posts
            .iter()
            .map(|post| (post.channel_id.as_str(), post.body.as_str()))
            .collect::<Vec<_>>(),
        vec![("scum_chat", "private post")]
    );
}

/// The public index is a durable lifecycle projection. Setup games are retained
/// for rebuilds but excluded until started; active and completed rows page by a
/// stable `(updated_seq, game_id)` cursor without carrying private game state.
#[sqlx::test(migrations = "../projections/migrations")]
async fn game_index_pages_public_active_and_completed_lifecycle_rows(pool: sqlx::PgPool) {
    let active_game = Uuid::from_u128(1);
    let completed_game = Uuid::from_u128(2);
    let setup_game = Uuid::from_u128(3);

    append_and_project(
        &pool,
        active_game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                serde_json::json!({ "host": "host_active", "pack": "mafiascum" }),
                ActorId::User("host_active".into()),
                100,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                110,
            ),
            EventInput::new(
                "PhaseAdvanced",
                1,
                serde_json::json!({ "phase_id": "N01" }),
                ActorId::Host,
                130,
            ),
        ],
    )
    .await
    .unwrap();
    append_and_project(
        &pool,
        completed_game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                serde_json::json!({ "host": "host_completed", "pack": "mafia_universe" }),
                ActorId::User("host_completed".into()),
                90,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                100,
            ),
            EventInput::new(
                "GameCompleted",
                1,
                serde_json::json!({}),
                ActorId::Host,
                140,
            ),
        ],
    )
    .await
    .unwrap();
    append_and_project(
        &pool,
        setup_game,
        &[EventInput::new(
            "GameCreated",
            1,
            serde_json::json!({ "host": "host_setup", "pack": "epicmafia" }),
            ActorId::User("host_setup".into()),
            150,
        )],
    )
    .await
    .unwrap();

    let latest = game_index(&pool, None, 1).await.unwrap();
    assert_eq!(latest.games.len(), 1);
    assert_eq!(latest.games[0].game_id, completed_game);
    assert_eq!(latest.games[0].status, "completed");
    assert_eq!(latest.games[0].phase_id.as_deref(), Some("D01"));
    assert_eq!(latest.games[0].completed_seq, Some(6));
    let cursor = latest.next_cursor.expect("older public row cursor");

    let older = game_index(&pool, Some(cursor), 1).await.unwrap();
    assert_eq!(older.games.len(), 1);
    assert_eq!(older.games[0].game_id, active_game);
    assert_eq!(older.games[0].status, "active");
    assert_eq!(older.games[0].phase_id.as_deref(), Some("N01"));
    assert_eq!(older.next_cursor, None);

    rebuild(&pool, active_game).await.unwrap();
    rebuild(&pool, completed_game).await.unwrap();
    rebuild(&pool, setup_game).await.unwrap();
    let rebuilt = game_index(&pool, None, 10).await.unwrap();
    assert_eq!(
        rebuilt
            .games
            .iter()
            .map(|row| (row.game_id, row.status.as_str(), row.phase_id.as_deref()))
            .collect::<Vec<_>>(),
        vec![
            (completed_game, "completed", Some("D01")),
            (active_game, "active", Some("N01")),
        ]
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn encrypted_private_events_still_fold_and_rebuild(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let events = vec![
        EventInput::new(
            "RoleAssigned",
            1,
            serde_json::json!({
                "slot_id": "slot_1",
                "role_key": "godfather",
                "alignment": "mafia",
                "role_effects": ["godfather"],
            }),
            ActorId::Host,
            30,
        ),
        EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "private:mafia_day_chat",
                "slot_or_user": { "slot": "slot_1" },
                "body": "private night plan",
                "phase_id": "D01",
            }),
            ActorId::Slot("slot_1".into()),
            31,
        ),
    ];

    append_and_project(&pool, game, &events).await.unwrap();

    let raw_role: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'RoleAssigned'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_role["slot_id"], "slot_1");
    assert!(raw_role.get("role_key").is_none());
    assert!(raw_role["private"]["ciphertext"].is_string());
    assert!(raw_role["private"]["kid"].is_string());

    let raw_post: serde_json::Value = sqlx::query_scalar(
        "SELECT payload FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_post["channel_id"], "private:mafia_day_chat");
    assert_eq!(raw_post["phase_id"], "D01");
    assert!(raw_post.get("body").is_none());
    assert!(raw_post["body_private"]["ciphertext"].is_string());
    assert!(raw_post["body_private"]["kid"].is_string());

    let projected_role = slot_state(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|slot| slot.slot_id == "slot_1")
        .expect("slot role projection");
    assert_eq!(projected_role.role_key.as_deref(), Some("godfather"));
    assert_eq!(projected_role.alignment.as_deref(), Some("mafia"));

    let private_thread =
        projections::thread_view_for_channel(&pool, game, "private:mafia_day_chat", None, 10)
            .await
            .unwrap();
    assert_eq!(private_thread.posts[0].body, "private night plan");

    projections::rebuild(&pool, game).await.unwrap();
    let rebuilt_thread =
        projections::thread_view_for_channel(&pool, game, "private:mafia_day_chat", None, 10)
            .await
            .unwrap();
    assert_eq!(rebuilt_thread.posts[0].body, "private night plan");
}

/// `append_and_project` is one transaction: a conflicting concurrent append
/// rolls back the projection updates too (no partial write).
#[sqlx::test(migrations = "../projections/migrations")]
async fn projection_rolls_back_on_conflict(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();

    // Seed one event so the stream is non-empty.
    let seed = EventInput::new(
        "RoleAssigned",
        1,
        serde_json::json!({ "slot_id": "slot_1", "role_key": "doctor" }),
        ActorId::System,
        1,
    );
    append_and_project(&pool, game, &[seed]).await.unwrap();

    // Two racing append_and_project at the same next stream_seq via manual txs
    // is exercised in the eventstore crate; here we assert the projection state
    // is exactly what the single committed append produced.
    let slots = slot_state(&pool, game).await.unwrap();
    assert_eq!(slots.len(), 1);
    assert_eq!(slots[0].role_key.as_deref(), Some("doctor"));
}

/// Non-game discussion streams use the same append-only store but a separate,
/// public-safe projection boundary from game streams.
#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_projection_pages_visible_topics_and_hides_moderated_rows(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(101);
    let visible_topic = Uuid::from_u128(102);
    let hidden_topic = Uuid::from_u128(103);

    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({
                "slug": "general",
                "title": "General",
                "description": "Public discussion"
            }),
            ActorId::User("moderator".into()),
            1,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        visible_topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({
                    "area_id": area,
                    "title": "Welcome",
                    "author_user_id": "member"
                }),
                ActorId::User("member".into()),
                2,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "First public post", "author_user_id": "member" }),
                ActorId::User("member".into()),
                3,
            ),
        ],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        hidden_topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({
                    "area_id": area,
                    "title": "Hidden",
                    "author_user_id": "member"
                }),
                ActorId::User("member".into()),
                4,
            ),
            EventInput::new(
                "DiscussionTopicModerationChanged",
                1,
                serde_json::json!({ "status": "hidden" }),
                ActorId::User("moderator".into()),
                5,
            ),
        ],
    )
    .await
    .unwrap();

    let area_row = discussion_area_by_slug(&pool, "general")
        .await
        .unwrap()
        .unwrap();
    let page = discussion_topics(&pool, area_row.area_id, None, 10)
        .await
        .unwrap();
    assert_eq!(page.topics.len(), 1);
    assert_eq!(page.topics[0].topic_id, visible_topic);
    assert_eq!(page.topics[0].post_count, 1);
    assert_eq!(page.topics[0].status, "open");
    let posts = discussion_posts(&pool, visible_topic, None, 10)
        .await
        .unwrap();
    assert_eq!(posts.posts[0].body, "First public post");
    assert_eq!(
        discussion_topic_by_id(&pool, hidden_topic)
            .await
            .unwrap()
            .unwrap()
            .status,
        "hidden"
    );
    rebuild_discussion_stream(&pool, visible_topic)
        .await
        .unwrap();
    let rebuilt_posts = discussion_posts(&pool, visible_topic, None, 10)
        .await
        .unwrap();
    assert_eq!(rebuilt_posts.posts[0].body, "First public post");
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn profile_projection_keeps_owner_state_private_and_rebuildable(pool: sqlx::PgPool) {
    let profile = Uuid::from_u128(201);
    append_profile_and_project(
        &pool,
        profile,
        &[
            EventInput::new(
                "ProfileCreated",
                1,
                serde_json::json!({
                    "principal_user_id": "owner_a",
                    "handle": "owner_a",
                    "display_name": "Owner A",
                    "bio": "Opening profile",
                    "visibility": "public"
                }),
                ActorId::User("owner_a".into()),
                1,
            ),
            EventInput::new(
                "ProfileUpdated",
                1,
                serde_json::json!({
                    "display_name": "Owner A",
                    "bio": "Updated profile",
                    "visibility": "members"
                }),
                ActorId::User("owner_a".into()),
                2,
            ),
        ],
    )
    .await
    .unwrap();
    assert!(public_profile_by_handle(&pool, "owner_a")
        .await
        .unwrap()
        .is_none());
    let editor = profile_editor_by_handle(&pool, "owner_a")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(editor.principal_user_id, "owner_a");
    assert_eq!(editor.bio, "Updated profile");
    rebuild_profile_stream(&pool, profile).await.unwrap();
    assert_eq!(
        profile_editor_by_handle(&pool, "owner_a")
            .await
            .unwrap()
            .unwrap()
            .visibility,
        "members"
    );
}
