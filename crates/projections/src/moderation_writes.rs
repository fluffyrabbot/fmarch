//! Trust-and-safety application service for public publications.
//!
//! This module owns the transaction that loads a moderation case, asks the
//! `trust_safety` domain to decide, appends the case events, and folds them.

use eventstore::EventInput;
use principal::PrincipalId;
use sqlx::postgres::PgPool;
use sqlx::Row;
use trust_safety::{
    self, ModerationCaseState, ModerationCaseStatus, ModerationCommand, ModerationEvent,
    ModerationTarget, ReportReasonFamily,
};
use uuid::Uuid;

use crate::{
    fold_moderation_event, moderation_domain_error, ModerationReportReceiptRow, ProjectionError,
};

/// Submit a public-content report under one transaction-scoped target lock.
/// The lock makes case creation, active-report deduplication, and the bounded
/// per-reporter rate check one atomic decision.
pub async fn submit_moderation_report(
    pool: &PgPool,
    target: ModerationTarget,
    report_id: Uuid,
    reporter_principal_id: PrincipalId,
    reason: ReportReasonFamily,
    details: String,
    occurred_at: i64,
) -> Result<ModerationReportReceiptRow, ProjectionError> {
    let mut tx = pool.begin().await?;
    let lock_key = format!("{}:{}", target.public.surface_id, target.public.source_seq);
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
    .bind(reporter_principal_id.as_uuid())
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
        .bind(reporter_principal_id.as_uuid())
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
        Some(_) => ModerationCommand::SubmitReport {
            report_id,
            reason,
            details,
        },
        None => ModerationCommand::OpenReport {
            target,
            report_id,
            reason,
            details,
        },
    };
    let events = trust_safety::decide_moderation(existing.as_ref(), command)
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
    events: Vec<ModerationEvent>,
    actor_principal_id: PrincipalId,
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
    events: Vec<ModerationEvent>,
    actor_principal_id: PrincipalId,
    occurred_at: i64,
) -> Vec<EventInput> {
    events
        .into_iter()
        .map(|event| {
            EventInput::new(
                event.kind(),
                1,
                event.payload(),
                eventstore::ActorId::Principal(actor_principal_id),
                occurred_at,
            )
        })
        .collect()
}

async fn moderation_case_state_for_target(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target: &ModerationTarget,
) -> Result<Option<ModerationCaseState>, ProjectionError> {
    let row = sqlx::query(
        "SELECT case_id, status, version FROM moderation_case WHERE surface_id = $1 AND source_seq = $2",
    )
    .bind(target.public.surface_id)
    .bind(target.public.source_seq)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok(ModerationCaseState {
            case_id: row.get("case_id"),
            target: target.clone(),
            status: ModerationCaseStatus::parse(row.get::<String, _>("status").as_str())
                .map_err(|reject| moderation_domain_error(reject, "load case"))?,
            version: row.get("version"),
        })
    })
    .transpose()
}

async fn moderation_target_is_public(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    target: &ModerationTarget,
) -> Result<bool, ProjectionError> {
    let visible: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM public_publication AS publication
            JOIN publication_surface AS surface ON surface.surface_id = publication.surface_id
            WHERE publication.surface_id = $1
              AND publication.source_seq = $2
              AND publication.visible
              AND surface.visible
        )
        "#,
    )
    .bind(target.public.surface_id)
    .bind(target.public.source_seq)
    .fetch_one(&mut **tx)
    .await?;
    Ok(visible)
}
