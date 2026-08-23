//! End-to-end + determinism integration tests against REAL Postgres.
//!
//! The migrations dir contains one greenfield baseline for the event store and
//! every projection, so `#[sqlx::test(migrations = ...)]` builds the complete
//! schema on an ephemeral DB. Requires `DATABASE_URL` (compose PG :5544);
//! never silently passes without a DB.

use std::process::Command as ProcessCommand;
use std::str::FromStr;
use std::{collections::BTreeMap, sync::Arc};

use attention::WatchTarget;
use content_reference::PublicContentRef;
use domain::events::{IndexedEvent, ResolutionCounts};
use domain::pack::{GrantKind, Pack};
use domain::phase::PhaseId;
use domain::state::{RevealState, SlotLifecycle, SlotState, StateSnapshot, Submission};
use domain::{resolve, InnerEvent, ResolutionApplied, ResolutionInput};
use eventstore::{ActorId, EventInput, StoreError};
use game_persona_application::GamePersonaPresentation;
use game_platform::{GamePersonaId, GamePersonaName};
use projections::{
    action_counters, action_grants, append_and_project, append_discussion_and_project,
    append_discussion_and_project_expected, audit_rebuild, day_vote_outcomes,
    discussion_area_by_slug, discussion_posts, discussion_topic_by_id, discussion_topics,
    game_index, host_phase_controls, host_prompts, operator_game_index, phase_state,
    player_notifications, public_profile_by_handle, public_search, rebuild,
    rebuild_discussion_stream, rebuild_moderation_stream, rebuild_profile_stream,
    reconcile_database_authority, slot_effects, slot_state, votecount, ProjectionError,
    PublicSearchFilter, APPLICATION_DATABASE_ROLE, LIVE_EVENT_NOTIFY_CHANNEL,
};
use sha2::{Digest, Sha256};
use social::{
    PrincipalId, ProfileBio, ProfileDisplayName, ProfileEdit, ProfileHandle, ProfileId,
    ProfilePresentation, ProfileRevision, ProfileVisibility,
};
use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool, Row};
use trust_safety::{self, ModerationCommand, ModerationTarget, ReportReasonFamily};
use uuid::Uuid;

const LOCAL_APPLICATION_DATABASE_PASSWORD: &str = "fmarch-local-application-password";
const LOCAL_KEY_ADMIN_DATABASE_PASSWORD: &str = "fmarch-local-key-admin-password";

fn test_pack_artifact(key: &str) -> content_registry::PackArtifactSnapshot {
    let mut pack = load_pack();
    pack.name = key.to_string();
    content_registry::PackArtifactSnapshot::from_document(&pack)
        .unwrap_or_else(|error| panic!("build canonical test pack artifact `{key}`: {error}"))
}

fn fixture_principal_id(label: &str) -> PrincipalId {
    label
        .parse()
        .unwrap_or_else(|_| PrincipalId::fixture(label))
}

fn test_game_created_payload(host: &str, key: &str) -> serde_json::Value {
    let artifact = test_pack_artifact(key);
    serde_json::json!({
        "host_principal_id": fixture_principal_id(host),
        "pack_ref": &artifact.pack_ref,
        "pack_artifact": artifact,
    })
}

fn refresh_completed_game_archive_checksum(export: &mut projections::CompletedGameExport) {
    #[derive(serde::Serialize)]
    struct ChecksumManifest<'a> {
        stream: &'a eventstore::StreamExport,
        detached_subject_aliases: &'a [projections::CompletedGameDetachedAlias],
    }

    let bytes = serde_json::to_vec(&ChecksumManifest {
        stream: &export.stream,
        detached_subject_aliases: &export.detached_subject_aliases,
    })
    .unwrap();
    export.archive_checksum_sha256 = format!("{:x}", Sha256::digest(bytes));
}

fn refresh_stream_export_checksum(export: &mut eventstore::StreamExport) {
    #[derive(serde::Serialize)]
    struct ChecksumManifest<'a> {
        version: u16,
        stream_id: Uuid,
        active_epoch: Option<i64>,
        stream_keys: &'a [eventstore::ExportStreamKey],
        events: &'a [eventstore::ExportEvent],
    }

    let bytes = serde_json::to_vec(&ChecksumManifest {
        version: export.version,
        stream_id: export.stream_id,
        active_epoch: export.active_epoch,
        stream_keys: &export.stream_keys,
        events: &export.events,
    })
    .unwrap();
    export.checksum_sha256 = format!("{:x}", Sha256::digest(bytes));
}

async fn ensure_test_principal(pool: &sqlx::PgPool, principal_id: &str) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(
        &mut connection,
        &fixture_principal_id(principal_id),
        &[],
        1,
    )
    .await
    .unwrap();
}

/// Stable authority fixtures for the attention, mute, and moderation scenarios.
/// Labels remain presentation-only; every authorization edge receives a UUID.
fn auxiliary_principal(id: u128) -> PrincipalId {
    PrincipalId::from_uuid(Uuid::from_u128(id))
}

async fn ensure_auxiliary_principal(pool: &sqlx::PgPool, principal_id: PrincipalId) {
    let mut connection = pool.acquire().await.unwrap();
    identity::methods::ensure_principal(&mut connection, &principal_id, &[], 1)
        .await
        .unwrap();
}

async fn create_auxiliary_profile(
    pool: &sqlx::PgPool,
    principal_id: PrincipalId,
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: ProfileVisibility,
    occurred_at: i64,
) -> Uuid {
    profile_application::create_profile(
        pool,
        principal_id,
        test_profile_presentation(handle, display_name, bio, visibility),
        occurred_at,
    )
    .await
    .unwrap()
    .as_uuid()
}

async fn append_test_game_persona_registration(
    pool: &sqlx::PgPool,
    game: Uuid,
    persona_id: GamePersonaId,
    principal_id: &str,
    public_name: &str,
    occurred_at: i64,
) {
    let mut tx = pool.begin().await.unwrap();
    let event = game_persona_application::register(
        &mut tx,
        game,
        persona_id,
        &fixture_principal_id(principal_id),
        GamePersonaPresentation {
            public_name: GamePersonaName::new(public_name).unwrap(),
        },
        ActorId::Host,
        occurred_at,
    )
    .await
    .unwrap();
    projections::append_and_project_in_tx(&mut tx, game, &[event])
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

async fn append_test_game_persona_rename(
    pool: &sqlx::PgPool,
    game: Uuid,
    persona_id: GamePersonaId,
    public_name: &str,
    occurred_at: i64,
) {
    let mut tx = pool.begin().await.unwrap();
    let event = game_persona_application::rename(
        &mut tx,
        game,
        persona_id,
        GamePersonaPresentation {
            public_name: GamePersonaName::new(public_name).unwrap(),
        },
        ActorId::Host,
        occurred_at,
    )
    .await
    .unwrap();
    projections::append_and_project_in_tx(&mut tx, game, &[event])
        .await
        .unwrap();
    tx.commit().await.unwrap();
}

fn test_profile_presentation(
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: ProfileVisibility,
) -> ProfilePresentation {
    ProfilePresentation::new(
        ProfileHandle::new(handle).unwrap(),
        ProfileDisplayName::new(display_name).unwrap(),
        ProfileBio::new(bio).unwrap(),
        visibility,
    )
}

async fn create_test_profile(
    pool: &sqlx::PgPool,
    principal: &str,
    handle: &str,
    display_name: &str,
    bio: &str,
    visibility: ProfileVisibility,
    occurred_at: i64,
) -> Uuid {
    profile_application::create_profile(
        pool,
        fixture_principal_id(principal),
        test_profile_presentation(handle, display_name, bio, visibility),
        occurred_at,
    )
    .await
    .unwrap()
    .as_uuid()
}

/// A typed profile update fixture keeps the test seam aligned with the
/// application boundary instead of passing a positional collection of values.
struct TestProfileUpdate<'a> {
    profile_id: Uuid,
    principal: &'a str,
    expected_revision: u64,
    edit: ProfileEdit,
    occurred_at: i64,
}

fn test_profile_edit(display_name: &str, bio: &str, visibility: ProfileVisibility) -> ProfileEdit {
    ProfileEdit::new(
        ProfileDisplayName::new(display_name).unwrap(),
        ProfileBio::new(bio).unwrap(),
        visibility,
    )
}

async fn update_test_profile(pool: &sqlx::PgPool, update: TestProfileUpdate<'_>) {
    profile_application::update_profile(
        pool,
        ProfileId::from_uuid(update.profile_id),
        fixture_principal_id(update.principal),
        ProfileRevision::new(update.expected_revision),
        update.edit,
        update.occurred_at,
    )
    .await
    .unwrap();
}

