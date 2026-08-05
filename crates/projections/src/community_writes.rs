//! Community command writers: moderation reports, member mutes, and
//! subscriptions. Folds and rebuilds stay in the crate root; these writers
//! append domain decisions and fold through the shared fold helpers.

use eventstore::EventInput;
use sqlx::postgres::PgPool;
use sqlx::Row;
use uuid::Uuid;

use crate::{
    fold_member_mute_event, fold_moderation_event, fold_subscription_event, member_mute_state,
    moderation_domain_error, public_subscription_target_latest_seq, subscription_domain_state,
    subscription_target_state, MemberMuteStateRow, ModerationReportReceiptRow, ProjectionError,
    SubscriptionTargetStateRow,
};

/// Submit a public-content report under one transaction-scoped target lock.
/// The lock makes case creation, active-report deduplication, and the bounded
/// per-reporter rate check one atomic decision.
pub async fn submit_moderation_report(
    pool: &PgPool,
    target: community::ModerationTarget,
    report_id: Uuid,
    reporter_principal_id: &str,
    reason: community::ReportReasonFamily,
    details: String,
    occurred_at: i64,
) -> Result<ModerationReportReceiptRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    let lock_key = format!(
        "{}:{}:{}",
        target.kind.as_str(),
        target.scope_id,
        target.source_seq
    );
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(lock_key)
        .execute(&mut *tx)
        .await?;
    if !moderation_target_is_public(&mut tx, &target).await? {
        return Err(ProjectionError::ModerationTargetNotPublic);
    }
    let recent: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM moderation_report WHERE reporter_principal_id = $1 AND submitted_at >= $2",
    )
    .bind(reporter_principal_id)
    .bind(occurred_at.saturating_sub(86_400))
    .fetch_one(&mut *tx)
    .await?;
    if recent >= 10 {
        return Err(ProjectionError::ModerationReportRateLimited);
    }

    let existing = moderation_case_state_for_target(&mut tx, &target).await?;
    if let Some(state) = &existing {
        let duplicate: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM moderation_report WHERE case_id = $1 AND reporter_principal_id = $2 AND reason_family = $3 AND active)",
        )
        .bind(state.case_id)
        .bind(reporter_principal_id)
        .bind(reason.as_str())
        .fetch_one(&mut *tx)
        .await?;
        if duplicate {
            return Err(ProjectionError::DuplicateModerationReport);
        }
    }

    let case_id = existing
        .as_ref()
        .map_or_else(Uuid::new_v4, |state| state.case_id);
    let command = match &existing {
        Some(_) => community::ModerationCommand::SubmitReport {
            report_id,
            reason,
            details,
        },
        None => community::ModerationCommand::OpenReport {
            target,
            report_id,
            reason,
            details,
        },
    };
    let events = community::decide_moderation(existing.as_ref(), command)
        .map_err(|reject| moderation_domain_error(reject, "submit report"))?;
    let inputs = moderation_event_inputs(events, reporter_principal_id, occurred_at);
    let expected = existing.as_ref().map_or(0, |state| state.version);
    let stored = eventstore::append_expected_in_tx(&mut tx, case_id, expected, &inputs).await?;
    for event in &stored {
        fold_moderation_event(&mut tx, case_id, event).await?;
    }
    tx.commit().await?;
    Ok(ModerationReportReceiptRow {
        report_id,
        status: "received".to_string(),
        submitted_at: occurred_at,
    })
}

pub async fn append_moderation_and_project_expected(
    pool: &PgPool,
    case_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<community::ModerationEvent>,
    actor_principal_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs = moderation_event_inputs(events, actor_principal_id, occurred_at);
    let mut tx = pool.begin().await?;
    let stored =
        eventstore::append_expected_in_tx(&mut tx, case_id, expected_stream_seq, &inputs).await?;
    for event in &stored {
        fold_moderation_event(&mut tx, case_id, event).await?;
    }
    tx.commit().await?;
    Ok(())
}

fn moderation_event_inputs(
    events: Vec<community::ModerationEvent>,
    actor_principal_id: &str,
    occurred_at: i64,
) -> Vec<EventInput> {
    events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::User(actor_principal_id.to_string()),
                occurred_at,
            )
        })
        .collect()
}

pub async fn mute_public_profile(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    change_public_profile_mute(pool, principal_user_id, target_handle, true, occurred_at).await
}

pub async fn unmute_public_profile(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    change_public_profile_mute(pool, principal_user_id, target_handle, false, occurred_at).await
}

