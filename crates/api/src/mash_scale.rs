//! Deterministic local acceptance proof for the 30+ seat mash frontier.
//!
//! This is deliberately built over production command, scheduler, projection,
//! rebuild, and host-console seams. The only synthetic part is the fixed
//! fixture document and its explicit local regression budgets.

use std::collections::BTreeSet;
use std::time::{Duration, Instant};

use caps::Principal;
use commands::day_scheduler::{
    run_day_event_scheduler_once, DayEventSchedulerConfig, DayEventSchedulerTickReport,
    SchedulerError,
};
use commands::{Command, Reject};
use game_platform::{DayEventId, DayProgramRef, ParticipationPayload};
use projections::{
    audit_rebuild, day_event_narratives, day_event_participation_page, DayEventParticipationCursor,
    ProjectionError, MAX_DAY_EVENT_PARTICIPATION_PAGE_SIZE,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use tokio::task::JoinSet;
use uuid::Uuid;

use crate::program_library::{
    load_checked_in_program_library, ProgramAudience, ProgramLibraryError,
};
use crate::{load_host_console_state_for_principal, load_player_day_event_attention_for_principal};

pub const MASH_SCALE_ARTIFACT_VERSION: u16 = 3;
pub const MASH_SCALE_ROSTER_COUNT: usize = 60;
pub const MASH_SCALE_EVENT_COUNT: usize = 5;
pub const MASH_SCALE_CONCURRENT_SUBMISSIONS: usize = 40;
pub const MASH_SCALE_PARTICIPATION_ROWS: usize = MASH_SCALE_ROSTER_COUNT * MASH_SCALE_EVENT_COUNT;
pub const MASH_SCALE_MAX_ATTENTION_TASKS: usize = 8;
pub const MASH_SCALE_MAX_PAGE_ROWS_EXAMINED: u64 = 202;
pub const MASH_SCALE_MAX_CONCURRENCY_MS: u64 = 20_000;
pub const MASH_SCALE_MAX_SCHEDULER_MS: u64 = 5_000;
pub const MASH_SCALE_MAX_HOST_CONSOLE_MS: u64 = 2_000;
pub const MASH_SCALE_MAX_HOST_CONSOLE_BYTES: usize = 512 * 1024;
pub const MASH_SCALE_MAX_REBUILD_MS: u64 = 5_000;

const HOST: &str = "mash_scale_host";
const OPEN_AT: i64 = 100;
const LOCK_AT: i64 = 200;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleConcurrencyEvidence {
    pub requested: usize,
    pub acknowledged: usize,
    pub retryable_conflicts: usize,
    pub retries: usize,
    pub unexpected_rejections: usize,
    pub final_participation_rows: usize,
    pub duplicate_participation_rows: i64,
    pub elapsed_ms: u64,
    pub threshold_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleSchedulerEvidence {
    pub replicas: usize,
    pub open_claimed_games: usize,
    pub lock_claimed_games: usize,
    pub failed_games: usize,
    pub opened_and_locked_events: usize,
    pub narrative_posts: i64,
    pub distinct_narrative_receipts: i64,
    pub published_narratives: usize,
    pub elapsed_ms: u64,
    pub threshold_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleParticipationPageEvidence {
    pub page_limit: u32,
    pub rows_returned: usize,
    pub next_cursor: Option<DayEventParticipationCursor>,
    pub cursor_page_size: u32,
    pub cursor_round_trip_rows: usize,
    pub cursor_distinct_rows: usize,
    pub rows_examined: u64,
    pub maximum_rows_examined: u64,
    pub keyset_index_used: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleAttentionEvidence {
    pub open_events_visible_to_player: usize,
    pub open_events_player_can_act_on: usize,
    pub attention_items: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleHostConsoleEvidence {
    pub slot_count: usize,
    pub day_event_count: usize,
    pub participant_references: usize,
    pub attention_task_count: usize,
    pub maximum_attention_tasks: usize,
    pub serialized_bytes: usize,
    pub maximum_serialized_bytes: usize,
    pub elapsed_ms: u64,
    pub threshold_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScalePrivateChannelEvidence {
    pub private_event_count: usize,
    pub member_rows: i64,
    pub narrative_rows: i64,
    pub narrative_plaintext_rows: i64,
    pub thread_posts: i64,
    pub thread_plaintext_rows: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleRebuildEvidence {
    pub ok: bool,
    pub diff_count: usize,
    pub participation_rows_after_rebuild: i64,
    pub published_narratives_after_rebuild: usize,
    pub private_channel_members_after_rebuild: i64,
    pub elapsed_ms: u64,
    pub threshold_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MashScaleAcceptanceReport {
    pub artifact_version: u16,
    pub artifact_path: String,
    pub ok: bool,
    pub proof_boundary: String,
    pub program_ref: DayProgramRef,
    pub game_id: Uuid,
    pub roster_count: usize,
    pub event_count: usize,
    pub total_participation_rows: usize,
    pub concurrency: MashScaleConcurrencyEvidence,
    pub scheduler: MashScaleSchedulerEvidence,
    pub participation_page: MashScaleParticipationPageEvidence,
    pub player_attention: MashScaleAttentionEvidence,
    pub host_console: MashScaleHostConsoleEvidence,
    pub private_channel: MashScalePrivateChannelEvidence,
    pub rebuild: MashScaleRebuildEvidence,
}

#[derive(Debug, thiserror::Error)]
pub enum MashScaleError {
    #[error("scale fixture command rejected: {0}")]
    Command(#[from] Reject),
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Projection(#[from] ProjectionError),
    #[error(transparent)]
    Scheduler(#[from] SchedulerError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    ProgramLibrary(#[from] ProgramLibraryError),
    #[error("host-console scale read failed: {0}")]
    HostConsole(String),
    #[error("player-attention scale read failed: {0}")]
    PlayerAttention(String),
    #[error("concurrent participation task failed: {0}")]
    Join(String),
    #[error("scale fixture private-channel contract failed: {0}")]
    PrivateChannelFixture(String),
}

pub async fn run_mash_scale_acceptance(
    pool: &PgPool,
    artifact_path: impl Into<String>,
) -> Result<MashScaleAcceptanceReport, MashScaleError> {
    let game =
        Uuid::parse_str("6d617368-7363-416c-8000-000000000013").expect("checked mash-scale UUID");
    seed_game(pool, game).await?;

    let library = load_checked_in_program_library()?;
    let artifact =
        library.resolve_identity("mash-scale-acceptance", 1, ProgramAudience::Acceptance)?;
    let program_ref = artifact.program_ref.clone();
    let program = artifact.document.clone();
    commands::handle(
        pool,
        &Principal::user(HOST),
        Command::AttachDayProgram {
            game,
            program: program.clone(),
        },
    )
    .await?;

    let open_scheduler_started = Instant::now();
    let open_reports = race_scheduler_replicas(pool, OPEN_AT).await?;
    let open_scheduler_elapsed = open_scheduler_started.elapsed();
    let open_events = projections::day_events(pool, game).await?;
    let player_attention_items =
        load_player_day_event_attention_for_principal(pool, game, &user_id(1), Some(&slot_id(1)))
            .await
            .map_err(|error| MashScaleError::PlayerAttention(format!("{error:?}")))?;
    let player_attention = MashScaleAttentionEvidence {
        open_events_visible_to_player: open_events.len(),
        open_events_player_can_act_on: player_attention_items
            .iter()
            .filter(|event| event.can_submit || event.can_withdraw)
            .count(),
        attention_items: player_attention_items.len(),
    };

    let primary_event = program.events[0].id.clone();
    let concurrency_started = Instant::now();
    let concurrency = submit_concurrent_participation(pool, game, primary_event.clone()).await?;
    let concurrency_elapsed_ms = elapsed_ms(concurrency_started.elapsed());

    for event in &program.events {
        let start_slot = if event.id == primary_event {
            MASH_SCALE_CONCURRENT_SUBMISSIONS + 1
        } else {
            1
        };
        for slot_number in start_slot..=MASH_SCALE_ROSTER_COUNT {
            submit_participation(pool, game, &event.id, slot_number).await?;
        }
    }

    let page = day_event_participation_page(
        pool,
        game,
        primary_event.as_str(),
        None,
        MAX_DAY_EVENT_PARTICIPATION_PAGE_SIZE,
    )
    .await?;
    let cursor_page_size = 25;
    let first_cursor_page =
        day_event_participation_page(pool, game, primary_event.as_str(), None, cursor_page_size)
            .await?;
    let second_cursor_page = day_event_participation_page(
        pool,
        game,
        primary_event.as_str(),
        first_cursor_page.next_cursor.as_ref(),
        cursor_page_size,
    )
    .await?;
    let cursor_round_trip_rows = first_cursor_page.rows.len() + second_cursor_page.rows.len();
    let cursor_distinct_rows = first_cursor_page
        .rows
        .iter()
        .chain(&second_cursor_page.rows)
        .map(|row| row.actor_slot.as_str())
        .collect::<BTreeSet<_>>()
        .len();
    let (rows_examined, keyset_index_used) =
        participation_page_plan(pool, game, primary_event.as_str()).await?;
    let participation_page = MashScaleParticipationPageEvidence {
        page_limit: MAX_DAY_EVENT_PARTICIPATION_PAGE_SIZE,
        rows_returned: page.rows.len(),
        next_cursor: page.next_cursor,
        cursor_page_size,
        cursor_round_trip_rows,
        cursor_distinct_rows,
        rows_examined,
        maximum_rows_examined: MASH_SCALE_MAX_PAGE_ROWS_EXAMINED,
        keyset_index_used,
    };

    let lock_scheduler_started = Instant::now();
    let lock_reports = race_scheduler_replicas(pool, LOCK_AT).await?;
    let scheduler_elapsed_ms =
        elapsed_ms(open_scheduler_elapsed.saturating_add(lock_scheduler_started.elapsed()));
    let narratives = day_event_narratives(pool, game).await?;
    let published_narratives = narratives
        .iter()
        .filter(|row| row.status == "published")
        .count();
    let narrative_counts = sqlx::query(
        "SELECT count(*)::bigint AS posts, \
                count(DISTINCT payload->'day_event_narrative'->>'receipt_id')::bigint AS receipts \
         FROM events \
         WHERE stream_id = $1 AND kind = 'PostSubmitted' \
           AND payload ? 'day_event_narrative'",
    )
    .bind(game)
    .fetch_one(pool)
    .await?;
    let scheduler = MashScaleSchedulerEvidence {
        replicas: 2,
        open_claimed_games: claimed_games(&open_reports),
        lock_claimed_games: claimed_games(&lock_reports),
        failed_games: failed_games(&open_reports) + failed_games(&lock_reports),
        opened_and_locked_events: projections::day_events(pool, game)
            .await?
            .iter()
            .filter(|event| event.state == "locked")
            .count(),
        narrative_posts: narrative_counts.get("posts"),
        distinct_narrative_receipts: narrative_counts.get("receipts"),
        published_narratives,
        elapsed_ms: scheduler_elapsed_ms,
        threshold_ms: MASH_SCALE_MAX_SCHEDULER_MS,
    };

    let host_console_started = Instant::now();
    let host_console_state = load_host_console_state_for_principal(pool, game, HOST, Some(25))
        .await
        .map_err(|error| MashScaleError::HostConsole(format!("{error:?}")))?;
    let host_console_elapsed_ms = elapsed_ms(host_console_started.elapsed());
    let host_console_bytes = serde_json::to_vec(&host_console_state)?.len();
    let host_console = MashScaleHostConsoleEvidence {
        slot_count: host_console_state.slots.len(),
        day_event_count: host_console_state.day_events.len(),
        participant_references: host_console_state
            .day_events
            .iter()
            .map(|event| event.participant_slots.len())
            .sum(),
        attention_task_count: host_console_state.tasks.len(),
        maximum_attention_tasks: MASH_SCALE_MAX_ATTENTION_TASKS,
        serialized_bytes: host_console_bytes,
        maximum_serialized_bytes: MASH_SCALE_MAX_HOST_CONSOLE_BYTES,
        elapsed_ms: host_console_elapsed_ms,
        threshold_ms: MASH_SCALE_MAX_HOST_CONSOLE_MS,
    };
    let private_events = program
        .events
        .iter()
        .filter(|event| {
            matches!(
                event.channel_policy,
                game_platform::EventChannelPolicy::Private { .. }
            )
        })
        .collect::<Vec<_>>();
    let private_event = private_events.first().ok_or_else(|| {
        MashScaleError::PrivateChannelFixture(
            "acceptance program must contain a private DayEvent".to_string(),
        )
    })?;
    let private_channel_id = private_event
        .channel_policy
        .channel_id(&private_event.id)
        .to_string();
    let private_channel = MashScalePrivateChannelEvidence {
        private_event_count: private_events.len(),
        member_rows: sqlx::query_scalar(
            "SELECT count(*) FROM private_channel_member \
             WHERE game_id = $1 AND channel_id = $2",
        )
        .bind(game)
        .bind(&private_channel_id)
        .fetch_one(pool)
        .await?,
        narrative_rows: sqlx::query_scalar(
            "SELECT count(*) FROM day_event_narrative \
             WHERE game_id = $1 AND channel_id = $2",
        )
        .bind(game)
        .bind(&private_channel_id)
        .fetch_one(pool)
        .await?,
        narrative_plaintext_rows: sqlx::query_scalar(
            "SELECT count(*) FROM day_event_narrative \
             WHERE game_id = $1 AND channel_id = $2 \
               AND (body_template IS NOT NULL OR rendered_body IS NOT NULL)",
        )
        .bind(game)
        .bind(&private_channel_id)
        .fetch_one(pool)
        .await?,
        thread_posts: sqlx::query_scalar(
            "SELECT count(*) FROM thread_view WHERE game_id = $1 AND channel_id = $2",
        )
        .bind(game)
        .bind(&private_channel_id)
        .fetch_one(pool)
        .await?,
        thread_plaintext_rows: sqlx::query_scalar(
            "SELECT count(*) FROM thread_view \
             WHERE game_id = $1 AND channel_id = $2 AND body IS NOT NULL",
        )
        .bind(game)
        .bind(&private_channel_id)
        .fetch_one(pool)
        .await?,
    };

    let rebuild_started = Instant::now();
    let rebuild_report = audit_rebuild(pool, game).await?;
    let rebuild_elapsed_ms = elapsed_ms(rebuild_started.elapsed());
    let participation_rows_after_rebuild: i64 =
        sqlx::query_scalar("SELECT count(*) FROM day_event_participation WHERE game_id = $1")
            .bind(game)
            .fetch_one(pool)
            .await?;
    let published_narratives_after_rebuild = day_event_narratives(pool, game)
        .await?
        .iter()
        .filter(|row| row.status == "published")
        .count();
    let private_channel_members_after_rebuild: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM private_channel_member \
         WHERE game_id = $1 AND channel_id = $2",
    )
    .bind(game)
    .bind(&private_channel_id)
    .fetch_one(pool)
    .await?;
    let rebuild = MashScaleRebuildEvidence {
        ok: rebuild_report.ok,
        diff_count: rebuild_report
            .tables
            .iter()
            .filter(|table| !table.matches)
            .count(),
        participation_rows_after_rebuild,
        published_narratives_after_rebuild,
        private_channel_members_after_rebuild,
        elapsed_ms: rebuild_elapsed_ms,
        threshold_ms: MASH_SCALE_MAX_REBUILD_MS,
    };

    let concurrency = MashScaleConcurrencyEvidence {
        elapsed_ms: concurrency_elapsed_ms,
        threshold_ms: MASH_SCALE_MAX_CONCURRENCY_MS,
        ..concurrency
    };
    let expected_narratives = MASH_SCALE_EVENT_COUNT * 2;
    let ok = concurrency.requested == MASH_SCALE_CONCURRENT_SUBMISSIONS
        && concurrency.acknowledged == MASH_SCALE_CONCURRENT_SUBMISSIONS
        && concurrency.unexpected_rejections == 0
        && concurrency.final_participation_rows == MASH_SCALE_CONCURRENT_SUBMISSIONS
        && concurrency.duplicate_participation_rows == 0
        && concurrency.elapsed_ms <= concurrency.threshold_ms
        && scheduler.open_claimed_games == 1
        && scheduler.lock_claimed_games == 1
        && scheduler.failed_games == 0
        && scheduler.opened_and_locked_events == MASH_SCALE_EVENT_COUNT
        && scheduler.narrative_posts == expected_narratives as i64
        && scheduler.distinct_narrative_receipts == expected_narratives as i64
        && scheduler.published_narratives == expected_narratives
        && scheduler.elapsed_ms <= scheduler.threshold_ms
        && participation_page.rows_returned == MASH_SCALE_ROSTER_COUNT
        && participation_page.next_cursor.is_none()
        && participation_page.cursor_round_trip_rows == 50
        && participation_page.cursor_distinct_rows == 50
        && participation_page.rows_examined <= participation_page.maximum_rows_examined
        && participation_page.keyset_index_used
        && player_attention.open_events_visible_to_player == MASH_SCALE_EVENT_COUNT
        && player_attention.open_events_player_can_act_on == MASH_SCALE_EVENT_COUNT
        && player_attention.attention_items == player_attention.open_events_player_can_act_on
        && host_console.slot_count == MASH_SCALE_ROSTER_COUNT
        && host_console.day_event_count == MASH_SCALE_EVENT_COUNT
        && host_console.participant_references == MASH_SCALE_PARTICIPATION_ROWS
        && host_console.attention_task_count <= host_console.maximum_attention_tasks
        && host_console.serialized_bytes <= host_console.maximum_serialized_bytes
        && host_console.elapsed_ms <= host_console.threshold_ms
        && private_channel.private_event_count == 1
        && private_channel.member_rows == MASH_SCALE_ROSTER_COUNT as i64
        && private_channel.narrative_rows == 2
        && private_channel.narrative_plaintext_rows == 0
        && private_channel.thread_posts == 2
        && private_channel.thread_plaintext_rows == 0
        && rebuild.ok
        && rebuild.diff_count == 0
        && rebuild.participation_rows_after_rebuild == MASH_SCALE_PARTICIPATION_ROWS as i64
        && rebuild.published_narratives_after_rebuild == expected_narratives
        && rebuild.private_channel_members_after_rebuild == MASH_SCALE_ROSTER_COUNT as i64
        && rebuild.elapsed_ms <= rebuild.threshold_ms;

    Ok(MashScaleAcceptanceReport {
        artifact_version: MASH_SCALE_ARTIFACT_VERSION,
        artifact_path: artifact_path.into(),
        ok,
        proof_boundary: "Local single-node Postgres acceptance for one deterministic, manifest-pinned 60-seat program artifact with five scheduled host-decision DayEvents, including one participant-scoped private event channel. It proves content-addressed program resolution, bounded keyset reads, 40-way command plus membership contention, two scheduler replicas, mixed public/private narrative receipt uniqueness, ciphertext-only private retry/thread rows, host-console hydration, and projection rebuild under explicit local regression ceilings; it does not prove hosted multi-region latency.".to_string(),
        program_ref,
        game_id: game,
        roster_count: MASH_SCALE_ROSTER_COUNT,
        event_count: MASH_SCALE_EVENT_COUNT,
        total_participation_rows: MASH_SCALE_PARTICIPATION_ROWS,
        concurrency,
        scheduler,
        participation_page,
        player_attention,
        host_console,
        private_channel,
        rebuild,
    })
}

async fn seed_game(pool: &PgPool, game: Uuid) -> Result<(), MashScaleError> {
    commands::handle(
        pool,
        &Principal::user(HOST),
        Command::CreateGame {
            game,
            pack: "mafiascum".to_string(),
            cohost_denied: Vec::new(),
        },
    )
    .await?;
    for slot_number in 1..=MASH_SCALE_ROSTER_COUNT {
        let slot = slot_id(slot_number);
        let user = user_id(slot_number);
        commands::handle(
            pool,
            &Principal::user(HOST),
            Command::AddSlot {
                game,
                slot: slot.clone(),
            },
        )
        .await?;
        commands::handle(
            pool,
            &Principal::user(HOST),
            commands::seat_persona! {
                game,
                slot: slot.clone(),
                user,
            },
        )
        .await?;
        commands::handle(
            pool,
            &Principal::user(HOST),
            Command::AssignRole {
                game,
                slot,
                role_key: "vanilla_townie".to_string(),
            },
        )
        .await?;
    }
    commands::handle(
        pool,
        &Principal::user(HOST),
        Command::StartGame {
            game,
            phase: "D01".to_string(),
        },
    )
    .await?;
    Ok(())
}

async fn submit_concurrent_participation(
    pool: &PgPool,
    game: Uuid,
    event_id: DayEventId,
) -> Result<MashScaleConcurrencyEvidence, MashScaleError> {
    let mut tasks = JoinSet::new();
    for slot_number in 1..=MASH_SCALE_CONCURRENT_SUBMISSIONS {
        let pool = pool.clone();
        let event_id = event_id.clone();
        tasks.spawn(async move {
            let result = submit_participation(&pool, game, &event_id, slot_number).await;
            (slot_number, result)
        });
    }
    let mut acknowledged = 0;
    let mut retryable_conflicts = 0;
    let mut retries = 0;
    let mut unexpected_rejections = 0;
    while let Some(result) = tasks.join_next().await {
        let (slot_number, result) =
            result.map_err(|error| MashScaleError::Join(error.to_string()))?;
        match result {
            Ok(()) => acknowledged += 1,
            Err(MashScaleError::Command(Reject::StreamConflict)) => {
                retryable_conflicts += 1;
                let mut settled = false;
                for _ in 0..3 {
                    retries += 1;
                    match submit_participation(pool, game, &event_id, slot_number).await {
                        Ok(()) => {
                            acknowledged += 1;
                            settled = true;
                            break;
                        }
                        Err(MashScaleError::Command(Reject::StreamConflict)) => continue,
                        Err(_) => {
                            unexpected_rejections += 1;
                            settled = true;
                            break;
                        }
                    }
                }
                if !settled {
                    unexpected_rejections += 1;
                }
            }
            Err(_) => unexpected_rejections += 1,
        }
    }
    let final_participation_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM day_event_participation \
         WHERE game_id = $1 AND event_id = $2",
    )
    .bind(game)
    .bind(event_id.as_str())
    .fetch_one(pool)
    .await?;
    let duplicate_participation_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM ( \
           SELECT actor_slot FROM day_event_participation \
           WHERE game_id = $1 AND event_id = $2 \
           GROUP BY actor_slot HAVING count(*) > 1 \
         ) duplicate_slots",
    )
    .bind(game)
    .bind(event_id.as_str())
    .fetch_one(pool)
    .await?;
    Ok(MashScaleConcurrencyEvidence {
        requested: MASH_SCALE_CONCURRENT_SUBMISSIONS,
        acknowledged,
        retryable_conflicts,
        retries,
        unexpected_rejections,
        final_participation_rows: final_participation_rows as usize,
        duplicate_participation_rows,
        elapsed_ms: 0,
        threshold_ms: 0,
    })
}

async fn submit_participation(
    pool: &PgPool,
    game: Uuid,
    event_id: &DayEventId,
    slot_number: usize,
) -> Result<(), MashScaleError> {
    commands::handle(
        pool,
        &Principal::user(user_id(slot_number)),
        Command::SubmitDayEventParticipation {
            game,
            event_id: event_id.clone(),
            actor_slot: slot_id(slot_number),
            payload: ParticipationPayload::OptIn,
        },
    )
    .await?;
    Ok(())
}

async fn race_scheduler_replicas(
    pool: &PgPool,
    observed_at: i64,
) -> Result<[DayEventSchedulerTickReport; 2], MashScaleError> {
    let config = DayEventSchedulerConfig {
        batch_size: 1,
        ..DayEventSchedulerConfig::default()
    };
    let (left, right) = tokio::join!(
        run_day_event_scheduler_once(
            pool,
            &config,
            Uuid::parse_str("6d617368-7363-416c-8000-000000000101")
                .expect("checked scheduler UUID"),
            observed_at,
        ),
        run_day_event_scheduler_once(
            pool,
            &config,
            Uuid::parse_str("6d617368-7363-416c-8000-000000000102")
                .expect("checked scheduler UUID"),
            observed_at,
        )
    );
    Ok([left?, right?])
}

async fn participation_page_plan(
    pool: &PgPool,
    game: Uuid,
    event_id: &str,
) -> Result<(u64, bool), MashScaleError> {
    let mut tx = pool.begin().await?;
    sqlx::query("SET LOCAL enable_seqscan = off")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query(
        "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) \
         SELECT game_id, event_id, actor_slot, payload, phase_id, submitted_seq \
         FROM day_event_participation \
         WHERE game_id = $1 AND event_id = $2 \
         ORDER BY submitted_seq, actor_slot LIMIT 101",
    )
    .bind(game)
    .bind(event_id)
    .fetch_one(&mut *tx)
    .await?;
    let plan: serde_json::Value = row.try_get(0)?;
    tx.rollback().await?;
    let mut rows_examined = 0;
    let mut keyset_index_used = false;
    collect_plan_evidence(&plan, &mut rows_examined, &mut keyset_index_used);
    Ok((rows_examined, keyset_index_used))
}

fn collect_plan_evidence(
    value: &serde_json::Value,
    rows_examined: &mut u64,
    index_used: &mut bool,
) {
    match value {
        serde_json::Value::Array(values) => {
            for value in values {
                collect_plan_evidence(value, rows_examined, index_used);
            }
        }
        serde_json::Value::Object(values) => {
            if values.get("Index Name").and_then(|value| value.as_str())
                == Some("day_event_participation_page_idx")
            {
                *index_used = true;
            }
            let is_scan = values
                .get("Node Type")
                .and_then(|value| value.as_str())
                .is_some_and(|node_type| node_type.ends_with("Scan"));
            if is_scan {
                for key in [
                    "Actual Rows",
                    "Rows Removed by Filter",
                    "Rows Removed by Index Recheck",
                ] {
                    *rows_examined = rows_examined.saturating_add(
                        values
                            .get(key)
                            .and_then(|value| value.as_f64())
                            .unwrap_or_default()
                            .ceil() as u64,
                    );
                }
            }
            for value in values.values() {
                collect_plan_evidence(value, rows_examined, index_used);
            }
        }
        _ => {}
    }
}

fn claimed_games(reports: &[DayEventSchedulerTickReport; 2]) -> usize {
    reports.iter().map(|report| report.claimed_games).sum()
}

fn failed_games(reports: &[DayEventSchedulerTickReport; 2]) -> usize {
    reports.iter().map(|report| report.failed_games).sum()
}

fn slot_id(number: usize) -> String {
    format!("slot_{number}")
}

fn user_id(number: usize) -> String {
    format!("mash_scale_user_{number}")
}

fn elapsed_ms(duration: Duration) -> u64 {
    duration.as_millis().try_into().unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::collect_plan_evidence;

    #[test]
    fn plan_evidence_counts_scan_work_without_double_counting_parent_rows() {
        let plan = serde_json::json!([{
            "Plan": {
                "Node Type": "Limit",
                "Actual Rows": 60,
                "Plans": [{
                    "Node Type": "Sort",
                    "Actual Rows": 60,
                    "Plans": [{
                        "Node Type": "Bitmap Heap Scan",
                        "Actual Rows": 60,
                        "Rows Removed by Filter": 1,
                        "Plans": [{
                            "Node Type": "Bitmap Index Scan",
                            "Index Name": "day_event_participation_page_idx",
                            "Actual Rows": 60
                        }]
                    }]
                }]
            }
        }]);
        let mut rows_examined = 0;
        let mut index_used = false;

        collect_plan_evidence(&plan, &mut rows_examined, &mut index_used);

        assert_eq!(rows_examined, 121);
        assert!(index_used);
    }
}