fn load_pack() -> Pack {
    let current_dir = std::env::current_dir().expect("resolve current directory");
    let path = current_dir
        .ancestors()
        .map(|ancestor| ancestor.join("packs/mafiascum/pack.json"))
        .find(|candidate| candidate.is_file())
        .unwrap_or_else(|| {
            panic!(
                "find packs/mafiascum/pack.json from {}",
                current_dir.display()
            )
        });
    let raw = std::fs::read_to_string(&path).expect("read pack.json");
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

fn phase_id(value: &str) -> PhaseId {
    PhaseId::parse(value).expect("projection test phase id must be canonical")
}

fn empty_phase_announcement(index: usize, phase: &str) -> IndexedEvent {
    IndexedEvent {
        index,
        event: InnerEvent::PhaseAnnouncement(domain::PhaseAnnouncement {
            phase_id: phase_id(phase),
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
        phase_id: phase_id("N01"),
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
            "author": { "kind": "slot", "slot_id": "slot_2" },
            "body": "I think slot 1 is caught.",
            "phase_id": "D01",
        }),
        ActorId::Slot("slot_2".into()),
        24,
    ));

    // Night-1 resolution: Mafia kills slot_3, no protection → PlayerKilled.
    let state = StateSnapshot {
        phase_id: phase_id("N01"),
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
        phase_id: phase_id("N01"),
        run_id: "run_e2e_001".into(),
        state,
        submissions: subs,
        day_phase_inputs: Default::default(),
        pack: domain::validate_pack_validated(Arc::new(pack.clone()))
            .expect("projection E2E pack validates"),
        seed: 424242,
        logical_time: 100,
    })
    .expect("scenario resolution succeeds");
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
    let tally: BTreeMap<(PhaseId, String), i64> = vc
        .iter()
        .map(|r| ((r.phase_id.clone(), r.candidate_slot.clone()), r.count))
        .collect();
    assert_eq!(
        tally[&(phase_id("D01"), "slot_1".into())],
        1,
        "2 ballots - 1 withdrawn = 1"
    );
    assert!(!tally.contains_key(&(phase_id("D01"), "slot_3".into())));

    let thread = projections::thread_view(&pool, game, None, 50)
        .await
        .unwrap();
    assert_eq!(thread.posts.len(), 2);
    let player_post = thread
        .posts
        .iter()
        .find(|post| {
            matches!(
                &post.author,
                projections::GameThreadAuthor::Slot { slot_id } if slot_id == "slot_2"
            )
        })
        .expect("slot_2 player post");
    assert_eq!(
        player_post.phase_id.as_ref().map(PhaseId::as_str),
        Some("D01")
    );
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
        phase_id: phase_id("D01"),
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
    assert_eq!(rows[0].phase_id, phase_id("D01"));
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
        phase_id: phase_id("D01"),
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
        phase_id: phase_id("N01"),
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
                    phase_id: None,
                },
            },
            empty_phase_announcement(1, "N01"),
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
    assert_eq!(notices[0].phase_id, phase_id("N01"));
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
        phase_id: phase_id("D01"),
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
                    phase_id: phase_id("D01"),
                    metadata: domain::HostPromptMetadata {
                        policy: Some("beloved_princess".into()),
                        death_cause: Some("lynch".into()),
                        role: Some("beloved_princess".into()),
                        ..domain::HostPromptMetadata::default()
                    },
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
    assert_eq!(before[0].phase_id, phase_id("D01"));
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
    assert_eq!(controls[0].source_phase_id, phase_id("D01"));
    assert_eq!(controls[0].target_phase_id, phase_id("N02"));
    assert_eq!(
        controls[0].skipped_phase_id.as_ref().map(PhaseId::as_str),
        Some("D02")
    );
    assert_eq!(controls[0].reason, "skip_next_day");
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
            "unknown phase id kind",
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
            phase_id("D01"),
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
        phase_id("N02")
    );
}