async fn change_public_profile_mute(
    pool: &PgPool,
    principal_user_id: &str,
    target_handle: &str,
    mute: bool,
    occurred_at: i64,
) -> Result<MemberMuteStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    let target = sqlx::query(
        r#"
        SELECT profile.profile_id, owner.principal_user_id AS owner_principal_user_id
        FROM profile_public AS profile
        JOIN profile_editor AS owner ON owner.profile_id = profile.profile_id
        LEFT JOIN community_member_mute AS existing
          ON existing.principal_user_id = $2
         AND existing.target_profile_id = profile.profile_id
        WHERE profile.handle = $1
          AND (profile.visibility = 'public' OR (NOT $3 AND existing.relationship_id IS NOT NULL))
        "#,
    )
    .bind(target_handle)
    .bind(principal_user_id)
    .bind(mute)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(ProjectionError::MuteTargetNotPublic)?;
    let target_profile_id: Uuid = target.get("profile_id");
    if target.get::<String, _>("owner_principal_user_id") == principal_user_id {
        return Err(ProjectionError::CannotMuteSelf);
    }
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "member-mute:{principal_user_id}:{target_profile_id}"
        ))
        .execute(&mut *tx)
        .await?;
    let existing = member_mute_domain_state(&mut tx, principal_user_id, target_profile_id).await?;
    let relationship_id = existing
        .as_ref()
        .map_or_else(Uuid::new_v4, |state| state.relationship_id);
    let command = if mute {
        community::MemberMuteCommand::Mute { target_profile_id }
    } else {
        community::MemberMuteCommand::Unmute
    };
    let events = community::decide_member_mute(existing.as_ref(), command)
        .map_err(member_mute_domain_error)?;
    append_member_mute_events(
        &mut tx,
        relationship_id,
        existing.as_ref().map_or(0, |state| state.version),
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    member_mute_state(pool, principal_user_id, target_handle).await
}

async fn member_mute_domain_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_user_id: &str,
    target_profile_id: Uuid,
) -> Result<Option<community::MemberMuteState>, ProjectionError> {
    let row = sqlx::query(
        "SELECT relationship_id, active, version FROM community_member_mute WHERE principal_user_id = $1 AND target_profile_id = $2",
    )
    .bind(principal_user_id)
    .bind(target_profile_id)
    .fetch_optional(&mut **tx)
    .await?;
    Ok(row.map(|row| community::MemberMuteState {
        relationship_id: row.get("relationship_id"),
        principal_user_id: principal_user_id.to_string(),
        target_profile_id,
        active: row.get("active"),
        version: row.get("version"),
    }))
}

fn member_mute_domain_error(reject: community::CommunityReject) -> ProjectionError {
    match reject {
        community::CommunityReject::AlreadyMuted => ProjectionError::AlreadyMuted,
        community::CommunityReject::NotMuted | community::CommunityReject::MuteNotFound => {
            ProjectionError::NotMuted
        }
        _ => ProjectionError::Payload {
            kind: "community member mute".to_string(),
            source: serde::de::Error::custom(reject.to_string()),
        },
    }
}

async fn append_member_mute_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    relationship_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<community::MemberMuteEvent>,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::User(principal_user_id.to_string()),
                occurred_at,
            )
        })
        .collect();
    let stored =
        eventstore::append_expected_in_tx(tx, relationship_id, expected_stream_seq, &inputs)
            .await?;
    for event in &stored {
        fold_member_mute_event(tx, relationship_id, event).await?;
    }
    Ok(())
}

pub async fn subscribe_to_public_target(
    pool: &PgPool,
    target: community::SubscriptionTarget,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    let existing = subscription_domain_state(&mut tx, principal_user_id, &target).await?;
    let subscription_id = existing
        .as_ref()
        .map_or_else(Uuid::new_v4, |state| state.subscription_id);
    let events = community::decide_subscription(
        existing.as_ref(),
        community::SubscriptionCommand::Subscribe {
            target: target.clone(),
            initial_read_through_seq: latest_source_seq,
        },
    )
    .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        subscription_id,
        existing.as_ref().map_or(0, |state| state.version),
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

pub async fn unsubscribe_from_public_target(
    pool: &PgPool,
    target: community::SubscriptionTarget,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let state = subscription_domain_state(&mut tx, principal_user_id, &target)
        .await?
        .ok_or(ProjectionError::NotSubscribed)?;
    let events =
        community::decide_subscription(Some(&state), community::SubscriptionCommand::Unsubscribe)
            .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        state.subscription_id,
        state.version,
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

pub async fn advance_subscription_read_cursor(
    pool: &PgPool,
    target: community::SubscriptionTarget,
    principal_user_id: &str,
    read_through_seq: i64,
    occurred_at: i64,
) -> Result<SubscriptionTargetStateRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    lock_subscription_target(&mut tx, principal_user_id, &target).await?;
    let latest_source_seq = public_subscription_target_latest_seq(&mut tx, &target)
        .await?
        .ok_or(ProjectionError::SubscriptionTargetNotPublic)?;
    if read_through_seq <= 0 || read_through_seq > latest_source_seq {
        return Err(ProjectionError::InvalidSubscriptionReadCursor);
    }
    let state = subscription_domain_state(&mut tx, principal_user_id, &target)
        .await?
        .ok_or(ProjectionError::NotSubscribed)?;
    let events = community::decide_subscription(
        Some(&state),
        community::SubscriptionCommand::AdvanceRead { read_through_seq },
    )
    .map_err(subscription_domain_error)?;
    append_subscription_events(
        &mut tx,
        state.subscription_id,
        state.version,
        events,
        principal_user_id,
        occurred_at,
    )
    .await?;
    tx.commit().await?;
    subscription_target_state(pool, principal_user_id, target).await
}

async fn lock_subscription_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    principal_user_id: &str,
    target: &community::SubscriptionTarget,
) -> Result<(), ProjectionError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!(
            "subscription:{principal_user_id}:{}:{}",
            target.kind.as_str(),
            target.scope_id
        ))
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn append_subscription_events(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    subscription_id: Uuid,
    expected_stream_seq: i64,
    events: Vec<community::SubscriptionEvent>,
    principal_user_id: &str,
    occurred_at: i64,
) -> Result<(), ProjectionError> {
    let inputs: Vec<_> = events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::User(principal_user_id.to_string()),
                occurred_at,
            )
        })
        .collect();
    let stored =
        eventstore::append_expected_in_tx(tx, subscription_id, expected_stream_seq, &inputs)
            .await?;
    for event in &stored {
        fold_subscription_event(tx, subscription_id, event).await?;
    }
    Ok(())
}

