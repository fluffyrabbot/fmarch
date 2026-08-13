//! Day program / event / scheduler / auto-resolution / narrative family.

use crate::common::*;
use commands::day_scheduler::{
    day_event_scheduler_status, run_day_event_scheduler_once, DayEventSchedulerConfig,
};
use commands::{
    advance_day_event_automation_as_scheduler, handle, handle_idempotent, load_engine_snapshot,
    CohostPermissionClass, Command, Reject,
};
use eventstore::ActorId;
use projections::{
    audit_rebuild, day_event_narratives, day_event_participation, day_events, day_programs,
    phase_state, slot_effects,
};
use sqlx::PgPool;
use uuid::Uuid;

fn minimal_day_event(event_id: &str, effect: &str) -> game_platform::DayEvent {
    game_platform::DayEvent {
        id: game_platform::DayEventId::new(event_id).unwrap(),
        program_id: game_platform::ProgramId::new("program-bakery").unwrap(),
        template_key: game_platform::TemplateKey::new("theme.raffle").unwrap(),
        phase_scope: game_platform::PhaseScope::DuringDay { number: 1 },
        schedule: game_platform::DayEventSchedule::HostOpened,
        participation: game_platform::ParticipationSpec {
            who: game_platform::ParticipantFilter::AliveSlots,
            mode: game_platform::ParticipationMode::OptIn,
            limits: game_platform::ParticipationLimits {
                minimum: 1,
                maximum: None,
            },
        },
        state: game_platform::DayEventState::Scheduled,
        resolution: game_platform::DayEventResolutionMode::HostDecision,
        rewards: vec![game_platform::RewardBinding {
            reward_key: game_platform::RewardKey::new("cookie").unwrap(),
            display_name_theme_key: game_platform::TemplateKey::new("theme.cookie").unwrap(),
            effects: vec![game_platform::RewardEffectTemplate {
                recipient: game_platform::RecipientSelector::Winner,
                operation: game_platform::EffectOperationTemplate::Mark {
                    effect: game_platform::Tag::new(effect).unwrap(),
                },
            }],
        }],
        narrative: game_platform::NarrativeTemplates {
            opened: None,
            locked: None,
            resolved: None,
            cancelled: None,
        },
        channel_policy: game_platform::EventChannelPolicy::PublicMain,
    }
}

fn minimal_day_program(
    program_id: &str,
    version: u32,
    event_ids: &[&str],
) -> game_platform::DayProgram {
    let events = event_ids
        .iter()
        .map(|event_id| {
            let event = minimal_day_event(event_id, "bomb");
            game_platform::DayEventTemplate {
                id: event.id,
                template_key: event.template_key,
                phase_scope: event.phase_scope,
                schedule: event.schedule,
                participation: event.participation,
                resolution: event.resolution,
                rewards: event.rewards,
                narrative: event.narrative,
                channel_policy: event.channel_policy,
            }
        })
        .collect();
    game_platform::DayProgram {
        id: game_platform::ProgramId::new(program_id).unwrap(),
        version,
        display_name: "Bakery".to_string(),
        theme_ref: Some(game_platform::ContentRef::new("theme.bakery").unwrap()),
        narrative_templates: Vec::new(),
        events,
    }
}