/// Replaying a stored event is an ingress boundary: malformed phase strings
/// must fail before any projection row moves. This deliberately covers the
/// top-level folds that do not deserialize through a domain envelope first.
#[sqlx::test(migrations = "../projections/migrations")]
async fn persisted_phase_ids_reject_noncanonical_payloads_atomically(pool: sqlx::PgPool) {
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
    .expect("canonical phase starts the game projection");

    let malformed_events = vec![
        EventInput::new(
            "GameStarted",
            1,
            serde_json::json!({ "phase_id": "D003" }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "PhaseAdvanced",
            1,
            serde_json::json!({ "phase_id": "N01R02" }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "DeadlineSet",
            1,
            serde_json::json!({ "phase_id": "D00", "at": 20 }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "VoteSubmitted",
            1,
            serde_json::json!({
                "phase_id": "D3",
                "actor": "slot_1",
                "target": "slot_2"
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "ActionSubmitted",
            1,
            serde_json::json!({
                "phase_id": "N01junk",
                "actor": "slot_1",
                "action_id": "action_1",
                "template_id": "template_1",
                "targets": []
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "ActionWithdrawn",
            1,
            serde_json::json!({
                "phase_id": "D01R0",
                "actor": "slot_1",
                "action_id": "action_1"
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "phase_id": "D01R02",
                "channel_id": "main",
                "author": { "kind": "host_narrator" },
                "body": "invalid phase must not write a post"
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "DayEventOpened",
            1,
            serde_json::json!({
                "event_id": "event_1",
                "phase_id": "D003",
                "opened_at": 20
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "DayEventParticipationSubmitted",
            1,
            serde_json::json!({
                "event_id": "event_1",
                "actor_slot": "slot_1",
                "phase_id": "D01junk",
                "payload": { "kind": "default" }
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "HostPromptResolved",
            1,
            serde_json::json!({
                "prompt_id": "prompt_1",
                "decision": { "choice": "slot_1" },
                "public_resolution": {
                    "kind": "day_vote_elimination",
                    "phase_id": "D01R02",
                    "selected_slot": "slot_1",
                    "reason": "host choice"
                }
            }),
            ActorId::Host,
            2,
        ),
        EventInput::new(
            "EffectNotification",
            1,
            serde_json::json!({
                "effect": "notified",
                "status": "pending",
                "audience": ["slot_1"],
                "phase_id": "D003"
            }),
            ActorId::Host,
            2,
        ),
    ];

    for event in malformed_events {
        let err = append_and_project(&pool, game, &[event])
            .await
            .expect_err("stored noncanonical phase id must be rejected");
        assert!(
            matches!(err, ProjectionError::Payload { .. }),
            "phase validation must fail at the payload boundary, got {err:?}"
        );
        assert!(
            err.to_string().contains("phase id"),
            "expected the phase parser error, got {err}"
        );
        assert_eq!(
            phase_state(&pool, game).await.unwrap().unwrap().phase_id,
            phase_id("D01"),
            "failed replay must leave the existing phase_state untouched"
        );
        assert!(
            votecount(&pool, game).await.unwrap().is_empty(),
            "failed replay must not write a ballot"
        );
        assert!(
            projections::thread_view(&pool, game, None, 10)
                .await
                .unwrap()
                .posts
                .is_empty(),
            "failed replay must not write a post"
        );
    }
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn canonical_persisted_phase_ids_round_trip_through_projection_folds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01", "phase_opened_at": 10 }),
                ActorId::Host,
                10,
            ),
            EventInput::new(
                "VoteSubmitted",
                1,
                serde_json::json!({
                    "phase_id": "D01",
                    "actor": "slot_1",
                    "target": "slot_2"
                }),
                ActorId::Host,
                11,
            ),
            EventInput::new(
                "ActionSubmitted",
                1,
                serde_json::json!({
                    "phase_id": "N02",
                    "actor": "slot_1",
                    "action_id": "action_1",
                    "template_id": "template_1",
                    "targets": ["slot_2"]
                }),
                ActorId::Host,
                12,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "phase_id": "D01",
                    "channel_id": "main",
                    "author": { "kind": "host_narrator" },
                    "body": "canonical phase id"
                }),
                ActorId::Host,
                13,
            ),
            EventInput::new(
                "PhaseAdvanced",
                1,
                serde_json::json!({ "phase_id": "N02", "phase_opened_at": 14 }),
                ActorId::Host,
                14,
            ),
            EventInput::new(
                "DeadlineSet",
                1,
                serde_json::json!({ "phase_id": "N02", "at": 20 }),
                ActorId::Host,
                15,
            ),
        ],
    )
    .await
    .expect("canonical persisted phase ids project");

    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        phase_id("N02")
    );
    assert_eq!(
        votecount(&pool, game).await.unwrap()[0].phase_id,
        phase_id("D01")
    );
    assert_eq!(
        projections::active_action_submissions(&pool, game, &phase_id("N02"), "slot_1")
            .await
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        projections::thread_view(&pool, game, None, 10)
            .await
            .unwrap()
            .posts[0]
            .phase_id
            .as_ref()
            .map(PhaseId::as_str),
        Some("D01")
    );

    rebuild(&pool, game)
        .await
        .expect("canonical phase ids must replay identically");
    assert_eq!(
        phase_state(&pool, game).await.unwrap().unwrap().phase_id,
        phase_id("N02")
    );
    assert_eq!(
        votecount(&pool, game).await.unwrap()[0].phase_id,
        phase_id("D01")
    );
    assert_eq!(
        projections::thread_view(&pool, game, None, 10)
            .await
            .unwrap()
            .posts[0]
            .phase_id
            .as_ref()
            .map(PhaseId::as_str),
        Some("D01")
    );
}

/// Setup discussion is deliberately outside a phase. The nullable SQL column
/// must round-trip as typed absence rather than an empty-string sentinel.
#[sqlx::test(migrations = "../projections/migrations")]
async fn prephase_thread_posts_round_trip_as_typed_absence(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "author": { "kind": "host_narrator" },
                "phase_id": null,
                "body": "The lobby is open."
            }),
            ActorId::Host,
            1,
        )],
    )
    .await
    .expect("pre-phase post is valid");

    let posts = projections::thread_view(&pool, game, None, 10)
        .await
        .expect("read pre-phase post");
    assert_eq!(posts.posts.len(), 1);
    assert_eq!(posts.posts[0].phase_id, None);
    assert_eq!(posts.posts[0].body, "The lobby is open.");
    let stored_phase_id: Option<String> =
        sqlx::query_scalar("SELECT phase_id FROM thread_view WHERE game_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_phase_id, None);

    rebuild(&pool, game).await.expect("rebuild pre-phase post");
    let rebuilt = projections::thread_view(&pool, game, None, 10)
        .await
        .expect("read rebuilt pre-phase post");
    assert_eq!(rebuilt.posts.len(), 1);
    assert_eq!(rebuilt.posts[0].phase_id, None);
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
    reconcile_database_authority(
        &pool,
        LOCAL_APPLICATION_DATABASE_PASSWORD,
        LOCAL_KEY_ADMIN_DATABASE_PASSWORD,
    )
    .await
    .expect("reconcile least-privilege roles for projection audit CLI");

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
    assert_eq!(before_slot["role_key"], "<private>");
    assert_eq!(rebuilt_slot["role_key"], "<private>");
    let live_slots = projections::slot_state(&pool, drift_game)
        .await
        .expect("live drifted projection rows after rollback audit");
    let live_role = live_slots
        .iter()
        .find(|row| row.slot_id == "slot_2")
        .and_then(|row| row.role_key.as_deref());
    assert_eq!(live_role, Some("tampered_doctor"));
}

async fn run_audit_rebuild_cli(pool: &PgPool, game: Uuid) -> std::process::Output {
    let database_url = application_database_url_for_pool(pool).await;
    let bin = std::env::var("CARGO_BIN_EXE_audit_rebuild")
        .unwrap_or_else(|_| env!("CARGO_BIN_EXE_audit_rebuild").to_string());
    ProcessCommand::new(bin)
        .arg(game.to_string())
        .env("DATABASE_URL", database_url)
        .output()
        .expect("run audit_rebuild binary")
}

async fn tamper_slot_state_role(pool: &PgPool, game: Uuid, slot: &str, role_key: &str) {
    let game_text = game.to_string();
    let context = format!("fmarch-projection-v1:slot_state:{game_text}:{slot}");
    let envelope: serde_json::Value =
        sqlx::query_scalar("SELECT private FROM slot_state WHERE game_id = $1 AND slot_id = $2")
            .bind(game)
            .bind(slot)
            .fetch_one(pool)
            .await
            .expect("read encrypted live slot state before tamper");
    let mut plaintext = eventstore::decrypt_private_projection(&envelope, &context)
        .expect("open live slot state before tamper");
    plaintext["role_key"] = serde_json::json!(role_key);
    let mut tx = pool.begin().await.expect("begin slot-state tamper");
    let private = eventstore::encrypt_private_projection(&mut tx, plaintext, &context)
        .await
        .expect("seal tampered slot state");
    let update =
        sqlx::query("UPDATE slot_state SET private = $3 WHERE game_id = $1 AND slot_id = $2")
            .bind(game)
            .bind(slot)
            .bind(private)
            .execute(&mut *tx)
            .await
            .expect("tamper live slot_state role");
    tx.commit().await.expect("commit slot-state tamper");
    assert_eq!(update.rows_affected(), 1, "one slot_state row tampered");
}

async fn application_database_url_for_pool(pool: &PgPool) -> String {
    let database: String = sqlx::query_scalar("SELECT current_database()")
        .fetch_one(pool)
        .await
        .expect("query current test database");
    let base = std::env::var("DATABASE_URL").expect("DATABASE_URL for sqlx test");
    PgConnectOptions::from_str(&base)
        .expect("DATABASE_URL is valid Postgres")
        .database(&database)
        .username(APPLICATION_DATABASE_ROLE)
        .password(LOCAL_APPLICATION_DATABASE_PASSWORD)
        .to_url_lossy()
        .to_string()
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn persistent_effect_projection_marks_clears_and_rebuilds(pool: sqlx::PgPool) {
    let game = Uuid::new_v4();
    let applied = ResolutionApplied {
        phase_id: phase_id("N01"),
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
                    phase_id: Some(phase_id("N01")),
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
                    phase_id: Some(phase_id("N01")),
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
                    source_action: None,
                    phase_id: None,
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
                effect.phase_id.as_ref().map(PhaseId::as_str),
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
        phase_id: phase_id("N01"),
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
                    phase_id: Some(phase_id("N01")),
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
        phase_id: phase_id("N01"),
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
                    phase_id: phase_id("N01"),
                },
            },
            IndexedEvent {
                index: 1,
                event: InnerEvent::ActionGrantConsumed {
                    grant_id: "extra_action".into(),
                    actor: "slot_2".into(),
                    action_id: "cop_extra_n02".into(),
                    source_action: "motivate_n01".into(),
                    phase_id: phase_id("N02"),
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
                    phase_id: phase_id("N01"),
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
        phase_id: phase_id("N01"),
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
                    phase_id: phase_id("N01"),
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
    assert_eq!(counter.phase_id, phase_id("N01"));
    assert_eq!(counter.phase_kind, "Night");
    assert_eq!(counter.phase_number, 1);

    let before_json = serde_json::to_string(&before).unwrap();
    sqlx::query(
        "UPDATE action_counter SET phase_kind = 'Day', phase_number = 999 \
         WHERE game_id = $1 AND slot_id = 'slot_1' AND counter_id = 'x_shot:night_kill'",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    let derived = action_counters(&pool, game).await.unwrap();
    assert_eq!(derived[0].phase_id, phase_id("N01"));
    assert_eq!(derived[0].phase_kind, "Night");
    assert_eq!(derived[0].phase_number, 1);

    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        before_json,
        serde_json::to_string(&action_counters(&pool, game).await.unwrap()).unwrap(),
        "action_counter: rebuild != incremental"
    );

    sqlx::query(
        "UPDATE action_counter SET phase_id = 'N00' \
         WHERE game_id = $1 AND slot_id = 'slot_1' AND counter_id = 'x_shot:night_kill'",
    )
    .bind(game)
    .execute(&pool)
    .await
    .unwrap();
    assert!(matches!(
        action_counters(&pool, game).await,
        Err(ProjectionError::Payload { ref kind, .. }) if kind == "action_counter"
    ));
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
                "author": { "kind": "slot", "slot_id": "slot_1" },
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
            "author": { "kind": "slot", "slot_id": "slot_2" },
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
                test_game_created_payload("host_active", "mafiascum"),
                ActorId::Principal(fixture_principal_id("host_active")),
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
                test_game_created_payload("host_completed", "mafia_universe"),
                ActorId::Principal(fixture_principal_id("host_completed")),
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
            test_game_created_payload("host_setup", "epicmafia"),
            ActorId::Principal(fixture_principal_id("host_setup")),
            150,
        )],
    )
    .await
    .unwrap();

    let latest = game_index(&pool, None, 1).await.unwrap();
    assert_eq!(latest.games.len(), 1);
    assert_eq!(latest.games[0].game_id, completed_game);
    assert_eq!(latest.games[0].pack_ref.key, "mafia_universe");
    assert_eq!(latest.games[0].pack_ref.version, 1);
    assert_eq!(
        latest.games[0].pack_ref.content_hash.as_str(),
        test_pack_artifact("mafia_universe")
            .pack_ref
            .content_hash
            .as_str()
    );
    assert_eq!(latest.games[0].status, "completed");
    assert_eq!(
        latest.games[0].phase_id.as_ref().map(PhaseId::as_str),
        Some("D01")
    );
    assert_eq!(latest.games[0].completed_seq, Some(6));
    let cursor = latest.next_cursor.expect("older public row cursor");

    let older = game_index(&pool, Some(cursor), 1).await.unwrap();
    assert_eq!(older.games.len(), 1);
    assert_eq!(older.games[0].game_id, active_game);
    assert_eq!(older.games[0].pack_ref.key, "mafiascum");
    assert_eq!(older.games[0].status, "active");
    assert_eq!(
        older.games[0].phase_id.as_ref().map(PhaseId::as_str),
        Some("N01")
    );
    assert_eq!(older.next_cursor, None);

    rebuild(&pool, active_game).await.unwrap();
    rebuild(&pool, completed_game).await.unwrap();
    rebuild(&pool, setup_game).await.unwrap();
    let rebuilt = game_index(&pool, None, 10).await.unwrap();
    assert_eq!(
        rebuilt
            .games
            .iter()
            .map(|row| {
                (
                    row.game_id,
                    row.status.as_str(),
                    row.phase_id.as_ref().map(PhaseId::as_str),
                )
            })
            .collect::<Vec<_>>(),
        vec![
            (completed_game, "completed", Some("D01")),
            (active_game, "active", Some("N01")),
        ]
    );
    let operator_rows = operator_game_index(&pool, None, 10).await.unwrap();
    assert_eq!(
        operator_rows
            .games
            .iter()
            .map(|row| (row.game_id, row.status.as_str()))
            .collect::<Vec<_>>(),
        vec![
            (setup_game, "setup"),
            (completed_game, "completed"),
            (active_game, "active"),
        ]
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn public_search_filters_visibility_private_channels_and_rebuilds(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(42);
    let topic = Uuid::from_u128(43);
    let game = Uuid::from_u128(44);
    ensure_test_principal(&pool, "signal_member").await;
    let profile = create_test_profile(
        &pool,
        "signal_member",
        "signal_member",
        "Signal Member",
        "Studies public signals",
        ProfileVisibility::Public,
        1,
    )
    .await;
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "theory", "title": "Theory", "description": "Public analysis" }),
            ActorId::Principal(fixture_principal_id("moderator")),
            2,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Signal theory", "author_profile_id": profile }),
                ActorId::Principal(fixture_principal_id("signal_member")),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Alpha signal analysis", "author_profile_id": profile }),
                ActorId::Principal(fixture_principal_id("signal_member")),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload("host", "signal_pack"),
                ActorId::Principal(fixture_principal_id("host")),
                5,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                6,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "Public signal from the game",
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                7,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "role_pm:slot_1",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "Private secret signal",
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                8,
            ),
        ],
    )
    .await
    .unwrap();

    let first = public_search(&pool, "signal", PublicSearchFilter::All, None, 2, None)
        .await
        .unwrap();
    assert_eq!(first.results.len(), 2);
    let second = public_search(
        &pool,
        "signal",
        PublicSearchFilter::All,
        first.next_cursor,
        10,
        None,
    )
    .await
    .unwrap();
    assert!(!second.results.is_empty());
    let discussions = public_search(
        &pool,
        "signal",
        PublicSearchFilter::Discussions,
        None,
        10,
        None,
    )
    .await
    .unwrap();
    assert!(discussions
        .results
        .iter()
        .all(|row| row.kind == "discussions"));
    assert!(discussions
        .results
        .iter()
        .any(|row| row.href.contains("/discussions/theory/t/") && row.href.contains("#post-")));
    let private = public_search(&pool, "secret", PublicSearchFilter::All, None, 10, None)
        .await
        .unwrap();
    assert!(private.results.is_empty());

    append_discussion_and_project_expected(
        &pool,
        topic,
        2,
        &[EventInput::new(
            "DiscussionTopicVisibilityChanged",
            1,
            serde_json::json!({ "visibility": "hidden" }),
            ActorId::Principal(fixture_principal_id("moderator")),
            9,
        )],
    )
    .await
    .unwrap();
    assert!(public_search(
        &pool,
        "alpha",
        PublicSearchFilter::Discussions,
        None,
        10,
        None,
    )
    .await
    .unwrap()
    .results
    .is_empty());

    update_test_profile(
        &pool,
        TestProfileUpdate {
            profile_id: profile,
            principal: "signal_member",
            expected_revision: 1,
            edit: test_profile_edit(
                "Signal Member",
                "Studies public signals",
                ProfileVisibility::Private,
            ),
            occurred_at: 10,
        },
    )
    .await;
    assert!(public_search(
        &pool,
        "signal",
        PublicSearchFilter::Profiles,
        None,
        10,
        None,
    )
    .await
    .unwrap()
    .results
    .is_empty());
    rebuild_profile_stream(&pool, profile).await.unwrap();

    rebuild(&pool, game).await.unwrap();
    let rebuilt_games = public_search(&pool, "signal", PublicSearchFilter::Games, None, 10, None)
        .await
        .unwrap();
    assert!(rebuilt_games.results.iter().any(|row| row.kind == "games"));
    assert!(rebuilt_games
        .results
        .iter()
        .all(|row| row.href.starts_with(&format!("/games/{game}"))));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn moderation_reports_dedupe_hide_restore_audit_and_rebuild(pool: sqlx::PgPool) {
    let host = auxiliary_principal(0x2101);
    let reporter = auxiliary_principal(0x2102);
    let other_member = auxiliary_principal(0x2103);
    let moderator = auxiliary_principal(0x2104);
    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(&host.to_string(), "moderation_pack"),
                ActorId::Principal(host),
                1,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                2,
            ),
            EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": { "kind": "slot", "slot_id": "slot_1" },
                    "body": "abusive zebra message",
                    "phase_id": "D01"
                }),
                ActorId::Slot("slot_1".into()),
                3,
            ),
        ],
    )
    .await
    .unwrap();
    let source_seq = projections::thread_view(&pool, game, None, 10)
        .await
        .unwrap()
        .posts[0]
        .source_seq;
    let target = ModerationTarget {
        public: PublicContentRef::new(game, source_seq),
    };
    let report_id = Uuid::new_v4();
    let receipt = projections::submit_moderation_report(
        &pool,
        target.clone(),
        report_id,
        reporter,
        ReportReasonFamily::Harassment,
        "direct abuse".into(),
        10,
    )
    .await
    .unwrap();
    assert_eq!(receipt.status, "received");
    assert!(matches!(
        projections::submit_moderation_report(
            &pool,
            target.clone(),
            Uuid::new_v4(),
            reporter,
            ReportReasonFamily::Harassment,
            "duplicate".into(),
            11,
        )
        .await,
        Err(ProjectionError::DuplicateModerationReport)
    ));
    assert!(
        projections::moderation_report_receipt(&pool, report_id, other_member)
            .await
            .unwrap()
            .is_none()
    );

    let page = projections::moderation_cases(&pool, Some("open"), None, 10)
        .await
        .unwrap();
    assert_eq!(page.cases.len(), 1);
    let case_id = page.cases[0].case_id;
    let state = projections::moderation_case_state(&pool, case_id)
        .await
        .unwrap()
        .unwrap();
    let hidden = trust_safety::decide_moderation(
        Some(&state),
        ModerationCommand::Hide {
            reason: "harassing content".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        &pool,
        case_id,
        state.version,
        hidden,
        moderator,
        12,
    )
    .await
    .unwrap();
    assert!(projections::public_thread_view(&pool, game, None, 10)
        .await
        .unwrap()
        .posts
        .is_empty());
    assert!(
        public_search(&pool, "zebra", PublicSearchFilter::Games, None, 10, None)
            .await
            .unwrap()
            .results
            .is_empty()
    );
    assert_eq!(
        projections::moderation_report_receipt(&pool, report_id, reporter)
            .await
            .unwrap()
            .unwrap()
            .status,
        "hidden"
    );

    let state = projections::moderation_case_state(&pool, case_id)
        .await
        .unwrap()
        .unwrap();
    let restored = trust_safety::decide_moderation(
        Some(&state),
        ModerationCommand::Restore {
            reason: "appeal accepted".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        &pool,
        case_id,
        state.version,
        restored,
        moderator,
        13,
    )
    .await
    .unwrap();
    assert_eq!(
        projections::public_thread_view(&pool, game, None, 10)
            .await
            .unwrap()
            .posts
            .len(),
        1
    );
    assert_eq!(
        public_search(&pool, "zebra", PublicSearchFilter::Games, None, 10, None)
            .await
            .unwrap()
            .results
            .len(),
        1
    );

    projections::submit_moderation_report(
        &pool,
        target,
        Uuid::new_v4(),
        reporter,
        ReportReasonFamily::Harassment,
        "new report after restoration".into(),
        14,
    )
    .await
    .unwrap();
    let state = projections::moderation_case_state(&pool, case_id)
        .await
        .unwrap()
        .unwrap();
    let dismissed = trust_safety::decide_moderation(
        Some(&state),
        ModerationCommand::Dismiss {
            reason: "not a violation".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        &pool,
        case_id,
        state.version,
        dismissed,
        moderator,
        15,
    )
    .await
    .unwrap();
    let detail = projections::moderation_case_by_id(&pool, case_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(detail.case.status, "dismissed");
    assert_eq!(detail.reports.len(), 2);
    assert_eq!(detail.history.len(), 6);

    rebuild_moderation_stream(&pool, case_id).await.unwrap();
    let rebuilt = projections::moderation_case_by_id(&pool, case_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(rebuilt.case.status, "dismissed");
    assert_eq!(rebuilt.history, detail.history);
    assert_eq!(
        public_search(&pool, "zebra", PublicSearchFilter::Games, None, 10, None)
            .await
            .unwrap()
            .results
            .len(),
        1
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn moderation_report_submissions_are_bounded_per_reporter(pool: sqlx::PgPool) {
    let host = auxiliary_principal(0x2201);
    let reporter = auxiliary_principal(0x2202);
    let game = Uuid::new_v4();
    let mut events = vec![
        EventInput::new(
            "GameCreated",
            1,
            test_game_created_payload(&host.to_string(), "moderation_limit"),
            ActorId::Principal(host),
            1,
        ),
        EventInput::new(
            "GameStarted",
            1,
            serde_json::json!({ "phase_id": "D01" }),
            ActorId::Host,
            2,
        ),
    ];
    for index in 0..11 {
        events.push(EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "author": { "kind": "slot", "slot_id": "slot_1" },
                "body": format!("report target {index}"),
                "phase_id": "D01"
            }),
            ActorId::Slot("slot_1".into()),
            3 + index,
        ));
    }
    append_and_project(&pool, game, &events).await.unwrap();
    let posts = projections::public_thread_view(&pool, game, None, 20)
        .await
        .unwrap()
        .posts;
    assert_eq!(posts.len(), 11);
    for (index, post) in posts.iter().take(10).enumerate() {
        projections::submit_moderation_report(
            &pool,
            ModerationTarget {
                public: PublicContentRef::new(game, post.source_seq),
            },
            Uuid::new_v4(),
            reporter,
            ReportReasonFamily::Other,
            String::new(),
            100 + index as i64,
        )
        .await
        .unwrap();
    }
    let rejected = projections::submit_moderation_report(
        &pool,
        ModerationTarget {
            public: PublicContentRef::new(game, posts[10].source_seq),
        },
        Uuid::new_v4(),
        reporter,
        ReportReasonFamily::Other,
        String::new(),
        111,
    )
    .await;
    assert!(matches!(
        rejected,
        Err(ProjectionError::ModerationReportRateLimited)
    ));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn subscriptions_fan_out_public_updates_suppress_moderation_and_rebuild(pool: PgPool) {
    let author = auxiliary_principal(0x2301);
    let member = auxiliary_principal(0x2302);
    let moderator = auxiliary_principal(0x2303);
    let reporter = auxiliary_principal(0x2304);
    let host = auxiliary_principal(0x2305);
    let area = Uuid::new_v4();
    let topic = Uuid::new_v4();
    ensure_auxiliary_principal(&pool, author).await;
    let profile = create_auxiliary_profile(
        &pool,
        author,
        "author_a",
        "Author A",
        "Writes community updates",
        ProfileVisibility::Public,
        1,
    )
    .await;
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({ "slug": "watch", "title": "Watch", "description": "Updates" }),
            ActorId::Principal(moderator),
            2,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({ "area_id": area, "title": "Watched topic", "author_profile_id": profile }),
                ActorId::Principal(author),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "Opening post", "author_profile_id": profile }),
                ActorId::Principal(author),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let target = WatchTarget { surface_id: topic };
    let watcher = projections::subscribe_to_public_target(&pool, target.clone(), member, 5)
        .await
        .unwrap();
    assert!(watcher.subscribed);
    assert_eq!(watcher.unread_count, 0);
    projections::subscribe_to_public_target(&pool, target.clone(), author, 5)
        .await
        .unwrap();

    let version = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .version;
    append_discussion_and_project_expected(
        &pool,
        topic,
        version,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({ "body": "First watched reply", "author_profile_id": profile }),
            ActorId::Principal(author),
            6,
        )],
    )
    .await
    .unwrap();
    let watched_seq = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .last_post_seq
        .unwrap();
    let inbox = projections::public_inbox(&pool, member, None, 20)
        .await
        .unwrap();
    assert_eq!(inbox.unread_count, 1);
    assert_eq!(inbox.items.len(), 1);
    assert_eq!(inbox.items[0].title, "Watched topic");
    assert!(inbox.items[0]
        .href
        .ends_with(&format!("#post-{watched_seq}")));
    assert!(!inbox.items[0].href.contains(&member.to_string()));
    assert!(projections::public_inbox(&pool, author, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());

    projections::advance_subscription_read_cursor(&pool, target.clone(), member, watched_seq, 7)
        .await
        .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .unread_count,
        0
    );

    let version = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .version;
    append_discussion_and_project_expected(
        &pool,
        topic,
        version,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({ "body": "Moderated watched reply", "author_profile_id": profile }),
            ActorId::Principal(author),
            8,
        )],
    )
    .await
    .unwrap();
    let moderated_seq = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .last_post_seq
        .unwrap();
    let moderation_target = ModerationTarget {
        public: PublicContentRef::new(topic, moderated_seq),
    };
    projections::submit_moderation_report(
        &pool,
        moderation_target,
        Uuid::new_v4(),
        reporter,
        ReportReasonFamily::Spam,
        "spam".into(),
        9,
    )
    .await
    .unwrap();
    let case = projections::moderation_cases(&pool, Some("open"), None, 10)
        .await
        .unwrap()
        .cases
        .into_iter()
        .find(|case| case.source_seq == moderated_seq)
        .unwrap();
    let case_state = projections::moderation_case_state(&pool, case.case_id)
        .await
        .unwrap()
        .unwrap();
    let hidden = trust_safety::decide_moderation(
        Some(&case_state),
        ModerationCommand::Hide {
            reason: "spam".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        &pool,
        case.case_id,
        case_state.version,
        hidden,
        moderator,
        10,
    )
    .await
    .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .unread_count,
        0
    );
    let case_state = projections::moderation_case_state(&pool, case.case_id)
        .await
        .unwrap()
        .unwrap();
    let restored = trust_safety::decide_moderation(
        Some(&case_state),
        ModerationCommand::Restore {
            reason: "restored".into(),
        },
    )
    .unwrap();
    projections::append_moderation_and_project_expected(
        &pool,
        case.case_id,
        case_state.version,
        restored,
        moderator,
        11,
    )
    .await
    .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .unread_count,
        1
    );

    projections::unsubscribe_from_public_target(&pool, target.clone(), member, 12)
        .await
        .unwrap();
    let version = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .version;
    append_discussion_and_project_expected(
        &pool,
        topic,
        version,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({ "body": "Unwatched reply", "author_profile_id": profile }),
            ActorId::Principal(author),
            13,
        )],
    )
    .await
    .unwrap();
    let before_resubscribe = projections::public_inbox(&pool, member, None, 20)
        .await
        .unwrap()
        .items
        .len();
    let resubscribed = projections::subscribe_to_public_target(&pool, target.clone(), member, 14)
        .await
        .unwrap();
    assert_eq!(
        resubscribed.read_through_seq,
        resubscribed.latest_source_seq
    );

    rebuild_discussion_stream(&pool, topic).await.unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .items
            .len(),
        before_resubscribe
    );
    let subscription_id: Uuid = sqlx::query_scalar(
        "SELECT subscription_id FROM public_watch WHERE principal_id = $1 AND surface_id = $2",
    )
    .bind(member.as_uuid())
    .bind(topic)
    .fetch_one(&pool)
    .await
    .unwrap();
    projections::rebuild_subscription_stream(&pool, subscription_id)
        .await
        .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .items
            .len(),
        before_resubscribe
    );

    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[
            EventInput::new(
                "GameCreated",
                1,
                test_game_created_payload(&host.to_string(), "watch_pack"),
                ActorId::Principal(host),
                15,
            ),
            EventInput::new(
                "GameStarted",
                1,
                serde_json::json!({ "phase_id": "D01" }),
                ActorId::Host,
                16,
            ),
        ],
    )
    .await
    .unwrap();
    let game_target = WatchTarget { surface_id: game };
    projections::subscribe_to_public_target(&pool, game_target, member, 17)
        .await
        .unwrap();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "PostSubmitted",
            1,
            serde_json::json!({
                "channel_id": "main",
                "author": { "kind": "host_narrator" },
                "body": "Game update",
                "phase_id": "D01"
            }),
            ActorId::Host,
            18,
        )],
    )
    .await
    .unwrap();
    let game_post_author_profile_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT author_profile_id FROM public_publication \
         WHERE surface_id = $1 AND body = 'Game update' ORDER BY source_seq DESC LIMIT 1",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        game_post_author_profile_id, None,
        "public game posts never carry profile attribution"
    );
    let game_items = projections::public_inbox(&pool, member, None, 20)
        .await
        .unwrap()
        .items
        .into_iter()
        .filter(|item| item.surface_id == game)
        .count();
    assert_eq!(game_items, 0);
    rebuild(&pool, game).await.unwrap();
    assert_eq!(
        projections::public_inbox(&pool, member, None, 20)
            .await
            .unwrap()
            .items
            .into_iter()
            .filter(|item| item.surface_id == game)
            .count(),
        0
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn thread_author_must_match_stored_event_actor(pool: sqlx::PgPool) {
    let forged_attributions = [
        (
            serde_json::json!({ "kind": "slot", "slot_id": "slot_2" }),
            ActorId::Slot("slot_1".into()),
            "a slot cannot claim another slot",
        ),
        (
            serde_json::json!({ "kind": "host_narrator" }),
            ActorId::Slot("slot_1".into()),
            "a slot cannot claim host narration",
        ),
        (
            serde_json::json!({ "kind": "system" }),
            ActorId::Host,
            "a host cannot claim system output",
        ),
    ];

    for (author, actor, expectation) in forged_attributions {
        let game = Uuid::new_v4();
        let error = append_and_project(
            &pool,
            game,
            &[EventInput::new(
                "PostSubmitted",
                1,
                serde_json::json!({
                    "channel_id": "main",
                    "author": author,
                    "body": "forged attribution",
                    "phase_id": "D01",
                }),
                actor,
                1,
            )],
        )
        .await
        .expect_err(expectation);

        assert!(matches!(
            error,
            ProjectionError::Payload { ref kind, .. } if kind == "PostSubmitted"
        ));
        let persisted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(
            persisted, 0,
            "invalid attribution rolls back the event append"
        );
    }
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
                "author": { "kind": "slot", "slot_id": "slot_1" },
                "body": "private night plan",
                "phase_id": "D01",
            }),
            ActorId::Slot("slot_1".into()),
            31,
        ),
    ];

    append_and_project(&pool, game, &events).await.unwrap();

    let raw_role: (i16, i64, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version, stream_key_epoch, sealed_nonce, sealed_body FROM events WHERE stream_id = $1 AND kind = 'RoleAssigned'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_role.0, 3);
    assert!(raw_role.1 > 0);
    assert_eq!(raw_role.2.len(), 24);
    assert!(raw_role.3.len() >= 16);
    let raw_role_body = String::from_utf8_lossy(&raw_role.3);
    assert!(!raw_role_body.contains("slot_1"));
    assert!(!raw_role_body.contains("godfather"));

    let raw_post: (i16, i64, Vec<u8>, Vec<u8>) = sqlx::query_as(
        "SELECT sealed_version, stream_key_epoch, sealed_nonce, sealed_body FROM events WHERE stream_id = $1 AND kind = 'PostSubmitted'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(raw_post.0, 3);
    assert!(raw_post.1 > 0);
    assert_eq!(raw_post.2.len(), 24);
    assert!(raw_post.3.len() >= 16);
    let raw_post_body = String::from_utf8_lossy(&raw_post.3);
    assert!(!raw_post_body.contains("private:mafia_day_chat"));
    assert!(!raw_post_body.contains("private night plan"));

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

#[sqlx::test(migrations = "../projections/migrations")]
async fn append_and_project_notifies_live_channel_after_commit(pool: sqlx::PgPool) {
    let mut listener = sqlx::postgres::PgListener::connect_with(&pool)
        .await
        .expect("listen");
    listener
        .listen(LIVE_EVENT_NOTIFY_CHANNEL)
        .await
        .expect("subscribe live channel");
    let game = Uuid::new_v4();
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "RoleAssigned",
            1,
            serde_json::json!({ "slot_id": "slot_1", "role_key": "doctor" }),
            ActorId::System,
            1,
        )],
    )
    .await
    .unwrap();
    let notification = tokio::time::timeout(std::time::Duration::from_secs(2), listener.recv())
        .await
        .expect("NOTIFY after commit")
        .expect("payload");
    assert_eq!(notification.channel(), LIVE_EVENT_NOTIFY_CHANNEL);
    assert_eq!(notification.payload(), game.to_string());
}