fn subscription_domain_error(reject: community::CommunityReject) -> ProjectionError {
    match reject {
        community::CommunityReject::AlreadySubscribed => ProjectionError::AlreadySubscribed,
        community::CommunityReject::NotSubscribed
        | community::CommunityReject::SubscriptionNotFound => ProjectionError::NotSubscribed,
        community::CommunityReject::ReadCursorMustAdvance => {
            ProjectionError::InvalidSubscriptionReadCursor
        }
        _ => ProjectionError::Payload {
            kind: "community subscription".to_string(),
            source: serde::de::Error::custom(reject.to_string()),
        },
    }
}

async fn moderation_case_state_for_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target: &community::ModerationTarget,
) -> Result<Option<community::ModerationCaseState>, ProjectionError> {
    let row = sqlx::query(
        "SELECT case_id, status, version FROM moderation_case WHERE target_kind = $1 AND scope_id = $2 AND source_seq = $3",
    )
    .bind(target.kind.as_str())
    .bind(target.scope_id)
    .bind(target.source_seq)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(community::ModerationCaseState {
            case_id: row.get("case_id"),
            target: target.clone(),
            status: community::ModerationCaseStatus::parse(row.get::<String, _>("status").as_str())
                .map_err(|reject| moderation_domain_error(reject, "load case"))?,
            version: row.get("version"),
        })
    })
    .transpose()
}

async fn moderation_target_is_public(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target: &community::ModerationTarget,
) -> Result<bool, ProjectionError> {
    let visible: bool = match target.kind {
        community::ModerationTargetKind::DiscussionPost => {
            sqlx::query_scalar(
                r#"
            SELECT EXISTS(
                SELECT 1
                FROM discussion_post AS post
                JOIN discussion_topic AS topic ON topic.topic_id = post.topic_id
                WHERE post.topic_id = $1 AND post.source_seq = $2
                  AND topic.visibility = 'visible'
                  AND NOT EXISTS (
                      SELECT 1 FROM moderation_target_state AS moderation
                      WHERE moderation.target_kind = 'discussion_post'
                        AND moderation.scope_id = post.topic_id
                        AND moderation.source_seq = post.source_seq
                        AND moderation.visibility = 'hidden'
                  )
            )
            "#,
            )
            .bind(target.scope_id)
            .bind(target.source_seq)
            .fetch_one(&mut **tx)
            .await?
        }
        community::ModerationTargetKind::GamePost => {
            sqlx::query_scalar(
                r#"
            SELECT EXISTS(
                SELECT 1
                FROM thread_view AS post
                JOIN game_index AS game ON game.game_id = post.game_id
                WHERE post.game_id = $1 AND post.source_seq = $2
                  AND post.channel_id = 'main'
                  AND game.status IN ('active', 'completed')
                  AND NOT EXISTS (
                      SELECT 1 FROM moderation_target_state AS moderation
                      WHERE moderation.target_kind = 'game_post'
                        AND moderation.scope_id = post.game_id
                        AND moderation.source_seq = post.source_seq
                        AND moderation.visibility = 'hidden'
                  )
            )
            "#,
            )
            .bind(target.scope_id)
            .bind(target.source_seq)
            .fetch_one(&mut **tx)
            .await?
        }
    };
    Ok(visible)
}