fn narrative_day_program(program_id: &str, event_ids: &[&str]) -> game_platform::DayProgram {
    let mut program = minimal_day_program(program_id, 1, event_ids);
    let keys = [
        ("opened", "Event {{event_id}} opened."),
        (
            "locked",
            "Event {{event_id}} locked with {{participant_count}}: {{participants}}.",
        ),
        (
            "resolved",
            "Event {{event_id}} winners {{winners}} received {{rewards}}.",
        ),
        (
            "cancelled",
            "Event {{event_id}} cancelled: {{cancellation_reason}}.",
        ),
    ];
    program.narrative_templates = keys
        .iter()
        .map(|(lifecycle, body)| game_platform::NarrativeTemplate {
            key: game_platform::TemplateKey::new(format!("theme.bakery.narrative.{lifecycle}"))
                .unwrap(),
            body: (*body).to_string(),
        })
        .collect();
    for event in &mut program.events {
        event.narrative = game_platform::NarrativeTemplates {
            opened: Some(game_platform::TemplateKey::new("theme.bakery.narrative.opened").unwrap()),
            locked: Some(game_platform::TemplateKey::new("theme.bakery.narrative.locked").unwrap()),
            resolved: Some(
                game_platform::TemplateKey::new("theme.bakery.narrative.resolved").unwrap(),
            ),
            cancelled: Some(
                game_platform::TemplateKey::new("theme.bakery.narrative.cancelled").unwrap(),
            ),
        };
        event.channel_policy = game_platform::EventChannelPolicy::PublicMain;
    }
    program
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn day_program_attachment_compiles_atomically_and_preserves_generations(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let first = minimal_day_program("program-bakery", 1, &["event-cookie", "event-cake"]);
    let expected_hash = first.content_hash().unwrap().to_string();
    let ack = handle(
        &pool,
        &user("host_h"),
        Command::AttachDayProgram {
            game,
            program: first.clone(),
        },
    )
    .await
    .expect("attach and compile first program generation");
    assert_eq!(ack.stream_seqs.len(), 3);

    let programs = day_programs(&pool, game).await.unwrap();
    assert_eq!(programs.len(), 1);
    assert_eq!(programs[0].program_id, "program-bakery");
    assert_eq!(programs[0].version, 1);
    assert_eq!(programs[0].content_hash, expected_hash);
    assert_eq!(programs[0].document, first);
    let original_event = day_events(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == "event-cookie")
        .unwrap()
        .definition;
    assert_eq!(
        original_event.program_id,
        game_platform::ProgramId::new("program-bakery").unwrap()
    );
    assert_eq!(
        original_event.state,
        game_platform::DayEventState::Scheduled
    );

    let before_duplicate: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user("host_h"),
            Command::AttachDayProgram {
                game,
                program: first,
            },
        )
        .await
        .expect_err("a program generation is immutable"),
        Reject::DayProgramAlreadyAttached
    );
    let after_duplicate: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after_duplicate, before_duplicate);

    let mut invalid_adapter =
        minimal_day_program("program-invalid-adapter", 1, &["event-invalid-adapter"]);
    invalid_adapter.events[0].rewards[0].effects[0].operation =
        game_platform::EffectOperationTemplate::Mark {
            effect: game_platform::Tag::new("not_declared_by_pack").unwrap(),
        };
    assert!(matches!(
        handle(
            &pool,
            &user("host_h"),
            Command::AttachDayProgram {
                game,
                program: invalid_adapter,
            },
        )
        .await
        .expect_err("adapter validation applies before any program facts append"),
        Reject::DayProgramValidation(_)
    ));
    assert_eq!(day_programs(&pool, game).await.unwrap().len(), 1);
    assert!(day_events(&pool, game)
        .await
        .unwrap()
        .iter()
        .all(|event| event.event_id != "event-invalid-adapter"));

    handle(
        &pool,
        &user("host_h"),
        Command::AttachDayProgram {
            game,
            program: minimal_day_program("program-bakery", 2, &["event-bread"]),
        },
    )
    .await
    .expect("a distinct generation remains additive");
    assert_eq!(day_programs(&pool, game).await.unwrap().len(), 2);
    assert_eq!(
        day_events(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .find(|event| event.event_id == "event-cookie")
            .unwrap()
            .definition,
        original_event,
        "later generations cannot rewrite an existing definition"
    );

    let before_collision: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user("host_h"),
            Command::AttachDayProgram {
                game,
                program: minimal_day_program("program-tea", 1, &["event-cookie", "event-tea"]),
            },
        )
        .await
        .expect_err("one event-id collision rejects the complete attachment"),
        Reject::DayEventAlreadyExists
    );
    let after_collision: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
            .bind(game)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(after_collision, before_collision);
    assert_eq!(day_programs(&pool, game).await.unwrap().len(), 2);
    assert!(day_events(&pool, game)
        .await
        .unwrap()
        .iter()
        .all(|event| event.event_id != "event-tea"));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn incompatible_day_program_rejects_before_any_program_fact(pool: PgPool) {
    let game = Uuid::new_v4();
    handle(
        &pool,
        &user("host_h"),
        Command::CreateGame {
            game,
            pack: "default_open".into(),
            cohost_denied: vec![],
        },
    )
    .await
    .expect("create game");
    let program: game_platform::DayProgram = serde_json::from_str(include_str!(
        "../../../../programs/mash-scale-acceptance.v1.program.json"
    ))
    .unwrap();
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();

    let rejection = handle(
        &pool,
        &user("host_h"),
        Command::AttachDayProgram { game, program },
    )
    .await
    .expect_err("setup-visible incompatibility remains authoritative at command time");
    assert!(matches!(
        rejection,
        Reject::DayProgramValidation(ref message)
            if message.contains("scale-event-1")
                && message.contains("not declared by pack `default_open`")
    ));
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, before);
    assert!(day_programs(&pool, game).await.unwrap().is_empty());
    assert!(day_events(&pool, game).await.unwrap().is_empty());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn absolute_day_event_schedule_records_due_evidence_once_at_boundaries(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-absolute").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "bomb");
    event.participation.limits.minimum = 0;
    event.schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: Some(game_platform::UnixSeconds::new(200)),
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();

    let early = advance_day_event_automation_as_scheduler(&pool, game, 99, 1)
        .await
        .unwrap();
    assert!(early.stream_seqs.is_empty());

    let opened = advance_day_event_automation_as_scheduler(&pool, game, 100, 1)
        .await
        .unwrap();
    assert_eq!(opened.stream_seqs.len(), 2);
    let row = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(row.state, "open");
    assert_eq!(row.open_due_at, Some(100));
    assert_eq!(row.open_observed_at, Some(100));
    assert_eq!(row.opened_at, Some(100));

    let duplicate_open = advance_day_event_automation_as_scheduler(&pool, game, 150, 1)
        .await
        .unwrap();
    assert!(duplicate_open.stream_seqs.is_empty());

    let locked = advance_day_event_automation_as_scheduler(&pool, game, 225, 1)
        .await
        .unwrap();
    assert_eq!(locked.stream_seqs.len(), 2);
    let row = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(row.state, "locked");
    assert_eq!(row.lock_due_at, Some(200));
    assert_eq!(row.lock_observed_at, Some(225));
    assert_eq!(row.locked_at, Some(225));

    let duplicate_lock = advance_day_event_automation_as_scheduler(&pool, game, 300, 1)
        .await
        .unwrap();
    assert!(duplicate_lock.stream_seqs.is_empty());
    let evidence = sqlx::query_as::<_, (String, serde_json::Value, serde_json::Value)>(
        "SELECT kind, payload, actor FROM events WHERE stream_id = $1 \
         AND kind IN ('DayEventOpenDue', 'DayEventLockDue') ORDER BY stream_seq",
    )
    .bind(game)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(evidence.len(), 2);
    assert_eq!(evidence[0].0, "DayEventOpenDue");
    assert_eq!(evidence[0].1["source"], "absolute");
    assert_eq!(evidence[1].0, "DayEventLockDue");
    assert!(evidence
        .iter()
        .all(|(_, _, actor)| actor["type"] == "System"));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn relative_day_event_schedule_uses_explicit_phase_open_clock(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let phase = phase_state(&pool, game).await.unwrap().unwrap();
    let phase_opened_at = phase
        .phase_opened_at
        .expect("new phase facts carry an explicit wall-clock anchor");
    let event_id = game_platform::DayEventId::new("event-relative").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "bomb");
    event.participation.limits.minimum = 0;
    event.schedule = game_platform::DayEventSchedule::RelativeToPhase {
        phase_id: game_platform::PhaseId::new("D01").unwrap(),
        open_offset: game_platform::DurationSeconds::new(10).unwrap(),
        lock_offset: Some(game_platform::DurationSeconds::new(20).unwrap()),
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();

    assert!(
        advance_day_event_automation_as_scheduler(&pool, game, phase_opened_at + 9, 1)
            .await
            .unwrap()
            .stream_seqs
            .is_empty()
    );
    advance_day_event_automation_as_scheduler(&pool, game, phase_opened_at + 10, 1)
        .await
        .unwrap();
    advance_day_event_automation_as_scheduler(&pool, game, phase_opened_at + 20, 1)
        .await
        .unwrap();
    let row = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(row.state, "locked");
    assert_eq!(row.open_due_at, Some(phase_opened_at + 10));
    assert_eq!(row.lock_due_at, Some(phase_opened_at + 20));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn phase_trigger_observation_and_manual_cancellation_have_stable_precedence(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let triggered_id = game_platform::DayEventId::new("event-triggered").unwrap();
    let mut triggered = minimal_day_event(triggered_id.as_str(), "bomb");
    triggered.schedule = game_platform::DayEventSchedule::OnTrigger {
        trigger: game_platform::ProgramTrigger::PhaseResolved {
            phase_id: game_platform::PhaseId::new("D01").unwrap(),
        },
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent {
            game,
            event: triggered,
        },
    )
    .await
    .unwrap();

    handle(
        &pool,
        &user("host_h"),
        Command::ResolvePhase { game, seed: 7 },
    )
    .await
    .unwrap();
    let opened = advance_day_event_automation_as_scheduler(&pool, game, 1_000, 1)
        .await
        .unwrap();
    assert_eq!(opened.stream_seqs.len(), 2);
    let triggered = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(triggered.state, "open");
    assert_eq!(triggered.open_due_at, Some(1_000));

    handle(
        &pool,
        &user("host_h"),
        Command::CancelDayEvent {
            game,
            event_id: triggered_id,
            reason: "host superseded automation".into(),
        },
    )
    .await
    .unwrap();
    let after_cancel = advance_day_event_automation_as_scheduler(&pool, game, 2_000, 1)
        .await
        .unwrap();
    assert!(after_cancel.stream_seqs.is_empty());
    let cancelled = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(cancelled.state, "cancelled");
    assert_eq!(
        cancelled.cancelled_reason.as_deref(),
        Some("host superseded automation")
    );
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn scheduler_worker_catches_up_missed_boundaries_and_records_service_authority(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let mut event = minimal_day_event("event-worker", "bomb");
    event.participation.limits.minimum = 0;
    event.schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: Some(game_platform::UnixSeconds::new(200)),
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();

    let config = DayEventSchedulerConfig::default();
    let report = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 225)
        .await
        .unwrap();
    assert_eq!(report.claimed_games, 1);
    assert_eq!(report.succeeded_games, 1);
    assert_eq!(report.appended_events, 4);
    let event = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(event.state, "locked");
    assert_eq!(event.open_due_at, Some(100));
    assert_eq!(event.lock_due_at, Some(200));

    let meta: serde_json::Value = sqlx::query_scalar(
        "SELECT meta FROM events WHERE stream_id = $1 AND kind = 'DayEventOpenDue'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(meta["principal_user_id"], "service:day-event-automation");
    assert_eq!(
        meta["authority_used"],
        format!("DayEventAutomation({game})")
    );
    assert_eq!(meta["source"], "day_event_automation");
    let status = day_event_scheduler_status(&pool, game, 225)
        .await
        .unwrap()
        .unwrap();
    assert!(!status.pending);
    assert_eq!(status.total_attempts, 1);
    assert_eq!(status.total_successes, 1);
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn concurrent_scheduler_replicas_claim_one_game_without_duplicate_evidence(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let mut event = minimal_day_event("event-replica-race", "bomb");
    event.participation.limits.minimum = 0;
    event.schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: None,
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();

    let config = DayEventSchedulerConfig {
        batch_size: 1,
        ..DayEventSchedulerConfig::default()
    };
    let (left, right) = tokio::join!(
        run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100),
        run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100),
    );
    let reports = [left.unwrap(), right.unwrap()];
    assert_eq!(
        reports
            .iter()
            .map(|report| report.claimed_games)
            .sum::<usize>(),
        1
    );
    assert_eq!(
        reports
            .iter()
            .map(|report| report.appended_events)
            .sum::<usize>(),
        2
    );
    let evidence: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'DayEventOpenDue'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(evidence, 1);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn scheduler_failure_releases_lease_and_applies_bounded_retry_backoff(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let mut event = minimal_day_event("event-retry", "bomb");
    event.schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: None,
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE phase_state SET phase_id = 'invalid' WHERE game_id = $1")
        .bind(game)
        .execute(&pool)
        .await
        .unwrap();

    let config = DayEventSchedulerConfig {
        retry_base_seconds: 5,
        retry_max_seconds: 20,
        ..DayEventSchedulerConfig::default()
    };
    let first = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100)
        .await
        .unwrap();
    assert_eq!(first.failed_games, 1);
    let status = day_event_scheduler_status(&pool, game, 100)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(status.consecutive_failures, 1);
    assert_eq!(status.retry_not_before, Some(105));
    assert!(status.lease_owner.is_none());
    assert!(!status.last_error.unwrap().trim().is_empty());

    let suppressed = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 104)
        .await
        .unwrap();
    assert_eq!(suppressed.claimed_games, 0);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn day_event_narratives_compile_publish_and_rebuild_as_host_notices(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let resolved_id = game_platform::DayEventId::new("event-narrative-resolved").unwrap();
    let cancelled_id = game_platform::DayEventId::new("event-narrative-cancelled").unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::AttachDayProgram {
            game,
            program: narrative_day_program(
                "program-narrative",
                &[resolved_id.as_str(), cancelled_id.as_str()],
            ),
        },
    )
    .await
    .unwrap();

    for event_id in [&resolved_id, &cancelled_id] {
        handle(
            &pool,
            &user("host_h"),
            Command::OpenDayEvent {
                game,
                event_id: event_id.clone(),
            },
        )
        .await
        .unwrap();
    }
    let before_worker = day_event_narratives(&pool, game).await.unwrap();
    assert_eq!(
        before_worker
            .iter()
            .filter(|row| row.status == "pending")
            .count(),
        2
    );
    assert_eq!(
        projections::thread_view(&pool, game, None, 100)
            .await
            .unwrap()
            .posts
            .len(),
        0,
        "mechanics commit before narrative publication"
    );

    let config = DayEventSchedulerConfig::default();
    let opened = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100)
        .await
        .unwrap();
    assert_eq!(opened.appended_events, 4);

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: resolved_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: resolved_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::CancelDayEvent {
            game,
            event_id: cancelled_id,
            reason: "rain delay".to_string(),
        },
    )
    .await
    .unwrap();
    let terminal_inputs = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 101)
        .await
        .unwrap();
    assert_eq!(terminal_inputs.appended_events, 4);

    handle(
        &pool,
        &user("host_h"),
        Command::ResolveDayEvent {
            game,
            event_id: resolved_id,
            decision: game_platform::DayEventDecision::SelectWinners {
                slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
            },
        },
    )
    .await
    .unwrap();
    let resolved = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 102)
        .await
        .unwrap();
    assert_eq!(resolved.appended_events, 2);

    let notices = projections::thread_view(&pool, game, None, 100)
        .await
        .unwrap()
        .posts;
    assert_eq!(notices.len(), 5);
    assert!(notices.iter().all(|post| post.channel_id == "main"
        && post.author_user.as_deref() == Some("host")
        && post.author_slot.is_none()));
    assert!(notices
        .iter()
        .any(|post| post.body == "Event event-narrative-cancelled cancelled: rain delay."));
    assert!(notices.iter().any(|post| {
        post.body == "Event event-narrative-resolved winners slot_1 received cookie."
    }));

    let narratives = day_event_narratives(&pool, game).await.unwrap();
    assert_eq!(
        narratives
            .iter()
            .filter(|row| row.status == "published")
            .count(),
        5
    );
    assert!(narratives
        .iter()
        .filter(|row| row.status == "published")
        .all(|row| row.source_seq.is_some() && row.published_seq.is_some()));
    let stream = eventstore::load_stream(&pool, game).await.unwrap();
    let published = stream
        .iter()
        .filter(|event| event.kind == "DayEventNarrativePublished")
        .count();
    assert_eq!(published, 5);
    assert!(stream
        .iter()
        .filter(|event| event.kind == "PostSubmitted"
            && event.payload.get("day_event_narrative").is_some())
        .all(|event| {
            event.actor == ActorId::Host
                && event.meta["principal_user_id"] == "service:day-event-narrative"
                && event.meta["authority_used"] == format!("DayEventNarrative({game})")
        }));

    let caught_up = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 103)
        .await
        .unwrap();
    assert_eq!(caught_up.claimed_games, 0);
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn private_day_event_channel_is_sealed_participation_scoped_and_replacement_safe(
    pool: PgPool,
) {
    let host = "host_h";
    let outgoing = "user_a";
    let incoming = "user_b";
    let slot = "slot_1";
    let game = setup_game(&pool, host, slot, outgoing).await;
    let event_id = game_platform::DayEventId::new("event-private-showcase").unwrap();
    let channel_id = game_platform::EventChannelPolicy::Private {
        membership: game_platform::EventChannelMembership::Participants,
    }
    .channel_id(&event_id)
    .as_str()
    .to_string();
    let mut program = narrative_day_program("program-private-showcase", &[event_id.as_str()]);
    program.events[0].channel_policy = game_platform::EventChannelPolicy::Private {
        membership: game_platform::EventChannelMembership::Participants,
    };
    handle(
        &pool,
        &user(host),
        Command::AttachDayProgram { game, program },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user(host),
        Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();

    let sealed_work: (
        Option<String>,
        serde_json::Value,
        Option<String>,
        serde_json::Value,
    ) = sqlx::query_as(
        "SELECT body_template, body_template_private, rendered_body, rendered_body_private \
             FROM day_event_narrative \
             WHERE game_id = $1 AND event_id = $2 AND lifecycle = 'opened'",
    )
    .bind(game)
    .bind(event_id.as_str())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(sealed_work.0.is_none());
    assert!(sealed_work.1["ciphertext"].is_string());
    assert!(sealed_work.2.is_none());
    assert!(sealed_work.3["ciphertext"].is_string());
    assert!(!caps::resolve(&pool, &user(outgoing), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(channel_id.clone())));

    handle(
        &pool,
        &user(outgoing),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: slot.into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    assert!(caps::resolve(&pool, &user(outgoing), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(channel_id.clone())));
    handle(
        &pool,
        &user(outgoing),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: slot.into(),
            body: "participant-only draft".into(),
            media: Vec::new(),
            quotations: Vec::new(),
        },
    )
    .await
    .unwrap();
    run_day_event_scheduler_once(
        &pool,
        &DayEventSchedulerConfig::default(),
        Uuid::new_v4(),
        100,
    )
    .await
    .unwrap();

    let stored_private_posts: Vec<(Option<String>, serde_json::Value)> = sqlx::query_as(
        "SELECT body, body_private FROM thread_view \
         WHERE game_id = $1 AND channel_id = $2 ORDER BY source_seq",
    )
    .bind(game)
    .bind(&channel_id)
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(stored_private_posts.len(), 2);
    assert!(stored_private_posts
        .iter()
        .all(|(body, private)| body.is_none() && private["ciphertext"].is_string()));

    handle(
        &pool,
        &user(outgoing),
        Command::WithdrawDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: slot.into(),
        },
    )
    .await
    .unwrap();
    assert!(!caps::resolve(&pool, &user(outgoing), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(channel_id.clone())));
    handle(
        &pool,
        &user(outgoing),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: slot.into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user(host),
        Command::ProcessReplacement {
            game,
            slot: slot.into(),
            outgoing_persona_id: current_slot_persona_id(&pool, game, slot).await,
            incoming_principal_user_id: incoming.into(),
        },
    )
    .await
    .unwrap();
    assert!(!caps::resolve(&pool, &user(outgoing), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(channel_id.clone())));
    assert!(caps::resolve(&pool, &user(incoming), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(channel_id.clone())));

    handle(
        &pool,
        &user(host),
        Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    let closed_post = handle(
        &pool,
        &user(incoming),
        Command::SubmitPost {
            game,
            channel_id: channel_id.clone(),
            actor_slot: slot.into(),
            body: "late private post".into(),
            media: Vec::new(),
            quotations: Vec::new(),
        },
    )
    .await
    .unwrap_err();
    assert_eq!(closed_post, Reject::NotAuthorized);
    assert_eq!(
        projections::thread_view_for_channel(&pool, game, &channel_id, None, 10)
            .await
            .unwrap()
            .posts
            .iter()
            .map(|post| post.body.as_str())
            .collect::<Vec<_>>(),
        vec![
            "participant-only draft",
            "Event event-private-showcase opened."
        ]
    );

    let eligible_event_id = game_platform::DayEventId::new("event-private-eligible-slots").unwrap();
    let eligible_channel_id = game_platform::EventChannelPolicy::Private {
        membership: game_platform::EventChannelMembership::EligibleSlots,
    }
    .channel_id(&eligible_event_id)
    .as_str()
    .to_string();
    let mut eligible_event = minimal_day_event(eligible_event_id.as_str(), "bomb");
    eligible_event.channel_policy = game_platform::EventChannelPolicy::Private {
        membership: game_platform::EventChannelMembership::EligibleSlots,
    };
    handle(
        &pool,
        &user(host),
        Command::ScheduleDayEvent {
            game,
            event: eligible_event,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user(host),
        Command::OpenDayEvent {
            game,
            event_id: eligible_event_id,
        },
    )
    .await
    .unwrap();
    assert!(!caps::resolve(&pool, &user(outgoing), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(
            eligible_channel_id.clone()
        )));
    assert!(caps::resolve(&pool, &user(incoming), game)
        .await
        .unwrap()
        .grants(&caps::Capability::ChannelMember(eligible_channel_id)));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn narrative_publish_failure_never_rolls_back_scheduled_mechanics(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let mut program = narrative_day_program("program-narrative-failure", &["event-narrative-fail"]);
    program.events[0].schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: None,
    };
    handle(
        &pool,
        &user("host_h"),
        Command::AttachDayProgram { game, program },
    )
    .await
    .unwrap();
    sqlx::query(
        "CREATE FUNCTION fail_day_event_narrative_post() RETURNS trigger LANGUAGE plpgsql AS $$ \
         BEGIN \
           IF NEW.kind = 'PostSubmitted' AND NEW.payload ? 'day_event_narrative' THEN \
             RAISE EXCEPTION 'injected narrative delivery failure'; \
           END IF; \
           RETURN NEW; \
         END $$",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "CREATE TRIGGER fail_day_event_narrative_post \
         BEFORE INSERT ON events FOR EACH ROW EXECUTE FUNCTION fail_day_event_narrative_post()",
    )
    .execute(&pool)
    .await
    .unwrap();

    let config = DayEventSchedulerConfig::default();
    let failed = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100)
        .await
        .unwrap();
    assert_eq!(failed.failed_games, 1);
    assert_eq!(
        day_events(&pool, game).await.unwrap().remove(0).state,
        "open",
        "schedule mechanics committed in the transaction before notice delivery"
    );
    assert_eq!(
        day_event_narratives(&pool, game)
            .await
            .unwrap()
            .into_iter()
            .find(|row| row.lifecycle == game_platform::NarrativeLifecycle::Opened)
            .unwrap()
            .status,
        "pending"
    );

    sqlx::query("DROP TRIGGER fail_day_event_narrative_post ON events")
        .execute(&pool)
        .await
        .unwrap();
    let retry_at = day_event_scheduler_status(&pool, game, 100)
        .await
        .unwrap()
        .unwrap()
        .retry_not_before
        .unwrap();
    let retried = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), retry_at)
        .await
        .unwrap();
    assert_eq!(retried.succeeded_games, 1);
    assert_eq!(retried.appended_events, 2);
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn automatic_day_event_records_lock_seed_and_resolves_atomically_as_system(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-auto-raffle").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "bomb");
    event.resolution = game_platform::DayEventResolutionMode::Auto {
        policy: game_platform::AutoResolvePolicy::SeededRandom { winners: 1 },
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();

    let locked = day_events(&pool, game).await.unwrap().remove(0);
    let recorded_seed = locked
        .auto_seed
        .expect("seeded policy captures its seed in the lock fact");
    assert!(matches!(
        handle(
            &pool,
            &user("host_h"),
            Command::ResolveDayEvent {
                game,
                event_id: event_id.clone(),
                decision: game_platform::DayEventDecision::SelectWinners {
                    slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
                },
            },
        )
        .await
        .expect_err("host cannot redraw an automatic event"),
        Reject::DayEventValidation(message) if message.contains("cannot be host-resolved")
    ));

    let report = run_day_event_scheduler_once(
        &pool,
        &DayEventSchedulerConfig::default(),
        Uuid::new_v4(),
        500,
    )
    .await
    .unwrap();
    assert_eq!(report.claimed_games, 1);
    assert_eq!(report.succeeded_games, 1);
    assert_eq!(report.appended_events, 2);

    let resolved = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(resolved.state, "resolved");
    assert_eq!(resolved.auto_seed, Some(recorded_seed));
    assert_eq!(resolved.winner_slots, ["slot_1"]);
    assert_eq!(
        resolved.resolution_evidence,
        Some(game_platform::DayEventResolutionEvidence::Auto {
            policy: game_platform::AutoResolvePolicy::SeededRandom { winners: 1 },
            seed: Some(recorded_seed),
            participant_slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
        })
    );
    let resolution = eventstore::load_stream(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "DayEventResolved")
        .expect("automatic resolution fact");
    assert_eq!(resolution.actor, eventstore::ActorId::System);
    assert_eq!(
        resolution.meta["principal_user_id"],
        "service:day-event-automation"
    );
    assert_eq!(
        resolution.meta["authority_used"],
        format!("DayEventAutomation({game})")
    );
    assert_eq!(resolution.meta["resolution_source"], "automatic policy");
    assert!(slot_effects(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|effect| effect.slot_id == "slot_1" && effect.effect == "bomb"));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn scheduled_auto_resolution_catches_up_in_seeded_durable_steps(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-auto-scheduled").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "bomb");
    event.schedule = game_platform::DayEventSchedule::Absolute {
        open_at: game_platform::UnixSeconds::new(100),
        lock_at: Some(game_platform::UnixSeconds::new(200)),
    };
    event.resolution = game_platform::DayEventResolutionMode::Auto {
        policy: game_platform::AutoResolvePolicy::SeededRandom { winners: 1 },
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();
    let config = DayEventSchedulerConfig::default();
    let opened = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 100)
        .await
        .unwrap();
    assert_eq!(opened.appended_events, 2);
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();

    let locked = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 225)
        .await
        .unwrap();
    assert_eq!(locked.appended_events, 2);
    let locked_row = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(locked_row.state, "locked");
    let seed = locked_row.auto_seed.expect("schedule lock captures seed");
    let pending = day_event_scheduler_status(&pool, game, 225)
        .await
        .unwrap()
        .unwrap();
    assert!(pending.auto_resolve_pending);
    assert!(pending.pending);

    let resolved = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 226)
        .await
        .unwrap();
    assert_eq!(resolved.appended_events, 2);
    let resolved_row = day_events(&pool, game).await.unwrap().remove(0);
    assert_eq!(resolved_row.state, "resolved");
    assert_eq!(resolved_row.auto_seed, Some(seed));
    assert!(matches!(
        resolved_row.resolution_evidence,
        Some(game_platform::DayEventResolutionEvidence::Auto {
            seed: Some(evidence_seed),
            ..
        }) if evidence_seed == seed
    ));
    let caught_up = day_event_scheduler_status(&pool, game, 226)
        .await
        .unwrap()
        .unwrap();
    assert!(!caught_up.auto_resolve_pending);
    assert!(!caught_up.pending);
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn auto_resolution_claim_is_replica_safe_and_manual_cancel_wins_before_claim(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-auto-race").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "bomb");
    event.resolution = game_platform::DayEventResolutionMode::Auto {
        policy: game_platform::AutoResolvePolicy::FirstN { winners: 1 },
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent { game, event },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();

    let config = DayEventSchedulerConfig {
        batch_size: 1,
        ..DayEventSchedulerConfig::default()
    };
    let (left, right) = tokio::join!(
        run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 600),
        run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 600),
    );
    assert_eq!(
        [left.unwrap(), right.unwrap()]
            .iter()
            .map(|report| report.claimed_games)
            .sum::<usize>(),
        1
    );
    let resolutions: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'DayEventResolved'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(resolutions, 1);

    let cancelled_id = game_platform::DayEventId::new("event-auto-cancel").unwrap();
    let mut cancelled = minimal_day_event(cancelled_id.as_str(), "bomb");
    cancelled.resolution = game_platform::DayEventResolutionMode::Auto {
        policy: game_platform::AutoResolvePolicy::FirstN { winners: 1 },
    };
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent {
            game,
            event: cancelled,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayEvent {
            game,
            event_id: cancelled_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: cancelled_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: cancelled_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::CancelDayEvent {
            game,
            event_id: cancelled_id.clone(),
            reason: "host chose fiat instead".into(),
        },
    )
    .await
    .unwrap();
    let after_cancel = run_day_event_scheduler_once(&pool, &config, Uuid::new_v4(), 601)
        .await
        .unwrap();
    assert_eq!(after_cancel.claimed_games, 1);
    assert_eq!(after_cancel.appended_events, 0);
    let cancelled = day_events(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == cancelled_id.as_str())
        .unwrap();
    assert_eq!(cancelled.state, "cancelled");
    assert!(cancelled.resolution_evidence.is_none());
    let resolutions_after_cancel: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM events WHERE stream_id = $1 AND kind = 'DayEventResolved'",
    )
    .bind(game)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(resolutions_after_cancel, 1);
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn day_event_vertical_is_typed_atomic_rebuildable_and_engine_visible(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-cookie").unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent {
            game,
            event: minimal_day_event(event_id.as_str(), "bomb"),
        },
    )
    .await
    .expect("schedule inline event");
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .expect("host opens event");
    assert_eq!(day_events(&pool, game).await.unwrap()[0].state, "open");

    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .expect("eligible occupant opts in");
    assert_eq!(
        handle(
            &pool,
            &user("user_a"),
            Command::SubmitDayEventParticipation {
                game,
                event_id: event_id.clone(),
                actor_slot: "slot_1".into(),
                payload: game_platform::ParticipationPayload::OptIn,
            },
        )
        .await
        .expect_err("duplicate participation rejects"),
        Reject::DuplicateParticipation
    );
    handle(
        &pool,
        &user("user_a"),
        Command::WithdrawDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
        },
    )
    .await
    .expect("open participation can be withdrawn");
    assert!(day_event_participation(&pool, game, event_id.as_str())
        .await
        .unwrap()
        .is_empty());
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .expect("slot opts in again");
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .expect("host locks event");
    assert_eq!(day_events(&pool, game).await.unwrap()[0].state, "locked");
    assert!(matches!(
        handle(
            &pool,
            &user("user_a"),
            Command::WithdrawDayEventParticipation {
                game,
                event_id: event_id.clone(),
                actor_slot: "slot_1".into(),
            },
        )
        .await
        .expect_err("locked participation is immutable"),
        Reject::DayEventStateConflict(_)
    ));

    let resolution_command_id = Uuid::new_v4();
    let ack = handle_idempotent(
        &pool,
        &user("host_h"),
        resolution_command_id,
        Command::ResolveDayEvent {
            game,
            event_id: event_id.clone(),
            decision: game_platform::DayEventDecision::SelectWinners {
                slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
            },
        },
    )
    .await
    .expect("host resolves with reward effects");
    assert_eq!(ack.stream_seqs.len(), 2);
    let stream = eventstore::load_stream(&pool, game).await.unwrap();
    let resolved_batch = stream
        .iter()
        .filter(|event| ack.stream_seqs.contains(&event.stream_seq))
        .collect::<Vec<_>>();
    assert_eq!(resolved_batch[0].kind, "EffectsMarked");
    assert_eq!(resolved_batch[0].meta["source"], "day_event");
    assert_eq!(resolved_batch[0].meta["day_event_id"], "event-cookie");
    assert_eq!(resolved_batch[0].meta["reward_key"], "cookie");
    assert_eq!(
        resolved_batch[0].payload["source_action"],
        "day_event:event-cookie:cookie:mark"
    );
    assert_eq!(resolved_batch[1].kind, "DayEventResolved");
    assert_eq!(resolved_batch[1].actor, ActorId::Host);
    assert_eq!(resolved_batch[1].causation_id, Some(resolution_command_id));
    assert_eq!(resolved_batch[1].meta["source"], "day_event");
    assert_eq!(resolved_batch[1].meta["day_event_id"], "event-cookie");
    assert_eq!(
        resolved_batch[1].meta["command_id"],
        resolution_command_id.to_string()
    );
    assert_eq!(resolved_batch[1].meta["principal_user_id"], "host_h");
    assert_eq!(
        resolved_batch[1].meta["authority_used"],
        format!("HostOf({game})")
    );
    assert_eq!(resolved_batch[1].meta["resolution_source"], "host decision");
    let projected = day_events(&pool, game).await.unwrap();
    assert_eq!(projected[0].state, "resolved");
    assert_eq!(projected[0].winner_slots, ["slot_1"]);
    assert_eq!(projected[0].reward_keys_applied, ["cookie"]);
    assert_eq!(
        projected[0].resolution_evidence,
        Some(game_platform::DayEventResolutionEvidence::HostDecision {
            participant_slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
        })
    );
    assert!(slot_effects(&pool, game)
        .await
        .unwrap()
        .iter()
        .any(|effect| effect.slot_id == "slot_1" && effect.effect == "bomb"));
    assert!(load_engine_snapshot(&pool, game, "D01")
        .await
        .unwrap()
        .slots
        .iter()
        .find(|slot| slot.slot_id == "slot_1")
        .unwrap()
        .effects
        .iter()
        .any(|effect| effect == "bomb"));
    assert!(matches!(
        handle(
            &pool,
            &user("host_h"),
            Command::ResolveDayEvent {
                game,
                event_id: event_id.clone(),
                decision: game_platform::DayEventDecision::SelectWinners {
                    slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
                },
            },
        )
        .await
        .expect_err("resolved event cannot resolve twice"),
        Reject::DayEventStateConflict(_)
    ));

    let cancelled_id = game_platform::DayEventId::new("event-cancelled").unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent {
            game,
            event: minimal_day_event(cancelled_id.as_str(), "bomb"),
        },
    )
    .await
    .expect("schedule event that will be cancelled");
    handle(
        &pool,
        &user("host_h"),
        Command::CancelDayEvent {
            game,
            event_id: cancelled_id.clone(),
            reason: "host withdrew the event".into(),
        },
    )
    .await
    .expect("host cancels a nonterminal event");
    let cancelled = day_events(&pool, game)
        .await
        .unwrap()
        .into_iter()
        .find(|event| event.event_id == cancelled_id.as_str())
        .expect("cancelled event remains inspectable");
    assert_eq!(cancelled.state, "cancelled");
    assert_eq!(
        cancelled.cancelled_reason.as_deref(),
        Some("host withdrew the event")
    );
    assert!(matches!(
        handle(
            &pool,
            &user("host_h"),
            Command::OpenDayEvent {
                game,
                event_id: cancelled_id,
            },
        )
        .await
        .expect_err("cancelled event cannot be reopened"),
        Reject::DayEventStateConflict(_)
    ));
    assert!(audit_rebuild(&pool, game).await.unwrap().ok);
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn day_event_reward_adapters_fail_before_scheduling(pool: PgPool) {
    let game = setup_game(&pool, "host_h", "slot_1", "user_a").await;
    let event_id = game_platform::DayEventId::new("event-invalid-reward").unwrap();
    let mut event = minimal_day_event(event_id.as_str(), "not_declared_by_pack");
    event.rewards[0].reward_key = game_platform::RewardKey::new("bad-cookie").unwrap();
    let mut valid = minimal_day_event("source", "bomb");
    event.rewards.insert(0, valid.rewards.remove(0));
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(matches!(
        handle(
            &pool,
            &user("host_h"),
            Command::ScheduleDayEvent { game, event },
        )
        .await
        .expect_err("an unmaterializable reward adapter rejects the definition"),
        Reject::DayEventValidation(_)
    ));
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = $1")
        .bind(game)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(after, before);
    assert!(day_events(&pool, game).await.unwrap().is_empty());
    assert!(slot_effects(&pool, game).await.unwrap().is_empty());
}