/// Non-game discussion streams use the same append-only store but a separate,
/// public-safe projection boundary from game streams.
#[sqlx::test(migrations = "../projections/migrations")]
async fn discussion_projection_pages_visible_topics_and_hides_moderated_rows(pool: sqlx::PgPool) {
    let area = Uuid::from_u128(101);
    let visible_topic = Uuid::from_u128(102);
    let hidden_topic = Uuid::from_u128(103);

    ensure_test_principal(&pool, "member").await;
    let member_profile = create_test_profile(
        &pool,
        "member",
        "member",
        "Member",
        "Community member",
        ProfileVisibility::Public,
        1,
    )
    .await;
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
            ActorId::Principal(fixture_principal_id("moderator")),
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
                    "author_profile_id": member_profile
                }),
                ActorId::Principal(fixture_principal_id("member")),
                2,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({ "body": "First public post", "author_profile_id": member_profile }),
                ActorId::Principal(fixture_principal_id("member")),
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
                    "author_profile_id": member_profile
                }),
                ActorId::Principal(fixture_principal_id("member")),
                4,
            ),
            EventInput::new(
                "DiscussionTopicVisibilityChanged",
                1,
                serde_json::json!({ "visibility": "hidden" }),
                ActorId::Principal(fixture_principal_id("moderator")),
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
    let page = discussion_topics(&pool, area_row.area_id, None, 10, None)
        .await
        .unwrap();
    assert_eq!(page.topics.len(), 1);
    assert_eq!(page.topics[0].topic_id, visible_topic);
    assert_eq!(page.topics[0].post_count, 1);
    assert_eq!(page.topics[0].posting_state, "open");
    assert_eq!(page.topics[0].visibility, "visible");
    assert_eq!(page.topics[0].author.as_ref().unwrap().handle, "member");
    let posts = discussion_posts(&pool, visible_topic, None, 10, None)
        .await
        .unwrap();
    assert_eq!(posts.posts[0].body, "First public post");
    assert_eq!(posts.posts[0].author.as_ref().unwrap().handle, "member");

    let stale_version = page.topics[0].version;
    append_discussion_and_project_expected(
        &pool,
        visible_topic,
        stale_version,
        &[EventInput::new(
            "DiscussionTopicPostingStateChanged",
            1,
            serde_json::json!({ "posting_state": "locked" }),
            ActorId::Principal(fixture_principal_id("moderator")),
            6,
        )],
    )
    .await
    .unwrap();
    let stale_post = append_discussion_and_project_expected(
        &pool,
        visible_topic,
        stale_version,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({ "body": "stale reply", "author_profile_id": member_profile }),
            ActorId::Principal(fixture_principal_id("member")),
            7,
        )],
    )
    .await
    .unwrap_err();
    assert!(matches!(
        stale_post,
        ProjectionError::Store(StoreError::Conflict { .. })
    ));
    assert_eq!(
        discussion_posts(&pool, visible_topic, None, 10, None)
            .await
            .unwrap()
            .posts
            .len(),
        1
    );
    assert_eq!(
        discussion_topic_by_id(&pool, hidden_topic)
            .await
            .unwrap()
            .unwrap()
            .visibility,
        "hidden"
    );
    rebuild_discussion_stream(&pool, visible_topic)
        .await
        .unwrap();
    let rebuilt_posts = discussion_posts(&pool, visible_topic, None, 10, None)
        .await
        .unwrap();
    assert_eq!(rebuilt_posts.posts[0].body, "First public post");
    rebuild_profile_stream(&pool, member_profile).await.unwrap();
    let profile_rebuilt_topic = discussion_topic_by_id(&pool, visible_topic)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        profile_rebuilt_topic.author.as_ref().unwrap().handle,
        "member"
    );
    assert_eq!(
        discussion_posts(&pool, visible_topic, None, 10, None)
            .await
            .unwrap()
            .posts[0]
            .author
            .as_ref()
            .unwrap()
            .handle,
        "member"
    );
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn member_mutes_are_private_reversible_and_filter_personalized_reads(pool: sqlx::PgPool) {
    let reader = auxiliary_principal(0x2401);
    let author = auxiliary_principal(0x2402);
    let moderator = auxiliary_principal(0x2403);
    let area = Uuid::from_u128(142);
    let topic = Uuid::from_u128(143);
    ensure_auxiliary_principal(&pool, reader).await;
    let _reader_profile = create_auxiliary_profile(
        &pool,
        reader,
        "reader",
        "Reader",
        "Reader profile",
        ProfileVisibility::Public,
        1,
    )
    .await;
    ensure_auxiliary_principal(&pool, author).await;
    let target_profile = create_auxiliary_profile(
        &pool,
        author,
        "orchid_author",
        "Orchid Author",
        "Orchid public profile",
        ProfileVisibility::Public,
        1,
    )
    .await;
    append_discussion_and_project(
        &pool,
        area,
        &[EventInput::new(
            "DiscussionAreaCreated",
            1,
            serde_json::json!({
                "slug": "orchids",
                "title": "Orchids",
                "description": "Orchid discussion"
            }),
            ActorId::Principal(moderator),
            2,
        )],
    )
    .await
    .unwrap();
    append_discussion_and_project(
        &pool,
        topic,
        &[
            EventInput::new(
                "DiscussionTopicCreated",
                1,
                serde_json::json!({
                    "area_id": area,
                    "title": "Orchid signals",
                    "author_profile_id": target_profile
                }),
                ActorId::Principal(author),
                3,
            ),
            EventInput::new(
                "DiscussionPostSubmitted",
                1,
                serde_json::json!({
                    "body": "Opening orchid signal",
                    "author_profile_id": target_profile
                }),
                ActorId::Principal(author),
                4,
            ),
        ],
    )
    .await
    .unwrap();
    let subscription_target = WatchTarget { surface_id: topic };
    projections::subscribe_to_public_target(&pool, subscription_target.clone(), reader, 5)
        .await
        .unwrap();
    let version = discussion_topic_by_id(&pool, topic)
        .await
        .unwrap()
        .unwrap()
        .version;
    append_discussion_and_project_expected(
        &pool,
        topic,
        version,
        &[EventInput::new(
            "DiscussionPostSubmitted",
            1,
            serde_json::json!({
                "body": "Watched orchid reply",
                "author_profile_id": target_profile
            }),
            ActorId::Principal(author),
            6,
        )],
    )
    .await
    .unwrap();
    assert_eq!(
        projections::public_inbox(&pool, reader, None, 20)
            .await
            .unwrap()
            .unread_count,
        1
    );

    let muted = projections::mute_public_profile(&pool, reader, "orchid_author", 7)
        .await
        .unwrap();
    assert!(muted.muted);
    assert!(matches!(
        projections::mute_public_profile(&pool, reader, "orchid_author", 8).await,
        Err(ProjectionError::AlreadyMuted)
    ));
    assert!(matches!(
        projections::mute_public_profile(&pool, reader, "reader", 8).await,
        Err(ProjectionError::CannotMuteSelf)
    ));
    assert_eq!(
        projections::member_mutes(&pool, reader, None, 20)
            .await
            .unwrap()
            .members
            .len(),
        1
    );
    assert!(discussion_topics(&pool, area, None, 20, Some(reader))
        .await
        .unwrap()
        .topics
        .is_empty());
    assert!(discussion_posts(&pool, topic, None, 20, Some(reader))
        .await
        .unwrap()
        .posts
        .is_empty());
    assert!(public_search(
        &pool,
        "orchid",
        PublicSearchFilter::All,
        None,
        20,
        Some(reader),
    )
    .await
    .unwrap()
    .results
    .is_empty());
    assert!(
        !public_search(&pool, "orchid", PublicSearchFilter::All, None, 20, None,)
            .await
            .unwrap()
            .results
            .is_empty()
    );
    assert!(projections::public_inbox(&pool, reader, None, 20)
        .await
        .unwrap()
        .items
        .is_empty());
    assert_eq!(
        projections::subscription_target_state(&pool, reader, subscription_target.clone())
            .await
            .unwrap()
            .unread_count,
        0
    );

    let relationship_id: Uuid =
        sqlx::query_scalar("SELECT relationship_id FROM profile_mute WHERE principal_id = $1")
            .bind(reader.as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    assert_eq!(
        projections::member_mutes(&pool, reader, None, 20)
            .await
            .unwrap()
            .members
            .len(),
        1
    );

    let unmuted = projections::unmute_public_profile(&pool, reader, "orchid_author", 9)
        .await
        .unwrap();
    assert!(!unmuted.muted);
    assert!(
        discussion_posts(&pool, topic, None, 20, Some(reader))
            .await
            .unwrap()
            .posts
            .len()
            >= 2
    );
    assert_eq!(
        projections::public_inbox(&pool, reader, None, 20)
            .await
            .unwrap()
            .unread_count,
        1
    );
    assert!(matches!(
        projections::unmute_public_profile(&pool, reader, "orchid_author", 10).await,
        Err(ProjectionError::NotMuted)
    ));
    projections::rebuild_member_mute_stream(&pool, relationship_id)
        .await
        .unwrap();
    assert!(projections::member_mutes(&pool, reader, None, 20)
        .await
        .unwrap()
        .members
        .is_empty());

    let remuted = projections::mute_public_profile(&pool, reader, "orchid_author", 11)
        .await
        .unwrap();
    assert!(remuted.muted);
    profile_application::update_profile(
        &pool,
        ProfileId::from_uuid(target_profile),
        author,
        ProfileRevision::new(1),
        test_profile_edit(
            "Orchid Author",
            "Orchid public profile",
            ProfileVisibility::Private,
        ),
        12,
    )
    .await
    .unwrap();
    assert!(public_profile_by_handle(&pool, "orchid_author")
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM profile_mute WHERE principal_id = $1 AND target_profile_id = $2",
        )
        .bind(reader.as_uuid())
        .bind(target_profile)
        .fetch_one(&pool)
        .await
        .unwrap(),
        0,
        "a private profile has no remaining public mute target",
    );
    assert!(projections::member_mutes(&pool, reader, None, 20)
        .await
        .unwrap()
        .members
        .is_empty());
    assert!(matches!(
        projections::member_mute_state(&pool, reader, "orchid_author").await,
        Err(ProjectionError::MuteTargetNotPublic)
    ));
    assert!(matches!(
        projections::mute_public_profile(&pool, reader, "orchid_author", 13).await,
        Err(ProjectionError::MuteTargetNotPublic)
    ));
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn profile_projection_keeps_owner_state_private_and_rebuildable(pool: sqlx::PgPool) {
    ensure_test_principal(&pool, "owner_a").await;
    let profile = create_test_profile(
        &pool,
        "owner_a",
        "owner_a",
        "Owner A",
        "Opening profile",
        ProfileVisibility::Public,
        1,
    )
    .await;
    update_test_profile(
        &pool,
        TestProfileUpdate {
            profile_id: profile,
            principal: "owner_a",
            expected_revision: 1,
            edit: test_profile_edit("Owner A", "Updated profile", ProfileVisibility::Private),
            occurred_at: 2,
        },
    )
    .await;
    assert!(public_profile_by_handle(&pool, "owner_a")
        .await
        .unwrap()
        .is_none());
    let metadata = sqlx::query(
        "SELECT active_principal_id, handle_hmac, current_claim_id, lifecycle, redacted_alias, revision FROM member_profile WHERE profile_id = $1",
    )
    .bind(profile)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        metadata.get::<Option<Uuid>, _>("active_principal_id"),
        Some(fixture_principal_id("owner_a").as_uuid())
    );
    assert_eq!(metadata.get::<String, _>("lifecycle"), "active");
    assert_eq!(metadata.get::<Option<String>, _>("redacted_alias"), None);
    assert!(metadata
        .get::<Option<Uuid>, _>("current_claim_id")
        .is_some());
    let handle_hmac = metadata
        .get::<Option<Vec<u8>>, _>("handle_hmac")
        .expect("active profiles retain only an opaque handle reservation");
    assert_eq!(handle_hmac.len(), 32);
    assert_eq!(metadata.get::<i64, _>("revision"), 2);
    rebuild_profile_stream(&pool, profile).await.unwrap();
    assert!(public_profile_by_handle(&pool, "owner_a")
        .await
        .unwrap()
        .is_none());
    let rebuilt = sqlx::query(
        "SELECT active_principal_id, handle_hmac, current_claim_id, lifecycle, redacted_alias, revision FROM member_profile WHERE profile_id = $1",
    )
    .bind(profile)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        rebuilt.get::<Option<Uuid>, _>("active_principal_id"),
        Some(fixture_principal_id("owner_a").as_uuid())
    );
    assert_eq!(rebuilt.get::<String, _>("lifecycle"), "active");
    assert_eq!(rebuilt.get::<Option<String>, _>("redacted_alias"), None);
    assert!(rebuilt.get::<Option<Uuid>, _>("current_claim_id").is_some());
    assert_eq!(
        rebuilt.get::<Option<Vec<u8>>, _>("handle_hmac"),
        Some(handle_hmac)
    );
    assert_eq!(rebuilt.get::<i64, _>("revision"), 2);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn completed_game_export_import_rebuilds_and_audits_in_an_isolated_database(
    pool: sqlx::PgPool,
) {
    let game = Uuid::new_v4();
    let principal = format!("archive-persona-owner-{}", Uuid::new_v4().simple());
    let persona_id = GamePersonaId::random();
    ensure_test_principal(&pool, &principal).await;
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "GameCreated",
            1,
            test_game_created_payload("export_host", "archived_removed_pack"),
            ActorId::Principal(fixture_principal_id("export_host")),
            1,
        )],
    )
    .await
    .unwrap();
    append_test_game_persona_registration(
        &pool,
        game,
        persona_id,
        &principal,
        "Source Persona Name",
        2,
    )
    .await;
    append_test_game_persona_rename(&pool, game, persona_id, "Latest Source Persona Name", 3).await;
    append_and_project(
        &pool,
        game,
        &[EventInput::new(
            "GameCompleted",
            1,
            serde_json::json!({}),
            ActorId::Host,
            4,
        )],
    )
    .await
    .unwrap();
    let export = projections::export_completed_game(&pool, game)
        .await
        .unwrap();
    assert_eq!(export.detached_subject_aliases.len(), 1);
    let detached_alias = export.detached_subject_aliases[0].detached_alias.clone();
    let subject_id: Uuid =
        sqlx::query_scalar("SELECT subject_id FROM privacy_subject WHERE principal_id = $1")
            .bind(fixture_principal_id(&principal).as_uuid())
            .fetch_one(&pool)
            .await
            .unwrap();
    let archive_json = serde_json::to_string(&export).unwrap();
    assert!(!archive_json.contains(&principal));
    assert!(!archive_json.contains("Source Persona Name"));
    assert!(!archive_json.contains("Latest Source Persona Name"));
    assert!(!archive_json.contains(&subject_id.to_string()));
    assert!(archive_json.contains("\"stream_id\""));
    assert!(!archive_json.contains("\"stream\""));
    identity::active_subject_key_store()
        .await
        .unwrap()
        .destroy(identity::SubjectId::from_uuid(subject_id))
        .await
        .unwrap();

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL for target import");
    let (prefix, _) = database_url.rsplit_once('/').expect("database URL path");
    let admin = PgPoolOptions::new()
        .max_connections(1)
        .connect(&format!("{prefix}/postgres"))
        .await
        .unwrap();
    let target_name = format!("fmarch_projection_import_{}", Uuid::new_v4().simple());
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE DATABASE \"{target_name}\""
    )))
    .execute(&admin)
    .await
    .unwrap();
    let target = PgPoolOptions::new()
        .max_connections(2)
        .connect(&format!("{prefix}/{target_name}"))
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&target).await.unwrap();
    let mut tampered_alias_export = export.clone();
    tampered_alias_export.detached_subject_aliases[0].detached_alias =
        "Archived player 00000000000000000000".to_string();
    let tamper_error = projections::import_completed_game_export(&target, &tampered_alias_export)
        .await
        .expect_err("the wrapper checksum must authenticate detached aliases");
    assert!(tamper_error
        .to_string()
        .contains("archive checksum mismatch"));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&target)
            .await
            .unwrap(),
        0
    );
    let mut tampered_artifact_export = export.clone();
    let created = tampered_artifact_export
        .stream
        .events
        .iter_mut()
        .find(|event| event.kind == "GameCreated")
        .expect("archived GameCreated artifact attachment");
    let first = created
        .sealed_body
        .ciphertext
        .chars()
        .next()
        .expect("non-empty GameCreated ciphertext");
    created
        .sealed_body
        .ciphertext
        .replace_range(..1, if first == 'A' { "B" } else { "A" });
    refresh_stream_export_checksum(&mut tampered_artifact_export.stream);
    refresh_completed_game_archive_checksum(&mut tampered_artifact_export);
    projections::import_completed_game_export(&target, &tampered_artifact_export)
        .await
        .expect_err("authenticated GameCreated pack artifact tampering must fail closed");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&target)
            .await
            .unwrap(),
        0,
        "artifact attachment tampering must fail before import"
    );
    let mut missing_alias_export = export.clone();
    missing_alias_export.detached_subject_aliases.clear();
    refresh_completed_game_archive_checksum(&mut missing_alias_export);
    let subject_set_error =
        projections::import_completed_game_export(&target, &missing_alias_export)
            .await
            .expect_err("the alias manifest must cover the exact authenticated subject set");
    assert!(subject_set_error
        .to_string()
        .contains("exactly cover the authenticated game-persona subject set"));
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&target)
            .await
            .unwrap(),
        0,
        "a post-insert subject-set failure must roll the imported stream back"
    );
    sqlx::query(
        r#"
        CREATE FUNCTION reject_archive_game_index() RETURNS trigger
            LANGUAGE plpgsql AS $$
        BEGIN
            RAISE EXCEPTION 'forced archive rebuild failure';
        END;
        $$
        "#,
    )
    .execute(&target)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER reject_archive_game_index BEFORE INSERT ON game_index \
         FOR EACH ROW EXECUTE FUNCTION reject_archive_game_index()",
    )
    .execute(&target)
    .await
    .unwrap();
    assert!(projections::import_completed_game_export(&target, &export)
        .await
        .is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&target)
            .await
            .unwrap(),
        0,
        "a failed first rebuild must leave no imported event prefix"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM completed_game_detached_alias WHERE game_id = $1",
        )
        .bind(game)
        .fetch_one(&target)
        .await
        .unwrap(),
        0,
        "detached aliases must roll back with their failed event import"
    );
    sqlx::query("DROP TRIGGER reject_archive_game_index ON game_index")
        .execute(&target)
        .await
        .unwrap();
    sqlx::query("DROP FUNCTION reject_archive_game_index()")
        .execute(&target)
        .await
        .unwrap();
    let collision_alias = "Global tombstone collision must not win";
    let collision_principal = fixture_principal_id("unrelated-collision-principal");
    sqlx::query(
        "INSERT INTO platform_principal \
         (principal_id, status, created_at, disabled_at) \
         VALUES ($1, 'disabled', 1, 2)",
    )
    .bind(collision_principal.as_uuid())
    .execute(&target)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO privacy_subject \
         (subject_id, principal_id, created_at, lifecycle_state) \
         VALUES ($1, $2, 1, 'erased')",
    )
    .bind(subject_id)
    .bind(collision_principal.as_uuid())
    .execute(&target)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO subject_tombstone (subject_id, replacement_alias, destroyed_at) \
         VALUES ($1, $2, 2)",
    )
    .bind(subject_id)
    .bind(collision_alias)
    .execute(&target)
    .await
    .unwrap();
    let audit = projections::import_completed_game_export(&target, &export)
        .await
        .unwrap();
    assert!(audit.ok);
    assert_eq!(
        projections::game_pack_artifact(&target, game)
            .await
            .unwrap()
            .expect("isolated import rebuilt exact artifact custody"),
        test_pack_artifact("archived_removed_pack"),
        "isolated import must restore the exact self-contained artifact without registry lookup"
    );
    let imported_persona = sqlx::query(
        "SELECT public.current_public_name, binding.subject_id, binding.current_claim_id, binding.lifecycle \
         FROM game_persona_public AS public \
         LEFT JOIN game_persona_subject_binding AS binding USING (game_id, persona_id) \
         WHERE public.game_id = $1 AND public.persona_id = $2",
    )
    .bind(game)
    .bind(persona_id.as_uuid())
    .fetch_one(&target)
    .await
    .unwrap();
    assert_eq!(
        imported_persona.get::<String, _>("current_public_name"),
        detached_alias
    );
    assert_ne!(
        imported_persona.get::<String, _>("current_public_name"),
        collision_alias
    );
    assert_eq!(imported_persona.get::<Option<Uuid>, _>("subject_id"), None);
    assert_eq!(
        imported_persona.get::<Option<Uuid>, _>("current_claim_id"),
        None
    );
    assert_eq!(imported_persona.get::<Option<String>, _>("lifecycle"), None);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM privacy_subject")
            .fetch_one(&target)
            .await
            .unwrap(),
        1,
        "the import must not create or retain a subject link beyond the deliberate collision row"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM subject_private_claim")
            .fetch_one(&target)
            .await
            .unwrap(),
        0
    );

    drop(target);
    sqlx::query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1")
        .bind(&target_name)
        .execute(&admin)
        .await
        .unwrap();
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP DATABASE \"{target_name}\""
    )))
    .execute(&admin)
    .await
    .unwrap();
}