#[sqlx::test(migrations = "../projections/migrations")]
async fn day_event_ops_and_resolution_honor_independent_cohost_denials(pool: PgPool) {
    let game = setup_game_with_pack_and_denied(
        &pool,
        "host_h",
        "slot_1",
        "user_a",
        "mafiascum",
        vec![
            CohostPermissionClass::DayEventOps,
            CohostPermissionClass::DayEventResolve,
            CohostPermissionClass::ProgramAttach,
        ],
    )
    .await;
    handle(
        &pool,
        &user("host_h"),
        Command::AddCohost {
            game,
            user: "user_c".into(),
        },
    )
    .await
    .unwrap();
    let event_id = game_platform::DayEventId::new("event-cohost-policy").unwrap();
    assert_eq!(
        handle(
            &pool,
            &user("user_c"),
            Command::AttachDayProgram {
                game,
                program: minimal_day_program("program-cohost-policy", 1, &["event-program-policy"]),
            },
        )
        .await
        .expect_err("cohost program-attach denylist blocks compilation"),
        Reject::CohostPermissionDenied("program_attach".to_string())
    );
    assert_eq!(
        handle(
            &pool,
            &user("user_c"),
            Command::ScheduleDayEvent {
                game,
                event: minimal_day_event(event_id.as_str(), "bomb"),
            },
        )
        .await
        .expect_err("cohost ops denylist blocks definition"),
        Reject::CohostPermissionDenied("day_event_ops".to_string())
    );
    handle(
        &pool,
        &user("host_h"),
        Command::ScheduleDayEvent {
            game,
            event: minimal_day_event(event_id.as_str(), "bomb"),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::OpenDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("user_a"),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: "slot_1".into(),
            payload: game_platform::ParticipationPayload::OptIn,
        },
    )
    .await
    .unwrap();
    handle(
        &pool,
        &user("host_h"),
        Command::LockDayEvent {
            game,
            event_id: event_id.clone(),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        handle(
            &pool,
            &user("user_c"),
            Command::ResolveDayEvent {
                game,
                event_id,
                decision: game_platform::DayEventDecision::SelectWinners {
                    slots: vec![game_platform::SlotId::new("slot_1").unwrap()],
                },
            },
        )
        .await
        .expect_err("cohost resolve denylist blocks rewards"),
        Reject::CohostPermissionDenied("day_event_resolve".to_string())
    );
    assert_eq!(day_events(&pool, game).await.unwrap()[0].state, "locked");
    assert!(slot_effects(&pool, game).await.unwrap().is_empty());
}
